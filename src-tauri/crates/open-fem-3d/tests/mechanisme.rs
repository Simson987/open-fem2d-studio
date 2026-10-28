//! Mechanismen die de belasting niet aanstoot (#195).
//!
//! Elke berekening gaat met een proefbelasting na of de stijfheidsmatrix
//! singulier is. Stoot de belasting de vrije beweging aan, dan volgt een
//! fout; zo niet, dan een uitkomst met een melding die de beweging noemt,
//! met de kleinste verplaatsingen langs die beweging. Goed opgelegde en
//! slecht geconditioneerde maar reguliere modellen krijgen geen melding.

use open_fem_3d::{
    solve, AnalysisKind, EndReleases3D, Material3D, Member3D, MemberLoad3D, NodalLoad3D, Node3D, Plate3D,
    Section3D, ShellElement3D, SolveRequest3D, SolveResult3D, Support3D, SurfaceLoad3D, ThermalLoad3D,
};

/// E in kN/m² (210 000 MPa).
const E: f64 = 210_000_000.0;

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

fn staaf(id: usize, begin: usize, eind: usize) -> Member3D {
    Member3D {
        id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: 1,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![],
        tension_only: false, bedding: None, part_section_ids: None,
    }
}

/// De knop Scharnierend: My en Mz los aan beide einden, torsie gaat over.
fn scharnierend(mut s: Member3D) -> Member3D {
    s.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true, ..Default::default() };
    s
}

/// Scharnieroplegging: translaties vast, alle draaiingen vrij.
fn scharnier(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, ..Default::default() }
}

fn inklemming(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }
}

/// Alleen Y vast: houdt een raam in zijn vlak.
fn in_het_vlak(node_id: usize) -> Support3D {
    Support3D { node_id, uy: true, ..Default::default() }
}

fn verzoek(nodes: Vec<Node3D>, members: Vec<Member3D>, supports: Vec<Support3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: E / 1000.0, g_mpa: None, nu: 0.3, alpha_per_k: None }],
        sections: vec![Section3D { id: 1, name: "proef".into(), area_m2: 0.01, iy_m4: 8e-6, iz_m4: 12e-6,
            torsion_j_m4: 5e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
        members, supports, nodal_loads: vec![], member_loads: vec![],
        member_point_loads: vec![], thermal_loads: vec![], plates: vec![], shell_elements: vec![],
        surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 100, tolerance: 1e-10, buckling_modes: 0,
    }
}

fn last(id: usize, node_id: usize, f: [f64; 3]) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx: f[0], fy: f[1], fz: f[2], mx: 0.0, my: 0.0, mz: 0.0 }
}

fn verplaatsing(r: &SolveResult3D, id: usize) -> [f64; 6] {
    let d = r.displacements.iter().find(|x| x.node_id == id).unwrap_or_else(|| panic!("geen knoop {id}"));
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]
}

fn reactie(r: &SolveResult3D, id: usize) -> [f64; 6] {
    let x = r.reactions.iter().find(|x| x.node_id == id).unwrap_or_else(|| panic!("geen reactie in knoop {id}: {:?}", r.reactions));
    [x.fx, x.fy, x.fz, x.mx, x.my, x.mz]
}

fn mechanisme(r: &SolveResult3D) -> Option<&String> {
    r.diagnostics.iter().find(|m| m.starts_with("Mechanisme:"))
}

fn dicht(berekend: f64, verwacht: f64, tolerantie: f64, wat: &str) {
    assert!((berekend - verwacht).abs() <= tolerantie, "{wat}: {berekend:.12e} in plaats van {verwacht:.12e}");
}

