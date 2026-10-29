//! Wringing, NEN-EN 1993-1-1 6.2.7 (issue #249), tegen handberekeningen.
//!
//! Tot oktober 2026 kende de staaltoets geen 6.2.7: een CHS 88,9×4 S235 met
//! |T_Ed| = 6,75 kNm kreeg status Ok met UC 0. Bewaakt wordt:
//!
//!  * de Saint-Venant-wringtoets (6.23) met τ_Rd = f_y/(√3·γ_M0) voor een
//!    ronde buis, een koker en massief rond;
//!  * V_pl,T,Rd volgens (6.28) in 6.2.6 (en daarmee ρ in 6.2.8, 6.2.10);
//!  * buiging naast wringing met f_y,T = f_y·√(1 − (τ_t/τ_Rd)²) (6.2.1(5));
//!  * een open I-profiel onder wringing: 6.2.7 "n.v.t." met reden en de staaf
//!    NIET VOLLEDIG GETOETST, nooit Ok;
//!  * zonder wringend moment verandert er niets: geen 6.2.7 in de lijst.

use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

fn staaf(naam: &str, grade: &str, l_m: f64, krachten: InternalForces) -> BeamCheckResult {
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
        steel_grade: grade.to_string(),
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
        tension_only: None,
        a_net_mm2: None,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
        draadeind: None,
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

fn waarde(r: &BeamCheckResult, id: &str) -> f64 {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c.value,
        CheckKind::Stability(c) => c.value,
    }
}

fn t(kn_m: f64) -> InternalForces {
    InternalForces { mt_ed: kn_m, ..Default::default() }
}

const TAU_RD_S235: f64 = 235.0 / 1.732_050_807_568_877_2; // 135,677 N/mm², γ_M0 = 1,0

/// Issue #249: uitkraging 1 m, CHS 88,9×4 S235, |T_Ed| = 1,35·5 = 6,75 kNm.
/// I_t = 1 926 800 mm⁴, r = 44,45 mm: W_t = I_t/r = 43 347,6 mm³,
/// τ_t,Ed = 6,75·10⁶/43 347,6 = 155,7 N/mm² > τ_Rd = 135,7 N/mm²,
/// T_Rd = 135,677·43 347,6 = 5,881 kNm, UC = 6,75/5,881 = 1,148 → NotOk.
#[test]
fn chs_88_9x4_issue_249_voldoet_niet() {
    let r = staaf("CHS 88.9x4", "S235", 1.0, t(-6.75));
    let w_t = 1_926_800.0 / 44.45;
    let t_rd = TAU_RD_S235 * w_t * 1e-6;
    assert!((t_rd - 5.881).abs() < 1e-3, "hand T_Rd = {t_rd}");
    assert!((waarde(&r, "6.2.7_torsion") - t_rd).abs() < 1e-6);
    let u = uc(&r, "6.2.7_torsion").unwrap();
    assert!((u - 6.75 / t_rd).abs() < 1e-9, "UC = {u}");
    assert!((u - 1.1477).abs() < 1e-3);
    assert_eq!(status(&r, "6.2.7_torsion"), CheckStatus::NotOk);
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "6.2.7_torsion");
    assert!((r.uc_max - u).abs() < 1e-12);
}

/// Dezelfde buis met T_Ed = 5,0 kNm: UC = 5,0/5,881 = 0,850 → Ok. Zonder N
/// of M is er geen toets 6.2.7_combined_nmt.
#[test]
fn chs_88_9x4_binnen_t_rd() {
    let r = staaf("CHS 88.9x4", "S235", 1.0, t(5.0));
    let t_rd = TAU_RD_S235 * 1_926_800.0 / 44.45 * 1e-6;
    let u = uc(&r, "6.2.7_torsion").unwrap();
    assert!((u - 5.0 / t_rd).abs() < 1e-9 && (u - 0.8502).abs() < 1e-3, "UC = {u}");
    assert_eq!(r.status, CheckStatus::Ok);
    assert!(r.checks.iter().all(|c| c.id != "6.2.7_combined_nmt"));
}

