//! De PDF zegt waar de toetskrachten vandaan komen (issue #199, taak 7).
//!
//! # Wat er moet staan
//!
//! De UGT-toets rekent bij de toetsing van een model in de app altijd tweede
//! orde (P-Δ) met scheefstand; de resultaten en de BGT-toetsen volgen de
//! instellingen Analyse en Scheefstand. Het papier zegt dat op drie plaatsen:
//!
//!  1. de inleiding bij "Berekeningswijze en stabiliteit": twee berekeningen,
//!     de grens α_cr ≥ 10 alleen voor de resultaten, voor de toets informatief;
//!  2. de zin bij "Initiële scheefstand": in de toetskrachten altijd, in de
//!     resultaten alleen met de schakelaar aan;
//!  3. de krachtregel van elk toetsblok: "2e orde + scheefstand φ = 1/200" bij
//!     een UGT-toetscombinatie (ook de variant id + 1 000 000), "resultaten" bij
//!     een BGT-combinatie — alleen als de aanroeper `toetskrachten` meestuurt.
//!     Zonder dat veld blijft de regel zoals hij was: de kern ziet aan een
//!     `force_state` niet of hij uit een tweede-ordeberekening komt.
//!
//! # Hoe
//!
//! Zoals `rapportaanvulling_pdf.rs`: de inhoudsstromen worden uitgepakt en een
//! woord wordt met de ingesloten Liberation Sans naar zijn gliefreeks vertaald.
//! De helpers staan hier opnieuw; elke integratietest is een eigen crate.

use mechanics::{ForceStateSnapshot, InternalForces};
use nen_en_1993_1_1_section::{
    classification::CrossSectionClass, CheckStatus, ResistanceCalc, UnityCheck,
};
use report::{generate_report_pdf, ReportInput, ToetsCombinatieNaam, ToetskrachtenRapport};
use steel_check::result::{BeamCheckResult, CheckKind, NamedCheck};

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

/// Per teken het gliefnummer als vier hexcijfers, zoals printpdf een woord in
/// de stroom zet. Per WOORD: een alinea wordt in regels geknipt.
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

fn staat_erin(stroom: &str, woord: &str) -> bool {
    [FONT_REGULAR, FONT_BOLD].iter().any(|font| stroom.contains(&glief_hex(font, woord)))
}

/// Een weerstandstoets op combinatie `combinatie`.
fn toets(id: &str, combinatie: u32) -> NamedCheck {
    NamedCheck {
        id: id.into(),
        kind: CheckKind::Resistance(ResistanceCalc {
            deelstappen: Vec::new(),
            id: id.into(),
            title: format!("Toets {id}"),
            article: "EN 1993-1-1 §6.2.4".into(),
            force_state: ForceStateSnapshot {
                combination_id: combinatie,
                position_mm: 0.0,
                forces: InternalForces { n_ed: -100.0, vy_ed: 0.0, vz_ed: 5.0, mt_ed: 0.0, my_ed: 20.0, mz_ed: 0.0 },
            },
            formula_latex: "N_{c,Rd} = A · f_y / γ_{M0}".into(),
            variables: Vec::new(),
            value: 1000.0,
            unit: "kN".into(),
            uc: Some(UnityCheck { ed: 100.0, rd: 1000.0, uc: 0.1, formula_latex: "UC".into() }),
            status: CheckStatus::Ok,
            notes: Vec::new(),
        }),
    }
}

/// Een HEA 200-kolom met drie toetsen: UGT 6.10b (+x, id 7), dezelfde
/// combinatie in −x (id 1 000 007) en de karakteristieke BGT (id 17).
fn kolom() -> BeamCheckResult {
    BeamCheckResult {
        beam_id: 1,
        profile_name: "HEA200".into(),
        steel_grade: "S235".into(),
        classification: CrossSectionClass::Class1,
        checks: vec![toets("ugt_plus", 7), toets("ugt_min", 1_000_007), toets("bgt", 17)],
        uc_max: 0.1,
        status: CheckStatus::Ok,
        governing_check_id: "ugt_plus".into(),
        verloop: None,
    }
}

fn invoer(
    toetskrachten: Option<ToetskrachtenRapport>,
    analyse: Option<&str>,
    scheefstand: Option<&str>,
) -> ReportInput {
    ReportInput {
        bijlage: Default::default(),
        project_name: "Toetskrachten".into(),
        project_number: "TK-199".into(),
        engineer: "Constructeur".into(),
        company: "Ontwerpbureau".into(),
        date: "2026-10-15".into(),
        taal: Default::default(),
        steel_check_results: vec![kolom()],
        timber_check_results: Vec::new(),
        clt_check_results: Vec::new(),
        concrete_check_results: Vec::new(),
        stress_check_results: Vec::new(),
        concrete_stiffness_trace: None,
        concrete_dekkingslijnen: Vec::new(),
        concrete_reinforcement_zones: Vec::new(),
        scheefstand_toelichting: scheefstand.map(str::to_string),
        analyse_toelichting: analyse.map(str::to_string),
        toetskrachten,
        wind_toelichting: None,
        plate_results: Vec::new(),
        plate_inputs: Vec::new(),
        plate_skipped: Vec::new(),
    }
}

