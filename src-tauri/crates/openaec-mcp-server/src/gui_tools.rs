//! `gui_tools` — de MCP-tools die de DRAAIENDE desktop-app bedienen.
//!
//! Dit zijn geen rekenkern-opdrachten en ze horen dus niet in de drie-wegen-
//! regel: zij *zijn* de weg naar de GUI. Elke tool is één-op-één een actie van
//! `bediening/bediening.ts` in de app (of, voor `gui_screenshot`, van
//! `gui_control.rs` in Rust), aangesproken over het bedieningskanaal:
//! `POST http://127.0.0.1:<poort>/opdracht` met een sessietoken.
//!
//! De app wordt gevonden via `gui-control.json` in haar app-datamap
//! (`%LOCALAPPDATA%\org.openaec.fem-studio\`), te overschrijven met
//! `OPENAEC_GUI_CONTROL_FILE`. Staat het daar niet, maar wel onder de vorige
//! identifier, dan draait een app tot en met 2026.39.1 en geldt dat bestand.
//! Ontbreekt het bestand of luistert er niets, dan komt er één duidelijke
//! fout: start de app met `OPENAEC_GUI_CONTROL=1`. Deze server start de app
//! niet zelf — dat hoort bij een testscript, niet bij een tool die ook door
//! een assistent wordt aangeroepen.
//!
//! Antwoorden gaan ongewijzigd door: `structuredContent` is precies wat de
//! actie teruggaf, en een toolfout draagt de tekst van de app.

use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

use crate::RpcError;

/// De tweeëntwintig tools. Eén lijst, gebruikt door `is_gui_tool`, de schema's en de
/// dispatch — zodat een tool niet in de lijst kan staan zonder afhandeling.
pub const GUI_TOOLS: [&str; 22] = [
    "gui_quit",
    "gui_status",
    "gui_load_model",
    "gui_build_model",
    "gui_build_3d_model",
    "gui_build_3d_steel_hall",
    "gui_import_ifc_analysis_model",
    "gui_configure_3d_view",
    "gui_select_3d_combination",
    "gui_select_member",
    "gui_select_3d_plate",
    "gui_split_3d_member",
    "gui_set_cage",
    "gui_set_analysis",
    "gui_solve",
    "gui_run_checks",
    "gui_open_curtailment",
    "gui_set_view",
    "gui_detach_report",
    "gui_read_checks",
    "gui_screenshot",
    "gui_export_report_pdf",
];

pub fn is_gui_tool(naam: &str) -> bool {
    GUI_TOOLS.contains(&naam)
}

// ── Het kanaal vinden ───────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Vindbestand {
    pid: u32,
    poort: u16,
    token: String,
    #[serde(default)]
    versie: String,
}

/// De identifier van de app; haar app-datamap heet zo. Gelijk aan
/// `identifier` in `src-tauri/tauri.conf.json` (zie de test onderaan).
const APP_IDENTIFIER: &str = "org.openaec.fem-studio";

/// De identifier tot en met uitgave 2026.39.1. Een app van die versie schrijft
/// haar vindbestand nog onder deze map.
const OUDE_APP_IDENTIFIER: &str = "org.openaec.fem2d-studio";

fn vindbestand_pad() -> Result<std::path::PathBuf, RpcError> {
    if let Ok(p) = std::env::var("OPENAEC_GUI_CONTROL_FILE") {
        return Ok(p.into());
    }
    let basis = std::env::var("LOCALAPPDATA")
        .map_err(|_| niet_bereikbaar("LOCALAPPDATA is niet gezet; zet OPENAEC_GUI_CONTROL_FILE"))?;
    Ok(kies_vindbestand(std::path::Path::new(&basis)))
}

/// Het vindbestand onder de identifier van deze versie. Bestaat dat niet,
/// maar dat onder de vorige identifier wel, dan dat (een oudere app). Bestaat
/// geen van beide, dan het nieuwe pad, voor de foutmelding.
fn kies_vindbestand(basis: &std::path::Path) -> std::path::PathBuf {
    let nieuw = basis.join(APP_IDENTIFIER).join("gui-control.json");
    if nieuw.exists() {
        return nieuw;
    }
    let oud = basis.join(OUDE_APP_IDENTIFIER).join("gui-control.json");
    if oud.exists() {
        oud
    } else {
        nieuw
    }
}

fn niet_bereikbaar(reden: impl std::fmt::Display) -> RpcError {
    RpcError::tool_exec(format!(
        "De app draait niet met bediening aan ({reden}). Start Open FEM Studio met de \
         omgevingsvariabele OPENAEC_GUI_CONTROL=1; hij schrijft dan gui-control.json in zijn \
         app-datamap en deze tools vinden hem daar."
    ))
}

fn kanaal() -> Result<Vindbestand, RpcError> {
    let pad = vindbestand_pad()?;
    let tekst = std::fs::read_to_string(&pad)
        .map_err(|e| niet_bereikbaar(format!("{} niet leesbaar: {e}", pad.display())))?;
    serde_json::from_str(&tekst)
        .map_err(|e| niet_bereikbaar(format!("{} onleesbaar: {e}", pad.display())))
}

/// Roep één actie aan over het kanaal. Synchroon; de dispatch zet dit op een
/// blocking-thread zodat de stdio-lus niet stilstaat.
fn roep(naam: &str, args: Value, tijdslimiet_s: u64) -> Result<Value, RpcError> {
    let k = kanaal()?;
    let url = format!("http://127.0.0.1:{}/opdracht", k.poort);
    let antwoord = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", k.token))
        .timeout(Duration::from_secs(tijdslimiet_s + 15))
        .send_json(json!({ "naam": naam, "args": args, "tijdslimiet_s": tijdslimiet_s }));

    let body: Value = match antwoord {
        Ok(r) => r
            .into_json()
            .map_err(|e| RpcError::tool_exec(format!("antwoord van de app onleesbaar: {e}")))?,
        Err(ureq::Error::Status(code, r)) => {
            let tekst = r.into_string().unwrap_or_default();
            return Err(RpcError::tool_exec(format!("de app antwoordde HTTP {code}: {tekst}")));
        }
        Err(ureq::Error::Transport(t)) => {
            return Err(niet_bereikbaar(format!(
                "pid {} op poort {} antwoordt niet: {t}",
                k.pid, k.poort
            )));
        }
    };

    if body.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(body.get("uitkomst").cloned().unwrap_or(Value::Null))
    } else {
        Err(RpcError::tool_exec(
            body.get("fout")
                .and_then(Value::as_str)
                .unwrap_or("de app meldde een fout zonder tekst")
                .to_string(),
        ))
    }
}

