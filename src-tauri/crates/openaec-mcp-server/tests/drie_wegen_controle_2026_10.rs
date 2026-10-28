//! De controle van oktober 2026 langs de drie wegen: de opgeslagen MCP-
//! aanroepen van de punten K3, K5, B6, B7 en B15
//! (`design-mockup/testdata/controle-2026-10/`) geven via het Tauri-command,
//! de toetsbrug en de MCP-server hetzelfde antwoord, met de HANDWAARDEN van
//! de controle als verwachting.
//!
//! HOE ELKE WEG WORDT AANGESPROKEN — gelijk aan `drie_wegen_hout.rs`:
//! * **Weg 1 (Tauri-command)**: de body van het command (inlezen in de
//!   Rust-typen, dan de kern).
//! * **Weg 2 (toetsbrug)**: `toetsbrug::behandel`.
//! * **Weg 3 (MCP)**: de werkelijke binary over stdio, `tools/call`.
//!
//! `check_fem_model` (B15, K5) bestaat alleen als MCP-gereedschap: het rekent
//! het model door met de solverbundel en toetst met dezelfde kern. Die twee
//! gevallen hangen af van de ingebakken bundel — na een wijziging in
//! `design-mockup/src` eerst `npm run build:sidecar` — en van Node.js.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Value};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

const K3: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k3-check-timber-beams.json");
const K5: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/k5-check-fem-model.json");
const B6_A: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b6-check-steel-beam-a.json");
const B6_B: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b6-check-steel-beam-b.json");
const B7: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b7-check-steel-beam.json");
const B15: &str = include_str!("../../../../design-mockup/testdata/controle-2026-10/b15-check-fem-model.json");

fn argumenten(json: &str) -> Value {
    let v: Value = serde_json::from_str(json).expect("geldige JSON");
    v["arguments"].clone()
}

// ── De drie wegen ───────────────────────────────────────────────────────────

fn weg_tauri_staal(invoer: &Value) -> Value {
    let inputs: Vec<steel_check::BeamCheckInput> =
        serde_json::from_value(json!([invoer])).expect("BeamCheckInput");
    serde_json::to_value(&steel_check::check_all_beams(inputs)[0]).unwrap()
}

fn weg_tauri_hout(inputs: &Value) -> Value {
    let inputs: Vec<timber_check::TimberBeamCheckInput> =
        serde_json::from_value(inputs.clone()).expect("TimberBeamCheckInput");
    serde_json::to_value(timber_check::check_all_timber_beams(inputs)).unwrap()
}

fn weg_toetsbrug(opdracht: &str, inputs: Value) -> Value {
    let verzoek: toetsbrug::Verzoek =
        serde_json::from_value(json!({ "opdracht": opdracht, "inputs": inputs })).unwrap();
    toetsbrug::behandel(verzoek).unwrap_or_else(|e| panic!("toetsbrug {opdracht}: {e}"))
}

async fn lees_bericht<R: AsyncBufReadExt + Unpin>(reader: &mut R) -> Value {
    let mut regel = String::new();
    let n = timeout(Duration::from_secs(120), reader.read_line(&mut regel))
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
                "clientInfo": { "name": "drie-wegen-controle-2026-10", "version": "0.0.0" }
            }
        }),
    )
    .await;
    let resp = lees_bericht(&mut reader).await;
    assert!(resp["error"].is_null(), "initialize gaf een fout: {resp:?}");
    (child, stdin, reader)
}

async fn weg_mcp(
    stdin: &mut ChildStdin,
    reader: &mut BufReader<ChildStdout>,
    id: u32,
    tool: &str,
    argumenten: Value,
) -> Value {
    schrijf(
        stdin,
        json!({
            "jsonrpc": "2.0", "id": id, "method": "tools/call",
            "params": { "name": tool, "arguments": argumenten }
        }),
    )
    .await;
    let resp = lees_bericht(reader).await;
    assert_eq!(resp["id"], id);
    assert_eq!(resp["result"]["isError"], false, "{tool} gaf een fout: {resp}");
    resp["result"]["structuredContent"].clone()
}

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

