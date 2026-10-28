//! Issue #226: een ronde trekstaaf krijgt niet onvoorwaardelijk een
//! maatgevende draadeindtoets.
//!
//! RD 60 S355, L = 3 m, N_Ed = +800 kN. Hand: t = d = 60 mm > 40 mm, dus
//! f_y = 335 en f_u = 470 N/mm² (tabel 3.1). A = π·60²/4 = 2827,4 mm²,
//! N_pl,Rd = 2827,4·335/1,0 = 947,19 kN → UC 0,8446. Alleen bij een gesneden
//! draad M60 (P = 5,5): A_s = π/4·(60 − 0,9382·5,5)² = 2362,0 mm²,
//! N_t,Rd = 0,9·470·2362,0/1,25 = 799,31 kN → UC 1,0009.

use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

fn staaf(naam: &str, grade: &str, l_m: f64, krachten: InternalForces, draadeind: Option<Draadeind>) -> BeamCheckResult {
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
        draadeind,
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

fn n(kn: f64) -> InternalForces {
    InternalForces { n_ed: kn, ..Default::default() }
}

const UC_STAAF: f64 = 800.0 / 947.19;
const UC_DRAAD: f64 = 800.0 / 799.31;

/// Zonder opgegeven eindafwerking: het draadeind staat er als informatie
/// (UC 1,0009), maar maakt de staaf niet NotOk; uc_max is de staaftoets en de
/// staaf is NIET VOLLEDIG GETOETST — geen Ok.
#[test]
fn niet_opgegeven_is_informatie() {
    let r = staaf("RD 60", "S355", 3.0, n(800.0), None);
    assert!((uc(&r, "6.2.3_threaded_end").unwrap() - UC_DRAAD).abs() < 1e-3);
    assert!((uc(&r, "6.2.3_tension").unwrap() - UC_STAAF).abs() < 1e-3);
    assert!((r.uc_max - UC_STAAF).abs() < 1e-3, "uc_max {}", r.uc_max);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.governing_check_id.starts_with("NIET VOLLEDIG GETOETST"), "{}", r.governing_check_id);
    let CheckKind::Resistance(c) = &toets(&r, "6.2.3_threaded_end").kind else { panic!() };
    assert!(c.notes[0].starts_with("AANNAME"));
}

/// Bij 700 kN voldoet ook het aangenomen draadeind (700/799,31 = 0,876): Ok,
/// met de staaftoets 700/947,19 = 0,739 als uc_max.
#[test]
fn niet_opgegeven_en_draadeind_voldoet() {
    let r = staaf("RD 60", "S355", 3.0, n(700.0), None);
    assert_eq!(r.status, CheckStatus::Ok);
    assert!((r.uc_max - 700.0 / 947.19).abs() < 1e-3);
    assert_eq!(r.governing_check_id, "6.2.3_tension");
}

/// Gesneden draad: het draadeind is de trektoets en is maatgevend, NotOk.
#[test]
fn gesneden_draad_maatgevend() {
    let r = staaf("RD 60", "S355", 3.0, n(800.0), Some(Draadeind::Gesneden));
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "6.2.3_threaded_end");
    assert!((r.uc_max - UC_DRAAD).abs() < 1e-3);
}

/// Opgestuikt, gelast of geen draad: geen draadeindtoets, UC 0,845 Ok.
#[test]
fn zonder_gesneden_draad() {
    for d in [Draadeind::Opgestuikt, Draadeind::Gelast, Draadeind::Geen] {
        let r = staaf("RD 60", "S355", 3.0, n(800.0), Some(d));
        assert!(r.checks.iter().all(|c| c.id != "6.2.3_threaded_end"), "{d:?}");
        assert_eq!(r.status, CheckStatus::Ok, "{d:?}");
        assert!((r.uc_max - UC_STAAF).abs() < 1e-3, "{d:?}");
        assert!((r.uc_max - 0.8446).abs() < 1e-3);
    }
}

/// Ook bij een trek-alleen staaf.
#[test]
fn trek_alleen_niet_opgegeven() {
    let envelop: Vec<ForcePoint> = (0..3)
        .map(|i| ForcePoint { combination_id: 1, position_mm: 1500.0 * i as f64, forces: n(800.0) })
        .collect();
    let mut invoer: BeamCheckInput = serde_json::from_value(serde_json::json!({
        "beam_id": 1, "profile_name": "RD 60", "steel_grade": "S355", "length_m": 3.0,
        "forces_envelope": [], "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "buckling_length_y_m": 3.0, "buckling_length_z_m": 3.0,
        "deflection_limit_class": "Floor", "deflection_limit_numerator": 333,
        "deflection_actual_max_mm": 0.0, "is_cantilever": false, "consequence_class": "CC2",
        "pre_camber_mm": 0.0, "deflection_permanent_mm": 0.0, "deflection_add_limit_numerator": 0.0,
        "deflection_notes": [], "q_equiv_n_per_mm": 0.0, "z_a_mm": 0.0, "tension_only": true
    }))
    .unwrap();
    invoer.forces_envelope = envelop;
    let r = check_beam(invoer);
    assert_eq!(r.status, CheckStatus::NotApplicable, "{}", r.governing_check_id);
    assert!((r.uc_max - UC_STAAF).abs() < 1e-3);
}
