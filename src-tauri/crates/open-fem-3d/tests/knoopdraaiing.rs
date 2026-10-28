//! Scharnierende staafeinden op knopen zonder draaistijfheid (#96).
//!
//! Een staaf met My en Mz los aan beide einden (de knop Scharnierend) op
//! opleggingen die de draaiing vrijlaten, of alleen scharnierende staafeinden
//! in een knoop: de knoopdraaiing is onbepaald, maar constructief is er niets
//! mis. De adapter houdt die draaiing vast (module `knoopdraaiing`); de
//! uitkomsten volgen hier de klassieke handberekeningen. Een mechanisme dat
//! de belasting aanstoot, blijft een fout; een mechanisme dat zij niet
//! aanstoot, geeft sinds #195 een uitkomst met een melding.

use open_fem_3d::{
    solve, AnalysisKind, Bedding3D, BucklingSummary, EndReleases3D, GlobalDirection3D, Material3D, Member3D,
    MemberLoad3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D, SolveResult3D, Support3D,
};

type V3 = [f64; 3];

/// E in kN/m² (210 000 MPa) en Iy, Iz van de doorsnede: EIy = 1680 kNm².
const E: f64 = 210_000_000.0;
const IY: f64 = 8e-6;
const IZ: f64 = 12e-6;

fn doorsnede() -> Section3D {
    Section3D { id: 1, name: "proef".into(), area_m2: 0.01, iy_m4: IY, iz_m4: IZ,
        torsion_j_m4: 5e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

fn staaf(id: usize, begin: usize, eind: usize) -> Member3D {
    Member3D {
        id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: 1,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![],
        tension_only: false, bedding: None, part_section_ids: None,
    }
}

/// De knop Scharnierend: My en Mz los aan beide einden, torsie gaat over.
const SCHARNIEREND: EndReleases3D = EndReleases3D {
    my_start: true, my_end: true, mz_start: true, mz_end: true, torsion_start: false, torsion_end: false,
};

fn scharnierend(mut s: Member3D) -> Member3D {
    s.releases = SCHARNIEREND;
    s
}

/// Scharnieroplegging: translaties vast, alle draaiingen vrij.
fn scharnier(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, ..Default::default() }
}

fn inklemming(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }
}

fn steun(node_id: usize, v: [bool; 6]) -> Support3D {
    Support3D { node_id, ux: v[0], uy: v[1], uz: v[2], rx: v[3], ry: v[4], rz: v[5], ..Default::default() }
}

fn verzoek(nodes: Vec<Node3D>, members: Vec<Member3D>, supports: Vec<Support3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: E / 1000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![doorsnede()], members, supports, nodal_loads: vec![], member_loads: vec![],
        member_point_loads: vec![], thermal_loads: vec![], plates: vec![], shell_elements: vec![],
        surface_loads: vec![], diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 100, tolerance: 1e-10, buckling_modes: 0,
    }
}

/// Gelijkmatige last in lokaal z (bij een liggende staaf verticaal).
fn q_lokaal(id: usize, member_id: usize, qz: f64) -> MemberLoad3D {
    MemberLoad3D { id, member_id, qz_start_kn_per_m: qz, qz_end_kn_per_m: qz, ..Default::default() }
}

fn knooplast(id: usize, node_id: usize, f: [f64; 6]) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx: f[0], fy: f[1], fz: f[2], mx: f[3], my: f[4], mz: f[5] }
}

/// Vergelijk met de handberekening; de gemeten afwijking staat in de
/// testuitvoer (`cargo test -- --nocapture`).
fn dicht(actual: f64, expected: f64, relatief: f64, absoluut: f64, wat: &str) {
    let verschil = (actual - expected).abs();
    let relatief_gemeten = if expected != 0.0 { verschil / expected.abs() } else { f64::NAN };
    eprintln!("{wat}: berekend {actual:.9e}, verwacht {expected:.9e}, verschil {verschil:.2e} (relatief {relatief_gemeten:.2e})");
    assert!(verschil <= absoluut.max(expected.abs() * relatief),
        "{wat}: {actual:.12e} in plaats van {expected:.12e} (verschil {verschil:.3e})");
}

fn reactie(r: &SolveResult3D, id: usize) -> &open_fem_3d::Reaction3D {
    r.reactions.iter().find(|x| x.node_id == id).unwrap_or_else(|| panic!("geen reactie in knoop {id}: {:?}", r.reactions))
}

fn verplaatsing(r: &SolveResult3D, id: usize) -> &open_fem_3d::Displacement3D {
    r.displacements.iter().find(|x| x.node_id == id).unwrap()
}

fn krachten(r: &SolveResult3D, id: usize) -> &open_fem_3d::MemberForces3D {
    r.member_forces.iter().find(|x| x.member_id == id).unwrap()
}

/// Waarde van een snedekrachtlijn op plaats t (een bemonsterd punt).
fn lijn(reeks: &[open_fem_3d::MemberDiagram3D], member_id: usize, t: f64) -> f64 {
    let lijn = reeks.iter().find(|d| d.member_id == member_id).unwrap();
    lijn.points.iter().find(|p| (p.t - t).abs() < 1e-9).unwrap_or_else(|| panic!("geen punt op t = {t}")).value
}

fn cross(a: V3, b: V3) -> V3 { [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }

/// Kracht- en momentensom (om de oorsprong) van de reacties en de gegeven
/// uitwendige lasten (punt, kracht, moment); beide horen nul te zijn.
fn evenwicht(r: &SolveResult3D, nodes: &[Node3D], lasten: &[(V3, V3, V3)]) -> (f64, f64) {
    let punt = |id: usize| { let k = nodes.iter().find(|k| k.id == id).unwrap(); [k.x, k.y, k.z] };
    let mut f = [0.0; 3];
    let mut m = [0.0; 3];
    let mut tel = |p: V3, kracht: V3, moment: V3| {
        let arm = cross(p, kracht);
        for a in 0..3 {
            f[a] += kracht[a];
            m[a] += arm[a] + moment[a];
        }
    };
    for x in &r.reactions { tel(punt(x.node_id), [x.fx, x.fy, x.fz], [x.mx, x.my, x.mz]); }
    for (p, kracht, moment) in lasten { tel(*p, *kracht, *moment); }
    (f.iter().map(|x| x.abs()).fold(0.0, f64::max), m.iter().map(|x| x.abs()).fold(0.0, f64::max))
}

fn vrije_knoopdraaiing(r: &SolveResult3D) -> bool {
    r.diagnostics.iter().any(|m| m.starts_with("Vrije knoopdraaiing"))
}

/// Spec 1: ligger 6 m, scharnierend aan beide einden, op twee
/// scharnieropleggingen (alle draaiingen vrij), gelijkmatige last:
/// M midden = qL²/8, M einden = 0, reacties qL/2; met een tussenknoop in het
/// midden ook de doorbuiging 5qL⁴/(384EI). Langs X en schuin in het plan,
/// lineair en tweede orde.
#[test]
fn scharnierende_ligger_op_twee_scharnieropleggingen() {
    let (l, q) = (6.0, 5.0);
    for (richting, d) in [("langs X", [1.0, 0.0, 0.0]), ("schuin in het plan", [0.6, 0.8, 0.0])] {
        for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
            for midden in [false, true] {
                let geval = format!("{richting}, {analyse:?}, tussenknoop {midden}");
                let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l * d[0], l * d[1], 0.0)];
                let mut ligger = scharnierend(staaf(1, 1, 2));
                if midden {
                    nodes.push(knoop(3, l / 2.0 * d[0], l / 2.0 * d[1], 0.0));
                    ligger.intermediate_node_ids = vec![3];
                }
                let mut r = verzoek(nodes.clone(), vec![ligger], vec![scharnier(1), scharnier(2)]);
                r.analysis = analyse;
                r.member_loads.push(q_lokaal(1, 1, -q));
                let uit = solve(r).unwrap_or_else(|fout| panic!("{geval}: {fout}"));

                // Reacties qL/2, alleen in de twee opleggingen en zonder momenten.
                assert_eq!(uit.reactions.len(), 2, "{geval}: {:?}", uit.reactions);
                for id in [1, 2] {
                    let x = reactie(&uit, id);
                    dicht(x.fz, q * l / 2.0, 1e-10, 1e-10, &format!("{geval}: Fz in knoop {id}"));
                    assert!(x.fx.abs() < 1e-9 && x.fy.abs() < 1e-9, "{geval}: {x:?}");
                    assert!(x.mx == 0.0 && x.my == 0.0 && x.mz == 0.0, "{geval}: kunstmatige reactie in de uitvoer {x:?}");
                }
                // M midden qL²/8, einden 0; geen torsie en geen buiging om lokaal z.
                dicht(lijn(&uit.diagrams.moment_y, 1, 0.5).abs(), q * l * l / 8.0, 1e-9, 1e-9, &format!("{geval}: M midden"));
                for t in [0.0, 1.0] {
                    assert!(lijn(&uit.diagrams.moment_y, 1, t).abs() < 1e-9, "{geval}: M op t = {t}");
                }
                let f = krachten(&uit, 1);
                for m in [f.my_start_knm, f.my_end_knm, f.mz_start_knm, f.mz_end_knm, f.torsion_start_knm, f.torsion_end_knm] {
                    assert!(m.abs() < 1e-9, "{geval}: eindmoment {f:?}");
                }
                if midden {
                    let w = verplaatsing(&uit, 3).uz;
                    dicht(w, -5.0 * q * l.powi(4) / (384.0 * E * IY), 1e-9, 1e-12, &format!("{geval}: doorbuiging midden"));
                }
                // De knoopdraaiingen zijn onbepaald en in de uitvoer nul.
                for v in &uit.displacements {
                    if v.node_id == 3 { continue; }
                    assert!(v.rx.abs() < 1e-12 && v.ry.abs() < 1e-12 && v.rz.abs() < 1e-12, "{geval}: {v:?}");
                }
                // Evenwicht: krachten en momenten om de oorsprong.
                let resultante = ([l / 2.0 * d[0], l / 2.0 * d[1], 0.0], [0.0, 0.0, -q * l], [0.0; 3]);
                let (df, dm) = evenwicht(&uit, &nodes, &[resultante]);
                assert!(df < 1e-9 && dm < 1e-9, "{geval}: evenwicht {df:e} {dm:e}");
                assert!(uit.equilibrium.as_ref().is_some_and(|e| e.equilibrium_ok), "{geval}");
                // Een melding over de vastgehouden draaiing, geen over de opleggingen.
                assert!(vrije_knoopdraaiing(&uit), "{geval}: {:?}", uit.diagnostics);
                assert!(!uit.diagnostics.iter().any(|m| m.contains("Opleggingen")), "{geval}: {:?}", uit.diagnostics);
                if analyse == AnalysisKind::PDelta {
                    assert!(uit.second_order.as_ref().is_some_and(|s| s.converged), "{geval}");
                }
            }
        }
    }
}

