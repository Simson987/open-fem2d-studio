//! Issue #250 — art. 6.1(9) + NB: de begrenzing van de drukzonehoogte x_u/d
//! bij M_Ed, en de bros/taai-tekst van de M-N-κ-toets.
//!
//! HANDBEREKENING (uit het issue, N8):
//! Balk 300 × 500 mm, C20/25 (f_cd = 13,333 N/mm²), B500B (f_yd = 434,783),
//! dekking 30, beugel Ø8, onder 4Ø32 (A_s1 = 3217 mm², d = 500 − 30 − 8 − 16 =
//! 446 mm), boven 2Ø12 (A_s2 = 226,2 mm², d₂ = 30 + 8 + 6 = 44 mm).
//!
//! ```text
//!   grens (f_ck ≤ 50):  500/(500 + 434,783) = 0,53488
//!   drukwapening vloeit: F_s2 = 226,195·434,783 = 98,346 kN, arm d − d₂ = 0,402 m
//!   beton:  M_c = 340 − 98,346·0,402 = 300,465 kNm
//!   0,8·x·300·13,333·(446 − 0,4·x) = 300,465·10⁶
//!     → 1280·x² − 1 427 200·x + 300,465·10⁶ = 0 (gedeeld door 3200/… zie onder)
//!     → x_u = 281,7 mm; x_u/d = 0,632; UC = 0,632/0,535 = 1,18
//!   controle drukwapening: ε_s2 = 3,5·(1 − 44/281,7) = 2,95 ‰ > ε_yd = 2,17 ‰
//!   bij M_Ed = 300 kNm: x_u/d = 0,515 < 0,535 → voldoet.
//! ```

use concrete_check::{check_concrete_beam, CheckKind, CheckStatus, ConcreteBeamCheckInput};
use mechanics::{ForcePoint, InternalForces};
use nen_en_1992_1_1::{ConcreteSectionInput, RebarRow, ReinforcementCage, ReinforcementZones};
use nen_en_1993_1_1_section::ResistanceCalc;

fn korf(onder: (u32, f64)) -> ReinforcementCage {
    ReinforcementCage {
        cover_mm: 30.0,
        stirrup_diameter_mm: 8.0,
        stirrup_spacing_mm: Some(150.0),
        stirrup_legs: Some(2),
        top: RebarRow {
            count: 2,
            diameter_mm: 12.0,
        },
        bottom: RebarRow {
            count: onder.0,
            diameter_mm: onder.1,
        },
        ..ReinforcementCage::default()
    }
}

fn punt(x_mm: f64, v: f64, m: f64) -> ForcePoint {
    ForcePoint {
        combination_id: 1,
        position_mm: x_mm,
        forces: InternalForces {
            vz_ed: v,
            my_ed: m,
            ..Default::default()
        },
    }
}

fn invoer(cage: ReinforcementCage, m: f64, v: f64) -> ConcreteBeamCheckInput {
    ConcreteBeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        section: ConcreteSectionInput::rectangle(300.0, 500.0),
        concrete_class: "C20/25".into(),
        reinforcement_grade: "B500B".into(),
        cage,
        reinforcement_zones: ReinforcementZones::default(),
        length_m: 6.0,
        forces_envelope: vec![punt(0.0, v, 0.0), punt(3000.0, 0.0, m), punt(6000.0, -v, 0.0)],
        n_strips: 50,
        steel_branch: Default::default(),
        design_situation: Default::default(),
        apply_min_eccentricity: true,
        sls_frequent_envelope: vec![],
        exposure_class: None,
        structural_class: None,
        aggregate_size_mm: None,
        structural_system: None,
        bar_spacing_mm: None,
        column: None,
        sls_quasi_permanent_envelope: vec![],
        first_order_envelope: None,
        tweede_orde_in_krachten: None,
        staafstand: None,
        staafstand_notities: None,
    }
}

fn toets<'a>(r: &'a concrete_check::ConcreteBeamCheckResult, id: &str) -> &'a ResistanceCalc {
    let c = r
        .checks
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("toets {id} ontbreekt"));
    let CheckKind::Resistance(rc) = &c.kind else {
        panic!("{id} is geen weerstandstoets")
    };
    rc
}

