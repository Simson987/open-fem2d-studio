//! §6.2.3, §6.2.4, §6.2.9 en §6.3 — trek, druk, buiging met normaalkracht en
//! knik zoals de norm ze schrijft, tegen handberekeningen op
//! catalogusprofielen.
//!
//! Wat hier bewaakt wordt (oktober 2026):
//!
//!  * 6.2.9 voor een I-profiel volgt (6.36): de reductie begint bij n > 0,5·a
//!    en niet pas bij n > a, en er is geen sprong bij n = a. De vrijstelling
//!    van 6.2.9.1(4) wordt getoetst en gemeld;
//!  * buiging om twee assen volgt (6.41) met α = 2 en β = 5n ≥ 1;
//!  * een koker volgt (6.39);
//!  * bij N_Ed ≥ N_pl,Rd geeft 6.2.9 geen rekenkundig artefact maar een
//!    eindige unity check — de evenredige overschrijding — en de melding
//!    "N_Ed ≥ N_pl,Rd: de doorsnede bezwijkt al op normaalkracht";
//!  * trek (6.2.3) wordt voor elke doorsnede getoetst; zuivere trek geeft
//!    nooit een unity check van 0, en een staaf op trek krijgt geen knik-UC.
//!
//! Alle getallen zijn met de hand uitgerekend; de afleiding staat bij de test.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

/// Een staaf `naam` van `l_m` meter met overal dezelfde krachten (11 punten).
fn staaf(naam: &str, l_m: f64, krachten: InternalForces) -> BeamCheckResult {
    staaf_met(naam, l_m, krachten, None)
}

fn staaf_met(naam: &str, l_m: f64, krachten: InternalForces, a_net_mm2: Option<f64>) -> BeamCheckResult {
    let envelop: Vec<ForcePoint> = (0..11)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: l_m * 1000.0 * i as f64 / 10.0,
            forces: krachten,
        })
        .collect();
    check_beam(BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: naam.to_string(),
        steel_grade: "S235".to_string(),
        length_m: l_m,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing {
            top_flange_positions: vec![],
            bottom_flange_positions: vec![],
        },
        buckling_length_y_m: l_m,
        buckling_length_z_m: l_m,
        deflection_limit_class: DeflectionClass::Floor,
        deflection_limit_numerator: 333,
        deflection_actual_max_mm: 0.0,
        is_cantilever: false,
        consequence_class: ConsequenceClass::CC2,
        pre_camber_mm: 0.0,
        deflection_permanent_mm: 0.0,
        deflection_add_limit_numerator: 0.0,
        deflection_notes: vec![],
        q_equiv_n_per_mm: 0.0,
        z_a_mm: 0.0,
        custom_section: None,
        staafstand: None,
        staafstand_notities: None,
        staafeinden: None,
        staaf_notities: None,
        profile_end: None,
        custom_section_end: None,
        a_net_mm2,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
        draadeind: None,
        tension_only: None,
    })
}

fn toets<'a>(r: &'a BeamCheckResult, id: &str) -> &'a NamedCheck {
    r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| {
        panic!(
            "toets '{id}' ontbreekt; wel: {:?}",
            r.checks.iter().map(|c| c.id.as_str()).collect::<Vec<_>>()
        )
    })
}

fn weerstand<'a>(r: &'a BeamCheckResult, id: &str) -> &'a nen_en_1993_1_1_section::ResistanceCalc {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c,
        CheckKind::Stability(_) => panic!("{id} is een stabiliteitstoets"),
    }
}

fn uc(r: &BeamCheckResult, id: &str) -> Option<f64> {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c.uc.as_ref().map(|u| u.uc),
        CheckKind::Stability(c) => c.uc.as_ref().map(|u| u.uc),
    }
}

fn status(r: &BeamCheckResult, id: &str) -> CheckStatus {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c.status,
        CheckKind::Stability(c) => c.status,
    }
}

fn notities<'a>(r: &'a BeamCheckResult, id: &str) -> &'a [String] {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => &c.notes,
        CheckKind::Stability(c) => &c.notes,
    }
}

fn deelstap(r: &BeamCheckResult, id: &str, stap: &str) -> f64 {
    weerstand(r, id)
        .deelstappen
        .iter()
        .find(|d| d.id == stap)
        .unwrap_or_else(|| panic!("deelstap {stap} ontbreekt in {id}"))
        .value
        .expect("deelstap zonder waarde")
}

