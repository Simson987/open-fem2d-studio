//! Trek-alleen staven, starre schijven en de eigen tweede orde (#60), elk met
//! een gesloten oplossing of een exacte evenwichtsidentiteit.
//!
//! Eenheden: m, kN, kNm; E = 210 000 MPa = 2,1·10⁸ kN/m², ν = 0,3.

use open_fem_3d::{
    solve, AnalysisKind, BucklingSummary, Diaphragm3D, EndReleases3D, Material3D, Member3D,
    MemberLoad3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D, SolveResult3D, Support3D,
};

const E_KN_M2: f64 = 210_000.0 * 1000.0;
const G_KN_M2: f64 = E_KN_M2 / (2.0 * 1.3);

fn doorsnede(id: usize, area: f64, i: f64, j: f64) -> Section3D {
    Section3D { id, name: format!("doorsnede {id}"), area_m2: area, iy_m4: i, iz_m4: i,
        torsion_j_m4: j, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

fn staaf(id: usize, begin: usize, eind: usize, sectie: usize) -> Member3D {
    Member3D { id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: sectie,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false, bedding: None, part_section_ids: None }
}

fn scharnierend(mut staaf: Member3D) -> Member3D {
    staaf.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true,
        torsion_start: false, torsion_end: false };
    staaf
}

fn trek_alleen(mut staaf: Member3D) -> Member3D {
    staaf.tension_only = true;
    scharnierend(staaf)
}

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

fn vast(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }
}

fn last(id: usize, node_id: usize, fx: f64, fy: f64, fz: f64) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx, fy, fz, mx: 0.0, my: 0.0, mz: 0.0 }
}

fn verzoek(nodes: Vec<Node3D>, sections: Vec<Section3D>, members: Vec<Member3D>,
    supports: Vec<Support3D>, nodal_loads: Vec<NodalLoad3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 1, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections, members, supports, nodal_loads, member_loads: vec![], member_point_loads: vec![],
        thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

fn dichtbij(werkelijk: f64, verwacht: f64, relatief: f64, absoluut: f64, wat: &str) {
    let verschil = (werkelijk - verwacht).abs();
    assert!(verschil <= absoluut.max(verwacht.abs() * relatief),
        "{wat}: berekend {werkelijk:.12e}, verwacht {verwacht:.12e}, verschil {verschil:.3e}");
}

fn verplaatsing(r: &SolveResult3D, knoop: usize) -> [f64; 6] {
    let d = r.displacements.iter().find(|d| d.node_id == knoop).unwrap();
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]
}

fn normaalkracht(r: &SolveResult3D, staaf: usize) -> f64 {
    r.member_forces.iter().find(|f| f.member_id == staaf).unwrap().n_start_kn
}

fn reactie(r: &SolveResult3D, knoop: usize) -> [f64; 6] {
    let x = r.reactions.iter().find(|x| x.node_id == knoop).unwrap();
    [x.fx, x.fy, x.fz, x.mx, x.my, x.mz]
}

fn kruis(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// Globale kracht- en momentensom (om de oorsprong) van knooplasten en reacties.
fn krachten_en_momenten(req: &SolveRequest3D, r: &SolveResult3D) -> ([f64; 3], [f64; 3]) {
    let plaats = |id: usize| { let n = req.nodes.iter().find(|n| n.id == id).unwrap(); [n.x, n.y, n.z] };
    let mut kracht = [0.0; 3];
    let mut moment = [0.0; 3];
    let mut tel = |p: [f64; 3], f: [f64; 3], m: [f64; 3]| {
        let rf = kruis(p, f);
        for as_ in 0..3 { kracht[as_] += f[as_]; moment[as_] += rf[as_] + m[as_]; }
    };
    for l in &req.nodal_loads { tel(plaats(l.node_id), [l.fx, l.fy, l.fz], [l.mx, l.my, l.mz]); }
    for x in &r.reactions { tel(plaats(x.node_id), [x.fx, x.fy, x.fz], [x.mx, x.my, x.mz]); }
    (kracht, moment)
}

/// Het tweede-ordemoment Σ N·(e_x × Δu) over alle staven (N trek positief).
/// Met reacties ((K + K_G)·u − F) is de onvervormde momentensom hier exact gelijk aan.
fn tweede_orde_moment(req: &SolveRequest3D, r: &SolveResult3D) -> [f64; 3] {
    let mut som = [0.0; 3];
    for s in &req.members {
        let a = req.nodes.iter().find(|n| n.id == s.start_node_id).unwrap();
        let b = req.nodes.iter().find(|n| n.id == s.end_node_id).unwrap();
        let l = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2) + (b.z - a.z).powi(2)).sqrt();
        let ex = [(b.x - a.x) / l, (b.y - a.y) / l, (b.z - a.z) / l];
        let (ua, ub) = (verplaatsing(r, a.id), verplaatsing(r, b.id));
        let du = [ub[0] - ua[0], ub[1] - ua[1], ub[2] - ua[2]];
        let n = normaalkracht(r, s.id);
        let m = kruis(ex, du);
        for as_ in 0..3 { som[as_] += n * m[as_]; }
    }
    som
}

