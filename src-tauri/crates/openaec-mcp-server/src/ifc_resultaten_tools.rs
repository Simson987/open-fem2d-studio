//! `fem_resultaten_ifc_schrijven` en `fem_resultaten_ifc_lezen` — rekenresultaten
//! als `.ifcfemresults` (IFC4: model + resultaten, issue #87).
//!
//! WAT HIER GEBEURT EN WAT NIET
//! Deze module rekent niet en schrijft geen IFC. De keten is:
//!   1. hier: het `.ifcfem`-projectbestand (of `.ifcfemresults`) van schijf
//!      lezen;
//!   2. sidecar `ifcfemresults_schrijven` — rekenen met `rekenDoor` (dezelfde
//!      doorrekening als `solve_fem_model`) en het bestand bouwen met
//!      `bouwIfcResultaten` (`design-mockup/src/io/ifcResultaten.ts`), dezelfde
//!      functie als de kaart "Resultaten (.ifcfemresults)" onder Exporteren in
//!      de app; of `ifcfemresults_lezen` — `leesIfcResultaten`, dezelfde lezer
//!      als Openen in de app;
//!   3. hier: het bestand atomair wegschrijven.
//! Alleen 2D: de 3D-resultaten schrijft de app (de 3D-kern draait daar). Het
//! lezen kent beide.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::fem_tools::van_sidecar;
use crate::ifc_import_tools::stap_tekst;
use crate::RpcError;

pub(crate) const SCHRIJVEN: &str = "fem_resultaten_ifc_schrijven";
pub(crate) const LEZEN: &str = "fem_resultaten_ifc_lezen";

pub(crate) fn is_ifc_resultaten_tool(naam: &str) -> bool {
    naam == SCHRIJVEN || naam == LEZEN
}

