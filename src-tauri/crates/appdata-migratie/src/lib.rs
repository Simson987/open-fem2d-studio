//! `appdata-migratie` — neemt bij de eerste start na de naamswijziging de
//! app-datamappen van de vorige identifier over.
//!
//! # Waarom
//!
//! Tauri en de webview bewaren alles in mappen die naar de identifier van de
//! app heten. Tot en met uitgave 2026.39.1 was dat [`OUDE_IDENTIFIER`]; nu is
//! het [`NIEUWE_IDENTIFIER`]. Zonder overname start de nieuwe versie met lege
//! instellingen: geen recente bestanden, geen taal, thema en projectgegevens,
//! en een lege localStorage (eigen doorsneden, CLT-opbouwen, weergavekeuzes).
//!
//! # Welke mappen
//!
//! Per platform de basismappen waarin Tauri en de webview een submap per
//! identifier maken ([`basismappen`]):
//!
//! * Windows: `%APPDATA%` (Roaming: `preferences.json` van de plugin-store,
//!   met de instellingen en de recente bestanden) en `%LOCALAPPDATA%` (Local:
//!   de WebView2-gegevens in `EBWebView`, waaronder de localStorage);
//! * macOS: `~/Library/Application Support` (de plugin-store) en
//!   `~/Library/WebKit` (de localStorage van WKWebView, onder de bundel-id);
//! * Linux: `~/.local/share` (de plugin-store en de WebKitGTK-gegevens) en
//!   `~/.config`.
//!
//! # Hoe
//!
//! * Alleen als de nieuwe map nog NIET bestaat en de oude wel; anders niets.
//! * Kopiëren, niet verplaatsen: de oude map blijft staan, zodat een oudere
//!   installatie ermee blijft werken.
//! * Eerst naar een tijdelijke map naast de nieuwe, daarna in één keer
//!   hernoemen. Een onderbroken kopie laat zo nooit een halve nieuwe map
//!   achter; de volgende start probeert het opnieuw.
//! * Niet mee gaan: de caches van de webview ([`OVERGESLAGEN_MAPPEN`]; samen
//!   al gauw honderden MB die de webview zelf opnieuw opbouwt), de
//!   lockbestanden van WebView2 en LevelDB ([`OVERGESLAGEN_BESTANDEN`]),
//!   achtergebleven kopieën `EBWebView.*` en het vindbestand van het
//!   bedieningskanaal (`gui-control.json`, dat bij één draaiend proces hoort).
//! * Een bestand dat niet te lezen is (bijvoorbeeld vergrendeld door een
//!   draaiende oude versie) wordt overgeslagen en in de uitkomst genoemd; de
//!   rest gaat door. Een volle schijf breekt de overname af.
//!
//! De aanroep staat in `src-tauri/src/main.rs`, vóór `run()`: de webview
//! opent zijn gegevensmap bij het starten, de plugin-store leest zijn bestand
//! bij het eerste gebruik.

use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// De identifier tot en met uitgave 2026.39.1.
pub const OUDE_IDENTIFIER: &str = "org.openaec.fem2d-studio";

/// De identifier van deze uitgave. Moet gelijk zijn aan `identifier` in
/// `src-tauri/tauri.conf.json`; een test bewaakt dat.
pub const NIEUWE_IDENTIFIER: &str = "org.openaec.fem-studio";

/// Mapnamen die op elke diepte overgeslagen worden: caches van de webview.
pub const OVERGESLAGEN_MAPPEN: &[&str] = &[
    "Cache",
    "Code Cache",
    "GPUCache",
    "GPUPersistentCache",
    "GrShaderCache",
    "GraphiteDawnCache",
    "ShaderCache",
    "DawnCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "component_crx_cache",
    "extensions_crx_cache",
    "Crashpad",
];

/// Bestandsnamen die op elke diepte overgeslagen worden: lockbestanden. De
/// webview en LevelDB maken ze zelf opnieuw aan.
pub const OVERGESLAGEN_BESTANDEN: &[&str] = &["lockfile", "LOCK"];

/// Eén over te nemen map.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mappaar {
    pub oud: PathBuf,
    pub nieuw: PathBuf,
}

