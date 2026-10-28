//! Knikfactor en tweede orde van staven zonder tussenknopen (controle oktober
//! 2026, punt K4, issue #186).
//!
//! Eén kubisch element met de consistente geometrische stijfheid geeft voor een
//! pendelstaaf N_cr = 12·EI/L² in plaats van π²·EI/L² (+21,6 %), en een staaf
//! met scharnieren aan beide einden heeft dan geen eigen knikvorm meer: alleen
//! de koordestijfheid N/L blijft over. De adapter verdeelt daarom voor de
//! knikanalyse en de tweede orde elke gedrukte staaf in vier delen per stuk
//! tussen twee echte knopen, rekent elk deel in K_G met zijn eigen
//! normaalkracht, en voegt de uitkomst weer samen tot de ene staaf van het
//! model.
//!
//! De verzoeken zijn de exacte MCP-aanroepen van de controle
//! (`design-mockup/testdata/controle-2026-10/k4/invoer-*.json`); de
//! verwachtingen zijn handwaarden:
//! - 021: pendelstaaf 5 m, I = 3,692·10⁻⁵ m⁴, N = 300 kN, q = 2 kN/m:
//!   N_cr = π²EI/L² = 3061 kN, α_cr = 10,20; veldmoment tweede orde
//!   q/k²·(sec(kL/2) − 1) = 6,948 kNm met k = √(N/EI); moment bij de
//!   scharnieren 0;
//! - 045: geschoord frame, regel 4 m scharnier–scharnier met N = 10 kN:
//!   α_cr = π²EI/(L²·N) = 129,5;
//! - 061 en 062: driepoot met scharnierende poten (L = 3,786 m), poot 2
//!   N = −34,70 kN: α_cr = 4,167;
//! - 038: staaf 5 m aan beide einden ingeklemd, ΔT = +30 K:
//!   N = E·A·α·ΔT = 378 kN, N_cr,z = 4π²EI_z/L² → α_cr = 5,30.
//!
//! Met vier delen ligt de knikfactor van een eindig-elementenmodel met de
//! consistente K_G altijd boven de exacte waarde (Rayleigh–Ritz): bij een
//! scharnierende staaf 0,05–0,06 %, bij een aan beide einden ingeklemde staaf
//! (twee delen per halve golf) 0,75 %.

use open_fem_3d::{solve, AnalysisKind, BucklingSummary, SolveRequest3D, SolveResult3D};
use serde_json::Value;

/// E in kN/m² (210 000 MPa).
const E: f64 = 210_000_000.0;
const PI: f64 = std::f64::consts::PI;

const INVOER_021: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k4/invoer-021.json");
const INVOER_038: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k4/invoer-038.json");
const INVOER_045: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k4/invoer-045.json");
const INVOER_061: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k4/invoer-061.json");
const INVOER_062: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k4/invoer-062.json");

/// Het verzoek uit een MCP-aanroep {tool, arguments}.
fn verzoek(json: &str) -> SolveRequest3D {
    let aanroep: Value = serde_json::from_str(json).expect("geldige JSON");
    serde_json::from_value(aanroep["arguments"].clone()).expect("geldig 3D-verzoek")
}

/// 038 zoals vastgelegd, plus de werkelijke profielhoogte h = 300 mm (IPE300,
/// I_y = 8356·10⁴ mm⁴) die een temperatuurverschil over de doorsnede sinds
/// #221 vraagt; de vastgelegde aanroep kende dat veld nog niet.
fn verzoek_038() -> SolveRequest3D {
    let mut r = verzoek(INVOER_038);
    r.sections[0].height_m = Some(0.300);
    r
}

fn knikfactor(r: &SolveResult3D) -> f64 {
    match &r.buckling {
        BucklingSummary::Available { modes, .. } => modes[0].load_factor,
        anders => panic!("geen knikfactor: {anders:?}"),
    }
}

fn relatief(waarde: f64, referentie: f64) -> f64 { (waarde - referentie) / referentie.abs() }

/// De eindige-elementenwaarde ligt boven de handwaarde, en hoogstens `max` erboven.
fn boven_en_dichtbij(waarde: f64, hand: f64, max: f64, wat: &str) {
    let afwijking = relatief(waarde, hand);
    eprintln!("{wat}: {waarde:.6} tegen hand {hand:.6} ({:+.4} %)", afwijking * 100.0);
    assert!(afwijking >= -1e-9, "{wat}: {waarde} ligt onder de exacte {hand}");
    assert!(afwijking <= max, "{wat}: {waarde} ligt {:.3} % boven {hand} (grens {:.2} %)", afwijking * 100.0, max * 100.0);
}