/// Spec 2: portaal met ingeklemde kolomvoeten en een scharnierend
/// aangesloten ligger. De kolomkoppen hebben draaistijfheid van de kolommen:
/// de regel doet hier niets (geen melding) en de uitkomst is de bekende
/// (My 0 / 45 / 0 kNm, kolommen zonder moment). Ook tweede orde en knik.
#[test]
fn portaal_met_scharnierende_ligger_blijft_gelijk() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)];
    let maak = |analyse: AnalysisKind| {
        let mut r = verzoek(
            nodes.clone(),
            vec![staaf(1, 1, 3), staaf(2, 2, 4), scharnierend(staaf(3, 3, 4))],
            vec![inklemming(1), inklemming(2)],
        );
        r.member_loads.push(q_lokaal(1, 3, -10.0));
        r.analysis = analyse;
        r.buckling_modes = 2;
        r
    };
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let uit = solve(maak(analyse)).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        assert!(!vrije_knoopdraaiing(&uit), "de regel hoort hier niets te doen: {:?}", uit.diagnostics);
        dicht(lijn(&uit.diagrams.moment_y, 3, 0.5).abs(), 45.0, 1e-9, 1e-9, "M midden ligger");
        for t in [0.0, 1.0] { assert!(lijn(&uit.diagrams.moment_y, 3, t).abs() < 1e-9, "M ligger op t = {t}"); }
        for kolom in [1, 2] {
            let f = krachten(&uit, kolom);
            dicht(f.n_start_kn, -30.0, 1e-9, 1e-9, "N kolom (druk)");
            for m in [f.my_start_knm, f.my_end_knm, f.mz_start_knm, f.mz_end_knm] {
                assert!(m.abs() < 1e-9, "{analyse:?}: kolom {kolom} {f:?}");
            }
        }
        for id in [1, 2] {
            let x = reactie(&uit, id);
            dicht(x.fz, 30.0, 1e-10, 1e-10, "Fz voet");
            assert!(x.my.abs() < 1e-9, "{analyse:?}: {x:?}");
        }
        assert!(matches!(uit.buckling, BucklingSummary::Available { .. }), "{analyse:?}: {:?}", uit.buckling);
        if analyse == AnalysisKind::PDelta {
            assert!(uit.second_order.as_ref().is_some_and(|s| s.converged && s.stable));
        }
    }
}

/// Spec 3: twee liggers scharnierend verbonden in een vrije tussenknoop, met
/// ingeklemde buiteneinden: twee consoles met een scharnier. Een puntlast P
/// in het scharnier verdeelt zich naar de tipstijfheden 3EI/L³:
/// L1 = 4 en L2 = 2 m geven P1 = P/9 en P2 = 8P/9.
#[test]
fn twee_consoles_met_een_scharnier_in_een_vrije_tussenknoop() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 6.0, 0.0, 0.0)];
    let leden = || {
        let mut links = staaf(1, 1, 2);
        links.releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
        let mut rechts = staaf(2, 2, 3);
        rechts.releases = EndReleases3D { my_start: true, mz_start: true, ..Default::default() };
        vec![links, rechts]
    };
    let p = 9.0;
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let mut r = verzoek(nodes.clone(), leden(), vec![inklemming(1), inklemming(3)]);
        r.analysis = analyse;
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -p, 0.0, 0.0, 0.0]));
        let uit = solve(r).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        let (k1, k2) = (3.0 * E * IY / 64.0, 3.0 * E * IY / 8.0);
        let (p1, p2) = (p * k1 / (k1 + k2), p * k2 / (k1 + k2));
        dicht(p1, 1.0, 1e-12, 1e-12, "P1 = P/9");
        dicht(verplaatsing(&uit, 2).uz, -p / (k1 + k2), 1e-9, 1e-12, "zakking scharnier");
        dicht(reactie(&uit, 1).fz, p1, 1e-9, 1e-9, "R1");
        dicht(reactie(&uit, 3).fz, p2, 1e-9, 1e-9, "R3");
        dicht(reactie(&uit, 1).my.abs(), p1 * 4.0, 1e-9, 1e-9, "inklemmingsmoment links P1·L1");
        dicht(reactie(&uit, 3).my.abs(), p2 * 2.0, 1e-9, 1e-9, "inklemmingsmoment rechts P2·L2");
        dicht(krachten(&uit, 1).my_end_knm, 0.0, 0.0, 1e-9, "M scharnier links");
        dicht(krachten(&uit, 2).my_start_knm, 0.0, 0.0, 1e-9, "M scharnier rechts");
        // Het scharnier heeft geen oplegging: ook geen kunstmatige reactie.
        assert!(uit.reactions.iter().all(|x| x.node_id != 2), "{:?}", uit.reactions);
        let (df, dm) = evenwicht(&uit, &nodes, &[([4.0, 0.0, 0.0], [0.0, 0.0, -p], [0.0; 3])]);
        assert!(df < 1e-9 && dm < 1e-9, "evenwicht {df:e} {dm:e}");
        assert!(vrije_knoopdraaiing(&uit), "{:?}", uit.diagnostics);
    }

    // Een moment om de staafas (X) in het scharnier: de torsie van beide
    // staven neemt het op, verdeeld naar GJ/L: T1 = M/3 en T2 = 2M/3.
    let mut r = verzoek(nodes.clone(), leden(), vec![inklemming(1), inklemming(3)]);
    r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, 0.0, 6.0, 0.0, 0.0]));
    let uit = solve(r).unwrap();
    dicht(krachten(&uit, 1).torsion_end_knm.abs(), 2.0, 1e-9, 1e-9, "torsie links");
    dicht(krachten(&uit, 2).torsion_start_knm.abs(), 4.0, 1e-9, 1e-9, "torsie rechts");

    // Een moment om Y of Z in het scharnier neemt niets op: een mechanisme,
    // lineair en in de tweede orde, met en zonder normaalkracht (de controle
    // op de kunstmatige reacties zit in beide rekenpaden).
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        for fx in [0.0, -20.0] {
            for (as_, f) in [("Y", [fx, 0.0, -3.0, 0.0, 6.0, 0.0]), ("Z", [fx, 0.0, -3.0, 0.0, 0.0, 6.0])] {
                let geval = format!("{analyse:?}, Fx = {fx}, moment om {as_}");
                let mut r = verzoek(nodes.clone(), leden(), vec![inklemming(1), inklemming(3)]);
                r.analysis = analyse;
                r.nodal_loads.push(knooplast(1, 2, f));
                let fout = solve(r).expect_err(&geval);
                assert!(fout.contains("het model is een mechanisme") && fout.contains("In knoop 2"), "{geval}: {fout}");
                assert!(fout.contains(&format!("6,000 kNm om {as_} in knoop 2")), "{geval}: {fout}");
            }
        }
    }
}

