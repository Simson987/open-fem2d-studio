//! Trek-alleen staven (`BeamCheckInput::tension_only`): windverbanden van
//! strip of rond staal die in de 3D-berekening alleen meedoen zolang ze op
//! trek staan.
//!
//! Wat hier bewaakt wordt:
//!  * met de vlag alleen 6.2.3 (de brutodoorsnede, en bij massief rond het
//!    draadeind), met de juiste unity check;
//!  * geen druk, buiging, dwarskracht, knik, kip, 6.3.3 of doorbuiging;
//!  * de grootste drukkracht staat als informatieve regel in het resultaat,
//!    met de tekst "trek-alleen staaf: drukkracht geldt als
//!    speling/voorspanning, niet getoetst";
//!  * een kleine druk duwt een slanke strip niet in klasse 4: de trek blijft
//!    getoetst;
//!  * zonder de vlag (of met `false`) verandert er niets.
//!
//! Alle getallen zijn met de hand uitgerekend; de afleiding staat bij de test.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::classification::CrossSectionClass;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

/// Een windverband van 6 m: combinatie 1 op trek (`trek_kn`), combinatie 2
/// met een kleine druk (`druk_kn`, negatief) en een moment uit het eigen
/// gewicht, elk op vijf punten.
fn windverband(naam: &str, trek_kn: f64, druk_kn: f64, tension_only: Option<bool>) -> BeamCheckInput {
    let mut envelop: Vec<ForcePoint> = Vec::new();
    for (c, n) in [(1, trek_kn), (2, druk_kn)] {
        for i in 0..5 {
            let x = 1500.0 * i as f64;
            // Eigen gewicht: een parabool met 0,05 kNm in het midden.
            let my = 0.05 * 4.0 * (x / 6000.0) * (1.0 - x / 6000.0);
            envelop.push(ForcePoint {
                combination_id: c,
                position_mm: x,
                forces: InternalForces { n_ed: n, my_ed: my, vz_ed: 0.01, ..Default::default() },
            });
        }
    }
    BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 4,
        profile_name: naam.to_string(),
        steel_grade: "S235".to_string(),
        length_m: 6.0,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing { top_flange_positions: vec![], bottom_flange_positions: vec![] },
        buckling_length_y_m: 0.0,
        buckling_length_z_m: 0.0,
        deflection_limit_class: DeflectionClass::Floor,
        deflection_limit_numerator: 333,
        deflection_actual_max_mm: 12.0,
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
        tension_only,
        a_net_mm2: None,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
    }
}

fn ids(r: &BeamCheckResult) -> Vec<&str> {
    r.checks.iter().map(|c| c.id.as_str()).collect()
}

fn weerstand<'a>(r: &'a BeamCheckResult, id: &str) -> &'a nen_en_1993_1_1_section::ResistanceCalc {
    match &r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} ontbreekt: {:?}", ids(r))).kind {
        CheckKind::Resistance(c) => c,
        CheckKind::Stability(_) => panic!("{id} is een stabiliteitstoets"),
    }
}

/// Strip 80x10 S235, 150 kN trek en 0,30 kN druk:
///   N_pl,Rd = 800·235/1,0 = 188,0 kN → UC = 150/188,0 = 0,797872
/// Alleen de trektoets en de informatieve drukregel; geen knik (N_cr van
/// deze strip om de zwakke as is maar enkele tientallen N), geen kip, geen
/// doorbuiging.
#[test]
fn strip_alleen_trek_met_de_juiste_uc() {
    let r = check_beam(windverband("Strip 80x10", 150.0, -0.3, Some(true)));
    assert_eq!(ids(&r), vec!["6.2.3_tension", TOETS_TREK_ALLEEN]);
    let trek = weerstand(&r, "6.2.3_tension");
    assert_relative_eq!(trek.value, 188.0, max_relative = 1e-12);
    assert_relative_eq!(trek.uc.as_ref().unwrap().uc, 150.0 / 188.0, max_relative = 1e-12);
    assert_eq!(trek.force_state.combination_id, 1);
    assert_eq!(r.governing_check_id, "6.2.3_tension");
    assert_relative_eq!(r.uc_max, 150.0 / 188.0, max_relative = 1e-12);
    assert_eq!(r.status, CheckStatus::Ok);
    assert_eq!(r.classification, CrossSectionClass::Class1);

    let info = weerstand(&r, TOETS_TREK_ALLEEN);
    assert_eq!(info.status, CheckStatus::NotApplicable);
    assert!(info.uc.is_none());
    assert_eq!(info.force_state.combination_id, 2);
    assert!(
        info.notes[0].contains("trek-alleen staaf: drukkracht geldt als speling/voorspanning, niet getoetst"),
        "{:?}",
        info.notes
    );
    assert!(info.notes[0].contains("N_Ed = -0,30 kN"), "{:?}", info.notes);
}

