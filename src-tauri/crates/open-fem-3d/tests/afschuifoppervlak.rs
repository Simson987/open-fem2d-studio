//! Afschuifoppervlakken van een doorsnede (`shearAreaYM2`, `shearAreaZM2`,
//! issue #197): de adapter keurt een waarde die niet eindig of niet positief
//! is af, zodat ook de MCP-weg (die het verzoek rechtstreeks doorgeeft) geen
//! Timoshenko-staaf met Av = 0 of NaN aan de kern geeft.
//!
//! En een geldige waarde rekent mee: een uitkraging L = 2 m met een
//! puntlast P = 10 kN aan het eind zakt met de buiging én de afschuiving,
//! w = P·L³/(3·E·I) + P·L/(G·Av), met G = E/(2(1+ν)).
//!
//! Eenheden: m, kN; E = 210 000 MPa = 2,1·10⁸ kN/m², ν = 0,3.

use open_fem_3d::{
    solve, AnalysisKind, Material3D, Member3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D, Support3D,
};

const L: f64 = 2.0;
const P: f64 = 10.0;
const I: f64 = 8e-6;
const E_KN: f64 = 210_000.0 * 1000.0;

fn verzoek(av_y: Option<f64>, av_z: Option<f64>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2,
        analysis: AnalysisKind::Linear,
        nodes: vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: L, y: 0.0, z: 0.0 }],
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![Section3D {
            id: 1, name: "proef".into(), area_m2: 0.01, iy_m4: I, iz_m4: I, torsion_j_m4: 5e-6,
            shear_area_y_m2: av_y, shear_area_z_m2: av_z, height_m: None, width_m: None,
        }],
        members: vec![Member3D {
            id: 1, start_node_id: 1, end_node_id: 2, material_id: 1, section_id: 1,
            releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
            bedding: None, part_section_ids: None,
        }],
        supports: vec![Support3D { node_id: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }],
        nodal_loads: vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: -P, mx: 0.0, my: 0.0, mz: 0.0 }],
        member_loads: vec![], member_point_loads: vec![], thermal_loads: vec![], plates: vec![], shell_elements: vec![],
        surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

#[test]
fn ongeldige_afschuifoppervlakken_worden_geweigerd() {
    for (naam, y, z) in [
        ("Av,y = 0", Some(0.0), Some(1e-3)),
        ("Av,z = 0", Some(1e-3), Some(0.0)),
        ("Av,y < 0", Some(-1e-3), Some(1e-3)),
        ("Av,z NaN", Some(1e-3), Some(f64::NAN)),
        ("Av,y oneindig", Some(f64::INFINITY), Some(1e-3)),
    ] {
        let fout = solve(verzoek(y, z)).err().unwrap_or_else(|| panic!("{naam}: geaccepteerd"));
        assert!(fout.contains("doorsnede 1") && fout.contains("Av"), "{naam}: {fout}");
        println!("{naam}: {fout}");
    }
}

#[test]
fn zonder_afschuifoppervlak_euler_bernoulli() {
    let uit = solve(verzoek(None, None)).expect("zonder Av rekent de staaf als Euler-Bernoulli");
    let w = uit.displacements.iter().find(|d| d.node_id == 2).unwrap().uz;
    let hand = P * L.powi(3) / (3.0 * E_KN * I);
    println!("Euler-Bernoulli: w = {:.6e} m, hand {hand:.6e} m", -w);
    assert!((-w - hand).abs() <= 1e-9 * hand.max(1.0) + 1e-12, "w {w} tegen {hand}");
}

#[test]
fn geldig_afschuifoppervlak_telt_mee_in_de_zakking() {
    let av = 1e-3;
    let uit = solve(verzoek(Some(av), Some(av))).expect("een geldige Av wordt geaccepteerd");
    let w = uit.displacements.iter().find(|d| d.node_id == 2).unwrap().uz;
    let g = E_KN / (2.0 * 1.3);
    let buiging = P * L.powi(3) / (3.0 * E_KN * I);
    let afschuiving = P * L / (g * av);
    let hand = buiging + afschuiving;
    println!("Timoshenko: w = {:.6e} m, hand {hand:.6e} m (buiging {buiging:.6e}, afschuiving {afschuiving:.6e})", -w);
    assert!((-w - hand).abs() <= 1e-6 * hand, "w {w} tegen {hand}");
}
