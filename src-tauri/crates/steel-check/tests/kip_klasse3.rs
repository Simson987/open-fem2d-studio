//! Kip (6.3.2) en 6.3.3 bij een doorsnede in klasse 3 — art. 6.3.2.1(3):
//! W_y = W_pl,y alleen bij klasse 1 en 2, W_y = W_el,y bij klasse 3, in λ̄_LT
//! én in M_b,Rd; en tabel 6.7: M_y,Rk = W_el,y·f_y in (6.61) en (6.62).
//!
//! Tot oktober 2026 rekende de kiptoets voor elke klasse met W_pl,y. Bij een
//! HEA in S355 met slanke flenzen gaf dat een M_b,Rd die 6,9 % te hoog lag, en
//! hier een ligger die "voldoet" (UC 0,963) waar hij niet voldoet (UC 1,029).
//!
//! De casus: HEA 300, L = 6 m tussen twee gaffels, geen kipsteunen, een
//! CONSTANT moment M_y,Ed = 380 kNm (β = +1, B* = 1, q = 0), belasting in het
//! zwaartepunt (z_a = 0). Uit de catalogus: h = 290, b = 300, t_w = 8,5,
//! t_f = 14, r = 27 mm; I_z = 63,1·10⁶ mm⁴, I_t = 852 000 mm⁴,
//! W_el,y = 1 260 000 mm³, W_pl,y = 1 380 000 mm³, A = 11 200 mm²,
//! i_y = 127,685 mm.
//!
//! Klasse in S355 (f_y = 355 MPa bij t_f = 14 mm ≤ 40 mm, ε = √(235/355) =
//! 0,81362):
//!   flens  c/t_f = (300 − 8,5 − 2·27)/2/14 = 8,482 > 10ε = 8,136, ≤ 14ε = 11,39
//!          → klasse 3 (tabel 5.2, blad 2, uitstekend deel onder druk);
//!   lijf   c/t_w = (290 − 2·14 − 2·27)/8,5 = 24,47 ≤ 72ε = 58,58 → klasse 1.
//! De doorsnede valt dus in klasse 3. In S235 (ε = 1) is de flens 8,482 ≤ 9
//! → klasse 1.
//!
//! M_cr volgens de NB (NB.NB.11, NB.NB.13, NB.148):
//!   S     = (h/2)·√(E·I_z/(G·I_t)) = 145·√(210 000·63,1·10⁶/(80 769·852 000))
//!         = 2012,103 mm
//!   C₁    = 1,000, C₂ = 0 (figuur NB.NB.5/6 bij β = +1, B* = 1; tabel NB.NB.1
//!           geval 1: 1,75 − 1,05 + 0,3 = 1,0)
//!   L_kip = L_st = L_g = 6000 mm (één veld tussen twee gaffels)
//!   C     = π·1,0·√(1 + π²·2012,103²/6000²) = 4,563357
//!   k_red = 1 (h/t_w = 34,1 ≤ 75, NB.NB.7)
//!   M_cr  = C/L_g·√(E·I_z·G·I_t) = 726,2726 kNm
//!
//! Alle getallen hieronder zijn met de hand (rekenmachine) nagerekend.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::classification::CrossSectionClass;
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1993_1_1_stability::StabilityCalc;
use steel_check::*;

const L_M: f64 = 6.0;
const M_ED: f64 = 380.0;

/// HEA 300 van 6 m met overal M_y = 380 kNm en normaalkracht `n_kn`
/// (trek positief), 11 punten, één combinatie.
fn hea300(grade: &str, n_kn: f64) -> BeamCheckResult {
    let envelop: Vec<ForcePoint> = (0..11)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: L_M * 1000.0 * i as f64 / 10.0,
            forces: InternalForces { n_ed: n_kn, my_ed: M_ED, ..Default::default() },
        })
        .collect();
    check_beam(BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: "HEA 300".to_string(),
        steel_grade: grade.to_string(),
        length_m: L_M,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing {
            top_flange_positions: vec![],
            bottom_flange_positions: vec![],
        },
        buckling_length_y_m: L_M,
        buckling_length_z_m: L_M,
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
        staafeinden: None,
        staaf_notities: None,
        profile_end: None,
        custom_section_end: None,
        tension_only: None,
        a_net_mm2: None,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
        draadeind: None,
    })
}

fn stabiliteit<'a>(r: &'a BeamCheckResult, id: &str) -> &'a StabilityCalc {
    match &r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt")).kind {
        CheckKind::Stability(s) => s,
        CheckKind::Resistance(_) => panic!("{id} is geen stabiliteitstoets"),
    }
}

fn waarde(s: &StabilityCalc, symbool: &str) -> f64 {
    s.variables
        .iter()
        .chain(s.intermediate_values.iter())
        .find(|v| v.symbol == symbool)
        .unwrap_or_else(|| panic!("{symbool} ontbreekt in {}", s.id))
        .value
}

