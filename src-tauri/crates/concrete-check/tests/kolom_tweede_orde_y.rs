//! Issue #224 (B11) — tweede orde om y in de losse kolomtoets boven λ_lim,
//! met de nominale kromming van §5.8.8 (NB: alleen geschoorde, op zichzelf
//! staande elementen).
//!
//! HANDBEREKENING kolom 048: 400 × 400 mm, C30/37 (f_cd = 20), B500B
//! (f_yd = 434,78), boven en onder 3Ø20 (A_s = 1 885 mm²), dekking 30, beugel
//! Ø8-240; geschoord, scharnierend-scharnierend, l = l₀ = 4 m, φ(∞,t₀) = 2,0,
//! geen quasi-blijvende combinatie. N_Ed = 1 500 kN druk, M_y voet/kop = 30/60
//! kNm (zelfde teken).
//!
//! ```text
//!   λ = 4000/(400/√12) = 34,64;  λ_lim = 30,17 (issue)       → tweede orde
//!   n = 1 500 000/(160 000·20) = 0,46875;  ω = 1885·434,78/3 200 000 = 0,2561
//!   K_r = (1,2561 − 0,46875)/(1,2561 − 0,4) = 0,9197                (5.36)
//!   β = 0,35 + 30/200 − 34,64/150 = 0,2691;  φ_ef = φ(∞,t₀) = 2,0 (bovengrens)
//!   K_φ = 1 + 0,2691·2 = 1,5381                                     (5.37)
//!   d = 400 − 30 − 8 − 10 = 352 mm;  1/r₀ = 2,1739‰/(0,45·352)      (5.34)
//!   e₂ = K_r·K_φ·(1/r₀)·l₀²/10 = 31,06 mm;  M₂ = 1500·0,03106 = 46,59 kNm
//!   M₀e = 0,6·60 + 0,4·30 = 48 kNm                                  (5.32)
//!   e_i = θ_i·l₀/2 = (1/300)·4000/2 = 6,667 mm → N·e_i = 10,0 kNm  (α_h = 1)
//!   M_Edy = 48 + 10 + 46,59 = 104,59 kNm   (issue: 104,6 bij θ₀ = 1/300)
//! ```

use concrete_check::{
    column_check, CheckKind, CheckStatus, ConcreteColumnCheckRequest, ConcreteColumnInput,
    Kniklengtekeuze,
};
use mechanics::{ForcePoint, InternalForces};
use nen_en_1992_1_1::kolom::{Knikgeval, Schoring};
use nen_en_1992_1_1::{ConcreteSectionInput, RebarRow, ReinforcementCage, ResistanceCalc};

fn punt(x_mm: f64, n: f64, m: f64) -> ForcePoint {
    ForcePoint {
        combination_id: 1,
        position_mm: x_mm,
        forces: InternalForces {
            n_ed: n,
            my_ed: m,
            ..Default::default()
        },
    }
}

fn verzoek(bracing: Schoring, phi: Option<f64>) -> ConcreteColumnCheckRequest {
    ConcreteColumnCheckRequest {
        bijlage: Default::default(),
        beam_id: 48,
        section: ConcreteSectionInput::rectangle(400.0, 400.0),
        concrete_class: "C30/37".into(),
        reinforcement_grade: "B500B".into(),
        cage: ReinforcementCage {
            cover_mm: 30.0,
            stirrup_diameter_mm: 8.0,
            stirrup_spacing_mm: Some(240.0),
            stirrup_legs: Some(2),
            top: RebarRow {
                count: 3,
                diameter_mm: 20.0,
            },
            bottom: RebarRow {
                count: 3,
                diameter_mm: 20.0,
            },
            ..ReinforcementCage::default()
        },
        length_m: 4.0,
        column: ConcreteColumnInput {
            bracing,
            buckling_length: Kniklengtekeuze::Figuur57 {
                geval: if bracing == Schoring::Geschoord {
                    Knikgeval::ScharnierendScharnierend
                } else {
                    Knikgeval::Console
                },
            },
            phi_inf_t0: phi,
            stirrup_zone: None,
            lap_situation: None,
            bracing_z: Some(Schoring::Geschoord),
            buckling_length_z: Some(Kniklengtekeuze::Figuur57 {
                geval: Knikgeval::ScharnierendScharnierend,
            }),
            m0_edz_knm: None,
        },
        forces_envelope: vec![
            punt(0.0, -1500.0, 30.0),
            punt(2000.0, -1500.0, 45.0),
            punt(4000.0, -1500.0, 60.0),
        ],
        sls_quasi_permanent_envelope: vec![],
        first_order_envelope: None,
        tweede_orde_in_krachten: None,
        design_situation: Default::default(),
        steel_branch: Default::default(),
    }
}

