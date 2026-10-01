//! Massief rond staal (reeks "RD") — de catalogus, de aliassen en de toetsing,
//! tegen handberekeningen.
//!
//! Een ronde staaf is meestal een windverband of trekstang. Wat hier bewaakt
//! wordt:
//!
//!  * de doorsnedegrootheden zijn de gesloten formules van d;
//!  * "Ø24", "ROND 24" en "RD24" vinden "RD 24";
//!  * trek staat als twee toetsen in de lijst — de brutodoorsnede (6.2.3,
//!    (6.6)) en het draadeind (NEN-EN 1993-1-8 tabel 3.4) — en de kleinste
//!    weerstand wint;
//!  * een staaf op TREK knikt niet: 6.3.1 en 6.3.3 zijn dan "n.v.t." in plaats
//!    van een knik-UC op de trekkracht;
//!  * knik onder druk met kromme c, met de hand nagerekend;
//!  * kip staat als "n.v.t." met reden in de lijst, zonder unity check, en
//!    6.3.3 draait wél door met χ_LT = 1;
//!  * de combinatie M + N volgt de plastische interactie van een volle cirkel,
//!    met het resulterende moment;
//!  * tabel 3.1 leest de diameter als dikte (RD 48: de kolom 40–80 mm).
//!
//! Alle getallen zijn met de hand uitgerekend; de afleiding staat bij de test.

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::classification::CrossSectionClass;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;
use steel_profiles::ProfileKind;

/// Een staaf `naam` van `l_m` meter met overal dezelfde krachten (11 punten).
fn staaf(naam: &str, grade: &str, l_m: f64, krachten: InternalForces) -> BeamCheckResult {
    let envelop: Vec<ForcePoint> = (0..11)
        .map(|i| ForcePoint {
            combination_id: 1,
            position_mm: l_m * 1000.0 * i as f64 / 10.0,
            forces: krachten,
        })
        .collect();
    check_beam(BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: naam.to_string(),
        steel_grade: grade.to_string(),
        length_m: l_m,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing {
            top_flange_positions: vec![],
            bottom_flange_positions: vec![],
        },
        buckling_length_y_m: l_m,
        buckling_length_z_m: l_m,
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
    })
}

fn n(kn: f64) -> InternalForces {
    InternalForces { n_ed: kn, ..Default::default() }
}

fn toets<'a>(r: &'a BeamCheckResult, id: &str) -> &'a NamedCheck {
    r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| {
        panic!(
            "toets '{id}' ontbreekt; wel: {:?}",
            r.checks.iter().map(|c| c.id.as_str()).collect::<Vec<_>>()
        )
    })
}

fn waarde(r: &BeamCheckResult, id: &str) -> f64 {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c.value,
        CheckKind::Stability(c) => c.value,
    }
}

fn uc(r: &BeamCheckResult, id: &str) -> Option<f64> {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c.uc.as_ref().map(|u| u.uc),
        CheckKind::Stability(c) => c.uc.as_ref().map(|u| u.uc),
    }
}

fn status(r: &BeamCheckResult, id: &str) -> CheckStatus {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => c.status,
        CheckKind::Stability(c) => c.status,
    }
}

fn notities<'a>(r: &'a BeamCheckResult, id: &str) -> &'a [String] {
    match &toets(r, id).kind {
        CheckKind::Resistance(c) => &c.notes,
        CheckKind::Stability(c) => &c.notes,
    }
}

fn tussenwaarde(r: &BeamCheckResult, id: &str, sym: &str) -> f64 {
    let CheckKind::Stability(s) = &toets(r, id).kind else { panic!("{id} is geen stabiliteitstoets") };
    s.intermediate_values
        .iter()
        .find(|v| v.symbol == sym)
        .unwrap_or_else(|| panic!("tussenwaarde {sym} ontbreekt in {id}"))
        .value
}

