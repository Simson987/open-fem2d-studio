//! `gui_control::kanaal` — het luisterende deel van het bedieningskanaal, los
//! van Tauri.
//!
//! Een HTTP-luisteraar op `127.0.0.1:<vrije poort>` met een sessietoken, en
//! het vindbestand (`{pid, poort, token, versie}`) dat een client naar hem
//! toe leidt. `gui_control.rs` zet hem aan en uit — bij het starten, en live
//! vanuit de instelling "Bediening door een AI-assistent toestaan (MCP)" —
//! en geeft mee wat een opdracht dóét, als [`Verwerker`].
//!
//! Los van Tauri zodat het aan- en uitzetten zonder app te toetsen is
//! (tests/gui_kanaal.rs): het vindbestand verschijnt en verdwijnt, de poort
//! gaat open en dicht, een vreemd of verlopen token wordt geweigerd.
//!
//! # Volgorde bij het starten
//!
//! Eerst luisteren, dan de draden starten, en pas dán het vindbestand
//! schrijven — via een tijdelijk bestand en hernoemen. Een client die het
//! bestand vindt, vindt dus altijd een luisteraar, en leest nooit een half
//! bestand. Het vindbestand draagt het token: op Unix is het alleen voor de
//! eigen gebruiker leesbaar (0600, een nieuwe map 0700); op Windows krijgt
//! het bestand vóór het schrijven een afgeschermde DACL voor de gebruiker.
//!
//! # Twee draden: het levensteken en de opdrachten
//!
//! De luisterdraad beantwoordt `GET /status` (het levensteken) en een
//! verzoek zonder geldig token meteen, en zet elke geautoriseerde
//! `POST /opdracht` in de wachtrij van de opdrachtdraad. Die voert de
//! opdrachten één voor één uit, in volgorde van binnenkomst — een
//! paginaopdracht mag minuten duren, en de pagina hoort er nooit twee tegelijk
//! te krijgen. Zo blijft het levensteken antwoorden terwijl de app bezig is:
//! een client (de MCP-server, of een tweede instantie in
//! [`vindbestand_van_ander`]) ziet een bezige app nooit als een dode.
//!
//! # Volgorde bij het stoppen
//!
//! Eerst gemarkeerd als gestopt: een verzoek dat daarna nog aan de beurt
//! komt, krijgt 503 en gaat niet naar de pagina. Dan het vindbestand weg —
//! alleen als het nog het onze is (zelfde token): een andere instantie kan
//! het intussen hebben overgenomen, en dat bestand is niet van ons om weg te
//! halen. Dan de luisterdraad deblokkeren: die eindigt, en de poort gaat
//! dicht. Een opdracht die op dat moment loopt, maakt haar antwoord af over
//! haar eigen verbinding; wat er nog in de wachtrij stond, krijgt 503. Er
//! wordt niet op de opdrachtdraad gewacht: de schakelaar in de instellingen
//! hoort meteen te reageren.
//!
//! # Een vindbestand van een ander
//!
//! [`vindbestand_van_ander`] zegt of het vindbestand van een ander proces is
//! waarvan de poort nog antwoordt. Dan start `gui_control` geen tweede kanaal
//! over dat bestand heen: anders zou bijvoorbeeld een ontwikkelversie (zelfde
//! app-datamap) de clients van de geïnstalleerde app naar zich toe trekken,
//! en bij het afsluiten hun vindbestand weghalen.

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

/// Eén opdracht van een client: `POST /opdracht` met `{naam, args, tijdslimiet_s}`.
#[derive(Deserialize, Debug, Clone)]
pub struct Opdracht {
    pub naam: String,
    #[serde(default)]
    pub args: Value,
    /// Per opdracht te verhogen (toetsen kan lang duren); de verwerker begrenst.
    #[serde(default)]
    pub tijdslimiet_s: Option<u64>,
}

/// Wat een opdracht doet. In de app: `gui_control::voer_uit`.
pub type Verwerker = Arc<dyn Fn(Opdracht) -> Result<Value, String> + Send + Sync>;

