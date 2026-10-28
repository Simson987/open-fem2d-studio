//! Orthotrope platen (#79, #97): analytische verificatie.
//!
//! * De algemene MITC4-stijfheid met isotrope matrices is de bron.
//! * Trekstrook (vlakke spanning, orthotroop): ε_x = σ_x/E_x, ε_y = −ν_xy·σ_x/E_x;
//!   in de andere richting ε_y = σ_y/E_y, ε_x = −ν_yx·σ_y/E_y met ν_yx = ν_xy·E_y/E_x
//!   (Reddy, Mechanics of Laminated Composite Plates and Shells, §3.3). Een
//!   homogene spanningstoestand is exact voor bilineaire elementen.
//! * Schuifpaneel met verhinderde verticale verplaatsing: u_x = γ·z, γ = τ/G,
//!   δ = V·H/(G·L·t), ook met E_x ≈ 0.
//! * Metselwerkwand (E_x ≈ 0) op een vrij opgelegde funderingsbalk: de wand
//!   werkt niet mee, de balk krijgt M = q·L²/8 (besluit in #97).
//!
//! De elementen krijgen bewust wisselende knoopvolgordes (de eigen elementas
//! van de kern ligt langs rand 0→1, ook tegen de plaat-x in, en een omgekeerde
//! omloop spiegelt het element): de draaiing naar de elementassen moet dat
//! opvangen.

use open_fem_3d::{
    solve, AnalysisKind, Material3D, Member3D, NodalLoad3D, Node3D, Plate3D, PlateOrthotropy3D, Section3D,
    ShellElement3D, SolveRequest3D, SolveResult3D, Support3D,
};
use rekenkern::element::quad::{mitc4_local_stiffness, mitc4_local_stiffness_general};
use rekenkern::types::QuadConstitutive;

struct Grid { nx: usize, first_id: usize }
impl Grid {
    fn id(&self, i: usize, j: usize) -> usize { self.first_id + j * (self.nx + 1) + i }
}

/// Verticaal net in het XZ-vlak (y = 0): knoop (i, j) op x = i·a/nx, z = j·b/ny.
fn wall_grid(nx: usize, ny: usize, a: f64, b: f64, nodes: &mut Vec<Node3D>) -> Grid {
    let first_id = nodes.iter().map(|n| n.id).max().unwrap_or(0) + 1;
    let grid = Grid { nx, first_id };
    for j in 0..=ny {
        for i in 0..=nx {
            nodes.push(Node3D { id: grid.id(i, j), x: a * i as f64 / nx as f64, y: 0.0, z: b * j as f64 / ny as f64 });
        }
    }
    grid
}

/// Vierhoeken met per element een andere startknoop en (om en om) omloop.
fn mixed_quads(grid: &Grid, nx: usize, ny: usize, plate_id: usize) -> Vec<ShellElement3D> {
    let mut out = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            let mut ids = vec![grid.id(i, j), grid.id(i + 1, j), grid.id(i + 1, j + 1), grid.id(i, j + 1)];
            let k = i + 2 * j;
            ids.rotate_left(k % 4);
            if k % 3 == 1 { ids.reverse(); }
            out.push(ShellElement3D { id: out.len() + 1, plate_id, node_ids: ids });
        }
    }
    out
}

fn ortho(e_x: f64, e_y: f64, g: f64, nu_xy: f64) -> PlateOrthotropy3D {
    PlateOrthotropy3D { e_x_mpa: e_x, e_y_mpa: e_y, g_xy_mpa: g, nu_xy, g_xz_mpa: None, g_yz_mpa: None }
}