fn knikfactor(r: &SolveResult3D) -> f64 {
    match &r.buckling {
        BucklingSummary::Available { modes, .. } => modes[0].load_factor,
        other => panic!("knikfactor verwacht, kreeg {other:?}"),
    }
}

// ─── Trek-alleen ─────────────────────────────────────────────────────────────

/// Portaal 6 × 4 m met scharnierende voeten in het vlak, een scharnierende
/// ligger en een kruisverband van twee trek-alleen diagonalen: zonder verband
/// is het een mechanisme, dus de horizontale last H gaat volledig door één
/// diagonaal: N = H/cos θ = H·d/L met d = √(6² + 4²) = 7,2111 m. De andere
/// diagonaal zou op druk komen en valt weg. Bij −H wisselen ze.
fn kruisportaal(h_kn: f64) -> SolveRequest3D {
    let voet = |node_id| Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true, ..Default::default() };
    verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)],
        vec![doorsnede(1, 0.01, 8e-5, 5e-6), doorsnede(2, 0.001, 1e-6, 2e-6)],
        vec![
            staaf(1, 1, 3, 1), staaf(2, 2, 4, 1), scharnierend(staaf(3, 3, 4, 1)),
            trek_alleen(staaf(4, 1, 4, 2)), trek_alleen(staaf(5, 2, 3, 2)),
        ],
        vec![voet(1), voet(2)],
        vec![last(1, 3, h_kn, 0.0, 0.0)],
    )
}

#[test]
fn kruisverband_onder_h_trekt_een_diagonaal_en_laat_de_andere_vallen() {
    let d = (36.0f64 + 16.0).sqrt();
    let h = 12.0;
    for (teken, trek, druk) in [(1.0, 4usize, 5usize), (-1.0, 5, 4)] {
        let req = kruisportaal(teken * h);
        let r = solve(req.clone()).unwrap();
        assert_eq!(r.inactive_members, vec![druk], "bij {teken}·H valt staaf {druk} weg");
        assert!(r.tension_only_rounds >= 2, "minstens één statuswissel en één bevestiging");
        dichtbij(normaalkracht(&r, trek), h * d / 6.0, 1e-9, 1e-9, "N diagonaal = H/cos θ");
        assert_eq!(normaalkracht(&r, druk), 0.0);
        let nul = r.diagrams.axial.iter().find(|lijn| lijn.member_id == druk).unwrap();
        assert!(nul.points.iter().all(|p| p.value == 0.0) && nul.max_abs_value == 0.0);
        assert!(r.diagrams.moment_y.iter().any(|lijn| lijn.member_id == druk));
        // Reacties: ΣFx = −H; momentevenwicht om voet 1 geeft Rz(2) = H·h/L.
        let (kracht, moment) = krachten_en_momenten(&req, &r);
        for as_ in 0..3 {
            dichtbij(kracht[as_], 0.0, 0.0, 1e-9, "krachtensom");
            dichtbij(moment[as_], 0.0, 0.0, 1e-9, "momentensom");
        }
        dichtbij(reactie(&r, 2)[2], teken * h * 4.0 / 6.0, 1e-9, 1e-9, "Rz voet 2");
        assert!(r.equilibrium.as_ref().is_some_and(|e| e.equilibrium_ok));
        assert!(r.diagnostics.iter().any(|m| m.contains("Trek-alleen: 1 van 2")), "{:?}", r.diagnostics);
    }
}

/// Een staaflast op een inactieve diagonaal verdwijnt niet: hij gaat als
/// reacties van een vrij opgelegde staaf naar de eindknopen. qz = −0,5 kN/m
/// over d = 7,2111 m geeft een resultante van 3,6056 kN langs de lokale z-as.
#[test]
fn staaflast_op_een_inactieve_staaf_blijft_in_het_evenwicht() {
    let mut req = kruisportaal(-12.0);
    req.member_loads.push(MemberLoad3D {
        id: 1, member_id: 4, qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -0.5, qz_end_kn_per_m: -0.5, start_position_m: None, end_position_m: None,
        ..Default::default()
    });
    let r = solve(req.clone()).unwrap();
    assert_eq!(r.inactive_members, vec![4]);
    // Lokale z van de diagonaal 1→4 (in het XZ-vlak): omhoog loodrecht op de staaf.
    let d = 52.0f64.sqrt();
    let ez = [-4.0 / d, 0.0, 6.0 / d];
    let resultante = -0.5 * d;
    let som = |as_: usize| r.reactions.iter().map(|x| [x.fx, x.fy, x.fz][as_]).sum::<f64>();
    dichtbij(som(0), 12.0 - resultante * ez[0], 1e-9, 1e-9, "ΣRx = −(−H + q·d·ez,x)");
    dichtbij(som(2), -resultante * ez[2], 1e-9, 1e-9, "ΣRz = −q·d·ez,z");
    assert!(r.diagnostics.iter().any(|m| m.contains("als knooplasten")), "{:?}", r.diagnostics);
}

