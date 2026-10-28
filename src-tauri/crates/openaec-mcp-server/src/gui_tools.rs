//! `gui_tools` — de MCP-tools die de DRAAIENDE desktop-app bedienen.
//!
//! Dit zijn geen rekenkern-opdrachten en ze horen dus niet in de drie-wegen-
//! regel: zij *zijn* de weg naar de GUI. Elke tool is één-op-één een actie van
//! `bediening/bediening.ts` in de app (of, voor `gui_screenshot`, van
//! `gui_control.rs` in Rust), aangesproken over het bedieningskanaal:
//! `POST http://127.0.0.1:<poort>/opdracht` met een sessietoken.
//!
//! De app wordt gevonden via `gui-control.json` in haar app-datamap
//! (`org.openaec.fem-studio` onder `%LOCALAPPDATA%` op Windows,
//! `~/Library/Application Support` op macOS en `$XDG_DATA_HOME` of
//! `~/.local/share` op Linux; zie [`datamap_basis`]), te overschrijven met
//! `OPENAEC_GUI_CONTROL_FILE`. Staat het daar niet, maar wel onder de vorige
//! identifier, dan draait een app tot en met 2026.39.1 en geldt dat bestand.
//! Het kanaal staat bij een nieuwe installatie standaard aan. Een expliciete
//! keuze voor uit in Instellingen → AI-assistent (MCP) blijft bewaard; met
//! `OPENAEC_GUI_CONTROL=1` kan het kanaal voor één sessie alsnog starten.
//! Ontbreekt het bestand, luistert er niets of hoort het bij een eerdere
//! sessie, dan komt er één duidelijke fout met foutcode `APP_NIET_BEREIKBAAR`
//! die zegt wat te doen (zie [`niet_bereikbaar`]).
//!
//! # `gui_start_app` (issue #109)
//!
//! De enige tool die een proces start: de geïnstalleerde app, met
//! `OPENAEC_GUI_CONTROL=1` in de omgeving van het nieuwe proces, als er nog
//! geen bereikbaar kanaal is én de app nog niet draait. De app-exe staat naast
//! deze server (de installatiemap), of waar `OPENAEC_APP` naar wijst; een
//! ander pad aannemen kan niet — een assistent kiest hier geen programma.
//! Draait de app al zonder kanaal, dan start hij niets: een tweede start zou
//! de single-instance van de app (#90) toch alleen naar het bestaande venster
//! sturen. Dan zegt de fout dat de gebruiker de instelling moet aanzetten.
//! Alleen een app van dezelfde gebruiker in dezelfde sessie telt: de
//! single-instance werkt per sessie. De gestarte app erft niets van deze
//! server: geen stdin/stdout/stderr, en op Windows ook niet de pijpen van de
//! MCP-client (zie `start_proces`).
//!
//! Antwoorden gaan ongewijzigd door: `structuredContent` is precies wat de
//! actie teruggaf, en een toolfout draagt de tekst van de app.

use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use crate::RpcError;

/// De drieëntwintig tools. Eén lijst, gebruikt door `is_gui_tool`, de schema's en de
/// dispatch — zodat een tool niet in de lijst kan staan zonder afhandeling.
pub const GUI_TOOLS: [&str; 23] = [
    "gui_quit",
    "gui_status",
    "gui_start_app",
    "gui_load_model",
    "gui_build_model",
    "gui_build_3d_model",
    "gui_build_3d_steel_hall",
    "gui_import_ifc_analysis_model",
    "gui_configure_3d_view",
    "gui_select_3d_combination",
    "gui_select_member",
    "gui_select_3d_plate",
    "gui_split_3d_member",
    "gui_set_cage",
    "gui_set_analysis",
    "gui_solve",
    "gui_run_checks",
    "gui_open_curtailment",
    "gui_set_view",
    "gui_detach_report",
    "gui_read_checks",
    "gui_screenshot",
    "gui_export_report_pdf",
];

pub fn is_gui_tool(naam: &str) -> bool {
    GUI_TOOLS.contains(&naam)
}

// ── Het kanaal vinden ───────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
struct Vindbestand {
    pid: u32,
    poort: u16,
    token: String,
    #[serde(default)]
    versie: String,
}

/// De identifier van de app; haar app-datamap heet zo. Gelijk aan
/// `identifier` in `src-tauri/tauri.conf.json` (zie de test onderaan).
const APP_IDENTIFIER: &str = "org.openaec.fem-studio";

/// De identifier tot en met uitgave 2026.39.1. Een app van die versie schrijft
/// haar vindbestand nog onder deze map.
const OUDE_APP_IDENTIFIER: &str = "org.openaec.fem2d-studio";

/// De map waarin Tauri de app-datamap (`app_local_data_dir`) aanmaakt, per
/// platform zoals Tauri hem kiest: Windows `%LOCALAPPDATA%`, macOS
/// `~/Library/Application Support`, Linux `$XDG_DATA_HOME` (als dat een
/// absoluut pad is) en anders `~/.local/share`. De app-datamap zelf is die map
/// plus [`APP_IDENTIFIER`]. Zonder de nodige variabele: `None`, geen gok.
fn datamap_basis(
    os: &str,
    localappdata: Option<&str>,
    home: Option<&str>,
    xdg_data_home: Option<&str>,
) -> Option<PathBuf> {
    let niet_leeg = |s: Option<&str>| s.filter(|v| !v.trim().is_empty()).map(PathBuf::from);
    match os {
        "windows" => niet_leeg(localappdata),
        "macos" => Some(niet_leeg(home)?.join("Library").join("Application Support")),
        _ => match niet_leeg(xdg_data_home).filter(|p| p.is_absolute() || p.starts_with("/")) {
            Some(x) => Some(x),
            None => Some(niet_leeg(home)?.join(".local").join("share")),
        },
    }
}

/// [`datamap_basis`] op deze computer.
fn datamap_basis_hier() -> Result<PathBuf, RpcError> {
    let var = |n: &str| std::env::var(n).ok();
    datamap_basis(
        std::env::consts::OS,
        var("LOCALAPPDATA").as_deref(),
        var("HOME").as_deref(),
        var("XDG_DATA_HOME").as_deref(),
    )
    .ok_or_else(|| {
        niet_bereikbaar(
            "de app-datamap is onbekend (LOCALAPPDATA, of op macOS en Linux HOME, is niet gezet); zet \
             OPENAEC_GUI_CONTROL_FILE",
        )
    })
}

/// Het vindbestand uit `OPENAEC_GUI_CONTROL_FILE`, als dat gezet en niet leeg is.
fn eigen_vindbestand() -> Option<PathBuf> {
    match std::env::var("OPENAEC_GUI_CONTROL_FILE") {
        Ok(p) if !p.trim().is_empty() => Some(PathBuf::from(p)),
        _ => None,
    }
}

fn vindbestand_pad() -> Result<PathBuf, RpcError> {
    if let Some(p) = eigen_vindbestand() {
        return Ok(p);
    }
    Ok(kies_vindbestand(&datamap_basis_hier()?))
}

/// Het vindbestand onder de identifier van deze versie. Bestaat dat niet,
/// maar dat onder de vorige identifier wel, dan dat (een oudere app). Bestaat
/// geen van beide, dan het nieuwe pad, voor de foutmelding.
fn kies_vindbestand(basis: &std::path::Path) -> std::path::PathBuf {
    let nieuw = basis.join(APP_IDENTIFIER).join("gui-control.json");
    if nieuw.exists() {
        return nieuw;
    }
    let oud = basis.join(OUDE_APP_IDENTIFIER).join("gui-control.json");
    if oud.exists() {
        oud
    } else {
        nieuw
    }
}

/// Wat te doen als de app niet bereikbaar is — voor een mens én voor een
/// assistent die het aan een mens moet uitleggen.
const REMEDIE_NIET_BEREIKBAAR: &str =
    "Start Open FEM Studio. Bij een nieuwe installatie staat Instellingen → AI-assistent (MCP) \
     standaard aan; is de bediening bewust uitgezet, zet \"Bediening door een AI-assistent \
     toestaan\" daar weer aan. Of roep gui_start_app aan, dat de geïnstalleerde app met bediening \
     start als hij nog niet draait. Voor ontwikkelaars: start de app met OPENAEC_GUI_CONTROL=1.";

/// De fout als de app niet bereikbaar is: de reden, wat te doen, en de vaste
/// foutcode `APP_NIET_BEREIKBAAR` in `structuredContent`.
fn niet_bereikbaar(reden: impl std::fmt::Display) -> RpcError {
    let melding = format!("Open FEM Studio is niet bereikbaar: {reden}.");
    RpcError {
        code: -32000,
        message: format!("{melding} {REMEDIE_NIET_BEREIKBAAR}"),
        data: Some(json!({
            "error_code": "APP_NIET_BEREIKBAAR",
            "melding": melding,
            "remedie": REMEDIE_NIET_BEREIKBAAR,
        })),
    }
}

/// Lees het vindbestand op `pad`.
fn lees_kanaal(pad: &Path) -> Result<Vindbestand, RpcError> {
    let tekst = std::fs::read_to_string(pad).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            niet_bereikbaar(format!(
                "er is geen vindbestand ({} bestaat niet) — de app draait niet, of de bediening \
                 staat uit",
                pad.display()
            ))
        } else {
            niet_bereikbaar(format!("het vindbestand {} is niet leesbaar: {e}", pad.display()))
        }
    })?;
    serde_json::from_str(&tekst)
        .map_err(|e| niet_bereikbaar(format!("het vindbestand {} is onleesbaar: {e}", pad.display())))
}

fn kanaal() -> Result<Vindbestand, RpcError> {
    lees_kanaal(&vindbestand_pad()?)
}

/// Roep één actie aan over het kanaal. Synchroon; de dispatch zet dit op een
/// blocking-thread zodat de stdio-lus niet stilstaat.
fn roep(naam: &str, args: Value, tijdslimiet_s: u64) -> Result<Value, RpcError> {
    roep_op(&kanaal()?, naam, args, tijdslimiet_s)
}

/// Zoals [`roep`], op een kanaal dat al gelezen is.
fn roep_op(k: &Vindbestand, naam: &str, args: Value, tijdslimiet_s: u64) -> Result<Value, RpcError> {
    let url = format!("http://127.0.0.1:{}/opdracht", k.poort);
    let antwoord = ureq::post(&url)
        .set("Authorization", &format!("Bearer {}", k.token))
        .timeout(Duration::from_secs(tijdslimiet_s + 15))
        .send_json(json!({ "naam": naam, "args": args, "tijdslimiet_s": tijdslimiet_s }));

    let body: Value = match antwoord {
        Ok(r) => r
            .into_json()
            .map_err(|e| RpcError::tool_exec(format!("antwoord van de app onleesbaar: {e}")))?,
        // Een ander token: het vindbestand hoort bij een eerdere sessie (de app
        // is herstart, of het kanaal ging uit en weer aan) en is niet bijgewerkt.
        Err(ureq::Error::Status(401, _)) => {
            return Err(niet_bereikbaar(format!(
                "het token uit het vindbestand wordt op poort {} geweigerd — het bestand hoort bij \
                 een eerdere sessie (pid {})",
                k.poort, k.pid
            )));
        }
        // Het kanaal ging uit terwijl deze opdracht onderweg was.
        Err(ureq::Error::Status(503, _)) => {
            return Err(niet_bereikbaar(format!(
                "de bediening is in de app uitgezet (pid {}, poort {})",
                k.pid, k.poort
            )));
        }
        Err(ureq::Error::Status(code, r)) => {
            let tekst = r.into_string().unwrap_or_default();
            return Err(RpcError::tool_exec(format!(
                "de app antwoordde HTTP {code}: {tekst}"
            )));
        }
        Err(ureq::Error::Transport(t)) => {
            return Err(niet_bereikbaar(format!(
                "het vindbestand noemt pid {} op poort {}, maar daar antwoordt niets ({t}) — de app \
                 is gesloten of de bediening is uitgezet",
                k.pid, k.poort
            )));
        }
    };

    if body.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(body.get("uitkomst").cloned().unwrap_or(Value::Null))
    } else {
        Err(RpcError::tool_exec(
            body.get("fout")
                .and_then(Value::as_str)
                .unwrap_or("de app meldde een fout zonder tekst")
                .to_string(),
        ))
    }
}

/// `GET /status` op de poort van een kanaal, met hetzelfde sessietoken als opdrachten.
fn poort_status(k: &Vindbestand, tijd: Duration) -> Result<Value, RpcError> {
    let url = format!("http://127.0.0.1:{}/status", k.poort);
    ureq::get(&url)
        .set("Authorization", &format!("Bearer {}", k.token))
        .timeout(tijd)
        .call()
        .map_err(|e| {
            niet_bereikbaar(format!(
                "het vindbestand noemt pid {} op poort {}, maar daar antwoordt niets ({e}) — de app \
                 is gesloten of de bediening is uitgezet",
                k.pid, k.poort
            ))
        })?
        .into_json()
        .map_err(|e| RpcError::tool_exec(format!("status onleesbaar: {e}")))
}

