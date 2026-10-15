//! `open_fem_3d_ifc_importeren` — een IFC4-analysemodel (Structural Analysis
//! View) als 3D-project, met een eerlijk verslag; desgewenst meteen
//! doorgerekend en getoetst.
//!
//! WAT HIER GEBEURT EN WAT NIET
//! Deze module leest geen IFC en rekent geen staaf. De keten is:
//!   1. hier: het bestand van schijf lezen (UTF-8, anders ISO 8859-1);
//!   2. sidecar `ifc_importeren` — de import van de app
//!      (`design-mockup/src/io/ifcAnalyseImport.ts`, dezelfde functie als de
//!      knop "Rekenmodel importeren") en, met `reken`, de rekenverzoeken per
//!      belast geval en per combinatie (`buildOpenFem3DSolveRequest`, zoals de
//!      knop Berekenen);
//!   3. hier: elk verzoek door `open_fem_3d::solve`, dezelfde vastgezette
//!      3D-kern als het Tauri-command en de tool `solve_open_fem_3d`;
//!   4. sidecar `ifc_uitwerken` — reactiesommen, evenwicht, verplaatsingen en
//!      de EN 1993-toetsinvoer (`buildOpenFem3DSteelCheckInputs`);
//!   5. hier: `steel_check::check_all_beams` en de uitkomst per onderdeel
//!      (de groepering van de stalen hal, `groepeer_toetsing`).
//! Kan het model niet gerekend worden (een onderdeel dat de 3D-kern niet kent,
//! een staaf zonder profiel), dan komt het model terug met
//! `berekening.uitgevoerd = false` en de reden — er wordt niets weggelaten om
//! toch te rekenen.
//!
//! DE TOETSKRACHTEN (issue #199, B9): zoals bij de stalen hal
//! (`staalhal_tools.rs`). `analyse` geldt alleen voor de resultaten; met
//! `toetsen` rekent de UGT-toets elke UGT-combinatie P-Δ met scheefstand in
//! +X, −X, +Y en −Y (de `toetsverzoeken` van de sidecar, dezelfde functies als
//! de app), met de φ van het projectbestand van de import. Een mislukte
//! toetsberekening maakt de toets een weigering met de reden per combinatie;
//! de resultaten blijven staan.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::fem_tools::{eis_afgedwongen_toetsanalyse, van_sidecar};
use crate::staalhal_tools::{groepeer_toetsing, lees_rekenverzoeken, reken_alle, toetsuitkomsten, toetsweigering};
use crate::RpcError;

pub(crate) const TOOL: &str = "open_fem_3d_ifc_importeren";

pub(crate) fn is_ifc_import_tool(naam: &str) -> bool {
    naam == TOOL
}

/// Het schema van de keuze van het analysemodel: naam of volgnummer (vanaf 1).
/// Gedeeld met `gui_import_ifc_analysis_model`.
pub(crate) fn analysemodel_schema() -> Value {
    json!({
        "oneOf": [
            { "type": "string", "minLength": 1, "description": "Naam van het IfcStructuralAnalysisModel (hoofdletterongevoelig)." },
            { "type": "integer", "minimum": 1, "description": "Volgnummer van het analysemodel in het bestand, vanaf 1." }
        ],
        "description": "Welk analysemodel. Mag ontbreken als het bestand er één heeft; bij meer modellen komt anders een fout terug met de lijst (naam, beschrijving, aantallen)."
    })
}

