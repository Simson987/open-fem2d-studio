//! Issue #225 (B12) — A_s,min volgens de NB bij 9.2.1.1(1) bij TREK MET BUIGING
//! en kleine excentriciteit, en de keuze van de snede in een omhullende met
//! ook een (niet-scheurende) drukcombinatie.
//!
//! HANDBEREKENING. Plaatstrook 1000 × 250 mm, C30/37 (f_cd = 20, f_ctm = 2,9),
//! B500B (f_yd = 434,783), onder 5Ø12 = 565,49 mm², geen bovenwapening, geen
//! beugels, dekking 30 → d = 250 − 30 − 6 = 214 mm; staaf 89 mm onder het
//! zwaartepunt.
//!
//! ```text
//! A_s,UGT bij N = +100 kN, M = 10 kNm: e = 100 mm, last 11 mm buiten de wapening.
//!   Moment om de wapening: 100·0,011 = 1,1 kNm = 0,8·x·1000·20·(214 − 0,4·x)
//!   → x = 0,3215 mm, C = 5,14 kN, T = 105,14 kN → A_s,UGT = 241,83 mm²
//!   A_s,min2 = 1,25·241,83 = 302,29 mm²
//! N_E,min/M_E,min (NB, trek): W = 1000·250²/6 = 10 416 667 mm³,
//!   η = e·A_c/W = 100·250 000/10 416 667 = 2,4
//!   N_E,min = 2,9·250 000/3,4 = 213,24 kN;  M_E,min = 2,9·W·2,4/3,4 = 21,32 kNm
//!   zelfde omkering: x = 0,686 mm → A_s,min1 = 515,68 mm²
//! A_s,min = min(515,68; 302,29) = 302,29 mm²; UC = 302,29/565,49 = 0,5346.
//! ```
//! De drukcombinatie (N = −500 kN, M = 10 kNm) heeft e = 20 mm, η = 0,48 ≤ 1:
//! de resultante ligt binnen de kern, de doorsnede scheurt niet; A_s,min2 = 0.

use concrete_check::{check_concrete_beam, CheckKind, CheckStatus, ConcreteBeamCheckInput};
use mechanics::{ForcePoint, InternalForces};
use nen_en_1992_1_1::{ConcreteSectionInput, RebarRow, ReinforcementCage, ReinforcementZones};
use nen_en_1993_1_1_section::ResistanceCalc;

fn punt(combi: u32, x_mm: f64, n: f64, v: f64, m: f64) -> ForcePoint {
    ForcePoint {
        combination_id: combi,
        position_mm: x_mm,
        forces: InternalForces {
            n_ed: n,
            vz_ed: v,
            my_ed: m,
            ..Default::default()
        },
    }
}

fn invoer(env: Vec<ForcePoint>) -> ConcreteBeamCheckInput {
    ConcreteBeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        section: ConcreteSectionInput::rectangle(1000.0, 250.0),
        concrete_class: "C30/37".into(),
        reinforcement_grade: "B500B".into(),
        cage: ReinforcementCage {
            cover_mm: 30.0,
            stirrup_diameter_mm: 0.0,
            top: RebarRow {
                count: 0,
                diameter_mm: 12.0,
            },
            bottom: RebarRow {
                count: 5,
                diameter_mm: 12.0,
            },
            ..ReinforcementCage::default()
        },
        reinforcement_zones: ReinforcementZones::default(),
        length_m: 1.0,
        forces_envelope: env,
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
        staafstand: None,
        staafstand_notities: None,
    }
}

fn trek() -> Vec<ForcePoint> {
    vec![punt(2, 0.0, 100.0, 90.0, 10.0), punt(2, 1000.0, 100.0, 90.0, 10.0)]
}

fn druk() -> Vec<ForcePoint> {
    vec![punt(1, 0.0, -500.0, 150.0, 10.0), punt(1, 1000.0, -500.0, 150.0, 10.0)]
}

fn as_min(r: &concrete_check::ConcreteBeamCheckResult) -> &ResistanceCalc {
    let c = r.checks.iter().find(|c| c.id == "9.2.1.1_as_min").unwrap();
    let CheckKind::Resistance(rc) = &c.kind else {
        panic!()
    };
    rc
}

fn var(rc: &ResistanceCalc, deel: &str) -> f64 {
    rc.variables
        .iter()
        .find(|v| v.symbol.contains(deel))
        .unwrap_or_else(|| panic!("{deel} ontbreekt: {:?}", rc.variables))
        .value
}

fn controleer_trekcombinatie(rc: &ResistanceCalc) {
    assert_eq!(rc.force_state.combination_id, 2, "getoetste snede: {:?}", rc.force_state);
    assert_eq!(rc.status, CheckStatus::Ok, "{:?}", rc.notes);
    assert!((var(rc, r"N_{E,\min}") - 213.235).abs() < 0.01);
    assert!((var(rc, r"M_{E,\min}") - 21.3235).abs() < 0.001);
    assert!((var(rc, r"\min 1") - 515.68).abs() < 0.5, "A_s,min1");
    assert!((var(rc, r"\min 2") - 302.29).abs() < 0.3, "A_s,min2");
    let uc = rc.uc.as_ref().unwrap().uc;
    assert!((uc - 0.5346).abs() < 6e-4, "UC = {uc}");
}

#[test]
fn issue_225_alleen_trek_levert_a_s_min() {
    let r = check_concrete_beam(invoer(trek()));
    controleer_trekcombinatie(as_min(&r));
}

#[test]
fn issue_225_druk_en_trek_kiest_de_trekcombinatie() {
    let mut env = druk();
    env.extend(trek());
    let r = check_concrete_beam(invoer(env));
    controleer_trekcombinatie(as_min(&r));
}

#[test]
fn issue_225_drukcombinatie_binnen_de_kern_toetst_met_a_s_min2() {
    let r = check_concrete_beam(invoer(druk()));
    let rc = as_min(&r);
    // Geen "niet van toepassing" zonder uitkomst meer: A_s,min2 = 0 is de
    // veilige bovengrens, dus voldoet.
    assert!(rc.uc.is_some(), "{:?}", rc.notes);
    assert_eq!(rc.status, CheckStatus::Ok);
    assert!(rc.notes.iter().any(|n| n.contains("kern")));
}