/// Spec 4: dezelfde twee liggers met scharnieropleggingen aan de
/// buiteneinden: drie scharnieren op een lijn, een echt mechanisme.
#[test]
fn drie_scharnieren_op_een_lijn_blijven_een_mechanisme() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 6.0, 0.0, 0.0)];
    let mut links = staaf(1, 1, 2);
    links.releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
    let mut rechts = staaf(2, 2, 3);
    rechts.releases = EndReleases3D { my_start: true, mz_start: true, ..Default::default() };
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        for last in ["knoop", "staaf"] {
            let mut r = verzoek(nodes.clone(), vec![links.clone(), rechts.clone()], vec![scharnier(1), scharnier(3)]);
            r.analysis = analyse;
            if last == "knoop" {
                r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -9.0, 0.0, 0.0, 0.0]));
            } else {
                r.member_loads.push(q_lokaal(1, 1, -5.0));
                r.member_loads.push(q_lokaal(2, 2, -5.0));
            }
            let fout = solve(r).unwrap_err();
            assert!(fout.contains("mechanisme"), "{analyse:?}, last op {last}: {fout}");
        }
    }
    // Twee vakwerkstaven op één lijn tussen twee inklemmingen: de tussenknoop
    // kan dwars op de lijn bewegen. De kern meldt een singuliere matrix; de
    // opleggingen houden het deel vast, dus het is een intern mechanisme.
    let fout = solve({
        let mut r = verzoek(nodes.clone(), vec![scharnierend(staaf(1, 1, 2)), scharnierend(staaf(2, 2, 3))],
            vec![inklemming(1), inklemming(3)]);
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -9.0, 0.0, 0.0, 0.0]));
        r
    }).unwrap_err();
    assert!(fout.contains("singuliere stijfheidsmatrix") && fout.contains("intern mechanisme"), "{fout}");
}

/// Een staaf van `a` naar `b`, in `delen` stukken geknipt met tussenknopen
/// vanaf id `*volgende`.
fn geknipt(mut s: Member3D, nodes: &mut Vec<Node3D>, delen: usize, volgende: &mut usize) -> Member3D {
    let punt = |id: usize, nodes: &Vec<Node3D>| { let k = nodes.iter().find(|k| k.id == id).unwrap(); [k.x, k.y, k.z] };
    let (a, b) = (punt(s.start_node_id, nodes), punt(s.end_node_id, nodes));
    for i in 1..delen {
        let t = i as f64 / delen as f64;
        nodes.push(knoop(*volgende, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])));
        s.intermediate_node_ids.push(*volgende);
        *volgende += 1;
    }
    s
}

/// Een mechanisme mét translaties dat de belasting niet aanstoot. De regel
/// legt alleen de vrije knoopdraaiingen vast; daarna is de stijfheidsmatrix
/// nog singulier. Tot #195 was dat altijd een fout. Sinds #195 volgt de regel
/// dezelfde afspraak als elk ander mechanisme (module `mechanisme`): stoot de
/// belasting het niet aan, dan een uitkomst met een melding die de beweging
/// noemt; stoot zij het wel aan, dan een fout. Verantwoording per geval:
/// - een vierstangenmechanisme (grond als vierde stang), 6 × 4 m, met
///   scharnierende voeten en staafeinden, de koppen alleen buiten het vlak
///   gesteund, in delen geknipt, onder alleen verticale last: het raam kan
///   zwaaien, de last werkt loodrecht op die beweging. Lineair, met en zonder
///   knik: een uitkomst met de melding (de kolommen dragen elk 50 kN, het raam
///   staat lood). In de tweede orde maken de drukkrachten het zwaaien
///   instabiel: nog steeds een fout;
/// - het trek-alleen raam onder alleen een verticale last op de ligger: beide
///   diagonalen vallen weg en het raam kan zwaaien, maar de last stoot dat
///   niet aan: een uitkomst met beide diagonalen inactief en de melding;
/// - drie scharnieren op een lijn, in acht delen per staaf, onder alleen een
///   axiale last: de tussenknoop kan dwars bewegen (in Y en in Z), de last
///   werkt langs de lijn: een uitkomst met de melding; de last verdeelt zich
///   naar de axiale stijfheden over beide staven.
#[test]
fn mechanisme_dat_de_belasting_niet_aanstoot_geeft_een_melding() {
    let melding = |geval: &str, uit: &SolveResult3D, beweging: &str| {
        let tekst = uit.diagnostics.iter().find(|m| m.starts_with("Mechanisme:"))
            .unwrap_or_else(|| panic!("{geval}: geen melding {:?}", uit.diagnostics));
        assert!(tekst.contains(beweging), "{geval}: {tekst}");
    };
    let y = [false, true, false, false, false, false];
    for delen in [2, 6] {
        for (analyse, knik) in [(AnalysisKind::Linear, 0), (AnalysisKind::Linear, 1), (AnalysisKind::PDelta, 0)] {
            let geval = format!("portaal, {delen} delen, {analyse:?}, knik {knik}");
            let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)];
            let mut volgende = 100;
            let leden = [(1, 1, 3), (2, 2, 4), (3, 3, 4)].map(|(id, a, b)| geknipt(scharnierend(staaf(id, a, b)), &mut nodes, delen, &mut volgende));
            let mut r = verzoek(nodes, leden.to_vec(), vec![scharnier(1), scharnier(2), steun(3, y), steun(4, y)]);
            r.analysis = analyse;
            r.buckling_modes = knik;
            r.nodal_loads.push(knooplast(1, 3, [0.0, 0.0, -50.0, 0.0, 0.0, 0.0]));
            r.nodal_loads.push(knooplast(2, 4, [0.0, 0.0, -50.0, 0.0, 0.0, 0.0]));
            if analyse == AnalysisKind::PDelta {
                let fout = solve(r).expect_err(&geval);
                assert!(fout.contains("het model is een mechanisme") && fout.contains("intern mechanisme"), "{geval}: {fout}");
                assert!(fout.contains("niet positief definiet") && fout.contains("bewegen in X"), "{geval}: {fout}");
                continue;
            }
            let uit = solve(r).unwrap_or_else(|fout| panic!("{geval}: {fout}"));
            melding(&geval, &uit, "kunnen samen bewegen in X");
            assert!(vrije_knoopdraaiing(&uit), "{geval}: {:?}", uit.diagnostics);
            dicht(reactie(&uit, 1).fz, 50.0, 1e-9, 1e-9, "R1");
            dicht(reactie(&uit, 2).fz, 50.0, 1e-9, 1e-9, "R2");
            for id in [3, 4] { dicht(verplaatsing(&uit, id).ux, 0.0, 0.0, 1e-14, "geen zwaai"); }
        }
    }

    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)];
    let diagonaal = |id, a, b| { let mut s = scharnierend(staaf(id, a, b)); s.tension_only = true; s };
    let mut r = verzoek(
        nodes,
        vec![staaf(1, 1, 3), staaf(2, 2, 4), scharnierend(staaf(3, 3, 4)), diagonaal(5, 1, 4), diagonaal(6, 2, 3)],
        vec![scharnier(1), scharnier(2), steun(3, y), steun(4, y)],
    );
    r.member_loads.push(q_lokaal(1, 3, -10.0));
    let uit = solve(r).unwrap_or_else(|fout| panic!("trek-alleen raam: {fout}"));
    assert_eq!(uit.inactive_members, vec![5, 6], "{:?}", uit.diagnostics);
    melding("trek-alleen raam", &uit, "knopen 3 en 4 kunnen samen bewegen in X");
    dicht(reactie(&uit, 1).fz.abs(), 30.0, 1e-9, 1e-9, "trek-alleen raam: R1");

    let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 6.0, 0.0, 0.0)];
    let mut volgende = 100;
    let mut links = staaf(1, 1, 2);
    links.releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
    let mut rechts = staaf(2, 2, 3);
    rechts.releases = EndReleases3D { my_start: true, mz_start: true, ..Default::default() };
    let links = geknipt(links, &mut nodes, 8, &mut volgende);
    let rechts = geknipt(rechts, &mut nodes, 8, &mut volgende);
    let mut r = verzoek(nodes, vec![links, rechts], vec![scharnier(1), scharnier(3)]);
    r.nodal_loads.push(knooplast(1, 2, [9.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    let uit = solve(r).unwrap_or_else(|fout| panic!("drie scharnieren: {fout}"));
    // Twee bewegingen: de tussenknoop en de rekenknopen dwars in Y en in Z.
    melding("drie scharnieren", &uit, "2 vrije bewegingen");
    melding("drie scharnieren", &uit, "kunnen samen bewegen in Z");
    melding("drie scharnieren", &uit, "kunnen samen bewegen in Y");
    dicht(krachten(&uit, 1).n_start_kn.abs() + krachten(&uit, 2).n_start_kn.abs(), 9.0, 1e-9, 1e-9, "drie scharnieren: N");
}

/// De grens voor de kunstmatige reacties is afrondingsruis. Een wringend
/// moment van 0,03 kNm op een scharnierende ligger die vrij om haar as kan
/// draaien, naast een losse ingeklemde kolom onder 2000 kN: het moment mag
/// niet onder een grens ten opzichte van de kolomlast verdwijnen, het is een
/// mechanisme. Zonder het moment rekent hetzelfde model.
#[test]
fn klein_wringend_moment_naast_een_zware_kolom() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 30.0, 0.0, 0.0), knoop(4, 30.0, 0.0, 20.0)];
    let model = |mx: f64| {
        let mut r = verzoek(nodes.clone(), vec![scharnierend(staaf(1, 1, 2)), staaf(2, 3, 4)],
            vec![scharnier(1), scharnier(2), inklemming(3)]);
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -1.0, mx, 0.0, 0.0]));
        r.nodal_loads.push(knooplast(2, 4, [0.0, 0.0, -2000.0, 0.0, 0.0, 0.0]));
        r
    };
    let fout = solve(model(0.03)).unwrap_err();
    assert!(fout.contains("het model is een mechanisme") && fout.contains("0,030 kNm om X"), "{fout}");
    let uit = solve(model(0.0)).unwrap();
    dicht(reactie(&uit, 2).fz, 1.0, 1e-9, 1e-9, "R2");
    dicht(reactie(&uit, 3).fz, 2000.0, 1e-9, 1e-9, "R kolom");
    assert!(vrije_knoopdraaiing(&uit), "{:?}", uit.diagnostics);
}

