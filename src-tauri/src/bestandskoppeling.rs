//! `bestandskoppeling` — een projectbestand openen dat het besturingssysteem
//! aan de app geeft (issue #90).
//!
//! # Waar een bestand vandaan komt
//!
//! * **Windows en Linux, eerste start** — de installer koppelt `.ifcfem` en
//!   `.ifcfem2d` aan de app (`bundle.fileAssociations` in tauri.conf.json); een
//!   dubbelklik start `open-fem-studio.exe "<pad>"`. `eerste_start` leest argv
//!   in `setup`.
//! * **Windows en Linux, de app draait al** — tauri-plugin-single-instance (de
//!   EERSTE plugin in `run`) ziet in de tweede start dat er al een instantie
//!   is, geeft de argv en werkmap van die start aan de draaiende app en stopt
//!   de tweede start, vóór er een venster is. `tweede_start` verwerkt ze en
//!   haalt het venster naar voren; zonder bestand alleen dat laatste.
//! * **macOS** — Finder start geen tweede proces maar stuurt de app een
//!   `RunEvent::Opened` met `file://`-URL's, ook bij de eerste start. Zie
//!   `geopend`.
//!
//! # Naar de pagina
//!
//! De paden gaan in een [`Wachtrij`] en Rust stuurt het event
//! [`EVENT_BESTANDEN`]. De pagina (`design-mockup/src/io/bestandskoppeling.ts`)
//! haalt de wachtrij op bij het laden (zodra de recente bestanden er zijn) en
//! na elk event, met het command `bestandskoppeling_ophalen`, en opent elk pad
//! langs de bestaande weg van de recente bestanden (`handleOpenFilePath`: de vraag over niet-opgeslagen
//! werk, recente bestanden, 2D of 3D uit het bestand). De wachtrij is er omdat
//! een event van vóór het laden van de pagina door niemand gehoord wordt.
//!
//! # De fs-scope
//!
//! De pagina leest met `readTextFile`, en tauri-plugin-fs laat alleen paden
//! door die in de capability staan (`**/*.ifcfem`, `**/*.ifcfem2d`,
//! hoofdlettergevoelig) of die tijdens de looptijd zijn vrijgegeven. Zoals de
//! dialoogplugin na een keuze doet, geeft [`meld`] daarom precies elk
//! gemelde projectbestand vrij met `allow_file` — geen map, geen patroon —
//! zodat ook `HAL.IFCFEM` op een netwerkschijf leesbaar is. Een bestand met een
//! andere extensie wordt níet vrijgegeven; de pagina meldt alleen dat het geen
//! project is.
//!
//! # Wanneer er één venster bewaakt wordt
//!
//! Zie [`een_instantie_bewaken`]: niet in een debugbuild (de ontwikkelversie
//! deelt de identifier met de geïnstalleerde app en zou anders stoppen zodra
//! die draait) en niet in een instantie met het bedieningskanaal én een eigen
//! vindbestand (`OPENAEC_GUI_CONTROL_FILE`: een testscript start die bewust
//! naast die van de gebruiker; zie gui_control.rs). De gewone MCP-stand
//! (alleen `OPENAEC_GUI_CONTROL=1`) is wél de ene app, zodat een dubbelklik
//! opent in de app die de MCP bestuurt.

use std::collections::HashSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// De extensies van een projectbestand: dezelfde als Openen en de recente
/// bestanden (`PROJECT_FILE_EXTS` in design-mockup/src/io/projectFile.ts).
pub const PROJECTEXTENSIES: [&str; 2] = ["ifcfem", "ifcfem2d"];

/// Het event waarmee Rust de pagina laat weten dat er paden klaarstaan.
pub const EVENT_BESTANDEN: &str = "bestandskoppeling:bestanden";

/// Zet de bewaking op één venster ook in een debugbuild aan (`1` of `true`),
/// om het tijdens de ontwikkeling te kunnen proberen.
pub const IN_DEBUG_VARIABELE: &str = "OPENAEC_EEN_INSTANTIE";

/// Het venster dat naar voren komt en het event krijgt.
const HOOFDVENSTER: &str = "main";

/// Wat een start aan bestanden meebracht.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Startbestanden {
    /// Bestaande `.ifcfem`- en `.ifcfem2d`-bestanden, in de volgorde van de
    /// start, elk één keer.
    pub projecten: Vec<PathBuf>,
    /// Bestaande bestanden met een andere extensie ("Openen met" op een ander
    /// bestandstype): niet openen, wel melden.
    pub andere: Vec<PathBuf>,
}

impl Startbestanden {
    pub fn is_leeg(&self) -> bool {
        self.projecten.is_empty() && self.andere.is_empty()
    }
}

