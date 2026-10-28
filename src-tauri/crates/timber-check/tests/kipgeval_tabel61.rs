//! Issue #220: het belastinggeval van tabel 6.1 (EN 1995-1-1 6.3.3) volgt uit
//! het momentverloop als `ltb_load_case` niet is opgegeven.
//!
//! ── DE HANDBEREKENING (controle 2026-10-26, B2) ────────────────────────────
//! C24, b × h = 45 × 300 mm, l = 4 m, klimaatklasse 1, middellang, M_y,d = 4 kNm
//! constant, N = V = 0. f_m,d = 0,8·24/1,3 = 14,769 N/mm²; E_0,05 = 7400.
//!   σ_m,d     = 4·10⁶ / (45·300²/6) = 5,926 N/mm²
//!   l_ef      = 1,0·4000 = 4000 mm (tabel 6.1, constant moment)
//!   σ_m,crit  = 0,78·45²·7400/(300·4000) = 9,740 N/mm²            (6.32)
//!   λ_rel,m   = √(24/9,740) = 1,5697 > 1,4 → k_crit = 1/λ² = 0,4058 (6.34)
//!   UC        = 5,926/(0,4058·14,769) = 0,9886                     (6.33)
//! Met l_ef = 0,9·l (de oude stille terugval): σ_m,crit = 10,82, k_crit = 0,4509,
//! UC = 0,8898 — 10 % te gunstig.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use steel_check::CheckKind;
use timber_check::{check_timber_beam, TimberBeamCheckInput, TimberBeamCheckResult};

fn ligger(punten: Vec<(f64, f64)>, extra: serde_json::Value) -> TimberBeamCheckInput {
    let mut j = serde_json::json!({
        "beam_id": 1, "width_mm": 45.0, "height_mm": 300.0,
        "strength_class": "C24", "service_class": "Sc1", "load_duration": "MediumTerm",
        "length_m": 4.0, "forces_envelope": [],
    });
    for (k, v) in extra.as_object().unwrap() {
        j[k] = v.clone();
    }
    let mut i: TimberBeamCheckInput = serde_json::from_value(j).unwrap();
    i.forces_envelope = punten
        .into_iter()
        .map(|(x, my)| ForcePoint {
            combination_id: 1,
            position_mm: x,
            forces: InternalForces { my_ed: my, ..Default::default() },
        })
        .collect();
    i
}

fn kip(r: &TimberBeamCheckResult) -> &nen_en_1993_1_1_stability::StabilityCalc {
    match &r.checks.iter().find(|c| c.id == "6.3.3_beam_stability").expect("kiptoets").kind {
        CheckKind::Stability(s) => s,
        CheckKind::Resistance(_) => panic!("kiptoets is een stabiliteitstoets"),
    }
}

fn notities(r: &TimberBeamCheckResult) -> String {
    kip(r).notes.join(" | ")
}

/// n + 1 stations op 0..L met M = f(ξ).
fn verloop(n: usize, f: impl Fn(f64) -> f64) -> Vec<(f64, f64)> {
    (0..=n).map(|i| {
        let xi = i as f64 / n as f64;
        (4000.0 * xi, f(xi))
    }).collect()
}

#[test]
fn constant_moment_zonder_opgave_geeft_lef_gelijk_aan_l() {
    let r = check_timber_beam(ligger(vec![(0.0, 4.0), (2000.0, 4.0), (4000.0, 4.0)], serde_json::json!({})));
    let k = kip(&r);
    assert_relative_eq!(k.uc.as_ref().unwrap().uc, 0.9886, max_relative = 2e-4);
    let n = notities(&r);
    assert!(n.contains("l_ef = 1,0 · 4000"), "{n}");
    assert!(n.contains("AFGELEID") && n.contains("constant"), "{n}");
}

