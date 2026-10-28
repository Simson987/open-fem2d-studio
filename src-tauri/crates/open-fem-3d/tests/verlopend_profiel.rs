//! Verlopende staven (#73): `partSectionIds` verdeelt een staaf in n gelijke
//! delen met elk een eigen doorsnede. De adapter knipt de staaf op de
//! deelgrenzen en voegt de uitkomsten weer samen tot de ene modelstaaf.
//!
//! Referenties:
//! (a) een staaf met overal dezelfde doorsnede rekent bitgelijk als zonder het
//!     veld; een getrapte staaf is gelijk aan een keten van losse staven;
//! (b) zakking van een verlopende console onder een eindlast:
//!     δ = F/E·∫(L−x)²/I(x) dx (arbeidsstelling), exact voor de getrapte staaf
//!     (I per deel constant) en analytisch voor de continue staaf (rechthoek
//!     met een lineair verlopende hoogte); convergentie O(1/n²);
//! (c) eigen gewicht als staaflast per deel: Σ ρ·g·A_i·L/n, het inklemmoment,
//!     de momentenlijn op de grenzen en de zakking (Simpson, exact per deel);
//! (d) knik van een verlopende pendelkolom tegen de exacte overdrachtsmatrix
//!     van de getrapte kolom (E·I_i·w'' + P·w = 0 per deel) en de continue
//!     kolom (fijn getrapt met Richardson-extrapolatie); de knikgegevens ook
//!     bij een normaalkracht die langs de staaf verandert;
//! (e) samen met bedding, globale lasten, plaatknopen, scharnieren (#96),
//!     torsievrijgaven, trek-alleen (met montage en kruisregel, A_eq van de
//!     delen in serie) en tweede orde: zonder fout, in evenwicht;
//! (f) foutmeldingen en het contract (JSON).

use open_fem_3d::{
    solve, AnalysisKind, Bedding3D, BucklingSummary, EndReleases3D, GlobalDirection3D, Material3D, Member3D,
    MemberLoad3D, MemberPointLoad3D, NodalLoad3D, Node3D, Plate3D, Section3D, ShellElement3D, SolveRequest3D,
    SolveResult3D, Support3D, SurfaceLoad3D, TensionOnlyFit3D, ThermalLoad3D,
};

/// E in kN/m² (210 000 MPa).
const E: f64 = 210_000_000.0;
const PI: f64 = std::f64::consts::PI;

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

/// Rechthoek b (lokaal y) × h (lokaal z): I_y = b·h³/12 voor buiging door een
/// last in lokaal z, I_z = h·b³/12; J volgens de gangbare benadering.
fn rechthoek(id: usize, b: f64, h: f64) -> Section3D {
    let (a, c) = (b.max(h), b.min(h));
    Section3D {
        id, name: format!("{:.1}x{:.1}", b * 1000.0, h * 1000.0), area_m2: b * h,
        iy_m4: b * h.powi(3) / 12.0, iz_m4: h * b.powi(3) / 12.0,
        torsion_j_m4: a * c.powi(3) * (1.0 / 3.0 - 0.21 * c / a * (1.0 - c.powi(4) / (12.0 * a.powi(4)))),
        shear_area_y_m2: None, shear_area_z_m2: None, height_m: Some(h), width_m: Some(b),
    }
}

/// De doorsneden van een verlopende staaf zoals de app ze maakt: deel i van n
/// het tussenprofiel in het midden, rechthoek b × h met h lineair van h0 naar h1.
fn delen(eerste_id: usize, n: usize, b: f64, h0: f64, h1: f64) -> Vec<Section3D> {
    (0..n).map(|i| {
        let t = (i as f64 + 0.5) / n as f64;
        rechthoek(eerste_id + i, b, h0 + (h1 - h0) * t)
    }).collect()
}

fn ids(doorsneden: &[Section3D]) -> Vec<usize> { doorsneden.iter().map(|d| d.id).collect() }

fn staaf(id: usize, begin: usize, eind: usize, sectie: usize) -> Member3D {
    Member3D {
        id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: sectie,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![],
        tension_only: false, bedding: None, part_section_ids: None,
    }
}

fn verlopend(mut s: Member3D, doorsneden: &[Section3D]) -> Member3D {
    s.part_section_ids = Some(ids(doorsneden));
    s
}

fn verzoek(nodes: Vec<Node3D>, members: Vec<Member3D>, sections: Vec<Section3D>, supports: Vec<Support3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: E / 1000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections, members, supports, nodal_loads: vec![], member_loads: vec![], member_point_loads: vec![],
        thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
        tension_only_fit: None, tension_only_cross_rule: false, max_iterations: 100, tolerance: 1e-10, buckling_modes: 0,
    }
}

fn steun(node_id: usize, v: [bool; 6]) -> Support3D {
    Support3D { node_id, ux: v[0], uy: v[1], uz: v[2], rx: v[3], ry: v[4], rz: v[5], ..Default::default() }
}

fn inklemming(node_id: usize) -> Support3D { steun(node_id, [true; 6]) }

fn knooplast(id: usize, node_id: usize, f: [f64; 6]) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx: f[0], fy: f[1], fz: f[2], mx: f[3], my: f[4], mz: f[5] }
}

fn globaal(id: usize, member_id: usize, richting: GlobalDirection3D, q: [f64; 2], bereik: Option<(f64, f64)>) -> MemberLoad3D {
    MemberLoad3D {
        id, member_id, global_direction: Some(richting), q_start_kn_per_m: Some(q[0]), q_end_kn_per_m: Some(q[1]),
        start_position_m: bereik.map(|b| b.0), end_position_m: bereik.map(|b| b.1), ..Default::default()
    }
}

fn verplaatsing(r: &SolveResult3D, id: usize) -> [f64; 6] {
    let d = r.displacements.iter().find(|d| d.node_id == id).unwrap_or_else(|| panic!("knoop {id} ontbreekt"));
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]
}

fn reactie(r: &SolveResult3D, id: usize) -> [f64; 6] {
    let d = r.reactions.iter().find(|d| d.node_id == id).unwrap_or_else(|| panic!("reactie {id} ontbreekt"));
    [d.fx, d.fy, d.fz, d.mx, d.my, d.mz]
}

fn relatief(waarde: f64, referentie: f64) -> f64 { (waarde - referentie).abs() / referentie.abs() }

/// Meet de afwijking, meld haar en toets haar tegen de grens.
fn grens(afwijking: f64, max: f64, wat: &str) {
    eprintln!("{wat}: afwijking {afwijking:.3e} (grens {max:.0e})");
    assert!(afwijking <= max, "{wat}: afwijking {afwijking:.3e} boven {max:.0e}");
}

// ---------------------------------------------------------------- (a)

/// Portaal 6 × 4 m met ingeklemde voeten; de ligger 2-3 draagt alle soorten
/// staaflasten (lokaal trapezium, globaal axiaal, puntlast, temperatuur).
fn raam(analyse: AnalysisKind, delen_ligger: Option<Vec<usize>>) -> SolveRequest3D {
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, 4.0), knoop(3, 6.0, 0.0, 4.0), knoop(4, 6.0, 0.0, 0.0)];
    let mut ligger = staaf(2, 2, 3, 1);
    ligger.part_section_ids = delen_ligger;
    let mut kopie = rechthoek(2, 0.2, 0.4);
    kopie.name = "kopie met dezelfde getallen".into();
    let mut r = verzoek(nodes, vec![staaf(1, 1, 2, 1), ligger, staaf(3, 4, 3, 1)],
        vec![rechthoek(1, 0.2, 0.4), kopie], vec![inklemming(1), inklemming(4)]);
    r.analysis = analyse;
    r.buckling_modes = 2;
    r.nodal_loads.push(knooplast(1, 2, [10.0, 3.0, -40.0, 0.0, 0.0, 0.0]));
    r.nodal_loads.push(knooplast(2, 3, [0.0, 0.0, -40.0, 0.0, 0.0, 0.0]));
    r.member_loads.push(MemberLoad3D {
        id: 1, member_id: 2, qz_start_kn_per_m: -5.0, qz_end_kn_per_m: -8.0,
        start_position_m: Some(0.5), end_position_m: Some(5.0), ..Default::default()
    });
    r.member_loads.push(globaal(2, 2, GlobalDirection3D::X, [1.5, 1.5], None));
    r.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 2, py_kn: 2.0, pz_kn: -12.0, position_m: 2.5 });
    r.thermal_loads.push(ThermalLoad3D {
        id: 1, member_id: 2, delta_t_uniform_k: 20.0, delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 5.0,
    });
    r
}