/// Wat [`neem_over`] deed.
#[derive(Debug, PartialEq, Eq)]
pub enum Uitkomst {
    /// De nieuwe map bestond al; er is niets gekopieerd.
    NieuweBestaatAl,
    /// Er is geen oude map; er was niets over te nemen.
    GeenOudeMap,
    /// Overgenomen.
    Overgenomen {
        /// Aantal gekopieerde bestanden.
        bestanden: usize,
        /// Wat niet gekopieerd kon worden, met de reden.
        overgeslagen: Vec<(PathBuf, String)>,
    },
}

/// De basismappen van dit platform waarin Tauri en de webview een submap per
/// identifier maken. Dezelfde bron als `tauri::path` (dirs 6): data-, lokale
/// data- en configuratiemap, en op macOS de WebKit-map.
pub fn basismappen() -> Vec<PathBuf> {
    #[allow(unused_mut)]
    let mut uit: Vec<PathBuf> = [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir()]
        .into_iter()
        .flatten()
        .collect();
    #[cfg(target_os = "macos")]
    if let Some(thuis) = dirs::home_dir() {
        uit.push(thuis.join("Library").join("WebKit"));
    }
    uit
}

/// De mapparen voor deze identifiers in de gegeven basismappen, zonder
/// dubbelen (op macOS vallen data-, lokale data- en configuratiemap samen, op
/// Windows data- en configuratiemap).
pub fn mapparen(basissen: &[PathBuf], oud: &str, nieuw: &str) -> Vec<Mappaar> {
    let mut uit: Vec<Mappaar> = Vec::new();
    for basis in basissen {
        let paar = Mappaar {
            oud: basis.join(oud),
            nieuw: basis.join(nieuw),
        };
        if !uit.contains(&paar) {
            uit.push(paar);
        }
    }
    uit
}

/// Neemt één map over, als de nieuwe nog niet bestaat en de oude wel.
pub fn neem_over(paar: &Mappaar) -> io::Result<Uitkomst> {
    if paar.nieuw.exists() {
        return Ok(Uitkomst::NieuweBestaatAl);
    }
    if !paar.oud.is_dir() {
        return Ok(Uitkomst::GeenOudeMap);
    }
    let naam = paar
        .nieuw
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "nieuwe map zonder naam"))?;
    let mut tijdelijke_naam = naam.to_os_string();
    tijdelijke_naam.push(format!(".migratie-{}", std::process::id()));
    let tijdelijk = paar.nieuw.with_file_name(tijdelijke_naam);
    // Een restant van een onderbroken poging van een proces met hetzelfde
    // nummer. Een andere instantie die nu kopieert, gebruikt haar eigen naam.
    if tijdelijk.exists() {
        fs::remove_dir_all(&tijdelijk)?;
    }

    let mut verslag = Verslag::default();
    if let Err(e) = kopieer_map(&paar.oud, &tijdelijk, true, &mut verslag) {
        let _ = fs::remove_dir_all(&tijdelijk);
        return Err(e);
    }
    match fs::rename(&tijdelijk, &paar.nieuw) {
        Ok(()) => Ok(Uitkomst::Overgenomen {
            bestanden: verslag.bestanden,
            overgeslagen: verslag.overgeslagen,
        }),
        Err(e) => {
            let _ = fs::remove_dir_all(&tijdelijk);
            // Een tweede instantie die tegelijk startte, was eerder klaar.
            if paar.nieuw.exists() {
                Ok(Uitkomst::NieuweBestaatAl)
            } else {
                Err(e)
            }
        }
    }
}

