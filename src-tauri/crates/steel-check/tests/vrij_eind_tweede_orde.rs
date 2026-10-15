//! Een VRIJ staafeind en de tweede-orde-berekening met scheefstand.
//!
//! Een vrijstaande kolom zonder opgegeven kniklengte krijgt L_cr = 2·L: de
//! zijdelingse knik van de ingeklemd-vrije staaf. Zit die zijdelingse
//! uitbuiging al in de krachten — de globale berekening is tweede orde (P-Δ)
//! MET scheefstand — dan wordt de staaf getoetst met de systeemlengte L
//! (NEN-EN 1993-1-1 5.2.2(7)b); 2·L zou de zijdelingse knik dubbel tellen. De
//! invoerbouwer zegt per as of dat zo is (`zijdelingse_knik_in_analyse`).
//!
//! Handwaarden HEA200 S235, L = 3000 mm, N_Ed = 200 kN druk, γ_M1 = 1,0:
//! A = 5383 mm², i_y = 82,8 mm, i_z = 49,8 mm; λ₁ = 93,9;
//! knikkromme b om y, c om z (h/b = 0,95 ≤ 1,2; t_f = 10 mm ≤ 100 mm).
//!
//! | geval                       | L_cr,y | L_cr,z | χ_y    | χ_z    | N_b,Rd   | UC     |
//! |-----------------------------|--------|--------|--------|--------|----------|--------|
//! | eerste orde (veld weg)      | 6000   | 6000   | 0,7417 | 0,3960 | 501,0 kN | 0,3992 |
//! | 2D, 2e orde + scheefstand   | 3000   | 6000   | 0,9316 | 0,3960 | 501,0 kN | 0,3992 |
//! | 3D, 2e orde + scheefstand   | 3000   | 3000   | 0,9316 | 0,7605 | 962,0 kN | 0,2079 |
//!
//! In 2D blijft z (uit het vlak) op 2·L: de vlakke berekening ziet die richting
//! niet, ook niet in tweede orde.
//!
//! Een OPGEGEVEN L_cr,y groter dan de staaflengte (hier 4500 mm) blijft staan,
//! met de sway-regel C_my = 0,9 van tabel B.3. De toetskrachten van een model
//! in deze app zijn altijd tweede orde met scheefstand; de kern zegt er dan bij
//! dat 5.2.2(7)b de systeemlengte toestaat en dat de opgave de sway dubbel
//! telt. Geen rekenwijziging: χ_y(4500 mm, kromme b) = 0,8476 met de hand
//! (λ̄_y = 4500/(82,8·93,9) = 0,5788, Φ = 0,7319).

use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_stability::kniklengte::{HERKOMST_VRIJ_EIND, HERKOMST_VRIJ_EIND_TWEEDE_ORDE};
use nen_en_1993_1_1_stability::{Deelstap, StabilityCalc};
use steel_check::*;

const L_MM: f64 = 3000.0;
const N_KN: f64 = 200.0;
const A_MM2: f64 = 5383.0;
const I_Y_MM: f64 = 82.8;
const I_Z_MM: f64 = 49.8;
const F_Y: f64 = 235.0;
const LAMBDA_1: f64 = 93.9;
/// Tolerantie tussen kern en hand: de catalogusmaten hierboven zijn op drie
/// cijfers afgerond (de kern rekent i_z = 49,8x mm uit de doorsnede, met
/// afrondingsstraal), en dat geeft tot 0,3 % in χ_z.
const TOL: f64 = 5e-3;

fn kolom(einden: Staafeinden, zijdelings: Option<ZijdelingseKnikInAnalyse>) -> BeamCheckResult {
    check_beam(invoer(einden, zijdelings))
}

const KOP_VRIJ: Staafeinden = Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Vrij };