fn waarde_bij(lijn: &open_fem_3d::MemberDiagram3D, t: f64) -> f64 {
    lijn.points.iter().filter(|p| (p.t - t).abs() < 1e-9).map(|p| p.value)
        .next().unwrap_or_else(|| panic!("geen punt op t = {t}"))
}

/// 021: pendelstaaf in tweede orde. De knikfactor benadert π²EI/(L²N), het
/// veldmoment de exacte tweede-ordewaarde, en bij de scharnieren is het moment
/// nul — ook in de staafkrachten, waar eerder de fictieve knooplasten −K_G·u
/// van de eindstap als eindmoment terechtkwamen (0,365 kNm).
#[test]
fn k4_021_pendelstaaf_tweede_orde_volgens_euler() {
    let (i, l, n, q) = (3.692e-5, 5.0, 300.0, 2.0);
    let r = solve(verzoek(INVOER_021)).unwrap();
    let n_cr = PI * PI * E * i / (l * l);
    boven_en_dichtbij(knikfactor(&r), n_cr / n, 2e-3, "021 α_cr");
    let BucklingSummary::Available { members, .. } = &r.buckling else { unreachable!() };
    assert_eq!(members.len(), 1, "één knikregel per modelstaaf");
    boven_en_dichtbij(members[0].critical_force_kn, n_cr, 2e-3, "021 N_cr");
    assert!(relatief(members[0].effective_length_m, l).abs() < 1e-3, "L_cr {}", members[0].effective_length_m);

    // Uitkomst per modelstaaf: zelfde vorm als zonder onderverdeling.
    assert_eq!(r.member_forces.len(), 1);
    assert_eq!(r.diagrams.moment_y.len(), 1);
    assert_eq!(r.diagrams.moment_y[0].member_id, 1);
    let mut knopen: Vec<usize> = r.displacements.iter().map(|d| d.node_id).collect();
    knopen.sort_unstable();
    assert_eq!(knopen, vec![1, 2], "alleen de knopen van het model");
    let mut reacties: Vec<usize> = r.reactions.iter().map(|d| d.node_id).collect();
    reacties.sort_unstable();
    assert_eq!(reacties, vec![1, 2], "alleen de opleggingen van het model");

    // Veldmoment: exact q/k²·(sec(kL/2) − 1).
    let k = (n / (E * i)).sqrt();
    let m_veld = q / (k * k) * (1.0 / (k * l / 2.0).cos() - 1.0);
    let lijn = &r.diagrams.moment_y[0];
    let midden = waarde_bij(lijn, 0.5).abs();
    eprintln!("021 veldmoment {midden:.5} kNm tegen hand {m_veld:.5} ({:+.3} %)", relatief(midden, m_veld) * 100.0);
    assert!(relatief(midden, m_veld).abs() < 1e-3, "veldmoment {midden} tegen {m_veld}");
    assert!((lijn.max_abs_value - midden).abs() < 1e-9 * m_veld, "het grootste moment staat in het midden");

    // Geen moment bij de scharnieren, in de lijn en in de staafkrachten.
    let f = &r.member_forces[0];
    for (wat, m) in [("lijn t=0", waarde_bij(lijn, 0.0)), ("lijn t=1", waarde_bij(lijn, 1.0)),
        ("My begin", f.my_start_knm), ("My eind", f.my_end_knm), ("Mz begin", f.mz_start_knm), ("Mz eind", f.mz_end_knm)] {
        eprintln!("021 {wat}: {m:.3e} kNm");
        assert!(m.abs() < 1e-6, "021 {wat}: {m} kNm bij een scharnier");
    }
    // De lijnen hebben dezelfde 21 punten als een ongedeelde staaf (de kern
    // bemonstert per element in 20 stappen), en volgen over de hele lengte de
    // exacte oplossing van de gedrukte ligger:
    //   M(x) = q/k²·(cos(k·(x − L/2))/cos(kL/2) − 1),
    //   V(x) = dM/dx = −q/k·sin(k·(x − L/2))/cos(kL/2)  (lokaal x-z: dM_y/dx = V_z).
    let teken = waarde_bij(lijn, 0.5).signum();
    for (soort, lijn, exact, schaal) in [
        ("M_y", &r.diagrams.moment_y[0],
            Box::new(|x: f64| q / (k * k) * ((k * (x - l / 2.0)).cos() / (k * l / 2.0).cos() - 1.0)) as Box<dyn Fn(f64) -> f64>,
            m_veld),
        ("V_z", &r.diagrams.shear_z[0],
            Box::new(|x: f64| -q / k * (k * (x - l / 2.0)).sin() / (k * l / 2.0).cos()) as Box<dyn Fn(f64) -> f64>,
            q * l / 2.0),
    ] {
        assert_eq!(lijn.points.len(), 21, "{soort}: 21 punten");
        let mut grootste: f64 = 0.0;
        for (index, punt) in lijn.points.iter().enumerate() {
            assert!((punt.t - index as f64 / 20.0).abs() < 1e-12, "{soort}: punt {index} op t = {}", punt.t);
            grootste = grootste.max((punt.value - teken * exact(punt.t * l)).abs() / schaal);
        }
        eprintln!("021 {soort}-lijn tegen de exacte oplossing: grootste afwijking {:.3e} van {schaal:.3}", grootste);
        assert!(grootste < 1e-3, "{soort}-lijn wijkt {grootste:.2e} af van de exacte oplossing");
    }
}

