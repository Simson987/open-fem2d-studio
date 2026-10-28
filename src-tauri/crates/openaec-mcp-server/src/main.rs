//! openaec-mcp-server — Model Context Protocol server exposing the
//! OpenAEC check engines (EN 1993 steel, EN 1992 concrete, EN 1995 timber and
//! cross-laminated timber) and the 2D FEM solver over stdio (JSON-RPC 2.0).
//!
//! Speaks newline-delimited JSON-RPC on stdin/stdout. stderr is reserved
//! for human-readable tracing (so it never collides with protocol traffic).
//!
//! Implements the minimal subset of MCP needed for tool calls from
//! Claude Desktop / Claude Code: `initialize`, `notifications/initialized`,
//! `tools/list`, `tools/call`. Protocol version: 2025-06-18.
//!
//! Heavy work (PDF generation, steel checks) runs on
//! `tokio::task::spawn_blocking` so the stdio reader never stalls.

// De toolschema's zijn één grote `json!`-boom; met de velden `staafeinden` en
// `staaf_notities` (september 2026) liep die tegen de standaardgrens van 128
// macro-expansies aan.
#![recursion_limit = "512"]

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;

/// De vijf FEM-tools. Ze rekenen niet hier maar in de Node-sidecar, op
/// letterlijk dezelfde solver als de app. Zie `fem_tools.rs`.
mod fem_tools;

/// Ruimtelijke raamwerken: dezelfde versievaste Rust-adapter als de app.
mod frame3d_tools;
mod native_fem_tools;
mod open_fem_3d_tools;

/// De stalen hal (`open_fem_3d_staalhal_maken`): de generator van de wizard in
/// de sidecar, rekenen met de 3D-kern hierboven en toetsen met `steel_check`.
mod staalhal_tools;

/// De import van een IFC4-analysemodel (`open_fem_3d_ifc_importeren`): de
/// import van de app in de sidecar, rekenen met de 3D-kern en toetsen met
/// `steel_check`, langs dezelfde keten als de stalen hal.
mod ifc_import_tools;
mod extensie_tools;

/// De acht betontools (NEN-EN 1992-1-1). Ze roepen dezelfde `concrete_check`
/// aan als het Tauri-command en de toetsbrug — de derde weg naar één
/// rekengang. Zie `concrete_tools.rs`.
mod concrete_tools;

/// De GUI-tools: bedienen de DRAAIENDE desktop-app over haar bedieningskanaal
/// (Instellingen → AI-assistent (MCP), of `OPENAEC_GUI_CONTROL=1`), en
/// `gui_start_app` start de geïnstalleerde app met dat kanaal aan. Geen
/// rekenkern-opdrachten en dus buiten de
/// drie-wegen-regel — zij zíjn de weg naar de GUI. Zie `gui_tools.rs`.
mod gui_tools;

/// De vier houttools (NEN-EN 1995-1-1), hout en kruislaaghout. Ze roepen
/// dezelfde `timber_check` aan als het Tauri-command en de toetsbrug. Deze weg
/// ontbrak, terwijl `generate_steel_report_pdf` hieronder wél
/// `timber_check_results` accepteert — de rapportweg beloofde dus hout dat
/// langs deze weg niet te maken was. Zie `timber_tools.rs`.
mod timber_tools;

/// De plaattoets (wandschijven, belast in het vlak): `check_plates`. Roept
/// dezelfde `plaat_check::check_all_plates` aan als het Tauri-command en de
/// toetsbrug. Zie `plate_tools.rs`.
mod plate_tools;

/// De API-commando's van de app (het commandoregister in `design-mockup/src/api/`):
/// één tool per commando, uit de ingebakken catalogus. Met `project` zonder app op
/// een bestand (via de sidecar), anders in de draaiende app. Zie `api_tools.rs`.
mod api_tools;
// `detail: "samenvatting"` voor toetsantwoorden van enkele kB (#229).
mod samenvatting;
#[cfg(test)]
mod report_tests;

const PROTOCOL_VERSION: &str = "2025-06-18";
const SERVER_NAME: &str = "openaec-fem";
const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

// ── JSON-RPC types ───────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct Request {
    jsonrpc: String,
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

impl RpcError {
    fn invalid_params(msg: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: msg.into(),
            data: None,
        }
    }
    fn tool_exec(msg: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: msg.into(),
            data: None,
        }
    }
    fn method_not_found(method: &str) -> Self {
        Self {
            code: -32601,
            message: format!("Method not found: {method}"),
            data: None,
        }
    }

    /// De fout als machineleesbaar object, voor `structuredContent` op het
    /// toolfoutpad.
    ///
    /// Waarom dit bestaat: `tools/call` geeft een toolfout per MCP-spec terug
    /// als een *geslaagd* resultaat met `isError: true`, zodat het model de fout
    /// kan lezen. Daarbij verdampten tot nu toe de foutcode en `data`, en bleef
    /// er alleen een tekstregel over. Voor een client leest "Node ontbreekt" dan
    /// identiek aan "je raamwerk is een mechanisme" — de eerste is een
    /// installatieprobleem, de tweede een constructieve bevinding. Bij
    /// rekensoftware mag een ontbrekende runtime nooit op een rekenfout lijken,
    /// dus gaan code, melding, remedie en detail hier mee terug.
    ///
    /// `data` is de bron zodra die er is: de FEM-tools vullen hem al met
    /// `error_code`, `melding`, `remedie` en `detail`. Ontbreekt hij, dan wordt
    /// er een code afgeleid uit de JSON-RPC-code, zodat een client ALTIJD iets
    /// machineleesbaars krijgt en nooit op de meldingstekst hoeft te matchen.
    fn gestructureerde_fout(&self) -> Value {
        let mut velden = match &self.data {
            Some(Value::Object(map)) => map.clone(),
            // Een niet-object `data` (geen enkele tool doet dit vandaag) gaat
            // ongewijzigd mee als detail in plaats van verloren te gaan.
            Some(anders) => {
                let mut m = Map::new();
                m.insert("detail".to_owned(), anders.clone());
                m
            }
            None => Map::new(),
        };
        velden
            .entry("error_code")
            .or_insert_with(|| json!(afgeleide_foutcode(self.code)));
        velden
            .entry("melding")
            .or_insert_with(|| json!(self.message));
        // De sleutel staat er altijd, desnoods op `null`: dan is zichtbaar dat
        // er geen remedie bekend is, in plaats van dat het veld ontbreekt en de
        // client moet raden of hij iets mist.
        velden.entry("remedie").or_insert(Value::Null);
        Value::Object(velden)
    }
}

/// JSON-RPC-code → machineleesbare foutcode, als terugval voor tools die er zelf
/// nog geen meegeven (de vijf staaltools).
///
/// Bewust grof en kort: dit is een terugvalwaarde, geen tweede codelijst naast
/// die van de sidecar. `ARGUMENT_ONGELDIG` is dezelfde code die `fem_tools`
/// gebruikt voor een ondeugdelijke aanroep, zodat een client één begrip heeft
/// voor "jouw aanroep deugde niet".
fn afgeleide_foutcode(code: i32) -> &'static str {
    match code {
        -32602 => "ARGUMENT_ONGELDIG",
        -32601 => "TOOL_ONBEKEND",
        _ => "TOOL_MISLUKT",
    }
}