/// De inhoud van het vindbestand.
#[derive(Deserialize, Debug, Clone, PartialEq)]
pub struct Vindbestand {
    pub pid: u32,
    pub poort: u16,
    pub token: String,
    #[serde(default)]
    pub versie: String,
}

/// Lees een vindbestand; `None` als het er niet is of niet te lezen is.
pub fn lees_vindbestand(pad: &Path) -> Option<Vindbestand> {
    serde_json::from_str(&fs::read_to_string(pad).ok()?).ok()
}

/// De melding bij een opdracht die binnenkomt nadat het kanaal is uitgezet.
const UITGEZET: &str = "het bedieningskanaal is uitgezet (Instellingen → AI-assistent (MCP))";

/// Een draaiend kanaal: luisteraar, draad en vindbestand.
pub struct Luisteraar {
    poort: u16,
    token: String,
    bestand: PathBuf,
    server: Arc<tiny_http::Server>,
    gestopt: Arc<AtomicBool>,
}

impl Luisteraar {
    /// Luister op 127.0.0.1, start de lus en schrijf daarna het vindbestand
    /// `bestand` (de map wordt aangemaakt).
    pub fn start(bestand: &Path, versie: &str, verwerk: Verwerker) -> Result<Luisteraar, String> {
        let server = tiny_http::Server::http("127.0.0.1:0")
            .map_err(|e| format!("kan niet luisteren op 127.0.0.1: {e}"))?;
        let poort = match server.server_addr() {
            tiny_http::ListenAddr::IP(a) => a.port(),
            #[allow(unreachable_patterns)]
            _ => return Err("onverwacht luisteradres".into()),
        };
        let server = Arc::new(server);
        let token = maak_token();
        let gestopt = Arc::new(AtomicBool::new(false));

        {
            // De opdrachtdraad eerst: zonder hem geen kanaal.
            let (wachtrij, binnen) = mpsc::channel::<tiny_http::Request>();
            let g = Arc::clone(&gestopt);
            std::thread::Builder::new()
                .name("gui-control-opdracht".into())
                .spawn(move || {
                    for req in binnen {
                        voer_opdracht_uit(req, &g, &verwerk);
                    }
                })
                .map_err(|e| format!("opdrachtdraad niet te starten: {e}"))?;
            let server = Arc::clone(&server);
            let token = token.clone();
            let versie = versie.to_string();
            let gestopt = Arc::clone(&gestopt);
            std::thread::Builder::new()
                .name("gui-control".into())
                .spawn(move || lus(&server, &token, &versie, &gestopt, wachtrij))
                .map_err(|e| format!("luisterdraad niet te starten: {e}"))?;
        }

        let inhoud = json!({
            "pid": std::process::id(),
            "poort": poort,
            "token": token,
            "versie": versie,
        });
        if let Err(e) = schrijf_vindbestand(bestand, &serde_json::to_string_pretty(&inhoud).unwrap()) {
            gestopt.store(true, Ordering::SeqCst);
            server.unblock();
            return Err(e);
        }
        Ok(Luisteraar { poort, token, bestand: bestand.to_path_buf(), server, gestopt })
    }

    pub fn poort(&self) -> u16 {
        self.poort
    }

    pub fn bestand(&self) -> &Path {
        &self.bestand
    }

    /// Zet het kanaal uit; zie de moduletekst voor de volgorde.
    pub fn stop(self) {
        self.gestopt.store(true, Ordering::SeqCst);
        verwijder_als_eigen(&self.bestand, &self.token);
        self.server.unblock();
    }
}

/// Verwijder het vindbestand als het (nog) ons token draagt. `true` als het
/// weg is gehaald.
pub fn verwijder_als_eigen(pad: &Path, token: &str) -> bool {
    match lees_vindbestand(pad) {
        Some(v) if v.token == token => fs::remove_file(pad).is_ok(),
        _ => false,
    }
}