// ── Opzoeken in een antwoord ───────────────────────────────────────────────

fn toets<'a>(r: &'a Value, id: &str) -> &'a Value {
    &r["checks"]
        .as_array()
        .and_then(|c| c.iter().find(|t| t["id"] == id))
        .unwrap_or_else(|| panic!("toets {id} ontbreekt in {r}"))["kind"]["data"]
}

fn getal(v: &Value, pad: &[&str]) -> f64 {
    let mut w = v;
    for p in pad {
        w = &w[*p];
    }
    w.as_f64().unwrap_or_else(|| panic!("geen getal op {pad:?}: {v}"))
}

fn dichtbij(werkelijk: f64, hand: f64, rel: f64, wat: &str) {
    assert!(
        (werkelijk - hand).abs() <= rel * hand.abs(),
        "{wat}: {werkelijk} tegen hand {hand} (toegestaan {} %)",
        rel * 100.0
    );
}

// ── Staal: B6 en B7 ─────────────────────────────────────────────────────────

/// B6: M_y,V,Rd volgens (6.30) = 130,70 kNm; UC 0,765 (run b) en 1,530 bij
/// x = 1000 mm (run a), beide als M_y,Ed/M_y,V,Rd. B7: IPE 300 S355 in klasse
/// 4 met A_eff = 5269 mm², N_c,Rd = 1870,5 kN, N_b,Rd = 936,0 kN, UC 0,534.
#[tokio::test]
async fn staal_b6_en_b7_langs_de_drie_wegen() {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mut id = 10;
    let mut uitkomst = Vec::new();
    for invoer in [argumenten(B6_B), argumenten(B6_A), argumenten(B7)] {
        let tauri = weg_tauri_staal(&invoer);
        let brug = weg_toetsbrug("check_steel_beams", json!([invoer.clone()]))[0].clone();
        id += 1;
        let mcp = weg_mcp(&mut stdin, &mut reader, id, "check_steel_beam", invoer).await;
        assert_eq!(tauri, brug, "Tauri en toetsbrug lopen uiteen");
        assert_eq!(tauri, mcp, "Tauri en MCP lopen uiteen");
        uitkomst.push(tauri);
    }
    let _ = child.kill().await;

    let (b, a, k4) = (&uitkomst[0], &uitkomst[1], &uitkomst[2]);
    let mv_b = toets(b, "6.2.8_combined_mv");
    dichtbij(getal(mv_b, &["value"]), 130.70, 5e-4, "B6 M_y,V,Rd");
    dichtbij(getal(mv_b, &["uc", "uc"]), 0.765, 2e-3, "B6 run b UC");
    assert_eq!(mv_b["status"], "Ok");
    assert_eq!(mv_b["uc"]["formula_latex"], r"M_{y,Ed} / M_{y,V,Rd}");
    assert_eq!(b["status"], "Ok");

    let mv_a = toets(a, "6.2.8_combined_mv");
    dichtbij(getal(mv_a, &["uc", "uc"]), 1.530, 2e-3, "B6 run a UC");
    assert_eq!(mv_a["uc"]["formula_latex"], r"M_{y,Ed} / M_{y,V,Rd}");
    assert_eq!(a["status"], "NotOk");

    assert_eq!(k4["classification"], "Class4");
    assert_eq!(k4["status"], "Ok");
    dichtbij(getal(toets(k4, "6.2.4_compression"), &["value"]), 1870.5, 5e-4, "B7 N_c,Rd");
    dichtbij(getal(toets(k4, "6.3.1_buckling"), &["value"]), 936.0, 2e-3, "B7 N_b,Rd");
    dichtbij(getal(k4, &["uc_max"]), 0.534, 2e-3, "B7 uc_max");
}