/// Heeft dit pad de extensie van een projectbestand? Hoofdletters maken niet
/// uit; alleen de laatste extensie telt (`hal.ifcfem.bak` is geen project).
pub fn is_projectbestand(pad: &Path) -> bool {
    pad.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| PROJECTEXTENSIES.iter().any(|p| e.eq_ignore_ascii_case(p)))
}

/// Haal uit argv de bestanden die deze start meebracht.
///
/// `argv[0]` is het programma en telt niet mee. Een argument dat met `-`
/// begint is een vlag (ook `--` en het `-psn_…` van een oudere macOS). Een
/// relatief pad hoort bij `werkmap`: die van DEZE start — bij een tweede start
/// geeft de single-instance-plugin de werkmap van die start mee. Alleen
/// bestaande bestanden blijven over (geen map die toevallig op `.ifcfem`
/// eindigt); spaties in een pad zijn gewoon deel van het pad, want het
/// besturingssysteem geeft elk argument los.
///
/// Neemt `OsString`: argv van het besturingssysteem hoeft geen geldige
/// Unicode te zijn (NTFS staat een ongepaarde surrogaat in een naam toe, ext4
/// willekeurige bytes). `std::env::args()` raakt daarop in paniek en zou de app
/// bij het opstarten laten vallen; `args_os()` met deze functie niet.
pub fn bestanden_uit_argv_os(argv: &[OsString], werkmap: &Path) -> Startbestanden {
    let kandidaten = argv
        .iter()
        .skip(1)
        // De eerste byte van de gecodeerde vorm: een ASCII-`-` is op elk
        // platform dezelfde byte, ook in de WTF-8 van Windows.
        .filter(|a| !a.is_empty() && a.as_encoded_bytes().first() != Some(&b'-'))
        .map(PathBuf::from)
        .collect();
    deel_in(kandidaten, werkmap)
}

/// [`bestanden_uit_argv_os`] voor argv als `String`, zoals
/// tauri-plugin-single-instance de argumenten van een tweede start doorgeeft.
pub fn bestanden_uit_argv(argv: &[String], werkmap: &Path) -> Startbestanden {
    let argv: Vec<OsString> = argv.iter().map(OsString::from).collect();
    bestanden_uit_argv_os(&argv, werkmap)
}

/// Deel kandidaat-paden in: relatief → bij `werkmap`, dan alleen bestaande
/// bestanden, elk één keer, projectbestanden apart van de rest.
///
/// Het pad blijft zoals het gegeven is (alleen `.` en dubbele scheidingstekens
/// vallen weg): een bestand op `Z:\` blijft `Z:\…` in de recente bestanden en
/// wordt geen UNC-pad.
///
/// Een pad dat geen geldige Unicode is, valt af (met een regel op stderr): de
/// pagina krijgt paden als JSON-tekst, en zo'n pad kwam daar verminkt aan
/// (U+FFFD), als een ander, niet vrijgegeven pad dat niet te openen is.
pub fn deel_in(kandidaten: Vec<PathBuf>, werkmap: &Path) -> Startbestanden {
    let mut gezien = HashSet::new();
    let mut uit = Startbestanden::default();
    for kandidaat in kandidaten {
        let absoluut = if kandidaat.is_absolute() {
            kandidaat
        } else {
            werkmap.join(kandidaat)
        };
        let pad: PathBuf = absoluut.components().collect();
        if !pad.is_file() || !gezien.insert(pad.clone()) {
            continue;
        }
        if pad.to_str().is_none() {
            eprintln!(
                "[bestandskoppeling] {} overgeslagen: de naam is geen geldige Unicode",
                pad.display()
            );
            continue;
        }
        if is_projectbestand(&pad) {
            uit.projecten.push(pad);
        } else {
            uit.andere.push(pad);
        }
    }
    uit
}

/// De bestandspaden uit de URL's van `RunEvent::Opened` (macOS). Alleen
/// `file://`; een andere URL is geen bestand.
pub fn paden_uit_urls(urls: &[tauri::Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|u| u.scheme() == "file")
        .filter_map(|u| u.to_file_path().ok())
        .collect()
}

