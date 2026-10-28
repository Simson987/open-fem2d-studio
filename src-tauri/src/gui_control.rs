//! `gui_control` — het bedieningskanaal van de app.
//!
//! Alleen actief als de gebruiker het toestaat: met de instelling
//! "Bediening door een AI-assistent toestaan (MCP)" (Instellingen →
//! AI-assistent (MCP); bewaard in `ai-assistent.json`, zie [`instelling`]),
//! of als de app is gestart met `OPENAEC_GUI_CONTROL=1` (testscripts,
//! ontwikkelwerk). Dan luistert deze module op `127.0.0.1:<vrije poort>`, met
//! een sessietoken, en schrijft hij `gui-control.json` (`{pid, poort, token,
//! versie}`) in de app-datamap zodat een client hem kan vinden. Anders bestaat
//! er geen luisteraar, geen bestand en geen token — de commands hieronder
//! antwoorden dan alleen "niet actief".
//!
//! # Aan en uit terwijl de app draait (issue #109)
//!
//! De schakelaar in de instellingen roept `gui_kanaal_aan` of `gui_kanaal_uit`
//! aan: die bewaren de keuze en starten of stoppen het kanaal meteen. Uit
//! haalt het vindbestand weg en sluit de poort; weer aan geeft een nieuwe poort
//! en een nieuw token. Elke wijziging gaat als event `gui-control:status` naar
//! de pagina's (statusbalk, `bediening.ts`, het paneel). Het luisterende deel
//! zelf staat los van Tauri in [`kanaal`]; de beslissing bij het opstarten en
//! het aan- en uitzetten staan in [`GuiControl`] los van de `AppHandle`, achter
//! de trait [`AppKant`], zodat tests/gui_kanaal.rs ze zonder app toetst.
//!
//! # Wat het kanaal is, en wat niet
//!
//! Een client stuurt `POST /opdracht` met `{naam, args}` en
//! `Authorization: Bearer <token>`. Drie soorten opdrachten:
//!
//! * **Paginaopdrachten** — het overgrote deel. Rust zet ze als event
//!   (`gui-control:opdracht`) op het hoofdvenster; de pagina voert ze uit met
//!   haar eigen acties (`bediening/bediening.ts`) en meldt de uitkomst terug
//!   via het command `gui_control_antwoord`. De HTTP-aanroep wacht daarop,
//!   met een tijdslimiet. Verloopt die, dan een fout mét de opdrachtnaam — er
//!   blijft nooit een verbinding stil hangen.
//! * **`screenshot`** — doet Rust zelf: `PrintWindow` op het venster met het
//!   opgegeven Tauri-label, naar een PNG. Echte pixels, ook van het canvas.
//!   Met `dom: true` gaat hij alsnog naar de pagina (html2canvas), als
//!   terugval.
//! * **`model_laden`** — leest het bestand in Rust en geeft de TEKST door aan
//!   de pagina. De pagina zelf mag namelijk niet elk pad lezen: de
//!   fs-scope van Tauri kent alleen paden die via een dialoog zijn gekozen.
//!   **`ifc_analysemodel_importeren`** doet hetzelfde voor een .ifc-bestand.
//! * **`rapport_pdf`** — het standaardrapport (het live rapport, volledig of
//!   beperkt) als PDF: de pagina bereidt voor (`rapport_voorbereiden`,
//!   weigert met reden als er niets vers te printen valt), Rust print het
//!   hoofdvenster via WebView2 naar PDF, de pagina zet alles terug
//!   (`rapport_afronden`), en Rust controleert de PDF. Zie `mod rapport`.
//!
//! Het vindbestand staat in de app-datamap, tenzij `OPENAEC_GUI_CONTROL_FILE`
//! een ander pad noemt — dezelfde variabele waarmee de MCP-server zoekt.
//!
//! Dit is een API van acties, geen muis- of toetsenbordautomatisering. Er is
//! geen luisteraar op een ander adres dan loopback, geen kanaal zonder token,
//! en het staat niet standaard aan. Zolang het aanstaat, toont de statusbalk
//! van de app dat.

pub mod instelling;
pub mod kanaal;

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex, Weak};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use kanaal::{Luisteraar, Opdracht, Verwerker};

/// De omgevingsvariabele die het kanaal aanzet.
pub const OMGEVINGSVARIABELE: &str = "OPENAEC_GUI_CONTROL";
/// De naam van het vindbestand in de app-datamap.
pub const BESTANDSNAAM: &str = "gui-control.json";
/// Een ander pad voor het vindbestand. De MCP-server (`gui_tools.rs`) en de
/// GUI-tests zoeken met dezelfde variabele.
pub const VINDBESTAND_VARIABELE: &str = "OPENAEC_GUI_CONTROL_FILE";
/// Het event waarmee een paginaopdracht het hoofdvenster in gaat.
const EVENT_OPDRACHT: &str = "gui-control:opdracht";
/// Het event waarmee Rust de pagina's laat weten dat het kanaal aan of uit
/// ging (payload: [`KanaalStatus`]).
pub const EVENT_STATUS: &str = "gui-control:status";
/// Het venster waarin `bediening.ts` luistert.
const HOOFDVENSTER: &str = "main";
const STANDAARD_TIJDSLIMIET_S: u64 = 60;
const MAX_TIJDSLIMIET_S: u64 = 600;

/// Antwoorden van de pagina, op opdracht-id. `None` = nog onderweg.
type Wachtkamer = Arc<(Mutex<HashMap<u64, Option<Value>>>, Condvar)>;

/// Wat het kanaal van de app nodig heeft: wat een opdracht dóét, en waar een
/// nieuwe status heen gaat. In de app is dat de [`AppHandle`] (de pagina via
/// events, een screenshot via het venster); in tests/gui_kanaal.rs een
/// nabootsing. Zo staan de beslissing bij het opstarten en de volgorde van
/// aan en uit los van Tauri, en zijn ze zonder app te toetsen.
pub trait AppKant {
    /// De verwerker voor een nieuw kanaal. De toestand komt zwak mee: de
    /// luisterdraad houdt hem niet in leven na het afsluiten.
    fn verwerker(&self, control: Weak<GuiControl>) -> Verwerker;
    /// Laat de pagina's de nieuwe status weten.
    fn meld(&self, status: &KanaalStatus);
}

impl AppKant for AppHandle {
    fn verwerker(&self, control: Weak<GuiControl>) -> Verwerker {
        let app = self.clone();
        Arc::new(move |o: Opdracht| {
            let control = control.upgrade().ok_or("de app sluit af")?;
            voer_uit(&app, &control, o)
        })
    }

