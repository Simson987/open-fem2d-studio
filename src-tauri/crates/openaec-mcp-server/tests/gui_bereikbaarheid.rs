//! Wat een assistent te horen krijgt als Open FEM Studio niet bereikbaar is
//! (issue #109) — en dat `gui_start_app` niets start zonder app-exe.
//!
//! Elke GUI-tool en elke API-tool zonder `project` gaat via het vindbestand
//! naar de draaiende app. Is die er niet (geen vindbestand, poort dicht, een
//! achtergebleven bestand van een eerdere sessie), dan moet de fout precies
//! zeggen wat te doen: Instellingen → AI-assistent (MCP) aanzetten, of
//! `gui_start_app`, en voor ontwikkelaars `OPENAEC_GUI_CONTROL=1` — met een
//! vaste foutcode, zodat een client er niet op tekst hoeft te matchen.
//!
//! De server draait als apart proces met een eigen `OPENAEC_GUI_CONTROL_FILE`
//! in een tijdelijke map: het vindbestand van de gebruiker wordt nooit gelezen,
//! en `OPENAEC_APP` wijst naar een exe die niet bestaat, zodat er nooit een
//! app gestart wordt.

use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");

struct Werkmap(PathBuf);

impl Werkmap {
    fn nieuw(naam: &str) -> Self {
        let pad = std::env::temp_dir().join(format!("ofs-gui-bereikbaar-{}-{naam}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pad);
        std::fs::create_dir_all(&pad).unwrap();
        Werkmap(pad)
    }
    fn pad(&self) -> &Path {
        &self.0
    }
}

impl Drop for Werkmap {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn schrijf(stdin: &mut ChildStdin, waarde: Value) {
    let mut regel = serde_json::to_string(&waarde).unwrap();
    regel.push('\n');
    stdin.write_all(regel.as_bytes()).await.unwrap();
    stdin.flush().await.unwrap();
}

async fn lees(reader: &mut BufReader<ChildStdout>) -> Value {
    let mut regel = String::new();
    let n = timeout(Duration::from_secs(60), reader.read_line(&mut regel))
        .await
        .expect("timeout bij het wachten op een antwoord")
        .expect("read_line");
    assert!(n > 0, "de server stopte");
    serde_json::from_str(regel.trim()).unwrap()
}

/// Start de server met een eigen vindbestand en een niet-bestaande app-exe.
async fn start(vindbestand: &Path, app: &Path) -> (Child, ChildStdin, BufReader<ChildStdout>) {
    let mut child = Command::new(BIN_PATH)
        .env("OPENAEC_GUI_CONTROL_FILE", vindbestand)
        .env("OPENAEC_APP", app)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("server starten");
    let mut stdin = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    schrijf(&mut stdin, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "bereikbaar", "version": "0" } } })).await;
    assert_eq!(lees(&mut reader).await["id"], 1);
    (child, stdin, reader)
}

async fn roep(stdin: &mut ChildStdin, reader: &mut BufReader<ChildStdout>, id: u32, tool: &str, args: Value) -> Value {
    schrijf(stdin, json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": tool, "arguments": args } })).await;
    let resp = lees(reader).await;
    assert_eq!(resp["id"], id);
    resp["result"].clone()
}

fn tekst(uit: &Value) -> String {
    uit["content"][0]["text"].as_str().unwrap_or("").to_owned()
}

/// Lees één HTTP-verzoek helemaal: tot het einde van de kop en dan de body
/// volgens Content-Length.
fn lees_verzoek(s: &mut std::net::TcpStream) {
    let mut buf = Vec::new();
    let mut blok = [0u8; 4096];
    loop {
        let Ok(n) = s.read(&mut blok) else { return };
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&blok[..n]);
        let tekst = String::from_utf8_lossy(&buf).into_owned();
        if let Some((kop, body)) = tekst.split_once("\r\n\r\n") {
            let lengte = kop
                .lines()
                .find_map(|r| {
                    let (k, v) = r.split_once(':')?;
                    k.trim().eq_ignore_ascii_case("content-length").then(|| v.trim().parse::<usize>().ok())?
                })
                .unwrap_or(0);
            if body.len() >= lengte {
                return;
            }
        }
    }
}

