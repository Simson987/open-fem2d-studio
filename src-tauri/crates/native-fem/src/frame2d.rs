//! Plane-frame elements in m, kN and MPa. The plane is X/Y;
//! the 2D app maps its vertical Z coordinate and R_y rotation here explicitly.

use crate::math::{constrained_solve, free_positive_definite, Matrix};
use crate::{positive, Analysis, MaterialLaw};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: usize,
    pub e_mpa: f64,
    #[serde(default)]
    pub law: MaterialLaw,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub id: usize,
    pub area_m2: f64,
    pub inertia_m4: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub id: usize,
    pub start_node_id: usize,
    pub end_node_id: usize,
    pub material_id: usize,
    pub section_id: usize,
    #[serde(default)]
    pub releases: EndReleases,
    #[serde(default)]
    pub springs: EndSprings,
    /// Winkler line stiffness in kN/m². Each end receives k*L/2 as a
    /// tributary global-Y spring, matching the existing FEM Studio solver.
    #[serde(default)]
    pub foundation_kn_per_m2: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndReleases {
    #[serde(default)]
    pub ux_start: bool,
    #[serde(default)]
    pub uy_start: bool,
    #[serde(default)]
    pub rz_start: bool,
    #[serde(default)]
    pub ux_end: bool,
    #[serde(default)]
    pub uy_end: bool,
    #[serde(default)]
    pub rz_end: bool,
}

impl EndReleases {
    fn any(self) -> bool {
        self.axes().iter().any(|(_, released)| *released)
    }

    fn axes(self) -> [(usize, bool); 6] {
        [
            (0, self.ux_start),
            (1, self.uy_start),
            (2, self.rz_start),
            (3, self.ux_end),
            (4, self.uy_end),
            (5, self.rz_end),
        ]
    }
}

/// Local connection stiffnesses between a member end and its structural node.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndSprings {
    #[serde(default)]
    pub ux_start_kn_per_m: Option<f64>,
    #[serde(default)]
    pub uy_start_kn_per_m: Option<f64>,
    #[serde(default)]
    pub rz_start_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub ux_end_kn_per_m: Option<f64>,
    #[serde(default)]
    pub uy_end_kn_per_m: Option<f64>,
    #[serde(default)]
    pub rz_end_knm_per_rad: Option<f64>,
}

impl EndSprings {
    fn axes(self) -> [Option<f64>; 6] {
        [
            self.ux_start_kn_per_m,
            self.uy_start_kn_per_m,
            self.rz_start_knm_per_rad,
            self.ux_end_kn_per_m,
            self.uy_end_kn_per_m,
            self.rz_end_knm_per_rad,
        ]
    }