/// Neemt de app-datamappen van [`OUDE_IDENTIFIER`] over naar
/// [`NIEUWE_IDENTIFIER`], in alle [`basismappen`]. Niets hiervan is fataal:
/// de app start hoe dan ook. De uitkomst gaat naar stderr (alleen te zien in
/// een debug-build met console) en wordt teruggegeven.
pub fn neem_oude_appdata_over() -> Vec<(Mappaar, io::Result<Uitkomst>)> {
    mapparen(&basismappen(), OUDE_IDENTIFIER, NIEUWE_IDENTIFIER)
        .into_iter()
        .map(|paar| {
            let uitkomst = neem_over(&paar);
            match &uitkomst {
                Ok(Uitkomst::Overgenomen { bestanden, overgeslagen }) => {
                    eprintln!(
                        "[appdata-migratie] {} -> {}: {bestanden} bestanden overgenomen",
                        paar.oud.display(),
                        paar.nieuw.display()
                    );
                    for (pad, reden) in overgeslagen {
                        eprintln!("[appdata-migratie]   overgeslagen: {} ({reden})", pad.display());
                    }
                }
                Ok(_) => {}
                Err(e) => eprintln!(
                    "[appdata-migratie] {} -> {} mislukt: {e}",
                    paar.oud.display(),
                    paar.nieuw.display()
                ),
            }
            (paar, uitkomst)
        })
        .collect()
}

#[derive(Default)]
struct Verslag {
    bestanden: usize,
    overgeslagen: Vec<(PathBuf, String)>,
}

/// Gaat dit item niet mee? `bovenaan`: het staat direct in de identifier-map.
fn sla_over(naam: &OsStr, is_map: bool, bovenaan: bool) -> bool {
    let Some(naam) = naam.to_str() else {
        return false;
    };
    if bovenaan && (naam == "gui-control.json" || naam.starts_with("EBWebView.")) {
        return true;
    }
    if is_map {
        OVERGESLAGEN_MAPPEN.contains(&naam)
    } else {
        OVERGESLAGEN_BESTANDEN.contains(&naam)
    }
}

