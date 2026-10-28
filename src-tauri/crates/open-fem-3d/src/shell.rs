//! Platen (vlakke schalen) aan de Open FEM-grens.
//!
//! Platen rekenen met het MITC4-vierhoekelement van de externe 3D-kern (zes
//! vrijheidsgraden per knoop: EAS-membraan, Mindlin-buiging met aangenomen
//! dwarskrachtrek, draaiveer loodrecht op het vlak). Het DKT-driehoekelement
//! van dezelfde kern wordt bewust niet aangeboden: het haalt de analytische
//! referenties niet (zie `tests/plate_cases.rs`). Driehoekige gebieden meshen
//! we daarom als vierhoeken (één driehoek = drie vierhoeken).
//!
//! De uitvoer van de kern staat per element in een eigen lokaal assenstelsel.
//! Deze module zet alles om naar één contract:
//!
//! * Plaatassen: z is de plaatnormaal; bij een niet-verticale plaat wijst z
//!   omhoog, bij een verticale plaat wijst y omhoog. x is de projectie van de
//!   globale X-as op het plaatvlak (of van de globale Y-as als de plaat
//!   loodrecht op X staat); y = z × x.
//! * Membraankrachten n (kN/m): n = ∫σ dz, trek positief.
//! * Momenten m (kNm/m): positief geeft trek aan de onderzijde (de −z-zijde),
//!   dus m = −∫σ·z dz. Een op zwaartekracht belaste vloer heeft positieve
//!   veldmomenten en negatieve inklemmomenten.
//! * Dwarskrachten v (kN/m): v = ∫τ_αz dz op een snede met normaal +α,
//!   positief in +z, uit de aangenomen dwarskrachtrek van MITC4.
//! * Spanningen boven (+z) en onder (−z) in MPa: σ = n/t ∓ 6·m/t².
//! * Knoopwaarden: gemiddelde van de hoekwaarden van de aansluitende elementen
//!   van dezelfde plaat; op de plaatrand een kwadratische patchfit door de
//!   elementmiddens (anders zou een inklemmoment slechts de waarde op een
//!   halve elementbreedte van de rand tonen).
//!
//! Vlaklasten worden hier consistent naar knoopkrachten omgezet
//! (F_i = q·∫N_i dA), zodat hun resultante en hun moment om elk punt exact
//! gelijk zijn aan die van de werkelijke last.

use std::collections::{BTreeMap, HashMap};

use rekenkern::element::quad::{quad_stress_at_nodes, quad_stresses, quad_transform_3d};
use serde::{Deserialize, Serialize};

use crate::{Plate3D, ShellElement3D, SolveRequest3D};

pub(crate) type V3 = [f64; 3];

pub(crate) fn sub(a: V3, b: V3) -> V3 { [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
pub(crate) fn add(a: V3, b: V3) -> V3 { [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
pub(crate) fn scale(a: V3, s: f64) -> V3 { [a[0] * s, a[1] * s, a[2] * s] }
pub(crate) fn dot(a: V3, b: V3) -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
pub(crate) fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub(crate) fn norm(a: V3) -> f64 { dot(a, a).sqrt() }
pub(crate) fn unit(a: V3) -> Option<V3> {
    let length = norm(a);
    if length.is_finite() && length > 0.0 { Some(scale(a, 1.0 / length)) } else { None }
}

/// Oppervlaktevector van een vlakke veelhoek: richting = normaal volgens de
/// rechterhandregel van de knoopvolgorde, lengte = oppervlakte.
pub(crate) fn area_vector(points: &[V3]) -> V3 {
    let origin = points[0];
    let mut sum = [0.0; 3];
    for index in 1..points.len().saturating_sub(1) {
        let a = sub(points[index], origin);
        let b = sub(points[index + 1], origin);
        sum = add(sum, cross(a, b));
    }
    scale(sum, 0.5)
}

/// Assenstelsel van één plaat; zie de module-uitleg voor de afspraak.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlateAxes3D {
    pub x: V3,
    pub y: V3,
    pub z: V3,
}

/// Plaatassen uit een (niet genormeerde) plaatnormaal.
pub(crate) fn plate_axes(normal: V3) -> Option<PlateAxes3D> {
    let mut z = unit(normal)?;
    let project = |axis: V3, z: V3| sub(axis, scale(z, dot(axis, z)));
    let mut x = project([1.0, 0.0, 0.0], z);
    if norm(x) < 1e-3 {
        x = project([0.0, 1.0, 0.0], z);
    }
    let x = unit(x)?;
    if z[2].abs() > 1e-6 {
        if z[2] < 0.0 { z = scale(z, -1.0); }
    } else if cross(z, x)[2] < 0.0 {
        z = scale(z, -1.0);
    }
    let y = cross(z, x);
    Some(PlateAxes3D { x, y, z })
}

/// Alle plaatgrootheden in één punt, in plaatassen.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellValues3D {
    pub nxx_kn_per_m: f64,
    pub nyy_kn_per_m: f64,
    pub nxy_kn_per_m: f64,
    pub mxx_knm_per_m: f64,
    pub myy_knm_per_m: f64,
    pub mxy_knm_per_m: f64,
    /// Dwarskrachten; `None` alleen als het element er geen levert.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vx_kn_per_m: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vy_kn_per_m: Option<f64>,
    pub sigma_xx_top_mpa: f64,
    pub sigma_yy_top_mpa: f64,
    pub tau_xy_top_mpa: f64,
    pub von_mises_top_mpa: f64,
    pub sigma_xx_bottom_mpa: f64,
    pub sigma_yy_bottom_mpa: f64,
    pub tau_xy_bottom_mpa: f64,
    pub von_mises_bottom_mpa: f64,
}

/// Resultaat in het midden van één plaatelement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellElementResult3D {
    pub element_id: usize,
    pub plate_id: usize,
    pub centroid_m: V3,
    #[serde(flatten)]
    pub values: ShellValues3D,
}

/// Knoopwaarde van één plaat: het gemiddelde van de aansluitende elementen
/// van díe plaat (bij een plaatknik of een aansluitende tweede plaat wordt
/// niet over de plaatgrens heen gemiddeld).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellNodeResult3D {
    pub node_id: usize,
    pub plate_id: usize,
    /// Verplaatsing langs de plaatnormaal z (m).
    pub w_m: f64,
    #[serde(flatten)]
    pub values: ShellValues3D,
}

