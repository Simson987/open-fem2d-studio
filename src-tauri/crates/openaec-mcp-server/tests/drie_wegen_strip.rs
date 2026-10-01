//! Platstaal langs de drie wegen: een windverband "Strip 80x10" geeft via het
//! Tauri-command, de toetsbrug en de MCP-server hetzelfde antwoord, met de
//! trektoets op de brutodoorsnede — ook als de naam als "FL 80x10" of
//! "Platstaal 80x10" binnenkomt.
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

/// Een windverband van 6 m onder 150 kN trek, zonder moment (een
/// trek-alleen-staaf uit de 3D-berekening).
fn trekstaaf(naam: &str) -> Value {
    let punt = |x_mm: f64, my: f64| {
        json!({
            "combination_id": 3,
            "position_mm": x_mm,
            "forces": { "n_ed": 150.0, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": my, "mz_ed": 0.0 }
        })
    };
    json!({
        "beam_id": 21,
        "profile_name": naam,
        "steel_grade": "S235",
        "length_m": 6.0,
        "forces_envelope": [punt(0.0, 0.0), punt(3000.0, 0.0), punt(6000.0, 0.0)],
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
                "clientInfo": { "name": "drie-wegen-strip", "version": "0.0.0" }
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

/// Met de hand: A = 80·10 = 800 mm², N_pl,Rd = 800·235/1,0 = 188,0 kN (6.6),
/// UC = 150/188,0 = 0,79787. Geen draadeind; kip en knik n.v.t.
#[tokio::test]
async fn windverband_strip_80x10_langs_de_drie_wegen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mut id = 10;
    for naam in ["Strip 80x10", "FL 80x10", "Platstaal 80x10"] {
        id += 1;
        let invoer = trekstaaf(naam);
        let tauri = weg_tauri(&invoer);
        let brug = weg_toetsbrug(&invoer);
        let mcp = weg_mcp(&mut stdin, &mut reader, id, invoer.clone()).await;
        assert_eq!(tauri, brug, "{naam}: Tauri en toetsbrug lopen uiteen");
        assert_eq!(tauri, mcp, "{naam}: Tauri en MCP lopen uiteen");

        let trek = &toets(&tauri, "6.2.3_tension")["kind"]["data"];
        let rd = trek["value"].as_f64().unwrap();
        assert!((rd - 188.0).abs() < 1e-9, "{naam}: N_pl,Rd = {rd}");
        let uc = trek["uc"]["uc"].as_f64().unwrap();
        assert!((uc - 150.0 / 188.0).abs() < 1e-12, "{naam}: UC = {uc}");
        assert_eq!(tauri["governing_check_id"], "6.2.3_tension", "{naam}");
        assert!(
            tauri["checks"].as_array().unwrap().iter().all(|t| t["id"] != "6.2.3_threaded_end"),
            "{naam}: een strip heeft geen draadeind"
        );
        // Kip n.v.t. met reden, en geen knik op een trekkracht.
        for id_nvt in ["6.3.2_ltb", "6.3.1_buckling", "6.2.4_compression"] {
            let t = &toets(&tauri, id_nvt)["kind"]["data"];
            assert_eq!(t["status"], "NotApplicable", "{naam}: {id_nvt}");
        }
        for id_nvt in ["6.3.2_ltb", "6.3.1_buckling"] {
            let t = &toets(&tauri, id_nvt)["kind"]["data"];
            assert!(t["uc"].is_null(), "{naam}: {id_nvt} hoort geen unity check te hebben");
        }
    }
    let _ = child.kill().await;
}

/// Dezelfde strip als trek-alleen staaf, met in een tweede combinatie een
/// kleine druk (0,3 kN, speling): langs alle drie de wegen alleen de
/// trektoets (UC = 150/188,0) en de informatieve drukregel.
#[tokio::test]
async fn trek_alleen_strip_langs_de_drie_wegen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mut invoer = trekstaaf("Strip 80x10");
    let druk = json!({
        "combination_id": 4,
        "position_mm": 3000.0,
        "forces": { "n_ed": -0.3, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": 0.0, "mz_ed": 0.0 }
    });
    invoer["forces_envelope"].as_array_mut().unwrap().push(druk);
    invoer["tension_only"] = json!(true);
    let tauri = weg_tauri(&invoer);
    let brug = weg_toetsbrug(&invoer);
    let mcp = weg_mcp(&mut stdin, &mut reader, 30, invoer.clone()).await;
    assert_eq!(tauri, brug, "Tauri en toetsbrug lopen uiteen");
    assert_eq!(tauri, mcp, "Tauri en MCP lopen uiteen");
    let ids: Vec<&str> = tauri["checks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert_eq!(ids, vec!["6.2.3_tension", "trek_alleen"]);
    let uc = toets(&tauri, "6.2.3_tension")["kind"]["data"]["uc"]["uc"].as_f64().unwrap();
    assert!((uc - 150.0 / 188.0).abs() < 1e-12, "UC = {uc}");
    let _ = child.kill().await;
}