fn status() -> Result<Value, RpcError> {
    let k = kanaal()?;
    let basis = poort_status(&k, Duration::from_secs(5))?;
    // De pagina weet meer (weergave, selectie, aantallen); haal dat erbij.
    let pagina = roep_op(&k, "status", json!({}), 10).unwrap_or(Value::Null);
    Ok(json!({
        "bereikbaar": true,
        "pid": k.pid,
        "poort": k.poort,
        "versie": if k.versie.is_empty() { basis["versie"].clone() } else { json!(k.versie) },
        "pagina": pagina,
    }))
}

// ── De app starten: gui_start_app (issue #109) ──────────────────────────────

/// Het pad van de app-exe, als die niet naast deze server staat. Dezelfde
/// variabele als die van de testscripts in design-mockup/referentie-gui/.
const APP_VARIABELE: &str = "OPENAEC_APP";
const STANDAARD_START_S: u64 = 60;
const MIN_START_S: u64 = 5;
const MAX_START_S: u64 = 300;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StartApp {
    #[serde(default)]
    timeout_s: Option<u64>,
}

/// `open-fem-studio` met de exe-extensie van het platform.
fn app_bestandsnaam() -> String {
    format!("open-fem-studio{}", std::env::consts::EXE_SUFFIX)
}

/// Een fout met een eigen foutcode en remedie (in `structuredContent`).
fn startfout(code: &str, melding: String, remedie: &str) -> RpcError {
    RpcError {
        code: -32000,
        message: format!("{melding} {remedie}"),
        data: Some(json!({ "error_code": code, "melding": melding, "remedie": remedie })),
    }
}

/// De app-exe: waar `OPENAEC_APP` naar wijst, anders `open-fem-studio(.exe)`
/// naast deze server (de installer zet beide in de installatiemap).
fn kies_app_exe(omgeving: Option<&str>, eigen_exe: &Path) -> Result<PathBuf, RpcError> {
    let (pad, herkomst) = match omgeving.filter(|s| !s.trim().is_empty()) {
        Some(p) => (PathBuf::from(p), format!("{APP_VARIABELE} wijst naar {p}")),
        None => {
            let p = eigen_exe.parent().unwrap_or(Path::new(".")).join(app_bestandsnaam());
            (p.clone(), format!("naast deze MCP-server hoort {} te staan", p.display()))
        }
    };
    if pad.is_file() {
        return Ok(pad);
    }
    Err(startfout(
        "APP_NIET_GEVONDEN",
        format!("Open FEM Studio is niet gevonden: {herkomst}, maar daar staat geen bestand."),
        "Gebruik de MCP-server uit de installatiemap van Open FEM Studio (Instellingen → \
         AI-assistent (MCP) in de app toont het pad), of zet OPENAEC_APP op het pad van \
         open-fem-studio.exe. Er is niets gestart.",
    ))
}

/// De pids uit de uitvoer van `tasklist /FO CSV /NH` met deze exe-naam. Leest
/// alleen de CSV-regels, zodat de (vertaalde) melding "geen taken" niet
/// uitmaakt.
fn pids_uit_tasklist(uitvoer: &str, exe_naam: &str) -> Vec<u32> {
    uitvoer
        .lines()
        .filter_map(|r| {
            let r = r.trim().strip_prefix('"')?;
            let velden: Vec<&str> = r.split("\",\"").collect();
            if velden.len() >= 2 && velden[0].eq_ignore_ascii_case(exe_naam) {
                velden[1].trim_end_matches('"').parse().ok()
            } else {
                None
            }
        })
        .collect()
}

/// De argumenten van `tasklist`: processen met deze exe-naam, en met een
/// bekende sessie alleen die in die sessie. Een app in de sessie van een
/// ándere gebruiker (terminalserver, snelle gebruikerswisseling) telt niet:
/// de single-instance van de app (#90) werkt per sessie, dus een eigen start
/// kan dan gewoon, en die andere app is voor deze gebruiker niet te bedienen.
fn tasklist_args(exe_naam: &str, sessie: Option<u32>) -> Vec<String> {
    let mut args = vec!["/FI".to_owned(), format!("IMAGENAME eq {exe_naam}")];
    if let Some(s) = sessie {
        args.extend(["/FI".to_owned(), format!("SESSION eq {s}")]);
    }
    args.extend(["/FO", "CSV", "/NH"].map(str::to_owned));
    args
}

/// De argumenten van `pgrep`: processen van deze gebruiker met precies deze naam.
#[cfg_attr(windows, allow(dead_code))]
fn pgrep_args(exe_naam: &str, uid: u32) -> Vec<String> {
    vec!["-u".to_owned(), uid.to_string(), "-x".to_owned(), exe_naam.to_owned()]
}

/// Kleine aanroepen van het besturingssysteem, zonder extra crate.
#[cfg(windows)]
mod os {
    use std::ffi::c_void;

    #[link(name = "kernel32")]
    extern "system" {
        fn ProcessIdToSessionId(pid: u32, sessie: *mut u32) -> i32;
        fn SetHandleInformation(handle: *mut c_void, masker: u32, vlaggen: u32) -> i32;
    }

    /// De sessie van dit proces.
    pub fn eigen_sessie() -> Option<u32> {
        let mut sessie = 0u32;
        // SAFETY: een geldige pointer naar een u32 die deze aanroep vult.
        (unsafe { ProcessIdToSessionId(std::process::id(), &mut sessie) } != 0).then_some(sessie)
    }

