//! masonry_tools.rs — metselwerk (NEN-EN 1996-1-1, issue #98) als MCP-tool.
//!
//! De derde weg naar `metselwerk_check`, naast het Tauri-command en de
//! toetsbrug-opdracht van dezelfde naam. Er wordt hier niet gerekend: de tool
//! leest het invoertype, roept `metselwerk_check::check_all_metselwerk_walls`
//! aan en geeft het resultaat door.
//!
//! Het schema is strikt (`additionalProperties: false` op elk niveau): alle
//! invoertypen staan op `deny_unknown_fields`, en de spiegeltest onderaan
//! leest de veldnamen uit de typen zelf.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::RpcError;

pub const MASONRY_TOOLS: [&str; 1] = ["check_masonry_walls"];

pub fn is_masonry_tool(naam: &str) -> bool {
    MASONRY_TOOLS.contains(&naam)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Wandinvoer {
    inputs: Vec<metselwerk_check::MetselwerkWandInput>,
}

pub async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        "check_masonry_walls" => {
            let args: Wandinvoer = serde_json::from_value(args)
                .map_err(|e| RpcError::invalid_params(format!("MetselwerkWandInput: {e}")))?;
            let uit = tokio::task::spawn_blocking(move || metselwerk_check::check_all_metselwerk_walls(args.inputs))
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?;
            serde_json::to_value(uit)
                .map(|v| json!({ "results": v }))
                .map_err(|e| RpcError::tool_exec(format!("serialize result: {e}")))
        }
        _ => Err(RpcError::method_not_found(naam)),
    }
}

fn pos(beschrijving: &str) -> Value {
    json!({ "type": "number", "exclusiveMinimum": 0, "description": beschrijving })
}

fn getal(beschrijving: &str) -> Value {
    json!({ "type": "number", "description": beschrijving })
}

fn object(props: Value, verplicht: &[&str], beschrijving: &str) -> Value {
    json!({
        "type": "object", "additionalProperties": false, "description": beschrijving,
        "properties": props, "required": verplicht
    })
}

/// Een NDP-waarde met haar bron.
fn schema_normwaarde(beschrijving: &str) -> Value {
    object(
        json!({
            "waarde": pos("De waarde."),
            "bron": { "type": "string", "minLength": 1,
                "description": "Bron van de waarde, bijv. 'NEN-EN 1996-1-1 NB tabel 3.3' of een productverklaring. Leeg = geweigerd." }
        }),
        &["waarde", "bron"],
        beschrijving,
    )
}

