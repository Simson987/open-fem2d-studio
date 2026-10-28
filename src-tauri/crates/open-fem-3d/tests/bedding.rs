//! Staaf op bedding (#106): analytische controles volgens de theorie van de
//! ligger op elastische bedding (Winkler; Hetényi).
//!
//! Eenheden: m, kN, kNm; E = 210 000 MPa = 2,1·10⁸ kN/m². De grond heeft de
//! lijnstijfheid k·b (kN/m per m staaf) en λ = (k·b/(4·E·I))^¼.
//!
//! De adapter rekent de bedding met losse veren k·b·L_trib in rekenknopen op
//! hoogstens 0,15/λ van elkaar (zie de module `bedding`). De foutgrenzen
//! hieronder volgen uit die deellengte h en staan per test verantwoord; de
//! gemeten afwijking staat erbij.

use std::f64::consts::{FRAC_PI_2, PI};

use open_fem_3d::{
    solve, AnalysisKind, Bedding3D, BeddingPoint3D, BucklingSummary, EndReleases3D, Material3D, Member3D,
    MemberBedding3D, MemberLoad3D, MemberPointLoad3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D,
    SolveResult3D, Support3D,
};

const E_KN_M2: f64 = 210_000.0 * 1000.0;

fn doorsnede(id: usize, area: f64, iy: f64, iz: f64, j: f64) -> Section3D {
    Section3D { id, name: format!("doorsnede {id}"), area_m2: area, iy_m4: iy, iz_m4: iz,
        torsion_j_m4: j, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

fn knoop(id: usize, x: f64, y: f64, z: f64) -> Node3D { Node3D { id, x, y, z } }

fn staaf(id: usize, begin: usize, eind: usize, sectie: usize) -> Member3D {
    Member3D { id, start_node_id: begin, end_node_id: eind, material_id: 1, section_id: sectie,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
        bedding: None, part_section_ids: None }
}

fn op_bedding(mut staaf: Member3D, k: Option<f64>, b: f64, k_lat: Option<f64>, alleen_druk: bool) -> Member3D {
    staaf.bedding = Some(Bedding3D {
        k_kn_per_m3: k, width_m: b, k_lateral_kn_per_m3: k_lat, compression_only: alleen_druk,
    });
    staaf
}

/// Oplegging met per richting (ux, uy, uz, rx, ry, rz) vast of vrij.
fn steun(node_id: usize, vast: [bool; 6]) -> Support3D {
    Support3D { node_id, ux: vast[0], uy: vast[1], uz: vast[2], rx: vast[3], ry: vast[4], rz: vast[5],
        ..Default::default() }
}

fn knooplast(id: usize, node_id: usize, fx: f64, fy: f64, fz: f64) -> NodalLoad3D {
    NodalLoad3D { id, node_id, fx, fy, fz, mx: 0.0, my: 0.0, mz: 0.0 }
}

fn verzoek(nodes: Vec<Node3D>, sections: Vec<Section3D>, members: Vec<Member3D>, supports: Vec<Support3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "S235".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections, members, supports, nodal_loads: vec![], member_loads: vec![], member_point_loads: vec![],
        thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![], diaphragms: vec![], node_links: vec![],
        tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

fn lambda(kb: f64, ei: f64) -> f64 { (kb / (4.0 * ei)).powf(0.25) }

fn bedding_van(r: &SolveResult3D, staaf: usize) -> &MemberBedding3D {
    r.bedding.iter().find(|b| b.member_id == staaf).expect("staaf staat in de bedding-uitvoer")
}

fn punt_bij(b: &MemberBedding3D, t: f64) -> &BeddingPoint3D {
    b.points.iter().min_by(|p, q| (p.t - t).abs().total_cmp(&(q.t - t).abs())).unwrap()
}

fn afwijking(werkelijk: f64, verwacht: f64) -> f64 { (werkelijk - verwacht).abs() / verwacht.abs() }

fn dichtbij(werkelijk: f64, verwacht: f64, relatief: f64, wat: &str) {
    let fout = afwijking(werkelijk, verwacht);
    assert!(fout <= relatief, "{wat}: berekend {werkelijk:.9e}, verwacht {verwacht:.9e}, afwijking {:.4} %", 100.0 * fout);
}

/// Alleen modelknopen in de verplaatsingen en reacties; de rekenknopen en
/// grondknopen van de adapter blijven binnen.
fn alleen_modelknopen(request: &SolveRequest3D, r: &SolveResult3D) {
    let ids: Vec<usize> = request.nodes.iter().map(|n| n.id).collect();
    assert!(r.displacements.iter().all(|d| ids.contains(&d.node_id)), "verplaatsing van een rekenknoop in de uitvoer");
    assert!(r.reactions.iter().all(|x| ids.contains(&x.node_id)), "reactie van een rekenknoop in de uitvoer");
    assert_eq!(r.displacements.len(), ids.len(), "elke modelknoop heeft een verplaatsing");
}

/// Verticaal evenwicht: knooplasten + oplegreacties + grondreacties = 0.
/// Alleen voor verzoeken met knooplasten en verticale lasten van bekende som.
fn verticaal_evenwicht(r: &SolveResult3D, last_z: f64) {
    let reacties: f64 = r.reactions.iter().map(|x| x.fz).sum();
    let grond: f64 = r.bedding.iter().map(|b| b.total_reaction_kn).sum();
    let rest = last_z + reacties + grond;
    assert!(rest.abs() <= 1e-6 * last_z.abs().max(1.0),
        "verticaal evenwicht: last {last_z}, reacties {reacties}, grond {grond}, rest {rest:.3e}");
    if let Some(evenwicht) = &r.equilibrium {
        assert!(evenwicht.equilibrium_ok, "evenwichtssamenvatting: {evenwicht:?}");
    }
}

/// Alleen druk, punt voor punt de statusregel van de kern: een weggevallen
/// veer zakt niet (zakking ≤ tol) en heeft geen druk, een actieve veer staat
/// niet op trek (zakking ≥ −tol). tol is de statusgrens van de kern: 10⁻⁶ maal
/// de grootste zakking of knoopverplaatsing van het resultaat. Een weggevallen
/// veer die weer de grond in zakt, betekent dat de lus haar niet herstelde.
fn alleen_druk_klopt(r: &SolveResult3D) {
    let schaal = r.bedding.iter().flat_map(|b| b.points.iter()).map(|p| p.settlement_m.abs())
        .chain(r.displacements.iter().flat_map(|d| [d.ux.abs(), d.uy.abs(), d.uz.abs()]))
        .fold(0.0, f64::max);
    let tol = 1e-6 * schaal;
    for grond in &r.bedding {
        for (i, punt) in grond.points.iter().enumerate() {
            if punt.active {
                assert!(punt.settlement_m >= -tol,
                    "staaf {} punt {i} (t {:.4}): actief maar komt omhoog ({:.3e} m)", grond.member_id, punt.t, punt.settlement_m);
            } else {
                assert!(punt.settlement_m <= tol,
                    "staaf {} punt {i} (t {:.4}): los maar zakt de grond in ({:.3e} m)", grond.member_id, punt.t, punt.settlement_m);
                assert_eq!(punt.pressure_kn_per_m, 0.0, "staaf {} punt {i}: los, dus geen druk", grond.member_id);
            }
        }
    }
}

/// Oneindig lange ligger (L·λ = 23,9) onder een puntlast P in het midden:
/// w₀ = P·λ/(2·k·b) en M₀ = P/(4·λ). Langs X, langs Y, en langs X met een
/// rolhoek van 90°, waarbij de verticale buiging bij I_z hoort.
///
/// Foutgrens 1,5 %. De einden liggen op λ·x ≈ 12 van de last (invloed
/// e^(−12) ≈ 6·10⁻⁶). De grond zit in losse veren op h ≤ 0,15/λ; dat geeft
/// een fout van de orde (λ·h)² = 2,3 % maal een coëfficiënt kleiner dan één.
/// Gemeten (160 delen, λ·h = 0,149): w₀ −0,0004 %, M₀ −0,37 %, in alle drie
/// de richtingen gelijk.
#[test]
fn oneindige_ligger_onder_puntlast_volgt_de_gesloten_oplossing() {
    let (k, b, p) = (50_000.0, 0.8, 100.0);
    let kb = k * b;
    let (iy, iz) = (2e-4, 1e-4);
    for (naam, richting, rol, i_verticaal) in [
        ("langs X", [1.0, 0.0, 0.0], None, iy),
        ("langs Y", [0.0, 1.0, 0.0], None, iy),
        ("langs X, rol 90°", [1.0, 0.0, 0.0], Some(FRAC_PI_2), iz),
    ] {
        let lam = lambda(kb, E_KN_M2 * i_verticaal);
        let l = 23.9 / lam;
        let mut ligger = op_bedding(staaf(1, 1, 2, 1), Some(k), b, None, false);
        ligger.roll_angle_rad = rol;
        // Horizontaal en torsie vast in knoop 1; verticaal alleen de grond.
        let torsie_x = richting[0] == 1.0;
        let mut request = verzoek(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l * richting[0], l * richting[1], 0.0)],
            vec![doorsnede(1, 0.01, iy, iz, 1e-5)],
            vec![ligger],
            vec![steun(1, [true, true, false, torsie_x, !torsie_x, true])],
        );
        // De verticale last: lokaal z omlaag, of lokaal y bij de rol van 90°
        // (e_y wijst dan omhoog).
        let (py, pz) = if rol.is_some() { (-p, 0.0) } else { (0.0, -p) };
        request.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: py, pz_kn: pz, position_m: l / 2.0 });
        let r = solve(request.clone()).unwrap_or_else(|fout| panic!("{naam}: {fout}"));
        alleen_modelknopen(&request, &r);
        let grond = bedding_van(&r, 1);
        let midden = punt_bij(grond, 0.5);
        assert!((midden.t - 0.5).abs() < 1e-9, "{naam}: een rekenknoop in het midden");
        let w0 = p * lam / (2.0 * kb);
        let m0 = p / (4.0 * lam);
        let lijn = if rol.is_some() { &r.diagrams.moment_z } else { &r.diagrams.moment_y };
        let moment = lijn.iter().find(|m| m.member_id == 1).unwrap().max_abs_value;
        eprintln!("{naam}: w0 {:.4} %, M0 {:.4} %, delen {}", 100.0 * (midden.settlement_m - w0) / w0,
            100.0 * (moment - m0) / m0, grond.points.len() - 1);
        dichtbij(midden.settlement_m, w0, 0.015, &format!("{naam}: zakking onder de last"));
        dichtbij(moment, m0, 0.015, &format!("{naam}: moment onder de last"));
        // Dwarskracht naast de last: P/2 aan elke kant (symmetrie). De veer van de
        // middelste rekenknoop (k·b·h·w₀ = P·λh/2) telt als grond over ±h/2, niet
        // als puntlast op de knoop (`bedding::correctie`); zonder die verdeling
        // stond hier P/2·(1 − λh/2), 7,5 % te weinig. Grens 0,5 %.
        let dwars = if rol.is_some() { &r.diagrams.shear_y } else { &r.diagrams.shear_z };
        let dwars = dwars.iter().find(|v| v.member_id == 1).unwrap();
        eprintln!("{naam}: V naast de last {:.4} %", 100.0 * (dwars.max_abs_value - p / 2.0) / (p / 2.0));
        dichtbij(dwars.max_abs_value, p / 2.0, 0.005, &format!("{naam}: dwarskracht naast de last"));
        dichtbij(midden.pressure_kn_per_m, kb * midden.settlement_m, 1e-12, &format!("{naam}: druk = k·b·w"));
        dichtbij(grond.max_settlement_m, midden.settlement_m, 1e-12, &format!("{naam}: grootste zakking"));
        dichtbij(grond.total_reaction_kn, p, 1e-8, &format!("{naam}: grondreactie = last"));
        assert!(grond.points.iter().all(|punt| punt.active && punt.lateral_kn_per_m.is_none()));
        assert_eq!(grond.lifted_fraction, 0.0);
        assert!(grond.points.first().unwrap().t == 0.0 && grond.points.last().unwrap().t == 1.0);
        assert!(grond.points.windows(2).all(|paar| paar[1].t > paar[0].t));
        // Ver van de last staat de ligger vrijwel stil.
        assert!(grond.points.first().unwrap().settlement_m.abs() < 1e-4 * w0, "{naam}: begin zakt niet");
        verticaal_evenwicht(&r, -p);
    }
}