pub(crate) fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": SCHRIJVEN,
            "description": "Reken een 2D-project (.ifcfem of ouder .ifcfem2d) door, precies zoals solve_fem_model, en schrijf model plus resultaten als één IFC4-bestand (.ifcfemresults): per belastinggeval en combinatie een IfcStructuralResultGroup (ResultForLoadGroup naar de belastinggroep, HasResults op het analysemodel), knoopverplaatsingen en reacties als IfcStructuralPointReaction, snedekrachten en verplaatsingen over de stations als IfcStructuralCurveReaction, plaatelementen als IfcStructuralSurfaceReaction met de spanningen in de set OpenFEM_Plaatelement. Het projectbestand reist mee (set OpenFEM_Projectbestand op IfcProject), zodat de app het model met de resultaten heropent zonder te rekenen. Getallen in SI (m, N, N·m, Pa) en exact terug te lezen met fem_resultaten_ifc_lezen. Dezelfde functie als de kaart \"Resultaten (.ifcfemresults)\" onder Exporteren in de app. Unity checks staan er alleen in als de app ze meegeeft; deze tool schrijft geen toetsuitkomst.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["project", "uitvoerpad"],
                "properties": {
                    "project": { "type": "string", "minLength": 1,
                        "description": "Absoluut pad naar het .ifcfem- (of .ifcfem2d-)projectbestand. De server leest het zelf." },
                    "uitvoerpad": { "type": "string", "minLength": 1,
                        "description": "Absoluut pad voor het resultatenbestand; eindigt op .ifcfemresults. Een bestaand bestand wordt alleen vervangen met `overschrijven: true`." },
                    "overschrijven": { "type": "boolean", "default": false,
                        "description": "Een bestaand bestand op `uitvoerpad` vervangen." },
                    "gevolgklasse": { "type": "string", "enum": ["CC1", "CC2", "CC3"],
                        "description": "Gevolgklasse voor de standaardcombinaties, zoals bij solve_fem_model; weglaten = die uit het projectbestand." },
                    "timeout_s": { "type": "integer", "minimum": 1, "maximum": 600,
                        "description": "Tijdslimiet van de sidecar-aanroep in seconden." }
                }
            }
        }),
        json!({
            "name": LEZEN,
            "description": "Lees een .ifcfemresults-bestand (IFC4 met resultaten, geschreven door Open FEM Studio) terug zonder te rekenen: de resultaatgroepen (2D/3D, geval of combinatie, theorie), per geval en combinatie de reacties (samenvatting) of alles (detail volledig: 2D in de vorm van solve_fem_model met stations, 3D zoals solve_open_fem_3d), en of het projectbestand is ingebed. Resultaten van andere programma's in hetzelfde bestand worden overgeslagen.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "required": ["pad"],
                "properties": {
                    "pad": { "type": "string", "minLength": 1,
                        "description": "Absoluut pad naar het .ifcfemresults-bestand." },
                    "detail": { "type": "string", "enum": ["samenvatting", "volledig"], "default": "samenvatting",
                        "description": "samenvatting: reacties en grootste verplaatsing; volledig: alle resultaten." },
                    "timeout_s": { "type": "integer", "minimum": 1, "maximum": 600,
                        "description": "Tijdslimiet van de sidecar-aanroep in seconden." }
                }
            }
        }),
    ]
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SchrijfArgumenten {
    project: String,
    uitvoerpad: String,
    #[serde(default)]
    overschrijven: bool,
    #[serde(default)]
    gevolgklasse: Option<String>,
    #[serde(default)]
    timeout_s: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LeesArgumenten {
    pad: String,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    timeout_s: Option<u64>,
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

fn bestandsfout(melding: impl Into<String>) -> RpcError {
    let melding = melding.into();
    RpcError {
        code: -32000,
        message: format!("[BESTAND_ONLEESBAAR] {melding}"),
        data: Some(json!({
            "error_code": "BESTAND_ONLEESBAAR",
            "melding": melding,
            "remedie": "Geef een absoluut pad en controleer de lees- en schrijfrechten.",
        })),
    }
}

/// Extensie .ifcfemresults, absoluut, bestaande map, en geen bestaand bestand
/// tenzij `overschrijven` — VOOR er gerekend wordt.
fn keur_uitvoerpad(pad: &str, overschrijven: bool) -> Result<(), RpcError> {
    if !pad.to_lowercase().ends_with(".ifcfemresults") {
        return Err(argumentfout(format!("`uitvoerpad` moet op .ifcfemresults eindigen, niet `{pad}`.")));
    }
    let p = std::path::Path::new(pad);
    if !p.is_absolute() {
        return Err(argumentfout(format!("`uitvoerpad` moet een absoluut pad zijn, niet `{pad}`.")));
    }
    if let Some(map) = p.parent() {
        if !map.is_dir() {
            return Err(argumentfout(format!("De map van `uitvoerpad` bestaat niet: `{}`.", map.display())));
        }
    }
    if p.exists() && !overschrijven {
        return Err(argumentfout(format!(
            "`{pad}` bestaat al; geef `overschrijven: true` om het te vervangen, of kies een ander pad."
        )));
    }
    Ok(())
}

/// Eerst naast het doel schrijven, dan in één keer vervangen.
fn schrijf_atomair(pad: &str, tekst: &str) -> Result<(), RpcError> {
    let tijdelijk = format!("{pad}.tmp-{}", std::process::id());
    std::fs::write(&tijdelijk, tekst)
        .map_err(|e| bestandsfout(format!("`{tijdelijk}` is niet te schrijven ({e}).")))?;
    std::fs::rename(&tijdelijk, pad).map_err(|e| {
        let _ = std::fs::remove_file(&tijdelijk);
        bestandsfout(format!("`{pad}` is niet te schrijven ({e})."))
    })
}

async fn roep(op: &str, payload: Value, timeout_s: Option<u64>) -> Result<Value, RpcError> {
    let opties = SidecarOpties::uit_omgeving();
    sidecar::roep_aan(op, payload, &opties, timeout_s)
        .await
        .map(|uit| uit.result)
        .map_err(van_sidecar)
}

pub(crate) async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        SCHRIJVEN => schrijven(args).await,
        LEZEN => lezen(args).await,
        _ => Err(RpcError::method_not_found(naam)),
    }
}