fn status() -> Result<Value, RpcError> {
    let k = kanaal()?;
    let url = format!("http://127.0.0.1:{}/status", k.poort);
    let basis: Value = ureq::get(&url)
        .timeout(Duration::from_secs(5))
        .call()
        .map_err(|e| niet_bereikbaar(format!("pid {} op poort {}: {e}", k.pid, k.poort)))?
        .into_json()
        .map_err(|e| RpcError::tool_exec(format!("status onleesbaar: {e}")))?;
    // De pagina weet meer (weergave, selectie, aantallen); haal dat erbij.
    let pagina = roep("status", json!({}), 10).unwrap_or(Value::Null);
    Ok(json!({
        "bereikbaar": true,
        "pid": k.pid,
        "poort": k.poort,
        "versie": if k.versie.is_empty() { basis["versie"].clone() } else { json!(k.versie) },
        "pagina": pagina,
    }))
}

// ── Dispatch ────────────────────────────────────────────────────────────────

fn lees<T: for<'de> Deserialize<'de>>(naam: &str, args: Value) -> Result<T, RpcError> {
    serde_json::from_value(args).map_err(|e| RpcError::invalid_params(format!("{naam}: {e}")))
}

#[derive(Deserialize)]
struct Leeg {}
#[derive(Deserialize)]
struct MetPad { path: String }
#[derive(Deserialize)]
struct MetId { id: u64 }
#[derive(Deserialize)]
struct MetBeamId { beam_id: u64 }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Splits3DStaaf { beam_id: u64, ratio: f64 }
/// `gui_build_3d_steel_hall`: de halparameters gaan ongewijzigd naar de
/// pagina; de generator in de app leest ze met zijn eigen strikte poort.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Staalhal { #[serde(default)] hal: Option<Value> }
/// `gui_import_ifc_analysis_model`: de app leest het bestand via Rust
/// (`gui_control.rs`) en importeert het met dezelfde functie als de knop
/// "Rekenmodel importeren".
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IfcImport {
    path: String,
    #[serde(default)]
    analysis_model: Option<Value>,
}
#[derive(Deserialize)]
struct Korf { beam_id: u64, cage: Value }
#[derive(Deserialize)]
struct Analyse { analysis_type: String }
#[derive(Deserialize)]
struct Weergave { view: String }
#[derive(Deserialize)]
struct Schermafdruk {
    #[serde(default = "hoofdvenster")]
    window: String,
    path: String,
    #[serde(default)]
    dom: bool,
}
fn hoofdvenster() -> String { "main".into() }

/// `gui_export_report_pdf`. Strikt: een tikfout in een veldnaam (bijvoorbeeld
/// `reporttype`) is een fout, geen stil genegeerd veld dat een ander rapport
/// oplevert dan gevraagd.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RapportExport {
    path: String,
    #[serde(default)]
    report_type: Option<String>,
    #[serde(default)]
    page_size: Option<String>,
    #[serde(default)]
    orientation: Option<String>,
    #[serde(default)]
    project: Option<ProjectKop>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectKop {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    number: Option<String>,
    #[serde(default)]
    engineer: Option<String>,
    #[serde(default)]
    company: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

/// Eén keuze uit een vaste lijst, of een invalid_params met de toegestane waarden.
fn keuze(veld: &str, waarde: Option<String>, toegestaan: &[&str]) -> Result<Option<String>, RpcError> {
    match waarde {
        None => Ok(None),
        Some(v) if toegestaan.contains(&v.as_str()) => Ok(Some(v)),
        Some(v) => Err(RpcError::invalid_params(format!(
            "gui_export_report_pdf: `{veld}` must be one of {}, not {v:?}",
            toegestaan.join(" | ")
        ))),
    }
}

/// Vertaal de MCP-argumenten naar de kanaalopdracht `rapport_pdf` (Nederlandse
/// veldnamen, zoals alle opdrachten van `gui_control.rs`). Los van het aanroepen,
/// zodat de vertaling zonder draaiende app te toetsen is.
fn rapport_pdf_args(a: RapportExport) -> Result<Value, RpcError> {
    let pad = std::path::Path::new(&a.path);
    if !pad.is_absolute() {
        return Err(RpcError::invalid_params(format!(
            "gui_export_report_pdf: `path` must be absolute, not {:?}",
            a.path
        )));
    }
    let is_pdf = pad
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err(RpcError::invalid_params(format!(
            "gui_export_report_pdf: `path` must end in .pdf, not {:?}",
            a.path
        )));
    }
    let mut uit = serde_json::Map::new();
    uit.insert("pad".into(), json!(a.path));
    if let Some(t) = keuze("report_type", a.report_type, &["volledig", "beperkt"])? {
        uit.insert("type".into(), json!(t));
    }
    if let Some(f) = keuze("page_size", a.page_size, &["A4", "A3"])? {
        uit.insert("formaat".into(), json!(f));
    }
    if let Some(o) = keuze("orientation", a.orientation, &["portrait", "landscape"])? {
        uit.insert("orientatie".into(), json!(o));
    }
    if let Some(p) = a.project {
        let mut kop = serde_json::Map::new();
        for (k, v) in [
            ("naam", p.name),
            ("nummer", p.number),
            ("constructeur", p.engineer),
            ("bedrijf", p.company),
            ("datum", p.date),
        ] {
            if let Some(v) = v {
                kop.insert(k.into(), json!(v));
            }
        }
        uit.insert("project".into(), Value::Object(kop));
    }
    Ok(Value::Object(uit))
}

/// Het rapport exporteren en de PDF terugleveren. De bytes komen uit het
/// GESCHREVEN BESTAND, niet uit een tweede afdruk: wat de client als base64
/// krijgt, is precies wat op schijf staat en wat de app heeft gecontroleerd.
fn export_report_pdf(args: Value) -> Result<Value, RpcError> {
    let a: RapportExport = lees("gui_export_report_pdf", args)?;
    let kanaal_args = rapport_pdf_args(a)?;
    // Ruim: de app wacht op rekenen, toetsen en paginering vóór hij print.
    let uit = roep("rapport_pdf", kanaal_args, 300)?;
    let geschreven = uit
        .get("pad")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::tool_exec("de app gaf geen pad van de PDF terug"))?
        .to_string();
    let bytes = std::fs::read(&geschreven)
        .map_err(|e| RpcError::tool_exec(format!("de PDF op {geschreven} is niet te lezen: {e}")))?;
    if let Some(gemeld) = uit.get("bytes").and_then(Value::as_u64) {
        if gemeld != bytes.len() as u64 {
            return Err(RpcError::tool_exec(format!(
                "de PDF op {geschreven} is veranderd tussen schrijven en lezen ({gemeld} → {} bytes)",
                bytes.len()
            )));
        }
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err(RpcError::tool_exec(format!("{geschreven} is geen PDF")));
    }
    Ok(json!({
        "path": geschreven,
        "bytes": bytes.len(),
        "pages": uit.get("paginas").cloned().unwrap_or(Value::Null),
        "sheets": uit.get("vellen").cloned().unwrap_or(Value::Null),
        "report_type": uit.get("rapportType").cloned().unwrap_or(Value::Null),
        "page_size": uit.get("formaat").cloned().unwrap_or(Value::Null),
        "orientation": uit.get("orientatie").cloned().unwrap_or(Value::Null),
        "pdf_base64": base64::engine::general_purpose::STANDARD.encode(&bytes),
        // Wat de app over dit document meldt (kop, toetsing, analysetype, wat er
        // is teruggezet) — in de woorden van de app.
        "details": uit,
    }))
}