fn ok(id: Value, result: Value) -> Response {
    Response {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}
fn err(id: Value, error: RpcError) -> Response {
    Response {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(error),
    }
}

// ── Tool registry ────────────────────────────────────────────────────────────

/// Schema van `forces_envelope` (`Vec<ForcePoint>`).
///
/// Geen `additionalProperties: false` op de punten zelf: `ForcePoint` en
/// `InternalForces` kennen geen `#[serde(default)]`, dus daar levert een
/// tikfout altijd al een "missing field"-fout op. Het schema belooft hier dus
/// niet strenger te zijn dan de server werkelijk is.
///
/// Wordt gedeeld met `concrete_tools`: `ConcreteBeamCheckInput` draagt dezelfde
/// `Vec<ForcePoint>` als `BeamCheckInput`, dus één schema en geen tweede
/// beschrijving die kan afwijken.
fn schema_krachtenomhullende() -> Value {
    json!({
        "type": "array",
        "description": "Omhullende van de snedekrachten: per combinatie en per station een punt. Eenheden kN en kNm; N positief = trek.",
        "items": {
            "type": "object",
            "required": ["combination_id", "position_mm", "forces"],
            "properties": {
                "combination_id": { "type": "integer", "minimum": 0 },
                "position_mm": { "type": "number", "description": "Afstand vanaf het staafbegin in mm." },
                "forces": {
                    "type": "object",
                    "required": ["n_ed", "vy_ed", "vz_ed", "mt_ed", "my_ed", "mz_ed"],
                    "properties": {
                        "n_ed":  { "type": "number", "description": "Normaalkracht kN, positief = trek." },
                        "vy_ed": { "type": "number", "description": "Dwarskracht kN." },
                        "vz_ed": { "type": "number", "description": "Dwarskracht kN." },
                        "mt_ed": { "type": "number", "description": "Wringend moment kNm." },
                        "my_ed": { "type": "number", "description": "Buigend moment kNm." },
                        "mz_ed": { "type": "number", "description": "Buigend moment kNm." }
                    }
                }
            }
        }
    })
}

/// Schema van `custom_section` (D4.3, inline opgegeven doorsnede).
///
/// Alle geneste objecten staan op `additionalProperties: false`, gelijk aan
/// `#[serde(deny_unknown_fields)]` op `CustomSection`, `CustomLamella`,
/// `CustomGeslotenCel` en `CustomPunt`. Uitzondering: `eigenschappen`
/// (`SectionProperties`) blijft los — dat type staat in een andere crate en
/// is hier niet aangepast.
fn schema_custom_section() -> Value {
    json!({
        "type": ["object", "null"],
        "additionalProperties": false,
        "description": "Inline opgegeven doorsnede. Gevuld = de profielendatabase wordt niet geraadpleegd. Weglaten of null = het gewone pad via 'profile_name'.",
        "required": ["naam"],
        "properties": {
            "naam": { "type": "string", "description": "Naam zoals hij in het rapport verschijnt." },
            "lamellen": {
                "type": "array",
                "description": "Rechthoekige platen waaruit de doorsnede is opgebouwd.",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["b_mm", "t_mm", "y_mm", "z_mm"],
                    "properties": {
                        "b_mm": { "type": "number", "description": "Lengte in de lengterichting van de plaat." },
                        "t_mm": { "type": "number", "description": "Dikte loodrecht daarop." },
                        "y_mm": { "type": "number" },
                        "z_mm": { "type": "number" },
                        "alpha_rad": { "type": "number", "default": 0,
                            "description": "Hoek van de lengterichting met de y-as; 0 = liggend, pi/2 = staand." }
                    }
                }
            },
            "gesloten_cellen": {
                "type": "array",
                "description": "Expliciet gedeclareerde gesloten cellen voor de Bredt-torsie. Ontbreken ze terwijl de lamellen wel een cel sluiten, dan wordt I_t met de open formule bepaald en verschijnt daarover een melding.",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["midlijn", "dikte_mm", "lamellen"],
                    "properties": {
                        "midlijn": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["y_mm", "z_mm"],
                                "properties": {
                                    "y_mm": { "type": "number" },
                                    "z_mm": { "type": "number" }
                                }
                            }
                        },
                        "dikte_mm": { "type": "array", "items": { "type": "number" } },
                        "lamellen": { "type": "array", "items": { "type": "integer", "minimum": 0 } }
                    }
                }
            },
            "eigenschappen": {
                "type": ["object", "null"],
                "description": "Kant-en-klare doorsnede-eigenschappen (SectionProperties); alleen gebruikt als 'lamellen' leeg is."
            },
            "vorm": {
                "type": "string",
                "enum": ["Onbekend", "GelasteIDubbelsymmetrisch", "GelasteIMonosymmetrisch", "Koker", "RondeBuis"],
                "default": "Onbekend",
                "description": "Vormaanduiding; alleen gebruikt als 'lamellen' leeg is. 'Onbekend' leidt tot weigering van de toetsing."
            }
        }
    })
}

/// Levert de payload van `tools/list`.
///
/// `check_steel_beam` heeft een **volledig en strikt** schema: elk veld dat de
/// Rust-kant kent staat erin, en `additionalProperties` staat op `false`. Dat
/// spiegelt `#[serde(deny_unknown_fields)]` op `BeamCheckInput`, zodat een
/// tikfout in een veldnaam een fout oplevert in plaats van een stille
/// terugval op de standaardwaarde. Dat verschil is niet cosmetisch: de vijf
/// `#[serde(default)]`-velden (onder andere `q_equiv_n_per_mm` en `z_a_mm`)
/// maken de kiptoets **gunstiger** als ze op nul vallen — onveilig aan de
/// verkeerde kant.
///
/// `generate_steel_report_pdf` staat nog wél op `additionalProperties: true`;
/// dat is een rapportage-invoer zonder rekengevolg.
///
/// De vijf FEM-tools uit `fem_tools` staan er ALTIJD bij, ook wanneer er geen
/// Node-runtime is. Verbergen zou de storing ondiagnosticeerbaar maken: de
/// client meldt dan dat de functie niet bestaat, terwijl de gebruiker weet dat
/// hij hem geïnstalleerd heeft. In plaats daarvan komt er bij de aanroep een
/// Nederlandse melding met foutcode en remedie, en blijft `fem_solver_status`
/// het eerste dat je vraagt.
///
/// De acht betontools uit `concrete_tools` volgen. Ze hebben, net als
/// `check_steel_beam`, een volledig en strikt schema: `ConcreteBeamCheckInput`
/// en `MnKappaRequest` staan op `#[serde(deny_unknown_fields)]`.
///
/// De vier houttools uit `timber_tools` sluiten de rij. Hún staafschema's
/// noemen ook elk veld, maar houden `additionalProperties` op `true`:
/// `TimberBeamCheckInput` en `CltBeamCheckInput` kennen géén
/// `deny_unknown_fields`, en een schema dat strenger belooft dan de server is
/// verplaatst de fout naar de client. De reden staat in `timber_tools.rs`.