/// Ligger met vrije einden onder een gelijkmatige last q: de zakking is
/// overal q/(k·b) en het moment vrijwel nul.
///
/// Foutgrenzen. Tussen twee veren draagt de ligger q over één deel h. Binnen
/// de ligger geeft dat q·h²/12 boven de veren; het laatste deel aan een vrij
/// einde werkt als een ligger die aan één kant is ingeklemd, met hoogstens
/// q·h²/8 (de inklemming door de rest van de ligger is niet volledig). Dat
/// vrije einde mist het inklemmingsmoment q·h²/12 van het laatste deel; dat
/// verstoort de zakking met 2·M·λ²/(k·b) (halfoneindige ligger), relatief
/// λ²·h²/6 ≤ 0,15²/6 = 0,375 %. Gemeten (47 delen, λ·h = 0,149): zakking
/// 0,363 % (theorie 0,368 %), |M| = 0,112 kNm tegen q·h²/8 = 0,113 kNm; voor
/// de vergelijking: q/λ² = 41 kNm.
#[test]
fn ligger_met_gelijkmatige_last_zakt_overal_even_veel() {
    let (k, b, q, l) = (50_000.0, 0.8, 20.0, 10.0);
    let kb = k * b;
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![doorsnede(1, 0.01, 2e-4, 1e-4, 1e-5)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(k), b, None, false)],
        vec![steun(1, [true, true, false, true, false, true])],
    );
    request.member_loads.push(MemberLoad3D {
        id: 1, member_id: 1, qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -q, qz_end_kn_per_m: -q, start_position_m: None, end_position_m: None,
        ..Default::default()
    });
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let grond = bedding_van(&r, 1);
    let h = l * (grond.points[1].t - grond.points[0].t);
    let w = q / kb;
    let grens_w = (0.15f64).powi(2) / 6.0;
    let grootste_w = grond.points.iter().map(|p| afwijking(p.settlement_m, w)).fold(0.0, f64::max);
    let moment = r.diagrams.moment_y.iter().find(|m| m.member_id == 1).unwrap().max_abs_value;
    eprintln!("gelijkmatig: grootste afwijking zakking {:.4} % (grens {:.3} %), |M|max {moment:.4e} kNm (grens q·h²/8 = {:.4e})",
        100.0 * grootste_w, 100.0 * grens_w, q * h * h / 8.0);
    assert!(grootste_w <= grens_w, "zakking wijkt {:.4} % af", 100.0 * grootste_w);
    assert!(moment <= q * h * h / 8.0, "moment {moment} groter dan q·h²/8");
    // Dwarskracht: de grond draagt q ter plekke, dus V ≈ 0 en aan de vrije
    // einden precies 0. Als puntlasten op de knopen gaf de grond een zaagtand
    // ±q·h/2; verdeeld over de lengte van elke veer (`bedding::correctie`)
    // blijft alleen het verschil tussen q en k·b·w over. Met |w − q/(k·b)| ≤
    // λ²h²/6 · q/(k·b), uitdovend over 1/λ: |V| ≤ λ²h²/6 · q/λ.
    let dwars = r.diagrams.shear_z.iter().find(|v| v.member_id == 1).unwrap();
    let lam = lambda(kb, E_KN_M2 * 2e-4);
    let grens_v = (lam * h).powi(2) / 6.0 * q / lam;
    eprintln!("gelijkmatig: |V|max {:.4e} kN (grens {grens_v:.4e}, zaagtand zonder verdeling q·h/2 = {:.4e})", dwars.max_abs_value, q * h / 2.0);
    assert!(dwars.max_abs_value <= grens_v, "dwarskracht {} groter dan {grens_v}", dwars.max_abs_value);
    let krachten = r.member_forces.iter().find(|f| f.member_id == 1).unwrap();
    assert!(krachten.vz_start_kn.abs() < 1e-9 && krachten.vz_end_kn.abs() < 1e-9,
        "vrije einden zonder dwarskracht: {} en {}", krachten.vz_start_kn, krachten.vz_end_kn);
    dichtbij(grond.total_reaction_kn, q * l, 1e-8, "grondreactie = q·L");
    // De oplegging neemt verticaal niets op: zij blokkeert uz niet.
    assert!(r.reactions.iter().all(|x| x.fz.abs() < 1e-9));
    assert!(r.equilibrium.as_ref().is_none_or(|e| e.equilibrium_ok));
}

