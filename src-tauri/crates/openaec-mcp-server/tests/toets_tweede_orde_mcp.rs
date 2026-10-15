//! De UGT-toets van `check_fem_model` rekent altijd tweede orde (P-Δ) met
//! scheefstand — end-to-end over de echte binary.
//!
//! WAT HIER VASTLIGT
//! NEN-EN 1993-1-1 5.2.2(3)b en (7)b: de staaftoets met de systeemlengte als
//! kniklengte hoort bij krachten uit een tweede-ordeberekening met de globale
//! imperfecties van 5.3.2. Tot deze regel toetste `check_fem_model` met de
//! krachten van de resultaatberekening, en een los model rekent eerste orde
//! zonder scheefstand: voor een vrijstaande kolom gaf dat het eerste-ordemoment
//! en, met een vrije kop, 2·L. Nu:
//!   1. de toetsanalyse staat in `stability` (`analysis_type`,
//!      `model_analysis_type`, `scheefstand`, `hergebruikt`), met de
//!      toelichtingen en een vaste regel in `warnings`;
//!   2. de toetskrachten zijn P-Δ met φ = 1/200 in +x en −x (handberekening
//!      hieronder), de resultaten van `solve_fem_model` blijven eerste orde;
//!   3. `nonlinear` bestaat niet bij `check_fem_model` en wordt geweigerd;
//!      `solve_fem_model` levert geen `steel_check_inputs` meer;
//!   4. divergeert de toets (α_cr < 1), dan TOETSING_GEWEIGERD met de reden per
//!      combinatie, terwijl de resultaten gewoon rekenen;
//!   5. een bundel die de toetsanalyse niet meldt (een bundel van vóór deze
//!      regel) geeft TOETSING_ONMOGELIJK in plaats van een toetsing;
//!   6. de teksten (taak 7): de analysetoelichting noemt de resultaten en de
//!      toetskrachten elk op een eigen regel, α_cr is informatief (geen FOUT
//!      bij `solve_fem_model`, B14), en `toetskrachten` gaat ongewijzigd naar
//!      `generate_steel_report_pdf`.
//!
//! LET OP: dit hangt af van de ingebakken solverbundel. Na een wijziging in
//! `design-mockup/src/mcp/sidecar.ts` of `lib/toetsKrachten.ts` eerst
//! `npm run build:sidecar`, anders meet deze test de oude bundel. Node ≥ 20 is
//! een harde eis; ontbreekt hij, dan faalt de test met die melding.

use openaec_mcp_server::sidecar::{self, SidecarOpties};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
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

/// Eén toolaanroep op een verse server, met extra omgevingsvariabelen; geeft
/// het `result`-object terug (een toolfout staat daarin met `isError`).
async fn roep_tool_met(naam: &str, argumenten: Value, omgeving: &[(&str, &Path)]) -> Value {
    let mut cmd = Command::new(BIN_PATH);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    for (sleutel, waarde) in omgeving {
        cmd.env(sleutel, waarde);
    }
    if !omgeving.is_empty() {
        // Een aangewezen bundel met een andere hash mag alleen bewust draaien.
        cmd.env("OPENAEC_FEM_STA_DRIFT_TOE", "1");
    }
    let mut kind = cmd.spawn().expect("de MCP-server starten");
    let mut stdin = kind.stdin.take().expect("stdin");
    let mut reader = BufReader::new(kind.stdout.take().expect("stdout"));

    for bericht in [
        json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18", "capabilities": {},
                "clientInfo": { "name": "toets-tweede-orde", "version": "0.0.0" }
            }
        }),
        json!({
            "jsonrpc": "2.0", "id": 2, "method": "tools/call",
            "params": { "name": naam, "arguments": argumenten }
        }),
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
            assert!(bericht["error"].is_null(), "een toolfout hoort in `result` te staan: {bericht}");
            antwoord = bericht["result"].clone();
        }
    }
    drop(stdin);
    let _ = timeout(Duration::from_secs(10), kind.wait()).await;
    antwoord
}