fn deelstap(r: &BeamCheckResult, id: &str, stap: &str) -> f64 {
    let CheckKind::Resistance(c) = &toets(r, id).kind else { panic!("{id} is geen weerstandstoets") };
    c.deelstappen
        .iter()
        .find(|d| d.id == stap)
        .unwrap_or_else(|| panic!("deelstap {stap} ontbreekt in {id}"))
        .value
        .expect("deelstap zonder waarde")
}

// ── De catalogus ─────────────────────────────────────────────────────────────

/// RD 24 met de hand:
///   A    = π·24²/4  = 452,389 mm²
///   I    = π·24⁴/64 = 16 286,0 mm⁴  (I_y = I_z)
///   W_el = π·24³/32 = 1 357,17 mm³
///   W_pl = 24³/6    = 2 304 mm³
///   i    = 24/4     = 6 mm
///   I_t  = π·24⁴/32 = 32 572,0 mm⁴,  I_w = 0
///   A_v  = 0,75·A   = 339,292 mm²
/// De catalogus schrijft zes significante cijfers, vandaar de grens 1e-5.
#[test]
fn rd24_staat_met_de_gesloten_formules_in_de_catalogus() {
    let rd = steel_profiles::db().find("RD 24").expect("RD 24 in de catalogus");
    assert_eq!(rd.kind, ProfileKind::RoundBar);
    let p = &rd.properties;
    assert_relative_eq!(p.area_mm2, 452.389, max_relative = 1e-5);
    assert_relative_eq!(p.iy_mm4, 16_286.0, max_relative = 1e-5);
    assert_relative_eq!(p.iz_mm4, 16_286.0, max_relative = 1e-5);
    assert_relative_eq!(p.wel_y_mm3, 1_357.17, max_relative = 1e-5);
    assert_relative_eq!(p.wel_z_mm3, 1_357.17, max_relative = 1e-5);
    assert_relative_eq!(p.wpl_y_mm3, 2_304.0, max_relative = 1e-9);
    assert_relative_eq!(p.wpl_z_mm3, 2_304.0, max_relative = 1e-9);
    assert_relative_eq!(p.iy_radius_mm, 6.0, max_relative = 1e-9);
    assert_relative_eq!(p.iz_radius_mm, 6.0, max_relative = 1e-9);
    assert_relative_eq!(p.it_mm4, 32_572.0, max_relative = 1e-5);
    assert_eq!(p.iw_mm6, 0.0);
    assert_relative_eq!(p.av_z_mm2, 339.292, max_relative = 1e-5);
    assert_relative_eq!(p.av_y_mm2, 339.292, max_relative = 1e-5);
    assert_eq!((rd.buckling_curves.y_axis, rd.buckling_curves.z_axis), ('c', 'c'));
    // Massief: de dikte voor tabel 3.1 is de diameter.
    assert_eq!((rd.geometry.h, rd.geometry.b, rd.geometry.tf), (24.0, 24.0, 24.0));
}

/// De hele reeks staat erin, met d in de naam.
#[test]
fn de_reeks_is_compleet() {
    for d in [10, 12, 16, 20, 24, 27, 30, 33, 36, 39, 42, 45, 48, 52, 56, 60, 64] {
        let naam = format!("RD {d}");
        let p = steel_profiles::db().find(&naam).unwrap_or_else(|| panic!("{naam} ontbreekt"));
        assert_eq!(p.name, naam);
        assert_eq!(p.kind, ProfileKind::RoundBar);
        assert_relative_eq!(p.geometry.h, d as f64);
    }
}

/// De gangbare schrijfwijzen vinden "RD 24"; wat geen massief rond is, blijft
/// wat het was.
#[test]
fn aliassen_vinden_rd24() {
    for alias in ["RD 24", "RD24", "rd 24", "Rd24", "Ø24", "Ø 24", "ø24", "⌀24", "ROND 24", "rond24"] {
        let p = steel_profiles::db().find(alias).unwrap_or_else(|| panic!("'{alias}' vindt niets"));
        assert_eq!(p.name, "RD 24", "'{alias}'");
    }
    assert!(steel_profiles::db().find("Ø25").is_none(), "RD 25 bestaat niet");
    assert!(steel_profiles::db().find("Ø24x3").is_none(), "geen massief rond");
    assert_eq!(steel_profiles::db().find("RHS 100x50x5").map(|p| p.kind), Some(ProfileKind::Rhs));
    assert_eq!(steel_profiles::rond_staal_sleutel("ROND30"), Some("RD30".to_string()));
    assert_eq!(steel_profiles::rond_staal_sleutel("RHS30"), None);
}

