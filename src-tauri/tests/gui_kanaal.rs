//! Het bedieningskanaal aan en uit (issue #109), zonder app.
//!
//! Getoetst worden de stukken van `gui_control` die los van Tauri staan: de
//! luisteraar (`gui_control::kanaal`) met zijn vindbestand, de bewaarde
//! instelling "Bediening door een AI-assistent toestaan (MCP)"
//! (`gui_control::instelling`), en `GuiControl` zelf — de beslissing bij het
//! opstarten en de schakelaar (`zet_aan`/`zet_uit`, achter de commando's
//! `gui_kanaal_aan`/`_uit`) — met een nabootsing van de app (`AppKant`) in
//! plaats van een `AppHandle`. Wat dan nog in gui_control.rs overblijft, is
//! de paden uit de app halen en het event versturen.
//!
//! Alles werkt in een eigen tijdelijke map: geen enkele proef raakt de
//! app-datamap of het vindbestand van de gebruiker.
//!
//! Dit zijn unit-tests in tests/ om dezelfde reden als tests/bestandskoppeling.rs:
//! de unit-testharnas van de lib laadt op Windows niet (zie build.rs).

use open_fem_studio_lib::gui_control::{instelling, kanaal, AppKant, GuiControl, KanaalStatus};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

/// Een eigen, lege map per test; weg bij het verlaten van de test.
struct Werkmap(PathBuf);

impl Werkmap {
    fn nieuw(naam: &str) -> Self {
        let pad = std::env::temp_dir().join(format!("ofs-gui-kanaal-{}-{naam}", std::process::id()));
        let _ = fs::remove_dir_all(&pad);
        fs::create_dir_all(&pad).expect("werkmap aanmaken");
        Werkmap(pad)
    }

    fn pad(&self) -> &Path {
        &self.0
    }
}

