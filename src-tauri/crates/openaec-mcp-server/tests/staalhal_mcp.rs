//! De MCP-tool `open_fem_3d_staalhal_maken` end-to-end over de echte binary:
//! generator (sidecar) → 3D-kern → uitwerking (sidecar) → staaltoets.
//!
//! De verwachte getallen zijn handwerk, niet afgelezen uit de uitkomst:
//!   G  0,30 · 60 · 30 = 540 kN          S  0,56 · 1800 = 1008 kN
//!   W dwars (0,64 + 0,40) · 8 · 60 = 499,2 kN in +Y, dak 0,48 · 1800 = 864 kN omhoog
//!   W langs 0,64 · 30 · (8 + 9,5)/2 / 2 = 84 kN in +X
//!   eigen gewicht staal Σ ρ·A·g·L = 809,947 kN (test-open-fem3d-staalhal.mjs),
//!   beton 2500 · 0,4 · 0,6 · 9,81 / 1000 = 5,886 kN/m over 2·60 + 11·30 + 22·0,8 m.
//!
//! DE TOETSKRACHTEN (issue #199, B9). `analyse` geldt alleen voor de
//! resultaten; de UGT-toets rekent altijd P-Δ met scheefstand φ = 1/200 (het
//! projectbestand van de hal heeft geen scheefstandvelden) in +X, −X, +Y en
//! −Y. Handcontrole per toetsberekening: de varianten +X en −X van één
//! combinatie hebben dezelfde lasten op φ·V na, dus
//! ΣR_x(+X) − ΣR_x(−X) = −2·φ·ΣR_z (en net zo in Y); K_G voert bij een
//! starre translatie geen kracht af. De standaardhal wordt geweigerd: zijn
//! wandverbanden CHS 88,9×4 knikken onder "Wind langs" zelf (8 van de 28
//! toetsberekeningen, α_cr 0,66–0,75; test-open-fem3d-staalhal-pdelta.mjs).
//! Met trek-alleen verbanden is elke toetsberekening stabiel.
//!
//! LET OP: dit meet de INGEBAKKEN solverbundel. Na een wijziging in
//! `design-mockup/src` eerst `npm run build:sidecar`. Node ≥ 20 is een harde eis.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");
const TOOL: &str = "open_fem_3d_staalhal_maken";

async fn eis_node() {
    let status = sidecar::status(&SidecarOpties::default()).await;
    assert!(
        status.available,
        "Deze test vereist Node.js {} of nieuwer. Gemeld: [{}] {}",
        sidecar::MINIMALE_NODE_MAJOR,
        status.error_code.unwrap_or_default(),
        status.reason.unwrap_or_default()
    );
}

/// Eén JSON-RPC-verzoek op een verse server (na `initialize`); geeft `result`.
async fn verzoek(methode: &str, params: Value) -> Value {
    verzoek_met(methode, params, &[]).await
}

/// Als [`verzoek`], met extra omgevingsvariabelen (een andere solverbundel).
async fn verzoek_met(methode: &str, params: Value, omgeving: &[(&str, &Path)]) -> Value {
    let mut cmd = Command::new(BIN_PATH);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (sleutel, waarde) in omgeving {
        cmd.env(sleutel, waarde);
    }
    if !omgeving.is_empty() {
        // Een aangewezen bundel met een andere hash mag alleen bewust draaien.
        cmd.env("OPENAEC_FEM_STA_DRIFT_TOE", "1");
    }
    let mut kind = cmd.spawn().expect("de MCP-server starten");
    let mut stdin = kind.stdin.take().expect("stdin");
    let mut reader = BufReader::new(kind.stdout.take().expect("stdout"));
    for bericht in [
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": { "name": "staalhal-mcp", "version": "0.0.0" }
            }
        }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": methode, "params": params }),
    ] {
        let mut regel = serde_json::to_string(&bericht).unwrap();
        regel.push('\n');
        stdin.write_all(regel.as_bytes()).await.unwrap();
        stdin.flush().await.unwrap();
    }
    let mut antwoord = Value::Null;
    for _ in 0..2 {
        let mut regel = String::new();
        let n = timeout(Duration::from_secs(300), reader.read_line(&mut regel))
            .await
            .expect("de server antwoordde niet binnen 300 s")
            .expect("read_line mislukte");
        assert!(n > 0, "EOF op stdout — de server stopte onverwacht");
        let bericht: Value = serde_json::from_str(regel.trim())
            .unwrap_or_else(|e| panic!("ongeldige JSON-RPC-regel {}: {e}", &regel[..regel.len().min(300)]));
        if bericht["id"] == 2 {
            assert!(bericht["error"].is_null(), "JSON-RPC-fout: {bericht}");
            antwoord = bericht["result"].clone();
        }
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(10), kind.wait()).await;
    antwoord
}