// HEB 200, S235, uit de catalogus: A = 7810 mm², b = 200, t_f = 15,
// t_w = 9, h = 200, W_pl,y = 642 000 mm³, W_pl,z = 306 000 mm³.
//   N_pl,Rd   = 7810·235      = 1835,35 kN
//   M_pl,y,Rd = 642 000·235   = 150,87 kNm
//   M_pl,z,Rd = 306 000·235   = 71,91 kNm
//   a         = (7810 − 2·200·15)/7810 = 1810/7810 = 0,231754 → 0,5·a = 0,115877
const N_PL_HEB200: f64 = 1835.35;
const M_PL_Y_HEB200: f64 = 150.87;
const A_HEB200: f64 = 1810.0 / 7810.0;

/// n tussen 0,5·a en a: HEB 200 met N_Ed = 0,2·N_pl,Rd = 367,07 kN druk en
/// M_y,Ed = 100 kNm.
///   vrijstelling (6.33): 0,25·N_pl,Rd = 458,84 kN ≥ 367,07 — voldaan;
///                (6.34): 0,5·h_w·t_w·f_y = 0,5·170·9·235 = 179,78 kN < 367,07
///                → niet vrijgesteld;
///   (6.36): M_N,y,Rd = 150,87·(1 − 0,2)/(1 − 0,5·0,231754)
///                    = 150,87·0,8/0,884123 = 136,515 kNm
///   UC = 100/136,515 = 0,732520.
/// De oude regel (geen reductie tot n = a) gaf 100/150,87 = 0,662822: 10,5 %
/// te gunstig, precies in het gebied waar (6.36) al reduceert.
#[test]
fn heb200_reductie_begint_bij_een_halve_a() {
    let r = staaf("HEB 200", 1.0, InternalForces { n_ed: -0.2 * N_PL_HEB200, my_ed: 100.0, ..Default::default() });
    let mn = weerstand(&r, "6.2.9_combined_mn");
    assert_relative_eq!(deelstap(&r, "6.2.9_combined_mn", "a"), A_HEB200, max_relative = 1e-12);
    assert_relative_eq!(deelstap(&r, "6.2.9_combined_mn", "n"), 0.2, max_relative = 1e-12);
    assert_relative_eq!(mn.value, 136.514_954, max_relative = 1e-7);
    assert_relative_eq!(uc(&r, "6.2.9_combined_mn").unwrap(), 0.732_520_48, max_relative = 1e-7);
    assert_eq!(mn.status, CheckStatus::Ok);
    let vrij = mn.deelstappen.iter().find(|d| d.id == "vrijstelling").expect("vrijstelling");
    assert!(vrij.notes[0].contains("niet voldaan"), "{:?}", vrij.notes);
    assert!(mn.article.contains("(6.36)"), "{}", mn.article);
}

/// Onder 0,5·a geen reductie, en bij n = a geen sprong: de UC loopt continu
/// door. HEB 200, M_y = 100 kNm:
///   n = 0,10  < 0,5a: M_N,y,Rd = M_pl,y,Rd → UC = 100/150,87 = 0,662822
///   n = a⁻ en a⁺: (1 − n)/(1 − 0,5a) = 0,768246/0,884123 = 0,868936 aan beide
///   kanten → UC = 100/(150,87·0,868936) = 0,762791.
#[test]
fn geen_sprong_bij_n_gelijk_aan_a() {
    let m = |n: f64| {
        let r = staaf("HEB 200", 1.0, InternalForces { n_ed: -n * N_PL_HEB200, my_ed: 100.0, ..Default::default() });
        uc(&r, "6.2.9_combined_mn").unwrap()
    };
    assert_relative_eq!(m(0.10), 100.0 / M_PL_Y_HEB200, max_relative = 1e-12);
    let onder = m(A_HEB200 - 1e-9);
    let boven = m(A_HEB200 + 1e-9);
    assert_relative_eq!(onder, boven, max_relative = 1e-7);
    assert_relative_eq!(onder, 100.0 / (M_PL_Y_HEB200 * (1.0 - A_HEB200) / (1.0 - 0.5 * A_HEB200)), max_relative = 1e-7);
}

