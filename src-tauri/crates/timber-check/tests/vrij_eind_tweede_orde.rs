//! Een VRIJ staafeind bij hout, en de tweede-orde-berekening met scheefstand.
//!
//! Tot oktober 2026 zette de 2D-invoerbouwer `is_cantilever` hard op `false`:
//! een vrijstaande houten kolom kreeg L_cr = L, een viermaal te hoge kritieke
//! kracht. Nu volgt de vlag het vrije eind, en geldt zonder opgegeven
//! kniklengte 2·L — tenzij de zijdelingse uitbuiging om die as al in een
//! tweede-orde-berekening met scheefstand zit (`zijdelingse_knik_in_analyse`):
//! dan de staaflengte, op dezelfde grondslag als NEN-EN 1993-1-1 5.2.2(7)b.
//!
//! Handwaarden C24 100 × 160, L = 2000 mm, N_Ed = 20 kN druk; f_c,0,k = 21,
//! E_0,05 = 7400 N/mm², β_c = 0,2, k_mod = 0,8, γ_M = 1,3, dus
//! f_c,0,d = 12,923 N/mm² en σ_c,0,d = 1,25 N/mm²; i_y = 46,188 mm,
//! i_z = 28,868 mm.
//!
//! | geval                       | L_cr,y | L_cr,z | k_c,y  | k_c,z  | (6.24) |
//! |-----------------------------|--------|--------|--------|--------|--------|
//! | eerste orde (veld weg)      | 4000   | 4000   | 0,3934 | 0,1663 | 0,5816 |
//! | 2D, 2e orde + scheefstand   | 2000   | 4000   | 0,8606 | 0,1663 | 0,5816 |
//! | 3D, 2e orde + scheefstand   | 2000   | 2000   | 0,8606 | 0,5619 | 0,1721 |
//!
//! Bijvoorbeeld om y bij 2·L: λ_y = 4000/46,188 = 86,60; λ_rel,y = 86,60/π·√(21/7400)
//! = 1,4685; k_y = 0,5·(1 + 0,2·(1,4685 − 0,3) + 1,4685²) = 1,6951;
//! k_c,y = 1/(1,6951 + √(1,6951² − 1,4685²)) = 0,3934.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1993_1_1_stability::kniklengte::{
    HERKOMST_STAAFLENGTE, HERKOMST_VRIJ_EIND, HERKOMST_VRIJ_EIND_TWEEDE_ORDE,
};
use nen_en_1993_1_1_stability::{Deelstap, StabilityCalc};
use nen_en_1995_1_1::stability::{LtbLoadCase, LtbLoadPosition};
use nen_en_1995_1_1::{LoadDurationClass, ServiceClass};
use steel_check::ZijdelingseKnikInAnalyse;
use timber_check::*;

const B: f64 = 100.0;
const H: f64 = 160.0;
const L_MM: f64 = 2000.0;
const N_KN: f64 = 20.0;
const F_C0K: f64 = 21.0;
const E_005: f64 = 7400.0;
const BETA_C: f64 = 0.2;

fn kolom(is_cantilever: bool, zijdelings: Option<ZijdelingseKnikInAnalyse>) -> TimberBeamCheckResult {
    let envelop = (0..=10)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: L_MM * i as f64 / 10.0,
            forces: InternalForces { n_ed: -N_KN, ..Default::default() },
        })
        .collect();
    check_timber_beam(TimberBeamCheckInput {
        ruimtelijk: false,
        is_cantilever,
        deflection_not_applicable_reason: None,
        bijlage: Default::default(),
        beam_id: 1,
        width_mm: B,
        height_mm: H,
        custom_section: None,
        strength_class: "C24".to_string(),
        service_class: ServiceClass::Sc1,
        load_duration: LoadDurationClass::MediumTerm,
        load_duration_per_combination: vec![],
        length_m: L_MM / 1000.0,
        forces_envelope: envelop,
        buckling_length_y_m: 0.0,
        buckling_length_z_m: 0.0,
        lateral_bracing: None,
        ltb_segment_length_m: 0.0,
        ltb_load_case: Some(LtbLoadCase::UniformLoad),
        ltb_load_position: LtbLoadPosition::CentreOfGravity,
        ltb_effective_length_override_m: 0.0,
        perform_ltb_check: false,
        k_cr: 1.0,
        load_sharing: false,
        deflection_inst_mm: 0.0,
        deflection_quasi_perm_mm: 0.0,
        deflection_permanent_mm: 0.0,
        deflection_limit_fin: 250.0,
        deflection_limit_add: 333.0,
        deflection_notes: vec![],
        deflection_quasi_perm_fin_mm: None,
        staaf_notities: None,
        width_end_mm: None,
        height_end_mm: None,
        schuine_rand: None,
        zijdelingse_knik_in_analyse: zijdelings,
    })
}

fn kolomtoets(r: &TimberBeamCheckResult) -> &StabilityCalc {
    let c = r.checks.iter().find(|c| c.id == "6.3.2_column_stability").expect("6.3.2 ontbreekt");
    let CheckKind::Stability(s) = &c.kind else { panic!("6.3.2 is een stabiliteitstoets") };
    s
}

fn stap<'a>(s: &'a StabilityCalc, id: &str) -> &'a Deelstap {
    s.deelstappen.iter().find(|d| d.id == id).unwrap_or_else(|| {
        panic!(
            "stap {id} ontbreekt; wel aanwezig: {:?}",
            s.deelstappen.iter().map(|d| d.id.as_str()).collect::<Vec<_>>()
        )
    })
}