async fn hal(argumenten: Value) -> Value {
    let uit = verzoek("tools/call", json!({ "name": TOOL, "arguments": argumenten })).await;
    assert_eq!(uit["isError"], json!(false), "{}", uit["content"][0]["text"]);
    uit["structuredContent"].clone()
}

fn dichtbij(a: &Value, b: f64, label: &str, tol: f64) {
    let a = a.as_f64().unwrap_or_else(|| panic!("{label}: geen getal ({a})"));
    assert!((a - b).abs() <= tol, "{label}: verwacht {b}, berekend {a}");
}

fn geval<'a>(uit: &'a Value, id: i64) -> &'a Value {
    uit["berekening"]["gevallen"]
        .as_array()
        .expect("gevallen")
        .iter()
        .find(|g| g["id"] == id)
        .unwrap_or_else(|| panic!("geval {id} ontbreekt"))
}

/// Zonder parameters: de voorbeeldhal, knoop voor knoop gelijk aan het
/// projectbestand `docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem`.
#[tokio::test]
async fn standaardhal_is_het_voorbeeldmodel() {
    eis_node().await;
    let uit = hal(json!({})).await;
    assert_eq!(
        uit["samenvatting"]["aantallen"],
        json!({ "knopen": 165, "staven": 340, "opleggingen": 22, "palen": 0, "knoopbelastingen": 13, "staafbelastingen": 412 })
    );
    assert!(uit.get("berekening").is_none(), "zonder reken geen berekening");
    let project = &uit["project"];
    assert_eq!(project["modelDimension"], json!("3d"));
    assert_eq!(
        project["loadCases"].as_array().unwrap().iter().map(|c| c["id"].as_i64().unwrap()).collect::<Vec<_>>(),
        vec![5, 1, 2, 3, 4]
    );
    assert_eq!(project["structuralGrid"]["xAxes"].as_array().unwrap().len(), 11);
    let pad = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../docs/verificatie/3d-raamwerk/staalhal-60x30.ifcfem");
    let bestand: Value = serde_json::from_str(&std::fs::read_to_string(&pad).expect("projectbestand")).unwrap();
    assert_eq!(project["model3d"], bestand["model3d"], "het MCP-model is het voorbeeldmodel");
}