    fn meld(&self, status: &KanaalStatus) {
        let _ = self.emit(EVENT_STATUS, status.clone());
    }
}

/// De toestand van het kanaal, beheerd door Tauri (`app.manage`).
pub struct GuiControl {
    /// Het draaiende kanaal, of `None` als het uit staat.
    kanaal: Mutex<Option<Luisteraar>>,
    /// Waar het vindbestand komt: `OPENAEC_GUI_CONTROL_FILE`, anders de
    /// app-datamap. `None` als de app-datamap onbekend is.
    vindbestand: Option<PathBuf>,
    /// Waar de instelling bewaard wordt (`ai-assistent.json`).
    instelling: Option<PathBuf>,
    /// Gestart met `OPENAEC_GUI_CONTROL=1`.
    door_omgeving: bool,
    /// Waarom het kanaal niet startte, als het niet startte.
    laatste_fout: Mutex<Option<String>>,
    versie: String,
    volgende_id: Mutex<u64>,
    wachtkamer: Wachtkamer,
}

/// Wat het paneel "AI-assistent (MCP)" en de statusbalk over het kanaal weten.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KanaalStatus {
    /// De bewaarde instelling.
    pub toegestaan: bool,
    /// Luistert er nu een kanaal?
    pub actief: bool,
    pub poort: Option<u16>,
    /// Gestart met `OPENAEC_GUI_CONTROL=1` (ook als de tool `gui_start_app`
    /// van de MCP-server de app startte): het kanaal stond dan aan voor deze
    /// sessie, los van de bewaarde instelling.
    pub door_omgeving: bool,
    pub vindbestand: Option<String>,
    /// Waarom het kanaal niet startte.
    pub fout: Option<String>,
}

impl GuiControl {
    fn nieuw(vindbestand: Option<PathBuf>, instelling: Option<PathBuf>, door_omgeving: bool, versie: String) -> Self {
        GuiControl {
            kanaal: Mutex::new(None),
            vindbestand,
            instelling,
            door_omgeving,
            laatste_fout: Mutex::new(None),
            versie,
            volgende_id: Mutex::new(0),
            wachtkamer: Arc::new((Mutex::new(HashMap::new()), Condvar::new())),
        }
    }

