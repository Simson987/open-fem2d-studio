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
//! LET OP: dit meet de INGEBAKKEN solverbundel. Na een wijziging in
//! `design-mockup/src` eerst `npm run build:sidecar`. Node ≥ 20 is een harde eis.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Value};
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
    let mut kind = Command::new(BIN_PATH)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("de MCP-server starten");
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

/// Rekenen en toetsen: ΣR per geval volgens de hand, evenwicht in de kern én
/// in de onafhankelijke krachtensom, verplaatsingen binnen L/250 en h/150, en
/// een UC per groep uit de staaltoets.
#[tokio::test]
async fn standaardhal_gerekend_en_getoetst() {
    eis_node().await;
    let uit = hal(json!({ "reken": true })).await;
    let b = &uit["berekening"];
    assert_eq!(b["analyse"], json!("linear"));
    assert_eq!(b["gevolgklasse"], json!("CC2"));
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
    eprintln!("staalhal: uc_max {uc:.3} ({})", t["maatgevend"]);
}

/// Op het balkrooster dragen alleen de palen af: Σ paalreacties = Σ lasten,
/// en onder eigen gewicht staal + beton.
#[tokio::test]
async fn balkrooster_draagt_af_op_de_palen() {
    eis_node().await;
    let uit = hal(json!({ "hal": { "fundering": { "type": "balkrooster" } }, "reken": true, "toetsen": false })).await;
    assert_eq!(uit["samenvatting"]["aantallen"]["palen"], json!(66));
    assert!(uit["berekening"].get("toetsing").is_none(), "toetsen: false");
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
