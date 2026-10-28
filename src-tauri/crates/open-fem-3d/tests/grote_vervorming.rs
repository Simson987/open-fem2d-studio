//! Issue #244, punt 054: een waarschuwing bij een uitkomst buiten de
//! kleine-verplaatsingentheorie. De grenzen (0,05 rad, L/50) zijn het voorstel
//! uit de controle, geen normeis.
//!
//! Uitkraging L = 3 m, ingeklemd, EI = 210·10⁶ kN/m² · 8·10⁻⁶ m⁴ = 1680 kNm²,
//! puntlast P aan het vrije eind. Met de hand:
//!   θ = P·L²/(2EI) = P · 9/3360   →  P = 30 kN: 0,08036 rad (> 0,05)
//!   w = P·L³/(3EI) = P · 27/5040  →  P = 30 kN: 160,7 mm = L/18,7 (> L/50 = 60 mm)
//!   P = 5 kN: θ = 0,01339 rad, w = 26,8 mm — geen waarschuwing.

use open_fem_3d::{
    solve, AnalysisKind, Material3D, Member3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D, Support3D,
};

fn uitkraging(p: f64) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear,
        nodes: vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 3.0, y: 0.0, z: 0.0 }],
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![Section3D { id: 1, name: "proef".into(), area_m2: 0.01, iy_m4: 8e-6, iz_m4: 8e-6,
            torsion_j_m4: 5e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
        members: vec![Member3D {
            id: 1, start_node_id: 1, end_node_id: 2, material_id: 1, section_id: 1,
            releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![],
            tension_only: false, bedding: None, part_section_ids: None,
        }],
        supports: vec![Support3D { node_id: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }],
        nodal_loads: vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: -p, mx: 0.0, my: 0.0, mz: 0.0 }],
        member_loads: vec![], member_point_loads: vec![], thermal_loads: vec![], plates: vec![],
        shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None,
        tension_only_cross_rule: false, max_iterations: 100, tolerance: 1e-10, buckling_modes: 0,
    }
}

#[test]
fn grote_draaiing_en_zakking_geven_een_waarschuwing() {
    let r = solve(uitkraging(30.0)).expect("oplosbaar");
    let d = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
    let theta = (d.ry * d.ry + d.rz * d.rz).sqrt();
    assert!((theta - 30.0 * 9.0 / 3360.0).abs() < 1e-9, "θ = {theta}");
    assert!((d.uz.abs() - 30.0 * 27.0 / 5040.0).abs() < 1e-9, "w = {}", d.uz);
    let w = r.diagnostics.iter().find(|m| m.starts_with("WAARSCHUWING grote vervorming"))
        .unwrap_or_else(|| panic!("geen waarschuwing: {:?}", r.diagnostics));
    assert!(w.contains("0.0804 rad") && w.contains("knoop 2"), "{w}");
    assert!(w.contains("160.7 mm") && w.contains("L/19"), "{w}");
    assert!(w.contains("geen normeis"), "{w}");
}

#[test]
fn kleine_vervorming_geeft_geen_waarschuwing() {
    let r = solve(uitkraging(5.0)).expect("oplosbaar");
    assert!(
        !r.diagnostics.iter().any(|m| m.contains("grote vervorming")),
        "{:?}",
        r.diagnostics
    );
}