    /// Haal de erfbaarheid van de eigen stdin, stdout en stderr af.
    ///
    /// Rust start elk kindproces met `bInheritHandles = TRUE`; het kind erft
    /// dan élke erfbare handle van deze server, ook zijn std-handles — de
    /// pijpen van de MCP-client. Een app die zo gestart is, houdt die pijpen
    /// open zolang hij draait, en de client ziet het einde van stdout pas als
    /// de app stopt. `Stdio::null()` in het kind verandert daar niets aan.
    ///
    /// Veilig voor de andere kinderen van de server: die krijgen `piped` of
    /// `null`, en `Stdio::inherit` dupliceert de handle zelf als erfbaar.
    pub fn std_handles_niet_erfbaar() {
        use std::os::windows::io::AsRawHandle;
        const HANDLE_FLAG_INHERIT: u32 = 0x0000_0001;
        for handle in [
            std::io::stdin().as_raw_handle(),
            std::io::stdout().as_raw_handle(),
            std::io::stderr().as_raw_handle(),
        ] {
            // Geen handle (null) of INVALID_HANDLE_VALUE (-1): niets te doen.
            if handle.is_null() || handle as isize == -1 {
                continue;
            }
            // SAFETY: een std-handle van dit proces; alleen de erfvlag gaat eraf.
            unsafe {
                SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

#[cfg(unix)]
mod os {
    extern "C" {
        fn getuid() -> u32;
    }

    /// De gebruiker van dit proces.
    pub fn eigen_uid() -> u32 {
        // SAFETY: getuid heeft geen argumenten en faalt nooit.
        unsafe { getuid() }
    }
}

/// De processen met deze exe-naam van deze gebruiker in deze sessie, of
/// `None` als dat niet na te gaan is.
fn draaiende_pids(exe_naam: &str) -> Option<Vec<u32>> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let uit = std::process::Command::new("tasklist")
            .args(tasklist_args(exe_naam, os::eigen_sessie()))
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if !uit.status.success() {
            return None;
        }
        Some(pids_uit_tasklist(&String::from_utf8_lossy(&uit.stdout), exe_naam))
    }
    #[cfg(not(windows))]
    {
        let args = {
            #[cfg(unix)]
            {
                pgrep_args(exe_naam, os::eigen_uid())
            }
            #[cfg(not(unix))]
            {
                vec!["-x".to_owned(), exe_naam.to_owned()]
            }
        };
        let uit = std::process::Command::new("pgrep")
            .args(args)
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()?;
        Some(
            String::from_utf8_lossy(&uit.stdout)
                .lines()
                .filter_map(|r| r.trim().parse().ok())
                .collect(),
        )
    }
}

/// Wat `start_en_wacht` start en waar het op wacht.
struct Start {
    exe: PathBuf,
    args: Vec<OsString>,
    /// Extra omgeving voor het nieuwe proces (`OPENAEC_GUI_CONTROL=1`).
    env: Vec<(OsString, OsString)>,
    /// Waar het vindbestand van de gestarte app verschijnt.
    vindbestand: PathBuf,
    tijdslimiet: Duration,
}

/// Start het proces los van deze server: zonder stdin/stdout/stderr (stdout is
/// hier het protocol), en op Windows in een eigen procesgroep zonder console
/// en zo mogelijk buiten de job van de MCP-client, zodat de app blijft draaien
/// als de client de server afsluit. Op Windows gaan eerst de eigen std-handles
/// van de server op niet-erfbaar (zie [`os::std_handles_niet_erfbaar`]): anders
/// houdt de app de pijpen van de client open (tests/gui_start_app_pijpen.rs).
fn start_proces(s: &Start) -> std::io::Result<std::process::Child> {
    #[cfg(windows)]
    os::std_handles_niet_erfbaar();
    let maak = |_vlaggen: u32| {
        let mut c = std::process::Command::new(&s.exe);
        c.args(&s.args)
            .envs(s.env.iter().map(|(k, v)| (k.as_os_str(), v.as_os_str())))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        if let Some(map) = s.exe.parent().filter(|m| !m.as_os_str().is_empty()) {
            c.current_dir(map);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(_vlaggen);
        }
        c.spawn()
    };
    #[cfg(windows)]
    {
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
        let basis = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
        // Staat de job van de client geen uitbreken toe, dan zonder.
        maak(basis | CREATE_BREAKAWAY_FROM_JOB).or_else(|_| maak(basis))
    }
    #[cfg(not(windows))]
    {
        maak(0)
    }
}

/// Start de app en wacht tot (1) het vindbestand van DIT proces er is en zijn
/// poort antwoordt, en (2) de pagina een opdracht beantwoordt — hooguit
/// `tijdslimiet`. Stopt het proces voor die tijd, dan is dat meestal een
/// tweede start die de single-instance van de app naar een al draaiend
/// venster doorstuurde.
fn start_en_wacht(s: &Start) -> Result<Value, RpcError> {
    let begin = Instant::now();
    let deadline = begin + s.tijdslimiet;
    // Een vindbestand van vóór deze start (een achtergebleven bestand) telt
    // niet; de marge vangt de grofheid van bestandstijden op.
    let gestart_om = SystemTime::now() - Duration::from_secs(1);
    let mut kind = start_proces(s).map_err(|e| {
        startfout(
            "APP_START_MISLUKT",
            format!("Open FEM Studio ({}) is niet te starten: {e}.", s.exe.display()),
            "Start de app zelf en zet Instellingen → AI-assistent (MCP) aan.",
        )
    })?;
    let pid = kind.id();
    let van_deze_start = |pad: &Path, v: &Vindbestand| {
        v.pid == pid
            || std::fs::metadata(pad)
                .and_then(|m| m.modified())
                .is_ok_and(|t| t >= gestart_om)
    };

    let kanaal = loop {
        if let Ok(Some(einde)) = kind.try_wait() {
            return Err(startfout(
                "APP_GESTOPT",
                format!(
                    "Open FEM Studio ({}) stopte direct na het starten ({einde}) zonder \
                     bedieningskanaal.",
                    s.exe.display()
                ),
                "Meestal draait de app dan al zonder bediening: een tweede start geeft alleen het \
                 venster door. Zet in die app Instellingen → AI-assistent (MCP) aan.",
            ));
        }
        if let Ok(v) = lees_kanaal(&s.vindbestand) {
            if van_deze_start(&s.vindbestand, &v) && poort_status(&v, Duration::from_secs(2)).is_ok() {
                break v;
            }
        }
        if Instant::now() >= deadline {
            return Err(startfout(
                "APP_START_TIJD",
                format!(
                    "Open FEM Studio is gestart (pid {pid}), maar binnen {} s verscheen er geen \
                     bedieningskanaal in {}.",
                    s.tijdslimiet.as_secs(),
                    s.vindbestand.display()
                ),
                "Wacht tot de app geladen is en roep gui_status aan, of verhoog timeout_s.",
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    };

    // De poort antwoordt; de pagina luistert pas als ze geladen is.
    let pagina = loop {
        match roep_op(&kanaal, "status", json!({}), 3) {
            Ok(p) => break p,
            Err(e) => {
                if Instant::now() >= deadline {
                    return Err(startfout(
                        "APP_START_TIJD",
                        format!(
                            "Open FEM Studio draait (pid {}, poort {}), maar de pagina antwoordde niet \
                             binnen {} s ({}).",
                            kanaal.pid,
                            kanaal.poort,
                            s.tijdslimiet.as_secs(),
                            e.message
                        ),
                        "Wacht tot de app geladen is en roep gui_status aan, of verhoog timeout_s.",
                    ));
                }
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    };
    Ok(json!({
        "gestart": true,
        "pid": kanaal.pid,
        "poort": kanaal.poort,
        "versie": kanaal.versie,
        "app_pad": s.exe.to_string_lossy(),
        "wachttijd_ms": begin.elapsed().as_millis() as u64,
        "pagina": pagina,
    }))
}

/// `gui_start_app`: zie de moduletekst.
fn start_app(args: Value) -> Result<Value, RpcError> {
    let a: StartApp = lees("gui_start_app", args)?;
    let tijd = a.timeout_s.unwrap_or(STANDAARD_START_S);
    if !(MIN_START_S..=MAX_START_S).contains(&tijd) {
        return Err(RpcError::invalid_params(format!(
            "gui_start_app: `timeout_s` must lie between {MIN_START_S} and {MAX_START_S}, not {tijd}"
        )));
    }
    // 1. Al bereikbaar: niets starten.
    if let Ok(st) = status() {
        return Ok(json!({ "gestart": false, "al_bereikbaar": true, "status": st }));
    }
    // 2. De app-exe.
    let eigen = std::env::current_exe().unwrap_or_default();
    let exe = kies_app_exe(std::env::var(APP_VARIABELE).ok().as_deref(), &eigen)?;
    // 3. Draait hij al, zonder bereikbaar kanaal? Dan geen tweede app.
    let exe_naam = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if let Some(pids) = draaiende_pids(&exe_naam).filter(|p| !p.is_empty()) {
        let lijst: Vec<String> = pids.iter().map(u32::to_string).collect();
        return Err(startfout(
            "APP_DRAAIT_ZONDER_KANAAL",
            format!(
                "Open FEM Studio draait al (pid {}), maar zonder bereikbaar bedieningskanaal; er is \
                 geen tweede app gestart.",
                lijst.join(", ")
            ),
            "Zet in die app Instellingen → AI-assistent (MCP) aan (\"Bediening door een \
             AI-assistent toestaan\"), of sluit de app en roep gui_start_app opnieuw aan.",
        ));
    }
    // 4. Starten met het kanaal aan, en wachten. Op het vindbestand onder de
    // identifier van DEZE versie (of OPENAEC_GUI_CONTROL_FILE): een
    // achtergebleven bestand onder de vorige identifier hoort niet bij de app
    // die nu start. OPENAEC_GUI_CONTROL_FILE gaat niet expliciet mee naar de
    // app (alleen geërfd als het hier al gezet is): met een eigen vindbestand
    // zou de app buiten de bewaking op één venster vallen (#90).
    let vindbestand = match eigen_vindbestand() {
        Some(p) => p,
        None => datamap_basis_hier()?.join(APP_IDENTIFIER).join("gui-control.json"),
    };
    start_en_wacht(&Start {
        exe,
        args: Vec::new(),
        env: vec![("OPENAEC_GUI_CONTROL".into(), "1".into())],
        vindbestand,
        tijdslimiet: Duration::from_secs(tijd),
    })
}

// ── Dispatch ────────────────────────────────────────────────────────────────

fn lees<T: for<'de> Deserialize<'de>>(naam: &str, args: Value) -> Result<T, RpcError> {
    serde_json::from_value(args).map_err(|e| RpcError::invalid_params(format!("{naam}: {e}")))
}

#[derive(Deserialize)]
struct Leeg {}
#[derive(Deserialize)]
struct MetPad {
    path: String,
}
#[derive(Deserialize)]
struct MetId {
    id: u64,
}
#[derive(Deserialize)]
struct MetBeamId {
    beam_id: u64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Splits3DStaaf { beam_id: u64, ratio: f64 }
/// `gui_build_3d_steel_hall`: de halparameters gaan ongewijzigd naar de
/// pagina; de generator in de app leest ze met zijn eigen strikte poort.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Staalhal { #[serde(default)] hal: Option<Value> }
/// `gui_import_ifc_analysis_model`: de app leest het bestand via Rust
/// (`gui_control.rs`) en importeert het met dezelfde functie als de knop
/// "Rekenmodel importeren".
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IfcImport {
    path: String,
    #[serde(default)]
    analysis_model: Option<Value>,
}
#[derive(Deserialize)]
struct Korf {
    beam_id: u64,
    cage: Value,
}
#[derive(Deserialize)]
struct Analyse {
    analysis_type: String,
}
#[derive(Deserialize)]
struct Weergave {
    view: String,
}
#[derive(Deserialize)]
struct Schermafdruk {
    #[serde(default = "hoofdvenster")]
    window: String,
    path: String,
    #[serde(default)]
    dom: bool,
}
fn hoofdvenster() -> String {
    "main".into()
}

/// `gui_export_report_pdf`. Strikt: een tikfout in een veldnaam (bijvoorbeeld
/// `reporttype`) is een fout, geen stil genegeerd veld dat een ander rapport
/// oplevert dan gevraagd.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RapportExport {
    path: String,
    #[serde(default)]
    report_type: Option<String>,
    #[serde(default)]
    page_size: Option<String>,
    #[serde(default)]
    orientation: Option<String>,
    #[serde(default)]
    project: Option<ProjectKop>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectKop {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    number: Option<String>,
    #[serde(default)]
    engineer: Option<String>,
    #[serde(default)]
    company: Option<String>,
    #[serde(default)]
    date: Option<String>,
}

/// Eén keuze uit een vaste lijst, of een invalid_params met de toegestane waarden.
fn keuze(
    veld: &str,
    waarde: Option<String>,
    toegestaan: &[&str],
) -> Result<Option<String>, RpcError> {
    match waarde {
        None => Ok(None),
        Some(v) if toegestaan.contains(&v.as_str()) => Ok(Some(v)),
        Some(v) => Err(RpcError::invalid_params(format!(
            "gui_export_report_pdf: `{veld}` must be one of {}, not {v:?}",
            toegestaan.join(" | ")
        ))),
    }
}

/// Vertaal de MCP-argumenten naar de kanaalopdracht `rapport_pdf` (Nederlandse
/// veldnamen, zoals alle opdrachten van `gui_control.rs`). Los van het aanroepen,
/// zodat de vertaling zonder draaiende app te toetsen is.
fn rapport_pdf_args(a: RapportExport) -> Result<Value, RpcError> {
    let pad = std::path::Path::new(&a.path);
    if !pad.is_absolute() {
        return Err(RpcError::invalid_params(format!(
            "gui_export_report_pdf: `path` must be absolute, not {:?}",
            a.path
        )));
    }
    let is_pdf = pad
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err(RpcError::invalid_params(format!(
            "gui_export_report_pdf: `path` must end in .pdf, not {:?}",
            a.path
        )));
    }
    let mut uit = serde_json::Map::new();
    uit.insert("pad".into(), json!(a.path));
    if let Some(t) = keuze("report_type", a.report_type, &["volledig", "beperkt"])? {
        uit.insert("type".into(), json!(t));
    }
    if let Some(f) = keuze("page_size", a.page_size, &["A4", "A3"])? {
        uit.insert("formaat".into(), json!(f));
    }
    if let Some(o) = keuze("orientation", a.orientation, &["portrait", "landscape"])? {
        uit.insert("orientatie".into(), json!(o));
    }
    if let Some(p) = a.project {
        let mut kop = serde_json::Map::new();
        for (k, v) in [
            ("naam", p.name),
            ("nummer", p.number),
            ("constructeur", p.engineer),
            ("bedrijf", p.company),
            ("datum", p.date),
        ] {
            if let Some(v) = v {
                kop.insert(k.into(), json!(v));
            }
        }
        uit.insert("project".into(), Value::Object(kop));
    }
    Ok(Value::Object(uit))
}

/// Het rapport exporteren en de PDF terugleveren. De bytes komen uit het
/// GESCHREVEN BESTAND, niet uit een tweede afdruk: wat de client als base64
/// krijgt, is precies wat op schijf staat en wat de app heeft gecontroleerd.
fn export_report_pdf(args: Value) -> Result<Value, RpcError> {
    let a: RapportExport = lees("gui_export_report_pdf", args)?;
    let kanaal_args = rapport_pdf_args(a)?;
    // Ruim: de app wacht op rekenen, toetsen en paginering vóór hij print.
    let uit = roep("rapport_pdf", kanaal_args, 300)?;
    let geschreven = uit
        .get("pad")
        .and_then(Value::as_str)
        .ok_or_else(|| RpcError::tool_exec("de app gaf geen pad van de PDF terug"))?
        .to_string();
    let bytes = std::fs::read(&geschreven).map_err(|e| {
        RpcError::tool_exec(format!("de PDF op {geschreven} is niet te lezen: {e}"))
    })?;
    if let Some(gemeld) = uit.get("bytes").and_then(Value::as_u64) {
        if gemeld != bytes.len() as u64 {
            return Err(RpcError::tool_exec(format!(
                "de PDF op {geschreven} is veranderd tussen schrijven en lezen ({gemeld} → {} bytes)",
                bytes.len()
            )));
        }
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err(RpcError::tool_exec(format!("{geschreven} is geen PDF")));
    }
    Ok(json!({
        "path": geschreven,
        "bytes": bytes.len(),
        "pages": uit.get("paginas").cloned().unwrap_or(Value::Null),
        "sheets": uit.get("vellen").cloned().unwrap_or(Value::Null),
        "report_type": uit.get("rapportType").cloned().unwrap_or(Value::Null),
        "page_size": uit.get("formaat").cloned().unwrap_or(Value::Null),
        "orientation": uit.get("orientatie").cloned().unwrap_or(Value::Null),
        "pdf_base64": base64::engine::general_purpose::STANDARD.encode(&bytes),
        // Wat de app over dit document meldt (kop, toetsing, analysetype, wat er
        // is teruggezet) — in de woorden van de app.
        "details": uit,
    }))
}

/// Een API-commando (src/api/ in de app) uitvoeren in de draaiende app, via de
/// paginaopdracht `api_uitvoeren`. De pagina antwoordt altijd met
/// `{ ok, output }` of `{ ok: false, error: { code, melding, detail } }`, zodat
/// de foutcode van het register hier heel aankomt (het kanaal zelf kent alleen
/// een fouttekst).
pub(crate) fn roep_api(naam: &str, invoer: Value) -> Result<Value, RpcError> {
    let uit = roep("api_uitvoeren", json!({ "name": naam, "input": invoer }), 60)?;
    if uit.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(uit.get("output").cloned().unwrap_or(Value::Null));
    }
    let fout = uit.get("error").cloned().unwrap_or(Value::Null);
    let code = fout.get("code").and_then(Value::as_str).unwrap_or("INTERN").to_owned();
    let melding = fout
        .get("melding")
        .and_then(Value::as_str)
        .unwrap_or("de app meldde een fout zonder tekst")
        .to_owned();
    let remedie = openaec_mcp_server::sidecar::remedie_voor_code(&code);
    Err(RpcError {
        code: if code == "INVOER_ONGELDIG" { -32602 } else { -32000 },
        message: format!("[{code}] {melding} — {remedie}"),
        data: Some(json!({
            "error_code": code,
            "melding": melding,
            "remedie": remedie,
            "detail": fout.get("detail").cloned().unwrap_or(Value::Null),
        })),
    })
}

pub async fn dispatch(naam: &str, args: Value) -> Result<Value, RpcError> {
    let naam = naam.to_string();
    // ureq is synchroon; buiten de stdio-lus houden.
    tokio::task::spawn_blocking(move || dispatch_sync(&naam, args))
        .await
        .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?
}

fn dispatch_sync(naam: &str, args: Value) -> Result<Value, RpcError> {
    match naam {
        "gui_status" => {
            let _: Leeg = lees(naam, args)?;
            status()
        }
        "gui_start_app" => start_app(args),
        "gui_load_model" => {
            let a: MetPad = lees(naam, args)?;
            roep("model_laden", json!({ "pad": a.path }), 60)
        }
        "gui_build_model" => roep("model_bouwen", args, 60),
        "gui_build_3d_model" => roep("model_3d_bouwen", args, 60),
        "gui_build_3d_steel_hall" => {
            let a: Staalhal = lees(naam, args)?;
            roep("staalhal_maken", json!({ "hal": a.hal.unwrap_or_else(|| json!({})) }), 60)
        }
        "gui_import_ifc_analysis_model" => {
            let a: IfcImport = lees(naam, args)?;
            let mut opdracht = json!({ "pad": a.path });
            if let Some(keuze) = a.analysis_model {
                let geldig = keuze.as_str().is_some_and(|s| !s.trim().is_empty()) || keuze.as_u64().is_some_and(|n| n >= 1);
                if !geldig {
                    return Err(RpcError::invalid_params(
                        "gui_import_ifc_analysis_model: `analysis_model` is the model name or its 1-based number",
                    ));
                }
                opdracht["analysemodel"] = keuze;
            }
            roep("ifc_analysemodel_importeren", opdracht, 120)
        }
        "gui_configure_3d_view" => roep("weergave_3d_configureren", args, 30),
        "gui_select_3d_combination" => {
            let a: MetId = lees(naam, args)?;
            roep("resultaat_3d_kiezen", json!({ "id": a.id }), 30)
        }
        "gui_select_member" => {
            let a: MetId = lees(naam, args)?;
            roep("staaf_selecteren", json!({ "id": a.id }), 30)
        }
        "gui_select_3d_plate" => {
            let a: MetId = lees(naam, args)?;
            roep("plaat_3d_selecteren", json!({ "id": a.id }), 30)
        }
        "gui_split_3d_member" => {
            let a: Splits3DStaaf = lees(naam, args)?;
            if !a.ratio.is_finite() || a.ratio <= 1e-6 || a.ratio >= 1.0 - 1e-6 {
                return Err(RpcError::invalid_params(
                    "gui_split_3d_member: `ratio` must lie strictly between 0 and 1",
                ));
            }
            roep(
                "staaf_3d_splitsen",
                json!({ "beamId": a.beam_id, "ratio": a.ratio }),
                30,
            )
        }
        "gui_set_cage" => {
            let a: Korf = lees(naam, args)?;
            roep(
                "korf_zetten",
                json!({ "beamId": a.beam_id, "korf": a.cage }),
                30,
            )
        }
        "gui_set_analysis" => {
            let a: Analyse = lees(naam, args)?;
            roep(
                "analysetype_zetten",
                json!({ "analysetype": a.analysis_type }),
                30,
            )
        }
        "gui_solve" => {
            // `detail: "samenvatting"` (#229): standaard het volledige antwoord.
            let mut args = args;
            let samenvatting = crate::samenvatting::neem_detail(&mut args)
                .map_err(|e| RpcError::invalid_params(format!("{naam}: {e}")))?;
            let _: Leeg = lees(naam, args)?;
            let mut uit = roep("rekenen", json!({}), 120)?;
            if samenvatting {
                crate::samenvatting::samenvat_gui_solve(&mut uit);
            }
            Ok(uit)
        }
        "gui_run_checks" => {
            let _: Leeg = lees(naam, args)?;
            roep("toetsen", json!({}), 300)
        }
        "gui_open_curtailment" => {
            let a: MetBeamId = lees(naam, args)?;
            roep("dekkingslijn_openen", json!({ "beamId": a.beam_id }), 180)
        }
        "gui_set_view" => {
            let a: Weergave = lees(naam, args)?;
            roep("weergave_zetten", json!({ "view": a.view }), 30)
        }
        "gui_detach_report" => {
            let _: Leeg = lees(naam, args)?;
            roep("rapport_losmaken", json!({}), 60)
        }
        "gui_read_checks" => {
            let _: Leeg = lees(naam, args)?;
            roep("toetsen_uitlezen", json!({}), 30)
        }
        "gui_screenshot" => {
            let a: Schermafdruk = lees(naam, args)?;
            roep(
                "screenshot",
                json!({ "venster": a.window, "pad": a.path, "dom": a.dom }),
                60,
            )
        }
        "gui_quit" => {
            let _: Leeg = lees(naam, args)?;
            roep("afsluiten", json!({}), 10)
        }
        "gui_export_report_pdf" => export_report_pdf(args),
        anders => Err(RpcError::method_not_found(anders)),
    }
}

// ── Schema's ────────────────────────────────────────────────────────────────

fn leeg_schema() -> Value {
    json!({ "type": "object", "properties": {}, "additionalProperties": false })
}

pub fn tool_definitions() -> Vec<Value> {
    let vooraf = "Drives the RUNNING Open FEM Studio desktop app through its control channel \
                  (the user switches it on in the app under Settings → AI assistant (MCP), Dutch UI: \
                  Instellingen → AI-assistent (MCP); or the app is started with OPENAEC_GUI_CONTROL=1; \
                  gui_start_app starts the installed app with the channel on). ";
    vec![
        json!({
            "name": "gui_status",
            "description": format!("{vooraf}Reports whether the app is reachable, its pid/port/version, and what the page sees: active view, selection, member count, whether checks are running."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_start_app",
            "description": "Starts the installed Open FEM Studio desktop app with its control channel switched on (OPENAEC_GUI_CONTROL=1 in the environment of the new process) when it is not running yet, and waits until the channel and the page answer (timeout_s, default 60 s). Returns {gestart, pid, poort, versie, app_pad, wachttijd_ms, pagina}. When the channel is already reachable it starts nothing and returns {gestart: false, al_bereikbaar: true, status}. When the app is already running WITHOUT a reachable channel (for this user, in this session) it starts no second app and fails with APP_DRAAIT_ZONDER_KANAAL: the user then switches on Settings → AI assistant (MCP) in the app (Dutch UI: Instellingen → AI-assistent (MCP)). A channel opened by this tool lasts for this session only; the saved setting in the app is not changed. The executable is open-fem-studio next to this server (the installation folder), or the path in the environment variable OPENAEC_APP; it cannot be chosen through this tool.",
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "timeout_s": { "type": "integer", "minimum": MIN_START_S, "maximum": MAX_START_S, "default": STANDAARD_START_S,
                        "description": "How long to wait for the channel and the page, in seconds." }
                } }
        }),
        json!({
            "name": "gui_load_model",
            "description": format!("{vooraf}Loads a project file (.femp / .ifcfem / .ifcfem2d) into the app. The file is read by the app process itself, so any path the app can read works."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": { "path": { "type": "string", "description": "Absolute path to the project file." } } }
        }),
        json!({
            "name": "gui_build_model",
            "description": format!("{vooraf}Builds a model in the app from scratch through the same store actions the canvas uses. Coordinates in mm; loads per the app's Load type. A new project already holds the load cases \"Eigen gewicht\" (id 5, marked `eigenGewicht`: filled automatically with q = ρ·A·g per member, read-only — a load with that caseId is refused), \"Permanent (G)\" (id 1), \"Variabel (Q)\" (2), \"Sneeuw (S)\" (3) and \"Wind (W)\" (4); the result returns the load cases as they stand (`loadCases`, with `eigenGewicht` on the automatic one) and `selfWeightEnabled`."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "nodes": { "type": "array", "items": { "type": "object", "properties": { "x": {"type":"number"}, "z": {"type":"number"} }, "required": ["x","z"] } },
                    "beams": { "type": "array", "items": { "type": "object", "properties": { "from": {"type":"integer"}, "to": {"type":"integer"}, "updates": {"type":"object"} }, "required": ["from","to"] }, "description": "from/to are 1-based indices into `nodes`; `updates` is a Partial<Beam> applied after creation (material, profileName, betonKorf, ...)." },
                    "supports": { "type": "array", "items": { "type": "object", "properties": { "node": {"type":"integer"}, "type": {"type":"string"}, "k": {"type":"number"} }, "required": ["node","type"] } },
                    "loads": { "type": "array", "items": { "type": "object" }, "description": "Load objects without id (the app assigns ids)." },
                    "load_cases": { "type": "array", "items": { "type": "string" } }
                } }
        }),
        json!({
            "name": "gui_build_3d_model",
            "description": format!("{vooraf}Replaces the active project with a 3D frame model and opens its 3D workspace. Coordinates are metres; from/to/node are 1-based indices into nodes. Member profile_name, profile_name_end (tapered member), material, roll_angle_deg, local end releases, tension_only, bedding (member on an elastic foundation) and optional check_config are retained and feed the 3D view, solver, IFC and EN 1992/EN 1993 checks. Optional diaphragms couple X, Y and the rotation about Z of nodes at one height as a rigid horizontal plane. The model settings tension_only_fit_after_permanent (tension-only members fitted after the permanent load) and tension_only_cross_rule (of two crossing tension-only members one always stays active) go with the model. For concrete, check_config uses the same BeamCheckConfig fields as the properties panel (including betonKorf and optional betonKolom). Optional levels (horizontal structural-grid axes: label and height in metres) replace the levels of the structural grid; a node or plate with `level` (1-based index into levels) is linked to that level, so it moves along when the level height changes in the app. A linked node's z must equal the level height; a linked plate lies horizontally on the level with all its nodes. A plate with bedding lies on an elastic (Winkler) foundation, e.g. a ground floor slab on sand. Optional load_panels carry a surface load (kN/m²) without stiffness to the beams in their plane; the app converts them into member and nodal loads before the frame kernel and reports per panel which members carry and any warning."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "levels": { "type": "array", "description": "Levels: horizontal structural-grid axes with a label and a height in metres (e.g. Ground 0, First floor 3). A label that already exists in the app keeps its identity.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "label": {"type":"string"}, "position_m": {"type":"number"} }, "required": ["label","position_m"] } },
                    "nodes": { "type": "array", "items": { "type": "object", "additionalProperties": false,
                        "properties": { "x": {"type":"number"}, "y": {"type":"number"}, "z": {"type":"number"},
                            "level": {"type":"integer","minimum":1,"description":"1-based index into levels: the node is linked to that level; z must equal its height."} }, "required": ["x","y","z"] } },
                    "beams": { "type": "array", "items": { "type": "object", "additionalProperties": false,
                        "properties": { "from": {"type":"integer","minimum":1}, "to": {"type":"integer","minimum":1}, "profile_name": {"type":"string"}, "profile_name_end": {"type":"string","minLength":1,"description":"Tapered member: the section at the END (to node); the dimensions vary linearly from profile_name to profile_name_end. Same rules as a 2D tapered member: rectangle to rectangle or I/H to I/H from the steel catalogue (computed as a welded I section); other shapes are refused with the reason."}, "material": {"type":"string"},
                            "roll_angle_deg": {"type":"number","description":"Rotation of local y/z axes around the member axis, degrees."},
                            "releases": {"type":"object","additionalProperties":false,"description":"Released local end moments/torsion.",
                                "properties":{"my_start":{"type":"boolean"},"my_end":{"type":"boolean"},"mz_start":{"type":"boolean"},"mz_end":{"type":"boolean"},"torsion_start":{"type":"boolean"},"torsion_end":{"type":"boolean"}}},
                            "tension_only": {"type":"boolean","description":"Tension-only member (e.g. a round-bar wind brace): it drops out of a load case or combination in which it would be in compression (axial force 0)."},
                            "bedding": {"type":"object","additionalProperties":false,"required":["width_m"],
                                "description":"Member on an elastic (Winkler) foundation: soil springs k·b along the whole length; the solver subdivides the member itself. k_kn_per_m3 is the vertical modulus in kN/m³ (global Z, soil below the member), width_m the contact width b in metres, k_lateral_kn_per_m3 an optional lateral modulus in kN/m³ (horizontal, perpendicular to the member, both sides, always linear; all round, in two directions perpendicular to the axis, for a member steeper than 45°), compression_only drops the vertical springs where the member lifts. Give k_kn_per_m3, k_lateral_kn_per_m3 or both. A (nearly) vertical member (pile) takes only k_lateral_kn_per_m3.",
                                "properties":{"k_kn_per_m3":{"type":"number","exclusiveMinimum":0},"width_m":{"type":"number","exclusiveMinimum":0},
                                    "k_lateral_kn_per_m3":{"type":"number","exclusiveMinimum":0},"compression_only":{"type":"boolean"}}},
                            "check_config": {"type":"object","additionalProperties":true} }, "required": ["from","to"] } },
                    "supports": { "type": "array", "description":"A support needs a rigid preset, one or more global springs, or both on different DOFs. Springs are kN/m or kNm/rad. Prescribed translations are m and rotations rad and need a matching rigid preset DOF.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "node": {"type":"integer","minimum":1}, "type": {"type":"string","enum":["fixed","pinned","xRoller","yRoller","zRoller","revoluteX","revoluteY","revoluteZ"]},
                            "springs":{"type":"object","additionalProperties":false,"properties":{
                                "kx_kn_per_m":{"type":"number","exclusiveMinimum":0},"ky_kn_per_m":{"type":"number","exclusiveMinimum":0},"kz_kn_per_m":{"type":"number","exclusiveMinimum":0},
                                "krx_knm_per_rad":{"type":"number","exclusiveMinimum":0},"kry_knm_per_rad":{"type":"number","exclusiveMinimum":0},"krz_knm_per_rad":{"type":"number","exclusiveMinimum":0}
                            }},
                            "prescribed":{"type":"object","additionalProperties":false,"properties":{
                                "ux_m":{"type":"number"},"uy_m":{"type":"number"},"uz_m":{"type":"number"},
                                "rx_rad":{"type":"number"},"ry_rad":{"type":"number"},"rz_rad":{"type":"number"}
                            }} }, "required": ["node"] } },
                    "loads": { "type": "array", "items": { "type": "object", "additionalProperties": false,
                        "properties": { "node": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "fx": {"type":"number"}, "fy": {"type":"number"}, "fz": {"type":"number"}, "mx": {"type":"number"}, "my": {"type":"number"}, "mz": {"type":"number"} }, "required": ["node"] } }
                    ,"member_loads": { "type": "array", "description": "Trapezoidal loads in local member y/z axes, kN/m; positions are metres from member start. case_id selects the shared project load case (default 1).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "beam": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "qy_start": {"type":"number"}, "qy_end": {"type":"number"}, "qz_start": {"type":"number"}, "qz_end": {"type":"number"}, "start_m": {"type":"number","minimum":0}, "end_m": {"type":"number","exclusiveMinimum":0} }, "required": ["beam"] } }
                    ,"member_point_loads": { "type": "array", "description": "Concentrated loads in local member y/z axes, kN; position_m is metres from member start. case_id selects the shared project load case (default 1).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "beam": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "py": {"type":"number"}, "pz": {"type":"number"}, "position_m": {"type":"number","minimum":0} }, "required": ["beam","position_m"] } }
                    ,"thermal_loads": { "type": "array", "description": "Member temperature loads in K. The optional gradients act over the local y/z section directions.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "beam": {"type":"integer","minimum":1}, "case_id": {"type":"integer","minimum":1}, "delta_t_uniform_k": {"type":"number"}, "delta_t_gradient_y_k": {"type":"number"}, "delta_t_gradient_z_k": {"type":"number"} }, "required": ["beam"] } }
                    ,"plates": { "type": "array", "description": "Polygonal plates. nodes contains the ordered 1-based node indices; openings use the same format. Thickness and corner radii are metres.",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "nodes": {"type":"array","minItems":3,"items":{"type":"integer","minimum":1}}, "thickness_m":{"type":"number","exclusiveMinimum":0}, "material":{"type":"string"}, "corner_radius_m":{"type":"number","minimum":0},
                            "level":{"type":"integer","minimum":1,"description":"1-based index into levels: the plate lies horizontally on that level together with all its nodes (also those of its openings)."},
                            "openings":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"nodes":{"type":"array","minItems":3,"items":{"type":"integer","minimum":1}},"corner_radius_m":{"type":"number","minimum":0}},"required":["nodes"]}},
                            "bedding":{"type":"object","additionalProperties":false,"required":["k_kn_per_m3"],
                                "description":"Plate on an elastic (Winkler) foundation, e.g. a ground floor slab on sand: the solver puts a spring k·A perpendicular to the plate on every node of its mesh. k_kn_per_m3 is the modulus of subgrade reaction in kN/m³; the soil lies on the underside of the plate (against the plate normal: below a floor). compression_only drops the springs where the plate lifts. Without a support in its plane the solver holds the plate there as long as the load is perpendicular to it; a load in the plane of the plate needs a support.",
                                "properties":{"k_kn_per_m3":{"type":"number","exclusiveMinimum":0},"compression_only":{"type":"boolean"}}} }, "required": ["nodes"] } }
                    ,"surface_loads": { "type": "array", "description": "Global plate surface loads in kN/m².",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "plate":{"type":"integer","minimum":1}, "case_id":{"type":"integer","minimum":1}, "qx":{"type":"number"}, "qy":{"type":"number"}, "qz":{"type":"number"} }, "required": ["plate"] } }
                    ,"diaphragms": { "type": "array", "description": "Rigid horizontal diaphragms (e.g. a hollow-core floor with a structural topping): X, Y and the rotation about Z of the nodes move as one rigid body; Z and the rotations about X and Y stay free per node. nodes are 1-based node indices (at least 2) at one height within 1 mm; a node belongs to at most one diaphragm, and at most one of its nodes may hold the diaphragm in its plane (a support in X, Y or rotation about Z).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": { "nodes": {"type":"array","minItems":2,"items":{"type":"integer","minimum":1}}, "name": {"type":"string"} }, "required": ["nodes"] } }
                    ,"tension_only_fit_after_permanent": { "type": "boolean", "default": false,
                        "description": "Model setting: tension-only members are fitted after the permanent load. Their stress-free length follows the deformation under the permanent load cases (type dead, factor 1.0, including self-weight and load panels), so under that load alone they carry nothing; the result lists the fitting elongation per member." }
                    ,"tension_only_cross_rule": { "type": "boolean", "default": false,
                        "description": "Model setting (cross rule): of two tension-only members that cross each other in their interiors (axes within 1 mm, no shared end node), the one with the largest axial force always stays active, even with a small compressive force. Three or more members through one point do not count." }
                    ,"load_panels": { "type": "array", "description": "Load panels: a plane polygon over existing nodes without stiffness that transfers its load to the beams in that plane. nodes are the ordered 1-based corner node indices (at least 3, in one plane). q is kN/m² and non-zero. direction gravity acts in global -Z per m² HORIZONTAL PROJECTION (snow, floors, finishes); direction normal acts perpendicular to the panel per m² panel along a fixed normal that points down (for a vertical panel -Y, for a panel parallel to YZ -X), a negative q reverses it (suction); direction verticalSurface acts in global -Z per m² ACTUAL PANEL AREA (including vertical cladding). distribution oneWay sends every point along span_direction (a global vector, projected onto the panel; required for oneWay) to the nearest beam transverse to the span (at most 10 degrees off): half the distance to the neighbours as loaded width, edge beams half a strip; beams along the span and skewed members such as bracing get nothing. distribution twoWay sends every point to the nearest beam in the panel: 45-degree lines, triangles and trapezoids on four edge beams. A beam counts when both end nodes lie on the edge or inside the panel (1 mm). An edge without a beam sends its load to the nearest beam with a warning; a panel without any beam blocks the calculation. excluded_beams are 1-based member indices that get no load. case_id selects the shared project load case (default 1).",
                        "items": { "type": "object", "additionalProperties": false,
                        "properties": {
                            "nodes": {"type":"array","minItems":3,"items":{"type":"integer","minimum":1}},
                            "case_id": {"type":"integer","minimum":1},
                            "q": {"type":"number","description":"kN/m², non-zero."},
                            "direction": {"type":"string","enum":["gravity","normal","verticalSurface"]},
                            "distribution": {"type":"string","enum":["oneWay","twoWay"]},
                            "span_direction": {"type":"object","additionalProperties":false,"required":["x","y","z"],
                                "description":"Global span direction; projected onto the panel. Required for oneWay.",
                                "properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}}},
                            "excluded_beams": {"type":"array","items":{"type":"integer","minimum":1}}
                            ,"openings": {"type":"array","items":{"type":"object","additionalProperties":false,
                                "properties":{"nodes":{"type":"array","minItems":3,"items":{"type":"integer","minimum":1}}},"required":["nodes"]}}
                        }, "required": ["nodes","q","direction","distribution"] } }
                    ,"envelope_panels": { "type": "array", "description": "Facade and roof panels of the building envelope, independent of load cases and without stiffness. Ordered 1-based node indices define a planar polygon; openings remove area. The ordered nodes plus flip_outer_side define the outward normal. Load transfer uses the same oneWay/twoWay rules as load_panels. cladding_weight_kn_per_m2 is stored per actual surface area for the load generator.",
                        "items": { "type":"object","additionalProperties":false,
                        "properties": {
                            "nodes":{"type":"array","minItems":3,"items":{"type":"integer","minimum":1}},
                            "type":{"type":"string","enum":["facade","roof"]},
                            "name":{"type":"string"},
                            "flip_outer_side":{"type":"boolean"},
                            "distribution":{"type":"string","enum":["oneWay","twoWay"]},
                            "span_direction":{"type":"object","additionalProperties":false,"required":["x","y","z"],
                                "properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}}},
                            "cladding_weight_kn_per_m2":{"type":"number","minimum":0},
                            "openings":{"type":"array","items":{"type":"object","additionalProperties":false,
                                "properties":{"nodes":{"type":"array","minItems":3,"items":{"type":"integer","minimum":1}}},"required":["nodes"]}}
                        }, "required":["nodes","type","distribution"] } }
                } }
        }),
        json!({
            "name": "gui_build_3d_steel_hall",
            "description": format!("{vooraf}Builds a steel hall in the app with the same generator as the \"Stalen hal…\" wizard (and the MCP tool open_fem_3d_staalhal_maken): frames, purlins, eaves beams, roof and wall bracing, loads G/S/W and self-weight, optionally on a concrete beam grid on piles. Replaces the 3D model as ONE undo step, adds the hall's load cases to the project where missing (existing cases are kept and reused by name), sets the structural grid and opens the 3D workspace fitted to the model. Returns the counts, the project load-case ids and the member ids per group."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": { "hal": crate::staalhal_tools::hal_schema() } }
        }),
        json!({
            "name": "gui_import_ifc_analysis_model",
            "description": format!("{vooraf}Imports an IFC4 structural analysis model (Structural Analysis View) as a NEW 3D project, exactly as the button \"Rekenmodel importeren\" on the IFC ribbon tab does (and the MCP tool open_fem_3d_ifc_importeren, which works without the app): nodes, supports and springs, members with profile, material, roll and end releases, tension-only members, rigid diaphragms, load panels, member and nodal loads, load cases, combinations and levels. The app reads the file itself. Unsaved work in the app is replaced without asking. Returns the report: counts, tension-only members, diaphragms, explanations, warnings and everything that was not imported. With several analysis models in the file, `analysis_model` (name or 1-based number) is required; without it the error lists the models."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": {
                    "path": { "type": "string", "minLength": 1, "description": "Absolute path to the .ifc file (IFC4, STEP)." },
                    "analysis_model": crate::ifc_import_tools::analysemodel_schema()
                } }
        }),
        json!({
            "name": "gui_configure_3d_view",
            "description": format!("{vooraf}Configures the current 3D workspace: camera, visible objects, how plates are drawn (plateDisplay: volume, surface or mesh), the size of nodes and supports (in % of their automatic size), profile volumes, structural grid (grid axes and levels) and the section box. Structural-grid positions are metres. z_levels are the levels: a level whose label already exists keeps its identity, so nodes and plates linked to it move to its new height; the app refuses a change that would leave a member without length or a plate out of plane, and then nothing changes. The section box is an axis-aligned box in global X/Y/Z (metres) that cuts the model: only what lies inside is drawn, selectable and snappable; it belongs to the view (saved with the visibility and in saved views)."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": {
                    "view": { "type": "string", "enum": ["iso","top","front","side"] },
                    "visibility": { "type": "object", "additionalProperties": false,
                        "properties": {
                            "nodes":{"type":"boolean"}, "beams":{"type":"boolean"}, "plates":{"type":"boolean"}, "profiles":{"type":"boolean"},
                            "plateDisplay":{"type":"string","enum":["volume","surface","mesh"],"description":"How plates are drawn: volume (with their thickness), surface (the mid-plane only, semi-transparent, with outline and openings) or mesh (the elements of the analysis mesh on the mid-plane). Independent of plates (shown or hidden)."},
                            "nodeNumbers":{"type":"boolean"}, "beamNumbers":{"type":"boolean"}, "nodeCoordinates":{"type":"boolean"},
                            "supports":{"type":"boolean"}, "loads":{"type":"boolean"}, "loadPanels":{"type":"boolean"}, "envelopePanels":{"type":"boolean"}, "grid":{"type":"boolean"},
                            "axes":{"type":"boolean"}, "structuralGrid":{"type":"boolean"}, "levelMarks":{"type":"boolean"},
                            "deformation":{"type":"boolean"}, "reactions":{"type":"boolean"},
                            "utilization":{"type":"boolean"}, "axialForce":{"type":"boolean"},
                            "shearY":{"type":"boolean"}, "shearZ":{"type":"boolean"},
                            "torsion":{"type":"boolean"}, "momentY":{"type":"boolean"}, "momentZ":{"type":"boolean"},
                            "groundPressure":{"type":"boolean","description":"Ground pressure under members on an elastic foundation (kN/m), drawn below the member; parts without contact (compression only) dashed grey."},
                            "nodeSizePercent":{"type":"number","minimum":25,"maximum":400,"description":"Size of the node spheres in % of their automatic size (100 = automatic)."},
                            "supportSizePercent":{"type":"number","minimum":25,"maximum":400,"description":"Size of the support symbols in % of their automatic size (100 = automatic). Loads keep their size."}
                        } },
                    "structural_grid": { "type": "object", "additionalProperties": false,
                        "properties": {
                            "enabled":{"type":"boolean"},
                            "x_axes":{"$ref":"#/$defs/axisList"},
                            "y_axes":{"$ref":"#/$defs/axisList"},
                            "z_levels":{"$ref":"#/$defs/axisList"}
                        } },
                    "section_box": { "type": "object", "additionalProperties": false, "required": ["enabled"],
                        "description": "Section box (axis-aligned, global X/Y/Z in metres). enabled switches it on or off; off keeps the bounds. Give min_m and max_m together (each axis at least 100 mm), or fit: model (the model bounds plus a margin) or selection (around the current 3D selection), not both. On without bounds or fit: the kept bounds, else the model bounds.",
                        "properties": {
                            "enabled":{"type":"boolean"},
                            "min_m":{"$ref":"#/$defs/pointM"},
                            "max_m":{"$ref":"#/$defs/pointM"},
                            "fit":{"type":"string","enum":["model","selection"]}
                        } }
                },
                "$defs": { "axisList": { "type":"array", "items": { "type":"object", "additionalProperties":false,
                    "properties": { "label":{"type":"string"}, "position_m":{"type":"number"} }, "required":["label","position_m"] } },
                    "pointM": { "type":"object", "additionalProperties":false, "required":["x","y","z"],
                        "properties": { "x":{"type":"number"}, "y":{"type":"number"}, "z":{"type":"number"} } } }
            }
        }),
        json!({
            "name": "gui_select_member",
            "description": format!("{vooraf}Selects one member (beam) in the app, as if clicked on the canvas."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["id"],
                "properties": { "id": { "type": "integer" } } }
        }),
        json!({
            "name": "gui_select_3d_plate",
            "description": format!("{vooraf}Selects one 3D plate in the app, enabling plate properties, openings and surface-load commands."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["id"],
                "properties": { "id": { "type": "integer", "minimum": 1 } } }
        }),
        json!({
            "name": "gui_split_3d_member",
            "description": format!("{vooraf}Splits one 3D frame member at a relative position measured from its start node. The new internal node is rigid; section, material, roll and check settings are retained. Distributed, point and thermal member loads are transferred exactly, and only the original outside end releases remain."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["beam_id", "ratio"],
                "properties": {
                    "beam_id": { "type": "integer", "minimum": 1 },
                    "ratio": { "type": "number", "exclusiveMinimum": 0, "exclusiveMaximum": 1,
                        "description": "Relative split position from the member start, for example 0.5 for midspan." }
                } }
        }),
        json!({
            "name": "gui_select_3d_combination",
            "description": format!("{vooraf}Selects one already calculated 3D UGT/BGT combination in the Results explorer and on the 3D canvas. Call gui_solve first; its combinationResultaten list contains the available ids."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["id"],
                "properties": { "id": { "type": "integer", "minimum": 1 } } }
        }),
        json!({
            "name": "gui_set_cage",
            "description": format!("{vooraf}Sets the reinforcement cage of a concrete member — the same ReinforcementCage shape `check_concrete_beam` takes (cover_mm, stirrup_diameter_mm, top/bottom rows, stirrup_spacing_mm, stirrup_legs). The app validates it with its own `controleerKorf`; a rejected cage comes back as the app's own message."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["beam_id", "cage"],
                "properties": { "beam_id": { "type": "integer" }, "cage": { "type": "object" } } }
        }),
        json!({
            "name": "gui_set_analysis",
            "description": format!("{vooraf}Sets the analysis type: eersteOrde, tweedeOrdeGeometrisch (P-Delta) or tweedeOrdeFysisch (P-Delta + physically non-linear concrete)."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["analysis_type"],
                "properties": { "analysis_type": { "type": "string", "enum": ["eersteOrde", "tweedeOrdeGeometrisch", "tweedeOrdeFysisch"] } } }
        }),
        json!({
            "name": "gui_solve",
            "description": format!("{vooraf}Runs the full calculation exactly as the Bereken button does and returns only when analysis and checks are finished. For 2D this covers all load cases/combinations and the physically non-linear concrete round when selected. For 3D it runs the P-Delta frame analysis, eigenvalue buckling, all six local member-force components, reactions, and EN 1992/EN 1993 checks. A 3D answer contains the complete result plus steel/concrete results and explicit skipped reasons. When the active load case has no loads (and so no result of its own), the answer is not an error: `result` then holds the first calculated combination (or the active case switches to a calculated case), and `melding` / `actiefBelastinggeval` say so. With detail \"samenvatting\" a 3D answer stays a few kB: per-node, per-member and per-shell-element lists become counts (`result.weggelaten`) plus their extremes (`result.uitersten`, `reactieSomKn`), checks keep only id, title, article, UC, status and combination; the 2D answer is already compact and unchanged."),
            "inputSchema": { "type": "object", "additionalProperties": false,
                "properties": { "detail": crate::samenvatting::schema_detail() } }
        }),
        json!({
            "name": "gui_run_checks",
            "description": format!("{vooraf}Runs the current model and its code checks as the Toetsing button does, waits until everything is done, and returns the results per member — or the app's error text. In 3D this returns the P-Delta/buckling result together with EN 1993 steel and EN 1992 concrete checks."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_open_curtailment",
            "description": format!("{vooraf}Selects a concrete member and opens the curtailment (dekkingslijn) panel, waits for the kernel answer, and returns {{verzoek, antwoord}}: the exact DekkingslijnVerzoek the panel sent and the DekkingslijnAntwoord it got back — replay `verzoek` through `concrete_dekkingslijn` to verify the GUI against the engine. Or the panel's error text."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["beam_id"],
                "properties": { "beam_id": { "type": "integer" } } }
        }),
        json!({
            "name": "gui_set_view",
            "description": format!("{vooraf}Switches the main window view: default (canvas), check, report, insights, ifc, viewer."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["view"],
                "properties": { "view": { "type": "string" } } }
        }),
        json!({
            "name": "gui_detach_report",
            "description": format!("{vooraf}Opens the live report in its own window and returns that window's Tauri label (for gui_screenshot)."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_read_checks",
            "description": format!("{vooraf}Reads the current check results without re-running them. For a 3D project the answer includes the full 3D solve result, steel checks, concrete checks, running state and any solve/check error."),
            "inputSchema": leeg_schema()
        }),
        json!({
            "name": "gui_screenshot",
            "description": format!("{vooraf}Captures a window of the app to a PNG file: real pixels via PrintWindow (default), or with dom=true a DOM render via html2canvas. `window` is the Tauri label: main, or the label gui_detach_report returned."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": {
                    "window": { "type": "string", "default": "main" },
                    "path": { "type": "string", "description": "Absolute path of the PNG to write." },
                    "dom": { "type": "boolean", "default": false }
                } }
        }),
        json!({
            "name": "gui_export_report_pdf",
            "description": format!("{vooraf}Exports the app's STANDARD REPORT — the live report, volledig or beperkt, the same document File → Print → Save as PDF gives — to a PDF file, and returns it as base64 as well. Requires a current calculation and check (call gui_solve first): the tool REFUSES with the reason when there are no results, when they are stale, when a calculation or check is still running or scheduled, or when the check failed. A model without checkable members is valid; the report then states that nothing was checked. report_type, page_size, orientation and project apply to THIS export only and are restored afterwards — the user's settings and what Save writes to the project file do not change. Waits for an explicit ready signal (pagination done, table of contents settled, fonts loaded) instead of a fixed delay. The main window switches to the report during the export and back afterwards; a minimized window is restored for the export and minimized again. Windows only (WebView2 PrintToPdf). The PDF is checked — %PDF header and page count equal to the report's sheet count — and on a mismatch no file is left at `path`. Returns {{path, bytes, pages, sheets, report_type, page_size, orientation, pdf_base64, details}}."),
            "inputSchema": { "type": "object", "additionalProperties": false, "required": ["path"],
                "properties": {
                    "path": { "type": "string", "description": "Absolute path of the PDF to write; must end in .pdf. An existing file is replaced." },
                    "report_type": { "type": "string", "enum": ["volledig", "beperkt"], "description": "Report preset: volledig (complete calculation, all chapters and derivations) or beperkt (the summary for the client). Omitted: the report settings currently in the app." },
                    "page_size": { "type": "string", "enum": ["A4", "A3"] },
                    "orientation": { "type": "string", "enum": ["portrait", "landscape"] },
                    "project": { "type": "object", "additionalProperties": false,
                        "description": "Project header for this export only. When given, ALL header text fields come from here (fields left out stay empty), so nothing of a previous project leaks into the header; the design basis (consequence class, design life) stays the one the calculation used. Omitted: the app's project settings.",
                        "properties": {
                            "name": { "type": "string" },
                            "number": { "type": "string" },
                            "engineer": { "type": "string" },
                            "company": { "type": "string" },
                            "date": { "type": "string", "description": "Printed as given; an ISO date (2026-09-15) is written out in Dutch." }
                        } }
                } }
        }),
        json!({
            "name": "gui_quit",
            "description": format!("{vooraf}Closes the app gracefully (through the app's own exit path, so its control file is cleaned up). Unsaved work is discarded — the app does not ask."),
            "inputSchema": leeg_schema()
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Een lege werkmap voor de vindbestandtest.
    fn lege_map(naam: &str) -> std::path::PathBuf {
        let pad = std::env::temp_dir().join(format!("gui-tools-{naam}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pad);
        std::fs::create_dir_all(&pad).unwrap();
        pad
    }

    fn leg_vindbestand(basis: &std::path::Path, identifier: &str) -> std::path::PathBuf {
        let map = basis.join(identifier);
        std::fs::create_dir_all(&map).unwrap();
        let pad = map.join("gui-control.json");
        std::fs::write(&pad, r#"{"pid":1,"poort":1,"token":"x"}"#).unwrap();
        pad
    }

    #[test]
    fn vindbestand_eerst_onder_de_nieuwe_identifier_dan_de_oude() {
        let basis = lege_map("vind");
        let nieuw = basis.join(APP_IDENTIFIER).join("gui-control.json");
        // Geen van beide: het nieuwe pad, zodat de melding daarnaar wijst.
        assert_eq!(kies_vindbestand(&basis), nieuw);
        // Alleen een app tot en met 2026.39.1: diens bestand.
        let oud = leg_vindbestand(&basis, OUDE_APP_IDENTIFIER);
        assert_eq!(kies_vindbestand(&basis), oud);
        // Beide: de nieuwe gaat voor.
        assert_eq!(leg_vindbestand(&basis, APP_IDENTIFIER), nieuw);
        assert_eq!(kies_vindbestand(&basis), nieuw);
        std::fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn identifier_is_die_van_tauri_conf() {
        let pad = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("tauri.conf.json");
        let conf: Value = serde_json::from_str(&std::fs::read_to_string(pad).unwrap()).unwrap();
        assert_eq!(conf["identifier"], APP_IDENTIFIER);
        assert_ne!(APP_IDENTIFIER, OUDE_APP_IDENTIFIER);
    }

    #[test]
    fn elke_tool_heeft_een_schema_en_andersom() {
        let defs = tool_definitions();
        assert_eq!(defs.len(), GUI_TOOLS.len());
        for d in &defs {
            let naam = d["name"].as_str().unwrap();
            assert!(is_gui_tool(naam), "{naam} ontbreekt in GUI_TOOLS");
        }
    }

    fn export(args: Value) -> Result<Value, RpcError> {
        rapport_pdf_args(lees("gui_export_report_pdf", args)?)
    }

    fn absoluut(naam: &str) -> String {
        std::env::temp_dir()
            .join(naam)
            .to_string_lossy()
            .into_owned()
    }

    #[test]
    fn export_vertaalt_naar_de_kanaalopdracht() {
        let pad = absoluut("rapport.pdf");
        let uit = export(json!({
            "path": pad,
            "report_type": "beperkt",
            "page_size": "A3",
            "orientation": "landscape",
            "project": { "name": "Loods", "number": "P-12", "date": "2026-09-15" }
        }))
        .unwrap();
        assert_eq!(
            uit,
            json!({
                "pad": pad,
                "type": "beperkt",
                "formaat": "A3",
                "orientatie": "landscape",
                "project": { "naam": "Loods", "nummer": "P-12", "datum": "2026-09-15" }
            })
        );
        // Alleen het pad: de app gebruikt dan haar eigen rapportinstellingen.
        assert_eq!(
            export(json!({ "path": pad })).unwrap(),
            json!({ "pad": pad })
        );
    }

    #[test]
    fn export_weigert_onbekende_velden_en_waarden() {
        let pad = absoluut("rapport.pdf");
        assert!(export(json!({ "path": pad, "reporttype": "beperkt" })).is_err());
        assert!(export(json!({ "path": pad, "report_type": "kort" })).is_err());
        assert!(export(json!({ "path": pad, "page_size": "A5" })).is_err());
        assert!(export(json!({ "path": pad, "orientation": "staand" })).is_err());
        assert!(export(json!({ "path": pad, "project": { "naam": "Loods" } })).is_err());
        assert!(
            export(json!({ "path": "rapport.pdf" })).is_err(),
            "relatief pad"
        );
        assert!(
            export(json!({ "path": absoluut("rapport.png") })).is_err(),
            "geen .pdf"
        );
        assert!(export(json!({})).is_err(), "pad ontbreekt");
    }

    #[test]
    fn het_schema_van_de_export_is_strikt() {
        let defs = tool_definitions();
        let d = defs
            .iter()
            .find(|d| d["name"] == "gui_export_report_pdf")
            .expect("gui_export_report_pdf heeft een schema");
        let s = &d["inputSchema"];
        assert_eq!(s["additionalProperties"], json!(false));
        assert_eq!(s["required"], json!(["path"]));
        assert_eq!(
            s["properties"]["project"]["additionalProperties"],
            json!(false)
        );
        assert_eq!(
            s["properties"]["report_type"]["enum"],
            json!(["volledig", "beperkt"])
        );
    }

    #[test]
    fn het_3d_schema_draagt_toetsing_revolutes_en_resultaatlagen() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let beam = &bouw["inputSchema"]["properties"]["beams"]["items"]["properties"];
        assert_eq!(beam["check_config"]["type"], json!("object"));
        assert_eq!(beam["roll_angle_deg"]["type"], json!("number"));
        assert_eq!(beam["releases"]["additionalProperties"], json!(false));
        assert_eq!(beam["releases"]["properties"]["torsion_end"]["type"], json!("boolean"));
        let member_load = &bouw["inputSchema"]["properties"]["member_loads"]["items"];
        assert_eq!(member_load["additionalProperties"], json!(false));
        assert_eq!(member_load["properties"]["qz_start"]["type"], json!("number"));
        assert_eq!(member_load["properties"]["case_id"]["minimum"], json!(1));
        let point_load = &bouw["inputSchema"]["properties"]["member_point_loads"]["items"];
        assert_eq!(point_load["additionalProperties"], json!(false));
        assert_eq!(point_load["properties"]["position_m"]["minimum"], json!(0));
        assert_eq!(point_load["required"], json!(["beam", "position_m"]));
        let thermal = &bouw["inputSchema"]["properties"]["thermal_loads"]["items"];
        assert_eq!(thermal["additionalProperties"], json!(false));
        assert_eq!(thermal["properties"]["delta_t_gradient_z_k"]["type"], json!("number"));
        assert_eq!(bouw["inputSchema"]["properties"]["loads"]["items"]["properties"]["case_id"]["type"], json!("integer"));
        let plate = &bouw["inputSchema"]["properties"]["plates"]["items"];
        assert_eq!(plate["properties"]["nodes"]["minItems"], json!(3));
        assert_eq!(plate["properties"]["openings"]["items"]["additionalProperties"], json!(false));
        let surface = &bouw["inputSchema"]["properties"]["surface_loads"]["items"];
        assert_eq!(surface["properties"]["qz"]["type"], json!("number"));
        let support_types = bouw["inputSchema"]["properties"]["supports"]["items"]
            ["properties"]["type"]["enum"].as_array().unwrap();
        for kind in ["xRoller", "yRoller", "zRoller", "revoluteX", "revoluteY", "revoluteZ"] {
            assert!(support_types.contains(&json!(kind)), "{kind} ontbreekt");
        }
        let springs = &bouw["inputSchema"]["properties"]["supports"]["items"]["properties"]["springs"];
        assert_eq!(springs["additionalProperties"], json!(false));
        assert_eq!(springs["properties"]["kz_kn_per_m"]["exclusiveMinimum"], json!(0));
        assert_eq!(springs["properties"]["kry_knm_per_rad"]["type"], json!("number"));
        let prescribed = &bouw["inputSchema"]["properties"]["supports"]["items"]["properties"]["prescribed"];
        assert_eq!(prescribed["additionalProperties"], json!(false));
        assert_eq!(prescribed["properties"]["ux_m"]["type"], json!("number"));
        assert_eq!(prescribed["properties"]["rz_rad"]["type"], json!("number"));

        let levels = &bouw["inputSchema"]["properties"]["levels"]["items"];
        assert_eq!(levels["additionalProperties"], json!(false));
        assert_eq!(levels["required"], json!(["label", "position_m"]));
        let node = &bouw["inputSchema"]["properties"]["nodes"]["items"];
        assert_eq!(node["properties"]["level"]["minimum"], json!(1));
        assert_eq!(node["required"], json!(["x", "y", "z"]), "level blijft optioneel");
        assert_eq!(plate["properties"]["level"]["type"], json!("integer"));

        let view = defs.iter().find(|d| d["name"] == "gui_configure_3d_view").unwrap();
        let visibility = &view["inputSchema"]["properties"]["visibility"]["properties"];
        for layer in [
            "plates", "deformation", "reactions", "utilization", "axialForce", "shearY",
            "shearZ", "torsion", "momentY", "momentZ", "groundPressure",
        ] {
            assert_eq!(visibility[layer]["type"], json!("boolean"), "{layer} ontbreekt");
        }
        let select = defs.iter().find(|d| d["name"] == "gui_select_3d_combination").unwrap();
        assert_eq!(select["inputSchema"]["properties"]["id"]["minimum"], json!(1));
        let split = defs.iter().find(|d| d["name"] == "gui_split_3d_member").unwrap();
        assert_eq!(split["inputSchema"]["required"], json!(["beam_id", "ratio"]));
        assert_eq!(split["inputSchema"]["properties"]["ratio"]["exclusiveMaximum"], json!(1));
    }

    /// Belastingvlakken in `gui_build_3d_model`: strikt op elk niveau, met de
    /// twee keuzes als vaste lijst. Een tikfout in `direction` of een
    /// onbekend veld mag niet stil een standaardlastrichting opleveren.
    #[test]
    fn het_3d_schema_draagt_belastingvlakken_strikt() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let panel = &bouw["inputSchema"]["properties"]["load_panels"]["items"];
        assert_eq!(panel["additionalProperties"], json!(false));
        assert_eq!(panel["required"], json!(["nodes", "q", "direction", "distribution"]));
        assert_eq!(panel["properties"]["nodes"]["minItems"], json!(3));
        assert_eq!(panel["properties"]["nodes"]["items"]["minimum"], json!(1));
        assert_eq!(panel["properties"]["case_id"]["minimum"], json!(1));
        assert_eq!(panel["properties"]["direction"]["enum"], json!(["gravity", "normal", "verticalSurface"]));
        assert_eq!(panel["properties"]["distribution"]["enum"], json!(["oneWay", "twoWay"]));
        let span = &panel["properties"]["span_direction"];
        assert_eq!(span["additionalProperties"], json!(false));
        assert_eq!(span["required"], json!(["x", "y", "z"]));
        assert_eq!(panel["properties"]["excluded_beams"]["items"]["minimum"], json!(1));
        let opening = &panel["properties"]["openings"]["items"];
        assert_eq!(opening["additionalProperties"], json!(false));
        assert_eq!(opening["properties"]["nodes"]["minItems"], json!(3));
        let envelope = &bouw["inputSchema"]["properties"]["envelope_panels"]["items"];
        assert_eq!(envelope["additionalProperties"], json!(false));
        assert_eq!(envelope["required"], json!(["nodes", "type", "distribution"]));
        assert_eq!(envelope["properties"]["type"]["enum"], json!(["facade", "roof"]));
        assert_eq!(envelope["properties"]["openings"]["items"]["additionalProperties"], json!(false));
        let view = defs.iter().find(|d| d["name"] == "gui_configure_3d_view").unwrap();
        assert_eq!(view["inputSchema"]["properties"]["visibility"]["properties"]["loadPanels"]["type"], json!("boolean"));
        assert_eq!(view["inputSchema"]["properties"]["visibility"]["properties"]["envelopePanels"]["type"], json!("boolean"));
        // De peilmaten bij de levels (issue #92) staan los van het stramien: eigen schakelaar.
        assert_eq!(view["inputSchema"]["properties"]["visibility"]["properties"]["levelMarks"]["type"], json!("boolean"));
        // De grootte van knopen en opleggingen (issue #82): een getal in %, 25–400.
        let zicht = &view["inputSchema"]["properties"]["visibility"]["properties"];
        for sleutel in ["nodeSizePercent", "supportSizePercent"] {
            assert_eq!(zicht[sleutel]["type"], json!("number"), "{sleutel}");
            assert_eq!(zicht[sleutel]["minimum"], json!(25), "{sleutel}");
        }
        assert_eq!(zicht["nodeSizePercent"]["maximum"], json!(400));
        assert_eq!(zicht["supportSizePercent"]["maximum"], json!(400));
        // De plaatweergave (issue #78): één keuze uit drie standen, geen schakelaar.
        assert_eq!(zicht["plateDisplay"]["type"], json!("string"));
        assert_eq!(zicht["plateDisplay"]["enum"], json!(["volume", "surface", "mesh"]));
        // De section box (issue #86): strikt, aan/uit verplicht, grenzen als {x, y, z} in m.
        let doos = &view["inputSchema"]["properties"]["section_box"];
        assert_eq!(doos["additionalProperties"], json!(false));
        assert_eq!(doos["required"], json!(["enabled"]));
        assert_eq!(doos["properties"]["enabled"]["type"], json!("boolean"));
        assert_eq!(doos["properties"]["fit"]["enum"], json!(["model", "selection"]));
        for grens in ["min_m", "max_m"] {
            assert_eq!(doos["properties"][grens]["$ref"], json!("#/$defs/pointM"), "{grens}");
        }
        let punt = &view["inputSchema"]["$defs"]["pointM"];
        assert_eq!(punt["additionalProperties"], json!(false));
        assert_eq!(punt["required"], json!(["x", "y", "z"]));
    }

    /// Trek-alleen per staaf en starre schijven in `gui_build_3d_model`:
    /// strikt, met de knopen als 1-gebaseerde indices zoals bij platen.
    #[test]
    fn het_3d_schema_draagt_trek_alleen_en_schijven_strikt() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let beam = &bouw["inputSchema"]["properties"]["beams"]["items"];
        assert_eq!(beam["additionalProperties"], json!(false));
        assert_eq!(beam["properties"]["tension_only"]["type"], json!("boolean"));
        let diaphragm = &bouw["inputSchema"]["properties"]["diaphragms"]["items"];
        assert_eq!(diaphragm["additionalProperties"], json!(false));
        assert_eq!(diaphragm["required"], json!(["nodes"]));
        assert_eq!(diaphragm["properties"]["nodes"]["minItems"], json!(2));
        assert_eq!(diaphragm["properties"]["nodes"]["items"]["minimum"], json!(1));
        assert_eq!(diaphragm["properties"]["name"]["type"], json!("string"));
    }

    /// Plaat op bedding (#107) in `gui_build_3d_model`: een strikt object met
    /// k_kn_per_m3 verplicht en de twee velden in snake_case.
    #[test]
    fn het_3d_schema_draagt_plaat_op_bedding_strikt() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let bedding = &bouw["inputSchema"]["properties"]["plates"]["items"]["properties"]["bedding"];
        assert_eq!(bedding["type"], json!("object"));
        assert_eq!(bedding["additionalProperties"], json!(false));
        assert_eq!(bedding["required"], json!(["k_kn_per_m3"]));
        assert_eq!(bedding["properties"]["k_kn_per_m3"]["exclusiveMinimum"], json!(0));
        assert_eq!(bedding["properties"]["compression_only"]["type"], json!("boolean"));
        assert_eq!(bedding["properties"].as_object().unwrap().len(), 2);
    }

    /// Staaf op bedding (#106) in `gui_build_3d_model`: een strikt object met
    /// width_m verplicht en de vier velden in snake_case.
    #[test]
    fn het_3d_schema_draagt_staaf_op_bedding_strikt() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let bedding = &bouw["inputSchema"]["properties"]["beams"]["items"]["properties"]["bedding"];
        assert_eq!(bedding["type"], json!("object"));
        assert_eq!(bedding["additionalProperties"], json!(false));
        assert_eq!(bedding["required"], json!(["width_m"]));
        for veld in ["k_kn_per_m3", "width_m", "k_lateral_kn_per_m3"] {
            assert_eq!(bedding["properties"][veld]["exclusiveMinimum"], json!(0), "{veld}");
        }
        assert_eq!(bedding["properties"]["compression_only"]["type"], json!("boolean"));
        assert_eq!(bedding["properties"].as_object().unwrap().len(), 4);
    }

    /// Verlopende staaf (#73) in `gui_build_3d_model`: `profile_name_end` is
    /// niet-lege tekst naast `profile_name`, en de beschrijving noemt het.
    #[test]
    fn het_3d_schema_kent_het_eindprofiel_van_een_verlopende_staaf() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        let eind = &bouw["inputSchema"]["properties"]["beams"]["items"]["properties"]["profile_name_end"];
        assert_eq!(eind["type"], json!("string"));
        assert_eq!(eind["minLength"], json!(1));
        assert!(bouw["description"].as_str().unwrap().contains("profile_name_end"));
    }

    // ── Bereikbaarheid en gui_start_app (issue #109) ────────────────────────

    #[test]
    fn de_fout_zegt_wat_te_doen_als_de_app_niet_bereikbaar_is() {
        let e = niet_bereikbaar("er is geen vindbestand");
        for deel in [
            "Open FEM Studio is niet bereikbaar: er is geen vindbestand.",
            "Instellingen → AI-assistent (MCP) standaard aan",
            "is de bediening bewust uitgezet",
            "gui_start_app",
            "OPENAEC_GUI_CONTROL=1",
        ] {
            assert!(e.message.contains(deel), "{deel:?} ontbreekt: {}", e.message);
        }
        let data = e.data.unwrap();
        assert_eq!(data["error_code"], json!("APP_NIET_BEREIKBAAR"));
        assert_eq!(data["remedie"], json!(REMEDIE_NIET_BEREIKBAAR));
        // Een ontbrekend vindbestand: de reden noemt het pad.
        let map = lege_map("geen-vind");
        let fout = lees_kanaal(&map.join("gui-control.json")).unwrap_err();
        assert!(fout.message.contains("geen vindbestand"), "{}", fout.message);
        assert!(fout.message.contains("gui-control.json"), "{}", fout.message);
        std::fs::remove_dir_all(&map).unwrap();
    }

    #[test]
    fn tasklist_wordt_gelezen_ongeacht_de_taal_van_windows() {
        let naam = "open-fem-studio.exe";
        let engels = "INFO: No tasks are running which match the specified criteria.\r\n";
        let nederlands = "INFO: Er worden geen taken uitgevoerd die voldoen aan de opgegeven criteria.\r\n";
        assert!(pids_uit_tasklist(engels, naam).is_empty());
        assert!(pids_uit_tasklist(nederlands, naam).is_empty());
        let twee = "\"open-fem-studio.exe\",\"43440\",\"Console\",\"1\",\"250.000 K\"\r\n\
                    \"Open-FEM-Studio.EXE\",\"512\",\"Console\",\"1\",\"1,024 K\"\r\n\
                    \"openaec-mcp-server.exe\",\"77\",\"Console\",\"1\",\"9 K\"\r\n";
        assert_eq!(pids_uit_tasklist(twee, naam), vec![43440, 512]);
    }

    /// Alleen een app van deze gebruiker in deze sessie telt als "draait al":
    /// de single-instance van de app werkt per sessie.
    #[test]
    fn alleen_een_app_in_de_eigen_sessie_telt() {
        let naam = "open-fem-studio.exe";
        assert_eq!(
            tasklist_args(naam, Some(3)),
            ["/FI", "IMAGENAME eq open-fem-studio.exe", "/FI", "SESSION eq 3", "/FO", "CSV", "/NH"]
        );
        // Sessie onbekend: alle sessies (dan liever een terechte weigering te veel).
        assert_eq!(tasklist_args(naam, None), ["/FI", "IMAGENAME eq open-fem-studio.exe", "/FO", "CSV", "/NH"]);
        assert_eq!(pgrep_args("open-fem-studio", 1000), ["-u", "1000", "-x", "open-fem-studio"]);
    }

    /// Echt nagevraagd: dit testproces draait in de eigen sessie en wordt dus
    /// gevonden; een naam die niet draait, niet.
    #[cfg(windows)]
    #[test]
    fn draaiende_pids_vindt_een_proces_in_de_eigen_sessie() {
        assert!(os::eigen_sessie().is_some(), "de sessie van dit proces is bekend");
        let eigen = std::env::current_exe().unwrap();
        let naam = eigen.file_name().unwrap().to_string_lossy().into_owned();
        let pids = draaiende_pids(&naam).expect("tasklist werkt");
        assert!(pids.contains(&std::process::id()), "{naam}: {pids:?}");
        assert_eq!(draaiende_pids("bestaat-niet-ofs-109.exe"), Some(vec![]));
    }

    /// De app-datamap zoals Tauri hem kiest (`app_local_data_dir`), per platform.
    #[test]
    fn de_app_datamap_per_platform() {
        let p = |s: &str| PathBuf::from(s);
        assert_eq!(
            datamap_basis("windows", Some(r"C:\Users\a\AppData\Local"), Some(r"C:\Users\a"), None),
            Some(p(r"C:\Users\a\AppData\Local"))
        );
        assert_eq!(datamap_basis("windows", None, Some(r"C:\Users\a"), None), None, "zonder LOCALAPPDATA geen gok");
        assert_eq!(datamap_basis("windows", Some("  "), None, None), None, "leeg telt niet");
        assert_eq!(
            datamap_basis("macos", None, Some("/Users/a"), Some("/Users/a/data")),
            Some(p("/Users/a").join("Library").join("Application Support")),
            "macOS kent geen XDG"
        );
        assert_eq!(datamap_basis("macos", Some("x"), None, None), None);
        assert_eq!(
            datamap_basis("linux", None, Some("/home/a"), Some("/home/a/data")),
            Some(p("/home/a/data"))
        );
        assert_eq!(
            datamap_basis("linux", None, Some("/home/a"), None),
            Some(p("/home/a").join(".local").join("share"))
        );
        assert_eq!(
            datamap_basis("linux", None, Some("/home/a"), Some("relatief")),
            Some(p("/home/a").join(".local").join("share")),
            "een relatief XDG_DATA_HOME telt niet"
        );
        assert_eq!(datamap_basis("linux", None, None, None), None);
        // Het vindbestand ligt daaronder, in de map van de identifier.
        let basis = p("/home/a/.local/share");
        assert_eq!(kies_vindbestand(&basis), basis.join(APP_IDENTIFIER).join("gui-control.json"));
    }

    #[test]
    fn de_app_exe_staat_naast_de_server_of_waar_openaec_app_naar_wijst() {
        let map = lege_map("app-exe");
        let server = map.join(format!("openaec-mcp-server{}", std::env::consts::EXE_SUFFIX));
        let app = map.join(app_bestandsnaam());
        // Nog geen app naast de server: een fout met code, en het pad erin.
        let e = kies_app_exe(None, &server).unwrap_err();
        assert_eq!(e.data.as_ref().unwrap()["error_code"], json!("APP_NIET_GEVONDEN"));
        assert!(e.message.contains(&app.display().to_string()), "{}", e.message);
        std::fs::write(&app, b"").unwrap();
        assert_eq!(kies_app_exe(None, &server).unwrap(), app);
        assert_eq!(kies_app_exe(Some("  "), &server).unwrap(), app, "leeg telt niet");
        // OPENAEC_APP gaat voor, en moet bestaan.
        let elders = map.join("elders.exe");
        let e = kies_app_exe(Some(&elders.to_string_lossy()), &server).unwrap_err();
        assert!(e.message.contains("OPENAEC_APP"), "{}", e.message);
        std::fs::write(&elders, b"").unwrap();
        assert_eq!(kies_app_exe(Some(&elders.to_string_lossy()), &server).unwrap(), elders);
        std::fs::remove_dir_all(&map).unwrap();
    }

    #[test]
    fn het_schema_van_gui_start_app_is_strikt() {
        let defs = tool_definitions();
        let d = defs.iter().find(|d| d["name"] == "gui_start_app").expect("gui_start_app");
        let s = &d["inputSchema"];
        assert_eq!(s["additionalProperties"], json!(false));
        assert_eq!(s["properties"]["timeout_s"]["minimum"], json!(MIN_START_S));
        assert_eq!(s["properties"]["timeout_s"]["maximum"], json!(MAX_START_S));
        assert!(lees::<StartApp>("gui_start_app", json!({ "timeout": 5 })).is_err());
        assert!(start_app(json!({ "timeout_s": 4 })).is_err(), "onder de grens: geweigerd vóór er iets gebeurt");
    }

    // De nep-app: dit testproces zelf, opnieuw gestart met alleen de proef
    // `nep_app` en de omgevingsvariabele OFS_NEP_APP (het pad van het
    // vindbestand). Dan gedraagt het zich als de app met kanaal: na een korte
    // "opstarttijd" luistert het op 127.0.0.1, schrijft het vindbestand met zijn
    // eigen pid, beantwoordt GET /status en de paginaopdracht `status`, en stopt
    // op `afsluiten` (of na een minuut). Met OFS_NEP_APP_STIL komt er nooit een
    // vindbestand.

    const NEP_TOKEN: &str = "nep-token";

    fn nep_proces(vindbestand: &Path, extra: &[(&str, &str)], filter: &str) -> Start {
        let mut env: Vec<(OsString, OsString)> = vec![
            ("OFS_NEP_APP".into(), vindbestand.as_os_str().to_owned()),
            ("OPENAEC_GUI_CONTROL".into(), "1".into()),
        ];
        env.extend(extra.iter().map(|(k, v)| (OsString::from(k), OsString::from(v))));
        Start {
            exe: std::env::current_exe().unwrap(),
            args: vec!["--exact".into(), filter.into(), "--nocapture".into(), "--test-threads=1".into()],
            env,
            vindbestand: vindbestand.to_path_buf(),
            tijdslimiet: Duration::from_secs(30),
        }
    }

    /// Lees één HTTP-verzoek: de eerste regel en de body.
    fn lees_verzoek(s: &mut std::net::TcpStream) -> Option<(String, String)> {
        use std::io::Read;
        let mut buf = Vec::new();
        let mut blok = [0u8; 4096];
        loop {
            let n = s.read(&mut blok).ok()?;
            if n == 0 {
                return None;
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
                    let eerste = kop.lines().next().unwrap_or("").to_owned();
                    let heeft_token = kop.contains(&format!("Bearer {NEP_TOKEN}"));
                    return Some((if heeft_token { eerste } else { format!("{eerste} ZONDER-TOKEN") }, body.to_owned()));
                }
            }
        }
    }

