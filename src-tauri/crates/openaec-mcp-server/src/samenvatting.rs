//! Compacte samenvatting van toetsresultaten (`detail: "samenvatting"`,
//! issue #229).
//!
//! WAAROM
//! Een volledig toetsresultaat draagt per toets de formule, de variabelen,
//! de tussenwaarden, de deelstappen, de notities en (beton) het hele
//! M-N-κ-diagram en beide interactiediagrammen; `check_fem_model` stuurt
//! bovendien alle toetsinvoer terug, met de krachtverdeling per station.
//! Gemeten in de controle van oktober 2026: 33–110 kB voor één staaf. Voor
//! een AI-assistent is dat ballast — bij een groot model viel de verbinding
//! weg.
//!
//! WAT DE SAMENVATTING BEWAART
//! Per staaf (of plaat) de kale gegevens (id, profiel, materiaal, `uc_max`,
//! `status`, de maatgevende toets en combinatie) en per toets alleen id,
//! titel, artikel, UC, status en de combinatie van het krachtpunt. Lijsten
//! van tekst (bijvoorbeeld de vormaannamen) en `niet_uitgevoerd` (wat er NIET
//! getoetst is en waarom) blijven staan: die horen bij het oordeel. Wat
//! wegvalt is uitsluitend afleiding; met `detail: "volledig"` komt die terug.
//! Er wordt niets herberekend en geen getal veranderd.

use serde_json::{json, Map, Value};

/// Velden die bij het oordeel horen en dus ook in de samenvatting blijven,
/// al zijn het lijsten of objecten.
const ALTIJD_BEWAREN: [&str; 3] = ["niet_uitgevoerd", "shape_assumptions", "geweigerd"];

/// Eén toets (`NamedCheck`: `{ id, kind: { type, data } }`) als kaal record.
fn samenvat_toets(toets: &Value) -> Value {
    let data = &toets["kind"]["data"];
    let uc = &data["uc"];
    let mut uit = Map::new();
    uit.insert("id".into(), toets["id"].clone());
    for sleutel in ["title", "article", "status"] {
        if !data[sleutel].is_null() {
            uit.insert(sleutel.into(), data[sleutel].clone());
        }
    }
    uit.insert("uc".into(), if uc.is_object() { uc["uc"].clone() } else { Value::Null });
    let combinatie = &data["force_state"]["combination_id"];
    if !combinatie.is_null() {
        uit.insert("combination_id".into(), combinatie.clone());
    }
    Value::Object(uit)
}

/// Eén toetsresultaat (staal, hout, kruislaaghout, beton of plaat) als
/// samenvatting: alle kale velden, de toetsen kaal, de rest weg.
pub(crate) fn samenvat_resultaat(r: &Value) -> Value {
    let Some(obj) = r.as_object() else { return r.clone() };
    let mut uit = Map::new();
    for (sleutel, waarde) in obj {
        let kaal = !(waarde.is_object() || waarde.is_array());
        let tekstlijst = waarde
            .as_array()
            .is_some_and(|a| a.iter().all(Value::is_string));
        if kaal || tekstlijst || ALTIJD_BEWAREN.contains(&sleutel.as_str()) {
            uit.insert(sleutel.clone(), waarde.clone());
        } else if sleutel == "checks" {
            let toetsen = waarde.as_array().map(|a| a.iter().map(samenvat_toets).collect()).unwrap_or_default();
            uit.insert("checks".into(), Value::Array(toetsen));
        }
    }
    Value::Object(uit)
}

/// `check_fem_model` als samenvatting: de resultaten per staaf/plaat kaal,
/// de teruggestuurde toetsinvoer vervangen door een telling, en de
/// toelichtingen bij de toetsanalyse weg (`analyse_toelichting`,
/// `scheefstand_toelichting`; #199). `governing`,
/// `governing_plate`, `skipped_*`, `warnings`, `stability`, `self_weight` en
/// `solve_summary` blijven ongewijzigd: die zijn klein en dragen het oordeel.
pub(crate) fn samenvat_check_fem_model(uit: &mut Value) {
    let Some(map) = uit.as_object_mut() else { return };
    for sleutel in ["results", "timber_results", "clt_results", "plate_results"] {
        if let Some(Value::Array(lijst)) = map.get(sleutel) {
            let kort: Vec<Value> = lijst.iter().map(samenvat_resultaat).collect();
            map.insert(sleutel.into(), Value::Array(kort));
        }
    }
    let mut weggelaten = Map::new();
    for sleutel in ["steel_check_inputs", "timber_check_inputs", "clt_check_inputs", "plate_check_inputs"] {
        if let Some(waarde) = map.remove(sleutel) {
            let aantal = waarde.as_array().map(Vec::len).unwrap_or(0);
            weggelaten.insert(sleutel.into(), json!(aantal));
        }
    }
    // De toelichtingen bij de toetsanalyse (issue #199): de tekstuele afleiding
    // van de analyse en van φ. Het oordeel staat in `toetskrachten` (noemer en
    // de tweede-ordecombinaties) en `stability`; de tekst komt terug met
    // `detail: "volledig"`.
    let mut weggelaten_teksten = Vec::new();
    for sleutel in ["analyse_toelichting", "scheefstand_toelichting"] {
        if map.remove(sleutel).is_some() {
            weggelaten_teksten.push(json!(sleutel));
        }
    }
    map.insert("detail".into(), json!("samenvatting"));
    map.insert(
        "weggelaten_toetsinvoer".into(),
        json!({
            "aantallen": weggelaten,
            "toelichtingen": weggelaten_teksten,
            "toelichting": "Samenvatting: de toetsinvoer, formules, variabelen, deelstappen en notities zijn weggelaten. Vraag `detail: \"volledig\"` voor de afleiding.",
        }),
    );
}

