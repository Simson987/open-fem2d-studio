//! Een AI-assistent aan de app koppelen (issue #109): de meegeleverde
//! MCP-server vinden, en hem veilig in `claude_desktop_config.json` zetten.
//!
//! Het samenvoegen raakt een bestand van de gebruiker dat ook andere servers
//! en instellingen draagt. De eisen, elk hieronder getoetst:
//! * een afwezig of leeg bestand wordt aangemaakt met alleen onze regel;
//! * alle andere inhoud blijft staan, in dezelfde volgorde en met dezelfde
//!   inspringing, regeleinden en byte-order-mark;
//! * een bestaande regel `open-fem-studio` wordt bijgewerkt (command en
//!   args), met behoud van wat de gebruiker er zelf bij zette (`env`);
//! * ongeldige JSON wordt geweigerd en het bestand blijft onaangeroerd; de
//!   weigering draagt de vaste code `ONGELDIGE_JSON` met regel en kolom (één
//!   keer in de melding), zodat het paneel haar vertaalt;
//! * vóór elke wijziging komt er een reservekopie met tijdstempel;
//! * nog eens toevoegen verandert niets en maakt geen kopie.
//!
//! Alles in een eigen tijdelijke map: de echte config van de gebruiker wordt
//! nooit gelezen of geschreven.

use open_fem_studio_lib::mcp_koppeling::{
    claude_desktop_config_pad, kandidaten, reservekopie_pad, server_bestandsnaam, voeg_toe,
    voeg_toe_aan_bestand, zoek_server, Soort, MISLUKT, ONGELDIGE_JSON, SERVERNAAM,
};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

struct Werkmap(PathBuf);

impl Werkmap {
    fn nieuw(naam: &str) -> Self {
        let pad = std::env::temp_dir().join(format!("ofs-mcp-koppeling-{}-{naam}", std::process::id()));
        let _ = fs::remove_dir_all(&pad);
        fs::create_dir_all(&pad).expect("werkmap aanmaken");
        Werkmap(pad)
    }

    fn pad(&self) -> &Path {
        &self.0
    }

    /// Alle bestandsnamen in een map, gesorteerd.
    fn namen(map: &Path) -> Vec<String> {
        let mut uit: Vec<String> = fs::read_dir(map)
            .map(|d| d.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
            .unwrap_or_default();
        uit.sort();
        uit
    }
}

impl Drop for Werkmap {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const SERVER: &str = r"C:\Users\proef\AppData\Local\Open FEM Studio\openaec-mcp-server.exe";

/// 6 oktober 2026, 14:22:33 UTC.
fn moment() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_791_296_553)
}

fn json_van(tekst: &str) -> Value {
    serde_json::from_str(tekst.trim_start_matches('\u{feff}')).expect("geldige JSON")
}

// ── Samenvoegen (zuiver, zonder bestand) ────────────────────────────────────

#[test]
fn de_servernaam_is_open_fem_studio() {
    assert_eq!(SERVERNAAM, "open-fem-studio");
}

#[test]
fn een_afwezig_of_leeg_bestand_krijgt_alleen_onze_regel() {
    for inhoud in [None, Some(""), Some("  \r\n"), Some("{}")] {
        let s = voeg_toe(inhoud, SERVERNAAM, SERVER).expect("samenvoegen");
        assert_eq!(
            json_van(&s.tekst),
            json!({ "mcpServers": { "open-fem-studio": { "command": SERVER, "args": [] } } }),
            "{inhoud:?}"
        );
        assert_eq!(s.soort, if inhoud.is_none() { Soort::Aangemaakt } else { Soort::Toegevoegd });
        // Een nieuw of leeg bestand eindigt met een regeleinde; "{}" zonder
        // regeleinde blijft zonder.
        assert_eq!(s.tekst.ends_with('\n'), inhoud != Some("{}"), "{inhoud:?}");
        // Twee spaties, zoals Claude Desktop zelf schrijft.
        assert!(s.tekst.contains("\n  \"mcpServers\""), "{}", s.tekst);
    }
}

