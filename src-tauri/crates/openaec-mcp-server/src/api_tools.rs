//! De API-commando's van de app als MCP-tools.
//!
//! WAAROM
//! De app heeft één commandoregister (`design-mockup/src/api/`). `npm run
//! build:sidecar` schrijft de catalogus daarvan naar `assets/api-catalogus.json`,
//! uit dezelfde bundel als `fem-kernel.mjs`; die catalogus zit hier ingebakken.
//! Elk commando wordt een tool met de naam van het commando, `_` voor `.`
//! (`model3d.node.add` → `model3d_node_add`). Een nieuw commando in de app is
//! na het herbouwen een nieuwe tool, zonder Rust-code.
//!
//! UITVOEREN
//!  - Een documentcommando met `project` (pad naar een .ifcfem): zonder app.
//!    Rust leest het bestand, de sidecar voert het commando uit op de tekst
//!    (`api_uitvoeren`), en Rust schrijft het nieuwe document terug tenzij
//!    `save: false`. `project.new` leest niets en maakt het bestand.
//!  - Een documentcommando zonder `project`, en elk app-commando: in de
//!    draaiende app, via het bedieningskanaal (`gui_tools::roep_api`).

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

use crate::fem_tools::van_sidecar;
use crate::RpcError;

const CATALOGUS: &str = include_str!("../assets/api-catalogus.json");

#[derive(Debug)]
pub(crate) struct ApiTool {
    /// Naam in de app, bijv. `model3d.node.add`.
    pub naam: String,
    /// Naam van de MCP-tool, bijv. `model3d_node_add`.
    pub tool: String,
    pub beschrijving: String,
    pub schema: Value,
    /// Een documentcommando werkt ook zonder app; een app-commando niet.
    pub document: bool,
}

/// De commando's uit de ingebakken catalogus, één keer gelezen.
pub(crate) fn tools() -> &'static [ApiTool] {
    static TOOLS: OnceLock<Vec<ApiTool>> = OnceLock::new();
    TOOLS.get_or_init(|| {
        let catalogus: Value = serde_json::from_str(CATALOGUS)
            .expect("assets/api-catalogus.json is geen geldige JSON; draai `npm run build:sidecar`");
        catalogus["commands"]
            .as_array()
            .expect("assets/api-catalogus.json mist `commands`; draai `npm run build:sidecar`")
            .iter()
            .map(|c| {
                let naam = c["name"].as_str().expect("commando zonder naam").to_owned();
                ApiTool {
                    tool: naam.replace('.', "_"),
                    naam,
                    beschrijving: c["description"].as_str().unwrap_or_default().to_owned(),
                    schema: c["inputSchema"].clone(),
                    document: c["kind"] == "document",
                }
            })
            .collect()
    })
}

pub(crate) fn is_api_tool(naam: &str) -> bool {
    tools().iter().any(|t| t.tool == naam)
}

pub(crate) fn tool_definitions() -> Vec<Value> {
    tools()
        .iter()
        .map(|t| {
            let mut schema = t.schema.clone();
            let mut beschrijving = t.beschrijving.clone();
            if t.document {
                schema["properties"]["project"] = json!({
                    "type": "string", "minLength": 1,
                    "description": "Pad naar een .ifcfem-bestand: het commando werkt dan zonder app op dat bestand. Weglaten: in de draaiende app."
                });
                schema["properties"]["save"] = json!({
                    "type": "boolean",
                    "description": "Alleen met project: het resultaat in het bestand terugschrijven (standaard true); false = alleen de uitkomst."
                });
                beschrijving.push_str(" Met `project` zonder app op dat bestand; anders in de draaiende app.");
            } else {
                beschrijving.push_str(" Alleen in de draaiende app (Instellingen → AI-assistent (MCP) aan, of gestart met gui_start_app of OPENAEC_GUI_CONTROL=1).");
            }
            json!({ "name": t.tool, "description": beschrijving, "inputSchema": schema })
        })
        .collect()
}

fn argumentfout(melding: impl Into<String>) -> RpcError {
    let melding = melding.into();
    RpcError {
        code: -32602,
        message: format!("[ARGUMENT_ONGELDIG] {melding}"),
        data: Some(json!({
            "error_code": "ARGUMENT_ONGELDIG",
            "melding": melding,
            "remedie": "Vergelijk de aanroep met het inputSchema uit `tools/list`; onbekende velden worden geweigerd.",
        })),
    }
}

fn bestandfout(melding: impl Into<String>) -> RpcError {
    let melding = melding.into();
    let remedie = sidecar::remedie_voor_code("BESTAND_ONLEESBAAR");
    RpcError {
        code: -32000,
        message: format!("[BESTAND_ONLEESBAAR] {melding} — {remedie}"),
        data: Some(json!({ "error_code": "BESTAND_ONLEESBAAR", "melding": melding, "remedie": remedie })),
    }
}