/// (6.28): CHS 88,9×4 S235, A_v = 679,2 mm², V_pl,Rd = 679,2·135,677 = 92,15 kN.
/// T_Ed = 3 kNm: τ_t,Ed = 3·10⁶/43 347,6 = 69,21 N/mm²,
/// V_pl,T,Rd = (1 − 69,21/135,677)·92,15 = 0,4899·92,15 = 45,15 kN.
/// V_z,Ed = 40 kN: UC = 40/45,15 = 0,886 (zonder wringing 0,434).
#[test]
fn chs_dwarskracht_met_wringing_6_28() {
    let f = InternalForces { mt_ed: 3.0, vz_ed: 40.0, ..Default::default() };
    let r = staaf("CHS 88.9x4", "S235", 1.0, f);
    let v_pl = 679.2 * TAU_RD_S235 * 1e-3;
    let tau = 3.0e6 / (1_926_800.0 / 44.45);
    let k = 1.0 - tau / TAU_RD_S235;
    assert!((k - 0.4899).abs() < 1e-3, "k = {k}");
    let u = uc(&r, "6.2.6_shear_z").unwrap();
    assert!((u - 40.0 / (k * v_pl)).abs() < 1e-9, "UC = {u}, hand {}", 40.0 / (k * v_pl));
    assert!((u - 0.886).abs() < 1e-3);
    assert!((waarde(&r, "6.2.6_shear_z") - k * v_pl).abs() < 1e-9);
    // Zonder wringing: de oude uitkomst, V_pl,Rd.
    let r0 = staaf("CHS 88.9x4", "S235", 1.0, InternalForces { vz_ed: 40.0, ..Default::default() });
    assert!((uc(&r0, "6.2.6_shear_z").unwrap() - 40.0 / v_pl).abs() < 1e-9);
}

/// Buiging naast wringing (6.2.1(5)): CHS 88,9×4 S235 (klasse 1),
/// W_pl = 28 853,4 mm³, M_pl,Rd = 6,780 kNm. T_Ed = 3 kNm geeft
/// τ_t/τ_Rd = 0,5101, f_y,T = 235·√(1 − 0,5101²) = 202,1 N/mm²,
/// M_pl,T,Rd = 28 853,4·202,1 = 5,832 kNm; M_y,Ed = 5 kNm: UC = 0,857.
/// Zonder wringing zou 6.2.9 5/6,780 = 0,737 geven.
#[test]
fn chs_buiging_met_wringing() {
    let f = InternalForces { mt_ed: 3.0, my_ed: 5.0, ..Default::default() };
    let r = staaf("CHS 88.9x4", "S235", 1.0, f);
    let tau = 3.0e6 / (1_926_800.0 / 44.45);
    let ratio = tau / TAU_RD_S235;
    let fy_t = 235.0 * (1.0 - ratio * ratio).sqrt();
    let m_pl_t = 28_853.4 * fy_t * 1e-6;
    let hand = 5.0 / m_pl_t;
    assert!((hand - 0.857).abs() < 1e-3, "hand {hand}");
    let u = uc(&r, "6.2.7_combined_nmt").unwrap();
    assert!((u - hand).abs() < 1e-6, "UC = {u}, hand {hand}");
    assert!(uc(&r, "6.2.9_combined_mn").unwrap() < u);
    assert_eq!(r.status, CheckStatus::Ok);
}

/// RHS 200×100×6,3 S355: C_t = I_t/(t + K/t) (EN 10210-2 bijlage B) =
/// 14 703 100/(6,3 + 64,48) = 207 730 mm³; τ_Rd = 355/√3 = 204,96 N/mm²,
/// T_Rd = 42,58 kNm; T_Ed = 20 kNm: UC = 0,470.
#[test]
fn rhs_koker_en10210() {
    let r = staaf("RHS 200x100x6.3", "S355", 2.0, t(20.0));
    let t_rd = waarde(&r, "6.2.7_torsion");
    assert!((t_rd - 207_730.0 * 355.0 / 3f64.sqrt() * 1e-6).abs() / t_rd < 2e-3, "T_Rd = {t_rd}");
    assert!((uc(&r, "6.2.7_torsion").unwrap() - 0.4697).abs() < 2e-3);
    assert_eq!(r.status, CheckStatus::Ok);
}

/// Massief rond RD 30 S235: W_t = π·d³/16 = 5301,4 mm³, T_Rd = 0,7193 kNm;
/// T_Ed = 0,5 kNm: UC = 0,695.
#[test]
fn massief_rond() {
    let r = staaf("RD 30", "S235", 1.0, t(0.5));
    let w_t = std::f64::consts::PI * 30f64.powi(3) / 16.0;
    let t_rd = w_t * TAU_RD_S235 * 1e-6;
    // I_t uit de catalogus is afgerond op zes cijfers.
    assert!((waarde(&r, "6.2.7_torsion") - t_rd).abs() / t_rd < 1e-4);
    assert!((uc(&r, "6.2.7_torsion").unwrap() - 0.5 / t_rd).abs() < 1e-3);
}

/// Een open I-profiel onder wringing: de welving is niet bekend, dus 6.2.7
/// staat als "n.v.t." met reden, en de staaf is NIET VOLLEDIG GETOETST —
/// nooit Ok. Faalt een gerekende toets, dan blijft het NotOk.
#[test]
fn ipe_wringing_niet_getoetst() {
    let r = staaf("IPE 300", "S235", 3.0, t(1.0));
    assert_eq!(status(&r, "6.2.7_torsion"), CheckStatus::NotApplicable);
    assert!(uc(&r, "6.2.7_torsion").is_none());
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(
        r.governing_check_id.starts_with("NIET VOLLEDIG GETOETST") && r.governing_check_id.contains("6.2.7"),
        "{}",
        r.governing_check_id
    );
    let zwaar = staaf(
        "IPE 300",
        "S235",
        3.0,
        InternalForces { mt_ed: 1.0, my_ed: 200.0, ..Default::default() },
    );
    assert_eq!(zwaar.status, CheckStatus::NotOk);
}