/// (a) Overal dezelfde doorsnede (hetzelfde id, of een ander id met dezelfde
/// getallen): de adapter knipt niet en de hele uitkomst is bitgelijk aan die
/// zonder het veld, lineair met knik en in tweede orde. Alleen
/// `maxImbalanceKn` van de tweede orde (een som van afrondingsruis, orde
/// 1e-13 kN) hangt van de volgorde in de hashmaps af en verschilt al tussen
/// twee keer hetzelfde verzoek; die blijft buiten de vergelijking.
#[test]
fn a_gelijke_delen_zijn_bitgelijk_aan_een_prismatische_staaf() {
    for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
        let json = |r: SolveRequest3D| {
            let mut uit = serde_json::to_value(solve(r).unwrap()).unwrap();
            if analyse == AnalysisKind::PDelta {
                let ruis = uit["equilibrium"]["maxImbalanceKn"].as_f64().unwrap();
                assert!(ruis < 1e-9, "onbalans {ruis}");
                uit["equilibrium"]["maxImbalanceKn"] = serde_json::Value::Null;
            }
            serde_json::to_string(&uit).unwrap()
        };
        let zonder = json(raam(analyse, None));
        // Zelfde verzoek twee keer: de vergelijking hieronder is betekenisvol.
        assert_eq!(json(raam(analyse, None)), zonder, "{analyse:?}: herhaalbaar");
        assert_eq!(json(raam(analyse, Some(vec![1; 5]))), zonder, "{analyse:?}: vijf keer doorsnede 1");
        assert_eq!(json(raam(analyse, Some(vec![2, 1, 2, 2]))), zonder, "{analyse:?}: id 2 met dezelfde getallen");
        eprintln!("(a) {analyse:?}: uitkomst bitgelijk ({} tekens JSON)", zonder.len());
    }
}

/// Lineair verlopende lokale last q(s) van `q` bij s = a tot `q_eind` bij s = b.
fn trapezium(q: f64, q_eind: f64, a: f64, b: f64, s: f64) -> f64 { q + (q_eind - q) * (s - a) / (b - a) }

/// (a) Een getrapte console (3 delen) rekent als een keten van drie losse
/// staven met dezelfde doorsneden en lasten: verplaatsingen, reacties,
/// eindkrachten en de samengevoegde lijnen (gelijk binnen afrondingsruis).
#[test]
fn a_getrapte_staaf_is_een_keten_van_losse_staven() {
    let doorsneden = delen(11, 3, 0.2, 0.5, 0.25);
    let begin = rechthoek(10, 0.2, 0.5);
    let mut alle = vec![begin];
    alle.extend(doorsneden.clone());
    let (l, h) = (6.0, 2.0);
    let (qa, qb, a, b) = (-4.0, -7.0, 0.5, 5.5);
    let eindlast = [5.0, 2.0, -10.0, 0.5, 0.0, 0.0];

    // Verlopende staaf 1 → 2.
    let mut verloop = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![verlopend(staaf(1, 1, 2, 10), &doorsneden)], alle.clone(), vec![inklemming(1)]);
    verloop.nodal_loads.push(knooplast(1, 2, eindlast));
    verloop.member_loads.push(MemberLoad3D {
        id: 1, member_id: 1, qz_start_kn_per_m: qa, qz_end_kn_per_m: qb,
        start_position_m: Some(a), end_position_m: Some(b), ..Default::default()
    });
    verloop.member_loads.push(globaal(2, 1, GlobalDirection3D::Z, [-2.0, -2.0], None));
    verloop.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: 3.0, pz_kn: -6.0, position_m: 2.5 });
    verloop.thermal_loads.push(ThermalLoad3D {
        id: 1, member_id: 1, delta_t_uniform_k: 15.0, delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 4.0,
    });

    // Keten 1 → 101 → 102 → 2 met dezelfde doorsneden.
    let mut keten = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(101, h, 0.0, 0.0), knoop(102, 2.0 * h, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![staaf(1, 1, 101, 11), staaf(2, 101, 102, 12), staaf(3, 102, 2, 13)], alle, vec![inklemming(1)]);
    keten.nodal_loads.push(knooplast(1, 2, eindlast));
    for deel in 0..3 {
        let (van, tot) = ((deel as f64 * h).max(a), ((deel + 1) as f64 * h).min(b));
        let begin_deel = deel as f64 * h;
        keten.member_loads.push(MemberLoad3D {
            id: 10 + deel, member_id: deel + 1,
            qz_start_kn_per_m: trapezium(qa, qb, a, b, van), qz_end_kn_per_m: trapezium(qa, qb, a, b, tot),
            start_position_m: Some(van - begin_deel), end_position_m: Some(tot - begin_deel), ..Default::default()
        });
        keten.member_loads.push(globaal(20 + deel, deel + 1, GlobalDirection3D::Z, [-2.0, -2.0], None));
        keten.thermal_loads.push(ThermalLoad3D {
            id: 1 + deel, member_id: deel + 1, delta_t_uniform_k: 15.0, delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 4.0,
        });
    }
    keten.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 2, py_kn: 3.0, pz_kn: -6.0, position_m: 0.5 });

    let v = solve(verloop).unwrap();
    let k = solve(keten).unwrap();
    // Alleen de modelknopen; de grensknopen van de adapter staan niet in de uitvoer.
    let mut knopen: Vec<usize> = v.displacements.iter().map(|d| d.node_id).collect();
    knopen.sort_unstable();
    assert_eq!(knopen, vec![1, 2]);
    let schaal_u = verplaatsing(&k, 2).iter().fold(0.0f64, |m, x| m.max(x.abs()));
    let du = (0..6).map(|i| (verplaatsing(&v, 2)[i] - verplaatsing(&k, 2)[i]).abs()).fold(0.0, f64::max) / schaal_u;
    grens(du, 1e-10, "(a) keten: eindverplaatsing");
    let schaal_r = reactie(&k, 1).iter().fold(0.0f64, |m, x| m.max(x.abs()));
    let dr = (0..6).map(|i| (reactie(&v, 1)[i] - reactie(&k, 1)[i]).abs()).fold(0.0, f64::max) / schaal_r;
    grens(dr, 1e-10, "(a) keten: inklemreactie");

    // Eindkrachten: begin van het eerste deel, eind van het laatste.
    assert_eq!(v.member_forces.len(), 1);
    let (f, k1, k3) = (&v.member_forces[0], &k.member_forces[0], &k.member_forces[2]);
    assert!((f.length_m - l).abs() < 1e-12);
    let paren = [
        (f.n_start_kn, k1.n_start_kn), (f.vy_start_kn, k1.vy_start_kn), (f.vz_start_kn, k1.vz_start_kn),
        (f.torsion_start_knm, k1.torsion_start_knm), (f.my_start_knm, k1.my_start_knm), (f.mz_start_knm, k1.mz_start_knm),
        (f.n_end_kn, k3.n_end_kn), (f.vy_end_kn, k3.vy_end_kn), (f.vz_end_kn, k3.vz_end_kn),
        (f.torsion_end_knm, k3.torsion_end_knm), (f.my_end_knm, k3.my_end_knm), (f.mz_end_knm, k3.mz_end_knm),
    ];
    let schaal_f = paren.iter().map(|p| p.1.abs()).fold(1.0, f64::max);
    grens(paren.iter().map(|p| (p.0 - p.1).abs()).fold(0.0, f64::max) / schaal_f, 1e-10, "(a) keten: eindkrachten");

    // De samengevoegde lijnen zijn de lijnen van de losse staven achter elkaar.
    let lijnen = |r: &SolveResult3D| [
        r.diagrams.moment_y.clone(), r.diagrams.moment_z.clone(), r.diagrams.shear_y.clone(),
        r.diagrams.shear_z.clone(), r.diagrams.axial.clone(), r.diagrams.torsion.clone(),
    ];
    for (lijn_v, lijn_k) in lijnen(&v).iter().zip(lijnen(&k).iter()) {
        assert_eq!(lijn_v.len(), 1);
        let punten_v = &lijn_v[0].points;
        let mut punten_k = Vec::new();
        for deel in 0..3 {
            let d = lijn_k.iter().find(|d| d.member_id == deel + 1).unwrap();
            punten_k.extend(d.points.iter().map(|p| ((deel as f64 + p.t) / 3.0, p.value)));
        }
        assert_eq!(punten_v.len(), punten_k.len());
        let schaal = punten_k.iter().map(|p| p.1.abs()).fold(1.0, f64::max);
        let afwijking = punten_v.iter().zip(&punten_k)
            .map(|(p, q)| ((p.t - q.0).abs()).max((p.value - q.1).abs() / schaal))
            .fold(0.0, f64::max);
        assert!(afwijking < 1e-10, "lijn: afwijking {afwijking:.3e}");
    }
    assert!(v.equilibrium.as_ref().unwrap().equilibrium_ok);
}

