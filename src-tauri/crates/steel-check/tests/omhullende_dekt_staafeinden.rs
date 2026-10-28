//! Issue #243, punt 089: een omhullende die de staafeinden niet dekt.
//!
//! IPE240 S235, L = 6 m, dak, geen kipsteunen. De krachtenomhullende bevat
//! alleen x = 3000 mm. De kiptoets haalt β en B* (NB.NB.4.3) uit de momenten
//! op de staafeinden; buiten het bemonsterde bereik houdt `interpolate_my_at`
//! het veldmoment vast. Die eindmomenten zijn dus niet gemeten maar
//! doorgetrokken (onveilige richting: B* → ±1 en C₁ te hoog). Tot oktober
//! 2026 stond dat alleen in een notitie en was de staaf "Ok" (UC kip 0,2278).
//!
//! Verwacht: status NotApplicable met de reden in `governing_check_id`, de
//! unity checks zelf onveranderd. Met de staafeinden erbij (M = 0 op x = 0 en
//! x = L, de vrij opgelegde ligger) is de staaf gewoon getoetst.

use mechanics::{ForcePoint, InternalForces};
use nen_en_1990::ConsequenceClass;
use nen_en_1993_1_1_ltb::LateralBracing;
use nen_en_1993_1_1_section::CheckStatus;
use steel_check::*;

fn punt(x: f64, my: f64, vz: f64) -> ForcePoint {
    ForcePoint {
        combination_id: 1,
        position_mm: x,
        forces: InternalForces { my_ed: my, vz_ed: vz, ..Default::default() },
    }
}

fn invoer(envelop: Vec<ForcePoint>) -> BeamCheckInput {
    BeamCheckInput {
        bijlage: Default::default(),
        beam_id: 1,
        profile_name: "IPE240".to_string(),
        steel_grade: "S235".to_string(),
        length_m: 6.0,
        forces_envelope: envelop,
        lateral_bracing: LateralBracing {
            top_flange_positions: vec![],
            bottom_flange_positions: vec![],
        },
        buckling_length_y_m: 6.0,
        buckling_length_z_m: 6.0,
        deflection_limit_class: DeflectionClass::Roof,
        deflection_limit_numerator: 250,
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
    }
}

fn kip_uc(r: &BeamCheckResult) -> f64 {
    let c = r.checks.iter().find(|c| c.id == "6.3.2_ltb").expect("kiptoets");
    match &c.kind {
        CheckKind::Stability(s) => s.uc.as_ref().expect("gerekend").uc,
        CheckKind::Resistance(x) => x.uc.as_ref().expect("gerekend").uc,
    }
}

#[test]
fn alleen_het_midden_bemonsterd_is_niet_volledig_getoetst() {
    let r = check_beam(invoer(vec![punt(3000.0, 20.0, 0.0)]));
    assert!(r.uc_max < 1.0, "uc_max {}", r.uc_max);
    assert!(kip_uc(&r) > 0.0);
    assert_eq!(r.status, CheckStatus::NotApplicable);
    assert!(
        r.governing_check_id.starts_with("NIET VOLLEDIG GETOETST: de kip (6.3.2)")
            && r.governing_check_id.contains("combinatie 1 reikt niet tot beide staafeinden"),
        "{}",
        r.governing_check_id
    );
}

#[test]
fn met_de_staafeinden_erbij_is_de_staaf_getoetst() {
    // Parabool van een vrij opgelegde ligger, M_max = 20 kNm, V = ±13,333 kN.
    let r = check_beam(invoer(vec![
        punt(0.0, 0.0, 13.333),
        punt(3000.0, 20.0, 0.0),
        punt(6000.0, 0.0, -13.333),
    ]));
    assert_eq!(r.status, CheckStatus::Ok, "{}", r.governing_check_id);
    assert!(!r.governing_check_id.starts_with("NIET VOLLEDIG"));
}

/// Een fout die al vaststaat blijft "voldoet niet", ook met een onvolledige
/// omhullende: NotOk gaat voor.
#[test]
fn een_falende_toets_blijft_not_ok() {
    let r = check_beam(invoer(vec![punt(3000.0, 200.0, 0.0)]));
    assert!(r.uc_max > 1.0);
    assert_eq!(r.status, CheckStatus::NotOk);
}