/// Het schema van het veld `bijlage` — de nationale bijlage waarmee getoetst
/// wordt.
///
/// Eén functie voor alle gereedschappen die een nationaal bepaalde parameter
/// gebruiken. De `enum` komt uit `nationale_bijlage::BIJLAGEN_GEVULD`, zodat
/// het schema niet kan beweren dat een bijlage bestaat die geen rekenwaarden
/// heeft — en zodat er bij een tweede rij niets met de hand hoeft te worden
/// bijgewerkt.
fn schema_bijlage() -> Value {
    json!({
        "type": "string",
        "enum": nationale_bijlage::BIJLAGEN_GEVULD,
        "default": "NL",
        "description": "Nationale bijlage waarmee getoetst wordt. Zij bepaalt de nationaal bepaalde parameters (partiële factoren, doorbuigingsgrenzen, k_cr, dekkingseisen, de kipmethode). Alleen de bijlagen in deze lijst hebben rekenwaarden; een andere waarde wordt GEWEIGERD met reden en er wordt nooit stil op een andere bijlage teruggevallen. Weglaten = de enige gevulde bijlage."
    })
}

fn tool_definitions() -> Value {
    let mut tools = json!([
        {
            "name": "list_steel_profiles",
            "description": "List all steel cross-section profiles in the OpenAEC database (HEA, HEB, IPE, HEM, UNP, RHS, SHS, CHS). Each profile includes geometry, section properties, and EN 1993-1-1 buckling curves. 'bronnen' says per group which properties come from a published profile table and which are computed: for IPE/HEA/HEB/HEM A, I, W, i, A_v and I_t are EN 10365 table values while I_w comes from the section engine (the table I_w is an upper bound).",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "list_steel_grades",
            "description": "List supported EN 10025 structural-steel grades (S235, S275, S355, S420, S460) with yield strength, ultimate strength and partial factors gamma_M0/M1/M2.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "check_steel_beam",
            "description": "Run the full EN 1993-1-1 steel check (cross-section resistance §6.2, member stability §6.3, deflection SLS) on a single beam. Input is a BeamCheckInput (profile name, grade, length, force envelope, lateral bracing, etc.). Returns BeamCheckResult with full derivation trace. Bending and shear (§6.2.8) uses eq. (6.30) for doubly symmetric I/H sections and reports UC = M_y,Ed/M_y,V,Rd. A class 4 section is checked with the effective cross-section of EN 1993-1-5 4.4 (A_eff, W_eff; doubly symmetric I and hollow box); for any other class 4 shape only tension, shear and deflection are checked and the status is NotApplicable ('NIET TOETSBAAR: ...'), never Ok. A web with h_w/t_w > 72 eps/eta needs the shear buckling check of EN 1993-1-5 section 5, which is not implemented: shear (z), 6.2.8 and 6.2.10 are then refused, and with V_z,Ed > 0 the member is NotApplicable ('NIET VOLLEDIG GETOETST: ...') unless a computed check fails; V_z,Ed > V_pl,z,Rd (an upper bound) always gives NotOk. In 6.2.10 with only M_y and shear (N = 0, M_z = 0) the UC is M_y,Ed/M_y,V,Rd, as in 6.2.8. A 'Doorlopend' member end (see 'staafeinden') whose buckling or lateral-torsional check cannot be determined also gives NotApplicable ('NIET VOLLEDIG GETOETST: ...'), unless a computed check fails. A 'Vrij' member end without a given buckling length uses 2*L, or L about an axis listed in 'zijdelingse_knik_in_analyse' (second-order analysis with sway imperfection, 5.2.2(7)b).",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "bijlage": schema_bijlage(),
                    "beam_id": { "type": "integer", "minimum": 0,
                        "description": "Staafnummer; komt onveranderd terug in het resultaat." },
                    "profile_name": { "type": "string",
                        "description": "Profielnaam uit de catalogus, bijvoorbeeld 'HEA200' of 'IPE300'. Wordt genegeerd als 'custom_section' is ingevuld." },
                    "steel_grade": { "type": "string", "enum": ["S235", "S275", "S355", "S420", "S460"],
                        "description": "Staalsoort volgens NEN-EN 1993-1-1 tabel 3.1. Alleen deze vijf worden herkend, hoofdletterongevoelig ('s355' = 'S355', zoals bij de profielnaam). Elke andere waarde (bijv. 'S690' of 'S355J2') wordt GEWEIGERD: geen toetsen, status NotApplicable en 'governing_check_id' = \"ERROR: staalsoort … onbekend …\". Er wordt nooit op S235 teruggevallen." },
                    "length_m": { "type": "number",
                        "description": "Staaflengte in m." },
                    "forces_envelope": schema_krachtenomhullende(),
                    "lateral_bracing": {
                        "type": "object",
                        "additionalProperties": false,
                        "description": "Kipsteunen als fracties van de staaflengte (0..1). Beide arrays zijn verplicht; een leeg object wordt geweigerd omdat de Rust-kant hier geen standaardwaarden kent. Geen kipsteunen = twee lege arrays.",
                        "required": ["top_flange_positions", "bottom_flange_positions"],
                        "properties": {
                            "top_flange_positions":    { "type": "array", "items": { "type": "number" } },
                            "bottom_flange_positions": { "type": "array", "items": { "type": "number" } }
                        }
                    },
                    "buckling_length_y_m": { "type": "number", "default": 0,
                        "description": "Kniklengte om de sterke y-as in m: knik IN het vlak van het model. 0 (of weglaten) = niet opgegeven; de kern houdt dan de staaflengte aan en zet in de toets 6.3.1_buckling dat die lengte een terugval is. Een negatieve of niet-eindige waarde wordt genegeerd met een kanttekening." },
                    "buckling_length_z_m": { "type": "number", "default": 0,
                        "description": "Kniklengte om de zwakke z-as in m: knik UIT het vlak van het model, een richting die de raamwerkberekening nooit ziet. 0 (of weglaten) = niet opgegeven; de kern leidt L_cr,z dan af uit 'lateral_bracing', maar ALLEEN op plaatsen waar een kipsteun aan de boven- EN aan de onderflens zit (binnen 1 mm): de grootste afstand tussen zulke plaatsen, de staafeinden meegeteld. Een steun aan een flens verkort L_cr,z NIET (NEN-EN 1993-1-1 6.3.5.2(2) en 6.3.1.4(5)). Zonder zulke paren geldt de staaflengte. De gebruikte waarde en haar herkomst ('opgegeven', 'uit de kipsteunen', 'staaflengte (terugval)') staan in de toets." },
                    "deflection_limit_class": { "type": "string",
                        "enum": ["Floor", "FloorBrittlePartitions", "Roof", "Cantilever", "Custom"],
                        "description": "Doorbuigingsklasse. w_fin (w_max) wordt bij elke klasse behalve 'Custom' getoetst tegen l_rep/250 (NEN-EN 1990:2002/NB:2019 A1.4.3(4), vloeren en daken). De klasse bepaalt de NB-categorie uit NEN-EN 1990:2002/NB:2019 A1.4.3(3) voor w_add: 'Floor' = 3/1000 van l_rep (overige vloeren en daken die intensief door personen worden gebruikt), 'FloorBrittlePartitions' = l_rep/500 (vloeren die scheurgevoelige scheidingswanden dragen), 'Roof' = l_rep/250 (overige daken), 'Cantilever' = dezelfde categorie als 'Floor' maar met l_rep = tweemaal de uitkraaglengte. De noemer uit 'deflection_limit_numerator' telt alleen bij 'Custom'." },
                    "deflection_limit_numerator": { "type": "integer",
                        "description": "Noemer x in de eis L/x; alleen gebruikt bij klasse 'Custom', en dan voor w_fin en w_add samen. Bij 'Custom' moet x groter dan nul zijn: 0 of negatief is een invoerfout, de staaf wordt dan niet getoetst en krijgt status NotApplicable met de reden in governing_check_id. Bij de andere klassen wordt het getal niet gelezen." },
                    "deflection_actual_max_mm": { "type": "number",
                        "description": "Gerekende zakking in mm, met teken (negatief = omlaag): bij een ligger het veldmaximum ten opzichte van de koorde tussen de staafeinden, bij een uitkraging ten opzichte van het ingeklemde eind." },
                    "is_cantilever": { "type": "boolean",
                        "description": "Uitkraging: l_rep = 2 x de staaflengte voor w_fin EN w_add (NEN-EN 1990:2002/NB:2019 A1.4.3); hetzelfde als klasse 'Cantilever'. 'deflection_actual_max_mm' hoort dan de zakking ten opzichte van het ingeklemde eind te zijn, niet ten opzichte van de koorde tussen de verplaatste staafeinden." },
                    "consequence_class": { "type": "string", "enum": ["CC1", "CC2", "CC3"],
                        "description": "Gevolgklasse, ALLEEN TER VERMELDING: deze toetsing past K_FI niet toe en verandert geen enkele UC. Volgens NEN-EN 1990:2002/NB:2019 zit de gevolgklasse in de partiële belastingsfactoren (tabel NB.4 voor CC2, NB.5 voor CC1 en CC3); lever dus krachten in `forces_envelope` die met die factoren zijn bepaald. `solve_fem_model` en `check_fem_model` doen dat al met hun veld `gevolgklasse`." },
                    "pre_camber_mm": { "type": "number", "default": 0,
                        "description": "Zeeg in mm, POSITIEF = OMHOOG (een zeeg tegen een doorhangende ligger in is positief). De kern rekent w_fin = w_z + w_zeeg met w_z negatief omlaag (NEN-EN 1990 A1.4.3(2), figuur A1.1). De zeeg telt niet mee in w_add." },
                    "deflection_permanent_mm": { "type": "number", "default": 0,
                        "description": "Doorbuiging onder de permanente BGT-combinatie (mm), voor w_add. 0 betekent w_add = w_fin (veilig-zijdig)." },
                    "deflection_add_limit_numerator": { "type": "number", "default": 0, "minimum": 0,
                        "description": "Noemer n in de grenswaarde L/n voor de bijkomende zakking w_add. 0 (of weglaten) = de NB-waarde die bij 'deflection_limit_class' hoort volgens NEN-EN 1990:2002/NB:2019 A1.4.3(3). Een negatieve of niet-eindige waarde is een invoerfout: de staaf wordt dan niet getoetst en krijgt status NotApplicable met de reden in governing_check_id. Een waarde > 0 overschrijft die klassewaarde en wordt op de STAAFLENGTE toegepast, dus zonder de verdubbeling l_rep = 2*L bij een uitkraging. Gebruik dit alleen om een externe referentie-uitwerking met een vaste noemer na te rekenen; het rapport vermeldt dan dat de noemer is opgegeven en niet uit de norm volgt." },
                    "q_equiv_n_per_mm": { "type": "number", "default": 0,
                        "description": "Equivalente gelijkmatig verdeelde belasting in het kipveld (N/mm), voor B* volgens NB.4.3(3). 0 = alleen eindmomenten en dat is GUNSTIGER; laat dit veld niet per ongeluk weg." },
                    "z_a_mm": { "type": "number", "default": 0,
                        "description": "Afstand zwaartepunt tot aangrijpingspunt van de belasting (mm). Positief = boven het zwaartepunt, destabiliserend (last op de bovenflens: z_a = h/2). 0 is GUNSTIGER dan een last op de bovenflens." },
                    "deflection_notes": { "type": "array", "items": { "type": "string" }, "default": [],
                        "description": "Vrije toelichtingen bij de doorbuigingstoets; ze komen letterlijk in de 'notes' van de w_fin-regel van het resultaat. Bedoeld om zichtbaar te maken vanaf welke referentielijn en over welke lengte 'deflection_actual_max_mm' is gemeten, en welke aannames daarbij zijn gedaan." },
                    "custom_section": schema_custom_section(),
                    "staafstand": { "type": "string", "enum": ["Liggend", "Staand"], "default": "Liggend",
                        "description": "Hoe de staaf in het model staat; rekent nergens mee. De krachtenomhullende hoort in de referentierichting te staan: 'Liggend' (minder dan 75 graden met de horizontaal) van links naar rechts, 'Staand' van voet naar kop. Bij 'Staand' zet de kiptoets erbij dat de BOVENflens de linkerflens en de ONDERflens de rechterflens is. Weglaten = 'Liggend'." },
                    "staafstand_notities": { "type": "array", "items": { "type": "string" }, "default": [],
                        "description": "Kanttekeningen bij de staafstand; rekenen nergens mee en komen letterlijk in de 'notes' van de kiptoets. De bouwer van `check_fem_model` en van de app zet hier een waarschuwing bij een naar links hellende staaf dicht bij de grens van 75 graden: daar keert om aan welke fysieke zijde de BOVENflens ligt (tot 75 graden het bovenvlak, daarboven de linkerzijde = het ondervlak). Weglaten = geen kanttekening." },
                    "staafeinden": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["begin", "eind"],
                        "description": "Wat er aan de twee staafeinden zit, in de referentierichting (begin = x = 0). 'Gaffel' = oplegging of aansluiting: zijdelings gesteund en torsievast, de aanname van vóór dit veld. 'Vrij' = geen oplegging en geen aansluitende staaf (uitkraging, vrijstaande kolom): de kniklengte-terugval wordt 2*L (of L om een as uit 'zijdelingse_knik_in_analyse') en de kiptoets rekent met de vervangende ligger van tabel NB.NB.1 geval 5 (L_g = L_st = L_kip = 2*L, C1 = 1,0, C2 = 0). 'Doorlopend' = de staaf loopt zonder oplegging door in een staaf met een andere doorsnede, een ander materiaal of een verlopend profiel: kip (en 6.3.3) wordt geweigerd met reden, en de kniktoets alleen uitgevoerd als beide kniklengtes zijn opgegeven; ontbreekt zo de kniktoets bij druk of de kiptoets bij buiging, dan is de status NotApplicable (niet volledig getoetst), tenzij een andere toets boven 1 uitkomt (NotOk). Weglaten = beide 'Gaffel'. `check_fem_model` en de app vullen dit uit het model.",
                        "properties": {
                            "begin": { "type": "string", "enum": ["Gaffel", "Vrij", "Doorlopend"] },
                            "eind":  { "type": "string", "enum": ["Gaffel", "Vrij", "Doorlopend"] }
                        }
                    },
                    "staaf_notities": { "type": "array", "items": { "type": "string" }, "default": [],
                        "description": "Toelichtingen bij de staaf als geheel; rekenen nergens mee en komen letterlijk in de 'notes' van de kniktoets (6.3.1), de kiptoets (6.3.2) en de eindzakking. `check_fem_model` en de app zetten hier dat een door tussenknopen geknipte staaf als één doorgaande lijn is getoetst, over welke lengte, en welke tussenknopen niet als steun tellen. Weglaten = niets te melden." },
                    "profile_end": { "type": "string",
                        "description": "Profiel aan het EIND van de staaf (x = L) van een VERLOPENDE staaf; 'profile_name' is dan het profiel aan het begin (x = 0). De maten h, b, t_w en t_f verlopen lineair en de doorsnede telt over de hele staaf als GELAST I-profiel zonder afrondingsstraal (knikkromme tabel 6.2 en kipkromme tabel 6.5 voor gelaste profielen). De kern toetst elke doorsnedetoets (6.2.x) op elk rekenpunt met de plaatselijke doorsnede en rekent de stabiliteitstoetsen (6.3.x) met de kleinste doorsnede in het veld; het resultaat krijgt dan een veld 'verloop' met de zes toetsdoorsneden en het maatgevende punt. Beide profielen moeten I/H-profielen uit de catalogus zijn; een koker, buis, hoeklijn, U-profiel, een I-profiel met toelopende flenzen of een eigen doorsnede wordt geweigerd met reden. Weglaten, leeg of gelijk aan 'profile_name' = prismatisch." },
                    "a_net_mm2": { "type": "number", "minimum": 0,
                        "description": "Nettodoorsnede A_net (mm²) voor de trektoets 6.2.3: de doorsnede ter plaatse van gaten of een andere verzwakking. Met A_net is N_t,Rd = min(A·f_y/γ_M0; 0,9·A_net·f_u/γ_M2), vergelijking (6.6) en (6.7); zonder rekent de kern N_t,Rd = A·f_y/γ_M0 en zegt de toets dat er geen A_net is opgegeven. Weglaten of 0 = niet opgegeven; een A_net groter dan A is een invoerfout en de staaf wordt dan met reden geweigerd." },
                    "tension_only": { "type": "boolean", "default": false,
                        "description": "Trek-alleen staaf (windverband van strip of rond staal, trekstang): de staaf doet in de berekening alleen mee zolang zij op trek staat. Dan toetst de kern alleen trek (6.2.3, en bij massief rond het draadeind); druk, buiging, dwarskracht en hun combinaties, knik, kip, 6.3.3 en de doorbuiging vallen weg. Een drukkracht in de omhullende geldt als speling of voorspanning en wordt niet getoetst; de grootste staat als informatieve regel ('trek_alleen') in het resultaat. Weglaten of false = een gewone staaf." },
                    "draadeind": { "type": "string", "enum": ["Gesneden", "Opgestuikt", "Gelast", "Geen"],
                        "description": "Eindafwerking van een staaf van massief rond staal (RD …); bij elk ander profiel zonder betekenis. 'Gesneden' = draad in de staaf gesneden: het draadeind (NEN-EN 1993-1-8 tabel 3.4, A_s van M<d>) telt mee als trektoets. 'Opgestuikt', 'Gelast' of 'Geen' = geen draadeindtoets; de brutodoorsnede (6.6) is de trektoets en de aansluiting zelf valt buiten deze toets. Weglaten = niet opgegeven: het draadeind wordt als AANNAME van een gesneden draad gerekend en als informatie getoond; het telt niet mee in 'uc_max', en voldoet het niet, dan is de status NotApplicable ('NIET VOLLEDIG GETOETST') in plaats van Ok of NotOk." },
                    "deflection_add_mm": { "type": "number",
                        "description": "De bijkomende zakking w_add = w2 + w3 in mm (met teken, negatief = omlaag), als de aanroeper haar per BGT-combinatie heeft bepaald: het grootste verschil |w_c − w1| met w1 = 'deflection_permanent_mm' (NEN-EN 1990:2002/NB:2019 A1.4.3(2), figuur NB.1). Weglaten = w_add = 'deflection_actual_max_mm' − 'deflection_permanent_mm'; dat klopt alleen als de combinatie met de grootste |w| ook het grootste verschil met w1 geeft (niet bij een overstek dat onder de blijvende last omhoog en onder de veranderlijke omlaag gaat). `check_fem_model` en de app vullen het veld alleen als het verschilt." },
                    "deflection_length_m": { "type": "number", "exclusiveMinimum": 0,
                        "description": "Lengte in m van het DEEL van de staaf waarvan de doorbuiging gemeten is, als dat niet de hele staaf is: de grenzen van w_fin en w_add rekenen dan met deze lengte (en met ℓ_rep = 2 × deze lengte als 'is_cantilever' of klasse 'Cantilever'). Bedoeld voor een doorgaande lijn die over een kolomkop doorloopt in een overstek: het veld en het overstek hebben elk hun eigen ℓ_rep (NEN-EN 1990:2002/NB:2019 A1.4.3). Weglaten = 'length_m'. Groter dan 'length_m' is een invoerfout; de staaf wordt dan met reden geweigerd." },
                    "zijdelingse_knik_in_analyse": {
                        "type": "object",
                        "additionalProperties": false,
                        "required": ["y", "z"],
                        "description": "Om welke doorsnedeassen de globale berekening tweede orde (P-Δ) MET scheefstand (NEN-EN 1993-1-1 5.3.2) is en de staaf kan laten uitbuigen. Alleen van belang bij een 'Vrij' staafeind in 'staafeinden' zonder opgegeven kniklengte: om een gedekte as geldt dan de staaflengte (5.2.2(7)b: de zijdelingse knik zit al in de krachten), om een niet-gedekte as 2*L. In een vlak model is hooguit 'y' waar. Zet het alleen voor een staaf waarvan de scheefstand de zijdelingse knikvorm aanstoot: een overwegend verticale staaf (kolom); de scheefstand is een horizontale kracht bij de verticale last, en een liggende uitkraging met druk krijgt er geen imperfectie in haar knikvorm door. Bij een hoekprofiel telt alleen y EN z samen. Zet het bovendien alleen als de scheefstand φ in de berekening minstens de eigen φ van die kolom is: EN 1993-1-1 (5.5) met h = haar lengte en m = 1 (een kolom met een vrije kop hangt nergens aan; de φ van een heel model middelt over al zijn kolommen). Bij L houdt de kern C_m = 0,9 als ondergrens (tabel B.3, knikvorm met verplaatsbare knopen). Weglaten = geen as gedekt (2*L). `check_fem_model` en de app vullen dit uit het analysetype, de scheefstand en φ.",
                        "properties": {
                            "y": { "type": "boolean" },
                            "z": { "type": "boolean" }
                        }
                    }
                },
                "required": [
                    "beam_id", "profile_name", "steel_grade", "length_m",
                    "forces_envelope", "lateral_bracing",
                    "deflection_limit_class", "deflection_limit_numerator",
                    "deflection_actual_max_mm", "is_cantilever", "consequence_class"
                ]
            }
        },
        {
            "name": "compute_section_properties",
            "description": "Herberekent de doorsnedegrootheden (A, Iy, Iz, Wel, Wpl, Av, It, Iw, traagheidsstralen, zwaartepunt, schuifmiddelpunt, plastische neutrale lijn) van een catalogusprofiel uit zijn genormeerde maten met de exacte doorsnedemotor van section-properties: contourintegralen voor de meetkundige grootheden, een numerieke torsieoplossing (met insluiting van It) voor It en Iw. Dezelfde motor die de catalogus vult; flenshelling van UNP en INP, walsuitrondingen en de EN 10210-hoekstralen van kokers zitten erin. Het antwoord is plat (area_mm2, iy_mm4, ...) plus diagnostiek (a_mesh_afwijking, it_onzekerheid, meldingen, tijd_ms). 'catalogus_vergelijking' zet de cataloguswaarden van I_t en I_w ernaast, met hun bron en het verschil: bij IPE/HEA/HEB/HEM is de catalogus-I_t de EN 10365-tabelwaarde en de catalogus-I_w de motorwaarde; de it-onzekerheidsband is de numerieke insluiting voor de geïdealiseerde contour, geen band rond de tabel. De toetsing rekent met de cataloguswaarden (list_steel_profiles).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "profile_name": { "type": "string", "description": "e.g. 'HEA200'" }
                },
                "required": ["profile_name"],
                "additionalProperties": false
            }
        },
        {
            "name": "generate_steel_report_pdf",
            "description": "Generate a complete constructive-check PDF report. Material-neutral despite the name: EN 1993-1-1 steel, EN 1995-1-1 timber and cross-laminated timber, EN 1992-1-1 concrete, plus the norm-independent stress check (von Mises against an allowable stress). The cover and the page header name only the standards actually present. Optionally include concrete_stiffness_trace to add the chapter on physically non-linear second-order analysis: the per-combination assumptions, the segment stiffness tables and the four concrete figures. Returns the PDF as base64 plus byte_count, or — with `output_path` — writes it to disk and returns only the path and byte_count. Heavy operation — runs on a blocking task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "bijlage": schema_bijlage(),
                    "project_name":        { "type": "string" },
                    "project_number":      { "type": "string" },
                    "engineer":            { "type": "string" },
                    "company":             { "type": "string" },
                    "date":                { "type": "string" },
                    "taal": { "type": "string", "enum": ["nl", "en", "de", "fr"], "default": "nl", "description": "Language in which the report writes the project date, on the cover and in the header of every page: 'nl' 16 september 2026, 'en' September 16, 2026, 'de' 16. September 2026, 'fr' 16 septembre 2026. A date that is not a calendar date YYYY-MM-DD is printed verbatim. Omit = 'nl'; any other value is REJECTED." },
                    "steel_check_results": { "type": "array" },
                    "timber_check_results":   { "type": "array" },
                    "clt_check_results":      { "type": "array" },
                    "concrete_check_results": { "type": "array" },
                    "stress_check_results":   { "type": "array" },
                    "plate_inputs": { "type": "array", "items": plate_tools::schema_plaat(),
                        "description": "Original plate inputs from the same check run, including all relevant ULS and SLS combinations and element stresses. Optional; the PDF lists every supplied combination and the stresses at its governing element. Does not rerun checks." },
                    "plate_results": { "type": "array", "items": { "type": "object" },
                        "description": "Complete PlateCheckResult objects returned by check_plates or check_fem_model: all combination results, governing element/combination, unperformed checks and refusal reasons. Results are printed without recalculation. Empty or absent with no plate inputs/skips omits the plate chapter." },
                    "plate_skipped": { "type": "array", "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["plate_id", "reden"],
                        "properties": { "plate_id": { "type": "integer", "minimum": 0 }, "reden": { "type": "string" } }
                    }, "description": "Plates not sent to the check kernel, with their literal reason. Printed as not checked." },
                    "concrete_stiffness_trace": { "type": "object" },
                    "output_path": { "type": "string", "minLength": 1, "description": "Absolute path ending in .pdf. When given, the PDF is written there (replacing an existing file) and the answer is only { output_path, byte_count } — no base64. Recommended: base64 of a three-page report is ~2.9 million characters." },
                    "wind_toelichting": { "type": "string", "description": "Optional text block (one line per load case) describing generated wind loads: NEN-EN 1991-1-4 paragraph and table, roof pitch alpha, blockage phi and the coefficient used. Printed verbatim under 'Uitgangspunten' → 'Windbelasting'; empty or absent = the PDF says nothing about wind." }
                },
                "required": [
                    "project_name", "project_number", "engineer",
                    "company", "date", "steel_check_results"
                ],
                "additionalProperties": true
            }
        }
    ]);
    let lijst = tools
        .as_array_mut()
        .expect("de tooldefinities zijn een array");
    lijst.extend(fem_tools::tool_definitions());
    lijst.extend(frame3d_tools::tool_definitions());
    lijst.extend(native_fem_tools::tool_definitions());
    lijst.extend(open_fem_3d_tools::tool_definitions());
    lijst.extend(staalhal_tools::tool_definitions());
    lijst.extend(ifc_import_tools::tool_definitions());
    lijst.extend(extensie_tools::tool_definitions());
    lijst.extend(concrete_tools::tool_definitions());
    lijst.extend(timber_tools::tool_definitions());
    lijst.extend(plate_tools::tool_definitions());
    lijst.extend(gui_tools::tool_definitions());
    lijst.extend(api_tools::tool_definitions());
    tools
}

