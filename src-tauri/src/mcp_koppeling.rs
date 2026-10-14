//! `mcp_koppeling` — een AI-assistent aan de app koppelen (issue #109).
//!
//! Het paneel Instellingen → AI-assistent (MCP) laat zien waar de
//! meegeleverde MCP-server staat, en zet hem op een klik in de config van
//! Claude Desktop. De opdracht voor Claude Code en het JSON-fragment voor
//! andere clients bouwt de pagina zelf uit het pad
//! (`design-mockup/src/lib/mcpKoppeling.ts`).
//!
//! # De server vinden
//!
//! De installer zet `openaec-mcp-server(.exe)` naast de app-exe
//! (`bundle.externalBin`, tauri.bundel.conf.json). In een ontwikkelbuild
//! staat hij in `src-tauri/target/{release,debug}` of als sidecarkopie in
//! `src-tauri/binaries/` (`scripts/mcp-sidecar.mjs`); die plekken worden
//! alleen in een debugbuild bekeken. Het paneel toont wat er werkelijk is, en
//! anders waar gezocht is.
//!
//! # Claude Desktop veilig bijwerken
//!
//! `claude_desktop_config.json` is van de gebruiker en draagt ook andere
//! servers en instellingen. Daarom:
//! * alleen na een klik op de knop (het commando `mcp_claude_desktop_toevoegen`);
//! * in Rust en niet via de fs-plugin: de pagina krijgt er geen ruimer
//!   bestandsbereik voor;
//! * de JSON wordt gelezen met behoud van de volgorde van elke sleutel en
//!   teruggeschreven met dezelfde inspringing, regeleinden en
//!   byte-order-mark; alleen de regel `open-fem-studio` in `mcpServers` komt
//!   erbij of wordt bijgewerkt (`command`, `args`; wat de gebruiker er zelf
//!   bij zette, zoals `env`, blijft);
//! * ongeldige JSON wordt geweigerd met de plek van de fout, en het bestand
//!   blijft onaangeroerd; de weigering draagt een vaste foutcode
//!   (`ONGELDIGE_JSON`, met regel en kolom), zodat het paneel haar in de taal
//!   van de gebruiker toont (zie [`KoppelFout`]);
//! * vóór elke wijziging een reservekopie `claude_desktop_config.json.<JJJJMMDD-UUMMSS>.bak`
//!   (UTC) naast het origineel; is er niets te wijzigen, dan geen kopie en
//!   geen schrijfactie;
//! * schrijven via een tijdelijk bestand en hernoemen.
//!
//! Een andere regel die dezelfde server start (bijvoorbeeld een oude
//! `openaec-fem`), wordt gemeld en niet aangeraakt: Claude Desktop zou de
//! tools anders twee keer tonen, maar wat de gebruiker zelf schreef, is niet
//! van ons om weg te halen.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// De naam van de regel in `mcpServers`, en in `claude mcp add`.
pub const SERVERNAAM: &str = "open-fem-studio";

/// `openaec-mcp-server` met de exe-extensie van het platform.
pub fn server_bestandsnaam() -> String {
    format!("openaec-mcp-server{}", std::env::consts::EXE_SUFFIX)
}

// ── De server vinden ────────────────────────────────────────────────────────

/// Waar de server kan staan, in volgorde: naast de app-exe (de installatie),
/// en met een bronmap (alleen in een debugbuild) ook de releasebuild naast
/// de debugbuild, `target/{release,debug}` in de bronmap en de sidecarkopieën
/// in `binaries/`.
pub fn kandidaten(app_exe: &Path, bronmap: Option<&Path>) -> Vec<PathBuf> {
    let naam = server_bestandsnaam();
    let mut uit = Vec::new();
    let exe_map = app_exe.parent().map(Path::to_path_buf).unwrap_or_default();
    uit.push(exe_map.join(&naam));
    if let Some(bron) = bronmap {
        if let Some(profielen) = exe_map.parent() {
            uit.push(profielen.join("release").join(&naam));
            uit.push(profielen.join("debug").join(&naam));
        }
        uit.push(bron.join("target").join("release").join(&naam));
        uit.push(bron.join("target").join("debug").join(&naam));
        let mut sidecars: Vec<PathBuf> = fs::read_dir(bron.join("binaries"))
            .map(|d| {
                d.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .filter(|p| {
                        let n = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                        n.starts_with("openaec-mcp-server-") && n.ends_with(std::env::consts::EXE_SUFFIX)
                    })
                    .collect()
            })
            .unwrap_or_default();
        sidecars.sort();
        uit.extend(sidecars);
    }
    let mut gezien = std::collections::HashSet::new();
    uit.retain(|p| gezien.insert(p.clone()));
    uit
}