    fn any(self) -> bool {
        self.axes().iter().any(Option::is_some)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub node_id: usize,
    pub ux: bool,
    pub uy: bool,
    pub rz: bool,
    #[serde(default)]
    pub kx_kn_per_m: Option<f64>,
    #[serde(default)]
    pub ky_kn_per_m: Option<f64>,
    #[serde(default)]
    pub krz_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub ux_prescribed_m: Option<f64>,
    #[serde(default)]
    pub uy_prescribed_m: Option<f64>,
    #[serde(default)]
    pub rz_prescribed_rad: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodalLoad {
    pub node_id: usize,
    pub fx: f64,
    pub fy: f64,
    pub mz: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberLoad {
    pub member_id: usize,
    pub qx_start_kn_per_m: f64,
    pub qx_end_kn_per_m: f64,
    pub qy_start_kn_per_m: f64,
    pub qy_end_kn_per_m: f64,
    #[serde(default)]
    pub start_position_m: Option<f64>,
    #[serde(default)]
    pub end_position_m: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberPointLoad {
    pub member_id: usize,
    pub px_kn: f64,
    pub py_kn: f64,
    pub position_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThermalLoad {
    pub member_id: usize,
    pub delta_t_k: f64,
    pub alpha_per_k: f64,
    /// Temperature at local +Y minus temperature at local -Y, in kelvin.
    #[serde(default)]
    pub delta_t_gradient_k: f64,
    /// Distance between the two temperature faces, required for a gradient.
    #[serde(default)]
    pub depth_m: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub analysis: Analysis,
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    pub sections: Vec<Section>,
    pub members: Vec<Member>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub nodal_loads: Vec<NodalLoad>,
    #[serde(default)]
    pub member_loads: Vec<MemberLoad>,
    #[serde(default)]
    pub member_point_loads: Vec<MemberPointLoad>,
    #[serde(default)]
    pub thermal_loads: Vec<ThermalLoad>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
}

fn default_iterations() -> usize {
    50
}
fn default_tolerance() -> f64 {
    1e-8
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: usize,
    pub displacement: [f64; 3],
    pub reaction: [f64; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub member_id: usize,
    /// Local nodal forces [N1, V1, M1, N2, V2, M2].
    pub local_end_forces: [f64; 6],
    pub stations_m: Vec<f64>,
    pub normal_force_kn: Vec<f64>,
    pub shear_force_kn: Vec<f64>,
    pub bending_moment_knm: Vec<f64>,
    pub deflection_m: Vec<f64>,
    pub axial_disp_m: Vec<f64>,
    pub rotation_rad: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axial_history: Option<AxialHistory>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxialHistory {
    pub plastic_strain: f64,
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
    pub tangent_e_mpa: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result2D {
    pub nodes: Vec<NodeResult>,
    pub members: Vec<MemberResult>,
    pub equilibrium_residual: f64,
    pub iterations: usize,
}

#[derive(Clone)]
struct Element {
    dofs: [usize; 6],
    length: f64,
    transform: [[f64; 6]; 6],
    local_stiffness: [[f64; 6]; 6],
    local_load: [f64; 6],
    ea_kn: f64,
    ei_knm2: f64,
    area_m2: f64,
    thermal_strain: f64,
    thermal_curvature: f64,
    material: Material,
    releases: EndReleases,
    springs: EndSprings,
    raw_stiffness: Option<[[f64; 6]; 6]>,
    raw_load: Option<[f64; 6]>,
}

fn shape(length: f64, position: f64) -> ([f64; 6], [f64; 6]) {
    let t = position / length;
    let axial = [1.0 - t, 0.0, 0.0, t, 0.0, 0.0];
    let transverse = [
        0.0,
        1.0 - 3.0 * t * t + 2.0 * t * t * t,
        length * (t - 2.0 * t * t + t * t * t),
        0.0,
        3.0 * t * t - 2.0 * t * t * t,
        length * (-t * t + t * t * t),
    ];
    (axial, transverse)
}

fn add_member_load(local: &mut [f64; 6], load: &MemberLoad, length: f64) -> Result<(), String> {
    let a = load.start_position_m.unwrap_or(0.0);
    let b = load.end_position_m.unwrap_or(length);
    if ![
        a,
        b,
        load.qx_start_kn_per_m,
        load.qx_end_kn_per_m,
        load.qy_start_kn_per_m,
        load.qy_end_kn_per_m,
    ]
    .iter()
    .all(|v| v.is_finite())
        || a < 0.0
        || b > length + 1e-10
        || b <= a
    {
        return Err(format!(
            "invalid distributed load on member {}",
            load.member_id
        ));
    }
    // Three-point Gauss exactly integrates a cubic Hermite shape times a
    // linearly varying pressure over any subspan.
    let abscissas = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    for (&xi, &weight) in abscissas.iter().zip(&weights) {
        let position = (a + b) / 2.0 + xi * (b - a) / 2.0;
        let fraction = (position - a) / (b - a);
        let px = load.qx_start_kn_per_m * (1.0 - fraction) + load.qx_end_kn_per_m * fraction;
        let py = load.qy_start_kn_per_m * (1.0 - fraction) + load.qy_end_kn_per_m * fraction;
        let (axial, transverse) = shape(length, position);
        for i in 0..6 {
            local[i] += (axial[i] * px + transverse[i] * py) * weight * (b - a) / 2.0;
        }
    }
    Ok(())
}

fn integrated_load(load: &MemberLoad, length: f64, x: f64, axial: bool, power: u32) -> f64 {
    let a = load.start_position_m.unwrap_or(0.0);
    let b = load.end_position_m.unwrap_or(length).min(x);
    if b <= a {
        return 0.0;
    }
    let original_end = load.end_position_m.unwrap_or(length);
    let (start, end) = if axial {
        (load.qx_start_kn_per_m, load.qx_end_kn_per_m)
    } else {
        (load.qy_start_kn_per_m, load.qy_end_kn_per_m)
    };
    let abscissas = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    let factorial = match power {
        0 | 1 => 1.0,
        2 => 2.0,
        3 => 6.0,
        _ => unreachable!(),
    };
    abscissas
        .iter()
        .zip(&weights)
        .map(|(&xi, &weight)| {
            let position = (a + b) / 2.0 + xi * (b - a) / 2.0;
            let fraction = (position - a) / (original_end - a);
            let q = start * (1.0 - fraction) + end * fraction;
            q * (x - position).powi(power as i32) / factorial * weight * (b - a) / 2.0
        })
        .sum()
}

fn local_displacement(element: &Element, u: &[f64]) -> [f64; 6] {
    std::array::from_fn(|i| {
        (0..6)
            .map(|j| element.transform[i][j] * u[element.dofs[j]])
            .sum()
    })
}

fn condense_connections(element: &mut Element) -> Result<(), String> {
    if !element.releases.any() && !element.springs.any() {
        return Ok(());
    }
    element.raw_stiffness = Some(element.local_stiffness);
    element.raw_load = Some(element.local_load);
    for ((axis, released), spring) in element
        .releases
        .axes()
        .into_iter()
        .zip(element.springs.axes())
    {
        let spring = if released { None } else { spring };
        if !released && spring.is_none() {
            continue;
        }
        let k_spring = spring.unwrap_or(0.0);
        let member_stiffness = element.local_stiffness[axis][axis];
        let pivot = member_stiffness + k_spring;
        let axis_scale = element.raw_stiffness.unwrap()[axis][axis].abs();
        if !pivot.is_finite() || pivot < -axis_scale * 1e-12 {
            return Err("invalid 2D frame release condensation pivot".into());
        }
        if pivot <= axis_scale * 1e-12 {
            // A second release can remove the remaining rigid-body stiffness.
            // It is valid only when the member load is also self-equilibrated.
            if element.local_stiffness[axis]
                .iter()
                .any(|v| v.abs() > axis_scale * 1e-10)
                || element.local_load[axis].abs() > 1e-9
            {
                return Err("unbalanced load on disconnected 2D frame release".into());
            }
            element.local_stiffness[axis] = [0.0; 6];
            for row in 0..6 {
                element.local_stiffness[row][axis] = 0.0;
            }
            element.local_load[axis] = 0.0;
            continue;
        }
        let column = std::array::from_fn::<_, 6, _>(|i| element.local_stiffness[i][axis]);
        let load = element.local_load[axis];
        for i in 0..6 {
            if i == axis {
                continue;
            }
            element.local_load[i] -= column[i] * load / pivot;
            for j in 0..6 {
                if j != axis {
                    element.local_stiffness[i][j] -= column[i] * column[j] / pivot;
                }
            }
        }
        for other in 0..6 {
            if other == axis {
                continue;
            }
            element.local_stiffness[axis][other] = k_spring * column[other] / pivot;
            element.local_stiffness[other][axis] = element.local_stiffness[axis][other];
        }
        element.local_stiffness[axis][axis] = k_spring * member_stiffness / pivot;
        element.local_load[axis] = k_spring * load / pivot;
    }
    Ok(())
}

/// Recover the physical member-end displacement behind releases and springs.
fn connected_local_displacement(
    element: &Element,
    mut d: [f64; 6],
    load_factor: f64,
    geometric: bool,
    axial_override: Option<f64>,
) -> [f64; 6] {
    let Some(mut k) = element.raw_stiffness else {
        return d;
    };
    if geometric {
        let kg = geometric_local(
            element,
            axial_override.unwrap_or_else(|| axial_force(element, &d)),
        );
        for i in 0..6 {
            for j in 0..6 {
                k[i][j] += kg[i][j];
            }
        }
    }
    let f = element.raw_load.unwrap().map(|value| value * load_factor);
    let connected: Vec<(usize, f64)> = element
        .releases
        .axes()
        .into_iter()
        .zip(element.springs.axes())
        .filter_map(|((axis, release), spring)| {
            (release || spring.is_some())
                .then_some((axis, if release { 0.0 } else { spring.unwrap_or(0.0) }))
        })
        .collect();
    let released: Vec<usize> = connected.iter().map(|(axis, _)| *axis).collect();
    // Row reduction preserves a nodal displacement as the gauge for a free
    // rigid-body motion when both ends of one local direction are released.
    let n = released.len();
    let mut a = [[0.0; 7]; 6];
    for (row, &axis) in released.iter().enumerate() {
        for (column, &other) in released.iter().enumerate() {
            a[row][column] = k[axis][other];
        }
        let spring = connected[row].1;
        a[row][row] += spring;
        a[row][n] = f[axis]
            - (0..6)
                .filter(|j| !released.contains(j))
                .map(|j| k[axis][j] * d[j])
                .sum::<f64>()
            + spring * d[axis];
    }
    let mut pivots = Vec::new();
    let mut rank = 0;
    for column in 0..n {
        let best = (rank..n)
            .max_by(|&i, &j| a[i][column].abs().total_cmp(&a[j][column].abs()))
            .unwrap();
        let magnitude = a[best][column].abs();
        let scale = (0..n).map(|row| a[row][row].abs()).fold(0.0_f64, f64::max);
        if magnitude <= scale * 1e-12 {
            continue;
        }
        a.swap(rank, best);
        for row in (rank + 1)..n {
            let factor = a[row][column] / a[rank][column];
            for col in column..=n {
                a[row][col] -= factor * a[rank][col];
            }
        }
        pivots.push(column);
        rank += 1;
    }
    for row in (0..rank).rev() {
        let column = pivots[row];
        let remainder = ((column + 1)..n)
            .map(|j| a[row][j] * d[released[j]])
            .sum::<f64>();
        d[released[column]] = (a[row][n] - remainder) / a[row][column];
    }
    d
}

fn axial_force(element: &Element, d: &[f64; 6]) -> f64 {
    // Average elastic axial force, tension positive.
    let left = (0..6)
        .map(|j| element.local_stiffness[0][j] * d[j])
        .sum::<f64>()
        - element.local_load[0];
    let right = (0..6)
        .map(|j| element.local_stiffness[3][j] * d[j])
        .sum::<f64>()
        - element.local_load[3];
    (right - left) / 2.0
}

fn geometric_local(element: &Element, axial: f64) -> [[f64; 6]; 6] {
    let l = element.length;
    let geometric = [
        [36.0, 3.0 * l, -36.0, 3.0 * l],
        [3.0 * l, 4.0 * l * l, -3.0 * l, -l * l],
        [-36.0, -3.0 * l, 36.0, -3.0 * l],
        [3.0 * l, -l * l, -3.0 * l, 4.0 * l * l],
    ];
    let axes = [1, 2, 4, 5];
    let mut kg = [[0.0; 6]; 6];
    for (a, &i) in axes.iter().enumerate() {
        for (b, &j) in axes.iter().enumerate() {
            kg[i][j] = axial * geometric[a][b] / (30.0 * l);
        }
    }
    kg
}

fn geometric_assembly(
    elements: &HashMap<usize, Element>,
    nodal_f: &[f64],
    springs: &[f64],
    u: &[f64],
) -> Result<(Matrix, Vec<f64>), String> {
    let mut k = Matrix::zeros(u.len())?;
    let mut f = nodal_f.to_vec();
    for element in elements.values() {
        let d = local_displacement(element, u);
        let kg = geometric_local(element, axial_force(element, &d));
        let mut assembled = element.clone();
        assembled.local_stiffness = element.raw_stiffness.unwrap_or(element.local_stiffness);
        assembled.local_load = element.raw_load.unwrap_or(element.local_load);
        for i in 0..6 {
            for j in 0..6 {
                assembled.local_stiffness[i][j] += kg[i][j];
            }
        }
        condense_connections(&mut assembled)?;
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i]
                            * assembled.local_stiffness[a][b]
                            * element.transform[b][j];
                    }
                }
                k.add(element.dofs[i], element.dofs[j], value);
            }
            for j in 0..6 {
                f[element.dofs[i]] += element.transform[j][i] * assembled.local_load[j];
            }
        }
    }
    for (dof, &spring) in springs.iter().enumerate() {
        if spring > 0.0 {
            k.add(dof, dof, spring);
        }
    }
    Ok((k, f))
}

#[derive(Clone, Copy, Default)]
struct AxialState {
    plastic_strain: f64,
    equivalent_plastic_strain: f64,
    tensile_damage: f64,
}

#[derive(Clone, Copy)]
struct AxialResponse {
    stress_mpa: f64,
    tangent_e_mpa: f64,
    state: AxialState,
}

fn axial_response(material: &Material, strain: f64, previous: AxialState) -> AxialResponse {
    let e = material.e_mpa;
    match material.law {
        MaterialLaw::Elastic => AxialResponse {
            stress_mpa: e * strain,
            tangent_e_mpa: e,
            state: previous,
        },
        MaterialLaw::SteelBilinear {
            yield_mpa,
            hardening_ratio,
        } => {
            let trial = e * (strain - previous.plastic_strain);
            if hardening_ratio == 1.0 {
                return AxialResponse {
                    stress_mpa: trial,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let hardening = e * hardening_ratio / (1.0 - hardening_ratio);
            let excess = trial.abs() - yield_mpa - hardening * previous.equivalent_plastic_strain;
            if excess <= 0.0 {
                return AxialResponse {
                    stress_mpa: trial,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let increment = excess / (e + hardening);
            let sign = trial.signum();
            AxialResponse {
                stress_mpa: trial - sign * e * increment,
                tangent_e_mpa: hardening_ratio * e,
                state: AxialState {
                    plastic_strain: previous.plastic_strain + sign * increment,
                    equivalent_plastic_strain: previous.equivalent_plastic_strain + increment,
                    ..previous
                },
            }
        }
        MaterialLaw::ConcreteCracking {
            tensile_mpa,
            residual_ratio,
        } => {
            if strain <= 0.0 {
                return AxialResponse {
                    stress_mpa: e * strain,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let elastic = e * strain;
            let candidate = if elastic > tensile_mpa {
                1.0 - (tensile_mpa + residual_ratio * (elastic - tensile_mpa)) / elastic
            } else {
                0.0
            };
            let damage = previous.tensile_damage.max(candidate).clamp(0.0, 1.0);
            let growing = candidate > previous.tensile_damage + 1e-12;
            AxialResponse {
                stress_mpa: (1.0 - damage) * elastic,
                tangent_e_mpa: if growing {
                    residual_ratio * e
                } else {
                    (1.0 - damage) * e
                },
                state: AxialState {
                    tensile_damage: damage,
                    ..previous
                },
            }
        }
    }
}

fn axial_strain(element: &Element, d: &[f64; 6]) -> f64 {
    (d[3] - d[0]) / element.length
}

/// Return tangent K and internal force for a trial displacement. Material
/// state is only committed after a load increment reaches equilibrium.
fn material_system(
    elements: &HashMap<usize, Element>,
    u: &[f64],
    states: &HashMap<usize, AxialState>,
    springs: &[f64],
    geometric: bool,
    load_factor: f64,
) -> Result<(Matrix, Vec<f64>, Vec<f64>), String> {
    let mut tangent = Matrix::zeros(u.len())?;
    let mut member_load = vec![0.0; u.len()];
    let mut axial_correction = vec![0.0; u.len()];
    let mut tangent_corrections = Vec::with_capacity(elements.len());
    for (&id, element) in elements {
        let d = local_displacement(element, u);
        let response = axial_response(
            &element.material,
            axial_strain(element, &d) - load_factor * element.thermal_strain,
            states[&id],
        );
        let n = response.stress_mpa * 1000.0 * element.area_m2;
        let mut assembled = element.clone();
        assembled.local_stiffness = element.raw_stiffness.unwrap_or(element.local_stiffness);
        assembled.local_load = element.raw_load.unwrap_or(element.local_load);
        if geometric {
            let kg = geometric_local(element, n);
            for i in 0..6 {
                for j in 0..6 {
                    assembled.local_stiffness[i][j] += kg[i][j];
                }
            }
        }
        condense_connections(&mut assembled)?;
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i]
                            * assembled.local_stiffness[a][b]
                            * element.transform[b][j];
                    }
                }
                tangent.add(element.dofs[i], element.dofs[j], value);
            }
            for j in 0..6 {
                member_load[element.dofs[i]] += element.transform[j][i] * assembled.local_load[j];
            }
        }
        let elastic_n = element.ea_kn * axial_strain(element, &d);
        // The elastic thermal equivalent load is included in local_load.
        // Restore it here so the residual uses the material stress at
        // mechanical strain rather than subtracting thermal strain twice.
        let correction = n - elastic_n + load_factor * element.ea_kn * element.thermal_strain;
        for (axis, sign) in [(0, -1.0), (3, 1.0)] {
            for i in 0..6 {
                axial_correction[element.dofs[i]] += sign * correction * element.transform[axis][i];
            }
        }
        let delta_axial = (response.tangent_e_mpa / element.material.e_mpa - 1.0) * element.ea_kn
            / element.length;
        tangent_corrections.push((element, delta_axial));
    }
    for (dof, &spring) in springs.iter().enumerate() {
        if spring > 0.0 {
            tangent.add(dof, dof, spring);
        }
    }
    let mut internal = tangent.mul(u);
    for (force, correction) in internal.iter_mut().zip(&axial_correction) {
        *force += correction;
    }
    for (element, delta_axial) in tangent_corrections {
        for (row, row_sign) in [(0, 1.0), (3, -1.0)] {
            for (col, col_sign) in [(0, 1.0), (3, -1.0)] {
                let value = row_sign * col_sign * delta_axial;
                for i in 0..6 {
                    for j in 0..6 {
                        tangent.add(
                            element.dofs[i],
                            element.dofs[j],
                            element.transform[row][i] * value * element.transform[col][j],
                        );
                    }
                }
            }
        }
    }
    Ok((tangent, internal, member_load))
}

pub fn solve(request: &Request) -> Result<Result2D, String> {
    if request.max_iterations == 0
        || request.max_iterations > 1000
        || !request.tolerance.is_finite()
        || request.tolerance <= 0.0
        || request.tolerance >= 1.0
    {
        return Err("invalid 2D frame iteration limit or tolerance".into());
    }
    if request.nodes.len() < 2 || request.members.is_empty() {
        return Err("2D frame requires nodes and members".into());
    }
    if request.analysis.material()
        && request
            .members
            .iter()
            .any(|member| member.releases.ux_start || member.releases.ux_end)
    {
        return Err(
            "2D frame axial translation releases with material nonlinearity are unsupported".into(),
        );
    }
    if request.analysis.material()
        && request.members.iter().any(|member| {
            (member.springs.ux_start_kn_per_m.is_some() && !member.releases.ux_start)
                || (member.springs.ux_end_kn_per_m.is_some() && !member.releases.ux_end)
        })
    {
        return Err(
            "2D frame axial connection springs with material nonlinearity are unsupported".into(),
        );
    }
    if !request.load_path.is_empty() {
        if !request.analysis.material()
            || request.load_path.len() > 100
            || request.load_path.iter().any(|factor| !factor.is_finite())
        {
            return Err("invalid 2D frame material load path".into());
        }
    }
    if request.analysis.material()
        && (request
            .member_loads
            .iter()
            .any(|load| load.qx_start_kn_per_m != 0.0 || load.qx_end_kn_per_m != 0.0)
            || request
                .member_point_loads
                .iter()
                .any(|load| load.px_kn != 0.0))
    {
        return Err(
            "2D frame axial material history does not yet support member axial loads".into(),
        );
    }
    let mut node_index = HashMap::new();
    for (index, node) in request.nodes.iter().enumerate() {
        if node.id == 0
            || !node.x.is_finite()
            || !node.y.is_finite()
            || node_index.insert(node.id, index).is_some()
        {
            return Err("invalid or duplicate 2D frame node".into());
        }
    }
    let mut materials = HashMap::new();
    for material in &request.materials {
        positive(material.e_mpa, "E")?;
        match material.law {
            MaterialLaw::Elastic => {}
            MaterialLaw::SteelBilinear {
                yield_mpa,
                hardening_ratio,
            } => {
                positive(yield_mpa, "steel yield")?;
                if !hardening_ratio.is_finite() || !(0.0..=1.0).contains(&hardening_ratio) {
                    return Err("invalid steel hardening ratio".into());
                }
            }
            MaterialLaw::ConcreteCracking {
                tensile_mpa,
                residual_ratio,
            } => {
                positive(tensile_mpa, "concrete tensile strength")?;
                if !residual_ratio.is_finite() || !(0.0..=1.0).contains(&residual_ratio) {
                    return Err("invalid concrete residual ratio".into());
                }
            }
        }
        if material.id == 0 || materials.insert(material.id, material).is_some() {
            return Err("invalid or duplicate 2D frame material".into());
        }
    }
    let mut sections = HashMap::new();
    for section in &request.sections {
        positive(section.area_m2, "area")?;
        positive(section.inertia_m4, "inertia")?;
        if section.id == 0 || sections.insert(section.id, section).is_some() {
            return Err("invalid or duplicate 2D frame section".into());
        }
    }
    let mut k = Matrix::zeros(3 * request.nodes.len())?;
    let mut f = vec![0.0; k.n];
    let mut elements = HashMap::new();
    let mut member_ids = HashSet::new();
    let mut released_rotations = vec![false; k.n];
    for member in &request.members {
        if member.id == 0 || !member_ids.insert(member.id) {
            return Err("invalid or duplicate 2D frame member".into());
        }
        if member
            .foundation_kn_per_m2
            .is_some_and(|value| !value.is_finite() || value <= 0.0)
        {
            return Err("invalid 2D frame foundation line stiffness".into());
        }
        if member
            .springs
            .axes()
            .iter()
            .flatten()
            .any(|value| !value.is_finite() || *value <= 0.0)
        {
            return Err("invalid 2D frame connection spring stiffness".into());
        }
        let start = *node_index
            .get(&member.start_node_id)
            .ok_or("unknown start node")?;
        let end = *node_index
            .get(&member.end_node_id)
            .ok_or("unknown end node")?;
        let material = materials
            .get(&member.material_id)
            .ok_or("unknown member material")?;
        let section = sections
            .get(&member.section_id)
            .ok_or("unknown member section")?;
        let dx = request.nodes[end].x - request.nodes[start].x;
        let dy = request.nodes[end].y - request.nodes[start].y;
        let length = dx.hypot(dy);
        positive(length, "member length")?;
        let c = dx / length;
        let s = dy / length;
        let mut transform = [[0.0; 6]; 6];
        for offset in [0, 3] {
            transform[offset][offset] = c;
            transform[offset][offset + 1] = s;
            transform[offset + 1][offset] = -s;
            transform[offset + 1][offset + 1] = c;
            transform[offset + 2][offset + 2] = 1.0;
        }
        let ea_l = material.e_mpa * 1000.0 * section.area_m2 / length;
        let ei_l3 = material.e_mpa * 1000.0 * section.inertia_m4 / length.powi(3);
        let mut local_stiffness = [[0.0; 6]; 6];
        local_stiffness[0][0] = ea_l;
        local_stiffness[0][3] = -ea_l;
        local_stiffness[3][0] = -ea_l;
        local_stiffness[3][3] = ea_l;
        let bending = [
            [12.0, 6.0 * length, -12.0, 6.0 * length],
            [
                6.0 * length,
                4.0 * length * length,
                -6.0 * length,
                2.0 * length * length,
            ],
            [-12.0, -6.0 * length, 12.0, -6.0 * length],
            [
                6.0 * length,
                2.0 * length * length,
                -6.0 * length,
                4.0 * length * length,
            ],
        ];
        for (i, &row) in [1, 2, 4, 5].iter().enumerate() {
            for (j, &column) in [1, 2, 4, 5].iter().enumerate() {
                local_stiffness[row][column] = bending[i][j] * ei_l3;
            }
        }
        let dofs = [
            3 * start,
            3 * start + 1,
            3 * start + 2,
            3 * end,
            3 * end + 1,
            3 * end + 2,
        ];
        if member.releases.rz_start {
            released_rotations[dofs[2]] = true;
        }
        if member.releases.rz_end {
            released_rotations[dofs[5]] = true;
        }
        let element = Element {
            dofs,
            length,
            transform,
            local_stiffness,
            local_load: [0.0; 6],
            ea_kn: material.e_mpa * 1000.0 * section.area_m2,
            ei_knm2: material.e_mpa * 1000.0 * section.inertia_m4,
            area_m2: section.area_m2,
            thermal_strain: 0.0,
            thermal_curvature: 0.0,
            material: (*material).clone(),
            releases: member.releases,
            springs: member.springs,
            raw_stiffness: None,
            raw_load: None,
        };
        elements.insert(member.id, element);
    }
    for load in &request.nodal_loads {
        let index = *node_index.get(&load.node_id).ok_or("unknown loaded node")?;
        if ![load.fx, load.fy, load.mz]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err("non-finite 2D nodal load".into());
        }
        for (axis, value) in [load.fx, load.fy, load.mz].iter().enumerate() {
            f[3 * index + axis] += value;
        }
    }
    let nodal_f = f.clone();
    for load in &request.member_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown loaded member")?;
        add_member_load(&mut element.local_load, load, element.length)?;
    }
    for load in &request.member_point_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown point-loaded member")?;
        if ![load.position_m, load.px_kn, load.py_kn]
            .iter()
            .all(|v| v.is_finite())
            || load.position_m < 0.0
            || load.position_m > element.length
        {
            return Err("invalid 2D member point load".into());
        }
        let (axial, transverse) = shape(element.length, load.position_m);
        for i in 0..6 {
            element.local_load[i] += axial[i] * load.px_kn + transverse[i] * load.py_kn;
        }
    }
    for load in &request.thermal_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown thermally loaded 2D frame member")?;
        if !load.delta_t_k.is_finite()
            || !load.delta_t_gradient_k.is_finite()
            || !load.alpha_per_k.is_finite()
            || load.alpha_per_k < 0.0
            || load.delta_t_gradient_k != 0.0
                && !load
                    .depth_m
                    .is_some_and(|depth| depth.is_finite() && depth > 0.0)
            || load
                .depth_m
                .is_some_and(|depth| !depth.is_finite() || depth <= 0.0)
        {
            return Err("invalid 2D frame thermal load".into());
        }
        let strain = load.alpha_per_k * load.delta_t_k;
        // Positive local curvature shortens the +Y face; a hotter +Y face
        // therefore imposes negative curvature.
        let curvature = -load.alpha_per_k * load.delta_t_gradient_k / load.depth_m.unwrap_or(1.0);
        if !strain.is_finite() || !curvature.is_finite() {
            return Err("invalid 2D frame thermal strain or curvature".into());
        }
        element.thermal_strain += strain;
        element.thermal_curvature += curvature;
        if !element.thermal_strain.is_finite() || !element.thermal_curvature.is_finite() {
            return Err("invalid combined 2D frame thermal strain or curvature".into());
        }
    }
    for element in elements.values_mut() {
        let force = element.ea_kn * element.thermal_strain;
        let moment = element.ei_knm2 * element.thermal_curvature;
        if !force.is_finite() || !moment.is_finite() {
            return Err("non-finite 2D frame thermal equivalent load".into());
        }
        element.local_load[0] -= force;
        element.local_load[3] += force;
        element.local_load[2] -= moment;
        element.local_load[5] += moment;
    }
    for element in elements.values_mut() {
        condense_connections(element)?;
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i]
                            * element.local_stiffness[a][b]
                            * element.transform[b][j];
                    }
                }
                k.add(element.dofs[i], element.dofs[j], value);
            }
            for j in 0..6 {
                f[element.dofs[i]] += element.transform[j][i] * element.local_load[j];
            }
        }
    }
    let mut prescribed = vec![None; k.n];
    let mut spring_stiffness = vec![0.0; k.n];
    let mut support_stiffness = vec![0.0; k.n];
    for member in &request.members {
        if let Some(line_stiffness) = member.foundation_kn_per_m2 {
            let element = &elements[&member.id];
            let tributary = line_stiffness * element.length / 2.0;
            if !tributary.is_finite() {
                return Err("invalid 2D frame foundation tributary stiffness".into());
            }
            for end in [0, 3] {
                // The legacy solver also assigns 0.1% horizontal soil
                // friction. Keep the same global-axis convention here.
                spring_stiffness[element.dofs[end]] += 0.001 * tributary;
                spring_stiffness[element.dofs[end + 1]] += tributary;
            }
        }
    }
    for (dof, &stiffness) in spring_stiffness.iter().enumerate() {
        if stiffness > 0.0 {
            k.add(dof, dof, stiffness);
        }
    }
    let mut supported = HashSet::new();
    for support in &request.supports {
        let node = *node_index
            .get(&support.node_id)
            .ok_or("unknown support node")?;
        if !supported.insert(support.node_id) {
            return Err("duplicate 2D frame support".into());
        }
        let fixed = [support.ux, support.uy, support.rz];
        let values = [
            support.ux_prescribed_m,
            support.uy_prescribed_m,
            support.rz_prescribed_rad,
        ];
        let springs = [
            support.kx_kn_per_m,
            support.ky_kn_per_m,
            support.krz_knm_per_rad,
        ];
        for axis in 0..3 {
            if let Some(value) = values[axis] {
                if !fixed[axis] || !value.is_finite() {
                    return Err("invalid 2D prescribed displacement".into());
                }
            }
            if let Some(stiffness) = springs[axis] {
                positive(stiffness, "spring stiffness")?;
                if fixed[axis] {
                    return Err("2D support cannot fix and spring the same DOF".into());
                }
                k.add(3 * node + axis, 3 * node + axis, stiffness);
                spring_stiffness[3 * node + axis] += stiffness;
                support_stiffness[3 * node + axis] += stiffness;
            }
            if fixed[axis] {
                prescribed[3 * node + axis] = Some(values[axis].unwrap_or(0.0));
            }
        }
    }
    for dof in 0..k.n {
        if !released_rotations[dof] || prescribed[dof].is_some() || k.get(dof, dof) != 0.0 {
            continue;
        }
        if (0..k.n).any(|other| k.get(dof, other) != 0.0 || k.get(other, dof) != 0.0) {
            continue;
        }
        if f[dof] != 0.0 {
            return Err("load on a disconnected 2D frame rotation".into());
        }
        prescribed[dof] = Some(0.0);
    }
    let mut states: HashMap<usize, AxialState> = elements
        .keys()
        .map(|&id| (id, AxialState::default()))
        .collect();
    let mut final_factor = 1.0;
    let mut iterations = 0;
    let (u, reactions) = if request.analysis.material() {
        let mut u = vec![0.0; k.n];
        let path = if request.load_path.is_empty() {
            vec![1.0]
        } else {
            request.load_path.clone()
        };
        let steps = if request
            .materials
            .iter()
            .any(|m| !matches!(m.law, MaterialLaw::Elastic))
        {
            10
        } else {
            1
        };
        let mut start = 0.0;
        for &end in &path {
            for step in 1..=steps {
                let factor = start + (end - start) * step as f64 / steps as f64;
                let constraints: Vec<Option<f64>> = prescribed
                    .iter()
                    .map(|value| value.map(|v| factor * v))
                    .collect();
                let mut converged = false;
                for _ in 0..request.max_iterations {
                    iterations += 1;
                    let (tangent, internal, member_load) = material_system(
                        &elements,
                        &u,
                        &states,
                        &spring_stiffness,
                        request.analysis.geometric(),
                        factor,
                    )?;
                    let target: Vec<f64> = nodal_f
                        .iter()
                        .zip(&member_load)
                        .map(|(nodal, member)| factor * (nodal + member))
                        .collect();
                    if request.analysis.geometric() {
                        free_positive_definite(&tangent, &constraints)?;
                    }
                    let ku = tangent.mul(&u);
                    let rhs: Vec<f64> = target
                        .iter()
                        .zip(&internal)
                        .zip(&ku)
                        .map(|((load, force), ku)| load - force + ku)
                        .collect();
                    let (candidate, _) = constrained_solve(&tangent, &rhs, &constraints)?;
                    let change = candidate
                        .iter()
                        .zip(&u)
                        .map(|(a, b)| (a - b).powi(2))
                        .sum::<f64>()
                        .sqrt();
                    let magnitude = candidate
                        .iter()
                        .map(|v| v * v)
                        .sum::<f64>()
                        .sqrt()
                        .max(1e-12);
                    u = candidate;
                    if change / magnitude <= request.tolerance {
                        converged = true;
                        break;
                    }
                }
                if !converged {
                    return Err(format!(
                        "2D frame material iteration did not converge at load factor {factor}"
                    ));
                }
                states = elements
                    .iter()
                    .map(|(&id, element)| {
                        let d = local_displacement(element, &u);
                        let response = axial_response(
                            &element.material,
                            axial_strain(element, &d) - factor * element.thermal_strain,
                            states[&id],
                        );
                        (id, response.state)
                    })
                    .collect();
            }
            start = end;
        }
        final_factor = *path.last().unwrap();
        let (_, internal, member_load) = material_system(
            &elements,
            &u,
            &states,
            &spring_stiffness,
            request.analysis.geometric(),
            final_factor,
        )?;
        f = nodal_f
            .iter()
            .zip(&member_load)
            .map(|(nodal, member)| nodal + member)
            .collect();
        let reactions = internal
            .iter()
            .zip(&f)
            .map(|(force, load)| force - final_factor * load)
            .collect();
        (u, reactions)
    } else {
        let (mut u, _) = constrained_solve(&k, &f, &prescribed)?;
        iterations = 1;
        if request.analysis.geometric() {
            let mut converged = false;
            for iteration in 2..=request.max_iterations {
                let (candidate_k, candidate_f) =
                    geometric_assembly(&elements, &nodal_f, &spring_stiffness, &u)?;
                free_positive_definite(&candidate_k, &prescribed)?;
                let (candidate, _) = constrained_solve(&candidate_k, &candidate_f, &prescribed)?;
                let change = candidate
                    .iter()
                    .zip(&u)
                    .map(|(a, b)| (a - b).powi(2))
                    .sum::<f64>()
                    .sqrt();
                let magnitude = candidate
                    .iter()
                    .map(|v| v * v)
                    .sum::<f64>()
                    .sqrt()
                    .max(1e-12);
                u = candidate;
                iterations = iteration;
                if change / magnitude <= request.tolerance {
                    converged = true;
                    break;
                }
            }
            if !converged {
                return Err(format!(
                    "2D frame P-Delta did not converge in {} iterations",
                    request.max_iterations
                ));
            }
            (k, f) = geometric_assembly(&elements, &nodal_f, &spring_stiffness, &u)?;
            free_positive_definite(&k, &prescribed)?;
        }
        let reactions: Vec<f64> = k
            .mul(&u)
            .iter()
            .zip(&f)
            .map(|(ku, load)| ku - load)
            .collect();
        (u, reactions)
    };
    let max_load = f.iter().fold(1.0_f64, |maximum, &value| {
        maximum.max((final_factor * value).abs())
    });
    let equilibrium_residual = reactions
        .iter()
        .enumerate()
        .filter(|(dof, _)| prescribed[*dof].is_none())
        .fold(0.0_f64, |maximum, (_, value)| maximum.max(value.abs()))
        / max_load;
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| NodeResult {
            node_id: node.id,
            displacement: [u[3 * index], u[3 * index + 1], u[3 * index + 2]],
            reaction: [
                reactions[3 * index] - support_stiffness[3 * index] * u[3 * index],
                reactions[3 * index + 1] - support_stiffness[3 * index + 1] * u[3 * index + 1],
                reactions[3 * index + 2] - support_stiffness[3 * index + 2] * u[3 * index + 2],
            ],
        })
        .collect();
    let members = request
        .members
        .iter()
        .map(|member| {
            let element = &elements[&member.id];
            let unrecovered = local_displacement(element, &u);
            let material_response = request.analysis.material().then(|| {
                axial_response(
                    &element.material,
                    axial_strain(element, &unrecovered) - final_factor * element.thermal_strain,
                    states[&member.id],
                )
            });
            let axial_override =
                material_response.map(|response| response.stress_mpa * 1000.0 * element.area_m2);
            let local_displacement = connected_local_displacement(
                element,
                unrecovered,
                final_factor,
                request.analysis.geometric(),
                axial_override,
            );
            let stiffness = element
                .raw_stiffness
                .as_ref()
                .unwrap_or(&element.local_stiffness);
            let applied_load = element.raw_load.as_ref().unwrap_or(&element.local_load);
            let mut elastic_end_forces = [0.0; 6];
            for i in 0..6 {
                elastic_end_forces[i] = (0..6)
                    .map(|j| stiffness[i][j] * local_displacement[j])
                    .sum::<f64>()
                    - final_factor * applied_load[i];
            }
            let response = material_response;
            let axial = if let Some(response) = response {
                response.stress_mpa * 1000.0 * element.area_m2
            } else {
                axial_force(element, &local_displacement)
            };
            let mut local_end_forces = elastic_end_forces;
            if request.analysis.material() {
                let correction = axial - element.ea_kn * axial_strain(element, &local_displacement)
                    + final_factor * element.ea_kn * element.thermal_strain;
                local_end_forces[0] -= correction;
                local_end_forces[3] += correction;
            }
            if request.analysis.geometric() {
                let kg = geometric_local(element, axial);
                for i in 0..6 {
                    local_end_forces[i] += (0..6)
                        .map(|j| kg[i][j] * local_displacement[j])
                        .sum::<f64>();
                }
            }
            let line_loads: Vec<&MemberLoad> = request
                .member_loads
                .iter()
                .filter(|load| load.member_id == member.id)
                .collect();
            let point_loads: Vec<&MemberPointLoad> = request
                .member_point_loads
                .iter()
                .filter(|load| load.member_id == member.id)
                .collect();
            let mut samples: Vec<(f64, bool)> = (0..=20)
                .map(|index| (element.length * index as f64 / 20.0, true))
                .collect();
            for point in &point_loads {
                samples.retain(|(x, _)| (x - point.position_m).abs() > 1e-10);
                samples.push((point.position_m, false));
                samples.push((point.position_m, true));
            }
            samples.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
            let mut stations_m = Vec::with_capacity(samples.len());
            let mut normal_force_kn = Vec::with_capacity(samples.len());
            let mut shear_force_kn = Vec::with_capacity(samples.len());
            let mut bending_moment_knm = Vec::with_capacity(samples.len());
            let mut deflection_m = Vec::with_capacity(samples.len());
            let mut axial_disp_m = Vec::with_capacity(samples.len());
            let mut rotation_rad = Vec::with_capacity(samples.len());
            for (x, right_side) in samples {
                let integral = |axial, power| {
                    line_loads
                        .iter()
                        .map(|load| integrated_load(load, element.length, x, axial, power))
                        .sum::<f64>()
                        * final_factor
                };
                let point = |axial, power| {
                    point_loads
                        .iter()
                        .filter(|load| {
                            load.position_m < x - 1e-10
                                || (right_side && (load.position_m - x).abs() <= 1e-10)
                        })
                        .map(|load| {
                            let force = if axial { load.px_kn } else { load.py_kn };
                            let distance = (x - load.position_m).max(0.0);
                            let factorial = match power {
                                0 | 1 => 1.0,
                                2 => 2.0,
                                3 => 6.0,
                                _ => unreachable!(),
                            };
                            force * distance.powi(power as i32) / factorial
                        })
                        .sum::<f64>()
                        * final_factor
                };
                stations_m.push(x);
                normal_force_kn.push(-local_end_forces[0] - integral(true, 0) - point(true, 0));
                shear_force_kn.push(local_end_forces[1] + integral(false, 0) + point(false, 0));
                axial_disp_m.push(if request.analysis.material() {
                    local_displacement[0]
                        + (local_displacement[3] - local_displacement[0]) * x / element.length
                } else {
                    local_displacement[0]
                        + final_factor * element.thermal_strain * x
                        + (-elastic_end_forces[0] * x - integral(true, 1) - point(true, 1))
                            / element.ea_kn
                });
                rotation_rad.push(
                    local_displacement[2]
                        + final_factor * element.thermal_curvature * x
                        + (-elastic_end_forces[2] * x
                            + elastic_end_forces[1] * x * x / 2.0
                            + integral(false, 2)
                            + point(false, 2))
                            / element.ei_knm2,
                );
                let deflection = local_displacement[1]
                    + local_displacement[2] * x
                    + final_factor * element.thermal_curvature * x * x / 2.0
                    + (-elastic_end_forces[2] * x * x / 2.0
                        + elastic_end_forces[1] * x.powi(3) / 6.0
                        + integral(false, 3)
                        + point(false, 3))
                        / element.ei_knm2;
                deflection_m.push(deflection);
                bending_moment_knm.push(
                    -local_end_forces[2]
                        + local_end_forces[1] * x
                        + integral(false, 1)
                        + point(false, 1)
                        + if request.analysis.geometric() {
                            axial * (deflection - local_displacement[1])
                        } else {
                            0.0
                        },
                );
            }
            MemberResult {
                member_id: member.id,
                local_end_forces,
                stations_m,
                normal_force_kn,
                shear_force_kn,
                bending_moment_knm,
                deflection_m,
                axial_disp_m,
                rotation_rad,
                axial_history: response.map(|response| AxialHistory {
                    plastic_strain: response.state.plastic_strain,
                    equivalent_plastic_strain: response.state.equivalent_plastic_strain,
                    tensile_damage: response.state.tensile_damage,
                    tangent_e_mpa: response.tangent_e_mpa,
                }),
            }
        })
        .collect();
    Ok(Result2D {
        nodes,
        members,
        equilibrium_residual,
        iterations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cantilever() -> Request {
        Request {
            analysis: Analysis::Linear,
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                },
                Node {
                    id: 2,
                    x: 3.0,
                    y: 0.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 210_000.0,
                law: MaterialLaw::Elastic,
            }],
            sections: vec![Section {
                id: 1,
                area_m2: 0.01,
                inertia_m4: 8e-6,
            }],
            members: vec![Member {
                id: 1,
                start_node_id: 1,
                end_node_id: 2,
                material_id: 1,
                section_id: 1,
                releases: EndReleases::default(),
                springs: EndSprings::default(),
                foundation_kn_per_m2: None,
            }],
            supports: vec![Support {
                node_id: 1,
                ux: true,
                uy: true,
                rz: true,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
                krz_knm_per_rad: None,
                ux_prescribed_m: None,
                uy_prescribed_m: None,
                rz_prescribed_rad: None,
            }],
            nodal_loads: vec![],
            member_loads: vec![],
            member_point_loads: vec![],
            thermal_loads: vec![],
            load_path: vec![],
            max_iterations: default_iterations(),
            tolerance: default_tolerance(),
        }
    }

    fn fixed_end(input: &mut Request) {
        let mut support = input.supports[0].clone();
        support.node_id = 2;
        input.supports.push(support);
    }

    #[test]
    fn rotational_start_spring_adds_closed_form_cantilever_tip_rotation() {
        let mut input = cantilever();
        let k = 3500.0;
        input.members[0].springs.rz_start_knm_per_rad = Some(k);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let expected = -10.0 * 3.0_f64.powi(3) / (3.0 * ei) - 10.0 * 3.0_f64.powi(2) / k;
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-11);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-9);
        assert!((result.members[0].local_end_forces[2] - 30.0).abs() < 1e-9);
    }

    #[test]
    fn axial_start_spring_adds_series_extension() {
        let mut input = cantilever();
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 50.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ea = 210_000.0 * 1000.0 * 0.01;
        let expected = 50.0 * 3.0 / ea + 50.0 / 200_000.0;
        assert!((result.nodes[1].displacement[0] - expected).abs() < 1e-12);
        assert!((result.members[0].normal_force_kn[10] - 50.0).abs() < 1e-9);
        assert!((result.nodes[0].reaction[0] + 50.0).abs() < 1e-9);
    }

    #[test]
    fn two_axial_end_springs_sum_their_series_compliance() {
        let mut input = cantilever();
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        input.members[0].springs.ux_end_kn_per_m = Some(100_000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 50.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ea = 210_000.0 * 1000.0 * 0.01;
        let expected = 50.0 * (3.0 / ea + 1.0 / 200_000.0 + 1.0 / 100_000.0);
        assert!((result.nodes[1].displacement[0] - expected).abs() < 1e-12);
        assert!((result.members[0].axial_disp_m[0] - 50.0 / 200_000.0).abs() < 1e-12);
        assert!((result.members[0].normal_force_kn[10] - 50.0).abs() < 1e-9);
    }

    #[test]
    fn transverse_start_spring_adds_shear_extension() {
        let mut input = cantilever();
        input.members[0].springs.uy_start_kn_per_m = Some(1000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let expected = -10.0 * 3.0_f64.powi(3) / (3.0 * ei) - 10.0 / 1000.0;
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-11);
        assert!((result.members[0].deflection_m[0] + 0.01).abs() < 1e-11);
        assert!((result.members[0].local_end_forces[1] - 10.0).abs() < 1e-9);
    }

    #[test]
    fn rotational_spring_coexists_with_steel_axial_plasticity() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.members[0].springs.rz_start_knm_per_rad = Some(3500.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let plastic_strain = 250.0 / 210_000.0 + 50.0 / (0.02 * 210_000.0);
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let bending = -10.0 * 3.0_f64.powi(3) / (3.0 * ei) - 10.0 * 3.0_f64.powi(2) / 3500.0;
        assert!((result.nodes[1].displacement[0] - 3.0 * plastic_strain).abs() < 1e-8);
        assert!((result.nodes[1].displacement[1] - bending).abs() < 1e-9);
        assert!((result.members[0].local_end_forces[2] - 30.0).abs() < 1e-7);
        input.members[0].springs.ux_start_kn_per_m = Some(1000.0);
        assert!(solve(&input)
            .unwrap_err()
            .contains("axial connection springs"));
    }

    #[test]
    fn transverse_spring_coexists_with_concrete_tension_damage() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.05,
        };
        input.members[0].springs.uy_start_kn_per_m = Some(1000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 100.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 30_000.0 * 1000.0 * 8e-6;
        let expected = -10.0 * 3.0_f64.powi(3) / (3.0 * ei) - 10.0 / 1000.0;
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-9);
        assert!(
            result.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .tensile_damage
                > 0.0
        );
        assert!((result.members[0].normal_force_kn[10] - 100.0).abs() < 1e-5);
    }

    #[test]
    fn rotational_end_spring_under_udl_matches_slope_deflection() {
        let mut input = cantilever();
        fixed_end(&mut input);
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let k = 4.0 * ei / 3.0;
        input.members[0].springs.rz_end_knm_per_rad = Some(k);
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -10.0,
            qy_end_kn_per_m: -10.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        let theta = (10.0 * 3.0_f64.powi(2) / 12.0) / (4.0 * ei / 3.0 + k);
        let m_end = k * theta;
        let m_start = 10.0 * 3.0_f64.powi(2) / 12.0 + 2.0 * ei / 3.0 * theta;
        assert!((result.members[0].local_end_forces[5].abs() - m_end).abs() < 1e-9);
        assert!((result.members[0].local_end_forces[2].abs() - m_start).abs() < 1e-9);
        assert!((result.nodes[0].reaction[1] + result.nodes[1].reaction[1] - 30.0).abs() < 1e-9);
    }

    #[test]
    fn release_overrides_parallel_end_spring_and_invalid_springs_are_rejected() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.rz_end = true;
        input.members[0].springs.rz_end_knm_per_rad = Some(1e6);
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -10.0,
            qy_end_kn_per_m: -10.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0].local_end_forces[5].abs() < 1e-9);
        input.members[0].springs.ux_start_kn_per_m = Some(f64::NAN);
        assert!(solve(&input).unwrap_err().contains("connection spring"));
    }

    #[test]
    fn axial_translation_release_allows_free_thermal_expansion() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.ux_start = true;
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 30.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-9));
        assert!((result.members[0].axial_disp_m[0] + 0.00108).abs() < 1e-12);
        assert!(result
            .nodes
            .iter()
            .all(|node| node.reaction[0].abs() < 1e-9));
    }

    #[test]
    fn transverse_translation_release_transfers_member_load_to_other_end() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.uy_start = true;
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -10.0,
            qy_end_kn_per_m: -10.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0].local_end_forces[1].abs() < 1e-8);
        assert!((result.nodes[1].reaction[1] - 30.0).abs() < 1e-8);
        assert!(result.nodes[0].reaction[1].abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-9);
    }

    #[test]
    fn two_axial_end_releases_are_valid_only_with_external_axial_restraint() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.ux_start = true;
        input.members[0].releases.ux_end = true;
        assert!(solve(&input).unwrap().members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-9));
        input.supports[1].ux = false;
        assert!(solve(&input).unwrap_err().contains("singular"));
    }

    #[test]
    fn material_analysis_rejects_axial_translation_release_until_section_law_is_condensed() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.members[0].releases.ux_start = true;
        assert!(solve(&input)
            .unwrap_err()
            .contains("axial translation releases"));
    }

    #[test]
    fn foundation_adds_tributary_stiffness_without_reporting_soil_as_support() {
        let mut input = cantilever();
        input.members[0].foundation_kn_per_m2 = Some(100.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let beam_tip_stiffness = 3.0 * 210_000.0 * 1000.0 * 8e-6 / 3.0_f64.powi(3);
        let soil_tip_stiffness = 100.0 * 3.0 / 2.0;
        let expected = -10.0 / (beam_tip_stiffness + soil_tip_stiffness);
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-12);
        assert!(result.nodes[1].reaction[1].abs() < 1e-9);
        assert!((result.nodes[0].reaction[1] - 10.0 - soil_tip_stiffness * expected).abs() < 1e-9);
        assert!(result.equilibrium_residual < 1e-9);
    }

    #[test]
    fn foundation_rejects_nonpositive_or_nonfinite_stiffness() {
        for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let mut input = cantilever();
            input.members[0].foundation_kn_per_m2 = Some(invalid);
            assert!(solve(&input).unwrap_err().contains("foundation"));
        }
    }

    #[test]
    fn geometric_foundation_frame_uses_sparse_stability_check() {
        let mut input = cantilever();
        input.nodes = (0..=200)
            .map(|index| Node {
                id: index + 1,
                x: index as f64,
                y: 0.0,
            })
            .collect();
        input.materials[0].e_mpa = 1000.0;
        input.sections[0].area_m2 = 1.0;
        input.sections[0].inertia_m4 = 0.001;
        input.members = (0..200)
            .map(|index| Member {
                id: index + 1,
                start_node_id: index + 1,
                end_node_id: index + 2,
                material_id: 1,
                section_id: 1,
                releases: EndReleases::default(),
                springs: EndSprings::default(),
                foundation_kn_per_m2: Some(1000.0),
            })
            .collect();
        input.nodal_loads.push(NodalLoad {
            node_id: 201,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let linear = solve(&input).unwrap();
        input.analysis = Analysis::Geometric;
        let geometric = solve(&input).unwrap();
        assert!(
            (linear.nodes[200].displacement[1] - geometric.nodes[200].displacement[1]).abs()
                < 1e-10
        );
        assert!(geometric.equilibrium_residual < 1e-8);
        assert!(geometric.iterations >= 2);
    }

    #[test]
    fn uniform_temperature_matches_free_and_restrained_axial_solutions() {
        let mut input = cantilever();
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 40.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let free = solve(&input).unwrap();
        assert!((free.nodes[1].displacement[0] - 0.00144).abs() < 1e-12);
        assert!(free.members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-8));
        assert!((free.members[0].axial_disp_m[10] - 0.00072).abs() < 1e-12);

        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let restrained = solve(&input).unwrap();
        assert!((restrained.nodes[0].reaction[0] - 1008.0).abs() < 1e-8);
        assert!((restrained.nodes[1].reaction[0] + 1008.0).abs() < 1e-8);
        assert!(restrained.members[0]
            .axial_disp_m
            .iter()
            .all(|u| u.abs() < 1e-11));
        assert!(restrained.equilibrium_residual < 1e-12);

        input.thermal_loads[0].alpha_per_k = f64::NAN;
        assert!(solve(&input).unwrap_err().contains("thermal load"));
        input.thermal_loads[0].alpha_per_k = 12e-6;
        input.thermal_loads[0].member_id = 99;
        assert!(solve(&input)
            .unwrap_err()
            .contains("unknown thermally loaded"));
    }

    #[test]
    fn thermal_gradient_matches_free_curvature_and_fixed_end_moments() {
        let mut input = cantilever();
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 0.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 40.0,
            depth_m: Some(0.2),
        });
        let curvature = -12e-6 * 40.0 / 0.2;
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            ..input.supports[0].clone()
        });
        let free = solve(&input).unwrap();
        assert!((free.members[0].deflection_m[10] + curvature * 3.0 * 3.0 / 8.0).abs() < 1e-11);
        assert!((free.members[0].rotation_rad[0] + curvature * 3.0 / 2.0).abs() < 1e-11);
        assert!(free.members[0]
            .bending_moment_knm
            .iter()
            .all(|m| m.abs() < 1e-9));
        assert!(free.nodes.iter().all(|node| node.reaction[1].abs() < 1e-9));

        input.supports[0].rz = true;
        input.supports[1].rz = true;
        let fixed = solve(&input).unwrap();
        let thermal_moment = 210_000.0 * 1000.0 * 8e-6 * curvature;
        assert!(fixed.members[0]
            .deflection_m
            .iter()
            .all(|v| v.abs() < 1e-11));
        assert!(fixed.members[0]
            .bending_moment_knm
            .iter()
            .all(|m| (m + thermal_moment).abs() < 1e-8));
        assert!((fixed.members[0].local_end_forces[2] - thermal_moment).abs() < 1e-8);
        assert!((fixed.members[0].local_end_forces[5] + thermal_moment).abs() < 1e-8);

        input.analysis = Analysis::Combined;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 100.0,
            hardening_ratio: 0.2,
        };
        input.supports[1].ux = true;
        input.thermal_loads[0].delta_t_k = 100.0;
        input.load_path = vec![1.0];
        let combined = solve(&input).unwrap();
        assert!((combined.members[0].bending_moment_knm[10] + thermal_moment).abs() < 1e-8);
        assert!(
            combined.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                < 0.0
        );

        input.analysis = Analysis::Linear;
        input.load_path.clear();
        input.materials[0].law = MaterialLaw::Elastic;
        input.thermal_loads[0].delta_t_k = 0.0;
        input.members[0].releases = EndReleases {
            rz_start: true,
            rz_end: true,
            ..EndReleases::default()
        };
        let hinged = solve(&input).unwrap();
        assert!((hinged.members[0].deflection_m[10] + curvature * 3.0 * 3.0 / 8.0).abs() < 1e-11);
        assert!(hinged.members[0]
            .bending_moment_knm
            .iter()
            .all(|m| m.abs() < 1e-9));

        input.thermal_loads[0].depth_m = None;
        assert!(solve(&input).unwrap_err().contains("thermal load"));
        input.thermal_loads[0].depth_m = Some(-0.2);
        assert!(solve(&input).unwrap_err().contains("thermal load"));
    }

    #[test]
    fn thermal_steel_path_uses_mechanical_strain_and_retains_plasticity() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 100.0,
            hardening_ratio: 0.5,
        };
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 100.0,
            alpha_per_k: 1e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let free = solve(&input).unwrap();
        assert!((free.nodes[1].displacement[0] - 0.003).abs() < 1e-10);
        assert!(
            free.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                .abs()
                < 1e-12
        );

        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let peak = solve(&input).unwrap();
        assert!((peak.nodes[0].reaction[0] - 1550.0).abs() < 1e-7);
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        assert!((unloaded.nodes[0].reaction[0] + 550.0).abs() < 1e-7);
        assert!(
            (unloaded.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                + 0.0002619047619047619)
                .abs()
                < 1e-12
        );
        assert!(unloaded.equilibrium_residual < 1e-10);

        let documented: Request = serde_json::from_str(include_str!(
            "../examples/frame2d-thermal-steel-unload.json"
        ))
        .unwrap();
        let example = solve(&documented).unwrap();
        assert!((example.nodes[0].reaction[0] + 550.0).abs() < 1e-7);
    }

    #[test]
    fn restrained_cooling_retains_concrete_damage_on_partial_reheating() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 33_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.2,
        };
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: -30.0,
            alpha_per_k: 1e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        input.load_path = vec![1.0, 0.0, 0.5];
        let result = solve(&input).unwrap();
        let history = result.members[0].axial_history.as_ref().unwrap();
        assert!((history.tensile_damage - (1.0 - 4.38 / 9.9)).abs() < 1e-10);
        assert!((result.nodes[0].reaction[0] + 21.9).abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn thermal_compression_amplifies_combined_geometric_material_sway() {
        let mut input = cantilever();
        input.analysis = Analysis::Combined;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: false,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let baseline = solve(&input).unwrap();
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 10.0,
            alpha_per_k: 1.2e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let heated = solve(&input).unwrap();
        assert!(heated.nodes[1].displacement[1] < baseline.nodes[1].displacement[1]);
        assert!(heated.members[0].normal_force_kn[0] < -200.0);
        assert!(heated.equilibrium_residual < 1e-7);
    }

    #[test]
    fn tip_force_matches_euler_bernoulli_closed_form() {
        let mut input = cantilever();
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!(
            (result.nodes[1].displacement[1] + 10.0 * 3.0_f64.powi(3) / (3.0 * ei)).abs() < 1e-12
        );
        assert!(
            (result.nodes[1].displacement[2] + 10.0 * 3.0_f64.powi(2) / (2.0 * ei)).abs() < 1e-12
        );
        assert!((result.nodes[0].reaction[1] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-10);
        assert!(
            (result.members[0].deflection_m[20] - result.nodes[1].displacement[1]).abs() < 1e-12
        );
        assert!(
            (result.members[0].rotation_rad[20] - result.nodes[1].displacement[2]).abs() < 1e-12
        );
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn p_delta_compression_amplifies_and_tension_reduces_tip_sway() {
        let mut input = cantilever();
        input.analysis = Analysis::Geometric;
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: -100.0,
            fy: -10.0,
            mz: 0.0,
        });
        let compression = solve(&input).unwrap();
        input.nodal_loads[0].fx = 100.0;
        let tension = solve(&input).unwrap();
        input.analysis = Analysis::Linear;
        let linear = solve(&input).unwrap();
        assert!(compression.nodes[1].displacement[1] < linear.nodes[1].displacement[1]);
        assert!(tension.nodes[1].displacement[1] > linear.nodes[1].displacement[1]);
        let wave = (100.0_f64 / (210_000.0 * 1000.0 * 8e-6)).sqrt();
        let exact = -10.0 / (100.0 * wave) * ((3.0 * wave).tan() - 3.0 * wave);
        assert!((compression.nodes[1].displacement[1] / exact - 1.0).abs() < 0.001);
        assert!(compression.iterations >= 2);
        assert!(compression.equilibrium_residual < 1e-8);
        assert!((compression.nodes[0].reaction[0] - 100.0).abs() < 1e-8);
        assert!(
            (compression.nodes[0].reaction[2]
                - (30.0 - 100.0 * compression.nodes[1].displacement[1]))
                .abs()
                < 1e-8
        );
        assert!(
            compression.members[0]
                .bending_moment_knm
                .last()
                .unwrap()
                .abs()
                < 1e-8
        );
    }

    #[test]
    fn p_delta_rejects_compression_above_euler_cantilever_load() {
        let mut input = cantilever();
        input.analysis = Analysis::Geometric;
        // Pcr = pi² EI/(4 L²) = 460.6 kN for this one-element column.
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: -600.0,
            fy: -1.0,
            mz: 0.0,
        });
        assert!(solve(&input)
            .unwrap_err()
            .contains("non-positive free stiffness"));
    }

    #[test]
    fn documented_cantilever_example_matches_closed_form() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-cantilever.json")).unwrap();
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!((result.nodes[1].displacement[1] + 10.0 * 27.0 / (3.0 * ei)).abs() < 1e-12);
        assert!((result.nodes[1].displacement[2] + 10.0 * 9.0 / (2.0 * ei)).abs() < 1e-12);
        assert!((result.nodes[0].reaction[1] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-10);
    }

    #[test]
    fn released_tip_rotation_recovers_cantilever_response_despite_fixed_joint_rotation() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!((result.nodes[1].displacement[1] + 10.0 * 27.0 / (3.0 * ei)).abs() < 1e-11);
        assert_eq!(result.nodes[1].displacement[2], 0.0);
        assert!(
            (result.members[0].rotation_rad.last().unwrap() + 10.0 * 9.0 / (2.0 * ei)).abs()
                < 1e-11
        );
        assert!(result.members[0].local_end_forces[5].abs() < 1e-9);
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-9);
    }

    #[test]
    fn two_end_releases_condense_distributed_load_and_inactive_rotations() {
        let mut input = cantilever();
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.members[0].releases = EndReleases {
            rz_start: true,
            rz_end: true,
            ..EndReleases::default()
        };
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        assert!((result.nodes[0].reaction[1] - 7.5).abs() < 1e-9);
        assert!((result.nodes[1].reaction[1] - 7.5).abs() < 1e-9);
        assert!(result.members[0].local_end_forces[2].abs() < 1e-9);
        assert!(result.members[0].local_end_forces[5].abs() < 1e-9);
        assert!((result.members[0].bending_moment_knm[10] - 5.0 * 9.0 / 8.0).abs() < 1e-9);
        input.analysis = Analysis::Geometric;
        let geometric = solve(&input).unwrap();
        assert!((geometric.members[0].bending_moment_knm[10] - 5.0 * 9.0 / 8.0).abs() < 1e-9);
    }

    #[test]
    fn p_delta_with_released_tip_recovers_beam_column_solution() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        input.analysis = Analysis::Geometric;
        input.nodal_loads[0].fx = -100.0;
        let result = solve(&input).unwrap();
        let wave = (100.0_f64 / (210_000.0 * 1000.0 * 8e-6)).sqrt();
        let exact = -10.0 / (100.0 * wave) * ((3.0 * wave).tan() - 3.0 * wave);
        assert!((result.nodes[1].displacement[1] / exact - 1.0).abs() < 0.001);
        assert!(result.members[0].local_end_forces[5].abs() < 1e-8);
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-8);
        input.nodal_loads[0].fx = -600.0;
        assert!(solve(&input)
            .unwrap_err()
            .contains("non-positive free stiffness"));
    }

    #[test]
    fn material_path_with_release_scales_member_load_and_recovers_rotation() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        input.analysis = Analysis::Material;
        input.load_path = vec![0.5];
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let material = solve(&input).unwrap();
        input.analysis = Analysis::Linear;
        input.load_path.clear();
        input.nodal_loads[0].fy *= 0.5;
        input.member_loads[0].qy_start_kn_per_m *= 0.5;
        input.member_loads[0].qy_end_kn_per_m *= 0.5;
        let reference = solve(&input).unwrap();
        assert!(
            (material.nodes[1].displacement[1] - reference.nodes[1].displacement[1]).abs() < 1e-10
        );
        assert!(
            (material.members[0].rotation_rad.last().unwrap()
                - reference.members[0].rotation_rad.last().unwrap())
            .abs()
                < 1e-10
        );
        assert!(material.members[0].local_end_forces[5].abs() < 1e-9);
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(
            (combined.nodes[1].displacement[1] - reference.nodes[1].displacement[1]).abs() < 1e-10
        );
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-9);
    }

    #[test]
    fn combined_release_with_member_load_matches_elastic_p_delta() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        input.nodal_loads[0].fx = -100.0;
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -2.0,
            qy_end_kn_per_m: -2.0,
            start_position_m: None,
            end_position_m: None,
        });
        input.analysis = Analysis::Geometric;
        let geometric = solve(&input).unwrap();
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(
            (combined.nodes[1].displacement[1] - geometric.nodes[1].displacement[1]).abs() < 1e-8
        );
        assert!((combined.nodes[0].reaction[2] - geometric.nodes[0].reaction[2]).abs() < 1e-7);
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-8);
        assert!(combined.equilibrium_residual < 1e-8);
    }

    #[test]
    fn combined_release_retains_steel_plasticity_and_tension_stiffening() {
        let mut input: Request = serde_json::from_str(include_str!(
            "../examples/frame2d-combined-released-steel.json"
        ))
        .unwrap();
        input.analysis = Analysis::Material;
        let material = solve(&input).unwrap();
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(
            (combined.nodes[1].displacement[0] - material.nodes[1].displacement[0]).abs() < 1e-8
        );
        assert!(combined.nodes[1].displacement[1] > material.nodes[1].displacement[1]);
        assert!(
            combined.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                > 0.0
        );
        assert!((combined.members[0].normal_force_kn[0] - 1500.0).abs() < 1e-5);
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-7);
        assert!(combined.equilibrium_residual < 1e-7);
    }

    #[test]
    fn uniform_load_and_midspan_point_force_match_resultants() {
        let mut input = cantilever();
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 0.0,
            py_kn: -4.0,
            position_m: 1.5,
        });
        let result = solve(&input).unwrap();
        assert!((result.nodes[0].reaction[1] - 19.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 28.5).abs() < 1e-10);
        assert!((result.members[0].local_end_forces[1] - 19.0).abs() < 1e-10);
        let stations = &result.members[0].stations_m;
        let jump = stations
            .windows(2)
            .position(|pair| (pair[0] - 1.5).abs() < 1e-12 && (pair[1] - 1.5).abs() < 1e-12)
            .unwrap();
        assert!(
            (result.members[0].shear_force_kn[jump + 1] - result.members[0].shear_force_kn[jump]
                + 4.0)
                .abs()
                < 1e-10
        );
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-10);
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn simply_supported_uniform_load_matches_closed_form_midspan_field() {
        let mut input = cantilever();
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!(
            (result.members[0].deflection_m[10] + 5.0 * 5.0 * 3.0_f64.powi(4) / (384.0 * ei)).abs()
                < 1e-12
        );
        assert!(
            (result.members[0].bending_moment_knm[10] - 5.0 * 3.0_f64.powi(2) / 8.0).abs() < 1e-10
        );
        assert!((result.nodes[0].reaction[1] - 7.5).abs() < 1e-10);
        assert!((result.nodes[1].reaction[1] - 7.5).abs() < 1e-10);
    }

    #[test]
    fn imposed_axial_displacement_gives_ea_delta_over_length() {
        let mut input = cantilever();
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: false,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: Some(0.001),
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let result = solve(&input).unwrap();
        let expected = 210_000.0 * 1000.0 * 0.01 * 0.001 / 3.0;
        assert!((result.nodes[0].reaction[0] + expected).abs() < 1e-10);
        assert!((result.nodes[1].reaction[0] - expected).abs() < 1e-10);
    }

    #[test]
    fn axial_spring_reaction_completes_force_balance() {
        let mut input = cantilever();
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: false,
            rz: false,
            kx_kn_per_m: Some(700.0),
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 100.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let axial_stiffness = 210_000.0 * 1000.0 * 0.01 / 3.0;
        let displacement = 100.0 / (axial_stiffness + 700.0);
        assert!((result.nodes[1].displacement[0] - displacement).abs() < 1e-12);
        assert!((result.nodes[1].reaction[0] + 700.0 * displacement).abs() < 1e-10);
        assert!((result.nodes[0].reaction[0] + axial_stiffness * displacement).abs() < 1e-10);
        assert!(
            (result
                .nodes
                .iter()
                .map(|node| node.reaction[0])
                .sum::<f64>()
                + 100.0)
                .abs()
                < 1e-10
        );
    }

    #[test]
    fn material_axial_member_load_and_unknown_member_load_are_rejected() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 1.0,
            py_kn: 0.0,
            position_m: 1.0,
        });
        assert!(solve(&input)
            .unwrap_err()
            .contains("axial material history"));
        input.analysis = Analysis::Linear;
        input.member_point_loads.clear();
        input.member_point_loads.push(MemberPointLoad {
            member_id: 99,
            px_kn: 0.0,
            py_kn: 1.0,
            position_m: 0.5,
        });
        assert!(solve(&input)
            .unwrap_err()
            .contains("unknown point-loaded member"));
    }

    #[test]
    fn steel_axial_load_path_retains_closed_form_plastic_extension() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: 0.0,
            mz: 0.0,
        });
        let loaded = solve(&input).unwrap();
        let expected_strain = 250.0 / 210_000.0 + (300.0 - 250.0) / (0.02 * 210_000.0);
        assert!((loaded.nodes[1].displacement[0] - 3.0 * expected_strain).abs() < 1e-9);
        assert!((loaded.members[0].normal_force_kn[0] - 3000.0).abs() < 1e-6);
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        let expected_plastic = expected_strain - 300.0 / 210_000.0;
        assert!((unloaded.nodes[1].displacement[0] - 3.0 * expected_plastic).abs() < 1e-8);
        assert!(
            (unloaded.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                - expected_plastic)
                .abs()
                < 1e-8
        );
        assert!(unloaded.members[0].normal_force_kn[0].abs() < 1e-6);
        assert!(unloaded.equilibrium_residual < 1e-6);
    }

    #[test]
    fn documented_steel_unload_example_matches_closed_form() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-steel-unload.json")).unwrap();
        let result = solve(&input).unwrap();
        assert!((result.nodes[1].displacement[0] - 0.035).abs() < 1e-8);
        assert!(result.members[0].normal_force_kn[0].abs() < 1e-6);
    }

    #[test]
    fn concrete_axial_damage_persists_after_unloading() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.2,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 60.0,
            fy: 0.0,
            mz: 0.0,
        });
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        let history = unloaded.members[0].axial_history.as_ref().unwrap();
        assert!(history.tensile_damage > 0.0);
        assert!(unloaded.nodes[1].displacement[0].abs() < 1e-8);
        assert!(unloaded.equilibrium_residual < 1e-6);
        input.load_path.push(0.5);
        let reloaded = solve(&input).unwrap();
        let reloaded_history = reloaded.members[0].axial_history.as_ref().unwrap();
        assert!((reloaded_history.tensile_damage - 2.0 / 3.0).abs() < 1e-8);
        assert!((reloaded_history.tangent_e_mpa - 10_000.0).abs() < 1e-7);
        assert!((reloaded.nodes[1].displacement[0] - 0.0009).abs() < 1e-9);
    }

    #[test]
    fn combined_material_and_geometry_uses_current_axial_force() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: -10.0,
            mz: 0.0,
        });
        let material = solve(&input).unwrap();
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(combined.nodes[1].displacement[1] > material.nodes[1].displacement[1]);
        assert!((combined.members[0].normal_force_kn[0] - 3000.0).abs() < 1e-5);
        assert!(combined.members[0].bending_moment_knm.last().unwrap().abs() < 1e-6);
        assert!(combined.equilibrium_residual < 1e-7);
    }
}