#[test]
fn trek_alleen_staaf_die_een_knoop_los_laat_geeft_een_heldere_fout() {
    let mut req = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0)],
        vec![doorsnede(1, 0.01, 8e-6, 5e-6)],
        vec![trek_alleen(staaf(7, 1, 2, 1))],
        vec![vast(1)],
        vec![last(1, 2, -5.0, 0.0, 0.0)],
    );
    req.members[0].releases = Default::default();
    let fout = solve(req).unwrap_err();
    assert!(fout.contains("staaf 7") && fout.contains("knoop 2") && fout.contains("los hangen"), "{fout}");
}

// ─── Starre schijven ─────────────────────────────────────────────────────────

/// Twee ingeklemde kolommen van 3 m, I₁ = 1·10⁻⁵ en I₂ = 2·10⁻⁵ m⁴, alleen
/// verbonden door een starre vloer. H = 30 kN op kolom 1:
/// k_i = 3EI_i/h³ = 233,33 en 466,67 kN/m, u = H/(k₁+k₂) = 0,042857 m,
/// V₁ = 10 kN, V₂ = 20 kN, inklemmingsmomenten 30 en 60 kNm.
#[test]
fn twee_kolommen_onder_een_starre_vloer_verdelen_naar_stijfheid() {
    let mut req = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 5.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 3.0), knoop(4, 5.0, 0.0, 3.0)],
        vec![doorsnede(1, 0.01, 1e-5, 2e-5), doorsnede(2, 0.01, 2e-5, 4e-5)],
        vec![staaf(1, 1, 3, 1), staaf(2, 2, 4, 2)],
        vec![vast(1), vast(2)],
        vec![last(1, 3, 30.0, 0.0, 0.0)],
    );
    req.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![3, 4] });
    let r = solve(req.clone()).unwrap();
    let k1 = 3.0 * E_KN_M2 * 1e-5 / 27.0;
    let u = 30.0 / (3.0 * k1);
    dichtbij(verplaatsing(&r, 3)[0], u, 1e-9, 1e-12, "u kolom 1");
    dichtbij(verplaatsing(&r, 4)[0], u, 1e-9, 1e-12, "gelijke verplaatsing kolom 2");
    dichtbij(reactie(&r, 1)[0], -10.0, 1e-9, 1e-9, "V₁");
    dichtbij(reactie(&r, 2)[0], -20.0, 1e-9, 1e-9, "V₂");
    dichtbij(reactie(&r, 1)[4].abs(), 30.0, 1e-9, 1e-9, "M₁");
    dichtbij(reactie(&r, 2)[4].abs(), 60.0, 1e-9, 1e-9, "M₂");
    for knoop in [3, 4] {
        dichtbij(verplaatsing(&r, knoop)[1], 0.0, 0.0, 1e-12, "geen v zonder torsie");
        dichtbij(verplaatsing(&r, knoop)[5], 0.0, 0.0, 1e-12, "geen rotatie om Z");
    }
    // Ook in tweede orde blijft de koppeling star (geen drukkracht: N = 0).
    req.analysis = AnalysisKind::PDelta;
    let tweede = solve(req).unwrap();
    dichtbij(verplaatsing(&tweede, 4)[0], u, 1e-9, 1e-12, "tweede orde zonder druk = eerste orde");
}