/// De eerste kandidaat die een bestand is.
pub fn zoek_server(kandidaten: &[PathBuf]) -> Option<PathBuf> {
    kandidaten.iter().find(|p| p.is_file()).cloned()
}

/// De bronmap van de app-crate, alleen in een debugbuild: een releasebuild
/// draagt geen pad van de bouwmachine mee.
#[cfg(debug_assertions)]
fn bronmap() -> Option<PathBuf> {
    Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

#[cfg(not(debug_assertions))]
fn bronmap() -> Option<PathBuf> {
    None
}

/// Waar Claude Desktop zijn config leest: Windows `%APPDATA%\Claude`, macOS
/// `~/Library/Application Support/Claude`, Linux `$XDG_CONFIG_HOME/Claude`
/// (anders `~/.config/Claude`). Zonder de nodige variabele: `None`, geen gok.
pub fn claude_desktop_config_pad(
    os: &str,
    appdata: Option<&str>,
    home: Option<&str>,
    xdg_config: Option<&str>,
) -> Option<PathBuf> {
    let niet_leeg = |s: Option<&str>| s.filter(|v| !v.trim().is_empty()).map(PathBuf::from);
    let map = match os {
        "windows" => niet_leeg(appdata)?.join("Claude"),
        "macos" => niet_leeg(home)?.join("Library").join("Application Support").join("Claude"),
        _ => match niet_leeg(xdg_config) {
            Some(x) => x.join("Claude"),
            None => niet_leeg(home)?.join(".config").join("Claude"),
        },
    };
    Some(map.join("claude_desktop_config.json"))
}

fn claude_desktop_config_hier() -> Option<PathBuf> {
    let var = |n: &str| std::env::var(n).ok();
    claude_desktop_config_pad(
        std::env::consts::OS,
        var("APPDATA").as_deref(),
        var("HOME").as_deref(),
        var("XDG_CONFIG_HOME").as_deref(),
    )
}

/// Wat het paneel nodig heeft.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KoppelInfo {
    /// Het pad van de server, als hij gevonden is.
    pub server_pad: Option<String>,
    /// Waar gezocht is (voor de melding als hij ontbreekt).
    pub gezocht: Vec<String>,
    /// Waar de config van Claude Desktop staat (of zou staan).
    pub claude_desktop_config: Option<String>,
    pub claude_desktop_config_bestaat: bool,
    pub servernaam: String,
}

pub fn info() -> KoppelInfo {
    let exe = std::env::current_exe().unwrap_or_default();
    let lijst = kandidaten(&exe, bronmap().as_deref());
    let server = zoek_server(&lijst);
    let config = claude_desktop_config_hier();
    KoppelInfo {
        server_pad: server.map(|p| p.to_string_lossy().into_owned()),
        gezocht: lijst.iter().map(|p| p.to_string_lossy().into_owned()).collect(),
        claude_desktop_config_bestaat: config.as_deref().is_some_and(Path::is_file),
        claude_desktop_config: config.map(|p| p.to_string_lossy().into_owned()),
        servernaam: SERVERNAAM.into(),
    }
}

// ── JSON met behoud van de volgorde ─────────────────────────────────────────