/// 045: geschoord frame met scharnierende staven en een trek-alleen kruis. De
/// regel (4 m, N = 10 kN) knikt zelf: α_cr = π²EI/(L²N) = 129,5, niet 8400.
#[test]
fn k4_045_scharnierende_regel_knikt_zelf() {
    let r = solve(verzoek(INVOER_045)).unwrap();
    let hand = PI * PI * E * 1e-5 / (4.0 * 4.0) / 10.0;
    boven_en_dichtbij(knikfactor(&r), hand, 2e-3, "045 α_cr");
    let BucklingSummary::Available { members, .. } = &r.buckling else { unreachable!() };
    let regel = members.iter().find(|m| m.member_id == 3).expect("knikregel van de regel");
    assert!(relatief(regel.effective_length_m, 4.0).abs() < 1e-3, "L_cr regel {}", regel.effective_length_m);
    assert_eq!(r.member_forces.len(), 5, "elke modelstaaf één regel, ook de trek-alleen staven");
}

/// 061: driepoot met scharnierende poten, één staaf per poot: α_cr = 4,167
/// (eerder 1807: zonder eigen knikvorm van de poot).
#[test]
fn k4_061_driepoot_scharnierende_poten() {
    let r = solve(verzoek(INVOER_061)).unwrap();
    let l = (2.0f64 * 2.0 + 1.1547 * 1.1547 + 3.0 * 3.0).sqrt();
    let n_cr = PI * PI * E * 1e-6 / (l * l);
    let n_poot = r.member_forces.iter().find(|f| f.member_id == 2).unwrap().n_start_kn;
    eprintln!("061 N poot 2 = {n_poot:.4} kN");
    assert!((n_poot + 34.704).abs() < 1e-2, "N poot 2 {n_poot}");
    boven_en_dichtbij(knikfactor(&r), n_cr / n_poot.abs(), 2e-3, "061 α_cr");
}

/// 062: dezelfde driepoot met elke poot in vier stukken via tussenknopen. Elk
/// stuk gaat in vier delen (`KNIKDELEN` per stuk, review K4): zestien delen per
/// poot, waar 061 er vier heeft. Beide liggen boven de handwaarde, en het
/// fijnere net (dat de knopen van 061 bevat) hoogstens even hoog als 061
/// (Rayleigh–Ritz). Tot de review kreeg een staaf met vier of meer stukken
/// geen onderverdeling; 062 rekende toen exact als 061.
#[test]
fn k4_062_driepoot_met_tussenknopen() {
    let r = solve(verzoek(INVOER_062)).unwrap();
    let l = (2.0f64 * 2.0 + 1.1547 * 1.1547 + 3.0 * 3.0).sqrt();
    let n_cr = PI * PI * E * 1e-6 / (l * l);
    let n_poot = r.member_forces.iter().find(|f| f.member_id == 2).unwrap().n_start_kn;
    boven_en_dichtbij(knikfactor(&r), n_cr / n_poot.abs(), 2e-3, "062 α_cr");
    let r061 = solve(verzoek(INVOER_061)).unwrap();
    assert!(knikfactor(&r) <= knikfactor(&r061) * (1.0 + 1e-12), "062 {} boven 061 {}", knikfactor(&r), knikfactor(&r061));
}

