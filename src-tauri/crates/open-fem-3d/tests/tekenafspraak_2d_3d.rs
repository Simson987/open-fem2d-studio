//! Issue #244, punt 053: de tekenafspraak van de 3D-kern naast die van 2D.
//!
//! Portaal: ingeklemde kolommen HEA200 (I = 36,92·10⁶ mm⁴, A = 5383 mm²) van
//! 4 m, regel IPE300 (I = 83,56·10⁶ mm⁴, A = 5381 mm²) van 6 m, H = 10 kN in
//! +X op knoop 2, in het XZ-vlak en uit het vlak vastgezet. De 2D-kern
//! (solve_fem_model) geeft voor dit portaal reactie M_y(knoop 1) = +11,028 kNm
//! (positief tegen de klok in, x rechts, z omhoog) en kolom 1 M_begin =
//! −11,028, M_eind = +9,017 kNm, V = +5,011 kN.
//!
//! De 3D-kern volgt de rechterhandregel om +Y: hetzelfde tegenwerkende
//! moment (tegen de klok in in het XZ-aanzicht) is daar NEGATIEF. Deze test
//! legt vast wat de toolbeschrijving van solve_open_fem_3d en
//! `units.teken_momenten` van solve_fem_model zeggen: zelfde absolute waarden,
//! tegengesteld teken voor M_y. Evenwicht: ΣR_x = −10 kN.

use open_fem_3d::{
    solve, AnalysisKind, Material3D, Member3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D, Support3D,
};

fn doorsnede(id: usize, i_mm4: f64, a_mm2: f64) -> Section3D {
    // In- en uit-het-vlak dezelfde I: welke lokale as in het vlak ligt, doet
    // er dan niet toe; uit het vlak is het portaal vastgezet.
    Section3D { id, name: format!("s{id}"), area_m2: a_mm2 * 1e-6, iy_m4: i_mm4 * 1e-12, iz_m4: i_mm4 * 1e-12,
        torsion_j_m4: 1e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

fn staaf(id: usize, a: usize, b: usize, s: usize) -> Member3D {
    Member3D { id, start_node_id: a, end_node_id: b, material_id: 1, section_id: s, releases: Default::default(),
        roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false, bedding: None, part_section_ids: None }
}

#[test]
fn reactiemoment_my_heeft_het_tegengestelde_teken_van_2d() {
    let vast = |id| Support3D { node_id: id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() };
    let uit_vlak = |id| Support3D { node_id: id, uy: true, rx: true, rz: true, ..Default::default() };
    let r = solve(SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear,
        nodes: vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 0.0, y: 0.0, z: 4.0 },
            Node3D { id: 3, x: 6.0, y: 0.0, z: 4.0 }, Node3D { id: 4, x: 6.0, y: 0.0, z: 0.0 },
        ],
        materials: vec![Material3D { id: 1, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![doorsnede(1, 36.92e6, 5383.0), doorsnede(2, 83.56e6, 5381.0)],
        members: vec![staaf(1, 1, 2, 1), staaf(2, 2, 3, 2), staaf(3, 4, 3, 1)],
        supports: vec![vast(1), vast(4), uit_vlak(2), uit_vlak(3)],
        nodal_loads: vec![NodalLoad3D { id: 1, node_id: 2, fx: 10.0, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.0, mz: 0.0 }],
        member_loads: vec![], member_point_loads: vec![], thermal_loads: vec![], plates: vec![],
        shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None,
        tension_only_cross_rule: false, max_iterations: 100, tolerance: 1e-10, buckling_modes: 0,
    }).expect("oplosbaar");
    let rx: f64 = r.reactions.iter().filter(|x| x.node_id == 1 || x.node_id == 4).map(|x| x.fx).sum();
    assert!((rx + 10.0).abs() < 1e-6, "ΣR_x = {rx}");
    let m1 = r.reactions.iter().find(|x| x.node_id == 1).unwrap().my;
    eprintln!("3D reactie M_y knoop 1 = {m1:.4} kNm (2D: +11,028)");
    // De 2D-waarde is +11,028 (zie de kop); 3D tegengesteld, binnen 0,1 %
    // (de controle mat 0,008 % verschil in de absolute waarden).
    assert!(m1 < 0.0, "M_y = {m1}: hoort negatief te zijn (rechterhandregel om +Y)");
    assert!((m1.abs() - 11.028).abs() < 0.011, "|M_y| = {}", m1.abs());
    // Rotatie van knoop 2: het portaal zwaait naar +X, de knoop draait met de
    // klok mee in het XZ-aanzicht = positief om +Y in 3D (2D: r_y < 0).
    let ry = r.displacements.iter().find(|d| d.node_id == 2).unwrap().ry;
    assert!(ry > 0.0, "r_y knoop 2 = {ry}");
}