/// Uiterste knoopwaarden van één grootheid binnen één plaat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlateExtreme3D {
    /// Veldnaam zoals in `ShellNodeResult3D` (bijv. `mxxKnmPerM` of `wM`).
    pub quantity: String,
    pub min: f64,
    pub min_node_id: usize,
    pub max: f64,
    pub max_node_id: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlateSummary3D {
    pub plate_id: usize,
    pub axes: PlateAxes3D,
    pub element_count: usize,
    pub node_count: usize,
    pub area_m2: f64,
    /// Resultante van de vlaklasten op deze plaat plus de knooplasten op
    /// haar knopen, globaal (kN). Een knooplast op een knoop van meer platen
    /// telt naar rato mee (gelijk verdeeld). Knoopmomenten tellen niet mee.
    pub load_resultant_kn: V3,
    pub extremes: Vec<PlateExtreme3D>,
}

/// Plaatgegevens die de adapter vóór het rekenen vastlegt.
pub(crate) struct PlateGeometry {
    pub axes: PlateAxes3D,
    pub area_m2: f64,
}

/// Coördinaten van de knopen van een element.
pub(crate) fn element_points(element: &ShellElement3D, nodes: &HashMap<usize, V3>) -> Vec<V3> {
    element.node_ids.iter().map(|id| nodes[id]).collect()
}

/// Controleer elementen en plaatvlakken en bepaal de plaatassen.
pub(crate) fn validate_shells(
    request: &SolveRequest3D,
    nodes: &HashMap<usize, V3>,
) -> Result<HashMap<usize, PlateGeometry>, String> {
    let materials: std::collections::HashSet<usize> = request.materials.iter().map(|m| m.id).collect();
    let mut plates: BTreeMap<usize, &Plate3D> = BTreeMap::new();
    for plate in &request.plates {
        if plate.id == 0 { return Err("plaat-id 0 is niet toegestaan".into()); }
        if plates.insert(plate.id, plate).is_some() { return Err(format!("dubbele plaat-id {}", plate.id)); }
        if !materials.contains(&plate.material_id) {
            return Err(format!("plaat {} verwijst naar ontbrekend materiaal {}", plate.id, plate.material_id));
        }
        if !plate.thickness_m.is_finite() || plate.thickness_m <= 0.0 {
            return Err(format!("plaat {} heeft een ongeldige dikte {} m", plate.id, plate.thickness_m));
        }
        if let Some(orthotropy) = &plate.orthotropy {
            orthotropy.validate(plate.id)?;
        }
    }
    let mut element_ids = std::collections::HashSet::new();
    let mut per_plate: BTreeMap<usize, Vec<&ShellElement3D>> = BTreeMap::new();
    for element in &request.shell_elements {
        if element.id == 0 { return Err("plaatelement-id 0 is niet toegestaan".into()); }
        if !element_ids.insert(element.id) { return Err(format!("dubbele plaatelement-id {}", element.id)); }
        if !plates.contains_key(&element.plate_id) {
            return Err(format!("plaatelement {} verwijst naar ontbrekende plaat {}", element.id, element.plate_id));
        }
        if element.node_ids.len() != 4 {
            return Err(format!(
                "plaatelement {} moet vier knopen hebben: platen rekenen met MITC4-vierhoeken                  (een driehoek is als drie vierhoeken te meshen)",
                element.id,
            ));
        }
        for (index, id) in element.node_ids.iter().enumerate() {
            if !nodes.contains_key(id) {
                return Err(format!("plaatelement {} verwijst naar ontbrekende knoop {id}", element.id));
            }
            if element.node_ids[..index].contains(id) {
                return Err(format!("plaatelement {} gebruikt knoop {id} twee keer", element.id));
            }
        }
        let points = element_points(element, nodes);
        let area = area_vector(&points);
        let span = points.iter().map(|p| norm(sub(*p, points[0]))).fold(0.0, f64::max);
        if !(norm(area) > 1e-10 * span.max(1e-9).powi(2)) {
            return Err(format!("plaatelement {} heeft geen oppervlakte", element.id));
        }
        {
            // Vlak en strikt convex in het eigen vlak: dan is de Jacobiaan
            // van MITC4 overal positief.
            let normal = unit(area).unwrap();
            let warp = (0..4).map(|i| dot(sub(points[i], points[0]), normal).abs()).fold(0.0, f64::max);
            if warp > 1e-6 * span.max(1e-9) {
                return Err(format!("plaatelement {} is niet vlak (scheluwte {warp:.3e} m)", element.id));
            }
            for i in 0..4 {
                let a = points[i];
                let b = points[(i + 1) % 4];
                let c = points[(i + 2) % 4];
                if dot(cross(sub(b, a), sub(c, b)), normal) <= 1e-12 * span.max(1e-9).powi(2) {
                    return Err(format!("plaatelement {} is niet convex of gedegenereerd", element.id));
                }
            }
        }
        per_plate.entry(element.plate_id).or_default().push(element);
    }
    let mut geometry = HashMap::new();
    for (plate_id, _) in &plates {
        let elements = per_plate.get(plate_id)
            .ok_or_else(|| format!("plaat {plate_id} heeft geen elementen"))?;
        // Referentienormaal: de oppervlaktevector van het eerste element. De
        // overige mogen tegengesteld omlopen; hun normaal telt dan gespiegeld.
        let reference = unit(area_vector(&element_points(elements[0], nodes))).unwrap();
        let mut normal_sum = [0.0; 3];
        let mut area_sum = 0.0;
        let mut span: f64 = 0.0;
        let origin = nodes[&elements[0].node_ids[0]];
        for element in elements {
            let points = element_points(element, nodes);
            let area = area_vector(&points);
            let oriented = if dot(area, reference) < 0.0 { scale(area, -1.0) } else { area };
            normal_sum = add(normal_sum, oriented);
            area_sum += norm(area);
            for point in &points { span = span.max(norm(sub(*point, origin))); }
        }
        let normal = unit(normal_sum).ok_or_else(|| format!("plaat {plate_id} heeft geen eenduidig vlak"))?;
        let tolerance = 1e-6 * span.max(1.0);
        for element in elements {
            let points = element_points(element, nodes);
            let element_normal = unit(area_vector(&points)).unwrap();
            if dot(element_normal, normal).abs() < 1.0 - 1e-6 {
                return Err(format!("plaat {plate_id} is niet vlak: element {} staat schuin op het plaatvlak", element.id));
            }
            for point in &points {
                if dot(sub(*point, origin), normal).abs() > tolerance {
                    return Err(format!("plaat {plate_id} is niet vlak: element {} ligt buiten het plaatvlak", element.id));
                }
            }
        }
        let axes = plate_axes(normal).ok_or_else(|| format!("plaat {plate_id} heeft geen bruikbare assen"))?;
        geometry.insert(*plate_id, PlateGeometry { axes, area_m2: area_sum });
    }
    let mut load_ids = std::collections::HashSet::new();
    for load in &request.surface_loads {
        if load.id == 0 { return Err("vlaklast-id 0 is niet toegestaan".into()); }
        if !load_ids.insert(load.id) { return Err(format!("dubbele vlaklast-id {}", load.id)); }
        if !plates.contains_key(&load.plate_id) {
            return Err(format!("vlaklast {} verwijst naar ontbrekende plaat {}", load.id, load.plate_id));
        }
        let values = [load.qx_kn_per_m2, load.qy_kn_per_m2, load.qz_kn_per_m2];
        if values.iter().any(|v| !v.is_finite()) || values.iter().all(|v| *v == 0.0) {
            return Err(format!("vlaklast {} bevat geen geldige niet-nulwaarde", load.id));
        }
    }
    Ok(geometry)
}