/// Vier gelijke ingeklemde kolommen (h = 3 m, I = 1·10⁻⁵, J = 2·10⁻⁵ m⁴) op de
/// hoeken van 6 × 4 m onder een starre vloer; P = 20 kN in X op hoek (0, 0).
/// Stijfheidscentrum (3, 2): translatie P/(4k), moment Mz = 2·P = 40 kNm,
/// torsiestijfheid K_θ = k·Σ(Δx² + Δy²) + 4·GJ/h = 12 133,3 + 2 153,8 kNm/rad.
#[test]
fn schijf_draait_star_onder_een_excentrische_last() {
    let mut req = verzoek(
        vec![
            knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 6.0, 4.0, 0.0), knoop(4, 0.0, 4.0, 0.0),
            knoop(5, 0.0, 0.0, 3.0), knoop(6, 6.0, 0.0, 3.0), knoop(7, 6.0, 4.0, 3.0), knoop(8, 0.0, 4.0, 3.0),
        ],
        vec![doorsnede(1, 0.01, 1e-5, 2e-5)],
        (1..=4).map(|i| staaf(i, i, i + 4, 1)).collect(),
        (1..=4).map(vast).collect(),
        vec![last(1, 5, 20.0, 0.0, 0.0)],
    );
    req.diaphragms.push(Diaphragm3D { id: 3, node_ids: vec![5, 6, 7, 8] });
    let r = solve(req.clone()).unwrap();
    let k = 3.0 * E_KN_M2 * 1e-5 / 27.0;
    let k_theta = k * 4.0 * (9.0 + 4.0) + 4.0 * G_KN_M2 * 2e-5 / 3.0;
    let theta = 40.0 / k_theta;
    let u_c = 20.0 / (4.0 * k);
    for (knoop, x, y) in [(5, 0.0, 0.0), (6, 6.0, 0.0), (7, 6.0, 4.0), (8, 0.0, 4.0)] {
        let d = verplaatsing(&r, knoop);
        dichtbij(d[0], u_c - (y - 2.0) * theta, 1e-9, 1e-12, &format!("u knoop {knoop}"));
        dichtbij(d[1], (x - 3.0) * theta, 1e-9, 1e-12, &format!("v knoop {knoop}"));
        dichtbij(d[5], theta, 1e-9, 1e-12, &format!("rotatie om Z knoop {knoop}"));
    }
    let (kracht, moment) = krachten_en_momenten(&req, &r);
    for as_ in 0..3 {
        dichtbij(kracht[as_], 0.0, 0.0, 1e-9, "krachtensom");
        dichtbij(moment[as_], 0.0, 0.0, 1e-8, "momentensom");
    }
}

#[test]
fn schijven_worden_gekeurd() {
    let basis = || {
        let mut req = verzoek(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 5.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 3.0), knoop(4, 5.0, 0.0, 3.0)],
            vec![doorsnede(1, 0.01, 1e-5, 2e-5)],
            vec![staaf(1, 1, 3, 1), staaf(2, 2, 4, 1)],
            vec![vast(1), vast(2)],
            vec![last(1, 3, 30.0, 0.0, 0.0)],
        );
        req.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![3, 4] });
        req
    };
    let fout = |wijzig: &dyn Fn(&mut SolveRequest3D)| { let mut req = basis(); wijzig(&mut req); solve(req).unwrap_err() };
    assert!(fout(&|req| req.nodes[3].z = 3.002).contains("niet op één hoogte"));
    assert!(fout(&|req| req.diaphragms[0].node_ids = vec![3]).contains("minder dan twee"));
    assert!(fout(&|req| req.diaphragms[0].node_ids = vec![3, 9]).contains("ontbrekende knoop 9"));
    assert!(fout(&|req| req.diaphragms.push(Diaphragm3D { id: 2, node_ids: vec![4, 1] })).contains("hoogstens één schijf"));
    assert!(fout(&|req| {
        req.supports.push(Support3D { node_id: 3, ux: true, ..Default::default() });
        req.supports.push(Support3D { node_id: 4, uy: true, ..Default::default() });
    }).contains("onbepaald"));
    // Binnen 1 mm is goed.
    let mut req = basis();
    req.nodes[3].z = 3.001;
    assert!(solve(req).is_ok());
    // Eén vaste knoop wordt de meester: de hele schijf staat stil in X.
    let mut req = basis();
    req.supports.push(Support3D { node_id: 4, ux: true, ..Default::default() });
    let r = solve(req).unwrap();
    dichtbij(verplaatsing(&r, 3)[0], 0.0, 0.0, 1e-12, "schijf vastgehouden via knoop 4");
    dichtbij(reactie(&r, 4)[0], -30.0, 1e-9, 1e-9, "de hele last naar de vaste knoop");
    // Liggen alle knopen in X en Y vast, dan valt de schijf weg met een melding.
    let mut req = basis();
    req.nodal_loads[0].fx = 0.0;
    req.nodal_loads[0].fz = -10.0;
    req.supports.push(Support3D { node_id: 3, ux: true, uy: true, ..Default::default() });
    req.supports.push(Support3D { node_id: 4, ux: true, uy: true, ..Default::default() });
    let r = solve(req).unwrap();
    assert!(r.diagnostics.iter().any(|m| m.contains("koppelt niets")), "{:?}", r.diagnostics);
}

// ─── Tweede orde (#60) ───────────────────────────────────────────────────────