/// Een korte, vrijwel starre ligger op bedding met alleen druk, met een last
/// dicht bij één eind: het andere eind komt los.
///
/// Referentie: dezelfde losse veren onder een star lichaam. Met de actieve
/// rekenknopen A geldt w(x) = w₀ − θ·x en Σ K_i·w_i = P, Σ K_i·w_i·x_i = P·a
/// (K_i = k·b·L_trib). Bij L = 4 m, h = 0,5 m en a = 0,6 m dragen de knopen op
/// x = 0 … 1,5 m: w₀ = 5,2308 mm; de rest (2,25 m van 4 m) is los. De doorbuiging
/// van de ligger zelf (λ·L = 0,28) verandert dat met minder dan 10⁻⁴.
/// Gesloten oplossing voor een doorlopende grond: contactlengte 3·a = 1,8 m;
/// de losse lengte ligt dus binnen één deel van 1 − 3a/L = 0,55.
#[test]
fn alleen_druk_laat_een_eind_loskomen() {
    let (k, b, p, a, l) = (20_000.0, 1.0, 100.0, 0.6, 4.0);
    let kb = k * b;
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![doorsnede(1, 0.1, 1.0, 1.0, 1.0)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(k), b, None, true)],
        vec![steun(1, [true, true, false, true, false, true])],
    );
    request.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: 0.0, pz_kn: -p, position_m: a });
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let grond = bedding_van(&r, 1);
    assert_eq!(grond.points.len(), 9, "8 delen: het minimum bij λ·L = 0,28");
    // Starre referentie met dezelfde veren en dezelfde actieve knopen.
    let x: Vec<f64> = grond.points.iter().map(|p| p.t * l).collect();
    let h = x[1] - x[0];
    let veer: Vec<f64> = (0..x.len()).map(|i| kb * if i == 0 || i + 1 == x.len() { h / 2.0 } else { h }).collect();
    let actief: Vec<usize> = (0..x.len()).filter(|i| grond.points[*i].active).collect();
    assert_eq!(actief, vec![0, 1, 2, 3], "contact op x = 0 … 1,5 m");
    let (s0, s1, s2) = actief.iter().fold((0.0, 0.0, 0.0), |(a0, a1, a2), &i| (a0 + veer[i], a1 + veer[i] * x[i], a2 + veer[i] * x[i] * x[i]));
    // [s0 −s1; s1 −s2]·[w₀; θ] = [P; P·a]
    let det = -s0 * s2 + s1 * s1;
    let w0 = (-p * s2 + s1 * p * a) / det;
    let theta = (s0 * p * a - s1 * p) / det;
    dichtbij(w0, 5.2308e-3, 1e-4, "starre referentie w₀");
    for (i, punt) in grond.points.iter().enumerate() {
        let verwacht = w0 - theta * x[i];
        assert!((punt.settlement_m - verwacht).abs() <= 1e-4 * w0,
            "punt {i}: zakking {} tegen star {verwacht}", punt.settlement_m);
        assert!(punt.pressure_kn_per_m >= 0.0, "punt {i}: druk {} < 0", punt.pressure_kn_per_m);
        if punt.active {
            assert!(punt.settlement_m > 0.0);
            dichtbij(punt.pressure_kn_per_m, kb * punt.settlement_m, 1e-12, "druk = k·b·w");
        } else {
            assert!(punt.settlement_m < 0.0, "punt {i} is los en komt omhoog");
            assert_eq!(punt.pressure_kn_per_m, 0.0);
        }
    }
    dichtbij(grond.lifted_fraction, 2.25 / 4.0, 1e-12, "losse lengte");
    assert!((grond.lifted_fraction - (1.0 - 3.0 * a / l)).abs() <= h / l, "binnen één deel van de doorlopende oplossing");
    dichtbij(grond.max_pressure_kn_per_m, kb * w0, 1e-4, "grootste druk");
    assert_eq!(grond.min_pressure_kn_per_m, 0.0);
    dichtbij(grond.total_reaction_kn, p, 1e-8, "grondreactie = last");
    // Momentevenwicht om het begin: de grondreactie grijpt aan onder de last.
    let moment: f64 = grond.points.iter().enumerate()
        .filter(|(_, punt)| punt.active)
        .map(|(i, punt)| veer[i] * punt.settlement_m * x[i]).sum();
    dichtbij(moment, p * a, 1e-8, "momentevenwicht om het begin");
    verticaal_evenwicht(&r, -p);
    alleen_druk_klopt(&r);
    assert!(r.diagnostics.iter().any(|regel| regel.contains("alleen druk") && regel.contains("staaf 1")),
        "melding over de losse lengte: {:?}", r.diagnostics);
}

/// Zonder alleen druk trekt de grond het einde terug: alle veren doen mee en
/// een deel van de ligger heeft een negatieve druk.
#[test]
fn zonder_alleen_druk_neemt_de_grond_trek_op() {
    let (k, b, p, a, l) = (20_000.0, 1.0, 100.0, 0.6, 4.0);
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![doorsnede(1, 0.1, 1.0, 1.0, 1.0)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(k), b, None, false)],
        vec![steun(1, [true, true, false, true, false, true])],
    );
    request.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: 0.0, pz_kn: -p, position_m: a });
    let r = solve(request).unwrap();
    let grond = bedding_van(&r, 1);
    assert!(grond.points.iter().all(|punt| punt.active));
    assert!(grond.min_pressure_kn_per_m < 0.0, "het verre eind trekt aan de grond");
    assert_eq!(grond.lifted_fraction, 0.0);
    dichtbij(grond.total_reaction_kn, p, 1e-8, "grondreactie = last");
}

/// Knik van een lange staaf op bedding onder druk (Hetényi): voor een
/// scharnierend opgelegde staaf met L = m·π/α, α = (k·b/(E·I))^¼, is de
/// kritieke last precies P_cr = 2·√(k·b·E·I) (golf m = 6).
///
/// Foutgrens 1 %: de knikvorm heeft een golflengte 2π/α ≈ 30 deellengten
/// (α·h ≤ 0,15·√2); veren in de knopen van een sinusvorm geven bij gelijke
/// delen dezelfde grondenergie als een doorlopende grond, en de kubische
/// staafelementen en de consistente K_G wijken af in de orde (α·h)⁴.
/// Gemeten (89 delen): +0,0004 %. Zijdelings knikt de staaf niet eerst:
/// I_z = 100·I_y geeft π²·E·I_z/L² = 1,39·P_cr.
#[test]
fn knik_op_bedding_volgt_hetenyi() {
    let (kb, iy) = (4_200.0, 2e-4);
    let ei = E_KN_M2 * iy;
    let alpha = (kb / ei).powf(0.25);
    let l = 6.0 * PI / alpha;
    let p_cr = 2.0 * (kb * ei).sqrt();
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![doorsnede(1, 0.01, iy, 100.0 * iy, 1e-5)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(kb), 1.0, None, false)],
        vec![steun(1, [true, true, true, true, false, false]), steun(2, [false, true, true, false, false, false])],
    );
    request.nodal_loads.push(knooplast(1, 2, -1000.0, 0.0, 0.0));
    request.buckling_modes = 3;
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let BucklingSummary::Available { modes, members } = &r.buckling else { panic!("knik: {:?}", r.buckling) };
    let berekend = modes[0].load_factor * 1000.0;
    eprintln!("Hetényi: P_cr {berekend:.2} kN tegen {p_cr:.2} kN, afwijking {:.4} %, delen {}",
        100.0 * (berekend - p_cr) / p_cr, bedding_van(&r, 1).points.len() - 1);
    dichtbij(berekend, p_cr, 0.01, "kritieke last op bedding");
    let staafknik = members.iter().find(|m| m.member_id == 1).expect("knikgegevens per modelstaaf");
    dichtbij(staafknik.critical_force_kn, p_cr, 0.01, "N_cr van de staaf");
    assert_eq!(staafknik.length_m, l);

    // Tweede orde onder 1/5 van de kritieke last: rekent zonder fout.
    let mut tweede = request;
    tweede.analysis = AnalysisKind::PDelta;
    tweede.nodal_loads[0].fx = -p_cr / 5.0;
    let r = solve(tweede).unwrap();
    assert!(r.second_order.as_ref().is_some_and(|s| s.converged));
}

