//! Issue #205: een houten staaf met een DOORLOPEND staafeind — een getrapte
//! kolom.
//!
//! Het geval: een kolom van 6 m, onder 3 m C24 120 × 120 en daarboven 3 m C24
//! 100 × 100, zonder steun op de overgang. De invoerbouwer toetst elk deel als
//! eigen staaf; het onderste deel heeft aan zijn eind (x = L) een `Doorlopend`
//! eind. Tot dit issue kende de houtkern alleen een vrij eind, en kreeg het deel
//! L_cr = 3000 mm: de lengte van één deel, alsof de overgang zijdelings
//! gesteund is.
//!
//! Handwaarden C24 120 × 120 (A = 14 400 mm², i = 34,641 mm), N_Ed = 15 kN
//! druk, k_mod = 0,8 (middellang, klimaatklasse 1), γ_M = 1,3:
//!   f_c,0,d = 0,8·21/1,3 = 12,923 N/mm²; σ_c,0,d = 15 000/14 400 = 1,0417 N/mm²
//!   L_cr = 3000 (de oude terugval): λ_rel = 3000/34,641/π·√(21/7400) = 1,4685
//!     → k_c = 0,3934 → UC (6.23) = 1,0417/(0,3934·12,923) = 0,2049
//!   L_cr = 6000 (opgegeven, de hele kolom): λ_rel = 2,9370 → k_c = 0,10849
//!     → UC = 1,0417/(0,10849·12,923) = 0,7430

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1993_1_1_stability::StabilityCalc;
use nen_en_1995_1_1::stability::{LtbLoadCase, LtbLoadPosition};
use nen_en_1995_1_1::{LoadDurationClass, ServiceClass};
use steel_check::{Staafeind, Staafeinden, NIET_VOLLEDIG_GETOETST};
use timber_check::*;

const L_MM: f64 = 3000.0;
const F_C0K: f64 = 21.0;
const E_005: f64 = 7400.0;
const BETA_C: f64 = 0.2;

fn invoer(n_kn: f64, my_knm: f64, staafeinden: Option<Staafeinden>) -> TimberBeamCheckInput {
    let envelop = (0..=10)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: L_MM * i as f64 / 10.0,
            forces: InternalForces { n_ed: -n_kn, my_ed: my_knm, ..Default::default() },
        })
        .collect();
    TimberBeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        width_mm: 120.0,
        height_mm: 120.0,
        custom_section: None,
        strength_class: "C24".to_string(),
        service_class: ServiceClass::Sc1,
        load_duration: LoadDurationClass::MediumTerm,
        load_duration_per_combination: vec![],
        length_m: L_MM / 1000.0,
        forces_envelope: envelop,
        buckling_length_y_m: 0.0,
        buckling_length_z_m: 0.0,
        ruimtelijk: true,
        is_cantilever: false,
        staafeinden,
        lateral_bracing: None,
        ltb_segment_length_m: 0.0,
        ltb_load_case: Some(LtbLoadCase::UniformLoad),
        ltb_load_position: LtbLoadPosition::CentreOfGravity,
        ltb_effective_length_override_m: 0.0,
        perform_ltb_check: true,
        k_cr: 1.0,
        load_sharing: false,
        deflection_inst_mm: 0.0,
        deflection_quasi_perm_mm: 0.0,
        deflection_permanent_mm: 0.0,
        deflection_limit_fin: 250.0,
        deflection_limit_add: 333.0,
        deflection_notes: vec![],
        deflection_quasi_perm_fin_mm: None,
        deflection_add_mm: None,
        deflection_not_applicable_reason: None,
        staaf_notities: None,
        width_end_mm: None,
        height_end_mm: None,
        zijdelingse_knik_in_analyse: None,
        schuine_rand: None,
        pre_camber_mm: None,
    }
}

const DOORLOPEND_BOVEN: Option<Staafeinden> =
    Some(Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Doorlopend });

fn stabiliteit<'a>(r: &'a TimberBeamCheckResult, id: &str) -> &'a StabilityCalc {
    let c = r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} ontbreekt"));
    let CheckKind::Stability(s) = &c.kind else { panic!("{id} is een stabiliteitstoets") };
    s
}

/// k_c met de hand: (6.21)–(6.28).
fn k_c(l_cr_mm: f64) -> f64 {
    let i = 120.0 / 12.0_f64.sqrt();
    let lambda_rel = l_cr_mm / i / std::f64::consts::PI * (F_C0K / E_005).sqrt();
    let k = 0.5 * (1.0 + BETA_C * (lambda_rel - 0.3) + lambda_rel * lambda_rel);
    (1.0 / (k + (k * k - lambda_rel * lambda_rel).sqrt())).min(1.0)
}

fn uc_6_23(l_cr_mm: f64) -> f64 {
    let f_c0d = 0.8 * F_C0K / 1.3;
    (15_000.0 / 14_400.0) / (k_c(l_cr_mm) * f_c0d)
}

#[test]
fn handwaarden_kloppen() {
    assert_relative_eq!(k_c(3000.0), 0.3934, max_relative = 5e-4);
    assert_relative_eq!(k_c(6000.0), 0.10849, max_relative = 5e-4);
    assert_relative_eq!(uc_6_23(3000.0), 0.2049, max_relative = 5e-4);
    assert_relative_eq!(uc_6_23(6000.0), 0.7430, max_relative = 5e-4);
}

#[test]
fn zonder_veld_of_met_twee_gaffels_verandert_er_niets() {
    let a = check_timber_beam(invoer(15.0, 0.0, None));
    let b = check_timber_beam(invoer(
        15.0,
        0.0,
        Some(Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Gaffel }),
    ));
    assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&b).unwrap());
    // De oude terugval: L_cr = 3000, UC 0,2049, status Ok.
    let s = stabiliteit(&a, "6.3.2_column_stability");
    assert_relative_eq!(s.uc.as_ref().unwrap().uc, uc_6_23(3000.0), max_relative = 1e-4);
    assert_eq!(a.status, CheckStatus::Ok);
}