// ── Tool dispatch ────────────────────────────────────────────────────────────

async fn dispatch_tool(name: &str, args: Value) -> Result<Value, RpcError> {
    match name {
        "list_steel_profiles" => {
            let profiles = tokio::task::spawn_blocking(|| steel_profiles::db().all().to_vec())
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?;
            // Issue #241: de catalogus mengt tabel- en motorwaarden; per
            // groep staat hier welke grootheid waarvandaan komt.
            Ok(json!({ "profiles": profiles, "bronnen": steel_profiles::herkomst_groepen() }))
        }
        "list_steel_grades" => {
            use nen_en_1993_1_1_section::{S235, S275, S355, S420, S460};
            let grades = vec![S235, S275, S355, S420, S460];
            Ok(json!({ "grades": grades }))
        }
        "check_steel_beam" => {
            let input: steel_check::BeamCheckInput = serde_json::from_value(args)
                .map_err(|e| RpcError::invalid_params(format!("BeamCheckInput: {e}")))?;
            let result = tokio::task::spawn_blocking(move || steel_check::check_beam(input))
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?;
            serde_json::to_value(result)
                .map_err(|e| RpcError::tool_exec(format!("serialize result: {e}")))
        }
        "compute_section_properties" => {
            let profile_name = args
                .get("profile_name")
                .and_then(Value::as_str)
                .ok_or_else(|| RpcError::invalid_params("missing string field 'profile_name'"))?
                .to_owned();
            let naam = profile_name.clone();
            let result = tokio::task::spawn_blocking(move || compute_section_props(&profile_name))
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))??;
            let mut v = serde_json::to_value(result)
                .map_err(|e| RpcError::tool_exec(format!("serialize result: {e}")))?;
            voeg_catalogusvergelijking_toe(&naam, &mut v);
            Ok(v)
        }
        "generate_steel_report_pdf" => {
            // `output_path` (#227, #229): de PDF naar schijf in plaats van als
            // base64 in het antwoord — dat waren ~2,9 miljoen tekens voor drie
            // pagina's. Geen veld van `ReportInput`, dus hier eraf gehaald.
            let mut args = args;
            let uitvoer = match args.as_object_mut().and_then(|m| m.remove("output_path")) {
                None => None,
                Some(Value::String(p)) => Some(keur_pdf_pad(&p)?),
                Some(_) => return Err(RpcError::invalid_params("output_path moet een pad (tekst) zijn.")),
            };
            let input: report::ReportInput = serde_json::from_value(args)
                .map_err(|e| RpcError::invalid_params(format!("ReportInput: {e}")))?;
            let bytes = tokio::task::spawn_blocking(move || report::generate_report_pdf(input))
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?;
            let byte_count = bytes.len();
            if let Some(pad) = uitvoer {
                let tijdelijk = format!("{pad}.tmp-{}", std::process::id());
                std::fs::write(&tijdelijk, &bytes)
                    .and_then(|_| std::fs::rename(&tijdelijk, &pad))
                    .map_err(|e| {
                        let _ = std::fs::remove_file(&tijdelijk);
                        RpcError::tool_exec(format!("De PDF kon niet naar `{pad}` worden geschreven ({e})."))
                    })?;
                return Ok(json!({ "output_path": pad, "byte_count": byte_count }));
            }
            let pdf_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(json!({ "pdf_base64": pdf_b64, "byte_count": byte_count }))
        }
        // De FEM-tools. Ze rekenen niet hier: `fem_tools` zet het verzoek klaar
        // voor de Node-sidecar, die dezelfde solverfuncties uitvoert als de app.
        // `check_fem_model` roept daarna `steel_check::check_all_beams` aan —
        // dezelfde functie die `src-tauri/src/lib.rs` voor de app aanroept.
        fem if fem_tools::is_fem_tool(fem) => fem_tools::dispatch(fem, args).await,
        frame3d if frame3d_tools::is_frame3d_tool(frame3d) => {
            frame3d_tools::dispatch(frame3d, args).await
        }
        native if native_fem_tools::is_native_fem_tool(native) => {
            native_fem_tools::dispatch(native, args).await
        }
        open_fem_3d if open_fem_3d_tools::is_open_fem_3d_tool(open_fem_3d) => {
            open_fem_3d_tools::dispatch(open_fem_3d, args).await
        }
        hal if staalhal_tools::is_staalhal_tool(hal) => staalhal_tools::dispatch(hal, args).await,
        ifc if ifc_import_tools::is_ifc_import_tool(ifc) => ifc_import_tools::dispatch(ifc, args).await,
        extensie if extensie_tools::is_extensie_tool(extensie) => extensie_tools::dispatch(extensie, args).await,
        // De betontools. Ze roepen `concrete_check` aan — dezelfde functies die
        // `src-tauri/src/lib.rs` en `crates/toetsbrug` aanroepen. Zie
        // `concrete_tools.rs` en `tests/drie_wegen_beton.rs`.
        beton if concrete_tools::is_concrete_tool(beton) => {
            concrete_tools::dispatch(beton, args).await
        }
        // De houttools. Ze roepen `timber_check::check_all_timber_beams` en
        // `timber_check::clt::check_all_clt_beams` aan — dezelfde
        // batch-instappen die `src-tauri/src/lib.rs` en `crates/toetsbrug`
        // aanroepen, zodat geen van de drie schillen een eigen lus over de
        // staven houdt. Zie `timber_tools.rs` en
        // `tests/drie_wegen_kruistabel.rs`.
        hout if timber_tools::is_timber_tool(hout) => timber_tools::dispatch(hout, args).await,
        // De plaattoets: `plaat_check::check_all_plates`, dezelfde functie als
        // het Tauri-command en de toetsbrug. Zie `plate_tools.rs`.
        plaat if plate_tools::is_plate_tool(plaat) => plate_tools::dispatch(plaat, args).await,
        // De GUI-tools: geen rekenwerk, maar opdrachten aan de draaiende app
        // over haar bedieningskanaal. Zie `gui_tools.rs`.
        gui if gui_tools::is_gui_tool(gui) => gui_tools::dispatch(gui, args).await,
        api if api_tools::is_api_tool(api) => api_tools::dispatch(api, args).await,
        other => Err(RpcError::method_not_found(other)),
    }
}