pub(crate) fn schema_materiaal() -> Value {
    object(
        json!({
            "steensoort": { "type": "string",
                "enum": ["Baksteen", "Kalkzandsteen", "Betonsteen", "Cellenbeton", "Kunststeen", "Natuursteen"],
                "description": "Soort metselsteen (EN 771-1 t/m -6)." },
            "steengroep": { "type": "string", "enum": ["Groep1", "Groep2", "Groep3", "Groep4"],
                "description": "Steengroep volgens tabel 3.1. Bepaalt ook β bij een geconcentreerde last (§6.1.3: alleen groep 1)." },
            "mortel": { "type": "string", "enum": ["Algemeen", "Lijm", "Licht"],
                "description": "Algemeen = mortel voor algemene toepassing (α 0,7, β 0,3); Lijm = lijmmortel 0,5–3 mm (α 0,85 of 0,7, β 0); Licht = lichte mortel: niet ondersteund (niet getoetst)." },
            "f_b_mpa": pos("Genormaliseerde druksterkte van de steen f_b (EN 772-1), N/mm². Boven 75 (algemeen) of 50 (lijm) afgekapt."),
            "f_m_mpa": pos("Druksterkte van de mortel f_m, N/mm². Verplicht bij algemene mortel; afgekapt op min(20; 2 f_b)."),
            "k": schema_normwaarde("K van §3.6.1.2 (NDP: tabel 3.3 of NB), met bron. Er is geen standaardwaarde."),
            "langsvoeg": { "type": "boolean", "description": "VERPLICHT: is er een langsvoeg in de wand? Dan K × 0,8 (§3.6.1.2)." },
            "gamma_m": schema_normwaarde("Materiaalfactor γ_M (NDP, §2.4.3 / NB), met bron."),
            "k_e": schema_normwaarde("K_E in E = K_E f_k (NDP, §3.7.2), met bron. Zonder: Φ_m halverwege niet getoetst."),
            "phi_inf": schema_normwaarde("Eindkruipcoëfficiënt φ_∞ (NDP, tabel 3.8), met bron. Zonder: Φ_m halverwege niet getoetst."),
            "f_vk0_mpa": schema_normwaarde("Initiële schuifsterkte f_vk0 in N/mm² (NDP, tabel 3.4), met bron. Zonder: afschuiving niet getoetst."),
            "stootvoegen_gevuld": { "type": "boolean", "description": "VERPLICHT: gevulde stootvoegen? Ongevuld: 0,5 f_vk0 en grens 0,045 f_b (§3.6.2)." },
            "f_xk1_mpa": schema_normwaarde("Buigtreksterkte f_xk1 (breukvlak evenwijdig aan de lintvoegen) in N/mm² (NDP, §3.6.3), met bron."),
            "f_xk2_mpa": schema_normwaarde("Buigtreksterkte f_xk2 (breukvlak loodrecht op de lintvoegen) in N/mm² (NDP, §3.6.3), met bron.")
        }),
        &["steensoort", "steengroep", "mortel", "f_b_mpa", "k", "langsvoeg", "gamma_m", "stootvoegen_gevuld"],
        "Metselwerk: steen, mortel en de nationaal te kiezen parameters. Elke NDP-waarde met bron; geen standaarden.",
    )
}

fn schema_steunranden() -> Value {
    let rand = |soort: &str, uitleg: &str| {
        object(
            json!({ "soort": { "const": soort }, "l_m": pos("Afstand in m (zie beschrijving).") }),
            &["soort", "l_m"],
            uitleg,
        )
    };
    json!({
        "description": "Steunranden van de wand (§5.5.1.2).",
        "oneOf": [
            object(json!({ "soort": { "const": "BovenOnder" } }), &["soort"], "Alleen boven en onder gesteund (ρ_2)."),
            rand("EenVerticaleRand", "Boven, onder en één verticale rand (ρ_3); l_m = afstand vrije rand – hart verstijvende wand. l ≥ 15 t: telt niet mee."),
            rand("TweeVerticaleRanden", "Boven, onder en beide verticale randen (ρ_4); l_m = hart-op-hart verstijvende wanden. l ≥ 30 t: telt niet mee.")
        ]
    })
}