/// B7, lijfplooi: IPE 600 S460 (h_w/t_w = 46,8 > 72ε/η = 42,9), N = −1500 kN,
/// M_y = 600 kNm. Met V_z = 2600 kN > V_pl,z,Rd = 8380·460/√3 = 2225,57 kN
/// voldoet de staaf niet (UC 1,1682, de bovengrens van 6.2.6(1)); met V_z =
/// 1500 kN is hij NIET VOLLEDIG GETOETST (n.v.t.) — langs geen enkele weg
/// "voldoet". En 6.2.10 met N = 0 (B6 run a) heeft dezelfde UC als 6.2.8.
#[tokio::test]
async fn staal_b7_lijfplooi_en_b6_6_2_10_langs_de_drie_wegen() {
    let ipe600 = |v_z: f64| {
        let mut a = argumenten(B6_B);
        a["profile_name"] = json!("IPE600");
        a["steel_grade"] = json!("S460");
        a["length_m"] = json!(6.0);
        a["forces_envelope"] = json!([0.0, 3000.0, 6000.0].iter().map(|&x: &f64| json!({
            "combination_id": 1, "position_mm": x,
            "forces": { "n_ed": -1500.0, "vy_ed": 0.0, "vz_ed": v_z, "mt_ed": 0.0,
                        "my_ed": if x == 3000.0 { 600.0 } else { 0.0 }, "mz_ed": 0.0 }
        })).collect::<Vec<_>>());
        a["lateral_bracing"] = json!({
            "top_flange_positions": [0.0, 0.25, 0.5, 0.75, 1.0],
            "bottom_flange_positions": [0.0, 0.25, 0.5, 0.75, 1.0]
        });
        a
    };
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mut uitkomst = Vec::new();
    for (id, invoer) in [(20, ipe600(2600.0)), (21, ipe600(1500.0)), (22, argumenten(B6_A))] {
        let tauri = weg_tauri_staal(&invoer);
        let brug = weg_toetsbrug("check_steel_beams", json!([invoer.clone()]))[0].clone();
        let mcp = weg_mcp(&mut stdin, &mut reader, id, "check_steel_beam", invoer).await;
        assert_eq!(tauri, brug, "Tauri en toetsbrug lopen uiteen");
        assert_eq!(tauri, mcp, "Tauri en MCP lopen uiteen");
        uitkomst.push(tauri);
    }
    let _ = child.kill().await;

    let (boven, onder, b6a) = (&uitkomst[0], &uitkomst[1], &uitkomst[2]);
    assert_eq!(boven["status"], "NotOk");
    assert_eq!(boven["governing_check_id"], "6.2.6_shear_z");
    dichtbij(getal(toets(boven, "6.2.6_shear_z"), &["value"]), 2225.57, 1e-5, "B7 V_pl,z,Rd");
    dichtbij(getal(boven, &["uc_max"]), 1.1682, 1e-4, "B7 uc_max");
    assert_eq!(onder["status"], "NotApplicable");
    assert!(
        onder["governing_check_id"].as_str().unwrap().starts_with("NIET VOLLEDIG GETOETST: lijfplooi"),
        "{}",
        onder["governing_check_id"]
    );
    let (mv, mnv) = (toets(b6a, "6.2.8_combined_mv"), toets(b6a, "6.2.10_combined_mnv"));
    dichtbij(getal(mnv, &["uc", "uc"]), getal(mv, &["uc", "uc"]), 1e-9, "B6 6.2.10 = 6.2.8");
    assert_ne!(mnv["uc"]["formula_latex"], r"1/\lambda");
}

// ── Hout: K3 ────────────────────────────────────────────────────────────────