/// Ingeklemde kolom L = 4 m in 8 elementen, I = 8·10⁻⁶ m⁴:
/// N_cr = π²EI/(4L²) = 259,08 kN. Bij P = 0,3·N_cr en H = 1 kN versterkt de
/// kopverplaatsing volgens 1/(1 − P/N_cr) = 1,4286 (de exacte balk-kolom-
/// oplossing 3(tan μ − μ)/μ³ = 1,4228 ligt daar 0,40 % onder). De eerste
/// knikfactor is N_cr/P = 3,3333.
#[test]
fn uitkragende_kolom_volgt_de_versterking_en_de_knikfactor_binnen_1_procent() {
    let lengte: f64 = 4.0;
    let n_cr = std::f64::consts::PI.powi(2) * E_KN_M2 * 8e-6 / (4.0 * lengte * lengte);
    let p = 0.3 * n_cr;
    let maak = |analysis| {
        let mut req = verzoek(
            (0..=8).map(|i| knoop(i + 1, 0.0, 0.0, i as f64 * lengte / 8.0)).collect(),
            vec![doorsnede(1, 0.01, 8e-6, 5e-6)],
            (1..=8).map(|i| staaf(i, i, i + 1, 1)).collect(),
            vec![vast(1)],
            vec![last(1, 9, 1.0, 0.0, -p)],
        );
        req.analysis = analysis;
        req.buckling_modes = 1;
        req
    };
    let lineair = solve(maak(AnalysisKind::Linear)).unwrap();
    let req = maak(AnalysisKind::PDelta);
    let tweede = solve(req.clone()).unwrap();
    let versterking = verplaatsing(&tweede, 9)[0] / verplaatsing(&lineair, 9)[0];
    dichtbij(versterking, 1.0 / (1.0 - 0.3), 0.01, 0.0, "versterking 1/(1 − N/N_cr)");
    dichtbij(knikfactor(&tweede), n_cr / p, 0.01, 0.0, "α_cr = N_cr/P");
    dichtbij(knikfactor(&lineair), n_cr / p, 0.01, 0.0, "α_cr ook bij eerste orde");
    let samenvatting = tweede.second_order.as_ref().unwrap();
    assert!(samenvatting.converged && samenvatting.stable);
    dichtbij(samenvatting.max_amplification, versterking, 1e-6, 0.0, "gerapporteerde versterking");
    // Reacties = lasten, en het inklemmingsmoment is H·L + P·δ.
    let r = reactie(&tweede, 1);
    dichtbij(r[0], -1.0, 1e-9, 1e-9, "Rx = −H");
    dichtbij(r[2], p, 1e-9, 1e-9, "Rz = P");
    let delta = verplaatsing(&tweede, 9)[0];
    dichtbij(r[4].abs(), 1.0 * lengte + p * delta, 0.01, 0.0, "M = H·L + P·δ");
    let (_, moment) = krachten_en_momenten(&req, &tweede);
    let tweede_orde = tweede_orde_moment(&req, &tweede);
    for as_ in 0..3 {
        dichtbij(moment[as_], tweede_orde[as_], 1e-6, 1e-9, "momentensom = Σ N·(e_x × Δu)");
    }
}

/// Een staafeindscharnier telt ook in de geometrische stijfheid mee. Kolom
/// L = 4 m in 8 elementen, onder ingeklemd, boven via een scharnier (vrijgave
/// my/mz aan het einde van het bovenste element) aan een vaste knoop:
/// N_cr = 20,19·EI/L² (ingeklemd–scharnierend, (4,4934)²).
#[test]
fn staafeindscharnier_telt_mee_in_de_knikfactor() {
    let lengte: f64 = 4.0;
    let n_cr = 4.493_409_457_909_064f64.powi(2) * E_KN_M2 * 8e-6 / (lengte * lengte);
    let mut req = verzoek(
        (0..=8).map(|i| knoop(i + 1, 0.0, 0.0, i as f64 * lengte / 8.0)).collect(),
        vec![doorsnede(1, 0.01, 8e-6, 5e-6)],
        (1..=8).map(|i| staaf(i, i, i + 1, 1)).collect(),
        vec![vast(1), Support3D { node_id: 9, ux: true, uy: true, rx: true, ry: true, rz: true, ..Default::default() }],
        vec![last(1, 9, 0.0, 0.0, -100.0)],
    );
    req.members[7].releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
    req.buckling_modes = 1;
    let r = solve(req).unwrap();
    dichtbij(knikfactor(&r) * 100.0, n_cr, 0.01, 0.0, "N_cr ingeklemd–scharnierend");
}