fn waarde(s: &StabilityCalc, id: &str) -> f64 {
    stap(s, id).value.unwrap_or_else(|| panic!("stap {id} heeft geen uitkomst"))
}

/// k_c met de hand: λ = L_cr/i, λ_rel (6.21)/(6.22), k (6.27)/(6.28),
/// k_c (6.25)/(6.26).
fn k_c(l_cr_mm: f64, i_mm: f64) -> f64 {
    let lambda_rel = l_cr_mm / i_mm / std::f64::consts::PI * (F_C0K / E_005).sqrt();
    let k = 0.5 * (1.0 + BETA_C * (lambda_rel - 0.3) + lambda_rel * lambda_rel);
    (1.0 / (k + (k * k - lambda_rel * lambda_rel).sqrt())).min(1.0)
}

fn i_y() -> f64 {
    H / 12.0_f64.sqrt()
}

fn i_z() -> f64 {
    B / 12.0_f64.sqrt()
}

/// (6.24) met de hand: σ_c,0,d / (k_c,z · f_c,0,d).
fn vergelijking(k_c: f64) -> f64 {
    let f_c0d = 0.8 * F_C0K / 1.3;
    let sigma = N_KN * 1e3 / (B * H);
    sigma / (k_c * f_c0d)
}

#[test]
fn de_handwaarden_zelf() {
    assert_relative_eq!(k_c(4000.0, i_y()), 0.3934, max_relative = 3e-4);
    assert_relative_eq!(k_c(4000.0, i_z()), 0.1663, max_relative = 3e-4);
    assert_relative_eq!(k_c(2000.0, i_y()), 0.8606, max_relative = 3e-4);
    assert_relative_eq!(k_c(2000.0, i_z()), 0.5619, max_relative = 3e-4);
    assert_relative_eq!(vergelijking(k_c(4000.0, i_z())), 0.5816, max_relative = 5e-4);
    assert_relative_eq!(vergelijking(k_c(2000.0, i_z())), 0.1721, max_relative = 5e-4);
}

/// Een vrij eind zonder opgave van de berekening: 2·L om beide assen.
#[test]
fn vrij_eind_in_eerste_orde_geeft_twee_l() {
    let s_r = kolom(true, None);
    let s = kolomtoets(&s_r);
    assert_eq!(waarde(s, "l_cr_y"), 4000.0);
    assert_eq!(waarde(s, "l_cr_z"), 4000.0);
    assert_eq!(stap(s, "l_cr_y").notes[0], format!("Herkomst: {HERKOMST_VRIJ_EIND}."));
    assert!(stap(s, "l_cr_y").notes.iter().any(|n| n.contains("een van de staafeinden is VRIJ")));
    assert_relative_eq!(waarde(s, "k_c_y"), k_c(4000.0, i_y()), max_relative = 1e-9);
    assert_relative_eq!(waarde(s, "k_c_z"), k_c(4000.0, i_z()), max_relative = 1e-9);
    assert_relative_eq!(s.uc.as_ref().unwrap().uc, vergelijking(k_c(4000.0, i_z())), max_relative = 1e-9);
}

/// 2D in tweede orde met scheefstand: om y de staaflengte, om z (uit het vlak)
/// 2·L. Hier blijft z maatgevend, met dezelfde UC.
#[test]
fn vlak_model_in_tweede_orde_geeft_l_om_y() {
    let r = kolom(true, Some(ZijdelingseKnikInAnalyse { y: true, z: false }));
    let s = kolomtoets(&r);
    assert_eq!(waarde(s, "l_cr_y"), 2000.0);
    assert_eq!(waarde(s, "l_cr_z"), 4000.0);
    assert_eq!(stap(s, "l_cr_y").notes[0], format!("Herkomst: {HERKOMST_VRIJ_EIND_TWEEDE_ORDE}."));
    assert!(stap(s, "l_cr_y").notes.iter().any(|n| n.contains("NEN-EN 1995-1-1 5.4.4")));
    assert_relative_eq!(waarde(s, "k_c_y"), k_c(2000.0, i_y()), max_relative = 1e-9);
    assert_relative_eq!(s.uc.as_ref().unwrap().uc, vergelijking(k_c(4000.0, i_z())), max_relative = 1e-9);
}

/// 3D in tweede orde met scheefstand in X en Y: om beide assen de staaflengte.
#[test]
fn ruimtelijk_model_in_tweede_orde_geeft_l_om_beide_assen() {
    let r = kolom(true, Some(ZijdelingseKnikInAnalyse { y: true, z: true }));
    let s = kolomtoets(&r);
    assert_eq!(waarde(s, "l_cr_y"), 2000.0);
    assert_eq!(waarde(s, "l_cr_z"), 2000.0);
    assert_relative_eq!(s.uc.as_ref().unwrap().uc, vergelijking(k_c(2000.0, i_z())), max_relative = 1e-9);
}

/// Zonder vrij eind doet het veld niets: de staaflengte, zoals altijd.
#[test]
fn zonder_vrij_eind_de_staaflengte() {
    let r = kolom(false, Some(ZijdelingseKnikInAnalyse { y: true, z: true }));
    let s = kolomtoets(&r);
    assert_eq!(waarde(s, "l_cr_y"), 2000.0);
    assert_eq!(stap(s, "l_cr_y").notes[0], format!("Herkomst: {HERKOMST_STAAFLENGTE}."));
}
