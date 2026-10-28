//! Platstaal (reeks "Strip <b>x<t>") — de catalogus, de schrijfwijzen en de
//! toetsing, tegen handberekeningen.
//!
//! Een strip is in een staalhal meestal een windverband. Wat hier bewaakt
//! wordt:
//!
//!  * de doorsnedegrootheden zijn de gesloten formules van b en t, met de
//!    breedte langs z: I_y = t·b³/12 is de sterke as;
//!  * "FL 80x10", "Platstaal 80x10", "Strip 80 x 10" en "strip80x10" vinden
//!    "Strip 80x10";
//!  * trek op de brutodoorsnede (6.2.3, (6.6)), zonder draadeind;
//!  * een strip op TREK knikt niet: 6.2.4, 6.3.1 en 6.3.3 zijn dan "n.v.t."
//!    zonder unity check;
//!  * knik onder druk met kromme c, om de zwakke as, met de hand nagerekend;
//!  * de klasse volgt bij druk uit b/t (blad 2, c = b), zonder druk klasse 1;
//!  * kip is "n.v.t." zolang de strip niet om de sterke as buigt, en wordt
//!    met reden geweigerd zodra zij dat wel doet;
//!  * buiging met normaalkracht volgt (6.32): M_N,Rd = M_pl,Rd·(1 − n²).
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
    staaf_met_a_net(naam, grade, l_m, krachten, None)
}