/// Het uitvoerpad van de rapport-PDF: absoluut, eindigend op .pdf, in een
/// bestaande map. Een bestaand bestand wordt vervangen (zoals Opslaan als).
fn keur_pdf_pad(pad: &str) -> Result<String, RpcError> {
    let p = std::path::Path::new(pad);
    if !pad.to_lowercase().ends_with(".pdf") {
        return Err(RpcError::invalid_params(format!("output_path moet op .pdf eindigen, niet `{pad}`.")));
    }
    if !p.is_absolute() {
        return Err(RpcError::invalid_params(format!("output_path moet een absoluut pad zijn, niet `{pad}`.")));
    }
    if !p.parent().is_some_and(|m| m.is_dir()) {
        return Err(RpcError::invalid_params(format!("De map van output_path bestaat niet: `{pad}`.")));
    }
    Ok(pad.to_owned())
}

fn compute_section_props(
    profile_name: &str,
) -> Result<section_properties::opdracht::Uitvoer, RpcError> {
    use steel_profiles::ProfileKind;
    // Tot september 2026 rekende dit gereedschap met oude handboekformules
    // (basisaudit nr 34): zonder flenshelling (UNP: I_z +15 %, W_pl,z −32 %),
    // met een grove It en Iw. Nu gaat het door `section_properties::opdracht`,
    // dezelfde ingang als het generatiescript dat de catalogus vult, zodat
    // het antwoord de catalogus reproduceert in plaats van tegenspreekt.
    let profile = steel_profiles::db()
        .find(profile_name)
        .ok_or_else(|| RpcError::invalid_params(format!("unknown profile: {profile_name}")))?;
    let g = &profile.geometry;
    let schuin = g.flange_slope > 0.0;
    let soort = match profile.kind {
        ProfileKind::ISection if schuin => "ISectionSchuin",
        ProfileKind::ISection => "ISection",
        ProfileKind::Channel if schuin => "ChannelSchuin",
        ProfileKind::Channel => "Channel",
        ProfileKind::Rhs => "Rhs",
        ProfileKind::Shs => "Shs",
        ProfileKind::Chs => "Chs",
        ProfileKind::Angle => "Angle",
        // Massief rond staal: de motor rekent dezelfde cirkel als de
        // catalogus (exacte kwartbogen; I_t numeriek).
        ProfileKind::RoundBar => "RoundBar",
        // Platstaal: een massieve rechthoek met h = de breedte b van de strip
        // (langs z) en b = de dikte t. De motor geeft daarbij ook de kleine
        // welvingsconstante van een rechthoek; de catalogus zet I_w op 0.
        ProfileKind::FlatBar => "Rechthoek",
    };
    let invoer: section_properties::opdracht::Invoer = serde_json::from_value(json!({
        "naam": profile.name,
        "soort": soort,
        "h": g.h, "b": g.b, "tw": g.tw, "tf": g.tf, "t": g.t, "r": g.r, "r2": g.r2,
    }))
    .map_err(|e| RpcError::tool_exec(format!("doorsnedemotor-invoer: {e}")))?;
    section_properties::opdracht::reken(&invoer)
        .map_err(|e| RpcError::tool_exec(format!("doorsnedemotor: {e}")))
}