/// Gewichten ∫N_i dA van de knopen van een vlakke bilineaire vierhoek, met
/// 2×2 Gauss (exact voor een vlakke vierhoek).
pub(crate) fn nodal_area_weights(points: &[V3]) -> Vec<f64> {
    let normal = unit(area_vector(points)).unwrap_or([0.0, 0.0, 1.0]);
    let ex = unit(sub(sub(points[1], points[0]), scale(normal, dot(sub(points[1], points[0]), normal))))
        .unwrap_or([1.0, 0.0, 0.0]);
    let ey = cross(normal, ex);
    let local: Vec<[f64; 2]> = points.iter()
        .map(|p| { let d = sub(*p, points[0]); [dot(d, ex), dot(d, ey)] })
        .collect();
    let g = 1.0 / 3.0_f64.sqrt();
    let mut weights = vec![0.0; 4];
    for (xi, eta) in [(-g, -g), (g, -g), (g, g), (-g, g)] {
        let n = [
            0.25 * (1.0 - xi) * (1.0 - eta), 0.25 * (1.0 + xi) * (1.0 - eta),
            0.25 * (1.0 + xi) * (1.0 + eta), 0.25 * (1.0 - xi) * (1.0 + eta),
        ];
        let dxi = [-0.25 * (1.0 - eta), 0.25 * (1.0 - eta), 0.25 * (1.0 + eta), -0.25 * (1.0 + eta)];
        let deta = [-0.25 * (1.0 - xi), -0.25 * (1.0 + xi), 0.25 * (1.0 + xi), 0.25 * (1.0 - xi)];
        let mut j = [[0.0; 2]; 2];
        for i in 0..4 {
            j[0][0] += dxi[i] * local[i][0];
            j[0][1] += dxi[i] * local[i][1];
            j[1][0] += deta[i] * local[i][0];
            j[1][1] += deta[i] * local[i][1];
        }
        let det = (j[0][0] * j[1][1] - j[0][1] * j[1][0]).abs();
        for i in 0..4 { weights[i] += n[i] * det; }
    }
    weights
}

/// Vlaklasten als knoopkrachten (globaal, kN), per knoop opgeteld.
pub(crate) fn surface_load_nodal_forces(
    request: &SolveRequest3D,
    nodes: &HashMap<usize, V3>,
) -> BTreeMap<usize, V3> {
    let mut per_plate: HashMap<usize, V3> = HashMap::new();
    for load in &request.surface_loads {
        let entry = per_plate.entry(load.plate_id).or_insert([0.0; 3]);
        *entry = add(*entry, [load.qx_kn_per_m2, load.qy_kn_per_m2, load.qz_kn_per_m2]);
    }
    let mut forces: BTreeMap<usize, V3> = BTreeMap::new();
    for element in &request.shell_elements {
        let Some(q) = per_plate.get(&element.plate_id) else { continue };
        let points = element_points(element, nodes);
        for (node_id, weight) in element.node_ids.iter().zip(nodal_area_weights(&points)) {
            let entry = forces.entry(*node_id).or_insert([0.0; 3]);
            *entry = add(*entry, scale(*q, weight));
        }
    }
    forces
}

