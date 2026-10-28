//! `gui_start_app` (issue #109): de gestarte app houdt de pijpen van de
//! MCP-server niet open.
//!
//! Een MCP-client start de server met pijpen voor stdin, stdout en stderr. Op
//! Windows erft een nieuw proces elke erfbare handle van zijn ouder (Rust roept
//! `CreateProcessW` altijd aan met `bInheritHandles = TRUE`), en de std-handles
//! van de server zijn die pijpen. Erft de app ze, dan ziet de client het einde
//! van stdout pas als de app stopt — met de echte app na uren. Hier: de server
//! start een nep-app die blijft draaien, stopt daarna op een gesloten stdin, en
//! dan moet het einde van stdout en stderr binnen twee seconden volgen.
//!
//! De nep-app is dit testprogramma zelf, gekopieerd onder een eigen naam (de
//! server weigert een tweede start als er al een proces met die naam draait).
//! Zonder argumenten gestart draait het beide proeven hieronder; met
//! `OFS_NEP_APP_STOP` in de omgeving doet `nep_app` alsof het de app is: hij
//! meldt zich, schrijft nooit een vindbestand, en blijft draaien tot het
//! stopbestand er is (hooguit een minuut). Alles in een eigen tijdelijke map,
//! met een eigen `OPENAEC_GUI_CONTROL_FILE`: het vindbestand en de app van de
//! gebruiker worden nooit geraakt.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

const BIN_PATH: &str = env!("CARGO_BIN_EXE_openaec-mcp-server");
/// Het stopbestand van de nep-app; gezet = dit proces is de nep-app.
const STOP: &str = "OFS_NEP_APP_STOP";
/// Het bestand waarin de nep-app zijn pid zet zolang hij draait.
const GESTART: &str = "OFS_NEP_APP_GESTART";

/// De nep-app. In een gewone testronde (zonder `OFS_NEP_APP_STOP`) doet hij niets.
#[test]
fn nep_app() {
    let Some(stop) = std::env::var_os(STOP).map(PathBuf::from) else { return };
    let gestart = std::env::var_os(GESTART).map(PathBuf::from);
    if let Some(g) = &gestart {
        std::fs::write(g, std::process::id().to_string()).unwrap();
    }
    let einde = Instant::now() + Duration::from_secs(60);
    while !stop.exists() && Instant::now() < einde {
        std::thread::sleep(Duration::from_millis(100));
    }
    if let Some(g) = &gestart {
        let _ = std::fs::remove_file(g);
    }
}

struct Werkmap(PathBuf);

