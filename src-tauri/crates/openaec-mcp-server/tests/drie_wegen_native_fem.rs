//! The experimental Rust FEM contract is identical through the desktop
//! command body, development bridge and the running MCP server.

use serde_json::{json, Value};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

fn input() -> Value {
    json!({"kind":"squareMesh","input":{
        "originX":0,"originY":0,"widthM":2,"heightM":2,
        "cellSizeM":1,"materialId":1,"thicknessM":0.1
    }})
}

fn quad_input() -> Value {
    json!({"kind":"quad2d","input":{
        "analysis":"linear",
        "nodes":[
            {"id":1,"x":0,"y":0},{"id":2,"x":1,"y":0},
            {"id":3,"x":0,"y":1},{"id":4,"x":1,"y":1}
        ],
        "quads":[{"id":1,"nodeIds":[1,2,4,3],"materialId":1,"thicknessM":0.1}],
        "materials":[{"id":1,"eMpa":1000,"nu":0,"law":{"kind":"elastic"}}],
        "supports":[{"nodeId":1,"ux":true,"uy":true},
                    {"nodeId":3,"ux":true,"uy":false}],
        "loads":[{"nodeId":2,"fx":50,"fy":0},{"nodeId":4,"fx":50,"fy":0}]
    }})
}

#[tokio::test]
async fn all_three_routes_return_identical_native_results() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_openaec-mcp-server"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    async fn exchange(
        stdin: &mut tokio::process::ChildStdin,
        stdout: &mut BufReader<tokio::process::ChildStdout>,
        message: Value,
    ) -> Value {
        stdin
            .write_all(format!("{}\n", message).as_bytes())
            .await
            .unwrap();
        stdin.flush().await.unwrap();
        let mut line = String::new();
        let n = timeout(Duration::from_secs(30), stdout.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        assert!(n > 0, "MCP server exited before answering");
        serde_json::from_str(&line).unwrap()
    }
    let initialized = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "jsonrpc":"2.0","id":1,"method":"initialize","params":{
                "protocolVersion":"2025-06-18","capabilities":{},
                "clientInfo":{"name":"native-fem-test","version":"0"}
            }
        }),
    )
    .await;
    assert!(initialized["error"].is_null(), "{initialized}");
    for (id, model) in [(2, input()), (3, quad_input())] {
        // Same function as the Tauri command, with the actual typed request.
        let typed: openaec_native_fem::dispatch::NativeFemRequest =
            serde_json::from_value(model.clone()).unwrap();
        let desktop_body =
            serde_json::to_value(openaec_native_fem::dispatch::solve_native_fem(typed).unwrap())
                .unwrap();
        let bridge: toetsbrug::Verzoek = serde_json::from_value(json!({
            "opdracht":"solve_native_fem","inputs":model
        }))
        .unwrap();
        let browser = toetsbrug::behandel(bridge).unwrap();
        assert_eq!(desktop_body, browser);
        let response = exchange(
            &mut stdin,
            &mut stdout,
            json!({
                "jsonrpc":"2.0","id":id,"method":"tools/call","params":{
                    "name":"solve_native_fem","arguments":{"inputs":model}
                }
            }),
        )
        .await;
        assert_eq!(response["result"]["isError"], false, "{response}");
        assert_eq!(response["result"]["structuredContent"], desktop_body);
        if id == 3 {
            let ux = desktop_body["result"]["nodes"][1]["uxM"].as_f64().unwrap();
            assert!((ux - 0.001).abs() < 1e-10, "ux {ux}");
        }
    }
    let mut invalid = quad_input();
    invalid["input"]["quads"][0]["unknownField"] = json!(1);
    assert!(
        serde_json::from_value::<openaec_native_fem::dispatch::NativeFemRequest>(invalid.clone())
            .is_err()
    );
    let bridge: toetsbrug::Verzoek = serde_json::from_value(json!({
        "opdracht":"solve_native_fem","inputs":invalid
    }))
    .unwrap();
    assert!(toetsbrug::behandel(bridge).is_err());
    let rejected = exchange(
        &mut stdin,
        &mut stdout,
        json!({
            "jsonrpc":"2.0","id":4,"method":"tools/call","params":{
                "name":"solve_native_fem","arguments":{"inputs":invalid}
            }
        }),
    )
    .await;
    assert_eq!(rejected["result"]["isError"], true, "{rejected}");
    let _ = child.kill().await;
}