async fn roep_tool(naam: &str, argumenten: Value) -> Value {
    roep_tool_met(naam, argumenten, &[]).await
}

/// De inhoud van een geslaagde aanroep.
fn inhoud(resultaat: &Value) -> &Value {
    assert_eq!(
        resultaat["isError"],
        json!(false),
        "deze aanroep hoort te slagen: {}",
        resultaat["content"][0]["text"]
    );
    &resultaat["structuredContent"]
}

/// De foutinhoud van een mislukte aanroep.
fn foutinhoud(resultaat: &Value) -> &Value {
    assert_eq!(resultaat["isError"], json!(true), "deze aanroep had moeten mislukken: {resultaat}");
    &resultaat["structuredContent"]
}

// ── Het model: een ingeklemde HEA 200-kolom met een vrije kop ───────────────
//
// h = 4000 mm, S235, G op de kop (verticaal) en W op de kop (horizontaal 5 kN).
// Combinaties: 1 = 1,35·G, 2 = 1,2·G + 1,5·W (UGT) en 3 = G + W (BGT).
//
// HANDBEREKENING bij G = 200 kN, combinatie 2 in +x:
//   N_Ed = 1,2 · 200 = 240 kN;  H = 1,5 · 5 + φ·N_Ed = 7,5 + 240/200 = 8,7 kN
//   M_I  = 8,7 · 4 = 34,8 kNm (eerste orde met scheefstand)
//   HEA 200: I_y = 36,92·10⁶ mm⁴ → N_cr = π²·E·I/(2h)² = 1 195,6 kN
//   M_II ligt tussen M_I en M_I/(1 − N/N_cr) = 34,8/(1 − 0,2007) = 43,5 kNm.
// De resultaten (eerste orde, geen scheefstand) geven 1,5 · 5 · 4 = 30 kNm.
fn kolom(g_kn: f64) -> Value {
    json!({
        "nodes": [ { "id": 1, "x": 0, "z": 0 }, { "id": 2, "x": 0, "z": 4000 } ],
        "beams": [ { "id": 1, "from": 1, "to": 2, "material": "S235", "profile": "HEA200" } ],
        "supports": [ { "nodeId": 1, "type": "fixed" } ],
        "loadCases": [
            { "id": 1, "name": "G", "type": "dead" },
            { "id": 2, "name": "W", "type": "wind" }
        ],
        "loads": [
            { "id": 1, "type": "pointForce", "caseId": 1, "nodeId": 2, "fz": -g_kn },
            { "id": 2, "type": "pointForce", "caseId": 2, "nodeId": 2, "fx": 5 }
        ]
    })
}

fn combinaties() -> Value {
    json!([
        { "id": 1, "name": "1,35G", "type": "uls", "factors": { "1": 1.35 } },
        { "id": 2, "name": "1,2G+1,5W", "type": "uls", "factors": { "1": 1.2, "2": 1.5 } },
        { "id": 3, "name": "G+W", "type": "sls", "factors": { "1": 1.0, "2": 1.0 } }
    ])
}

/// De grootste |M_y,Ed| van combinatie `id` in de krachtenomhullende (kNm).
fn m_max(invoer: &Value, id: i64) -> f64 {
    invoer["forces_envelope"]
        .as_array()
        .expect("forces_envelope")
        .iter()
        .filter(|p| p["combination_id"].as_i64() == Some(id))
        .map(|p| p["forces"]["my_ed"].as_f64().unwrap_or(0.0).abs())
        .fold(0.0, f64::max)
}

// ── 6. Teksten: α_cr informatief, en de PDF met de toetskrachten ────────────