pub(crate) fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": TOOL,
        "description": "Importeer een IFC4-analysemodel (Structural Analysis View: IfcStructuralAnalysisModel met knopen, staven, vlakken, belastinggevallen en combinaties) als 3D-project van Open FEM Studio — dezelfde import als de knop \"Rekenmodel importeren\" in de app. Geeft het project als JSON (`project`), de lijst analysemodellen in het bestand en een verslag: aantallen, trek-alleen staven, starre schijven, toelichting, waarschuwingen en alles wat niet is ingelezen. Een .ifcfem-projectbestand (te openen in de app of met gui_load_model) wordt ALLEEN geschreven met `uitvoerpad`; het geschreven pad staat dan in `projectbestand.pad` (zonder `uitvoerpad` is `projectbestand` null en staat er niets op schijf). Eenheden uit IfcUnitAssignment worden omgerekend naar m en kN. Met `reken: true` rekent dezelfde 3D-kern als solve_open_fem_3d elk belast geval en elke combinatie uit het bestand (zonder combinaties in het bestand: de standaardset volgens NEN-EN 1990), de RESULTATEN volgens `analyse` en zonder scheefstand, met reactiesommen en evenwicht per geval; met `toetsen` (standaard aan) ook de EN 1993-toetsing met UC per onderdeel. TOETSKRACHTEN: de UGT-toets rekent ALTIJD zelf tweede orde (P-Delta) met scheefstand (NEN-EN 1993-1-1 5.2.2(3)b en (7)b, 5.3.2), elke UGT-combinatie in +X, −X, +Y en −Y (id + k·1000000), met phi uit de projectinstelling van het projectbestand (vast 1/200), los van `analyse`; de BGT-toetsen lezen de resultaten. Dezelfde functies als de app. `berekening.toetsanalyse` beschrijft de toets (`analysis_type`, `model_analysis_type`, `scheefstand` {phi, noemer, phi_x, phi_y, noemer_x, noemer_y, bron, model_scheefstand_aan, afgedwongen}: phi_x geldt voor ±X en phi_y voor ±Y, elk met m per rij kolommen in die richting (EN 1993-1-1 5.3.2(3)), phi is de grootste, `alpha_cr` per UGT-basiscombinatie met `stabiliteitsmeldingen` ({niveau, tekst}: dezelfde meldingen als de app, informatief over de resultaten; alleen een geweigerde toets is een fout), `meldingen`, per toetsberekening ΣR en evenwicht); draagt het bestand de scheefstand al als imperfectiegeval, dan zegt een melding dat die in de toets dubbel telt. Divergeert de tweede orde van de toets in een UGT-combinatie (alpha_cr ≤ 1), dan is `berekening.toetsing.geweigerd` true met de reden per combinatie en een `suggestie`, zonder UC; de resultaten blijven staan en er wordt nooit teruggevallen op eerste orde. Kent de 3D-kern een onderdeel nog niet (bijvoorbeeld trek-alleen staven of starre schijven), dan is `berekening.uitgevoerd` false met de reden.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "required": ["pad"],
            "properties": {
                "pad": { "type": "string", "minLength": 1, "description": "Absoluut pad naar het .ifc-bestand (IFC4, STEP-vorm). De server leest het zelf." },
                "analysemodel": analysemodel_schema(),
                "reken": { "type": "boolean", "default": false,
                    "description": "Meteen doorrekenen met de 3D-kern (per belast geval en per combinatie)." },
                "analyse": { "type": "string", "enum": ["linear", "p-delta"], "default": "linear",
                    "description": "De RESULTATEN: eerste orde (linear, zoals het projectbestand) of tweede orde (p-delta), zonder scheefstand. De toets rekent hoe dan ook P-Delta met scheefstand." },
                "gevolgklasse": { "type": "string", "enum": ["CC1", "CC2", "CC3"], "default": "CC2",
                    "description": "Gevolgklasse voor de standaardcombinaties, alleen als het bestand zelf geen combinaties heeft." },
                "toetsen": { "type": "boolean", "default": true,
                    "description": "Met reken: ook EN 1993 toetsen (staven met een catalogusprofiel van staal), met UGT-krachten uit een eigen tweede-ordeberekening (P-Delta) met scheefstand in +X, −X, +Y en −Y (4 berekeningen per UGT-combinatie extra)." },
                "uitvoerpad": { "type": "string", "minLength": 1,
                    "description": "Absoluut pad voor het .ifcfem-projectbestand dat geschreven moet worden (eindigt op .ifcfem). Dezelfde inhoud als Opslaan in de app, met format, version en savedAt. Een bestaand bestand wordt alleen vervangen met `overschrijven: true`. Weglaten = niets schrijven; alleen JSON." },
                "overschrijven": { "type": "boolean", "default": false,
                    "description": "Alleen met uitvoerpad: een bestaand bestand op dat pad vervangen." },
                "detail": { "type": "string", "enum": ["samenvatting", "volledig"], "default": "samenvatting",
                    "description": "volledig: ook alle reacties en verplaatsingen per geval en de toetsuitkomst per staaf." },
                "timeout_s": { "type": "integer", "minimum": 1, "maximum": 600,
                    "description": "Tijdslimiet per sidecar-aanroep in seconden." }
            }
        }
    })]
}

// ── Uitvoering ──────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Argumenten {
    pad: String,
    #[serde(default)]
    analysemodel: Option<Value>,
    #[serde(default)]
    reken: bool,
    #[serde(default)]
    analyse: Option<String>,
    #[serde(default)]
    gevolgklasse: Option<String>,
    #[serde(default)]
    toetsen: Option<bool>,
    #[serde(default)]
    detail: Option<String>,
    #[serde(default)]
    timeout_s: Option<u64>,
    #[serde(default)]
    uitvoerpad: Option<String>,
    #[serde(default)]
    overschrijven: bool,
}