/// Is het vindbestand van een ánder proces dan `eigen_pid`, en antwoordt zijn
/// poort nog? Dan het pid uit het bestand.
pub fn vindbestand_van_ander(pad: &Path, eigen_pid: u32) -> Option<u32> {
    let v = lees_vindbestand(pad)?;
    if v.pid == eigen_pid {
        return None;
    }
    let status = status_van_poort(v.poort, &v.token, Duration::from_millis(800))?;
    // Een app van vóór dit werk meldt geen pid in /status; antwoordt de poort
    // met "gereed", dan is het een levend kanaal. Meldt hij wél een pid, dan
    // moet dat het pid uit het bestand zijn (anders is de poort hergebruikt).
    match status.get("pid").and_then(Value::as_u64) {
        Some(pid) if pid != u64::from(v.pid) => None,
        _ if status.get("gereed").and_then(Value::as_bool) == Some(true) => Some(v.pid),
        _ => None,
    }
}

/// `GET /status` op 127.0.0.1:`poort`, met het token. De JSON-body bij
/// een 200, anders `None`.
pub fn status_van_poort(poort: u16, token: &str, tijd: Duration) -> Option<Value> {
    let adres = SocketAddr::from(([127, 0, 0, 1], poort));
    let mut s = TcpStream::connect_timeout(&adres, tijd).ok()?;
    s.set_read_timeout(Some(tijd)).ok()?;
    s.set_write_timeout(Some(tijd)).ok()?;
    s.write_all(format!("GET /status HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n").as_bytes())
        .ok()?;
    let mut antwoord = Vec::new();
    let mut blok = [0u8; 4096];
    // Lees tot de body compleet is (Content-Length) of de verbinding sluit.
    loop {
        match s.read(&mut blok) {
            Ok(0) => break,
            Ok(n) => {
                antwoord.extend_from_slice(&blok[..n]);
                if body_compleet(&antwoord) {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let tekst = String::from_utf8_lossy(&antwoord);
    let (kop, body) = tekst.split_once("\r\n\r\n")?;
    let code = kop.split_whitespace().nth(1)?;
    if code != "200" {
        return None;
    }
    serde_json::from_str(body.trim()).ok()
}

fn body_compleet(antwoord: &[u8]) -> bool {
    let tekst = String::from_utf8_lossy(antwoord);
    let Some((kop, body)) = tekst.split_once("\r\n\r\n") else { return false };
    kop.lines()
        .find_map(|r| {
            let (naam, waarde) = r.split_once(':')?;
            naam.trim().eq_ignore_ascii_case("content-length").then(|| waarde.trim().parse::<usize>().ok())?
        })
        .is_some_and(|lengte| body.len() >= lengte)
}

/// Schrijf het vindbestand via een tijdelijk bestand ernaast en hernoemen.
fn schrijf_vindbestand(pad: &Path, inhoud: &str) -> Result<(), String> {
    if let Some(map) = pad.parent().filter(|m| !m.as_os_str().is_empty()) {
        maak_map(map).map_err(|e| format!("map van het vindbestand niet aan te maken: {e}"))?;
    }
    let naam = pad.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tijdelijk = pad.with_file_name(format!("{naam}.{}.tmp", std::process::id()));
    // Een achtergebleven tijdelijk bestand weg, zodat het nieuwe met de
    // rechten hieronder wordt aangemaakt.
    let _ = fs::remove_file(&tijdelijk);
    schrijf_alleen_voor_eigenaar(&tijdelijk, inhoud).map_err(|e| format!("vindbestand niet te schrijven: {e}"))?;
    if fs::rename(&tijdelijk, pad).is_err() {
        // Hernoemen over een bestand dat een client net open heeft, kan op
        // Windows mislukken; dan rechtstreeks schrijven.
        let _ = fs::remove_file(&tijdelijk);
        schrijf_alleen_voor_eigenaar(pad, inhoud).map_err(|e| format!("vindbestand niet te schrijven: {e}"))?;
    }
    Ok(())
}

/// Maak de map (en wat erboven ontbreekt) aan; op Unix alleen toegankelijk
/// voor de eigen gebruiker. Een map die al bestaat, houdt haar rechten.
fn maak_map(map: &Path) -> std::io::Result<()> {
    let mut bouwer = fs::DirBuilder::new();
    bouwer.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        bouwer.mode(0o700);
    }
    bouwer.create(map)
}

/// Schrijf `inhoud` naar `pad`. Op Unix alleen lees- en schrijfbaar voor de
/// eigen gebruiker (0600), ook als het bestand al bestond: het vindbestand
/// draagt het token, en dat geeft volledige bediening van de app. Op Windows
/// krijgt het bestand vóór het schrijven een afgeschermde DACL voor de gebruiker;
/// zo lekt ook in een map met ruimere geërfde rechten geen token.
fn schrijf_alleen_voor_eigenaar(pad: &Path, inhoud: &str) -> std::io::Result<()> {
    let mut opties = fs::OpenOptions::new();
    opties.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opties.mode(0o600);
    }
    let mut f = opties.open(pad)?;
    #[cfg(windows)]
    beperk_windows_rechten(pad)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        f.set_permissions(fs::Permissions::from_mode(0o600))?;
    }
    f.write_all(inhoud.as_bytes())?;
    f.flush()
}

/// Een beschermde DACL met alleen volledige toegang voor de huidige gebruiker. Het
/// bestand is nog leeg wanneer de ACL wordt gezet; bij een fout komt er geen
/// sessietoken op schijf.
#[cfg(windows)]
fn beperk_windows_rechten(pad: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{BOOL, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::{
        GetSecurityDescriptorDacl, PSECURITY_DESCRIPTOR, DACL_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION,
    };

    let sid = huidige_windows_gebruiker_sid()?;
    let sddl: Vec<u16> = format!("D:P(A;;FA;;;{sid})").encode_utf16().chain(std::iter::once(0)).collect();
    let mut descriptor = PSECURITY_DESCRIPTOR::default();
    // P beschermt tegen geërfde ACE's; alleen de huidige gebruikers-SID mag lezen.
    unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            PCWSTR(sddl.as_ptr()), 1, &mut descriptor, None,
        )
    }
    .map_err(std::io::Error::other)?;
    let mut aanwezig = BOOL(0);
    let mut standaard = BOOL(0);
    let mut acl = std::ptr::null_mut();
    let mut naam: Vec<u16> = pad.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let uitkomst = unsafe {
        let ophalen = GetSecurityDescriptorDacl(descriptor, &mut aanwezig, &mut acl, &mut standaard);
        match ophalen {
            Ok(()) if aanwezig.as_bool() && !acl.is_null() => SetNamedSecurityInfoW(
                PWSTR(naam.as_mut_ptr()), SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                None, None, Some(acl), None,
            ).0,
            Ok(()) => 87, // ERROR_INVALID_PARAMETER: nooit een lege DACL toepassen.
            Err(e) => e.code().0 as u32,
        }
    };
    unsafe { LocalFree(Some(HLOCAL(descriptor.0))); }
    if uitkomst == 0 { Ok(()) } else { Err(std::io::Error::from_raw_os_error(uitkomst as i32)) }
}

