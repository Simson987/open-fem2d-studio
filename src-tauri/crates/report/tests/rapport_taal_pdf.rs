//! Issue #227: de PDF van `generate_steel_report_pdf` was niet indienbaar —
//! ruwe LaTeX, Engelse koppen naast Nederlandse toetsnamen, het id van de
//! maatgevende toets, decimale punten, een doorbuigingsblok met "Comb 0" en
//! de grens L/250 alsof het de zakking was, een beschadigd streepje in de
//! metadata en een paginering die het voorblad niet meetelde.
//!
//! Model uit het issue: houtligger C24, 75 × 225 mm, L = 4 m; buiging UC
//! 0,642, dwarskracht 0,217, kip 0,655 en w_fin 0,688 (11 mm tegen de grens
//! L/250 = 4000/250 = 16 mm; 11/16 = 0,6875).

use mechanics::{ForceStateSnapshot, InternalForces};
use nen_en_1993_1_1_section::{CheckStatus, NamedValue, ResistanceCalc, UnityCheck};
use nen_en_1995_1_1::{LoadDurationClass, ServiceClass};
use report::{generate_report_pdf, ReportInput};
use steel_check::result::{CheckKind, NamedCheck};
use timber_check::TimberBeamCheckResult;

const FONTS: [&[u8]; 3] = [
    include_bytes!("../fonts/LiberationSans-Regular.ttf"),
    include_bytes!("../fonts/LiberationSans-Bold.ttf"),
    include_bytes!("../fonts/LiberationSans-Italic.ttf"),
];

fn toets(
    id: &str,
    titel: &str,
    formule: &str,
    combinatie: u32,
    krachten: (f64, f64),
    waarde: f64,
    eenheid: &str,
    ed: f64,
    rd: f64,
) -> NamedCheck {
    NamedCheck {
        id: id.into(),
        kind: CheckKind::Resistance(ResistanceCalc {
            deelstappen: Vec::new(),
            id: id.into(),
            title: titel.into(),
            article: "EN 1995-1-1".into(),
            force_state: ForceStateSnapshot {
                combination_id: combinatie,
                position_mm: if combinatie == 0 { 0.0 } else { 2000.0 },
                forces: InternalForces {
                    n_ed: 0.0,
                    vy_ed: 0.0,
                    vz_ed: krachten.0,
                    mt_ed: 0.0,
                    my_ed: krachten.1,
                    mz_ed: 0.0,
                },
            },
            formula_latex: formule.into(),
            variables: vec![NamedValue { symbol: r"\sigma_{m,y,d}".into(), value: 9.481, unit: "MPa".into() }],
            value: waarde,
            unit: eenheid.into(),
            uc: Some(UnityCheck { ed, rd, uc: ed / rd, formula_latex: "UC = E_d / R_d".into() }),
            status: CheckStatus::Ok,
            notes: vec![],
        }),
    }
}

fn houtligger() -> TimberBeamCheckResult {
    let checks = vec![
        toets(
            "bending",
            "Buiging",
            r"\frac{\sigma_{m,y,d}}{f_{m,y,d}} + k_m \cdot \frac{\sigma_{m,z,d}}{f_{m,z,d}} \leq 1",
            1,
            (6.0, 6.0),
            14.77,
            "MPa",
            9.481,
            14.77,
        ),
        toets(
            "shear",
            "Dwarskracht",
            r"\tau_d = \frac{V_{z,Ed} \cdot S_y}{I_y \cdot b_{ef}}",
            1,
            (6.0, 6.0),
            2.0,
            "MPa",
            0.434,
            2.0,
        ),
        // De zakkingstoets zoals de houtkern hem levert: geen krachtpunt
        // (combinatie 0, x = 0, krachten nul), `value` = de grens L/250 en
        // `uc.ed` = de zakking.
        toets("deflection_w_fin", "Doorbuiging w_fin", r"w_{fin} \leq L / 250", 0, (0.0, 0.0), 16.0, "mm", 11.0, 16.0),
    ];
    TimberBeamCheckResult {
        beam_id: 1,
        section_name: "75 x 225".into(),
        strength_class: "C24".into(),
        service_class: ServiceClass::Sc1,
        load_duration: LoadDurationClass::MediumTerm,
        checks,
        uc_max: 11.0 / 16.0,
        status: CheckStatus::Ok,
        governing_check_id: "deflection_w_fin".into(),
        k_mod_per_load_duration: vec![],
        governing_combination_id: None,
        verloop: None,
    }
}

fn invoer() -> ReportInput {
    let mut invoer: ReportInput = serde_json::from_value(serde_json::json!({
        "project_name": "Houtligger", "project_number": "020", "engineer": "Ir. Test",
        "company": "OpenAEC", "date": "2026-10-16", "steel_check_results": []
    }))
    .expect("ReportInput uit JSON, zoals de MCP-tool hem leest");
    invoer.timber_check_results = vec![houtligger()];
    invoer
}

