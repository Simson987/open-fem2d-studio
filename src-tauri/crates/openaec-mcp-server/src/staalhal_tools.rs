//! `open_fem_3d_staalhal_maken` — een stalen hal als 3D-raamwerk met één
//! aanroep: model (projectbestand), en desgewenst meteen doorgerekend en
//! getoetst.
//!
//! WAT HIER GEBEURT EN WAT NIET
//! Deze module bouwt geen hal en rekent geen staaf. De keten is:
//!   1. sidecar `staalhal_maken` — de generator van de wizard in de app
//!      (`design-mockup/src/components/openFem3d/wizards/staalhal.ts`) en,
//!      met `reken`, de rekenverzoeken per belastinggeval en per
//!      standaardcombinatie (dezelfde `buildOpenFem3DSolveRequest` als de app);
//!   2. hier: elk verzoek door `open_fem_3d::solve`, dezelfde vastgezette
//!      3D-kern als het Tauri-command en de tool `solve_open_fem_3d`;
//!   3. sidecar `staalhal_uitwerken` — reactiesommen, evenwicht, verplaatsingen
//!      en de EN 1993-toetsinvoer (`buildOpenFem3DSteelCheckInputs`);
//!   4. hier: `steel_check::check_all_beams`, de functie achter het
//!      Tauri-command `check_steel_beams`, en het groeperen van de uitkomsten
//!      per rol (kolom, spantligger, …) met de staafnummers die de generator
//!      meegaf.
//! De parameters van de hal worden in de sidecar gelezen, met dezelfde poort
//! als in de app: een onbekend veld of een verkeerd type is een fout, nooit
//! een stille standaardwaarde. Het schema hieronder is daar de spiegel van
//! (zie de test `schema_spiegelt_de_veldpoort_van_de_generator`).

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

use crate::fem_tools::van_sidecar;
use crate::RpcError;

pub(crate) const TOOL: &str = "open_fem_3d_staalhal_maken";

pub(crate) fn is_staalhal_tool(naam: &str) -> bool {
    naam == TOOL
}

// ── Schema ──────────────────────────────────────────────────────────────────

const STAALSOORTEN: [&str; 5] = ["S235", "S275", "S355", "S420", "S460"];
const BETONKLASSEN: [&str; 14] = [
    "C12/15", "C16/20", "C20/25", "C25/30", "C30/37", "C35/45", "C40/50", "C45/55", "C50/60",
    "C55/67", "C60/75", "C70/85", "C80/95", "C90/105",
];

fn maat(standaard: f64, max: f64, beschrijving: &str) -> Value {
    json!({ "type": "number", "exclusiveMinimum": 0, "maximum": max, "default": standaard, "description": beschrijving })
}

fn last(standaard: f64, beschrijving: &str) -> Value {
    json!({ "type": "number", "minimum": 0, "maximum": 100, "default": standaard, "description": beschrijving })
}

fn profielkeuze(profiel: &str, rol: &str) -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "description": format!("{rol}: catalogusprofiel en staalsoort."),
        "properties": {
            "profiel": { "type": "string", "minLength": 1, "default": profiel,
                "description": "Profiel uit de staalcatalogus (met I_z en I_t), bijv. \"HEA 450\" of \"CHS 88.9x4\"." },
            "materiaal": { "type": "string", "enum": STAALSOORTEN, "default": "S235" }
        }
    })
}

