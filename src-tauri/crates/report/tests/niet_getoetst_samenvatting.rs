//! Een staaf die niet (volledig) getoetst is, staat in de samenvattingstabel
//! van het rapport zonder UC: "—" en status "N/A", nooit een getal dat als
//! "voldoet" leest (controle 2026-10, punt B7).
//!
//! Twee staven uit de staalkern:
//! * staaf 1, IPE 300 S235, L = 1 m, alleen M_y,Ed = 10 kNm: getoetst, UC =
//!   10/(628 000·235·10⁻⁶) = 10/147,58 = 0,068;
//! * staaf 2, CHS 323,9×6,3 in S460 onder druk: d/t = 51,4 > 90ε² = 46,0, dus
//!   klasse 4, en voor een buis zijn de effectieve breedtes niet uitgewerkt.
//!   Alleen trek, dwarskracht en doorbuiging zijn gerekend; status n.v.t.
//!   ("NIET TOETSBAAR: …"), met een uc_max die NIET in de tabel mag staan.

use nen_en_1993_1_1_section::CheckStatus;
use report::{report_members, samenvattingsrijen, ReportInput};
use serde_json::json;
use steel_check::{check_beam, BeamCheckInput};

fn staaf(beam_id: u32, profiel: &str, staal: &str, n: f64, v: f64, m: f64) -> BeamCheckInput {
    let punt = |x: f64| {
        json!({
            "combination_id": 1,
            "position_mm": x,
            "forces": { "n_ed": n, "vy_ed": 0.0, "vz_ed": v, "mt_ed": 0.0, "my_ed": m, "mz_ed": 0.0 }
        })
    };
    serde_json::from_value(json!({
        "beam_id": beam_id,
        "profile_name": profiel,
        "steel_grade": staal,
        "length_m": 1.0,
        "forces_envelope": [punt(0.0), punt(500.0), punt(1000.0)],
        "lateral_bracing": { "top_flange_positions": [0.0, 0.5, 1.0], "bottom_flange_positions": [0.0, 0.5, 1.0] },
        "deflection_limit_class": "Floor",
        "deflection_limit_numerator": 250,
        "deflection_actual_max_mm": -1.0,
        "is_cantilever": false,
        "consequence_class": "CC2"
    }))
    .expect("geldige invoer")
}

#[test]
fn niet_getoetste_staaf_heeft_geen_uc_in_de_samenvatting() {
    let getoetst = check_beam(staaf(1, "IPE300", "S235", 0.0, 0.0, 10.0));
    let niet = check_beam(staaf(2, "CHS 323.9x6.3", "S460", -500.0, 20.0, 0.0));
    assert_eq!(getoetst.status, CheckStatus::Ok);
    assert_eq!(niet.status, CheckStatus::NotApplicable, "{}", niet.governing_check_id);
    assert!(niet.governing_check_id.starts_with("NIET TOETSBAAR"), "{}", niet.governing_check_id);
    // De gerekende toetsen (dwarskracht, doorbuiging) geven wél een UC > 0:
    // juist die mag niet als uitkomst van de staaf in de tabel staan.
    assert!(niet.uc_max > 0.0, "{}", niet.uc_max);

    let input = ReportInput {
        bijlage: Default::default(),
        project_name: "Niet getoetst".into(),
        project_number: "NG-001".into(),
        engineer: "Test Engineer".into(),
        company: "OpenAEC Foundation".into(),
        date: "2026-10-14".into(),
        taal: Default::default(),
        steel_check_results: vec![getoetst, niet],
        timber_check_results: vec![],
        clt_check_results: vec![],
        concrete_check_results: vec![],
        stress_check_results: vec![],
        concrete_stiffness_trace: None,
        concrete_dekkingslijnen: Vec::new(),
        concrete_reinforcement_zones: Vec::new(),
        scheefstand_toelichting: None,
        analyse_toelichting: None,
        wind_toelichting: None,
        toetskrachten: None,
        plate_results: Vec::new(),
        plate_inputs: Vec::new(),
        plate_skipped: Vec::new(),
    };
    let leden = report_members(&input);
    let rijen = samenvattingsrijen(&leden);
    assert_eq!(rijen.len(), 2);
    // Kolommen: staaf, doorsnede, materiaal, norm, UC, maatgevend, status.
    let (r1, r2) = (&rijen[0], &rijen[1]);
    assert_eq!(r1[0], "1");
    assert!(r1[4].starts_with("0"), "UC van de getoetste staaf: {}", r1[4]);
    assert_eq!(r1[6], "OK");
    assert_eq!(r2[0], "2");
    assert_eq!(r2[4], "—", "een niet getoetste staaf hoort geen UC te tonen");
    assert_eq!(r2[6], "N/A");
    assert!(r2[5].starts_with("NIET TOETSBAAR"), "{}", r2[5]);
}
