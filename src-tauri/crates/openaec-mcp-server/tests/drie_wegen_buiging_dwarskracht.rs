//! 6.2.8 op elk station langs de drie wegen: een IPE 300 met een zware
//! puntlast vlak bij de oplegging (combinatie 2) en een gelijkmatige last
//! (combinatie 1) geeft via het Tauri-command, de toetsbrug en de MCP-server
//! dezelfde 6.2.8, met de maatgevende plaats naast de puntlast — niet het punt
//! met het grootste moment.
//!
//! HOE ELKE WEG WORDT AANGESPROKEN — gelijk aan `drie_wegen_strip.rs`:
//! * **Weg 1 (Tauri-command)**: de body van `check_steel_beams` uit
//!   `src-tauri/src/lib.rs` (inlezen in de Rust-typen, dan de kern).
//! * **Weg 2 (toetsbrug)**: `toetsbrug::behandel`.
//! * **Weg 3 (MCP)**: de werkelijke binary over stdio, `tools/call`.
//!
//! Er komt geen invoerveld bij. De handberekening staat in
//! `steel-check/tests/buiging_dwarskracht.rs`.

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

/// IPE 300, S235, L = 4 m. Combinatie 1: q = 60 kN/m; combinatie 2: P = 330 kN
/// op x = 0,4 m (links V = 297 kN, rechts −33 kN, M = 118,8 kNm). Tot oktober
/// 2026 was P = 280 kN; met (6.30) zou combinatie 1 dan maatgevend zijn (zie
/// `steel-check/tests/buiging_dwarskracht.rs`).
fn ligger() -> Value {
    let punt = |c: u32, x_mm: f64, vz: f64, my: f64| {
        json!({
            "combination_id": c,
            "position_mm": x_mm,
            "forces": { "n_ed": 0.0, "vy_ed": 0.0, "vz_ed": vz, "mt_ed": 0.0, "my_ed": my, "mz_ed": 0.0 }
        })
    };
    let mut punten: Vec<Value> = (0..=10)
        .map(|i| {
            let x = 0.4 * i as f64;
            punt(1, x * 1000.0, 120.0 - 60.0 * x, 30.0 * x * (4.0 - x))
        })
        .collect();
    punten.push(punt(2, 0.0, 297.0, 0.0));
    punten.push(punt(2, 400.0, 297.0, 118.8));
    punten.push(punt(2, 400.0, -33.0, 118.8));
    for i in 2..=10 {
        let x = 0.4 * i as f64;
        punten.push(punt(2, x * 1000.0, -33.0, 132.0 - 33.0 * x));
    }
    json!({
        "beam_id": 8,
        "profile_name": "IPE 300",
        "steel_grade": "S235",
        "length_m": 4.0,
        "forces_envelope": punten,
        "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "buckling_length_y_m": 4.0,
        "buckling_length_z_m": 4.0,
        "deflection_limit_class": "Custom",
        "deflection_limit_numerator": 300,
        "deflection_actual_max_mm": 0.0,
        "is_cantilever": false,
        "consequence_class": "CC2",
        "pre_camber_mm": 0.0,
        "deflection_permanent_mm": 0.0,
        "deflection_add_limit_numerator": 300.0,
        "q_equiv_n_per_mm": 0.0,
        "z_a_mm": 0.0
    })
}

fn weg_tauri(invoer: &Value) -> Value {
    let inputs: Vec<steel_check::BeamCheckInput> =
        serde_json::from_value(json!([invoer])).expect("BeamCheckInput");
    serde_json::to_value(&steel_check::check_all_beams(inputs)[0]).unwrap()
}

fn weg_toetsbrug(invoer: &Value) -> Value {
    let verzoek: toetsbrug::Verzoek =
        serde_json::from_value(json!({ "opdracht": "check_steel_beams", "inputs": [invoer] })).unwrap();
    let antwoord = toetsbrug::behandel(verzoek).unwrap_or_else(|e| panic!("toetsbrug: {e}"));
    antwoord.as_array().expect("een lijst")[0].clone()
}