/// Het strikte schema van de halparameters: dezelfde velden, standaardwaarden
/// en grenzen als `leesStaalhalInvoer` in de generator. Gedeeld met
/// `gui_build_3d_steel_hall`, zodat de app en de MCP-tool één vocabulaire
/// hebben.
pub(crate) fn hal_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "default": {},
        "description": "Parameters van de hal. Alle lengtes in mm; ontbrekende velden krijgen de standaardwaarde (samen: de voorbeeldhal 60 × 30 m). Assen: x langs de hal, y dwars (overspanning), z omhoog, peil 0 = z 0.",
        "properties": {
            "lengteMm": maat(60000.0, 500000.0, "Lengte van de hal (x), mm."),
            "breedteMm": maat(30000.0, 500000.0, "Breedte = overspanning van de spanten (y), mm."),
            "spantafstandMm": maat(6000.0, 500000.0, "Grootste h.o.h.-afstand van de spanten, mm. Aantal vakken = ⌈lengte/spantafstand⌉, de werkelijke afstand lengte/aantal. Niet samen met aantalVakken."),
            "aantalVakken": { "type": "integer", "minimum": 1, "maximum": 100,
                "description": "Aantal vakken tussen de spanten (aantal spanten = vakken + 1). Niet samen met spantafstandMm." },
            "goothoogteMm": maat(8000.0, 60000.0, "Goothoogte (bovenkant kolom, lage zijde bij een lessenaarsdak), mm boven peil."),
            "dak": {
                "type": "object",
                "additionalProperties": false,
                "default": { "type": "zadeldak" },
                "description": "Daktype. Ontbreken nokhoogte en helling, dan geldt helling 1 : 10.",
                "properties": {
                    "type": { "type": "string", "enum": ["zadeldak", "lessenaarsdak", "platdak"], "default": "zadeldak" },
                    "nokhoogteMm": { "type": "number", "exclusiveMinimum": 0, "maximum": 60000,
                        "description": "Zadeldak: nokhoogte; lessenaarsdak: hoogte aan de hoge zijde (y = breedte); mm boven peil. Niet samen met hellingGraden." },
                    "hellingGraden": { "type": "number", "exclusiveMinimum": 0, "maximum": 60,
                        "description": "Dakhelling in graden, in plaats van nokhoogteMm." }
                }
            },
            "gordingafstandMm": maat(2500.0, 500000.0, "Grootste gordingafstand, horizontaal gemeten, mm. Bij een zadeldak valt de nok op een gording."),
            "profielen": {
                "type": "object",
                "additionalProperties": false,
                "description": "Profielen per groep; alleen staal (S235–S460) met een catalogusprofiel.",
                "properties": {
                    "kolom": profielkeuze("HEA 450", "Kolommen (90° gedraaid: lijf in het spantvlak)"),
                    "spantligger": profielkeuze("IPE 600", "Spantliggers"),
                    "gording": profielkeuze("IPE 160", "Gordingen (scharnierend van spant tot spant)"),
                    "randligger": profielkeuze("HEA 160", "Randliggers langs de goten (scharnierend)"),
                    "verband": profielkeuze("CHS 88.9x4", "Dak- en wandverbanden (scharnierende kruizen)")
                }
            },
            "kolomvoet": { "type": "string", "enum": ["ingeklemd", "scharnierend"], "default": "ingeklemd",
                "description": "Op vaste opleggingen: inklemming of scharnier. Op het balkrooster: star of met een eindscharnier (My, Mz) op de poer." },
            "verbanden": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "vakken": {
                        "oneOf": [
                            { "type": "string", "enum": ["kopvakken", "alle", "geen"] },
                            { "type": "array", "items": { "type": "integer", "minimum": 1 }, "description": "Vaknummers, 1 = eerste vak." }
                        ],
                        "default": "kopvakken"
                    },
                    "dak": { "type": "boolean", "default": true, "description": "Dakverband: kruis in elk gordingveld van de gekozen vakken." },
                    "wanden": { "type": "boolean", "default": true, "description": "Wandverband: kruis in beide langsgevels van de gekozen vakken. Verplicht bij scharnierende kolomvoeten." }
                }
            },
            "fundering": {
                "type": "object",
                "additionalProperties": false,
                "description": "Vaste opleggingen onder de kolommen, of een betonnen balkrooster op palen (hal en rooster rekenen samen).",
                "properties": {
                    "type": { "type": "string", "enum": ["opleggingen", "balkrooster"], "default": "opleggingen" },
                    "balkBreedteMm": maat(400.0, 5000.0, "Breedte funderingsbalk, mm."),
                    "balkHoogteMm": maat(600.0, 5000.0, "Hoogte funderingsbalk, mm."),
                    "betonklasse": { "type": "string", "enum": BETONKLASSEN, "default": "C20/25" },
                    "dwarsbalken": { "type": "string", "enum": ["elkSpant", "kopspanten"], "default": "elkSpant",
                        "description": "Dwarsbalken onder elk spant of alleen onder de kopspanten; langsbalken liggen altijd onder beide kolomlijnen." },
                    "diepteMm": { "type": "number", "minimum": 0, "maximum": 20000, "default": 800,
                        "description": "Diepte van de systeemlijn (hart balk) onder peil, mm. Groter dan 0: een betonnen poer verbindt kolomvoet en rooster." },
                    "paalKzKnPerMm": { "type": "number", "exclusiveMinimum": 0, "maximum": 1000000, "default": 100,
                        "description": "Verticale veerstijfheid per paal, kN/mm." },
                    "paalHorizontaal": { "type": "string", "enum": ["veren", "statischBepaald"], "default": "veren",
                        "description": "veren: horizontale veer per paal (paalKhKnPerMm); statischBepaald: u_x en u_y vast in de eerste paal, u_y in de laatste paal van kolomlijn y = 0." },
                    "paalKhKnPerMm": { "type": "number", "exclusiveMinimum": 0, "maximum": 1000000, "default": 5,
                        "description": "Horizontale veerstijfheid per paal, kN/mm (bij paalHorizontaal = veren)." },
                    "paalAfstandMm": { "type": "number", "minimum": 500, "maximum": 500000, "default": 6000,
                        "description": "Grootste h.o.h.-afstand van de palen langs een balk; onder elke kolom staat altijd een paal." }
                }
            },
            "lasten": {
                "type": "object",
                "additionalProperties": false,
                "description": "Lasten in kN/m² horizontale projectie. Belastinggevallen: 1 Permanent (G), 2 Sneeuw (S), 3 Wind dwars (+Y), 4 Wind langs (+X), 5 Eigen gewicht.",
                "properties": {
                    "dakafwerkingKnM2": last(0.3, "Dakafwerking (G), op de gordingen."),
                    "sneeuwKnM2": last(0.56, "Sneeuw (S), op de gordingen."),
                    "wind": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "bron": { "type": "string", "enum": ["handmatig", "stuwdruk"], "default": "handmatig",
                                "description": "handmatig: de drie drukken hieronder; stuwdruk: q_p(z = nokhoogte) uit NEN-EN 1991-1-4 met c_pe,10 van tabel 7.1 (zones D/E) en cDak op het hele dak." },
                            "drukKnM2": last(0.64, "Druk op de loefgevel (wind dwars op de kolommen y = 0, wind langs op de kopgevel)."),
                            "zuigingKnM2": last(0.4, "Zuiging op de lijgevel (kolommen y = breedte)."),
                            "dakZuigingKnM2": last(0.48, "Opwaartse zuiging op het hele dak (in het geval wind dwars)."),
                            "windgebied": { "type": "string", "enum": ["I", "II", "III"], "default": "II" },
                            "terreincategorie": { "type": "string", "enum": ["0", "I", "II", "III", "IV"], "default": "III" },
                            "cDak": { "type": "number", "minimum": 0, "maximum": 5, "default": 0.6,
                                "description": "Vormfactor voor de opwaartse zuiging op het dak (bij bron stuwdruk)." }
                        }
                    }
                }
            },
            "eigenGewicht": { "type": "boolean", "default": true,
                "description": "Het vaste geval \"Eigen gewicht\" (id 5) en eigen gewicht aan: ρ·A·g per staaf, ook voor rooster en poeren." },
            "projectnaam": { "type": "string", "default": "", "description": "Leeg: \"Staalhal <lengte> × <breedte> m\"." }
        }
    })
}