/// Verticale paal met zijdelingse bedding onder een horizontale kopkracht H
/// (vrije kop, lange paal λ·L ≈ 10): y₀ = 2·H·λ/(k·b), θ₀ = 2·H·λ²/(k·b).
/// De kracht staat schuin in het grondvlak (30 en 40 kN), zodat de veren in
/// X en in Y elk hun deel dragen.
///
/// Foutgrens 1,5 %. De invloed van de paalvoet is e^(−10) ≈ 5·10⁻⁵. Aan de
/// vrije kop draagt de eindknoop de grond over een half deel in één punt; de
/// werkelijke grondlast daar loopt over dat halve deel af, dus de fout is hier
/// van de orde λ·h (≤ 0,15) maal een kleine coëfficiënt, niet (λ·h)².
/// Gemeten (69 delen, λ·h = 0,149): y₀ −0,73 %, θ₀ −1,10 %.
#[test]
fn paal_met_zijdelingse_bedding_onder_kopkracht() {
    let (k_lat, b, l) = (30_000.0, 0.4, 25.0);
    let kb = k_lat * b;
    let i = 5e-4;
    let lam = lambda(kb, E_KN_M2 * i);
    let (fx, fy) = (30.0, 40.0);
    let h = (fx * fx + fy * fy as f64).sqrt();
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, -l), knoop(2, 0.0, 0.0, 0.0)],
        vec![doorsnede(1, 0.05, i, i, 1e-3)],
        vec![op_bedding(staaf(1, 1, 2, 1), None, b, Some(k_lat), false)],
        // Voet: verticaal en torsie vast; zijdelings alleen de grond.
        vec![steun(1, [false, false, true, false, false, true])],
    );
    request.nodal_loads.push(knooplast(1, 2, fx, fy, 0.0));
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let kop = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
    let y0 = 2.0 * h * lam / kb;
    let theta0 = 2.0 * h * lam * lam / kb;
    let draaiing = (kop.rx * kop.rx + kop.ry * kop.ry).sqrt();
    eprintln!("paal: λL {:.2}, ux {:.4} %, uy {:.4} %, θ {:.4} %", lam * l,
        100.0 * (kop.ux - fx / h * y0) / (fx / h * y0), 100.0 * (kop.uy - fy / h * y0) / (fy / h * y0),
        100.0 * (draaiing - theta0) / theta0);
    dichtbij(kop.ux, fx / h * y0, 0.015, "kopverplaatsing X");
    dichtbij(kop.uy, fy / h * y0, 0.015, "kopverplaatsing Y");
    dichtbij(draaiing, theta0, 0.015, "kopdraaiing");
    let grond = bedding_van(&r, 1);
    let top = grond.points.last().unwrap();
    assert_eq!(top.t, 1.0);
    let lateraal = top.lateral_kn_per_m.expect("zijdelingse lijnlast bij zijdelingse bedding");
    dichtbij(lateraal, kb * (kop.ux * kop.ux + kop.uy * kop.uy).sqrt(), 1e-9, "zijdelingse lijnlast = k·b·|u|");
    assert!(grond.points.iter().all(|punt| punt.pressure_kn_per_m == 0.0), "geen verticale bedding");
    assert_eq!(grond.total_reaction_kn, 0.0);
    // Horizontaal evenwicht: de voet neemt horizontaal niets op.
    assert!(r.reactions.iter().all(|x| x.fx.abs() < 1e-9 && x.fy.abs() < 1e-9));
    assert!(r.equilibrium.as_ref().is_none_or(|e| e.equilibrium_ok), "{:?}", r.equilibrium);
}

/// Een schuine ligger (30° in het grondvlak) met verticale en zijdelingse
/// bedding onder een zijdelingse puntlast: de zijdelingse veren staan dan
/// niet langs X of Y. Gesloten oplossing als bij de oneindige ligger, met
/// λ uit k_lat·b en I_z (buiging in lokaal y, horizontaal): w₀ = P·λ/(2·k_lat·b),
/// M₀ = P/(4·λ). Foutgrens 1,5 % zoals daar. Gemeten: w₀ −0,0003 %, M₀ −0,33 %.
#[test]
fn schuine_ligger_met_zijdelingse_bedding() {
    let (k, k_lat, b, p) = (50_000.0, 20_000.0, 0.8, 50.0);
    let (iy, iz) = (2e-4, 1e-4);
    let lam_v = lambda(k * b, E_KN_M2 * iy);
    let lam = lambda(k_lat * b, E_KN_M2 * iz);
    let l = 23.9 / lam_v;
    let (c, s) = (30f64.to_radians().cos(), 30f64.to_radians().sin());
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l * c, l * s, 0.0)],
        vec![doorsnede(1, 0.01, iy, iz, 1e-5)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(k), b, Some(k_lat), false)],
        vec![steun(1, [true, true, false, true, true, false])],
    );
    // Lokaal y is horizontaal en staat loodrecht op de staaf.
    request.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: p, pz_kn: 0.0, position_m: l / 2.0 });
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let grond = bedding_van(&r, 1);
    let midden = punt_bij(grond, 0.5);
    let lateraal = midden.lateral_kn_per_m.expect("zijdelingse lijnlast");
    let w0 = p * lam / (2.0 * k_lat * b);
    let m0 = p / (4.0 * lam);
    let moment = r.diagrams.moment_z.iter().find(|m| m.member_id == 1).unwrap().max_abs_value;
    eprintln!("schuin: w0 {:.4} %, M0 {:.4} %", 100.0 * (lateraal.abs() / (k_lat * b) - w0) / w0, 100.0 * (moment - m0) / m0);
    // De grond duwt terug, tegen de last in.
    assert!(lateraal < 0.0, "de grond duwt tegen de verplaatsing in");
    dichtbij(-lateraal / (k_lat * b), w0, 0.015, "zijdelingse verplaatsing onder de last");
    dichtbij(moment, m0, 0.015, "zijdelings moment onder de last");
    assert!(grond.max_settlement_m.abs() < 1e-9, "geen verticale last, geen zakking");
    assert!(r.equilibrium.as_ref().is_none_or(|e| e.equilibrium_ok), "{:?}", r.equilibrium);
}

/// Snedekrachten van een staaf op bedding met de grond als verdeelde last
/// (`bedding::correctie`): een ligger die 30° oploopt in het verticale vlak,
/// verticaal op bedding, in twee staven met een verticale puntlast P op de
/// middenknoop. De grond werkt verticaal, dus is de snedekracht overal
/// verticaal; zij heeft zowel een normaal- als een dwarskrachtcomponent.
///  - Vrije einden: N = V = 0 (de oplegging in het begin houdt alleen X, Y,
///    torsie en de draaiing om Z vast en neemt hier niets op). Als puntlast op
///    de eindknoop stond hier de hele eindveer, in N en in V.
///  - Naast de last draagt de grond onder elke helft P/2 (de rekenknopen en
///    veren liggen symmetrisch langs de staaf): |N| = P/2·sin 30°, |V| =
///    P/2·cos 30°.
///
/// Beide volgen exact uit het evenwicht van de discrete veren: grens 10⁻⁹·P.
#[test]
fn schuine_ligger_op_bedding_snedekrachten_met_verdeelde_grond() {
    let (k, b, p, l) = (50_000.0, 0.6, 100.0, 4.0);
    let (c, s) = (30f64.to_radians().cos(), 30f64.to_radians().sin());
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 2.0 * l * c, 0.0, 2.0 * l * s), knoop(3, l * c, 0.0, l * s)],
        vec![doorsnede(1, 0.0149, 2.517e-4, 8.56e-5, 1.85e-6)],
        vec![op_bedding(staaf(1, 1, 3, 1), Some(k), b, None, false), op_bedding(staaf(2, 3, 2, 1), Some(k), b, None, false)],
        vec![steun(1, [true, true, false, true, false, true])],
    );
    request.nodal_loads.push(knooplast(1, 3, 0.0, 0.0, -p));
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    verticaal_evenwicht(&r, -p);
    let krachten = |id: usize| r.member_forces.iter().find(|f| f.member_id == id).unwrap();
    let dwars = |vy: f64, vz: f64| (vy * vy + vz * vz).sqrt();
    let (a, e) = (krachten(1), krachten(2));
    let grens = 1e-9 * p;
    eprintln!("schuin verticaal: begin N {:.3e} V {:.3e}; naast de last N {:.6} V {:.6}; eind N {:.3e} V {:.3e}",
        a.n_start_kn, dwars(a.vy_start_kn, a.vz_start_kn), a.n_end_kn, dwars(a.vy_end_kn, a.vz_end_kn),
        e.n_end_kn, dwars(e.vy_end_kn, e.vz_end_kn));
    assert!(a.n_start_kn.abs() < grens && dwars(a.vy_start_kn, a.vz_start_kn) < grens, "vrij begin: {a:?}");
    assert!(e.n_end_kn.abs() < grens && dwars(e.vy_end_kn, e.vz_end_kn) < grens, "vrij eind: {e:?}");
    assert!((a.n_end_kn.abs() - p / 2.0 * s).abs() < grens, "N naast de last {} ≠ P/2·sin 30°", a.n_end_kn);
    assert!((dwars(a.vy_end_kn, a.vz_end_kn) - p / 2.0 * c).abs() < grens, "V naast de last ≠ P/2·cos 30°: {a:?}");
    assert!((e.n_start_kn.abs() - p / 2.0 * s).abs() < grens && (dwars(e.vy_start_kn, e.vz_start_kn) - p / 2.0 * c).abs() < grens,
        "andere kant van de last: {e:?}");
    // De lijnen beginnen en eindigen met dezelfde waarden als de staafeinden.
    let lijn = |lijst: &[open_fem_3d::MemberDiagram3D], id: usize| lijst.iter().find(|d| d.member_id == id).unwrap().points.clone();
    let normaal = lijn(&r.diagrams.axial, 1);
    assert!((normaal.first().unwrap().value - a.n_start_kn).abs() < grens && (normaal.last().unwrap().value - a.n_end_kn).abs() < grens);
    let vz = lijn(&r.diagrams.shear_z, 1);
    assert!((vz.first().unwrap().value - a.vz_start_kn).abs() < grens && (vz.last().unwrap().value - a.vz_end_kn).abs() < grens);
}