// ── Trek: brutodoorsnede en draadeind ───────────────────────────────────────

/// RD 24 in S235 onder 80 kN trek.
///   brutodoorsnede (6.6): N_pl,Rd = A·f_y/γ_M0 = 452,389·235/1,0 = 106 311 N
///                        = 106,31 kN → UC = 80/106,31 = 0,7525;
///   draadeind M24 (P = 3,0 mm, ISO 261):
///                        A_s = π/4·(24 − 0,9382·3)² = π/4·21,1854² = 352,50 mm²
///                        N_t,Rd,draad = 0,9·360·352,50/1,25 = 91 369 N
///                        = 91,37 kN → UC = 80/91,37 = 0,8756.
/// Het draadeind is maatgevend. (Met de afgeronde tabelwaarde A_s = 353 mm²
/// uit ISO 898-1 zou het 0,9·360·353/1,25 = 91,50 kN zijn; de kern rekent met
/// de formule, 0,14 % lager.)
#[test]
fn trek_rd24_draadeind_is_maatgevend() {
    let r = staaf("RD 24", "S235", 6.0, n(80.0));
    assert_eq!(r.classification, CrossSectionClass::Class1);
    assert_relative_eq!(waarde(&r, "6.2.3_tension"), 106.311, max_relative = 1e-4);
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 0.75251, max_relative = 1e-4);
    assert_relative_eq!(deelstap(&r, "6.2.3_threaded_end", "spoed"), 3.0);
    assert_relative_eq!(deelstap(&r, "6.2.3_threaded_end", "a_s"), 352.503, max_relative = 1e-5);
    assert_relative_eq!(waarde(&r, "6.2.3_threaded_end"), 91.369, max_relative = 1e-4);
    assert_relative_eq!(uc(&r, "6.2.3_threaded_end").unwrap(), 0.87557, max_relative = 1e-4);
    assert_eq!(r.governing_check_id, "6.2.3_threaded_end");
    assert_relative_eq!(r.uc_max, 0.87557, max_relative = 1e-4);
    assert_eq!(r.status, CheckStatus::Ok);
    // De naam en het artikel waaronder het rapport hem toont.
    let CheckKind::Resistance(d) = &toets(&r, "6.2.3_threaded_end").kind else { unreachable!() };
    assert_eq!(d.title, "Trek in het draadeind (M24)");
    assert_eq!(d.article, "NEN-EN 1993-1-8 tabel 3.4");
    assert!(d.formula_latex.contains(r"k_2 \cdot f_u \cdot A_s"), "{}", d.formula_latex);
}

/// RD 30 in S235:
///   N_pl,Rd = π·30²/4·235 = 706,858·235 = 166,11 kN;
///   M30, P = 3,5: A_s = π/4·(30 − 3,2837)² = 560,59 mm²,
///   N_t,Rd,draad = 0,9·360·560,59/1,25 = 145,30 kN.
#[test]
fn trek_rd30() {
    let r = staaf("RD 30", "S235", 6.0, n(120.0));
    assert_relative_eq!(waarde(&r, "6.2.3_tension"), 166.112, max_relative = 1e-4);
    assert_relative_eq!(deelstap(&r, "6.2.3_threaded_end", "a_s"), 560.586, max_relative = 1e-5);
    assert_relative_eq!(waarde(&r, "6.2.3_threaded_end"), 145.304, max_relative = 1e-4);
    assert_relative_eq!(r.uc_max, 120.0 / 145.304, max_relative = 1e-4);
    assert_eq!(r.governing_check_id, "6.2.3_threaded_end");
}

