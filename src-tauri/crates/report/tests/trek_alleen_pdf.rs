//! Een trek-alleen staaf in de PDF: zegt de kopregel "trek-alleen", staat
//! alleen de trektoets erin, en staat de drukkracht er als informatieve regel
//! bij — niet getoetst?
//!
//! Een windverband Strip 80x10 onder 150 kN trek, met in een tweede
//! combinatie een kleine druk van 0,3 kN (speling). N_pl,Rd = 800·235/1,0 =
//! 188,0 kN, UC = 0,798.
//!
//! Woorden worden teruggezocht zoals in `zwakke_as_pdf.rs`: de inhoudsstromen
//! met `lopdf` uitgepakt, elk woord met `ttf-parser` vertaald naar de
//! glief-nummers van Liberation Sans.

use report::{generate_report_pdf, ReportInput};
use serde_json::json;
use steel_check::{check_beam, BeamCheckInput};

const FONT_REGULAR: &[u8] = include_bytes!("../fonts/LiberationSans-Regular.ttf");
const FONT_BOLD: &[u8] = include_bytes!("../fonts/LiberationSans-Bold.ttf");

fn inhoudsstromen(pdf: &[u8]) -> String {
    let doc = lopdf::Document::load_mem(pdf).expect("de PDF moet te lezen zijn");
    let mut uit = String::new();
    for (_, id) in doc.get_pages() {
        let inhoud = doc.get_page_content(id).expect("de inhoudsstroom moet uit te pakken zijn");
        uit.push_str(&String::from_utf8_lossy(&inhoud).to_uppercase());
    }
    uit
}

fn glief_hex(font: &[u8], woord: &str) -> String {
    let face = ttf_parser::Face::parse(font, 0).expect("het lettertype moet te lezen zijn");
    woord
        .chars()
        .map(|ch| {
            let gid = face
                .glyph_index(ch)
                .unwrap_or_else(|| panic!("geen glief voor {ch:?} — kies een ander proefwoord"));
            format!("{:04X}", gid.0)
        })
        .collect()
}

fn eis_erin(stroom: &str, woord: &str) {
    assert!(
        [FONT_REGULAR, FONT_BOLD].iter().any(|f| stroom.contains(&glief_hex(f, woord))),
        "{woord:?} staat niet in de inhoudsstroom van de PDF"
    );
}

#[test]
fn de_pdf_toont_trek_alleen_en_alleen_de_trektoets() {
    let mut envelop = Vec::new();
    for (c, n) in [(1, 150.0), (2, -0.3)] {
        for i in 0..=4 {
            envelop.push(json!({
                "combination_id": c,
                "position_mm": 1500.0 * i as f64,
                "forces": { "n_ed": n, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": 0.0, "mz_ed": 0.0 }
            }));
        }
    }
    let invoer: BeamCheckInput = serde_json::from_value(json!({
        "beam_id": 31,
        "profile_name": "Strip 80x10",
        "steel_grade": "S235",
        "length_m": 6.0,
        "forces_envelope": envelop,
        "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "deflection_limit_class": "Custom",
        "deflection_limit_numerator": 300,
        "deflection_actual_max_mm": 0.0,
        "is_cantilever": false,
        "consequence_class": "CC2",
        "tension_only": true
    }))
    .expect("geldige invoer");
    let resultaat = check_beam(invoer);
    assert_eq!(resultaat.governing_check_id, "6.2.3_tension");
    assert_eq!(resultaat.checks.len(), 2, "alleen de trektoets en de drukregel");

    let pdf = generate_report_pdf(ReportInput {
        bijlage: Default::default(),
        project_name: "Trek-alleen".into(),
        project_number: "TA-001".into(),
        engineer: "Test Engineer".into(),
        company: "OpenAEC Foundation".into(),
        date: "2026-10-01".into(),
        taal: Default::default(),
        steel_check_results: vec![resultaat],
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
        plate_results: Vec::new(),
        plate_inputs: Vec::new(),
        plate_skipped: Vec::new(),
    });
    let stroom = inhoudsstromen(&pdf);
    // De kopregel en de samenvatting zeggen dat het een trek-alleen staaf is.
    eis_erin(&stroom, "trek-alleen");
    // De trektoets, en de drukregel met haar vaste tekst.
    eis_erin(&stroom, "6.2.3");
    eis_erin(&stroom, "speling/voorspanning,");
    // Geen knik- of kiptoets.
    assert!(
        ![FONT_REGULAR, FONT_BOLD].iter().any(|f| stroom.contains(&glief_hex(f, "Kipweerstand"))),
        "een trek-alleen staaf hoort geen kiptoets in de PDF te hebben"
    );
}