    pub fn is_actief(&self) -> bool {
        self.kanaal.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    /// Zet het kanaal uit en verwijder het vindbestand (als het nog het onze
    /// is). Bij afsluiten aangeroepen; een achtergebleven bestand zou een
    /// client naar een poort sturen waar niets meer luistert.
    pub fn opruimen(&self) {
        if let Some(l) = self.kanaal.lock().unwrap_or_else(|e| e.into_inner()).take() {
            l.stop();
        }
    }

    /// De bewaarde instelling (standaard aan bij een beschikbaar pad).
    fn instelling_aan(&self) -> bool {
        self.instelling.as_deref().is_some_and(instelling::lees)
    }

    pub fn status(&self) -> KanaalStatus {
        let kanaal = self.kanaal.lock().unwrap_or_else(|e| e.into_inner());
        KanaalStatus {
            toegestaan: self.instelling_aan(),
            actief: kanaal.is_some(),
            poort: kanaal.as_ref().map(Luisteraar::poort),
            door_omgeving: self.door_omgeving,
            vindbestand: kanaal
                .as_ref()
                .map(|l| l.bestand().to_string_lossy().into_owned()),
            fout: self.laatste_fout.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        }
    }

    /// Zet de toestand op en start het kanaal als dat bij het opstarten
    /// gevraagd is: met `OPENAEC_GUI_CONTROL=1` (`door_omgeving`), of omdat de
    /// bewaarde instelling in `instelling` aanstaat. Anders blijft het uit —
    /// geen luisteraar, geen vindbestand.
    ///
    /// `vindbestand` en `instelling` zijn `None` als de app-datamap onbekend
    /// is. Een fout bij het starten (poort, bestand, een andere instantie die
    /// het kanaal al heeft) is geen reden om de app niet te starten: het
    /// kanaal blijft uit en de reden staat in de status voor het paneel.
    pub fn opstarten(
        vindbestand: Option<PathBuf>,
        instelling: Option<PathBuf>,
        door_omgeving: bool,
        versie: String,
        kant: &dyn AppKant,
    ) -> Arc<GuiControl> {
        let control = Arc::new(GuiControl::nieuw(vindbestand, instelling, door_omgeving, versie));
        if instelling::moet_starten(control.door_omgeving, control.instelling_aan()) {
            if let Err(e) = control.start_kanaal(kant) {
                eprintln!("[gui_control] niet gestart: {e}");
                control.zet_fout(Some(e));
            }
        }
        control
    }

    /// Start het kanaal als het nog niet draait. Weigert over het levende
    /// vindbestand van een andere instantie heen te starten.
    fn start_kanaal(self: &Arc<Self>, kant: &dyn AppKant) -> Result<(), String> {
        let mut slot = self.kanaal.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_some() {
            return Ok(());
        }
        let bestand = self
            .vindbestand
            .clone()
            .ok_or("de app-datamap is onbekend; zet OPENAEC_GUI_CONTROL_FILE")?;
        if let Some(pid) = kanaal::vindbestand_van_ander(&bestand, std::process::id()) {
            return Err(format!(
                "een andere Open FEM Studio (pid {pid}) bedient het kanaal al via {}; sluit die eerst",
                bestand.display()
            ));
        }
        let l = Luisteraar::start(&bestand, &self.versie, kant.verwerker(Arc::downgrade(self)))?;
        eprintln!("[gui_control] actief op 127.0.0.1:{}", l.poort());
        *slot = Some(l);
        Ok(())
    }

    fn zet_fout(&self, fout: Option<String>) {
        *self.laatste_fout.lock().unwrap_or_else(|e| e.into_inner()) = fout;
    }

    /// De schakelaar aan: bewaar de keuze en start het kanaal. Een fout bij
    /// het bewaren is een fout (en dan start er niets); lukt het starten niet,
    /// dan staat de reden in `fout` van de teruggegeven status.
    pub fn zet_aan(self: &Arc<Self>, kant: &dyn AppKant) -> Result<KanaalStatus, String> {
        let pad = self
            .instelling
            .as_deref()
            .ok_or("de app-datamap is onbekend: de instelling kan niet bewaard worden")?;
        instelling::schrijf(pad, true)?;
        let start = self.start_kanaal(kant);
        self.zet_fout(start.err());
        Ok(self.meld(kant))
    }

    /// De schakelaar uit: zet het kanaal uit (vindbestand weg, poort dicht) en
    /// bewaar de keuze. Ook een kanaal dat met `OPENAEC_GUI_CONTROL=1` werd
    /// gestart, gaat uit. Eerst uit, dan bewaren: ook als het bewaren mislukt,
    /// is het kanaal dicht.
    pub fn zet_uit(&self, kant: &dyn AppKant) -> Result<KanaalStatus, String> {
        self.opruimen();
        self.zet_fout(None);
        let bewaard = match self.instelling.as_deref() {
            Some(pad) => instelling::schrijf(pad, false),
            None => Err("de app-datamap is onbekend: de instelling kan niet bewaard worden".into()),
        };
        let status = self.meld(kant);
        bewaard.map(|_| status)
    }

    /// Stuur de status naar alle vensters en geef hem terug.
    fn meld(&self, kant: &dyn AppKant) -> KanaalStatus {
        let status = self.status();
        kant.meld(&status);
        status
    }

    fn nieuw_id(&self) -> u64 {
        let mut n = self.volgende_id.lock().unwrap();
        *n += 1;
        *n
    }
}

/// Is deze start met het kanaal gevraagd (`OPENAEC_GUI_CONTROL` op `1` of
/// `true`)? Ook de bestandskoppeling kijkt hiernaar, samen met
/// [`eigen_vindbestand`].
pub fn gevraagd() -> bool {
    std::env::var(OMGEVINGSVARIABELE)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Het eigen pad voor het vindbestand uit `OPENAEC_GUI_CONTROL_FILE`, als dat
/// gezet en niet leeg is. Een instantie met kanaal én eigen vindbestand start
/// bewust naast die van de gebruiker (de testscripts in referentie-gui/); de
/// bestandskoppeling bewaakt dan geen enkel venster.
pub fn eigen_vindbestand() -> Option<PathBuf> {
    match std::env::var(VINDBESTAND_VARIABELE) {
        Ok(p) if !p.trim().is_empty() => Some(PathBuf::from(p)),
        _ => None,
    }
}

/// Zet de toestand van het kanaal op en start het kanaal als dat gevraagd is:
/// met `OPENAEC_GUI_CONTROL=1`, of omdat de instelling "Bediening door een
/// AI-assistent toestaan (MCP)" aanstaat. Hier alleen de paden en de versie
/// van de app; de beslissing staat in [`GuiControl::opstarten`].
///
/// Wordt in `setup` aangeroepen; de teruggegeven waarde gaat in `app.manage`.
pub fn start(app: &AppHandle) -> Arc<GuiControl> {
    let datamap = app.path().app_local_data_dir().ok();
    // Het vindbestand staat standaard in de app-datamap. Met
    // OPENAEC_GUI_CONTROL_FILE kan het elders: een test die een tweede
    // app-instantie start terwijl de gebruiker er al één met bediening heeft
    // draaien, zou anders diens vindbestand overschrijven — en daarmee elke
    // client van die gebruiker naar de testinstantie sturen.
    let vindbestand = eigen_vindbestand().or_else(|| datamap.as_ref().map(|m| m.join(BESTANDSNAAM)));
    let instellingpad = datamap.map(|m| m.join(instelling::BESTANDSNAAM));
    GuiControl::opstarten(
        vindbestand,
        instellingpad,
        gevraagd(),
        app.package_info().version.to_string(),
        app,
    )
}

/// Eén opdracht: zelf afhandelen, of doorgeven aan de pagina en wachten.
fn voer_uit(app: &AppHandle, control: &Arc<GuiControl>, o: Opdracht) -> Result<Value, String> {
    let tijdslimiet = Duration::from_secs(
        o.tijdslimiet_s
            .unwrap_or(STANDAARD_TIJDSLIMIET_S)
            .clamp(1, MAX_TIJDSLIMIET_S),
    );
    match o.naam.as_str() {
        "screenshot" => {
            let dom = o.args.get("dom").and_then(Value::as_bool).unwrap_or(false);
            if dom {
                // Terugval: de pagina tekent zichzelf met html2canvas en geeft
                // een data-URL; wij schrijven het bestand.
                let uit = naar_pagina(app, control, "screenshot_dom", o.args.clone(), tijdslimiet)?;
                let data = uit
                    .get("dataUrl")
                    .and_then(Value::as_str)
                    .ok_or("screenshot_dom gaf geen dataUrl")?;
                let pad = pad_uit_args(&o.args)?;
                schrijf_data_url(data, &pad)?;
                Ok(json!({ "pad": pad, "bron": "dom" }))
            } else {
                let label = o
                    .args
                    .get("venster")
                    .and_then(Value::as_str)
                    .unwrap_or(HOOFDVENSTER);
                let pad = pad_uit_args(&o.args)?;
                capture::naar_png(app, label, &pad)?;
                Ok(json!({ "pad": pad, "bron": "venster", "venster": label }))
            }
        }
        // Netjes afsluiten: via `AppHandle::exit`, zodat `RunEvent::Exit`
        // loopt en het vindbestand wordt opgeruimd. Een client die het proces
        // zou doden, laat dat bestand achter — en dan wijst het naar niets.
        // Eerst antwoorden, dan sluiten: anders ziet de client een verbroken
        // verbinding in plaats van een bevestiging.
        "afsluiten" => {
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                app.exit(0);
            });
            Ok(json!({ "afgesloten": true }))
        }
        "model_laden" => {
            let pad = o
                .args
                .get("pad")
                .and_then(Value::as_str)
                .ok_or("model_laden vraagt om `pad`")?;
            let tekst = fs::read_to_string(pad).map_err(|e| format!("{pad}: {e}"))?;
            naar_pagina(
                app,
                control,
                "model_laden",
                json!({ "tekst": tekst, "pad": pad }),
                tijdslimiet,
            )
        }
        // Net als `model_laden`: Rust leest het bestand, de pagina importeert
        // het met dezelfde functie als de knop "Rekenmodel importeren".
        "ifc_analysemodel_importeren" => {
            let pad = o
                .args
                .get("pad")
                .and_then(Value::as_str)
                .ok_or("ifc_analysemodel_importeren vraagt om `pad`")?;
            let bytes = fs::read(pad).map_err(|e| format!("{pad}: {e}"))?;
            let mut args = json!({ "tekst": stap_tekst(bytes), "pad": pad });
            if let Some(keuze) = o.args.get("analysemodel") {
                args["analysemodel"] = keuze.clone();
            }
            naar_pagina(app, control, "ifc_analysemodel_importeren", args, tijdslimiet)
        }
        "rapport_pdf" => rapport::naar_pdf(app, control, &o.args, tijdslimiet),
        naam => naar_pagina(app, control, naam, o.args, tijdslimiet),
    }
}