/// Als [`staaf`], met een opgegeven nettodoorsnede voor 6.2.3.
fn staaf_met_a_net(
    naam: &str,
    grade: &str,
    l_m: f64,
    krachten: InternalForces,
    a_net_mm2: Option<f64>,
) -> BeamCheckResult {
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
        a_net_mm2,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: None,
        draadeind: None,
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

// ── De catalogus ─────────────────────────────────────────────────────────────

/// Strip 80x10 met de hand (b = 80, t = 10; de breedte langs z):
///   A      = 80·10           = 800 mm²
///   I_y    = 10·80³/12       = 426 666,7 mm⁴  (sterke as)
///   I_z    = 80·10³/12       = 6 666,67 mm⁴
///   W_el,y = 10·80²/6        = 10 666,7 mm³,  W_pl,y = 10·80²/4 = 16 000 mm³
///   W_pl,z = 80·10²/4        = 2 000 mm³
///   i_y    = 80/√12          = 23,094 mm,     i_z = 10/√12 = 2,8868 mm
///   I_t    = 80·10³·(1/3 − 0,21·0,125·(1 − 10⁴/(12·80⁴))) = 24 566,7 mm⁴
///   A_v    = ⅔·800           = 533,33 mm²
/// De catalogus schrijft zes significante cijfers, vandaar de grens 1e-5.
#[test]
fn catalogus_strip_80x10_met_de_hand() {
    let s = steel_profiles::db().find("Strip 80x10").expect("Strip 80x10 in de catalogus");
    assert_eq!(s.name, "Strip 80x10");
    assert_eq!(s.kind, ProfileKind::FlatBar);
    let p = s.properties;
    assert_relative_eq!(p.area_mm2, 800.0, max_relative = 1e-12);
    assert_relative_eq!(p.iy_mm4, 426_666.7, max_relative = 1e-5);
    assert_relative_eq!(p.iz_mm4, 6_666.67, max_relative = 1e-5);
    assert_relative_eq!(p.wel_y_mm3, 10_666.7, max_relative = 1e-5);
    assert_relative_eq!(p.wpl_y_mm3, 16_000.0, max_relative = 1e-9);
    assert_relative_eq!(p.wpl_z_mm3, 2_000.0, max_relative = 1e-9);
    assert_relative_eq!(p.iy_radius_mm, 23.094, max_relative = 1e-5);
    assert_relative_eq!(p.iz_radius_mm, 2.88675, max_relative = 1e-5);
    assert_relative_eq!(p.it_mm4, 24_566.7, max_relative = 1e-5);
    assert_eq!(p.iw_mm6, 0.0);
    assert_relative_eq!(p.av_z_mm2, 533.333, max_relative = 1e-5);
    assert_eq!((s.buckling_curves.y_axis, s.buckling_curves.z_axis), ('c', 'c'));
    // De stand: h is de breedte b (langs z), b, t_w, t_f en t zijn de dikte.
    assert_eq!((s.geometry.h, s.geometry.b, s.geometry.tw, s.geometry.tf, s.geometry.t), (80.0, 10.0, 10.0, 10.0, 10.0));
}

/// De reeks: b ∈ {30 … 200}, t ∈ {5 … 20}, alleen b ≥ 2t — 97 maten.
#[test]
fn reeks_alleen_b_minstens_twee_t() {
    let strips: Vec<_> = steel_profiles::db()
        .all()
        .iter()
        .filter(|p| p.kind == ProfileKind::FlatBar)
        .collect();
    assert_eq!(strips.len(), 97);
    for s in &strips {
        assert!(s.geometry.h >= 2.0 * s.geometry.t, "{}", s.name);
    }
    assert!(steel_profiles::db().find("Strip 30x15").is_some());
    assert!(steel_profiles::db().find("Strip 30x20").is_none(), "b < 2t hoort er niet in");
    assert!(steel_profiles::db().find("Strip 200x20").is_some());
}

/// De schrijfwijzen uit tekeningen, modellen en IFC-bestanden.
#[test]
fn schrijfwijzen_vinden_strip_80x10() {
    for alias in [
        "Strip 80x10",
        "FL 80x10",
        "Platstaal 80x10",
        "Strip 80 x 10",
        "strip80x10",
        "STRIP 80X10",
        "Strip 80×10",
        "fl80x10",
        "Strip 10x80",
    ] {
        let p = steel_profiles::db().find(alias).unwrap_or_else(|| panic!("'{alias}' niet gevonden"));
        assert_eq!(p.name, "Strip 80x10", "'{alias}'");
    }
    assert_eq!(steel_profiles::strip_sleutel("FL80X8"), Some("STRIP80X8".to_string()));
    assert_eq!(steel_profiles::strip_sleutel("STRIP80"), None);
    assert_eq!(steel_profiles::strip_sleutel("FLB80X10"), None);
    assert!(steel_profiles::db().find("Strip 80x9").is_none(), "t = 9 staat niet in de reeks");
}

// ── Trek ─────────────────────────────────────────────────────────────────────

/// Strip 80x10 in S235 onder 150 kN trek:
///   N_pl,Rd = A·f_y/γ_M0 = 800·235/1,0 = 188 000 N = 188,0 kN (6.6)
///   UC      = 150/188,0 = 0,79787
/// Geen draadeind; druk, knik en 6.3.3 n.v.t.; kip n.v.t. (geen M_y).
#[test]
fn trek_strip_80x10_s235() {
    let r = staaf("Strip 80x10", "S235", 6.0, n(150.0));
    assert_eq!(r.classification, CrossSectionClass::Class1);
    assert_relative_eq!(waarde(&r, "6.2.3_tension"), 188.0, max_relative = 1e-12);
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 150.0 / 188.0, max_relative = 1e-12);
    assert!(r.checks.iter().all(|c| c.id != "6.2.3_threaded_end"), "een strip heeft geen draadeind");
    assert_eq!(r.governing_check_id, "6.2.3_tension");
    assert_relative_eq!(r.uc_max, 150.0 / 188.0, max_relative = 1e-12);
    assert_eq!(r.status, CheckStatus::Ok);
    for id in ["6.2.4_compression", "6.3.1_buckling", "6.3.3_eq_6_61", "6.3.3_eq_6_62", "6.3.2_ltb"] {
        assert_eq!(status(&r, id), CheckStatus::NotApplicable, "{id}");
    }
    for id in ["6.3.1_buckling", "6.3.3_eq_6_61", "6.3.3_eq_6_62", "6.3.2_ltb"] {
        assert!(uc(&r, id).is_none(), "{id} hoort geen unity check te hebben");
        assert!(notities(&r, id)[0].starts_with("Niet van toepassing"), "{id}: {:?}", notities(&r, id));
    }
    // De dikte t = 10 mm is de maat voor tabel 3.1.
    assert!(
        notities(&r, "6.2.3_tension").iter().any(|t| t.contains("t = 10 mm ≤ 40 mm")),
        "{:?}",
        notities(&r, "6.2.3_tension")
    );
}

/// Boven N_pl,Rd: 200 kN trek → UC = 200/188,0 = 1,06383, voldoet niet.
#[test]
fn trek_boven_n_pl_rd_keurt_af() {
    let r = staaf("Strip 80x10", "S235", 6.0, n(200.0));
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 200.0 / 188.0, max_relative = 1e-12);
    assert_eq!(r.status, CheckStatus::NotOk);
    assert_eq!(r.governing_check_id, "6.2.3_tension");
}