/// Een JSON-waarde waarin een object zijn sleutels in de volgorde van het
/// bestand houdt. `serde_json::Value` sorteert ze (zonder de feature
/// `preserve_order`, en die feature zou via de feature-unificatie de
/// JSON-uitvoer van de hele workspace veranderen).
#[derive(Clone, Debug, PartialEq)]
enum Json {
    Null,
    Bool(bool),
    Getal(serde_json::Number),
    Tekst(String),
    Lijst(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct Bezoeker;
        impl<'de> Visitor<'de> for Bezoeker {
            type Value = Json;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("een JSON-waarde")
            }
            fn visit_unit<E>(self) -> Result<Json, E> {
                Ok(Json::Null)
            }
            fn visit_none<E>(self) -> Result<Json, E> {
                Ok(Json::Null)
            }
            fn visit_bool<E>(self, v: bool) -> Result<Json, E> {
                Ok(Json::Bool(v))
            }
            fn visit_i64<E>(self, v: i64) -> Result<Json, E> {
                Ok(Json::Getal(v.into()))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Json, E> {
                Ok(Json::Getal(v.into()))
            }
            fn visit_f64<E: de::Error>(self, v: f64) -> Result<Json, E> {
                serde_json::Number::from_f64(v)
                    .map(Json::Getal)
                    .ok_or_else(|| E::custom("getal buiten bereik"))
            }
            fn visit_str<E>(self, v: &str) -> Result<Json, E> {
                Ok(Json::Tekst(v.to_owned()))
            }
            fn visit_string<E>(self, v: String) -> Result<Json, E> {
                Ok(Json::Tekst(v))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut s: A) -> Result<Json, A::Error> {
                let mut uit = Vec::new();
                while let Some(w) = s.next_element()? {
                    uit.push(w);
                }
                Ok(Json::Lijst(uit))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Json, A::Error> {
                let mut uit = Vec::new();
                while let Some((k, w)) = m.next_entry::<String, Json>()? {
                    uit.push((k, w));
                }
                Ok(Json::Object(uit))
            }
        }
        d.deserialize_any(Bezoeker)
    }
}

impl Serialize for Json {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Json::Null => s.serialize_unit(),
            Json::Bool(b) => s.serialize_bool(*b),
            Json::Getal(n) => n.serialize(s),
            Json::Tekst(t) => s.serialize_str(t),
            Json::Lijst(l) => {
                let mut seq = s.serialize_seq(Some(l.len()))?;
                for w in l {
                    seq.serialize_element(w)?;
                }
                seq.end()
            }
            Json::Object(o) => {
                let mut map = s.serialize_map(Some(o.len()))?;
                for (k, w) in o {
                    map.serialize_entry(k, w)?;
                }
                map.end()
            }
        }
    }
}

/// De inspringing van een pretty-printed bestand: de witruimte vóór de eerste
/// ingesprongen regel (dat is het eerste niveau). Twee spaties als er geen is.
fn inspringing(tekst: &str) -> String {
    for regel in tekst.lines().skip(1) {
        let wit: String = regel.chars().take_while(|c| *c == ' ' || *c == '\t').collect();
        if wit.is_empty() || regel.trim().is_empty() {
            continue;
        }
        if wit.chars().all(|c| c == '\t') {
            return "\t".into();
        }
        if wit.chars().all(|c| c == ' ') && wit.len() <= 8 {
            return wit;
        }
        break;
    }
    "  ".into()
}

/// Is dit hetzelfde pad? Een Windows-pad (schuine streep terug of een
/// stationsletter) hoofdletterongevoelig en met beide scheidingstekens.
fn zelfde_pad(a: &str, b: &str) -> bool {
    let windows = |s: &str| s.contains('\\') || s.as_bytes().get(1) == Some(&b':');
    if windows(a) || windows(b) {
        let norm = |s: &str| s.replace('/', "\\").to_lowercase();
        norm(a) == norm(b)
    } else {
        a == b
    }
}

/// Zet `sleutel` op `waarde` in een object (elke keer dat de sleutel
/// voorkomt), of voeg hem achteraan toe. `true` als er iets veranderde.
fn zet(object: &mut Vec<(String, Json)>, sleutel: &str, waarde: Json) -> bool {
    let mut gevonden = false;
    let mut veranderd = false;
    for (k, w) in object.iter_mut() {
        if k == sleutel {
            gevonden = true;
            if *w != waarde {
                *w = waarde.clone();
                veranderd = true;
            }
        }
    }
    if !gevonden {
        object.push((sleutel.to_owned(), waarde));
        veranderd = true;
    }
    veranderd
}

// ── Weigeringen ─────────────────────────────────────────────────────────────

/// De foutcode van een config die geen geldige JSON is.
pub const ONGELDIGE_JSON: &str = "ONGELDIGE_JSON";
/// De foutcode van elke andere weigering; de reden staat in `melding`.
pub const MISLUKT: &str = "MISLUKT";

