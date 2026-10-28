//! End-to-end round-trip test for the MCP stdio loop.
//!
//! Spawns the actual `openaec-mcp-server` binary as a subprocess, drives the
//! protocol handshake (`initialize` → `notifications/initialized` →
//! `tools/list` → `tools/call list_steel_profiles`) over stdin/stdout, and
//! asserts every response is well-formed JSON-RPC and the tool returns a
//! non-empty profiles array.

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

/// Read one newline-terminated JSON-RPC message and parse it. Times out after
/// 30s — the first call may need to JIT-init the steel-profiles DB.
async fn read_message<R>(reader: &mut R) -> Value
where
    R: AsyncBufReadExt + Unpin,
{
    let mut line = String::new();
    let n = timeout(Duration::from_secs(30), reader.read_line(&mut line))
        .await
        .expect("timeout waiting for response")
        .expect("read_line failed");
    assert!(n > 0, "EOF on stdout — server exited unexpectedly");
    serde_json::from_str(line.trim())
        .unwrap_or_else(|e| panic!("invalid JSON-RPC line {:?}: {}", line, e))
}

#[tokio::test]
async fn stdio_roundtrip_initialize_list_call() {
    let mut child = Command::new(BIN_PATH)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn server");

    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut reader = BufReader::new(stdout);

    // ── 1. initialize ────────────────────────────────────────────────────
    let init = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "stdio-roundtrip-test", "version": "0.0.0" }
        }
    });
    let mut req = serde_json::to_string(&init).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["jsonrpc"], "2.0");
    assert_eq!(resp["id"], 1);
    assert_eq!(resp["result"]["serverInfo"]["name"], "openaec-fem");
    assert!(resp["result"]["protocolVersion"].is_string());
    assert!(resp["error"].is_null());

    // ── 2. notifications/initialized (no response expected) ──────────────
    let init_notif = json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized",
        "params": {}
    });
    let mut req = serde_json::to_string(&init_notif).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    // ── 3. tools/list ────────────────────────────────────────────────────
    let list = json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });
    let mut req = serde_json::to_string(&list).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["jsonrpc"], "2.0");
    assert_eq!(resp["id"], 2);
    let tools = resp["result"]["tools"]
        .as_array()
        .expect("tools must be an array");
    // Het AANTAL, niet alleen de namen: een tool die erbij komt zonder dat
    // iemand hem hier noemt, hoort op te vallen. De namenlijst hieronder is
    // niet uitputtend, dus zonder deze telling zou zo'n tool ongemerkt
    // meeliften.
    // 31 rekenkern-/FEM-tools (inclusief solve_open_fem_3d,
    // open_fem_3d_staalhal_maken en open_fem_3d_ifc_importeren, en het spoor
    // solve_frame3d en solve_native_fem) + 23
    // gui_*-tools (het bedieningskanaal van de desktop-app, zie gui_tools.rs;
    // sinds de staalhal ook gui_build_3d_steel_hall, sinds de IFC-import ook
    // gui_import_ifc_analysis_model, sinds issue #109 ook gui_start_app)
    // + project_import (lokale extensie) + list_aluminium_alloys en
    // check_aluminium_beams (issue #5) + de twee .ifcfemresults-tools
    // (issue #87: fem_resultaten_ifc_schrijven en _lezen) + check_masonry_walls
    // (issue #98) + list_koudgevormd_staalsoorten en
    // check_koudgevormd_beams (issue #4) = 62 vaste tools.
    // Daarbij één tool per API-commando van de app, uit de ingebakken catalogus
    // (assets/api-catalogus.json, geschreven door `npm run build:sidecar`).
    // Ook die tellen exact: elk commando uit de catalogus, niets meer.
    let catalogus: Value = serde_json::from_str(include_str!("../assets/api-catalogus.json"))
        .expect("assets/api-catalogus.json");
    let api_namen: Vec<String> = catalogus["commands"]
        .as_array()
        .expect("commands")
        .iter()
        .map(|c| c["name"].as_str().unwrap().replace('.', "_"))
        .collect();
    assert_eq!(
        tools.len(),
        62 + api_namen.len(),
        "expected 62 + {} tools, got {}",
        api_namen.len(),
        tools.len()
    );
    let names: Vec<&str> = tools
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    for api in &api_namen {
        assert!(names.contains(&api.as_str()), "API-tool {api} ontbreekt in tools/list");
    }
    let native_fem = tools
        .iter()
        .find(|tool| tool["name"] == "solve_native_fem")
        .unwrap();
    assert!(
        native_fem["inputSchema"]["properties"]["inputs"]["properties"]["kind"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|kind| kind == "geometricShell")
    );
    for expected in [
        "list_steel_profiles",
        "project_import",
        "gui_status",
        "gui_start_app",
        "gui_build_3d_model",
        "gui_select_3d_plate",
        "gui_split_3d_member",
        "gui_configure_3d_view",
        "gui_screenshot",
        "gui_quit",
        "list_steel_grades",
        "check_steel_beam",
        "compute_section_properties",
        "generate_steel_report_pdf",
        // De vijf FEM-tools (T10). Ze staan hier ALTIJD in, ook zonder
        // Node-runtime: verbergen zou de client laten melden dat de functie
        // niet bestaat, en dan is de storing niet meer te diagnosticeren.
        "fem_solver_status",
        "validate_fem_model",
        "load_fem_project",
        "solve_fem_model",
        "check_fem_model",
        // Ruimtelijke raamwerken: dezelfde Rust-adapter als het Tauri-command.
        "solve_open_fem_3d",
        "solve_frame3d",
        // Experimentele onafhankelijke Rust FEM-kernels via de gedeelde dispatcher.
        "solve_native_fem",
        // De stalen hal: generator van de wizard, 3D-kern en staaltoets; zie
        // `tests/staalhal_mcp.rs`.
        "open_fem_3d_staalhal_maken",
        "gui_build_3d_steel_hall",
        // De import van een IFC4-analysemodel: de import van de app in de
        // sidecar, 3D-kern en staaltoets; zie `tests/ifc_import_mcp.rs`.
        "open_fem_3d_ifc_importeren",
        "gui_import_ifc_analysis_model",
        // Resultaten als .ifcfemresults (issue #87); zie `tests/ifc_resultaten_mcp.rs`.
        "fem_resultaten_ifc_schrijven",
        "fem_resultaten_ifc_lezen",
        // De betontools (NEN-EN 1992-1-1). Dezelfde rekengang als het
        // Tauri-command en de toetsbrug; zie `tests/drie_wegen_beton.rs`,
        // `tests/drie_wegen_beff.rs` en `tests/drie_wegen_dekking.rs`.
        "list_concrete_classes",
        "list_reinforcement_grades",
        "check_concrete_beam",
        "concrete_mn_kappa",
        // De stateloze stijfheidsdienst voor de fysisch niet-lineaire tweede
        // orde (5.8.6): segmentindeling, secante EI per segment en het
        // convergentie-oordeel.
        "concrete_segment_stiffness",
        // De dekkingslijn: §9.2.1.3 met figuur 9.2 voor de momenten en §6.2
        // voor de dwarskracht, per plaats de benodigde naast de aanwezige
        // waarde met het bewijs erbij.
        "concrete_dekkingslijn",
        // De meewerkende flensbreedte b_eff per gebied van figuur 5.2
        // (5.3.2.1, alle grenstoestanden).
        "concrete_effective_flange_width",
        // De milieuklassen van tabel 4.1 en de dekkingstoets van 4.4.1, met
        // c_min,dur uit de door de nationale bijlage voorgeschreven tabel 4.4N.
        "list_exposure_classes",
        "concrete_cover_check",
        // De kruipcoëfficiënt volgens bijlage B (B.1–B.9).
        "concrete_creep_coefficient",
        // De vier houttools (NEN-EN 1995-1-1), hout en kruislaaghout. Ze
        // ontbraken hier terwijl `generate_steel_report_pdf` hierboven wél
        // `timber_check_results` accepteert; zie `tests/drie_wegen_hout.rs` en
        // `tests/drie_wegen_kruistabel.rs`. Deze vier heten precies zoals het
        // Tauri-command en de toetsbrug-opdracht — meervoud, want ze nemen net
        // als die twee een lijst staven.
        "list_timber_grades",
        "check_timber_beams",
        "list_clt_presets",
        "check_clt_beams",
        // De plaattoets (wandschijven); zie `tests/drie_wegen_plaat.rs`.
        "check_plates",
    ] {
        assert!(
            names.contains(&expected),
            "missing tool: {expected} (have {names:?})"
        );
    }

    // ── 4. tools/call list_steel_profiles ────────────────────────────────
    let call = json!({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "list_steel_profiles",
            "arguments": {}
        }
    });
    let mut req = serde_json::to_string(&call).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["jsonrpc"], "2.0");
    assert_eq!(resp["id"], 3);
    assert!(resp["error"].is_null(), "error: {resp:?}");

    let result = &resp["result"];
    assert_eq!(result["isError"], false);

    // The profiles array must be present in structuredContent and
    // also embedded as JSON text in content[0].text — verify both.
    let profiles_struct = result["structuredContent"]["profiles"]
        .as_array()
        .expect("structuredContent.profiles must be an array");
    assert!(!profiles_struct.is_empty(), "profile list is empty");

    let text = result["content"][0]["text"]
        .as_str()
        .expect("content[0].text must be a string");
    let parsed: Value = serde_json::from_str(text).expect("content text must be parseable JSON");
    assert!(
        parsed["profiles"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false),
        "embedded text profiles must be a non-empty array"
    );

    // Spot-check a profile has a recognisable shape.
    let first = &profiles_struct[0];
    assert!(first["name"].is_string());
    assert!(first["properties"]["area_mm2"].is_number());

    // ── 5. tools/call fem_solver_status ──────────────────────────────────
    // Bewijst dat de FEM-tools ook écht bereikbaar zijn en niet alleen in
    // `tools/list` staan. Deze tool is met opzet de enige die nooit faalt: een
    // storing IS zijn antwoord. Hij werkt daarmee mét en zónder Node-runtime,
    // wat hem geschikt maakt als eerste stap bij een storing én als test die
    // niets over de machine hoeft aan te nemen.
    let call = json!({
        "jsonrpc": "2.0",
        "id": 4,
        "method": "tools/call",
        "params": { "name": "fem_solver_status", "arguments": {} }
    });
    let mut req = serde_json::to_string(&call).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["id"], 4);
    assert!(resp["error"].is_null(), "error: {resp:?}");
    let status = &resp["result"]["structuredContent"];
    assert_eq!(resp["result"]["isError"], false);
    assert!(status["available"].is_boolean(), "status: {status}");
    assert_eq!(status["protocol_version"], 1);
    // De ingebakken bundelhash weet de binary altijd van zichzelf, ook als er
    // geen Node is om mee te rekenen.
    let hash = status["bundle_hash"].as_str().expect("bundle_hash");
    assert!(hash.starts_with("sha256:"), "bundle_hash: {hash}");
    // Werkt het niet, dan moet de reden Nederlands zijn en een remedie noemen —
    // een ontbrekende runtime mag nooit op een rekenfout lijken.
    if status["available"] == json!(false) {
        assert!(status["error_code"].is_string(), "status: {status}");
        assert!(status["reason"].is_string(), "status: {status}");
        assert!(status["remedie"].is_string(), "status: {status}");
    }

    // ── 6. tools/call solve_fem_model zonder model ───────────────────────
    // Een aanroep zonder `model` én zonder `project_path` moet worden
    // geweigerd. Zonder deze poort zou de server een "leeg model" kunnen
    // doorrekenen en nullen teruggeven die als uitkomst lezen.
    let call = json!({
        "jsonrpc": "2.0",
        "id": 5,
        "method": "tools/call",
        "params": { "name": "solve_fem_model", "arguments": {} }
    });
    let mut req = serde_json::to_string(&call).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["id"], 5);
    assert_eq!(resp["result"]["isError"], true, "resp: {resp:?}");
    let tekst = resp["result"]["content"][0]["text"].as_str().unwrap_or("");
    assert!(
        tekst.contains("project_path") && tekst.contains("model"),
        "de melding moet beide uitwegen noemen: {tekst}"
    );

    // ── 7. tools/call solve_open_fem_3d ─────────────────────────────────────
    // Volledige protocolroute: dezelfde uitkraging als de adaptertest, nu via
    // stdin/stdout en de MCP-contentverpakking. Hiermee bewijzen we dat de tool
    // niet alleen in tools/list staat maar ook daadwerkelijk rekent.
    let call = json!({
        "jsonrpc": "2.0",
        "id": 6,
        "method": "tools/call",
        "params": {
            "name": "solve_open_fem_3d",
            "arguments": {
                "schemaVersion": 1,
                "analysis": "p-delta",
                "nodes": [
                    { "id": 1, "x": 0.0, "y": 0.0, "z": 0.0 },
                    { "id": 2, "x": 3.0, "y": 0.0, "z": 0.0 }
                ],
                "materials": [{ "id": 1, "name": "S235", "eMpa": 210000.0, "nu": 0.3 }],
                "sections": [{
                    "id": 1, "name": "test", "areaM2": 0.01,
                    "iyM4": 0.0001, "izM4": 0.00005, "torsionJM4": 0.00001
                }],
                "members": [{
                    "id": 1, "startNodeId": 1, "endNodeId": 2,
                    "materialId": 1, "sectionId": 1, "releases": {}
                }],
                "supports": [{
                    "nodeId": 1, "ux": true, "uy": true, "uz": true,
                    "rx": true, "ry": true, "rz": true
                }],
                "memberLoads": [{
                    "id": 1, "memberId": 1,
                    "qyStartKnPerM": 0.0, "qyEndKnPerM": 0.0,
                    "qzStartKnPerM": -4.0, "qzEndKnPerM": -4.0,
                    "startPositionM": 0.0, "endPositionM": 3.0
                }]
            }
        }
    });
    let mut req = serde_json::to_string(&call).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["id"], 6);
    assert_eq!(resp["result"]["isError"], false, "resp: {resp:?}");
    let solved = &resp["result"]["structuredContent"];
    assert_eq!(solved["engine"]["id"], "open-fem-3d");
    assert_eq!(solved["analysis"], "p-delta");
    let uz = solved["displacements"][1]["uz"].as_f64().expect("uz");
    assert!((uz + 0.0019285714285714286).abs() < 1e-12, "uz={uz}");
    let fz = solved["reactions"][0]["fz"].as_f64().expect("reactie fz");
    assert!((fz - 12.0).abs() < 1e-10, "fz={fz}");

    // ── 8. revolute X door de volledige MCP/API-route ───────────────────
    // `rx=false` met alle translaties en de twee andere rotaties vast is een
    // revolute oplegging om globale X. Het koppel loopt daardoor naar de
    // afzonderlijke Rx-blokkering op knoop 2; op knoop 1 ontstaat rotatie.
    let call = json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {
            "name": "solve_open_fem_3d",
            "arguments": {
                "schemaVersion": 1,
                "analysis": "linear",
                "nodes": [
                    { "id": 1, "x": 0.0, "y": 0.0, "z": 0.0 },
                    { "id": 2, "x": 3.0, "y": 0.0, "z": 0.0 }
                ],
                "materials": [{ "id": 1, "name": "S235", "eMpa": 210000.0, "nu": 0.3 }],
                "sections": [{
                    "id": 1, "name": "test", "areaM2": 0.01,
                    "iyM4": 0.0001, "izM4": 0.00005, "torsionJM4": 0.00001
                }],
                "members": [{
                    "id": 1, "startNodeId": 1, "endNodeId": 2,
                    "materialId": 1, "sectionId": 1, "releases": {}
                }],
                "supports": [
                    { "nodeId": 1, "ux": true, "uy": true, "uz": true, "rx": false, "ry": true, "rz": true },
                    { "nodeId": 2, "ux": false, "uy": false, "uz": false, "rx": true, "ry": false, "rz": false }
                ],
                "nodalLoads": [{
                    "id": 1, "nodeId": 1, "fx": 0.0, "fy": 0.0, "fz": 0.0,
                    "mx": 5.0, "my": 0.0, "mz": 0.0
                }],
                "bucklingModes": 0
            }
        }
    });
    let mut req = serde_json::to_string(&call).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["id"], 7);
    assert_eq!(resp["result"]["isError"], false, "resp: {resp:?}");
    let solved = &resp["result"]["structuredContent"];
    let rx = solved["displacements"].as_array().unwrap().iter()
        .find(|value| value["nodeId"] == 1).unwrap()["rx"].as_f64().unwrap();
    assert!((rx - 0.018571428571428572).abs() < 1e-10, "rx={rx}");
    let mx = solved["reactions"].as_array().unwrap().iter()
        .find(|value| value["nodeId"] == 2).unwrap()["mx"].as_f64().unwrap();
    assert!((mx.abs() - 5.0).abs() < 1e-10, "mx={mx}");

    // ── 9. tools/call solve_frame3d (spoor frame3d) ──────────────────────
    // Dezelfde uitkraging als stap 7, nu door de tool van het frame3d-spoor
    // (Dedaliano-adapter onder de oude cratenaam).
    let call = json!({
        "jsonrpc": "2.0",
        "id": 8,
        "method": "tools/call",
        "params": {
            "name": "solve_frame3d",
            "arguments": {
                "schemaVersion": 1,
                "analysis": "p-delta",
                "nodes": [
                    { "id": 1, "x": 0.0, "y": 0.0, "z": 0.0 },
                    { "id": 2, "x": 3.0, "y": 0.0, "z": 0.0 }
                ],
                "materials": [{ "id": 1, "name": "S235", "eMpa": 210000.0, "nu": 0.3 }],
                "sections": [{
                    "id": 1, "name": "test", "areaM2": 0.01,
                    "iyM4": 0.0001, "izM4": 0.00005, "torsionJM4": 0.00001
                }],
                "members": [{
                    "id": 1, "startNodeId": 1, "endNodeId": 2,
                    "materialId": 1, "sectionId": 1, "releases": {}
                }],
                "supports": [{
                    "nodeId": 1, "ux": true, "uy": true, "uz": true,
                    "rx": true, "ry": true, "rz": true
                }],
                "memberLoads": [{
                    "id": 1, "memberId": 1,
                    "qyStartKnPerM": 0.0, "qyEndKnPerM": 0.0,
                    "qzStartKnPerM": -4.0, "qzEndKnPerM": -4.0,
                    "startPositionM": 0.0, "endPositionM": 3.0
                }]
            }
        }
    });
    let mut req = serde_json::to_string(&call).unwrap();
    req.push('\n');
    stdin.write_all(req.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();

    let resp = read_message(&mut reader).await;
    assert_eq!(resp["id"], 8);
    assert_eq!(resp["result"]["isError"], false, "resp: {resp:?}");
    let solved = &resp["result"]["structuredContent"];
    assert_eq!(solved["engine"]["id"], "dedaliano");
    assert_eq!(solved["analysis"], "p-delta");
    let uz = solved["displacements"][1]["uz"].as_f64().expect("uz");
    assert!((uz + 0.0019285714285714286).abs() < 1e-12, "uz={uz}");
    let fz = solved["reactions"][0]["fz"].as_f64().expect("reactie fz");
    assert!((fz - 12.0).abs() < 1e-10, "fz={fz}");

    // Cleanup: drop stdin → server sees EOF → exits.
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

/// Een client die zijn verzoeken in één keer stuurt en daarna stdin sluit
/// (een pijp, een script) krijgt toch op elk verzoek antwoord: de server
/// maakt lopende verzoeken af voordat hij stopt.
#[tokio::test]
async fn stdin_dicht_na_verzoeken_beantwoordt_alles() {
    let mut child = Command::new(BIN_PATH)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn server");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let berichten = [
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": { "name": "pijp", "version": "0" } } }),
        json!({ "jsonrpc": "2.0", "method": "notifications/initialized", "params": {} }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }),
        json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": { "name": "list_steel_grades", "arguments": {} } }),
    ];
    let mut tekst = String::new();
    for bericht in &berichten {
        tekst.push_str(&serde_json::to_string(bericht).unwrap());
        tekst.push('\n');
    }
    stdin.write_all(tekst.as_bytes()).await.unwrap();
    drop(stdin); // invoer dicht, direct na de verzoeken

    let mut reader = BufReader::new(stdout);
    let mut ids = Vec::new();
    loop {
        let mut line = String::new();
        let n = timeout(Duration::from_secs(30), reader.read_line(&mut line))
            .await
            .expect("timeout waiting for response")
            .expect("read_line failed");
        if n == 0 {
            break;
        }
        let bericht: Value = serde_json::from_str(line.trim()).expect("geldige JSON-RPC");
        assert!(bericht["error"].is_null(), "fout op {line}");
        ids.push(bericht["id"].as_i64().expect("antwoord met id"));
    }
    ids.sort_unstable();
    assert_eq!(ids, vec![1, 2, 3], "elk verzoek beantwoord, ook na het sluiten van stdin");
    let status = timeout(Duration::from_secs(30), child.wait())
        .await
        .expect("timeout waiting for exit")
        .expect("wait failed");
    assert!(status.success(), "server stopt netjes: {status}");
}