/// `solve_fem_model` rekent de resultaten eerste orde; met α_cr = 4,4 < 10
/// (N_cr = 1 195,6 kN, N_Ed = 1,35 · 200 = 270 kN) was dat tot 2026.42 de FOUT
/// "EERSTE ORDE NIET TOEGESTAAN". Sinds issue #199 (B14) is het een
/// informatieve regel over de resultaten: de toets rekent altijd tweede orde.
#[tokio::test]
async fn solve_meldt_alpha_cr_informatief_zonder_fout() {
    eis_node().await;
    let r = roep_tool(
        "solve_fem_model",
        json!({ "model": kolom(200.0), "combinations": combinaties() }),
    )
    .await;
    let d = inhoud(&r);
    let warnings: Vec<&str> = d["warnings"].as_array().expect("warnings").iter().filter_map(Value::as_str).collect();
    assert!(
        !warnings.iter().any(|w| w.starts_with("FOUT:") || w.contains("NIET TOEGESTAAN")),
        "geen FOUT over eerste orde meer (B14): {warnings:?}"
    );
    assert!(
        warnings.iter().any(|w| w.starts_with("α_cr = ") && w.contains("de resultaten zijn eerste orde")),
        "de informatieve regel over α_cr van de resultaten ontbreekt: {warnings:?}"
    );
}

/// De drie wegen naar het rapport: `toetskrachten` uit `check_fem_model` gaat
/// ongewijzigd naar `generate_steel_report_pdf` (het veld is streng:
/// `deny_unknown_fields`), samen met de toelichtingen.
#[tokio::test]
async fn toetskrachten_gaan_ongewijzigd_naar_het_rapport() {
    eis_node().await;
    let c = roep_tool(
        "check_fem_model",
        json!({ "model": kolom(200.0), "combinations": combinaties() }),
    )
    .await;
    let d = inhoud(&c).clone();
    let r = roep_tool(
        "generate_steel_report_pdf",
        json!({
            "project_name": "Kolom", "project_number": "TK-199", "engineer": "Constructeur",
            "company": "Ontwerpbureau", "date": "2026-10-15",
            "steel_check_results": d["results"],
            "analyse_toelichting": d["analyse_toelichting"],
            "scheefstand_toelichting": d["scheefstand_toelichting"],
            "toetskrachten": d["toetskrachten"],
        }),
    )
    .await;
    let pdf = inhoud(&r);
    assert!(
        pdf["byte_count"].as_u64().unwrap_or(0) > 1000,
        "het rapport hoort gezet te worden met de toetskrachten: {pdf}"
    );
}

// ── 1 en 2. Een eerste-ordemodel toetst met P-Δ en scheefstand ──────────────