/// Buiging om twee assen, (6.41): HEB 200, n = 0,2, M_y = 60 en M_z = 30 kNm.
///   M_N,y,Rd = 136,515 kNm (zie hierboven)
///   M_N,z,Rd = M_pl,z,Rd = 71,91 kNm ((6.37): n = 0,2 ≤ a)
///   α = 2, β = max(5·0,2; 1) = 1
///   linkerlid = (60/136,515)² + (30/71,91)¹ = 0,193171 + 0,417188 = 0,610359
///   UC = 1/μ met (μ·0,439512)² + μ·0,417188 = 1 → μ = 1,438654, UC = 0,695094
#[test]
fn tweeassig_volgt_6_41() {
    let r = staaf(
        "HEB 200",
        1.0,
        InternalForces { n_ed: -0.2 * N_PL_HEB200, my_ed: 60.0, mz_ed: 30.0, ..Default::default() },
    );
    let mn = weerstand(&r, "6.2.9_combined_mn");
    assert_relative_eq!(mn.value, 0.610_359_2, max_relative = 1e-6);
    assert_relative_eq!(uc(&r, "6.2.9_combined_mn").unwrap(), 0.695_094_4, max_relative = 1e-6);
    assert_relative_eq!(deelstap(&r, "6.2.9_combined_mn", "m_n_z_rd"), 71.91, max_relative = 1e-12);
    assert_relative_eq!(deelstap(&r, "6.2.9_combined_mn", "alpha_beta"), 1.0, max_relative = 1e-12);
}

/// N_Ed > N_pl,Rd: HEB 200 met N = 1,05·N_pl,Rd = 1927,12 kN druk en een
/// klein moment M_y = 5 kNm (m = 5/150,87 = 0,033141).
///
/// Er is geen momentweerstand over; (1 − n)/(1 − 0,5a) zou negatief zijn. De
/// UC is de EVENREDIGE overschrijding: de factor waardoor N én M samen gedeeld
/// moeten worden om op de grens van (6.36) uit te komen. Voor een I om de
/// y-as is dat max(m; n + (1 − 0,5a)·m):
///   UC = 1,05 + 0,884123·0,033141 = 1,079301
/// Eindig, groter dan n, en met de melding erbij. (De oude formule gaf hier
/// een rekenkundig artefact.)
#[test]
fn heb200_boven_n_pl_eindige_uc_met_melding() {
    let r = staaf("HEB 200", 1.0, InternalForces { n_ed: -1.05 * N_PL_HEB200, my_ed: 5.0, ..Default::default() });
    let verwacht = 1.05 + (1.0 - 0.5 * A_HEB200) * 5.0 / M_PL_Y_HEB200;
    assert_relative_eq!(verwacht, 1.079_300_8, max_relative = 1e-7);
    for id in ["6.2.9_combined_mn", "6.2.10_combined_mnv"] {
        assert_relative_eq!(uc(&r, id).unwrap(), verwacht, max_relative = 1e-9);
        assert_eq!(status(&r, id), CheckStatus::NotOk, "{id}");
        assert!(
            notities(&r, id)[0].starts_with("N_Ed ≥ N_pl,Rd: de doorsnede bezwijkt al op normaalkracht"),
            "{id}: {:?}",
            notities(&r, id)
        );
    }
    // De druktoets zegt hetzelfde: N/N_pl = 1,05.
    assert_relative_eq!(uc(&r, "6.2.4_compression").unwrap(), 1.05, max_relative = 1e-12);
}

/// Aan de grens geen sprong: net onder N_pl,Rd met een moment dat het
/// criterium nét laat voldoen, en net daarboven — de UC loopt door 1,0.
#[test]
fn rond_de_grens_loopt_de_uc_door_een() {
    // n = 0,95: M_N,y,Rd = 150,87·0,05/0,884123 = 8,532 kNm.
    let m_n = M_PL_Y_HEB200 * 0.05 / (1.0 - 0.5 * A_HEB200);
    let onder = staaf("HEB 200", 1.0, InternalForces { n_ed: -0.95 * N_PL_HEB200, my_ed: m_n * (1.0 - 1e-9), ..Default::default() });
    let boven = staaf("HEB 200", 1.0, InternalForces { n_ed: -0.95 * N_PL_HEB200, my_ed: m_n * (1.0 + 1e-9), ..Default::default() });
    let (u0, u1) = (uc(&onder, "6.2.9_combined_mn").unwrap(), uc(&boven, "6.2.9_combined_mn").unwrap());
    assert!(u0 <= 1.0 && u1 > 1.0, "{u0} {u1}");
    assert_relative_eq!(u0, 1.0, max_relative = 1e-7);
    assert_relative_eq!(u1, 1.0, max_relative = 1e-7);
}