/// Een geboute strip: Strip 80x10, S235, één gat Ø18 (M16) over de breedte,
/// 150 kN trek. Tabel 3.1 bij t = 10 mm: f_u = 360 MPa; γ_M2 = 1,25.
///   A_net   = 800 − 18·10                = 620 mm²
///   N_u,Rd  = 0,9·620·360/1,25           = 160 704 N = 160,704 kN (6.7)
///   N_pl,Rd = 800·235/1,0                = 188,0 kN (6.6)
///   N_t,Rd  = min(188,0; 160,704)        = 160,704 kN
///   UC      = 150/160,704                = 0,933393
/// De melding van de strip spreekt de (6.7) van de toets niet tegen.
#[test]
fn geboute_strip_volgt_6_7() {
    let r = staaf_met_a_net("Strip 80x10", "S235", 6.0, n(150.0), Some(620.0));
    assert_relative_eq!(waarde(&r, "6.2.3_tension"), 160.704, max_relative = 1e-12);
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 150.0 / 160.704, max_relative = 1e-12);
    assert_relative_eq!(uc(&r, "6.2.3_tension").unwrap(), 0.933393, max_relative = 1e-6);
    assert_eq!(r.governing_check_id, "6.2.3_tension");
    let notes = notities(&r, "6.2.3_tension");
    assert!(notes.iter().any(|t| t.contains("maatgevend is de nettodoorsnede")), "{notes:?}");
    assert!(
        notes.iter().any(|t| t.starts_with("Platstaal:") && t.contains("alleen mee als de nettodoorsnede A_net is opgegeven")),
        "{notes:?}"
    );
    assert!(!notes.iter().any(|t| t.contains("Geen nettodoorsnede opgegeven")), "{notes:?}");
}

// ── Druk en knik ─────────────────────────────────────────────────────────────

/// Strip 80x10, S235, L_cr = 1 m om beide assen, N_Ed = 10 kN druk. Klasse
/// bij druk: b/t = 8 ≤ 9ε = 9 → klasse 1. Knik om de zwakke as:
///   i_z     = 10/√12 = 2,8868 mm,  λ_z = 1000/2,8868 = 346,41
///   λ₁      = π·√(210 000/235) = 93,913
///   λ̄_z     = 346,41/93,913 = 3,68863
///   kromme c: α = 0,49
///   Φ       = 0,5·[1 + 0,49·(3,68863 − 0,2) + 3,68863²] = 8,15771
///   χ_z     = 1/(Φ + √(Φ² − λ̄²)) = 1/(8,15771 + 7,27614) = 0,064793
///   N_b,Rd  = 0,064793·800·235/1,0 = 12 181 N = 12,181 kN
///   UC      = 10/12,181 = 0,82095
#[test]
fn knik_strip_80x10_om_de_zwakke_as() {
    let r = staaf("Strip 80x10", "S235", 1.0, n(-10.0));
    assert_eq!(r.classification, CrossSectionClass::Class1);
    assert_relative_eq!(tussenwaarde(&r, "6.3.1_buckling", r"\bar{\lambda}_z"), 3.68863, max_relative = 1e-5);
    assert_relative_eq!(tussenwaarde(&r, "6.3.1_buckling", r"\chi_z"), 0.064_793, max_relative = 1e-4);
    assert_relative_eq!(waarde(&r, "6.3.1_buckling"), 12.181, max_relative = 1e-4);
    assert_relative_eq!(uc(&r, "6.3.1_buckling").unwrap(), 0.82095, max_relative = 1e-4);
    // Op druk zijn de trektoets n.v.t. en de druktoets gerekend.
    assert_eq!(status(&r, "6.2.3_tension"), CheckStatus::NotApplicable);
    assert!(uc(&r, "6.2.3_tension").is_none());
    assert_relative_eq!(uc(&r, "6.2.4_compression").unwrap(), 10.0 / 188.0, max_relative = 1e-12);
}

/// De klasse uit b/t bij druk (blad 2, c = b; S235, ε = 1):
///   Strip 120x10: b/t = 12 ≤ 14 → klasse 3; Strip 100x5: b/t = 20 > 14 →
///   klasse 4, en een klasse-4-doorsnede wordt niet getoetst. Zonder druk is
///   dezelfde strip klasse 1.
#[test]
fn klasse_bij_druk_uit_b_over_t() {
    assert_eq!(staaf("Strip 120x10", "S235", 1.0, n(-5.0)).classification, CrossSectionClass::Class3);
    let k4 = staaf("Strip 100x5", "S235", 1.0, n(-1.0));
    assert_eq!(k4.classification, CrossSectionClass::Class4);
    assert_eq!(k4.status, CheckStatus::NotApplicable);
    assert!(k4.governing_check_id.starts_with("NIET TOETSBAAR"), "{}", k4.governing_check_id);
    assert_eq!(staaf("Strip 100x5", "S235", 1.0, n(20.0)).classification, CrossSectionClass::Class1);
}