/// Plaatkrachten in het vlak (n) en momenten (m) als symmetrische 2×2-tensoren.
#[derive(Debug, Clone, Copy, Default)]
struct Resultants {
    n: [f64; 3], // xx, yy, xy (kN/m)
    m: [f64; 3], // xx, yy, xy (kNm/m), m = −∫σ·z dz
}

/// Teken van de kernmomenten ten opzichte van dit contract (m = −∫σ·z dz,
/// trek onder positief), in het eigen elementassenstelsel. MITC4 rekent met
/// κxx = −∂θy/∂x, κyy = ∂θx/∂y (rechtsdraaiende rotaties, u = z·θy, v = −z·θx):
/// ε = −z·κ, dus m_kern = −∫σ·z dz, precies dit contract. Geverifieerd met een
/// vrij opgelegde plaat onder zwaartekracht (positief veldmoment).
const QUAD_MOMENT_SIGN: f64 = 1.0;

fn tensor_to_plate(value: [f64; 3], e1: V3, e2: V3, axes: &PlateAxes3D) -> [f64; 3] {
    // T = Σ T_ab e_a ⊗ e_b;  T'_ij = x_i · T · x_j.
    let c = [[dot(axes.x, e1), dot(axes.x, e2)], [dot(axes.y, e1), dot(axes.y, e2)]];
    let t = [[value[0], value[2]], [value[2], value[1]]];
    let mut out = [[0.0; 2]; 2];
    for i in 0..2 {
        for j in 0..2 {
            let mut sum = 0.0;
            for a in 0..2 { for b in 0..2 { sum += c[i][a] * t[a][b] * c[j][b]; } }
            out[i][j] = sum;
        }
    }
    [out[0][0], out[1][1], 0.5 * (out[0][1] + out[1][0])]
}

fn vector_to_plate(value: [f64; 2], e1: V3, e2: V3, axes: &PlateAxes3D) -> [f64; 2] {
    let global = add(scale(e1, value[0]), scale(e2, value[1]));
    [dot(global, axes.x), dot(global, axes.y)]
}

fn values_from(resultants: Resultants, shear: Option<[f64; 2]>, thickness: f64) -> ShellValues3D {
    let t = thickness;
    let stress = |n: f64, m: f64, top: bool| {
        let bending = 6.0 * m / (t * t);
        (n / t + if top { -bending } else { bending }) / 1000.0
    };
    let von_mises = |sx: f64, sy: f64, txy: f64| (sx * sx - sx * sy + sy * sy + 3.0 * txy * txy).max(0.0).sqrt();
    let [nxx, nyy, nxy] = resultants.n;
    let [mxx, myy, mxy] = resultants.m;
    let top = [stress(nxx, mxx, true), stress(nyy, myy, true), stress(nxy, mxy, true)];
    let bottom = [stress(nxx, mxx, false), stress(nyy, myy, false), stress(nxy, mxy, false)];
    ShellValues3D {
        nxx_kn_per_m: nxx, nyy_kn_per_m: nyy, nxy_kn_per_m: nxy,
        mxx_knm_per_m: mxx, myy_knm_per_m: myy, mxy_knm_per_m: mxy,
        vx_kn_per_m: shear.map(|v| v[0]), vy_kn_per_m: shear.map(|v| v[1]),
        sigma_xx_top_mpa: top[0], sigma_yy_top_mpa: top[1], tau_xy_top_mpa: top[2],
        von_mises_top_mpa: von_mises(top[0], top[1], top[2]),
        sigma_xx_bottom_mpa: bottom[0], sigma_yy_bottom_mpa: bottom[1], tau_xy_bottom_mpa: bottom[2],
        von_mises_bottom_mpa: von_mises(bottom[0], bottom[1], bottom[2]),
    }
}

/// Transversale dwarskracht van MITC4 in het elementmidden, uit dezelfde
/// aangenomen (ANS) dwarskrachtrek als de stijfheid van de kern: covariante
/// rekken in de vier bindpunten, geïnterpoleerd naar ξ = η = 0 en met J⁻¹
/// naar fysieke rekken gebracht (γxz, γyz); de dwarskracht is v = S·γ.
fn mitc4_centre_shear_strain(local: &[[f64; 2]; 4], u_local: &[f64]) -> [f64; 2] {
    let shape = |xi: f64, eta: f64| [
        0.25 * (1.0 - xi) * (1.0 - eta), 0.25 * (1.0 + xi) * (1.0 - eta),
        0.25 * (1.0 + xi) * (1.0 + eta), 0.25 * (1.0 - xi) * (1.0 + eta),
    ];
    let derivatives = |xi: f64, eta: f64| (
        [-0.25 * (1.0 - eta), 0.25 * (1.0 - eta), 0.25 * (1.0 + eta), -0.25 * (1.0 + eta)],
        [-0.25 * (1.0 - xi), -0.25 * (1.0 + xi), 0.25 * (1.0 + xi), 0.25 * (1.0 - xi)],
    );
    let jacobian = |xi: f64, eta: f64| {
        let (dxi, deta) = derivatives(xi, eta);
        let mut j = [[0.0; 2]; 2];
        for i in 0..4 {
            j[0][0] += dxi[i] * local[i][0];
            j[0][1] += dxi[i] * local[i][1];
            j[1][0] += deta[i] * local[i][0];
            j[1][1] += deta[i] * local[i][1];
        }
        j
    };
    // Covariante rek e_ξz (rij 0) of e_ηz (rij 1) in (ξ, η).
    let covariant = |xi: f64, eta: f64, row: usize| {
        let j = jacobian(xi, eta);
        let n = shape(xi, eta);
        let (dxi, deta) = derivatives(xi, eta);
        let mut value = 0.0;
        for i in 0..4 {
            let w = u_local[i * 6 + 2];
            let theta_x = u_local[i * 6 + 3];
            let theta_y = u_local[i * 6 + 4];
            value += if row == 0 {
                dxi[i] * w - j[0][1] * n[i] * theta_x + j[0][0] * n[i] * theta_y
            } else {
                deta[i] * w - j[1][1] * n[i] * theta_x + j[1][0] * n[i] * theta_y
            };
        }
        value
    };
    let e_xi = 0.5 * (covariant(0.0, -1.0, 0) + covariant(0.0, 1.0, 0));
    let e_eta = 0.5 * (covariant(-1.0, 0.0, 1) + covariant(1.0, 0.0, 1));
    let j = jacobian(0.0, 0.0);
    let det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
    let inv = [[j[1][1] / det, -j[0][1] / det], [-j[1][0] / det, j[0][0] / det]];
    let gamma_xz = inv[0][0] * e_xi + inv[0][1] * e_eta;
    let gamma_yz = inv[1][0] * e_xi + inv[1][1] * e_eta;
    [gamma_xz, gamma_yz]
}

