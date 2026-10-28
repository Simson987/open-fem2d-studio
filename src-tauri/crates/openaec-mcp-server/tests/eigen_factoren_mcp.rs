//! Eigen factoren, bewust gekozen (issue #196) langs de MCP-weg — end-to-end
//! over de echte binary en de ingebakken solverbundel.
//!
//! WAAROM ALS INTEGRATIETEST. De bevestiging (`combinations[].bevestigdeFactoren`)
//! en de melding met de schaal K_FI op NB tabel NB.4 zitten in de solverbundel
//! (`design-mockup/src/lib/combinatieBeheer.ts`). De bron- en bundeltests
//! (`test-eigen-factoren.mjs`) bewijzen die regels; deze test bewijst dat een
//! projectbestand met de bevestiging via `project_path` door de server, de
//! sidecarpoort en het antwoordformaat komt:
//!  - het referentieproject P01 (1,22 / 1,08 voor G en 1,35 / 0,54 voor Q, dus
//!    K_FI = 0,9 maal NB.4) geeft bij `validate_fem_model` ok:false, met de
//!    schaal in de fout en zonder de herkomst "vóór september 2026" — er is geen
//!    spoor van een oud bestand;
//!  - hetzelfde bestand met de bevestiging geeft ok:true, met de bevestigde
//!    factoren als vermelding in `warnings`;
//!  - `load_fem_project` geeft de bevestiging mee in de combinaties, en
//!    `solve_fem_model` met precies die combinaties geeft geen FOUT en dezelfde
//!    uitkomst als zonder bevestiging (de bevestiging is geen rekenwaarde).
//!
//! LET OP: dit hangt af van de ingebakken solverbundel. Na een wijziging in
//! `design-mockup/src` eerst `npm run build:sidecar`, anders meet deze test de
//! oude bundel. Node ≥ 20 is een harde eis.

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

/// Eén tool-aanroep op een verse server (na `initialize`); geeft `result`.
async fn tool(naam: &str, argumenten: Value) -> Value {
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
                "clientInfo": { "name": "eigen-factoren-mcp", "version": "0.0.0" }
            }
        }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": naam, "arguments": argumenten } }),
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
        let bericht: Value = serde_json::from_str(regel.trim())
            .unwrap_or_else(|e| panic!("ongeldige JSON-RPC-regel {regel:?}: {e}"));
        if bericht["id"] == 2 {
            assert!(bericht["error"].is_null(), "JSON-RPC-fout: {bericht}");
            antwoord = bericht["result"].clone();
        }
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(10), kind.wait()).await;
    antwoord
}

/// P01 uit de repo, en een kopie met elke factor bevestigd, in een eigen map.
fn p01_bestanden() -> (PathBuf, PathBuf, PathBuf) {
    let bron = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../design-mockup/referentie-projecten/P01.femp");
    let tekst = std::fs::read_to_string(&bron).expect("P01.femp lezen");
    let mut bevestigd: Value = serde_json::from_str(&tekst).expect("P01 is JSON");
    for combinatie in bevestigd["combinations"].as_array_mut().expect("combinaties") {
        combinatie["bevestigdeFactoren"] = combinatie["factors"].clone();
    }
    let map = std::env::temp_dir().join(format!("eigen-factoren-mcp-{}", std::process::id()));
    std::fs::create_dir_all(&map).unwrap();
    let zonder = map.join("P01.femp");
    let met = map.join("P01-bevestigd.femp");
    std::fs::write(&zonder, &tekst).unwrap();
    std::fs::write(&met, serde_json::to_string(&bevestigd).unwrap()).unwrap();
    (map, zonder, met)
}

fn fouten(warnings: &Value) -> Vec<String> {
    warnings
        .as_array()
        .map(|l| l.iter().filter_map(|w| w.as_str()).filter(|w| w.starts_with("FOUT:")).map(str::to_owned).collect())
        .unwrap_or_default()
}

#[tokio::test]
async fn bevestigde_eigen_factoren_via_project_path_en_terug() {
    eis_node().await;
    let (map, zonder, met) = p01_bestanden();

    // Zonder bevestiging: een FOUT met de schaal, zonder herkomst uit een oud bestand.
    let uit = tool("validate_fem_model", json!({ "project_path": zonder.to_string_lossy() })).await;
    let s = &uit["structuredContent"];
    assert_eq!(s["ok"], json!(false), "P01 zonder bevestiging hoort een FOUT te geven: {uit}");
    let tekst = s["errors"].to_string();
    assert!(tekst.contains("1,22 ≈ 0,9 × 1,35"), "de fout noemt de schaal K_FI op NB.4: {tekst}");
    assert!(tekst.contains("NB.5 CC1 geeft 1,2"), "de fout noemt wat NB.5 geeft: {tekst}");
    assert!(!uit.to_string().contains("september 2026"), "geen herkomst zonder spoor: {uit}");

    // Met bevestiging: ok, en de factoren vermeld.
    let uit = tool("validate_fem_model", json!({ "project_path": met.to_string_lossy() })).await;
    let s = &uit["structuredContent"];
    assert_eq!(s["ok"], json!(true), "P01 met bevestiging hoort ok te zijn: {uit}");
    assert!(s["warnings"].to_string().contains("bewust gekozen"), "de vermelding ontbreekt: {uit}");

    // load_fem_project geeft de bevestiging mee; solve met precies die combinaties.
    let geladen = tool("load_fem_project", json!({ "path": met.to_string_lossy() })).await;
    let l = &geladen["structuredContent"];
    assert_eq!(l["combinations"][0]["bevestigdeFactoren"]["1"], json!(1.22), "{geladen}");
    let opgelost = tool("solve_fem_model", json!({
        "model": l["model"], "combinations": l["combinations"], "gevolgklasse": l["gevolgklasse"],
    })).await;
    assert_eq!(opgelost["isError"], json!(false), "{opgelost}");
    let w = &opgelost["structuredContent"]["warnings"];
    assert!(fouten(w).is_empty(), "geen FOUT na bevestigen: {:?}", fouten(w));

    // Zonder het veld: dezelfde uitkomst, maar de FOUT terug.
    let mut kaal = l["combinations"].clone();
    for c in kaal.as_array_mut().unwrap() {
        c.as_object_mut().unwrap().remove("bevestigdeFactoren");
    }
    let opnieuw = tool("solve_fem_model", json!({
        "model": l["model"], "combinations": kaal, "gevolgklasse": l["gevolgklasse"],
    })).await;
    assert_eq!(opnieuw["isError"], json!(false), "{opnieuw}");
    let w2 = &opnieuw["structuredContent"]["warnings"];
    assert!(fouten(w2).iter().any(|f| f.contains("Belastinggeval 1 ")), "de FOUT hoort terug te komen: {w2}");
    assert_eq!(
        opgelost["structuredContent"]["combinations"], opnieuw["structuredContent"]["combinations"],
        "de bevestiging is geen rekenwaarde: de uitkomsten horen gelijk te zijn"
    );

    let _ = std::fs::remove_dir_all(&map);
}