#[tokio::test]
async fn een_eerste_ordemodel_toetst_met_tweede_orde_en_scheefstand() {
    eis_node().await;
    let r = roep_tool(
        "check_fem_model",
        json!({ "model": kolom(200.0), "combinations": combinaties() }),
    )
    .await;
    let d = inhoud(&r);

    // ── De toetsanalyse ───────────────────────────────────────────────────
    let s = &d["stability"];
    assert_eq!(s["analysis_type"], "tweedeOrdeGeometrisch", "{s}");
    assert_eq!(s["model_analysis_type"], "eersteOrde", "{s}");
    assert_eq!(s["hergebruikt"], false, "{s}");
    // φ = 1/200: de vaste noemer van de projectinstelling, ook met de
    // schakelaar uit (de beginstand van een model).
    let sch = &s["scheefstand"];
    assert_eq!(sch["phi"].as_f64(), Some(1.0 / 200.0), "{s}");
    assert_eq!(sch["noemer"].as_f64(), Some(200.0), "{s}");
    assert_eq!(sch["bron"], "vast", "{s}");
    assert_eq!(sch["model_scheefstand_aan"], false, "{s}");
    assert_eq!(sch["afgedwongen"], true, "{s}");
    // α_cr één keer per UGT-basiscombinatie (1 en 2), niet per richting.
    let ids: Vec<i64> = s["alpha_cr"]
        .as_array()
        .expect("alpha_cr")
        .iter()
        .filter_map(|u| u["combination_id"].as_i64())
        .collect();
    assert_eq!(ids, vec![1, 2], "{s}");
    assert_eq!(d["solve_summary"]["nonlinear_used"], false, "de resultaten zijn eerste orde");

    // ── Toelichtingen en de vaste regel ───────────────────────────────────
    let analyse = d["analyse_toelichting"].as_str().expect("analyse_toelichting");
    assert!(
        analyse.contains("Toetskrachten") && analyse.contains("1/200") && analyse.contains("1e orde"),
        "de analysetoelichting noemt resultaten én toets: {analyse}"
    );
    // Taak 7: dezelfde tekst als de app (`analyseToelichting`), met de
    // resultaten en de toetskrachten elk op een eigen regel.
    let regels: Vec<&str> = analyse.lines().collect();
    assert!(
        regels[0].starts_with("Resultaten: 1e orde, zonder scheefstand."),
        "regel 1 gaat over de resultaten: {analyse}"
    );
    assert!(
        regels[1].starts_with("Toetskrachten (UGT): 2e orde (P-Δ) met scheefstand φ = 1/200 (vaste noemer)"),
        "regel 2 gaat over de toetskrachten: {analyse}"
    );
    // De herkomst van de toetskrachten, in de vorm van het rapport.
    let tk = &d["toetskrachten"];
    assert_eq!(tk["noemer"].as_f64(), Some(200.0), "toetskrachten voor generate_steel_report_pdf: {tk}");
    assert_eq!(
        tk["tweede_orde_combinaties"],
        json!([1, 1_000_001, 2, 1_000_002]),
        "de UGT-toetscombinaties, ook in −x, niet de BGT: {tk}"
    );
    let scheef = d["scheefstand_toelichting"].as_str().expect("scheefstand_toelichting");
    assert!(scheef.contains("1/200") && scheef.contains("toets"), "{scheef}");
    let warnings: Vec<&str> = d["warnings"].as_array().expect("warnings").iter().filter_map(Value::as_str).collect();
    assert!(
        warnings.iter().any(|w| w.starts_with("Toetskrachten:") && w.contains("φ = 1/200")),
        "de vaste regel over de toetskrachten ontbreekt: {warnings:?}"
    );
    assert!(
        !warnings.iter().any(|w| w.starts_with("FOUT:") && w.contains("EERSTE ORDE")),
        "de toets rekent nooit eerste orde, dus geen FOUT daarover: {warnings:?}"
    );

    // ── De toetskrachten ──────────────────────────────────────────────────
    let invoer = &d["steel_check_inputs"][0];
    let combis: Vec<i64> = invoer["forces_envelope"]
        .as_array()
        .expect("forces_envelope")
        .iter()
        .filter_map(|p| p["combination_id"].as_i64())
        .collect();
    for id in [1, 2, 1_000_001, 1_000_002] {
        assert!(combis.contains(&id), "toetscombinatie {id} ontbreekt in de krachten: {combis:?}");
    }
    let m = m_max(invoer, 2);
    assert!(
        m > 34.8 * 1.05 && m <= 43.5 * (1.0 + 1e-6),
        "M_voet 1,2G+1,5W (+x) = {m} kNm; P-Δ met scheefstand ligt tussen M_I = 34,8 en M_I/(1 − N/N_cr) = 43,5"
    );
    assert!(m_max(invoer, 1_000_002) < m, "−x: de scheefstand tegen de wind in, dus minder moment");
    // Vrije kop, φ = 1/200 ≥ de eigen φ van een kolom van 4 m: L om y.
    assert_eq!(invoer["zijdelingse_knik_in_analyse"], json!({ "y": true, "z": false }), "{invoer}");

    // ── De resultaten blijven eerste orde, zonder toetsinvoer ─────────────
    let r = roep_tool("solve_fem_model", json!({ "model": kolom(200.0), "combinations": combinaties() })).await;
    let d = inhoud(&r);
    assert_eq!(d["stability"]["analysis_type"], "eersteOrde");
    assert!(d.get("steel_check_inputs").is_none(), "solve_fem_model levert geen toetsinvoer meer");
    assert!(d.get("skipped_beams").is_none(), "zonder toetsinvoer ook geen overgeslagen staven");
    let m_voet = d["combinations"]["2"]["reactions"]["1"]["my"].as_f64().expect("my").abs();
    assert!((m_voet - 30.0).abs() < 1e-9, "de resultaten: 1,5 · 5 · 4 = 30 kNm, niet {m_voet}");
}

