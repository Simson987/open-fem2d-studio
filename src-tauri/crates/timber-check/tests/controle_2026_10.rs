//! Regressie op de controle van oktober 2026, punt K3: hout onder trek met
//! buiging (NEN-EN 1995-1-1 6.2.3, (6.17)/(6.18)). De invoer is die van de
//! controle (`design-mockup/testdata/controle-2026-10/k3-check-timber-beams.json`);
//! de verwachtingen zijn de HANDWAARDEN.
//!
//! GL24h 90 × 180, klimaatklasse 1, middellang (k_mod = 0,8), γ_M = 1,25,
//! k_h = min((600/180)^0,1; 1,1) = 1,1:
//!   f_t,0,d = 1,1·19,2·0,8/1,25 = 13,5168 N/mm²
//!   f_m,d   = 1,1·24·0,8/1,25   = 16,896 N/mm²
//!   A = 16 200 mm², W = 486 000 mm³
//! Staaf 1: N = +40 kN, M = 3 kNm → σ_t = 2,4691, σ_m = 6,1728;
//!   (6.17) = 0,18267 + 0,36534 = 0,54801 → voldoet.
//! Staaf 2: N = +80 kN, M = 6 kNm → σ_t = 4,9383, σ_m = 12,3457;
//!   (6.17) = 0,36534 + 0,73069 = 1,09603 → voldoet NIET.
//! In 2026.41.0 ontbrak (6.17) en was staaf 2 "voldoet" met UC 0,731.
//!
//! Daarnaast het bijpunt: bij een trekstaaf hoort de druktoets geen
//! drukspanning te tonen en de kolomknik geen UC met de trek als druk.

use approx::assert_relative_eq;
use nen_en_1993_1_1_section::CheckStatus;
use serde_json::Value;
use steel_check::{CheckKind, NamedCheck};
use timber_check::{check_all_timber_beams, TimberBeamCheckInput, TimberBeamCheckResult};

const K3: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k3-check-timber-beams.json");

fn resultaten() -> Vec<TimberBeamCheckResult> {
    let v: Value = serde_json::from_str(K3).expect("geldige JSON");
    let inputs: Vec<TimberBeamCheckInput> =
        serde_json::from_value(v["arguments"]["inputs"].clone()).expect("TimberBeamCheckInput");
    check_all_timber_beams(inputs)
}

fn toets<'a>(r: &'a TimberBeamCheckResult, id: &str) -> &'a NamedCheck {
    r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt"))
}

fn uc(c: &NamedCheck) -> Option<f64> {
    match &c.kind {
        CheckKind::Resistance(r) => r.uc.as_ref().map(|u| u.uc),
        CheckKind::Stability(s) => s.uc.as_ref().map(|u| u.uc),
    }
}

fn status(c: &NamedCheck) -> CheckStatus {
    match &c.kind {
        CheckKind::Resistance(r) => r.status,
        CheckKind::Stability(s) => s.status,
    }
}

fn variabele(c: &NamedCheck, symbool: &str) -> f64 {
    let vars = match &c.kind {
        CheckKind::Resistance(r) => &r.variables,
        CheckKind::Stability(s) => &s.variables,
    };
    vars.iter().find(|v| v.symbol == symbool).unwrap_or_else(|| panic!("{symbool}")).value
}

#[test]
fn k3_trek_met_buiging_volgens_6_17() {
    let r = resultaten();
    assert_eq!(r.len(), 2);
    for (staaf, hand, voldoet) in [(&r[0], 0.54801, true), (&r[1], 1.09603, false)] {
        let t = toets(staaf, "6.2.3_bending_tension");
        assert_relative_eq!(uc(t).unwrap(), hand, max_relative = 1e-4);
        assert_relative_eq!(variabele(t, "(6.17)"), hand, max_relative = 1e-4);
        assert_relative_eq!(variabele(t, r"f_{t,0,d}"), 13.5168, max_relative = 1e-5);
        assert_relative_eq!(variabele(t, r"f_{m,y,d}"), 16.896, max_relative = 1e-5);
        assert_eq!(status(t), if voldoet { CheckStatus::Ok } else { CheckStatus::NotOk });
        assert_eq!(staaf.governing_check_id, "6.2.3_bending_tension");
        assert_relative_eq!(staaf.uc_max, hand, max_relative = 1e-4);
    }
    assert_eq!(r[0].status, CheckStatus::Ok);
    assert_eq!(r[1].status, CheckStatus::NotOk);
}

