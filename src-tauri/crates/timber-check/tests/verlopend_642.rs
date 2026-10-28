//! Issue #253: verlopende houten ligger, toets art. 6.4.2 aan de schuine rand.
//!
//! ── DE HANDBEREKENING (controle 2026-10-26, deel 5b) ───────────────────────
//! C24, b = 100 mm, h lineair 600 → 200 mm, L = 4,0 m, vrij opgelegd,
//! q_d = 8 kN/m, k_mod = 0,6 (blijvend, klimaatklasse 1), γ_M = 1,3, kip uit.
//!   M(x) = q·x·(L − x)/2;   h(x) = 600 − 400·x/L;   tan α = 400/4000 = 0,10
//!   σ_m(x) = 6·M/(b·h²): grootst op x = 3000 mm (h = 300): M = 12 kNm,
//!   σ = 12·10⁶/(100·300²/6) = 8,00 N/mm²
//!   f_m,d = 0,6·24/1,3 = 11,077 N/mm²   →   UC 6.1.6 = 0,722
//! 6.4.2, f_m,d/f_v,d = 24/4 = 6, f_m,d/f_t,90,d = 60, f_m,d/f_c,90,d = 9,6:
//!   (6.39) k_m,α = 1/√(1 + (6/0,75·0,1)² + (60·0,01)²) = 1/√2 = 0,7071
//!          UC = 8,00/(0,7071·11,077) = 1,021 → voldoet NIET
//!   (6.40) k_m,α = 1/√(1 + (6/1,5·0,1)² + (9,6·0,01)²) = 0,9247
//!          UC = 8,00/(0,9247·11,077) = 0,781
//! Overal is k_h = 1,0 (h ≥ 150 mm) en is k_m,α constant langs de staaf, dus
//! het maximum van 6.4.2 ligt op hetzelfde punt als dat van 6.1.6.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1995_1_1::afgeschuind::SchuineRand;
use nen_en_1995_1_1::{LoadDurationClass, ServiceClass};
use steel_check::CheckKind;
use timber_check::{check_timber_beam, TimberBeamCheckInput, TimberBeamCheckResult};

fn ligger(h_eind: Option<f64>, rand: Option<SchuineRand>, my_teken: f64) -> TimberBeamCheckInput {
    let l = 4000.0;
    let q = 8.0;
    let punten = (0..=400)
        .map(|i| {
            let x = l * i as f64 / 400.0;
            let xm = x / 1000.0;
            ForcePoint {
                combination_id: 1,
                position_mm: x,
                forces: InternalForces {
                    my_ed: my_teken * q * xm * (4.0 - xm) / 2.0,
                    vz_ed: q * (2.0 - xm),
                    ..Default::default()
                },
            }
        })
        .collect();
    serde_json::from_value::<TimberBeamCheckInput>(serde_json::json!({
        "beam_id": 1, "width_mm": 100.0, "height_mm": 600.0,
        "strength_class": "C24", "service_class": "Sc1", "load_duration": "Permanent",
        "length_m": 4.0, "forces_envelope": [], "perform_ltb_check": false,
    }))
    .map(|mut i| {
        i.forces_envelope = punten;
        i.height_end_mm = h_eind;
        i.schuine_rand = rand;
        i
    })
    .unwrap()
}

fn toets<'a>(r: &'a TimberBeamCheckResult, id: &str) -> &'a nen_en_1993_1_1_section::ResistanceCalc {
    match &r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("{id} ontbreekt")).kind {
        CheckKind::Resistance(x) => x,
        CheckKind::Stability(_) => panic!("{id} is geen doorsnedetoets"),
    }
}

#[test]
fn schuine_rand_op_trek_is_de_ongunstigste_aanname_zonder_opgave() {
    let r = check_timber_beam(ligger(Some(200.0), None, 1.0));
    let buig = toets(&r, "6.1.6_bending");
    assert_relative_eq!(buig.uc.as_ref().unwrap().uc, 8.0 / (0.6 * 24.0 / 1.3), max_relative = 1e-9);
    assert_relative_eq!(buig.force_state.position_mm, 3000.0);
    let t = toets(&r, "6.4.2_tapered_edge");
    let k = t.variables.iter().find(|v| v.symbol == r"k_{m,\alpha}").unwrap().value;
    assert_relative_eq!(k, 1.0 / 2f64.sqrt(), max_relative = 1e-12);
    assert_relative_eq!(t.uc.as_ref().unwrap().uc, 1.02138, max_relative = 1e-5);
    assert_relative_eq!(t.force_state.position_mm, 3000.0);
    assert!(t.article.contains("(6.39)"));
    assert!(t.notes.iter().any(|n| n.contains("ONGUNSTIGSTE")));
    // Geen onterecht Ok meer: de staaf voldoet niet, en 6.4.2 is maatgevend.
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "6.4.2_tapered_edge");
    assert_relative_eq!(r.uc_max, 1.02138, max_relative = 1e-5);
    let rapport = r.verloop.as_ref().expect("verloop");
    assert!(rapport.notities.iter().any(|n| n.contains("6.4.2")));
}

#[test]
fn opgegeven_rand_kiest_639_of_640_met_het_momentteken() {
    // Bovenrand schuin, positief moment (trek onder): de schuine rand drukt.
    let boven = check_timber_beam(ligger(Some(200.0), Some(SchuineRand::Boven), 1.0));
    let t = toets(&boven, "6.4.2_tapered_edge");
    assert!(t.article.contains("(6.40)"));
    assert_relative_eq!(t.uc.as_ref().unwrap().uc, 0.78095, max_relative = 1e-4);
    assert_eq!(boven.status, CheckStatus::Ok);
    // Onderrand schuin: trek, (6.39).
    let onder = check_timber_beam(ligger(Some(200.0), Some(SchuineRand::Onder), 1.0));
    assert_relative_eq!(toets(&onder, "6.4.2_tapered_edge").uc.as_ref().unwrap().uc, 1.02138, max_relative = 1e-5);
    // Bovenrand schuin met een negatief moment: de bovenrand trekt.
    let neg = check_timber_beam(ligger(Some(200.0), Some(SchuineRand::Boven), -1.0));
    assert!(toets(&neg, "6.4.2_tapered_edge").article.contains("(6.39)"));
}

#[test]
fn prismatische_ligger_krijgt_geen_642() {
    let r = check_timber_beam(ligger(None, None, 1.0));
    assert!(r.checks.iter().all(|c| c.id != "6.4.2_tapered_edge"));
}