impl Drop for Werkmap {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Eén HTTP-verzoek zonder client-crate (de app-crate heeft er geen): de
/// statuscode en de JSON-body, of `None` als er niets antwoordt.
fn http(poort: u16, methode: &str, pad: &str, token: Option<&str>, body: &str) -> Option<(u16, Value)> {
    let adres = SocketAddr::from(([127, 0, 0, 1], poort));
    let mut s = TcpStream::connect_timeout(&adres, Duration::from_millis(500)).ok()?;
    s.set_read_timeout(Some(Duration::from_secs(10))).ok()?;
    let mut verzoek = format!(
        "{methode} {pad} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        body.len()
    );
    if let Some(t) = token {
        verzoek.push_str(&format!("Authorization: Bearer {t}\r\n"));
    }
    verzoek.push_str("\r\n");
    verzoek.push_str(body);
    s.write_all(verzoek.as_bytes()).ok()?;
    let mut antwoord = Vec::new();
    let _ = s.read_to_end(&mut antwoord);
    let tekst = String::from_utf8_lossy(&antwoord).into_owned();
    let (kop, rest) = tekst.split_once("\r\n\r\n")?;
    let code: u16 = kop.split_whitespace().nth(1)?.parse().ok()?;
    Some((code, serde_json::from_str(rest.trim()).unwrap_or(Value::Null)))
}

/// Wacht tot `voorwaarde` waar is, hooguit `tijd`.
fn wacht_tot(tijd: Duration, mut voorwaarde: impl FnMut() -> bool) -> bool {
    let einde = Instant::now() + tijd;
    while Instant::now() < einde {
        if voorwaarde() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    voorwaarde()
}

/// Een verwerker die elke opdracht onthoudt en `{naam, args}` teruggeeft;
/// de opdracht `fout` geeft een fout.
fn echo() -> (kanaal::Verwerker, Arc<Mutex<Vec<String>>>) {
    let gezien = Arc::new(Mutex::new(Vec::new()));
    let g = Arc::clone(&gezien);
    let verwerk: kanaal::Verwerker = Arc::new(move |o: kanaal::Opdracht| {
        g.lock().unwrap().push(o.naam.clone());
        if o.naam == "fout" {
            Err("de pagina weigert".to_string())
        } else {
            Ok(json!({ "naam": o.naam, "args": o.args }))
        }
    });
    (verwerk, gezien)
}

// ── De instelling ───────────────────────────────────────────────────────────

#[test]
fn de_instelling_staat_standaard_aan_en_ongeldige_inhoud_blijft_uit() {
    let map = Werkmap::nieuw("standaard");
    let pad = map.pad().join(instelling::BESTANDSNAAM);
    assert!(instelling::lees(&pad), "geen bestand: aan");
    fs::write(&pad, r#"{"andereKeuze":true}"#).unwrap();
    assert!(instelling::lees(&pad), "geen sleutel: aan");
    fs::write(&pad, "geen json").unwrap();
    assert!(!instelling::lees(&pad), "ongeldige JSON: uit om een bewuste keuze te bewaren");
    fs::write(&pad, r#"{"bedieningToestaan":"ja"}"#).unwrap();
    assert!(!instelling::lees(&pad), "ongeldige waarde: uit");
    fs::write(&pad, r#"{"bedieningToestaan":false}"#).unwrap();
    assert!(!instelling::lees(&pad), "expliciet uit blijft uit");
    fs::write(&pad, r#"{"bedieningToestaan":true}"#).unwrap();
    assert!(instelling::lees(&pad));
    let onleesbaar = map.pad().join("map-in-plaats-van-bestand");
    fs::create_dir(&onleesbaar).unwrap();
    assert!(!instelling::lees(&onleesbaar), "leesfout: uit");
}

#[test]
fn de_instelling_onthoudt_aan_en_uit_en_maakt_de_map_aan() {
    let map = Werkmap::nieuw("onthoudt");
    let pad = map.pad().join("nog").join("niet").join(instelling::BESTANDSNAAM);
    instelling::schrijf(&pad, true).expect("aan bewaren");
    assert!(instelling::lees(&pad));
    instelling::schrijf(&pad, false).expect("uit bewaren");
    assert!(!instelling::lees(&pad));
    // Andere sleutels in hetzelfde bestand blijven staan.
    fs::write(&pad, r#"{"bedieningToestaan":false,"later":1}"#).unwrap();
    instelling::schrijf(&pad, true).unwrap();
    let inhoud: Value = serde_json::from_str(&fs::read_to_string(&pad).unwrap()).unwrap();
    assert_eq!(inhoud, json!({ "bedieningToestaan": true, "later": 1 }));
}

#[test]
fn het_kanaal_start_door_de_instelling_of_door_de_omgevingsvariabele() {
    assert!(!instelling::moet_starten(false, false), "expliciet uit: geen kanaal");
    assert!(instelling::moet_starten(true, false), "OPENAEC_GUI_CONTROL=1 blijft werken");
    assert!(instelling::moet_starten(false, true), "de instelling zonder omgevingsvariabele");
    assert!(instelling::moet_starten(true, true));
}

// ── De luisteraar ───────────────────────────────────────────────────────────

#[test]
fn aanzetten_schrijft_het_vindbestand_en_opent_de_poort() {
    let map = Werkmap::nieuw("aan");
    let bestand = map.pad().join("sub").join("gui-control.json");
    let (verwerk, gezien) = echo();
    let l = kanaal::Luisteraar::start(&bestand, "2026.41.0-proef", verwerk).expect("starten");

    let vind = kanaal::lees_vindbestand(&bestand).expect("het vindbestand staat er");
    assert_eq!(vind.pid, std::process::id());
    assert_eq!(vind.poort, l.poort());
    assert_eq!(vind.versie, "2026.41.0-proef");
    assert_eq!(vind.token.len(), 64, "32 willekeurige bytes als hex");
    assert!(vind.token.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(l.bestand(), bestand.as_path());

    // Ook het levensteken vereist het token uit het vindbestand.
    assert_eq!(http(l.poort(), "GET", "/status", None, "").unwrap().0, 401);
    assert_eq!(http(l.poort(), "GET", "/status", Some("ongeldig"), "").unwrap().0, 401);
    let (code, status) = http(l.poort(), "GET", "/status", Some(&vind.token), "").expect("status");
    assert_eq!(code, 200);
    assert_eq!(status["gereed"], json!(true));
    assert_eq!(status["versie"], json!("2026.41.0-proef"));
    assert_eq!(status["pid"], json!(std::process::id()));
    assert_eq!(kanaal::status_van_poort(l.poort(), &vind.token, Duration::from_secs(2)).unwrap()["gereed"], json!(true));

    // Een opdracht met het token gaat naar de verwerker.
    let (code, a) = http(l.poort(), "POST", "/opdracht", Some(&vind.token), r#"{"naam":"status","args":{"x":1}}"#).unwrap();
    assert_eq!(code, 200);
    assert_eq!(a, json!({ "ok": true, "uitkomst": { "naam": "status", "args": { "x": 1 } } }));
    let (_, f) = http(l.poort(), "POST", "/opdracht", Some(&vind.token), r#"{"naam":"fout"}"#).unwrap();
    assert_eq!(f, json!({ "ok": false, "fout": "de pagina weigert" }));

    // Zonder of met een ander token: 401, en de verwerker ziet niets.
    let voor = gezien.lock().unwrap().len();
    assert_eq!(http(l.poort(), "POST", "/opdracht", None, r#"{"naam":"status"}"#).unwrap().0, 401);
    assert_eq!(http(l.poort(), "POST", "/opdracht", Some("abc"), r#"{"naam":"status"}"#).unwrap().0, 401);
    assert_eq!(gezien.lock().unwrap().len(), voor, "een opdracht zonder geldig token komt niet door");
    // Een onleesbare opdracht: 400.
    assert_eq!(http(l.poort(), "POST", "/opdracht", Some(&vind.token), "{").unwrap().0, 400);
    l.stop();
}

#[test]
fn uitzetten_haalt_het_vindbestand_weg_en_sluit_de_poort() {
    let map = Werkmap::nieuw("uit");
    let bestand = map.pad().join("gui-control.json");
    let (verwerk, _) = echo();
    let l = kanaal::Luisteraar::start(&bestand, "v", Arc::clone(&verwerk)).unwrap();
    let poort = l.poort();
    let token = kanaal::lees_vindbestand(&bestand).unwrap().token;
    assert!(http(poort, "GET", "/status", None, "").is_some());
    l.stop();
    assert!(!bestand.exists(), "het vindbestand is weg");
    assert!(
        wacht_tot(Duration::from_secs(5), || http(poort, "GET", "/status", None, "").is_none()),
        "de poort is dicht"
    );

    // Weer aan: een nieuwe poort-en-tokencombinatie; het oude token is niets meer waard.
    let l2 = kanaal::Luisteraar::start(&bestand, "v", verwerk).unwrap();
    let nieuw = kanaal::lees_vindbestand(&bestand).unwrap();
    assert_ne!(nieuw.token, token, "elke start een nieuw token");
    assert_eq!(http(l2.poort(), "POST", "/opdracht", Some(&token), r#"{"naam":"status"}"#).unwrap().0, 401);
    l2.stop();
    assert!(!bestand.exists());
}

#[test]
fn uitzetten_laat_het_vindbestand_van_een_ander_staan() {
    let map = Werkmap::nieuw("ander");
    let bestand = map.pad().join("gui-control.json");
    let (verwerk, _) = echo();
    let l = kanaal::Luisteraar::start(&bestand, "v", verwerk).unwrap();
    // Een andere instantie heeft het bestand intussen overgenomen.
    let vreemd = r#"{"pid":4242,"poort":1,"token":"van-een-ander","versie":"x"}"#;
    fs::write(&bestand, vreemd).unwrap();
    l.stop();
    assert_eq!(fs::read_to_string(&bestand).unwrap(), vreemd, "niet van ons: blijft staan");
    assert!(!kanaal::verwijder_als_eigen(&bestand, "ander-token"));
    assert!(kanaal::verwijder_als_eigen(&bestand, "van-een-ander"));
    assert!(!bestand.exists());
}

#[test]
fn een_levende_andere_instantie_wordt_herkend() {
    let map = Werkmap::nieuw("levend");
    let bestand = map.pad().join("gui-control.json");
    // Geen bestand: niemand.
    assert_eq!(kanaal::vindbestand_van_ander(&bestand, 1), None);
    let (verwerk, _) = echo();
    let l = kanaal::Luisteraar::start(&bestand, "v", verwerk).unwrap();
    // Vanuit een ánder proces (pid 1) gezien: dit proces bedient het kanaal.
    assert_eq!(kanaal::vindbestand_van_ander(&bestand, 1), Some(std::process::id()));
    // Vanuit dit proces zelf: geen ander.
    assert_eq!(kanaal::vindbestand_van_ander(&bestand, std::process::id()), None);
    let poort = l.poort();
    l.stop();
    assert!(wacht_tot(Duration::from_secs(5), || http(poort, "GET", "/status", None, "").is_none()));
    // Een achtergebleven bestand van een gestopte app (poort dicht): geen levende ander.
    fs::write(
        &bestand,
        format!(r#"{{"pid":4242,"poort":{poort},"token":"oud","versie":"x"}}"#),
    )
    .unwrap();
    assert_eq!(kanaal::vindbestand_van_ander(&bestand, 1), None);
}

#[test]
fn een_opdracht_na_het_uitzetten_wordt_geweigerd() {
    // Een verbinding die vóór het uitzetten is opengezet en daarna pas haar
    // opdracht stuurt, krijgt 503 en de verwerker ziet niets.
    let map = Werkmap::nieuw("na-uit");
    let bestand = map.pad().join("gui-control.json");
    let (verwerk, gezien) = echo();
    // Een verwerker die de eerste opdracht vasthoudt, zodat de lus bezet is
    // terwijl het kanaal uitgaat.
    let vast = Arc::new(Mutex::new(()));
    let slot = vast.lock().unwrap();
    let v2 = Arc::clone(&vast);
    let traag: kanaal::Verwerker = Arc::new(move |o: kanaal::Opdracht| {
        if o.naam == "traag" {
            let _w = v2.lock().unwrap();
        }
        verwerk(o)
    });
    let l = kanaal::Luisteraar::start(&bestand, "v", traag).unwrap();
    let poort = l.poort();
    let token = kanaal::lees_vindbestand(&bestand).unwrap().token;
    let t1 = token.clone();
    let eerste = std::thread::spawn(move || http(poort, "POST", "/opdracht", Some(&t1), r#"{"naam":"traag"}"#));
    // De lus zit nu vast in "traag" (de verwerker wacht op het slot).
    std::thread::sleep(Duration::from_millis(300));
    let t2 = token.clone();
    let tweede = std::thread::spawn(move || http(poort, "POST", "/opdracht", Some(&t2), r#"{"naam":"status"}"#));
    std::thread::sleep(Duration::from_millis(200));
    l.stop();
    drop(slot);
    let (c1, _) = eerste.join().unwrap().expect("de lopende opdracht maakt haar antwoord af");
    assert_eq!(c1, 200);
    let (c2, b2) = tweede.join().unwrap().expect("antwoord op de tweede");
    assert_eq!(c2, 503, "{b2}");
    assert!(b2["fout"].as_str().unwrap().contains("uitgezet"), "{b2}");
    assert_eq!(*gezien.lock().unwrap(), vec!["traag".to_string()]);
}

// ── Het levensteken terwijl de app bezig is ─────────────────────────────────

#[test]
fn status_antwoordt_ook_terwijl_een_opdracht_loopt() {
    // GET /status is het levensteken: de MCP-server (gui_start_app) en een
    // tweede instantie (vindbestand_van_ander) lezen er "levend" uit. Een
    // opdracht van minuten mag dat niet blokkeren — anders lijkt een bezige
    // app dood.
    let map = Werkmap::nieuw("bezig");
    let bestand = map.pad().join("gui-control.json");
    let (verwerk, gezien) = echo();
    let vast = Arc::new(Mutex::new(()));
    let slot = vast.lock().unwrap();
    let v2 = Arc::clone(&vast);
    let traag: kanaal::Verwerker = Arc::new(move |o: kanaal::Opdracht| {
        if o.naam == "traag" {
            let _w = v2.lock().unwrap();
        }
        verwerk(o)
    });
    let l = kanaal::Luisteraar::start(&bestand, "v", traag).unwrap();
    let poort = l.poort();
    let token = kanaal::lees_vindbestand(&bestand).unwrap().token;
    let t1 = token.clone();
    let eerste = std::thread::spawn(move || http(poort, "POST", "/opdracht", Some(&t1), r#"{"naam":"traag"}"#));
    // De echo-verwerker noteert pas ná het slot; wacht tot de lus bezet is.
    std::thread::sleep(Duration::from_millis(300));
    // Terwijl "traag" loopt: het levensteken binnen een halve seconde.
    let begin = Instant::now();
    let status = kanaal::status_van_poort(poort, &token, Duration::from_millis(500)).expect("status tijdens een opdracht");
    assert_eq!(status["gereed"], json!(true));
    assert!(begin.elapsed() < Duration::from_millis(500), "{:?}", begin.elapsed());
    // Een tweede instantie ziet een levende ander, geen dode poort.
    assert_eq!(kanaal::vindbestand_van_ander(&bestand, 1), Some(std::process::id()));
    // Een verzoek zonder token wordt ook meteen geweigerd.
    assert_eq!(http(poort, "POST", "/opdracht", None, r#"{"naam":"x"}"#).unwrap().0, 401);
    // Een tweede opdracht wacht op haar beurt: de pagina krijgt er nooit twee tegelijk.
    let t2 = token.clone();
    let tweede = std::thread::spawn(move || http(poort, "POST", "/opdracht", Some(&t2), r#"{"naam":"daarna"}"#));
    std::thread::sleep(Duration::from_millis(300));
    assert!(gezien.lock().unwrap().is_empty(), "nog niets klaar: de tweede wacht achter de eerste");
    drop(slot);
    assert_eq!(eerste.join().unwrap().expect("antwoord").0, 200);
    let (c2, b2) = tweede.join().unwrap().expect("antwoord op de tweede");
    assert_eq!((c2, b2["uitkomst"]["naam"].clone()), (200, json!("daarna")));
    assert_eq!(*gezien.lock().unwrap(), vec!["traag".to_string(), "daarna".to_string()], "in volgorde");
    l.stop();
}

// ── Het vindbestand is alleen voor de eigen gebruiker (Unix) ────────────────

#[cfg(unix)]
#[test]
fn het_vindbestand_is_alleen_voor_de_eigen_gebruiker_leesbaar() {
    use std::os::unix::fs::PermissionsExt;
    let map = Werkmap::nieuw("rechten");
    let nieuwe_map = map.pad().join("org.openaec.fem-studio");
    let bestand = nieuwe_map.join("gui-control.json");
    let (verwerk, _) = echo();
    let l = kanaal::Luisteraar::start(&bestand, "v", Arc::clone(&verwerk)).unwrap();
    let modus = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(modus(&bestand), 0o600, "het token is alleen voor de eigen gebruiker");
    assert_eq!(modus(&nieuwe_map), 0o700, "een nieuwe map ook");
    l.stop();
    // Een bestaand bestand met ruimere rechten: na een nieuwe start 0600.
    fs::write(&bestand, "{}").unwrap();
    fs::set_permissions(&bestand, fs::Permissions::from_mode(0o644)).unwrap();
    let l = kanaal::Luisteraar::start(&bestand, "v", verwerk).unwrap();
    assert_eq!(modus(&bestand), 0o600);
    l.stop();
}

// ── GuiControl: opstarten en de schakelaar ──────────────────────────────────

#[cfg(windows)]
#[test]
fn het_windows_vindbestand_heeft_een_beschermde_dacl_voor_een_gebruiker() {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT};
    use windows::Win32::Security::{
        GetAclInformation, GetSecurityDescriptorControl, ACL_SIZE_INFORMATION, AclSizeInformation,
        DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED,
    };

    let map = Werkmap::nieuw("rechten-windows");
    let bestand = map.pad().join("gui-control.json");
    let (verwerk, _) = echo();
    let l = kanaal::Luisteraar::start(&bestand, "v", verwerk).unwrap();
    let mut naam: Vec<u16> = bestand.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut acl = std::ptr::null_mut();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    let code = unsafe {
        GetNamedSecurityInfoW(PWSTR(naam.as_mut_ptr()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
            None, None, Some(&mut acl), None, &mut descriptor)
    };
    assert_eq!(code.0, 0, "DACL lezen: {code:?}");
    let mut control = 0u16;
    let mut revisie = 0u32;
    unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revisie) }.unwrap();
    assert_ne!(control & SE_DACL_PROTECTED.0, 0, "geen geërfde toegang");
    let mut info = ACL_SIZE_INFORMATION::default();
    unsafe {
        GetAclInformation(acl, (&mut info as *mut ACL_SIZE_INFORMATION).cast(),
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32, AclSizeInformation)
    }.unwrap();
    assert_eq!(info.AceCount, 1, "alleen de huidige gebruiker heeft een toegangsregel");
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))); }
    l.stop();
}

/// De app in het klein: een verwerker die alles terugzegt, en een lijst van
/// wat er aan de pagina's gemeld werd.
#[derive(Default)]
struct NepApp {
    meldingen: Mutex<Vec<KanaalStatus>>,
}

impl AppKant for NepApp {
    fn verwerker(&self, _control: Weak<GuiControl>) -> kanaal::Verwerker {
        echo().0
    }
    fn meld(&self, status: &KanaalStatus) {
        self.meldingen.lock().unwrap().push(status.clone());
    }
}

impl NepApp {
    fn laatste(&self) -> KanaalStatus {
        self.meldingen.lock().unwrap().last().cloned().expect("een melding")
    }
}

/// De paden van één app-datamap in een werkmap.
struct Datamap {
    map: Werkmap,
}

impl Datamap {
    fn nieuw(naam: &str) -> Self {
        Datamap { map: Werkmap::nieuw(naam) }
    }
    fn vind(&self) -> PathBuf {
        self.map.pad().join("gui-control.json")
    }
    fn instelling(&self) -> PathBuf {
        self.map.pad().join(instelling::BESTANDSNAAM)
    }
    fn opstarten(&self, door_omgeving: bool, app: &NepApp) -> Arc<GuiControl> {
        GuiControl::opstarten(Some(self.vind()), Some(self.instelling()), door_omgeving, "proef".into(), app)
    }
}

/// Is de poort dicht (binnen vijf seconden)?
fn poort_dicht(poort: u16) -> bool {
    wacht_tot(Duration::from_secs(5), || http(poort, "GET", "/status", None, "").is_none())
}

#[test]
fn opstarten_zonder_instelling_start_kanaal_en_expliciet_uit_blijft_uit() {
    let d = Datamap::nieuw("ctl-standaard");
    let app = NepApp::default();
    let control = d.opstarten(false, &app);
    assert!(d.vind().exists(), "vers profiel: vindbestand aanwezig");
    assert!(control.is_actief());
    let s = control.status();
    assert!(s.toegestaan && s.actief && s.poort.is_some() && !s.door_omgeving, "{s:?}");
    assert!(app.meldingen.lock().unwrap().is_empty(), "opstarten meldt niets");
    control.opruimen();
    // Een expliciete keuze voor uit blijft ook bij de volgende start uit.
    instelling::schrijf(&d.instelling(), false).unwrap();
    let control = d.opstarten(false, &app);
    assert!(!d.vind().exists() && !control.is_actief());
}

#[test]
fn opstarten_met_de_instelling_aan_start_het_kanaal_zonder_omgevingsvariabele() {
    let d = Datamap::nieuw("ctl-instelling");
    instelling::schrijf(&d.instelling(), true).unwrap();
    let app = NepApp::default();
    let control = d.opstarten(false, &app);
    let vind = kanaal::lees_vindbestand(&d.vind()).expect("het vindbestand staat er");
    let s = control.status();
    assert!(s.actief && s.toegestaan && !s.door_omgeving, "{s:?}");
    assert_eq!(s.poort, Some(vind.poort));
    assert_eq!(s.vindbestand.as_deref(), Some(d.vind().to_string_lossy().as_ref()));
    assert_eq!(vind.versie, "proef");
    control.opruimen();
    assert!(!d.vind().exists(), "afsluiten ruimt het vindbestand op");
    assert!(poort_dicht(vind.poort));
}

#[test]
fn opstarten_met_de_omgevingsvariabele_laat_de_bewaarde_instelling_uit() {
    // Zo start gui_start_app de app: het kanaal is er voor deze sessie, de
    // bewaarde keuze blijft uit (en het paneel moet dat ook zo tonen).
    let d = Datamap::nieuw("ctl-omgeving");
    instelling::schrijf(&d.instelling(), false).unwrap();
    let app = NepApp::default();
    let control = d.opstarten(true, &app);
    assert!(d.vind().exists());
    let s = control.status();
    assert!(s.actief && s.door_omgeving && !s.toegestaan, "{s:?}");
    assert!(!instelling::lees(&d.instelling()), "opstarten verandert de bewaarde keuze niet");
    // Uitzetten stopt ook dit kanaal en bewaart "uit".
    let poort = s.poort.unwrap();
    let na = control.zet_uit(&app).expect("uit");
    assert!(!na.actief && !na.toegestaan, "{na:?}");
    assert!(!d.vind().exists());
    assert!(d.instelling().exists() && !instelling::lees(&d.instelling()));
    assert!(poort_dicht(poort));
    assert_eq!(app.laatste(), na, "de pagina's horen het");
}

#[test]
fn zet_aan_bewaart_en_schrijft_het_vindbestand_zet_uit_haalt_het_weg() {
    let d = Datamap::nieuw("ctl-schakelaar");
    instelling::schrijf(&d.instelling(), false).unwrap();
    let app = NepApp::default();
    let control = d.opstarten(false, &app);
    assert!(!d.vind().exists());

    let aan = control.zet_aan(&app).expect("aan");
    assert!(instelling::lees(&d.instelling()), "de keuze is bewaard");
    let vind = kanaal::lees_vindbestand(&d.vind()).expect("het vindbestand staat er");
    assert!(aan.actief && aan.toegestaan && !aan.door_omgeving && aan.fout.is_none(), "{aan:?}");
    assert_eq!(aan.poort, Some(vind.poort));
    assert_eq!(app.laatste(), aan, "de pagina's horen het");
    // Het kanaal werkt: een opdracht met het token komt bij de verwerker.
    let (code, a) = http(vind.poort, "POST", "/opdracht", Some(&vind.token), r#"{"naam":"status"}"#).unwrap();
    assert_eq!((code, a["ok"].clone()), (200, json!(true)));
    // Nog eens aan: hetzelfde kanaal, geen nieuwe poort.
    let weer = control.zet_aan(&app).unwrap();
    assert_eq!(weer.poort, aan.poort);

    let uit = control.zet_uit(&app).expect("uit");
    assert!(!uit.actief && !uit.toegestaan && uit.poort.is_none(), "{uit:?}");
    assert!(!d.vind().exists(), "het vindbestand is weg");
    assert!(!instelling::lees(&d.instelling()), "de keuze is bewaard");
    assert!(poort_dicht(vind.poort));
    assert_eq!(app.laatste(), uit);
    assert_eq!(app.meldingen.lock().unwrap().len(), 3);

    // Bij de volgende start volgt het kanaal de bewaarde keuze.
    control.zet_aan(&app).unwrap();
    control.opruimen();
    let volgende = d.opstarten(false, &app);
    assert!(volgende.is_actief() && d.vind().exists(), "aan bewaard: bij de volgende start aan");
    volgende.zet_uit(&app).unwrap();
    let daarna = d.opstarten(false, &app);
    assert!(!daarna.is_actief() && !d.vind().exists(), "uit bewaard: bij de volgende start uit");
}

#[test]
fn zet_aan_start_niet_over_een_levende_andere_instantie_heen() {
    // Een andere app (pid 4242) bedient het kanaal al via hetzelfde
    // vindbestand, en zijn poort antwoordt.
    let d = Datamap::nieuw("ctl-ander");
    let luisteraar = TcpListener::bind("127.0.0.1:0").unwrap();
    let poort = luisteraar.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for s in luisteraar.incoming().take(4) {
            let Ok(mut s) = s else { continue };
            let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            let body = r#"{"versie":"x","gereed":true,"pid":4242}"#;
            let _ = write!(
                s,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    let vreemd = format!(r#"{{"pid":4242,"poort":{poort},"token":"van-een-ander","versie":"x"}}"#);
    fs::write(d.vind(), &vreemd).unwrap();
    instelling::schrijf(&d.instelling(), false).unwrap();
    let app = NepApp::default();
    let control = d.opstarten(false, &app);
    let s = control.zet_aan(&app).expect("de keuze is wel bewaard");
    assert!(s.toegestaan && !s.actief, "{s:?}");
    assert!(s.fout.as_deref().unwrap_or("").contains("pid 4242"), "de reden: {s:?}");
    assert_eq!(fs::read_to_string(d.vind()).unwrap(), vreemd, "het bestand van de ander blijft staan");
    // Uitzetten laat het bestand van de ander ook staan.
    control.zet_uit(&app).unwrap();
    assert_eq!(fs::read_to_string(d.vind()).unwrap(), vreemd);
}
