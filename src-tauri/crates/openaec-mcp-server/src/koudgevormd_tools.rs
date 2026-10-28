//! koudgevormd_tools.rs — koudgevormde profielen (NEN-EN 1993-1-3, issue #4)
//! als MCP-tools.
//!
//! De derde weg naar `koudgevormd_check`, naast het Tauri-command en de
//! toetsbrug-opdracht van dezelfde naam. Er wordt hier niet gerekend: de tool
//! leest het invoertype, roept `koudgevormd_check::check_all_koudgevormd_beams`
//! aan en geeft het resultaat door. Namen in het meervoud met een lijst onder
//! `inputs`, net als bij aluminium (zie `aluminium_tools.rs`).
//!
//! Het schema is strikt (`additionalProperties: false` op elk niveau): het
//! invoertype en de doorsnede staan op `deny_unknown_fields`, en de spiegeltest
//! onderaan leest de veldnamen uit het type zelf.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::RpcError;

pub const KOUDGEVORMD_TOOLS: [&str; 2] = ["list_koudgevormd_staalsoorten", "check_koudgevormd_beams"];

pub fn is_koudgevormd_tool(naam: &str) -> bool {
    KOUDGEVORMD_TOOLS.contains(&naam)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Staafinvoer {
    inputs: Vec<koudgevormd_check::KoudgevormdBeamCheckInput>,
}

pub async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        "list_koudgevormd_staalsoorten" => {
            Ok(json!({ "staalsoorten": koudgevormd_check::list_koudgevormd_staalsoorten() }))
        }
        "check_koudgevormd_beams" => {
            let args: Staafinvoer = serde_json::from_value(args)
                .map_err(|e| RpcError::invalid_params(format!("KoudgevormdBeamCheckInput: {e}")))?;
            let uit = tokio::task::spawn_blocking(move || koudgevormd_check::check_all_koudgevormd_beams(args.inputs))
                .await
                .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?;
            serde_json::to_value(uit)
                .map(|v| json!({ "results": v }))
                .map_err(|e| RpcError::tool_exec(format!("serialize result: {e}")))
        }
        _ => Err(RpcError::method_not_found(naam)),
    }
}

fn getal(beschrijving: &str) -> Value {
    json!({ "type": "number", "exclusiveMinimum": 0, "description": beschrijving })
}

fn schema_doorsnede() -> Value {
    let variant = |vorm: &str, velden: &[(&str, &str)], uitleg: &str| {
        let mut props = serde_json::Map::new();
        props.insert("vorm".into(), json!({ "const": vorm }));
        let mut verplicht = vec![json!("vorm")];
        for (v, b) in velden {
            let schema = if *v == "r_mm" {
                json!({ "type": "number", "minimum": 0, "description": b })
            } else {
                getal(b)
            };
            props.insert((*v).into(), schema);
            verplicht.push(json!(v));
        }
        json!({
            "type": "object", "additionalProperties": false, "description": uitleg,
            "properties": props, "required": verplicht
        })
    };
    let h = ("h_mm", "Hoogte buitenwerks, mm.");
    let b = ("b_mm", "Flensbreedte buitenwerks, mm.");
    let c = ("c_mm", "Liplengte buitenwerks, mm (lip loodrecht op de flens).");
    let t = ("t_mm", "KERNdikte t_cor zonder zinklaag (§3.2.4), mm.");
    let r = ("r_mm", "Binnenstraal van de zettingen, mm (alle zettingen 90°).");
    json!({
        "description": "Koudgevormd profiel, buitenwerkse maten. Buiging om de y-as (evenwijdig aan de flenzen); h staat langs z.",
        "oneOf": [
            variant("CProfiel", &[h, b, c, t, r], "C-profiel (U met lippen)."),
            variant("ZProfiel", &[h, b, c, t, r], "Z-profiel met lippen en gelijke flenzen (puntsymmetrisch)."),
            variant("UProfiel", &[h, b, t, r], "U-profiel zonder lippen."),
        ]
    })
}