// ---------------------------------------------------------------- (b)

/// δ = F/E·∫(L−x)²/I_i dx van de getrapte console (exact per deel).
fn zakking_getrapt(f: f64, l: f64, doorsneden: &[Section3D]) -> f64 {
    let n = doorsneden.len();
    let h = l / n as f64;
    doorsneden.iter().enumerate().map(|(i, d)| {
        let (x0, x1) = (i as f64 * h, (i + 1) as f64 * h);
        ((l - x0).powi(3) - (l - x1).powi(3)) / 3.0 / d.iy_m4
    }).sum::<f64>() * f / E
}

/// δ = F/E·∫(L−x)²/I(x) dx met I = b·h(x)³/12, h lineair van h0 naar h1:
/// 12/b·L³/(h1−h0)³·[3/2 + ln(h1/h0) + h1²/(2h0²) − 2h1/h0].
fn zakking_continu(f: f64, l: f64, b: f64, h0: f64, h1: f64) -> f64 {
    let r = h1 / h0;
    f / E * 12.0 / b * l.powi(3) / (h1 - h0).powi(3) * (1.5 + r.ln() + r * r / 2.0 - 2.0 * r)
}

/// (b) Verlopende console (rechthoek 200 × 500 → 200 × 250 mm, L = 4 m) onder
/// een eindlast van 10 kN: de zakking is exact die van de getrapte staaf
/// (Hermite-elementen zijn exact voor knooplasten) en convergeert met O(1/n²)
/// naar die van de continue staaf.
#[test]
fn b_verlopende_console_onder_een_eindlast() {
    let (l, b, h0, h1, f) = (4.0, 0.2, 0.5, 0.25, -10.0);
    let continu = zakking_continu(f, l, b, h0, h1);
    // De formule bij een kleine helling ε: F·L³/(3·E·I0)·(1 + 3/4·ε + O(ε²)).
    let eps = 1e-3;
    let bijna = zakking_continu(f, l, b, h0, h0 * (1.0 - eps));
    let prisma = f * l.powi(3) / (3.0 * E * b * h0.powi(3) / 12.0);
    grens(relatief(bijna, prisma * (1.0 + 0.75 * eps)), 1e-5, "(b) gesloten vorm bij een kleine helling");
    let mut fouten = Vec::new();
    for n in [2, 4, 8, 16, 32, 64] {
        let doorsneden = delen(11, n, b, h0, h1);
        let mut alle = vec![rechthoek(1, b, h0)];
        alle.extend(doorsneden.clone());
        let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
            vec![verlopend(staaf(1, 1, 2, 1), &doorsneden)], alle, vec![inklemming(1)]);
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, f, 0.0, 0.0, 0.0]));
        let uit = solve(r).unwrap();
        let uz = verplaatsing(&uit, 2)[2];
        let getrapt = zakking_getrapt(f, l, &doorsneden);
        // Afrondingsruis: de conditie van de stijfheidsmatrix van een console
        // in n buigelementen groeit met n⁴.
        let ruis = ((n as f64).powi(4) * f64::EPSILON).max(1e-13);
        grens(relatief(uz, getrapt), ruis, &format!("(b) n = {n}: zakking tegen de getrapte staaf"));
        // Statisch bepaald: inklemming F·L, ongeacht de doorsneden.
        grens(relatief(reactie(&uit, 1)[4].abs(), f.abs() * l), ruis, &format!("(b) n = {n}: inklemmoment"));
        let fout = relatief(getrapt, continu);
        eprintln!("(b) n = {n}: zakking {:.6} mm, continu {:.6} mm, verschil {:.3e}", -uz * 1e3, -continu * 1e3, fout);
        fouten.push(fout);
    }
    // O(1/n²): elke verdubbeling van n deelt de fout door ongeveer 4.
    for paar in fouten.windows(2).skip(1) {
        let orde = paar[0] / paar[1];
        eprintln!("(b) verhouding van opeenvolgende fouten {orde:.3}");
        assert!((3.5..4.5).contains(&orde), "convergentieorde: verhouding {orde}");
    }
    grens(*fouten.last().unwrap(), 1e-3, "(b) n = 64 tegen de continue staaf");
}

// ---------------------------------------------------------------- (c)