fn request(nodes: Vec<Node3D>, thickness: f64, orthotropy: PlateOrthotropy3D, elements: Vec<ShellElement3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2,
        analysis: AnalysisKind::Linear,
        nodes,
        // Het materiaal blijft verplicht; de orthotrope stijfheid vervangt E en ν.
        materials: vec![Material3D { id: 1, name: "wand".into(), e_mpa: 1.0, nu: 0.0, g_mpa: None, alpha_per_k: None }],
        sections: vec![],
        members: vec![],
        supports: vec![],
        nodal_loads: vec![],
        member_loads: vec![],
        member_point_loads: vec![],
        thermal_loads: vec![],
        plates: vec![Plate3D { id: 1, material_id: 1, thickness_m: thickness, bedding: None, orthotropy: Some(orthotropy) }],
        shell_elements: elements,
        surface_loads: vec![],
        diaphragms: vec![], node_links: vec![],
        tension_only_fit: None,
        tension_only_cross_rule: false,
        max_iterations: 50,
        tolerance: 1e-10,
        buckling_modes: 0,
    }
}

fn support(supports: &mut Vec<Support3D>, node_id: usize, fixed: [bool; 6]) {
    if let Some(s) = supports.iter_mut().find(|s| s.node_id == node_id) {
        s.ux |= fixed[0]; s.uy |= fixed[1]; s.uz |= fixed[2]; s.rx |= fixed[3]; s.ry |= fixed[4]; s.rz |= fixed[5];
    } else {
        supports.push(Support3D {
            node_id, ux: fixed[0], uy: fixed[1], uz: fixed[2], rx: fixed[3], ry: fixed[4], rz: fixed[5],
            ..Default::default()
        });
    }
}

fn load(id: usize, node_id: usize, fx: f64, fz: f64) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx, fy: 0.0, fz, mx: 0.0, my: 0.0, mz: 0.0 }
}

fn disp(result: &SolveResult3D, node_id: usize) -> [f64; 3] {
    let d = result.displacements.iter().find(|d| d.node_id == node_id).unwrap();
    [d.ux, d.uy, d.uz]
}

fn relative(actual: f64, expected: f64) -> f64 { (actual - expected).abs() / expected.abs() }

#[test]
fn algemene_mitc4_met_isotrope_matrices_is_de_bron() {
    // Scheve, niet-rechthoekige vierhoek buiten de coördinaatvlakken.
    let coords: [[f64; 3]; 4] = [[0.1, 0.0, 0.05], [1.3, 0.2, 0.25], [1.1, 0.9, 0.5], [-0.1, 1.0, 0.3]];
    // Vlak maken: projecteer op het vlak door de eerste drie knopen.
    let n = {
        let a = [coords[1][0] - coords[0][0], coords[1][1] - coords[0][1], coords[1][2] - coords[0][2]];
        let b = [coords[2][0] - coords[0][0], coords[2][1] - coords[0][1], coords[2][2] - coords[0][2]];
        let c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        let l = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
        [c[0] / l, c[1] / l, c[2] / l]
    };
    let mut coords = coords;
    let d = (0..3).map(|k| (coords[3][k] - coords[0][k]) * n[k]).sum::<f64>();
    for k in 0..3 { coords[3][k] -= d * n[k]; }
    let (e, nu, t) = (30.0e6, 0.2, 0.2);
    let source = mitc4_local_stiffness(&coords, e, nu, t);
    let f = e * t / (1.0 - nu * nu);
    let fb = e * t * t * t / (12.0 * (1.0 - nu * nu));
    let ds = 5.0 / 6.0 * e / (2.0 * (1.0 + nu)) * t;
    let general = mitc4_local_stiffness_general(&coords, &QuadConstitutive {
        membrane: [f, f * nu, 0.0, f * nu, f, 0.0, 0.0, 0.0, f * (1.0 - nu) / 2.0],
        bending: [fb, fb * nu, 0.0, fb * nu, fb, 0.0, 0.0, 0.0, fb * (1.0 - nu) / 2.0],
        shear: [ds, 0.0, 0.0, ds],
        drilling: f * (1.0 - nu) / 2.0,
    });
    let scale = source.iter().fold(0.0_f64, |m, v| m.max(v.abs()));
    let diff = source.iter().zip(&general).fold(0.0_f64, |m, (a, b)| m.max((a - b).abs()));
    println!("max |K_algemeen − K_bron| / max |K| = {:.3e}", diff / scale);
    assert!(diff / scale < 1e-12);
}