async fn schrijven(args: Value) -> Result<Value, RpcError> {
    let a: SchrijfArgumenten = serde_json::from_value(args)
        .map_err(|e| argumentfout(format!("De argumenten van `{SCHRIJVEN}` deugen niet: {e}.")))?;
    let klein = a.project.to_lowercase();
    if !(klein.ends_with(".ifcfem") || klein.ends_with(".ifcfem2d")) {
        return Err(argumentfout(format!("`project` moet naar een .ifcfem- of .ifcfem2d-bestand wijzen, niet `{}`.", a.project)));
    }
    if let Some(k) = &a.gevolgklasse {
        if !matches!(k.as_str(), "CC1" | "CC2" | "CC3") {
            return Err(argumentfout("`gevolgklasse` moet CC1, CC2 of CC3 zijn."));
        }
    }
    keur_uitvoerpad(&a.uitvoerpad, a.overschrijven)?;
    let inhoud = std::fs::read_to_string(&a.project)
        .map_err(|e| bestandsfout(format!("Het projectbestand `{}` kon niet worden gelezen ({e}).", a.project)))?;
    let bestandsnaam = std::path::Path::new(&a.uitvoerpad)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut payload = json!({ "project": { "inhoud": inhoud }, "bestandsnaam": bestandsnaam });
    if let Some(k) = &a.gevolgklasse {
        payload["gevolgklasse"] = json!(k);
    }
    let uit = roep("ifcfemresults_schrijven", payload, a.timeout_s).await?;
    let tekst = uit["inhoud"]
        .as_str()
        .ok_or_else(|| RpcError::tool_exec("de sidecar leverde geen IFC-tekst; is de bundel ouder dan deze server?"))?;
    if uit["validatie_fouten"].as_array().is_some_and(|f| !f.is_empty()) {
        return Err(RpcError::tool_exec(format!(
            "het gebouwde IFC-bestand haalt de eigen controle niet; er is niets geschreven: {}",
            uit["validatie_fouten"]
        )));
    }
    schrijf_atomair(&a.uitvoerpad, tekst)?;
    Ok(json!({
        "pad": a.uitvoerpad,
        "geschreven": true,
        "bytes": tekst.len(),
        "entiteiten": uit["entiteiten"],
        "gevallen": uit["gevallen"],
        "combinaties": uit["combinaties"],
        "project_ingebed": uit["project_ingebed"],
        "warnings": uit["warnings"],
    }))
}

async fn lezen(args: Value) -> Result<Value, RpcError> {
    let a: LeesArgumenten = serde_json::from_value(args)
        .map_err(|e| argumentfout(format!("De argumenten van `{LEZEN}` deugen niet: {e}.")))?;
    let detail = a.detail.as_deref().unwrap_or("samenvatting");
    if !matches!(detail, "samenvatting" | "volledig") {
        return Err(argumentfout("`detail` moet \"samenvatting\" of \"volledig\" zijn."));
    }
    let bytes = std::fs::read(&a.pad)
        .map_err(|e| bestandsfout(format!("Het bestand `{}` kon niet worden gelezen ({e}).", a.pad)))?;
    let mut uit = roep("ifcfemresults_lezen", json!({ "inhoud": stap_tekst(bytes), "detail": detail }), a.timeout_s).await?;
    uit["pad"] = json!(a.pad);
    Ok(uit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schemas_zijn_strikt() {
        let defs = tool_definitions();
        assert_eq!(defs.len(), 2);
        for def in &defs {
            assert_eq!(def["inputSchema"]["additionalProperties"], json!(false), "{}", def["name"]);
        }
        assert_eq!(defs[0]["inputSchema"]["required"], json!(["project", "uitvoerpad"]));
        assert_eq!(defs[1]["inputSchema"]["required"], json!(["pad"]));
    }

    #[test]
    fn uitvoerpad_wordt_vooraf_gekeurd() {
        let map = std::env::temp_dir().join(format!("ifcfemresults-uitvoer-{}", std::process::id()));
        std::fs::create_dir_all(&map).unwrap();
        let nieuw = map.join("hal.ifcfemresults").to_string_lossy().into_owned();
        assert!(keur_uitvoerpad(&nieuw, false).is_ok());
        assert!(keur_uitvoerpad(&map.join("hal.ifc").to_string_lossy(), false).is_err());
        assert!(keur_uitvoerpad("relatief/hal.ifcfemresults", false).is_err());
        schrijf_atomair(&nieuw, "x").unwrap();
        assert!(keur_uitvoerpad(&nieuw, false).is_err());
        assert!(keur_uitvoerpad(&nieuw, true).is_ok());
        let _ = std::fs::remove_dir_all(&map);
    }
}