fn toets<'a>(r: &'a concrete_check::ConcreteColumnCheckResponse, id: &str) -> &'a ResistanceCalc {
    let c = r
        .checks
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("{id} ontbreekt"));
    let CheckKind::Resistance(rc) = &c.kind else {
        panic!()
    };
    rc
}

fn var(rc: &ResistanceCalc, s: &str) -> f64 {
    rc.variables.iter().find(|v| v.symbol == s).unwrap().value
}

#[test]
fn issue_224_kolom_048_nominale_kromming_om_y() {
    let r = column_check(verzoek(Schoring::Geschoord, Some(2.0))).unwrap();
    assert!((r.lambda.unwrap() - 34.641).abs() < 1e-3);
    assert!((r.lambda_lim.unwrap() - 30.17).abs() < 0.01, "λ_lim {:?}", r.lambda_lim);

    let my = toets(&r, "5.8.8_moment_y");
    assert!((var(my, "K_r") - 0.91969).abs() < 1e-4);
    assert!((var(my, "K_φ") - 1.53812).abs() < 1e-4);
    assert!((var(my, "d") - 352.0).abs() < 1e-9);
    assert!((var(my, "M_0e") - 48.0).abs() < 1e-9);
    assert!((r.e_i_y_mm.unwrap() - 4000.0 / 600.0).abs() < 1e-9);
    let e2 = r.e_2_y_mm.unwrap();
    assert!((e2 - 31.063).abs() < 0.01, "e₂ = {e2} (hand 31,06)");
    let m_ed = r.m_edy_knm.unwrap();
    assert!((m_ed - 104.594).abs() < 0.01, "M_Edy = {m_ed} (hand 104,6)");
    assert!(my.uc.is_some());
    assert_ne!(my.status, CheckStatus::NotApplicable);

    // De poort is informatie geworden: geen NotOk en geen maatgevende UC.
    let poort = toets(&r, "5.8.3.1_slankheidsgrens");
    assert_eq!(poort.status, CheckStatus::NotApplicable);
    assert!((poort.uc.as_ref().unwrap().uc - 34.641 / 30.17).abs() < 1e-3);

    // (5.39) gebruikt nu het moment mét tweede orde (issue: was 30 kNm).
    let db = toets(&r, "5.8.9_dubbele_buiging");
    let m_edy_589 = db
        .variables
        .iter()
        .filter(|v| v.symbol.contains("M_Edy") || v.symbol.contains("M_{Edy}"))
        .map(|v| v.value)
        .fold(0.0_f64, f64::max);
    assert!(
        m_edy_589 > 100.0,
        "M_Edy in §5.8.9 = {m_edy_589}: {:?}",
        db.variables
    );
}

#[test]
fn issue_224_zonder_kruip_geen_goedkeuring_en_poort_blijft_notok() {
    let r = column_check(verzoek(Schoring::Geschoord, None)).unwrap();
    let my = toets(&r, "5.8.8_moment_y");
    assert_ne!(my.status, CheckStatus::Ok);
    assert!(r.m_edy_knm.is_none());
    let poort = toets(&r, "5.8.3.1_slankheidsgrens");
    assert_eq!(poort.status, CheckStatus::NotOk);
}

#[test]
fn issue_224_ongeschoord_mag_geen_nominale_kromming() {
    let r = column_check(verzoek(Schoring::Ongeschoord, Some(2.0))).unwrap();
    let my = toets(&r, "5.8.8_moment_y");
    assert_eq!(my.status, CheckStatus::NotApplicable);
    assert!(my.uc.is_none());
    assert!(my.notes.iter().any(|n| n.contains("ONGESCHOORD")));
    assert_eq!(
        toets(&r, "5.8.3.1_slankheidsgrens").status,
        CheckStatus::NotOk
    );
}