/// Waarom de knop "Toevoegen aan Claude Desktop" niets deed. `code` is vast,
/// zodat het paneel de melding in de taal van de gebruiker kan tonen:
/// [`ONGELDIGE_JSON`] (met `regel` en `kolom`) of [`MISLUKT`]. `melding` is
/// altijd de volledige Nederlandse tekst — de terugval van het paneel, en wat
/// in een log hoort.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KoppelFout {
    pub code: String,
    pub melding: String,
    /// Het configbestand, als de fout daarover gaat.
    pub config: Option<String>,
    pub regel: Option<usize>,
    pub kolom: Option<usize>,
}

impl KoppelFout {
    fn mislukt(melding: impl Into<String>) -> Self {
        KoppelFout { code: MISLUKT.into(), melding: melding.into(), config: None, regel: None, kolom: None }
    }

    /// Een fout van serde_json als weigering: de soort in het Nederlands, en
    /// de plek één keer (niet ook nog de Engelse tekst van serde_json, die de
    /// plek zelf al noemt).
    fn ongeldige_json(e: &serde_json::Error) -> Self {
        use serde_json::error::Category;
        let soort = match e.classify() {
            Category::Syntax => "syntaxfout",
            Category::Eof => "onverwacht einde",
            Category::Data => "ongeldige waarde",
            Category::Io => "leesfout",
        };
        KoppelFout {
            code: ONGELDIGE_JSON.into(),
            melding: format!(
                "het bestand is geen geldige JSON ({soort} op regel {}, kolom {})",
                e.line(),
                e.column()
            ),
            config: None,
            regel: Some(e.line()),
            kolom: Some(e.column()),
        }
    }

    /// Dezelfde weigering, over het bestand `config`, dat niet gewijzigd is.
    fn over_bestand(self, config: &Path) -> Self {
        KoppelFout {
            melding: format!("{}: {} — het bestand is niet gewijzigd", config.display(), self.melding),
            config: Some(config.to_string_lossy().into_owned()),
            ..self
        }
    }
}

impl std::fmt::Display for KoppelFout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.melding)
    }
}

impl From<String> for KoppelFout {
    fn from(melding: String) -> Self {
        KoppelFout::mislukt(melding)
    }
}

impl From<&str> for KoppelFout {
    fn from(melding: &str) -> Self {
        KoppelFout::mislukt(melding)
    }
}

// ── Samenvoegen ─────────────────────────────────────────────────────────────

/// Wat er met de config gebeurde.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Soort {
    /// Het bestand bestond niet.
    Aangemaakt,
    /// Onze regel kwam erbij.
    Toegevoegd,
    /// Onze regel stond er al, met een ander pad of andere `args`.
    Bijgewerkt,
    /// Onze regel stond er al precies zo.
    Ongewijzigd,
}

impl Soort {
    pub fn als_tekst(self) -> &'static str {
        match self {
            Soort::Aangemaakt => "aangemaakt",
            Soort::Toegevoegd => "toegevoegd",
            Soort::Bijgewerkt => "bijgewerkt",
            Soort::Ongewijzigd => "ongewijzigd",
        }
    }
}

/// De nieuwe tekst van de config.
#[derive(Debug, Clone)]
pub struct Samenvoeging {
    pub tekst: String,
    pub soort: Soort,
    /// Andere regels in `mcpServers` die dezelfde server starten.
    pub dubbel: Vec<String>,
}

