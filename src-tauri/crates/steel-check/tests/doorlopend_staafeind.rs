//! Een DOORLOPEND staafeind en de status van de staaf (controle oktober 2026,
//! K6, issue #188).
//!
//! Loopt een staaf zonder oplegging door in een staaf met een andere
//! doorsnede, dan weigert de kern de kiptoets, en de kniktoets als niet
//! beide kniklengtes zijn opgegeven (zie `Staafeind`). Een geweigerde toets
//! telt als 0 in `uc_max`. Tot de controle stond de staaf dan op Ok, ook als
//! zij gedrukt was en 6.3.1 dus ontbrak: een kolom HEA160 van 6 m met
//! N_Ed = 300 kN en een veer op 3 m kwam zo van UC 1,162 NotOk op 0,329 Ok.
//! Nu is de status NotApplicable (niet volledig getoetst) zodra knik bij druk
//! of kip bij buiging ontbreekt; NotOk blijft NotOk.
//!
//! Review van de samenvoeging 2026.42: de reden staat in `governing_check_id`
//! achter NIET VOLLEDIG GETOETST (zoals bij de lijfplooi, B7), zodat ook een
//! VERLOPENDE staaf met een doorlopend eind niet meer op Ok komt; en rekenruis
//! (|N|, |M_y| ≤ 10⁻⁶) telt niet als druk of buiging.
//!
//! Handwaarden HEA160 S235: A = 3880 mm², N_pl,Rd = 3880·235 = 911,8 kN.

use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

fn staaf(n_ed: f64, my_ed: f64, kniklengte_m: f64, einden: Option<Staafeinden>) -> BeamCheckResult {
    staaf_van("HEA160", None, n_ed, my_ed, kniklengte_m, einden)
}

fn staaf_van(
    profiel: &str,
    eindprofiel: Option<&str>,
    n_ed: f64,
    my_ed: f64,
    kniklengte_m: f64,
    einden: Option<Staafeinden>,
) -> BeamCheckResult {
    let l_m = 3.0;
    let envelop: Vec<ForcePoint> = (0..11)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: l_m * 1000.0 * i as f64 / 10.0,
            forces: InternalForces { n_ed, my_ed, ..Default::default() },
        })
        .collect();
    check_beam(BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: profiel.to_string(),
        steel_grade: "S235".to_string(),
        length_m: l_m,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing { top_flange_positions: vec![], bottom_flange_positions: vec![] },
        buckling_length_y_m: kniklengte_m,
        buckling_length_z_m: kniklengte_m,
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
        staafeinden: einden,
        staaf_notities: None,
        profile_end: eindprofiel.map(|p| p.to_string()),
        custom_section_end: None,
        a_net_mm2: None,
        tension_only: None,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
    })
}

const DOORLOPEND: Option<Staafeinden> = Some(Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Doorlopend });

fn toetsstatus(r: &BeamCheckResult, id: &str) -> CheckStatus {
    match &r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt")).kind {
        CheckKind::Resistance(c) => c.status,
        CheckKind::Stability(c) => c.status,
    }
}

/// Gedrukt, geen kniklengtes: 6.3.1 geweigerd, dus niet volledig getoetst.
#[test]
fn gedrukt_zonder_kniklengtes_is_niet_ok_maar_niet_volledig() {
    let r = staaf(-300.0, 0.0, 0.0, DOORLOPEND);
    assert_eq!(toetsstatus(&r, "6.3.1_buckling"), CheckStatus::NotApplicable);
    assert!(r.uc_max < 1.0, "de rest van de toetsen blijft onder 1: {}", r.uc_max);
    assert!((r.uc_max - 300.0 / 911.8).abs() < 2e-3, "uc_max = N/N_pl,Rd: {}", r.uc_max);
    assert_eq!(r.status, CheckStatus::NotApplicable, "knik ontbreekt bij druk: geen Ok");
    // Ter vergelijking: zonder doorlopend eind wordt geknikt en is de staaf Ok.
    let gewoon = staaf(-300.0, 0.0, 0.0, None);
    assert_eq!(toetsstatus(&gewoon, "6.3.1_buckling"), CheckStatus::Ok);
    assert_eq!(gewoon.status, CheckStatus::Ok);
}

/// Met beide kniklengtes opgegeven wordt geknikt; zonder buiging mist er dan
/// niets (de kip is geweigerd, maar er is geen moment).
#[test]
fn met_kniklengtes_en_zonder_buiging_is_ok() {
    let r = staaf(-300.0, 0.0, 6.0, DOORLOPEND);
    assert_eq!(toetsstatus(&r, "6.3.1_buckling"), CheckStatus::NotOk, "HEA160 6 m, 300 kN: 6.3.1 UC 1,162");
    assert_eq!(r.status, CheckStatus::NotOk);
    let licht = staaf(-100.0, 0.0, 6.0, DOORLOPEND);
    assert_eq!(toetsstatus(&licht, "6.3.1_buckling"), CheckStatus::Ok);
    assert_eq!(toetsstatus(&licht, "6.3.2_ltb"), CheckStatus::NotApplicable);
    assert_eq!(licht.status, CheckStatus::Ok, "geen moment: de geweigerde kip mist niets");
}

