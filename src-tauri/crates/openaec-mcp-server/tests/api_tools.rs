//! De API-commando's van de app als MCP-tools, end-to-end over de echte binary:
//! zonder app op een projectbestand (Rust leest en schrijft, de sidecar voert
//! het commando uit), met de foutcodes van het register.
//!
//! LET OP: dit meet de INGEBAKKEN solverbundel en catalogus. Na een wijziging
//! in `design-mockup/src` eerst `npm run build:sidecar`. Node ≥ 20 is een harde eis.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

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

/// Eén `tools/call` op een verse server (na `initialize`); geeft `result`.
async fn roep(tool: &str, arguments: Value) -> Value {
    let mut kind = Command::new(BIN_PATH)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("de MCP-server starten");
    let mut stdin = kind.stdin.take().expect("stdin");
    let mut reader = BufReader::new(kind.stdout.take().expect("stdout"));
    for bericht in [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": { "name": "api-tools", "version": "0.0.0" } } }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": tool, "arguments": arguments } }),
    ] {
        let mut regel = serde_json::to_string(&bericht).unwrap();
        regel.push('\n');
        stdin.write_all(regel.as_bytes()).await.unwrap();
        stdin.flush().await.unwrap();
    }
    let mut antwoord = Value::Null;
    for _ in 0..2 {
        let mut regel = String::new();
        let n = timeout(Duration::from_secs(120), reader.read_line(&mut regel))
            .await
            .expect("de server antwoordde niet binnen 120 s")
            .expect("read_line mislukte");
        assert!(n > 0, "EOF op stdout — de server stopte onverwacht");
        let bericht: Value = serde_json::from_str(regel.trim()).expect("geldige JSON-RPC");
        if bericht["id"] == 2 {
            assert!(bericht["error"].is_null(), "JSON-RPC-fout: {bericht}");
            antwoord = bericht["result"].clone();
        }
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(10), kind.wait()).await;
    antwoord
}

fn uitkomst(result: &Value) -> Value {
    assert_ne!(result["isError"], true, "toolfout: {result}");
    result["structuredContent"].clone()
}

fn foutcode(result: &Value) -> String {
    assert_eq!(result["isError"], true, "geen toolfout: {result}");
    result["structuredContent"]["error_code"].as_str().unwrap_or_default().to_owned()
}

fn tijdelijke_map(naam: &str) -> PathBuf {
    let map = std::env::temp_dir().join(format!("api-tools-{naam}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&map);
    std::fs::create_dir_all(&map).unwrap();
    map
}

fn lees_project(pad: &PathBuf) -> Value {
    serde_json::from_str(&std::fs::read_to_string(pad).expect("projectbestand")).expect("projectbestand is JSON")
}

#[tokio::test]
async fn commandos_op_een_projectbestand_zonder_app() {
    eis_node().await;
    let map = tijdelijke_map("keten");
    let pad = map.join("portaal.ifcfem");
    let p = pad.to_str().unwrap();

    // project.new maakt het bestand; het hoeft nog niet te bestaan.
    let nieuw = uitkomst(&roep("project_new", json!({ "project": p })).await);
    assert_eq!(nieuw["saved"], true);
    assert_eq!(lees_project(&pad)["modelDimension"], "3d");

    for (x, z) in [(0.0, 0.0), (6.0, 0.0), (0.0, 4.0), (6.0, 4.0)] {
        let knoop = uitkomst(&roep("model3d_node_add", json!({ "project": p, "x": x, "y": 0.0, "z": z })).await);
        assert_eq!(knoop["saved"], true);
    }
    let staaf = uitkomst(&roep("model3d_beam_add", json!({ "project": p, "startNodeId": 3, "endNodeId": 4, "profileName": "HEA 200" })).await);
    assert_eq!(staaf["output"]["beam"]["id"], 1);
    let model = &lees_project(&pad)["model3d"];
    assert_eq!(model["nodes"].as_array().unwrap().len(), 4);
    assert_eq!(model["beams"][0]["profileName"], "HEA 200");

    // save: false — de uitkomst wel, het bestand niet.
    let voor = std::fs::read_to_string(&pad).unwrap();
    let proef = uitkomst(&roep("model3d_node_add", json!({ "project": p, "x": 3.0, "y": 0.0, "z": 4.0, "save": false })).await);
    assert_eq!(proef["saved"], false);
    assert_eq!(proef["output"]["node"]["id"], 5);
    assert_eq!(std::fs::read_to_string(&pad).unwrap(), voor, "het bestand bleef gelijk");

    // Een lezend commando schrijft niets.
    let gelezen = uitkomst(&roep("model3d_get", json!({ "project": p })).await);
    assert_eq!(gelezen["saved"], false);
    assert_eq!(gelezen["output"]["counts"]["beams"], 1);

    let _ = std::fs::remove_dir_all(&map);
}

#[tokio::test]
async fn foutcodes_van_het_register_en_van_het_bestand() {
    eis_node().await;
    let map = tijdelijke_map("fouten");
    let pad = map.join("leeg.ifcfem");
    let p = pad.to_str().unwrap();
    uitkomst(&roep("project_new", json!({ "project": p })).await);

    assert_eq!(foutcode(&roep("model3d_node_delete", json!({ "project": p, "id": 9 })).await), "NIET_GEVONDEN");
    assert_eq!(foutcode(&roep("model3d_node_add", json!({ "project": p, "x": 0.0, "y": 0.0 })).await), "INVOER_ONGELDIG");
    let ontbreekt = map.join("bestaat-niet.ifcfem");
    assert_eq!(
        foutcode(&roep("model3d_get", json!({ "project": ontbreekt.to_str().unwrap() })).await),
        "BESTAND_ONLEESBAAR"
    );
    assert_eq!(foutcode(&roep("model3d_get", json!({ "project": map.join("x.txt").to_str().unwrap() })).await), "ARGUMENT_ONGELDIG");
    assert_eq!(foutcode(&roep("app_undo", json!({ "project": p })).await), "ARGUMENT_ONGELDIG");

    let _ = std::fs::remove_dir_all(&map);
}