/// Alleen My los aan beide einden, op scharnieropleggingen: de regel volgt de
/// lokale assen van de kern, met de rolhoek. Zonder rolhoek buigt een last in
/// lokaal z om lokaal y, dat aan de einden vrij is: M midden = qL²/8. Met een
/// rolhoek van 90° ligt lokaal y verticaal; een last in lokaal y buigt om
/// lokaal z, dat aan de einden momentvast is, maar de knopen hebben verder
/// geen draaistijfheid: ook dan qL²/8, einden 0 en verticale reacties qL/2.
#[test]
fn alleen_my_los_met_en_zonder_rolhoek() {
    let (l, q) = (6.0, 5.0);
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)];
    for rol in [None, Some(std::f64::consts::FRAC_PI_2)] {
        let mut ligger = staaf(1, 1, 2);
        ligger.roll_angle_rad = rol;
        ligger.releases = EndReleases3D { my_start: true, my_end: true, ..Default::default() };
        let mut r = verzoek(nodes.clone(), vec![ligger], vec![scharnier(1), scharnier(2)]);
        let mut last = MemberLoad3D { id: 1, member_id: 1, ..Default::default() };
        if rol.is_some() {
            (last.qy_start_kn_per_m, last.qy_end_kn_per_m) = (-q, -q);
        } else {
            (last.qz_start_kn_per_m, last.qz_end_kn_per_m) = (-q, -q);
        }
        r.member_loads.push(last);
        let uit = solve(r).unwrap_or_else(|fout| panic!("rol {rol:?}: {fout}"));
        let lijnen = if rol.is_some() { &uit.diagrams.moment_z } else { &uit.diagrams.moment_y };
        dicht(lijn(lijnen, 1, 0.5).abs(), q * l * l / 8.0, 1e-9, 1e-9, &format!("rol {rol:?}: M midden"));
        for t in [0.0, 1.0] {
            assert!(lijn(lijnen, 1, t).abs() < 1e-9, "rol {rol:?}: M op t = {t}");
        }
        for id in [1, 2] {
            let x = reactie(&uit, id);
            dicht(x.fz.abs(), q * l / 2.0, 1e-9, 1e-9, &format!("rol {rol:?}: Fz in knoop {id}"));
            assert!(x.fx.abs() < 1e-9 && x.fy.abs() < 1e-9 && x.mx == 0.0 && x.my == 0.0 && x.mz == 0.0, "rol {rol:?}: {x:?}");
        }
        assert!(vrije_knoopdraaiing(&uit), "rol {rol:?}: {:?}", uit.diagnostics);
    }
}

/// Torsie aan één einde los: een console van 2 m met de torsie alleen aan het
/// vrije einde vrijgegeven, één keer als eindknoop en één keer als
/// beginknoop. De staaf draagt geen torsie; de top draait vrij om de staafas
/// en die draaiing houdt de regel vast. De console rekent als altijd:
/// zakking qL⁴/(8EI), inklemmingsmoment qL²/2.
#[test]
fn torsie_aan_een_einde_los() {
    let (l, q) = (2.0, 4.0);
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)];
    for (naam, begin, eind, vrijgave) in [
        ("eind", 1, 2, EndReleases3D { torsion_end: true, ..Default::default() }),
        ("begin", 2, 1, EndReleases3D { torsion_start: true, ..Default::default() }),
    ] {
        let mut console = staaf(1, begin, eind);
        console.releases = vrijgave;
        let mut r = verzoek(nodes.clone(), vec![console], vec![inklemming(1)]);
        r.member_loads.push(q_lokaal(1, 1, -q));
        let uit = solve(r).unwrap_or_else(|fout| panic!("torsie los aan het {naam}: {fout}"));
        dicht(verplaatsing(&uit, 2).uz.abs(), q * l.powi(4) / (8.0 * E * IY), 1e-9, 1e-14, &format!("{naam}: tipzakking"));
        dicht(reactie(&uit, 1).my.abs(), q * l * l / 2.0, 1e-9, 1e-9, &format!("{naam}: inklemmingsmoment"));
        assert!(uit.diagnostics.iter().any(|m| m.starts_with("Vrije knoopdraaiing in knoop 2")), "{naam}: {:?}", uit.diagnostics);
    }
}

/// De knoopdraaiing in de uitvoer bevat het onbepaalde deel niet. Een schuine
/// console (in het plan langs (0,6; 0,8; 0)), ingeklemd, met My los aan de
/// top, en een wringend moment langs de staafas op de top. Torsie en buiging
/// zijn ontkoppeld: de top draait alleen om de staafas, precies als dezelfde
/// console zonder vrijgave. De regel houdt de vrije draaiing om lokaal y vast
/// met een globale draaiblokkering; zonder de projectie zou die blokkering
/// een deel van de torsiedraaiing in de uitvoer verschuiven.
#[test]
fn knoopdraaiing_in_de_uitvoer_zonder_onbepaald_deel() {
    let (l, t) = (5.0, 3.0);
    let ex = [0.6, 0.8, 0.0];
    let model = |los: bool| {
        let mut console = staaf(1, 1, 2);
        if los { console.releases = EndReleases3D { my_end: true, ..Default::default() }; }
        let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l * ex[0], l * ex[1], 0.0)], vec![console], vec![inklemming(1)]);
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, 0.0, t * ex[0], t * ex[1], 0.0]));
        solve(r).unwrap_or_else(|fout| panic!("los {los}: {fout}"))
    };
    let (vast, los) = (model(false), model(true));
    assert!(!vrije_knoopdraaiing(&vast) && vrije_knoopdraaiing(&los), "{:?}", los.diagnostics);
    let draaiing = |r: &SolveResult3D| { let d = verplaatsing(r, 2); [d.rx, d.ry, d.rz] };
    let (a, b) = (draaiing(&vast), draaiing(&los));
    // Analytisch: θ = T·L/(G·J) langs de staafas.
    let g = E / (2.0 * 1.3);
    let theta = t * l / (g * 5e-6);
    for i in 0..3 {
        dicht(a[i], theta * ex[i], 1e-9, 1e-15, &format!("zonder vrijgave, as {i}"));
        dicht(b[i], theta * ex[i], 1e-9, 1e-15, &format!("met My los, as {i}"));
    }
}

