//! aluminium_tools.rs — aluminium (NEN-EN 1999-1-1, issue #5) als MCP-tools.
//!
//! De derde weg naar `aluminium_check`, naast het Tauri-command en de
//! toetsbrug-opdracht van dezelfde naam. Er wordt hier niet gerekend: de tool
//! leest het invoertype, roept `aluminium_check::check_all_aluminium_beams`
//! aan en geeft het resultaat door. Namen in het meervoud met een lijst onder
//! `inputs`, net als bij hout (zie `timber_tools.rs`).
//!
//! Het schema is strikt (`additionalProperties: false` op elk niveau): het
//! invoertype en de doorsnede staan op `deny_unknown_fields`, en de spiegeltest
//! onderaan leest de veldnamen uit het type zelf.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::RpcError;

pub const ALUMINIUM_TOOLS: [&str; 2] = ["list_aluminium_alloys", "check_aluminium_beams"];

pub fn is_aluminium_tool(naam: &str) -> bool {
    ALUMINIUM_TOOLS.contains(&naam)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Staafinvoer {
    inputs: Vec<aluminium_check::AluminiumBeamCheckInput>,
}

pub async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        "list_aluminium_alloys" => Ok(json!({ "alloys": aluminium_check::list_aluminium_alloys() })),
        "check_aluminium_beams" => {
            let args: Staafinvoer = serde_json::from_value(args)
                .map_err(|e| RpcError::invalid_params(format!("AluminiumBeamCheckInput: {e}")))?;
            let uit = tokio::task::spawn_blocking(move || aluminium_check::check_all_aluminium_beams(args.inputs))
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
            props.insert((*v).into(), getal(b));
            verplicht.push(json!(v));
        }
        json!({
            "type": "object", "additionalProperties": false, "description": uitleg,
            "properties": props, "required": verplicht
        })
    };
    json!({
        "description": "Doorsnede zonder afrondingsstralen (veilig). Buiging om de sterke as; h staat langs z.",
        "oneOf": [
            variant("IProfiel", &[("h_mm", "Hoogte mm."), ("b_mm", "Flensbreedte mm."), ("tw_mm", "Lijfdikte mm."), ("tf_mm", "Flensdikte mm.")],
                "Dubbelsymmetrisch I-profiel."),
            variant("Koker", &[("h_mm", "Hoogte mm."), ("b_mm", "Breedte mm."), ("t_mm", "Wanddikte mm.")],
                "Rechthoekige koker met één wanddikte."),
            variant("Rechthoek", &[("b_mm", "Breedte mm."), ("h_mm", "Hoogte mm.")],
                "Massieve rechthoek (geen lokale plooi)."),
        ]
    })
}

pub(crate) fn schema_aluminium_staaf() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": [
            "beam_id", "section_name", "doorsnede", "legering", "lasstatus", "length_m",
            "forces_envelope", "buckling_length_y_m", "buckling_length_z_m"
        ],
        "properties": {
            "beam_id": { "type": "integer", "minimum": 0 },
            "section_name": { "type": "string", "description": "Naam voor de kopregel." },
            "doorsnede": schema_doorsnede(),
            "legering": { "type": "string", "enum": nen_en_1999_1_1::legering_namen(),
                "description": "Legering uit NEN-EN 1999-1-1 tabel 3.2b (extrusieprofielen). De rij volgt uit de grootste plaatdikte; buiten het bereik wordt de staaf geweigerd." },
            "lasstatus": { "type": "string", "enum": ["Onbekend", "Geen", "Gelast"],
                "description": "VERPLICHT, geen standaard. 'Geen' = bevestigd ongelast. 'Gelast' = MIG; de hele doorsnede wordt in de HAZ gerekend (§6.1.6, veilig, b_haz niet bepaald) en knik wordt dan NIET getoetst (κ, tabel 6.5). 'Onbekend' rekent als gelast maar geeft nooit 'voldoet'." },
            "length_m": getal("Staaflengte m."),
            "forces_envelope": crate::schema_krachtenomhullende(),
            "buckling_length_y_m": getal("Kniklengte in het vlak (om de sterke as y), m."),
            "buckling_length_z_m": getal("Kniklengte uit het vlak (om de zwakke as z), m."),
            "zijdelings_gesteund": { "type": "boolean", "default": false,
                "description": "Verklaring dat kip (§6.3.2) niet kan optreden (gedrukte rand over de hele lengte gesteund). Weglaten = false: kip blijft bij een moment 'niet getoetst' en de status wordt nooit 'voldoet'." },
            "deflection_mm": { "type": "number", "minimum": 0,
                "description": "Grootste BGT-doorbuiging mm (optioneel; met `deflection_limit_numerator`)." },
            "deflection_limit_numerator": { "type": "number", "exclusiveMinimum": 0,
                "description": "Projectgrens w ≤ L/n (§7.2 geeft geen waarde). Optioneel." }
        }
    })
}