impl Werkmap {
    fn nieuw(naam: &str) -> Self {
        let pad = std::env::temp_dir().join(format!("ofs-gui-pijpen-{}-{naam}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pad);
        std::fs::create_dir_all(&pad).unwrap();
        Werkmap(pad)
    }
    fn pad(&self) -> &Path {
        &self.0
    }
}

/// Bij het verlaten (ook bij een gefaalde proef): de nep-app stoppen, wachten
/// tot hij weg is en de map opruimen.
struct Opruimen {
    map: Werkmap,
    stop: PathBuf,
    gestart: PathBuf,
    server: Option<Child>,
}

impl Drop for Opruimen {
    fn drop(&mut self) {
        let _ = std::fs::write(&self.stop, b"stop");
        if let Some(mut s) = self.server.take() {
            let _ = s.kill();
            let _ = s.wait();
        }
        let einde = Instant::now() + Duration::from_secs(10);
        while self.gestart.exists() && Instant::now() < einde {
            std::thread::sleep(Duration::from_millis(100));
        }
        // De exe is pas te verwijderen als het proces helemaal weg is.
        for _ in 0..50 {
            if std::fs::remove_dir_all(self.map.pad()).is_ok() || !self.map.pad().exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
}

/// Wat een leesdraad meldt: een regel, of het einde van de stroom.
enum Stroom {
    Regel(String),
    Einde(Instant),
}

fn schrijf(stdin: &mut impl Write, waarde: Value) {
    let mut regel = serde_json::to_string(&waarde).unwrap();
    regel.push('\n');
    stdin.write_all(regel.as_bytes()).unwrap();
    stdin.flush().unwrap();
}

fn antwoord(ontvanger: &mpsc::Receiver<Stroom>, id: u32) -> Value {
    let einde = Instant::now() + Duration::from_secs(60);
    loop {
        let rest = einde.saturating_duration_since(Instant::now());
        match ontvanger.recv_timeout(rest) {
            Ok(Stroom::Regel(r)) => {
                let v: Value = serde_json::from_str(r.trim()).unwrap();
                if v["id"] == json!(id) {
                    return v;
                }
            }
            Ok(Stroom::Einde(_)) => panic!("de server stopte vóór het antwoord op {id}"),
            Err(_) => panic!("geen antwoord op {id} binnen een minuut"),
        }
    }
}

#[test]
fn de_gestarte_app_houdt_de_pijpen_van_de_server_niet_open() {
    if std::env::var_os(STOP).is_some() {
        return; // dit proces is de nep-app
    }
    let map = Werkmap::nieuw("app");
    let nep_app = map.pad().join(format!("nep-app-{}{}", std::process::id(), std::env::consts::EXE_SUFFIX));
    std::fs::copy(std::env::current_exe().unwrap(), &nep_app).expect("nep-app kopiëren");
    let mut opruimen = Opruimen {
        stop: map.pad().join("stop"),
        gestart: map.pad().join("gestart"),
        server: None,
        map,
    };
    let vind = opruimen.map.pad().join("gui-control.json");

    let mut server = Command::new(BIN_PATH)
        .env("OPENAEC_APP", &nep_app)
        .env("OPENAEC_GUI_CONTROL_FILE", &vind)
        .env(STOP, &opruimen.stop)
        .env(GESTART, &opruimen.gestart)
        .env_remove("OPENAEC_GUI_CONTROL")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("server starten");
    let mut stdin = server.stdin.take().unwrap();
    let stdout = server.stdout.take().unwrap();
    let mut stderr = server.stderr.take().unwrap();
    opruimen.server = Some(server);

    let (zender, uit) = mpsc::channel();
    std::thread::spawn(move || {
        let mut lezer = BufReader::new(stdout);
        let mut regel = String::new();
        loop {
            regel.clear();
            match lezer.read_line(&mut regel) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if zender.send(Stroom::Regel(regel.clone())).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = zender.send(Stroom::Einde(Instant::now()));
    });
    let (fout_zender, fout_einde) = mpsc::channel();
    std::thread::spawn(move || {
        let mut weg = Vec::new();
        let _ = stderr.read_to_end(&mut weg);
        let _ = fout_zender.send(Instant::now());
    });

    schrijf(&mut stdin, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "pijpen", "version": "0" } } }));
    antwoord(&uit, 1);
    schrijf(&mut stdin, json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
    schrijf(&mut stdin, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": { "name": "gui_start_app", "arguments": { "timeout_s": 5 } } }));
    let r = antwoord(&uit, 2);
    // De nep-app schrijft nooit een vindbestand: na 5 s geeft de tool het op.
    assert_eq!(r["result"]["structuredContent"]["error_code"], json!("APP_START_TIJD"), "{r}");
    assert!(opruimen.gestart.exists(), "de nep-app draait");

    // Stdin dicht: de server stopt. Daarna moeten stdout en stderr dicht zijn,
    // ook al draait de nep-app nog.
    drop(stdin);
    let server = opruimen.server.as_mut().unwrap();
    let einde = Instant::now() + Duration::from_secs(10);
    let gestopt = loop {
        if let Some(_status) = server.try_wait().unwrap() {
            break Instant::now();
        }
        assert!(Instant::now() < einde, "de server stopt niet op een gesloten stdin");
        std::thread::sleep(Duration::from_millis(20));
    };
    let stdout_dicht = loop {
        match uit.recv_timeout(Duration::from_secs(2)) {
            Ok(Stroom::Regel(_)) => continue,
            Ok(Stroom::Einde(t)) => break t,
            Err(_) => panic!(
                "stdout van de server is 2 s na zijn einde nog open: de gestarte app houdt de pijp vast"
            ),
        }
    };
    let stderr_dicht = fout_einde
        .recv_timeout(Duration::from_secs(2))
        .expect("stderr van de server is 2 s na zijn einde nog open: de gestarte app houdt de pijp vast");
    assert!(opruimen.gestart.exists(), "de nep-app draaide nog toen de pijpen dichtgingen");
    for (naam, t) in [("stdout", stdout_dicht), ("stderr", stderr_dicht)] {
        assert!(
            t.saturating_duration_since(gestopt) < Duration::from_secs(2),
            "{naam} ging pas {:?} na de server dicht",
            t.saturating_duration_since(gestopt)
        );
    }
}