/// Bewaakt deze start dat er maar één app-venster is?
///
/// * Een instantie met het bedieningskanaal aan (`OPENAEC_GUI_CONTROL=1`) én
///   een eigen vindbestand (`OPENAEC_GUI_CONTROL_FILE`): nee. Zo starten de
///   testscripts (referentie-gui/*.mjs) een instantie bewust naast die van de
///   gebruiker; met de bewaking zou ze meteen stoppen.
/// * Het bedieningskanaal zonder eigen vindbestand, de gedocumenteerde
///   MCP-stand: ja. Dat is de app van de gebruiker; een dubbelklik in de
///   verkenner opent in die app en niet in een tweede venster. Draait er al
///   een app, dan geeft zo'n start het venster aan die app en stopt (README
///   van de MCP-server). Een eigen vindbestand zonder kanaal betekent niets.
/// * In een debugbuild (`npm run tauri dev`): alleen met
///   `OPENAEC_EEN_INSTANTIE=1`. De ontwikkelversie heeft dezelfde identifier
///   als de geïnstalleerde app, en zou anders stoppen zodra die draait.
/// * Anders (de geïnstalleerde app): ja.
pub fn een_instantie_bewaken(
    debugbuild: bool,
    bediening_aan: bool,
    eigen_vindbestand: bool,
    in_debug_gevraagd: bool,
) -> bool {
    if bediening_aan && eigen_vindbestand {
        return false;
    }
    !debugbuild || in_debug_gevraagd
}

/// Staat `OPENAEC_EEN_INSTANTIE` op `1` of `true`?
pub fn in_debug_gevraagd() -> bool {
    std::env::var(IN_DEBUG_VARIABELE)
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// De paden die nog naar de pagina moeten, in volgorde.
#[derive(Default)]
pub struct Wachtrij(Mutex<Vec<String>>);

impl Wachtrij {
    /// Voeg paden toe; `true` als er iets bij kwam (dan is een event zinvol).
    pub fn voeg_toe(&self, paden: Vec<String>) -> bool {
        if paden.is_empty() {
            return false;
        }
        self.0.lock().unwrap_or_else(|e| e.into_inner()).extend(paden);
        true
    }

    /// Alles wat klaarstaat, en de wachtrij leeg: een pad gaat één keer.
    pub fn haal_op(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(|e| e.into_inner()))
    }
}

/// Geef de bestanden aan de pagina: projectbestanden vrij in de fs-scope, alle
/// paden in de wachtrij, en het event naar het hoofdvenster.
pub fn meld<R: Runtime>(app: &AppHandle<R>, bestanden: Startbestanden) {
    if bestanden.is_leeg() {
        return;
    }
    if let Some(scope) = app.try_fs_scope() {
        for pad in &bestanden.projecten {
            // Het pad zoals de pagina het straks vraagt. `allow_file` legt er
            // ook de canonieke vorm bij (`\\?\`-voorvoegsel, een netwerkschijf
            // als UNC-pad), en daarmee vergelijkt `is_allowed`; getoetst in
            // tests/bestandskoppeling.rs.
            if let Err(e) = scope.allow_file(pad) {
                eprintln!("[bestandskoppeling] {} niet vrijgegeven: {e}", pad.display());
            }
        }
    }
    let paden = bestanden
        .projecten
        .iter()
        .chain(bestanden.andere.iter())
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    let Some(rij) = app.try_state::<Wachtrij>() else {
        return;
    };
    if rij.voeg_toe(paden) {
        // Hoort de pagina het nog niet (eerste start, nog aan het laden), dan
        // haalt zij de wachtrij zelf op zodra ze luistert.
        let _ = app.emit_to(HOOFDVENSTER, EVENT_BESTANDEN, ());
    }
}

/// De eerste start: argv en werkmap van dit proces. In `setup` aangeroepen.
/// Met `args_os`: `args()` raakt in paniek op een argument dat geen geldige
/// Unicode is, en dan zou een dubbelklik op zo'n bestand de app laten vallen.
pub fn eerste_start<R: Runtime>(app: &AppHandle<R>) {
    let argv: Vec<OsString> = std::env::args_os().collect();
    let werkmap = std::env::current_dir().unwrap_or_default();
    meld(app, bestanden_uit_argv_os(&argv, &werkmap));
}

/// Een tweede start terwijl de app draait (tauri-plugin-single-instance): de
/// bestanden ervan openen hier, en het venster komt naar voren — ook zonder
/// bestand.
pub fn tweede_start<R: Runtime>(app: &AppHandle<R>, argv: &[String], werkmap: &str) {
    meld(app, bestanden_uit_argv(argv, Path::new(werkmap)));
    naar_voren(app);
}

/// macOS: bestanden uit `RunEvent::Opened`.
pub fn geopend<R: Runtime>(app: &AppHandle<R>, urls: &[tauri::Url]) {
    let werkmap = std::env::current_dir().unwrap_or_default();
    meld(app, deel_in(paden_uit_urls(urls), &werkmap));
    naar_voren(app);
}

/// Het hoofdvenster terug uit de taakbalk, zichtbaar en met de focus.
fn naar_voren<R: Runtime>(app: &AppHandle<R>) {
    if let Some(venster) = app.get_webview_window(HOOFDVENSTER) {
        let _ = venster.unminimize();
        let _ = venster.show();
        let _ = venster.set_focus();
    }
}