/// Controleert `uitvoerpad` VOOR er iets gelezen of gerekend wordt (#233):
/// extensie .ifcfem, een bestaande map, en geen bestaand bestand tenzij
/// `overschrijven`. Zo wordt nooit stil een project overschreven.
fn keur_uitvoerpad(pad: &str, overschrijven: bool) -> Result<(), RpcError> {
    if !pad.to_lowercase().ends_with(".ifcfem") {
        return Err(argumentfout(format!("`uitvoerpad` moet op .ifcfem eindigen, niet `{pad}`.")));
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

/// Eerst naast het doel schrijven, dan in één keer vervangen: een afgebroken
/// schrijfactie laat nooit een half projectbestand achter.
fn schrijf_projectbestand(pad: &str, tekst: &str) -> Result<(), RpcError> {
    let tijdelijk = format!("{pad}.tmp-{}", std::process::id());
    std::fs::write(&tijdelijk, tekst)
        .map_err(|e| bestandsfout(format!("`{tijdelijk}` is niet te schrijven ({e}).")))?;
    std::fs::rename(&tijdelijk, pad).map_err(|e| {
        let _ = std::fs::remove_file(&tijdelijk);
        bestandsfout(format!("`{pad}` is niet te schrijven ({e})."))
    })
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
            "remedie": "Geef een absoluut pad naar een IFC4-bestand in STEP-vorm (.ifc) en controleer de leesrechten.",
        })),
    }
}

fn rekenfout(melding: impl Into<String>) -> RpcError {
    let melding = melding.into();
    RpcError {
        code: -32000,
        message: format!("[MODEL_ONOPLOSBAAR] {melding}"),
        data: Some(json!({
            "error_code": "MODEL_ONOPLOSBAAR",
            "melding": melding,
            "remedie": "Lees het verslag van de import: opleggingen, eindscharnieren en profielen bepalen of het model een mechanisme is.",
        })),
    }
}

/// De bytes van een STEP-bestand als tekst. STEP hoort 7-bits te zijn (andere
/// tekens via `\X2\…\X0\`), maar schrijvers zetten er soms UTF-8 of ISO 8859-1
/// in. Eerst UTF-8; lukt dat niet, dan is elk byte één teken van ISO 8859-1 —
/// zo gaat er nooit een naam stil verloren en faalt het lezen niet.
pub(crate) fn stap_tekst(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(tekst) => tekst,
        Err(fout) => fout.into_bytes().into_iter().map(char::from).collect(),
    }
}

async fn roep(op: &str, payload: Value, timeout_s: Option<u64>) -> Result<Value, RpcError> {
    let opties = SidecarOpties::uit_omgeving();
    sidecar::roep_aan(op, payload, &opties, timeout_s)
        .await
        .map(|uit| uit.result)
        .map_err(van_sidecar)
}