/// S355, alleen M_y:
///   λ̄_LT = √(W_el,y·f_y/M_cr) = √(1 260 000·355/726,2726·10⁶) = 0,784783
///   kromme b (gewalst I, h/b = 0,967 ≤ 2), α_LT = 0,34
///   Φ_LT = 0,5·[1 + 0,34·(0,784783 − 0,4) + 0,75·0,784783²] = 0,796370
///   χ_LT = 1/(Φ_LT + √(Φ_LT² − 0,75·λ̄_LT²)) = 0,825457 (≤ 1, ≤ 1/λ̄² = 1,624)
///   M_b,Rd = 0,825457·1 260 000·355/1,0 = 369,227 kNm
///   UC = 380/369,227 = 1,029177 → voldoet NIET.
/// Met W_pl,y (de oude rekenwijze): λ̄_LT = 0,821304, χ_LT = 0,805329,
/// M_b,Rd = 394,531 kNm en UC 0,963170 — "voldoet", 6,9 % te gunstig.
#[test]
fn hea300_s355_kipt_met_w_el() {
    let r = hea300("S355", 0.0);
    assert_eq!(r.classification, CrossSectionClass::Class3);
    let s = stabiliteit(&r, "6.3.2_ltb");

    assert_relative_eq!(waarde(s, "S"), 2012.103, max_relative = 1e-6);
    assert_relative_eq!(waarde(s, "C_1"), 1.0, max_relative = 1e-12);
    assert_relative_eq!(waarde(s, "C"), 4.563357, max_relative = 1e-6);
    assert_relative_eq!(waarde(s, "M_{cr}"), 726.2726, max_relative = 1e-6);
    assert_relative_eq!(waarde(s, r"\bar{\lambda}_{LT}"), 0.784783, max_relative = 1e-5);
    assert_relative_eq!(waarde(s, r"\alpha_{LT}"), 0.34, max_relative = 1e-12);
    assert_relative_eq!(waarde(s, r"\chi_{LT}"), 0.825457, max_relative = 1e-5);
    assert_relative_eq!(s.value, 369.2270, max_relative = 1e-6);
    let uc = s.uc.as_ref().expect("de kiptoets heeft een UC");
    assert_relative_eq!(uc.rd, 369.2270, max_relative = 1e-6);
    assert_relative_eq!(uc.uc, 1.029177, max_relative = 1e-5);
    assert_eq!(s.status, CheckStatus::NotOk);

    // De formule, de variabele en de stap λ̄_LT noemen W_el,y, met zijn waarde.
    assert_eq!(s.formula_latex, r"M_{b,Rd} = \chi_{LT} \cdot W_{el,y} \cdot f_y / \gamma_{M1}");
    assert_relative_eq!(waarde(s, "W_{el,y}"), 1_260_000.0, max_relative = 1e-12);
    assert!(s.variables.iter().all(|v| v.symbol != "W_{pl,y}"), "{:?}", s.variables);
    let stap = s.deelstappen.iter().find(|d| d.id == "lambda_lt").expect("stap λ̄_LT");
    assert!(stap.formula_latex.contains("W_{el,y}"), "{}", stap.formula_latex);
    assert!(stap.ingevuld_latex.contains("1\\,260\\,000") || stap.ingevuld_latex.contains("1260000"),
        "de ingevulde regel hoort W_el,y te tonen: {}", stap.ingevuld_latex);
    assert!(stap.notes[0].starts_with("W_el,y omdat de doorsnede in klasse 3 valt"), "{:?}", stap.notes);
    assert!(s.notes.iter().any(|n| n.starts_with("Klasse 3: λ̄_LT en M_b,Rd zijn gerekend met W_y = W_el,y")),
        "{:?}", s.notes);

    // De doorsnedetoets rekent bij klasse 3 al elastisch: M_c,Rd = W_el,y·f_y
    // = 447,3 kNm, UC = 380/447,3 = 0,849542. M_b,Rd ligt daar nu onder.
    let CheckKind::Resistance(b) = &r.checks.iter().find(|c| c.id == "6.2.5_bending_y").unwrap().kind else {
        panic!("6.2.5 is een doorsnedetoets")
    };
    assert_relative_eq!(b.value, 447.3, max_relative = 1e-9);
    assert!(s.value < b.value, "M_b,Rd hoort onder M_c,Rd te liggen");
    assert_eq!(r.governing_check_id, "6.3.2_ltb");
    assert_relative_eq!(r.uc_max, 1.029177, max_relative = 1e-5);
}