fn knik(r: &BeamCheckResult) -> &StabilityCalc {
    let c = r.checks.iter().find(|c| c.id == "6.3.1_buckling").expect("6.3.1 ontbreekt");
    let CheckKind::Stability(s) = &c.kind else { panic!("6.3.1 is een stabiliteitstoets") };
    s
}

fn stap<'a>(s: &'a StabilityCalc, id: &str) -> &'a Deelstap {
    s.deelstappen.iter().find(|d| d.id == id).unwrap_or_else(|| {
        panic!(
            "stap {id} ontbreekt; wel aanwezig: {:?}",
            s.deelstappen.iter().map(|d| d.id.as_str()).collect::<Vec<_>>()
        )
    })
}

fn waarde(s: &StabilityCalc, id: &str) -> f64 {
    stap(s, id).value.unwrap_or_else(|| panic!("stap {id} heeft geen uitkomst"))
}

/// χ met de hand: λ̄ = L_cr/(i·λ₁), Φ = 0,5·(1 + α·(λ̄ − 0,2) + λ̄²),
/// χ = 1/(Φ + √(Φ² − λ̄²)) ≤ 1 (6.49).
fn chi(l_cr_mm: f64, i_mm: f64, alpha: f64) -> f64 {
    let lb = l_cr_mm / i_mm / LAMBDA_1;
    let phi = 0.5 * (1.0 + alpha * (lb - 0.2) + lb * lb);
    (1.0 / (phi + (phi * phi - lb * lb).sqrt())).min(1.0)
}

fn dichtbij(kern: f64, hand: f64, tol: f64, wat: &str) {
    assert!(((kern - hand) / hand).abs() < tol, "{wat}: kern {kern}, hand {hand}");
}

#[test]
fn de_handwaarden_zelf() {
    dichtbij(chi(6000.0, I_Y_MM, 0.34), 0.7417, 2e-4, "χ_y bij 2·L");
    dichtbij(chi(6000.0, I_Z_MM, 0.49), 0.3960, 2e-4, "χ_z bij 2·L");
    dichtbij(chi(3000.0, I_Y_MM, 0.34), 0.9316, 2e-4, "χ_y bij L");
    dichtbij(chi(3000.0, I_Z_MM, 0.49), 0.7605, 2e-4, "χ_z bij L");
    dichtbij(chi(6000.0, I_Z_MM, 0.49) * A_MM2 * F_Y / 1e3, 501.0, 1e-3, "N_b,Rd,z bij 2·L");
    dichtbij(chi(3000.0, I_Z_MM, 0.49) * A_MM2 * F_Y / 1e3, 962.0, 1e-3, "N_b,Rd,z bij L");
}

/// Eerste orde, of geen opgave van de berekening: 2·L om beide assen.
#[test]
fn eerste_orde_geeft_twee_l_om_beide_assen() {
    let r = kolom(KOP_VRIJ, None);
    let s = knik(&r);
    assert_eq!(waarde(s, "l_cr_y"), 6000.0);
    assert_eq!(waarde(s, "l_cr_z"), 6000.0);
    assert_eq!(stap(s, "l_cr_y").notes[0], format!("Herkomst: {HERKOMST_VRIJ_EIND}."));
    assert!(stap(s, "l_cr_y").notes.iter().any(|n| n.contains("eigen φ")));
    dichtbij(waarde(s, "chi_y"), chi(6000.0, I_Y_MM, 0.34), TOL, "χ_y");
    dichtbij(waarde(s, "chi_z"), chi(6000.0, I_Z_MM, 0.49), TOL, "χ_z");
    dichtbij(s.uc.as_ref().unwrap().uc, N_KN / 501.0, TOL, "UC 6.3.1");
}

/// Ook een veld met beide assen op `false` is eerste orde: 2·L.
#[test]
fn een_veld_zonder_gedekte_as_verandert_niets() {
    let gewoon = kolom(KOP_VRIJ, None);
    let leeg = kolom(KOP_VRIJ, Some(ZijdelingseKnikInAnalyse { y: false, z: false }));
    assert_eq!(knik(&gewoon).uc.as_ref().unwrap().uc, knik(&leeg).uc.as_ref().unwrap().uc);
    assert_eq!(waarde(knik(&leeg), "l_cr_y"), 6000.0);
}

