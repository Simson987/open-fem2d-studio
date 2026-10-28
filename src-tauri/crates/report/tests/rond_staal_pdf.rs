//! Massief rond staal in de PDF: staat de toets op het draadeind er met naam,
//! artikel en afleiding in, en staat kip er als "n.v.t." mét reden?
//!
//! Een windverband RD 24 onder 80 kN trek. Het draadeind is maatgevend
//! (N_t,Rd,draad = 0,9·360·352,50/1,25 = 91,37 kN tegen N_pl,Rd = 106,31 kN), dus
//! de PDF hoort zijn afleiding uit te schrijven: de spoed, de
//! spanningsdoorsnede en de weerstand.
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
fn de_pdf_toont_het_draadeind_en_kip_als_niet_van_toepassing() {
    let envelop: Vec<_> = (0..=10)
        .map(|i| {
            json!({
                "combination_id": 1,
                "position_mm": 600.0 * i as f64,
                "forces": { "n_ed": 80.0, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": 0.0, "mz_ed": 0.0 }
            })
        })
        .collect();
    let invoer: BeamCheckInput = serde_json::from_value(json!({
        "beam_id": 12,
        "profile_name": "RD 24",
        "steel_grade": "S235",
        "length_m": 6.0,
        "forces_envelope": envelop,
        "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "deflection_limit_class": "Custom",
        "deflection_limit_numerator": 300,
        "deflection_actual_max_mm": 0.0,
        "is_cantilever": false,
        "consequence_class": "CC2"
    }))
    .expect("geldige invoer");
    let resultaat = check_beam(invoer);
    assert_eq!(resultaat.governing_check_id, "6.2.3_threaded_end");

    let pdf = generate_report_pdf(ReportInput {
        bijlage: Default::default(),
        project_name: "Rond staal".into(),
        project_number: "RD-001".into(),
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
    let pad = std::env::temp_dir().join("rond_staal_proef.pdf");
    std::fs::write(&pad, &pdf).expect("de PDF moet weg te schrijven zijn");
    println!("PDF: {}", pad.display());

    let stroom = inhoudsstromen(&pdf);
    // De toets op het draadeind, met zijn artikel.
    eis_erin(&stroom, "draadeind");
    eis_erin(&stroom, "(M24)");
    eis_erin(&stroom, "1993-1-8");
    // De uitgeschreven afleiding van de maatgevende toets.
    eis_erin(&stroom, "Spanningsdoorsnede");
    // De trektoets op de brutodoorsnede staat ernaast.
    eis_erin(&stroom, "6.2.3");
    // Kip: n.v.t. met de reden erbij.
    eis_erin(&stroom, "Kipweerstand");
    eis_erin(&stroom, "rotatiesymmetrisch");
}
