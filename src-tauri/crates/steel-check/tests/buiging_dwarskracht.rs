//! §6.2.8 — buiging en dwarskracht op ELK station van de omhullende.
//!
//! De grootste dwarskracht en het grootste moment liggen zelden op dezelfde
//! plaats. Tot oktober 2026 werd 6.2.8 alleen getoetst op het punt met het
//! grootste |M_y|; daar is V_z bij een gelijkmatige last nul, en dan meldde de
//! toets "geen reductie" terwijl elders een plaats met grote V én groot M de
//! doorsnede zwaarder belastte.
//!
//! De casus: IPE 300, S235, vrij opgelegd, L = 4 m, twee combinaties.
//!  * Combinatie 1: q = 60 kN/m. V = 120 − 60·x, M = 30·x·(4 − x) (x in m):
//!    het grootste moment, 120 kNm in het midden, met V = 0.
//!  * Combinatie 2: een puntlast P = 330 kN op x = 0,4 m. Links van de last
//!    V = 330·3,6/4 = 297 kN, rechts V = 297 − 330 = −33 kN; M(0,4) =
//!    297·0,4 = 118,8 kNm. Het station links van de last heeft dus de
//!    grootste dwarskracht (gelijk aan die op de oplegging, waar M = 0) en een
//!    groot, maar niet het grootste, moment.
//!
//! Met de hand (catalogus: A_v,z = 2567 mm², W_pl,y = 628 000 mm³, h = 300,
//! t_f = 10,7, t_w = 7,1 mm; klasse 1):
//!   V_pl,z,Rd = 2567·235/(√3·1,0) = 348,2837 kN, V_pl,z,Rd/2 = 174,1418 kN
//!   M_y,c,Rd  = 628 000·235/1,0  = 147,580 kNm
//!   A_w = h_w·t_w = (300 − 2·10,7)·7,1 = 1978,06 mm² (6.2.8(5))
//!   combinatie 1, x = 2000 (V = 0):        UC = 120/147,58  = 0,813118
//!   combinatie 2, x = 400, links (V = 297): ρ = (2·297/348,2837 − 1)²
//!                                             = 0,705513² = 0,497739
//!            M_y,V,Rd = (628 000 − 0,497739·1978,06²/(4·7,1))·235·10⁻⁶
//!                     = 131,4650 kNm (6.30)
//!            UC = 118,8/131,4650 = 0,903663  ← maatgevend
//!   combinatie 2, x = 400, rechts (V = −33): UC = 118,8/147,58 = 0,804987
//!   combinatie 1, x = 400 (V = 96 < 174,14): UC = 43,2/147,58 = 0,292722
//! Het oude buigpunt gaf 0,813118.
//!
//! Tot oktober 2026 had combinatie 2 hier P = 280 kN (V = 252 kN, M = 100,8
//! kNm) en rekende 6.2.8 met (1 − ρ)·M_y,c,Rd = 118,0795 kNm (UC 0,853662).
//! Met (6.30) geeft die belasting M_y,V,Rd = 141,108 kNm en UC 0,7143, en dan
//! is het buigpunt van combinatie 1 weer maatgevend — de casus zou niet meer
//! laten zien waar hij voor is. De puntlast is daarom verzwaard (controle
//! 2026-10, punt B6).

use approx::assert_relative_eq;
use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

fn punt(combinatie: u32, x_mm: f64, vz_kn: f64, my_knm: f64) -> ForcePoint {
    ForcePoint {
        combination_id: combinatie,
        position_mm: x_mm,
        forces: InternalForces { vz_ed: vz_kn, my_ed: my_knm, ..Default::default() },
    }
}