/// Zet de opdracht als event op het hoofdvenster en wacht op het antwoord.
fn naar_pagina(
    app: &AppHandle,
    control: &Arc<GuiControl>,
    naam: &str,
    args: Value,
    tijdslimiet: Duration,
) -> Result<Value, String> {
    let id = control.nieuw_id();
    {
        let (slot, _) = &*control.wachtkamer;
        slot.lock().unwrap().insert(id, None);
    }
    app.emit_to(
        HOOFDVENSTER,
        EVENT_OPDRACHT,
        json!({ "id": id, "naam": naam, "args": args }),
    )
    .map_err(|e| format!("event naar het hoofdvenster mislukt: {e}"))?;

    let (slot, wekker) = &*control.wachtkamer;
    let deadline = Instant::now() + tijdslimiet;
    let mut kamer = slot.lock().unwrap();
    loop {
        if let Some(Some(antwoord)) = kamer.get(&id) {
            let antwoord = antwoord.clone();
            kamer.remove(&id);
            return uitkomst_uit_antwoord(antwoord);
        }
        let nu = Instant::now();
        if nu >= deadline {
            kamer.remove(&id);
            return Err(format!(
                "geen antwoord van de pagina op `{naam}` binnen {} s — luistert `bediening.ts` wel \
                 (is de app volledig geladen, en staat het kanaal nog aan)?",
                tijdslimiet.as_secs()
            ));
        }
        let (k, _) = wekker.wait_timeout(kamer, deadline - nu).unwrap();
        kamer = k;
    }
}

/// De bytes van een STEP-bestand (IFC) als tekst: UTF-8, en anders elk byte
/// als één teken van ISO 8859-1. STEP hoort 7-bits te zijn, maar een schrijver
/// die toch Latijn-1 gebruikt, mag het lezen niet laten mislukken.
fn stap_tekst(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(tekst) => tekst,
        Err(fout) => fout.into_bytes().into_iter().map(char::from).collect(),
    }
}

/// De pagina antwoordt `{ok, uitkomst}` of `{ok: false, fout}`.
fn uitkomst_uit_antwoord(a: Value) -> Result<Value, String> {
    if a.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(a.get("uitkomst").cloned().unwrap_or(Value::Null))
    } else {
        Err(a
            .get("fout")
            .and_then(Value::as_str)
            .unwrap_or("de pagina meldde een fout zonder tekst")
            .to_string())
    }
}

fn pad_uit_args(args: &Value) -> Result<String, String> {
    args.get("pad")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "screenshot vraagt om `pad` (waar de PNG moet komen)".to_string())
}

fn schrijf_data_url(data: &str, pad: &str) -> Result<(), String> {
    let b64 = data
        .strip_prefix("data:image/png;base64,")
        .ok_or("dataUrl is geen PNG")?;
    let bytes = base64_decode(b64)?;
    if let Some(ouder) = std::path::Path::new(pad).parent() {
        let _ = fs::create_dir_all(ouder);
    }
    fs::write(pad, bytes).map_err(|e| format!("{pad}: {e}"))
}

/// Base64 zonder extra crate: de app-crate heeft er geen, en dit is de enige plek.
fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    fn waarde(c: u8) -> Result<u32, String> {
        Ok(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return Err(format!("ongeldig base64-teken {c}")),
        })
    }
    let schoon: Vec<u8> = s
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut uit = Vec::with_capacity(schoon.len() * 3 / 4);
    for blok in schoon.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in blok.iter().enumerate() {
            acc |= waarde(c)? << (18 - 6 * i);
        }
        let n = blok.len();
        if n >= 2 {
            uit.push((acc >> 16) as u8);
        }
        if n >= 3 {
            uit.push((acc >> 8) as u8);
        }
        if n == 4 {
            uit.push(acc as u8);
        }
    }
    Ok(uit)
}

// ── Het antwoord van de pagina ──────────────────────────────────────────────
// De Tauri-commands zelf staan in lib.rs (dun); dit is wat ze aanroepen.

impl GuiControl {
    /// Lever het antwoord van de pagina af bij de wachtende HTTP-aanroep.
    pub fn antwoord(&self, id: u64, uitkomst: Value) -> Result<(), String> {
        let (slot, wekker) = &*self.wachtkamer;
        let mut kamer = slot.lock().unwrap();
        match kamer.get_mut(&id) {
            Some(plek) => {
                *plek = Some(uitkomst);
                wekker.notify_all();
                Ok(())
            }
            None => Err(format!("onbekend of verlopen opdracht-id {id}")),
        }
    }
}

// ── Screenshot: echte pixels van een Tauri-venster ──────────────────────────

mod capture {
    use super::*;

    #[cfg(windows)]
    pub fn naar_png(app: &AppHandle, label: &str, pad: &str) -> Result<(), String> {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use windows::Win32::Foundation::{HWND, RECT};
        // `PrintWindow` staat in de Windows-metadata onder Storage::Xps (feature
        // `Win32_Storage_Xps`), niet onder WindowsAndMessaging waar winuser.h hem
        // declareert — nagekeken in de crate-bron van windows 0.61.3.
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
            SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS,
        };
        use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