pub(crate) fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": TOOL,
        "description": "Maak een stalen hal als 3D-raamwerk (spanten, gordingen, randliggers, dak- en wandverbanden, lasten G/S/W dwars/W langs en eigen gewicht), eventueel op een betonnen balkrooster op palen. Geeft het projectbestand (.ifcfem-inhoud, te openen in Open FEM Studio of met gui_load_model), een samenvatting (aantallen, maten, staafnummers per groep) en waarschuwingen. Met `reken: true` rekent dezelfde 3D-kern als solve_open_fem_3d elk belastinggeval en elke standaardcombinatie, en komen per geval de reactiesommen, het evenwicht, de grootste verplaatsing, de zijverplaatsing van de goot en de paalreacties terug; met `toetsen` (standaard aan) ook de EN 1993-toetsing met UC per groep. Dezelfde generator als de wizard \"Stalen hal…\" in de app.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "hal": hal_schema(),
                "reken": { "type": "boolean", "default": false,
                    "description": "Meteen doorrekenen met de 3D-kern (per belast geval en per standaardcombinatie)." },
                "analyse": { "type": "string", "enum": ["linear", "p-delta"], "default": "linear",
                    "description": "Eerste orde (linear, zoals het projectbestand) of tweede orde (p-delta)." },
                "gevolgklasse": { "type": "string", "enum": ["CC1", "CC2", "CC3"], "default": "CC2",
                    "description": "Gevolgklasse voor de factoren van de standaardcombinaties (NEN-EN 1990 NB)." },
                "toetsen": { "type": "boolean", "default": true,
                    "description": "Met reken: ook EN 1993 toetsen (staven van staal; beton wordt met reden overgeslagen)." },
                "stramien": { "type": "boolean", "default": true,
                    "description": "Het stramien van de hal (spanten, gevels, levels) in het projectbestand." },
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
    #[serde(default)]
    hal: Option<Value>,
    #[serde(default)]
    reken: bool,
    #[serde(default)]
    analyse: Option<String>,
    #[serde(default)]
    gevolgklasse: Option<String>,
    #[serde(default)]
    toetsen: Option<bool>,
    #[serde(default)]
    stramien: Option<bool>,
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