/// 2D, tweede orde met scheefstand: om y de staaflengte, om z (uit het vlak)
/// 2·L. Bij deze kolom blijft z maatgevend.
#[test]
fn vlak_model_in_tweede_orde_geeft_l_om_y_en_twee_l_om_z() {
    let r = kolom(KOP_VRIJ, Some(ZijdelingseKnikInAnalyse { y: true, z: false }));
    let s = knik(&r);
    assert_eq!(waarde(s, "l_cr_y"), 3000.0);
    assert_eq!(waarde(s, "l_cr_z"), 6000.0);
    assert_eq!(stap(s, "l_cr_y").notes[0], format!("Herkomst: {HERKOMST_VRIJ_EIND_TWEEDE_ORDE}."));
    assert_eq!(stap(s, "l_cr_y").formula_latex, r"L_{cr,y} = L");
    assert!(stap(s, "l_cr_y").notes.iter().any(|n| n.contains("5.2.2(7)b") && n.contains("6000 mm")));
    assert_eq!(stap(s, "l_cr_z").notes[0], format!("Herkomst: {HERKOMST_VRIJ_EIND}."));
    dichtbij(waarde(s, "chi_y"), chi(3000.0, I_Y_MM, 0.34), TOL, "χ_y");
    dichtbij(waarde(s, "chi_z"), chi(6000.0, I_Z_MM, 0.49), TOL, "χ_z");
    dichtbij(s.uc.as_ref().unwrap().uc, N_KN / 501.0, TOL, "UC 6.3.1");
}

/// 3D, tweede orde met scheefstand in X en Y: om beide assen de staaflengte.
#[test]
fn ruimtelijk_model_in_tweede_orde_geeft_l_om_beide_assen() {
    let r = kolom(KOP_VRIJ, Some(ZijdelingseKnikInAnalyse { y: true, z: true }));
    let s = knik(&r);
    assert_eq!(waarde(s, "l_cr_y"), 3000.0);
    assert_eq!(waarde(s, "l_cr_z"), 3000.0);
    dichtbij(waarde(s, "chi_z"), chi(3000.0, I_Z_MM, 0.49), TOL, "χ_z");
    dichtbij(s.uc.as_ref().unwrap().uc, N_KN / 962.0, TOL, "UC 6.3.1");
}

/// Een opgegeven kniklengte gaat altijd voor, ook bij een gedekte as.
#[test]
fn een_opgegeven_kniklengte_gaat_voor() {
    let r = check_beam(BeamCheckInput {
        buckling_length_y_m: 4.5,
        ..invoer(KOP_VRIJ, Some(ZijdelingseKnikInAnalyse { y: true, z: true }))
    });
    let s = knik(&r);
    assert_eq!(waarde(s, "l_cr_y"), 4500.0);
    assert_eq!(waarde(s, "l_cr_z"), 3000.0);
}

/// De 6.3.3-toets (6.61) van een kolom met M_y van 20 kNm aan de voet naar 0
/// aan de kop (ψ = 0, uit het momentenverloop C_my = 0,6), als JSON-tekst.
fn interactie_met_moment(inv: BeamCheckInput) -> (BeamCheckResult, String) {
    let mut inv = inv;
    for p in inv.forces_envelope.iter_mut() {
        p.forces.my_ed = 20.0 * (1.0 - p.position_mm / L_MM);
    }
    let r = check_beam(inv);
    let c = r.checks.iter().find(|c| c.id == "6.3.3_eq_6_61").expect("6.3.3 (6.61) ontbreekt");
    let tekst = serde_json::to_string(c).unwrap();
    (r, tekst)
}