/// Een staaf op TREK knikt niet. Met de grootste |N| als "drukkracht" zou deze
/// RD 24 van 6 m een knik-UC van rond de 90 krijgen (N_b,Rd ≈ 0,9 kN). Dat hoort
/// niet: 6.3.1 en 6.3.3 zijn niet van toepassing, 6.2.4 ook niet, en geen van
/// drieën draagt een unity check.
#[test]
fn op_trek_is_knik_niet_van_toepassing() {
    let r = staaf("RD 24", "S235", 6.0, n(80.0));
    for id in ["6.3.1_buckling", "6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
        assert_eq!(status(&r, id), CheckStatus::NotApplicable, "{id}");
        assert!(uc(&r, id).is_none(), "{id} hoort geen unity check te hebben");
        assert!(notities(&r, id)[0].starts_with("Niet van toepassing"), "{id}: {:?}", notities(&r, id));
    }
    assert_eq!(status(&r, "6.2.4_compression"), CheckStatus::NotApplicable);
    assert!(r.uc_max < 1.0);
}

/// Zonder trek zijn de twee trektoetsen niet van toepassing: geen unity check,
/// wel de weerstand.
#[test]
fn op_druk_zijn_de_trektoetsen_niet_van_toepassing() {
    let r = staaf("RD 30", "S235", 3.0, n(-5.0));
    for id in ["6.2.3_tension", "6.2.3_threaded_end"] {
        assert_eq!(status(&r, id), CheckStatus::NotApplicable, "{id}");
        assert!(uc(&r, id).is_none(), "{id}");
    }
    assert_relative_eq!(waarde(&r, "6.2.3_threaded_end"), 145.304, max_relative = 1e-4);
}

// ── Knik onder druk ─────────────────────────────────────────────────────────

/// RD 30, S235, L_cr = 3 m om beide assen, N_Ed = 5 kN druk:
///   i       = 30/4 = 7,5 mm,  λ = 3000/7,5 = 400
///   λ₁      = π·√(210 000/235) = 93,913
///   λ̄       = 400/93,913 = 4,2593
///   kromme c: α = 0,49
///   Φ       = 0,5·[1 + 0,49·(4,2593 − 0,2) + 4,2593²] = 10,5652
///   χ       = 1/(Φ + √(Φ² − λ̄²)) = 1/(10,5652 + 9,6684) = 0,049422
///   N_b,Rd  = χ·A·f_y/γ_M1 = 0,049422·706,858·235/1,0 = 8 209,6 N = 8,21 kN
///   UC      = 5/8,2096 = 0,6090
#[test]
fn knik_rd30_op_drie_meter_met_kromme_c() {
    let r = staaf("RD 30", "S235", 3.0, n(-5.0));
    assert_relative_eq!(tussenwaarde(&r, "6.3.1_buckling", r"\lambda_y"), 400.0, max_relative = 1e-9);
    assert_relative_eq!(tussenwaarde(&r, "6.3.1_buckling", r"\bar{\lambda}_y"), 4.25926, max_relative = 1e-5);
    assert_relative_eq!(tussenwaarde(&r, "6.3.1_buckling", r"\bar{\lambda}_z"), 4.25926, max_relative = 1e-5);
    assert_relative_eq!(tussenwaarde(&r, "6.3.1_buckling", r"\chi_y"), 0.049_422, max_relative = 1e-4);
    assert_relative_eq!(waarde(&r, "6.3.1_buckling"), 8.2096, max_relative = 1e-4);
    assert_relative_eq!(uc(&r, "6.3.1_buckling").unwrap(), 0.60904, max_relative = 1e-4);
    let CheckKind::Stability(k) = &toets(&r, "6.3.1_buckling").kind else { unreachable!() };
    let kromme = k.deelstappen.iter().find(|d| d.id == "kromme_y").expect("kromme_y");
    assert_relative_eq!(kromme.value.unwrap(), 0.49);
    assert!(kromme.notes[0].contains("massieve profielen"), "{:?}", kromme.notes);
}

