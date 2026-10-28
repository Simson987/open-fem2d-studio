//! Issue #199, fase 5 — `tweede_orde_in_krachten`: uit welke berekening de
//! UGT-krachten komen, voor §5.8 om y.
//!
//! De UGT-toets van de app rekent altijd tweede orde (P-Δ met scheefstand) en
//! stuurt daarom altijd `first_order_envelope` mee. Zonder dit veld las de kern
//! dat als "het tweede-orde-moment om y zit al in M_Ed": §5.8.8 vervalt en de
//! poort bleef "voldoet niet". Een elastische P-Δ met de ongescheurde E_cm·I_c
//! is echter geen tweede orde volgens §5.8 (§5.8.6 vraagt scheurvorming en
//! kruip). Nu:
//!   * Geometrisch: §5.8.8 op de EERSTE-ORDE-momenten (M₀e uit
//!     `first_order_envelope`), met e_i en e₂; de poort wordt informatie;
//!   * Fysisch (§5.8.6): §5.8.8 vervalt, de poort wordt informatie;
//!   * None: de oude afleiding, bit-gelijk.
//!
//! HANDBEREKENING: kolom 048 uit `kolom_tweede_orde_y.rs` (400 × 400, C30/37,
//! 3Ø20 boven en onder, geschoord, l₀ = 4 m, φ(∞,t₀) = 2,0, N_Ed = 1 500 kN).
//! De eerste orde: M_y 30/45/60 kNm. De P-Δ-krachten (forces_envelope): 33/52/66
//! kNm (verzonnen, maar groter: zij mogen M₀e niet beïnvloeden).
//!   M₀e = 0,6·60 + 0,4·30 = 48 kNm  (5.32, uit de EERSTE orde)
//!   e_i = 4000/600 = 6,667 mm → 10,0 kNm; e₂ = 31,06 mm → 46,59 kNm
//!   M_Edy = 48 + 10 + 46,59 = 104,59 kNm — gelijk aan de kolom met alleen
//!   eerste-ordekrachten (issue #224).

use concrete_check::{
    column_check, CheckKind, CheckStatus, ConcreteColumnCheckRequest, ConcreteColumnInput,
    Kniklengtekeuze,
};
use concrete_check::input::TweedeOrdeInKrachten;
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

fn verzoek_basis(bracing: Schoring, phi: Option<f64>) -> ConcreteColumnCheckRequest {
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


/// De kolom met P-Δ-krachten en de eerste orde ernaast.
fn verzoek(bracing: Schoring, soort: Option<TweedeOrdeInKrachten>) -> ConcreteColumnCheckRequest {
    let mut v = verzoek_basis(bracing, Some(2.0));
    v.first_order_envelope = Some(v.forces_envelope.clone());
    v.forces_envelope = vec![
        punt(0.0, -1500.0, 33.0),
        punt(2000.0, -1500.0, 52.0),
        punt(4000.0, -1500.0, 66.0),
    ];
    v.tweede_orde_in_krachten = soort;
    v
}

const POORT: &str = "5.8.3.1_slankheidsgrens";
const MOMENT_Y: &str = "5.8.8_moment_y";

#[test]
fn geometrisch_rekent_nominale_kromming_op_de_eerste_orde() {
    let r = column_check(verzoek(Schoring::Geschoord, Some(TweedeOrdeInKrachten::Geometrisch))).unwrap();
    let my = toets(&r, MOMENT_Y);
    assert_ne!(my.status, CheckStatus::NotApplicable, "{:?}", my.notes);
    assert!((var(my, "M_0e") - 48.0).abs() < 1e-9, "M₀e uit de eerste orde: {}", var(my, "M_0e"));
    let m_ed = r.m_edy_knm.unwrap();
    assert!((m_ed - 104.594).abs() < 0.01, "M_Edy = {m_ed} (hand 104,59)");
    assert!(my.notes.iter().any(|n| n.contains("ongescheurde stijfheid")));
    let poort = toets(&r, POORT);
    assert_eq!(poort.status, CheckStatus::NotApplicable, "de poort wordt informatie");
}

#[test]
fn zonder_veld_de_oude_afleiding() {
    let r = column_check(verzoek(Schoring::Geschoord, None)).unwrap();
    let my = toets(&r, MOMENT_Y);
    assert_eq!(my.status, CheckStatus::NotApplicable);
    assert!(my.notes.iter().any(|n| n.contains("zit dan al in M_Ed")));
    assert_eq!(toets(&r, POORT).status, CheckStatus::NotOk, "zoals vóór fase 5");
    assert!(r.m_edy_knm.is_none());
}

#[test]
fn fysisch_poort_is_informatie() {
    let r = column_check(verzoek(Schoring::Geschoord, Some(TweedeOrdeInKrachten::Fysisch))).unwrap();
    assert_eq!(toets(&r, MOMENT_Y).status, CheckStatus::NotApplicable);
    let poort = toets(&r, POORT);
    assert_eq!(poort.status, CheckStatus::NotApplicable);
    assert!(poort.notes.iter().any(|n| n.contains("fysisch niet-lineaire berekening (§5.8.6")));
    // λ/λ_lim staat er nog als informatie.
    assert!((poort.uc.as_ref().unwrap().uc - 34.641 / 30.17).abs() < 1e-3);
}

#[test]
fn geometrisch_ongeschoord_blijft_notok_met_reden() {
    let r = column_check(verzoek(Schoring::Ongeschoord, Some(TweedeOrdeInKrachten::Geometrisch))).unwrap();
    assert_eq!(toets(&r, POORT).status, CheckStatus::NotOk);
    let my = toets(&r, MOMENT_Y);
    assert!(my.notes.iter().any(|n| n.contains("ONGESCHOORD")));
    assert!(my.notes.iter().any(|n| n.contains("ongescheurde stijfheid")));
}

#[test]
fn geen_rekent_op_de_krachten_zelf() {
    let mut v = verzoek_basis(Schoring::Geschoord, Some(2.0));
    v.tweede_orde_in_krachten = Some(TweedeOrdeInKrachten::Geen);
    let r = column_check(v).unwrap();
    assert!((r.m_edy_knm.unwrap() - 104.594).abs() < 0.01);
}