/// Elke standaardwaarde in het schema is de waarde die de generator invult.
#[tokio::test]
async fn standaardwaarden_van_het_schema_zijn_die_van_de_generator() {
    eis_node().await;
    let lijst = verzoek("tools/list", json!({})).await;
    let schema = lijst["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == TOOL)
        .expect("tool in tools/list")["inputSchema"]["properties"]["hal"]
        .clone();
    let parameters = hal(json!({})).await["parameters"].clone();

    fn vergelijk(pad: &str, schema: &Value, parameters: &Value, geteld: &mut usize) {
        for (sleutel, veld) in schema["properties"].as_object().unwrap() {
            let waar = format!("{pad}.{sleutel}");
            if veld.get("properties").is_some() {
                vergelijk(&waar, veld, &parameters[sleutel], geteld);
                continue;
            }
            let Some(standaard) = veld.get("default") else { continue };
            *geteld += 1;
            if sleutel == "spantafstandMm" {
                // De generator bewaart het AANTAL vakken: ⌈60000 / 6000⌉ = 10.
                assert_eq!(parameters["aantalVakken"], json!(10), "{waar}");
                continue;
            }
            let gegeven = &parameters[sleutel];
            match (standaard.as_f64(), gegeven.as_f64()) {
                (Some(a), Some(b)) => assert!((a - b).abs() < 1e-12, "{waar}: schema {a}, generator {b}"),
                _ => assert_eq!(gegeven, standaard, "{waar}"),
            }
        }
    }
    let mut geteld = 0;
    vergelijk("hal", &schema, &parameters, &mut geteld);
    assert!(geteld >= 35, "te weinig standaardwaarden vergeleken: {geteld}");
    assert_eq!(parameters["dak"]["type"], json!("zadeldak"));
    dichtbij(&parameters["dak"]["nokhoogteMm"], 9500.0, "nok bij helling 1:10", 1e-9);
}

/// De toetsanalyse van een hal: tweede orde geometrisch met φ = 1/200 (vast),
/// de resultaten lineair zonder scheefstand, 4 berekeningen per UGT-combinatie.
fn eis_toetsanalyse_van_de_hal(t: &Value, ugt: usize) {
    assert_eq!(t["analysis_type"], json!("tweedeOrdeGeometrisch"), "{t}");
    assert_eq!(t["model_analysis_type"], json!("linear"));
    assert_eq!(t["hergebruikt"], json!(false));
    assert_eq!(
        t["scheefstand"],
        // Issue #194: φ per richting (phi_x voor ±X, phi_y voor ±Y); met de vaste noemer gelijk.
        json!({ "phi": 0.005, "noemer": 200, "phi_x": 0.005, "phi_y": 0.005, "noemer_x": 200, "noemer_y": 200,
                "bron": "vast", "model_scheefstand_aan": false, "afgedwongen": true })
    );
    assert_eq!(t["richtingen"], json!(["+X", "−X", "+Y", "−Y"]));
    assert_eq!(t["aantal_berekeningen"], json!(4 * ugt));
    assert_eq!(t["alpha_cr"].as_array().map(Vec::len), Some(ugt), "α_cr één keer per UGT-basiscombinatie");
}

/// De handcontrole van de toetsberekeningen: per paar varianten
/// ΣR(+) − ΣR(−) = −2·φ·ΣR_z in de scheefstandas, gelijke ΣR_z, evenwicht.
fn eis_toets_reactiesommen(t: &Value) -> usize {
    let berekeningen = t["berekeningen"].as_array().expect("berekeningen");
    let van = |id: i64| berekeningen.iter().find(|b| b["id"] == id);
    let mut paren = 0;
    for b in berekeningen.iter().filter(|b| b["fout"].is_null()) {
        assert_eq!(b["evenwicht"]["kern"], json!(true), "{}", b["naam"]);
        assert_eq!(b["evenwicht"]["onafhankelijk"], json!(true), "{}", b["naam"]);
        let id = b["id"].as_i64().unwrap();
        if id % 2_000_000 >= 1_000_000 {
            continue; // de −X- en −Y-variant: tegenhanger van de + hieronder
        }
        let Some(min) = van(id + 1_000_000).filter(|m| m["fout"].is_null()) else { continue };
        let as_ = if id >= 2_000_000 { "fy" } else { "fx" };
        let fz = b["reactiesomKn"]["fz"].as_f64().unwrap();
        dichtbij(&min["reactiesomKn"]["fz"], fz, &format!("{} ΣRz", min["naam"]), 1e-6);
        let verschil = b["reactiesomKn"][as_].as_f64().unwrap() - min["reactiesomKn"][as_].as_f64().unwrap();
        assert!(
            (verschil + 2.0 * 0.005 * fz).abs() <= 1e-3,
            "{}: ΣR{as_}(+) − ΣR{as_}(−) = {verschil}, verwacht −2·φ·ΣR_z = {}",
            b["naam"],
            -2.0 * 0.005 * fz
        );
        paren += 1;
    }
    paren
}

/// Rekenen: ΣR per geval volgens de hand, evenwicht in de kern én in de
/// onafhankelijke krachtensom, verplaatsingen binnen L/250 en h/150. De toets
/// van de standaardhal wordt geweigerd: onder "Wind langs" knikken de
/// wandverbanden zelf (8 van de 28 toetsberekeningen). De resultaten blijven,
/// er is geen UC, en de suggestie is trek-alleen of zwaardere verbanden.
///
/// Tot issue #199 toetste deze tool met de eerste-orderesultaten en gaf hij
/// voor de standaardhal een UC per groep (uc_max 1,77, wandverband); die
/// toetsing rustte op krachten zonder scheefstand en zonder tweede orde.
#[tokio::test]
async fn standaardhal_gerekend_en_de_toets_geweigerd() {
    eis_node().await;
    let uit = hal(json!({ "reken": true })).await;
    let b = &uit["berekening"];
    assert_eq!(b["analyse"], json!("linear"));
    assert_eq!(b["gevolgklasse"], json!("CC2"));
    assert_eq!(b["aantal_berekeningen"], json!(19), "de resultaten: 5 gevallen en 14 combinaties");
    for (id, [fx, fy, fz]) in [(1, [0.0, 0.0, 540.0]), (2, [0.0, 0.0, 1008.0]), (3, [0.0, -499.2, -864.0]), (4, [-84.0, 0.0, 0.0])] {
        let g = geval(&uit, id);
        dichtbij(&g["reactiesomKn"]["fx"], fx, &format!("geval {id} ΣRx"), 1e-3);
        dichtbij(&g["reactiesomKn"]["fy"], fy, &format!("geval {id} ΣRy"), 1e-3);
        dichtbij(&g["reactiesomKn"]["fz"], fz, &format!("geval {id} ΣRz"), 1e-3);
    }
    dichtbij(&geval(&uit, 5)["reactiesomKn"]["fz"], 809.947, "eigen gewicht", 1e-2);
    for g in b["gevallen"].as_array().unwrap().iter().chain(b["combinaties"].as_array().unwrap()) {
        assert_eq!(g["evenwicht"]["kern"], json!(true), "{}", g["naam"]);
        assert_eq!(g["evenwicht"]["onafhankelijk"], json!(true), "{}", g["naam"]);
    }
    for g in b["gevallen"].as_array().unwrap() {
        assert!(g["maxVerplaatsingMm"].as_f64().unwrap() < 30000.0 / 250.0, "{}: u_max ≥ L/250", g["naam"]);
        assert!(g["maxGootverplaatsingMm"].as_f64().unwrap() < 8000.0 / 150.0, "{}: goot ≥ h/150", g["naam"]);
    }

    let ta = &b["toetsanalyse"];
    eis_toetsanalyse_van_de_hal(ta, 7);
    assert_eq!(ta["geweigerd"], json!(true));
    // De stabiele varianten rekenen gewoon, met de handcontrole op φ.
    assert!(eis_toets_reactiesommen(ta) >= 10, "te weinig paren nagerekend");
    let t = &b["toetsing"];
    assert_eq!(t["geweigerd"], json!(true), "{t}");
    assert!(t["uc_max"].is_null(), "geen UC bij een geweigerde toets");
    assert!(b.get("hout_toetsing").is_none(), "ook geen houttoetsing");
    let reden = t["reden"].as_str().unwrap();
    assert!(reden.contains("faalt in 8 van de 28 toetsberekeningen") && reden.contains("niet teruggevallen op eerste orde"), "{reden}");
    let per: Vec<i64> = t["per_combinatie"].as_array().unwrap().iter().map(|c| c["combination_id"].as_i64().unwrap()).collect();
    let mut verwacht: Vec<i64> = [4, 7].iter().flat_map(|id| (0..4).map(move |k| id + k * 1_000_000)).collect();
    verwacht.sort_unstable();
    let mut gekregen = per.clone();
    gekregen.sort_unstable();
    assert_eq!(gekregen, verwacht, "de varianten van \"Wind langs (W) leidend\"");
    for c in t["per_combinatie"].as_array().unwrap() {
        let r = c["reason"].as_str().unwrap();
        assert!(r.contains("alpha_cr=0.") && r.contains("eigen knikkracht") && r.contains("CHS 88.9x4"), "{r}");
    }
    let suggestie = t["suggestie"].as_str().unwrap();
    assert!(
        suggestie.contains("wandverband") && suggestie.contains("trek-alleen") && suggestie.contains("zwaardere verbanden"),
        "{suggestie}"
    );
    for a in ta["alpha_cr"].as_array().unwrap() {
        let id = a["combination_id"].as_i64().unwrap();
        if id == 4 || id == 7 {
            assert_eq!(a["status"], json!("niet_bepaald"), "{a}");
        } else {
            assert!(a["alpha_cr"].as_f64().is_some_and(|x| x > 1.0), "{a}");
        }
    }
}

/// Met trek-alleen verbanden is elke toetsberekening stabiel: de toets rekent
/// P-Δ met φ = 1/200 in vier richtingen (ΣR volgens de hand), en de staaltoets
/// geeft een UC per groep, met de toetsvarianten als UGT-combinaties.
#[tokio::test]
async fn hal_met_trek_alleen_verbanden_getoetst_met_tweede_orde_en_scheefstand() {
    eis_node().await;
    let uit = hal(json!({ "hal": { "verbanden": { "trekAlleen": true } }, "reken": true })).await;
    let b = &uit["berekening"];
    let ta = &b["toetsanalyse"];
    eis_toetsanalyse_van_de_hal(ta, 7);
    assert_eq!(ta["geweigerd"], json!(false));
    assert_eq!(eis_toets_reactiesommen(ta), 14, "7 combinaties × 2 assen");
    for a in ta["alpha_cr"].as_array().unwrap() {
        assert_eq!(a["status"], json!("bepaald"), "{a}");
        assert!(a["alpha_cr"].as_f64().is_some_and(|x| x > 1.0), "{a}");
    }
    let t = &b["toetsing"];
    let uc = t["uc_max"].as_f64().expect("uc_max");
    assert!(uc.is_finite() && uc > 0.0, "uc_max {uc}");
    for (groep, aantal) in [("kolom", 22), ("spantligger", 132), ("gording", 110), ("randligger", 20), ("dakverband", 48), ("wandverband", 8)] {
        let g = &t["per_groep"][groep];
        assert_eq!(g["aantal"], json!(aantal), "{groep}");
        assert!(g["uc_max"].as_f64().is_some_and(|x| x.is_finite() && x > 0.0), "{groep}: {g}");
    }
    let getoetst: u64 = t["status_telling"].as_object().unwrap().values().map(|v| v.as_u64().unwrap()).sum();
    assert_eq!(getoetst, 340);
    assert_eq!(t["niet_getoetst"], json!([]));
    assert!(
        t["notities"].as_array().unwrap().iter().any(|n| n.as_str().unwrap().contains("tweede orde (P-Δ) met scheefstand φ = 1/200")),
        "{}",
        t["notities"]
    );
    eprintln!("staalhal (trek-alleen verbanden, toets P-Δ): uc_max {uc:.3} ({})", t["maatgevend"]);
}

#[tokio::test]
async fn houten_hal_gerekend_en_volgens_en_1995_getoetst() {
    eis_node().await;
    let uit = hal(json!({
        "hal": {
            "lengteMm": 12000, "breedteMm": 8000, "aantalVakken": 2,
            "dak": { "type": "platdak" }, "gordingafstandMm": 2000,
            "profielen": {
                "kolom": { "materiaal": "GL28h", "profiel": "200x400" },
                "spantligger": { "materiaal": "GL28h", "profiel": "160x400" },
                "gording": { "materiaal": "C24", "profiel": "80x200" },
                "randligger": { "materiaal": "C24", "profiel": "100x200" },
                "verband": { "materiaal": "C24", "profiel": "100x100" }
            }
        }, "reken": true
    })).await;
    dichtbij(&uit["samenvatting"]["eigenGewichtKn"]["staal"], 0.0, "geen staal in houten hal", 1e-9);
    assert!(uit["samenvatting"]["eigenGewichtKn"]["hout"].as_f64().is_some_and(|v| v > 0.0));
    dichtbij(&geval(&uit, 1)["reactiesomKn"]["fz"], 28.8, "G op houten hal", 1e-3);
    assert!(uit["berekening"]["toetsing"]["uc_max"].is_null());
    // De toets: P-Δ met φ = 1/200. Hout: φ volgens NEN-EN 1995-1-1 (5.1) bij
    // h = 8 m is 0,005·√(5/8) = 0,00395 < 1/200, dus de vaste noemer blijft;
    // de toets meldt dat hij met E_mean rekent en 2·L houdt (B10).
    let ta = &uit["berekening"]["toetsanalyse"];
    eis_toetsanalyse_van_de_hal(ta, 7);
    assert_eq!(eis_toets_reactiesommen(ta), 14);
    assert!(ta["meldingen"].as_array().unwrap().iter().any(|m| m.as_str().unwrap().contains("E_mean")), "{}", ta["meldingen"]);
    let hout = &uit["berekening"]["hout_toetsing"];
    assert_eq!(hout["norm"], json!("NEN-EN 1995-1-1"));
    assert!(hout["uc_max"].as_f64().is_some_and(|v| v.is_finite() && v > 0.0));
    assert_eq!(hout["niet_getoetst"], json!([]));
    let aantal: u64 = hout["status_telling"].as_object().unwrap().values().map(|v| v.as_u64().unwrap()).sum();
    assert_eq!(aantal, uit["samenvatting"]["aantallen"]["staven"].as_u64().unwrap());
}

/// Op het balkrooster dragen alleen de palen af: Σ paalreacties = Σ lasten,
/// en onder eigen gewicht staal + beton.
#[tokio::test]
async fn balkrooster_draagt_af_op_de_palen() {
    eis_node().await;
    let uit = hal(json!({ "hal": { "fundering": { "type": "balkrooster" } }, "reken": true, "toetsen": false })).await;
    assert_eq!(uit["samenvatting"]["aantallen"]["palen"], json!(66));
    assert!(uit["berekening"].get("toetsing").is_none(), "toetsen: false");
    assert!(uit["berekening"].get("toetsanalyse").is_none(), "toetsen: false: geen toetsberekeningen");
    for (id, fz) in [(1, 540.0), (2, 1008.0), (3, -864.0)] {
        let g = geval(&uit, id);
        assert_eq!(g["paalreacties"]["aantal"], json!(66));
        dichtbij(&g["paalreacties"]["somFzKn"], fz, &format!("geval {id} Σ paalreacties"), 1e-3);
    }
    let beton = 5.886 * (2.0 * 60.0 + 11.0 * 30.0 + 22.0 * 0.8);
    dichtbij(&geval(&uit, 5)["paalreacties"]["somFzKn"], 809.947 + beton, "eigen gewicht op de palen", 1e-2);
}

/// Een fout in de halparameters komt terug als toolfout met de code en het
/// veld van ELK probleem uit de invoerpoort van de generator.
#[tokio::test]
async fn fout_in_de_hal_komt_terug_met_code_en_veld() {
    eis_node().await;
    let uit = verzoek(
        "tools/call",
        json!({ "name": TOOL, "arguments": { "hal": {
            "profielen": { "kolom": { "profile": "HEA 400" } },
            "kolomvoet": "scharnierend", "verbanden": { "wanden": false }
        } } }),
    )
    .await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let s = &uit["structuredContent"];
    assert_eq!(s["error_code"], json!("INVOER_ONGELDIG"), "{s}");
    let problemen = s["detail"]["problemen"].as_array().expect("problemen");
    let velden: Vec<&str> = problemen.iter().map(|p| p["veld"].as_str().unwrap()).collect();
    assert_eq!(velden, vec!["profielen.kolom.profile"], "de poort weigert eerst het onbekende veld: {problemen:?}");
    let stabiliteit = hal_fout(json!({ "kolomvoet": "scharnierend", "verbanden": { "wanden": false } })).await;
    assert_eq!(stabiliteit["detail"]["problemen"][0]["code"], json!("instabielLangs"));
}

async fn hal_fout(hal: Value) -> Value {
    let uit = verzoek("tools/call", json!({ "name": TOOL, "arguments": { "hal": hal } })).await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    uit["structuredContent"].clone()
}

// ── Een oude bundel: TOETSING_ONMOGELIJK ─────────────────────────────────────

/// Een nagemaakte bundel van vóór de toets van issue #199: hij praat het
/// protocol en antwoordt op `staalhal_maken` met rekenverzoeken, maar zonder
/// `toetsanalyse` en `toetsverzoeken` — zoals een bundel die de toets nog op
/// de resultaten deed.
fn schrijf_oude_bundel(map: &Path) -> PathBuf {
    let pad = map.join("oude-bundel.mjs");
    let script = r#"let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (brok) => {
  buffer += brok;
  let grens;
  while ((grens = buffer.indexOf("\n")) >= 0) {
    const regel = buffer.slice(0, grens);
    buffer = buffer.slice(grens + 1);
    if (!regel.trim()) continue;
    const v = JSON.parse(regel);
    const result = v.op === "handshake"
      ? { protocol: 1, node_version: "v0.0.0", bundle_version: "0.0.0-oud", bundle_hash: null }
      : { parameters: {}, project: {}, samenvatting: { groepen: {} }, waarschuwingen: [],
          reken: { analyse: "linear", gevolgklasse: "CC2" }, combinaties: [], rekenverzoeken: [] };
    process.stdout.write(JSON.stringify({ v: 1, id: v.id, ok: true, result }) + "\n");
  }
});
process.stdin.resume();
"#;
    std::fs::write(&pad, script).expect("oude bundel schrijven");
    pad
}

