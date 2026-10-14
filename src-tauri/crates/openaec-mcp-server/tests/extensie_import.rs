//! De lokale extensie importeert via de echte MCP-binary en Node-sidecar.
use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Value};
use std::{path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::timeout,
};

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

async fn roep(naam: &str, argumenten: Value, extensiemap: &PathBuf) -> Value {
    let mut kind = Command::new(BIN_PATH)
        .env("OPENAEC_EXTENSIONS_DIRS", extensiemap)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("MCP-server starten");
    let mut invoer = kind.stdin.take().unwrap();
    let mut uitvoer = BufReader::new(kind.stdout.take().unwrap());
    for bericht in [
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "protocolVersion":"2025-06-18","capabilities":{},
            "clientInfo":{"name":"extensie-test","version":"0"}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
            "name":naam,"arguments":argumenten}}),
    ] {
        invoer
            .write_all(format!("{bericht}\n").as_bytes())
            .await
            .unwrap();
    }
    drop(invoer);
    let mut antwoord = Value::Null;
    for _ in 0..2 {
        let mut regel = String::new();
        let gelezen = timeout(Duration::from_secs(90), uitvoer.read_line(&mut regel))
            .await
            .expect("MCP antwoord binnen 90 s")
            .expect("antwoord lezen");
        assert!(gelezen > 0, "MCP-server stopte voor het antwoord");
        let waarde: Value = serde_json::from_str(&regel).expect("geldige JSON-RPC");
        if waarde["id"] == 2 {
            antwoord = waarde["result"].clone();
        }
    }
    let _ = timeout(Duration::from_secs(5), kind.wait()).await;
    antwoord
}

#[tokio::test]
async fn importeert_en_weigert_onbekend_type() {
    let status = sidecar::status(&SidecarOpties::default()).await;
    assert!(status.available, "Node ontbreekt: {:?}", status.reason);
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../design-mockup/test-fixtures/extensie-voorbeeld");
    let doelmap = std::env::temp_dir().join(format!("ofs-extensie-mcp-{}", std::process::id()));
    std::fs::create_dir_all(&doelmap).unwrap();
    let doel = doelmap.join("import.ifcfem");
    let antwoord = roep(
        "project_import",
        json!({
            "path": fixture.join("voorbeeld.demofem"), "save_as": doel,
        }),
        &fixture,
    )
    .await;
    assert_ne!(antwoord["isError"], true, "{antwoord}");
    assert_eq!(
        antwoord["structuredContent"]["extension"]["id"],
        "org.openaec.voorbeeld"
    );
    let project: Value = serde_json::from_str(&std::fs::read_to_string(&doel).unwrap()).unwrap();
    assert_eq!(project["nodes"].as_array().unwrap().len(), 4);
    assert_eq!(project["beams"].as_array().unwrap().len(), 3);

    let onbekend = roep(
        "project_import",
        json!({
            "path": doelmap.join("onbekend.txt"), "save_as": doel,
        }),
        &fixture,
    )
    .await;
    assert_eq!(onbekend["isError"], true, "{onbekend}");
    assert_eq!(onbekend["structuredContent"]["error_code"], "NIET_GEVONDEN");
    let nog_steeds: Value = serde_json::from_str(&std::fs::read_to_string(&doel).unwrap()).unwrap();
    assert_eq!(
        nog_steeds, project,
        "een geweigerde import overschrijft het project niet"
    );
    std::fs::remove_dir_all(doelmap).unwrap();
}