fn rekenfout(melding: impl Into<String>) -> RpcError {
    let melding = melding.into();
    RpcError {
        code: -32000,
        message: format!("[MODEL_ONOPLOSBAAR] {melding}"),
        data: Some(json!({
            "error_code": "MODEL_ONOPLOSBAAR",
            "melding": melding,
            "remedie": "Controleer profielen, kolomvoeten en verbanden; een hal zonder wandverband op scharnieren is een mechanisme.",
        })),
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
    let volledig = detail == "volledig";
    let hal = a.hal.unwrap_or_else(|| json!({}));
    let reken = json!({
        "analyse": a.analyse.as_deref().unwrap_or("linear"),
        "gevolgklasse": a.gevolgklasse.as_deref().unwrap_or("CC2"),
    });

    let mut maken = json!({ "hal": hal, "stramien": a.stramien.unwrap_or(true) });
    if a.reken {
        maken["reken"] = reken.clone();
    }
    let gemaakt = roep("staalhal_maken", maken, a.timeout_s).await?;
    let mut uit = Map::new();
    for sleutel in ["project", "parameters", "samenvatting", "waarschuwingen"] {
        uit.insert(sleutel.to_owned(), gemaakt.get(sleutel).cloned().unwrap_or(Value::Null));
    }
    if !a.reken {
        return Ok(Value::Object(uit));
    }

    // ── Rekenen: elk verzoek door dezelfde 3D-kern als solve_open_fem_3d ──
    let verzoeken: Vec<(String, String, open_fem_3d::SolveRequest3D)> = gemaakt["rekenverzoeken"]
        .as_array()
        .ok_or_else(|| RpcError::tool_exec("de sidecar leverde geen rekenverzoeken"))?
        .iter()
        .map(|v| {
            let sleutel = v["sleutel"].as_str().unwrap_or_default().to_owned();
            let naam = v["naam"].as_str().unwrap_or_default().to_owned();
            serde_json::from_value(v["verzoek"].clone())
                .map(|verzoek| (sleutel.clone(), naam, verzoek))
                .map_err(|e| RpcError::tool_exec(format!("rekenverzoek {sleutel} past niet op het 3D-contract: {e}")))
        })
        .collect::<Result<_, _>>()?;
    let aantal_verzoeken = verzoeken.len();
    let resultaten = tokio::task::spawn_blocking(move || {
        let mut resultaten = Map::new();
        for (sleutel, naam, verzoek) in verzoeken {
            let r = open_fem_3d::solve(verzoek).map_err(|e| format!("{naam} ({sleutel}): {e}"))?;
            let waarde = serde_json::to_value(r).map_err(|e| format!("{sleutel}: resultaat niet naar JSON: {e}"))?;
            resultaten.insert(sleutel, waarde);
        }
        Ok::<_, String>(resultaten)
    })
    .await
    .map_err(|e| RpcError::tool_exec(format!("3D-kern kon niet worden afgerond: {e}")))?
    .map_err(|e| rekenfout(format!("De 3D-kern weigerde de hal: {e}")))?;

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

    let uitgewerkt = roep(
        "staalhal_uitwerken",
        json!({ "hal": gemaakt["parameters"], "reken": reken, "resultaten": Value::Object(resultaten) }),
        a.timeout_s,
    )
    .await?;

    let mut berekening = Map::new();
    berekening.insert("analyse".to_owned(), uitgewerkt["reken"]["analyse"].clone());
    berekening.insert("gevolgklasse".to_owned(), uitgewerkt["reken"]["gevolgklasse"].clone());
    berekening.insert("aantal_berekeningen".to_owned(), json!(aantal_verzoeken));
    berekening.insert("gevallen".to_owned(), uitgewerkt["gevallen"].clone());
    berekening.insert("combinaties".to_owned(), uitgewerkt["combinaties"].clone());
    berekening.insert("grenzen_ter_vergelijking".to_owned(), uitgewerkt["grenzen"].clone());
    if volledig {
        berekening.insert("per_geval".to_owned(), Value::Array(per_geval_volledig));
    }

    if a.toetsen.unwrap_or(true) {
        let invoer: Vec<steel_check::BeamCheckInput> = serde_json::from_value(uitgewerkt["toetsinvoer"].clone())
            .map_err(|e| RpcError::tool_exec(format!("de toetsinvoer van de sidecar past niet op BeamCheckInput: {e}")))?;
        let uitkomsten = tokio::task::spawn_blocking(move || steel_check::check_all_beams(invoer))
            .await
            .map_err(|e| RpcError::tool_exec(format!("toetsing kon niet worden afgerond: {e}")))?;
        let uitkomsten = serde_json::to_value(uitkomsten)
            .map_err(|e| RpcError::tool_exec(format!("toetsuitkomst niet naar JSON: {e}")))?;
        berekening.insert(
            "toetsing".to_owned(),
            groepeer_toetsing(&uitkomsten, &gemaakt["samenvatting"]["groepen"], &uitgewerkt, volledig),
        );
    }
    uit.insert("berekening".to_owned(), Value::Object(berekening));
    Ok(Value::Object(uit))
}

/// De uitkomst van `check_all_beams` per groep van de hal. Geen eigen
/// toetslogica: `uc_max`, `status` en `governing_check_id` zijn die van de
/// staaltoets zelf; hier wordt alleen per groep het maximum gezocht. Ook de
/// IFC-import (`ifc_import_tools.rs`) groepeert hiermee, per onderdeel uit het
/// bestand.
pub(crate) fn groepeer_toetsing(uitkomsten: &Value, groepen: &Value, uitgewerkt: &Value, volledig: bool) -> Value {
    let mut groep_van: BTreeMap<i64, String> = BTreeMap::new();
    if let Some(groepen) = groepen.as_object() {
        for (groep, ids) in groepen {
            for id in ids.as_array().into_iter().flatten().filter_map(Value::as_i64) {
                groep_van.insert(id, groep.clone());
            }
        }
    }
    let mut per_groep: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
    let mut maatgevend: Option<(f64, Value)> = None;
    let mut telling: BTreeMap<String, u64> = BTreeMap::new();
    let mut per_staaf = Vec::new();
    for r in uitkomsten.as_array().into_iter().flatten() {
        let id = r["beam_id"].as_i64().unwrap_or_default();
        let uc = r["uc_max"].as_f64().unwrap_or(f64::NAN);
        let groep = groep_van.get(&id).cloned().unwrap_or_else(|| "overig".to_owned());
        let status = r["status"].as_str().unwrap_or("?").to_owned();
        *telling.entry(status.clone()).or_default() += 1;
        let samenvatting = json!({
            "beam_id": id,
            "groep": groep,
            "profiel": r["profile_name"],
            "uc_max": uc,
            "status": status,
            "maatgevende_toets": r["governing_check_id"],
        });
        let g = per_groep.entry(groep.clone()).or_default();
        let aantal = g.get("aantal").and_then(Value::as_u64).unwrap_or(0) + 1;
        g.insert("aantal".to_owned(), json!(aantal));
        if g.get("uc_max").and_then(Value::as_f64).is_none_or(|huidig| uc > huidig) {
            g.insert("uc_max".to_owned(), json!(uc));
            g.insert("beam_id".to_owned(), json!(id));
            g.insert("profiel".to_owned(), r["profile_name"].clone());
            g.insert("maatgevende_toets".to_owned(), r["governing_check_id"].clone());
        }
        if maatgevend.as_ref().is_none_or(|(huidig, _)| uc > *huidig) {
            maatgevend = Some((uc, samenvatting.clone()));
        }
        if volledig {
            per_staaf.push(samenvatting);
        }
    }
    let mut toetsing = json!({
        "norm": "NEN-EN 1993-1-1",
        "uc_max": maatgevend.as_ref().map(|(uc, _)| json!(uc)).unwrap_or(Value::Null),
        "maatgevend": maatgevend.map(|(_, s)| s).unwrap_or(Value::Null),
        "per_groep": per_groep,
        "status_telling": telling,
        "niet_getoetst": uitgewerkt["nietGetoetst"],
        "notities": uitgewerkt["notities"],
    });
    if volledig {
        toetsing["per_staaf"] = Value::Array(per_staaf);
    }
    toetsing
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// De velden van één `export const NAAM = [...] as const;` uit de generator.
    fn velden_uit_bron(bron: &str, naam: &str) -> BTreeSet<String> {
        let start = bron
            .find(&format!("export const {naam} = ["))
            .unwrap_or_else(|| panic!("{naam} staat niet (meer) in staalhal.ts"));
        let rest = &bron[start..];
        let blok = &rest[rest.find('[').unwrap() + 1..rest.find("] as const;").expect("niet gesloten")];
        blok.split('"').skip(1).step_by(2).map(str::to_owned).collect()
    }

    fn sleutels(schema: &Value) -> BTreeSet<String> {
        schema["properties"].as_object().expect("properties").keys().cloned().collect()
    }

    /// Het schema is de spiegel van de invoerpoort van de generator
    /// (`design-mockup/src/components/openFem3d/wizards/staalhal.ts`): elk
    /// niveau noemt precies de velden die de poort kent. Een veld dat aan één
    /// kant bijkomt valt hier op, zodat het schema nooit iets belooft dat de
    /// poort weigert, of andersom.
    #[test]
    fn schema_spiegelt_de_veldpoort_van_de_generator() {
        let pad = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../design-mockup/src/components/openFem3d/wizards/staalhal.ts");
        let bron = std::fs::read_to_string(&pad).unwrap_or_else(|e| panic!("{} niet leesbaar: {e}", pad.display()));
        let hal = hal_schema();
        let p = &hal["properties"];
        assert_eq!(sleutels(&hal), velden_uit_bron(&bron, "STAALHAL_VELDEN"));
        assert_eq!(sleutels(&p["dak"]), velden_uit_bron(&bron, "STAALHAL_DAK_VELDEN"));
        assert_eq!(sleutels(&p["profielen"]), velden_uit_bron(&bron, "STAALHAL_PROFIEL_GROEPEN"));
        for groep in velden_uit_bron(&bron, "STAALHAL_PROFIEL_GROEPEN") {
            assert_eq!(sleutels(&p["profielen"]["properties"][&groep]), velden_uit_bron(&bron, "STAALHAL_PROFIEL_VELDEN"), "{groep}");
        }
        assert_eq!(sleutels(&p["verbanden"]), velden_uit_bron(&bron, "STAALHAL_VERBAND_VELDEN"));
        assert_eq!(sleutels(&p["fundering"]), velden_uit_bron(&bron, "STAALHAL_FUNDERING_VELDEN"));
        assert_eq!(sleutels(&p["lasten"]), velden_uit_bron(&bron, "STAALHAL_LASTEN_VELDEN"));
        assert_eq!(sleutels(&p["lasten"]["properties"]["wind"]), velden_uit_bron(&bron, "STAALHAL_WIND_VELDEN"));
    }

    /// `additionalProperties: false` op ELK objectniveau van het schema.
    #[test]
    fn schema_is_strikt_op_elk_niveau() {
        fn loop_na(pad: &str, schema: &Value, gezien: &mut usize) {
            if schema.get("properties").is_some() {
                *gezien += 1;
                assert_eq!(schema["additionalProperties"], json!(false), "{pad} is niet strikt");
                for (k, v) in schema["properties"].as_object().unwrap() {
                    loop_na(&format!("{pad}.{k}"), v, gezien);
                }
            }
        }
        let mut gezien = 0;
        loop_na("inputSchema", &tool_definitions()[0]["inputSchema"], &mut gezien);
        // invoer, hal, dak, profielen + 5 groepen, verbanden, fundering, lasten, wind
        assert_eq!(gezien, 13);
    }

    #[test]
    fn groeperen_neemt_het_maximum_per_groep_zonder_eigen_toetslogica() {
        let uitkomsten = json!([
            { "beam_id": 1, "profile_name": "HEA 450", "uc_max": 0.4, "status": "Ok", "governing_check_id": "a" },
            { "beam_id": 2, "profile_name": "HEA 450", "uc_max": 0.7, "status": "Ok", "governing_check_id": "b" },
            { "beam_id": 3, "profile_name": "IPE 600", "uc_max": 1.2, "status": "NotOk", "governing_check_id": "c" }
        ]);
        let groepen = json!({ "kolom": [1, 2], "spantligger": [3] });
        let t = groepeer_toetsing(&uitkomsten, &groepen, &json!({ "nietGetoetst": [], "notities": [] }), false);
        assert_eq!(t["per_groep"]["kolom"]["uc_max"], json!(0.7));
        assert_eq!(t["per_groep"]["kolom"]["beam_id"], json!(2));
        assert_eq!(t["per_groep"]["kolom"]["aantal"], json!(2));
        assert_eq!(t["uc_max"], json!(1.2));
        assert_eq!(t["maatgevend"]["groep"], json!("spantligger"));
        assert_eq!(t["status_telling"], json!({ "NotOk": 1, "Ok": 2 }));
        assert!(t.get("per_staaf").is_none());
    }
}