pub fn tool_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "list_aluminium_alloys",
            "description": "List the aluminium alloys the EN 1999-1-1 engine supports (table 3.2b, extruded profiles, T6): per thickness range f_o, f_u, f_o,haz, f_u,haz, rho_o,haz, rho_u,haz and the buckling class. Same list as the Tauri command and the toetsbrug opdracht of the same name, wrapped in an 'alloys' object.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
        }),
        json!({
            "name": "check_aluminium_beams",
            "description": "Run the NEN-EN 1999-1-1 aluminium member check on a list of members (I-section, rectangular hollow section or solid rectangle, major-axis bending): cross-section classification (6.1.4, table 6.2), local buckling with rho_c (6.1.5), tension (6.2.3), compression (6.2.4), bending (6.2.5), shear (6.2.6, non-slender webs), bending with shear (6.2.8), axial force with bending (6.2.9/6.2.10, linear form) and flexural buckling about both axes (6.3.1, unwelded members only), plus an optional SLS deflection against a project limit (7.2). Welded members are computed with the whole cross-section in the HAZ. NOT included: lateral-torsional buckling (6.3.2), members in bending and compression (6.3.3), buckling of welded members, shear buckling, minor-axis bending and torsion — when one of these applies, it is listed in `niet_getoetst` and the status is NotApplicable, never Ok. gamma_M1 = 1.10, gamma_M2 = 1.25 (recommended values, table 6.1). Same types as the Tauri command and the toetsbrug opdracht `check_aluminium_beams`; all three run through `aluminium_check::check_all_aluminium_beams`.",
            "inputSchema": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "inputs": { "type": "array", "description": "De aluminium staven. De volgorde van de lijst is de volgorde van de resultaten.", "items": schema_aluminium_staaf() }
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
        let t: aluminium_check::AluminiumBeamCheckInput = serde_json::from_value(json!({
            "beam_id": 1, "section_name": "x",
            "doorsnede": { "vorm": "Koker", "h_mm": 100.0, "b_mm": 50.0, "t_mm": 3.0 },
            "legering": "EN AW-6063 T6", "lasstatus": "Geen", "length_m": 1.0,
            "forces_envelope": [], "buckling_length_y_m": 1.0, "buckling_length_z_m": 1.0
        }))
        .unwrap();
        let mut uit_type: Vec<String> = serde_json::to_value(&t).unwrap().as_object().unwrap().keys().cloned().collect();
        let schema = schema_aluminium_staaf();
        let mut uit_schema: Vec<String> = schema["properties"].as_object().unwrap().keys().cloned().collect();
        uit_type.sort();
        uit_schema.sort();
        assert_eq!(uit_type, uit_schema);
        // De legeringen in het schema zijn die van de kern.
        assert_eq!(schema["properties"]["legering"]["enum"], json!(nen_en_1999_1_1::legering_namen()));
    }
}
