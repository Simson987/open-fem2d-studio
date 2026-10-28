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

/// Het grootste |veld| over een lijst objecten, met het id-veld erbij.
fn grootste(lijst: &[Value], id: &str, velden: &[&str]) -> Option<Value> {
    let mut beste: Option<(f64, &Value, &str)> = None;
    for item in lijst {
        for veld in velden {
            if let Some(v) = item[*veld].as_f64() {
                if beste.map_or(true, |(b, _, _)| v.abs() > b) {
                    beste = Some((v.abs(), item, veld));
                }
            }
        }
    }
    beste.map(|(_, item, veld)| json!({ id: item[id].clone(), "veld": veld, "waarde": item[veld].clone() }))
}

/// Het 3D-rekenresultaat (`SolveResult3D`, camelCase) als samenvatting: alle
/// kale velden en de kleine samenvattingen (engine, analysis, secondOrder,
/// equilibrium, forceBalance, buckling-status en -modes, plates, diagnostics,
/// inactiveMembers, …) blijven; de lijsten per knoop, staaf en plaatelement
/// worden aantallen plus hun uitersten. Er wordt niets herberekend.
fn samenvat_3d_resultaat(r: &Value) -> Value {
    let Some(obj) = r.as_object() else { return r.clone() };
    let mut uit = Map::new();
    let mut aantallen = Map::new();
    let mut uitersten = Map::new();
    for (sleutel, waarde) in obj {
        match (sleutel.as_str(), waarde) {
            ("displacements", Value::Array(l)) => {
                aantallen.insert(sleutel.clone(), json!(l.len()));
                if let Some(m) = grootste(l, "nodeId", &["ux", "uy", "uz"]) {
                    uitersten.insert("verplaatsing_m".into(), m);
                }
                if let Some(m) = grootste(l, "nodeId", &["rx", "ry", "rz"]) {
                    uitersten.insert("rotatie_rad".into(), m);
                }
            }
            ("reactions", Value::Array(l)) => {
                aantallen.insert(sleutel.clone(), json!(l.len()));
                let mut som = [0.0_f64; 3];
                for item in l {
                    for (i, veld) in ["fx", "fy", "fz"].iter().enumerate() {
                        som[i] += item[*veld].as_f64().unwrap_or(0.0);
                    }
                }
                uit.insert("reactieSomKn".into(), json!(som));
                // Een paar opleggingen zijn klein en dragen het oordeel.
                if l.len() <= 20 {
                    uit.insert(sleutel.clone(), waarde.clone());
                }
            }
            ("memberForces", Value::Array(l)) => {
                aantallen.insert(sleutel.clone(), json!(l.len()));
                for (naam, velden) in [
                    ("N_kN", ["nStartKn", "nEndKn"]),
                    ("Vy_kN", ["vyStartKn", "vyEndKn"]),
                    ("Vz_kN", ["vzStartKn", "vzEndKn"]),
                    ("T_kNm", ["torsionStartKnm", "torsionEndKnm"]),
                    ("My_kNm", ["myStartKnm", "myEndKnm"]),
                    ("Mz_kNm", ["mzStartKnm", "mzEndKnm"]),
                ] {
                    if let Some(m) = grootste(l, "memberId", &velden) {
                        uitersten.insert(format!("staafeinde_{naam}"), m);
                    }
                }
            }
            // Snedekrachtlijnen: per component de staaf met de grootste
            // |waarde| over de hele lijn (maxAbsValue), dus ook in het veld.
            ("diagrams", Value::Object(d)) => {
                let mut lijnen = Map::new();
                for (component, lijst) in d {
                    let Some(l) = lijst.as_array() else { continue };
                    if let Some(m) = grootste(l, "memberId", &["maxAbsValue"]) {
                        lijnen.insert(component.clone(), m);
                    }
                }
                aantallen.insert(sleutel.clone(), json!(d.values().filter_map(Value::as_array).map(Vec::len).max().unwrap_or(0)));
                uitersten.insert("snedekrachtlijnen".into(), Value::Object(lijnen));
            }
            ("buckling", Value::Object(b)) => {
                let mut kort = Map::new();
                for (k, v) in b {
                    if k == "members" {
                        aantallen.insert("buckling.members".into(), json!(v.as_array().map(Vec::len).unwrap_or(0)));
                    } else {
                        kort.insert(k.clone(), v.clone());
                    }
                }
                uit.insert(sleutel.clone(), Value::Object(kort));
            }
            // Eén regel per plaat met haar uitersten: klein, blijft.
            ("plates", _) => {
                uit.insert(sleutel.clone(), waarde.clone());
            }
            (_, Value::Array(l)) if !l.iter().all(|v| v.is_string() || v.is_number()) => {
                aantallen.insert(sleutel.clone(), json!(l.len()));
            }
            ("plateMesh", Value::Object(_)) => {
                aantallen.insert(sleutel.clone(), json!(1));
            }
            _ => {
                uit.insert(sleutel.clone(), waarde.clone());
            }
        }
    }
    uit.insert("uitersten".into(), Value::Object(uitersten));
    uit.insert("weggelaten".into(), Value::Object(aantallen));
    Value::Object(uit)
}

