//! Kip bij klasse 3 langs de drie wegen: een HEA 300 in S355 (flenzen in
//! klasse 3) geeft via het Tauri-command, de toetsbrug en de MCP-server
//! dezelfde kiptoets, met W_el,y in λ̄_LT en M_b,Rd (art. 6.3.2.1(3)) en
//! M_y,Rk = W_el,y·f_y in 6.3.3 (tabel 6.7).
//!
//! HOE ELKE WEG WORDT AANGESPROKEN — gelijk aan `drie_wegen_strip.rs`:
//! * **Weg 1 (Tauri-command)**: de body van `check_steel_beams` uit
//!   `src-tauri/src/lib.rs` (inlezen in de Rust-typen, dan de kern).
//! * **Weg 2 (toetsbrug)**: `toetsbrug::behandel`.
//! * **Weg 3 (MCP)**: de werkelijke binary over stdio, `tools/call`.
//!
//! Er komt geen invoerveld bij: de klasse volgt in de kern uit profiel,
//! staalsoort en krachten. Deze test bewaakt dat de drie wegen dezelfde kern
//! raken.

use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

/// HEA 300 van 6 m tussen gaffels, overal M_y = 380 kNm, en normaalkracht
/// `n_kn` (trek positief).
fn ligger(n_kn: f64) -> Value {
    let punt = |x_mm: f64| {
        json!({
            "combination_id": 1,
            "position_mm": x_mm,
            "forces": { "n_ed": n_kn, "vy_ed": 0.0, "vz_ed": 0.0, "mt_ed": 0.0, "my_ed": 380.0, "mz_ed": 0.0 }
        })
    };
    json!({
        "beam_id": 7,
        "profile_name": "HEA 300",
        "steel_grade": "S355",
        "length_m": 6.0,
        "forces_envelope": [punt(0.0), punt(1500.0), punt(3000.0), punt(4500.0), punt(6000.0)],
        "lateral_bracing": { "top_flange_positions": [], "bottom_flange_positions": [] },
        "buckling_length_y_m": 6.0,
        "buckling_length_z_m": 6.0,
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
                "clientInfo": { "name": "drie-wegen-kip-klasse3", "version": "0.0.0" }
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

/// Met de hand (zie `steel-check/tests/kip_klasse3.rs` voor de hele keten):
/// M_cr = 726,2726 kNm, λ̄_LT = √(1 260 000·355/726,2726·10⁶) = 0,784783,
/// χ_LT = 0,825457, M_b,Rd = 0,825457·1 260 000·355 = 369,227 kNm,
/// UC = 380/369,227 = 1,029177. Met N_Ed = 200 kN druk: (6.61) = 1,112850 met
/// M_y,Rk = W_el,y·f_y = 447,300 kNm.
#[tokio::test]
async fn hea300_s355_kip_met_w_el_langs_de_drie_wegen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    for (id, n_kn) in [(11_u32, 0.0), (12, -200.0)] {
        let invoer = ligger(n_kn);
        let tauri = weg_tauri(&invoer);
        let brug = weg_toetsbrug(&invoer);
        let mcp = weg_mcp(&mut stdin, &mut reader, id, invoer.clone()).await;
        assert_eq!(tauri, brug, "N = {n_kn}: Tauri en toetsbrug lopen uiteen");
        assert_eq!(tauri, mcp, "N = {n_kn}: Tauri en MCP lopen uiteen");
        assert_eq!(tauri["classification"], "Class3", "N = {n_kn}");

        let kip = toets(&tauri, "6.3.2_ltb");
        assert_eq!(
            kip["formula_latex"],
            r"M_{b,Rd} = \chi_{LT} \cdot W_{el,y} \cdot f_y / \gamma_{M1}"
        );
        assert!((variabele(kip, "W_{el,y}") - 1_260_000.0).abs() < 1e-6);
        let m_b_rd = kip["value"].as_f64().unwrap();
        assert!((m_b_rd - 369.2270).abs() < 1e-3, "N = {n_kn}: M_b,Rd = {m_b_rd}");
        let uc = kip["uc"]["uc"].as_f64().unwrap();
        assert!((uc - 1.029177).abs() < 1e-5, "N = {n_kn}: UC = {uc}");
        if n_kn < 0.0 {
            let t61 = toets(&tauri, "6.3.3_eq_6_61");
            assert!((variabele(t61, "M_{y,Rk}") - 447.3).abs() < 1e-9);
            let uc61 = t61["uc"]["uc"].as_f64().unwrap();
            assert!((uc61 - 1.112850).abs() < 1e-5, "6.61 = {uc61}");
        }
    }
    let _ = child.kill().await;
}
