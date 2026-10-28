//! NAFEMS-benchmarks voor de 3D-adapter (MITC4-schaal van de vastgezette kern), issue #217.
//!
//! Bron van de doelwaarden: NAFEMS, *The Standard NAFEMS Benchmarks*, publicatie TNSB, Rev. 3,
//! oktober 1990 (het NAFEMS-document zelf is niet in de repo opgenomen; zie
//! `docs/verificatie/nafems/README.md` voor de licentiepositie). De invoer en de doelwaarden zijn
//! overgenomen zoals ze in twee onafhankelijke reproducties van TNSB staan:
//! * ESRD, *Benchmarks Guide — The Standard NAFEMS Benchmarks: Linear Elastic Tests* (2018),
//!   blz. 4 (LE1), 8 (LE2), 12 (LE3), 15 (LE5), 19 (LE6);
//! * Dassault Systèmes, *Abaqus Benchmarks Guide* §4.2.1–4.2.6 (LE1–LE6), en voor LE5 de
//!   probleemschets van Dlubal, *Verification Example NAFEMS LE 5* (2021).
//!
//! | test | grootheid en meetpunt | doel | tolerantie (vooraf) |
//! |------|-----------------------|------|---------------------|
//! | LE1  | σyy in D (2; 0), membraan | 92,7 MPa | 3 % op het fijnste net |
//! | LE2  | tangentiële spanning buitenzijde (analytisch 6M/t²) | 60 MPa | 1 % op elk net |
//! | LE3  | radiale verplaatsing in A (10; 0; 0) | 0,185 m | 2 % op 32×32 (haalt dit niet: bevinding) |
//! | LE5  | σxx middenvlak in A (x = 2,5, vrije rand onderflens) | −108 MPa | 5 % op het fijnste net |
//! | LE6  | σ1 onderzijde in E (plaatmidden) | 0,802 MPa | 5 % op het fijnste net |
//!
//! Motivering van de toleranties staat per test en in de README. Ze zijn vastgelegd vóór de
//! eerste uitvoering en niet achteraf aangepast. Elke test drukt een convergentietabel af
//! (`cargo test -p open-fem-3d --release --test nafems -- --nocapture`).
//!
//! Eenheden van de adapter: m, kN, MPa (E), kN/m² (vlaklast), uitvoer σ in MPa.

use std::collections::BTreeMap;

use open_fem_3d::{
    solve, AnalysisKind, Material3D, NodalLoad3D, Node3D, Plate3D, ShellElement3D, ShellNodeResult3D,
    SolveRequest3D, SolveResult3D, Support3D, SurfaceLoad3D,
};

type V3 = [f64; 3];

// ── Gemeenschappelijke bouwstenen ────────────────────────────────────────────

fn request(nodes: Vec<Node3D>, e_mpa: f64, nu: f64) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2,
        analysis: AnalysisKind::Linear,
        nodes,
        materials: vec![Material3D { id: 1, name: "nafems".into(), e_mpa, nu, g_mpa: None, alpha_per_k: None }],
        sections: vec![],
        members: vec![],
        supports: vec![],
        nodal_loads: vec![],
        member_loads: vec![],
        member_point_loads: vec![],
        thermal_loads: vec![],
        plates: vec![],
        shell_elements: vec![],
        surface_loads: vec![],
        diaphragms: vec![], node_links: vec![],
        tension_only_fit: None,
        tension_only_cross_rule: false,
        max_iterations: 50,
        tolerance: 1e-10,
        buckling_modes: 0,
    }
}

/// Vrijheidsgraden vastzetten; meerdere aanroepen op dezelfde knoop worden samengevoegd.
fn fix(supports: &mut BTreeMap<usize, [bool; 6]>, node_id: usize, dofs: [bool; 6]) {
    let entry = supports.entry(node_id).or_insert([false; 6]);
    for k in 0..6 { entry[k] |= dofs[k]; }
}

fn supports_into(map: BTreeMap<usize, [bool; 6]>) -> Vec<Support3D> {
    map.into_iter()
        .map(|(node_id, f)| Support3D {
            node_id, ux: f[0], uy: f[1], uz: f[2], rx: f[3], ry: f[4], rz: f[5],
            ..Default::default()
        })
        .collect()
}

fn add_force(loads: &mut BTreeMap<usize, [f64; 6]>, node_id: usize, f: [f64; 6]) {
    let entry = loads.entry(node_id).or_insert([0.0; 6]);
    for k in 0..6 { entry[k] += f[k]; }
}

fn loads_into(map: BTreeMap<usize, [f64; 6]>) -> Vec<NodalLoad3D> {
    map.into_iter()
        .enumerate()
        .map(|(index, (node_id, f))| NodalLoad3D {
            id: index + 1, node_id, fx: f[0], fy: f[1], fz: f[2], mx: f[3], my: f[4], mz: f[5],
        })
        .collect()
}