// ── Hergebruik: het bestand rekent al P-Δ met de scheefstand aan ────────────

#[tokio::test]
async fn een_p_delta_bestand_met_scheefstand_wordt_hergebruikt() {
    eis_node().await;
    let model = kolom(200.0);
    let bestand = json!({
        "format": "open-fem-studio-v2",
        "version": 2,
        "savedAt": "2026-10-14T00:00:00Z",
        "nodes": model["nodes"],
        "beams": model["beams"],
        "supports": model["supports"],
        "plates": [],
        "loads": model["loads"],
        "loadCases": model["loadCases"],
        "combinations": combinaties(),
        "activeLoadCaseId": 1,
        "selfWeightEnabled": false,
        "nonlinearEnabled": true,
        "analysetype": "tweedeOrdeGeometrisch",
        "scheefstandEnabled": true,
        "scheefstandNoemer": 200,
        "scheefstandRichting": 1
    });
    let pad = std::env::temp_dir().join(format!("openaec-toets-hergebruik-{}.ifcfem", std::process::id()));
    std::fs::write(&pad, serde_json::to_string(&bestand).unwrap()).expect("proefbestand schrijven");

    let r = roep_tool("check_fem_model", json!({ "project_path": pad.to_string_lossy() })).await;
    let d = inhoud(&r);
    let s = &d["stability"];
    assert_eq!(s["analysis_type"], "tweedeOrdeGeometrisch", "{s}");
    assert_eq!(s["model_analysis_type"], "tweedeOrdeGeometrisch", "{s}");
    assert_eq!(s["hergebruikt"], true, "de resultaten zijn al P-Δ met dezelfde φ: {s}");
    assert_eq!(s["scheefstand"]["model_scheefstand_aan"], true, "{s}");
    assert_eq!(d["solve_summary"]["nonlinear_used"], true);
    let _ = std::fs::remove_file(&pad);
}

// ── 3. `nonlinear` bestaat niet bij check_fem_model ─────────────────────────

#[tokio::test]
async fn nonlinear_wordt_bij_check_fem_model_geweigerd() {
    // De argumenten worden vóór de sidecar gelezen: Node is hier niet nodig.
    let r = roep_tool(
        "check_fem_model",
        json!({ "model": kolom(200.0), "nonlinear": true }),
    )
    .await;
    let f = foutinhoud(&r);
    assert_eq!(f["error_code"], "ARGUMENT_ONGELDIG", "{f}");
    assert!(f["melding"].as_str().unwrap_or("").contains("nonlinear"), "{f}");
}

// ── 4. Divergentie: geen toetsing, wel resultaten ───────────────────────────

#[tokio::test]
async fn een_divergerende_toets_wordt_geweigerd_en_de_resultaten_rekenen() {
    eis_node().await;
    // G = 1100 kN: N_Ed = 1 485 kN (1,35·G) en 1 320 kN (1,2·G), beide boven
    // N_cr = 1 195,6 kN — α_cr < 1, de P-Δ van de toets heeft geen evenwicht.
    let r = roep_tool(
        "check_fem_model",
        json!({ "model": kolom(1100.0), "combinations": combinaties() }),
    )
    .await;
    let f = foutinhoud(&r);
    // Een eigen code: het model rekent (zie hieronder), de TOETS heeft geen
    // krachten. MODEL_ONOPLOSBAAR zou met "controleer de opleggingen" de
    // verkeerde kant op wijzen.
    assert_eq!(f["error_code"], "TOETSING_GEWEIGERD", "{f}");
    let remedie = f["remedie"].as_str().unwrap_or("");
    assert!(
        remedie.contains("wel doorgerekend") && remedie.contains("solve_fem_model") && !remedie.contains("opleggingen"),
        "de remedie hoort bij een geweigerde toets: {f}"
    );
    assert_eq!(f["detail"]["toets_geweigerd"], true, "{f}");
    let melding = f["melding"].as_str().unwrap_or("");
    assert!(
        melding.contains("De toetskrachten zijn niet te bepalen")
            && melding.contains("niet teruggevallen op eerste orde"),
        "{melding}"
    );
    let per = f["detail"]["per_combinatie"].as_array().expect("detail.per_combinatie");
    assert!(!per.is_empty(), "{f}");
    assert!(
        per.iter().all(|p| p["combination_id"].is_i64() && p["reason"].as_str().is_some()),
        "{f}"
    );
    assert!(
        per.iter().any(|p| p["reason"].as_str().unwrap_or("").contains("α_cr = 0,")),
        "de reden noemt α_cr < 1: {f}"
    );
    // α_cr ook als getal per combinatie (README: "de reden en α_cr in
    // detail.per_combinatie"): hand N_cr = 1 195,6 kN, N_Ed = 1 485 kN →
    // α_cr = 0,805 voor 1,35·G; elke variant draagt die van haar basis.
    assert!(
        per.iter().all(|p| p["alpha_cr"].as_f64().is_some_and(|a| a > 0.0 && a < 1.0)),
        "per combinatie een numeriek alpha_cr < 1: {f}"
    );
    assert_eq!(f["detail"]["stability"]["analysis_type"], "tweedeOrdeGeometrisch", "{f}");

    // De resultaten zelf (eerste orde) rekenen gewoon.
    let r = roep_tool("solve_fem_model", json!({ "model": kolom(1100.0), "combinations": combinaties() })).await;
    let d = inhoud(&r);
    assert_eq!(d["stability"]["analysis_type"], "eersteOrde");
}