    #[test]
    fn nep_app() {
        let Ok(vind) = std::env::var("OFS_NEP_APP") else { return };
        // Vangnet: nooit langer dan een minuut blijven hangen.
        std::thread::spawn(|| {
            std::thread::sleep(Duration::from_secs(60));
            std::process::exit(3);
        });
        if std::env::var("OFS_NEP_APP_STIL").is_ok() {
            std::thread::sleep(Duration::from_secs(8));
            return;
        }
        assert_eq!(std::env::var("OPENAEC_GUI_CONTROL").as_deref(), Ok("1"), "het kanaal hoort aan te staan");
        std::thread::sleep(Duration::from_millis(400));
        let luisteraar = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let poort = luisteraar.local_addr().unwrap().port();
        let inhoud = json!({ "pid": std::process::id(), "poort": poort, "token": NEP_TOKEN, "versie": "0.0.0-nep" });
        std::fs::write(&vind, inhoud.to_string()).unwrap();
        for stroom in luisteraar.incoming() {
            use std::io::Write;
            let Ok(mut s) = stroom else { continue };
            let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
            let Some((eerste, body)) = lees_verzoek(&mut s) else { continue };
            let opdracht: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            let (code, antwoord, stoppen) = if eerste.contains("ZONDER-TOKEN") {
                (401, json!({ "ok": false, "fout": "ontbrekend of onjuist token" }), false)
            } else if eerste.starts_with("GET /status") {
                (200, json!({ "versie": "0.0.0-nep", "gereed": true, "pid": std::process::id() }), false)
            } else {
                match opdracht["naam"].as_str() {
                    Some("status") => (200, json!({ "ok": true, "uitkomst": { "weergave": "default", "nep": true } }), false),
                    Some("afsluiten") => (200, json!({ "ok": true, "uitkomst": { "afgesloten": true } }), true),
                    _ => (200, json!({ "ok": false, "fout": "onbekend" }), false),
                }
            };
            let tekst = antwoord.to_string();
            let _ = write!(
                s,
                "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{tekst}",
                tekst.len()
            );
            let _ = s.flush();
            if stoppen {
                let _ = std::fs::remove_file(&vind);
                std::process::exit(0);
            }
        }
    }