/// Kracht- en momentensom (om de oorsprong) van reacties en knooplasten.
fn evenwicht(r: &SolveResult3D, request: &SolveRequest3D) -> f64 {
    let punt = |id: usize| { let k = request.nodes.iter().find(|k| k.id == id).unwrap(); [k.x, k.y, k.z] };
    let mut som = [0.0; 6];
    let mut tel = |p: [f64; 3], f: [f64; 3], m: [f64; 3]| {
        let arm = [p[1] * f[2] - p[2] * f[1], p[2] * f[0] - p[0] * f[2], p[0] * f[1] - p[1] * f[0]];
        for a in 0..3 { som[a] += f[a]; som[3 + a] += arm[a] + m[a]; }
    };
    for x in &r.reactions { tel(punt(x.node_id), [x.fx, x.fy, x.fz], [x.mx, x.my, x.mz]); }
    for x in &request.nodal_loads { tel(punt(x.node_id), [x.fx, x.fy, x.fz], [x.mx, x.my, x.mz]); }
    som.iter().map(|x| x.abs()).fold(0.0, f64::max)
}

/// Vierstangenmechanisme in het XZ-vlak: A (1) en D (4) scharnierend
/// opgelegd, drie scharnierende staven A–B, B–C en C–D; B en C buiten het
/// vlak (Y) gesteund. AB staat verticaal en CD schuin (D op x = 5), dus B
/// beweegt in X en C loodrecht op CD, in X én Z: B = (3, 0, 0)·a, C = (3, 0, 1)·a.
fn vierstangen() -> SolveRequest3D {
    verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, 3.0), knoop(3, 4.0, 0.0, 3.0), knoop(4, 5.0, 0.0, 0.0)],
        vec![scharnierend(staaf(1, 1, 2)), scharnierend(staaf(2, 2, 3)), scharnierend(staaf(3, 4, 3))],
        vec![scharnier(1), scharnier(4), in_het_vlak(2), in_het_vlak(3)],
    )
}

/// Een verticale last in B werkt loodrecht op de beweging van B: geen
/// arbeid langs het mechanisme. Uitkomst: AB draagt de last (N = −P), de
/// rest is krachtloos, en een melding noemt de beweging. Een verticale last
/// in C en een horizontale in B stoten het mechanisme aan: een fout die de
/// beweging en de kracht langs die beweging noemt.
#[test]
fn vierstangenmechanisme() {
    let p = 12.0;
    let mut r = vierstangen();
    r.nodal_loads.push(last(1, 2, [0.0, 0.0, -p]));
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"));
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    eprintln!("{melding}");
    assert!(melding.contains("knopen 2 en 3 kunnen samen bewegen in X en Z"), "{melding}");
    assert!(melding.contains("geen component") && melding.contains("kleinste verplaatsingen"), "{melding}");
    assert!(melding.contains("Aanwijzing: houd die beweging tegen met een verband of schoor"), "{melding}");
    assert_eq!(uit.diagnostics.iter().position(|m| m.starts_with("Mechanisme:")), Some(0), "{:?}", uit.diagnostics);
    let n = |id: usize| uit.member_forces.iter().find(|f| f.member_id == id).unwrap().n_start_kn;
    dicht(n(1), -p, 1e-9, "N AB");
    dicht(n(2), 0.0, 1e-9, "N BC");
    dicht(n(3), 0.0, 1e-9, "N CD");
    dicht(reactie(&uit, 1)[2], p, 1e-9, "R_A,z");
    dicht(reactie(&uit, 4)[2], 0.0, 1e-9, "R_D,z");
    assert!(evenwicht(&uit, &r) < 1e-9, "evenwicht");
    // De kleinste oplossing: geen component langs de beweging (3, 0, 0) in B
    // en (3, 0, 1) in C; de verkorting van AB staat er wel in.
    let (b, c) = (verplaatsing(&uit, 2), verplaatsing(&uit, 3));
    let langs = 3.0 * b[0] + 3.0 * c[0] + c[2];
    assert!(langs.abs() < 1e-12, "component langs het mechanisme {langs:e}: B {b:?}, C {c:?}");
    dicht(b[2], -p * 3.0 / (E * 0.01), 1e-15, "verkorting AB");
    // Geen kunstmatige reacties in B en C buiten Y.
    for id in [2, 3] {
        let x = reactie(&uit, id);
        assert!(x[0] == 0.0 && x[2] == 0.0, "knoop {id}: {x:?}");
    }

    for (wat, knoop, f) in [("verticaal in C", 3, [0.0, 0.0, -p]), ("horizontaal in B", 2, [p, 0.0, 0.0])] {
        let mut r = vierstangen();
        r.nodal_loads.push(last(1, knoop, f));
        let fout = solve(r).expect_err(wat);
        eprintln!("{wat}: {fout}");
        assert!(fout.starts_with("lineaire 3D-berekening: het model is een mechanisme"), "{wat}: {fout}");
        assert!(fout.contains("de belasting stoot die beweging aan"), "{wat}: {fout}");
        assert!(fout.contains("knopen 2 en 3 kunnen samen bewegen in X en Z"), "{wat}: {fout}");
        assert!(fout.contains("intern mechanisme"), "de opleggingen houden het deel vast: {fout}");
    }
}