/// Issue #241: zet naast de motoruitkomst van `compute_section_properties` de
/// cataloguswaarden van I_t en I_w, met hun bron en het verschil, en de
/// toelichting op de herkomst. Zo staat de menging van tabel- en motorwaarden
/// in de catalogus niet ongemeld naast elkaar.
fn voeg_catalogusvergelijking_toe(profile_name: &str, v: &mut Value) {
    let Some(p) = steel_profiles::db().find(profile_name) else { return };
    let h = steel_profiles::herkomst(p);
    let bron = |veld: &str| {
        if h.tabel.contains(&veld) {
            "profieltabel (EN 10365)"
        } else {
            "berekend (doorsnedemotor of gesloten formule)"
        }
    };
    let vergelijk = |veld: &str, catalogus: f64| {
        let motor = v[veld].as_f64().unwrap_or(f64::NAN);
        let verschil = if catalogus != 0.0 { (motor - catalogus) / catalogus * 100.0 } else { f64::NAN };
        json!({
            "catalogus": catalogus,
            "bron_catalogus": bron(veld),
            "motor": motor,
            "verschil_motor_pct": if verschil.is_finite() { json!(verschil) } else { Value::Null },
        })
    };
    let it = vergelijk("it_mm4", p.properties.it_mm4);
    let iw = vergelijk("iw_mm6", p.properties.iw_mm6);
    if let Value::Object(m) = v {
        m.insert(
            "catalogus_vergelijking".to_owned(),
            json!({ "it_mm4": it, "iw_mm6": iw, "toelichting": h.toelichting }),
        );
    }
}