fn node_value<'a>(result: &'a SolveResult3D, plate_id: usize, node_id: usize) -> &'a ShellNodeResult3D {
    result.shell_nodes.iter()
        .find(|r| r.node_id == node_id && r.plate_id == plate_id)
        .unwrap_or_else(|| panic!("geen knoopresultaat voor knoop {node_id} in plaat {plate_id}"))
}

fn displacement(result: &SolveResult3D, node_id: usize) -> [f64; 3] {
    let d = result.displacements.iter().find(|d| d.node_id == node_id).expect("verplaatsing");
    [d.ux, d.uy, d.uz]
}

/// Relatieve afwijking actual/target − 1 (positief = grotere absolute waarde dan het doel).
fn deviation(actual: f64, target: f64) -> f64 { actual / target - 1.0 }

/// Grootste hoofdspanning van een vlakke spanningstoestand.
fn principal_max(sx: f64, sy: f64, txy: f64) -> f64 {
    0.5 * (sx + sy) + (0.25 * (sx - sy).powi(2) + txy * txy).sqrt()
}

/// Lijnlast (kN/m, globaal) op een veelhoekige rand als consistente knoopkrachten: per segment
/// de helft van q·L naar elk eindpunt (exact voor een constante last op een rechte rand).
fn edge_load(loads: &mut BTreeMap<usize, [f64; 6]>, chain: &[(usize, V3)], per_segment: impl Fn(V3, V3) -> V3) {
    for pair in chain.windows(2) {
        let (a, pa) = pair[0];
        let (b, pb) = pair[1];
        let f = per_segment(pa, pb);
        add_force(loads, a, [0.5 * f[0], 0.5 * f[1], 0.5 * f[2], 0.0, 0.0, 0.0]);
        add_force(loads, b, [0.5 * f[0], 0.5 * f[1], 0.5 * f[2], 0.0, 0.0, 0.0]);
    }
}

// ── LE1: elliptisch membraan ─────────────────────────────────────────────────

/// LE1 (TNSB Rev. 3; ESRD-gids blz. 4): kwart membraan tussen de ellipsen
/// (x/2)² + y² = 1 (binnen, AD) en (x/3,25)² + (y/2,75)² = 1 (buiten, BC), dikte 0,1 m,
/// E = 210 GPa, ν = 0,3, vlakspanning. Symmetrie op AB (x = 0) en CD (y = 0), uitwendige druk
/// (naar buiten) van 10 MPa op BC. Doel: σyy in D (2; 0) = 92,7 MPa.
///
/// Net: afgebeeld raster tussen de twee ellipsen op gelijke parameterhoek θ (n_θ × n_r). De
/// NAFEMS-netten (grof/fijn) zijn ook zulke afgebeelde netten maar met eigen knooppunten; die
/// coördinaten staan alleen in de figuren van TNSB en zijn hier niet overgenomen.
/// Gemeten: de knoopwaarde in D zoals de app hem toont (randknoop: kwadratische patchfit door de
/// elementmiddens, `shell.rs`), membraanspanning n_yy/t.
const LE1_T: f64 = 0.1;

/// Knoop-id van D (binnenrand, θ = 0) in het LE1-net.
const LE1_D: usize = 1;

fn le1_request(n_theta: usize, n_r: usize) -> SolveRequest3D {
    let t = LE1_T;
    let id = |i: usize, j: usize| 1 + j * (n_r + 1) + i; // i radiaal, j hoek
    let point = |i: usize, j: usize| -> V3 {
        let theta = std::f64::consts::FRAC_PI_2 * j as f64 / n_theta as f64;
        let s = i as f64 / n_r as f64;
        let inner = [2.0 * theta.cos(), theta.sin()];
        let outer = [3.25 * theta.cos(), 2.75 * theta.sin()];
        [inner[0] + s * (outer[0] - inner[0]), inner[1] + s * (outer[1] - inner[1]), 0.0]
    };
    let mut nodes = Vec::new();
    for j in 0..=n_theta {
        for i in 0..=n_r {
            let p = point(i, j);
            nodes.push(Node3D { id: id(i, j), x: p[0], y: p[1], z: p[2] });
        }
    }
    let mut input = request(nodes, 210_000.0, 0.3);
    input.plates.push(Plate3D { id: 1, material_id: 1, thickness_m: t, bedding: None, orthotropy: None });
    for j in 0..n_theta {
        for i in 0..n_r {
            input.shell_elements.push(ShellElement3D {
                id: input.shell_elements.len() + 1,
                plate_id: 1,
                node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
            });
        }
    }
    let mut supports = BTreeMap::new();
    for j in 0..=n_theta {
        for i in 0..=n_r {
            // Vlakspanning: uit het vlak (w, θx, θy) overal vast.
            fix(&mut supports, id(i, j), [false, false, true, true, true, false]);
        }
    }
    for i in 0..=n_r {
        fix(&mut supports, id(i, 0), [false, true, false, false, false, true]); // CD: y = 0
        fix(&mut supports, id(i, n_theta), [true, false, false, false, false, true]); // AB: x = 0
    }
    input.supports = supports_into(supports);
    // Druk naar buiten op BC: p·t per meter rand, loodrecht op elk randsegment.
    let p_kn_per_m = 10_000.0 * t;
    let chain: Vec<(usize, V3)> = (0..=n_theta).map(|j| (id(n_r, j), point(n_r, j))).collect();
    let mut loads = BTreeMap::new();
    // Omloop met toenemende θ (tegen de klok): de buitennormaal van segment a→b is (dy, −dx)/L.
    edge_load(&mut loads, &chain, |a, b| [p_kn_per_m * (b[1] - a[1]), -p_kn_per_m * (b[0] - a[0]), 0.0]);
    input.nodal_loads = loads_into(loads);
    input
}