#[cfg(windows)]
fn huidige_windows_gebruiker_sid() -> std::io::Result<String> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token = HANDLE::default();
    unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) }
        .map_err(std::io::Error::other)?;
    let uitkomst = (|| {
        let mut lengte = 0u32;
        // De eerste aanroep bepaalt de benodigde bufferlengte.
        let _ = unsafe { GetTokenInformation(token, TokenUser, None, 0, &mut lengte) };
        if lengte < std::mem::size_of::<TOKEN_USER>() as u32 {
            return Err(std::io::Error::last_os_error());
        }
        let woorden = (lengte as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0usize; woorden];
        unsafe {
            GetTokenInformation(token, TokenUser, Some(buffer.as_mut_ptr().cast()), lengte, &mut lengte)
        }
        .map_err(std::io::Error::other)?;
        let gebruiker = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
        let mut tekst = PWSTR::null();
        unsafe { ConvertSidToStringSidW(gebruiker.User.Sid, &mut tekst) }
            .map_err(std::io::Error::other)?;
        let sid = unsafe { tekst.to_string() }.map_err(std::io::Error::other);
        unsafe { LocalFree(Some(HLOCAL(tekst.0.cast()))); }
        sid
    })();
    let _ = unsafe { CloseHandle(token) };
    uitkomst
}