/// (c) Eigen gewicht zoals de app het geeft: per deel een globale Z-last
/// ρ·g·A_i over [i·h, (i+1)·h]. Totaal Σ ρ·g·A_i·L/n, inklemmoment
/// Σ ρ·g·A_i·h·s_i (s_i het midden van deel i), de momentenlijn op de grenzen
/// en de zakking (arbeidsstelling, Simpson per deel: M·(L−x) is daar kubisch).
#[test]
fn c_eigen_gewicht_volgt_de_doorsnede_per_deel() {
    let (l, b, h0, h1, n) = (4.0, 0.2, 0.5, 0.25, 8);
    let rho_g = 7850.0 * 9.81 / 1000.0; // kN/m³
    let h = l / n as f64;
    let doorsneden = delen(11, n, b, h0, h1);
    let mut alle = vec![rechthoek(1, b, h0)];
    alle.extend(doorsneden.clone());
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![verlopend(staaf(1, 1, 2, 1), &doorsneden)], alle, vec![inklemming(1)]);
    let q: Vec<f64> = doorsneden.iter().map(|d| rho_g * d.area_m2).collect();
    for (i, qi) in q.iter().enumerate() {
        r.member_loads.push(globaal(i + 1, 1, GlobalDirection3D::Z, [-qi, -qi], Some((i as f64 * h, (i + 1) as f64 * h))));
    }
    let uit = solve(r).unwrap();

    let totaal: f64 = q.iter().map(|qi| qi * h).sum();
    let inklemming_m: f64 = q.iter().enumerate().map(|(i, qi)| qi * h * (i as f64 + 0.5) * h).sum();
    eprintln!("(c) eigen gewicht {totaal:.6} kN (prismatisch begin {:.6} kN), inklemmoment {inklemming_m:.6} kNm",
        rho_g * b * h0 * l);
    grens(relatief(reactie(&uit, 1)[2], totaal), 1e-12, "(c) verticale reactie = Σ ρ·g·A_i·L/n");
    grens(relatief(reactie(&uit, 1)[4].abs(), inklemming_m), 1e-12, "(c) inklemmoment");

    // M(x) van de console: de lasten voorbij x.
    let moment = |x: f64| -> f64 {
        q.iter().enumerate().map(|(i, qi)| {
            let (a, e) = (i as f64 * h, (i + 1) as f64 * h);
            if x >= e { 0.0 } else if x <= a { qi * h * ((a + e) / 2.0 - x) } else { qi * (e - x).powi(2) / 2.0 }
        }).sum()
    };
    let lijn = &uit.diagrams.moment_y[0];
    let mut getoetst = 0;
    for k in 0..=n {
        let t = k as f64 / n as f64;
        for punt in lijn.points.iter().filter(|p| (p.t - t).abs() < 1e-12) {
            assert!((punt.value.abs() - moment(t * l)).abs() < 1e-10 * inklemming_m, "M op t = {t}: {} tegen {}", punt.value, moment(t * l));
            getoetst += 1;
        }
    }
    assert!(getoetst >= n + 1, "momentenlijn op elke grens");
    // Zakking: δ = Σ 1/(E·I_i)·∫ M(x)·(L−x) dx, Simpson exact per deel.
    let delta: f64 = doorsneden.iter().enumerate().map(|(i, d)| {
        let (a, e) = (i as f64 * h, (i + 1) as f64 * h);
        let g = |x: f64| moment(x) * (l - x);
        (e - a) / 6.0 * (g(a) + 4.0 * g((a + e) / 2.0) + g(e)) / (E * d.iy_m4)
    }).sum();
    grens(relatief(-verplaatsing(&uit, 2)[2], delta), 1e-10, "(c) zakking onder eigen gewicht");
}

// ---------------------------------------------------------------- (d)

/// Kleinste knikkracht van een getrapte pendelkolom (E·I_i per deel, gelijke
/// delen): per deel w'' + k²·w = 0 met k² = P/(E·I_i); w en w' lopen door over
/// de grenzen. Overdracht van (w, w') vanaf (0, 1); de eerste P > 0 met
/// w(L) = 0 is de knikkracht (tekenwissel, daarna halveren).
fn knikkracht_getrapt(l: f64, ei: &[f64]) -> f64 {
    let h = l / ei.len() as f64;
    let w_eind = |p: f64| {
        let (mut w, mut dw) = (0.0f64, 1.0f64);
        for &stijfheid in ei {
            let k = (p / stijfheid).sqrt();
            let (c, s) = ((k * h).cos(), (k * h).sin());
            (w, dw) = (w * c + dw * s / k, -w * k * s + dw * c);
        }
        w
    };
    let ei_min = ei.iter().copied().fold(f64::INFINITY, f64::min);
    let mut laag = 0.5 * PI * PI * ei_min / (l * l);
    assert!(w_eind(laag) > 0.0);
    let mut hoog = laag;
    while w_eind(hoog) > 0.0 { laag = hoog; hoog *= 1.01; }
    for _ in 0..200 {
        let midden = 0.5 * (laag + hoog);
        if w_eind(midden) > 0.0 { laag = midden } else { hoog = midden }
    }
    0.5 * (laag + hoog)
}

/// De kolom: 6 m lang langs X, hoogte 300 mm (lokaal z), breedte (lokaal y)
/// lineair van 120 naar 80 mm: knik om de zwakke as, I_z = 0,3·d³/12.
fn kolom_doorsneden(n: usize) -> Vec<Section3D> {
    (0..n).map(|i| {
        let t = (i as f64 + 0.5) / n as f64;
        rechthoek(11 + i, 0.12 + (0.08 - 0.12) * t, 0.3)
    }).collect()
}

/// (d) Verlopende pendelkolom onder 100 kN druk: de eerste knikfactor van de
/// adapter tegen de exacte knikkracht van dezelfde getrapte kolom. Verschil:
/// alleen de discretisatie met één kubisch element per deel; voor een
/// prismatische pendelkolom met n elementen is dat ≈ 5·10⁻⁴·(4/n)⁴ (0,05 % bij
/// 4 elementen), de grens is het dubbele. Tegen de continue kolom (I(x) van
/// het tussenprofiel, 4000 delen met Richardson) convergeert het met O(1/n²).
/// Knikgegevens: N_cr = λ·|N|, kniklengte uit het deel met de grootste |N|/A.
#[test]
fn d_knik_van_een_verlopende_kolom() {
    let (l, p) = (6.0, 100.0);
    let fijn = |n: usize| knikkracht_getrapt(l, &kolom_doorsneden(n).iter().map(|d| E * d.iz_m4).collect::<Vec<_>>());
    let continu = (4.0 * fijn(4000) - fijn(2000)) / 3.0;
    eprintln!("(d) continue kolom: P_cr = {continu:.4} kN (prismatisch 120 mm: {:.4} kN, 80 mm: {:.4} kN)",
        PI * PI * E * 0.3 * 0.12f64.powi(3) / 12.0 / (l * l), PI * PI * E * 0.3 * 0.08f64.powi(3) / 12.0 / (l * l));
    let mut fouten = Vec::new();
    for n in [4, 8, 16, 32] {
        let doorsneden = kolom_doorsneden(n);
        let mut alle = vec![rechthoek(1, 0.12, 0.3)];
        alle.extend(doorsneden.clone());
        let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
            vec![verlopend(staaf(1, 1, 2, 1), &doorsneden)], alle,
            vec![steun(1, [true, true, true, true, false, false]), steun(2, [false, true, true, false, false, false])]);
        r.nodal_loads.push(knooplast(1, 2, [-p, 0.0, 0.0, 0.0, 0.0, 0.0]));
        r.buckling_modes = 2;
        let uit = solve(r).unwrap();
        let BucklingSummary::Available { modes, members } = &uit.buckling else { panic!("knik: {:?}", uit.buckling) };
        let p_kern = modes[0].load_factor * p;
        let getrapt = knikkracht_getrapt(l, &doorsneden.iter().map(|d| E * d.iz_m4).collect::<Vec<_>>());
        grens(relatief(p_kern, getrapt), 2.0 * 5e-4 * (4.0 / n as f64).powi(4),
            &format!("(d) n = {n}: P_cr {p_kern:.4} kN tegen de getrapte kolom {getrapt:.4} kN"));
        let fout = relatief(p_kern, continu);
        eprintln!("(d) n = {n}: tegen de continue kolom {fout:.3e}");
        fouten.push(fout);

        // Knikgegevens: één regel voor de hele staaf.
        assert_eq!(members.len(), 1);
        let data = &members[0];
        assert_eq!(data.member_id, 1);
        assert!((data.length_m - l).abs() < 1e-12);
        grens(relatief(data.axial_force_kn, -p), 1e-9, &format!("(d) n = {n}: N"));
        grens(relatief(data.critical_force_kn, p_kern), 1e-12, &format!("(d) n = {n}: N_cr = λ·|N|"));
        // Constante N: het kleinste (laatste) deel heeft de grootste |N|/A.
        let klein = doorsneden.last().unwrap();
        let l_eff = PI * (E * klein.iz_m4.min(klein.iy_m4) / p_kern).sqrt();
        grens(relatief(data.effective_length_m, l_eff), 1e-9, &format!("(d) n = {n}: kniklengte uit het kleinste deel"));
        grens(relatief(data.effective_length_factor, l_eff / l), 1e-9, &format!("(d) n = {n}: kniklengtefactor"));
        grens(relatief(data.slenderness_z, l_eff / (klein.iz_m4 / klein.area_m2).sqrt()), 1e-9, &format!("(d) n = {n}: slankheid"));
    }
    for paar in fouten.windows(2) {
        assert!(paar[1] < paar[0] / 3.0, "convergentie naar de continue kolom: {fouten:?}");
    }
    grens(*fouten.last().unwrap(), 1e-3, "(d) n = 32 tegen de continue kolom");
}