fn ligger() -> BeamCheckResult {
    let mut envelop: Vec<ForcePoint> = Vec::new();
    // Combinatie 1: q = 60 kN/m.
    for i in 0..=10 {
        let x = 0.4 * i as f64;
        envelop.push(punt(1, x * 1000.0, 120.0 - 60.0 * x, 30.0 * x * (4.0 - x)));
    }
    // Combinatie 2: P = 330 kN op x = 0,4 m — op de plaats van de last twee
    // stations, links en rechts van de sprong in de dwarskracht.
    envelop.push(punt(2, 0.0, 297.0, 0.0));
    envelop.push(punt(2, 400.0, 297.0, 118.8));
    envelop.push(punt(2, 400.0, -33.0, 118.8));
    for i in 2..=10 {
        let x = 0.4 * i as f64;
        envelop.push(punt(2, x * 1000.0, -33.0, 132.0 - 33.0 * x));
    }
    check_beam(BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: "IPE 300".to_string(),
        steel_grade: "S235".to_string(),
        length_m: 4.0,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing {
            top_flange_positions: vec![],
            bottom_flange_positions: vec![],
        },
        buckling_length_y_m: 4.0,
        buckling_length_z_m: 4.0,
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

fn doorsnedetoets<'a>(r: &'a BeamCheckResult, id: &str) -> &'a nen_en_1993_1_1_section::ResistanceCalc {
    match &r.checks.iter().find(|c| c.id == id).unwrap_or_else(|| panic!("toets {id} ontbreekt")).kind {
        CheckKind::Resistance(c) => c,
        CheckKind::Stability(_) => panic!("{id} is geen doorsnedetoets"),
    }
}

fn variabele(c: &nen_en_1993_1_1_section::ResistanceCalc, symbool: &str) -> f64 {
    c.variables
        .iter()
        .find(|v| v.symbol == symbool)
        .unwrap_or_else(|| panic!("{symbool} ontbreekt in {}", c.id))
        .value
}

/// Het station met grote V én groot M is maatgevend, niet het buigpunt.
#[test]
fn het_station_naast_de_puntlast_is_maatgevend() {
    let r = ligger();
    let mv = doorsnedetoets(&r, "6.2.8_combined_mv");

    // De plaats: combinatie 2, links van de last.
    assert_eq!(mv.force_state.combination_id, 2);
    assert_relative_eq!(mv.force_state.position_mm, 400.0, max_relative = 1e-12);
    assert_relative_eq!(mv.force_state.forces.vz_ed, 297.0, max_relative = 1e-12);

    // ρ, de verminderde momentweerstand (6.30) en de UC, met de hand.
    assert_relative_eq!(variabele(mv, r"V_{z,pl,Rd}"), 348.2837, max_relative = 1e-6);
    assert_relative_eq!(variabele(mv, r"\rho"), 0.497739, max_relative = 1e-5);
    assert_relative_eq!(variabele(mv, r"M_{y,c,Rd}"), 147.58, max_relative = 1e-12);
    assert_relative_eq!(mv.value, 131.4650, max_relative = 1e-6);
    let uc = mv.uc.as_ref().expect("6.2.8 heeft een UC");
    assert_relative_eq!(uc.ed, 118.8, max_relative = 1e-12);
    assert_relative_eq!(uc.rd, 131.4650, max_relative = 1e-6);
    assert_relative_eq!(uc.uc, 0.903663, max_relative = 1e-5);
    assert_eq!(mv.status, CheckStatus::Ok);
    // Het oude buigpunt (combinatie 1, x = 2000, V = 0) zou 120/147,58 =
    // 0,813118 hebben gegeven: dat ligt eronder.
    assert!(uc.uc > 120.0 / 147.58);

    // Het rapport noemt de plaats en de reden.
    assert!(
        mv.notes.iter().any(|t| t.contains("Getoetst op alle 23 punten van de omhullende")
            && t.contains("maatgevend is combinatie 2 op x = 400 mm")),
        "{:?}",
        mv.notes
    );
    assert!(
        mv.notes.iter().any(|t| t.starts_with("V_z,Ed = 297,000 kN > V_pl,z,Rd/2 = 174,142 kN: ρ")
            && t.contains("(6.30)")),
        "{:?}",
        mv.notes
    );

    // 6.2.10 rekent met N_Ed = 0 en alleen buiging om y precies hetzelfde:
    // (1 − ρ)·f_y alleen op het lijf, M_pl,y,V,Rd volgens (6.30).
    let mnv = doorsnedetoets(&r, "6.2.10_combined_mnv");
    assert_relative_eq!(mnv.uc.as_ref().unwrap().uc, 0.903663, max_relative = 1e-5);
    assert_eq!(mnv.force_state.combination_id, 2);
    assert_relative_eq!(mnv.force_state.position_mm, 400.0, max_relative = 1e-12);

    // En de dwarskracht zelf (6.2.6): 297/348,2837 = 0,852753.
    let vz = doorsnedetoets(&r, "6.2.6_shear_z");
    assert_relative_eq!(vz.uc.as_ref().unwrap().uc, 0.852753, max_relative = 1e-5);
}