    #[test]
    fn gui_start_app_start_de_app_en_wacht_op_kanaal_en_pagina() {
        let map = lege_map("start");
        let vind = map.join("gui-control.json");
        // Een achtergebleven vindbestand van een eerdere sessie telt niet.
        std::fs::write(&vind, r#"{"pid":4242,"poort":1,"token":"oud","versie":"oud"}"#).unwrap();
        let uit = start_en_wacht(&nep_proces(&vind, &[], "gui_tools::tests::nep_app")).expect("gestart");
        assert_eq!(uit["gestart"], json!(true));
        assert_eq!(uit["versie"], json!("0.0.0-nep"));
        assert_eq!(uit["pagina"], json!({ "weergave": "default", "nep": true }), "de pagina antwoordt");
        let k = lees_kanaal(&vind).unwrap();
        assert_eq!(uit["pid"], json!(k.pid));
        assert_eq!(uit["poort"], json!(k.poort));
        assert_ne!(k.pid, std::process::id(), "een eigen proces");
        assert!(uit["wachttijd_ms"].as_u64().unwrap() >= 400, "{uit}");
        // Netjes afsluiten via het kanaal; het vindbestand verdwijnt.
        assert_eq!(roep_op(&k, "afsluiten", json!({}), 5).unwrap(), json!({ "afgesloten": true }));
        let einde = Instant::now() + Duration::from_secs(10);
        while vind.exists() && Instant::now() < einde {
            std::thread::sleep(Duration::from_millis(100));
        }
        assert!(!vind.exists());
        let _ = std::fs::remove_dir_all(&map);
    }

    #[test]
    fn gui_start_app_meldt_een_app_die_meteen_stopt() {
        // Een tweede start die de single-instance naar een draaiend venster
        // doorstuurt, stopt meteen: hier een testproces dat niets draait.
        let map = lege_map("stopt");
        let vind = map.join("gui-control.json");
        let e = start_en_wacht(&nep_proces(&vind, &[], "bestaat::niet")).unwrap_err();
        assert_eq!(e.data.as_ref().unwrap()["error_code"], json!("APP_GESTOPT"), "{}", e.message);
        assert!(e.message.contains("Instellingen → AI-assistent (MCP)"), "{}", e.message);
        let _ = std::fs::remove_dir_all(&map);
    }

    #[test]
    fn gui_start_app_wacht_niet_langer_dan_de_grens() {
        let map = lege_map("stil");
        let vind = map.join("gui-control.json");
        let mut start = nep_proces(&vind, &[("OFS_NEP_APP_STIL", "1")], "gui_tools::tests::nep_app");
        start.tijdslimiet = Duration::from_secs(2);
        let begin = Instant::now();
        let e = start_en_wacht(&start).unwrap_err();
        let duur = begin.elapsed();
        assert_eq!(e.data.as_ref().unwrap()["error_code"], json!("APP_START_TIJD"), "{}", e.message);
        assert!(e.message.contains("binnen 2 s"), "{}", e.message);
        assert!(duur >= Duration::from_secs(2) && duur < Duration::from_secs(6), "{duur:?}");
        let _ = std::fs::remove_dir_all(&map);
    }

    /// De modelinstellingen voor trek-alleen staven in `gui_build_3d_model`:
    /// twee booleans op modelniveau, standaard uit.
    #[test]
    fn het_3d_schema_kent_montage_en_kruisregel() {
        let defs = tool_definitions();
        let bouw = defs.iter().find(|d| d["name"] == "gui_build_3d_model").unwrap();
        assert_eq!(bouw["inputSchema"]["additionalProperties"], json!(false));
        for veld in ["tension_only_fit_after_permanent", "tension_only_cross_rule"] {
            let instelling = &bouw["inputSchema"]["properties"][veld];
            assert_eq!(instelling["type"], json!("boolean"), "{veld}");
            assert_eq!(instelling["default"], json!(false), "{veld}");
        }
    }
}