// ── JSON-RPC method dispatch ────────────────────────────────────────────────

/// Returns `None` for notifications (no response should be written).
async fn handle_request(req: Request) -> Option<Response> {
    if req.jsonrpc != "2.0" {
        if let Some(id) = req.id {
            return Some(err(
                id,
                RpcError {
                    code: -32600,
                    message: format!(
                        "Invalid Request: jsonrpc must be '2.0', got '{}'",
                        req.jsonrpc
                    ),
                    data: None,
                },
            ));
        }
        return None;
    }

    let id = req.id.clone();
    let is_notification = id.is_none();

    let response_payload: Result<Value, RpcError> = match req.method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": SERVER_NAME, "version": SERVER_VERSION }
        })),
        "notifications/initialized" | "initialized" => {
            tracing::info!("client initialized");
            return None;
        }
        "tools/list" => Ok(json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let params = req.params.unwrap_or_else(|| json!({}));
            let name = match params.get("name").and_then(Value::as_str) {
                Some(n) => n.to_owned(),
                None => {
                    let resp = err(
                        id.unwrap_or(Value::Null),
                        RpcError::invalid_params("tools/call requires 'name' string param"),
                    );
                    return Some(resp);
                }
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match dispatch_tool(&name, arguments).await {
                Ok(value) => {
                    // Per MCP spec: tool result is wrapped as { content: [{type: "text", text: <json>}], isError: false }
                    let text = serde_json::to_string(&value)
                        .unwrap_or_else(|e| format!("{{\"error\":\"serialize: {e}\"}}"));
                    Ok(json!({
                        "content": [{ "type": "text", "text": text }],
                        "isError": false,
                        "structuredContent": value
                    }))
                }
                Err(e) => {
                    // Tool execution errors are reported in result, not as JSON-RPC errors,
                    // per MCP spec for tools/call (so the model can see them).
                    //
                    // De tekstregel is voor een mens; `structuredContent` houdt
                    // de foutcode, de Nederlandse remedie en het detail heel.
                    // Zonder dat is een storing in de rekenketen voor een client
                    // niet te onderscheiden van een constructieve bevinding —
                    // zie `RpcError::gestructureerde_fout`.
                    Ok(json!({
                        "content": [{ "type": "text", "text": format!("Error: {}", e.message) }],
                        "isError": true,
                        "structuredContent": e.gestructureerde_fout()
                    }))
                }
            }
        }
        "ping" => Ok(json!({})),
        other => Err(RpcError::method_not_found(other)),
    };

    if is_notification {
        return None;
    }
    let id = id.unwrap_or(Value::Null);
    Some(match response_payload {
        Ok(v) => ok(id, v),
        Err(e) => err(id, e),
    })
}