/// De fout van een niet-bereikbare app: tekst en gestructureerde inhoud.
fn eis_niet_bereikbaar(uit: &Value, reden_bevat: &str) {
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let t = tekst(uit);
    for deel in ["Instellingen → AI-assistent (MCP)", "gui_start_app", "OPENAEC_GUI_CONTROL=1", reden_bevat] {
        assert!(t.contains(deel), "de melding noemt {deel:?}: {t}");
    }
    let s = &uit["structuredContent"];
    assert_eq!(s["error_code"], json!("APP_NIET_BEREIKBAAR"), "{s}");
    assert!(s["melding"].as_str().unwrap().contains(reden_bevat), "{s}");
    assert!(s["remedie"].as_str().unwrap().contains("Instellingen → AI-assistent (MCP)"), "{s}");
}

#[tokio::test]
async fn zonder_vindbestand_zegt_de_fout_wat_te_doen() {
    let map = Werkmap::nieuw("geen");
    let vind = map.pad().join("gui-control.json");
    let (mut child, mut stdin, mut reader) = start(&vind, &map.pad().join("bestaat-niet.exe")).await;
    let uit = roep(&mut stdin, &mut reader, 2, "gui_status", json!({})).await;
    eis_niet_bereikbaar(&uit, "geen vindbestand");
    // Een API-commando zonder `project` gaat dezelfde weg en zegt hetzelfde.
    let api = roep(&mut stdin, &mut reader, 3, "app_undo", json!({})).await;
    eis_niet_bereikbaar(&api, "geen vindbestand");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn een_achtergebleven_vindbestand_met_een_dichte_poort() {
    let map = Werkmap::nieuw("dicht");
    let vind = map.pad().join("gui-control.json");
    let poort = {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    std::fs::write(&vind, format!(r#"{{"pid":4242,"poort":{poort},"token":"oud","versie":"x"}}"#)).unwrap();
    let (mut child, mut stdin, mut reader) = start(&vind, &map.pad().join("bestaat-niet.exe")).await;
    let uit = roep(&mut stdin, &mut reader, 2, "gui_solve", json!({})).await;
    eis_niet_bereikbaar(&uit, &format!("poort {poort}"));
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn een_vindbestand_van_een_eerdere_sessie_met_een_ander_token() {
    // Op de poort luistert iets dat het token weigert (zoals een app die na
    // een herstart een nieuw token heeft): 401.
    let map = Werkmap::nieuw("token");
    let vind = map.pad().join("gui-control.json");
    let luisteraar = TcpListener::bind("127.0.0.1:0").unwrap();
    let poort = luisteraar.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for s in luisteraar.incoming().take(4) {
            let Ok(mut s) = s else { continue };
            let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
            // Het HÉLE verzoek lezen (kop en body volgens Content-Length):
            // sluiten met ongelezen bytes geeft een RST, en dan ziet de client
            // een verbroken verbinding in plaats van de 401.
            lees_verzoek(&mut s);
            let body = r#"{"ok":false,"fout":"ontbrekend of onjuist token"}"#;
            let _ = write!(
                s,
                "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    std::fs::write(&vind, format!(r#"{{"pid":4242,"poort":{poort},"token":"oud","versie":"x"}}"#)).unwrap();
    let (mut child, mut stdin, mut reader) = start(&vind, &map.pad().join("bestaat-niet.exe")).await;
    let uit = roep(&mut stdin, &mut reader, 2, "gui_read_checks", json!({})).await;
    eis_niet_bereikbaar(&uit, "eerdere sessie");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}

#[tokio::test]
async fn gui_start_app_zonder_app_exe_start_niets_en_zegt_waarom() {
    let map = Werkmap::nieuw("start");
    let vind = map.pad().join("gui-control.json");
    let app = map.pad().join("bestaat-niet.exe");
    let (mut child, mut stdin, mut reader) = start(&vind, &app).await;
    let uit = roep(&mut stdin, &mut reader, 2, "gui_start_app", json!({ "timeout_s": 5 })).await;
    assert_eq!(uit["isError"], json!(true), "{uit}");
    let t = tekst(&uit);
    assert!(t.contains("OPENAEC_APP") && t.contains("bestaat-niet.exe"), "{t}");
    assert_eq!(uit["structuredContent"]["error_code"], json!("APP_NIET_GEVONDEN"), "{uit}");
    assert!(!vind.exists(), "er is niets gestart");
    drop(stdin);
    let _ = timeout(Duration::from_secs(5), child.wait()).await;
}