/// Een API-commando (src/api/ in de app) uitvoeren in de draaiende app, via de
/// paginaopdracht `api_uitvoeren`. De pagina antwoordt altijd met
/// `{ ok, output }` of `{ ok: false, error: { code, melding, detail } }`, zodat
/// de foutcode van het register hier heel aankomt (het kanaal zelf kent alleen
/// een fouttekst).
pub(crate) fn roep_api(naam: &str, invoer: Value) -> Result<Value, RpcError> {
    let uit = roep("api_uitvoeren", json!({ "name": naam, "input": invoer }), 60)?;
    if uit.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(uit.get("output").cloned().unwrap_or(Value::Null));
    }
    let fout = uit.get("error").cloned().unwrap_or(Value::Null);
    let code = fout.get("code").and_then(Value::as_str).unwrap_or("INTERN").to_owned();
    let melding = fout
        .get("melding")
        .and_then(Value::as_str)
        .unwrap_or("de app meldde een fout zonder tekst")
        .to_owned();
    let remedie = openaec_mcp_server::sidecar::remedie_voor_code(&code);
    Err(RpcError {
        code: if code == "INVOER_ONGELDIG" { -32602 } else { -32000 },
        message: format!("[{code}] {melding} — {remedie}"),
        data: Some(json!({
            "error_code": code,
            "melding": melding,
            "remedie": remedie,
            "detail": fout.get("detail").cloned().unwrap_or(Value::Null),
        })),
    })
}

pub async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    let naam = naam.to_string();
    // ureq is synchroon; buiten de stdio-lus houden.
    tokio::task::spawn_blocking(move || dispatch_sync(&naam, args))
        .await
        .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?
}

fn dispatch_sync(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        "gui_status" => {
            let _: Leeg = lees(naam, args)?;
            status()
        }
        "gui_load_model" => {
            let a: MetPad = lees(naam, args)?;
            roep("model_laden", json!({ "pad": a.path }), 60)
        }
        "gui_build_model" => roep("model_bouwen", args, 60),
        "gui_build_3d_model" => roep("model_3d_bouwen", args, 60),
        "gui_build_3d_steel_hall" => {
            let a: Staalhal = lees(naam, args)?;
            roep("staalhal_maken", json!({ "hal": a.hal.unwrap_or_else(|| json!({})) }), 60)
        }
        "gui_import_ifc_analysis_model" => {
            let a: IfcImport = lees(naam, args)?;
            let mut opdracht = json!({ "pad": a.path });
            if let Some(keuze) = a.analysis_model {
                let geldig = keuze.as_str().is_some_and(|s| !s.trim().is_empty()) || keuze.as_u64().is_some_and(|n| n >= 1);
                if !geldig {
                    return Err(RpcError::invalid_params(
                        "gui_import_ifc_analysis_model: `analysis_model` is the model name or its 1-based number",
                    ));
                }
                opdracht["analysemodel"] = keuze;
            }
            roep("ifc_analysemodel_importeren", opdracht, 120)
        }
        "gui_configure_3d_view" => roep("weergave_3d_configureren", args, 30),
        "gui_select_3d_combination" => {
            let a: MetId = lees(naam, args)?;
            roep("resultaat_3d_kiezen", json!({ "id": a.id }), 30)
        }
        "gui_select_member" => {
            let a: MetId = lees(naam, args)?;
            roep("staaf_selecteren", json!({ "id": a.id }), 30)
        }
        "gui_select_3d_plate" => {
            let a: MetId = lees(naam, args)?;
            roep("plaat_3d_selecteren", json!({ "id": a.id }), 30)
        }
        "gui_split_3d_member" => {
            let a: Splits3DStaaf = lees(naam, args)?;
            if !a.ratio.is_finite() || a.ratio <= 1e-6 || a.ratio >= 1.0 - 1e-6 {
                return Err(RpcError::invalid_params(
                    "gui_split_3d_member: `ratio` must lie strictly between 0 and 1",
                ));
            }
            roep(
                "staaf_3d_splitsen",
                json!({ "beamId": a.beam_id, "ratio": a.ratio }),
                30,
            )
        }
        "gui_set_cage" => {
            let a: Korf = lees(naam, args)?;
            roep("korf_zetten", json!({ "beamId": a.beam_id, "korf": a.cage }), 30)
        }
        "gui_set_analysis" => {
            let a: Analyse = lees(naam, args)?;
            roep("analysetype_zetten", json!({ "analysetype": a.analysis_type }), 30)
        }
        "gui_solve" => {
            let _: Leeg = lees(naam, args)?;
            roep("rekenen", json!({}), 120)
        }
        "gui_run_checks" => {
            let _: Leeg = lees(naam, args)?;
            roep("toetsen", json!({}), 300)
        }
        "gui_open_curtailment" => {
            let a: MetBeamId = lees(naam, args)?;
            roep("dekkingslijn_openen", json!({ "beamId": a.beam_id }), 180)
        }
        "gui_set_view" => {
            let a: Weergave = lees(naam, args)?;
            roep("weergave_zetten", json!({ "view": a.view }), 30)
        }
        "gui_detach_report" => {
            let _: Leeg = lees(naam, args)?;
            roep("rapport_losmaken", json!({}), 60)
        }
        "gui_read_checks" => {
            let _: Leeg = lees(naam, args)?;
            roep("toetsen_uitlezen", json!({}), 30)
        }
        "gui_screenshot" => {
            let a: Schermafdruk = lees(naam, args)?;
            roep(
                "screenshot",
                json!({ "venster": a.window, "pad": a.path, "dom": a.dom }),
                60,
            )
        }
        "gui_quit" => {
            let _: Leeg = lees(naam, args)?;
            roep("afsluiten", json!({}), 10)
        }
        "gui_export_report_pdf" => export_report_pdf(args),
        anders => Err(RpcError::method_not_found(anders)),
    }
}

// ── Schema's ────────────────────────────────────────────────────────────────

fn leeg_schema() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