/// Zuivere trek boven N_pl,Rd op een HEA 200 (A = 5380 mm²):
///   6.2.3: N_t,Rd = N_pl,Rd = 5380·235 = 1264,3 kN, UC = 1300/1264,3 = 1,028237
///   6.2.4, 6.3.1 en 6.3.3: n.v.t., zonder unity check (geen druk)
///   6.2.9: geen moment, n = 1,028 > 1 → UC = n = 1,028237, met de melding
/// Zuivere trek geeft dus nergens een UC van 0, en nergens een knik-UC.
#[test]
fn hea200_zuivere_trek_boven_n_pl() {
    let r = staaf("HEA 200", 6.0, InternalForces { n_ed: 1300.0, ..Default::default() });
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 1300.0 / 1264.3, max_relative = 1e-12);
    assert_eq!(status(&r, "6.2.3_tension"), CheckStatus::NotOk);
    assert!(
        notities(&r, "6.2.3_tension").iter().any(|t| t.starts_with("Geen nettodoorsnede opgegeven")),
        "{:?}",
        notities(&r, "6.2.3_tension")
    );
    for id in ["6.2.4_compression", "6.3.1_buckling", "6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
        assert_eq!(status(&r, id), CheckStatus::NotApplicable, "{id}");
        assert!(uc(&r, id).is_none(), "{id} hoort geen unity check te hebben");
        assert!(notities(&r, id)[0].starts_with("Niet van toepassing"), "{id}: {:?}", notities(&r, id));
    }
    assert_relative_eq!(uc(&r, "6.2.9_combined_mn").unwrap(), 1300.0 / 1264.3, max_relative = 1e-9);
    assert!(notities(&r, "6.2.9_combined_mn")[0].starts_with("N_Ed ≥ N_pl,Rd"));
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_relative_eq!(r.uc_max, 1300.0 / 1264.3, max_relative = 1e-9);
}

/// Een trekstaaf met een klein moment uit het eigen gewicht: IPE 200 (A =
/// 2850 mm²) van 6 m onder 300 kN trek en M_y = 2 kNm. Trek UC =
/// 300/(2850·235) = 300/669,75 = 0,447928; geen knik en geen 6.3.3 — de oude
/// toets nam de trekkracht als drukkracht en gaf een knik-UC op de trek.
#[test]
fn trekstaaf_krijgt_geen_knik_uc() {
    let r = staaf("IPE 200", 6.0, InternalForces { n_ed: 300.0, my_ed: 2.0, ..Default::default() });
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 300.0 / 669.75, max_relative = 1e-12);
    for id in ["6.2.4_compression", "6.3.1_buckling", "6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
        assert_eq!(status(&r, id), CheckStatus::NotApplicable, "{id}");
        assert!(uc(&r, id).is_none(), "{id}");
    }
}

/// Een staaf met trek én druk (een windverband dat omslaat): 6.2.3 toetst de
/// grootste trek, 6.2.4 en 6.3.1 de grootste DRUK — ook als de trek groter
/// is. IPE 200, combinatie 1 met 300 kN trek, combinatie 2 met 20 kN druk.
#[test]
fn trek_en_druk_elk_op_hun_eigen_punt() {
    let mut envelop: Vec<ForcePoint> = Vec::new();
    for (c, n) in [(1, 300.0), (2, -20.0)] {
        for i in 0..5 {
            envelop.push(ForcePoint {
                combination_id: c,
                position_mm: 1500.0 * i as f64,
                forces: InternalForces { n_ed: n, ..Default::default() },
            });
        }
    }
    let mut invoer = BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: "IPE 200".to_string(),
        steel_grade: "S235".to_string(),
        length_m: 6.0,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing { top_flange_positions: vec![], bottom_flange_positions: vec![] },
        buckling_length_y_m: 6.0,
        buckling_length_z_m: 6.0,
        deflection_limit_class: DeflectionClass::Floor,
        deflection_limit_numerator: 333,
        deflection_actual_max_mm: 0.0,
        is_cantilever: false,
        consequence_class: ConsequenceClass::CC2,
        pre_camber_mm: 0.0,
        deflection_permanent_mm: 0.0,
        deflection_add_limit_numerator: 0.0,
        deflection_notes: vec![],
        q_equiv_n_per_mm: 0.0,
        z_a_mm: 0.0,
        custom_section: None,
        staafstand: None,
        staafstand_notities: None,
        staafeinden: None,
        staaf_notities: None,
        profile_end: None,
        custom_section_end: None,
        a_net_mm2: None,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
        draadeind: None,
        tension_only: None,
    };
    let r = check_beam(invoer.clone());
    assert_eq!(weerstand(&r, "6.2.3_tension").force_state.combination_id, 1);
    assert_eq!(weerstand(&r, "6.2.4_compression").force_state.combination_id, 2);
    assert_relative_eq!(uc(&r, "6.2.4_compression").unwrap(), 20.0 / 669.75, max_relative = 1e-12);
    let CheckKind::Stability(knik) = &toets(&r, "6.3.1_buckling").kind else { unreachable!() };
    assert_eq!(knik.force_state.combination_id, 2);
    assert_relative_eq!(knik.uc.as_ref().unwrap().ed, 20.0, max_relative = 1e-12);
    // Met een opgegeven nettodoorsnede wordt (6.7) meegenomen:
    // N_u,Rd = 0,9·2400·360/1,25 = 622,08 kN < N_pl,Rd = 669,75 kN.
    invoer.a_net_mm2 = Some(2400.0);
    let r = check_beam(invoer.clone());
    assert_relative_eq!(weerstand(&r, "6.2.3_tension").value, 622.08, max_relative = 1e-12);
    // Een A_net groter dan A is een invoerfout: de staaf wordt geweigerd.
    invoer.a_net_mm2 = Some(3000.0);
    let r = check_beam(invoer);
    assert!(r.checks.is_empty() && r.governing_check_id.starts_with("ERROR: A_net"), "{}", r.governing_check_id);
}