        let venster = app.get_webview_window(label).ok_or_else(|| {
            // Welke vensters er wél zijn, zodat een client meteen ziet of het
            // label verkeerd is of het venster nooit is ontstaan.
            let bekend: Vec<String> = app.webview_windows().keys().cloned().collect();
            format!("geen venster met label `{label}` — bekende vensters: {bekend:?}")
        })?;
        let handle = venster
            .window_handle()
            .map_err(|e| format!("vensterhandle: {e}"))?;
        let hwnd_raw = match handle.as_raw() {
            RawWindowHandle::Win32(h) => h.hwnd.get(),
            _ => return Err("geen Win32-venster".into()),
        };
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);

        // PW_RENDERFULLCONTENT (2): zonder deze vlag blijft een WebView2 zwart.
        // Empirisch bevestigd op de geïnstalleerde app vóór deze module bestond.
        const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);

        let (breedte, hoogte, rgba) = unsafe {
            let mut r = RECT::default();
            GetWindowRect(hwnd, &mut r).map_err(|e| format!("GetWindowRect: {e}"))?;
            let w = r.right - r.left;
            let h = r.bottom - r.top;
            if w <= 0 || h <= 0 {
                return Err(format!("venster `{label}` heeft geen oppervlak ({w}×{h})"));
            }

            let hdc_scherm = GetDC(None);
            let hdc = CreateCompatibleDC(Some(hdc_scherm));
            let mut bmi = BITMAPINFO::default();
            bmi.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            };
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let hbm = CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0)
                .map_err(|e| format!("CreateDIBSection: {e}"))?;
            let oud = SelectObject(hdc, hbm.into());
            let ok = PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT).as_bool();

            let n = (w as usize) * (h as usize) * 4;
            let bron = std::slice::from_raw_parts(bits as *const u8, n);
            let mut rgba = Vec::with_capacity(n);
            for px in bron.chunks_exact(4) {
                rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }

            SelectObject(hdc, oud);
            let _ = DeleteObject(hbm.into());
            let _ = DeleteDC(hdc);
            ReleaseDC(None, hdc_scherm);

            if !ok {
                return Err(
                    "PrintWindow gaf false — het venster is mogelijk geminimaliseerd".into(),
                );
            }
            (w as u32, h as u32, rgba)
        };

        if let Some(ouder) = std::path::Path::new(pad).parent() {
            fs::create_dir_all(ouder).map_err(|e| format!("{}: {e}", ouder.display()))?;
        }
        let bestand = fs::File::create(pad).map_err(|e| format!("{pad}: {e}"))?;
        let mut enc = png::Encoder::new(std::io::BufWriter::new(bestand), breedte, hoogte);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut schrijver = enc.write_header().map_err(|e| format!("png: {e}"))?;
        schrijver
            .write_image_data(&rgba)
            .map_err(|e| format!("png: {e}"))?;
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn naar_png(_app: &AppHandle, _label: &str, _pad: &str) -> Result<(), String> {
        Err("venster-capture is alleen op Windows gebouwd; gebruik `dom: true`".into())
    }
}

// ── Het standaardrapport als PDF ────────────────────────────────────────────

/// `rapport_pdf`: het live rapport van het hoofdvenster naar een PDF-bestand.
///
/// # De volgorde, en waarom
///
/// 1. **`rapport_voorbereiden`** (pagina, `bediening/rapportExport.ts`) — weigert
///    met reden als er niets vers te printen valt (geen of verouderde
///    resultaten, toetsing loopt of faalde), zet rapporttype/papier/kop voor
///    DEZE export, schakelt naar het rapport en wacht op het klaar-signaal van
///    de paginering. Geeft vellen, papier en marges terug.
/// 2. **Printen** (`afdruk`, UI-draad) — WebView2 `PrintToPdf` naar een
///    tijdelijk bestand naast het doel.
/// 3. **`rapport_afronden`** (pagina) — ALTIJD, ook als het printen mislukte:
///    controleert dat er tussen "klaar" en de afdruk niets veranderde, en zet
///    type, papier, kop en weergave terug.
/// 4. **Controle** — `%PDF-`-kop en aantal pagina's gelijk aan het aantal
///    vellen. Pas dan wordt het tijdelijke bestand het doelbestand. Een PDF die
///    niet klopt, komt dus nooit op het gevraagde pad te staan.
///
/// # Geen deadlock
///
/// Deze functie draait op de draad van de luisterlus, niet op de UI-draad.
/// `with_webview` stuurt de closure als bericht naar de eventloop; daar wordt
/// `PrintToPdf` gestart (asynchroon), en de voltooiingshandler — ook op de
/// UI-draad — stuurt de uitkomst over een kanaal terug. Hier wordt met een
/// tijdslimiet op dat kanaal gewacht. Op de UI-draad wacht niets: de
/// antwoorden van de pagina (`gui_control_antwoord`) lopen over dezelfde
/// eventloop en blijven dus gewoon binnenkomen.
pub mod rapport {
    use super::*;
    use std::path::{Path, PathBuf};

    /// De argumenten die `rapport_pdf` kent. Een onbekend argument is een fout:
    /// een tikfout in `type` zou anders stil de huidige rapportinstellingen geven.
    const BEKENDE_ARGUMENTEN: [&str; 5] = ["pad", "type", "formaat", "orientatie", "project"];

    /// Het papier zoals de pagina het rapport heeft opgemaakt.
    #[derive(Debug, Clone, PartialEq)]
    pub struct Papier {
        /// Het vel zoals het op scherm staat: bij liggend is de breedte de lange zijde.
        pub vel_breedte_mm: f64,
        pub vel_hoogte_mm: f64,
        pub liggend: bool,
        pub marge_boven_mm: f64,
        pub marge_onder_mm: f64,
        pub marge_links_mm: f64,
        pub marge_rechts_mm: f64,
    }

    pub fn naar_pdf(
        app: &AppHandle,
        control: &Arc<GuiControl>,
        args: &Value,
        tijdslimiet: Duration,
    ) -> Result<Value, String> {
        let begin = Instant::now();
        controleer_argumenten(args)?;
        let doel = doelpad(args)?;
        // Buiten Windows weigeren VÓÓR de pagina iets verandert.
        if !cfg!(windows) {
            return Err(afdruk::NIET_OP_DIT_PLATFORM.into());
        }
        let venster = app
            .get_webview_window(HOOFDVENSTER)
            .ok_or("het hoofdvenster bestaat niet (meer)")?;
        // Een geminimaliseerd venster: HERSTELLEN, printen, en weer
        // minimaliseren. Een verborgen pagina krijgt vertraagde timers (de
        // debounce van de paginering loopt dan traag of niet), en de
        // printpijplijn van een geminimaliseerde WebView2 is niet iets om op te
        // vertrouwen zonder het te meten — herstellen is de weg die in elk geval
        // hetzelfde document geeft als Afdrukken in beeld.
        let geminimaliseerd = venster.is_minimized().unwrap_or(false);
        if geminimaliseerd {
            venster.unminimize().map_err(|e| {
                format!("het geminimaliseerde hoofdvenster is niet te herstellen: {e}")
            })?;
        }
        let uitkomst = exporteer(app, control, args, &doel, tijdslimiet, begin);
        if geminimaliseerd {
            let _ = venster.minimize();
        }
        let mut uit = uitkomst?;
        uit["vensterWasGeminimaliseerd"] = json!(geminimaliseerd);
        Ok(uit)
    }