/// 038: staaf aan beide einden ingeklemd onder ΔT = +30 K. Alle
/// vrijheidsgraden van de staaf lagen vast, dus K_G was leeg en de knikanalyse
/// faalde ("alleen numerieke nulmodi"); bij tweede orde blokkeerde dat de hele
/// berekening. Nu: α_cr = 4π²EI_z/(L²·N) = 5,30, lineair en in tweede orde.
#[test]
fn k4_038_ingeklemde_staaf_onder_temperatuur() {
    let (a, i_z, l) = (0.005, 6.04e-6, 5.0);
    let n = E * a * 12e-6 * 30.0;
    let hand = 4.0 * PI * PI * E * i_z / (l * l) / n;
    // De vastgelegde aanroep zonder hoogte: geen stille aanname h = √(12I/A).
    let fout = solve(verzoek(INVOER_038)).unwrap_err();
    assert!(fout.contains("mist de hoogte (heightM)"), "{fout}");
    let lineair = solve(verzoek_038()).unwrap();
    // #221, staaf 2 (uitkraging 4 m, ΔT_z = 20 K): θ_tip = α·ΔT/h·L =
    // 12e-6·20/0,300·4 = 3,20·10⁻³ rad (met h = √(12I/A) = 448 mm was het 2,1437·10⁻³).
    let tip = lineair.displacements.iter().find(|d| d.node_id == 4).unwrap();
    assert!(relatief(tip.ry.abs(), 3.2e-3).abs() < 1e-9, "θ_tip = {}", tip.ry);
    let n_staaf = lineair.member_forces.iter().find(|f| f.member_id == 1).unwrap().n_start_kn;
    assert!(relatief(n_staaf.abs(), n).abs() < 1e-9, "N = E·A·α·ΔT: {n_staaf}");
    boven_en_dichtbij(knikfactor(&lineair), hand, 1e-2, "038 α_cr lineair");

    let mut p_delta = verzoek_038();
    p_delta.analysis = AnalysisKind::PDelta;
    let tweede = solve(p_delta).expect("tweede orde wordt niet meer geblokkeerd");
    boven_en_dichtbij(knikfactor(&tweede), hand, 1e-2, "038 α_cr tweede orde");
    let BucklingSummary::Available { members, .. } = &tweede.buckling else { unreachable!() };
    let staaf = members.iter().find(|m| m.member_id == 1).unwrap();
    assert!(relatief(staaf.effective_length_m, 0.5 * l).abs() < 5e-3, "L_cr = 0,5·L: {}", staaf.effective_length_m);
}

/// Een lineaire berekening houdt haar uitkomsten bit voor bit: de knikanalyse
/// rekent op een eigen, onderverdeeld model, de verplaatsingen, krachten en
/// lijnen komen van het model zoals het is.
#[test]
fn k4_lineaire_uitkomst_bitgelijk_met_en_zonder_knikanalyse() {
    for invoer in [INVOER_021, INVOER_038, INVOER_045, INVOER_061] {
        let mut zonder = if invoer == INVOER_038 { verzoek_038() } else { verzoek(invoer) };
        zonder.analysis = AnalysisKind::Linear;
        zonder.buckling_modes = 0;
        let mut met = zonder.clone();
        met.buckling_modes = 3;
        let deel = |r: SolveResult3D| {
            let mut v = serde_json::to_value(r).unwrap();
            let o = v.as_object_mut().unwrap();
            o.remove("buckling");
            serde_json::to_string(&v).unwrap()
        };
        let a = deel(solve(zonder).unwrap());
        let b = deel(solve(met).unwrap());
        assert_eq!(a, b, "lineaire uitkomst verandert door de knikanalyse");
    }
}