/// σyy in D (knoopwaarde, MPa) en in het midden van het hoekelement bij D.
fn le1_sigma_d(result: &SolveResult3D) -> (f64, f64) {
    let t = LE1_T;
    let d = node_value(result, 1, LE1_D);
    let sigma_yy = d.values.nyy_kn_per_m / t / 1000.0;
    // Controle: membraan, dus boven = onder.
    assert!((d.values.sigma_yy_top_mpa - d.values.sigma_yy_bottom_mpa).abs() < 1e-6 * sigma_yy.abs());
    // Gemiddelde van de elementmiddens rond D ter vergelijking (geen patchfit).
    let centre = result.shell_elements.iter()
        .find(|e| e.element_id == 1)
        .map(|e| e.values.nyy_kn_per_m / t / 1000.0)
        .unwrap();
    (sigma_yy, centre)
}

fn le1(n_theta: usize, n_r: usize) -> (f64, f64) {
    le1_sigma_d(&solve(le1_request(n_theta, n_r)).expect("LE1 rekent"))
}

#[test]
fn nafems_le1_elliptic_membrane() {
    const TARGET: f64 = 92.7; // MPa, TNSB LE1; ESRD-gids blz. 4
    // Tolerantie 3 %: de doelwaarde heeft drie cijfers en lineaire vierhoeken geven een
    // randspanning met een discretisatiefout van enkele procenten op een matig net.
    const TOLERANCE: f64 = 0.03;
    println!("NAFEMS LE1 — σyy in D (doel {TARGET} MPa)");
    println!("  net (θ×r) | σyy knoop D (MPa) | afwijking | σyy midden hoekelement");
    let mut last = 0.0;
    for (nt, nr) in [(6, 3), (12, 6), (24, 12), (48, 24), (96, 48)] {
        let (sigma, centre) = le1(nt, nr);
        println!("  {nt:>3}×{nr:<3}    | {sigma:>8.3}          | {:+6.2} %  | {centre:>8.3}", 100.0 * deviation(sigma, TARGET));
        last = sigma;
    }
    assert!(deviation(last, TARGET).abs() < TOLERANCE, "LE1: σyy = {last:.3} MPa, doel {TARGET}");
}

// ── LE2: cilinderschaal, buigpatch ───────────────────────────────────────────