/// Spec 5: een ruimtevakwerk (tetraëder) met alle staven scharnierend aan
/// beide einden. Statisch bepaald opgelegd (A: X, Y, Z; B: Y, Z; C: Z); last
/// (6, 8, −10) kN in de top D. Knooppuntmethode:
/// D: N_DB = −7,5, N_DC = −10, N_DA = 0,5; C: N_CB = 0, N_CA = 8;
/// B: N_BA = 6; reacties A (−6; −8; −0,5), B (0; 0; 4,5), C (0; 0; 6).
#[test]
fn ruimtevakwerk_volgt_de_knooppuntmethode() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 0.0, 4.0, 0.0), knoop(4, 0.0, 0.0, 3.0)];
    let leden = vec![(1, 1, 2, 6.0), (2, 1, 3, 8.0), (3, 1, 4, 0.5), (4, 2, 3, 0.0), (5, 2, 4, -7.5), (6, 3, 4, -10.0)];
    let last = [6.0, 8.0, -10.0];
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let mut r = verzoek(
            nodes.clone(),
            leden.iter().map(|&(id, a, b, _)| scharnierend(staaf(id, a, b))).collect(),
            vec![steun(1, [true, true, true, false, false, false]), steun(2, [false, true, true, false, false, false]),
                steun(3, [false, false, true, false, false, false])],
        );
        r.analysis = analyse;
        r.buckling_modes = 1;
        r.nodal_loads.push(knooplast(1, 4, [last[0], last[1], last[2], 0.0, 0.0, 0.0]));
        let uit = solve(r).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        let lineair = analyse == AnalysisKind::Linear;
        for &(id, _, _, n) in &leden {
            let f = krachten(&uit, id);
            // Tweede orde: de normaalkrachten veranderen iets door de verplaatsingen.
            let grens = if lineair { 1e-9 } else { 1e-3 };
            dicht(f.n_start_kn, n, grens, grens, &format!("{analyse:?}: N staaf {id}"));
            for m in [f.my_start_knm, f.my_end_knm, f.mz_start_knm, f.mz_end_knm, f.torsion_start_knm, f.torsion_end_knm] {
                assert!(m.abs() < 1e-9, "{analyse:?}: buiging of torsie in staaf {id}: {f:?}");
            }
        }
        if lineair {
            for (id, verwacht) in [(1, [-6.0, -8.0, -0.5]), (2, [0.0, 0.0, 4.5]), (3, [0.0, 0.0, 6.0])] {
                let x = reactie(&uit, id);
                for (a, w) in [x.fx, x.fy, x.fz].into_iter().enumerate() {
                    dicht(w, verwacht[a], 1e-9, 1e-9, &format!("reactie {id} as {a}"));
                }
                assert!(x.mx == 0.0 && x.my == 0.0 && x.mz == 0.0, "kunstmatige reactie {x:?}");
            }
            assert_eq!(uit.reactions.len(), 3, "{:?}", uit.reactions);
            let (df, dm) = evenwicht(&uit, &nodes, &[([0.0, 0.0, 3.0], last, [0.0; 3])]);
            assert!(df < 1e-9 && dm < 1e-9, "evenwicht {df:e} {dm:e}");
        } else {
            assert!(uit.second_order.as_ref().is_some_and(|s| s.converged), "{:?}", uit.second_order);
        }
        assert!(!matches!(uit.buckling, BucklingSummary::Failed { .. }), "{analyse:?}: {:?}", uit.buckling);
        assert!(vrije_knoopdraaiing(&uit), "{:?}", uit.diagnostics);
    }
}

/// Spec 5: een vlakke vakwerkligger (X-Z-vlak), buiten het vlak in elke knoop
/// gesteund. P = 12 kN in het midden van de onderrand. Knooppuntmethode:
/// onderrand 4,5, bovenrand −9, eindschoren −7,5, middenschoren 7,5.
#[test]
fn vlakke_vakwerkligger_volgt_de_knooppuntmethode() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.0, 0.0, 0.0), knoop(3, 6.0, 0.0, 0.0),
        knoop(4, 1.5, 0.0, 2.0), knoop(5, 4.5, 0.0, 2.0)];
    let leden = [(1, 1, 2, 4.5), (2, 2, 3, 4.5), (3, 4, 5, -9.0), (4, 1, 4, -7.5), (5, 4, 2, 7.5), (6, 2, 5, 7.5), (7, 5, 3, -7.5)];
    let y = [false, true, false, false, false, false];
    let mut r = verzoek(
        nodes.clone(),
        leden.iter().map(|&(id, a, b, _)| scharnierend(staaf(id, a, b))).collect(),
        vec![steun(1, [true, true, true, false, false, false]), steun(3, [false, true, true, false, false, false]),
            steun(2, y), steun(4, y), steun(5, y)],
    );
    r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -12.0, 0.0, 0.0, 0.0]));
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let mut r = r.clone();
        r.analysis = analyse;
        r.buckling_modes = 1;
        let uit = solve(r).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        let grens = if analyse == AnalysisKind::Linear { 1e-9 } else { 1e-3 };
        for &(id, _, _, n) in &leden {
            let f = krachten(&uit, id);
            dicht(f.n_start_kn, n, grens, grens, &format!("{analyse:?}: N staaf {id}"));
            assert!([f.my_start_knm, f.my_end_knm, f.mz_start_knm, f.mz_end_knm, f.torsion_start_knm].iter().all(|m| m.abs() < 1e-9),
                "{analyse:?}: staaf {id} {f:?}");
        }
        dicht(reactie(&uit, 1).fz, 6.0, 1e-9, 1e-9, "R1");
        dicht(reactie(&uit, 3).fz, 6.0, 1e-9, 1e-9, "R3");
        assert!(!matches!(uit.buckling, BucklingSummary::Failed { .. }), "{analyse:?}: {:?}", uit.buckling);
    }
}

/// Spec 6: een schuine staaf (in plan en helling) scharnierend op een knoop.
/// Knoop 2 hangt aan twee schuine consoles (assen e_a en e_b, ingeklemd in
/// knoop 1 en 3), beide met My en Mz los in knoop 2. De torsie van beide
/// consoles houdt de draaiing van knoop 2 om e_a en e_b vast; vrij blijft
/// alleen de schuine richting n = e_a × e_b ∥ (3; 4; −3). De doorsnede is
/// rond (Iy = Iz): een console is in knoop 2 een veer 3EI/L³ dwars op zijn as
/// en EA/L langs zijn as; de verplaatsing volgt uit (K_a + K_b)·u = P.
#[test]
fn schuine_staaf_scharnierend_op_een_knoop() {
    let ea = [2.0 / 7.0, 3.0 / 7.0, 6.0 / 7.0];
    let eb = [6.0 / 7.0, -3.0 / 7.0, 2.0 / 7.0];
    let (la, lb) = (3.5, 7.0);
    let nodes = vec![
        knoop(1, -la * ea[0], -la * ea[1], -la * ea[2]),
        knoop(2, 0.0, 0.0, 0.0),
        knoop(3, lb * eb[0], lb * eb[1], lb * eb[2]),
    ];
    let model = |last: [f64; 6]| {
        let mut a = staaf(1, 1, 2);
        a.releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
        let mut b = staaf(2, 2, 3);
        b.releases = EndReleases3D { my_start: true, mz_start: true, ..Default::default() };
        let mut r = verzoek(nodes.clone(), vec![a, b], vec![inklemming(1), inklemming(3)]);
        r.sections[0].iz_m4 = IY;
        r.nodal_loads.push(knooplast(1, 2, last));
        r
    };
    let p = [3.0, -2.0, -10.0];
    let uit = solve(model([p[0], p[1], p[2], 0.0, 0.0, 0.0])).unwrap();

    // Analytisch: K = Σ k_dwars·(I − e·eᵀ) + k_as·e·eᵀ, u = K⁻¹·P.
    let stijf = |e: V3, l: f64| {
        let (dwars, langs) = (3.0 * E * IY / l.powi(3), E * 0.01 / l);
        let mut k = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let eij = e[i] * e[j];
                k[i][j] = dwars * ((i == j) as u8 as f64 - eij) + langs * eij;
            }
        }
        k
    };
    let (ka, kb) = (stijf(ea, la), stijf(eb, lb));
    let k: [[f64; 3]; 3] = std::array::from_fn(|i| std::array::from_fn(|j| ka[i][j] + kb[i][j]));
    let det = |m: [[f64; 3]; 3]| m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
        - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    let u: V3 = std::array::from_fn(|c| {
        let mut m = k;
        for rij in 0..3 { m[rij][c] = p[rij]; }
        det(m) / det(k)
    });
    let d = verplaatsing(&uit, 2);
    for (a, w) in [d.ux, d.uy, d.uz].into_iter().enumerate() {
        dicht(w, u[a], 1e-8, 1e-14, &format!("verplaatsing knoop 2 as {a}"));
    }
    // Reacties: R1 = −K_a·u, R3 = −K_b·u; het inklemmingsmoment is de
    // dwarskracht maal de lengte, in het scharnier is het moment nul.
    let maal = |m: [[f64; 3]; 3], v: V3| -> V3 { std::array::from_fn(|i| (0..3).map(|j| m[i][j] * v[j]).sum()) };
    for (id, kk, e, l, staaf_id) in [(1, ka, ea, la, 1), (3, kb, eb, lb, 2)] {
        let kracht = maal(kk, u);
        let x = reactie(&uit, id);
        for (a, w) in [x.fx, x.fy, x.fz].into_iter().enumerate() {
            dicht(w, -kracht[a], 1e-8, 1e-10, &format!("reactie {id} as {a}"));
        }
        let langs = kracht.iter().zip(e).map(|(f, e)| f * e).sum::<f64>();
        let dwars = (kracht.iter().map(|f| f * f).sum::<f64>() - langs * langs).sqrt();
        let m = [x.mx, x.my, x.mz];
        dicht(m.iter().map(|v| v * v).sum::<f64>().sqrt(), dwars * l, 1e-8, 1e-10, &format!("inklemmingsmoment {id}"));
        let f = krachten(&uit, staaf_id);
        let scharniermoment = if staaf_id == 1 { [f.my_end_knm, f.mz_end_knm] } else { [f.my_start_knm, f.mz_start_knm] };
        assert!(scharniermoment.iter().all(|m| m.abs() < 1e-9), "moment in het scharnier {f:?}");
        assert!(f.torsion_start_knm.abs() < 1e-9 && f.torsion_end_knm.abs() < 1e-9, "geen torsie {f:?}");
    }
    assert!(d.rx.abs() < 1e-12 && d.ry.abs() < 1e-12 && d.rz.abs() < 1e-12, "draaiing van knoop 2 {d:?}");
    let (df, dm) = evenwicht(&uit, &nodes, &[([0.0; 3], p, [0.0; 3])]);
    assert!(df < 1e-9 && dm < 1e-9, "evenwicht {df:e} {dm:e}");

    // Een moment om e_a draagt console a in torsie naar knoop 1.
    let uit = solve(model([0.0, 0.0, 0.0, 7.0 * ea[0], 7.0 * ea[1], 7.0 * ea[2]])).unwrap();
    dicht(krachten(&uit, 1).torsion_end_knm.abs(), 7.0, 1e-9, 1e-9, "torsie console a");
    assert!(krachten(&uit, 2).torsion_start_knm.abs() < 1e-9, "geen torsie in console b");
    // Een moment langs de vrije schuine richting n neemt niets op.
    let n = [3.0 / 34f64.sqrt(), 4.0 / 34f64.sqrt(), -3.0 / 34f64.sqrt()];
    let fout = solve(model([0.0, 0.0, 0.0, 5.0 * n[0], 5.0 * n[1], 5.0 * n[2]])).unwrap_err();
    assert!(fout.contains("het model is een mechanisme") && fout.contains("In knoop 2"), "{fout}");
}