// ── Kip: n.v.t. met reden, 6.3.3 draait door ────────────────────────────────

/// Kip staat als "n.v.t." in de lijst — geen unity check, wel de reden — en
/// 6.3.3 wordt onder druk gewoon getoetst.
///
/// RD 30, 3 m, N = 5 kN druk en M_y = 0,1 kNm constant. 6.61 bij χ_LT = 1:
/// M_b,Rd = W_pl·f_y/γ_M1 = 4 500·235/1,0 = 1,0575 kNm, dus
/// term_My = k_yy·0,1/1,0575 met k_yy uit tabel B.1.
#[test]
fn kip_is_niet_van_toepassing_en_6_3_3_draait_door() {
    let r = staaf(
        "RD 30",
        "S235",
        3.0,
        InternalForces { n_ed: -5.0, my_ed: 0.1, ..Default::default() },
    );
    assert_eq!(status(&r, "6.3.2_ltb"), CheckStatus::NotApplicable);
    assert!(uc(&r, "6.3.2_ltb").is_none(), "n.v.t. hoort geen 0,00 te dragen");
    let kip = notities(&r, "6.3.2_ltb");
    assert!(kip[0].starts_with("Niet van toepassing") && kip[0].contains("rotatiesymmetrisch"), "{kip:?}");

    for id in ["6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
        assert_ne!(status(&r, id), CheckStatus::NotApplicable, "{id} hoort gerekend te zijn");
        assert!(notities(&r, id).iter().any(|t| t.contains("χ_LT = 1,0")), "{id}");
    }
    // term_My van 6.61 met M_b,Rd = 1,0575 kNm: k_yy·0,1/1,0575.
    let CheckKind::Stability(s) = &toets(&r, "6.3.3_eq_6_61").kind else { unreachable!() };
    let k_yy = s.variables.iter().find(|v| v.symbol == "k_{yy}").unwrap().value;
    let term_my = s.intermediate_values.iter().find(|v| v.symbol == "term_{M_y}").unwrap().value;
    assert_relative_eq!(term_my, k_yy * 0.1 / 1.0575, max_relative = 1e-9);
}

// ── Combinatie M + N van een volle cirkel ───────────────────────────────────

/// RD 30, S235, N_Ed = 83,056 kN druk = ½·N_pl,Rd, met A = 706,858 mm² zoals
/// de catalogus hem schrijft (zes cijfers), dus N_pl,Rd = 706,858·235 = 166,112 kN:
///   n = 0,5 → β uit 1 − (2/π)(β − sin β·cos β) = 0,5 → β = 1,15494 rad
///   sin³β = 0,76549
///   M_pl,Rd = 30³/6·235 = 4 500·235 = 1,0575 kNm
///   M_N,Rd  = 0,76549·1,0575 = 0,80950 kNm
/// Met M_y = 0,3 en M_z = 0,4 kNm is het resulterende moment 0,5 kNm, dus
/// UC = 0,5/0,80950 = 0,61767 — hetzelfde als M_y = 0,5 alleen.
#[test]
fn combinatie_mn_volgt_de_plastische_interactie_van_een_cirkel() {
    let half = 706.858 * 235.0 * 1e-3 / 2.0;
    let schuin = staaf(
        "RD 30",
        "S235",
        1.0,
        InternalForces { n_ed: -half, my_ed: 0.3, mz_ed: 0.4, ..Default::default() },
    );
    let recht = staaf(
        "RD 30",
        "S235",
        1.0,
        InternalForces { n_ed: -half, my_ed: 0.5, ..Default::default() },
    );
    for r in [&schuin, &recht] {
        assert_relative_eq!(deelstap(r, "6.2.9_combined_mn", "n"), 0.5, max_relative = 1e-9);
        assert_relative_eq!(deelstap(r, "6.2.9_combined_mn", "beta"), 1.154_94, max_relative = 1e-5);
        assert_relative_eq!(waarde(r, "6.2.9_combined_mn"), 0.809_50, max_relative = 1e-4);
        assert_relative_eq!(uc(r, "6.2.9_combined_mn").unwrap(), 0.617_67, max_relative = 1e-4);
    }
    // Geen dwarskracht: 6.2.10 valt samen met 6.2.9, en 6.2.8 is zuivere
    // buiging tegen M_pl,Rd.
    assert_relative_eq!(
        uc(&schuin, "6.2.10_combined_mnv").unwrap(),
        uc(&schuin, "6.2.9_combined_mn").unwrap(),
        max_relative = 1e-12
    );
    assert_relative_eq!(uc(&schuin, "6.2.8_combined_mv").unwrap(), 0.5 / 1.0575, max_relative = 1e-9);
}

