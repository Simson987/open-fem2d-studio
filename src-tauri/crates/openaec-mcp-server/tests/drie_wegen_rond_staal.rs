//! Massief rond staal langs de drie wegen: een trekstaaf RD 24 geeft via het
//! Tauri-command, de toetsbrug en de MCP-server hetzelfde antwoord, mét de
//! toets op het draadeind — ook als de naam als "Ø24" binnenkomt.
//!
//! HOE ELKE WEG WORDT AANGESPROKEN — gelijk aan `drie_wegen_doorbuigingsnoemer.rs`
//! * **Weg 1 (Tauri-command)**: de body van `check_steel_beams` uit
//!   `src-tauri/src/lib.rs`, letterlijk uitgevoerd (inlezen in de Rust-typen,
//!   dan de kern).
//! * **Weg 2 (toetsbrug)**: `toetsbrug::behandel`, de functie die de binary op
//!   zijn invoer uitvoert.
//! * **Weg 3 (MCP)**: de werkelijke binary over stdio, `tools/call`.
//!
//! Er komt geen invoerveld bij: de profielnaam is een tekst die al langs alle
//! drie de wegen reist, en de catalogus zit in de kern. Deze test bewaakt dat
//! dat zo blijft.

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

/// Een windverband van 6 m onder 80 kN trek, met een klein moment uit het
/// eigen gewicht.
fn trekstaaf(naam: &str) -> Value {
    let punt = |x_mm: f64, my: f64| {
        json!({
            "combination_id": 3,
            "position_mm": x_mm,
            "forces": { "n_ed": 80.0, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": my, "mz_ed": 0.0 }
        })
    };
    json!({
        "beam_id": 21,
        "profile_name": naam,
        "steel_grade": "S235",
        "length_m": 6.0,
        "forces_envelope": [punt(0.0, 0.0), punt(3000.0, 0.16), punt(6000.0, 0.0)],
        "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "buckling_length_y_m": 0.0,
        "buckling_length_z_m": 0.0,
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
                "clientInfo": { "name": "drie-wegen-rond-staal", "version": "0.0.0" }
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
    r["checks"]
        .as_array()
        .and_then(|c| c.iter().find(|t| t["id"] == id))
        .unwrap_or_else(|| panic!("toets {id} ontbreekt in {r}"))
}

/// Het draadeind met de hand: A_s = π/4·(24 − 0,9382·3)² = 352,50 mm²,
/// N_t,Rd,draad = 0,9·360·352,50/1,25 = 91,37 kN, UC = 80/91,37 = 0,8756.
#[tokio::test]
async fn trekstaaf_rd24_langs_de_drie_wegen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mut id = 10;
    for naam in ["RD 24", "Ø24"] {
        id += 1;
        let invoer = trekstaaf(naam);
        let tauri = weg_tauri(&invoer);
        let brug = weg_toetsbrug(&invoer);
        let mcp = weg_mcp(&mut stdin, &mut reader, id, invoer.clone()).await;
        assert_eq!(tauri, brug, "{naam}: Tauri en toetsbrug lopen uiteen");
        assert_eq!(tauri, mcp, "{naam}: Tauri en MCP lopen uiteen");

        let draad = &toets(&tauri, "6.2.3_threaded_end")["kind"]["data"];
        let rd = draad["value"].as_f64().unwrap();
        assert!((rd - 91.369).abs() < 0.01, "{naam}: N_t,Rd,draad = {rd}");
        let uc = draad["uc"]["uc"].as_f64().unwrap();
        assert!((uc - 80.0 / 91.369).abs() < 1e-4, "{naam}: UC = {uc}");
        assert_eq!(tauri["governing_check_id"], "6.2.3_threaded_end", "{naam}");
        // Kip n.v.t. met reden, en geen knik op een trekkracht.
        for id_nvt in ["6.3.2_ltb", "6.3.1_buckling"] {
            let t = &toets(&tauri, id_nvt)["kind"]["data"];
            assert_eq!(t["status"], "NotApplicable", "{naam}: {id_nvt}");
            assert!(t["uc"].is_null(), "{naam}: {id_nvt} hoort geen unity check te hebben");
        }
    }
    let _ = child.kill().await;
}