/// Een bestaande tussenknoop (bijvoorbeeld een plaatknoop) blijft rekenknoop;
/// een eindscharnier blijft op het staafeinde. De zakking van de tussenknoop
/// in de bedding-uitvoer is zijn verplaatsing.
#[test]
fn tussenknopen_en_scharnieren_blijven_gelden() {
    let (k, b, q, l) = (50_000.0, 0.8, 20.0, 9.0);
    let mut ligger = op_bedding(staaf(1, 1, 3, 1), Some(k), b, None, false);
    ligger.intermediate_node_ids = vec![2];
    ligger.releases = EndReleases3D { my_end: true, ..Default::default() };
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 3.1, 0.0, 0.0), knoop(3, l, 0.0, 0.0), knoop(4, l + 2.0, 0.0, 0.0)],
        vec![doorsnede(1, 0.01, 2e-4, 1e-4, 1e-5)],
        vec![ligger, staaf(2, 3, 4, 1)],
        vec![steun(1, [true, true, false, true, false, true]), steun(4, [false, true, true, true, false, true])],
    );
    request.member_loads.push(MemberLoad3D {
        id: 1, member_id: 1, qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -q, qz_end_kn_per_m: -q, start_position_m: None, end_position_m: None,
        ..Default::default()
    });
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let grond = bedding_van(&r, 1);
    let tussen = grond.points.iter().find(|p| (p.t - 3.1 / l).abs() < 1e-12).expect("tussenknoop is rekenknoop");
    let knoop2 = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
    assert_eq!(tussen.settlement_m, -knoop2.uz);
    // Het scharnier aan het eind: geen moment in knoop 3.
    let lijn = r.diagrams.moment_y.iter().find(|m| m.member_id == 1).unwrap();
    assert!(lijn.points.last().unwrap().value.abs() < 1e-9, "scharnier aan het eind: M = 0");
    assert_eq!(r.member_forces.iter().filter(|f| f.member_id == 1).count(), 1, "één modelstaaf");
    let reactie4: f64 = r.reactions.iter().filter(|x| x.node_id == 4).map(|x| x.fz).sum();
    dichtbij(grond.total_reaction_kn + reactie4, q * l, 1e-8, "grond + oplegging = last");
}

/// Tweede orde en trek-alleen samen met bedding (alleen druk): een portaal met
/// kruisverband op een funderingsbalk. Onder de windlast valt het gedrukte
/// verband weg en komt de funderingsbalk aan de loefzijde los van de grond;
/// beide statussets veranderen dus in dezelfde lus. Rekent zonder fout en
/// sluit verticaal en horizontaal: lasten + reacties + grondreacties = 0.
#[test]
fn tweede_orde_en_trek_alleen_met_bedding() {
    let nodes = vec![
        knoop(1, 0.0, 0.0, 0.0), knoop(2, 2.0, 0.0, 0.0), knoop(3, 8.0, 0.0, 0.0), knoop(4, 10.0, 0.0, 0.0),
        knoop(5, 2.0, 0.0, 4.0), knoop(6, 8.0, 0.0, 4.0),
    ];
    let sections = vec![
        doorsnede(1, 0.2, 4e-3, 4e-3, 4e-3),
        doorsnede(2, 5e-3, 5e-5, 2e-5, 5e-7),
        doorsnede(3, 5e-4, 1e-8, 1e-8, 1e-8),
    ];
    let fundering = |id, a, b| op_bedding(staaf(id, a, b, 1), Some(30_000.0), 1.0, Some(10_000.0), true);
    let trek = |id, a, b| {
        let mut verband = staaf(id, a, b, 3);
        verband.tension_only = true;
        verband.releases = EndReleases3D { my_start: true, my_end: true, mz_start: true, mz_end: true, ..Default::default() };
        verband
    };
    let members = vec![
        fundering(1, 1, 2), fundering(2, 2, 3), fundering(3, 3, 4),
        staaf(4, 2, 5, 2), staaf(5, 3, 6, 2), staaf(6, 5, 6, 2),
        trek(7, 2, 6), trek(8, 3, 5),
    ];
    let supports = vec![
        steun(1, [true, false, false, true, false, false]),
        steun(5, [false, true, false, false, false, false]),
        steun(6, [false, true, false, false, false, false]),
    ];
    let mut request = verzoek(nodes, sections, members, supports);
    request.analysis = AnalysisKind::PDelta;
    request.buckling_modes = 1;
    let (h, v) = (300.0, -300.0);
    request.nodal_loads = vec![knooplast(1, 5, h, 0.0, v), knooplast(2, 6, 0.0, 0.0, v)];
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    assert!(r.second_order.as_ref().is_some_and(|s| s.converged));
    assert_eq!(r.inactive_members, vec![8], "het gedrukte verband valt weg");
    assert!(r.tension_only_rounds >= 2);
    verticaal_evenwicht(&r, 2.0 * v);
    alleen_druk_klopt(&r);
    let horizontaal: f64 = h + r.reactions.iter().map(|x| x.fx).sum::<f64>();
    assert!(horizontaal.abs() < 1e-6 * h, "horizontaal evenwicht: rest {horizontaal:.3e}");
    for id in [1, 2, 3] {
        let grond = bedding_van(&r, id);
        assert!(grond.points.iter().all(|p| p.pressure_kn_per_m >= 0.0), "staaf {id}: alleen druk");
        assert!(grond.points.iter().all(|p| p.lateral_kn_per_m.is_some()));
    }
    let los: Vec<f64> = (1..=3).map(|id| bedding_van(&r, id).lifted_fraction).collect();
    eprintln!("portaal: losse lengte per funderingsdeel {los:?}, statusrondes {}", r.tension_only_rounds);
    assert!(los[0] > 0.0, "de loefzijde van de fundering komt los: {los:?}");
    assert_eq!(los[2], 0.0, "de lijzijde blijft op de grond");

    // Lineair met knikfactor: ook zonder fout, met dezelfde inactieve staaf.
    let mut lineair = request;
    lineair.analysis = AnalysisKind::Linear;
    let r = solve(lineair).unwrap();
    assert_eq!(r.inactive_members, vec![8]);
    assert!(matches!(r.buckling, BucklingSummary::Available { .. }), "{:?}", r.buckling);
    verticaal_evenwicht(&r, 2.0 * v);
    alleen_druk_klopt(&r);
}

/// Alleen druk en een last die de ligger optilt: zonder de losgekomen veren
/// is de ligger niet meer opgelegd. Dat geeft een duidelijke melding.
#[test]
fn alleen_druk_zonder_contact_meldt_een_mechanisme() {
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0)],
        vec![doorsnede(1, 0.01, 2e-4, 1e-4, 1e-5)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(20_000.0), 1.0, None, true)],
        vec![steun(1, [true, true, false, true, false, true])],
    );
    request.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: 0.0, pz_kn: 10.0, position_m: 2.0 });
    let fout = solve(request).unwrap_err();
    assert!(fout.contains("bedding") && fout.contains("alleen druk") && fout.contains("staaf 1"), "{fout}");
    assert!(fout.contains("verschuiven in Z"), "de vrije beweging wordt genoemd: {fout}");
}