// ── Stdio loop ───────────────────────────────────────────────────────────────

async fn run_stdio() -> std::io::Result<()> {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();
    let stdout = Arc::new(Mutex::new(stdout));

    let mut reader = BufReader::new(stdin).lines();
    // Elk verzoek draait als eigen taak. Sluit de client stdin direct na zijn
    // verzoeken (een pijp, een script), dan maakt de server die taken eerst af:
    // anders eindigt main en vallen de antwoorden weg.
    let mut lopend = tokio::task::JoinSet::new();
    while let Some(line) = reader.next_line().await? {
        let line = line.trim().to_string();
        if line.is_empty() { continue; }
        // Afgeronde taken opruimen, zodat de set in een lange sessie niet groeit.
        while lopend.try_join_next().is_some() {}

        let stdout = stdout.clone();
        lopend.spawn(async move {
            let resp = match serde_json::from_str::<Request>(&line) {
                Ok(req) => handle_request(req).await,
                Err(e) => {
                    tracing::warn!(error = %e, raw = %line, "failed to parse request");
                    Some(err(
                        Value::Null,
                        RpcError {
                            code: -32700,
                            message: format!("Parse error: {e}"),
                            data: None,
                        },
                    ))
                }
            };
            if let Some(resp) = resp {
                match serde_json::to_string(&resp) {
                    Ok(mut s) => {
                        s.push('\n');
                        let mut out = stdout.lock().await;
                        if let Err(e) = out.write_all(s.as_bytes()).await {
                            tracing::error!(error = %e, "stdout write failed");
                        }
                        if let Err(e) = out.flush().await {
                            tracing::error!(error = %e, "stdout flush failed");
                        }
                    }
                    Err(e) => tracing::error!(error = %e, "failed to serialize response"),
                }
            }
        });
    }
    while lopend.join_next().await.is_some() {}
    Ok(())
}

#[tokio::main(flavor = "multi_thread")]
async fn main() -> std::io::Result<()> {
    // Tracing → stderr only. stdout is exclusively for protocol traffic.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("OPENAEC_MCP_LOG")
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tracing::info!(
        version = SERVER_VERSION,
        "openaec-mcp-server starting on stdio"
    );
    run_stdio().await?;
    tracing::info!("openaec-mcp-server shutting down (stdin closed)");
    Ok(())
}