/// RD 24 S235, 80 kN trek en een kleine druk: de trektoets op de
/// brutodoorsnede (106,31 kN) én het draadeind (M24, A_s = 352,50 mm²,
/// 0,9·360·352,50/1,25 = 91,37 kN → UC = 80/91,37 = 0,87557, maatgevend).
#[test]
fn rond_staal_trek_en_draadeind() {
    let r = check_beam(windverband("RD 24", 80.0, -0.2, Some(true)));
    assert_eq!(ids(&r), vec!["6.2.3_tension", "6.2.3_threaded_end", TOETS_TREK_ALLEEN]);
    assert_relative_eq!(weerstand(&r, "6.2.3_tension").value, 106.311, max_relative = 1e-4);
    assert_relative_eq!(weerstand(&r, "6.2.3_threaded_end").value, 91.369, max_relative = 1e-4);
    assert_eq!(r.governing_check_id, "6.2.3_threaded_end");
    assert_relative_eq!(r.uc_max, 80.0 / 91.369, max_relative = 1e-4);
}

/// Strip 100x5: b/t = 20 > 14ε, dus bij druk klasse 4 — en een klasse-4-
/// doorsnede wordt niet getoetst. Als trek-alleen staaf telt die kleine druk
/// niet: de trek blijft getoetst. N_pl,Rd = 500·235 = 117,5 kN, UC bij
/// 100 kN = 0,851064.
#[test]
fn kleine_druk_maakt_een_slanke_strip_niet_ontoetsbaar() {
    let zonder = check_beam(windverband("Strip 100x5", 100.0, -0.5, None));
    assert_eq!(zonder.classification, CrossSectionClass::Class4);
    assert!(zonder.governing_check_id.starts_with("NIET TOETSBAAR"), "{}", zonder.governing_check_id);

    let met = check_beam(windverband("Strip 100x5", 100.0, -0.5, Some(true)));
    assert_eq!(met.classification, CrossSectionClass::Class1);
    assert_relative_eq!(met.uc_max, 100.0 / 117.5, max_relative = 1e-12);
    assert_eq!(met.governing_check_id, "6.2.3_tension");
}

/// Zonder druk in de omhullende zegt de informatieve regel dat ook.
#[test]
fn zonder_druk_zegt_de_regel_dat() {
    let r = check_beam(windverband("Strip 80x10", 150.0, 20.0, Some(true)));
    let info = weerstand(&r, TOETS_TREK_ALLEEN);
    assert!(info.notes[0].ends_with("De omhullende bevat geen drukkracht."), "{:?}", info.notes);
}

/// Zonder de vlag, of met `false`, verandert er niets: byte-gelijk aan de
/// toetsing zonder het veld.
#[test]
fn zonder_vlag_blijft_alles_zoals_het_was() {
    for naam in ["Strip 80x10", "RD 24", "HEA 200"] {
        let geen = serde_json::to_string(&check_beam(windverband(naam, 150.0, -0.3, None))).unwrap();
        let onwaar = serde_json::to_string(&check_beam(windverband(naam, 150.0, -0.3, Some(false)))).unwrap();
        assert_eq!(geen, onwaar, "{naam}");
        let r = check_beam(windverband(naam, 150.0, -0.3, None));
        assert!(ids(&r).contains(&"6.3.1_buckling"), "{naam}: {:?}", ids(&r));
        assert!(!ids(&r).contains(&TOETS_TREK_ALLEEN), "{naam}");
    }
}