#[test]
fn foutmeldingen_bij_ongeldige_bedding() {
    let ligger = |bedding: Option<Bedding3D>| {
        let mut s = staaf(1, 1, 2, 1);
        s.bedding = bedding;
        verzoek(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 4.0, 0.0, 0.0)],
            vec![doorsnede(1, 0.01, 2e-4, 1e-4, 1e-5)],
            vec![s],
            vec![steun(1, [true, true, true, true, true, true])],
        )
    };
    let bed = |k: Option<f64>, b: f64, k_lat: Option<f64>| Some(Bedding3D {
        k_kn_per_m3: k, width_m: b, k_lateral_kn_per_m3: k_lat, compression_only: false,
    });
    let fout = |request: SolveRequest3D| solve(request).unwrap_err();

    let melding = fout(ligger(bed(Some(0.0), 1.0, None)));
    assert!(melding.contains("kKnPerM3") && melding.contains("staaf 1") && melding.contains("groter zijn dan nul"), "{melding}");
    let melding = fout(ligger(bed(Some(-5.0), 1.0, None)));
    assert!(melding.contains("kKnPerM3") && melding.contains("groter zijn dan nul"), "{melding}");
    let melding = fout(ligger(bed(Some(1000.0), 0.0, None)));
    assert!(melding.contains("widthM") && melding.contains("groter zijn dan nul"), "{melding}");
    let melding = fout(ligger(bed(Some(1000.0), f64::NAN, None)));
    assert!(melding.contains("widthM") && melding.contains("niet eindig"), "{melding}");
    let melding = fout(ligger(bed(Some(1000.0), 1.0, Some(0.0))));
    assert!(melding.contains("kLateralKnPerM3") && melding.contains("groter zijn dan nul"), "{melding}");
    let melding = fout(ligger(bed(None, 1.0, None)));
    assert!(melding.contains("geen beddingsconstante") && melding.contains("staaf 1"), "{melding}");

    let mut trek = ligger(bed(Some(1000.0), 1.0, None));
    trek.members[0].tension_only = true;
    let melding = fout(trek);
    assert!(melding.contains("trek-alleen") && melding.contains("bedding"), "{melding}");

    // Een (bijna) verticale staaf: geen verticale bedding, wel zijdelings.
    let paal = |k: Option<f64>, k_lat: Option<f64>| {
        let mut s = staaf(1, 1, 2, 1);
        s.bedding = bed(k, 0.4, k_lat);
        let mut request = verzoek(
            vec![knoop(1, 0.0, 0.0, -10.0), knoop(2, 0.3, 0.0, 0.0)],
            vec![doorsnede(1, 0.05, 5e-4, 5e-4, 1e-3)],
            vec![s],
            vec![steun(1, [false, false, true, false, false, true])],
        );
        request.nodal_loads.push(knooplast(1, 2, 10.0, 0.0, 0.0));
        request
    };
    let melding = fout(paal(Some(10_000.0), Some(10_000.0)));
    assert!(melding.contains("verticaal") && melding.contains("kKnPerM3") && melding.contains("kLateralKnPerM3"), "{melding}");
    assert!(solve(paal(None, Some(10_000.0))).is_ok(), "een paal met alleen zijdelingse bedding mag");
}

/// De namen in JSON volgen het contract met de app (camelCase).
#[test]
fn json_volgt_het_contract() {
    let tekst = r#"{
        "schemaVersion": 2, "analysis": "linear",
        "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 6, "y": 0, "z": 0 }],
        "materials": [{ "id": 1, "name": "C30/37", "eMpa": 33000, "nu": 0.2 }],
        "sections": [{ "id": 1, "name": "balk", "areaM2": 0.3, "iyM4": 0.0056, "izM4": 0.0016, "torsionJM4": 0.004 }],
        "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1,
            "bedding": { "kKnPerM3": 20000, "widthM": 0.6, "compressionOnly": true } }],
        "supports": [{ "nodeId": 1, "ux": true, "uy": true, "uz": false, "rx": true, "ry": false, "rz": true }],
        "memberLoads": [{ "id": 1, "memberId": 1, "qyStartKnPerM": 0, "qyEndKnPerM": 0,
            "qzStartKnPerM": -30, "qzEndKnPerM": -10 }]
    }"#;
    let request: SolveRequest3D = serde_json::from_str(tekst).unwrap();
    let bedding = request.members[0].bedding.as_ref().unwrap();
    assert_eq!((bedding.k_kn_per_m3, bedding.width_m, bedding.k_lateral_kn_per_m3, bedding.compression_only),
        (Some(20_000.0), 0.6, None, true));
    let r = solve(request).unwrap();
    let json = serde_json::to_value(&r).unwrap();
    let staaf = &json["bedding"][0];
    for sleutel in ["memberId", "points", "maxPressureKnPerM", "minPressureKnPerM", "maxSettlementM", "totalReactionKn", "liftedFraction"] {
        assert!(staaf.get(sleutel).is_some(), "sleutel {sleutel} ontbreekt in {staaf}");
    }
    let punt = &staaf["points"][0];
    for sleutel in ["t", "settlementM", "pressureKnPerM", "active"] {
        assert!(punt.get(sleutel).is_some(), "sleutel {sleutel} ontbreekt in {punt}");
    }
    assert!(punt.get("lateralKnPerM").is_none(), "zonder zijdelingse bedding geen lateralKnPerM");
    dichtbij(staaf["totalReactionKn"].as_f64().unwrap(), 20.0 * 6.0, 1e-8, "grondreactie = last");
    // Zonder bedding geen bedding-uitvoer.
    let zonder = tekst.replace(r#",
            "bedding": { "kKnPerM3": 20000, "widthM": 0.6, "compressionOnly": true }"#, "")
        .replace(r#""uz": false"#, r#""uz": true"#).replace(r#""ry": false"#, r#""ry": true"#);
    let r = solve(serde_json::from_str(&zonder).unwrap()).unwrap();
    assert!(serde_json::to_value(&r).unwrap().get("bedding").is_none());
    // Een tikfout in een beddingveld wordt geweigerd.
    let tikfout = tekst.replace("kKnPerM3", "kKnPerM2");
    assert!(serde_json::from_str::<SolveRequest3D>(&tikfout).is_err());
}

/// De n-de afgeleide van de vier homogene oplossingen van EI·w'''' + k·b·w = 0:
/// e^{λξ}·cos λξ, e^{λξ}·sin λξ, e^{−λξ}·cos λξ, e^{−λξ}·sin λξ, als het reële
/// en imaginaire deel van e^{s·λ·ξ} met s = 1 + i en s = −1 + i.
fn homogeen(lam: f64, xi: f64, n: u32) -> [f64; 4] {
    let mut uit = [0.0; 4];
    for (index, (sr, si)) in [(1.0f64, 1.0f64), (-1.0, 1.0)].into_iter().enumerate() {
        let (mut re, mut im) = (1.0, 0.0);
        for _ in 0..n {
            let nieuw = re * sr - im * si;
            im = re * si + im * sr;
            re = nieuw;
        }
        let schaal = lam.powi(n as i32) * (sr * lam * xi).exp();
        let (cos, sin) = ((si * lam * xi).cos(), (si * lam * xi).sin());
        uit[2 * index] = schaal * (re * cos - im * sin);
        uit[2 * index + 1] = schaal * (re * sin + im * cos);
    }
    uit
}

/// Gauss met rijwisseling; het stelsel is klein en regulier.
fn los_stelsel(mut a: Vec<Vec<f64>>, mut b: Vec<f64>) -> Vec<f64> {
    let n = b.len();
    for i in 0..n {
        let spil = (i..n).max_by(|&p, &q| a[p][i].abs().total_cmp(&a[q][i].abs())).unwrap();
        a.swap(i, spil);
        b.swap(i, spil);
        for r in 0..n {
            if r == i { continue; }
            let f = a[r][i] / a[i][i];
            for c in i..n { a[r][c] -= f * a[i][c]; }
            b[r] -= f * b[i];
        }
    }
    (0..n).map(|i| b[i] / a[i][i]).collect()
}

/// Een balk op een doorlopende grond zonder trek, met contact op [a, b] rond
/// een puntlast P (omlaag, in x_P), links van a vrij en onbelast en rechts van
/// b vrij met een opwaartse kracht F in x_F. Zie `alleen_druk_herstelt_weggevallen_veren`.
struct GeenTrek { ei: f64, lam: f64, p: f64, x_p: f64, f: f64, x_f: f64 }

impl GeenTrek {
    /// De coëfficiënten van de homogene oplossing links en rechts van de last.
    fn coefficienten(&self, a: f64, b: f64) -> Vec<f64> {
        let rij = |links: [f64; 4], rechts: [f64; 4]| [links.to_vec(), rechts.to_vec()].concat();
        let nul = [0.0; 4];
        let (l, xa, xb) = (self.lam, a - self.x_p, b - self.x_p);
        let mut matrix = vec![
            rij(homogeen(l, xa, 2), nul), // M(a) = 0
            rij(homogeen(l, xa, 3), nul), // V(a) = 0
            rij(nul, homogeen(l, xb, 2)), // EI·w''(b) = F·(b − x_F)
            rij(nul, homogeen(l, xb, 3)), // EI·w'''(b) = F
        ];
        for n in 0..4 {
            // In x_P: w, w' en w'' doorlopend, EI·w''' springt met P.
            matrix.push(rij(homogeen(l, 0.0, n).map(|v| -v), homogeen(l, 0.0, n)));
        }
        let rechts = vec![0.0, 0.0, self.f * (b - self.x_f) / self.ei, self.f / self.ei, 0.0, 0.0, 0.0, self.p / self.ei];
        los_stelsel(matrix, rechts)
    }

    /// De n-de afgeleide van de zakking op x binnen het contactgebied.
    fn w(&self, c: &[f64], x: f64, n: u32) -> f64 {
        let xi = x - self.x_p;
        let k = if xi < 0.0 { &c[0..4] } else { &c[4..8] };
        homogeen(self.lam, xi, n).iter().zip(k).map(|(f, c)| f * c).sum()
    }

    /// De contactgrenzen: w(a) = w(b) = 0, met Newton vanaf (a, b).
    fn grenzen(&self, mut a: f64, mut b: f64) -> (f64, f64) {
        let rest = |a: f64, b: f64| { let c = self.coefficienten(a, b); (self.w(&c, a, 0), self.w(&c, b, 0)) };
        for _ in 0..100 {
            let (r0, r1) = rest(a, b);
            let h = 1e-7;
            let (a0, a1) = rest(a + h, b);
            let (b0, b1) = rest(a, b + h);
            let j = [[(a0 - r0) / h, (b0 - r0) / h], [(a1 - r1) / h, (b1 - r1) / h]];
            let det = j[0][0] * j[1][1] - j[0][1] * j[1][0];
            let da = (r0 * j[1][1] - r1 * j[0][1]) / det;
            let db = (j[0][0] * r1 - j[1][0] * r0) / det;
            a -= da;
            b -= db;
            if da.abs() + db.abs() < 1e-12 { return (a, b); }
        }
        panic!("de contactgrenzen van de referentie convergeren niet");
    }
}

/// Alleen druk met herstel van weggevallen veren (review #106): een balk van
/// 27 m (HEB 300) op bedding, vrij in Z, met 35,5 kN omlaag op 11 m en 2,3 kN
/// omhoog op 26,95 m. Met alle veren actief komt de balk op plekken omhoog die
/// met minder veren weer zakken; de lus moet die veren terugzetten. Zonder dat
/// herstel bleven acht punten "los" terwijl ze tot 0,28 mm de grond in zakten
/// (losse fractie 0,882 in plaats van 0,855); de andere tests met alleen druk
/// raakten het herstel niet.
///
/// Referentie: dezelfde balk op een doorlopende grond zonder trek (`GeenTrek`).
/// Op het contactgebied [a, b] geldt EI·w'''' + k·b·w = 0 met de last als
/// sprong P in EI·w'''. Links van a hangt de balk vrij en onbelast (M = V = 0
/// in a), rechts van b vrij met de opwaartse kracht F (EI·w''(b) = F·(b − x_F),
/// EI·w'''(b) = F); de grenzen volgen uit w(a) = w(b) = 0. Dat geeft a = 7,673 m
/// en b = 11,592 m: losse fractie 1 − (b − a)/L = 0,8549, w_max = 0,4740 mm.
///
/// Foutgrenzen. Losse fractie: de kern beslist per rekenknoop (deel h ≤ 0,15/λ)
/// en telt per losse knoop zijn tributaire lengte; elke contactgrens valt
/// daardoor hoogstens een half deel anders, samen h/L (hier 0,9 %). Gemeten
/// 0,8545, dus −0,04 %-punt. Grootste zakking: veren in de knopen wijken af in
/// de orde (λh)² = 2,2 % maal een kleine coëfficiënt; grens 1 %, gemeten −0,1 %.
#[test]
fn alleen_druk_herstelt_weggevallen_veren() {
    let (k, b, l) = (48_000.0, 0.6, 27.0);
    let (iy, p, x_p, f, x_f) = (2.517e-4, 35.5, 11.0, 2.3, 26.95);
    let kb = k * b;
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
        vec![doorsnede(1, 0.0149, iy, 8.56e-5, 1.85e-6)],
        vec![op_bedding(staaf(1, 1, 2, 1), Some(k), b, None, true)],
        vec![steun(1, [true, true, false, true, false, true])],
    );
    request.member_point_loads.push(MemberPointLoad3D { id: 1, member_id: 1, py_kn: 0.0, pz_kn: -p, position_m: x_p });
    request.member_point_loads.push(MemberPointLoad3D { id: 2, member_id: 1, py_kn: 0.0, pz_kn: f, position_m: x_f });
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    alleen_druk_klopt(&r);
    verticaal_evenwicht(&r, -p + f);
    let grond = bedding_van(&r, 1);
    dichtbij(grond.total_reaction_kn, p - f, 1e-8, "grondreactie = P − F");

    // De referentie, vanaf het contactgebied van de kern.
    let ei = E_KN_M2 * iy;
    let referentie = GeenTrek { ei, lam: lambda(kb, ei), p, x_p, f, x_f };
    let actief: Vec<f64> = grond.points.iter().filter(|punt| punt.active).map(|punt| punt.t * l).collect();
    let (a, b_) = referentie.grenzen(actief[0], *actief.last().unwrap());
    let c = referentie.coefficienten(a, b_);
    // De referentie is de echte oplossing: overal in contact zakt de balk, en
    // buiten het contact komt hij omhoog (links stijgt w, rechts daalt w).
    let monsters: Vec<f64> = (1..400).map(|i| referentie.w(&c, a + (b_ - a) * i as f64 / 400.0, 0)).collect();
    assert!(monsters.iter().all(|w| *w > 0.0), "referentie: zakking in het contact");
    assert!(referentie.w(&c, a, 1) > 0.0 && referentie.w(&c, b_, 1) < 0.0, "referentie: buiten het contact omhoog");
    assert!((a - 7.673).abs() < 1e-3 && (b_ - 11.592).abs() < 1e-3, "referentie: contact op [{a:.4}; {b_:.4}]");
    let los_ref = 1.0 - (b_ - a) / l;
    let w_ref = monsters.iter().copied().fold(0.0, f64::max);
    let h = l * (grond.points[1].t - grond.points[0].t);
    eprintln!("herstel: los {:.5} tegen {los_ref:.5} (grens h/L = {:.5}), w_max {:.4} %",
        grond.lifted_fraction, h / l, 100.0 * (grond.max_settlement_m - w_ref) / w_ref);
    assert!((grond.lifted_fraction - los_ref).abs() <= h / l,
        "losse fractie {} tegen de doorlopende grond {los_ref}", grond.lifted_fraction);
    dichtbij(grond.max_settlement_m, w_ref, 0.01, "grootste zakking");
    // Het contact ligt rond de last, en de punten erbuiten zijn los.
    for punt in &grond.points {
        let x = punt.t * l;
        if x < a - h || x > b_ + h { assert!(!punt.active, "x = {x:.3} m ligt buiten het contact"); }
        if x > a + h && x < b_ - h { assert!(punt.active, "x = {x:.3} m ligt binnen het contact"); }
    }
}

