//! Issue #243, punt 081: een 3D-mechanisme noemt de knoop en de vrije
//! vrijheidsgraad.
//!
//! L-console (0,0,0)–(2,0,0)–(2,2,0). Staaf 1 heeft de torsie aan het eind
//! (knoop 2) vrijgegeven, knoop 1 is ingeklemd, F_z = −1 kN op knoop 3.
//! Staaf 2 kan dan als star lichaam om de as van staaf 1 (globale x door
//! knoop 2) draaien: knoop 2 en 3 draaien om x, knoop 3 zakt w = 2·θ_x.
//! Niets in het model houdt dat tegen; de enige oorzaak is de vrijgegeven
//! torsie van staaf 1 aan knoop 2. Tot oktober 2026 meldde de berekening
//! alleen een te groot residu met algemene adviezen.

use open_fem_3d::{
    solve, AnalysisKind, EndReleases3D, Material3D, Member3D, NodalLoad3D, Node3D, Section3D,
    SolveRequest3D, Support3D,
};

fn staaf(id: usize, begin: usize, eind: usize, releases: EndReleases3D) -> Member3D {
    Member3D {
        id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: 1,
        releases, roll_angle_rad: None, intermediate_node_ids: vec![],
        tension_only: false, bedding: None, part_section_ids: None,
    }
}

fn verzoek() -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear,
        nodes: vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 },
            Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 2.0, y: 2.0, z: 0.0 },
        ],
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![Section3D { id: 1, name: "proef".into(), area_m2: 0.01, iy_m4: 8e-6, iz_m4: 12e-6,
            torsion_j_m4: 5e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
        members: vec![
            staaf(1, 1, 2, EndReleases3D { torsion_end: true, ..Default::default() }),
            staaf(2, 2, 3, Default::default()),
        ],
        supports: vec![Support3D { node_id: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }],
        nodal_loads: vec![NodalLoad3D { id: 1, node_id: 3, fx: 0.0, fy: 0.0, fz: -1.0, mx: 0.0, my: 0.0, mz: 0.0 }],
        member_loads: vec![], member_point_loads: vec![], thermal_loads: vec![], plates: vec![],
        shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None,
        tension_only_cross_rule: false, max_iterations: 100, tolerance: 1e-10, buckling_modes: 0,
    }
}

#[test]
fn torsie_vrij_noemt_knoop_2_en_de_rotatie_om_de_staafas() {
    let fout = solve(verzoek()).expect_err("een mechanisme hoort geweigerd te worden");
    eprintln!("{fout}");
    assert!(fout.contains("knoop 2"), "{fout}");
    assert!(fout.contains("staaf 1") && fout.contains("torsie"), "{fout}");
    assert!(fout.contains("knoop 2 draait om de staafas van staaf 1"), "{fout}");
    assert!(fout.contains("torsionEnd"), "{fout}");
    // De kinematica: staaf 2 draait star om de x-as door knoop 2, dus knoop 3
    // draait ook om x en zakt (w = 2·θ_x).
    assert!(fout.contains("knoop 3 draait om de globale x-as en verschuift in z"), "{fout}");
}

/// Met de torsie aan knoop 2 weer star is het model gewoon oplosbaar:
/// M_x in de inklemming = F·2 m = 2 kNm (torsie in staaf 1).
#[test]
fn met_torsie_star_rekent_de_console() {
    let mut r = verzoek();
    r.members[0].releases = Default::default();
    let uit = solve(r).expect("oplosbaar");
    let reactie = uit.reactions.iter().find(|x| x.node_id == 1).expect("reactie knoop 1");
    assert!((reactie.fz - 1.0).abs() < 1e-9, "F_z {}", reactie.fz);
    assert!((reactie.mx.abs() - 2.0).abs() < 1e-9, "M_x {}", reactie.mx);
}