/// Raam 6 × 4 m zonder verband: scharnierende voeten (knoop 1 en 2),
/// doorgaande kolommen en een scharnierende ligger; de koppen buiten het
/// vlak gesteund. Het raam kan zwaaien in X.
fn raam() -> SolveRequest3D {
    verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)],
        vec![staaf(1, 1, 3), staaf(2, 2, 4), scharnierend(staaf(3, 3, 4))],
        vec![scharnier(1), scharnier(2), in_het_vlak(3), in_het_vlak(4)],
    )
}

/// Alleen verticale last: een uitkomst met een melding die het zwaaien
/// noemt, en dat de voeten daarbij draaien. Een horizontale last (ook een
/// heel kleine) is een fout. In de tweede orde maakt de drukkracht in de
/// kolommen het zwaaien instabiel: ook een fout.
#[test]
fn raam_zonder_verband() {
    let mut r = raam();
    r.nodal_loads.push(last(1, 3, [0.0, 0.0, -50.0]));
    r.nodal_loads.push(last(2, 4, [0.0, 0.0, -30.0]));
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"));
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    eprintln!("{melding}");
    assert!(melding.contains("knopen 3 en 4 kunnen samen bewegen in X (knopen 1 en 2 draaien daarbij om Y)"), "{melding}");
    assert!(melding.contains("instabiel (knikfactor 0)"), "kolommen op druk: {melding}");
    dicht(reactie(&uit, 1)[2], 50.0, 1e-9, "R1");
    dicht(reactie(&uit, 2)[2], 30.0, 1e-9, "R2");
    assert!(evenwicht(&uit, &r) < 1e-9, "evenwicht");
    // Geen zwaai: de kolommen staan lood (kleinste oplossing, geen ruis).
    for id in [1, 2, 3, 4] {
        let u = verplaatsing(&uit, id);
        assert!(u[0].abs() < 1e-14 && u[4].abs() < 1e-14, "knoop {id}: {u:?}");
    }
    // Dezelfde uitkomst bij herhalen.
    let nog = solve(r.clone()).unwrap();
    assert_eq!(format!("{:?}", nog.displacements), format!("{:?}", uit.displacements));

    for fx in [5.0, 1e-6] {
        let mut r = raam();
        r.nodal_loads.push(last(1, 3, [fx, 0.0, -50.0]));
        let fout = solve(r).expect_err("horizontale last");
        assert!(fout.contains("de belasting stoot die beweging aan") && fout.contains("knopen 3 en 4 kunnen samen bewegen in X"), "{fout}");
        assert!(fout.contains("verband of schoor"), "{fout}");
    }

    let mut r = raam();
    r.analysis = AnalysisKind::PDelta;
    r.nodal_loads.push(last(1, 3, [0.0, 0.0, -50.0]));
    let fout = solve(r).expect_err("tweede orde");
    eprintln!("{fout}");
    assert!(fout.starts_with("tweede-orde 3D-berekening: het model is een mechanisme dat de drukkrachten in de tweede orde aanstoten"), "{fout}");
    assert!(fout.contains("niet positief definiet") && fout.contains("knopen 3 en 4 kunnen samen bewegen in X"), "{fout}");

    // Een opwaartse last trekt kolom 1: trek houdt het zwaaien in de tweede
    // orde tegen. Het blijft een mechanisme zonder eerste-ordestijfheid, maar
    // de tweede orde stoot het niet aan: een uitkomst met de melding, zonder
    // de zin over instabiliteit.
    let mut r = raam();
    r.analysis = AnalysisKind::PDelta;
    r.nodal_loads.push(last(1, 3, [0.0, 0.0, 20.0]));
    let uit = solve(r).unwrap_or_else(|fout| panic!("trek in de kolom: {fout}"));
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    assert!(!melding.contains("instabiel"), "{melding}");
}