/// Een lijnlast langs de staafas (eigen gewicht van een kolom) geeft een
/// normaalkracht die langs de staaf verloopt. Elk deel van een voor de knik
/// onderverdeelde staaf rekent in K_G met zijn EIGEN normaalkracht (review K4:
/// met het gemiddelde van de staaf viel α_cr tot 20 % te hoog uit). De
/// identiteit die de app onafhankelijk narekent (`openFem3DSecondOrderMomentKnm`)
/// is dan: de momentensom van lasten en reacties in de onvervormde stand is
/// Σ N_deel·(e_x × Δu_deel) over de delen die de uitkomst in
/// `secondOrderParts` meegeeft. Met N̄ van de staaf en Δu tussen de
/// modelknopen klopt zij hier niet meer (dat toont dat de delen ertoe doen).
#[test]
fn k4_tweede_orde_moment_met_lijnlast_langs_de_as() {
    use open_fem_3d::{
        GlobalDirection3D, Material3D, Member3D, MemberLoad3D, NodalLoad3D, Node3D, Section3D, Support3D,
    };
    let h = 6.0;
    let request = SolveRequest3D {
        schema_version: 2, analysis: AnalysisKind::PDelta,
        nodes: vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 0.0, y: 0.0, z: h }],
        materials: vec![Material3D { id: 1, name: "staal".into(), e_mpa: 210_000.0, nu: 0.3, g_mpa: None, alpha_per_k: None }],
        sections: vec![Section3D { id: 1, name: "kolom".into(), area_m2: 5.38e-3, iy_m4: 3.69e-5, iz_m4: 1.34e-5,
            torsion_j_m4: 2.1e-7, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }],
        members: vec![Member3D { id: 1, start_node_id: 1, end_node_id: 2, material_id: 1, section_id: 1,
            releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false,
            bedding: None, part_section_ids: None }],
        supports: vec![Support3D { node_id: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }],
        nodal_loads: vec![NodalLoad3D { id: 1, node_id: 2, fx: 10.0, fy: 4.0, fz: -60.0, mx: 0.0, my: 0.0, mz: 0.0 }],
        member_loads: vec![MemberLoad3D { id: 1, member_id: 1, global_direction: Some(GlobalDirection3D::Z),
            q_start_kn_per_m: Some(-3.0), q_end_kn_per_m: Some(-3.0), ..Default::default() }],
        member_point_loads: vec![], thermal_loads: vec![], plates: vec![], shell_elements: vec![], surface_loads: vec![],
        diaphragms: vec![], node_links: vec![], tension_only_fit: None, tension_only_cross_rule: false, max_iterations: 100,
        tolerance: 1e-10, buckling_modes: 1,
    };
    let r = solve(request).unwrap();
    let f = &r.member_forces[0];
    assert!((f.n_start_kn - (-78.0)).abs() < 1e-6 && (f.n_end_kn - (-60.0)).abs() < 1e-6, "N verloopt: {f:?}");
    let u = r.displacements.iter().find(|d| d.node_id == 2).unwrap();
    let reactie = r.reactions.iter().find(|x| x.node_id == 1).unwrap();
    // Lasten en reacties: de lijnlast ligt op de Z-as en heeft geen moment om de oorsprong.
    let kracht = [10.0 + reactie.fx, 4.0 + reactie.fy, -60.0 - 3.0 * h + reactie.fz];
    let moment = [-h * 4.0 + reactie.mx, h * 10.0 + reactie.my, reactie.mz];

    // De delen: vier, elk met zijn eigen N (de gemiddelden 75,75 · 71,25 ·
    // 66,75 · 62,25 kN druk), en samen het hele Δu tussen de modelknopen.
    assert_eq!(r.second_order_parts.len(), 1, "één staaf");
    let delen = &r.second_order_parts[0].parts;
    assert_eq!(delen.len(), 4, "vier delen");
    for (index, deel) in delen.iter().enumerate() {
        let verwacht = -(60.0 + 3.0 * h * (3.5 - index as f64) / 4.0);
        assert!((deel.n_kn - verwacht).abs() < 1e-3, "deel {index}: N {} tegen {verwacht}", deel.n_kn);
    }
    for as_ in 0..3 {
        let som: f64 = delen.iter().map(|deel| deel.du_m[as_]).sum();
        let totaal = [u.ux, u.uy, u.uz][as_];
        assert!((som - totaal).abs() < 1e-9 * totaal.abs().max(1e-6), "Σ Δu as {as_}: {som} tegen {totaal}");
    }
    // e_x = Z: e_x × Δu = (−Δu_y, Δu_x, 0).
    let mut tweede_orde = [0.0; 3];
    for deel in delen {
        tweede_orde[0] -= deel.n_kn * deel.du_m[1];
        tweede_orde[1] += deel.n_kn * deel.du_m[0];
    }
    let n_gem = (f.n_start_kn + f.n_end_kn) / 2.0;
    let oud = [-n_gem * u.uy, n_gem * u.ux, 0.0];
    eprintln!("momentensom {moment:?} tegen Σ N_deel·(e_x × Δu_deel) {tweede_orde:?} (N̄·(e_x × Δu): {oud:?}); krachtensom {kracht:?}");
    for as_ in 0..3 {
        assert!(kracht[as_].abs() < 1e-8, "krachtensom {as_}: {}", kracht[as_]);
        assert!((moment[as_] - tweede_orde[as_]).abs() < 1e-8 * 60.0, "as {as_}: {} tegen {}", moment[as_], tweede_orde[as_]);
    }
    assert!((moment[1] - oud[1]).abs() > 1e-6, "met N̄ van de hele staaf sluit de som hier niet: {} tegen {}", moment[1], oud[1]);
}