/// Spec 7: een staaf met de torsie aan beide einden los en zonder
/// buigvrijgave. Als console draait de vrije top om de staafas zonder
/// stijfheid: de regel houdt dat vast en de console rekent als altijd
/// (qL²/2, qL⁴/(8EI)). Een wringend moment op de top is een mechanisme.
/// Tussen twee inklemmingen doet de regel niets (qL²/12). De variant op
/// bedding staat in `tests/bedding.rs` (torsie_aan_beide_einden_vrij_op_bedding).
#[test]
fn torsie_aan_beide_einden_los_zonder_buigvrijgave() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 2.0, 0.0, 0.0)];
    let mut ligger = staaf(1, 1, 2);
    ligger.releases = EndReleases3D { torsion_start: true, torsion_end: true, ..Default::default() };
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let mut r = verzoek(nodes.clone(), vec![ligger.clone()], vec![inklemming(1)]);
        r.analysis = analyse;
        r.member_loads.push(q_lokaal(1, 1, -4.0));
        let uit = solve(r).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        dicht(verplaatsing(&uit, 2).uz, -4.0 * 16.0 / (8.0 * E * IY), 1e-9, 1e-14, "tipzakking");
        dicht(reactie(&uit, 1).my.abs(), 8.0, 1e-9, 1e-9, "inklemmingsmoment");
        assert!(vrije_knoopdraaiing(&uit));
    }
    let mut wring = verzoek(nodes.clone(), vec![ligger.clone()], vec![inklemming(1)]);
    wring.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, 0.0, 1.5, 0.0, 0.0]));
    let fout = solve(wring).unwrap_err();
    assert!(fout.contains("het model is een mechanisme") && fout.contains("1,500 kNm om X in knoop 2"), "{fout}");

    let mut tussen = verzoek(nodes.clone(), vec![ligger], vec![inklemming(1), inklemming(2)]);
    tussen.member_loads.push(q_lokaal(1, 1, -4.0));
    let uit = solve(tussen).unwrap();
    assert!(!vrije_knoopdraaiing(&uit));
    dicht(reactie(&uit, 1).my.abs(), 4.0 * 4.0 / 12.0, 1e-9, 1e-9, "qL²/12");
}

/// Spec 8: de eerste knikfactor van een scharnierende kolom onder druk
/// tussen scharnieropleggingen (alle draaiingen vrij): Euler π²EI/L² met de
/// kleinste traagheid. De kolom is in 16 delen geknipt (tussenknopen); de
/// draaiing om haar eigen as houdt de regel vast. Tweede orde met een kleine
/// dwarslast H in het midden: de staaf-kolom met een puntlast heeft de
/// versterking 3·(tan u − u)/u³ met u = (L/2)·√(P/EI) (ongeveer 1/(1 − 1/α_cr)).
#[test]
fn eulerknik_van_een_scharnierende_kolom() {
    let (l, p) = (6.0, 100.0);
    let delen = 16;
    let mut nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, l)];
    let tussen: Vec<usize> = (1..delen).map(|i| 2 + i).collect();
    for (i, id) in tussen.iter().enumerate() {
        nodes.push(knoop(*id, 0.0, 0.0, l * (i + 1) as f64 / delen as f64));
    }
    let mut kolom = scharnierend(staaf(1, 1, 2));
    kolom.intermediate_node_ids = tussen.clone();
    let maak = |analyse: AnalysisKind, dwars: f64| {
        let mut r = verzoek(nodes.clone(), vec![kolom.clone()], vec![scharnier(1), steun(2, [true, true, false, false, false, false])]);
        r.analysis = analyse;
        r.buckling_modes = 1;
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -p, 0.0, 0.0, 0.0]));
        if dwars != 0.0 {
            r.nodal_loads.push(knooplast(2, tussen[delen / 2 - 1], [dwars, 0.0, 0.0, 0.0, 0.0, 0.0]));
        }
        r
    };
    let euler = std::f64::consts::PI.powi(2) * E * IY.min(IZ) / (l * l);
    let uit = solve(maak(AnalysisKind::Linear, 0.0)).unwrap();
    let alpha = match &uit.buckling {
        BucklingSummary::Available { modes, .. } => modes[0].load_factor,
        anders => panic!("knikfactor verwacht: {anders:?}"),
    };
    dicht(alpha * p, euler, 1e-4, 0.0, "Euler-knikkracht");
    assert!(vrije_knoopdraaiing(&uit));

    let lineair = solve(maak(AnalysisKind::Linear, 0.1)).unwrap();
    let tweede = solve(maak(AnalysisKind::PDelta, 0.1)).unwrap();
    let midden = tussen[delen / 2 - 1];
    let versterking = verplaatsing(&tweede, midden).ux / verplaatsing(&lineair, midden).ux;
    let u = l / 2.0 * (p / (E * IY)).sqrt();
    dicht(versterking, 3.0 * (u.tan() - u) / u.powi(3), 1e-5, 0.0, "tweede-ordeversterking");
    assert!(tweede.second_order.as_ref().is_some_and(|s| s.converged && s.stable));
}