fn maak_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ── De luisterlus en de opdrachtdraad ───────────────────────────────────────

/// De luisterdraad: het levensteken en de weigeringen meteen, een
/// geautoriseerde opdracht naar de `wachtrij` van de opdrachtdraad. Eindigt
/// als de server gedeblokkeerd wordt; daarmee sluit ook de wachtrij, en de
/// opdrachtdraad stopt zodra hij leeg is.
fn lus(
    server: &tiny_http::Server,
    token: &str,
    versie: &str,
    gestopt: &AtomicBool,
    wachtrij: mpsc::Sender<tiny_http::Request>,
) {
    for req in server.incoming_requests() {
        if !geautoriseerd(&req, token) {
            antwoord(req, 401, json!({ "ok": false, "fout": "ontbrekend of onjuist token" }));
            continue;
        }
        if gestopt.load(Ordering::SeqCst) {
            antwoord(req, 503, json!({ "ok": false, "fout": UITGEZET }));
            continue;
        }
        let pad = req.url().to_string();
        let methode = req.method().as_str().to_string();
        match (methode.as_str(), pad.as_str()) {
            ("GET", "/status") => antwoord(
                req,
                200,
                json!({ "versie": versie, "gereed": true, "pid": std::process::id() }),
            ),
            ("POST", "/opdracht") => {
                if let Err(mpsc::SendError(req)) = wachtrij.send(req) {
                    antwoord(req, 503, json!({ "ok": false, "fout": UITGEZET }));
                }
            }
            _ => antwoord(req, 404, json!({ "ok": false, "fout": format!("onbekend: {methode} {pad}") })),
        }
    }
}

/// De opdrachtdraad: één geautoriseerde opdracht lezen en uitvoeren. Is het
/// kanaal intussen uitgezet, dan 503 en niets naar de pagina.
fn voer_opdracht_uit(mut req: tiny_http::Request, gestopt: &AtomicBool, verwerk: &Verwerker) {
    if gestopt.load(Ordering::SeqCst) {
        antwoord(req, 503, json!({ "ok": false, "fout": UITGEZET }));
        return;
    }
    let mut tekst = String::new();
    let (status, body) = if let Err(e) = req.as_reader().read_to_string(&mut tekst) {
        (400, json!({ "ok": false, "fout": format!("body onleesbaar: {e}") }))
    } else {
        match serde_json::from_str::<Opdracht>(&tekst) {
            Err(e) => (400, json!({ "ok": false, "fout": format!("opdracht onleesbaar: {e}") })),
            Ok(o) => match verwerk(o) {
                Ok(uitkomst) => (200, json!({ "ok": true, "uitkomst": uitkomst })),
                Err(fout) => (200, json!({ "ok": false, "fout": fout })),
            },
        }
    };
    antwoord(req, status, body);
}

fn antwoord(req: tiny_http::Request, status: u16, body: Value) {
    let antwoord = tiny_http::Response::from_string(body.to_string())
        .with_status_code(status)
        .with_header(
            tiny_http::Header::from_bytes("Content-Type", "application/json; charset=utf-8")
                .expect("geldige header"),
        );
    let _ = req.respond(antwoord);
}

fn geautoriseerd(req: &tiny_http::Request, token: &str) -> bool {
    req.headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str() == format!("Bearer {token}"))
        .unwrap_or(false)
}