fn toets_200() -> Option<ToetskrachtenRapport> {
    Some(ToetskrachtenRapport { noemer: 200.0, tweede_orde_combinaties: vec![7, 1_000_007], combinaties: vec![] })
}

/// Dezelfde toetskrachten, met de namen van de combinaties zoals de app ze
/// meestuurt.
fn toets_200_met_namen() -> Option<ToetskrachtenRapport> {
    Some(ToetskrachtenRapport {
        noemer: 200.0,
        tweede_orde_combinaties: vec![7, 1_000_007],
        combinaties: vec![
            ToetsCombinatieNaam { id: 7, naam: "UGTplusx".into() },
            ToetsCombinatieNaam { id: 1_000_007, naam: "UGTminx".into() },
            ToetsCombinatieNaam { id: 17, naam: "BGTkar".into() },
        ],
    })
}

/// De combinatie bij naam (issue #199): de variant in −x draagt id + 1 000 000,
/// en dat id staat in geen combinatielijst van het model. Met de namen staat
/// er "Comb UGTminx …" en nergens "1000007".
#[test]
fn de_krachtregel_noemt_de_combinatie_bij_naam() {
    let s = inhoudsstromen(&generate_report_pdf(invoer(toets_200_met_namen(), None, None)));
    assert!(staat_erin(&s, "UGTminx"), "de naam van de variant in −x");
    assert!(staat_erin(&s, "UGTplusx"), "de naam van de variant in +x");
    assert!(staat_erin(&s, "BGTkar"), "de naam van de BGT-combinatie");
    assert!(!staat_erin(&s, "1000007"), "geen kaal id + 1 000 000 meer in de krachtregel");
    assert!(staat_erin(&s, "1/200)"), "de herkomst blijft erbij");
}

/// De krachtregel noemt de herkomst: 2e orde + scheefstand bij de UGT (ook de
/// variant in −x), "resultaten" bij de BGT.
#[test]
fn de_krachtregel_noemt_de_herkomst_van_de_toetskrachten() {
    let s = inhoudsstromen(&generate_report_pdf(invoer(toets_200(), None, None)));
    assert!(staat_erin(&s, "(2e"), "de UGT-krachtregel noemt \"2e orde\"");
    assert!(staat_erin(&s, "1/200)"), "de UGT-krachtregel noemt φ = 1/200");
    assert!(staat_erin(&s, "(resultaten)"), "de BGT-krachtregel noemt de resultaten");
    // De variant in −x heeft een eigen id; ook haar regel draagt de herkomst.
    assert!(staat_erin(&s, "1000007"), "de toetsvariant −x staat in het rapport");
}

/// Zonder `toetskrachten` (een eigen aanroep met zelf aangeleverde krachten)
/// blijft de krachtregel zoals hij was.
#[test]
fn zonder_toetskrachten_blijft_de_krachtregel_zoals_hij_was() {
    let s = inhoudsstromen(&generate_report_pdf(invoer(None, None, None)));
    assert!(!staat_erin(&s, "1/200)"), "geen φ in de krachtregel zonder toetskrachten");
    assert!(!staat_erin(&s, "(resultaten)"), "geen herkomst in de krachtregel zonder toetskrachten");
    assert!(staat_erin(&s, "Comb"), "de krachtregel zelf staat er wel");
}

/// De inleiding bij de berekeningswijze en de zin bij de scheefstand zeggen
/// dat de toetskrachten tweede orde met scheefstand zijn.
#[test]
fn inleiding_en_scheefstandzin_noemen_de_toetskrachten() {
    let s = inhoudsstromen(&generate_report_pdf(invoer(
        toets_200(),
        Some("Resultaten: 1e orde, zonder scheefstand."),
        Some("Scheefstand: vaste noemer uit de projectinstellingen."),
    )));
    // 1. De inleiding: twee berekeningen; α_cr is voor de toets informatief.
    assert!(staat_erin(&s, "berekeningen."), "de inleiding noemt twee berekeningen");
    assert!(staat_erin(&s, "informatief."), "α_cr is voor de toets informatief");
    assert!(
        !staat_erin(&s, "veronderstelt"),
        "de oude inleiding (\"veronderstelt bovendien krachten uit een tweede-orde-berekening\") is weg"
    );
    // 2. De scheefstandzin: in de resultaten alleen met de schakelaar aan.
    assert!(staat_erin(&s, "schakelaar"), "de scheefstandzin noemt de schakelaar van de resultaten");
}