/// Een opgegeven L_cr,y > L blijft staan, met de sway-regel C_my = 0,9, maar
/// met de kanttekening dat de sway dan dubbel telt: de toetskrachten van een
/// model in deze app zijn tweede orde met scheefstand, en 5.2.2(7)b staat dan
/// de systeemlengte toe. Met een vrij eind en zonder; geen rekenwijziging.
#[test]
fn opgegeven_kniklengte_boven_l_krijgt_de_kanttekening_over_dubbele_sway() {
    let gaffels = Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Gaffel };
    for einden in [KOP_VRIJ, gaffels] {
        let (r, interactie) =
            interactie_met_moment(BeamCheckInput { buckling_length_y_m: 4.5, ..invoer(einden, None) });
        let s = knik(&r);
        // Geen rekenwijziging: de opgave blijft de kniklengte.
        assert_eq!(waarde(s, "l_cr_y"), 4500.0);
        dichtbij(waarde(s, "chi_y"), chi(4500.0, I_Y_MM, 0.34), TOL, "χ_y bij de opgave");
        dichtbij(chi(4500.0, I_Y_MM, 0.34), 0.8476, 2e-4, "hand: χ_y bij 4500 mm");
        let notitie = stap(s, "l_cr_y")
            .notes
            .iter()
            .find(|n| n.contains("DUBBELE SWAY"))
            .unwrap_or_else(|| panic!("kanttekening ontbreekt bij L_cr,y: {:?}", stap(s, "l_cr_y").notes));
        assert!(
            notitie.contains("4500 mm")
                && notitie.contains("3000 mm")
                && notitie.contains("tweede-ordeberekening (P-Δ) met scheefstand")
                && notitie.contains("5.2.2(7)b")
                && notitie.contains("dubbel"),
            "{notitie}"
        );
        // De sway-regel blijft (C_my = 0,9), met dezelfde kanttekening in het kort.
        assert!(
            interactie.contains("C_my = 0,9") && interactie.contains("telt deze ondergrens de sway dubbel"),
            "C_my: {interactie}"
        );
    }
    // Een opgave ≤ L: geen sway-regel en geen kanttekening.
    let (r, interactie) =
        interactie_met_moment(BeamCheckInput { buckling_length_y_m: 3.0, ..invoer(gaffels, None) });
    assert!(!stap(knik(&r), "l_cr_y").notes.iter().any(|n| n.contains("DUBBELE SWAY")));
    assert!(!interactie.contains("sway dubbel"), "{interactie}");
    // 2·L van de kern bij een vrij eind is geen opgave: de sway-regel geldt,
    // maar de zijdelingse knik zit dan niet in de krachten, dus geen
    // kanttekening over dubbel tellen.
    let (r, interactie) = interactie_met_moment(invoer(KOP_VRIJ, None));
    assert_eq!(waarde(knik(&r), "l_cr_y"), 6000.0);
    assert!(!stap(knik(&r), "l_cr_y").notes.iter().any(|n| n.contains("DUBBELE SWAY")));
    assert!(interactie.contains("C_my = 0,9") && !interactie.contains("sway dubbel"), "{interactie}");
}