/// Grondknopen en veerelementen van de bedding bestaan alleen in het kernmodel;
/// een melding van de kern over hen zegt niets over het model en valt weg
/// (review #106). Twee staven op bedding met zijdelingse k en een gedeelde
/// eindknoop onder een kolom: elk legt in die knoop een veerelement naar een
/// eigen grondknoop op dezelfde plek, die de kern als "near-duplicates" meldt.
/// In de uitvoer staat geen melding over dubbele knopen en geen knoop-id boven
/// de hoogste modelknoop.
#[test]
fn geen_kernmeldingen_over_grondknopen() {
    let bed = |id, a, b| op_bedding(staaf(id, a, b, 1), Some(50_000.0), 0.6, Some(20_000.0), false);
    let mut request = verzoek(
        vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, 0.0, 4.0, 0.0), knoop(3, 0.0, 8.0, 0.0), knoop(4, 0.0, 4.0, 3.0)],
        vec![doorsnede(1, 0.0149, 2.517e-4, 8.56e-5, 1.85e-6), doorsnede(2, 0.00538, 3.692e-5, 1.336e-5, 2.1e-7)],
        vec![bed(1, 1, 2), bed(2, 2, 3), staaf(3, 2, 4, 2)],
        vec![steun(1, [true, true, false, false, true, true]), steun(4, [true, true, false, false, false, false])],
    );
    request.nodal_loads.push(knooplast(1, 4, 0.0, 0.0, -100.0));
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    verticaal_evenwicht(&r, -100.0);
    let hoogste = request.nodes.iter().map(|n| n.id).max().unwrap();
    for regel in &r.diagnostics {
        assert!(!regel.to_lowercase().contains("duplicate"), "melding over grondknopen: {regel}");
        // Elk getal na "node(s)" of "knoop/knopen" (ook in een opsomming) is een modelknoop.
        let woorden: Vec<String> = regel.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty())
            .map(str::to_lowercase).collect();
        let mut in_opsomming = false;
        for woord in &woorden {
            if matches!(woord.as_str(), "node" | "nodes" | "knoop" | "knopen") { in_opsomming = true; continue; }
            match woord.parse::<usize>() {
                Ok(id) if in_opsomming => assert!(id <= hoogste, "knoop {id} bestaat niet in het model: {regel}"),
                _ if in_opsomming && matches!(woord.as_str(), "and" | "en") => {}
                _ => in_opsomming = false,
            }
        }
    }
}