/// (d) Knikgegevens bij een normaalkracht die langs de verlopende staaf
/// verandert. Pendelkolom 6 m, rechthoek 300 breed, hoogte 160 → 80 mm in 4
/// delen (A = 45 000, 39 000, 33 000, 27 000 mm²); een tussenknoop op de helft
/// met 100 kN en 400 kN op de kop, dus 500 kN in de onderste twee delen en
/// 400 kN in de bovenste twee. N en N_cr van de staaf zijn, zoals bij een
/// prismatische geknipte staaf, de grootste |N| (500 kN) en λ·500 kN. De
/// kniklengte en de slankheden komen van het bovenste deel (de grootste
/// |N|/A: 400/27 000 tegen 500/39 000), met zijn eigen knikkracht λ·400 kN.
#[test]
fn d_knikgegevens_bij_een_veranderende_normaalkracht() {
    let l = 6.0;
    let doorsneden = delen(11, 4, 0.3, 0.16, 0.08);
    let mut alle = vec![rechthoek(1, 0.3, 0.16)];
    alle.extend(doorsneden.clone());
    let mut kolom = verlopend(staaf(1, 1, 2, 1), &doorsneden);
    kolom.intermediate_node_ids = vec![3];
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0), knoop(3, l / 2.0, 0.0, 0.0)],
        vec![kolom], alle,
        vec![steun(1, [true, true, true, true, false, false]), steun(2, [false, true, true, false, false, false])]);
    r.nodal_loads.push(knooplast(1, 3, [-100.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    r.nodal_loads.push(knooplast(2, 2, [-400.0, 0.0, 0.0, 0.0, 0.0, 0.0]));
    r.buckling_modes = 2;
    let uit = solve(r).unwrap();
    let BucklingSummary::Available { modes, members } = &uit.buckling else { panic!("knik: {:?}", uit.buckling) };
    let lambda = modes[0].load_factor;
    assert_eq!(members.len(), 1, "één regel voor de hele staaf");
    let data = &members[0];
    grens(relatief(data.axial_force_kn, -500.0), 1e-9, "(d) veranderende N: N is de grootste |N| (500 kN)");
    grens(relatief(data.critical_force_kn, lambda * 500.0), 1e-12, "(d) veranderende N: N_cr = λ·max|N|");
    // Het bovenste deel: de grootste spanning, met zijn eigen knikkracht λ·400 kN.
    let spanning: Vec<f64> = doorsneden.iter().zip([500.0, 500.0, 400.0, 400.0]).map(|(d, n)| n / d.area_m2).collect();
    assert!(spanning[3] > spanning[0] && spanning[3] > spanning[1] && spanning[3] > spanning[2], "{spanning:?}");
    let boven = &doorsneden[3];
    let l_eff = PI * (E * boven.iy_m4.min(boven.iz_m4) / (lambda * 400.0)).sqrt();
    grens(relatief(data.effective_length_m, l_eff), 1e-9, "(d) veranderende N: kniklengte uit het bovenste deel met λ·400 kN");
    grens(relatief(data.effective_length_factor, l_eff / l), 1e-9, "(d) veranderende N: kniklengtefactor");
    grens(relatief(data.slenderness_y, l_eff / (boven.iy_m4 / boven.area_m2).sqrt()), 1e-9, "(d) veranderende N: slankheid y");
    grens(relatief(data.slenderness_z, l_eff / (boven.iz_m4 / boven.area_m2).sqrt()), 1e-9, "(d) veranderende N: slankheid z");
}

// ---------------------------------------------------------------- (e)

/// (e) Vloer 6 × 6 m (MITC4, 12 × 12) op vier verlopende funderingsbalken op
/// bedding (#106), met plaatknopen als tussenknopen. Twee balken in 5 delen
/// (grenzen tussen de plaatknopen: nieuwe rekenknopen), twee in 6 delen
/// (grenzen op plaatknopen). Eén balk draagt een globale Z-last (wand) en een
/// globale X-last langs de staaf (#80). De grond draagt alle verticale last,
/// twee hoekknopen de horizontale.
#[test]
fn e_bedding_plaatknopen_en_globale_lasten() {
    let (a, n) = (6.0, 12);
    let mut nodes = Vec::new();
    let id = |i: usize, j: usize| 1 + j * (n + 1) + i;
    for j in 0..=n {
        for i in 0..=n {
            nodes.push(knoop(id(i, j), a * i as f64 / n as f64, a * j as f64 / n as f64, 0.0));
        }
    }
    let mut shell_elements = Vec::new();
    for j in 0..n {
        for i in 0..n {
            shell_elements.push(ShellElement3D {
                id: shell_elements.len() + 1, plate_id: 1,
                node_ids: vec![id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
            });
        }
    }
    let vijf = delen(11, 5, 0.3, 0.6, 0.4);
    let zes = delen(21, 6, 0.3, 0.6, 0.4);
    let mut sections = vec![rechthoek(1, 0.3, 0.6)];
    sections.extend(vijf.clone());
    sections.extend(zes.clone());
    let randen = [((0, 0), (n, 0)), ((n, 0), (n, n)), ((n, n), (0, n)), ((0, n), (0, 0))];
    let mut members = Vec::new();
    for (index, (begin, eind)) in randen.iter().enumerate() {
        let tussen: Vec<usize> = (1..n).map(|k| {
            let s = k as f64 / n as f64;
            let lerp = |p: usize, q: usize| (p as f64 + (q as f64 - p as f64) * s).round() as usize;
            id(lerp(begin.0, eind.0), lerp(begin.1, eind.1))
        }).collect();
        let mut balk = verlopend(staaf(index + 1, id(begin.0, begin.1), id(eind.0, eind.1), 1),
            if index % 2 == 0 { &vijf } else { &zes });
        balk.intermediate_node_ids = tussen;
        balk.bedding = Some(Bedding3D { k_kn_per_m3: Some(20_000.0), width_m: 0.6, k_lateral_kn_per_m3: None, compression_only: false });
        members.push(balk);
    }
    let mut r = verzoek(nodes, members, sections,
        vec![steun(id(0, 0), [true, true, false, false, false, false]), steun(id(n, 0), [false, true, false, false, false, false])]);
    r.materials[0] = Material3D { id: 1, name: "beton".into(), e_mpa: 30_000.0, nu: 0.2, g_mpa: None, alpha_per_k: None };
    r.plates.push(Plate3D { id: 1, material_id: 1, thickness_m: 0.2, bedding: None, orthotropy: None });
    r.shell_elements = shell_elements;
    r.surface_loads.push(SurfaceLoad3D { id: 1, plate_id: 1, qx_kn_per_m2: 0.0, qy_kn_per_m2: 0.0, qz_kn_per_m2: -5.0 });
    r.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [-8.0, -8.0], None));
    r.member_loads.push(globaal(2, 1, GlobalDirection3D::X, [2.0, 2.0], None));
    let uit = solve(r).unwrap();

    let verticaal = 5.0 * a * a + 8.0 * a;
    let grond: f64 = uit.bedding.iter().map(|b| b.total_reaction_kn).sum();
    grens(relatief(grond, verticaal), 1e-9, "(e) grond draagt q·A + wandlast");
    let rx: f64 = uit.reactions.iter().map(|r| r.fx).sum();
    grens(relatief(rx, -2.0 * a), 1e-9, "(e) horizontale reactie = −globale X-last");
    let evenwicht = uit.equilibrium.as_ref().unwrap();
    assert!(evenwicht.equilibrium_ok && evenwicht.residual_ok, "{evenwicht:?}");
    // Alleen modelknopen in de uitvoer; vier staven, elk één lijn over de hele lengte.
    assert_eq!(uit.displacements.len(), (n + 1) * (n + 1));
    assert_eq!(uit.member_forces.len(), 4);
    assert!(uit.diagrams.moment_y.iter().all(|d| d.points.first().unwrap().t.abs() < 1e-12
        && (d.points.last().unwrap().t - 1.0).abs() < 1e-12));
    // De grenzen van de 5-delige balk (geen plaatknoop) zijn rekenknopen van de bedding.
    let balk = uit.bedding.iter().find(|b| b.member_id == 1).unwrap();
    for k in 1..5 {
        let t = k as f64 / 5.0;
        assert!(balk.points.iter().any(|p| (p.t - t).abs() < 1e-12), "rekenknoop op de grens t = {t}");
    }
    // De 6-delige balk: grenzen op plaatknopen, dus geen extra rekenknopen.
    let ander = uit.bedding.iter().find(|b| b.member_id == 2).unwrap();
    let zonder_grenzen = ander.points.len();
    assert!(ander.points.windows(2).all(|p| p[1].t > p[0].t), "oplopend, geen dubbele");
    eprintln!("(e) bedding: balk 1 {} rekenknopen, balk 2 {zonder_grenzen}", balk.points.len());
}

/// (e) Eén verlopende balk met alles tegelijk: bedding met alleen druk
/// (#106), scharnierende einden (#96), een globale Z-last (#80) en een
/// opwaartse knooplast op het eind, zodat dat eind loskomt. De statuslus van
/// de bedding telt de grensknopen als gewone rekenknopen; de grond draagt de
/// netto verticale last.
#[test]
fn e_bedding_alleen_druk_scharnieren_en_globale_last_op_een_verlopende_balk() {
    let l = 8.0;
    let doorsneden = delen(11, 5, 0.3, 0.7, 0.35);
    let mut alle = vec![rechthoek(1, 0.3, 0.7)];
    alle.extend(doorsneden.clone());
    let mut balk = verlopend(staaf(1, 1, 2, 1), &doorsneden);
    balk.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true, torsion_start: false, torsion_end: false };
    balk.bedding = Some(Bedding3D { k_kn_per_m3: Some(5_000.0), width_m: 0.6, k_lateral_kn_per_m3: None, compression_only: true });
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)], vec![balk], alle,
        vec![steun(1, [true, true, false, false, false, false]), steun(2, [false, true, false, false, false, false])]);
    r.member_loads.push(globaal(1, 1, GlobalDirection3D::Z, [-10.0, -10.0], Some((0.0, 5.0))));
    r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, 15.0, 0.0, 0.0, 0.0]));
    let uit = solve(r).unwrap();
    let grond = &uit.bedding[0];
    grens(relatief(grond.total_reaction_kn, 10.0 * 5.0 - 15.0), 1e-9, "(e) alleen druk: grond = netto verticale last");
    assert!(grond.lifted_fraction > 0.0 && grond.lifted_fraction < 1.0, "deels los: {}", grond.lifted_fraction);
    let melding = uit.diagnostics.iter().find(|m| m.starts_with("Bedding alleen druk: los van de grond"))
        .unwrap_or_else(|| panic!("melding statuslus: {:?}", uit.diagnostics));
    for k in 1..5 {
        let t = k as f64 / 5.0;
        assert!(grond.points.iter().any(|p| (p.t - t).abs() < 1e-12), "grensknoop t = {t} is rekenknoop");
    }
    assert!(grond.points.iter().all(|p| p.pressure_kn_per_m >= 0.0), "alleen druk");
    assert!(uit.equilibrium.as_ref().unwrap().equilibrium_ok);
    let mut knopen: Vec<usize> = uit.displacements.iter().map(|d| d.node_id).collect();
    knopen.sort_unstable();
    assert_eq!(knopen, vec![1, 2]);
    eprintln!("(e) alleen druk: los over {:.1} % van de lengte; {melding}", 100.0 * grond.lifted_fraction);
}

