//! Issue #200, de kern: w_add van een houten uitkraging waarvan de punt onder
//! de blijvende last omhoog gaat en onder de veranderlijke omlaag.
//!
//! NEN-EN 1990:2002/NB:2019 figuur NB.1: w_add = w₂ + w₃, met w₂ het kruipdeel
//! en w₃ = w_c − w₁ de ogenblikkelijke zakking bovenop die onder de blijvende
//! belasting. Zonder `deflection_add_mm` neemt de kern w₃ = w_inst − w₁, met
//! w_inst de combinatie met de grootste |w| — en die hoort hier bij de
//! combinatie die het minst van de blijvende verschilt.
//!
//! HANDWAARDEN. Uitkraging L = 2000 mm, C24 100 × 200, klimaatklasse 1
//! (k_def = 0,6, tabel 3.2), noemers op de staaflengte 125 en 166,5 (ℓ_rep =
//! 2·L met L/250 en L/333). Zakkingen van de punt (mm, + = omhoog):
//!   G = +4,0; Q (sneeuw, ψ₂ = 0) = −10,0; W (wind omhoog, ψ₂ = 0) = +3,0.
//!   karakteristiek G + Q = −6,0; G + W = +7,0 → w_inst = +7,0 (grootste |w|)
//!   quasi-blijvend = G = +4,0 = w₁.
//!   w_fin = 7,0 + 0,6·4,0 = 9,4 → grens 2000/125 = 16 → UC 0,5875
//!   w₂ = 0,6·4,0 = 2,4
//!   ZONDER het veld: w_add = 9,4 − 4,0 = 5,4 → grens 2000/166,5 = 12,012 → UC 0,4496
//!   MET w₃ = (G + Q) − G = −10,0: w_add = 2,4 − 10,0 = −7,6 → UC 0,6327
//!   (de andere kandidaat, (G + W) − G = +3,0, geeft 2,4 + 3,0 = 5,4.)

use approx::assert_relative_eq;
use nen_en_1993_1_1_section::{CheckStatus, ResistanceCalc};
use serde_json::{json, Value};
use steel_check::CheckKind;
use timber_check::{check_timber_beam, TimberBeamCheckInput, TimberBeamCheckResult};

fn invoer(w3: Value) -> Value {
    let punt = |x: f64, vz: f64, my: f64| {
        json!({ "combination_id": 1, "position_mm": x,
                "forces": { "n_ed": 0.0, "vy_ed": 0.0, "vz_ed": vz, "mt_ed": 0.0, "my_ed": my, "mz_ed": 0.0 } })
    };
    json!({
        "beam_id": 2, "width_mm": 100.0, "height_mm": 200.0, "strength_class": "C24",
        "service_class": "Sc1", "load_duration": "MediumTerm", "length_m": 2.0,
        "forces_envelope": [punt(0.0, 4.0, -4.0), punt(2000.0, 0.0, 0.0)],
        "is_cantilever": true,
        "deflection_inst_mm": 7.0,
        "deflection_quasi_perm_mm": 4.0,
        "deflection_permanent_mm": 4.0,
        "deflection_limit_fin": 125.0,
        "deflection_limit_add": 166.5,
        "deflection_add_mm": w3
    })
}

fn toets(r: &TimberBeamCheckResult, id: &str) -> ResistanceCalc {
    match &r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} ontbreekt")).kind {
        CheckKind::Resistance(c) => c.clone(),
        CheckKind::Stability(_) => panic!("{id} is een weerstandstoets"),
    }
}

fn reken(v: Value) -> TimberBeamCheckResult {
    let i: TimberBeamCheckInput = serde_json::from_value(v).expect("geldige invoer");
    check_timber_beam(i)
}

#[test]
fn weglaten_en_null_zijn_het_gedrag_van_voor_het_veld() {
    let mut zonder = invoer(Value::Null);
    zonder.as_object_mut().unwrap().remove("deflection_add_mm");
    let a = reken(zonder);
    let b = reken(invoer(Value::Null));
    assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&b).unwrap());
    let add = toets(&a, "deflection_w_add");
    assert_relative_eq!(add.uc.as_ref().unwrap().ed, 5.4, max_relative = 1e-12);
    assert_relative_eq!(add.uc.as_ref().unwrap().uc, 5.4 / (2000.0 / 166.5), max_relative = 1e-12);
}

#[test]
fn w_add_uit_w3_per_combinatie_met_kruip() {
    let r = reken(invoer(json!(-10.0)));
    let fin = toets(&r, "deflection_w_fin");
    let add = toets(&r, "deflection_w_add");
    // w_fin verandert niet.
    assert_relative_eq!(fin.uc.as_ref().unwrap().ed, 9.4, max_relative = 1e-12);
    assert_relative_eq!(fin.uc.as_ref().unwrap().uc, 0.5875, max_relative = 1e-12);
    // w_add = w₂ + w₃ = 2,4 − 10,0 = −7,6 mm.
    let w = add.variables.iter().find(|v| v.symbol == "w").unwrap().value;
    assert_relative_eq!(w, -7.6, max_relative = 1e-12);
    assert_relative_eq!(add.uc.as_ref().unwrap().rd, 2000.0 / 166.5, max_relative = 1e-12);
    assert_relative_eq!(add.uc.as_ref().unwrap().uc, 7.6 / (2000.0 / 166.5), max_relative = 1e-12);
    assert_relative_eq!(add.uc.as_ref().unwrap().uc, 0.63273, max_relative = 1e-4);
    assert_eq!(add.status, CheckStatus::Ok);
    let w2 = add.variables.iter().find(|v| v.symbol == "w_{2}").unwrap().value;
    assert_relative_eq!(w2, 2.4, max_relative = 1e-12);
    assert!(add.formula_latex.contains("w_{2,z}"));
    assert!(
        add.notes.iter().any(|n| n.contains("PER BGT-COMBINATIE") && n.contains("-7,60") && n.contains("5,40")),
        "de herkomst van w₃ staat bij w_add: {:?}",
        add.notes
    );
}

#[test]
fn een_niet_eindige_w3_wordt_geweigerd() {
    let mut i: TimberBeamCheckInput = serde_json::from_value(invoer(Value::Null)).unwrap();
    i.deflection_add_mm = Some(f64::NAN);
    let r = check_timber_beam(i);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(r.checks.is_empty());
    assert!(r.governing_check_id.starts_with("ERROR: deflection_add_mm"), "{}", r.governing_check_id);
}