/// Een gedrukte kolom met eigen gewicht langs de as tegen een fijn verdeelde
/// referentie (64 losse staven van 93,75 mm): voet scharnierend, kop in
/// draaiing vast en vrij verplaatsbaar, q = 15 kN/m en P = 50 kN op de kop
/// (de review van K4 mat met het gemiddelde N per staaf +19,6 %, onveilig);
/// en een ingeklemde uitkraging met dezelfde lasten (toen −18,6 %). Met de N
/// van elk deel ligt de ene staaf binnen 1 % van de referentie: +0,87 % en
/// −1,12 % — de rest is de constante N binnen elk van de vier delen.
#[test]
fn k4_kolom_met_eigen_gewicht_langs_de_as_tegen_fijne_referentie() {
    use serde_json::json;
    let model = |n: usize, kop_draaiing_vast: bool| -> SolveRequest3D {
        let l = 6.0;
        let nodes: Vec<_> = (0..=n).map(|i| json!({ "id": i + 1, "x": 0, "y": 0, "z": l * i as f64 / n as f64 })).collect();
        let members: Vec<_> = (0..n).map(|i| json!({ "id": i + 1, "startNodeId": i + 1, "endNodeId": i + 2,
            "materialId": 1, "sectionId": 1 })).collect();
        let lasten: Vec<_> = (0..n).map(|i| json!({ "id": i + 1, "memberId": i + 1, "globalDirection": "z",
            "qStartKnPerM": -15.0, "qEndKnPerM": -15.0 })).collect();
        let supports = if kop_draaiing_vast {
            json!([
                { "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": false, "ry": false, "rz": true },
                { "nodeId": n + 1, "ux": false, "uy": false, "uz": false, "rx": true, "ry": true, "rz": false },
            ])
        } else {
            json!([{ "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": true, "ry": true, "rz": true }])
        };
        serde_json::from_value(json!({
            "nodes": nodes,
            "materials": [{ "id": 1, "name": "staal", "eMpa": 210000, "nu": 0.3 }],
            "sections": [{ "id": 1, "name": "k", "areaM2": 0.003, "iyM4": 1.336e-5, "izM4": 1.336e-5, "torsionJM4": 1e-6 }],
            "members": members, "supports": supports, "memberLoads": lasten,
            "nodalLoads": [{ "id": 1, "nodeId": n + 1, "fx": 0, "fy": 0, "fz": -50.0, "mx": 0, "my": 0, "mz": 0 }],
            "analysis": "linear", "bucklingModes": 2,
        })).expect("geldig verzoek")
    };
    for (kop_draaiing_vast, naam, onder, boven) in [
        (true, "voet scharnier, kop draaiing vast", 0.0, 1e-2),
        (false, "ingeklemde uitkraging", -1.5e-2, 0.0),
    ] {
        let een = knikfactor(&solve(model(1, kop_draaiing_vast)).unwrap());
        let fijn = knikfactor(&solve(model(64, kop_draaiing_vast)).unwrap());
        let afwijking = relatief(een, fijn);
        eprintln!("{naam}: één staaf α_cr {een:.5}, 64 staven {fijn:.5} ({:+.3} %)", afwijking * 100.0);
        assert!(afwijking >= onder && afwijking <= boven, "{naam}: {:+.3} % buiten [{onder}, {boven}]", afwijking * 100.0);
    }
}

/// Een kolom van 4 × 3 m langs z met een zijdelingse steun (u_x, u_y) op elke
/// tussenknoop, 300 kN op de kop: elk vak knikt zelf, α_cr = π²EI/(L_vak²·N)
/// = 28,341. Tot de review van K4 hing de onderverdeling aan het totaal aantal
/// stukken (minder dan vier → aanvullen tot vier): één staaf met drie
/// tussenknopen werd niet verdeeld (+21,6 %), een staaf met twee tussenknopen
/// en één los vak gaf +0,57 %. Nu gaat elk stuk tussen echte knopen in vier
/// delen, en geeft elke modellering van hetzelfde bouwwerk hetzelfde getal.
#[test]
fn k4_kolom_vier_vakken_elke_modellering_gelijk() {
    use serde_json::json;
    let i = 3.692e-5;
    let hand = PI * PI * E * i / (3.0 * 3.0) / 300.0;
    let staaf = |id: usize, a: usize, b: usize, tussen: &[usize]| json!({ "id": id, "startNodeId": a, "endNodeId": b,
        "materialId": 1, "sectionId": 1, "intermediateNodeIds": tussen });
    let varianten = [
        ("één staaf met drie tussenknopen", vec![staaf(1, 1, 5, &[2, 3, 4])]),
        ("staaf 1–4 met twee tussenknopen en staaf 4–5", vec![staaf(1, 1, 4, &[2, 3]), staaf(2, 4, 5, &[])]),
        ("twee staven met elk één tussenknoop", vec![staaf(1, 1, 3, &[2]), staaf(2, 3, 5, &[4])]),
        ("vier losse staven", vec![staaf(1, 1, 2, &[]), staaf(2, 2, 3, &[]), staaf(3, 3, 4, &[]), staaf(4, 4, 5, &[])]),
    ];
    let mut waarden = Vec::new();
    for (naam, members) in varianten {
        let mut supports = vec![json!({ "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": false, "ry": false, "rz": true })];
        supports.extend((2..=5).map(|n| json!({ "nodeId": n, "ux": true, "uy": true, "uz": false, "rx": false, "ry": false, "rz": false })));
        let request: SolveRequest3D = serde_json::from_value(json!({
            "nodes": (0..5).map(|k| json!({ "id": k + 1, "x": 0, "y": 0, "z": 3.0 * k as f64 })).collect::<Vec<_>>(),
            "materials": [{ "id": 1, "name": "staal", "eMpa": 210000, "nu": 0.3 }],
            "sections": [{ "id": 1, "name": "k", "areaM2": 0.005, "iyM4": i, "izM4": i, "torsionJM4": 1e-6 }],
            "members": members, "supports": supports,
            "nodalLoads": [{ "id": 1, "nodeId": 5, "fx": 0, "fy": 0, "fz": -300, "mx": 0, "my": 0, "mz": 0 }],
            "analysis": "linear", "bucklingModes": 2,
        })).expect("geldig verzoek");
        let alpha = knikfactor(&solve(request).unwrap());
        boven_en_dichtbij(alpha, hand, 2e-3, naam);
        waarden.push(alpha);
    }
    for alpha in &waarden[1..] {
        assert!(relatief(*alpha, waarden[0]).abs() < 1e-9, "zelfde bouwwerk, andere α_cr: {waarden:?}");
    }
}