/// Portaal 8 × 5 m, ingeklemde voeten, kolommen in 4 en de ligger in
/// 12 elementen (19 vrije knopen, 114 vrije vrijheidsgraden, boven de grens
/// van 64 waar de P-Δ van de kern faalde). De koppen zijn buiten het vlak (Y)
/// gesteund, zodat de zijwaartse knik in het vlak maatgevend is. Het evenwicht
/// sluit exact en de momentensom verschilt precies het tweede-ordemoment.
#[test]
fn portaal_met_ligger_in_12_elementen_rekent_tweede_orde() {
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    let mut volgende = 1;
    let mut kolom = |x: f64, nodes: &mut Vec<Node3D>, members: &mut Vec<Member3D>| {
        let voet = volgende;
        for i in 0..=4 {
            nodes.push(knoop(volgende, x, 0.0, i as f64 * 5.0 / 4.0));
            if i > 0 { members.push(staaf(members.len() + 1, volgende - 1, volgende, 1)); }
            volgende += 1;
        }
        (voet, volgende - 1)
    };
    let (voet_links, kop_links) = kolom(0.0, &mut nodes, &mut members);
    let (voet_rechts, kop_rechts) = kolom(8.0, &mut nodes, &mut members);
    let mut vorige = kop_links;
    for i in 1..12 {
        let id = nodes.len() + 1;
        nodes.push(knoop(id, i as f64 * 8.0 / 12.0, 0.0, 5.0));
        members.push(staaf(members.len() + 1, vorige, id, 2));
        vorige = id;
    }
    members.push(staaf(members.len() + 1, vorige, kop_rechts, 2));
    let mut req = verzoek(
        nodes,
        vec![doorsnede(1, 0.0064, 5.4e-5, 2.8e-7), doorsnede(2, 0.0072, 1.16e-4, 3.4e-7)],
        members,
        vec![
            vast(voet_links), vast(voet_rechts),
            Support3D { node_id: kop_links, uy: true, ..Default::default() },
            Support3D { node_id: kop_rechts, uy: true, ..Default::default() },
        ],
        vec![last(1, kop_links, 20.0, 0.0, -600.0), last(2, kop_rechts, 0.0, 0.0, -600.0)],
    );
    req.analysis = AnalysisKind::PDelta;
    req.buckling_modes = 1;
    let r = solve(req.clone()).unwrap();
    let samenvatting = r.second_order.as_ref().unwrap();
    assert!(samenvatting.converged && samenvatting.stable, "{samenvatting:?}");
    let alpha = knikfactor(&r);
    assert!(alpha > 1.0);
    let (kracht, moment) = krachten_en_momenten(&req, &r);
    dichtbij(kracht[0], 0.0, 0.0, 1e-8, "ΣFx");
    dichtbij(kracht[2], 0.0, 0.0, 1e-8, "ΣFz");
    let tweede_orde = tweede_orde_moment(&req, &r);
    for as_ in 0..3 {
        dichtbij(moment[as_], tweede_orde[as_], 1e-6, 1e-8, "momentensom = Σ N·(e_x × Δu)");
    }
    assert!(r.equilibrium.as_ref().is_some_and(|e| e.equilibrium_ok));
    // De zijwaartse versterking volgt de EN 1993-1-1-benadering 1/(1 − 1/α_cr).
    let mut lineair = req.clone();
    lineair.analysis = AnalysisKind::Linear;
    let l = solve(lineair).unwrap();
    let versterking = verplaatsing(&r, kop_rechts)[0] / verplaatsing(&l, kop_rechts)[0];
    dichtbij(versterking, 1.0 / (1.0 - 1.0 / alpha), 0.01, 0.0, "zijwaartse versterking");
    eprintln!("portaal: α_cr = {alpha:.4}, versterking {versterking:.5}, iteraties {}", samenvatting.iterations);
}