#[test]
fn bestaande_servers_en_instellingen_blijven_staan_in_hun_volgorde() {
    let origineel = r#"{
    "globalShortcut": "Ctrl+Space",
    "mcpServers": {
        "filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\werk"],
            "env": { "DEBUG": "1" }
        },
        "zoeken": { "command": "C:\\tools\\zoek.exe" }
    },
    "preferences": { "menuBarEnabled": false, "getal": 1.5, "groot": 12345678901, "lijst": [1, null, true] }
}
"#;
    let s = voeg_toe(Some(origineel), SERVERNAAM, SERVER).unwrap();
    assert_eq!(s.soort, Soort::Toegevoegd);
    let mut verwacht = json_van(origineel);
    verwacht["mcpServers"]["open-fem-studio"] = json!({ "command": SERVER, "args": [] });
    assert_eq!(json_van(&s.tekst), verwacht, "alleen onze regel erbij");
    // De volgorde van de sleutels blijft, en onze regel komt achteraan.
    let plek = |sleutel: &str| s.tekst.find(sleutel).unwrap_or_else(|| panic!("{sleutel} ontbreekt"));
    assert!(plek("\"globalShortcut\"") < plek("\"mcpServers\""));
    assert!(plek("\"mcpServers\"") < plek("\"preferences\""));
    assert!(plek("\"filesystem\"") < plek("\"zoeken\""));
    assert!(plek("\"zoeken\"") < plek("\"open-fem-studio\""));
    assert!(plek("\"open-fem-studio\"") < plek("\"preferences\""));
    assert!(plek("\"menuBarEnabled\"") < plek("\"getal\""));
    // Getallen blijven zoals ze waren.
    assert!(s.tekst.contains("1.5") && s.tekst.contains("12345678901"), "{}", s.tekst);
    // Vier spaties in, vier spaties uit.
    assert!(s.tekst.contains("\n    \"globalShortcut\""), "{}", s.tekst);
    assert!(s.tekst.contains("\n        \"open-fem-studio\""), "{}", s.tekst);
    assert!(s.dubbel.is_empty());
}

#[test]
fn tabs_regeleinden_en_byte_order_mark_blijven() {
    let origineel = "\u{feff}{\r\n\t\"mcpServers\": {\r\n\t\t\"a\": { \"command\": \"a.exe\" }\r\n\t}\r\n}";
    let s = voeg_toe(Some(origineel), SERVERNAAM, SERVER).unwrap();
    assert!(s.tekst.starts_with('\u{feff}'), "de byte-order-mark blijft");
    assert!(s.tekst.contains("\r\n\t\"mcpServers\""), "tab en CRLF: {:?}", s.tekst);
    assert!(s.tekst.contains("\r\n\t\t\"open-fem-studio\""), "{:?}", s.tekst);
    assert!(!s.tekst.replace("\r\n", "").contains('\n'), "geen losse LF tussen de CRLF's");
    assert!(!s.tekst.ends_with('\n'), "het origineel eindigde zonder regeleinde");
}

#[test]
fn een_bestaande_regel_wordt_bijgewerkt_met_behoud_van_env() {
    let origineel = r#"{
  "mcpServers": {
    "open-fem-studio": {
      "command": "C:\\oud\\openaec-mcp-server.exe",
      "args": ["--oud"],
      "env": { "OPENAEC_MCP_LOG": "debug" }
    }
  }
}
"#;
    let s = voeg_toe(Some(origineel), SERVERNAAM, SERVER).unwrap();
    assert_eq!(s.soort, Soort::Bijgewerkt);
    assert_eq!(
        json_van(&s.tekst)["mcpServers"]["open-fem-studio"],
        json!({ "command": SERVER, "args": [], "env": { "OPENAEC_MCP_LOG": "debug" } })
    );
    // Nog eens: niets te doen.
    let t = voeg_toe(Some(&s.tekst), SERVERNAAM, SERVER).unwrap();
    assert_eq!(t.soort, Soort::Ongewijzigd);
    assert_eq!(t.tekst, s.tekst);
}

