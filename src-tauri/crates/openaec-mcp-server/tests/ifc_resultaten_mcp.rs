//! De MCP-tools `fem_resultaten_ifc_schrijven` en `fem_resultaten_ifc_lezen`
//! (issue #87) end-to-end over de echte binary: projectbestand lezen →
//! rekenen en IFC bouwen (sidecar) → bestand schrijven → teruglezen (sidecar).
//!
//! Handberekening: ligger op twee steunpunten, L = 6 m, q = 5 kN/m (geval G)
//! → R = qL/2 = 15 kN per steunpunt; q = 3 kN/m (geval Q) → 9 kN.
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
async fn roep(tool: &str, argumenten: Value) -> Value {
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
                "clientInfo": { "name": "ifc-resultaten-mcp", "version": "0.0.0" }
            }
        }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": tool, "arguments": argumenten } }),
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

fn projectbestand(map: &std::path::Path) -> String {
    let bestand = json!({
        "format": "open-fem-studio-v2",
        "version": 2,
        "savedAt": "2026-10-28T00:00:00Z",
        "nodes": [{ "id": 1, "x": 0, "z": 0 }, { "id": 2, "x": 6000, "z": 0 }],
        "beams": [{ "id": 1, "from": 1, "to": 2, "material": "S235", "profile": "IPE 300" }],
        "supports": [{ "nodeId": 1, "type": "pinned" }, { "nodeId": 2, "type": "zRoller" }],
        "plates": [],
        "loads": [
            { "id": 1, "type": "lineLoad", "caseId": 1, "beamId": 1, "q": -5 },
            { "id": 2, "type": "lineLoad", "caseId": 2, "beamId": 1, "q": -3 }
        ],
        "loadCases": [{ "id": 1, "name": "G", "type": "dead" }, { "id": 2, "name": "Q", "type": "live", "categorie": "A" }],
        "activeLoadCaseId": 1,
        "selfWeightEnabled": false,
        "analysetype": "eersteOrde",
    });
    let pad = map.join("ligger.ifcfem");
    std::fs::write(&pad, serde_json::to_string(&bestand).unwrap()).expect("proefbestand schrijven");
    pad.to_string_lossy().into_owned()
}

#[tokio::test]
async fn schrijven_en_teruglezen_volgens_de_hand() {
    eis_node().await;
    let map = std::env::temp_dir().join(format!("ifcfemresults-mcp-{}", std::process::id()));
    std::fs::create_dir_all(&map).unwrap();
    let project = projectbestand(&map);
    let uitvoer = map.join("ligger.ifcfemresults").to_string_lossy().into_owned();
    let _ = std::fs::remove_file(&uitvoer);

    let uit = roep("fem_resultaten_ifc_schrijven", json!({ "project": project, "uitvoerpad": uitvoer })).await;
    assert_eq!(uit["isError"], json!(false), "{}", uit["content"][0]["text"]);
    let s = &uit["structuredContent"];
    assert_eq!(s["geschreven"], json!(true), "{s}");
    assert_eq!(s["project_ingebed"], json!(true), "{s}");
    assert_eq!(s["gevallen"], json!([1, 2]), "{s}");
    let tekst = std::fs::read_to_string(&uitvoer).expect("het bestand staat op schijf");
    assert!(tekst.starts_with("ISO-10303-21;"));
    assert!(tekst.contains("FILE_SCHEMA(('IFC4'));"));
    assert!(tekst.contains("=IFCSTRUCTURALRESULTGROUP("), "geen resultaatgroep");
    assert!(tekst.contains("=IFCSTRUCTURALPOINTREACTION("), "geen knoopreactie");
    assert!(tekst.contains("=IFCSTRUCTURALCURVEREACTION("), "geen staafreactie");

    // Een tweede keer zonder `overschrijven` wordt geweigerd, vóór er gerekend wordt.
    let nogmaals = roep("fem_resultaten_ifc_schrijven", json!({ "project": project, "uitvoerpad": uitvoer })).await;
    assert_eq!(nogmaals["isError"], json!(true), "{nogmaals}");

    let gelezen = roep("fem_resultaten_ifc_lezen", json!({ "pad": uitvoer })).await;
    assert_eq!(gelezen["isError"], json!(false), "{}", gelezen["content"][0]["text"]);
    let g = &gelezen["structuredContent"];
    assert_eq!(g["project_ingebed"], json!(true));
    for (geval, r) in [("1", 15.0), ("2", 9.0)] {
        for knoop in ["1", "2"] {
            let fz = g["tweeD"]["per_case"][geval]["reactions"][knoop]["fz_kN"].as_f64()
                .unwrap_or_else(|| panic!("geval {geval} knoop {knoop}: {g}"));
            assert!((fz - r).abs() < 1e-9, "geval {geval} knoop {knoop}: R = {fz} kN, hand {r} kN");
        }
    }
    let _ = std::fs::remove_dir_all(&map);
}
