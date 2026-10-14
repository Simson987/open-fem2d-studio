//! Een lokaal importformaat via dezelfde extensiecode als Bestand → Openen.
//! De sidecar keurt het project en schrijft het doelbestand naast zichzelf
//! alvorens het atomair te vervangen.
use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::fem_tools::van_sidecar;
use crate::RpcError;

const TOOL: &str = "project_import";
const IDENTIFIER: &str = "org.openaec.fem-studio";

pub(crate) fn is_extensie_tool(naam: &str) -> bool {
    naam == TOOL
}

pub(crate) fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": TOOL,
        "description": "Importeer een bestand met een lokaal geïnstalleerde of gekoppelde extensie naar een nieuw .ifcfem-project, zonder draaiende app. De extensiecode draait met de rechten van deze MCP-server; gebruik alleen eigen of vertrouwde extensies. Het importverslag komt terug in het antwoord.",
        "inputSchema": {
            "type": "object", "additionalProperties": false,
            "required": ["path", "save_as"],
            "properties": {
                "path": { "type": "string", "minLength": 1, "description": "Absoluut pad naar het te importeren bestand." },
                "save_as": { "type": "string", "minLength": 1, "description": "Absoluut pad naar het nieuwe .ifcfem-project." },
                "importer": { "type": "string", "minLength": 1, "description": "Optionele importeur-id, of extensie-id/importeur-id bij meerdere kandidaten." },
                "timeout_s": { "type": "integer", "minimum": 1, "maximum": 120, "description": "Tijdslimiet in seconden, standaard 60." }
            }
        }
    })]
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Argumenten {
    path: String,
    save_as: String,
    importer: Option<String>,
    timeout_s: Option<u64>,
}

fn argumentfout(tekst: impl Into<String>) -> RpcError {
    let tekst = tekst.into();
    RpcError::invalid_params(format!("[ARGUMENT_ONGELDIG] {tekst}"))
}

fn app_datamap() -> Option<PathBuf> {
    let basis = match std::env::consts::OS {
        // Tauri plugin-store bewaart preferences.json onder AppData (Roaming),
        // dezelfde map waar het Tauri-command de ZIP-extensies installeert.
        "windows" => PathBuf::from(std::env::var_os("APPDATA")?),
        "macos" => PathBuf::from(std::env::var_os("HOME")?)
            .join("Library")
            .join("Application Support"),
        _ => match std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
        {
            Some(pad) => pad,
            None => PathBuf::from(std::env::var_os("HOME")?)
                .join(".local")
                .join("share"),
        },
    };
    Some(basis.join(IDENTIFIER))
}

fn voorkeuren(app_map: Option<&Path>) -> (Vec<PathBuf>, Vec<String>) {
    let Some(app_map) = app_map else {
        return (vec![], vec![]);
    };
    let Ok(tekst) = std::fs::read_to_string(app_map.join("preferences.json")) else {
        return (vec![], vec![]);
    };
    let Ok(waarde) = serde_json::from_str::<Value>(&tekst) else {
        return (vec![], vec![]);
    };
    let gekoppeld = waarde
        .get("extensies.mappen")
        .and_then(Value::as_array)
        .map(|lijst| {
            lijst
                .iter()
                .filter_map(Value::as_str)
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default();
    let uit = waarde
        .get("extensies.uit")
        .and_then(Value::as_array)
        .map(|lijst| {
            lijst
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    (gekoppeld, uit)
}

fn extensiemappen() -> (Vec<String>, Vec<String>) {
    let app_map = app_datamap();
    let (gekoppeld, uit) = voorkeuren(app_map.as_deref());
    let mut mappen = Vec::new();
    if let Some(vast) = app_map.map(|p| p.join("extensions")) {
        if let Ok(items) = std::fs::read_dir(vast) {
            for item in items.flatten() {
                if item.file_type().is_ok_and(|soort| soort.is_dir()) {
                    mappen.push(item.path());
                }
            }
        }
    }
    mappen.extend(gekoppeld);
    if let Some(omgeving) = std::env::var_os("OPENAEC_EXTENSIONS_DIRS") {
        mappen.extend(std::env::split_paths(&omgeving));
    }
    let mut gezien = HashSet::new();
    let mappen = mappen
        .into_iter()
        .filter_map(|map| {
            let pad = map.canonicalize().ok()?;
            if pad.is_dir() && gezien.insert(pad.clone()) {
                Some(pad.to_string_lossy().into_owned())
            } else {
                None
            }
        })
        .collect();
    (mappen, uit)
}

pub(crate) async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    if naam != TOOL {
        return Err(RpcError::method_not_found(naam));
    }
    let a: Argumenten = serde_json::from_value(args)
        .map_err(|e| argumentfout(format!("Argumenten voor {TOOL} zijn ongeldig: {e}")))?;
    if !Path::new(&a.path).is_absolute() || !Path::new(&a.save_as).is_absolute() {
        return Err(argumentfout("path en save_as moeten absolute paden zijn."));
    }
    if !a.save_as.to_ascii_lowercase().ends_with(".ifcfem") {
        return Err(argumentfout("save_as moet eindigen op .ifcfem."));
    }
    let timeout = a.timeout_s.unwrap_or(60);
    if !(1..=120).contains(&timeout) {
        return Err(argumentfout("timeout_s moet tussen 1 en 120 liggen."));
    }
    let (extension_dirs, disabled_ids) = extensiemappen();
    let mut payload = json!({
        "path": a.path, "saveAs": a.save_as,
        "extensionDirs": extension_dirs, "disabledIds": disabled_ids,
    });
    if let Some(importer) = a.importer {
        payload["importer"] = json!(importer);
    }
    let opties = SidecarOpties::uit_omgeving();
    sidecar::roep_aan("extensie_importeren", payload, &opties, Some(timeout))
        .await
        .map(|antwoord| antwoord.result)
        .map_err(van_sidecar)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_is_streng() {
        let schema = &tool_definitions()[0]["inputSchema"];
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"], json!(["path", "save_as"]));
    }
}