/// K3: (6.17) = 0,54801 (staaf 1, voldoet) en 1,09603 (staaf 2, voldoet niet).
#[tokio::test]
async fn hout_k3_langs_de_drie_wegen() {
    let inputs = argumenten(K3)["inputs"].clone();
    let tauri = weg_tauri_hout(&inputs);
    let brug = weg_toetsbrug("check_timber_beams", inputs.clone());
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mcp = weg_mcp(&mut stdin, &mut reader, 30, "check_timber_beams", json!({ "inputs": inputs })).await;
    let _ = child.kill().await;
    assert_eq!(tauri, brug, "Tauri en toetsbrug lopen uiteen");
    // De MCP-server verpakt de lijst; vergelijk staaf voor staaf.
    let lijst = mcp.get("results").unwrap_or(&mcp);
    assert_eq!(&tauri, lijst, "Tauri en MCP lopen uiteen");

    for (i, hand, status) in [(0, 0.54801, "Ok"), (1, 1.09603, "NotOk")] {
        let r = &tauri[i];
        let t = toets(r, "6.2.3_bending_tension");
        dichtbij(getal(t, &["uc", "uc"]), hand, 1e-4, "K3 (6.17)");
        assert_eq!(r["governing_check_id"], "6.2.3_bending_tension");
        assert_eq!(r["status"], status);
        // Bijpunt: geen drukwaarden bij een trekstaaf.
        assert!(toets(r, "6.1.4_compression")["uc"].is_null());
        assert!(toets(r, "6.3.2_column_stability")["uc"].is_null());
    }
}

/// K3, druk: staaf 1 met N = −40 kN. (6.19)/(6.20) op doorsnedeniveau, met de
/// hand: f_c,0,d = 15,36 N/mm², (σ_c/f_c)² = 0,025841, σ_m/f_m = 0,365343;
/// (6.19) = 0,391184 en (6.20) = 0,281581. Langs alle drie de wegen gelijk.
#[tokio::test]
async fn hout_k3_druk_met_buiging_langs_de_drie_wegen() {
    let mut inputs = argumenten(K3)["inputs"].clone();
    let lijst = inputs.as_array_mut().unwrap();
    lijst.truncate(1);
    for p in lijst[0]["forces_envelope"].as_array_mut().unwrap() {
        p["forces"]["n_ed"] = json!(-40.0);
    }
    let tauri = weg_tauri_hout(&inputs);
    let brug = weg_toetsbrug("check_timber_beams", inputs.clone());
    let (mut child, mut stdin, mut reader) = start_server().await;
    let mcp = weg_mcp(&mut stdin, &mut reader, 31, "check_timber_beams", json!({ "inputs": inputs })).await;
    let _ = child.kill().await;
    assert_eq!(tauri, brug, "Tauri en toetsbrug lopen uiteen");
    assert_eq!(&tauri, mcp.get("results").unwrap_or(&mcp), "Tauri en MCP lopen uiteen");

    let t = toets(&tauri[0], "6.2.4_bending_compression");
    dichtbij(getal(t, &["uc", "uc"]), 0.391184, 1e-5, "K3 (6.19)");
    let var = |sym: &str| {
        t["variables"]
            .as_array()
            .and_then(|v| v.iter().find(|x| x["symbol"] == sym))
            .and_then(|x| x["value"].as_f64())
            .unwrap_or_else(|| panic!("{sym}"))
    };
    dichtbij(var(r"f_{c,0,d}"), 15.36, 1e-9, "K3 f_c,0,d");
    dichtbij(var("(6.20)"), 0.281581, 1e-5, "K3 (6.20)");
    assert_eq!(t["status"], "Ok");
    assert!(toets(&tauri[0], "6.2.3_bending_tension")["uc"].is_null());
}

// ── check_fem_model: B15 en K5 ──────────────────────────────────────────────

async fn check_fem_model(argumenten: Value) -> Value {
    let (mut child, mut stdin, mut reader) = start_server().await;
    let uit = weg_mcp(&mut stdin, &mut reader, 40, "check_fem_model", argumenten).await;
    let _ = child.kill().await;
    uit
}