/// Voeg de regel `naam` (`{command: server, args: []}`) toe aan de tekst van
/// een config, of werk hem bij. `None` = het bestand bestaat niet.
pub fn voeg_toe(inhoud: Option<&str>, naam: &str, server: &str) -> Result<Samenvoeging, KoppelFout> {
    let tekst = inhoud.unwrap_or("");
    let bom = tekst.starts_with('\u{feff}');
    let kern = tekst.trim_start_matches('\u{feff}');
    let leeg = kern.trim().is_empty();
    let crlf = kern.contains("\r\n");
    let regeleinde_aan_het_eind = leeg || kern.ends_with('\n');

    let mut wortel = if leeg {
        Json::Object(Vec::new())
    } else {
        serde_json::from_str::<Json>(kern).map_err(|e| KoppelFout::ongeldige_json(&e))?
    };
    let Json::Object(velden) = &mut wortel else {
        return Err("het bestand bevat geen JSON-object op het hoogste niveau".into());
    };
    // Komt `mcpServers` vaker voor, dan telt (zoals in elke JSON-lezer) de laatste.
    let plek = match velden.iter().rposition(|(k, _)| k == "mcpServers") {
        Some(i) => i,
        None => {
            velden.push(("mcpServers".into(), Json::Object(Vec::new())));
            velden.len() - 1
        }
    };
    let Json::Object(servers) = &mut velden[plek].1 else {
        return Err("`mcpServers` in het bestand is geen object".into());
    };

    let dubbel: Vec<String> = servers
        .iter()
        .filter(|(k, w)| {
            k != naam
                && matches!(w, Json::Object(o) if o.iter().any(|(ck, cw)| ck == "command"
                    && matches!(cw, Json::Tekst(c) if zelfde_pad(c, server))))
        })
        .map(|(k, _)| k.clone())
        .collect();

    let regel = || Json::Object(vec![
        ("command".into(), Json::Tekst(server.into())),
        ("args".into(), Json::Lijst(Vec::new())),
    ]);
    let soort = if servers.iter().any(|(k, _)| k == naam) {
        let mut veranderd = false;
        for (k, w) in servers.iter_mut().filter(|(k, _)| k == naam) {
            let Json::Object(o) = w else {
                return Err(format!("de regel `{k}` in `mcpServers` is geen object").into());
            };
            veranderd |= zet(o, "command", Json::Tekst(server.into()));
            veranderd |= zet(o, "args", Json::Lijst(Vec::new()));
        }
        if veranderd { Soort::Bijgewerkt } else { Soort::Ongewijzigd }
    } else {
        servers.push((naam.into(), regel()));
        if inhoud.is_none() { Soort::Aangemaakt } else { Soort::Toegevoegd }
    };

    if soort == Soort::Ongewijzigd {
        return Ok(Samenvoeging { tekst: tekst.to_owned(), soort, dubbel });
    }

    let ind = inspringing(kern);
    let mut buf = Vec::new();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(ind.as_bytes());
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    wortel.serialize(&mut ser).map_err(|e| KoppelFout::mislukt(format!("JSON schrijven: {e}")))?;
    let mut nieuw = String::from_utf8(buf).expect("serde_json schrijft UTF-8");
    if regeleinde_aan_het_eind {
        nieuw.push('\n');
    }
    // Een regeleinde binnen een JSON-tekst staat altijd als \n geschreven, dus
    // elke echte LF hier is een regeleinde van de opmaak.
    if crlf {
        nieuw = nieuw.replace('\n', "\r\n");
    }
    if bom {
        nieuw.insert(0, '\u{feff}');
    }
    Ok(Samenvoeging { tekst: nieuw, soort, dubbel })
}

// ── Het bestand ─────────────────────────────────────────────────────────────

/// Wat de knop "Toevoegen aan Claude Desktop" deed.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KoppelUitkomst {
    pub config: String,
    /// `aangemaakt`, `toegevoegd`, `bijgewerkt` of `ongewijzigd`.
    pub soort: String,
    pub reservekopie: Option<String>,
    /// De map van Claude Desktop bestond nog niet (is Claude Desktop wel geïnstalleerd?).
    pub map_aangemaakt: bool,
    pub dubbel: Vec<String>,
    pub servernaam: String,
    pub server: String,
}

/// De naam van de reservekopie: `<bestand>.<JJJJMMDD-UUMMSS>.bak` (UTC) ernaast.
pub fn reservekopie_pad(config: &Path, nu: SystemTime) -> PathBuf {
    reservekopie_pad_met(config, nu, 1)
}

fn reservekopie_pad_met(config: &Path, nu: SystemTime, volgnummer: u32) -> PathBuf {
    let naam = config.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let stempel = tijdstempel(nu);
    let extra = if volgnummer > 1 { format!("-{volgnummer}") } else { String::new() };
    config.with_file_name(format!("{naam}.{stempel}{extra}.bak"))
}

/// `JJJJMMDD-UUMMSS` in UTC, zonder datum-crate.
fn tijdstempel(nu: SystemTime) -> String {
    let s = nu.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let (j, m, d) = datum_uit_dagen(s.div_euclid(86_400));
    let r = s.rem_euclid(86_400);
    format!("{j:04}{m:02}{d:02}-{:02}{:02}{:02}", r / 3600, (r % 3600) / 60, r % 60)
}

