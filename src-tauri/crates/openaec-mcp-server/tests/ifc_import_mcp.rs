//! De MCP-tool `open_fem_3d_ifc_importeren` end-to-end over de echte binary:
//! bestand lezen → import (sidecar) → 3D-kern → uitwerking (sidecar) →
//! staaltoets.
//!
//! De testbestanden zijn synthetisch:
//! `docs/verificatie/ifc-analyse/genereer-ifc-analyse.mjs`. De verwachte
//! reacties van de luifel zijn handwerk (zie test-ifc-analyse-import.mjs):
//!   G  2,0 kN/m per geprojecteerde lengte over 3 m          = 6 kN
//!   S  0,8 kN/m per ware lengte over √9,25 m               = 2,4331 kN
//!   Q  5 kN op de tip + 3 kN midden op de ligger           = 8 kN
//!   W  0,5 kN/m lokaal op de kolom van 3 m                  = 1,5 kN in +X
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
const TOOL: &str = "open_fem_3d_ifc_importeren";

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

fn fixture(naam: &str) -> String {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../docs/verificatie/ifc-analyse")
        .join(naam)
        .to_string_lossy()
        .into_owned()
}

/// Eén `tools/call` op een verse server (na `initialize`); geeft `result`.
async fn roep(argumenten: Value) -> Value {
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
                "clientInfo": { "name": "ifc-import-mcp", "version": "0.0.0" }
            }
        }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": TOOL, "arguments": argumenten } }),
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

async fn importeer(argumenten: Value) -> Value {
    let uit = roep(argumenten).await;
    assert_eq!(uit["isError"], json!(false), "{}", uit["content"][0]["text"]);
    uit["structuredContent"].clone()
}

fn dichtbij(a: &Value, b: f64, label: &str, tol: f64) {
    let a = a.as_f64().unwrap_or_else(|| panic!("{label}: geen getal ({a})"));
    assert!((a - b).abs() <= tol, "{label}: verwacht {b}, berekend {a}");
}

/// Twee analysemodellen en geen keuze: een fout met de lijst, zodat de client
/// kan kiezen in plaats van te raden.
#[tokio::test]
async fn zonder_keuze_komt_de_lijst_met_analysemodellen_terug() {
    eis_node().await;
    let uit = roep(json!({ "pad": fixture("ifc-analyse-m-n.ifc") })).await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let s = &uit["structuredContent"];
    assert_eq!(s["error_code"], json!("INVOER_ONGELDIG"), "{s}");
    let namen: Vec<&str> = s["detail"]["modellen"].as_array().expect("modellen").iter()
        .map(|m| m["naam"].as_str().unwrap()).collect();
    assert_eq!(namen, vec!["Hal", "Luifel"]);
}

/// De luifel: ingelezen, doorgerekend door de 3D-kern en getoetst; ΣR per
/// geval volgens de hand en evenwicht in elk geval en elke combinatie.
#[tokio::test]
async fn luifel_ingelezen_gerekend_en_getoetst() {
    eis_node().await;
    let uit = importeer(json!({ "pad": fixture("ifc-analyse-m-n.ifc"), "analysemodel": "Luifel", "reken": true })).await;
    assert_eq!(uit["analysemodel"], json!({ "nummer": 2, "naam": "Luifel" }));
    assert_eq!(uit["project"]["modelDimension"], json!("3d"));
    assert_eq!(uit["verslag"]["aantallen"]["staven"], json!(2));
    let b = &uit["berekening"];
    assert_eq!(b["uitgevoerd"], json!(true), "{b}");
    assert_eq!(b["combinatiebron"], json!("bestand"));
    assert_eq!(b["aantal_berekeningen"], json!(6));
    let gevallen = b["gevallen"].as_array().expect("gevallen");
    let geval = |id: i64| gevallen.iter().find(|g| g["id"] == id).unwrap_or_else(|| panic!("geval {id}"));
    for (id, [fx, fz]) in [(1, [0.0, 6.0]), (2, [0.0, 0.8 * 9.25f64.sqrt()]), (3, [0.0, 8.0]), (4, [-1.5, 0.0])] {
        dichtbij(&geval(id)["reactiesomKn"]["fx"], fx, &format!("geval {id} ΣRx"), 1e-6);
        dichtbij(&geval(id)["reactiesomKn"]["fz"], fz, &format!("geval {id} ΣRz"), 1e-6);
    }
    for g in gevallen.iter().chain(b["combinaties"].as_array().unwrap()) {
        assert_eq!(g["evenwicht"]["kern"], json!(true), "{}", g["naam"]);
        assert_eq!(g["evenwicht"]["onafhankelijk"], json!(true), "{}", g["naam"]);
    }
    let t = &b["toetsing"];
    for groep in ["Kolom", "Luifelligger"] {
        assert!(t["per_groep"][groep]["uc_max"].as_f64().is_some_and(|x| x.is_finite() && x > 0.0), "{groep}: {t}");
    }
    let getoetst: u64 = t["status_telling"].as_object().unwrap().values().map(|v| v.as_u64().unwrap()).sum();
    assert_eq!(getoetst, 2);
}

/// De hal heeft trek-alleen staven en schijven. Kan de kern die (nog) niet
/// rekenen, dan komt het model terug met de reden; er wordt niets weggelaten.
#[tokio::test]
async fn hal_komt_terug_met_verslag_en_eerlijke_rekenstatus() {
    eis_node().await;
    let uit = importeer(json!({ "pad": fixture("ifc-analyse-m-n.ifc"), "analysemodel": 1, "reken": true, "toetsen": false })).await;
    let v = &uit["verslag"];
    assert_eq!(v["model"], json!("Hal"));
    assert_eq!(v["trekAlleen"], json!(3));
    assert_eq!(v["aantallen"]["schijven"], json!(2));
    assert_eq!(v["aantallen"]["imperfectieGevallen"], json!(1));
    assert_eq!(uit["project"]["scheefstandEnabled"], json!(false));
    let b = &uit["berekening"];
    if b["uitgevoerd"] == json!(false) {
        assert!(b["reden"].as_str().is_some_and(|r| !r.is_empty()), "zonder reden: {b}");
    } else {
        for g in b["gevallen"].as_array().unwrap() {
            assert_eq!(g["evenwicht"]["kern"], json!(true), "{}", g["naam"]);
        }
    }
}

/// Hetzelfde bestand in mm en kN levert precies hetzelfde model op.
#[tokio::test]
async fn millimeters_en_kilonewton_geven_hetzelfde_model() {
    eis_node().await;
    let a = importeer(json!({ "pad": fixture("ifc-analyse-m-n.ifc"), "analysemodel": "Hal" })).await;
    let b = importeer(json!({ "pad": fixture("ifc-analyse-mm-kn.ifc"), "analysemodel": "Hal" })).await;
    assert_eq!(a["project"]["model3d"], b["project"]["model3d"]);
    assert_eq!(a["project"]["combinations"], b["project"]["combinations"]);
    assert!(b["verslag"]["toelichting"][0].as_str().unwrap().contains("lengte mm, kracht kN"));
}

/// Een pad dat niet bestaat: BESTAND_ONLEESBAAR, met het pad in de melding.
#[tokio::test]
async fn een_ontbrekend_bestand_wordt_gemeld() {
    let uit = roep(json!({ "pad": fixture("bestaat-niet.ifc") })).await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    assert_eq!(uit["structuredContent"]["error_code"], json!("BESTAND_ONLEESBAAR"));
    assert!(uit["content"][0]["text"].as_str().unwrap().contains("bestaat-niet.ifc"));
}