/// B15: IPE 300 vloerligger, L = 6 m. Hand: w_fin = 14,75 mm tegen L/250 =
/// 24 mm → UC 0,614; w_add = 5,13 mm tegen 18 mm → UC 0,285. De toetsinvoer
/// noemt de noemer die de kern toetst: 250.
#[tokio::test]
async fn b15_vloerligger_via_check_fem_model() {
    eis_node().await;
    let uit = check_fem_model(argumenten(B15)).await;
    let r = &uit["results"][0];
    let fin = toets(r, "deflection_w_fin");
    dichtbij(getal(fin, &["uc", "rd"]), 24.0, 1e-12, "B15 grens w_fin");
    dichtbij(getal(fin, &["uc", "uc"]), 0.614, 2e-3, "B15 UC w_fin");
    let add = toets(r, "deflection_w_add");
    dichtbij(getal(add, &["uc", "rd"]), 18.0, 1e-12, "B15 grens w_add");
    dichtbij(getal(add, &["uc", "uc"]), 0.285, 3e-3, "B15 UC w_add");
    assert_eq!(uit["steel_check_inputs"][0]["deflection_limit_numerator"], 250);
}

/// K5: uitkraging HEA 200, L = 3 m. Hand: zakking van het vrije eind w_fin =
/// 18,14 mm (de oude koordemaat gaf 3,25 mm), w_add = 11,61 mm; ℓ_rep = 6000 mm
/// voor beide grenzen: 24 mm (UC 0,756) en 18 mm (UC 0,645).
#[tokio::test]
async fn k5_uitkraging_via_check_fem_model() {
    eis_node().await;
    let uit = check_fem_model(argumenten(K5)).await;
    let invoer = &uit["steel_check_inputs"][0];
    assert_eq!(invoer["is_cantilever"], true);
    dichtbij(getal(invoer, &["deflection_actual_max_mm"]).abs(), 18.14, 2e-3, "K5 w");
    let r = &uit["results"][0];
    let fin = toets(r, "deflection_w_fin");
    dichtbij(getal(fin, &["uc", "ed"]), 18.14, 2e-3, "K5 w_fin");
    dichtbij(getal(fin, &["uc", "rd"]), 24.0, 1e-12, "K5 grens w_fin");
    dichtbij(getal(fin, &["uc", "uc"]), 0.756, 3e-3, "K5 UC w_fin");
    let add = toets(r, "deflection_w_add");
    dichtbij(getal(add, &["uc", "ed"]), 11.61, 2e-3, "K5 w_add");
    dichtbij(getal(add, &["uc", "rd"]), 18.0, 1e-12, "K5 grens w_add");
    dichtbij(getal(add, &["uc", "uc"]), 0.645, 3e-3, "K5 UC w_add");
    let notities = fin["notes"].as_array().unwrap();
    assert!(
        notities.iter().any(|n| n.as_str().unwrap_or("").starts_with("Uitkraging: w is de zakking")),
        "{notities:?}"
    );
    assert!(notities.iter().all(|n| !n.as_str().unwrap_or("").starts_with("w is gemeten vanaf de koorde")));
}