#[test]
fn ongeldige_json_wordt_geweigerd() {
    let fout = voeg_toe(Some("{ \"mcpServers\": { \"a\": } }"), SERVERNAAM, SERVER).unwrap_err();
    // Een vaste code met de plek, zodat het paneel de melding vertaalt.
    assert_eq!(fout.code, ONGELDIGE_JSON, "{fout}");
    assert_eq!((fout.regel, fout.kolom), (Some(1), Some(24)), "{fout}");
    assert_eq!(fout.melding, "het bestand is geen geldige JSON (syntaxfout op regel 1, kolom 24)");
    // De plek één keer, en geen Engelse tekst van serde_json erin.
    assert!(!fout.melding.contains(" at line "), "{fout}");
    // Een bestand dat middenin ophoudt, op de tweede regel.
    let fout = voeg_toe(Some("{
  \"mcpServers\": {"), SERVERNAAM, SERVER).unwrap_err();
    assert_eq!(fout.code, ONGELDIGE_JSON);
    assert_eq!(fout.regel, Some(2), "{fout}");
    assert!(fout.melding.contains("onverwacht einde op regel 2"), "{fout}");
    // Geldige JSON die niet past: geen ONGELDIGE_JSON, de reden in de melding.
    let fout = voeg_toe(Some("[1, 2]"), SERVERNAAM, SERVER).unwrap_err();
    assert_eq!(fout.code, MISLUKT);
    assert_eq!((fout.regel, fout.kolom), (None, None));
    assert!(fout.melding.contains("object"), "{fout}");
    let fout = voeg_toe(Some(r#"{"mcpServers": "geen object"}"#), SERVERNAAM, SERVER).unwrap_err();
    assert!(fout.melding.contains("mcpServers"), "{fout}");
    let fout = voeg_toe(Some(r#"{"mcpServers": {"open-fem-studio": 3}}"#), SERVERNAAM, SERVER).unwrap_err();
    assert!(fout.melding.contains("open-fem-studio"), "{fout}");
}

#[test]
fn een_weigering_gaat_als_vaste_velden_naar_het_paneel() {
    let fout = voeg_toe(Some("{,}"), SERVERNAAM, SERVER).unwrap_err();
    let json = serde_json::to_value(&fout).unwrap();
    assert_eq!(json["code"], json!("ONGELDIGE_JSON"));
    assert_eq!(json["regel"], json!(1));
    assert_eq!(json["kolom"], json!(2));
    assert!(json["melding"].as_str().unwrap().contains("regel 1, kolom 2"), "{json}");
    assert_eq!(json["config"], Value::Null, "zonder bestand geen pad");
}

#[test]
fn een_andere_regel_met_dezelfde_server_wordt_gemeld_en_niet_aangeraakt() {
    let origineel = format!(
        r#"{{ "mcpServers": {{ "openaec-fem": {{ "command": {} }} }} }}"#,
        serde_json::to_string(&SERVER.to_uppercase()).unwrap()
    );
    let s = voeg_toe(Some(&origineel), SERVERNAAM, SERVER).unwrap();
    assert_eq!(s.dubbel, vec!["openaec-fem".to_string()], "op Windows telt hoofdletterongevoelig");
    assert_eq!(json_van(&s.tekst)["mcpServers"]["openaec-fem"], json_van(&origineel)["mcpServers"]["openaec-fem"]);
}

// ── Het bestand ─────────────────────────────────────────────────────────────

#[test]
fn een_afwezig_bestand_en_zijn_map_worden_aangemaakt_zonder_reservekopie() {
    let map = Werkmap::nieuw("afwezig");
    let config = map.pad().join("Claude").join("claude_desktop_config.json");
    let u = voeg_toe_aan_bestand(&config, SERVERNAAM, Path::new(SERVER), moment()).unwrap();
    assert_eq!(u.soort, "aangemaakt");
    assert!(u.map_aangemaakt, "Claude Desktop had nog geen map");
    assert_eq!(u.reservekopie, None);
    assert_eq!(
        json_van(&fs::read_to_string(&config).unwrap()),
        json!({ "mcpServers": { "open-fem-studio": { "command": SERVER, "args": [] } } })
    );
    assert_eq!(Werkmap::namen(&map.pad().join("Claude")), vec!["claude_desktop_config.json"]);
}

#[test]
fn voor_het_schrijven_komt_er_een_reservekopie_met_tijdstempel() {
    let map = Werkmap::nieuw("kopie");
    let config = map.pad().join("claude_desktop_config.json");
    let origineel = "{\n  \"mcpServers\": {\n    \"ander\": { \"command\": \"x.exe\" }\n  }\n}\n";
    fs::write(&config, origineel).unwrap();
    let u = voeg_toe_aan_bestand(&config, SERVERNAAM, Path::new(SERVER), moment()).unwrap();
    assert_eq!(u.soort, "toegevoegd");
    assert!(!u.map_aangemaakt);
    let kopie = PathBuf::from(u.reservekopie.as_deref().expect("een reservekopie"));
    assert_eq!(kopie, map.pad().join("claude_desktop_config.json.20261006-142233.bak"));
    assert_eq!(fs::read_to_string(&kopie).unwrap(), origineel, "de kopie is het origineel, byte voor byte");
    let nu = json_van(&fs::read_to_string(&config).unwrap());
    assert_eq!(nu["mcpServers"]["ander"], json!({ "command": "x.exe" }));
    assert_eq!(nu["mcpServers"]["open-fem-studio"]["command"], json!(SERVER));

    // Nog eens, in dezelfde seconde: niets te doen, dus geen tweede kopie.
    let u2 = voeg_toe_aan_bestand(&config, SERVERNAAM, Path::new(SERVER), moment()).unwrap();
    assert_eq!(u2.soort, "ongewijzigd");
    assert_eq!(u2.reservekopie, None);
    // Een echte wijziging in dezelfde seconde: een tweede kopie naast de eerste.
    let ander = Path::new(r"D:\elders\openaec-mcp-server.exe");
    let u3 = voeg_toe_aan_bestand(&config, SERVERNAAM, ander, moment()).unwrap();
    assert_eq!(u3.soort, "bijgewerkt");
    let kopie2 = PathBuf::from(u3.reservekopie.unwrap());
    assert_ne!(kopie2, kopie, "de eerste kopie wordt niet overschreven");
    assert_eq!(fs::read_to_string(&kopie).unwrap(), origineel);
    assert_eq!(Werkmap::namen(map.pad()).len(), 3, "config en twee kopieën: {:?}", Werkmap::namen(map.pad()));
}

#[test]
fn ongeldige_json_in_het_bestand_blijft_onaangeroerd() {
    let map = Werkmap::nieuw("ongeldig");
    let config = map.pad().join("claude_desktop_config.json");
    let kapot = "{ \"mcpServers\": { \"a\": { \"command\": \"a.exe\" }, } ";
    fs::write(&config, kapot).unwrap();
    let fout = voeg_toe_aan_bestand(&config, SERVERNAAM, Path::new(SERVER), moment()).unwrap_err();
    assert_eq!(fout.code, ONGELDIGE_JSON, "{fout}");
    assert_eq!(fout.config.as_deref(), Some(config.to_string_lossy().as_ref()));
    assert_eq!(fout.regel, Some(1), "{fout}");
    assert!(fout.melding.contains("geen geldige JSON"), "{fout}");
    assert!(fout.melding.contains(&config.display().to_string()), "de melding noemt het bestand: {fout}");
    assert!(fout.melding.ends_with("het bestand is niet gewijzigd"), "{fout}");
    assert_eq!(fout.melding.matches("regel").count(), 1, "de plek één keer: {fout}");
    assert_eq!(fs::read_to_string(&config).unwrap(), kapot, "niet overschreven");
    assert_eq!(Werkmap::namen(map.pad()), vec!["claude_desktop_config.json"], "geen kopie, geen tijdelijk bestand");
}

#[test]
fn de_reservekopie_heet_naar_het_moment_in_utc() {
    let config = Path::new(r"C:\x\Claude\claude_desktop_config.json");
    assert_eq!(
        reservekopie_pad(config, moment()),
        Path::new(r"C:\x\Claude").join("claude_desktop_config.json.20261006-142233.bak")
    );
    assert_eq!(
        reservekopie_pad(config, UNIX_EPOCH + Duration::from_secs(951_782_400)),
        Path::new(r"C:\x\Claude").join("claude_desktop_config.json.20000229-000000.bak"),
        "schrikkeldag"
    );
}

// ── De server vinden ────────────────────────────────────────────────────────

#[test]
fn de_server_staat_naast_de_app_of_in_de_ontwikkelmappen() {
    let map = Werkmap::nieuw("server");
    let installatie = map.pad().join("Open FEM Studio");
    let app = installatie.join(format!("open-fem-studio{}", std::env::consts::EXE_SUFFIX));
    let lijst = kandidaten(&app, None);
    assert_eq!(lijst[0], installatie.join(server_bestandsnaam()), "eerst naast de app (de installatiemap)");
    assert_eq!(zoek_server(&lijst), None, "nog niets op schijf");
    fs::create_dir_all(&installatie).unwrap();
    fs::write(installatie.join(server_bestandsnaam()), b"").unwrap();
    assert_eq!(zoek_server(&kandidaten(&app, None)), Some(installatie.join(server_bestandsnaam())));

    // Ontwikkelwerk: de app in target/debug, de server als sidecar in src-tauri/binaries.
    let bron = map.pad().join("src-tauri");
    let debug_app = bron.join("target").join("debug").join(format!("open-fem-studio{}", std::env::consts::EXE_SUFFIX));
    let sidecar = bron
        .join("binaries")
        .join(format!("openaec-mcp-server-x86_64-pc-windows-msvc{}", std::env::consts::EXE_SUFFIX));
    fs::create_dir_all(sidecar.parent().unwrap()).unwrap();
    assert_eq!(zoek_server(&kandidaten(&debug_app, Some(&bron))), None);
    fs::write(&sidecar, b"").unwrap();
    assert_eq!(zoek_server(&kandidaten(&debug_app, Some(&bron))), Some(sidecar.clone()));
    // Een releasebuild van de server gaat voor de sidecarkopie.
    let release = bron.join("target").join("release").join(server_bestandsnaam());
    fs::create_dir_all(release.parent().unwrap()).unwrap();
    fs::write(&release, b"").unwrap();
    assert_eq!(zoek_server(&kandidaten(&debug_app, Some(&bron))), Some(release));
    // Een map met de naam van de server telt niet.
    let leeg = Werkmap::nieuw("server-map");
    let a = leeg.pad().join("open-fem-studio.exe");
    fs::create_dir_all(leeg.pad().join(server_bestandsnaam())).unwrap();
    assert_eq!(zoek_server(&kandidaten(&a, None)), None);
}

#[test]
fn de_config_van_claude_desktop_per_platform() {
    // Windows: %APPDATA%\Claude.
    assert_eq!(
        claude_desktop_config_pad("windows", Some(r"C:\Users\a\AppData\Roaming"), None, None),
        Some(Path::new(r"C:\Users\a\AppData\Roaming").join("Claude").join("claude_desktop_config.json"))
    );
    assert_eq!(claude_desktop_config_pad("windows", None, Some(r"C:\Users\a"), None), None, "zonder APPDATA geen gok");
    // macOS: ~/Library/Application Support/Claude.
    assert_eq!(
        claude_desktop_config_pad("macos", None, Some("/Users/a"), None),
        Some(Path::new("/Users/a").join("Library").join("Application Support").join("Claude").join("claude_desktop_config.json"))
    );
    // Linux: $XDG_CONFIG_HOME/Claude, anders ~/.config/Claude.
    assert_eq!(
        claude_desktop_config_pad("linux", None, Some("/home/a"), Some("/home/a/cfg")),
        Some(Path::new("/home/a/cfg").join("Claude").join("claude_desktop_config.json"))
    );
    assert_eq!(
        claude_desktop_config_pad("linux", None, Some("/home/a"), None),
        Some(Path::new("/home/a").join(".config").join("Claude").join("claude_desktop_config.json"))
    );
}
