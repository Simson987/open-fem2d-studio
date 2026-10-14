use open_fem_studio_lib::extensies::{
    installeer_zip, lees_importbestand, lees_script, scan_mappen, verwijder_geinstalleerd,
};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

struct Testmap(PathBuf);
impl Testmap {
    fn nieuw(naam: &str) -> Self {
        let pad = std::env::temp_dir().join(format!(
            "ofs-extensies-{naam}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&pad).unwrap();
        Self(pad)
    }
}
impl Drop for Testmap {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

const MANIFEST: &str =
    include_str!("../../design-mockup/test-fixtures/extensie-voorbeeld/extension.json");
const SCRIPT: &str = include_str!("../../design-mockup/test-fixtures/extensie-voorbeeld/index.js");

fn maak_extensie(map: &Path, manifest: &str) {
    fs::create_dir_all(map).unwrap();
    fs::write(map.join("extension.json"), manifest).unwrap();
    fs::write(map.join("index.js"), SCRIPT).unwrap();
}

fn maak_zip(pad: &Path, entries: &[(&str, &str)]) {
    let mut schrijver = zip::ZipWriter::new(File::create(pad).unwrap());
    for (naam, inhoud) in entries {
        schrijver
            .start_file(*naam, SimpleFileOptions::default())
            .unwrap();
        schrijver.write_all(inhoud.as_bytes()).unwrap();
    }
    schrijver.finish().unwrap();
}

#[test]
fn scant_geinstalleerde_gekoppelde_en_kapotte_extensies() {
    let tmp = Testmap::nieuw("scan");
    let vast = tmp.0.join("installed");
    maak_extensie(&vast.join("goed"), MANIFEST);
    maak_extensie(&vast.join("kapot"), "{geen json");
    let gekoppeld = tmp.0.join("linked");
    maak_extensie(&gekoppeld, MANIFEST);
    let gevonden = scan_mappen(&vast, &[gekoppeld.clone()], &[]).unwrap();
    assert_eq!(gevonden.len(), 3);
    assert!(gevonden
        .iter()
        .any(|x| x.bron == "geinstalleerd" && x.fout.is_some()));
    assert!(gevonden
        .iter()
        .any(|x| x.bron == "gekoppeld" && x.manifest_tekst.is_some()));
    assert!(gevonden
        .iter()
        .any(|x| x.map == vast.join("goed").to_string_lossy() && x.manifest_tekst.is_some()));
}

#[test]
fn script_en_importbytes_blijven_binnen_de_toegestane_grenzen() {
    let tmp = Testmap::nieuw("lezen");
    let vast = tmp.0.join("installed");
    maak_extensie(&vast.join("goed"), MANIFEST);
    assert!(lees_script(&vast.join("goed"), "index.js")
        .unwrap()
        .contains("openFemExtension"));
    assert!(lees_script(&vast.join("goed"), "../buiten.js").is_err());
    let invoer = tmp.0.join("proef.demofem");
    fs::write(&invoer, b"knoop 1 0 0").unwrap();
    let ids = vec!["org.openaec.voorbeeld".to_owned()];
    assert_eq!(
        lees_importbestand(&invoer, &vast, &[], &[], &ids).unwrap(),
        b"knoop 1 0 0"
    );
    assert!(lees_importbestand(&invoer, &vast, &[], &[], &[])
        .unwrap_err()
        .contains("Geen ingeschakelde"));
    let ander = tmp.0.join("geheim.txt");
    fs::write(&ander, b"geen import").unwrap();
    assert!(lees_importbestand(&ander, &vast, &[], &[], &ids).is_err());
}

#[test]
fn zip_wordt_eerst_gekeurd_en_veilig_geinstalleerd() {
    let tmp = Testmap::nieuw("zip");
    let vast = tmp.0.join("installed");
    let zip_pad = tmp.0.join("goed.zip");
    maak_zip(
        &zip_pad,
        &[("extension.json", MANIFEST), ("index.js", SCRIPT)],
    );
    let doel = installeer_zip(&zip_pad, &vast).unwrap();
    assert_eq!(doel, vast.join("org.openaec.voorbeeld"));
    assert_eq!(
        fs::read_to_string(doel.join("extension.json")).unwrap(),
        MANIFEST
    );
    assert!(installeer_zip(&zip_pad, &vast).is_err());
    let buiten = tmp.0.join("buiten");
    fs::create_dir(&buiten).unwrap();
    assert!(verwijder_geinstalleerd(&vast, &buiten).is_err());
    verwijder_geinstalleerd(&vast, &doel).unwrap();
    assert!(!doel.exists());
}

#[test]
fn zip_weigert_pad_escape_en_ongeldig_manifest_zonder_installatie() {
    let tmp = Testmap::nieuw("zip-fouten");
    let vast = tmp.0.join("installed");
    let pad = tmp.0.join("pad.zip");
    maak_zip(
        &pad,
        &[("extension.json", MANIFEST), ("../buiten.js", SCRIPT)],
    );
    assert!(installeer_zip(&pad, &vast).is_err());
    assert!(!tmp.0.join("buiten.js").exists());
    let pad = tmp.0.join("manifest.zip");
    let fout_manifest = MANIFEST.replace("\"apiVersion\": 1", "\"apiVersion\": 2");
    maak_zip(
        &pad,
        &[("extension.json", &fout_manifest), ("index.js", SCRIPT)],
    );
    assert!(installeer_zip(&pad, &vast).is_err());
    assert!(!vast.join("org.openaec.voorbeeld").exists());
}