/// Kopieert `van` naar `naar`, dat nog niet mag bestaan. Wat in de bron niet
/// te lezen is, komt in het verslag en de rest gaat door; een fout bij het
/// aanmaken van een map of een volle schijf breekt af.
fn kopieer_map(van: &Path, naar: &Path, bovenaan: bool, verslag: &mut Verslag) -> io::Result<()> {
    fs::create_dir(naar)?;
    let items = match fs::read_dir(van) {
        Ok(items) => items,
        Err(e) => {
            verslag.overgeslagen.push((van.to_path_buf(), e.to_string()));
            return Ok(());
        }
    };
    for item in items {
        let item = match item {
            Ok(item) => item,
            Err(e) => {
                verslag.overgeslagen.push((van.to_path_buf(), e.to_string()));
                continue;
            }
        };
        let bron = item.path();
        let soort = match item.file_type() {
            Ok(soort) => soort,
            Err(e) => {
                verslag.overgeslagen.push((bron, e.to_string()));
                continue;
            }
        };
        if sla_over(&item.file_name(), soort.is_dir(), bovenaan) {
            continue;
        }
        let doel = naar.join(item.file_name());
        if soort.is_dir() {
            kopieer_map(&bron, &doel, false, verslag)?;
        } else if soort.is_file() {
            match fs::copy(&bron, &doel) {
                Ok(_) => verslag.bestanden += 1,
                Err(e) if e.kind() == io::ErrorKind::StorageFull => return Err(e),
                Err(e) => {
                    let _ = fs::remove_file(&doel);
                    verslag.overgeslagen.push((bron, e.to_string()));
                }
            }
        } else {
            // Symbolische koppelingen en dergelijke: niet volgen.
            verslag.overgeslagen.push((bron, "geen gewoon bestand of map".into()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static TELLER: AtomicUsize = AtomicUsize::new(0);

    /// Een lege werkmap per test, onder de tijdelijke map van het systeem.
    fn werkmap(naam: &str) -> PathBuf {
        let pad = std::env::temp_dir().join(format!(
            "appdata-migratie-{naam}-{}-{}",
            std::process::id(),
            TELLER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&pad);
        fs::create_dir_all(&pad).unwrap();
        pad
    }

    fn schrijf(pad: &Path, inhoud: &str) {
        fs::create_dir_all(pad.parent().unwrap()).unwrap();
        fs::write(pad, inhoud).unwrap();
    }

    fn lees(pad: &Path) -> String {
        fs::read_to_string(pad).unwrap()
    }

    /// Alle bestanden onder `map`, relatief en met `/`, gesorteerd.
    fn inhoud(map: &Path) -> Vec<String> {
        fn loop_door(basis: &Path, map: &Path, uit: &mut Vec<String>) {
            for item in fs::read_dir(map).unwrap() {
                let pad = item.unwrap().path();
                if pad.is_dir() {
                    loop_door(basis, &pad, uit);
                } else {
                    let rel = pad.strip_prefix(basis).unwrap();
                    uit.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        let mut uit = Vec::new();
        loop_door(map, map, &mut uit);
        uit.sort();
        uit
    }

    /// Een oude identifier-map zoals 2026.39.1 hem achterlaat (Roaming en
    /// Local hier samen in één map).
    fn oude_map(basis: &Path) -> PathBuf {
        let oud = basis.join(OUDE_IDENTIFIER);
        schrijf(
            &oud.join("preferences.json"),
            r#"{"recentFiles":[{"path":"C:/werk/hal.ifcfem"}],"theme":"openaec"}"#,
        );
        schrijf(&oud.join("EBWebView/Default/Local Storage/leveldb/000003.log"), "localStorage");
        schrijf(&oud.join("EBWebView/Default/Local Storage/leveldb/CURRENT"), "MANIFEST-000001");
        schrijf(&oud.join("EBWebView/Default/Local Storage/leveldb/LOCK"), "");
        schrijf(&oud.join("EBWebView/Default/Preferences"), "{}");
        schrijf(&oud.join("EBWebView/Default/Cache/Cache_Data/data_0"), "cache");
        schrijf(&oud.join("EBWebView/Default/Code Cache/js/index"), "cache");
        schrijf(&oud.join("EBWebView/GrShaderCache/data_0"), "cache");
        schrijf(&oud.join("EBWebView/lockfile"), "");
        schrijf(&oud.join("EBWebView/Local State"), "{}");
        schrijf(&oud.join("EBWebView.stale-180433/Default/Preferences"), "achtergebleven");
        schrijf(&oud.join("gui-control.json"), r#"{"pid":1,"poort":1,"token":"x"}"#);
        oud
    }

    fn paar(basis: &Path) -> Mappaar {
        Mappaar {
            oud: basis.join(OUDE_IDENTIFIER),
            nieuw: basis.join(NIEUWE_IDENTIFIER),
        }
    }

    #[test]
    fn neemt_de_oude_map_over_zonder_caches_locks_en_restanten() {
        let basis = werkmap("over");
        oude_map(&basis);
        let p = paar(&basis);

        let uitkomst = neem_over(&p).unwrap();
        assert_eq!(
            uitkomst,
            Uitkomst::Overgenomen { bestanden: 5, overgeslagen: vec![] }
        );
        assert_eq!(
            inhoud(&p.nieuw),
            vec![
                "EBWebView/Default/Local Storage/leveldb/000003.log",
                "EBWebView/Default/Local Storage/leveldb/CURRENT",
                "EBWebView/Default/Preferences",
                "EBWebView/Local State",
                "preferences.json",
            ]
        );
        assert_eq!(
            lees(&p.nieuw.join("preferences.json")),
            r#"{"recentFiles":[{"path":"C:/werk/hal.ifcfem"}],"theme":"openaec"}"#
        );
        assert_eq!(
            lees(&p.nieuw.join("EBWebView/Default/Local Storage/leveldb/000003.log")),
            "localStorage"
        );
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn kopieert_en_laat_de_oude_map_ongemoeid() {
        let basis = werkmap("kopie");
        oude_map(&basis);
        let p = paar(&basis);
        let voor = inhoud(&p.oud);
        neem_over(&p).unwrap();
        assert_eq!(inhoud(&p.oud), voor, "de oude map is veranderd");
        assert_eq!(lees(&p.oud.join("gui-control.json")), r#"{"pid":1,"poort":1,"token":"x"}"#);
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn bestaat_de_nieuwe_map_al_dan_gebeurt_er_niets() {
        let basis = werkmap("bestaat");
        oude_map(&basis);
        let p = paar(&basis);
        fs::create_dir_all(&p.nieuw).unwrap();
        assert_eq!(neem_over(&p).unwrap(), Uitkomst::NieuweBestaatAl);
        assert!(inhoud(&p.nieuw).is_empty(), "er is toch iets gekopieerd");
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn zonder_oude_map_gebeurt_er_niets() {
        let basis = werkmap("geenoud");
        let p = paar(&basis);
        assert_eq!(neem_over(&p).unwrap(), Uitkomst::GeenOudeMap);
        assert!(!p.nieuw.exists());
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn een_tweede_start_doet_niets_en_laat_geen_tijdelijke_map_achter() {
        let basis = werkmap("tweede");
        oude_map(&basis);
        let p = paar(&basis);
        neem_over(&p).unwrap();
        // Wat de nieuwe versie daarna schrijft, blijft staan.
        schrijf(&p.nieuw.join("preferences.json"), r#"{"theme":"light"}"#);
        assert_eq!(neem_over(&p).unwrap(), Uitkomst::NieuweBestaatAl);
        assert_eq!(lees(&p.nieuw.join("preferences.json")), r#"{"theme":"light"}"#);
        let namen: Vec<String> = fs::read_dir(&basis)
            .unwrap()
            .map(|i| i.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            namen.iter().all(|n| !n.contains(".migratie-")),
            "tijdelijke map achtergebleven: {namen:?}"
        );
        fs::remove_dir_all(&basis).unwrap();
    }

    #[test]
    fn mapparen_zonder_dubbelen() {
        let a = PathBuf::from("basis-a");
        let b = PathBuf::from("basis-b");
        let paren = mapparen(&[a.clone(), b.clone(), a.clone()], "oud.id", "nieuw.id");
        assert_eq!(
            paren,
            vec![
                Mappaar { oud: a.join("oud.id"), nieuw: a.join("nieuw.id") },
                Mappaar { oud: b.join("oud.id"), nieuw: b.join("nieuw.id") },
            ]
        );
    }

    #[test]
    fn basismappen_zijn_die_van_tauri() {
        let basissen = basismappen();
        for verwacht in [dirs::data_dir(), dirs::data_local_dir(), dirs::config_dir()]
            .into_iter()
            .flatten()
        {
            assert!(basissen.contains(&verwacht), "{} ontbreekt", verwacht.display());
        }
    }

    #[test]
    fn de_nieuwe_identifier_is_die_van_tauri_conf() {
        let tauri = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
        let conf: serde_json::Value =
            serde_json::from_str(&lees(&tauri.join("tauri.conf.json"))).unwrap();
        assert_eq!(conf["identifier"], NIEUWE_IDENTIFIER);
        // Een platformconfiguratie mag de identifier niet anders zetten.
        for naam in ["tauri.windows.conf.json", "tauri.macos.conf.json", "tauri.linux.conf.json"] {
            let pad = tauri.join(naam);
            if pad.exists() {
                let conf: serde_json::Value = serde_json::from_str(&lees(&pad)).unwrap();
                assert!(
                    conf.get("identifier").is_none() || conf["identifier"] == NIEUWE_IDENTIFIER,
                    "{naam} zet een andere identifier"
                );
            }
        }
        assert_ne!(OUDE_IDENTIFIER, NIEUWE_IDENTIFIER);
    }

    /// Een draaiende oude versie houdt bestanden open. Zo'n bestand wordt
    /// overgeslagen en genoemd; de rest komt gewoon over.
    #[cfg(windows)]
    #[test]
    fn een_vergrendeld_bestand_wordt_overgeslagen_en_de_rest_komt_over() {
        use std::os::windows::fs::OpenOptionsExt;
        let basis = werkmap("vergrendeld");
        oude_map(&basis);
        let p = paar(&basis);
        let vast = p.oud.join("EBWebView/Default/Preferences");
        let _slot = fs::OpenOptions::new().read(true).share_mode(0).open(&vast).unwrap();

        match neem_over(&p).unwrap() {
            Uitkomst::Overgenomen { bestanden, overgeslagen } => {
                assert_eq!(bestanden, 4);
                assert_eq!(overgeslagen.len(), 1, "{overgeslagen:?}");
                assert_eq!(overgeslagen[0].0, vast);
            }
            anders => panic!("verwacht Overgenomen, kreeg {anders:?}"),
        }
        assert!(p.nieuw.join("preferences.json").exists());
        assert!(!p.nieuw.join("EBWebView/Default/Preferences").exists());
        drop(_slot);
        fs::remove_dir_all(&basis).unwrap();
    }
}