/// Spec 4: samen met trek-alleen. Raam met scharnierende voeten, een
/// scharnierend aangesloten ligger en twee scharnierende trek-alleen
/// diagonalen (koppen buiten het vlak gesteund). Zonder diagonaal een
/// mechanisme; H = 10 kN op knoop 3: diagonaal 1–4 trekt H·d/L, 2–3 valt
/// weg; kolom 2–4 drukt H·h/L, de ligger −H.
#[test]
fn samen_met_trek_alleen() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0), knoop(3, 0.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 4.0)];
    let diagonaal = |id, a, b| {
        let mut s = scharnierend(staaf(id, a, b));
        s.tension_only = true;
        s
    };
    let y = [false, true, false, false, false, false];
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let mut r = verzoek(
            nodes.clone(),
            vec![staaf(1, 1, 3), staaf(2, 2, 4), scharnierend(staaf(3, 3, 4)), diagonaal(5, 1, 4), diagonaal(6, 2, 3)],
            vec![scharnier(1), scharnier(2), steun(3, y), steun(4, y)],
        );
        r.analysis = analyse;
        r.nodal_loads.push(knooplast(1, 3, [10.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
        let uit = solve(r).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        assert_eq!(uit.inactive_members, vec![6], "{analyse:?}");
        if analyse == AnalysisKind::Linear {
            dicht(krachten(&uit, 5).n_start_kn, 10.0 * 52f64.sqrt() / 6.0, 1e-9, 1e-9, "N diagonaal");
            dicht(krachten(&uit, 2).n_start_kn, -10.0 * 4.0 / 6.0, 1e-9, 1e-9, "N kolom 2–4");
            dicht(krachten(&uit, 3).n_start_kn, -10.0, 1e-9, 1e-9, "N ligger");
            for id in [1, 2, 3] {
                let f = krachten(&uit, id);
                assert!([f.my_start_knm, f.my_end_knm, f.mz_start_knm, f.mz_end_knm].iter().all(|m| m.abs() < 1e-9), "staaf {id} {f:?}");
            }
            let (df, dm) = evenwicht(&uit, &nodes, &[([0.0, 0.0, 4.0], [10.0, 0.0, 0.0], [0.0; 3])]);
            assert!(df < 1e-9 && dm < 1e-9, "evenwicht {df:e} {dm:e}");
        } else {
            assert!(uit.second_order.as_ref().is_some_and(|s| s.converged));
        }
        assert!(vrije_knoopdraaiing(&uit), "{:?}", uit.diagnostics);
    }
}

/// Spec 4: samen met bedding (#106) en knik. Knik van een staaf op bedding
/// onder druk (Hetényi): scharnierend aan beide einden, op
/// scharnieropleggingen die alle draaiingen vrijlaten (zonder
/// torsieblokkering), met L = 6π/α en α = (k·b/(E·I))^¼, is de kritieke last
/// P_cr = 2·√(k·b·E·I). Foutgrens 1 % zoals in `tests/bedding.rs`
/// (knik_op_bedding_volgt_hetenyi, daar momentvast met een torsieblokkering).
/// Tweede orde onder P_cr/5 rekent zonder fout.
#[test]
fn samen_met_bedding_en_knik() {
    let (kb, iy) = (4_200.0, 2e-4);
    let ei = E * iy;
    let alpha = (kb / ei).powf(0.25);
    let l = 6.0 * std::f64::consts::PI / alpha;
    let p_cr = 2.0 * (kb * ei).sqrt();
    let mut ligger = scharnierend(staaf(1, 1, 2));
    ligger.bedding = Some(Bedding3D { k_kn_per_m3: Some(kb), width_m: 1.0, k_lateral_kn_per_m3: None, compression_only: false });
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)], vec![ligger],
        vec![steun(1, [true, true, true, false, false, false]), steun(2, [false, true, true, false, false, false])]);
    r.sections = vec![Section3D { id: 1, name: "bedding".into(), area_m2: 0.01, iy_m4: iy, iz_m4: 100.0 * iy,
        torsion_j_m4: 1e-5, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }];
    r.nodal_loads.push(knooplast(1, 2, [-1000.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    r.buckling_modes = 3;
    let uit = solve(r.clone()).unwrap();
    let BucklingSummary::Available { modes, .. } = &uit.buckling else { panic!("knik: {:?}", uit.buckling) };
    dicht(modes[0].load_factor * 1000.0, p_cr, 0.01, 0.0, "kritieke last op bedding");
    // De melding noemt alleen modelknopen, niet de rekenknopen van de bedding.
    assert!(uit.diagnostics.iter().any(|m| m.starts_with("Vrije knoopdraaiing in knopen 1–2:")), "{:?}", uit.diagnostics);
    assert_eq!(uit.reactions.len(), 2, "alleen de modelopleggingen: {:?}", uit.reactions);
    assert!(uit.reactions.iter().all(|x| x.mx == 0.0 && x.my == 0.0 && x.mz == 0.0), "{:?}", uit.reactions);

    let mut tweede = r;
    tweede.analysis = AnalysisKind::PDelta;
    tweede.nodal_loads[0].fx = -p_cr / 5.0;
    let uit = solve(tweede).unwrap();
    assert!(uit.second_order.as_ref().is_some_and(|s| s.converged));
}

/// Spec 4: samen met een globale last (#80). Een schuine spant (4 m
/// horizontaal, 3 m hoog), scharnierend op een scharnier en een rol in X,
/// met een verticale last per meter projectie q = 2 kN/m: M midden =
/// q·Lh²/8 = 4 kNm, einden 0, verticale reacties q·Lh/2.
#[test]
fn samen_met_een_globale_last() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 3.0)];
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let mut r = verzoek(nodes.clone(), vec![scharnierend(staaf(1, 1, 2))],
            vec![scharnier(1), steun(2, [false, true, true, false, false, false])]);
        r.analysis = analyse;
        r.member_loads.push(MemberLoad3D {
            id: 1, member_id: 1, global_direction: Some(GlobalDirection3D::Z),
            q_start_kn_per_m: Some(-2.0), q_end_kn_per_m: Some(-2.0), per_projection: true, ..Default::default()
        });
        let uit = solve(r).unwrap_or_else(|fout| panic!("{analyse:?}: {fout}"));
        dicht(lijn(&uit.diagrams.moment_y, 1, 0.5).abs(), 4.0, 1e-6, 1e-9, "M midden");
        for t in [0.0, 1.0] { assert!(lijn(&uit.diagrams.moment_y, 1, t).abs() < 1e-9, "M op t = {t}"); }
        if analyse == AnalysisKind::Linear {
            dicht(reactie(&uit, 1).fz, 4.0, 1e-9, 1e-9, "R1");
            dicht(reactie(&uit, 2).fz, 4.0, 1e-9, 1e-9, "R2");
            assert!(reactie(&uit, 1).fx.abs() < 1e-9);
        }
        assert!(vrije_knoopdraaiing(&uit), "{:?}", uit.diagnostics);
    }
}

/// Samen met een starre schijf. De schijf koppelt de draaiing om Z van haar
/// knopen aan haar verschuivingen; zij telt daarom als draaistijfheid om Z en
/// houdt in het scharnier van de twee consoles alleen de draaiing om Y vrij.
/// De schijf ligt in knoop 1 vast; knoop 3 is alleen verticaal ingeklemd (Z
/// en de draaiingen om X en Y). Verticaal is het de uitkomst van de twee
/// consoles: P1 = P/9, P2 = 8P/9.
#[test]
fn samen_met_een_starre_schijf() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 6.0, 0.0, 0.0)];
    let mut links = staaf(1, 1, 2);
    links.releases = EndReleases3D { my_end: true, mz_end: true, ..Default::default() };
    let mut rechts = staaf(2, 2, 3);
    rechts.releases = EndReleases3D { my_start: true, mz_start: true, ..Default::default() };
    let mut r = verzoek(nodes.clone(), vec![links, rechts],
        vec![inklemming(1), steun(3, [false, false, true, true, true, false])]);
    r.diaphragms.push(open_fem_3d::Diaphragm3D { id: 1, node_ids: vec![1, 2, 3] });
    r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -9.0, 0.0, 0.0, 0.0]));
    let uit = solve(r).unwrap();
    dicht(reactie(&uit, 1).fz, 1.0, 1e-9, 1e-9, "R1");
    dicht(reactie(&uit, 3).fz, 8.0, 1e-9, 1e-9, "R3");
    dicht(reactie(&uit, 1).my.abs(), 4.0, 1e-9, 1e-9, "inklemmingsmoment links");
    dicht(reactie(&uit, 3).my.abs(), 16.0, 1e-9, 1e-9, "inklemmingsmoment rechts");
    assert!(uit.reactions.iter().all(|x| x.node_id != 2), "{:?}", uit.reactions);
    assert!(uit.equilibrium.as_ref().is_some_and(|e| e.residual_ok && e.equilibrium_ok), "{:?}", uit.equilibrium);
    assert!(vrije_knoopdraaiing(&uit), "{:?}", uit.diagnostics);
}