pub(crate) fn schema_koudgevormd_staaf() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "beam_id", "section_name", "doorsnede", "staalsoort", "length_m",
            "forces_envelope", "buckling_length_y_m", "buckling_length_z_m"
        ],
        "properties": {
            "beam_id": { "type": "integer", "minimum": 0 },
            "section_name": { "type": "string", "description": "Naam voor de kopregel." },
            "doorsnede": schema_doorsnede(),
            "staalsoort": { "type": "string", "enum": nen_en_1993_1_3::staalsoort_namen(),
                "description": "Staalsoort uit NEN-EN 1993-1-3 tabel 3.1a (EN 10025-2 of EN 10346). Een deklaagaanduiding (+Z) hoort er niet bij." },
            "length_m": getal("Staaflengte m."),
            "forces_envelope": crate::schema_krachtenomhullende(),
            "buckling_length_y_m": getal("Kniklengte om de sterke as (y), m."),
            "buckling_length_z_m": getal("Kniklengte om de zwakke as (z), m. Bij een Z wordt max(L_y, L_z) voor beide hoofdassen gebruikt."),
            "buckling_length_t_m": getal("Kniklengte voor (buig)torsieknik l_T, m. Weglaten = de staaflengte (gaffelopleggingen)."),
            "zijdelings_gesteund": { "type": "boolean", "default": false,
                "description": "Verklaring dat de staaf over de hele lengte zijdelings en tegen wringen gesteund is (kip §6.2.4 kan niet optreden, een Z buigt om de y-as). Weglaten = false: kip blijft bij een moment 'niet getoetst' en de status wordt nooit 'voldoet'." },
            "deflection_mm": { "type": "number", "minimum": 0,
                "description": "Grootste BGT-doorbuiging mm uit een analyse met de bruto doorsnede (optioneel; met `deflection_limit_numerator`). De toets schaalt met I_y/I_y,eff (§7.1(3))." },
            "deflection_limit_numerator": { "type": "number", "exclusiveMinimum": 0,
                "description": "Projectgrens w ≤ L/n. Optioneel." }
        }
    })
}

pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "list_koudgevormd_staalsoorten",
            "description": "List the steel grades the EN 1993-1-3 cold-formed member check supports (table 3.1a subset: S235/S275/S355 to EN 10025-2, S220GD-S350GD to EN 10346) with f_yb and f_u. Same list as the Tauri command and the toetsbrug opdracht of the same name, wrapped in a 'staalsoorten' object.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "check_koudgevormd_beams",
            "description": "Run the NEN-EN 1993-1-3 cold-formed member check on a list of members (lipped C, lipped Z or plain U, major-axis bending): effective cross-section with EN 1993-1-5 4.4 and edge stiffeners (5.5.3, chi_d), tension with f_ya (6.1.2), compression (6.1.3), bending (6.1.4.1), shear (6.1.5), axial force + bending + shear with the neutral-axis shift e_N (6.1.8-6.1.10, linear form), flexural and (flexural-)torsional buckling (6.2.2/6.2.3, curve c), (6.36) for laterally restrained members, plus an optional SLS deflection scaled with I_y/I_y,eff against a project limit. NOT included: lateral-torsional buckling (6.2.4) of unrestrained members, stability of C/U in compression with the extra minor-axis moment N*e_N, minor-axis bending, torsion, local transverse forces (6.1.7), purlins with sheeting (10.1) and sections outside the limits of 5.2 — when one applies, it is listed in `niet_getoetst` and the status is NotApplicable, never Ok. gamma_M0 = gamma_M1 = 1.0, gamma_M2 = 1.25 (recommended values). Same types as the Tauri command and the toetsbrug opdracht `check_koudgevormd_beams`; all three run through `koudgevormd_check::check_all_koudgevormd_beams`.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "inputs": { "type": "array", "description": "De koudgevormde staven. De volgorde van de lijst is de volgorde van de resultaten.", "items": schema_koudgevormd_staaf() }
                },
                "required": ["inputs"]
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spiegeltest: het schema noemt precies de velden van het invoertype.
    #[test]
    fn het_schema_kent_precies_de_velden_van_het_invoertype() {
        let t: koudgevormd_check::KoudgevormdBeamCheckInput = serde_json::from_value(json!({
            "beam_id": 1, "section_name": "x",
            "doorsnede": { "vorm": "CProfiel", "h_mm": 200.0, "b_mm": 70.0, "c_mm": 20.0, "t_mm": 2.0, "r_mm": 3.0 },
            "staalsoort": "S350GD", "length_m": 1.0,
            "forces_envelope": [], "buckling_length_y_m": 1.0, "buckling_length_z_m": 1.0,
            "buckling_length_t_m": 1.0, "deflection_mm": 1.0, "deflection_limit_numerator": 250.0
        }))
        .unwrap();
        let mut uit_type: Vec<String> = serde_json::to_value(&t).unwrap().as_object().unwrap().keys().cloned().collect();
        let schema = schema_koudgevormd_staaf();
        let mut uit_schema: Vec<String> = schema["properties"].as_object().unwrap().keys().cloned().collect();
        uit_type.sort();
        uit_schema.sort();
        assert_eq!(uit_type, uit_schema);
        assert_eq!(schema["properties"]["staalsoort"]["enum"], json!(nen_en_1993_1_3::staalsoort_namen()));
        // De velden van elke doorsnedevariant zijn die van het type.
        for (vorm, velden) in [("CProfiel", 6), ("ZProfiel", 6), ("UProfiel", 5)] {
            let v = schema["properties"]["doorsnede"]["oneOf"].as_array().unwrap().iter()
                .find(|v| v["properties"]["vorm"]["const"] == vorm).unwrap();
            assert_eq!(v["properties"].as_object().unwrap().len(), velden, "{vorm}");
        }
    }
}