#[tokio::test]
async fn een_bundel_zonder_toetsanalyse_geeft_toetsing_onmogelijk() {
    eis_node().await;
    let map = std::env::temp_dir().join(format!("openaec-staalhal-oude-bundel-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&map);
    std::fs::create_dir_all(&map).expect("tijdelijke map");
    let bundel = schrijf_oude_bundel(&map);
    let uit = verzoek_met(
        "tools/call",
        json!({ "name": TOOL, "arguments": { "reken": true } }),
        &[("OPENAEC_FEM_KERNEL", bundel.as_path())],
    )
    .await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let s = &uit["structuredContent"];
    assert_eq!(s["error_code"], json!("TOETSING_ONMOGELIJK"), "{s}");
    let melding = s["melding"].as_str().unwrap_or("");
    assert!(melding.contains("`toetsanalyse.analysis_type` = ontbreekt") && melding.contains("Er is niet getoetst"), "{melding}");
    // Zonder toets bewaakt de server niets: dan komt de nagemaakte bundel door
    // (een echte oude bundel weigert het onbekende veld `toetsen` zelf).
    let zonder = verzoek_met(
        "tools/call",
        json!({ "name": TOOL, "arguments": { "reken": true, "toetsen": false } }),
        &[("OPENAEC_FEM_KERNEL", bundel.as_path())],
    )
    .await;
    assert_eq!(zonder["isError"], json!(false), "{zonder}");
    let _ = std::fs::remove_dir_all(&map);
}