    fn exporteer(
        app: &AppHandle,
        control: &Arc<GuiControl>,
        args: &Value,
        doel: &Path,
        tijdslimiet: Duration,
        begin: Instant,
    ) -> Result<Value, String> {
        // De pagina krijgt de tijd minus een marge voor printen en terugzetten;
        // wacht zij langer, dan zou de HTTP-aanroep verlopen vóór het afronden.
        let marge = Duration::from_secs(30);
        let pagina_tijd = tijdslimiet
            .saturating_sub(begin.elapsed())
            .saturating_sub(marge)
            .max(Duration::from_secs(5));
        let mut pagina_args = serde_json::Map::new();
        for k in ["type", "formaat", "orientatie", "project"] {
            if let Some(v) = args.get(k).filter(|v| !v.is_null()) {
                pagina_args.insert(k.to_string(), v.clone());
            }
        }
        pagina_args.insert(
            "tijdslimiet_ms".into(),
            json!(pagina_tijd.as_millis() as u64),
        );
        let voor = naar_pagina(
            app,
            control,
            "rapport_voorbereiden",
            Value::Object(pagina_args),
            pagina_tijd + Duration::from_secs(10),
        )?;
        let export_id = voor
            .get("exportId")
            .and_then(Value::as_u64)
            .ok_or("rapport_voorbereiden gaf geen exportId terug")?;

        let tijdelijk = tijdelijk_pad(doel);
        let opgegeven_vellen = voor.get("aantalVellen").and_then(Value::as_u64).map(|n| n as usize);
        // Het 3D-rapport wordt door de browser zelf over pagina's verdeeld en
        // heeft daarom vóór het afdrukken nog geen betrouwbaar vel-aantal. Bij
        // 2D blijven de vaste rapportvellen leidend en eisen we exacte gelijkheid.
        let dynamisch_3d_rapport = voor.get("rapportDimensie").and_then(Value::as_str) == Some("3d");
        let print = papier_uit_antwoord(&voor).and_then(|papier| {
            let rest = tijdslimiet
                .saturating_sub(begin.elapsed())
                .max(Duration::from_secs(30));
            afdruk::print_hoofdvenster(app, &tijdelijk, &papier, rest)
        });
        // Altijd afronden: ook na een mislukte afdruk hoort de toestand van de
        // gebruiker terug te komen.
        let af = naar_pagina(
            app,
            control,
            "rapport_afronden",
            json!({ "exportId": export_id }),
            Duration::from_secs(30),
        );
        let weg = || {
            let _ = fs::remove_file(&tijdelijk);
        };

        if let Err(e) = print {
            weg();
            return Err(format!("printen naar PDF mislukt: {e}"));
        }
        let af = match af {
            Ok(a) => a,
            Err(e) => {
                weg();
                return Err(format!(
                    "terugzetten na het printen mislukt ({e}); de PDF is weggegooid"
                ));
            }
        };
        if af.get("ongewijzigd").and_then(Value::as_bool) != Some(true) {
            weg();
            let reden = af
                .get("reden")
                .and_then(Value::as_str)
                .unwrap_or("de pagina bevestigde niet dat alles bleef staan");
            return Err(format!("de PDF is weggegooid: {reden}"));
        }
        let verwacht_vellen = match (dynamisch_3d_rapport, opgegeven_vellen) {
            (true, _) => None,
            (false, Some(n)) => Some(n),
            (false, None) => {
                weg();
                return Err("rapport_voorbereiden gaf geen aantalVellen terug".into());
            }
        };
        let bytes = match fs::read(&tijdelijk) {
            Ok(b) => b,
            Err(e) => {
                weg();
                return Err(format!(
                    "de geprinte PDF is niet te lezen ({}): {e}",
                    tijdelijk.display()
                ));
            }
        };
        let paginas = match controleer_pdf_met_verwacht_aantal(&bytes, verwacht_vellen) {
            Ok(n) => n,
            Err(e) => {
                weg();
                return Err(e);
            }
        };
        let vellen = verwacht_vellen.unwrap_or(paginas);
        if let Err(e) = fs::rename(&tijdelijk, doel) {
            weg();
            return Err(format!(
                "{}: {e} — staat het bestand open in een PDF-lezer?",
                doel.display()
            ));
        }

        Ok(json!({
            "pad": doel.to_string_lossy(),
            "bytes": bytes.len(),
            "paginas": paginas,
            "vellen": vellen,
            "rapportType": voor.get("rapportType").cloned().unwrap_or(Value::Null),
            "toetsingDetail": voor.get("toetsingDetail").cloned().unwrap_or(Value::Null),
            "formaat": voor.get("formaat").cloned().unwrap_or(Value::Null),
            "orientatie": voor.get("orientatie").cloned().unwrap_or(Value::Null),
            "velMm": voor.get("velMm").cloned().unwrap_or(Value::Null),
            "margesMm": voor.get("margesMm").cloned().unwrap_or(Value::Null),
            "projectKop": voor.get("projectKop").cloned().unwrap_or(Value::Null),
            "analysetype": voor.get("analysetype").cloned().unwrap_or(Value::Null),
            "toetsing": voor.get("toetsing").cloned().unwrap_or(Value::Null),
            "fysischeRonde": voor.get("fysischeRonde").cloned().unwrap_or(Value::Null),
            "vorigeToestand": voor.get("vorigeToestand").cloned().unwrap_or(Value::Null),
            "hersteld": af.get("hersteld").cloned().unwrap_or(Value::Null),
            "beforeprintGezien": af.get("beforeprintGezien").cloned().unwrap_or(Value::Null),
            "wachttijdMs": voor.get("wachttijdMs").cloned().unwrap_or(Value::Null),
            "duurMs": begin.elapsed().as_millis() as u64,
        }))
    }

    pub fn controleer_argumenten(args: &Value) -> Result<(), String> {
        let Some(obj) = args.as_object() else {
            return Err("rapport_pdf verwacht een object met argumenten".into());
        };
        for k in obj.keys() {
            if !BEKENDE_ARGUMENTEN.contains(&k.as_str()) {
                return Err(format!(
                    "onbekend argument `{k}` voor rapport_pdf (bekend: {})",
                    BEKENDE_ARGUMENTEN.join(", ")
                ));
            }
        }
        Ok(())
    }