/// Wand L×B in het XZ-vlak, alleen membraan (uit het vlak en de rotaties vast).
fn membrane_wall(nx: usize, ny: usize, l: f64, b: f64, t: f64, o: PlateOrthotropy3D) -> (SolveRequest3D, Grid) {
    let mut nodes = Vec::new();
    let g = wall_grid(nx, ny, l, b, &mut nodes);
    let elements = mixed_quads(&g, nx, ny, 1);
    let mut input = request(nodes, t, o, elements);
    for j in 0..=ny {
        for i in 0..=nx {
            support(&mut input.supports, g.id(i, j), [false, true, false, true, true, true]);
        }
    }
    (input, g)
}

#[test]
fn trekstrook_volgt_e_x_en_e_y_met_dwarscontractie() {
    let (e_x, e_y, g, nu_xy) = (3000.0, 8000.0, 1200.0, 0.15);
    let nu_yx = nu_xy * e_y / e_x;
    let (nx, ny, l, b, t, force) = (4, 2, 2.0, 1.0, 0.1, 100.0);

    // Trek in x: linkerrand u_x = 0, linksonder ook u_z = 0; rechterrand F.
    let (mut input, grid) = membrane_wall(nx, ny, l, b, t, ortho(e_x, e_y, g, nu_xy));
    for j in 0..=ny { support(&mut input.supports, grid.id(0, j), [true, false, false, false, false, false]); }
    support(&mut input.supports, grid.id(0, 0), [false, false, true, false, false, false]);
    for j in 0..=ny {
        let share = if j == 0 || j == ny { 0.5 } else { 1.0 } / ny as f64;
        input.nodal_loads.push(load(j + 1, grid.id(nx, j), force * share, 0.0));
    }
    let result = solve(input).unwrap();
    let sigma = force / (b * t) * 1e-3; // MPa
    let ux = sigma * l / e_x;
    let dz = -nu_xy * sigma / e_x * b;
    for j in 0..=ny {
        let d = disp(&result, grid.id(nx, j));
        println!("trek x: u_x = {:.6e} m (verwacht {ux:.6e})", d[0]);
        assert!(relative(d[0], ux) < 1e-9);
    }
    let contraction = disp(&result, grid.id(0, ny))[2] - disp(&result, grid.id(0, 0))[2];
    println!("trek x: Δz = {contraction:.6e} m (verwacht {dz:.6e})");
    assert!(relative(contraction, dz) < 1e-9);
    for node in &result.shell_nodes {
        assert!(relative(node.values.nxx_kn_per_m, force / b) < 1e-9, "nxx {}", node.values.nxx_kn_per_m);
        assert!(node.values.nyy_kn_per_m.abs() < 1e-8 && node.values.nxy_kn_per_m.abs() < 1e-8);
    }

    // Trek in y (verticaal): onderrand u_z = 0, linksonder u_x = 0; bovenrand F.
    let (mut input, grid) = membrane_wall(nx, ny, l, b, t, ortho(e_x, e_y, g, nu_xy));
    for i in 0..=nx { support(&mut input.supports, grid.id(i, 0), [false, false, true, false, false, false]); }
    support(&mut input.supports, grid.id(0, 0), [true, false, false, false, false, false]);
    for i in 0..=nx {
        let share = if i == 0 || i == nx { 0.5 } else { 1.0 } / nx as f64;
        input.nodal_loads.push(load(i + 1, grid.id(i, ny), 0.0, force * share));
    }
    let result = solve(input).unwrap();
    let sigma = force / (l * t) * 1e-3;
    let uz = sigma * b / e_y;
    let dx = -nu_yx * sigma / e_y * l;
    for i in 0..=nx {
        let d = disp(&result, grid.id(i, ny));
        assert!(relative(d[2], uz) < 1e-9, "u_z {} tegen {uz}", d[2]);
    }
    let contraction = disp(&result, grid.id(nx, 0))[0] - disp(&result, grid.id(0, 0))[0];
    println!("trek y: u_z = {:.6e} (verwacht {uz:.6e}), Δx = {contraction:.6e} (verwacht {dx:.6e})",
        disp(&result, grid.id(0, ny))[2]);
    assert!(relative(contraction, dx) < 1e-9);
    for node in &result.shell_nodes {
        assert!(relative(node.values.nyy_kn_per_m, force / l) < 1e-9);
    }
}