/// Koker, (6.39): HFRHS 200x200x16 (A = 11 501,3 mm², t = 16,
/// W_pl = 785 472 mm³), n = 0,4.
///   a_w = (11 501,3 − 2·200·16)/11 501,3 = 0,443541
///   M_N,y,Rd = 184,586·(1 − 0,4)/(1 − 0,221771) = 142,312 kNm
///   UC = 100/142,312 = 0,702680
#[test]
fn koker_volgt_6_39() {
    let n_pl = 11_501.3 * 235.0 * 1e-3;
    let r = staaf("HFRHS200X200X16", 1.0, InternalForces { n_ed: -0.4 * n_pl, my_ed: 100.0, ..Default::default() });
    assert_relative_eq!(deelstap(&r, "6.2.9_combined_mn", "a_w_a_f"), 0.443_541_2, max_relative = 1e-6);
    assert_relative_eq!(weerstand(&r, "6.2.9_combined_mn").value, 142.312_215, max_relative = 1e-6);
    assert_relative_eq!(uc(&r, "6.2.9_combined_mn").unwrap(), 0.702_680_37, max_relative = 1e-6);
}

/// Ronde buis, §6.2.9.1(2) exact: CHS 168.3x8.0 (R = 84,15, r = 76,15 mm,
/// A = 4028,78 mm², W_pl = 205 739 mm³), n = 0,5, M_y = 20 en M_z = 15 kNm.
/// De plastische neutrale lijn ligt op c met n(c) = 1 − 2·A_s(c)/A = 0,5:
///   c = 56,651 mm (= 0,673214·R)
///   A_s = A_s(R) − A_s(r) = 2368,269 − 1361,074 = 1007,195 mm² → n = 0,5000
///   S_s = ⅔[(R² − c²)^1,5 − (r² − c²)^1,5] = 160 617,9 − 87 847,8 = 72 770,1 mm³
///   S_s(0) = ⅔(R³ − r³) = 102 869,7 mm³ → m = 0,707400
///   (een dunne wand gaf cos(π·0,5/2) = 0,707107)
///   M_pl,Rd = 205 739·235 = 48,349 kNm → M_N,Rd = 34,202 kNm
///   M_Ed = √(20² + 15²) = 25 kNm → UC = 25/34,202 = 0,730954
#[test]
fn ronde_buis_volgt_de_exacte_ring() {
    let n_pl = 4028.78 * 235.0 * 1e-3;
    let r = staaf(
        "CHS 168.3x8.0",
        1.0,
        InternalForces { n_ed: -0.5 * n_pl, my_ed: 20.0, mz_ed: 15.0, ..Default::default() },
    );
    assert_relative_eq!(deelstap(&r, "6.2.9_combined_mn", "ring"), 0.707_400_3, max_relative = 1e-6);
    assert_relative_eq!(weerstand(&r, "6.2.9_combined_mn").value, 34.201_86, max_relative = 1e-6);
    assert_relative_eq!(uc(&r, "6.2.9_combined_mn").unwrap(), 0.730_954_4, max_relative = 1e-6);
}