    /// Het doelpad: absoluut en met de extensie .pdf. De map wordt aangemaakt.
    pub fn doelpad(args: &Value) -> Result<PathBuf, String> {
        let pad = args
            .get("pad")
            .and_then(Value::as_str)
            .ok_or("rapport_pdf vraagt om `pad` (waar de PDF moet komen)")?;
        let p = PathBuf::from(pad);
        if !p.is_absolute() {
            return Err(format!("`pad` moet een absoluut pad zijn, niet {pad}"));
        }
        let is_pdf = p
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false);
        if !is_pdf {
            return Err(format!("`pad` moet op .pdf eindigen: {pad}"));
        }
        if let Some(ouder) = p.parent() {
            fs::create_dir_all(ouder).map_err(|e| format!("{}: {e}", ouder.display()))?;
        }
        Ok(p)
    }

    /// Naast het doel, met het proces-id erin: twee exports naar hetzelfde pad
    /// (of een halve van een afgebroken poging) lopen elkaar zo niet in de weg.
    pub fn tijdelijk_pad(doel: &Path) -> PathBuf {
        let stam = doel
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "rapport".into());
        doel.with_file_name(format!("{stam}.{}.deel.pdf", std::process::id()))
    }

    /// Het papier uit het antwoord van `rapport_voorbereiden`.
    pub fn papier_uit_antwoord(v: &Value) -> Result<Papier, String> {
        let getal = |pad: &[&str]| -> Result<f64, String> {
            let mut w = v;
            for k in pad {
                w = w.get(*k).unwrap_or(&Value::Null);
            }
            w.as_f64()
                .filter(|x| x.is_finite() && *x >= 0.0)
                .ok_or_else(|| format!("rapport_voorbereiden gaf geen geldig `{}`", pad.join(".")))
        };
        let liggend = match v.get("orientatie").and_then(Value::as_str) {
            Some("landscape") => true,
            Some("portrait") => false,
            anders => {
                return Err(format!(
                    "rapport_voorbereiden gaf een onbekende oriëntatie {anders:?}"
                ))
            }
        };
        Ok(Papier {
            vel_breedte_mm: getal(&["velMm", "breedte"])?,
            vel_hoogte_mm: getal(&["velMm", "hoogte"])?,
            liggend,
            marge_boven_mm: getal(&["margesMm", "boven"])?,
            marge_onder_mm: getal(&["margesMm", "onder"])?,
            marge_links_mm: getal(&["margesMm", "links"])?,
            marge_rechts_mm: getal(&["margesMm", "rechts"])?,
        })
    }

    /// De controle achteraf: een PDF-kop, en voor vaste rapportvellen precies
    /// één pagina per vel. Een dynamisch rapport geeft `None` mee en gebruikt
    /// het werkelijk gevonden paginatal.
    ///
    /// Eén vel = één printpagina is de bedoeling van de print-CSS (`break-after:
    /// page` per vel), maar geen wet: een element dat hoger is dan een heel vel
    /// krijgt een eigen vel en mag daar overlopen (paginate.ts), en printinstellingen
    /// die van de `@page`-regel afwijken, verschuiven de breuken. In beide gevallen
    /// kloppen de paginanummers en de inhoudsopgave niet meer met wat er gedrukt
    /// is. Liever geen PDF dan zo'n PDF.
    pub fn controleer_pdf_met_verwacht_aantal(
        bytes: &[u8],
        verwacht_vellen: Option<usize>,
    ) -> Result<usize, String> {
        if !bytes.starts_with(b"%PDF-") {
            return Err("de afdruk is geen PDF (het bestand begint niet met %PDF-)".into());
        }
        let n = tel_paginas(bytes).ok_or(
            "het aantal pagina's is uit de PDF niet af te lezen (geen /Type /Page-objecten gevonden)",
        )?;
        if let Some(vellen) = verwacht_vellen {
            if n != vellen {
                return Err(format!(
                    "de PDF heeft {n} pagina's maar het rapport {vellen} vellen — een vel liep over meer \
                     dan één printpagina (bijvoorbeeld een figuur die hoger is dan een vel) of de \
                     printinstellingen weken af van de opmaak; de PDF is weggegooid"
                ));
            }
        }
        Ok(n)
    }

    /// Compatibele helper voor de vaste 2D-rapportvellen.
    pub fn controleer_pdf(bytes: &[u8], vellen: usize) -> Result<usize, String> {
        controleer_pdf_met_verwacht_aantal(bytes, Some(vellen))
    }

    /// Tel de paginaobjecten: `/Type /Page`, niet `/Type /Pages` (de boom).
    ///
    /// Geen PDF-bibliotheek: de app-crate heeft er geen, en voor een telling is
    /// die niet nodig. Staan de paginaobjecten in een gecomprimeerde
    /// objectstroom, dan vindt dit niets en geeft het `None` — dan volgt een
    /// fout en geen gok.
    pub fn tel_paginas(bytes: &[u8]) -> Option<usize> {
        const TYPE: &[u8] = b"/Type";
        const PAGE: &[u8] = b"/Page";
        let mut n = 0usize;
        let mut i = 0usize;
        while let Some(pos) = zoek(&bytes[i..], TYPE) {
            let mut j = i + pos + TYPE.len();
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if bytes[j..].starts_with(PAGE) {
                let na = bytes.get(j + PAGE.len()).copied();
                // Een PDF-naam loopt door tot een scheidingsteken; `/Pages`
                // heeft er nog een letter achter en telt dus niet.
                if !na.map(|c| c.is_ascii_alphanumeric()).unwrap_or(false) {
                    n += 1;
                }
            }
            i = j;
        }
        (n > 0).then_some(n)
    }

    fn zoek(hooiberg: &[u8], naald: &[u8]) -> Option<usize> {
        hooiberg.windows(naald.len()).position(|w| w == naald)
    }
}

