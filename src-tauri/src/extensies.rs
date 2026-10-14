//! Bestanden voor lokale importextensies. De pagina krijgt alleen manifesten,
//! scripts en bytes van bestandstypen die een ingeschakelde extensie aanbiedt.
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GevondenExtensie {
    pub map: String,
    pub manifest_tekst: Option<String>,
    pub fout: Option<String>,
    pub bron: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    id: String,
    name: String,
    version: String,
    api_version: u8,
    main: String,
    description: Option<String>,
    author: Option<String>,
    category: Option<String>,
    importers: Vec<Importeur>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Importeur {
    id: String,
    label: String,
    file_extensions: Vec<String>,
    dimension: String,
}

fn geldig_naamdeel(tekst: &str) -> bool {
    !tekst.is_empty()
        && tekst.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && tekst
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn keur_manifest(tekst: &str) -> Result<Manifest, String> {
    let manifest: Manifest =
        serde_json::from_str(tekst).map_err(|e| format!("Ongeldig manifest: {e}"))?;
    if !geldige_id(&manifest.id)
        || manifest.name.trim().is_empty()
        || semver::Version::parse(&manifest.version).is_err()
        || manifest.api_version != 1
        || !veilig_zip_pad(Path::new(&manifest.main))
        || manifest.importers.is_empty()
    {
        return Err(
            "Manifest mist een geldige id, naam, versie, apiVersion, main of importeur.".into(),
        );
    }
    let mut ids = HashSet::new();
    for importeur in &manifest.importers {
        if !geldig_naamdeel(&importeur.id)
            || !ids.insert(&importeur.id)
            || importeur.label.trim().is_empty()
            || !matches!(importeur.dimension.as_str(), "2d" | "3d")
            || importeur.file_extensions.is_empty()
            || importeur.file_extensions.iter().any(|type_| {
                type_.is_empty()
                    || !type_
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            })
        {
            return Err(format!(
                "Ongeldige of dubbele importeur {} in het manifest.",
                importeur.id
            ));
        }
    }
    Ok(manifest)
}

fn extensiemap(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions"))
}

fn omgeving_mappen() -> Vec<PathBuf> {
    std::env::var_os("OPENAEC_EXTENSIONS_DIRS")
        .map(|waarde| std::env::split_paths(&waarde).collect())
        .unwrap_or_default()
}

fn lees_een(map: &Path, bron: &str) -> GevondenExtensie {
    let manifest = map.join("extension.json");
    let (manifest_tekst, fout) = match fs::read_to_string(&manifest) {
        Ok(tekst) => match keur_manifest(&tekst) {
            Ok(_) => (Some(tekst), None),
            Err(e) => (None, Some(e)),
        },
        Err(e) => (None, Some(format!("extension.json is niet te lezen: {e}"))),
    };
    GevondenExtensie {
        map: map.to_string_lossy().into_owned(),
        manifest_tekst,
        fout,
        bron: bron.into(),
    }
}

/** Scannen is ook zonder AppHandle te testen. Elke kapotte map blijft zichtbaar. */
pub fn scan_mappen(
    vast: &Path,
    gekoppeld: &[PathBuf],
    omgeving: &[PathBuf],
) -> Result<Vec<GevondenExtensie>, String> {
    let mut gevonden = Vec::new();
    let mut gezien = HashSet::new();
    if vast.exists() {
        for item in fs::read_dir(vast).map_err(|e| format!("Extensiemap is niet te lezen: {e}"))? {
            let item = item.map_err(|e| e.to_string())?;
            if item.file_type().map_err(|e| e.to_string())?.is_dir() {
                let map = item.path();
                if let Ok(pad) = map.canonicalize() {
                    gezien.insert(pad);
                }
                gevonden.push(lees_een(&map, "geinstalleerd"));
            }
        }
    }
    for (mappen, bron) in [(gekoppeld, "gekoppeld"), (omgeving, "omgeving")] {
        for map in mappen {
            let pad = map.canonicalize().unwrap_or_else(|_| map.clone());
            if gezien.insert(pad) {
                gevonden.push(lees_een(map, bron));
            }
        }
    }
    gevonden.sort_by(|a, b| a.map.cmp(&b.map));
    Ok(gevonden)
}

pub fn lees_script(map: &Path, main: &str) -> Result<String, String> {
    let relatief = Path::new(main);
    if main.is_empty()
        || relatief
            .components()
            .any(|deel| !matches!(deel, Component::Normal(_)))
    {
        return Err("Het scriptpad moet binnen de extensiemap liggen.".into());
    }
    let basis = map
        .canonicalize()
        .map_err(|e| format!("Extensiemap is niet te lezen: {e}"))?;
    let script = basis
        .join(relatief)
        .canonicalize()
        .map_err(|e| format!("Extensiescript is niet te lezen: {e}"))?;
    if !script.starts_with(&basis) || !script.is_file() {
        return Err("Het scriptpad ligt buiten de extensiemap of is geen bestand.".into());
    }
    fs::read_to_string(script).map_err(|e| format!("Extensiescript is niet te lezen: {e}"))
}

fn manifest_id_en_types(tekst: &str) -> Option<(String, Vec<String>)> {
    let manifest = keur_manifest(tekst).ok()?;
    Some((
        manifest.id,
        manifest
            .importers
            .into_iter()
            .flat_map(|i| i.file_extensions)
            .collect(),
    ))
}

pub fn lees_importbestand(
    pad: &Path,
    vast: &Path,
    gekoppeld: &[PathBuf],
    omgeving: &[PathBuf],
    ingeschakelde_ids: &[String],
) -> Result<Vec<u8>, String> {
    let soort = pad
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let ondersteund = scan_mappen(vast, gekoppeld, omgeving)?
        .iter()
        .filter_map(|item| item.manifest_tekst.as_deref())
        .filter_map(manifest_id_en_types)
        .any(|(id, types)| ingeschakelde_ids.contains(&id) && types.contains(&soort));
    if !ondersteund {
        return Err(format!(
            "Geen ingeschakelde extensie biedt het bestandstype .{soort} aan."
        ));
    }
    fs::read(pad).map_err(|e| format!("Importbestand is niet te lezen: {e}"))
}

fn geldige_id(id: &str) -> bool {
    let delen: Vec<_> = id.split('.').collect();
    delen.len() >= 2 && delen.iter().all(|deel| geldig_naamdeel(deel))
}

fn veilig_zip_pad(pad: &Path) -> bool {
    let mut delen = pad.components();
    matches!(delen.next(), Some(Component::Normal(_)))
        && delen.all(|deel| matches!(deel, Component::Normal(_)))
}

/** Keurt de ZIP volledig vóór een bestand wordt geschreven en installeert atomair. */
pub fn installeer_zip(zip_pad: &Path, vast: &Path) -> Result<PathBuf, String> {
    let bestand = File::open(zip_pad).map_err(|e| format!("ZIP is niet te lezen: {e}"))?;
    let mut zip = zip::ZipArchive::new(bestand).map_err(|e| format!("Ongeldige ZIP: {e}"))?;
    if zip.len() > 100 {
        return Err("De ZIP bevat te veel bestanden (maximaal 100).".into());
    }
    let mut totaal = 0_u64;
    let mut manifest_tekst = None;
    let mut namen = HashSet::new();
    for index in 0..zip.len() {
        let mut item = zip.by_index(index).map_err(|e| e.to_string())?;
        let pad = Path::new(item.name());
        if !veilig_zip_pad(pad) || !namen.insert(pad.to_path_buf()) {
            return Err("De ZIP bevat een ongeldig of dubbel pad.".into());
        }
        if item
            .unix_mode()
            .is_some_and(|modus| modus & 0o170000 == 0o120000)
        {
            return Err("De ZIP bevat een symbolische koppeling.".into());
        }
        totaal = totaal.saturating_add(item.size());
        if totaal > 50 * 1024 * 1024 {
            return Err("De ZIP is uitgepakt groter dan 50 MB.".into());
        }
        if item.name() == "extension.json" {
            let mut tekst = String::new();
            item.read_to_string(&mut tekst)
                .map_err(|e| format!("Manifest is niet te lezen: {e}"))?;
            manifest_tekst = Some(tekst);
        }
    }
    let tekst = manifest_tekst.ok_or("De ZIP bevat geen extension.json op het hoogste niveau.")?;
    let manifest = keur_manifest(&tekst)?;
    let id = &manifest.id;
    if !namen.contains(Path::new(&manifest.main)) {
        return Err("Het script uit main ontbreekt in de ZIP of heeft een ongeldig pad.".into());
    }
    fs::create_dir_all(vast).map_err(|e| e.to_string())?;
    let doel = vast.join(id);
    if doel.exists() {
        return Err(format!("Extensie {id} is al geïnstalleerd."));
    }
    let tijdelijk = vast.join(format!(
        ".{id}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    ));
    fs::create_dir(&tijdelijk).map_err(|e| e.to_string())?;
    let resultaat = (|| -> Result<(), String> {
        for index in 0..zip.len() {
            let mut item = zip.by_index(index).map_err(|e| e.to_string())?;
            let pad = tijdelijk.join(item.name());
            if item.is_dir() {
                fs::create_dir_all(&pad).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = pad.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut uit = File::create(&pad).map_err(|e| e.to_string())?;
                io::copy(&mut item, &mut uit).map_err(|e| e.to_string())?;
            }
        }
        fs::rename(&tijdelijk, &doel).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if resultaat.is_err() {
        let _ = fs::remove_dir_all(&tijdelijk);
    }
    resultaat.map(|()| doel)
}

pub fn verwijder_geinstalleerd(vast: &Path, map: &Path) -> Result<(), String> {
    let basis = vast.canonicalize().map_err(|e| e.to_string())?;
    let doel = map.canonicalize().map_err(|e| e.to_string())?;
    if doel.parent() != Some(basis.as_path()) || !doel.is_dir() {
        return Err(
            "Alleen een geïnstalleerde extensie in de vaste extensiemap kan worden verwijderd."
                .into(),
        );
    }
    fs::remove_dir_all(doel).map_err(|e| e.to_string())
}

pub fn lezen(app: &tauri::AppHandle, mappen: Vec<String>) -> Result<Vec<GevondenExtensie>, String> {
    scan_mappen(
        &extensiemap(app)?,
        &mappen.into_iter().map(PathBuf::from).collect::<Vec<_>>(),
        &omgeving_mappen(),
    )
}

pub fn script_lezen(map: String, main: String) -> Result<String, String> {
    lees_script(Path::new(&map), &main)
}

pub fn bestand_lezen(
    app: &tauri::AppHandle,
    pad: String,
    mappen: Vec<String>,
    ingeschakelde_ids: Vec<String>,
) -> Result<Vec<u8>, String> {
    lees_importbestand(
        Path::new(&pad),
        &extensiemap(app)?,
        &mappen.into_iter().map(PathBuf::from).collect::<Vec<_>>(),
        &omgeving_mappen(),
        &ingeschakelde_ids,
    )
}

pub fn zip_installeren(app: &tauri::AppHandle, zip_pad: String) -> Result<String, String> {
    installeer_zip(Path::new(&zip_pad), &extensiemap(app)?)
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn verwijderen(app: &tauri::AppHandle, map: String) -> Result<(), String> {
    verwijder_geinstalleerd(&extensiemap(app)?, Path::new(&map))
}