/// Het raam zonder steun buiten het vlak. De opleggingen (#64) noemen dat
/// het raam als geheel om de lijn door de voeten kan omvallen; de koppen
/// kunnen niet elk apart in Y bewegen, want de ligger draagt torsie over. De
/// melding van de adapter noemt alleen wat de opleggingen niet noemen: het
/// zwaaien in het vlak.
#[test]
fn raam_zonder_steun_buiten_het_vlak() {
    let mut r = raam();
    r.supports.truncate(2);
    r.nodal_loads.push(last(1, 3, [0.0, 0.0, -50.0]));
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(uit.diagnostics[0].starts_with("Opleggingen: Het deel met knopen 1–4 en staven 1–3 is onvoldoende opgelegd; vrij: draaien om X (as door knoop 1 en 2)"), "{:?}", uit.diagnostics);
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    assert!(melding.starts_with("Mechanisme: knopen 3 en 4 kunnen samen bewegen in X"), "{melding}");
    assert!(!melding.contains("vrije bewegingen") && !melding.contains("in Y"), "{melding}");
    assert!(evenwicht(&uit, &r) < 1e-9, "evenwicht");
    // Geen omvallen of zwaaien in de uitvoer.
    for id in [3, 4] {
        let u = verplaatsing(&uit, id);
        assert!(u[0].abs() < 1e-14 && u[1].abs() < 1e-14, "knoop {id}: {u:?}");
    }
}

/// Alleen verticaal opgelegd (#64): de opleggingen noemen de vrije
/// bewegingen al; geen tweede melding, en de verplaatsingen hebben geen
/// component langs die bewegingen (geen verschuiving in X of Y).
#[test]
fn geen_dubbele_melding_naast_de_opleggingen() {
    let rol = |node_id| Support3D { node_id, uz: true, ..Default::default() };
    let mut r = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 4.0, 3.0, 0.0)],
        vec![staaf(1, 1, 2), staaf(2, 2, 3)],
        vec![rol(1), rol(2), rol(3)],
    );
    r.nodal_loads.push(last(1, 2, [0.0, 0.0, -10.0]));
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(uit.diagnostics[0].starts_with("Opleggingen: Het deel met knopen 1–3 en staven 1–2 is onvoldoende opgelegd"), "{:?}", uit.diagnostics);
    assert!(mechanisme(&uit).is_none(), "{:?}", uit.diagnostics);
    assert!(evenwicht(&uit, &r) < 1e-9);
    for id in [1, 2, 3] {
        let u = verplaatsing(&uit, id);
        assert!(u[0].abs() < 1e-14 && u[1].abs() < 1e-14 && u[5].abs() < 1e-14, "knoop {id}: {u:?}");
    }
}