// ── 5. Een oude bundel: TOETSING_ONMOGELIJK ─────────────────────────────────

/// Een nagemaakte bundel van vóór de afgedwongen toetsanalyse: hij praat het
/// protocol en antwoordt op `check` zoals een oude bundel, met de krachten van
/// de resultaatberekening en `analysis_type` van het model — zonder
/// `stability.scheefstand`.
fn schrijf_oude_bundel(map: &Path) -> PathBuf {
    let pad = map.join("oude-bundel.mjs");
    let script = r#"let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (brok) => {
  buffer += brok;
  let grens;
  while ((grens = buffer.indexOf("\n")) >= 0) {
    const regel = buffer.slice(0, grens);
    buffer = buffer.slice(grens + 1);
    if (!regel.trim()) continue;
    const v = JSON.parse(regel);
    const result = v.op === "handshake"
      ? { protocol: 1, node_version: "v0.0.0", bundle_version: "0.0.0-oud", bundle_hash: null }
      : {
          solve_summary: { cases_requested: [1], cases_solved: [1], cases_skipped_empty: [],
            combinations_skipped: [], nonlinear_used: false, solve_ms: 0 },
          stability: { analysis_type: "eersteOrde", alpha_cr: [] },
          steel_check_inputs: [], timber_check_inputs: [], clt_check_inputs: [],
          skipped_beams: [], plate_check_inputs: [], skipped_plates: [], warnings: [],
        };
    process.stdout.write(JSON.stringify({ v: 1, id: v.id, ok: true, result }) + "\n");
  }
});
process.stdin.resume();
"#;
    std::fs::write(&pad, script).expect("oude bundel schrijven");
    pad
}

#[tokio::test]
async fn een_bundel_zonder_toetsanalyse_geeft_toetsing_onmogelijk() {
    eis_node().await;
    let map = std::env::temp_dir().join(format!("openaec-toets-oude-bundel-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&map);
    std::fs::create_dir_all(&map).expect("tijdelijke map");
    let bundel = schrijf_oude_bundel(&map);

    let r = roep_tool_met(
        "check_fem_model",
        json!({ "model": kolom(200.0), "combinations": combinaties() }),
        &[("OPENAEC_FEM_KERNEL", bundel.as_path())],
    )
    .await;
    let f = foutinhoud(&r);
    assert_eq!(f["error_code"], "TOETSING_ONMOGELIJK", "{f}");
    let melding = f["melding"].as_str().unwrap_or("");
    assert!(melding.contains("Er is niet getoetst") && melding.contains("eersteOrde"), "{melding}");
    let _ = std::fs::remove_dir_all(&map);
}