/// Lees `detail` (`"samenvatting"` of `"volledig"`) uit de argumenten en haal
/// het eruit, zodat de rest naar een strikte invoerstructuur kan.
pub(crate) fn neem_detail(args: &mut Value) -> Result<bool, String> {
    match args.as_object_mut().and_then(|m| m.remove("detail")) {
        None => Ok(false),
        Some(Value::String(s)) if s == "volledig" => Ok(false),
        Some(Value::String(s)) if s == "samenvatting" => Ok(true),
        Some(v) => Err(format!("`detail` moet \"samenvatting\" of \"volledig\" zijn, niet {v}.")),
    }
}

/// Het schema van `detail`, gedeeld door de tools die het kennen.
pub(crate) fn schema_detail() -> Value {
    json!({
        "type": "string", "enum": ["volledig", "samenvatting"], "default": "volledig",
        "description": "\"samenvatting\" geeft een antwoord van enkele kB: per staaf (of plaat) uc_max, status, de maatgevende toets en combinatie, en per toets alleen id, titel, artikel, UC, status en combinatie; wat niet getoetst is en waarom, `warnings`, `skipped_*` en `governing` blijven volledig. Formules, variabelen, deelstappen, notities, diagrammen en de teruggestuurde toetsinvoer vallen weg. Aanbevolen voor een eerste oordeel; \"volledig\" (standaard) geeft de hele afleiding."
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toets(id: &str, uc: f64) -> Value {
        json!({ "id": id, "kind": { "type": "Resistance", "data": {
            "id": id, "title": "Buiging", "article": "6.1.6",
            "force_state": { "combination_id": 3, "position_mm": 2000.0,
                "forces": { "n_ed": 0.0, "vy_ed": 0.0, "vz_ed": 6.0, "mt_ed": 0.0, "my_ed": 6.0, "mz_ed": 0.0 } },
            "formula_latex": "\\frac{a}{b}", "variables": [{ "symbol": "a", "value": 1.0, "unit": "" }],
            "value": 14.77, "unit": "MPa", "uc": { "ed": 9.481, "rd": 14.77, "uc": uc, "formula_latex": "x" },
            "status": "Ok", "notes": ["lange toelichting"], "deelstappen": [{ "titel": "stap" }]
        }}})
    }

    #[test]
    fn een_resultaat_houdt_het_oordeel_en_verliest_de_afleiding() {
        let r = json!({
            "beam_id": 1, "section_name": "75 x 225", "uc_max": 0.642, "status": "Ok",
            "governing_check_id": "bending", "governing_combination_id": 3,
            "checks": [toets("bending", 0.642)],
            "niet_uitgevoerd": [{ "id": "7.3.4", "reden": "geen milieuklasse" }],
            "shape_assumptions": ["rechthoek"],
            "mn_kappa": { "punten": [1, 2, 3] }, "interaction_positive": [{ "n": 1 }],
            "k_mod_per_load_duration": [{ "x": 1 }]
        });
        let s = samenvat_resultaat(&r);
        for sleutel in ["beam_id", "section_name", "uc_max", "status", "governing_check_id", "governing_combination_id", "niet_uitgevoerd", "shape_assumptions"] {
            assert_eq!(s[sleutel], r[sleutel], "{sleutel}");
        }
        for weg in ["mn_kappa", "interaction_positive", "k_mod_per_load_duration"] {
            assert!(s.get(weg).is_none(), "{weg} hoort weg te vallen");
        }
        assert_eq!(
            s["checks"][0],
            json!({ "id": "bending", "title": "Buiging", "article": "6.1.6", "status": "Ok", "uc": 0.642, "combination_id": 3 })
        );
        assert!(serde_json::to_string(&s).unwrap().len() < serde_json::to_string(&r).unwrap().len() / 2);
    }

    #[test]
    fn check_fem_model_telt_de_weggelaten_toetsinvoer() {
        let mut uit = json!({
            "results": [{ "beam_id": 1, "uc_max": 0.5, "checks": [toets("b", 0.5)] }],
            "steel_check_inputs": [{ "beam_id": 1, "envelope": [1, 2, 3] }],
            "timber_check_inputs": [], "governing": { "beam_id": 1, "uc_max": 0.5 },
            "warnings": ["w"], "skipped_beams": []
        });
        samenvat_check_fem_model(&mut uit);
        assert!(uit.get("steel_check_inputs").is_none());
        assert_eq!(uit["weggelaten_toetsinvoer"]["aantallen"]["steel_check_inputs"], json!(1));
        assert_eq!(uit["governing"]["uc_max"], json!(0.5));
        assert_eq!(uit["warnings"], json!(["w"]));
        assert_eq!(uit["results"][0]["checks"][0]["uc"], json!(0.5));
        assert_eq!(uit["detail"], json!("samenvatting"));
    }

    #[test]
    fn detail_wordt_gelezen_en_verwijderd() {
        let mut a = json!({ "detail": "samenvatting", "x": 1 });
        assert_eq!(neem_detail(&mut a), Ok(true));
        assert_eq!(a, json!({ "x": 1 }));
        assert_eq!(neem_detail(&mut json!({})), Ok(false));
        assert_eq!(neem_detail(&mut json!({ "detail": "volledig" })), Ok(false));
        assert!(neem_detail(&mut json!({ "detail": "kort" })).is_err());
    }
}