#[test]
fn schuifpaneel_volgt_g_ook_zonder_horizontale_stijfheid() {
    // Metselwerkachtig: E_x = E_y/1000, G = 0,4·E_y. Verticale verplaatsing
    // overal verhinderd, onderrand vast, bovenrand V: δ = V·H/(G·L·t).
    let (e_y, nu_xy) = (5000.0, 0.0);
    let (e_x, g) = (e_y / 1000.0, 0.4 * e_y);
    let (nx, ny, l, h, t, v) = (4, 4, 2.0, 2.5, 0.1, 50.0);
    let (mut input, grid) = membrane_wall(nx, ny, l, h, t, ortho(e_x, e_y, g, nu_xy));
    for j in 0..=ny {
        for i in 0..=nx {
            support(&mut input.supports, grid.id(i, j), [j == 0, false, true, false, false, false]);
        }
    }
    for i in 0..=nx {
        let share = if i == 0 || i == nx { 0.5 } else { 1.0 } / nx as f64;
        input.nodal_loads.push(load(i + 1, grid.id(i, ny), v * share, 0.0));
    }
    let result = solve(input).unwrap();
    let expected = v * h / (g * 1000.0 * l * t);
    for i in 0..=nx {
        let d = disp(&result, grid.id(i, ny));
        println!("schuifpaneel: δ = {:.6e} m (verwacht {expected:.6e})", d[0]);
        assert!(relative(d[0], expected) < 1e-9);
    }
    for node in &result.shell_nodes {
        assert!(relative(node.values.nxy_kn_per_m, v / l) < 1e-9, "nxy {}", node.values.nxy_kn_per_m);
    }
}

/// Wand 6 × 2,5 m op een vrij opgelegde funderingsbalk, lijnlast q bovenop.
fn wall_on_beam(e_x: f64, e_y: f64, g: f64) -> f64 {
    let (nx, ny, l, h, t, q) = (24, 10, 6.0, 2.5, 0.1, 10.0);
    let mut nodes = Vec::new();
    let grid = wall_grid(nx, ny, l, h, &mut nodes);
    let elements = mixed_quads(&grid, nx, ny, 1);
    let mut input = request(nodes, t, ortho(e_x, e_y, g, 0.0), elements);
    input.materials.push(Material3D { id: 2, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None });
    let i_beam = 1.0e-4;
    input.sections.push(Section3D {
        id: 1, name: "balk".into(), area_m2: 0.01, iy_m4: i_beam, iz_m4: i_beam, torsion_j_m4: 1e-5,
        shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None,
    });
    input.members.push(Member3D {
        id: 1, start_node_id: grid.id(0, 0), end_node_id: grid.id(nx, 0), material_id: 2, section_id: 1,
        releases: Default::default(), roll_angle_rad: None,
        intermediate_node_ids: (1..nx).map(|i| grid.id(i, 0)).collect(), tension_only: false,
        bedding: None, part_section_ids: None,
    });
    // Alles in het XZ-vlak: uit het vlak (u_y) en de rotaties om X en Z vast.
    for j in 0..=ny {
        for i in 0..=nx {
            support(&mut input.supports, grid.id(i, j), [false, true, false, true, false, true]);
        }
    }
    support(&mut input.supports, grid.id(0, 0), [true, false, true, false, false, false]);
    support(&mut input.supports, grid.id(nx, 0), [false, false, true, false, false, false]);
    for i in 0..=nx {
        let share = if i == 0 || i == nx { 0.5 } else { 1.0 } * l / nx as f64;
        input.nodal_loads.push(load(i + 1, grid.id(i, ny), 0.0, -q * share));
    }
    let result = solve(input).unwrap();
    let reaction: f64 = result.reactions.iter().map(|r| r.fz).sum();
    assert!(relative(reaction, q * l) < 1e-9);
    result.diagrams.moment_y.iter().chain(&result.diagrams.moment_z)
        .filter(|d| d.member_id == 1).map(|d| d.max_abs_value).fold(0.0, f64::max)
}