pub(crate) fn schema_wand() -> Value {
    object(
        json!({
            "wand_id": { "type": "integer", "minimum": 0 },
            "naam": { "type": "string", "description": "Naam voor de kopregel." },
            "materiaal": schema_materiaal(),
            "geometrie": object(
                json!({
                    "t_mm": pos("Wanddikte t, mm (enkelsteens: t_ef = t)."),
                    "h_m": pos("Vrije verdiepingshoogte h, m."),
                    "l_m": pos("Lengte van het getoetste wanddeel (wand of penant), m. A = t·l (§6.1.2.1), lengte voor afschuiving en voor de spreiding van geconcentreerde lasten."),
                    "steunranden": schema_steunranden(),
                    "betonvloeren": { "type": "boolean", "description": "Boven en onder gesteund door gewapend-betonvloeren (ρ_2 = 0,75 als e bovenin ≤ 0,25 t); anders ρ_2 = 1,0." }
                }),
                &["t_mm", "h_m", "l_m", "steunranden", "betonvloeren"],
                "Enkelsteens wand of penant.",
            ),
            "verticaal": object(
                json!({
                    "n_boven_kn_m": getal("N_Ed bovenin, kN/m, DRUK positief."),
                    "m_boven_knm_m": getal("M_Ed bovenin (uit het vlak, incl. horizontale belasting), kNm/m."),
                    "n_midden_kn_m": getal("N_Ed halverwege, kN/m, druk positief."),
                    "m_midden_knm_m": getal("M_Ed halverwege, kNm/m."),
                    "n_onder_kn_m": getal("N_Ed onderin, kN/m, druk positief."),
                    "m_onder_knm_m": getal("M_Ed onderin, kNm/m.")
                }),
                &["n_boven_kn_m", "m_boven_knm_m", "n_midden_kn_m", "m_midden_knm_m", "n_onder_kn_m", "m_onder_knm_m"],
                "Verticale belasting per meter (UGT, incl. eigen gewicht) voor §6.1.2. Weglaten = niet getoetst.",
            ),
            "geconcentreerd": {
                "type": "array",
                "description": "Geconcentreerde lasten, bijv. de oplegging van een latei (§6.1.3).",
                "items": object(
                    json!({
                        "naam": { "type": "string" },
                        "n_edc_kn": pos("N_Edc, kN."),
                        "l_b_mm": pos("Opleglengte langs de wand, mm."),
                        "b_mm": pos("Opleggingsbreedte dwars op de wand (≤ t), mm."),
                        "a1_mm": { "type": "number", "minimum": 0, "description": "a_1: afstand wandeinde – dichtstbijzijnde rand oplegging, mm." },
                        "h_c_m": pos("h_c: hoogte van de wand tot het niveau van de last, m."),
                        "e_mm": getal("Excentriciteit van de last t.o.v. het wandhart, mm (|e| ≤ t/4, anders niet getoetst).")
                    }),
                    &["naam", "n_edc_kn", "l_b_mm", "b_mm", "a1_mm", "h_c_m", "e_mm"],
                    "Eén geconcentreerde last.",
                )
            },
            "afschuiving": object(
                json!({
                    "v_ed_kn": getal("V_Ed in het vlak, kN."),
                    "n_ed_kn": getal("Gelijktijdige (ongunstigste, doorgaans kleinste) drukkracht op het wanddeel, kN, druk positief."),
                    "m_ed_knm": getal("Gelijktijdig moment in het vlak, kNm (bepaalt l_c).")
                }),
                &["v_ed_kn", "n_ed_kn", "m_ed_knm"],
                "Afschuiving van het wanddeel (§6.2). Weglaten = niet getoetst.",
            ),
            "buiging": object(
                json!({
                    "m_ed_knm_m": getal("M_Ed uit het vlak, kNm per meter."),
                    "breukvlak": { "type": "string", "enum": ["EvenwijdigAanLintvoegen", "LoodrechtOpLintvoegen"],
                        "description": "EvenwijdigAanLintvoegen = f_xk1 (strook overspant verticaal); LoodrechtOpLintvoegen = f_xk2 (horizontaal)." }
                }),
                &["m_ed_knm_m", "breukvlak"],
                "Buiging uit het vlak van een strook van 1 m (§6.3.1). Weglaten = niet getoetst.",
            )
        }),
        &["wand_id", "naam", "materiaal", "geometrie"],
        "Eén metselwerkwand.",
    )
}