/// De M_y- en V_z-lijn van 021 (pendelstaaf 5 m, N = 300 kN, q = 2 kN/m) tegen
/// de exacte oplossing in 21 punten, en de eindmomenten nul.
fn lijnen_021_tegen_exact(r: &SolveResult3D, wat: &str) {
    let (i, l, n, q) = (3.692e-5, 5.0, 300.0, 2.0);
    let k = (n / (E * i)).sqrt();
    let m_veld = q / (k * k) * (1.0 / (k * l / 2.0).cos() - 1.0);
    let lijn_m = &r.diagrams.moment_y[0];
    let teken = waarde_bij(lijn_m, 0.5).signum();
    for (soort, lijn, exact, schaal) in [
        ("M_y", lijn_m,
            Box::new(|x: f64| q / (k * k) * ((k * (x - l / 2.0)).cos() / (k * l / 2.0).cos() - 1.0)) as Box<dyn Fn(f64) -> f64>,
            m_veld),
        ("V_z", &r.diagrams.shear_z[0],
            Box::new(|x: f64| -q / k * (k * (x - l / 2.0)).sin() / (k * l / 2.0).cos()) as Box<dyn Fn(f64) -> f64>,
            q * l / 2.0),
    ] {
        assert_eq!(lijn.points.len(), 21, "{wat} {soort}: 21 punten");
        let mut grootste: f64 = 0.0;
        for punt in &lijn.points {
            grootste = grootste.max((punt.value - teken * exact(punt.t * l)).abs() / schaal);
        }
        eprintln!("{wat} {soort}-lijn tegen de exacte oplossing: grootste afwijking {grootste:.3e} van {schaal:.3}");
        assert!(grootste < 1e-3, "{wat}: {soort}-lijn wijkt {grootste:.2e} af van de exacte oplossing");
    }
    let f = &r.member_forces[0];
    for (naam, m) in [("My begin", f.my_start_knm), ("My eind", f.my_end_knm), ("Mz begin", f.mz_start_knm), ("Mz eind", f.mz_end_knm)] {
        assert!(m.abs() < 1e-6, "{wat} {naam}: {m} kNm bij een scharnier");
    }
}

/// 021 met de scharnieren als VRIJGAVE op de staaf in plaats van in de
/// opleggingen (die nu in draaiing vastzitten), en de varianten met één
/// vrijgegeven eind en met torsievrijgaven. Zo loopt de tweede-ordecorrectie
/// van de staafkrachten (`vorm` in `tweede_orde`) door de tak van een
/// vrijgegeven einde: de gecondenseerde einddraaiing in het eerste en het
/// laatste deel. De review van K4 schakelde die tak uit zonder dat een test
/// faalde; V_z wijkt dan in de eindvakken 5,5 % af (5,000 tegen 5,446 bij
/// t = 0) en M_y bij t = 0,05 1,227 tegen 1,299.
#[test]
fn k4_021_scharnieren_als_vrijgave() {
    use serde_json::json;
    let varianten = [
        ("vrijgave aan beide einden", json!({ "myStart": true, "myEnd": true, "mzStart": true, "mzEnd": true }), [true, true]),
        ("vrijgave aan het begin, eind scharnierend opgelegd", json!({ "myStart": true, "mzStart": true }), [true, false]),
        ("vrijgave aan het eind, begin scharnierend opgelegd", json!({ "myEnd": true, "mzEnd": true }), [false, true]),
        ("vrijgave aan beide einden, ook torsie aan beide einden",
            json!({ "myStart": true, "myEnd": true, "mzStart": true, "mzEnd": true, "torsionStart": true, "torsionEnd": true }), [true, true]),
        ("vrijgave aan beide einden, torsie aan het begin",
            json!({ "myStart": true, "myEnd": true, "mzStart": true, "mzEnd": true, "torsionStart": true }), [true, true]),
    ];
    for (naam, releases, draaiing_vast) in varianten {
        let mut aanroep: Value = serde_json::from_str(INVOER_021).unwrap();
        let verzoek = &mut aanroep["arguments"];
        verzoek["members"][0]["releases"] = releases;
        for (index, vast) in draaiing_vast.into_iter().enumerate() {
            if vast {
                for as_ in ["rx", "ry", "rz"] { verzoek["supports"][index][as_] = json!(true); }
            }
        }
        let r = solve(serde_json::from_value(verzoek.clone()).expect("geldig verzoek")).unwrap();
        lijnen_021_tegen_exact(&r, naam);
    }
}