#[test]
fn doorlopend_zonder_kniklengtes_weigert_6_3_2_en_6_3_3() {
    let r = check_timber_beam(invoer(15.0, 0.0, DOORLOPEND_BOVEN));
    let knik = stabiliteit(&r, "6.3.2_column_stability");
    assert_eq!(knik.status, CheckStatus::NotApplicable);
    assert!(knik.uc.is_none(), "een geweigerde toets heeft geen UC");
    assert!(
        knik.notes.iter().any(|n| n.contains("het eind van de staaf (x = L)") && n.contains("L_cr,y én L_cr,z")),
        "{:?}",
        knik.notes
    );
    let kip = stabiliteit(&r, "6.3.3_beam_stability");
    assert_eq!(kip.status, CheckStatus::NotApplicable);
    assert!(kip.uc.is_none());
    assert!(kip.notes.iter().any(|n| n.contains("kipsteunafstand")), "{:?}", kip.notes);
    // Druk zonder kolomtoets: niet volledig getoetst, nooit Ok.
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.governing_check_id.starts_with(NIET_VOLLEDIG_GETOETST), "{}", r.governing_check_id);
    assert!(r.governing_check_id.contains("kolomknik (art. 6.3.2) bij druk"));
    // Zonder buiging ontbreekt de kiptoets niet als onderdeel van de status.
    assert!(!r.governing_check_id.contains("6.3.3"));
}

#[test]
fn doorlopend_met_kniklengtes_toetst_6_3_2_met_de_opgave() {
    let mut i = invoer(15.0, 0.0, DOORLOPEND_BOVEN);
    i.buckling_length_y_m = 6.0;
    i.buckling_length_z_m = 6.0;
    let r = check_timber_beam(i);
    let knik = stabiliteit(&r, "6.3.2_column_stability");
    assert_eq!(knik.status, CheckStatus::Ok);
    assert_relative_eq!(knik.uc.as_ref().unwrap().uc, uc_6_23(6000.0), max_relative = 1e-4);
    // Kip blijft geweigerd zonder kipsteunafstand, maar zonder buiging telt dat
    // niet: de staaf is volledig getoetst.
    assert_eq!(stabiliteit(&r, "6.3.3_beam_stability").status, CheckStatus::NotApplicable);
    assert_eq!(r.status, CheckStatus::Ok);
    assert!(!r.governing_check_id.starts_with(NIET_VOLLEDIG_GETOETST));
}

#[test]
fn doorlopend_met_buiging_en_zonder_kipsteunafstand_is_niet_volledig() {
    let mut i = invoer(15.0, 0.5, DOORLOPEND_BOVEN);
    i.buckling_length_y_m = 6.0;
    i.buckling_length_z_m = 6.0;
    let r = check_timber_beam(i.clone());
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.governing_check_id.contains("de kip (art. 6.3.3) bij buiging"), "{}", r.governing_check_id);
    assert!(!r.governing_check_id.contains("6.3.2"));
    // Met een kipsteunafstand wordt ook kip getoetst.
    i.ltb_segment_length_m = 6.0;
    let r = check_timber_beam(i);
    let kip = stabiliteit(&r, "6.3.3_beam_stability");
    assert!(kip.uc.is_some(), "kip getoetst: {:?}", kip.notes);
    assert_ne!(r.status, CheckStatus::NotApplicable);
}

#[test]
fn not_ok_blijft_not_ok_en_trek_blijft_ok() {
    // 400 kN druk: σ = 27,8 N/mm² > f_c,0,d = 12,9 → 6.1.4 boven 1.
    let r = check_timber_beam(invoer(400.0, 0.0, DOORLOPEND_BOVEN));
    assert_eq!(r.status, CheckStatus::NotOk);
    // Trek: geen druk, dus de ontbrekende kolomtoets laat niets open.
    let r = check_timber_beam(invoer(-15.0, 0.0, DOORLOPEND_BOVEN));
    assert_eq!(stabiliteit(&r, "6.3.2_column_stability").status, CheckStatus::NotApplicable);
    assert_eq!(r.status, CheckStatus::Ok);
}

#[test]
fn een_verlopende_staaf_met_een_doorlopend_eind_is_niet_volledig_getoetst() {
    let mut i = invoer(15.0, 0.0, DOORLOPEND_BOVEN);
    i.width_end_mm = Some(100.0);
    i.height_end_mm = Some(100.0);
    let r = check_timber_beam(i);
    assert!(r.verloop.is_some());
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.governing_check_id.starts_with(NIET_VOLLEDIG_GETOETST), "{}", r.governing_check_id);
}

#[test]
fn een_vrij_eind_in_staafeinden_werkt_als_is_cantilever() {
    let vlag = {
        let mut i = invoer(15.0, 0.0, None);
        i.is_cantilever = true;
        check_timber_beam(i)
    };
    let einden = check_timber_beam(invoer(
        15.0,
        0.0,
        Some(Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Vrij }),
    ));
    assert_relative_eq!(
        stabiliteit(&vlag, "6.3.2_column_stability").uc.as_ref().unwrap().uc,
        stabiliteit(&einden, "6.3.2_column_stability").uc.as_ref().unwrap().uc,
        max_relative = 1e-12
    );
    assert_relative_eq!(
        stabiliteit(&einden, "6.3.2_column_stability").uc.as_ref().unwrap().uc,
        uc_6_23(6000.0),
        max_relative = 1e-4
    );
}