/// Dagen sinds 1970-01-01 → (jaar, maand, dag) in de gregoriaanse kalender
/// (het algoritme `civil_from_days` van H. Hinnant).
fn datum_uit_dagen(dagen: i64) -> (i64, u32, u32) {
    let z = dagen + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let j = yoe + era * 400 + i64::from(m <= 2);
    (j, m, d)
}

/// Schrijf de originele bytes naar een nieuwe reservekopie; nooit over een
/// bestaande kopie heen.
fn maak_reservekopie(config: &Path, bytes: &[u8], nu: SystemTime) -> Result<PathBuf, String> {
    for volgnummer in 1..=100 {
        let pad = reservekopie_pad_met(config, nu, volgnummer);
        match fs::OpenOptions::new().write(true).create_new(true).open(&pad) {
            Ok(mut f) => {
                f.write_all(bytes)
                    .and_then(|_| f.sync_all())
                    .map_err(|e| format!("reservekopie {}: {e}", pad.display()))?;
                return Ok(pad);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("reservekopie {}: {e}", pad.display())),
        }
    }
    Err(format!("geen vrije naam voor een reservekopie naast {}", config.display()))
}

/// Voeg de regel toe aan het bestand `config` (zie de moduletekst).
pub fn voeg_toe_aan_bestand(config: &Path, naam: &str, server: &Path, nu: SystemTime) -> Result<KoppelUitkomst, KoppelFout> {
    let server_tekst = server.to_string_lossy().into_owned();
    let bytes = match fs::read(config) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{}: {e}", config.display()).into()),
    };
    let inhoud = match &bytes {
        Some(b) => Some(
            String::from_utf8(b.clone())
                .map_err(|_| KoppelFout::mislukt("geen UTF-8-tekst").over_bestand(config))?,
        ),
        None => None,
    };
    let s = voeg_toe(inhoud.as_deref(), naam, &server_tekst).map_err(|e| e.over_bestand(config))?;
    let mut uitkomst = KoppelUitkomst {
        config: config.to_string_lossy().into_owned(),
        soort: s.soort.als_tekst().into(),
        reservekopie: None,
        map_aangemaakt: false,
        dubbel: s.dubbel.clone(),
        servernaam: naam.into(),
        server: server_tekst,
    };
    if s.soort == Soort::Ongewijzigd {
        return Ok(uitkomst);
    }
    if let Some(map) = config.parent().filter(|m| !m.as_os_str().is_empty()) {
        if !map.is_dir() {
            fs::create_dir_all(map).map_err(|e| format!("{}: {e}", map.display()))?;
            uitkomst.map_aangemaakt = true;
        }
    }
    if let Some(b) = &bytes {
        let kopie = maak_reservekopie(config, b, nu)?;
        uitkomst.reservekopie = Some(kopie.to_string_lossy().into_owned());
    }
    let naam_bestand = config.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tijdelijk = config.with_file_name(format!("{naam_bestand}.{}.tmp", std::process::id()));
    fs::write(&tijdelijk, s.tekst.as_bytes()).map_err(|e| format!("{}: {e}", tijdelijk.display()))?;
    if let Err(e) = fs::rename(&tijdelijk, config) {
        let _ = fs::remove_file(&tijdelijk);
        return Err(format!(
            "{}: {e} — het bestand is niet gewijzigd{}",
            config.display(),
            uitkomst
                .reservekopie
                .as_deref()
                .map(|k| format!(" (de reservekopie {k} blijft staan)"))
                .unwrap_or_default()
        )
        .into());
    }
    Ok(uitkomst)
}

/// De knop "Toevoegen aan Claude Desktop": de gevonden server in de config
/// van Claude Desktop op deze computer.
pub fn voeg_toe_aan_claude_desktop() -> Result<KoppelUitkomst, KoppelFout> {
    let info = info();
    let server = info.server_pad.ok_or_else(|| {
        format!(
            "de MCP-server ({}) is niet gevonden; gezocht in: {}",
            server_bestandsnaam(),
            info.gezocht.join("; ")
        )
    })?;
    let config = claude_desktop_config_hier()
        .ok_or("de map van Claude Desktop is onbekend (de omgevingsvariabele APPDATA of HOME ontbreekt)")?;
    voeg_toe_aan_bestand(&config, SERVERNAAM, Path::new(&server), SystemTime::now())
}