// ── Kip ──────────────────────────────────────────────────────────────────────

/// Zonder buiging om de sterke as is kip n.v.t. (met reden); met M_y ≠ 0
/// wordt zij geweigerd met reden, en vervalt 6.3.3 mee.
#[test]
fn kip_alleen_bij_buiging_om_de_sterke_as() {
    let zwak = staaf("Strip 80x10", "S235", 2.0, InternalForces { n_ed: -2.0, mz_ed: 0.05, ..Default::default() });
    assert_eq!(status(&zwak, "6.3.2_ltb"), CheckStatus::NotApplicable);
    assert!(uc(&zwak, "6.3.2_ltb").is_none());
    assert!(notities(&zwak, "6.3.2_ltb")[0].starts_with("Niet van toepassing"));
    for id in ["6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
        assert_ne!(status(&zwak, id), CheckStatus::NotApplicable, "{id} hoort gerekend te zijn");
    }

    let sterk = staaf("Strip 80x10", "S235", 2.0, InternalForces { n_ed: -2.0, my_ed: 0.5, ..Default::default() });
    assert_eq!(status(&sterk, "6.3.2_ltb"), CheckStatus::NotApplicable);
    assert!(uc(&sterk, "6.3.2_ltb").is_none());
    assert!(
        notities(&sterk, "6.3.2_ltb")[0].contains("om de sterke as buigt"),
        "{:?}",
        notities(&sterk, "6.3.2_ltb")
    );
    for id in ["6.3.3_eq_6_61", "6.3.3_eq_6_62"] {
        assert_eq!(status(&sterk, id), CheckStatus::NotApplicable, "{id}");
        assert!(uc(&sterk, id).is_none(), "{id}");
    }
}

// ── Buiging met normaalkracht: (6.32) ───────────────────────────────────────

/// Strip 80x10, S235, N_Ed = 94 kN trek = ½·N_pl,Rd, dus n = 0,5 en
/// 1 − n² = 0,75 (6.32):
///   M_pl,y,Rd = 16 000·235 = 3,76 kNm → M_N,y,Rd = 2,82 kNm
///   M_pl,z,Rd =  2 000·235 = 0,47 kNm → M_N,z,Rd = 0,3525 kNm
/// Alleen M_z = 0,2 kNm:  UC = 0,2/0,3525 = 0,56738.
/// Alleen M_y = 1,0 kNm:  UC = 1,0/2,82   = 0,35461.
/// Beide (M_y = 1,0, M_z = 0,1): (6.41) met α = β = 1 (lid (6), conservatief):
///   0,35461 + 0,1/0,3525 = 0,35461 + 0,28369 = 0,63830.
#[test]
fn buiging_met_normaalkracht_volgt_6_32() {
    let z = staaf("Strip 80x10", "S235", 1.0, InternalForces { n_ed: 94.0, mz_ed: 0.2, ..Default::default() });
    assert_relative_eq!(uc(&z, "6.2.9_combined_mn").unwrap(), 0.2 / 0.3525, max_relative = 1e-9);
    let y = staaf("Strip 80x10", "S235", 1.0, InternalForces { n_ed: 94.0, my_ed: 1.0, ..Default::default() });
    assert_relative_eq!(uc(&y, "6.2.9_combined_mn").unwrap(), 1.0 / 2.82, max_relative = 1e-9);
    assert_relative_eq!(waarde(&y, "6.2.9_combined_mn"), 2.82, max_relative = 1e-9);
    let beide = staaf(
        "Strip 80x10",
        "S235",
        1.0,
        InternalForces { n_ed: 94.0, my_ed: 1.0, mz_ed: 0.1, ..Default::default() },
    );
    assert_relative_eq!(uc(&beide, "6.2.9_combined_mn").unwrap(), 1.0 / 2.82 + 0.1 / 0.3525, max_relative = 1e-9);
    // Zonder dwarskracht is 6.2.10 gelijk aan 6.2.9 (6.2.10(2)).
    assert_relative_eq!(
        uc(&beide, "6.2.10_combined_mnv").unwrap(),
        uc(&beide, "6.2.9_combined_mn").unwrap(),
        max_relative = 1e-12
    );
}