/// Een staaf op bedding met de torsie aan beide einden vrij (review #106). De
/// kern laat de hele torsie van een element vallen zodra één van zijn einden
/// vrij is. Kregen het eerste en het laatste deel elk hun vrijgave, dan
/// draaiden de rekenknopen ertussen vrij om de staafas (de grondveren grijpen
/// in de as aan): P-Delta en de knikanalyse faalden, soms ook lineair. Nu krijgt
/// alleen het eerste deel de vrijgave; de staaf draagt nog steeds geen torsie.
///
/// Een raster, geen enkel geval: of het misging hing van afronding af. Per
/// geval: rekent zonder fout (tweede orde geconvergeerd, knikanalyse niet
/// mislukt); een wringend moment op knoop 2 gaat volledig naar de oplegging
/// daar (de staaf draagt geen torsie, ook niet naar knoop 1); lineair is de
/// zakking die van dezelfde staaf zonder vrijgaven en zonder wringend moment,
/// want torsie en buiging zijn bij een rechte staaf ontkoppeld (grens 10⁻⁹
/// van de grootste zakking: afronding).
#[test]
fn torsie_aan_beide_einden_vrij_op_bedding() {
    let mx = 5.0;
    let model = |j: f64, l: f64, k: f64, analyse: AnalysisKind, n: f64, vrij: bool, wring: f64| {
        let mut ligger = op_bedding(staaf(1, 1, 2, 1), Some(k), 1.0, None, false);
        if vrij { ligger.releases = EndReleases3D { torsion_start: true, torsion_end: true, ..Default::default() }; }
        let mut request = verzoek(
            vec![knoop(1, 0.0, 0.0, 0.0), knoop(2, l, 0.0, 0.0)],
            vec![doorsnede(1, 0.01, 2e-4, 1e-4, j)],
            vec![ligger],
            vec![steun(1, [true; 6]), steun(2, [false, true, true, true, false, true])],
        );
        request.analysis = analyse;
        request.buckling_modes = 3;
        request.member_loads.push(MemberLoad3D {
            id: 1, member_id: 1, qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
            qz_start_kn_per_m: -10.0, qz_end_kn_per_m: -10.0, start_position_m: None, end_position_m: None,
            ..Default::default()
        });
        if n != 0.0 || wring != 0.0 {
            request.nodal_loads.push(NodalLoad3D { id: 1, node_id: 2, fx: -n, fy: 0.0, fz: 0.0, mx: wring, my: 0.0, mz: 0.0 });
        }
        request
    };
    let mut gevallen = 0;
    for j in [1e-8, 1e-6, 1e-3] {
        for l in [3.0, 10.0] {
            for k in [2_000.0, 200_000.0] {
                for analyse in [AnalysisKind::Linear, AnalysisKind::PDelta] {
                    for n in [0.0, 200.0] {
                        let geval = format!("J {j:e}, L {l}, k {k}, {analyse:?}, N {n}");
                        let r = solve(model(j, l, k, analyse, n, true, mx)).unwrap_or_else(|fout| panic!("{geval}: {fout}"));
                        if analyse == AnalysisKind::PDelta {
                            assert!(r.second_order.as_ref().is_some_and(|s| s.converged), "{geval}: tweede orde");
                        }
                        assert!(!matches!(r.buckling, BucklingSummary::Failed { .. }), "{geval}: knik {:?}", r.buckling);
                        if n > 0.0 {
                            assert!(matches!(r.buckling, BucklingSummary::Available { .. }), "{geval}: knik {:?}", r.buckling);
                        }
                        let krachten = r.member_forces.iter().find(|f| f.member_id == 1).unwrap();
                        assert!(krachten.torsion_start_knm.abs() < 1e-9 * mx && krachten.torsion_end_knm.abs() < 1e-9 * mx,
                            "{geval}: torsie in de staaf {krachten:?}");
                        let reactie = |id: usize| r.reactions.iter().find(|x| x.node_id == id).map(|x| x.mx).unwrap_or(0.0);
                        assert!((reactie(2) + mx).abs() < 1e-9 * mx && reactie(1).abs() < 1e-9 * mx,
                            "{geval}: wringend moment naar de oplegging van knoop 2: {} en {}", reactie(1), reactie(2));
                        if analyse == AnalysisKind::Linear {
                            let zonder = solve(model(j, l, k, analyse, n, false, 0.0)).unwrap();
                            let (met, zonder) = (bedding_van(&r, 1), bedding_van(&zonder, 1));
                            let grens = 1e-9 * met.max_settlement_m.abs().max(1e-12);
                            assert!(met.points.iter().zip(&zonder.points).all(|(p, q)| (p.settlement_m - q.settlement_m).abs() <= grens),
                                "{geval}: zakking hangt niet af van de torsievrijgave");
                        }
                        gevallen += 1;
                    }
                }
            }
        }
    }
    assert_eq!(gevallen, 48);
}

/// Een schoorpaal 1:3 (|e_x·Z| = 0,949, net onder de grens van 0,95 voor een
/// verticale staaf) met alleen zijdelingse bedding (review #106). De grond
/// werkt rondom, loodrecht op de paalas, zodra de staaf steiler staat dan 45°.
/// Voorheen werkte zij hier alleen horizontaal loodrecht op het schoorvlak en
/// was de paal ín dat vlak vrij: een mechanisme, terwijl dezelfde paal bij
/// 1:3,2 (boven de grens) wel rekende.
///
/// Gesloten oplossing als bij de verticale paal (lange paal, vrije kop,
/// λ·L ≈ 10): een kopkracht H loodrecht op de as geeft y₀ = 2·H·λ/(k·b) in de
/// richting van H. De kracht staat schuin in het vlak loodrecht op de as: 30 kN
/// in het schoorvlak (richting m) en 40 kN loodrecht erop (Y), zodat beide
/// richtingen hun deel dragen. Foutgrens 1,5 % zoals bij de verticale paal.
/// Daarnaast rekent de paal uit de review (horizontale kopkracht in het
/// schoorvlak, voet vast in Z) zonder fout en in evenwicht.
#[test]
fn schoorpaal_met_zijdelingse_bedding_rondom() {
    let (k_lat, b, l) = (30_000.0, 0.4, 25.0);
    let kb = k_lat * b;
    let i = 5e-4;
    let lam = lambda(kb, E_KN_M2 * i);
    let wortel = 10f64.sqrt();
    // Kop in de oorsprong, voet 1:3 schuin omlaag in +X; de staaf loopt van voet naar kop.
    let voet = [l / wortel, 0.0, -3.0 * l / wortel];
    let m = [3.0 / wortel, 0.0, 1.0 / wortel];
    let paal = |kop_last: [f64; 3]| {
        let mut request = verzoek(
            vec![knoop(1, voet[0], voet[1], voet[2]), knoop(2, 0.0, 0.0, 0.0)],
            vec![doorsnede(1, 0.05, i, i, 1e-3)],
            vec![op_bedding(staaf(1, 1, 2, 1), None, b, Some(k_lat), false)],
            vec![steun(1, [false, false, true, false, false, true])],
        );
        request.nodal_loads.push(knooplast(1, 2, kop_last[0], kop_last[1], kop_last[2]));
        request
    };
    let (hm, hy) = (30.0, 40.0);
    let request = paal([hm * m[0], hy, hm * m[2]]);
    let r = solve(request.clone()).unwrap();
    alleen_modelknopen(&request, &r);
    let kop = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
    let um = kop.ux * m[0] + kop.uy * m[1] + kop.uz * m[2];
    let verwacht = |h: f64| 2.0 * h * lam / kb;
    eprintln!("schoorpaal: λL {:.2}, u_m {:.4} %, u_y {:.4} %", lam * l,
        100.0 * (um - verwacht(hm)) / verwacht(hm), 100.0 * (kop.uy - verwacht(hy)) / verwacht(hy));
    dichtbij(um, verwacht(hm), 0.015, "kopverplaatsing in het schoorvlak");
    dichtbij(kop.uy, verwacht(hy), 0.015, "kopverplaatsing loodrecht op het schoorvlak");
    let top = bedding_van(&r, 1).points.last().unwrap();
    let loodrecht = (um * um + kop.uy * kop.uy).sqrt();
    dichtbij(top.lateral_kn_per_m.expect("zijdelingse lijnlast"), kb * loodrecht, 1e-6, "zijdelingse lijnlast = k·b·|u⊥|");
    assert!(r.equilibrium.as_ref().is_none_or(|e| e.equilibrium_ok), "{:?}", r.equilibrium);
    // De voet neemt niets op: de grond draagt de hele kopkracht.
    assert!(r.reactions.iter().all(|x| x.fz.abs() < 1e-6 * hy), "{:?}", r.reactions);

    // De paal uit de review: 50 kN horizontaal in het schoorvlak.
    let r = solve(paal([50.0, 0.0, 0.0])).unwrap_or_else(|fout| panic!("schoorpaal 1:3 met horizontale kopkracht: {fout}"));
    assert!(r.equilibrium.as_ref().is_none_or(|e| e.equilibrium_ok), "{:?}", r.equilibrium);
    let kop = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
    assert!(kop.ux > 0.0 && kop.ux.is_finite(), "de kop wijkt uit in de richting van de kracht: {kop:?}");
}
