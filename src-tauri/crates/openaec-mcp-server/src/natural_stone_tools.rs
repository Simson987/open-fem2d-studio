//! natural_stone_tools.rs — natuurstenen elementen (issue #99) als MCP-tool.
//!
//! De derde weg naar `natuursteen_check`, naast het Tauri-command en de
//! toetsbrug-opdracht van dezelfde naam. Er wordt hier niet gerekend: de tool
//! leest het invoertype, roept
//! `natuursteen_check::check_all_natuursteen_elements` aan en geeft het
//! resultaat door.
//!
//! Het schema is strikt (`additionalProperties: false` op elk niveau): alle
//! invoertypen staan op `deny_unknown_fields`, en de spiegeltest onderaan
//! leest de veldnamen uit de typen zelf.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::RpcError;

pub const NATURAL_STONE_TOOLS: [&str; 1] = ["check_natural_stone_elements"];

pub fn is_natural_stone_tool(naam: &str) -> bool {
    NATURAL_STONE_TOOLS.contains(&naam)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Elementinvoer {
    inputs: Vec<natuursteen_check::NatuursteenElementInput>,
}

pub async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        "check_natural_stone_elements" => {
            let args: Elementinvoer = serde_json::from_value(args)
                .map_err(|e| RpcError::invalid_params(format!("NatuursteenElementInput: {e}")))?;
            let uit = tokio::task::spawn_blocking(move || {
                natuursteen_check::check_all_natuursteen_elements(args.inputs)
            })
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

fn niet_neg(beschrijving: &str) -> Value {
    json!({ "type": "number", "minimum": 0, "description": beschrijving })
}

fn getal(beschrijving: &str) -> Value {
    json!({ "type": "number", "description": beschrijving })
}

fn tekst(beschrijving: &str) -> Value {
    json!({ "type": "string", "description": beschrijving })
}

fn bron(beschrijving: &str) -> Value {
    json!({ "type": "string", "minLength": 1, "description": beschrijving })
}

fn object(props: Value, verplicht: &[&str], beschrijving: &str) -> Value {
    json!({
        "type": "object", "additionalProperties": false, "description": beschrijving,
        "properties": props, "required": verplicht
    })
}

/// Een opgegeven waarde met haar bron.
fn schema_normwaarde(beschrijving: &str) -> Value {
    object(
        json!({
            "waarde": pos("De waarde."),
            "bron": bron("Bron: richtlijn, productverklaring, proefrapport of eigen keuze. Leeg = geweigerd.")
        }),
        &["waarde", "bron"],
        beschrijving,
    )
}

/// Een sterkte uit proeven of als opgegeven karakteristieke waarde.
fn schema_sterkte(beschrijving: &str, eenheid: &str) -> Value {
    json!({
        "description": beschrijving,
        "oneOf": [
            object(
                json!({
                    "soort": { "const": "Proefresultaten" },
                    "waarden": { "type": "array", "minItems": 3, "items": pos(eenheid),
                        "description": format!("De losse proefuitkomsten in {eenheid}, minstens 3 (NEN-EN 1990 tabel D.1, V_X onbekend).") },
                    "verdeling": { "type": "string", "enum": ["Normaal", "Lognormaal"],
                        "description": "Normaal: X_k = m − k_n s (vgl. D.1); Lognormaal: X_k = exp(m_Y − k_n s_Y) (vgl. D.2)." },
                    "bron": bron("Het proefrapport.")
                }),
                &["soort", "waarden", "verdeling", "bron"],
                "Karakteristieke waarde (5%-fractiel) volgens NEN-EN 1990 bijlage D, §D.7.2, k_n = t_{n−1;0,95}·√(1+1/n).",
            ),
            object(
                json!({
                    "soort": { "const": "Karakteristiek" },
                    "waarde": pos(&format!("De karakteristieke waarde in {eenheid}.")),
                    "bron": bron("Bron, bijv. de productverklaring (lower expected value, EN 1469 / EN 12372).")
                }),
                &["soort", "waarde", "bron"],
                "Opgegeven karakteristieke waarde met bron.",
            )
        ]
    })
}

pub(crate) fn schema_materiaal() -> Value {
    object(
        json!({
            "steensoort": tekst("Naam van de steen, bijv. 'Belgisch hardsteen'."),
            "buigproef": { "type": "string", "enum": ["En12372", "En13161"],
                "description": "Proefmethode van de buigsterkte: En12372 (geconcentreerde last) of En13161 (constant moment). Alleen voor het rapport; er wordt niet omgerekend." },
            "buigsterkte": schema_sterkte("Buigsterkte f_f (EN 12372 / EN 13161).", "N/mm²"),
            "druksterkte": schema_sterkte("Druksterkte f_c (EN 1926). Zonder: druk bij N_Ed > 0 en oplegdruk niet getoetst.", "N/mm²"),
            "schuifsterkte": schema_normwaarde("Karakteristieke schuifsterkte f_vk in N/mm², met bron (geen EN-proefnorm). Zonder: afschuiving niet getoetst."),
            "gamma_m": schema_normwaarde("Materiaalfactor γ_M (≥ 1), met bron. Geen standaardwaarde."),
            "reductiefactoren": {
                "type": "array",
                "description": "VERPLICHT (mag leeg zijn): factoren 0 < k ≤ 1 voor vochttoestand, vorst, belastingsduur, elk met bron. f_d = Π k · f_k / γ_M.",
                "items": object(
                    json!({
                        "naam": { "type": "string", "minLength": 1, "description": "Bijv. 'vochttoestand', 'vorst', 'belastingsduur'." },
                        "waarde": { "type": "number", "exclusiveMinimum": 0, "maximum": 1 },
                        "bron": bron("Bron van de factor.")
                    }),
                    &["naam", "waarde", "bron"],
                    "Eén reductiefactor.",
                )
            },
            "e_modulus": schema_normwaarde("Elasticiteitsmodulus E in N/mm² (EN 14146), met bron. Nodig voor de doorbuiging."),
            "volumiek_gewicht": schema_normwaarde("Volumiek gewicht in kN/m³ (EN 1936), met bron. Nodig als gamma_g bij de belasting is opgegeven.")
        }),
        &["steensoort", "buigproef", "buigsterkte", "gamma_m", "reductiefactoren"],
        "Natuursteen: sterkten uit beproeving en de factoren, elk met bron; geen standaardwaarden.",
    )
}

fn schema_belasting() -> Value {
    json!({
        "description": "Belasting in de uiterste grenstoestand.",
        "oneOf": [
            object(
                json!({
                    "soort": { "const": "Krachten" },
                    "m_ed_knm": getal("M_Ed in de maatgevende doorsnede, kNm."),
                    "v_ed_kn": getal("V_Ed, kN."),
                    "n_ed_kn": getal("N_Ed, kN, DRUK positief.")
                }),
                &["soort", "m_ed_knm", "v_ed_kn", "n_ed_kn"],
                "Rekenwaarden van de snedekrachten.",
            ),
            object(
                json!({
                    "soort": { "const": "Ligger" },
                    "schema": { "type": "string", "enum": ["VrijOpgelegd", "Uitkragend"],
                        "description": "VrijOpgelegd: M = q l²/8 + F l/4, V = q l/2 + F/2 (F in het midden). Uitkragend: M = q l²/2 + F l, V = q l + F (F aan het eind)." },
                    "l_m": pos("Overspanning of uitkraging, m."),
                    "q_ed_kn_m": niet_neg("Gelijkmatig verdeelde rekenlast, kN/m (zonder eigen gewicht als gamma_g is opgegeven)."),
                    "f_ed_kn": niet_neg("Puntlast (rekenwaarde), kN."),
                    "gamma_g": schema_normwaarde("γ_G voor het eigen gewicht (met bron); vraagt volumiek_gewicht. Weglaten = q_ed bevat het eigen gewicht al.")
                }),
                &["soort", "schema", "l_m", "q_ed_kn_m", "f_ed_kn"],
                "Een ligger; de toets bepaalt M_Ed en V_Ed.",
            )
        ]
    })
}

pub(crate) fn schema_element() -> Value {
    object(
        json!({
            "element_id": { "type": "integer", "minimum": 0 },
            "naam": tekst("Naam voor de kopregel."),
            "soort": { "type": "string", "enum": ["Latei", "Dorpel", "Consoleplaat", "Vloerplaat", "Traptrede", "Gevelplaat"],
                "description": "Soort element (kop en rapport)." },
            "materiaal": schema_materiaal(),
            "doorsnede": object(
                json!({ "b_mm": pos("Breedte b (bij een plaat: strookbreedte), mm."), "h_mm": pos("Hoogte/dikte h, mm.") }),
                &["b_mm", "h_mm"],
                "Rechthoekige doorsnede.",
            ),
            "zijdelings_gesteund": { "type": "boolean",
                "description": "VERPLICHT: is het element zijdelings gesteund (ingemetseld, verlijmd)? Bij false en h > b: kip niet getoetst (nooit Ok)." },
            "belasting": schema_belasting(),
            "oplegging": object(
                json!({ "f_ed_kn": niet_neg("Oplegreactie F_Ed, kN."), "a_mm": pos("Opleglengte a, mm.") }),
                &["f_ed_kn", "a_mm"],
                "Oplegdruk σ = F_Ed/(a·b) ≤ f_c,d (vraagt de druksterkte). Weglaten = niet getoetst.",
            ),
            "doorbuiging": object(
                json!({
                    "q_ser_kn_m": niet_neg("Representatieve lijnlast zonder eigen gewicht, kN/m."),
                    "f_ser_kn": niet_neg("Representatieve puntlast, kN."),
                    "grens": schema_normwaarde("Noemer van de grens w ≤ l/grens, met bron.")
                }),
                &["q_ser_kn_m", "f_ser_kn", "grens"],
                "Doorbuiging (BGT), alleen bij belasting Ligger; vraagt e_modulus.",
            ),
            "verankering": object(
                json!({
                    "breuklast": schema_sterkte("Breuklast per anker bij het ankergat (EN 13364).", "kN"),
                    "gamma": schema_normwaarde("Factor op de karakteristieke breuklast (≥ 1), met bron."),
                    "f_ed_kn": niet_neg("Rekenwaarde van de ankerkracht (wind en eigen gewicht), kN.")
                }),
                &["breuklast", "gamma", "f_ed_kn"],
                "Verankering van een gevelplaat: F_Ed ≤ F_k/γ. Plaatdikte en gatpositie (EN 1469) worden niet getoetst.",
            )
        }),
        &["element_id", "naam", "soort", "materiaal", "doorsnede", "zijdelings_gesteund", "belasting"],
        "Eén natuurstenen element.",
    )
}

pub fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": "check_natural_stone_elements",
        "description": "Check natural stone elements (lintels, sills, corbels, floor slabs, stair treads, facade slabs) with a rectangular section. Strengths come from testing: flexural strength EN 12372 or EN 13161, compressive strength EN 1926, breaking load at the dowel hole EN 13364. The characteristic value (5% fractile) is derived from the individual test results according to EN 1990 Annex D (D.7.2, V_X unknown, normal or lognormal, k_n = t_{n-1;0.95} sqrt(1+1/n), n >= 3), or given directly with its source. The material factor gamma_M and reduction factors for moisture, frost and load duration have NO defaults: each must be given with its source. Checks: bending (tension edge, sigma = |M|/W <= f_f,d; favourable compression ignored), compression edge, shear (tau = 1.5 V/A, only with a given f_vk), bearing pressure, deflection (SLS, beam only) and anchorage. NOT checked (listed in `niet_getoetst`, status NotApplicable, never Ok): buckling of compressed elements, lateral-torsional buckling of a deep section (h > b) that is not laterally supported, slab thickness and dowel position to EN 1469, and every check whose strength is missing. Natural stone MASONRY is checked by `check_masonry_walls` (steensoort Natuursteen). Forces: compression POSITIVE. Same types as the Tauri command and the toetsbrug opdracht `check_natural_stone_elements`; all three run through `natuursteen_check::check_all_natuursteen_elements`.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "inputs": { "type": "array", "description": "De elementen. De volgorde van de lijst is de volgorde van de resultaten.", "items": schema_element() }
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
            "element_id": 1, "naam": "x", "soort": "Latei",
            "materiaal": {
                "steensoort": "kalksteen", "buigproef": "En12372",
                "buigsterkte": { "soort": "Proefresultaten", "waarden": [10.0, 11.0, 12.0], "verdeling": "Normaal", "bron": "r" },
                "druksterkte": { "soort": "Karakteristiek", "waarde": 80.0, "bron": "r" },
                "schuifsterkte": nw(1.0), "gamma_m": nw(2.0),
                "reductiefactoren": [{ "naam": "vocht", "waarde": 0.9, "bron": "r" }],
                "e_modulus": nw(50000.0), "volumiek_gewicht": nw(27.0)
            },
            "doorsnede": { "b_mm": 100.0, "h_mm": 200.0 },
            "zijdelings_gesteund": true,
            "belasting": { "soort": "Ligger", "schema": "VrijOpgelegd", "l_m": 1.5, "q_ed_kn_m": 6.0, "f_ed_kn": 0.0, "gamma_g": nw(1.2) },
            "oplegging": { "f_ed_kn": 5.0, "a_mm": 100.0 },
            "doorbuiging": { "q_ser_kn_m": 4.5, "f_ser_kn": 0.0, "grens": nw(500.0) },
            "verankering": {
                "breuklast": { "soort": "Karakteristiek", "waarde": 2.0, "bron": "r" },
                "gamma": nw(2.5), "f_ed_kn": 0.5
            }
        })
    }

    fn sleutels(v: &Value) -> Vec<String> {
        let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
        k.sort();
        k
    }

    fn variant<'a>(one_of: &'a Value, soort: &str) -> &'a Value {
        let v = one_of["oneOf"].as_array().unwrap().iter()
            .find(|v| v["properties"]["soort"]["const"] == soort)
            .unwrap_or_else(|| panic!("variant {soort}"));
        &v["properties"]
    }

    /// Spiegeltest: het schema noemt op elk niveau precies de velden van het
    /// invoertype (rondgang door het type, dus ook optionele velden).
    #[test]
    fn het_schema_kent_precies_de_velden_van_de_invoertypen() {
        let t: natuursteen_check::NatuursteenElementInput = serde_json::from_value(voorbeeld()).unwrap();
        let v = serde_json::to_value(&t).unwrap();
        let s = schema_element();
        let p = &s["properties"];
        assert_eq!(sleutels(&v), sleutels(p));
        for veld in ["materiaal", "doorsnede", "oplegging", "doorbuiging", "verankering"] {
            assert_eq!(sleutels(&v[veld]), sleutels(&p[veld]["properties"]), "{veld}");
        }
        let m = &p["materiaal"]["properties"];
        assert_eq!(sleutels(&v["materiaal"]["reductiefactoren"][0]), sleutels(&m["reductiefactoren"]["items"]["properties"]));
        assert_eq!(sleutels(&v["materiaal"]["gamma_m"]), sleutels(&m["gamma_m"]["properties"]));
        assert_eq!(sleutels(&v["materiaal"]["buigsterkte"]), sleutels(variant(&m["buigsterkte"], "Proefresultaten")));
        assert_eq!(sleutels(&v["materiaal"]["druksterkte"]), sleutels(variant(&m["druksterkte"], "Karakteristiek")));
        assert_eq!(sleutels(&v["belasting"]), sleutels(variant(&p["belasting"], "Ligger")));
        let k: natuursteen_check::Belasting =
            serde_json::from_value(json!({ "soort": "Krachten", "m_ed_knm": 1.0, "v_ed_kn": 1.0, "n_ed_kn": 0.0 })).unwrap();
        assert_eq!(sleutels(&serde_json::to_value(k).unwrap()), sleutels(variant(&p["belasting"], "Krachten")));
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