/// De starre schijf telt als draaistijfheid om Z, ook als haar draaiing niet
/// door een inklemming vastligt. Drie ingeklemde kolommen (koppen 11, 12 en
/// 13) en hoekknoop 14, alleen verticaal gesteund, met een scharnierende
/// ligger 12–14 en een schijf over 11–14; excentrische horizontale lasten,
/// zodat de schijf verschuift en draait. Knoop 14 is alleen vrij om X (om Y
/// houdt de torsie van de ligger haar vast, om Z de schijf). Gelijk aan
/// hetzelfde model met een expliciete draaiblokkering om X in knoop 14, met
/// knoop 14 als meester en als slaaf van de schijf. Telde de regel de schijf
/// niet mee, dan blokkeerde zij ook de draaiing om Z: als meester een
/// onterechte mechanismefout, als slaaf een knoop die zowel gekoppeld als
/// opgelegd is.
#[test]
fn starre_schijf_zonder_ingeklemde_meester() {
    let model = |volgorde: Vec<usize>, rx: bool| {
        let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0), knoop(3, 0.0, 4.0, 0.0),
            knoop(11, 0.0, 0.0, 3.0), knoop(12, 4.0, 0.0, 3.0), knoop(13, 0.0, 4.0, 3.0), knoop(14, 4.0, 4.0, 3.0)];
        let mut r = verzoek(nodes, vec![staaf(1, 1, 11), staaf(2, 2, 12), staaf(3, 3, 13), scharnierend(staaf(4, 12, 14))],
            vec![inklemming(1), inklemming(2), inklemming(3), Support3D { node_id: 14, uz: true, rx, ..Default::default() }]);
        r.diaphragms.push(open_fem_3d::Diaphragm3D { id: 1, node_ids: volgorde });
        r.nodal_loads.push(knooplast(1, 13, [10.0, 0.0, -5.0, 0.0, 0.0, 0.0]));
        r.nodal_loads.push(knooplast(2, 14, [0.0, 4.0, -5.0, 0.0, 0.0, 0.0]));
        r.member_loads.push(q_lokaal(1, 4, -3.0));
        solve(r)
    };
    for (rol, volgorde) in [("meester", vec![14, 11, 12, 13]), ("slaaf", vec![11, 12, 13, 14])] {
        let referentie = model(volgorde.clone(), true).unwrap_or_else(|fout| panic!("{rol}, referentie: {fout}"));
        let regel = model(volgorde, false).unwrap_or_else(|fout| panic!("{rol}, met de regel: {fout}"));
        assert!(!vrije_knoopdraaiing(&referentie), "{rol}: {:?}", referentie.diagnostics);
        assert!(regel.diagnostics.iter().any(|m| m.starts_with("Vrije knoopdraaiing in knoop 14:")), "{rol}: {:?}", regel.diagnostics);
        let schaal_u = referentie.displacements.iter().map(|d| d.ux.abs().max(d.uy.abs()).max(d.uz.abs())).fold(0.0, f64::max);
        let schaal_r = referentie.displacements.iter().map(|d| d.rx.abs().max(d.ry.abs()).max(d.rz.abs())).fold(0.0, f64::max);
        assert!(schaal_u > 1e-6, "{rol}: de schijf beweegt niet: {schaal_u}");
        let draait = referentie.displacements.iter().find(|d| d.node_id == 11).unwrap().rz;
        assert!(draait.abs() > 1e-3 * schaal_r, "{rol}: de schijf draait niet: {draait}");
        for a in &referentie.displacements {
            let b = verplaatsing(&regel, a.node_id);
            for (x, y) in [(a.ux, b.ux), (a.uy, b.uy), (a.uz, b.uz)] {
                assert!((x - y).abs() <= 1e-9 * schaal_u, "{rol}, knoop {}: {a:?} tegen {b:?}", a.node_id);
            }
            for (x, y) in [(a.rx, b.rx), (a.ry, b.ry), (a.rz, b.rz)] {
                assert!((x - y).abs() <= 1e-9 * schaal_r, "{rol}, knoop {}: {a:?} tegen {b:?}", a.node_id);
            }
        }
        assert_eq!(referentie.reactions.len(), regel.reactions.len(), "{rol}");
        for a in &referentie.reactions {
            let b = reactie(&regel, a.node_id);
            for (x, y) in [(a.fx, b.fx), (a.fy, b.fy), (a.fz, b.fz), (a.mx, b.mx), (a.my, b.my), (a.mz, b.mz)] {
                assert!((x - y).abs() <= 1e-9 * (1.0 + x.abs()), "{rol}, reactie {}: {a:?} tegen {b:?}", a.node_id);
            }
        }
    }
}

/// Samen met een plaat: een plaatknoop heeft draaistijfheid in alle
/// richtingen. Een scharnierende ligger van plaathoek 2 naar een
/// scharnieroplegging in knoop 5: alleen de draaiing van knoop 5 is vrij, de
/// ligger rekent als vrij opgelegd (qL²/8) en de plaat blijft onbelast.
#[test]
fn samen_met_een_plaat() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 2.0, 0.0, 0.0), knoop(3, 2.0, 2.0, 0.0),
        knoop(4, 0.0, 2.0, 0.0), knoop(5, 4.0, 0.0, 0.0)];
    let mut r = verzoek(nodes, vec![scharnierend(staaf(1, 2, 5))],
        vec![scharnier(1), scharnier(2), scharnier(3), scharnier(4), scharnier(5)]);
    r.plates.push(open_fem_3d::Plate3D { id: 1, material_id: 1, thickness_m: 0.2, bedding: None, orthotropy: None });
    r.shell_elements.push(open_fem_3d::ShellElement3D { id: 1, plate_id: 1, node_ids: vec![1, 2, 3, 4] });
    r.member_loads.push(q_lokaal(1, 1, -6.0));
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    dicht(lijn(&uit.diagrams.moment_y, 1, 0.5).abs(), 6.0 * 4.0 / 8.0, 1e-9, 1e-9, "M midden ligger");
    dicht(reactie(&uit, 5).fz, 6.0, 1e-9, 1e-9, "R5");
    dicht(reactie(&uit, 2).fz, 6.0, 1e-9, 1e-9, "R2 (plaathoek)");
    for id in [1, 3, 4] { assert!(reactie(&uit, id).fz.abs() < 1e-9, "plaathoek {id} onbelast"); }
    assert!(vrije_knoopdraaiing(&uit) && uit.diagnostics.iter().any(|m| m.contains("in knoop 5:")), "{:?}", uit.diagnostics);
}

/// Temperatuur op een scharnierende ligger tussen twee scharnieropleggingen:
/// de kern condenseert ook de vaste-eindmomenten van de temperatuur bij een
/// vrijgegeven einde, dus de vastgehouden draaiingen krijgen geen reactie.
/// Een uniforme ΔT tussen twee vaste punten geeft N = −E·A·α·ΔT; een
/// temperatuurverschil over de hoogte geeft bij vrije einddraaiing geen moment.
#[test]
fn temperatuur_op_een_scharnierende_ligger() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0)];
    let mut r = verzoek(nodes, vec![scharnierend(staaf(1, 1, 2))], vec![scharnier(1), scharnier(2)]);
    // Werkelijke maten voor het temperatuurverschil (#221); bij vrije
    // einddraaiing blijft het moment toch nul.
    r.sections[0].height_m = Some(0.3);
    r.sections[0].width_m = Some(0.15);
    r.thermal_loads.push(open_fem_3d::ThermalLoad3D {
        id: 1, member_id: 1, delta_t_uniform_k: 30.0, delta_t_gradient_y_k: 10.0, delta_t_gradient_z_k: 20.0,
    });
    let uit = solve(r).unwrap_or_else(|fout| panic!("{fout}"));
    let f = krachten(&uit, 1);
    dicht(f.n_start_kn, -E * 0.01 * 12e-6 * 30.0, 1e-9, 1e-9, "N = −E·A·α·ΔT");
    for m in [f.my_start_knm, f.my_end_knm, f.mz_start_knm, f.mz_end_knm, f.torsion_start_knm, f.torsion_end_knm] {
        assert!(m.abs() < 1e-9, "{f:?}");
    }
    for reeks in [&uit.diagrams.moment_y, &uit.diagrams.moment_z] {
        assert!(reeks[0].max_abs_value < 1e-9, "{:?}", reeks[0]);
    }
    assert!(uit.reactions.iter().all(|x| x.mx == 0.0 && x.my == 0.0 && x.mz == 0.0 && x.fz.abs() < 1e-9));
}

/// Een torsiemoment op een ligger die vrij om haar as kan draaien (twee
/// scharnieropleggingen, geen torsieblokkering): een echt mechanisme, met de
/// benoeming van de controle op de opleggingen erbij.
#[test]
fn torsie_op_een_ligger_die_om_haar_as_kan_draaien_is_een_mechanisme() {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0)];
    for ligger in [staaf(1, 1, 2), scharnierend(staaf(1, 1, 2))] {
        let mut r = verzoek(nodes.clone(), vec![ligger], vec![scharnier(1), scharnier(2)]);
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -1.0, 5.0, 0.0, 0.0]));
        let fout = solve(r).unwrap_err();
        assert!(fout.contains("het model is een mechanisme") && fout.contains("Knopen 1–2 kunnen samen draaien"), "{fout}");
        assert!(fout.contains("5,000 kNm om X"), "{fout}");
        assert!(fout.contains("vrij: draaien om X"), "{fout}");
        assert!(fout.contains("torsie om de staafas"), "{fout}");
    }
}