/// Printen van het hoofdvenster naar PDF, op het platform dat het kan.
///
/// # Waarom `ICoreWebView2_7::PrintToPdf`
///
/// Twee routes zijn er zonder printdialoog en zonder debugpoort: de officiële
/// WebView2-API `PrintToPdf` (sinds runtime 1.0.992) en het DevTools-commando voor
/// PDF-afdruk via `CallDevToolsProtocolMethod`. Beide gebruiken de printpijplijn
/// van Chromium en dus dezelfde `@media print`- en `@page`-regels als
/// Afdrukken → Opslaan als PDF. Gekozen is `PrintToPdf`, omdat:
///
/// * het een stabiele, gedocumenteerde WebView2-interface is, geen protocol dat
///   per Chromium-versie kan schuiven;
/// * de browser zelf het bestand schrijft — de DevTools-route geeft de hele PDF als
///   base64 in één JSON-tekst terug over de UI-draad (bij een rapport van tientallen
///   vellen vele megabytes);
/// * de instellingen expliciet en getypeerd zijn.
///
/// De printinstellingen worden gelijk gezet aan wat de pagina gebruikte (papier,
/// oriëntatie, marges uit `rapport_voorbereiden`), zodat instellingen en de
/// `@page`-regel van ReportShell niet met elkaar kunnen botsen. Achtergronden AAN:
/// het rapport heeft grijze tabelkoppen (`report.css`, `.rpt-table thead th`) en
/// nergens `print-color-adjust`. Browserkop en -voet UIT: de paginanummers staan al
/// in de eigen `@page`-margeboxen.
mod afdruk {
    use super::*;

    #[cfg_attr(windows, allow(dead_code))]
    pub const NIET_OP_DIT_PLATFORM: &str =
        "de PDF-export van het rapport bestaat alleen op Windows: hij print via WebView2 \
         (ICoreWebView2_7::PrintToPdf), en Tauri en wry bieden op andere platforms geen \
         afdruk zonder printdialoog";

    const MM_PER_INCH: f64 = 25.4;

    #[cfg(windows)]
    pub fn print_hoofdvenster(
        app: &AppHandle,
        pad: &std::path::Path,
        papier: &rapport::Papier,
        tijdslimiet: Duration,
    ) -> Result<(), String> {
        use std::sync::mpsc;
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment6, ICoreWebView2_7, COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE,
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        };
        use webview2_com::PrintToPdfCompletedHandler;
        use windows::core::{Interface, HSTRING};

        let venster = app
            .get_webview_window(HOOFDVENSTER)
            .ok_or("het hoofdvenster bestaat niet (meer)")?;
        let pad_w = HSTRING::from(pad.to_string_lossy().as_ref());
        let papier = papier.clone();
        let (tx, rx) = mpsc::channel::<Result<(), String>>();
        let tx_start = tx.clone();

        venster
            .with_webview(move |wv| {
                // Draait op de UI-draad. Alles hier is snel: instellingen zetten en
                // PrintToPdf STARTEN; de uitkomst komt later via de handler.
                let start = (|| -> Result<(), String> {
                    unsafe {
                        let core = wv
                            .controller()
                            .CoreWebView2()
                            .map_err(|e| format!("CoreWebView2: {e}"))?;
                        let core7: ICoreWebView2_7 = core.cast().map_err(|e| {
                            format!("deze WebView2-runtime kent PrintToPdf niet (ICoreWebView2_7): {e}")
                        })?;
                        let env6: ICoreWebView2Environment6 = wv.environment().cast().map_err(|e| {
                            format!("deze WebView2-runtime kent printinstellingen niet (Environment6): {e}")
                        })?;
                        let s = env6
                            .CreatePrintSettings()
                            .map_err(|e| format!("CreatePrintSettings: {e}"))?;
                        let zet = |r: windows::core::Result<()>, wat: &str| {
                            r.map_err(|e| format!("printinstelling {wat}: {e}"))
                        };
                        // Het papier STAAND opgeven, de oriëntatie los: zo beschrijft
                        // WebView2 een vel (PageWidth/PageHeight in inch + Orientation).
                        let korte = papier.vel_breedte_mm.min(papier.vel_hoogte_mm);
                        let lange = papier.vel_breedte_mm.max(papier.vel_hoogte_mm);
                        zet(
                            s.SetOrientation(if papier.liggend {
                                COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                            } else {
                                COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                            }),
                            "Orientation",
                        )?;
                        zet(s.SetPageWidth(korte / MM_PER_INCH), "PageWidth")?;
                        zet(s.SetPageHeight(lange / MM_PER_INCH), "PageHeight")?;
                        zet(s.SetMarginTop(papier.marge_boven_mm / MM_PER_INCH), "MarginTop")?;
                        zet(s.SetMarginBottom(papier.marge_onder_mm / MM_PER_INCH), "MarginBottom")?;
                        zet(s.SetMarginLeft(papier.marge_links_mm / MM_PER_INCH), "MarginLeft")?;
                        zet(s.SetMarginRight(papier.marge_rechts_mm / MM_PER_INCH), "MarginRight")?;
                        zet(s.SetScaleFactor(1.0), "ScaleFactor")?;
                        zet(s.SetShouldPrintBackgrounds(true), "ShouldPrintBackgrounds")?;
                        zet(s.SetShouldPrintHeaderAndFooter(false), "ShouldPrintHeaderAndFooter")?;
                        zet(s.SetShouldPrintSelectionOnly(false), "ShouldPrintSelectionOnly")?;

                        let tx_klaar = tx.clone();
                        let handler = PrintToPdfCompletedHandler::create(Box::new(
                            move |fout: windows::core::Result<()>, gelukt: bool| {
                                let _ = tx_klaar.send(match fout {
                                    Ok(()) if gelukt => Ok(()),
                                    Ok(()) => Err(
                                        "PrintToPdf meldde dat het niet lukte (geen HRESULT-fout; \
                                         schrijfrechten op de map, of een lopende afdruk?)"
                                            .into(),
                                    ),
                                    Err(e) => Err(format!("PrintToPdf: {e}")),
                                });
                                Ok(())
                            },
                        ));
                        core7
                            .PrintToPdf(&pad_w, &s, &handler)
                            .map_err(|e| format!("PrintToPdf starten: {e}"))?;
                    }
                    Ok(())
                })();
                if let Err(e) = start {
                    let _ = tx_start.send(Err(e));
                }
            })
            .map_err(|e| format!("with_webview: {e}"))?;

        match rx.recv_timeout(tijdslimiet) {
            Ok(r) => r,
            Err(_) => Err(format!(
                "PrintToPdf gaf binnen {} s geen uitkomst",
                tijdslimiet.as_secs()
            )),
        }
    }

    #[cfg(not(windows))]
    pub fn print_hoofdvenster(
        _app: &AppHandle,
        _pad: &std::path::Path,
        _papier: &rapport::Papier,
        _tijdslimiet: Duration,
    ) -> Result<(), String> {
        Err(NIET_OP_DIT_PLATFORM.into())
    }
}