fn stromen(pdf: &[u8]) -> Vec<String> {
    let doc = lopdf::Document::load_mem(pdf).expect("PDF");
    doc.get_pages()
        .into_values()
        .map(|id| String::from_utf8_lossy(&doc.get_page_content(id).expect("stroom")).to_uppercase())
        .collect()
}

/// Staat `tekst` (als gliefnummers, in een van de drie gewichten) in `stroom`?
fn bevat(stroom: &str, tekst: &str) -> bool {
    FONTS.iter().any(|font| {
        let face = ttf_parser::Face::parse(font, 0).unwrap();
        let mut hex = String::new();
        for ch in tekst.chars() {
            match face.glyph_index(ch) {
                Some(g) => hex.push_str(&format!("{:04X}", g.0)),
                None => return false,
            }
        }
        stroom.contains(&hex)
    })
}

fn ergens(pdf: &[String], tekst: &str) -> bool {
    pdf.iter().any(|s| bevat(s, tekst))
}

#[test]
fn het_rapport_is_nederlands_en_leesbaar() {
    let bytes = generate_report_pdf(invoer());
    let pdf = stromen(&bytes);

    // Geen ruwe LaTeX, wel de uitgeschreven formules.
    for latex in [r"\frac", r"\sigma", r"\tau", r"\cdot", r"\leq", "{m,y,d}"] {
        assert!(!ergens(&pdf, latex), "ruwe LaTeX {latex:?} in de PDF");
    }
    assert!(ergens(&pdf, "σ_m,y,d / f_m,y,d + k_m · σ_m,z,d / f_m,z,d ≤ 1"));
    assert!(ergens(&pdf, "τ_d = (V_z,Ed · S_y) / (I_y · b_ef)"));

    // Eén taal: geen Engelse koppen meer.
    for engels in ["Summary", "Engineer", "Company", "Number", "Governing", "Generated by", "Beam ", "Section"] {
        assert!(!ergens(&pdf, engels), "Engelse tekst {engels:?} in de PDF");
    }
    for nl in ["Samenvatting", "Constructeur", "Bedrijf", "Projectnummer", "Maatgevend", "Staaf 1"] {
        assert!(ergens(&pdf, nl), "{nl:?} ontbreekt");
    }

    // De maatgevende toets met zijn naam, niet met zijn id.
    assert!(ergens(&pdf, "Doorbuiging w_fin"));
    assert!(!ergens(&pdf, "deflection_w_fin"), "het id van de maatgevende toets staat in de PDF");

    // Decimale komma: UC 0,69 in de samenvatting, 9,481 in de variabelen.
    assert!(ergens(&pdf, "0,69"));
    assert!(ergens(&pdf, "9,481"));
    assert!(!ergens(&pdf, "9.481"));

    // Het doorbuigingsblok: de zakking naast de grens, geen "Comb 0".
    assert!(ergens(&pdf, "zakking 11,0 mm"), "de zakking staat niet naast de grens");
    assert!(ergens(&pdf, "grens 16,0 mm"));
    assert!(!ergens(&pdf, "Comb 0") && !ergens(&pdf, "Combinatie 0"));
    assert!(!ergens(&pdf, "= 16,000 mm"), "de grens staat er als uitkomst");

    // Paginering inclusief voorblad: N bladen → "pagina 2 van N" … "pagina N van N".
    let n = pdf.len();
    assert!(n >= 2);
    assert!(ergens(&pdf, &format!("pagina 2 van {n}")), "paginering zonder voorblad");
    assert!(ergens(&pdf, &format!("pagina {n} van {n}")));
    assert!(!ergens(&pdf, &format!("van {}", n - 1)));
}

#[test]
fn metadata_titel_zonder_beschadigd_streepje_en_elk_lettertype_een_keer() {
    let bytes = generate_report_pdf(invoer());
    let doc = lopdf::Document::load_mem(&bytes).expect("PDF");
    let info = doc.trailer.get(b"Info").and_then(|o| o.as_reference()).expect("Info");
    let titel = doc.get_object(info).unwrap().as_dict().unwrap().get(b"Title").unwrap();
    let titel = match titel {
        lopdf::Object::String(b, _) => b.clone(),
        o => panic!("Title is geen tekenreeks: {o:?}"),
    };
    assert!(titel.is_ascii(), "niet-ASCII in de metadatatitel: {:?}", String::from_utf8_lossy(&titel));
    assert_eq!(String::from_utf8(titel).unwrap(), "Constructieve toetsing - EN 1995-1-1");

    // Vier lettertypes (normaal, vet, cursief, vet-cursief), elk één keer
    // ingebed — niet vijf met de alias "LiberationSans" als dubbel.
    let bestanden = doc
        .objects
        .values()
        .filter(|o| o.as_dict().is_ok_and(|d| d.has(b"FontFile2")))
        .count();
    assert_eq!(bestanden, 4, "ingebedde lettertypebestanden");
}