/// Een vrij eind met L uit de tweede orde houdt C_my = 0,9 als ondergrens
/// (tabel B.3, onder de tabel): de staaf heeft wél een knikvorm met
/// verplaatsbare knopen. Met M_y van 20 kNm aan de voet naar 0 aan de kop is
/// ψ = 0, dus zonder die ondergrens C_my = 0,6.
#[test]
fn vrij_eind_in_tweede_orde_houdt_c_m_negen_tiende() {
    let met_moment = |einden, zijdelings| {
        let mut inv = invoer(einden, zijdelings);
        for p in inv.forces_envelope.iter_mut() {
            p.forces.my_ed = 20.0 * (1.0 - p.position_mm / L_MM);
        }
        let r = check_beam(inv);
        let c = r.checks.iter().find(|c| c.id == "6.3.3_eq_6_61").expect("6.3.3 (6.61) ontbreekt");
        serde_json::to_string(c).unwrap()
    };
    let vrij = met_moment(KOP_VRIJ, Some(ZijdelingseKnikInAnalyse { y: true, z: false }));
    assert!(
        vrij.contains("Een staafeind is vrij: de staaf heeft een knikvorm met verplaatsbare knopen, ook al is L_cr,y")
            && vrij.contains("C_my = 0,9"),
        "de ondergrens C_my = 0,9 ontbreekt: {vrij}"
    );
    let gaffels = Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Gaffel };
    let gewoon = met_moment(gaffels, Some(ZijdelingseKnikInAnalyse { y: true, z: false }));
    assert!(!gewoon.contains("Een staafeind is vrij"), "zonder vrij eind geen ondergrens: {gewoon}");
}

/// Om z houdt een vrij eind C_mz = 0,9 ook bij 2·L (zonder veld): om y deed
/// de regel L_cr,y > L dat al, om z ontbrak hij. M_z van 10 kNm aan de voet
/// naar 0 aan de kop: ψ = 0, uit het momentenverloop C_mz = 0,6.
#[test]
fn vrij_eind_houdt_c_mz_negen_tiende_ook_bij_twee_l() {
    let mut inv = invoer(KOP_VRIJ, None);
    for p in inv.forces_envelope.iter_mut() {
        p.forces.mz_ed = 10.0 * (1.0 - p.position_mm / L_MM);
    }
    let r = check_beam(inv);
    let c = r.checks.iter().find(|c| c.id == "6.3.3_eq_6_61").expect("6.3.3 (6.61) ontbreekt");
    let tekst = serde_json::to_string(c).unwrap();
    assert!(
        tekst.contains("Een staafeind is vrij: de staaf heeft een knikvorm met verplaatsbare knopen. Tabel B.3")
            && tekst.contains("C_mz = 0,9"),
        "de ondergrens C_mz = 0,9 ontbreekt: {tekst}"
    );
}

/// Zonder vrij eind doet het veld niets: de gewone terugval op L.
#[test]
fn zonder_vrij_eind_doet_het_veld_niets() {
    let gaffels = Staafeinden { begin: Staafeind::Gaffel, eind: Staafeind::Gaffel };
    let met = kolom(gaffels, Some(ZijdelingseKnikInAnalyse { y: true, z: true }));
    let zonder = kolom(gaffels, None);
    assert_eq!(knik(&met).uc.as_ref().unwrap().uc, knik(&zonder).uc.as_ref().unwrap().uc);
    assert_eq!(waarde(knik(&met), "l_cr_y"), 3000.0);
}

fn invoer(einden: Staafeinden, zijdelings: Option<ZijdelingseKnikInAnalyse>) -> BeamCheckInput {
    BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: "HEA200".to_string(),
        steel_grade: "S235".to_string(),
        length_m: L_MM / 1000.0,
        forces_envelope: (0..11)
            .map(|i| ForcePoint {
                combination_id: 1,
                position_mm: L_MM * i as f64 / 10.0,
                forces: InternalForces { n_ed: -N_KN, ..Default::default() },
            })
            .collect(),
        lateral_bracing: LateralBracing { top_flange_positions: vec![], bottom_flange_positions: vec![] },
        buckling_length_y_m: 0.0,
        buckling_length_z_m: 0.0,
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
        staafstand: Some(mechanics::Staafstand::Staand),
        staafstand_notities: None,
        staafeinden: Some(einden),
        staaf_notities: None,
        profile_end: None,
        custom_section_end: None,
        a_net_mm2: None,
        tension_only: None,
        deflection_add_mm: None,
        deflection_length_m: None,
        zijdelingse_knik_in_analyse: zijdelings,
        draadeind: None,
    }
}