/// (e) Een verlopende ligger met scharnierende einden (#96) op
/// scharnieropleggingen: statisch bepaald, dus reacties q·L/2 en het
/// veldmoment q·L²/8 ongeacht de doorsneden. De vrije knoopdraaiing noemt alleen
/// de modelknopen.
#[test]
fn e_scharnierende_verlopende_ligger() {
    let (l, q) = (5.0, -6.0);
    let doorsneden = delen(11, 4, 0.2, 0.3, 0.5);
    let mut alle = vec![rechthoek(1, 0.2, 0.3)];
    alle.extend(doorsneden.clone());
    let mut ligger = verlopend(staaf(1, 1, 2, 1), &doorsneden);
    ligger.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true, torsion_start: false, torsion_end: false };
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)], vec![ligger], alle,
        vec![steun(1, [true, true, true, false, false, false]), steun(2, [false, true, true, false, false, false])]);
    r.member_loads.push(MemberLoad3D { id: 1, member_id: 1, qz_start_kn_per_m: q, qz_end_kn_per_m: q, ..Default::default() });
    let uit = solve(r).unwrap();
    grens(relatief(reactie(&uit, 1)[2], -q * l / 2.0), 1e-9, "(e) scharnierend: reactie begin");
    grens(relatief(reactie(&uit, 2)[2], -q * l / 2.0), 1e-9, "(e) scharnierend: reactie eind");
    let midden = uit.diagrams.moment_y[0].points.iter().find(|p| (p.t - 0.5).abs() < 1e-12).expect("punt op de grens t = 0,5");
    grens(relatief(midden.value.abs(), q.abs() * l * l / 8.0), 1e-9, "(e) scharnierend: veldmoment");
    let melding = uit.diagnostics.iter().find(|m| m.contains("Vrije knoopdraaiing")).expect("melding vrije knoopdraaiing");
    assert!(!melding.contains("rekenknopen"), "alleen modelknopen: {melding}");
    assert!(uit.equilibrium.as_ref().unwrap().equilibrium_ok);
}

/// (e) Torsie aan beide einden vrij, zonder plaatknopen: alleen het eerste deel
/// krijgt de vrijgave, dus de grensknopen draaien niet vrij om de staafas.
#[test]
fn e_torsievrijgave_aan_beide_einden() {
    let doorsneden = delen(11, 4, 0.2, 0.5, 0.3);
    let mut alle = vec![rechthoek(1, 0.2, 0.5)];
    alle.extend(doorsneden.clone());
    let mut ligger = verlopend(staaf(1, 1, 2, 1), &doorsneden);
    ligger.releases.torsion_start = true;
    ligger.releases.torsion_end = true;
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 6.0, 0.0, 0.0)], vec![ligger], alle,
        vec![steun(1, [true, true, true, true, false, false]), steun(2, [false, true, true, true, false, false])]);
    r.member_loads.push(MemberLoad3D { id: 1, member_id: 1, qz_start_kn_per_m: -4.0, qz_end_kn_per_m: -4.0, ..Default::default() });
    let uit = solve(r).unwrap();
    assert!(uit.diagnostics.iter().all(|m| !m.contains("Vrije knoopdraaiing")), "{:?}", uit.diagnostics);
    grens(relatief(reactie(&uit, 1)[2] + reactie(&uit, 2)[2], 24.0), 1e-12, "(e) torsievrij: verticale som");
    assert!(uit.diagrams.torsion[0].max_abs_value < 1e-9);
}