/// Kleinste oplossing: dezelfde raam met alleen een temperatuurlast op de
/// ligger. De ligger wordt α·ΔT·L langer; het raam mag zwaaien, dus die
/// verlenging verdeelt zich symmetrisch over beide koppen, zonder kracht.
#[test]
fn kleinste_oplossing_langs_het_mechanisme() {
    let mut r = raam();
    r.thermal_loads.push(ThermalLoad3D { id: 1, member_id: 3, delta_t_uniform_k: 30.0, delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 0.0 });
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    assert!(mechanisme(&uit).is_some(), "{:?}", uit.diagnostics);
    let rek = 12e-6 * 30.0 * 6.0;
    let (u3, u4) = (verplaatsing(&uit, 3), verplaatsing(&uit, 4));
    dicht(u4[0] - u3[0], rek, 1e-15, "verlenging van de ligger");
    dicht(u3[0] + u4[0], 0.0, 1e-15, "symmetrisch: geen zwaai");
    for f in &uit.member_forces {
        assert!(f.n_start_kn.abs() < 1e-9 && f.my_end_knm.abs() < 1e-9, "{f:?}");
    }
}

/// #96: een portaal waarvan alle staven scharnierend zijn (vrije
/// knoopdraaiingen, vastgehouden) en dat bovendien kan zwaaien. Onder alleen
/// verticale last: een uitkomst met beide meldingen. Tot #110 was dat een
/// fout, omdat de stijfheidsmatrix na het vasthouden singulier bleef.
#[test]
fn vrije_knoopdraaiing_en_een_mechanisme_dat_de_belasting_niet_aanstoot() {
    let mut r = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)],
        vec![scharnierend(staaf(1, 1, 3)), scharnierend(staaf(2, 2, 4)), scharnierend(staaf(3, 3, 4))],
        vec![scharnier(1), scharnier(2), in_het_vlak(3), in_het_vlak(4)],
    );
    r.member_loads.push(MemberLoad3D { id: 1, member_id: 3, qz_start_kn_per_m: -10.0, qz_end_kn_per_m: -10.0, ..Default::default() });
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    assert!(melding.contains("knopen 3 en 4 kunnen samen bewegen in X"), "{melding}");
    assert!(uit.diagnostics.iter().any(|m| m.starts_with("Vrije knoopdraaiing")), "{:?}", uit.diagnostics);
    dicht(reactie(&uit, 1)[2], 30.0, 1e-9, "R1");
    dicht(reactie(&uit, 2)[2], 30.0, 1e-9, "R2");
    let ligger = uit.member_forces.iter().find(|f| f.member_id == 3).unwrap();
    dicht(ligger.my_start_knm, 0.0, 1e-9, "M ligger begin");
}

/// Een plaat op vier hoeken met een pendel eronder: een scharnierende staaf
/// vanaf een plaatknoop met een vrij eind. Een verticale last aan het eind
/// trekt de pendel; zij kan zijdelings uitslaan, maar de last stoot dat niet
/// aan. Een plaatmodel volgt dezelfde regel.
#[test]
fn plaat_met_een_pendel() {
    let mut nodes = Vec::new();
    let n = 4;
    let id = |i: usize, j: usize| 1 + i + (n + 1) * j;
    for j in 0..=n {
        for i in 0..=n {
            nodes.push(knoop(id(i, j), i as f64, j as f64, 3.0));
        }
    }
    let mut elementen = Vec::new();
    for j in 0..n {
        for i in 0..n {
            elementen.push(ShellElement3D { id: 1 + i + n * j, plate_id: 1, node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)] });
        }
    }
    nodes.push(knoop(100, 2.0, 2.0, 1.0));
    let midden = id(2, 2);
    let mut r = verzoek(nodes, vec![scharnierend(staaf(1, midden, 100))], vec![
        inklemming(id(0, 0)), scharnier(id(n, 0)), scharnier(id(0, n)), scharnier(id(n, n)),
    ]);
    r.plates.push(Plate3D { id: 1, material_id: 1, thickness_m: 0.2, bedding: None, orthotropy: None });
    r.shell_elements = elementen;
    r.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -5.0 });
    r.nodal_loads.push(last(1, 100, [0.0, 0.0, -8.0]));
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"));
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    assert!(melding.contains("knoop 100 kan bewegen in X en Y") || melding.contains("2 vrije bewegingen"), "{melding}");
    let pendel = uit.member_forces.iter().find(|f| f.member_id == 1).unwrap();
    dicht(pendel.n_start_kn, 8.0, 1e-6, "N pendel");
    let u = verplaatsing(&uit, 100);
    assert!(u[0].abs() < 1e-12 && u[1].abs() < 1e-12, "geen uitslag: {u:?}");
    // Zijdelings belast: een fout.
    r.nodal_loads[0].fx = 1.0;
    let fout = solve(r).expect_err("zijdelings");
    assert!(fout.contains("de belasting stoot die beweging aan") && fout.contains("knoop 100"), "{fout}");
}