/// Buiging met een doorlopend eind: de kip ontbreekt, dus niet volledig
/// getoetst — ook zonder druk.
#[test]
fn buiging_zonder_kip_is_niet_volledig() {
    let r = staaf(0.0, 10.0, 6.0, DOORLOPEND);
    assert_eq!(toetsstatus(&r, "6.3.2_ltb"), CheckStatus::NotApplicable);
    assert!(r.uc_max < 1.0);
    assert_eq!(r.status, CheckStatus::NotApplicable);
}

/// Een toets boven 1 blijft NotOk, ook als er een toets ontbreekt.
#[test]
fn boven_een_blijft_not_ok() {
    let r = staaf(-1000.0, 0.0, 0.0, DOORLOPEND);
    assert!(r.uc_max > 1.0, "N > N_pl,Rd: {}", r.uc_max);
    assert_eq!(r.status, CheckStatus::NotOk);
}

/// De reden staat in `governing_check_id`, achter NIET VOLLEDIG GETOETST —
/// zoals bij de geweigerde lijfplooi (B7). Een weergave toont dan de reden en
/// geen toets-id met een UC onder 1.
#[test]
fn de_reden_staat_in_governing_check_id() {
    let knik = staaf(-300.0, 0.0, 0.0, DOORLOPEND);
    assert!(
        knik.governing_check_id.starts_with("NIET VOLLEDIG GETOETST: de kolomknik (6.3.1) bij druk niet getoetst"),
        "{}",
        knik.governing_check_id
    );
    assert!(knik.governing_check_id.contains("het eind van de staaf (x = L)"), "{}", knik.governing_check_id);
    let kip = staaf(0.0, 10.0, 6.0, DOORLOPEND);
    assert!(
        kip.governing_check_id.starts_with("NIET VOLLEDIG GETOETST: de kip (6.3.2) bij buiging niet getoetst"),
        "{}",
        kip.governing_check_id
    );
    let beide = staaf(-100.0, 10.0, 0.0, DOORLOPEND);
    assert!(
        beide.governing_check_id.contains("de kolomknik (6.3.1) bij druk en de kip (6.3.2) bij buiging"),
        "{}",
        beide.governing_check_id
    );
    // NotOk houdt de maatgevende toets.
    assert_eq!(staaf(-1000.0, 0.0, 0.0, DOORLOPEND).governing_check_id, "6.2.4_compression");
}

/// Rekenruis is geen buiging en geen druk: een zuiver gedrukte staaf met
/// M = 6,6·10⁻¹⁸ kNm uit de solver (review samenvoeging 2026.42, proef H)
/// kreeg zo "niet volledig getoetst" terwijl er niets te kippen valt.
#[test]
fn rekenruis_telt_niet_als_buiging_of_druk() {
    let ruis_m = staaf(-100.0, 6.611e-18, 6.0, DOORLOPEND);
    assert_eq!(toetsstatus(&ruis_m, "6.3.1_buckling"), CheckStatus::Ok);
    assert_eq!(ruis_m.status, CheckStatus::Ok, "M = 6,6·10⁻¹⁸ kNm is geen buiging");
    let ruis_n = staaf(-1e-12, 0.0, 0.0, DOORLOPEND);
    assert_eq!(ruis_n.status, CheckStatus::Ok, "N = −10⁻¹² kN is geen druk");
    // Een echt (klein) moment telt wel.
    let klein = staaf(-100.0, 1e-3, 6.0, DOORLOPEND);
    assert_eq!(klein.status, CheckStatus::NotApplicable, "M = 0,001 kNm is buiging");
}

/// Een VERLOPENDE staaf met een doorlopend eind: de kern toetst haar per
/// rekenpunt met `check_beam`, en `verlopend.rs` gaf de status n.v.t. alleen
/// door bij NIET VOLLEDIG GETOETST in `governing_check_id`. Zonder dat
/// voorvoegsel kwam een gedrukte kolom IPE 300 → IPE 200 met geweigerde knik
/// en kip op Ok (review samenvoeging 2026.42, proef D: N_Ed = 405 kN, uc_max
/// 0,632). IPE 200 om z over 6 m kan dat niet dragen (N_b,z ≈ 73 kN).
#[test]
fn verlopende_staaf_met_doorlopend_eind_is_niet_volledig() {
    let r = staaf_van("IPE300", Some("IPE200"), -405.0, 0.0, 0.0, DOORLOPEND);
    assert!(r.verloop.is_some(), "de staaf hoort als verlopend getoetst te zijn");
    assert_eq!(toetsstatus(&r, "6.3.1_buckling"), CheckStatus::NotApplicable);
    assert!(r.uc_max < 1.0, "de gerekende toetsen blijven onder 1: {}", r.uc_max);
    assert_eq!(r.status, CheckStatus::NotApplicable, "knik ontbreekt bij druk: geen Ok");
    assert!(r.governing_check_id.starts_with("NIET VOLLEDIG GETOETST"), "{}", r.governing_check_id);
    // Ter vergelijking: met gaffels aan beide einden wordt geknikt.
    let gewoon = staaf_van("IPE300", Some("IPE200"), -405.0, 0.0, 0.0, None);
    assert_ne!(toetsstatus(&gewoon, "6.3.1_buckling"), CheckStatus::NotApplicable);
    assert_ne!(gewoon.status, CheckStatus::NotApplicable);
}