#[test]
fn opgegeven_geval_blijft_gelden_zonder_extra_notitie() {
    let r = check_timber_beam(ligger(
        vec![(0.0, 4.0), (2000.0, 4.0), (4000.0, 4.0)],
        serde_json::json!({ "ltb_load_case": "UniformLoad" }),
    ));
    // De oude uitkomst met 0,9·l, nu alleen nog als de invoer erom vraagt.
    assert_relative_eq!(kip(&r).uc.as_ref().unwrap().uc, 0.8898, max_relative = 2e-4);
    assert!(!notities(&r).contains("AFGELEID"));
    let c = check_timber_beam(ligger(
        vec![(0.0, 4.0), (2000.0, 4.0), (4000.0, 4.0)],
        serde_json::json!({ "ltb_load_case": "ConstantMoment" }),
    ));
    assert_relative_eq!(kip(&c).uc.as_ref().unwrap().uc, 0.9886, max_relative = 2e-4);
}

#[test]
fn de_vormen_van_tabel_61_worden_herkend() {
    let geval = |punten, extra| notities(&check_timber_beam(ligger(punten, extra)));
    let geen = serde_json::json!({});
    let vrij = serde_json::json!({ "is_cantilever": true });
    // Twee steunpunten, gelijkmatig: parabool → 0,9.
    let n = geval(verloop(8, |x| 8.0 * x * (1.0 - x)), geen.clone());
    assert!(n.contains("l_ef = 0,9 · 4000") && n.contains("gelijkmatig"), "{n}");
    // Puntlast in het midden: driehoek → 0,8.
    let n = geval(verloop(8, |x| 4.0 * (1.0 - (2.0 * x - 1.0).abs())), geen.clone());
    assert!(n.contains("l_ef = 0,8 · 4000") && n.contains("puntlast in het midden"), "{n}");
    // Gelijkmatig + puntlast: de grootste l_ef van de twee, 0,9.
    let n = geval(verloop(8, |x| 4.0 * x * (1.0 - x) + 2.0 * (1.0 - (2.0 * x - 1.0).abs())), geen.clone());
    assert!(n.contains("l_ef = 0,9 · 4000"), "{n}");
    // Uitkraging (inklemming bij x = 0, vrij bij x = L), gelijkmatig: −q(L−x)²/2 → 0,5.
    let n = geval(verloop(8, |x| -10.0 * (1.0 - x).powi(2)), vrij.clone());
    assert!(n.contains("l_ef = 0,5 · 4000"), "{n}");
    // Uitkraging, vrij einde bij x = 0, puntlast aan dat einde → 0,8.
    let n = geval(verloop(8, |x| -10.0 * x), vrij.clone());
    assert!(n.contains("l_ef = 0,8 · 4000") && n.contains("vrije einde"), "{n}");
    // Doorgaande ligger (steunmoment): geen tabelrij → bovengrens 1,0.
    let n = geval(verloop(8, |x| 8.0 * x * (1.0 - x) - 1.0), geen.clone());
    assert!(n.contains("l_ef = 1,0 · 4000") && n.contains("bovengrens"), "{n}");
    // Te weinig stations voor een vorm (3 stations, geen constant moment) → 1,0.
    let n = geval(vec![(0.0, 0.0), (2000.0, 4.0), (4000.0, 0.0)], geen.clone());
    assert!(n.contains("l_ef = 1,0 · 4000") && n.contains("te weinig stations"), "{n}");
    // Kipsteunafstand korter dan de staaf → 1,0·ℓ met ℓ = 2000.
    let n = geval(verloop(8, |x| 8.0 * x * (1.0 - x)), serde_json::json!({ "ltb_segment_length_m": 2.0 }));
    assert!(n.contains("l_ef = 1,0 · 2000") && n.contains("kipsteunafstand is korter"), "{n}");
}

#[test]
fn over_de_combinaties_telt_de_grootste_lef() {
    // Combinatie 1 parabool (0,9), combinatie 2 constant (1,0) → 1,0.
    let mut i = ligger(verloop(8, |x| 8.0 * x * (1.0 - x)), serde_json::json!({}));
    for (x, _) in verloop(8, |_| 0.0) {
        i.forces_envelope.push(ForcePoint {
            combination_id: 2,
            position_mm: x,
            forces: InternalForces { my_ed: 1.0, ..Default::default() },
        });
    }
    let n = notities(&check_timber_beam(i));
    assert!(n.contains("l_ef = 1,0 · 4000") && n.contains("combinatie 2"), "{n}");
}