/// LE2 (TNSB Rev. 3; ESRD-gids blz. 8): sector van 30° van een cilinderschaal, dikte 10 mm,
/// E = 210 GPa, ν = 0,3. Rand AB ingeklemd, gebogen randen AD en BC symmetrie, op rand DC een
/// gelijkmatig randmoment van 1000 N·mm/mm (= 1 kNm/m). Doel: tangentiële spanning aan de
/// buitenzijde 60 MPa. Dat is ook de analytische waarde: een randmoment op een cilinderpaneel
/// geeft een overal constant ringmoment m = 1 kNm/m, dus σ = 6m/t² = 6·1/0,01² kN/m² = 60 MPa.
///
/// Straal 1 m en lengte 0,5 m zoals in de reproducties (de toestand is homogeen, dus deze maten
/// beïnvloeden het doel niet). Het vervormde NAFEMS-net staat alleen in de figuur van TNSB en is
/// niet overgenomen; we rekenen regelmatige netten. Elk element is een eigen vlakke plaat (de
/// adapter eist vlakke platen), dus gemeten in de elementmiddens.
fn le2(n_axial: usize, n_arc: usize) -> (f64, f64, f64) {
    let (r, length, t, m) = (1.0_f64, 0.5_f64, 0.01_f64, 1.0_f64);
    let half = 15f64.to_radians();
    let id = |i: usize, j: usize| 1 + j * (n_axial + 1) + i;
    let point = |i: usize, j: usize| -> V3 {
        let phi = -half + 2.0 * half * j as f64 / n_arc as f64;
        [length * i as f64 / n_axial as f64, r * phi.sin(), r * phi.cos()]
    };
    let mut nodes = Vec::new();
    for j in 0..=n_arc {
        for i in 0..=n_axial {
            let p = point(i, j);
            nodes.push(Node3D { id: id(i, j), x: p[0], y: p[1], z: p[2] });
        }
    }
    let mut input = request(nodes, 210_000.0, 0.3);
    for j in 0..n_arc {
        for i in 0..n_axial {
            let k = input.shell_elements.len() + 1;
            input.plates.push(Plate3D { id: k, material_id: 1, thickness_m: t, bedding: None, orthotropy: None });
            input.shell_elements.push(ShellElement3D {
                id: k, plate_id: k,
                node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
            });
        }
    }
    let mut supports = BTreeMap::new();
    for i in 0..=n_axial { fix(&mut supports, id(i, 0), [true; 6]); } // AB ingeklemd
    for j in 0..=n_arc {
        // Symmetrievlakken x = 0 en x = L: u_x = 0 en geen draaiing om een as in dat vlak.
        for i in [0, n_axial] { fix(&mut supports, id(i, j), [true, false, false, false, true, true]); }
    }
    input.supports = supports_into(supports);
    // Randmoment op DC om de cilinderas (x), consistent: helft van m·h op de eindknopen.
    let h = length / n_axial as f64;
    let mut loads = BTreeMap::new();
    for i in 0..=n_axial {
        let share = if i == 0 || i == n_axial { 0.5 * h } else { h };
        add_force(&mut loads, id(i, n_arc), [0.0, 0.0, 0.0, -m * share, 0.0, 0.0]);
    }
    input.nodal_loads = loads_into(loads);
    let result = solve(input).expect("LE2 rekent");
    // Plaatassen: z naar buiten (omhoog), x = cilinderas, y = ringrichting; "boven" = buitenzijde.
    let outer: Vec<f64> = result.shell_elements.iter().map(|e| e.values.sigma_yy_top_mpa).collect();
    let min = outer.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = outer.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    // Midden van het paneel (φ = 0) als representatieve waarde.
    let centre_element = (n_arc / 2) * n_axial + n_axial / 2 + 1;
    let centre = result.shell_elements.iter().find(|e| e.element_id == centre_element).unwrap().values.sigma_yy_top_mpa;
    (centre, min, max)
}

#[test]
fn nafems_le2_cylindrical_shell_bending_patch() {
    const TARGET: f64 = 60.0; // MPa, TNSB LE2; analytisch 6m/t²
    // Tolerantie 1 %: homogene toestand die een vlak facetelement exact kan beschrijven.
    const TOLERANCE: f64 = 0.01;
    println!("NAFEMS LE2 — σ_tangentieel buitenzijde (doel {TARGET} MPa)");
    println!("  net (as×boog) | midden (MPa) | min … max over alle elementen | grootste afwijking");
    for (na, nc) in [(1, 1), (2, 2), (4, 4), (8, 8), (8, 16)] {
        let (centre, min, max) = le2(na, nc);
        let worst = deviation(min, TARGET).abs().max(deviation(max, TARGET).abs());
        println!("  {na:>2}×{nc:<2}         | {centre:>8.3}     | {min:>8.3} … {max:>8.3}          | {:.3} %", 100.0 * worst);
        assert!(worst < TOLERANCE, "LE2 {na}×{nc}: spanning {min:.3} … {max:.3} MPa, doel {TARGET}");
    }
}

// ── LE3: halve bol met puntlasten ────────────────────────────────────────────