pub fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": "check_masonry_walls",
        "description": "Run the NEN-EN 1996-1-1 masonry check on a list of single-leaf walls or piers: characteristic compressive strength f_k = K f_b^alpha f_m^beta (3.6.1.2), effective height with rho_2/rho_3/rho_4 and slenderness h_ef/t_ef <= 27 (5.5.1), vertical load per metre with the capacity reduction factor Phi at top and bottom (6.1.2.2) and Phi_m at mid-height (Annex G, incl. creep eccentricity), concentrated loads with beta (6.1.3), in-plane shear with l_c and f_vk (6.2, 3.6.2) and out-of-plane bending of a 1 m strip (6.3.1). Nationally determined parameters (K, gamma_M, K_E, phi_inf, f_vk0, f_xk1, f_xk2) have NO defaults: each must be given with its source; when one is missing, the check that needs it is listed in `niet_getoetst` and the status is NotApplicable, never Ok. NOT included: lightweight mortar, thin-layer mortar with manufactured or natural stone, shell bedding, cavity walls, arching (6.3.2), Annex E moment coefficients, reinforced masonry. Forces: compression POSITIVE. Same types as the Tauri command and the toetsbrug opdracht `check_masonry_walls`; all three run through `metselwerk_check::check_all_metselwerk_walls`.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "inputs": { "type": "array", "description": "De wanden. De volgorde van de lijst is de volgorde van de resultaten.", "items": schema_wand() }
            },
            "required": ["inputs"]
        }
    })]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voorbeeld() -> Value {
        let nw = |w: f64| json!({ "waarde": w, "bron": "test" });
        json!({
            "wand_id": 1, "naam": "x",
            "materiaal": {
                "steensoort": "Kalkzandsteen", "steengroep": "Groep1", "mortel": "Algemeen",
                "f_b_mpa": 20.0, "f_m_mpa": 10.0, "k": nw(0.5), "langsvoeg": false, "gamma_m": nw(1.7),
                "k_e": nw(1000.0), "phi_inf": nw(1.5), "f_vk0_mpa": nw(0.3), "stootvoegen_gevuld": true,
                "f_xk1_mpa": nw(0.1), "f_xk2_mpa": nw(0.4)
            },
            "geometrie": { "t_mm": 100.0, "h_m": 2.6, "l_m": 1.0,
                "steunranden": { "soort": "TweeVerticaleRanden", "l_m": 2.0 }, "betonvloeren": true },
            "verticaal": { "n_boven_kn_m": 1.0, "m_boven_knm_m": 0.0, "n_midden_kn_m": 1.0,
                "m_midden_knm_m": 0.0, "n_onder_kn_m": 1.0, "m_onder_knm_m": 0.0 },
            "geconcentreerd": [{ "naam": "a", "n_edc_kn": 1.0, "l_b_mm": 100.0, "b_mm": 100.0,
                "a1_mm": 0.0, "h_c_m": 2.0, "e_mm": 0.0 }],
            "afschuiving": { "v_ed_kn": 1.0, "n_ed_kn": 1.0, "m_ed_knm": 0.0 },
            "buiging": { "m_ed_knm_m": 0.1, "breukvlak": "EvenwijdigAanLintvoegen" }
        })
    }

    fn sleutels(v: &Value) -> Vec<String> {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    }

    /// Spiegeltest: het schema noemt op elk niveau precies de velden van het
    /// invoertype (rondgang door het type, dus ook velden met een standaard).
    #[test]
    fn het_schema_kent_precies_de_velden_van_de_invoertypen() {
        let t: metselwerk_check::MetselwerkWandInput = serde_json::from_value(voorbeeld()).unwrap();
        let v = serde_json::to_value(&t).unwrap();
        let s = schema_wand();
        let p = &s["properties"];
        assert_eq!(sleutels(&v), sleutels(p));
        for veld in ["materiaal", "geometrie", "verticaal", "afschuiving", "buiging"] {
            assert_eq!(sleutels(&v[veld]), sleutels(&p[veld]["properties"]), "{veld}");
        }
        assert_eq!(sleutels(&v["geconcentreerd"][0]), sleutels(&p["geconcentreerd"]["items"]["properties"]));
        assert_eq!(sleutels(&v["materiaal"]["k"]), sleutels(&p["materiaal"]["properties"]["k"]["properties"]));
    }

    /// Elk object in het schema is gesloten.
    #[test]
    fn elk_object_is_strikt() {
        fn loop_door(v: &Value, pad: &str) {
            match v {
                Value::Object(m) => {
                    if m.get("type") == Some(&json!("object")) {
                        assert_eq!(m.get("additionalProperties"), Some(&json!(false)), "{pad}");
                    }
                    for (k, w) in m {
                        loop_door(w, &format!("{pad}.{k}"));
                    }
                }
                Value::Array(a) => a.iter().enumerate().for_each(|(i, w)| loop_door(w, &format!("{pad}[{i}]"))),
                _ => {}
            }
        }
        for t in tool_definitions() {
            loop_door(&t["inputSchema"], "inputSchema");
        }
    }
}