/// (e) Een verlopende trek-alleen staaf naast een veer: onder trek doet zij mee
/// met de axiale stijfheid van de delen in serie, E/Σ(h/A_i); onder druk valt
/// zij weg en blijft zij weg (de status kijkt met dezelfde stijfheid).
#[test]
fn e_trek_alleen_verlopend() {
    let doorsneden = delen(11, 3, 0.05, 0.05, 0.02);
    let mut alle = vec![rechthoek(1, 0.05, 0.05)];
    alle.extend(doorsneden.clone());
    let l = 3.0;
    let h = l / 3.0;
    let ea_l = E / doorsneden.iter().map(|d| h / d.area_m2).sum::<f64>();
    let veer = 1.0e4;
    for f in [10.0, -10.0] {
        let mut trek = verlopend(staaf(1, 1, 2, 1), &doorsneden);
        trek.tension_only = true;
        let mut tweede = steun(2, [false, true, true, true, true, true]);
        tweede.kx_kn_per_m = Some(veer);
        let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)], vec![trek], alle.clone(),
            vec![inklemming(1), tweede]);
        r.nodal_loads.push(knooplast(1, 2, [f, 0.0, 0.0, 0.0, 0.0, 0.0]));
        let uit = solve(r).unwrap();
        let ux = verplaatsing(&uit, 2)[0];
        if f > 0.0 {
            assert!(uit.inactive_members.is_empty());
            grens(relatief(ux, f / (veer + ea_l)), 1e-10, "(e) trek-alleen onder trek: u = F/(k + EA_eq/L)");
            grens(relatief(uit.member_forces[0].n_start_kn, f * ea_l / (veer + ea_l)), 1e-9, "(e) trek-alleen: N");
        } else {
            assert_eq!(uit.inactive_members, vec![1]);
            grens(relatief(ux, f / veer), 1e-12, "(e) trek-alleen onder druk: alleen de veer");
        }
    }
}

/// De delen van een verlopende strip in serie: A_eq = n/Σ(1/A_i).
fn a_eq(doorsneden: &[Section3D]) -> f64 {
    doorsneden.len() as f64 / doorsneden.iter().map(|d| 1.0 / d.area_m2).sum::<f64>()
}

fn scharnierend(mut s: Member3D) -> Member3D {
    s.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true, torsion_start: false, torsion_end: false };
    s
}

/// (e) Montage (`tensionOnlyFit`) van een verlopende trek-alleen hanger: de
/// knoop eronder hangt alleen aan de hanger, dus de montagelast P blijft in de
/// hanger (Δ0 = 0, zoals bij een prismatische hanger). De montage rekent de
/// kracht met de axiale stijfheid E·A_eq/L van de delen in serie,
/// A_eq = n/Σ(1/A_i): de restkracht in de melding is dan precies P. Met de
/// oppervlakte van het begin (2·10⁻⁴ m²) zou zij P·A_begin/A_eq = 9,0 kN
/// noemen, met het gemiddelde 22,5 kN.
#[test]
fn e_montage_van_een_verlopende_trek_alleen_hanger() {
    let (l, p) = (4.0, 20.0);
    let doorsneden = delen(11, 3, 0.01, 0.02, 0.08);
    let mut alle = vec![rechthoek(1, 0.01, 0.02)];
    alle.extend(doorsneden.clone());
    let mut hanger = verlopend(staaf(1, 1, 2, 1), &doorsneden);
    hanger.tension_only = true;
    let onder = steun(2, [true, true, false, true, true, true]);
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, l), knoop(2, 0.0, 0.0, 0.0)], vec![hanger], alle,
        vec![inklemming(1), onder]);
    r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -p, 0.0, 0.0, 0.0]));
    r.tension_only_fit = Some(TensionOnlyFit3D {
        nodal_loads: vec![knooplast(1, 2, [0.0, 0.0, -p, 0.0, 0.0, 0.0])], ..Default::default()
    });
    let uit = solve(r).unwrap();
    assert!(uit.inactive_members.is_empty());
    grens(relatief(uit.member_forces[0].n_start_kn, p), 1e-9, "(e) montage: de hanger draagt P");
    let delta = uit.tension_only_fit.iter().find(|f| f.member_id == 1).unwrap().delta_mm;
    assert!(delta.abs() <= 1e-9, "(e) montage: de hanger op zijn tekenlengte, Δ0 = {delta} mm");
    let zakking = p * doorsneden.iter().map(|d| (l / 3.0) / d.area_m2).sum::<f64>() / E;
    grens(relatief(verplaatsing(&uit, 2)[2], -zakking), 1e-9, "(e) montage: uz = −P·Σ(L_i/A_i)/E");
    grens(relatief(E * a_eq(&doorsneden) / l * zakking, p), 1e-12, "(e) montage: E·A_eq/L is de stijfheid van de delen in serie");
    let melding = format!("niet kan dragen; grootste |N| = {p:.3} kN (staaf 1)");
    assert!(uit.diagnostics.iter().any(|d| d.contains(&melding)), "{melding} in {:?}", uit.diagnostics);
}

/// (e) Kruisregel met een verlopende diagonaal. Portaal 6 × 4 m (XZ-vlak),
/// ingeklemde kolommen (A = 0,01 m²), de koppen horizontaal vast, een
/// scharnierende ligger en twee scharnierende trek-alleen strips: 4 (1→4)
/// prismatisch met A₄ = 4·10⁻⁴ m², 5 (2→3) verlopend van 10 × 20 naar
/// 10 × 80 mm in drie delen, A_eq = 4,44·10⁻⁴ m² (begin 2·10⁻⁴ m²). P op beide
/// koppen verkort de kolommen; zonder zijdelingse beweging verkort strip i
/// met s·w van zijn kop, w = −P/(k_v + k_i·s²), k_i = E·A_i/L. Beide strips
/// komen op druk en de regel houdt de minst gedrukte: N₄ = −k₄·s·P/(k_v + k₄·s²).
/// Daarna is strip 5 inactief, haar kop zakt P/k_v, en de status rekent haar
/// N met A_eq: N₅ = −E·A_eq/L·s·P/k_v < N₄, dus strip 4 blijft. Met de
/// oppervlakte van het begin zou N₅ boven N₄ liggen en zou de regel tussen de
/// strips heen en weer gaan.
#[test]
fn e_kruisregel_met_een_verlopende_diagonaal() {
    let (b, h, p) = (6.0, 4.0, 500.0);
    let (a_kolom, i_kolom) = (0.01, 1e-4);
    let kolom = Section3D {
        id: 1, name: "kolom".into(), area_m2: a_kolom, iy_m4: i_kolom, iz_m4: i_kolom, torsion_j_m4: i_kolom,
        shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None,
    };
    let strip = delen(11, 3, 0.01, 0.02, 0.08);
    let mut alle = vec![kolom, rechthoek(2, 0.01, 0.04), rechthoek(3, 0.01, 0.02)];
    alle.extend(strip.clone());
    let mut vier = scharnierend(staaf(4, 1, 4, 2));
    vier.tension_only = true;
    let mut vijf = scharnierend(verlopend(staaf(5, 2, 3, 3), &strip));
    vijf.tension_only = true;
    let kop = |node_id| steun(node_id, [true, true, false, false, false, false]);
    let mut r = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, b, 0.0, 0.0), knoop(3, 0.0, 0.0, h), knoop(4, b, 0.0, h)],
        vec![staaf(1, 1, 3, 1), staaf(2, 2, 4, 1), scharnierend(staaf(3, 3, 4, 1)), vier, vijf],
        alle, vec![inklemming(1), inklemming(2), kop(3), kop(4)]);
    r.nodal_loads.push(knooplast(1, 3, [0.0, 0.0, -p, 0.0, 0.0, 0.0]));
    r.nodal_loads.push(knooplast(2, 4, [0.0, 0.0, -p, 0.0, 0.0, 0.0]));
    r.tension_only_cross_rule = true;
    let uit = solve(r).unwrap();
    assert_eq!(uit.inactive_members, vec![5], "de verlopende diagonaal valt weg");
    assert_eq!(uit.cross_rule_members, vec![4], "de regel houdt de prismatische diagonaal");
    let l = (b * b + h * h).sqrt();
    let s = h / l;
    let (kv, k4) = (E * a_kolom / h, E * 4e-4 / l);
    let n4 = -k4 * s * p / (kv + k4 * s * s);
    let f4 = uit.member_forces.iter().find(|f| f.member_id == 4).unwrap();
    grens(relatief(f4.n_start_kn, n4), 1e-9, "(e) kruisregel: N₄ = −k₄·s·P/(k_v + k₄·s²)");
    grens(relatief(verplaatsing(&uit, 3)[2], -p / kv), 1e-9, "(e) kruisregel: de kop van de inactieve strip zakt P/k_v");
    grens(relatief(verplaatsing(&uit, 4)[2], -p / (kv + k4 * s * s)), 1e-9, "(e) kruisregel: de kop van de gehouden strip");
    // De grootheid waarop de regel kiest: N₅ met A_eq ligt onder N₄; met de
    // oppervlakte van het begin zou zij erboven liggen (de toets is daarvoor gevoelig).
    let n5 = |a: f64| E * a / l * s * (-p / kv);
    assert!(n5(a_eq(&strip)) < n4, "N₅ met A_eq {} < N₄ {n4}", n5(a_eq(&strip)));
    assert!(n5(0.01 * 0.02) > n4, "met A van het begin {} > N₄ {n4}", n5(0.01 * 0.02));
    let regel = uit.diagnostics.iter().find(|d| d.starts_with("Kruisregel")).expect("melding kruisregel");
    assert!(regel.contains(&format!("Grootste drukkracht in een actieve trek-alleen staaf: {:.3} kN (staaf 4)", -n4)), "{regel}");
    assert!(uit.equilibrium.as_ref().unwrap().equilibrium_ok);
}