struct ElementOutcome {
    centre: Resultants,
    corners: Vec<Resultants>,
    shear: Option<[f64; 2]>,
}

fn row_vector(t: &[f64], n: usize, row: usize) -> V3 { [t[row * n], t[row * n + 1], t[row * n + 2]] }

/// Eigen assen (e1, e2) van een MITC4-element in de kern.
pub(crate) fn element_axes(coords: &[V3; 4]) -> (V3, V3) {
    let transform = quad_transform_3d(coords);
    (row_vector(&transform, 24, 0), row_vector(&transform, 24, 1))
}

fn mat_vec(t: &[f64], u: &[f64], n: usize) -> Vec<f64> {
    (0..n).map(|i| (0..n).map(|j| t[i * n + j] * u[j]).sum()).collect()
}

/// Kernuitvoer van één MITC4-element, omgezet naar dit contract in plaatassen.
fn element_outcome(
    points: &[V3],
    u_global: &[f64],
    e_kn_m2: f64,
    nu: f64,
    thickness: f64,
    axes: &PlateAxes3D,
    orthotropy: Option<&crate::orthotroop::Stiffness>,
) -> ElementOutcome {
    let coords = [points[0], points[1], points[2], points[3]];
    let transform = quad_transform_3d(&coords);
    let u_local_vec = mat_vec(&transform, u_global, 24);
    let mut u_local = [0.0; 24];
    u_local.copy_from_slice(&u_local_vec);
    let (e1, e2, e3) = (row_vector(&transform, 24, 0), row_vector(&transform, 24, 1), row_vector(&transform, 24, 2));
    let flip = if dot(e3, axes.z) < 0.0 { -1.0 } else { 1.0 };
    let convert = |sxx: f64, syy: f64, txy: f64, mx: f64, my: f64, mxy: f64| {
        let n = tensor_to_plate([sxx * thickness, syy * thickness, txy * thickness], e1, e2, axes);
        let m = tensor_to_plate(
            [QUAD_MOMENT_SIGN * mx, QUAD_MOMENT_SIGN * my, QUAD_MOMENT_SIGN * mxy], e1, e2, axes);
        Resultants { n, m: [flip * m[0], flip * m[1], flip * m[2]] }
    };
    let local2d: [[f64; 2]; 4] = std::array::from_fn(|i| {
        let d = sub(points[i], points[0]);
        [dot(d, e1), dot(d, e2)]
    });
    let gamma = mitc4_centre_shear_strain(&local2d, &u_local);
    let (centre, corners, shear_local) = match orthotropy {
        None => {
            let centre = quad_stresses(&coords, &u_local, e_kn_m2, nu, thickness, 0.0, 0.0, 0.0);
            let corners: Vec<Resultants> = quad_stress_at_nodes(&coords, &u_local, e_kn_m2, nu, thickness, 0.0, 0.0, 0.0)
                .into_iter()
                .map(|s| convert(s.sigma_xx, s.sigma_yy, s.tau_xy, s.mx, s.my, s.mxy))
                .collect();
            let rigidity = 5.0 / 6.0 * e_kn_m2 / (2.0 * (1.0 + nu)) * thickness;
            let centre = convert(centre.sigma_xx, centre.sigma_yy, centre.tau_xy, centre.mx, centre.my, centre.mxy);
            (centre, corners, [rigidity * gamma[0], rigidity * gamma[1]])
        }
        Some(plate_stiffness) => {
            // Orthotroop (#79, #97): de kernfuncties met E = 1, ν = 0 geven
            // de rekken (σ = ε, τ = γ/2) en krommingen (m = t³/12·κ, mxy =
            // t³/24·κxy) in elementassen; de krachten volgen uit A en D.
            let element = crate::orthotroop::element_stiffness(plate_stiffness, e1, e2, axes);
            let bending = thickness * thickness * thickness / 12.0;
            let resultants = |sxx: f64, syy: f64, txy: f64, mx: f64, my: f64, mxy: f64| {
                let (n, m) = crate::orthotroop::element_forces(
                    &element,
                    [sxx, syy, 2.0 * txy],
                    [mx / bending, my / bending, 2.0 * mxy / bending],
                );
                convert(n[0] / thickness, n[1] / thickness, n[2] / thickness, m[0], m[1], m[2])
            };
            let centre = quad_stresses(&coords, &u_local, 1.0, 0.0, thickness, 0.0, 0.0, 0.0);
            let corners: Vec<Resultants> = quad_stress_at_nodes(&coords, &u_local, 1.0, 0.0, thickness, 0.0, 0.0, 0.0)
                .into_iter()
                .map(|s| resultants(s.sigma_xx, s.sigma_yy, s.tau_xy, s.mx, s.my, s.mxy))
                .collect();
            let centre = resultants(centre.sigma_xx, centre.sigma_yy, centre.tau_xy, centre.mx, centre.my, centre.mxy);
            (centre, corners, crate::orthotroop::element_shear(&element, gamma))
        }
    };
    let shear = vector_to_plate(shear_local, e1, e2, axes);
    ElementOutcome {
        centre,
        corners,
        shear: Some([flip * shear[0], flip * shear[1]]),
    }
}

