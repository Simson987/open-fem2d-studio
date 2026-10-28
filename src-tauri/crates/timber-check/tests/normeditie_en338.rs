//! Issue #243, punt 074: de toets noemt de EDITIE van EN 338.
//!
//! C24 140 × 140 mm, klimaatklasse 1, middellang (k_mod = 0,8), γ_M = 1,3,
//! L = 0,5 m, kip uit, N = −150 kN (druk), M_y = 2 kNm. Met de hand:
//!   k_h = min((150/140)^0,2; 1,3) = 1,013894
//!   f_t,0,d = k_h·f_t,0,k·k_mod/γ_M = 1,013894·14,0·0,8/1,3 = 8,7351 N/mm²
//! f_t,0,k = 14,0 is EN 338:2009 tabel 1; EN 338:2016 geeft 14,5 (→ 9,047).
//! De waarde blijft 14,0 (veilig, door de controle verdedigbaar genoemd);
//! nieuw is dat de uitvoer de editie vermeldt.

use approx::assert_relative_eq;
use serde_json::json;
use steel_check::CheckKind;
use timber_check::{check_all_timber_beams, TimberBeamCheckInput};

#[test]
fn trektoets_noemt_en_338_2009_en_rekent_met_14_0() {
    let punt = |x: f64| {
        json!({"combination_id": 1, "position_mm": x,
               "forces": {"n_ed": -150.0, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0,
                          "my_ed": 2.0, "mz_ed": 0.0}})
    };
    let input: TimberBeamCheckInput = serde_json::from_value(json!({
        "beam_id": 1, "width_mm": 140, "height_mm": 140, "strength_class": "C24",
        "service_class": "Sc1", "load_duration": "MediumTerm", "length_m": 0.5,
        "perform_ltb_check": false,
        "forces_envelope": [punt(0.0), punt(250.0), punt(500.0)]
    }))
    .expect("TimberBeamCheckInput");
    let r = &check_all_timber_beams(vec![input])[0];
    let trek = r.checks.iter().find(|c| c.id == "6.1.2_tension").expect("6.1.2");
    let CheckKind::Resistance(t) = &trek.kind else { panic!("weerstandstoets") };
    let f_t0d = t.variables.iter().find(|v| v.symbol == r"f_{t,0,d}").unwrap().value;
    let k_h = (150.0_f64 / 140.0).powf(0.2);
    assert_relative_eq!(f_t0d, k_h * 14.0 * 0.8 / 1.3, max_relative = 1e-9);
    assert_relative_eq!(f_t0d, 8.7351, max_relative = 1e-4);
    assert!(
        t.notes.iter().any(|n| n.contains("EN 338:2009") && n.contains("f_t,0,k = 14.0")),
        "editie EN 338 ontbreekt in de notities: {:?}",
        t.notes
    );
    // Ook de andere doorsnedetoetsen van §6.1 dragen de bron.
    for id in ["6.1.4_compression", "6.1.6_bending", "6.1.7_shear"] {
        let c = r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id}"));
        let CheckKind::Resistance(c) = &c.kind else { panic!("{id}") };
        assert!(c.notes.iter().any(|n| n.contains("EN 338:2009")), "{id}: {:?}", c.notes);
    }
}

#[test]
fn gelamineerd_hout_noemt_en_14080_2013() {
    let c = nen_en_1995_1_1::strength_class_by_name("GL24h").unwrap();
    assert_eq!(c.bron(), "EN 14080:2013 tabel 5");
    assert_eq!(nen_en_1995_1_1::strength_class_by_name("C24").unwrap().bron(), "EN 338:2009 tabel 1");
}