/// (e) Portaal met verlopende kolommen in tweede orde: geen fout, krachtensom
/// sluit, versterking > 1 en knikgegevens per modelstaaf.
#[test]
fn e_tweede_orde_met_verlopende_kolommen() {
    let kolom = delen(11, 6, 0.3, 0.25, 0.45);
    let mut alle = vec![rechthoek(1, 0.3, 0.25), rechthoek(2, 0.3, 0.5)];
    alle.extend(kolom.clone());
    let nodes = vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 0.0, 5.0), knoop(3, 8.0, 0.0, 5.0), knoop(4, 8.0, 0.0, 0.0)];
    let mut r = verzoek(nodes,
        vec![verlopend(staaf(1, 1, 2, 1), &kolom), staaf(2, 2, 3, 2), verlopend(staaf(3, 4, 3, 1), &kolom)],
        alle, vec![inklemming(1), inklemming(4)]);
    r.analysis = AnalysisKind::PDelta;
    r.buckling_modes = 2;
    r.nodal_loads.push(knooplast(1, 2, [20.0, 0.0, -600.0, 0.0, 0.0, 0.0]));
    r.nodal_loads.push(knooplast(2, 3, [0.0, 0.0, -600.0, 0.0, 0.0, 0.0]));
    r.member_loads.push(globaal(3, 2, GlobalDirection3D::Z, [-10.0, -10.0], None));
    let uit = solve(r).unwrap();
    let tweede = uit.second_order.as_ref().unwrap();
    assert!(tweede.converged && tweede.max_amplification > 1.0, "{tweede:?}");
    let som: [f64; 3] = [0, 1, 2].map(|i| uit.reactions.iter().map(|r| reactie(&uit, r.node_id)[i]).sum::<f64>());
    grens((som[0] + 20.0).abs() / 1300.0, 1e-9, "(e) tweede orde: Σ Rx");
    grens((som[2] - 1280.0).abs() / 1300.0, 1e-9, "(e) tweede orde: Σ Rz");
    let mut knopen: Vec<usize> = uit.displacements.iter().map(|d| d.node_id).collect();
    knopen.sort_unstable();
    assert_eq!(knopen, vec![1, 2, 3, 4]);
    let BucklingSummary::Available { modes, members } = &uit.buckling else { panic!("{:?}", uit.buckling) };
    assert!(modes[0].load_factor > 1.0);
    let mut staven: Vec<usize> = members.iter().map(|m| m.member_id).collect();
    staven.sort_unstable();
    assert_eq!(staven, vec![1, 2, 3]);
    eprintln!("(e) tweede orde: versterking {:.4}, α_cr {:.3}", tweede.max_amplification, modes[0].load_factor);
}

// ---------------------------------------------------------------- (f)

/// (f) Foutmeldingen: te weinig of te veel delen en een onbekende doorsnede.
#[test]
fn f_foutmeldingen() {
    let fout = |delen_ids: Vec<usize>| {
        let mut alle = vec![rechthoek(1, 0.2, 0.4)];
        alle.extend(delen(11, 3, 0.2, 0.4, 0.2));
        let mut s = staaf(7, 1, 2, 1);
        s.part_section_ids = Some(delen_ids);
        let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0)], vec![s], alle, vec![inklemming(1)]);
        r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -1.0, 0.0, 0.0, 0.0]));
        solve(r).unwrap_err()
    };
    for (lijst, aantal) in [(vec![], 0), (vec![11], 1), (vec![11; 65], 65)] {
        let tekst = fout(lijst);
        assert!(tekst.contains("staaf 7") && tekst.contains("partSectionIds") && tekst.contains(&format!("bevat {aantal} "))
            && tekst.contains("2 t/m 64"), "{tekst}");
    }
    let tekst = fout(vec![11, 12, 99]);
    assert!(tekst.contains("staaf 7") && tekst.contains("deel 3 van partSectionIds") && tekst.contains("ontbrekende doorsnede 99"), "{tekst}");
    // 64 delen mag.
    let mut alle = vec![rechthoek(1, 0.2, 0.4)];
    let veel = delen(11, 64, 0.2, 0.4, 0.2);
    alle.extend(veel.clone());
    let mut r = verzoek(vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0)],
        vec![verlopend(staaf(7, 1, 2, 1), &veel)], alle, vec![inklemming(1)]);
    r.nodal_loads.push(knooplast(1, 2, [0.0, 0.0, -1.0, 0.0, 0.0, 0.0]));
    assert!(solve(r).is_ok());
}

/// (f) Het contract: `partSectionIds` in camelCase; een oude staaf leest en
/// schrijft byte-gelijk (geen nieuwe sleutel), een tikfout wordt geweigerd.
#[test]
fn f_contract_json() {
    let oud = r#"{"id":1,"startNodeId":1,"endNodeId":2,"materialId":1,"sectionId":1,"releases":{"myStart":false,"myEnd":false,"mzStart":false,"mzEnd":false,"torsionStart":false,"torsionEnd":false},"rollAngleRad":null,"intermediateNodeIds":[],"tensionOnly":false}"#;
    let staaf: Member3D = serde_json::from_str(oud).unwrap();
    assert!(staaf.part_section_ids.is_none());
    assert_eq!(serde_json::to_string(&staaf).unwrap(), oud, "oude staaf byte-gelijk terug");
    let nieuw = r#"{"id":1,"startNodeId":1,"endNodeId":2,"materialId":1,"sectionId":1,"partSectionIds":[3,4,5]}"#;
    let staaf: Member3D = serde_json::from_str(nieuw).unwrap();
    assert_eq!(staaf.part_section_ids, Some(vec![3, 4, 5]));
    assert!(serde_json::to_string(&staaf).unwrap().contains(r#""partSectionIds":[3,4,5]"#));
    let tikfout = r#"{"id":1,"startNodeId":1,"endNodeId":2,"materialId":1,"sectionId":1,"partSectionId":[3,4]}"#;
    let melding = serde_json::from_str::<Member3D>(tikfout).unwrap_err().to_string();
    assert!(melding.contains("partSectionId"), "{melding}");
}