/// Slecht geconditioneerd maar regulier: geen melding, geen fout.
/// - een kolom op een zeer stijve en een zeer slappe rotatieveer naast elkaar
///   (1e9 en 1e-3 kNm/rad) en zeer stijve en slappe translatieveren;
/// - een lange slanke staaf van 200 m in 100 delen tussen twee inklemmingen;
/// - een plaatnet (MITC4 met draaiveer) op vier hoeken.
#[test]
fn slecht_geconditioneerd_maar_regulier() {
    let geen_melding = |wat: &str, uit: &SolveResult3D| {
        assert!(mechanisme(uit).is_none(), "{wat}: {:?}", uit.diagnostics);
        assert!(!uit.diagnostics.iter().any(|m| m.starts_with("Opleggingen")), "{wat}: {:?}", uit.diagnostics);
    };
    // Kolom 4 m, voet op veren.
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, 4.0)], vec![staaf(1, 1, 2)], vec![Support3D {
        node_id: 1, kx_kn_per_m: Some(1e12), ky_kn_per_m: Some(1e-2), kz_kn_per_m: Some(1e9),
        krx_knm_per_rad: Some(1e9), kry_knm_per_rad: Some(1e-3), krz_knm_per_rad: Some(1e9),
        ..Default::default()
    }]);
    r.nodal_loads.push(last(1, 2, [0.0, 0.0, -10.0]));
    let uit = solve(r.clone()).unwrap_or_else(|fout| panic!("veren: {fout}"));
    geen_melding("veren", &uit);
    dicht(reactie(&uit, 1)[2], 10.0, 1e-9, "veren: R_z");
    // Met een kleine horizontale last draagt de slappe rotatieveer: een grote
    // maar eindige uitkomst, M = H·h in de veer.
    r.nodal_loads[0].fx = 1e-3;
    let uit = solve(r).unwrap_or_else(|fout| panic!("veren, horizontaal: {fout}"));
    geen_melding("veren, horizontaal", &uit);
    dicht(reactie(&uit, 1)[4].abs(), 4e-3, 1e-9, "moment in de slappe veer");

    // Lange slanke staaf.
    let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 200.0, 0.0, 0.0)];
    let mut s = staaf(1, 1, 2);
    for i in 1..100 {
        nodes.push(knoop(10 + i, 2.0 * i as f64, 0.0, 0.0));
        s.intermediate_node_ids.push(10 + i);
    }
    let mut r = verzoek(nodes, vec![s], vec![inklemming(1), inklemming(2)]);
    r.member_loads.push(MemberLoad3D { id: 1, member_id: 1, qz_start_kn_per_m: -1.0, qz_end_kn_per_m: -1.0, ..Default::default() });
    let uit = solve(r).unwrap_or_else(|fout| panic!("slanke staaf: {fout}"));
    geen_melding("slanke staaf", &uit);
    dicht(reactie(&uit, 1)[2].abs(), 100.0, 1e-6, "slanke staaf: R1");

    // Plaatnet.
    let n = 12;
    let id = |i: usize, j: usize| 1 + i + (n + 1) * j;
    let mut nodes = Vec::new();
    for j in 0..=n {
        for i in 0..=n { nodes.push(knoop(id(i, j), 0.5 * i as f64, 0.5 * j as f64, 0.0)); }
    }
    let mut elementen = Vec::new();
    for j in 0..n {
        for i in 0..n {
            elementen.push(ShellElement3D { id: 1 + i + n * j, plate_id: 1, node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)] });
        }
    }
    let mut r = verzoek(nodes, vec![], vec![scharnier(id(0, 0)), scharnier(id(n, 0)), scharnier(id(0, n)), scharnier(id(n, n))]);
    r.sections.clear();
    r.plates.push(Plate3D { id: 1, material_id: 1, thickness_m: 0.25, bedding: None, orthotropy: None });
    r.shell_elements = elementen;
    r.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -5.0 });
    let uit = solve(r).unwrap_or_else(|fout| panic!("plaatnet: {fout}"));
    geen_melding("plaatnet", &uit);
}