/// `gui_solve` als samenvatting (#229). Het 2D-antwoord is al kort (per
/// combinatie de uitersten en een telling van de toetsing) en blijft zoals
/// het is. Het 3D-antwoord verliest de lijsten per knoop, staaf en
/// plaatelement (zie [`samenvat_3d_resultaat`]) en de afleiding van de
/// toetsen (zie [`samenvat_resultaat`]); oordeel, meldingen, overgeslagen
/// staven en combinatieoverzicht blijven.
pub(crate) fn samenvat_gui_solve(uit: &mut Value) {
    let Some(map) = uit.as_object_mut() else { return };
    if map.get("dimension").and_then(Value::as_str) == Some("3d") {
        if let Some(r) = map.get("result") {
            let kort = samenvat_3d_resultaat(r);
            map.insert("result".into(), kort);
        }
        for sleutel in ["steel", "concrete", "timber"] {
            if let Some(Value::Object(toetsing)) = map.get_mut(sleutel) {
                if let Some(Value::Array(lijst)) = toetsing.get("results") {
                    let kort: Vec<Value> = lijst.iter().map(samenvat_resultaat).collect();
                    toetsing.insert("results".into(), Value::Array(kort));
                }
            }
        }
    }
    map.insert("detail".into(), json!("samenvatting"));
    map.insert(
        "toelichting_detail".into(),
        json!("Samenvatting: lijsten per knoop, staaf en plaatelement staan als aantal in `result.weggelaten` en met hun uitersten in `result.uitersten`; per toets alleen id, titel, artikel, UC, status en combinatie. Vraag `detail: \"volledig\"` (standaard) voor alles."),
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

    /// gui_solve 3D: twee knopen, één staaf, een plaat met 600 elementen.
    /// De lijsten worden aantallen met hun uitersten; oordeel en
    /// samenvattingen blijven; 2D blijft zoals het was.
    #[test]
    fn gui_solve_3d_wordt_kort_en_2d_blijft() {
        let elementen: Vec<Value> = (0..600).map(|i| json!({ "elementId": i, "plateId": 1,
            "values": { "mxxKnmPerM": i as f64 * 0.01, "myyKnmPerM": 0.0 } })).collect();
        let mut uit = json!({
            "dimension": "3d", "melding": null, "maxVerplaatsingMm": 12.5,
            "combinatieResultaten": [{ "id": 1, "maxVerplaatsingMm": 12.5, "alphaCr": 11.0 }],
            "result": {
                "schemaVersion": 2, "engine": { "id": "e" }, "analysis": "pDelta",
                "displacements": [
                    { "nodeId": 1, "ux": 0.0, "uy": 0.0, "uz": 0.0, "rx": 0.0, "ry": 0.0, "rz": 0.0 },
                    { "nodeId": 2, "ux": 0.001, "uy": 0.0, "uz": -0.0125, "rx": 0.0, "ry": 0.004, "rz": 0.0 }],
                "reactions": [{ "nodeId": 1, "fx": -2.0, "fy": 0.0, "fz": 30.0, "mx": 0.0, "my": 5.0, "mz": 0.0 }],
                "memberForces": [{ "memberId": 7, "nStartKn": -3.0, "nEndKn": -3.0, "myStartKnm": 0.0, "myEndKnm": -40.0 }],
                "diagrams": { "momentY": [{ "memberId": 7, "points": [{ "x": 0.0, "value": 0.0 }], "maxValue": 45.0, "minValue": -40.0, "maxAbsValue": 45.0 }],
                              "axial": [{ "memberId": 7, "points": [], "maxValue": -3.0, "minValue": -3.0, "maxAbsValue": 3.0 }] },
                "buckling": { "status": "available", "modes": [{ "mode": 1, "loadFactor": 11.0 }], "members": [{ "memberId": 7 }] },
                "diagnostics": ["d"], "inactiveMembers": [3],
                "plates": [{ "plateId": 1, "elementCount": 600, "extremes": [{ "q": "mxx" }] }],
                "shellElements": elementen,
            },
            "steel": { "results": [{ "beam_id": 7, "uc_max": 0.5, "status": "Ok", "checks": [toets("b", 0.5)] }],
                       "skipped": [{ "beamId": 8, "reason": "hout" }], "notes": ["n"] },
            "concrete": null, "timber": null,
        });
        let groot = serde_json::to_string(&uit).unwrap().len();
        samenvat_gui_solve(&mut uit);
        let klein = serde_json::to_string(&uit).unwrap().len();
        assert!(klein < 4000 && klein * 5 < groot, "{groot} → {klein}");
        let r = &uit["result"];
        assert!(r.get("shellElements").is_none() && r.get("displacements").is_none() && r.get("diagrams").is_none());
        assert_eq!(r["weggelaten"]["shellElements"], json!(600));
        assert_eq!(r["weggelaten"]["displacements"], json!(2));
        assert_eq!(r["uitersten"]["verplaatsing_m"], json!({ "nodeId": 2, "veld": "uz", "waarde": -0.0125 }));
        assert_eq!(r["uitersten"]["snedekrachtlijnen"]["momentY"], json!({ "memberId": 7, "veld": "maxAbsValue", "waarde": 45.0 }));
        assert_eq!(r["uitersten"]["staafeinde_My_kNm"]["waarde"], json!(-40.0));
        assert_eq!(r["reactieSomKn"], json!([-2.0, 0.0, 30.0]));
        assert_eq!(r["buckling"]["modes"][0]["loadFactor"], json!(11.0));
        assert!(r["buckling"].get("members").is_none());
        assert_eq!(r["plates"][0]["elementCount"], json!(600));
        assert_eq!(r["inactiveMembers"], json!([3]));
        assert_eq!(uit["steel"]["results"][0]["checks"][0]["uc"], json!(0.5));
        assert!(uit["steel"]["results"][0]["checks"][0].get("notes").is_none());
        assert_eq!(uit["steel"]["skipped"][0]["beamId"], json!(8));
        assert_eq!(uit["combinatieResultaten"][0]["alphaCr"], json!(11.0));
        assert_eq!(uit["detail"], json!("samenvatting"));

        let twee_d = json!({ "combinaties": [{ "combinatie": 1, "M_max_kNm": 4.0 }], "toetsing": { "getoetst": 3 } });
        let mut kopie = twee_d.clone();
        samenvat_gui_solve(&mut kopie);
        assert_eq!(kopie["combinaties"], twee_d["combinaties"]);
        assert_eq!(kopie["toetsing"], twee_d["toetsing"]);
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