/// De andere tak van `vorm`: een staaf met vrijgaven aan BEIDE einden die niet
/// wordt onderverdeeld (zij staat op trek), dus één element waarvan de kromme
/// de koorde is. Een staaf langs x van 4 m, begin vast, eind op een veer
/// k_z = 50 kN/m, met trek T = 200 kN en een dwarslast H = 10 kN op het eind.
/// Tweede orde: de trek geeft de staaf N/L = 50 kN/m dwarsstijfheid, dus
/// w = H/(k + T/L) = 0,1 m, en de staaf is een pendel: zijn kracht ligt langs
/// de vervormde as, M = 0 en V (loodrecht op de vervormde as, dM/dx) = 0. Met
/// de koordetak uitgeschakeld bleef V_z = −N·w/L = −5 kN staan.
#[test]
fn k4_getrokken_pendelstaaf_koorde() {
    use serde_json::json;
    let request: SolveRequest3D = serde_json::from_value(json!({
        "nodes": [{ "id": 1, "x": 0, "y": 0, "z": 0 }, { "id": 2, "x": 4, "y": 0, "z": 0 }],
        "materials": [{ "id": 1, "name": "staal", "eMpa": 210000, "nu": 0.3 }],
        "sections": [{ "id": 1, "name": "staaf", "areaM2": 0.005, "iyM4": 3.692e-5, "izM4": 3.692e-5, "torsionJM4": 2.1e-7 }],
        "members": [{ "id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1, "sectionId": 1,
            "releases": { "myStart": true, "myEnd": true, "mzStart": true, "mzEnd": true } }],
        "supports": [
            { "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": true, "ry": true, "rz": true },
            { "nodeId": 2, "ux": false, "uy": true, "uz": false, "rx": true, "ry": true, "rz": true, "kzKnPerM": 50.0 },
        ],
        "nodalLoads": [{ "id": 1, "nodeId": 2, "fx": 200, "fy": 0, "fz": 10, "mx": 0, "my": 0, "mz": 0 }],
        "analysis": "p-delta", "bucklingModes": 1, "tolerance": 1e-12, "maxIterations": 200,
    })).expect("geldig verzoek");
    let r = solve(request).unwrap();
    let w = r.displacements.iter().find(|d| d.node_id == 2).unwrap().uz;
    let n = r.member_forces[0].n_start_kn;
    eprintln!("getrokken pendel: w = {w:.6} m, N = {n:.4} kN");
    assert!(relatief(w, 10.0 / (50.0 + n / 4.0)).abs() < 1e-6, "w {w} tegen H/(k + N/L)");
    assert!((w - 0.1).abs() < 1e-3, "w ≈ 0,1 m: {w}");
    assert_eq!(r.second_order_parts[0].parts.len(), 1, "getrokken: niet onderverdeeld");
    // Welke lokale as in het vlak van de dwarslast ligt, hangt aan de
    // assenafspraak van de kern; beide buigvlakken moeten nul zijn.
    let f = &r.member_forces[0];
    for (naam, waarde) in [("Vy begin", f.vy_start_kn), ("Vy eind", f.vy_end_kn), ("Vz begin", f.vz_start_kn),
        ("Vz eind", f.vz_end_kn), ("My begin", f.my_start_knm), ("My eind", f.my_end_knm), ("Mz begin", f.mz_start_knm),
        ("Mz eind", f.mz_end_knm)]
    {
        eprintln!("getrokken pendel {naam}: {waarde:.3e}");
        assert!(waarde.abs() < 1e-6, "getrokken pendel {naam}: {waarde}");
    }
    let lijnen = &r.diagrams;
    for punt in lijnen.shear_y[0].points.iter().chain(&lijnen.shear_z[0].points)
        .chain(&lijnen.moment_y[0].points).chain(&lijnen.moment_z[0].points)
    {
        assert!(punt.value.abs() < 1e-6, "getrokken pendel: lijnwaarde {} op t = {}", punt.value, punt.t);
    }
}