/// Waarde op een randknoop (herstel volgens het patchprincipe van
/// Zienkiewicz–Zhu): een kwadratisch polynoom (kleinste kwadraten) door de
/// waarden in de elementmiddens van de elementen binnen twee knoopringen,
/// geëvalueerd in de randknoop. In het elementmidden is MITC4 het
/// nauwkeurigst; binnen één element is κxx in x-richting constant, zodat de
/// hoekwaarden op de rand zelf niet beter zijn dan de waarde op een halve
/// elementbreedte. Te weinig of slecht gespreide middens: lineair vlak;
/// lukt ook dat niet, dan `None` en blijft het knoopgemiddelde.
fn extrapolate_to_boundary(
    plate_id: usize,
    node_id: usize,
    axes: &PlateAxes3D,
    nodes: &HashMap<usize, V3>,
    neighbours: &HashMap<(usize, usize), Vec<usize>>,
    elements_of: &HashMap<(usize, usize), Vec<usize>>,
    centres: &[(V3, [f64; 8])],
) -> Option<[f64; 8]> {
    let origin = nodes[&node_id];
    let mut ring: Vec<usize> = vec![node_id];
    let mut frontier = vec![node_id];
    for _ in 0..2 {
        let mut next = Vec::new();
        for id in &frontier {
            for other in neighbours.get(&(plate_id, *id)).map(|v| v.as_slice()).unwrap_or(&[]) {
                if !ring.contains(other) { ring.push(*other); next.push(*other); }
            }
        }
        frontier = next;
    }
    let mut patch: Vec<usize> = Vec::new();
    for id in &ring {
        for element in elements_of.get(&(plate_id, *id)).map(|v| v.as_slice()).unwrap_or(&[]) {
            if !patch.contains(element) { patch.push(*element); }
        }
    }
    let points: Vec<([f64; 2], [f64; 8])> = patch.iter().map(|index| {
        let (centroid, values) = &centres[*index];
        let d = sub(*centroid, origin);
        ([dot(d, axes.x), dot(d, axes.y)], *values)
    }).collect();
    let scale_length = points.iter().map(|(c, _)| c[0].hypot(c[1])).fold(0.0, f64::max);
    if !(scale_length > 0.0) { return None; }
    for terms in [6usize, 3] {
        if points.len() < terms + 3 { continue; }
        let basis = |c: [f64; 2]| {
            let (x, y) = (c[0] / scale_length, c[1] / scale_length);
            [1.0, x, y, x * x, x * y, y * y]
        };
        let mut ata = vec![vec![0.0; terms]; terms];
        for (c, _) in &points {
            let row = basis(*c);
            for i in 0..terms { for j in 0..terms { ata[i][j] += row[i] * row[j]; } }
        }
        // c0 = e0ᵀ(AᵀA)⁻¹Aᵀv: los (AᵀA)·g = e0 op; dan c0 = Σ_k (a_k·g)·v_k.
        let Some(g) = solve_symmetric(ata, 0) else { continue };
        let mut out = [0.0; 8];
        for (c, values) in &points {
            let row = basis(*c);
            let weight: f64 = (0..terms).map(|k| row[k] * g[k]).sum();
            for q in 0..8 { out[q] += weight * values[q]; }
        }
        return Some(out);
    }
    None
}

/// Los A·x = e_k op met Gauss-eliminatie en kolompivotering. `None` bij een
/// (bijna) singuliere matrix: de middens bepalen het polynoom dan niet.
fn solve_symmetric(mut a: Vec<Vec<f64>>, k: usize) -> Option<Vec<f64>> {
    let n = a.len();
    let mut b = vec![0.0; n];
    b[k] = 1.0;
    let largest = (0..n).map(|i| a[i][i].abs()).fold(0.0, f64::max);
    for col in 0..n {
        let pivot = (col..n).max_by(|&p, &q| a[p][col].abs().total_cmp(&a[q][col].abs()))?;
        if !(a[pivot][col].abs() > 1e-9 * largest) { return None; }
        a.swap(col, pivot);
        b.swap(col, pivot);
        for row in (col + 1)..n {
            let factor = a[row][col] / a[col][col];
            for c in col..n { a[row][c] -= factor * a[col][c]; }
            b[row] -= factor * b[col];
        }
    }
    let mut x = vec![0.0; n];
    for row in (0..n).rev() {
        let sum: f64 = ((row + 1)..n).map(|c| a[row][c] * x[c]).sum();
        x[row] = (b[row] - sum) / a[row][row];
    }
    Some(x)
}

pub(crate) struct ShellOutput {
    pub plates: Vec<PlateSummary3D>,
    pub elements: Vec<ShellElementResult3D>,
    pub nodes: Vec<ShellNodeResult3D>,
}