// ── Afschuiving en de dikteklasse ───────────────────────────────────────────

/// RD 24 met V_z = 10 kN: V_pl,Rd = A_v·f_y/(√3·γ_M0) = 339,292·235/√3 =
/// 46 034 N = 46,03 kN, met A_v = 0,75·A — en die keuze staat bij de toets.
#[test]
fn afschuiving_met_driekwart_a() {
    let r = staaf("RD 24", "S235", 2.0, InternalForces { vz_ed: 10.0, ..Default::default() });
    assert_relative_eq!(waarde(&r, "6.2.6_shear_z"), 46.034, max_relative = 1e-4);
    assert!(notities(&r, "6.2.6_shear_z").iter().any(|t| t.contains("0,75·A")));
}

/// RD 48 in S355: de diameter is de dikte voor tabel 3.1, en 48 > 40 mm, dus
/// f_y = 335 en f_u = 470 N/mm² (in plaats van 355 en 490).
///   N_pl,Rd = π·48²/4·335 = 1 809,557·335 = 606,20 kN
///   M48, P = 5: A_s = π/4·(48 − 4,691)² = 1 473,15 mm²
///   N_t,Rd,draad = 0,9·470·1 473,15/1,25 = 498,51 kN
#[test]
fn rd48_valt_in_de_dikteklasse_40_tot_80() {
    let r = staaf("RD 48", "S355", 6.0, n(100.0));
    assert_relative_eq!(waarde(&r, "6.2.3_tension"), 606.202, max_relative = 1e-4);
    assert_relative_eq!(waarde(&r, "6.2.3_threaded_end"), 498.513, max_relative = 1e-4);
    assert!(
        notities(&r, "6.2.3_tension").iter().any(|t| t.contains("t = 48 mm") && t.contains("40 mm < t ≤ 80 mm")),
        "{:?}",
        notities(&r, "6.2.3_tension")
    );
}

/// Boven N_pl,Rd geeft de combinatie M + N geen rekenkundig artefact maar de
/// evenredige overschrijding, met de melding. RD 30, N = 1,05·N_pl,Rd druk en
/// M_y = 0,02 kNm (m = 0,02/1,0575 = 0,018913). Bij n → 1 loopt de kromme van
/// een volle cirkel als m ≈ (3π/4)·(1 − n), dus UC ≈ n + 4/(3π)·m =
/// 1,05 + 0,42441·0,018913 = 1,058027; exact (numeriek) 1,058198.
#[test]
fn boven_n_pl_eindige_uc_met_melding() {
    let n_pl = 706.858 * 235.0 * 1e-3;
    let r = staaf(
        "RD 30",
        "S235",
        1.0,
        InternalForces { n_ed: -1.05 * n_pl, my_ed: 0.02, ..Default::default() },
    );
    for id in ["6.2.9_combined_mn", "6.2.10_combined_mnv"] {
        let u = uc(&r, id).unwrap();
        assert_relative_eq!(u, 1.058_198, max_relative = 1e-5);
        assert_eq!(status(&r, id), CheckStatus::NotOk, "{id}");
        assert!(
            notities(&r, id)[0].starts_with("N_Ed ≥ N_pl,Rd: de doorsnede bezwijkt al op normaalkracht"),
            "{id}: {:?}",
            notities(&r, id)
        );
    }
}