fn var(rc: &ResistanceCalc, sym: &str) -> f64 {
    rc.variables
        .iter()
        .find(|v| v.symbol == sym)
        .unwrap_or_else(|| panic!("variabele {sym} ontbreekt"))
        .value
}

/// x_u uit de vierkantsvergelijking van de handberekening, met vloeiende
/// drukwapening.
fn x_u_hand(m_knm: f64) -> f64 {
    let f_cd = 20.0 / 1.5;
    let f_yd = 500.0 / 1.15;
    let a_s2 = 2.0 * std::f64::consts::PI * 36.0;
    let m_c = m_knm * 1e6 - a_s2 * f_yd * (446.0 - 44.0);
    // 0,8·x·b·f_cd·(d − 0,4·x) = M_c  →  0,32·b·f_cd·x² − 0,8·b·f_cd·d·x + M_c = 0
    let a = 0.32 * 300.0 * f_cd;
    let b = -0.8 * 300.0 * f_cd * 446.0;
    (-b - (b * b - 4.0 * a * m_c).sqrt()) / (2.0 * a)
}

#[test]
fn issue_250_te_zwaar_gewapende_balk_wordt_afgekeurd_op_6_1_9() {
    let r = check_concrete_beam(invoer(korf((4, 32.0)), 340.0, 226.7));
    // De buigtoets zelf voldoet (issue: M_Rd = 354,22 kNm, UC 0,960).
    let blok = toets(&r, "6.1_bending_stress_block");
    assert!((blok.uc.as_ref().unwrap().rd - 354.22).abs() < 0.05);
    assert_eq!(blok.status, CheckStatus::Ok);

    let xu = toets(&r, "6.1(9)_drukzonehoogte");
    let hand = x_u_hand(340.0);
    assert!((hand - 281.7).abs() < 0.1, "handberekening x_u = {hand}");
    assert!((var(xu, "x_u") - hand).abs() < 0.05, "x_u = {}", var(xu, "x_u"));
    assert!((var(xu, "d") - 446.0).abs() < 1e-9);
    let grens: f64 = 500.0 / (500.0 + 500.0 / 1.15);
    assert!((grens - 0.53488).abs() < 1e-5);
    let uc = xu.uc.as_ref().unwrap().uc;
    assert!((uc - hand / 446.0 / grens).abs() < 1e-4, "UC = {uc}");
    assert!((uc - 1.18).abs() < 0.005, "UC = {uc} (issue: 1,18)");
    assert_eq!(xu.status, CheckStatus::NotOk);
    // De eindstatus is niet meer Ok.
    assert_eq!(r.status, CheckStatus::NotOk);
    assert!(r.uc_max > 1.17);
}

#[test]
fn issue_250_bij_300_knm_voldoet_de_drukzonegrens() {
    let r = check_concrete_beam(invoer(korf((4, 32.0)), 300.0, 200.0));
    let xu = toets(&r, "6.1(9)_drukzonehoogte");
    let hand = x_u_hand(300.0);
    assert!((hand / 446.0 - 0.515).abs() < 0.001, "x_u/d = {}", hand / 446.0);
    assert!((var(xu, "x_u") - hand).abs() < 0.05);
    assert_eq!(xu.status, CheckStatus::Ok);
}

#[test]
fn issue_250_betonstuik_met_vloeiend_staal_heet_taai_niet_bros() {
    // 3Ø16 onder: het staal vloeit ruim bij bezwijken (issue: ε_s ≈ 28 ‰),
    // het beton is maatgevend. De tekst mag dan geen "bros" zeggen.
    let r = check_concrete_beam(invoer(korf((3, 16.0)), 60.0, 40.0));
    let mn = toets(&r, "6.1_mn_kappa");
    let teksten: Vec<&String> = mn.deelstappen.iter().flat_map(|d| d.notes.iter()).collect();
    assert!(
        teksten.iter().any(|n| n.contains("TAAI")),
        "geen taai-tekst: {teksten:?}"
    );
    assert!(!teksten.iter().any(|n| n.contains("Dit is bros")));
}