/// Raamwerk 4 × 4 × 4 vakken (6 × 6 × 3,5 m) met kruisverbanden in de gevels:
/// 125 knopen, 600 vrije vrijheidsgraden. De tweede orde rekent zonder
/// matrixfout, het krachtenevenwicht sluit exact en het momentverschil is
/// precies het tweede-ordemoment.
///
/// De verbanden zijn buizen 168,3×8 (A = 40,3 cm², I = 1297 cm⁴). Tot oktober
/// 2026 stond hier 88,9×4 (10,67 cm², 96,34 cm⁴): dat verband van 6,95 m krijgt
/// in dit raamwerk 41,07 kN druk bij een Eulerlast van 41,38 kN. Met één
/// element per staaf zag de knikanalyse dat niet (α_cr > 10); met de staven
/// in vier delen (K4, #186) is α_cr = 1,008 en is de tweede orde terecht
/// instabiel. Met de zwaardere buis knikt het meest gedrukte verband als
/// eerste: α_cr = π²·E·I/(L²·|N|) met de eerste-ordenormaalkracht.
#[test]
fn groot_raamwerk_rekent_tweede_orde_zonder_factorisatiefout() {
    let n = 4usize;
    let id = |i: usize, j: usize, k: usize| 1 + k * (n + 1) * (n + 1) + j * (n + 1) + i;
    let mut nodes = Vec::new();
    for k in 0..=n { for j in 0..=n { for i in 0..=n {
        nodes.push(knoop(id(i, j, k), i as f64 * 6.0, j as f64 * 6.0, k as f64 * 3.5));
    } } }
    let mut members: Vec<Member3D> = Vec::new();
    let mut voeg = |a: usize, b: usize, s: usize, verband: bool| {
        let m = staaf(members.len() + 1, a, b, s);
        members.push(if verband { scharnierend(m) } else { m });
    };
    for k in 0..n { for j in 0..=n { for i in 0..=n { voeg(id(i, j, k), id(i, j, k + 1), 1, false); } } }
    for k in 1..=n { for j in 0..=n { for i in 0..=n {
        if i < n { voeg(id(i, j, k), id(i + 1, j, k), 2, false); }
        if j < n { voeg(id(i, j, k), id(i, j + 1, k), 2, false); }
    } } }
    for k in 0..n {
        for j in [0, n] { voeg(id(1, j, k), id(2, j, k + 1), 3, true); voeg(id(2, j, k), id(1, j, k + 1), 3, true); }
        for i in [0, n] { voeg(id(i, 1, k), id(i, 2, k + 1), 3, true); voeg(id(i, 2, k), id(i, 1, k + 1), 3, true); }
    }
    let supports: Vec<Support3D> = (0..(n + 1) * (n + 1)).map(|index| vast(index + 1)).collect();
    let mut loads = Vec::new();
    for knoop in nodes.iter().filter(|p| p.z > 0.0) {
        loads.push(last(loads.len() + 1, knoop.id, 3.0, 1.0, -60.0));
    }
    let mut req = verzoek(
        nodes,
        vec![
            doorsnede(1, 112.5e-4, 12e-5, 85e-8),
            doorsnede(2, 53.81e-4, 8.4e-5, 20e-8),
            doorsnede(3, 40.3e-4, 1297e-8, 2594e-8),
        ],
        members, supports, loads,
    );
    req.analysis = AnalysisKind::PDelta;
    req.buckling_modes = 1;
    // De verbanden: na 100 kolommen en 160 liggers.
    let eerste_verband = n * (n + 1) * (n + 1) + 2 * n * n * (n + 1) + 1;
    assert_eq!(req.members.len() - eerste_verband + 1, 8 * n, "acht verbanden per bouwlaag");
    let vrij = (req.nodes.len() - req.supports.len()) * 6;
    assert!(vrij >= 500, "{vrij} vrije vrijheidsgraden");
    let r = solve(req.clone()).unwrap();
    let samenvatting = r.second_order.as_ref().unwrap();
    assert!(samenvatting.converged && samenvatting.stable);
    let (kracht, moment) = krachten_en_momenten(&req, &r);
    for as_ in 0..3 { dichtbij(kracht[as_], 0.0, 0.0, 1e-7, "krachtensom"); }
    let tweede_orde = tweede_orde_moment(&req, &r);
    for as_ in 0..3 { dichtbij(moment[as_], tweede_orde[as_], 1e-6, 1e-6, "momentensom = Σ N·(e_x × Δu)"); }
    let alpha = knikfactor(&r);
    let BucklingSummary::Available { members: knik, .. } = &r.buckling else { unreachable!() };
    let l_verband = (6.0f64 * 6.0 + 3.5 * 3.5).sqrt();
    let euler = std::f64::consts::PI.powi(2) * E_KN_M2 * 1297e-8 / (l_verband * l_verband);
    let hand = knik.iter().filter(|m| m.member_id >= eerste_verband && m.axial_force_kn < 0.0)
        .map(|m| euler / m.axial_force_kn.abs()).fold(f64::INFINITY, f64::min);
    assert!(alpha >= hand && alpha <= hand * 1.002, "α_cr = {alpha} tegen de knik van het verband {hand}");
    eprintln!("groot raamwerk: {vrij} vrije vg, α_cr = {alpha:.3} (verband {hand:.3}), versterking {:.5}, {} iteraties",
        samenvatting.max_amplification, samenvatting.iterations);
}