/// De tijd van de controle (#195). De proef is één factorisatie per
/// berekening, dezelfde die #110 al deed; een regulier model rekent verder
/// zoals voorheen. Alleen een model met een vrije beweging rekent meer: de
/// nulruimte (inverse iteratie op de factor van de proef) en een tweede
/// oplossing van de kern met de beweging vastgehouden. Gemeten op een raam
/// van 30 vakken en 4 lagen (150 kolommen): met scharnierende voeten en
/// scharnierende liggers kan het raam zwaaien (de doorgaande kolommen nemen
/// alle lagen mee: één vrije beweging), met ingeklemde voeten is het regulier. De tijden staan in de uitvoer
/// (`cargo test -p open-fem-3d --test mechanisme -- --nocapture`).
#[test]
fn tijd_van_de_controle() {
    let (vakken, lagen) = (30, 4);
    let raam = |voet: fn(usize) -> Support3D| {
        let id = |i: usize, j: usize| 1 + i + (vakken + 1) * j;
        let mut nodes = Vec::new();
        for j in 0..=lagen {
            for i in 0..=vakken { nodes.push(knoop(id(i, j), 6.0 * i as f64, 0.0, 3.5 * j as f64)); }
        }
        let mut members = Vec::new();
        let mut supports = Vec::new();
        let mut volgende = 1;
        for i in 0..=vakken {
            supports.push(voet(id(i, 0)));
            for j in 0..lagen {
                members.push(staaf(volgende, id(i, j), id(i, j + 1)));
                volgende += 1;
            }
        }
        for j in 1..=lagen {
            for i in 0..vakken {
                members.push(scharnierend(staaf(volgende, id(i, j), id(i + 1, j))));
                volgende += 1;
            }
            for i in 0..=vakken { supports.push(in_het_vlak(id(i, j))); }
        }
        let mut r = verzoek(nodes, members, supports);
        for i in 0..=vakken { r.nodal_loads.push(last(i + 1, id(i, lagen), [0.0, 0.0, -10.0])); }
        r
    };
    let meet = |r: SolveRequest3D| {
        let begin = std::time::Instant::now();
        let mut uit = None;
        for _ in 0..3 { uit = Some(solve(r.clone()).unwrap_or_else(|fout| panic!("{fout}"))); }
        (begin.elapsed().as_secs_f64() / 3.0, uit.unwrap())
    };
    let (regulier, uit) = meet(raam(inklemming));
    assert!(mechanisme(&uit).is_none(), "{:?}", uit.diagnostics);
    let (met, uit) = meet(raam(scharnier));
    let melding = mechanisme(&uit).unwrap_or_else(|| panic!("geen melding: {:?}", uit.diagnostics));
    assert!(melding.contains("knopen 32–155 kunnen samen bewegen in X"), "{melding}");
    eprintln!(
        "tijd per berekening: regulier {:.1} ms, met een vrije beweging {:.1} ms (verhouding {:.2})",
        regulier * 1000.0, met * 1000.0, met / regulier,
    );
}