pub fn tool_definitions() -> Vec<Value> {
    let vooraf = "Drives the RUNNING Open FEM Studio desktop app through its control channel \
                  (the app must be started with OPENAEC_GUI_CONTROL=1). ";
    vec![
        json!({
            "name": "gui_status",
            "description": format!("{vooraf}Reports whether the app is reachable, its pid/port/version, and what the page sees: active view, selection, member count, whether checks are running."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_load_model",
            "description": format!("{vooraf}Loads a project file (.femp / .ifcfem / .ifcfem2d) into the app. The file is read by the app process itself, so any path the app can read works."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": { "path": { "type": "string", "description": "Absolute path to the project file." } } }
        }),
        json!({
            "name": "gui_build_model",
            "description": format!("{vooraf}Builds a model in the app from scratch through the same store actions the canvas uses. Coordinates in mm; loads per the app's Load type. A new project already holds the load cases \"Eigen gewicht\" (id 5, marked `eigenGewicht`: filled automatically with q = ρ·A·g per member, read-only — a load with that caseId is refused), \"Permanent (G)\" (id 1), \"Variabel (Q)\" (2), \"Sneeuw (S)\" (3) and \"Wind (W)\" (4); the result returns the load cases as they stand (`loadCases`, with `eigenGewicht` on the automatic one) and `selfWeightEnabled`."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "nodes": { "type": "array", "items": { "type": "object", "properties": { "x": {"type":"number"}, "z": {"type":"number"} }, "required": ["x","z"] } },
                    "beams": { "type": "array", "items": { "type": "object", "properties": { "from": {"type":"integer"}, "to": {"type":"integer"}, "updates": {"type":"object"} }, "required": ["from","to"] }, "description": "from/to are 1-based indices into `nodes`; `updates` is a Partial<Beam> applied after creation (material, profileName, betonKorf, ...)." },
                    "supports": { "type": "array", "items": { "type": "object", "properties": { "node": {"type":"integer"}, "type": {"type":"string"}, "k": {"type":"number"} }, "required": ["node","type"] } },
                    "loads": { "type": "array", "items": { "type": "object" }, "description": "Load objects without id (the app assigns ids)." },
                    "load_cases": { "type": "array", "items": { "type": "string" } }
                } }
        }),
        json!({
            "name": "gui_build_3d_model",
            "description": format!("{vooraf}Replaces the active project with a 3D frame model and opens its 3D workspace. Coordinates are metres; from/to/node are 1-based indices into nodes. Member profile_name, material, roll_angle_deg, local end releases, tension_only and optional check_config are retained and feed the 3D view, solver, IFC and EN 1992/EN 1993 checks. Optional diaphragms couple X, Y and the rotation about Z of nodes at one height as a rigid horizontal plane. The model settings tension_only_fit_after_permanent (tension-only members fitted after the permanent load) and tension_only_cross_rule (of two crossing tension-only members one always stays active) go with the model. For concrete, check_config uses the same BeamCheckConfig fields as the properties panel (including betonKorf and optional betonKolom). Optional levels (horizontal structural-grid axes: label and height in metres) replace the levels of the structural grid; a node or plate with `level` (1-based index into levels) is linked to that level, so it moves along when the level height changes in the app. A linked node's z must equal the level height; a linked plate lies horizontally on the level with all its nodes. Optional load_panels carry a surface load (kN/m²) without stiffness to the beams in their plane; the app converts them into member and nodal loads before the frame kernel and reports per panel which members carry and any warning."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "levels": { "type": "array", "description": "Levels: horizontal structural-grid axes with a label and a height in metres (e.g. Ground 0, First floor 3). A label that already exists in the app keeps its identity.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "label": {"type":"string"}, "position_m": {"type":"number"} }, "required": ["label","position_m"] } },
                    "nodes": { "type": "array", "items": { "type": "object", "additionalProperties": false,
                        "properties": { "x": {"type":"number"}, "y": {"type":"number"}, "z": {"type":"number"},
                            "level": {"type":"integer","minimum":1,"description":"1-based index into levels: the node is linked to that level; z must equal its height."} }, "required": ["x","y","z"] } },
                    "beams": { "type": "array", "items": { "type": "object", "additionalProperties": false,
                        "properties": { "from": {"type":"integer","minimum":1}, "to": {"type":"integer","minimum":1}, "profile_name": {"type":"string"}, "material": {"type":"string"},
                            "roll_angle_deg": {"type":"number","description":"Rotation of local y/z axes around the member axis, degrees."},
                            "releases": {"type":"object","additionalProperties":false,"description":"Released local end moments/torsion.",
                                "properties":{"my_start":{"type":"boolean"},"my_end":{"type":"boolean"},"mz_start":{"type":"boolean"},"mz_end":{"type":"boolean"},"torsion_start":{"type":"boolean"},"torsion_end":{"type":"boolean"}}},
                            "tension_only": {"type":"boolean","description":"Tension-only member (e.g. a round-bar wind brace): it drops out of a load case or combination in which it would be in compression (axial force 0)."},
                            "check_config": {"type":"object","additionalProperties":true} }, "required": ["from","to"] } },
                    "supports": { "type": "array", "description":"A support needs a rigid preset, one or more global springs, or both on different DOFs. Springs are kN/m or kNm/rad. Prescribed translations are m and rotations rad and need a matching rigid preset DOF.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "node": {"type":"integer","minimum":1}, "type": {"type":"string","enum":["fixed","pinned","xRoller","yRoller","zRoller","revoluteX","revoluteY","revoluteZ"]},
                            "springs":{"type":"object","additionalProperties":false,"properties":{
                                "kx_kn_per_m":{"type":"number","exclusiveMinimum":0},"ky_kn_per_m":{"type":"number","exclusiveMinimum":0},"kz_kn_per_m":{"type":"number","exclusiveMinimum":0},
                                "krx_knm_per_rad":{"type":"number","exclusiveMinimum":0},"kry_knm_per_rad":{"type":"number","exclusiveMinimum":0},"krz_knm_per_rad":{"type":"number","exclusiveMinimum":0}
                            }},
                            "prescribed":{"type":"object","additionalProperties":false,"properties":{
                                "ux_m":{"type":"number"},"uy_m":{"type":"number"},"uz_m":{"type":"number"},
                                "rx_rad":{"type":"number"},"ry_rad":{"type":"number"},"rz_rad":{"type":"number"}
                            }} }, "required": ["node"] } },
                    "loads": { "type": "array", "items": { "type": "object", "additionalProperties": false,
                        "properties": { "node": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "fx": {"type":"number"}, "fy": {"type":"number"}, "fz": {"type":"number"}, "mx": {"type":"number"}, "my": {"type":"number"}, "mz": {"type":"number"} }, "required": ["node"] } }
                    ,"member_loads": { "type": "array", "description": "Trapezoidal loads in local member y/z axes, kN/m; positions are metres from member start. case_id selects the shared project load case (default 1).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "beam": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "qy_start": {"type":"number"}, "qy_end": {"type":"number"}, "qz_start": {"type":"number"}, "qz_end": {"type":"number"}, "start_m": {"type":"number","minimum":0}, "end_m": {"type":"number","exclusiveMinimum":0} }, "required": ["beam"] } }
                    ,"member_point_loads": { "type": "array", "description": "Concentrated loads in local member y/z axes, kN; position_m is metres from member start. case_id selects the shared project load case (default 1).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "beam": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "py": {"type":"number"}, "pz": {"type":"number"}, "position_m": {"type":"number","minimum":0} }, "required": ["beam","position_m"] } }
                    ,"thermal_loads": { "type": "array", "description": "Member temperature loads in K. The optional gradients act over the local y/z section directions.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "beam": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "delta_t_uniform_k": {"type":"number"}, "delta_t_gradient_y_k": {"type":"number"}, "delta_t_gradient_z_k": {"type":"number"} }, "required": ["beam"] } }
                    ,"plates": { "type": "array", "description": "Polygonal plates. nodes contains the ordered 1-based node indices; openings use the same format. Thickness and corner radii are metres.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "nodes": {"type":"array","minItems":3,"items":{"type":"integer","minimum":1}}, "thickness_m":{"type":"number","exclusiveMinimum":0}, "material":{"type":"string"}, "corner_radius_m":{"type":"number","minimum":0},
                            "level":{"type":"integer","minimum":1,"description":"1-based index into levels: the plate lies horizontally on that level together with all its nodes (also those of its openings)."},
                            "openings":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"nodes":{"type":"array","minItems":3,"items":{"type":"integer","minimum":1}},"corner_radius_m":{"type":"number","minimum":0}},"required":["nodes"]}} }, "required": ["nodes"] } }
                    ,"surface_loads": { "type": "array", "description": "Global plate surface loads in kN/m².",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "plate":{"type":"integer","minimum":1}, "case_id":{"type":"integer","minimum":1}, "qx":{"type":"number"}, "qy":{"type":"number"}, "qz":{"type":"number"} }, "required": ["plate"] } }
                    ,"diaphragms": { "type": "array", "description": "Rigid horizontal diaphragms (e.g. a hollow-core floor with a structural topping): X, Y and the rotation about Z of the nodes move as one rigid body; Z and the rotations about X and Y stay free per node. nodes are 1-based node indices (at least 2) at one height within 1 mm; a node belongs to at most one diaphragm, and at most one of its nodes may hold the diaphragm in its plane (a support in X, Y or rotation about Z).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "nodes": {"type":"array","minItems":2,"items":{"type":"integer","minimum":1}}, "name": {"type":"string"} }, "required": ["nodes"] } }
                    ,"tension_only_fit_after_permanent": { "type": "boolean", "default": false,
                        "description": "Model setting: tension-only members are fitted after the permanent load. Their stress-free length follows the deformation under the permanent load cases (type dead, factor 1.0, including self-weight and load panels), so under that load alone they carry nothing; the result lists the fitting elongation per member." }
                    ,"tension_only_cross_rule": { "type": "boolean", "default": false,
                        "description": "Model setting (cross rule): of two tension-only members that cross each other in their interiors (axes within 1 mm, no shared end node), the one with the largest axial force always stays active, even with a small compressive force. Three or more members through one point do not count." }
                    ,"load_panels": { "type": "array", "description": "Load panels: a plane polygon over existing nodes without stiffness that transfers its load to the beams in that plane. nodes are the ordered 1-based corner node indices (at least 3, in one plane). q is kN/m² and non-zero. direction gravity acts in global -Z per m² HORIZONTAL PROJECTION (snow, floors, finishes); direction normal acts perpendicular to the panel per m² panel along a fixed normal that points down (for a vertical panel -Y, for a panel parallel to YZ -X), a negative q reverses it (suction). distribution oneWay sends every point along span_direction (a global vector, projected onto the panel; required for oneWay) to the nearest beam transverse to the span (at most 10 degrees off): half the distance to the neighbours as loaded width, edge beams half a strip; beams along the span and skewed members such as bracing get nothing. distribution twoWay sends every point to the nearest beam in the panel: 45-degree lines, triangles and trapezoids on four edge beams. A beam counts when both end nodes lie on the edge or inside the panel (1 mm). An edge without a beam sends its load to the nearest beam with a warning; a panel without any beam blocks the calculation. excluded_beams are 1-based member indices that get no load. case_id selects the shared project load case (default 1).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": {
                            "nodes": {"type":"array","minItems":3,"items":{"type":"integer","minimum":1}},
                            "case_id": {"type":"integer","minimum":1},
                            "q": {"type":"number","description":"kN/m², non-zero."},
                            "direction": {"type":"string","enum":["gravity","normal"]},
                            "distribution": {"type":"string","enum":["oneWay","twoWay"]},
                            "span_direction": {"type":"object","additionalProperties":false,"required":["x","y","z"],
                                "description":"Global span direction; projected onto the panel. Required for oneWay.",
                                "properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}}},
                            "excluded_beams": {"type":"array","items":{"type":"integer","minimum":1}}
                        }, "required": ["nodes","q","direction","distribution"] } }
                } }
        }),
        json!({
            "name": "gui_build_3d_steel_hall",
            "description": format!("{vooraf}Builds a steel hall in the app with the same generator as the \"Stalen hal…\" wizard (and the MCP tool open_fem_3d_staalhal_maken): frames, purlins, eaves beams, roof and wall bracing, loads G/S/W and self-weight, optionally on a concrete beam grid on piles. Replaces the 3D model as ONE undo step, adds the hall's load cases to the project where missing (existing cases are kept and reused by name), sets the structural grid and opens the 3D workspace fitted to the model. Returns the counts, the project load-case ids and the member ids per group."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": { "hal": crate::staalhal_tools::hal_schema() } }
        }),
        json!({
            "name": "gui_import_ifc_analysis_model",
            "description": format!("{vooraf}Imports an IFC4 structural analysis model (Structural Analysis View) as a NEW 3D project, exactly as the button \"Rekenmodel importeren\" on the IFC ribbon tab does (and the MCP tool open_fem_3d_ifc_importeren, which works without the app): nodes, supports and springs, members with profile, material, roll and end releases, tension-only members, rigid diaphragms, load panels, member and nodal loads, load cases, combinations and levels. The app reads the file itself. Unsaved work in the app is replaced without asking. Returns the report: counts, tension-only members, diaphragms, explanations, warnings and everything that was not imported. With several analysis models in the file, `analysis_model` (name or 1-based number) is required; without it the error lists the models."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": {
                    "path": { "type": "string", "minLength": 1, "description": "Absolute path to the .ifc file (IFC4, STEP)." },
                    "analysis_model": crate::ifc_import_tools::analysemodel_schema()
                } }
        }),
        json!({
            "name": "gui_configure_3d_view",
            "description": format!("{vooraf}Configures the current 3D workspace: camera, visible objects, profile volumes and structural grid (grid axes and levels). Structural-grid positions are metres. z_levels are the levels: a level whose label already exists keeps its identity, so nodes and plates linked to it move to its new height; the app refuses a change that would leave a member without length or a plate out of plane, and then nothing changes."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "view": { "type": "string", "enum": ["iso","top","front","side"] },
                    "visibility": { "type": "object", "additionalProperties": false,
                        "properties": {
                            "nodes":{"type":"boolean"}, "beams":{"type":"boolean"}, "plates":{"type":"boolean"}, "profiles":{"type":"boolean"},
                            "nodeNumbers":{"type":"boolean"}, "beamNumbers":{"type":"boolean"}, "nodeCoordinates":{"type":"boolean"},
                            "supports":{"type":"boolean"}, "loads":{"type":"boolean"}, "loadPanels":{"type":"boolean"}, "grid":{"type":"boolean"},
                            "axes":{"type":"boolean"}, "structuralGrid":{"type":"boolean"},
                            "deformation":{"type":"boolean"}, "reactions":{"type":"boolean"},
                            "utilization":{"type":"boolean"}, "axialForce":{"type":"boolean"},
                            "shearY":{"type":"boolean"}, "shearZ":{"type":"boolean"},
                            "torsion":{"type":"boolean"}, "momentY":{"type":"boolean"}, "momentZ":{"type":"boolean"}
                        } },
                    "structural_grid": { "type": "object", "additionalProperties": false,
                        "properties": {
                            "enabled":{"type":"boolean"},
                            "x_axes":{"$ref":"#/$defs/axisList"},
                            "y_axes":{"$ref":"#/$defs/axisList"},
                            "z_levels":{"$ref":"#/$defs/axisList"}
                        } }
                },
                "$defs": { "axisList": { "type":"array", "items": { "type":"object", "additionalProperties":false,
                    "properties": { "label":{"type":"string"}, "position_m":{"type":"number"} }, "required":["label","position_m"] } } }
            }
        }),
        json!({
            "name": "gui_select_member",
            "description": format!("{vooraf}Selects one member (beam) in the app, as if clicked on the canvas."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["id"],
                "properties": { "id": { "type": "integer" } } }
        }),
        json!({
            "name": "gui_select_3d_plate",
            "description": format!("{vooraf}Selects one 3D plate in the app, enabling plate properties, openings and surface-load commands."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["id"],
                "properties": { "id": { "type": "integer", "minimum": 1 } } }
        }),
        json!({
            "name": "gui_split_3d_member",
            "description": format!("{vooraf}Splits one 3D frame member at a relative position measured from its start node. The new internal node is rigid; section, material, roll and check settings are retained. Distributed, point and thermal member loads are transferred exactly, and only the original outside end releases remain."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["beam_id", "ratio"],
                "properties": {
                    "beam_id": { "type": "integer", "minimum": 1 },
                    "ratio": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 1,
                        "description": "Relative split position from the member start, for example 0.5 for midspan." }
                } }
        }),
        json!({
            "name": "gui_select_3d_combination",
            "description": format!("{vooraf}Selects one already calculated 3D UGT/BGT combination in the Results explorer and on the 3D canvas. Call gui_solve first; its combinationResultaten list contains the available ids."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["id"],
                "properties": { "id": { "type": "integer", "minimum": 1 } } }
        }),
        json!({
            "name": "gui_set_cage",
            "description": format!("{vooraf}Sets the reinforcement cage of a concrete member — the same ReinforcementCage shape `check_concrete_beam` takes (cover_mm, stirrup_diameter_mm, top/bottom rows, stirrup_spacing_mm, stirrup_legs). The app validates it with its own `controleerKorf`; a rejected cage comes back as the app's own message."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["beam_id", "cage"],
                "properties": { "beam_id": { "type": "integer" }, "cage": { "type": "object" } } }
        }),
        json!({
            "name": "gui_set_analysis",
            "description": format!("{vooraf}Sets the analysis type: eersteOrde, tweedeOrdeGeometrisch (P-Delta) or tweedeOrdeFysisch (P-Delta + physically non-linear concrete)."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["analysis_type"],
                "properties": { "analysis_type": { "type": "string", "enum": ["eersteOrde", "tweedeOrdeGeometrisch", "tweedeOrdeFysisch"] } } }
        }),
        json!({
            "name": "gui_solve",
            "description": format!("{vooraf}Runs the full calculation exactly as the Bereken button does and returns only when analysis and checks are finished. For 2D this covers all load cases/combinations and the physically non-linear concrete round when selected. For 3D it runs the P-Delta frame analysis, eigenvalue buckling, all six local member-force components, reactions, and EN 1992/EN 1993 checks. A 3D answer contains the complete result plus steel/concrete results and explicit skipped reasons."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_run_checks",
            "description": format!("{vooraf}Runs the current model and its code checks as the Toetsing button does, waits until everything is done, and returns the results per member — or the app's error text. In 3D this returns the P-Delta/buckling result together with EN 1993 steel and EN 1992 concrete checks."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_open_curtailment",
            "description": format!("{vooraf}Selects a concrete member and opens the curtailment (dekkingslijn) panel, waits for the kernel answer, and returns {{verzoek, antwoord}}: the exact DekkingslijnVerzoek the panel sent and the DekkingslijnAntwoord it got back — replay `verzoek` through `concrete_dekkingslijn` to verify the GUI against the engine. Or the panel's error text."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["beam_id"],
                "properties": { "beam_id": { "type": "integer" } } }
        }),
        json!({
            "name": "gui_set_view",
            "description": format!("{vooraf}Switches the main window view: default (canvas), check, report, insights, ifc, viewer."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["view"],
                "properties": { "view": { "type": "string" } } }
        }),
        json!({
            "name": "gui_detach_report",
            "description": format!("{vooraf}Opens the live report in its own window and returns that window's Tauri label (for gui_screenshot)."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_read_checks",
            "description": format!("{vooraf}Reads the current check results without re-running them. For a 3D project the answer includes the full 3D solve result, steel checks, concrete checks, running state and any solve/check error."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_screenshot",
            "description": format!("{vooraf}Captures a window of the app to a PNG file: real pixels via PrintWindow (default), or with dom=true a DOM render via html2canvas. `window` is the Tauri label: main, or the label gui_detach_report returned."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": {
                    "window": { "type": "string", "default": "main" },
                    "path": { "type": "string", "description": "Absolute path of the PNG to write." },
                    "dom": { "type": "boolean", "default": false }
                } }
        }),
        json!({
            "name": "gui_export_report_pdf",
            "description": format!("{vooraf}Exports the app's STANDARD REPORT — the live report, volledig or beperkt, the same document File → Print → Save as PDF gives — to a PDF file, and returns it as base64 as well. Requires a current calculation and check (call gui_solve first): the tool REFUSES with the reason when there are no results, when they are stale, when a calculation or check is still running or scheduled, or when the check failed. A model without checkable members is valid; the report then states that nothing was checked. report_type, page_size, orientation and project apply to THIS export only and are restored afterwards — the user's settings and what Save writes to the project file do not change. Waits for an explicit ready signal (pagination done, table of contents settled, fonts loaded) instead of a fixed delay. The main window switches to the report during the export and back afterwards; a minimized window is restored for the export and minimized again. Windows only (WebView2 PrintToPdf). The PDF is checked — %PDF header and page count equal to the report's sheet count — and on a mismatch no file is left at `path`. Returns {{path, bytes, pages, sheets, report_type, page_size, orientation, pdf_base64, details}}."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the PDF to write; must end in .pdf. An existing file is replaced." },
                    "report_type": { "type": "string", "enum": ["volledig", "beperkt"], "description": "Report preset: volledig (complete calculation, all chapters and derivations) or beperkt (the summary for the client). Omitted: the report settings currently in the app." },
                    "page_size": { "type": "string", "enum": ["A4", "A3"] },
                    "orientation": { "type": "string", "enum": ["portrait", "landscape"] },
                    "project": { "type": "object", "additionalProperties": false,
                        "description": "Project header for this export only. When given, ALL header text fields come from here (fields left out stay empty), so nothing of a previous project leaks into the header; the design basis (consequence class, design life) stays the one the calculation used. Omitted: the app's project settings.",
                        "properties": {
                            "name": { "type": "string" },
                            "number": { "type": "string" },
                            "engineer": { "type": "string" },
                            "company": { "type": "string" },
                            "date": { "type": "string", "description": "Printed as given; an ISO date (2026-09-15) is written out in Dutch." }
                        } }
                } }
        }),
        json!({
            "name": "gui_quit",
            "description": format!("{vooraf}Closes the app gracefully (through the app's own exit path, so its control file is cleaned up). Unsaved work is discarded — the app does not ask."),
            "inputSchema": leeg_schema()
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Een lege werkmap voor de vindbestandtest.
    fn lege_map(naam: &str) -> std::path::PathBuf {
        let pad = std::env::temp_dir().join(format!("gui-tools-{naam}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pad);
        std::fs::create_dir_all(&pad).unwrap();
        pad
    }

    fn leg_vindbestand(basis: &std::path::Path, identifier: &str) -> std::path::PathBuf {
        let map = basis.join(identifier);
        std::fs::create_dir_all(&map).unwrap();
        let pad = map.join("gui-control.json");
        std::fs::write(&pad, r#"{"pid":1,"poort":1,"token":"x"}"#).unwrap();
        pad
    }

    #[test]
    fn vindbestand_eerst_onder_de_nieuwe_identifier_dan_de_oude() {
        let basis = lege_map("vind");
        let nieuw = basis.join(APP_IDENTIFIER).join("gui-control.json");
        // Geen van beide: het nieuwe pad, zodat de melding daarnaar wijst.
        assert_eq!(kies_vindbestand(&basis), nieuw);
        // Alleen een app tot en met 2026.39.1: diens bestand.
        let oud = leg_vindbestand(&basis, OUDE_APP_IDENTIFIER);
        assert_eq!(kies_vindbestand(&basis), oud);
        // Beide: de nieuwe gaat voor.
        assert_eq!(leg_vindbestand(&basis, APP_IDENTIFIER), nieuw);
        assert_eq!(kies_vindbestand(&basis), nieuw);
        std::fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn identifier_is_die_van_tauri_conf() {
        let pad = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("tauri.conf.json");
        let conf: Value = serde_json::from_str(&std::fs::read_to_string(pad).unwrap()).unwrap();
        assert_eq!(conf["identifier"], APP_IDENTIFIER);
        assert_ne!(APP_IDENTIFIER, OUDE_APP_IDENTIFIER);
    }

    #[test]
    fn elke_tool_heeft_een_schema_en_andersom() {
        let defs = tool_definitions();
        assert_eq!(defs.len(), GUI_TOOLS.len());
        for d in &defs {
            let naam = d["name"].as_str().unwrap();
            assert!(is_gui_tool(naam), "{naam} ontbreekt in GUI_TOOLS");
        }
    }

    fn export(args: Value) -> Result<Value, RpcError> {
        rapport_pdf_args(lees("gui_export_report_pdf", args)?)
    }

    fn absoluut(naam: &str) -> String {
        std::env::temp_dir().join(naam).to_string_lossy().into_owned()
    }

    #[test]
    fn export_vertaalt_naar_de_kanaalopdracht() {
        let pad = absoluut("rapport.pdf");
        let uit = export(json!({
            "path": pad,
            "report_type": "beperkt",
            "page_size": "A3",
            "orientation": "landscape",
            "project": { "name": "Loods", "number": "P-12", "date": "2026-09-15" }
        }))
        .unwrap();
        assert_eq!(
            uit,
            json!({
                "pad": pad,
                "type": "beperkt",
                "formaat": "A3",
                "orientatie": "landscape",
                "project": { "naam": "Loods", "nummer": "P-12", "datum": "2026-09-15" }
            })
        );
        // Alleen het pad: de app gebruikt dan haar eigen rapportinstellingen.
        assert_eq!(export(json!({ "path": pad })).unwrap(), json!({ "pad": pad }));
    }

    #[test]
    fn export_weigert_onbekende_velden_en_waarden() {
        let pad = absoluut("rapport.pdf");
        assert!(export(json!({ "path": pad, "reporttype": "beperkt" })).is_err());
        assert!(export(json!({ "path": pad, "report_type": "kort" })).is_err());
        assert!(export(json!({ "path": pad, "page_size": "A5" })).is_err());
        assert!(export(json!({ "path": pad, "orientation": "staand" })).is_err());
        assert!(export(json!({ "path": pad, "project": { "naam": "Loods" } })).is_err());
        assert!(export(json!({ "path": "rapport.pdf" })).is_err(), "relatief pad");
        assert!(export(json!({ "path": absoluut("rapport.png") })).is_err(), "geen .pdf");
        assert!(export(json!({})).is_err(), "pad ontbreekt");
    }

    #[test]
    fn het_schema_van_de_export_is_strikt() {
        let defs = tool_definitions();
        let d = defs
            .iter()
            .find(|d| d["name"] == "gui_export_report_pdf")
            .expect("gui_export_report_pdf heeft een schema");
        let s = &d["inputSchema"];
        assert_eq!(s["additionalProperties"], json!(false));
        assert_eq!(s["required"], json!(["path"]));
        assert_eq!(s["properties"]["project"]["additionalProperties"], json!(false));
        assert_eq!(s["properties"]["report_type"]["enum"], json!(["volledig", "beperkt"]));
    }

    #[test]
    fn het_3d_schema_draagt_toetsing_revolutes_en_resultaatlagen() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let beam = &bouw["inputSchema"]["properties"]["beams"]["items"]["properties"];
        assert_eq!(beam["check_config"]["type"], json!("object"));
        assert_eq!(beam["roll_angle_deg"]["type"], json!("number"));
        assert_eq!(beam["releases"]["additionalProperties"], json!(false));
        assert_eq!(beam["releases"]["properties"]["torsion_end"]["type"], json!("boolean"));
        let member_load = &bouw["inputSchema"]["properties"]["member_loads"]["items"];
        assert_eq!(member_load["additionalProperties"], json!(false));
        assert_eq!(member_load["properties"]["qz_start"]["type"], json!("number"));
        assert_eq!(member_load["properties"]["case_id"]["minimum"], json!(1));
        let point_load = &bouw["inputSchema"]["properties"]["member_point_loads"]["items"];
        assert_eq!(point_load["additionalProperties"], json!(false));
        assert_eq!(point_load["properties"]["position_m"]["minimum"], json!(0));
        assert_eq!(point_load["required"], json!(["beam", "position_m"]));
        let thermal = &bouw["inputSchema"]["properties"]["thermal_loads"]["items"];
        assert_eq!(thermal["additionalProperties"], json!(false));
        assert_eq!(thermal["properties"]["delta_t_gradient_z_k"]["type"], json!("number"));
        assert_eq!(bouw["inputSchema"]["properties"]["loads"]["items"]["properties"]["case_id"]["type"], json!("integer"));
        let plate = &bouw["inputSchema"]["properties"]["plates"]["items"];
        assert_eq!(plate["properties"]["nodes"]["minItems"], json!(3));
        assert_eq!(plate["properties"]["openings"]["items"]["additionalProperties"], json!(false));
        let surface = &bouw["inputSchema"]["properties"]["surface_loads"]["items"];
        assert_eq!(surface["properties"]["qz"]["type"], json!("number"));
        let support_types = bouw["inputSchema"]["properties"]["supports"]["items"]
            ["properties"]["type"]["enum"].as_array().unwrap();
        for kind in ["xRoller", "yRoller", "zRoller", "revoluteX", "revoluteY", "revoluteZ"] {
            assert!(support_types.contains(&json!(kind)), "{kind} ontbreekt");
        }
        let springs = &bouw["inputSchema"]["properties"]["supports"]["items"]["properties"]["springs"];
        assert_eq!(springs["additionalProperties"], json!(false));
        assert_eq!(springs["properties"]["kz_kn_per_m"]["exclusiveMinimum"], json!(0));
        assert_eq!(springs["properties"]["kry_knm_per_rad"]["type"], json!("number"));
        let prescribed = &bouw["inputSchema"]["properties"]["supports"]["items"]["properties"]["prescribed"];
        assert_eq!(prescribed["additionalProperties"], json!(false));
        assert_eq!(prescribed["properties"]["ux_m"]["type"], json!("number"));
        assert_eq!(prescribed["properties"]["rz_rad"]["type"], json!("number"));

        let levels = &bouw["inputSchema"]["properties"]["levels"]["items"];
        assert_eq!(levels["additionalProperties"], json!(false));
        assert_eq!(levels["required"], json!(["label", "position_m"]));
        let node = &bouw["inputSchema"]["properties"]["nodes"]["items"];
        assert_eq!(node["properties"]["level"]["minimum"], json!(1));
        assert_eq!(node["required"], json!(["x", "y", "z"]), "level blijft optioneel");
        assert_eq!(plate["properties"]["level"]["type"], json!("integer"));

        let view = defs.iter().find(|d| d["name"] == "gui_configure_3d_view").unwrap();
        let visibility = &view["inputSchema"]["properties"]["visibility"]["properties"];
        for layer in [
            "plates", "deformation", "reactions", "utilization", "axialForce", "shearY",
            "shearZ", "torsion", "momentY", "momentZ",
        ] {
            assert_eq!(visibility[layer]["type"], json!("boolean"), "{layer} ontbreekt");
        }
        let select = defs.iter().find(|d| d["name"] == "gui_select_3d_combination").unwrap();
        assert_eq!(select["inputSchema"]["properties"]["id"]["minimum"], json!(1));
        let split = defs.iter().find(|d| d["name"] == "gui_split_3d_member").unwrap();
        assert_eq!(split["inputSchema"]["required"], json!(["beam_id", "ratio"]));
        assert_eq!(split["inputSchema"]["properties"]["ratio"]["exclusiveMaximum"], json!(1));
    }

    /// Belastingvlakken in `gui_build_3d_model`: strikt op elk niveau, met de
    /// twee keuzes als vaste lijst. Een tikfout in `direction` of een
    /// onbekend veld mag niet stil een standaardlastrichting opleveren.
    #[test]
    fn het_3d_schema_draagt_belastingvlakken_strikt() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let panel = &bouw["inputSchema"]["properties"]["load_panels"]["items"];
        assert_eq!(panel["additionalProperties"], json!(false));
        assert_eq!(panel["required"], json!(["nodes", "q", "direction", "distribution"]));
        assert_eq!(panel["properties"]["nodes"]["minItems"], json!(3));
        assert_eq!(panel["properties"]["nodes"]["items"]["minimum"], json!(1));
        assert_eq!(panel["properties"]["case_id"]["minimum"], json!(1));
        assert_eq!(panel["properties"]["direction"]["enum"], json!(["gravity", "normal"]));
        assert_eq!(panel["properties"]["distribution"]["enum"], json!(["oneWay", "twoWay"]));
        let span = &panel["properties"]["span_direction"];
        assert_eq!(span["additionalProperties"], json!(false));
        assert_eq!(span["required"], json!(["x", "y", "z"]));
        assert_eq!(panel["properties"]["excluded_beams"]["items"]["minimum"], json!(1));
        let view = defs.iter().find(|d| d["name"] == "gui_configure_3d_view").unwrap();
        assert_eq!(view["inputSchema"]["properties"]["visibility"]["properties"]["loadPanels"]["type"], json!("boolean"));
    }

    /// Trek-alleen per staaf en starre schijven in `gui_build_3d_model`:
    /// strikt, met de knopen als 1-gebaseerde indices zoals bij platen.
    #[test]
    fn het_3d_schema_draagt_trek_alleen_en_schijven_strikt() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let beam = &bouw["inputSchema"]["properties"]["beams"]["items"];
        assert_eq!(beam["additionalProperties"], json!(false));
        assert_eq!(beam["properties"]["tension_only"]["type"], json!("boolean"));
        let diaphragm = &bouw["inputSchema"]["properties"]["diaphragms"]["items"];
        assert_eq!(diaphragm["additionalProperties"], json!(false));
        assert_eq!(diaphragm["required"], json!(["nodes"]));
        assert_eq!(diaphragm["properties"]["nodes"]["minItems"], json!(2));
        assert_eq!(diaphragm["properties"]["nodes"]["items"]["minimum"], json!(1));
        assert_eq!(diaphragm["properties"]["name"]["type"], json!("string"));
    }

    /// De modelinstellingen voor trek-alleen staven in `gui_build_3d_model`:
    /// twee booleans op modelniveau, standaard uit.
    #[test]
    fn het_3d_schema_kent_montage_en_kruisregel() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        assert_eq!(bouw["inputSchema"]["additionalProperties"], json!(false));
        for veld in ["tension_only_fit_after_permanent", "tension_only_cross_rule"] {
            let instelling = &bouw["inputSchema"]["properties"][veld];
            assert_eq!(instelling["type"], json!("boolean"), "{veld}");
            assert_eq!(instelling["default"], json!(false), "{veld}");
        }
    }
}