/// Schijven, trek-alleen en tweede orde samen: twee bouwlagen (4 × 3 m op
/// 3 m hoogte), scharnierende kolommen en liggers, per gevel een kruisverband
/// van trek-alleen diagonalen en per verdieping een starre vloer. Onder H in X
/// valt in elk kruis de gedrukte diagonaal weg; de schijven blijven star; het
/// evenwicht sluit met het tweede-ordemoment.
#[test]
fn schijven_trek_alleen_en_tweede_orde_samen() {
    let hoeken = [(0.0, 0.0), (4.0, 0.0), (4.0, 3.0), (0.0, 3.0)];
    let id = |laag: usize, hoek: usize| 1 + laag * 4 + hoek;
    let mut nodes = Vec::new();
    for laag in 0..3 { for (hoek, &(x, y)) in hoeken.iter().enumerate() {
        nodes.push(knoop(id(laag, hoek), x, y, laag as f64 * 3.0));
    } }
    let mut members: Vec<Member3D> = Vec::new();
    let mut kruisen = Vec::new();
    for laag in 0..2 {
        for hoek in 0..4 { members.push(staaf(members.len() + 1, id(laag, hoek), id(laag + 1, hoek), 1)); }
        for hoek in 0..4 {
            let volgende = (hoek + 1) % 4;
            members.push(scharnierend(staaf(members.len() + 1, id(laag + 1, hoek), id(laag + 1, volgende), 2)));
            let a = members.len() + 1;
            members.push(trek_alleen(staaf(a, id(laag, hoek), id(laag + 1, volgende), 3)));
            members.push(trek_alleen(staaf(a + 1, id(laag, volgende), id(laag + 1, hoek), 3)));
            kruisen.push((a, a + 1));
        }
    }
    let supports = (0..4).map(|hoek| vast(id(0, hoek))).collect();
    let mut loads = Vec::new();
    for laag in 1..3 {
        loads.push(last(loads.len() + 1, id(laag, 0), 15.0, 0.0, 0.0));
        for hoek in 0..4 { loads.push(last(loads.len() + 1, id(laag, hoek), 0.0, 0.0, -80.0)); }
    }
    let mut req = verzoek(
        nodes,
        vec![doorsnede(1, 0.0064, 3e-5, 3e-7), doorsnede(2, 0.003, 8e-6, 1e-7), doorsnede(3, 0.0005, 5e-8, 1e-7)],
        members, supports, loads,
    );
    req.diaphragms = (1..3).map(|laag| Diaphragm3D { id: laag, node_ids: (0..4).map(|h| id(laag, h)).collect() }).collect();
    req.analysis = AnalysisKind::PDelta;
    req.buckling_modes = 1;
    let r = solve(req.clone()).unwrap();
    let samenvatting = r.second_order.as_ref().unwrap();
    assert!(samenvatting.converged && samenvatting.stable, "{samenvatting:?}");
    assert!(knikfactor(&r) > 1.0);
    let schaal = r.member_forces.iter().map(|f| f.n_start_kn.abs()).fold(1.0, f64::max);
    for (index, &(a, b)) in kruisen.iter().enumerate() {
        let (na, nb) = (normaalkracht(&r, a), normaalkracht(&r, b));
        assert!(na >= -1e-6 * schaal && nb >= -1e-6 * schaal, "geen trek-alleen staaf op druk: {na}, {nb}");
        // Gevels in X (hoek 0→1 en 2→3): de schuifkracht uit H (±18,75 kN per
        // diagonaal) overheerst de druk uit de kolomverkorting (≈ 4,5 kN), dus
        // precies één diagonaal draagt.
        if index % 2 == 0 {
            let inactief = [a, b].iter().filter(|s| r.inactive_members.contains(s)).count();
            assert_eq!(inactief, 1, "één diagonaal per kruis in de X-gevel valt weg: {a} ({na}), {b} ({nb})");
        }
    }
    for laag in 1..3 {
        let meester = verplaatsing(&r, id(laag, 0));
        for (hoek, &(x, y)) in hoeken.iter().enumerate() {
            let d = verplaatsing(&r, id(laag, hoek));
            dichtbij(d[0], meester[0] - y * meester[5], 1e-9, 1e-12, "starre schijf u");
            dichtbij(d[1], meester[1] + x * meester[5], 1e-9, 1e-12, "starre schijf v");
            dichtbij(d[5], meester[5], 1e-9, 1e-14, "starre schijf rotatie");
        }
    }
    let (kracht, moment) = krachten_en_momenten(&req, &r);
    for as_ in 0..3 { dichtbij(kracht[as_], 0.0, 0.0, 1e-8, "krachtensom"); }
    let tweede_orde = tweede_orde_moment(&req, &r);
    for as_ in 0..3 { dichtbij(moment[as_], tweede_orde[as_], 1e-6, 1e-8, "momentensom = Σ N·(e_x × Δu)"); }
}