/// Een trekstaaf: de druktoets toont geen drukspanning en heeft geen UC; de
/// kolomknik heeft geen UC (tot oktober 2026: σ_c,0,d = de trekspanning, en
/// "kolomknik" UC 1,666 bij staaf 2); 6.2.4 (druk met buiging) is n.v.t.
#[test]
fn k3_trekstaaf_toont_geen_drukwaarden() {
    for staaf in resultaten() {
        let druk = toets(&staaf, "6.1.4_compression");
        assert_eq!(status(druk), CheckStatus::NotApplicable);
        assert!(uc(druk).is_none());
        assert_eq!(variabele(druk, r"N_{c,Ed}"), 0.0);
        let kolom = toets(&staaf, "6.3.2_column_stability");
        assert_eq!(status(kolom), CheckStatus::NotApplicable);
        assert!(uc(kolom).is_none());
        assert_eq!(variabele(kolom, r"\sigma_{c,0,d}"), 0.0);
        let bc = toets(&staaf, "6.2.4_bending_compression");
        assert_eq!(status(bc), CheckStatus::NotApplicable);
        assert!(uc(bc).is_none());
    }
}

/// (6.19)/(6.20): DRUK met buiging op doorsnedeniveau, via
/// `check_all_timber_beams` — staaf 1 van de controle met N = −40 kN (druk) in
/// plaats van +40 kN. Met de hand (GL24h, k_mod = 0,8, γ_M = 1,25; k_h geldt
/// niet voor druk):
///   f_c,0,d = 24·0,8/1,25 = 15,36 N/mm²; f_m,y,d = 16,896 N/mm² (k_h = 1,1)
///   σ_c,0,d = 40 000/16 200 = 2,46914; (σ_c/f_c)² = 0,160751² = 0,025841
///   σ_m,y,d = 6,17284;  σ_m/f_m = 0,365343
///   (6.19) = 0,025841 + 0,365343           = 0,391184 (maatgevend)
///   (6.20) = 0,025841 + 0,7·0,365343       = 0,281581
/// Met f_t,0,d (13,5168) in plaats van f_c,0,d kwam (6.19) op 0,398712 uit.
#[test]
fn k3_druk_met_buiging_volgens_6_19_en_6_20() {
    let v: Value = serde_json::from_str(K3).expect("geldige JSON");
    let mut inputs: Vec<TimberBeamCheckInput> =
        serde_json::from_value(v["arguments"]["inputs"].clone()).expect("TimberBeamCheckInput");
    inputs.truncate(1);
    for p in inputs[0].forces_envelope.iter_mut() {
        p.forces.n_ed = -40.0;
    }
    let r = &check_all_timber_beams(inputs)[0];
    let t = toets(r, "6.2.4_bending_compression");
    let f_c0d = 24.0 * 0.8 / 1.25;
    let f_myd = 1.1 * 24.0 * 0.8 / 1.25;
    let c = 40_000.0 / 16_200.0 / f_c0d;
    let y = 3.0e6 / 486_000.0 / f_myd;
    assert_relative_eq!(variabele(t, r"f_{c,0,d}"), f_c0d, max_relative = 1e-9);
    assert_relative_eq!(variabele(t, r"f_{c,0,d}"), 15.36, max_relative = 1e-9);
    assert_relative_eq!(variabele(t, r"f_{m,y,d}"), 16.896, max_relative = 1e-9);
    assert_relative_eq!(variabele(t, r"\sigma_{c,0,d}"), 2.46914, max_relative = 1e-5);
    assert_relative_eq!(variabele(t, "(6.19)"), c * c + y, max_relative = 1e-9);
    assert_relative_eq!(variabele(t, "(6.19)"), 0.391184, max_relative = 1e-5);
    assert_relative_eq!(variabele(t, "(6.20)"), c * c + 0.7 * y, max_relative = 1e-9);
    assert_relative_eq!(variabele(t, "(6.20)"), 0.281581, max_relative = 1e-5);
    assert_relative_eq!(uc(t).unwrap(), 0.391184, max_relative = 1e-5);
    assert_eq!(status(t), CheckStatus::Ok);
    // Bij druk is (6.17) niet van toepassing, zonder UC.
    let bt = toets(r, "6.2.3_bending_tension");
    assert_eq!(status(bt), CheckStatus::NotApplicable);
    assert!(uc(bt).is_none());
}