pub(crate) async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    if naam != TOOL {
        return Err(RpcError::method_not_found(naam));
    }
    let a: Argumenten = serde_json::from_value(args)
        .map_err(|e| argumentfout(format!("De argumenten van `{TOOL}` deugen niet: {e}.")))?;
    let detail = a.detail.as_deref().unwrap_or("samenvatting");
    if !matches!(detail, "samenvatting" | "volledig") {
        return Err(argumentfout("`detail` moet \"samenvatting\" of \"volledig\" zijn."));
    }
    if let Some(keuze) = &a.analysemodel {
        let geldig = keuze.as_str().is_some_and(|s| !s.trim().is_empty()) || keuze.as_u64().is_some_and(|n| n >= 1);
        if !geldig {
            return Err(argumentfout("`analysemodel` is de naam van het analysemodel of zijn volgnummer (vanaf 1)."));
        }
    }
    if a.overschrijven && a.uitvoerpad.is_none() {
        return Err(argumentfout("`overschrijven` hoort bij `uitvoerpad`."));
    }
    if let Some(uitvoer) = &a.uitvoerpad {
        keur_uitvoerpad(uitvoer, a.overschrijven)?;
    }
    let volledig = detail == "volledig";
    let pad = a.pad.clone();
    let bytes = std::fs::read(&pad)
        .map_err(|e| bestandsfout(format!("Het IFC-bestand `{pad}` kon niet worden gelezen ({e}).")))?;
    let inhoud = stap_tekst(bytes);
    let toetsen = a.toetsen.unwrap_or(true);
    let reken = json!({
        "analyse": a.analyse.as_deref().unwrap_or("linear"),
        "gevolgklasse": a.gevolgklasse.as_deref().unwrap_or("CC2"),
    });

    let mut importeren = json!({ "inhoud": inhoud, "pad": pad });
    if let Some(keuze) = &a.analysemodel {
        importeren["analysemodel"] = keuze.clone();
    }
    if a.reken {
        importeren["reken"] = reken.clone();
        // Alleen het afwijkende `false` gaat mee; zie `staalhal_tools.rs`.
        if !toetsen {
            importeren["toetsen"] = json!(false);
        }
    }
    if a.uitvoerpad.is_some() {
        importeren["projectbestand"] = json!(true);
    }
    let gelezen = roep("ifc_importeren", importeren, a.timeout_s).await?;
    let mut uit = Map::new();
    for sleutel in ["pad", "modellen", "analysemodel", "project", "verslag"] {
        uit.insert(sleutel.to_owned(), gelezen.get(sleutel).cloned().unwrap_or(Value::Null));
    }
    // Het .ifcfem-bestand (#233): alleen met `uitvoerpad`, met de tekst die
    // de sidecar met `serializeProject` maakte — dezelfde als Opslaan.
    let projectbestand = match &a.uitvoerpad {
        Some(uitvoer) => {
            let tekst = gelezen["projectTekst"].as_str().ok_or_else(|| {
                RpcError::tool_exec("de sidecar leverde geen projecttekst; is de bundel ouder dan deze server?")
            })?;
            schrijf_projectbestand(uitvoer, tekst)?;
            json!({ "pad": uitvoer, "geschreven": true, "bytes": tekst.len() })
        }
        None => Value::Null,
    };
    uit.insert("projectbestand".to_owned(), projectbestand);
    if !a.reken {
        return Ok(Value::Object(uit));
    }
    if gelezen["rekenen"]["mogelijk"] != json!(true) {
        uit.insert("berekening".to_owned(), json!({
            "uitgevoerd": false,
            "reden": gelezen["rekenen"]["reden"],
        }));
        return Ok(Value::Object(uit));
    }
    if toetsen {
        eis_afgedwongen_toetsanalyse(&gelezen["toetsanalyse"], "toetsanalyse", "eerste orde zonder scheefstand")?;
    }

    // ── Rekenen: elk verzoek door dezelfde 3D-kern als solve_open_fem_3d ──
    let verzoeken = lees_rekenverzoeken(&gelezen["rekenverzoeken"], "rekenverzoeken")?;
    let aantal_verzoeken = verzoeken.len();
    let mut resultaten = Map::new();
    for (sleutel, naam, uitkomst) in reken_alle(verzoeken).await? {
        let waarde = uitkomst
            .map_err(|e| rekenfout(format!("De 3D-kern weigerde het geïmporteerde model: {naam} ({sleutel}): {e}")))?;
        resultaten.insert(sleutel, waarde);
    }
    // De toets: een mislukte berekening is een uitkomst `{ fout }` (zie `staalhal_tools.rs`).
    let toetsresultaten = if toetsen {
        Some(toetsuitkomsten(lees_rekenverzoeken(&gelezen["toetsverzoeken"], "toetsverzoeken")?).await?)
    } else {
        None
    };

    let mut per_geval_volledig = Vec::new();
    if volledig {
        for (sleutel, r) in &resultaten {
            if let Some(id) = sleutel.strip_prefix("geval:") {
                per_geval_volledig.push(json!({
                    "id": id.parse::<i64>().unwrap_or_default(),
                    "reacties": r["reactions"],
                    "verplaatsingen": r["displacements"],
                }));
            }
        }
    }

    // Het gekozen model bij zijn nummer: de tweede import is dan zeker dezelfde.
    let mut uitwerken = json!({
        "inhoud": inhoud,
        "analysemodel": gelezen["analysemodel"]["nummer"],
        "reken": reken,
        "resultaten": Value::Object(resultaten),
    });
    match toetsresultaten {
        Some(t) => uitwerken["toetsresultaten"] = Value::Object(t),
        None => uitwerken["toetsen"] = json!(false),
    }
    let uitgewerkt = roep("ifc_uitwerken", uitwerken, a.timeout_s).await?;

    let mut berekening = Map::new();
    berekening.insert("uitgevoerd".to_owned(), json!(true));
    berekening.insert("analyse".to_owned(), uitgewerkt["reken"]["analyse"].clone());
    berekening.insert("gevolgklasse".to_owned(), uitgewerkt["reken"]["gevolgklasse"].clone());
    berekening.insert("combinatiebron".to_owned(), gelezen["rekenen"]["combinatiebron"].clone());
    berekening.insert("aantal_berekeningen".to_owned(), json!(aantal_verzoeken));
    berekening.insert("gevallen".to_owned(), uitgewerkt["gevallen"].clone());
    berekening.insert("combinaties".to_owned(), uitgewerkt["combinaties"].clone());
    if volledig {
        berekening.insert("per_geval".to_owned(), Value::Array(per_geval_volledig));
    }
    if toetsen {
        eis_afgedwongen_toetsanalyse(&uitgewerkt["toetsanalyse"], "toetsanalyse", "eerste orde zonder scheefstand")?;
        berekening.insert("toetsanalyse".to_owned(), uitgewerkt["toetsanalyse"].clone());
    }
    if toetsen && !uitgewerkt["toetsweigering"].is_null() {
        // Geweigerd (B7): geen toetsing, wel de reden per combinatie. De resultaten blijven staan.
        berekening.insert("toetsing".to_owned(), toetsweigering(&uitgewerkt["toetsweigering"]));
    } else if toetsen {
        let invoer: Vec<steel_check::BeamCheckInput> = serde_json::from_value(uitgewerkt["toetsinvoer"].clone())
            .map_err(|e| RpcError::tool_exec(format!("de toetsinvoer van de sidecar past niet op BeamCheckInput: {e}")))?;
        let uitkomsten = tokio::task::spawn_blocking(move || steel_check::check_all_beams(invoer))
            .await
            .map_err(|e| RpcError::tool_exec(format!("toetsing kon niet worden afgerond: {e}")))?;
        let uitkomsten = serde_json::to_value(uitkomsten)
            .map_err(|e| RpcError::tool_exec(format!("toetsuitkomst niet naar JSON: {e}")))?;
        berekening.insert(
            "toetsing".to_owned(),
            groepeer_toetsing(&uitkomsten, &uitgewerkt["groepen"], &uitgewerkt, volledig),
        );
    }
    uit.insert("berekening".to_owned(), Value::Object(berekening));
    Ok(Value::Object(uit))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_blijft_utf8_en_latijn1_wordt_per_byte_gelezen() {
        assert_eq!(stap_tekst("Café".as_bytes().to_vec()), "Café");
        // 0xE9 is é in ISO 8859-1 en geen geldige UTF-8.
        assert_eq!(stap_tekst(vec![b'C', b'a', b'f', 0xE9]), "Café");
    }

    /// `additionalProperties: false` op elk objectniveau, `pad` verplicht, en
    /// het analysemodel als naam of volgnummer.
    #[test]
    fn schema_is_strikt() {
        let defs = tool_definitions();
        let s = &defs[0]["inputSchema"];
        assert_eq!(s["additionalProperties"], json!(false));
        assert_eq!(s["required"], json!(["pad"]));
        let keuze = &s["properties"]["analysemodel"]["oneOf"];
        assert_eq!(keuze[0]["type"], json!("string"));
        assert_eq!(keuze[1]["type"], json!("integer"));
        assert_eq!(keuze[1]["minimum"], json!(1));
        assert_eq!(s["properties"]["analyse"]["enum"], json!(["linear", "p-delta"]));
        assert_eq!(s["properties"]["uitvoerpad"]["type"], json!("string"));
        assert_eq!(s["properties"]["overschrijven"]["type"], json!("boolean"));
    }

    /// #233: het uitvoerpad wordt vooraf gekeurd — extensie, absoluut, map
    /// bestaat, en een bestaand bestand alleen met `overschrijven`.
    #[test]
    fn uitvoerpad_wordt_vooraf_gekeurd() {
        let map = std::env::temp_dir().join(format!("ifc-uitvoer-{}", std::process::id()));
        std::fs::create_dir_all(&map).unwrap();
        let nieuw = map.join("hal.ifcfem").to_string_lossy().into_owned();
        assert!(keur_uitvoerpad(&nieuw, false).is_ok());
        assert!(keur_uitvoerpad(&map.join("hal.json").to_string_lossy(), false).is_err());
        assert!(keur_uitvoerpad("relatief/hal.ifcfem", false).is_err());
        assert!(keur_uitvoerpad(&map.join("bestaat-niet/hal.ifcfem").to_string_lossy(), false).is_err());
        schrijf_projectbestand(&nieuw, "{}").unwrap();
        assert_eq!(std::fs::read_to_string(&nieuw).unwrap(), "{}");
        let fout = keur_uitvoerpad(&nieuw, false).unwrap_err();
        assert!(fout.message.contains("overschrijven"), "{}", fout.message);
        assert!(keur_uitvoerpad(&nieuw, true).is_ok());
        let _ = std::fs::remove_dir_all(&map);
    }
}