/// Plaatresultaten uit de knoopverplaatsingen van de kern.
pub(crate) fn recover_shell_results(
    request: &SolveRequest3D,
    geometry: &HashMap<usize, PlateGeometry>,
    nodes: &HashMap<usize, V3>,
    displacements: &HashMap<usize, [f64; 6]>,
) -> ShellOutput {
    let plates: HashMap<usize, &Plate3D> = request.plates.iter().map(|p| (p.id, p)).collect();
    let materials: HashMap<usize, (f64, f64)> = request.materials.iter()
        .map(|m| (m.id, (m.e_mpa * 1000.0, m.nu))).collect();
    let mut elements = Vec::with_capacity(request.shell_elements.len());
    // Per element: zwaartepunt en de acht middenwaarden (n, m, v) in plaatassen.
    let mut centres: Vec<(V3, [f64; 8])> = Vec::with_capacity(request.shell_elements.len());
    let mut elements_of: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    #[derive(Default)]
    struct Accumulator { sum: Resultants, count: usize, shear: [f64; 2], shear_count: usize }
    let mut per_node: BTreeMap<(usize, usize), Accumulator> = BTreeMap::new();
    for element in &request.shell_elements {
        let plate = plates[&element.plate_id];
        let axes = &geometry[&element.plate_id].axes;
        let (e, nu) = materials[&plate.material_id];
        let points = element_points(element, nodes);
        let mut u_global = Vec::with_capacity(points.len() * 6);
        for id in &element.node_ids {
            u_global.extend_from_slice(&displacements.get(id).copied().unwrap_or([0.0; 6]));
        }
        let orthotropy = plate.orthotropy.as_ref()
            .map(|o| crate::orthotroop::plate_stiffness(o, plate.thickness_m));
        let outcome = element_outcome(&points, &u_global, e, nu, plate.thickness_m, axes, orthotropy.as_ref());
        let centroid = scale(points.iter().fold([0.0; 3], |sum, p| add(sum, *p)), 1.0 / points.len() as f64);
        let shear = outcome.shear.unwrap_or([0.0; 2]);
        for id in &element.node_ids {
            elements_of.entry((element.plate_id, *id)).or_default().push(centres.len());
        }
        centres.push((centroid, [
            outcome.centre.n[0], outcome.centre.n[1], outcome.centre.n[2],
            outcome.centre.m[0], outcome.centre.m[1], outcome.centre.m[2],
            shear[0], shear[1],
        ]));
        elements.push(ShellElementResult3D {
            element_id: element.id,
            plate_id: element.plate_id,
            centroid_m: centroid,
            values: values_from(outcome.centre, outcome.shear, plate.thickness_m),
        });
        for (node_id, corner) in element.node_ids.iter().zip(&outcome.corners) {
            let entry = per_node.entry((element.plate_id, *node_id)).or_default();
            for k in 0..3 {
                entry.sum.n[k] += corner.n[k];
                entry.sum.m[k] += corner.m[k];
            }
            entry.count += 1;
            if let Some(shear) = outcome.shear {
                entry.shear[0] += shear[0];
                entry.shear[1] += shear[1];
                entry.shear_count += 1;
            }
        }
    }
    // Knoopgemiddelden: n, m (hoekwaarden) en v (elementmidden), acht getallen.
    let mut averaged: BTreeMap<(usize, usize), [f64; 8]> = BTreeMap::new();
    for ((plate_id, node_id), acc) in &per_node {
        let count = acc.count as f64;
        let shear_count = acc.shear_count.max(1) as f64;
        averaged.insert((*plate_id, *node_id), [
            acc.sum.n[0] / count, acc.sum.n[1] / count, acc.sum.n[2] / count,
            acc.sum.m[0] / count, acc.sum.m[1] / count, acc.sum.m[2] / count,
            acc.shear[0] / shear_count, acc.shear[1] / shear_count,
        ]);
    }
    // Randknopen per plaat: knopen van een elementrand die maar één element
    // van die plaat heeft. Buren: knopen die een element delen.
    let mut edge_count: HashMap<(usize, usize, usize), usize> = HashMap::new();
    let mut neighbours: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for element in &request.shell_elements {
        let ids = &element.node_ids;
        for k in 0..ids.len() {
            let (a, b) = (ids[k], ids[(k + 1) % ids.len()]);
            *edge_count.entry((element.plate_id, a.min(b), a.max(b))).or_insert(0) += 1;
            let list = neighbours.entry((element.plate_id, ids[k])).or_default();
            for other in ids { if other != &ids[k] && !list.contains(other) { list.push(*other); } }
        }
    }
    let mut boundary: std::collections::HashSet<(usize, usize)> = std::collections::HashSet::new();
    for ((plate_id, a, b), count) in &edge_count {
        if *count == 1 {
            boundary.insert((*plate_id, *a));
            boundary.insert((*plate_id, *b));
        }
    }
    let mut node_results = Vec::with_capacity(averaged.len());
    for ((plate_id, node_id), average) in &averaged {
        let axes = &geometry[plate_id].axes;
        let mut values = *average;
        if boundary.contains(&(*plate_id, *node_id)) {
            if let Some(extrapolated) = extrapolate_to_boundary(
                *plate_id, *node_id, axes, nodes, &neighbours, &elements_of, &centres,
            ) {
                values = extrapolated;
            }
        }
        let resultants = Resultants {
            n: [values[0], values[1], values[2]],
            m: [values[3], values[4], values[5]],
        };
        let has_shear = per_node[&(*plate_id, *node_id)].shear_count > 0;
        let u = displacements.get(node_id).copied().unwrap_or([0.0; 6]);
        node_results.push(ShellNodeResult3D {
            node_id: *node_id,
            plate_id: *plate_id,
            w_m: dot([u[0], u[1], u[2]], axes.z),
            values: values_from(resultants, has_shear.then_some([values[6], values[7]]), plates[plate_id].thickness_m),
        });
    }
    let mut load_per_plate: HashMap<usize, V3> = HashMap::new();
    for load in &request.surface_loads {
        let area = geometry[&load.plate_id].area_m2;
        let entry = load_per_plate.entry(load.plate_id).or_insert([0.0; 3]);
        *entry = add(*entry, scale([load.qx_kn_per_m2, load.qy_kn_per_m2, load.qz_kn_per_m2], area));
    }
    // Issue #244 (punt 069): ook de knooplasten op knopen van de plaat. Een
    // wandschijf die alleen via knooplasten op haar rand belast wordt, gaf
    // `loadResultantKn = [0, 0, 0]` terwijl de reacties wél 100 kN waren.
    // Een knoop die op meer platen ligt, verdeelt zijn last gelijk over die
    // platen, zodat de som over alle platen de totale knooplast blijft.
    // Alleen krachten; een knoopmoment heeft geen krachtresultante.
    let mut platen_van: HashMap<usize, Vec<usize>> = HashMap::new();
    for element in &request.shell_elements {
        for &node_id in &element.node_ids {
            let lijst = platen_van.entry(node_id).or_default();
            if !lijst.contains(&element.plate_id) { lijst.push(element.plate_id); }
        }
    }
    for load in &request.nodal_loads {
        let Some(platen) = platen_van.get(&load.node_id) else { continue };
        let deel = scale([load.fx, load.fy, load.fz], 1.0 / platen.len() as f64);
        for plate_id in platen {
            let entry = load_per_plate.entry(*plate_id).or_insert([0.0; 3]);
            *entry = add(*entry, deel);
        }
    }
    let mut summaries = Vec::new();
    for plate in &request.plates {
        let own: Vec<&ShellNodeResult3D> = node_results.iter().filter(|r| r.plate_id == plate.id).collect();
        let element_count = request.shell_elements.iter().filter(|e| e.plate_id == plate.id).count();
        let quantities: Vec<(&str, Box<dyn Fn(&ShellNodeResult3D) -> Option<f64>>)> = vec![
            ("wM", Box::new(|r| Some(r.w_m))),
            ("nxxKnPerM", Box::new(|r| Some(r.values.nxx_kn_per_m))),
            ("nyyKnPerM", Box::new(|r| Some(r.values.nyy_kn_per_m))),
            ("nxyKnPerM", Box::new(|r| Some(r.values.nxy_kn_per_m))),
            ("mxxKnmPerM", Box::new(|r| Some(r.values.mxx_knm_per_m))),
            ("myyKnmPerM", Box::new(|r| Some(r.values.myy_knm_per_m))),
            ("mxyKnmPerM", Box::new(|r| Some(r.values.mxy_knm_per_m))),
            ("vxKnPerM", Box::new(|r| r.values.vx_kn_per_m)),
            ("vyKnPerM", Box::new(|r| r.values.vy_kn_per_m)),
            ("vonMisesTopMpa", Box::new(|r| Some(r.values.von_mises_top_mpa))),
            ("vonMisesBottomMpa", Box::new(|r| Some(r.values.von_mises_bottom_mpa))),
        ];
        let mut extremes = Vec::new();
        for (name, read) in &quantities {
            let mut best: Option<(f64, usize, f64, usize)> = None;
            for result in &own {
                let Some(value) = read(result) else { continue };
                best = Some(match best {
                    None => (value, result.node_id, value, result.node_id),
                    Some((min, min_id, max, max_id)) => (
                        if value < min { value } else { min }, if value < min { result.node_id } else { min_id },
                        if value > max { value } else { max }, if value > max { result.node_id } else { max_id },
                    ),
                });
            }
            if let Some((min, min_node_id, max, max_node_id)) = best {
                extremes.push(PlateExtreme3D { quantity: (*name).into(), min, min_node_id, max, max_node_id });
            }
        }
        summaries.push(PlateSummary3D {
            plate_id: plate.id,
            axes: geometry[&plate.id].axes,
            element_count,
            node_count: own.len(),
            area_m2: geometry[&plate.id].area_m2,
            load_resultant_kn: load_per_plate.get(&plate.id).copied().unwrap_or([0.0; 3]),
            extremes,
        });
    }
    ShellOutput { plates: summaries, elements, nodes: node_results }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plate_axes_follow_the_documented_convention() {
        let horizontal = plate_axes([0.0, 0.0, -2.0]).unwrap();
        assert_eq!(horizontal.z, [0.0, 0.0, 1.0]);
        assert_eq!(horizontal.x, [1.0, 0.0, 0.0]);
        assert_eq!(horizontal.y, [0.0, 1.0, 0.0]);
        // Wand in het XZ-vlak: x = X, y omhoog, z = x × y = −Y.
        let wall_xz = plate_axes([0.0, 1.0, 0.0]).unwrap();
        assert_eq!(wall_xz.x, [1.0, 0.0, 0.0]);
        assert!((wall_xz.y[2] - 1.0).abs() < 1e-12);
        assert!((wall_xz.z[1] + 1.0).abs() < 1e-12);
        // Wand in het YZ-vlak: x = Y (projectie van X is nul), y omhoog.
        let wall_yz = plate_axes([-1.0, 0.0, 0.0]).unwrap();
        assert!((wall_yz.x[1] - 1.0).abs() < 1e-12);
        assert!((wall_yz.y[2] - 1.0).abs() < 1e-12);
        assert!((wall_yz.z[0] - 1.0).abs() < 1e-12);
    }

    #[test]
    fn bilinear_weights_sum_to_area_and_first_moment() {
        let points = [[0.0, 0.0, 0.0], [3.0, 0.0, 0.0], [2.5, 2.0, 0.0], [0.5, 1.5, 0.0]];
        let weights = nodal_area_weights(&points);
        let area = norm(area_vector(&points));
        assert!((weights.iter().sum::<f64>() - area).abs() < 1e-12);
        // ∫x dA = Σ x_i ∫N_i dA voor een isoparametrisch element.
        let first: f64 = weights.iter().zip(&points).map(|(w, p)| w * p[0]).sum();
        let triangles = [[points[0], points[1], points[2]], [points[0], points[2], points[3]]];
        let exact: f64 = triangles.iter().map(|t| {
            let a = norm(area_vector(t));
            a * (t[0][0] + t[1][0] + t[2][0]) / 3.0
        }).sum();
        assert!((first - exact).abs() < 1e-12);
    }
}