#[test]
fn metselwerkwand_werkt_niet_mee_met_de_funderingsbalk() {
    let (q, l) = (10.0, 6.0);
    let expected = q * l * l / 8.0;
    let e_y = 5000.0;
    let masonry = wall_on_beam(e_y * 1e-6, e_y, 0.4 * e_y);
    println!("metselwerkwand (E_x = 1e-6·E_y): M_balk = {masonry:.3} kNm, q·L²/8 = {expected:.3} kNm");
    assert!(relative(masonry, expected) < 0.01, "M_balk {masonry} tegen {expected}");
    // Ter vergelijking: een isotrope wand werkt als hoge ligger mee en
    // ontlast de balk grotendeels; precies wat #97 níet wil.
    let isotropic = wall_on_beam(e_y, e_y, e_y / 2.0);
    println!("isotrope wand: M_balk = {isotropic:.3} kNm");
    assert!(isotropic < 0.5 * expected);
}

#[test]
fn knoopkoppeling_draagt_alleen_de_gekoppelde_richtingen() {
    use open_fem_3d::NodeLink3D;
    // Knoop 2 ligt overal vast; knoop 3 ligt op dezelfde plek en volgt hem
    // alleen in Z. Staaf 3→4 (langs X, 2 m) met knoop 4 vast in X, Y, Z en om X.
    // F_z op knoop 3 gaat via de koppeling naar knoop 2, F_x via de staaf naar knoop 4.
    let mut input = request(
        vec![Node3D { id: 2, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 3, x: 0.0, y: 0.0, z: 0.0 },
             Node3D { id: 4, x: 2.0, y: 0.0, z: 0.0 }],
        0.1, ortho(1.0, 1.0, 1.0, 0.0), vec![]);
    input.plates.clear();
    input.materials[0].e_mpa = 210_000.0;
    input.sections.push(Section3D {
        id: 1, name: "s".into(), area_m2: 0.01, iy_m4: 1e-5, iz_m4: 1e-5, torsion_j_m4: 1e-6,
        shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None,
    });
    input.members.push(Member3D {
        id: 1, start_node_id: 3, end_node_id: 4, material_id: 1, section_id: 1,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
        bedding: None, part_section_ids: None,
    });
    support(&mut input.supports, 2, [true; 6]);
    support(&mut input.supports, 4, [true, true, true, true, false, false]);
    let link = NodeLink3D { id: 1, master_node_id: 2, slave_node_id: 3, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false };
    input.node_links.push(link.clone());
    input.nodal_loads.push(load(1, 3, 5.0, -7.0));
    let result = solve(input.clone()).unwrap();
    let reaction = |id: usize| result.reactions.iter().find(|r| r.node_id == id).unwrap().clone();
    let (r2, r4) = (reaction(2), reaction(4));
    println!("koppeling: R2 = ({:.6}, {:.6}) kN, R4 = ({:.6}, {:.6}) kN", r2.fx, r2.fz, r4.fx, r4.fz);
    assert!(r2.fx.abs() < 1e-9 && (r4.fx + 5.0).abs() < 1e-9, "F_x hoort naar knoop 4");
    // F_z: knoop 3 hangt in Z aan knoop 2 (star), dus de staaf buigt niet.
    assert!((r2.fz - 7.0).abs() < 1e-9 && r4.fz.abs() < 1e-9, "F_z hoort naar knoop 2");

    let mut verkeerd = input.clone();
    verkeerd.nodes[1].x = 0.01;
    assert!(solve(verkeerd).unwrap_err().contains("uit elkaar"));
    let mut opgelegd = input.clone();
    support(&mut opgelegd.supports, 3, [false, false, true, false, false, false]);
    assert!(solve(opgelegd).unwrap_err().contains("opgelegd"));
    let mut leeg = input;
    leeg.node_links[0].uz = false;
    assert!(solve(leeg).unwrap_err().contains("geen enkele"));
}
