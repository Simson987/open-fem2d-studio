//! Issue #240: CHS-naamvarianten en de overbodige kiptoets bij een ronde buis.
//!
//! CHS 168,3×8 S355, L = 4 m, N_Ed = −600 kN, M_y lineair 0 → 20 kNm,
//! V_z = 5 kN, geen kipsteunen. Handberekening:
//!
//! * A = 4028,78 mm², i = 56,745 mm, λ_1 = 93,9·ε = 76,41, λ̄ = 4000/56,745/76,41
//!   = 0,9225; kromme a (α = 0,21): Φ = 1,0014, χ = 0,7190;
//!   N_b,Rd = 0,7190·4028,78·355/1,0 = 1028,3 kN.
//! * W_pl = 205 739 mm³, M_pl,Rd = 73,04 kNm; C_my = 0,6, k_yy = 0,8530,
//!   k_zy = 0,5118 (bijlage B): (6.61) 600/1028,3 + 0,8530·20/73,04 = 0,817,
//!   (6.62) 600/1028,3 + 0,5118·20/73,04 = 0,724.
//! * Kip: een ronde buis is niet kipgevoelig (6.3.2.1(2)); 6.3.2 "n.v.t." met
//!   reden, en χ_LT = 1 in 6.3.3.
//!
//! De namen "CHS 168.3x8.0", "CHS 168.3x8" en "CHS168.3x8" geven hetzelfde
//! resultaat; een onbekende maat geeft een foutmelding met suggestie.

use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

fn staaf(naam: &str) -> BeamCheckResult {
    let (grade, l_m) = ("S355", 4.0);
    // N = −600 kN (druk), M_y lineair 0 → 20 kNm, V_z = 5 kN.
    let envelop: Vec<ForcePoint> = (0..11)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: l_m * 1000.0 * i as f64 / 10.0,
            forces: InternalForces {
                n_ed: -600.0,
                vz_ed: 5.0,
                my_ed: 20.0 * i as f64 / 10.0,
                ..Default::default()
            },
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

#[test]
fn chs_168_3x8_knik_en_interactie() {
    let r = staaf("CHS 168.3x8.0");
    let n_b_rd = waarde(&r, "6.3.1_buckling");
    assert!((n_b_rd - 1028.2).abs() < 0.2, "N_b,Rd = {n_b_rd}");
    let u61 = uc(&r, "6.3.3_eq_6_61").unwrap();
    let u62 = uc(&r, "6.3.3_eq_6_62").unwrap();
    assert!((u61 - 0.8171).abs() < 1e-3, "(6.61) = {u61}");
    assert!((u62 - 0.7237).abs() < 1e-3, "(6.62) = {u62}");
    assert_eq!(r.status, CheckStatus::Ok);
}

/// Kip: n.v.t. met reden, geen UC, en niets over flenzen.
#[test]
fn chs_geen_kiptoets() {
    let r = staaf("CHS 168.3x8.0");
    assert_eq!(status(&r, "6.3.2_ltb"), CheckStatus::NotApplicable);
    assert!(uc(&r, "6.3.2_ltb").is_none());
    let CheckKind::Stability(s) = &toets(&r, "6.3.2_ltb").kind else { panic!("geen stabiliteitstoets") };
    let tekst = s.notes.join(" ");
    assert!(tekst.contains("6.3.2.1(2)") && tekst.contains("ronde buis"), "{tekst}");
    assert!(!tekst.to_lowercase().contains("flens"), "{tekst}");
    assert!(s.deelstappen.is_empty());
}

/// De drie naamvarianten uit het issue geven hetzelfde resultaat.
#[test]
fn chs_naamvarianten() {
    let a = staaf("CHS 168.3x8.0");
    for naam in ["CHS 168.3x8", "CHS168.3x8", "chs 168.3 x 8.00"] {
        let b = staaf(naam);
        assert_ne!(b.status, CheckStatus::NotApplicable, "{naam}: {}", b.governing_check_id);
        assert!((b.uc_max - a.uc_max).abs() < 1e-12, "{naam}");
        assert_eq!(b.governing_check_id, a.governing_check_id, "{naam}");
    }
}

/// Een maat die niet in de catalogus staat: geen toetsen, "ERROR: …" en een
/// suggestie met de dichtstbijzijnde CHS 168,3.
#[test]
fn onbekende_chs_met_suggestie() {
    let r = staaf("CHS 168.3x9");
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.checks.is_empty());
    assert!(r.governing_check_id.starts_with("ERROR: profile CHS 168.3x9 not found"));
    assert!(r.governing_check_id.contains("\"CHS 168.3x8.0\""), "{}", r.governing_check_id);
    assert!(r.governing_check_id.contains("\"CHS 168.3x10\""), "{}", r.governing_check_id);
}