pub(crate) async fn dispatch(toolnaam: &str, args: Value) -> Result<Value, RpcError> {
    let tool = tools()
        .iter()
        .find(|t| t.tool == toolnaam)
        .ok_or_else(|| RpcError::method_not_found(toolnaam))?;
    let mut invoer = match args {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        _ => return Err(argumentfout("De argumenten moeten een object zijn.")),
    };
    let project = invoer.remove("project");
    let save = invoer.remove("save");
    if !tool.document && (project.is_some() || save.is_some()) {
        return Err(argumentfout(format!(
            "`project` en `save` horen bij een documentcommando; `{}` werkt alleen in de draaiende app.",
            tool.tool
        )));
    }
    match project {
        None => {
            if save.is_some() {
                return Err(argumentfout("`save` hoort bij `project`."));
            }
            let naam = tool.naam.clone();
            let output = tokio::task::spawn_blocking(move || crate::gui_tools::roep_api(&naam, Value::Object(invoer)))
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))??;
            Ok(json!({ "output": output, "via": "app" }))
        }
        Some(Value::String(pad)) => {
            let save = match save {
                None => true,
                Some(Value::Bool(b)) => b,
                Some(_) => return Err(argumentfout("`save` moet true of false zijn.")),
            };
            op_bestand(tool, &pad, Value::Object(invoer), save).await
        }
        Some(_) => Err(argumentfout("`project` moet een pad naar een .ifcfem-bestand zijn.")),
    }
}

async fn op_bestand(tool: &ApiTool, pad: &str, invoer: Value, save: bool) -> Result<Value, RpcError> {
    let klein = pad.to_lowercase();
    if !(klein.ends_with(".ifcfem") || klein.ends_with(".ifcfem2d")) {
        return Err(argumentfout(format!("`project` moet naar een .ifcfem- of .ifcfem2d-bestand wijzen, niet `{pad}`.")));
    }
    let mut payload = json!({ "name": tool.naam, "input": invoer });
    // Een nieuw project begint leeg; het bestand hoeft nog niet te bestaan.
    if tool.naam != "project.new" {
        let tekst = std::fs::read_to_string(pad).map_err(|e| bestandfout(format!("`{pad}` is niet te lezen: {e}.")))?;
        payload["project"] = json!(tekst);
    }
    let opties = SidecarOpties::uit_omgeving();
    let uit = sidecar::roep_aan("api_uitvoeren", payload, &opties, None)
        .await
        .map_err(van_sidecar)?
        .result;
    let mut opgeslagen = false;
    if save {
        if let Some(tekst) = uit.get("project").and_then(Value::as_str) {
            schrijf_vervangend(pad, tekst)?;
            opgeslagen = true;
        }
    }
    Ok(json!({
        "output": uit.get("output").cloned().unwrap_or(Value::Null),
        "saved": opgeslagen,
        "project": pad,
    }))
}

/// Eerst naast het bestand schrijven, dan in één keer vervangen: een
/// afgebroken schrijfactie laat nooit een half projectbestand achter.
fn schrijf_vervangend(pad: &str, tekst: &str) -> Result<(), RpcError> {
    let tijdelijk = format!("{pad}.tmp-{}", std::process::id());
    std::fs::write(&tijdelijk, tekst).map_err(|e| bestandfout(format!("`{tijdelijk}` is niet te schrijven: {e}.")))?;
    std::fs::rename(&tijdelijk, pad).map_err(|e| {
        let _ = std::fs::remove_file(&tijdelijk);
        bestandfout(format!("`{pad}` is niet te vervangen: {e}."))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogus_is_leesbaar_en_elk_schema_is_een_streng_object() {
        assert!(tools().len() > 50, "te weinig commando's: {}", tools().len());
        for tool in tools() {
            assert_eq!(tool.schema["type"], "object", "{}", tool.naam);
            assert_eq!(tool.schema["additionalProperties"], false, "{}", tool.naam);
            assert!(!tool.tool.contains('.'), "{}", tool.tool);
        }
    }

    #[test]
    fn documenttools_krijgen_project_en_save_apptools_niet() {
        let defs = tool_definitions();
        let def = |naam: &str| defs.iter().find(|d| d["name"] == naam).cloned().unwrap();
        let knoop = def("model3d_node_add");
        assert!(knoop["inputSchema"]["properties"]["project"].is_object());
        assert!(knoop["inputSchema"]["properties"]["save"].is_object());
        let undo = def("app_undo");
        assert!(undo["inputSchema"]["properties"]["project"].is_null());
    }

    #[test]
    fn toolnamen_zijn_uniek() {
        let mut namen: Vec<&str> = tools().iter().map(|t| t.tool.as_str()).collect();
        namen.sort_unstable();
        let voor = namen.len();
        namen.dedup();
        assert_eq!(namen.len(), voor);
    }
}