/// LE3 (TNSB Rev. 3; ESRD-gids blz. 12): kwart van een halve bol (geen gat), straal 10 m,
/// dikte 0,04 m, E = 68,25 GPa, ν = 0,3. Symmetrie op AE (y = 0) en CE (x = 0), u_z = 0 in de
/// pool E, evenaar vrij. Puntlasten F_x = +2 kN in A (10; 0; 0) en F_y = −2 kN in C (0; 10; 0).
/// Doel: radiale verplaatsing in A = 0,185 m.
///
/// Net: lengte-/breedtegraadnet (n meridiaanvakken × n parallelvakken). Elke cel ligt tussen
/// twee parallellen en is symmetrisch om haar middenmeridiaan, dus vlak (de adapter eist vlakke
/// elementen; elk element is een eigen plaat). De bovenste band (pooldriehoeken) is vervangen door
/// een vlakke polkap op de hoogte van de bovenste parallel, opgedeeld in vierhoeken met de pool:
/// de adapter rekent alleen MITC4-vierhoeken. Het gat dat de kap afvlakt is R(1 − cos(90°/n)),
/// bij n = 32 is dat 12 mm (0,12 % van R), ver van het meetpunt.
fn le3(n: usize) -> f64 {
    assert!(n % 2 == 0);
    let (r, t) = (10.0_f64, 0.04_f64);
    // Parallel j = 0 … n−1 (evenaar … bovenste parallel), meridiaan i = 0 … n.
    let id = |i: usize, j: usize| 1 + j * (n + 1) + i;
    let pole = 1 + n * (n + 1);
    let point = |i: usize, j: usize| -> V3 {
        let lambda = std::f64::consts::FRAC_PI_2 * i as f64 / n as f64;
        let beta = std::f64::consts::FRAC_PI_2 * j as f64 / n as f64;
        [r * beta.cos() * lambda.cos(), r * beta.cos() * lambda.sin(), r * beta.sin()]
    };
    let mut nodes = Vec::new();
    for j in 0..n {
        for i in 0..=n {
            let p = point(i, j);
            nodes.push(Node3D { id: id(i, j), x: p[0], y: p[1], z: p[2] });
        }
    }
    let z_cap = point(0, n - 1)[2];
    nodes.push(Node3D { id: pole, x: 0.0, y: 0.0, z: z_cap });
    let mut input = request(nodes, 68_250.0, 0.3);
    let add = |input: &mut SolveRequest3D, node_ids: Vec<usize>| {
        let k = input.shell_elements.len() + 1;
        input.plates.push(Plate3D { id: k, material_id: 1, thickness_m: t, bedding: None, orthotropy: None });
        input.shell_elements.push(ShellElement3D { id: k, plate_id: k, node_ids });
    };
    for j in 0..n - 1 {
        for i in 0..n {
            add(&mut input, vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
        }
    }
    for k in 0..n / 2 {
        let i = 2 * k;
        add(&mut input, vec![pole, id(i, n - 1), id(i + 1, n - 1), id(i + 2, n - 1)]);
    }
    let mut supports = BTreeMap::new();
    for j in 0..n {
        fix(&mut supports, id(0, j), [false, true, false, true, false, true]); // AE: vlak y = 0
        fix(&mut supports, id(n, j), [true, false, false, false, true, true]); // CE: vlak x = 0
    }
    fix(&mut supports, pole, [true, true, true, true, true, true]); // op beide vlakken, en u_z = 0 in E
    input.supports = supports_into(supports);
    let a = id(0, 0);
    let c = id(n, 0);
    let mut loads = BTreeMap::new();
    add_force(&mut loads, a, [2.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    add_force(&mut loads, c, [0.0, -2.0, 0.0, 0.0, 0.0, 0.0]);
    input.nodal_loads = loads_into(loads);
    let result = solve(input).expect("LE3 rekent");
    let ua = displacement(&result, a);
    let uc = displacement(&result, c);
    // Antisymmetrie van de belasting: u_y in C is het tegengestelde van u_x in A.
    assert!((ua[0] + uc[1]).abs() < 1e-6 * ua[0].abs(), "uA = {ua:?}, uC = {uc:?}");
    ua[0]
}

/// LE3-doel, vooraf vastgelegd. Tolerantie 2 %: drie cijfers in de doelwaarde, en onder een
/// puntlast groeit de verplaatsing van een afschuifvervormbare schaal bij verfijning nog
/// logaritmisch (geen strikte limiet).
const LE3_TARGET: f64 = 0.185; // m, TNSB LE3; ESRD-gids blz. 12
const LE3_TOLERANCE: f64 = 0.02;

/// Gemeten stand (bevinding #217): het MITC4-element van de vastgezette kern is op deze dunne,
/// dubbel gekromde schaal (R/t = 250) veel te stijf (membraanvergrendeling van het vlakke
/// facetelement; de kern meldt dit zelf in `SHELL_FAMILY_FEASIBILITY.md`, "Pinched hemisphere
/// … Locked"). Deze test legt de convergentie vast en bewaakt dat de uitkomst bij verfijning
/// stijgt; hij keurt de benchmark NIET goed. De NAFEMS-toets zelf staat in
/// `nafems_le3_target_within_tolerance` (`#[ignore]`, faalt bewust tot het element verbetert).
#[test]
fn nafems_le3_hemisphere_point_loads() {
    println!("NAFEMS LE3 — u_r in A (doel {LE3_TARGET} m) — BEVINDING: buiten tolerantie");
    println!("  net       | u_r A (m) | afwijking");
    let mut previous = 0.0;
    for n in [4, 8, 16, 32, 64] {
        let u = le3(n);
        println!("  {n:>3}×{n:<3}   | {u:.5}   | {:+6.2} %", 100.0 * deviation(u, LE3_TARGET));
        assert!(u > previous, "LE3: de verplaatsing moet bij verfijning toenemen ({previous} → {u})");
        previous = u;
    }
}

#[test]
#[ignore = "bevinding #217: MITC4 van de kern vergrendelt op LE3 (−68 % bij 32×32); zie docs/verificatie/nafems"]
fn nafems_le3_target_within_tolerance() {
    let u = le3(32);
    assert!(deviation(u, LE3_TARGET).abs() < LE3_TOLERANCE, "LE3 32×32: u = {u:.5} m, doel {LE3_TARGET}");
}

// ── LE5: Z-profiel uitkraging ────────────────────────────────────────────────

/// LE5 (TNSB Rev. 3; ESRD-gids blz. 15; schets Dlubal LE 5): uitkraging van 10 m met Z-doorsnede,
/// wanddikte 0,1 m, E = 210 GPa, ν = 0,3. Middenvlakken: lijf 2 m breed in het vlak z = 0
/// (y = −1 … 1), flenzen 1 m: bovenflens op y = 1 van z = 0 tot 1, onderflens op y = −1 van
/// z = 0 tot −1. Inklemming bij x = 0 (alle vrijheidsgraden). Torsiemoment 1,2 MNm bij x = 10 als
/// twee gelijkmatig over de flenseinden verdeelde dwarskrachten van 0,6 MN (+z bovenflens, −z
/// onderflens). Doel: σxx in A, x = 2,5, middenvlak, op de vrije rand van de onderflens
/// (2,5; −1; −1): −108 MPa (meetpunt volgens de schets van Dlubal en de beschrijving in de
/// reproductie van FieldCraft; ESRD noemt alleen x = 2,5 en het middenvlak).
///
/// Drie vlakke platen (lijf, twee flenzen) met gedeelde knopen op de aansluitlijnen.
/// Gemeten: knoopwaarde n_xx/t van de onderflens in A (randknoop: patchfit).
fn le5(n_x: usize, n_f: usize) -> f64 {
    assert!(n_x % 4 == 0);
    let t = 0.1;
    let length = 10.0;
    let n_web = 2 * n_f;
    // Doorsnedeketen: onderflens (z = −1 … 0 bij y = −1), lijf (y = −1 … 1), bovenflens.
    let mut chain: Vec<[f64; 2]> = Vec::new(); // (y, z)
    for k in 0..=n_f { chain.push([-1.0, -1.0 + k as f64 / n_f as f64]); }
    for k in 1..=n_web { chain.push([-1.0 + 2.0 * k as f64 / n_web as f64, 0.0]); }
    for k in 1..=n_f { chain.push([1.0, k as f64 / n_f as f64]); }
    let m = chain.len();
    let id = |s: usize, i: usize| 1 + i * m + s;
    let mut nodes = Vec::new();
    for i in 0..=n_x {
        for (s, yz) in chain.iter().enumerate() {
            nodes.push(Node3D { id: id(s, i), x: length * i as f64 / n_x as f64, y: yz[0], z: yz[1] });
        }
    }
    let mut input = request(nodes, 210_000.0, 0.3);
    for (plate, range) in [(1, 0..n_f), (2, n_f..n_f + n_web), (3, n_f + n_web..m - 1)] {
        input.plates.push(Plate3D { id: plate, material_id: 1, thickness_m: t, bedding: None, orthotropy: None });
        for s in range {
            for i in 0..n_x {
                input.shell_elements.push(ShellElement3D {
                    id: input.shell_elements.len() + 1,
                    plate_id: plate,
                    node_ids: vec![id(s, i), id(s, i + 1), id(s + 1, i + 1), id(s + 1, i)],
                });
            }
        }
    }
    let mut supports = BTreeMap::new();
    for s in 0..m { fix(&mut supports, id(s, 0), [true; 6]); }
    input.supports = supports_into(supports);
    // Dwarskracht 0,6 MN = 600 kN per flens, gelijkmatig langs het flenseinde (consistent).
    let q = 600.0; // kN per meter flenshoogte (flens 1 m)
    let mut loads = BTreeMap::new();
    let lower: Vec<(usize, V3)> = (0..=n_f).map(|s| (id(s, n_x), [length, chain[s][0], chain[s][1]])).collect();
    let upper: Vec<(usize, V3)> = (n_f + n_web..m).map(|s| (id(s, n_x), [length, chain[s][0], chain[s][1]])).collect();
    edge_load(&mut loads, &lower, |a, b| [0.0, 0.0, -q * (b[2] - a[2]).abs()]);
    edge_load(&mut loads, &upper, |a, b| [0.0, 0.0, q * (b[2] - a[2]).abs()]);
    input.nodal_loads = loads_into(loads);
    let result = solve(input).expect("LE5 rekent");
    let a = id(0, n_x / 4);
    let sigma_a = node_value(&result, 1, a).values.nxx_kn_per_m / t / 1000.0;
    // Evenwicht: het moment van de reacties om de x-as is −1,2 MNm (= −1200 kNm).
    let coordinates: BTreeMap<usize, [f64; 2]> = (0..m).map(|s| (id(s, 0), chain[s])).collect();
    let mx: f64 = result.reactions.iter()
        .map(|r| { let [y, z] = coordinates[&r.node_id]; r.mx + y * r.fz - z * r.fy })
        .sum();
    assert!((mx + 1200.0).abs() < 1e-6 * 1200.0, "Σ Mx reactie = {mx}");
    sigma_a
}

#[test]
fn nafems_le5_z_section_cantilever() {
    const TARGET: f64 = -108.0; // MPa, TNSB LE5; ESRD-gids blz. 15
    // Tolerantie 5 %: het doel komt uit een dunwandig model; schaalmodellen met verbonden wanden
    // landen enkele procenten verder (Abaqus S4 −110,4; OptiStruct Quad4 −112,2; Dlubal −108,9).
    const TOLERANCE: f64 = 0.05;
    println!("NAFEMS LE5 — σxx middenvlak in A (doel {TARGET} MPa)");
    println!("  net (lengte×flens) | σxx A (MPa) | afwijking");
    let mut last = 0.0;
    for (nx, nf) in [(8, 2), (16, 4), (32, 8), (64, 16), (128, 32)] {
        let sigma = le5(nx, nf);
        println!("  {nx:>3}×{nf:<3}            | {sigma:>9.3}   | {:+6.2} %", 100.0 * deviation(sigma, TARGET));
        last = sigma;
    }
    assert!(deviation(last, TARGET).abs() < TOLERANCE, "LE5: σxx = {last:.3} MPa, doel {TARGET}");
}

// ── LE6: scheve plaat onder druk ─────────────────────────────────────────────

/// LE6 (TNSB Rev. 3; ESRD-gids blz. 19; Abaqus Benchmarks Guide §4.2.6): ruitvormige plaat met
/// zijden 1 m en scheefheid 30° (hoeken A (0; 0), B (1; 0), C (1 + cos 30°; sin 30°),
/// D (cos 30°; sin 30°)), dikte 0,01 m, E = 210 GPa, ν = 0,3, druk 0,7 kPa (−z). Alle randen
/// u_z = 0 (rotaties vrij), u_x = u_y = 0 in A, u_y = 0 in B. Doel: grootste hoofdspanning aan
/// de onderzijde in het plaatmidden E: 0,802 MPa (Kirchhoff-oplossing).
///
/// Net: n×n parallellogrammen, gelijkmatig of met cosinusverdichting naar de randen (de stompe
/// hoeken B en D zijn singulier). Gemeten: knoopwaarde in E (binnenknoop, gemiddelde van de vier
/// hoekwaarden).
fn le6(n: usize, graded: bool) -> f64 {
    assert!(n % 2 == 0);
    let skew = [30f64.to_radians().cos(), 30f64.to_radians().sin()];
    let g = |k: usize| if graded {
        0.5 * (1.0 - (std::f64::consts::PI * k as f64 / n as f64).cos())
    } else {
        k as f64 / n as f64
    };
    let id = |i: usize, j: usize| 1 + j * (n + 1) + i;
    let mut nodes = Vec::new();
    for j in 0..=n {
        for i in 0..=n {
            nodes.push(Node3D { id: id(i, j), x: g(i) + skew[0] * g(j), y: skew[1] * g(j), z: 0.0 });
        }
    }
    let mut input = request(nodes, 210_000.0, 0.3);
    input.plates.push(Plate3D { id: 1, material_id: 1, thickness_m: 0.01, bedding: None, orthotropy: None });
    for j in 0..n {
        for i in 0..n {
            input.shell_elements.push(ShellElement3D {
                id: input.shell_elements.len() + 1,
                plate_id: 1,
                node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
            });
        }
    }
    let mut supports = BTreeMap::new();
    for k in 0..=n {
        for node in [id(k, 0), id(k, n), id(0, k), id(n, k)] {
            fix(&mut supports, node, [false, false, true, false, false, false]);
        }
    }
    fix(&mut supports, id(0, 0), [true, true, false, false, false, false]); // A
    fix(&mut supports, id(n, 0), [false, true, false, false, false, false]); // B
    input.supports = supports_into(supports);
    input.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -0.7 });
    let result = solve(input).expect("LE6 rekent");
    let e = node_value(&result, 1, id(n / 2, n / 2));
    let v = &e.values;
    // Evenwicht: Σ Rz = q·A met A = sin 30° m².
    let rz: f64 = result.reactions.iter().map(|r| r.fz).sum();
    assert!((rz - 0.7 * 0.5).abs() < 1e-9, "Σ Rz = {rz}");
    principal_max(v.sigma_xx_bottom_mpa, v.sigma_yy_bottom_mpa, v.tau_xy_bottom_mpa)
}

#[test]
fn nafems_le6_skew_plate() {
    const TARGET: f64 = 0.802; // MPa, TNSB LE6 (Kirchhoff); ESRD-gids blz. 19
    // Tolerantie 5 %: het doel is een dunne-plaatwaarde; een afschuifvervormbaar element
    // convergeert bij t = 10 mm naar ≈ 0,820 MPa (+2,2 %, ESRD dunne-volumemodel blz. 20).
    const TOLERANCE: f64 = 0.05;
    println!("NAFEMS LE6 — σ1 onderzijde in E (doel {TARGET} MPa)");
    println!("  net     | gelijkmatig (MPa) | afwijking | verdicht (MPa) | afwijking");
    let mut last = 0.0;
    for n in [4, 8, 16, 32, 64] {
        let uniform = le6(n, false);
        let graded = le6(n, true);
        println!(
            "  {n:>2}×{n:<2}   | {uniform:.4}            | {:+6.2} %  | {graded:.4}         | {:+6.2} %",
            100.0 * deviation(uniform, TARGET), 100.0 * deviation(graded, TARGET),
        );
        last = graded;
    }
    assert!(deviation(last, TARGET).abs() < TOLERANCE, "LE6: σ1 = {last:.4} MPa, doel {TARGET}");
}

// ── Drie wegen naar de kern (LE1, net 24×12) ─────────────────────────────────

/// Het LE1-verzoek staat als JSON in `docs/verificatie/nafems/` zodat iedereen het kan herhalen
/// en `design-mockup/test-nafems-3d.mjs` het door de andere twee wegen kan sturen: de
/// stdin/stdout-kern `open-fem-3d` (browserroute `/api/openFem3d/solve`) en de MCP-tool
/// `solve_open_fem_3d`. Het Tauri-commando `solve_open_fem_3d` roept `open_fem_3d::solve` aan,
/// precies wat deze test doet. De verwachte waarde in `le1-membraan-24x12.verwacht.json` is de
/// uitkomst van deze route; de JS-test eist dat de andere wegen hem tot op 1e-9 herhalen.
/// Opnieuw schrijven (alleen na een verantwoorde wijziging van invoer of kern):
/// `NAFEMS_SCHRIJF=1 cargo test -p open-fem-3d --release --test nafems le1_request_file`.
#[test]
fn nafems_le1_request_file_three_routes() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs/verificatie/nafems");
    let request_path = dir.join("le1-membraan-24x12.request.json");
    let expected_path = dir.join("le1-membraan-24x12.verwacht.json");
    let built = le1_request(24, 12);
    let (sigma, _) = le1_sigma_d(&solve(built.clone()).expect("LE1 rekent"));
    if std::env::var_os("NAFEMS_SCHRIJF").is_some() {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&request_path, serde_json::to_string(&built).unwrap() + "\n").unwrap();
        let expected = serde_json::json!({
            "benchmark": "NAFEMS LE1",
            "meetpunt": "knoop 1 = D (2; 0), plaat 1, sigma_yy = nyyKnPerM / 0,1 m / 1000",
            "doelMpa": 92.7,
            "sigmaYyDMpa": sigma,
        });
        std::fs::write(&expected_path, serde_json::to_string_pretty(&expected).unwrap() + "\n").unwrap();
    }
    let text = std::fs::read_to_string(&request_path).expect("verzoekbestand");
    let from_file: SolveRequest3D = serde_json::from_str(&text).expect("geldig verzoek");
    assert_eq!(
        serde_json::to_value(&from_file).unwrap(), serde_json::to_value(&built).unwrap(),
        "het verzoekbestand hoort bij de LE1-opbouw in deze test",
    );
    let (from_file_sigma, _) = le1_sigma_d(&solve(from_file).expect("LE1 uit bestand rekent"));
    let expected: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&expected_path).unwrap()).unwrap();
    let recorded = expected["sigmaYyDMpa"].as_f64().unwrap();
    println!("LE1 24×12 via open_fem_3d::solve (Tauri-weg): σyy D = {from_file_sigma:.6} MPa (vastgelegd {recorded:.6})");
    assert!((from_file_sigma - recorded).abs() < 1e-9 * recorded.abs());
    assert!((sigma - recorded).abs() < 1e-9 * recorded.abs());
    assert!(deviation(from_file_sigma, 92.7).abs() < 0.03);
}