/// B7: "maatgevend" (`governing`) van `check_fem_model` slaat een staaf met
/// status n.v.t. over. Staaf 2 is een CHS 323,9×6,3 in S460: d/t = 51,4 >
/// 90ε² = 46,0, dus klasse 4, en voor een buis zijn de effectieve breedtes
/// niet uitgewerkt — NIET TOETSBAAR, met alleen trek, dwarskracht en de
/// doorbuiging gerekend (UC van de doorbuiging ruim 0,4). Staaf 1, een licht
/// belaste IPE 300, is volledig getoetst met een veel kleinere UC. Maatgevend
/// is staaf 1: een UC van een niet getoetste staaf is geen uitkomst.
#[tokio::test]
async fn b7_maatgevend_slaat_een_niet_getoetste_staaf_over() {
    eis_node().await;
    let uit = check_fem_model(json!({
        "model": {
            "nodes": [
                { "id": 1, "x": 0, "z": 0 }, { "id": 2, "x": 3000, "z": 0 },
                { "id": 3, "x": 0, "z": 2000 }, { "id": 4, "x": 8000, "z": 2000 }
            ],
            "beams": [
                { "id": 1, "from": 1, "to": 2, "material": "S235", "profile": "IPE300" },
                { "id": 2, "from": 3, "to": 4, "material": "S460", "profile": "CHS 323.9x6.3" }
            ],
            "supports": [
                { "nodeId": 1, "type": "pinned" }, { "nodeId": 2, "type": "zRoller" },
                { "nodeId": 3, "type": "pinned" }, { "nodeId": 4, "type": "zRoller" }
            ],
            "loadCases": [{ "id": 1, "name": "Permanent", "type": "dead" }],
            "loads": [
                { "id": 1, "type": "lineLoad", "beamId": 1, "caseId": 1, "q": -1 },
                { "id": 2, "type": "lineLoad", "beamId": 2, "caseId": 1, "q": -5 }
            ],
            "selfWeightEnabled": false
        }
    }))
    .await;
    let resultaten = uit["results"].as_array().expect("results");
    let staaf = |id: u64| resultaten.iter().find(|r| r["beam_id"] == id).unwrap_or_else(|| panic!("staaf {id}: {uit}"));
    let (gewoon, buis) = (staaf(1), staaf(2));
    assert_eq!(buis["classification"], "Class4");
    assert_eq!(buis["status"], "NotApplicable");
    assert!(buis["governing_check_id"].as_str().unwrap().starts_with("NIET TOETSBAAR"), "{}", buis["governing_check_id"]);
    assert_eq!(gewoon["status"], "Ok");
    let (uc_gewoon, uc_buis) = (getal(gewoon, &["uc_max"]), getal(buis, &["uc_max"]));
    assert!(uc_buis > uc_gewoon, "de proef vraagt een hogere uc_max bij de niet getoetste staaf: {uc_buis} tegen {uc_gewoon}");
    let maatgevend = &uit["governing"];
    assert_eq!(maatgevend["beam_id"], 1, "{maatgevend}");
    dichtbij(getal(maatgevend, &["uc_max"]), uc_gewoon, 1e-12, "maatgevende UC");
}

/// K5: `check_fem_model` met `beam_ids` op een houten ligger die van een
/// scharnier naar een kolomkop loopt. De kolom valt buiten de selectie, maar
/// draagt de ligger nog steeds: geen uitkraging, dus de vloernoemers 250/333 op
/// de staaflengte en de meting vanaf de koorde. Tot de herziening zag de
/// houtbouwer alleen de selectie en gaf hij 125/166,5 ("Uitkraging").
#[tokio::test]
async fn k5_hout_met_beam_ids_is_geen_uitkraging() {
    eis_node().await;
    let uit = check_fem_model(json!({
        "model": {
            "nodes": [{ "id": 1, "x": 0, "z": 0 }, { "id": 2, "x": 4000, "z": 0 }, { "id": 3, "x": 4000, "z": -3000 }],
            "beams": [
                { "id": 1, "from": 1, "to": 2, "material": "C24", "profile": "100x300", "checkConfig": { "serviceClass": 1 } },
                { "id": 2, "from": 3, "to": 2, "material": "C24", "profile": "200x200", "checkConfig": { "serviceClass": 1 } }
            ],
            "supports": [{ "nodeId": 1, "type": "pinned" }, { "nodeId": 3, "type": "fixed" }],
            "loadCases": [{ "id": 1, "name": "G", "type": "dead" }, { "id": 2, "name": "Q", "type": "live" }],
            "loads": [
                { "id": 1, "type": "lineLoad", "beamId": 1, "caseId": 1, "q": -1 },
                { "id": 2, "type": "lineLoad", "beamId": 1, "caseId": 2, "q": -1.5 }
            ],
            "selfWeightEnabled": false
        },
        "beam_ids": [1]
    }))
    .await;
    let invoer = &uit["timber_check_inputs"][0];
    assert_eq!(invoer["beam_id"], 1);
    dichtbij(getal(invoer, &["deflection_limit_fin"]), 250.0, 1e-12, "w_fin-noemer");
    dichtbij(getal(invoer, &["deflection_limit_add"]), 333.0, 1e-12, "w_add-noemer");
    let notities = invoer["deflection_notes"].as_array().unwrap();
    assert!(
        notities[0].as_str().unwrap_or("").starts_with("w is gemeten vanaf de koorde"),
        "{notities:?}"
    );
}
