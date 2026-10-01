//! Tekens in de PDF die vroeger verdwenen.
//!
//! Twee fouten in de opmaakmachine, allebei onzichtbaar tot iemand het
//! rapport naast de rekenkern legde:
//!
//!  * Een `<` gold als begin van een opmaakcode: alles tot de eerstvolgende
//!    `>` — of tot het eind van de alinea — verdween. "n = 0,177 <= a = 0,234
//!    -> M_N = M_pl" werd "n = 0,177  M_N = M_pl".
//!  * Liberation Sans heeft ⁻ en de subschriftcijfers niet. "10⁻³" kwam als
//!    "10³" in de PDF, "k₂" als "k". Nu worden super- en subschrift die het
//!    lettertype mist kleiner en verhoogd (Ts) gezet met gewone tekens, en
//!    krijgen ⇒ en ⌀ een vervanging die het lettertype wel heeft.
//!
//! Woorden worden teruggezocht zoals in `rond_staal_pdf.rs`: de
//! inhoudsstromen met `lopdf` uitgepakt, elk woord met `ttf-parser` vertaald
//! naar de glief-nummers van Liberation Sans.

use openaec_layout::{shared_font_registry, DocTemplate, Flowable, Frame, PageTemplate, Paragraph, Pt, Rect, A4};

const FONT_REGULAR: &[u8] = include_bytes!("../fonts/LiberationSans-Regular.ttf");

fn inhoudsstromen(pdf: &[u8]) -> String {
    let doc = lopdf::Document::load_mem(pdf).expect("de PDF moet te lezen zijn");
    let mut uit = String::new();
    for (_, id) in doc.get_pages() {
        let inhoud = doc.get_page_content(id).expect("de inhoudsstroom moet uit te pakken zijn");
        uit.push_str(&String::from_utf8_lossy(&inhoud).to_uppercase());
    }
    uit
}

fn glief_hex(woord: &str) -> String {
    let face = ttf_parser::Face::parse(FONT_REGULAR, 0).expect("het lettertype moet te lezen zijn");
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

fn pdf_met(alineas: &[&str]) -> Vec<u8> {
    let fonts = shared_font_registry();
    {
        let mut reg = fonts.lock().unwrap();
        reg.register_ttf_bytes("LiberationSans-Regular", FONT_REGULAR.to_vec()).unwrap();
        reg.register_alias("LiberationSans", "LiberationSans-Regular");
    }
    let mut doc = DocTemplate::new("tekens", fonts.clone());
    let frame = Frame::new(Rect::new(Pt(56.7), Pt(56.7), Pt(481.9), Pt(728.5)));
    doc.add_page_template(PageTemplate::new("inhoud", A4, frame));
    let flow: Vec<Box<dyn Flowable>> = alineas
        .iter()
        .map(|t| Box::new(Paragraph::plain(*t)) as Box<dyn Flowable>)
        .collect();
    doc.build_to_bytes(flow).expect("de PDF moet te bouwen zijn")
}

/// Na een `<` gaat de tekst gewoon door.
#[test]
fn tekst_na_kleiner_dan_blijft_staan() {
    let stroom = inhoudsstromen(&pdf_met(&["n = 0,177 <= a = 0,234 -> reductie", "V_Ed < V_pl,Rd/2 vervolg"]));
    for woord in ["<=", "reductie", "<", "V_pl,Rd/2", "vervolg"] {
        assert!(stroom.contains(&glief_hex(woord)), "{woord:?} ontbreekt in de PDF");
    }
}

/// "10⁻³" staat er als "10" gevolgd door een verhoogd, kleiner "-3"; "k₂" als
/// "k" met een verlaagde "2"; ⌀ als Ø.
#[test]
fn superschrift_en_subschrift_verschijnen() {
    let stroom = inhoudsstromen(&pdf_met(&["eenheid 10⁻³ en k₂ = 0,9 bij ⌀24"]));
    // De gewone delen.
    assert!(stroom.contains(&glief_hex("10")), "10 ontbreekt");
    assert!(stroom.contains(&glief_hex("k")), "k ontbreekt");
    assert!(stroom.contains(&glief_hex("Ø24")), "⌀ hoort als Ø te staan");
    // Het verhoogde "-3": als eigen stuk tekst met een positieve tekstverhoging.
    assert!(stroom.contains(&glief_hex("-3")), "-3 ontbreekt");
    // Ts met een positieve en een negatieve waarde: superschrift en subschrift.
    let ts: Vec<f32> = stroom
        .split('\n')
        .filter_map(|r| r.trim().strip_suffix(" TS").and_then(|v| v.trim().parse::<f32>().ok()))
        .collect();
    assert!(ts.iter().any(|&v| v > 0.0), "geen verhoging (Ts > 0) gevonden: {ts:?}");
    assert!(ts.iter().any(|&v| v < 0.0), "geen verlaging (Ts < 0) gevonden: {ts:?}");
    assert!(ts.iter().any(|&v| v == 0.0), "de verhoging hoort weer op 0 te gaan: {ts:?}");
}