/// Zonder wringend moment komt 6.2.7 niet in de lijst.
#[test]
fn zonder_wringing_geen_toets() {
    let r = staaf("CHS 88.9x4", "S235", 1.0, InternalForces { my_ed: 3.0, ..Default::default() });
    assert!(r.checks.iter().all(|c| !c.id.starts_with("6.2.7")));
    let r = staaf("IPE 300", "S235", 3.0, InternalForces { my_ed: 30.0, ..Default::default() });
    assert!(r.checks.iter().all(|c| !c.id.starts_with("6.2.7")));
}

/// Vondst bij de stalen hal uit de halwizard: de 3D-staafanalyse geeft elke
/// IPE en HEA een wringend moment van hoogstens enkele Nm (rekenresten), en
/// door de regel hierboven stond bijna elke staaf op "niet volledig
/// getoetst". Een klein moment wordt nu met veilige bovengrenzen getoetst.
///
/// IPE 300 S235, L = 3 m, |T_Ed| = 0,01 kNm, M_y,Ed = 30 kNm. Catalogus:
/// h = 300, b = 150, t_f = 10,7, t_w = 7,1 mm, I_t = 201 000 mm⁴.
///   h_s = h − t_f = 289,3 mm
///   1/W_t,eq = t_f/I_t + 1,5/(h_s·b·t_f) = 5,3234·10⁻⁵ + 3,2305·10⁻⁶
///   W_t,eq = 17 710 mm³;  τ_Ed ≤ 0,01·10⁶/17 710 = 0,5646 N/mm²
///   UC 6.2.7 = 0,5646/135,68 = 0,00416
///   σ_w,Ed ≤ 6·T·L/(h_s·t_f·b²) = 6·10⁴·3000/(289,3·10,7·150²) = 2,584 N/mm²
/// Beide ≤ 5 % van τ_Rd (6,78) en f_y (11,75): getoetst, status Ok. In de
/// toets op buiging en normaalkracht: f_y,T = 235·√(1 − (0,5646/135,68)²) −
/// 2,584 = 232,414 N/mm².
#[test]
fn ipe_klein_wringend_moment_met_bovengrenzen_getoetst() {
    let r = staaf("IPE 300", "S235", 3.0, InternalForces { mt_ed: 0.01, my_ed: 30.0, ..Default::default() });
    let h_s: f64 = 300.0 - 10.7;
    let w_t_eq: f64 = 1.0 / (10.7 / 201_000.0 + 1.5 / (h_s * 150.0 * 10.7));
    let tau: f64 = 0.01e6 / w_t_eq;
    let sigma_w: f64 = 6.0 * 0.01e6 * 3000.0 / (h_s * 10.7 * 150.0 * 150.0);
    assert!((w_t_eq - 17_710.3).abs() < 1.0, "{w_t_eq}");
    assert!((sigma_w - 2.5844).abs() < 1e-3, "{sigma_w}");
    assert_eq!(status(&r, "6.2.7_torsion"), CheckStatus::Ok);
    let uc_t = uc(&r, "6.2.7_torsion").expect("UC 6.2.7");
    assert!((uc_t - tau / TAU_RD_S235).abs() < 1e-9, "{uc_t} ≠ {}", tau / TAU_RD_S235);
    assert!((uc_t - 0.004_16).abs() < 1e-5, "{uc_t}");
    assert_eq!(r.status, CheckStatus::Ok, "{}", r.governing_check_id);
    // Buiging met wringing: f_y,T met τ én σ_w; M_y,Ed/M_c,Rd met die f_y.
    let fy_t = 235.0 * (1.0 - (tau / TAU_RD_S235).powi(2)).sqrt() - sigma_w;
    assert!((fy_t - 232.414).abs() < 1e-3, "{fy_t}");
    let uc_nm = uc(&r, "6.2.7_combined_nmt").expect("UC 6.2.7_combined_nmt");
    let uc_buiging = uc(&r, "6.2.5_bending_y").expect("UC 6.2.5");
    assert!((uc_nm / uc_buiging - 235.0 / fy_t).abs() < 1e-6, "{uc_nm} / {uc_buiging}");
    // Een groter moment (0,5 kNm: τ ≤ 28 N/mm² > 5 % van τ_Rd) blijft niet getoetst.
    let groot = staaf("IPE 300", "S235", 3.0, t(0.5));
    assert_eq!(groot.status, CheckStatus::NotApplicable);
    assert!(uc(&groot, "6.2.7_torsion").is_none());
}