/// Dezelfde ligger in S235 valt in klasse 1 (flens 8,482 ≤ 9ε = 9) en houdt
/// W_pl,y:
///   λ̄_LT = √(1 380 000·235/726,2726·10⁶) = 0,668226
///   Φ_LT = 0,5·[1 + 0,34·(0,668226 − 0,4) + 0,75·0,668226²] = 0,713046
///   χ_LT = 0,885248;  M_b,Rd = 0,885248·1 380 000·235 = 287,086 kNm
#[test]
fn dezelfde_ligger_in_s235_houdt_w_pl() {
    let r = hea300("S235", 0.0);
    assert_eq!(r.classification, CrossSectionClass::Class1);
    let s = stabiliteit(&r, "6.3.2_ltb");
    assert_relative_eq!(waarde(s, "M_{cr}"), 726.2726, max_relative = 1e-6);
    assert_relative_eq!(waarde(s, r"\bar{\lambda}_{LT}"), 0.668226, max_relative = 1e-5);
    assert_relative_eq!(waarde(s, r"\chi_{LT}"), 0.885248, max_relative = 1e-5);
    assert_relative_eq!(s.value, 287.0860, max_relative = 1e-5);
    assert_eq!(s.formula_latex, r"M_{b,Rd} = \chi_{LT} \cdot W_{pl,y} \cdot f_y / \gamma_{M1}");
    assert_relative_eq!(waarde(s, "W_{pl,y}"), 1_380_000.0, max_relative = 1e-12);
    assert!(s.notes.iter().all(|n| !n.starts_with("Klasse 3")), "{:?}", s.notes);
}

/// S355 met N_Ed = 200 kN druk erbij — (6.61) met tabel 6.7 voor klasse 3:
///   N_Rk   = A·f_y = 11 200·355 = 3976,0 kN
///   M_y,Rk = W_el,y·f_y = 1 260 000·355 = 447,300 kNm
///   M_z,Rk = W_el,z·f_y = 421 000·355 = 149,455 kNm
///   knik om y: λ₁ = π·√(210 000/355) = 76,40915; λ̄_y = 6000/(127,6854·76,40915)
///              = 0,614985; kromme b (α = 0,34):
///              Φ_y = 0,5·[1 + 0,34·(0,614985 − 0,2) + 0,614985²] = 0,759651
///              χ_y = 1/(Φ_y + √(Φ_y² − λ̄_y²)) = 0,829469
///              N_b,y,Rd = 0,829469·3976,0 = 3297,968 kN
///   n_y    = 200/3297,968 = 0,060643
///   C_my   = 0,6 + 0,4·ψ = 1,0 (constant moment, ψ = 1; tabel B.3)
///   k_yy   = C_my·(1 + 0,6·λ̄_y·n_y) = 1,022377 ≤ C_my·(1 + 0,6·n_y) = 1,036386
///            (tabel B.1, klasse 3)
///   (6.61) = 0,060643 + 1,022377·380/(0,825457·447,300/1,0)
///          = 0,060643 + 1,052207 = 1,112850
/// Met W_pl,y in M_y,Rk (en in χ_LT) stond hier 0,060643 + 1,022377·380/394,531
/// = 1,045366.
#[test]
fn klasse_3_in_6_3_3_met_m_y_rk_elastisch() {
    let r = hea300("S355", -200.0);
    assert_eq!(r.classification, CrossSectionClass::Class3);
    let s = stabiliteit(&r, "6.3.3_eq_6_61");
    assert_relative_eq!(waarde(s, "N_{Rk}"), 3976.0, max_relative = 1e-9);
    assert_relative_eq!(waarde(s, "M_{y,Rk}"), 447.3, max_relative = 1e-9);
    assert_relative_eq!(waarde(s, "M_{z,Rk}"), 149.455, max_relative = 1e-9);
    assert_relative_eq!(waarde(s, r"\chi_{LT}"), 0.825457, max_relative = 1e-5);
    assert_relative_eq!(waarde(s, "k_{yy}"), 1.022377, max_relative = 1e-5);
    assert_relative_eq!(waarde(s, "term_N"), 0.060643, max_relative = 1e-4);
    assert_relative_eq!(waarde(s, "term_{M_y}"), 1.052207, max_relative = 1e-5);
    assert_relative_eq!(s.value, 1.112850, max_relative = 1e-5);
    assert!(
        s.notes.iter().any(|n| n.starts_with("Tabel 6.7, klasse 3: N_Rk = A·f_y = 3976,000 kN, M_y,Rk = W_el,y·f_y = 447,300 kNm")),
        "{:?}",
        s.notes
    );
    // 6.62 rekent met dezelfde M_y,Rk.
    let s62 = stabiliteit(&r, "6.3.3_eq_6_62");
    assert_relative_eq!(waarde(s62, "M_{y,Rk}"), 447.3, max_relative = 1e-9);
}