async fn lees_bericht<R: AsyncBufReadExt + Unpin>(reader: &mut R) -> Value {
    let mut regel = String::new();
    let n = timeout(Duration::from_secs(60), reader.read_line(&mut regel))
        .await
        .expect("timeout bij het wachten op een antwoord")
        .expect("read_line mislukt");
    assert!(n > 0, "EOF op stdout — de server is onverwacht gestopt");
    serde_json::from_str(regel.trim()).unwrap()
}

async fn schrijf(stdin: &mut ChildStdin, waarde: Value) {
    let mut regel = serde_json::to_string(&waarde).unwrap();
    regel.push('\n');
    stdin.write_all(regel.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();
}

async fn start_server() -> (Child, ChildStdin, BufReader<ChildStdout>) {
    let mut child = Command::new(BIN_PATH)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("server starten");
    let mut stdin = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    schrijf(
        &mut stdin,
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "drie-wegen-buiging-dwarskracht", "version": "0.0.0" }
            }
        }),
    )
    .await;
    let resp = lees_bericht(&mut reader).await;
    assert!(resp["error"].is_null(), "initialize gaf een fout: {resp:?}");
    (child, stdin, reader)
}

async fn weg_mcp(stdin: &mut ChildStdin, reader: &mut BufReader<ChildStdout>, id: u32, invoer: Value) -> Value {
    schrijf(
        stdin,
        json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": "check_steel_beam", "arguments": invoer }
        }),
    )
    .await;
    let resp = lees_bericht(reader).await;
    assert_eq!(resp["id"], id);
    assert_eq!(resp["result"]["isError"], false, "check_steel_beam gaf een fout: {resp}");
    resp["result"]["structuredContent"].clone()
}

fn toets<'a>(r: &'a Value, id: &str) -> &'a Value {
    &r["checks"]
        .as_array()
        .and_then(|c| c.iter().find(|t| t["id"] == id))
        .unwrap_or_else(|| panic!("toets {id} ontbreekt in {r}"))["kind"]["data"]
}

fn variabele(t: &Value, symbool: &str) -> f64 {
    t["variables"]
        .as_array()
        .and_then(|v| v.iter().find(|x| x["symbol"] == symbool))
        .and_then(|x| x["value"].as_f64())
        .unwrap_or_else(|| panic!("variabele {symbool} ontbreekt in {t}"))
}

/// ρ = (2·297/348,2837 − 1)² = 0,497739, M_y,V,Rd = (628 000 − 0,497739 ·
/// 1978,06²/(4·7,1))·235·10⁻⁶ = 131,4650 kNm (6.30), UC = 118,8/131,4650 =
/// 0,903663 op combinatie 2, x = 400 mm.
#[tokio::test]
async fn station_naast_de_puntlast_langs_de_drie_wegen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let invoer = ligger();
    let tauri = weg_tauri(&invoer);
    let brug = weg_toetsbrug(&invoer);
    let mcp = weg_mcp(&mut stdin, &mut reader, 21, invoer.clone()).await;
    assert_eq!(tauri, brug, "Tauri en toetsbrug lopen uiteen");
    assert_eq!(tauri, mcp, "Tauri en MCP lopen uiteen");

    let mv = toets(&tauri, "6.2.8_combined_mv");
    assert_eq!(mv["force_state"]["combination_id"], 2);
    assert!((mv["force_state"]["position_mm"].as_f64().unwrap() - 400.0).abs() < 1e-9);
    assert!((variabele(mv, r"\rho") - 0.497739).abs() < 1e-6);
    assert!((mv["value"].as_f64().unwrap() - 131.4650).abs() < 1e-3);
    let uc = mv["uc"]["uc"].as_f64().unwrap();
    assert!((uc - 0.903663).abs() < 1e-5, "UC = {uc}");
    let _ = child.kill().await;
}
