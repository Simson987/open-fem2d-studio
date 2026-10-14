//! De zuivere onderdelen van de bestandskoppeling (src/bestandskoppeling.rs):
//! welke bestanden de app opent als Windows, Linux of macOS ze aanreikt
//! (dubbelklik in de verkenner, "Openen met", de opdrachtregel, een tweede
//! start terwijl de app al draait), de wachtrij naar de pagina, en wanneer de
//! app bewaakt dat er maar één venster is.
//!
//! Dit zijn unit-tests, maar ze staan in tests/ en niet in de lib: de
//! unit-testharnas van de lib laadt op Windows niet (comctl32 v5 zonder
//! manifest, zie build.rs en testbinary_laadt.rs) en staat daarom uit
//! (`[lib] test = false`). Integratietest-doelen krijgen het manifest wél.

use open_fem_studio_lib::bestandskoppeling::{
    bestanden_uit_argv, bestanden_uit_argv_os, deel_in, een_instantie_bewaken, is_projectbestand,
    paden_uit_urls, Startbestanden, Wachtrij,
};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

/// Een eigen, lege map per test (geen tempfile-crate in deze crate); weg bij
/// het verlaten van de test.
struct Werkmap(PathBuf);

impl Werkmap {
    fn nieuw(naam: &str) -> Self {
        let pad = std::env::temp_dir().join(format!(
            "ofs-bestandskoppeling-{}-{naam}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&pad);
        fs::create_dir_all(&pad).expect("werkmap aanmaken");
        Werkmap(pad)
    }

    /// Maak een bestand (met tussenmappen) en geef het absolute pad terug.
    /// `relatief` met `/` als scheiding; het pad komt terug met de scheiding
    /// van het platform, zoals de verkenner het ook geeft.
    fn bestand(&self, relatief: &str) -> PathBuf {
        let pad: PathBuf = self.0.join(relatief).components().collect();
        if let Some(map) = pad.parent() {
            fs::create_dir_all(map).expect("tussenmap");
        }
        fs::write(&pad, "{}").expect("bestand schrijven");
        pad
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

/// argv zoals het besturingssysteem het geeft: eerst het programma.
fn argv(delen: &[&str]) -> Vec<String> {
    std::iter::once("C:\\Program Files\\Open FEM Studio\\open-fem-studio.exe")
        .chain(delen.iter().copied())
        .map(str::to_owned)
        .collect()
}

fn tekst(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Een pad in `map` waarvan de naam geen geldige Unicode is, zoals het
/// besturingssysteem het kan aanreiken: op Windows met een ongepaarde
/// surrogaat (NTFS staat die toe), op Unix met een losse byte 0xFF.
#[cfg(windows)]
fn niet_unicode(map: &Path, stam: &str, ext: &str) -> OsString {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let mut w: Vec<u16> = map.as_os_str().encode_wide().collect();
    w.push(u16::from(b'\\'));
    w.extend(stam.encode_utf16());
    w.push(0xD800);
    w.extend(format!(".{ext}").encode_utf16());
    OsString::from_wide(&w)
}

#[cfg(unix)]
fn niet_unicode(map: &Path, stam: &str, ext: &str) -> OsString {
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    let mut b = map.as_os_str().as_bytes().to_vec();
    b.push(b'/');
    b.extend_from_slice(stam.as_bytes());
    b.push(0xFF);
    b.extend_from_slice(format!(".{ext}").as_bytes());
    OsString::from_vec(b)
}

#[test]
fn een_projectbestand_uit_de_verkenner_wordt_geopend() {
    let w = Werkmap::nieuw("verkenner");
    let model = w.bestand("hal.ifcfem");
    let uit = bestanden_uit_argv(&argv(&[&tekst(&model)]), w.pad());
    assert_eq!(uit.projecten, vec![model]);
    assert!(uit.andere.is_empty());
}

#[test]
fn beide_extensies_ook_met_hoofdletters() {
    let w = Werkmap::nieuw("extensies");
    let nieuw = w.bestand("Model.IFCFEM");
    let oud = w.bestand("ligger.IfcFem2d");
    let gewoon = w.bestand("raam.ifcfem2d");
    let uit = bestanden_uit_argv(
        &argv(&[&tekst(&nieuw), &tekst(&oud), &tekst(&gewoon)]),
        w.pad(),
    );
    assert_eq!(uit.projecten, vec![nieuw, oud, gewoon]);
}

#[test]
fn paden_met_spaties_blijven_heel() {
    let w = Werkmap::nieuw("spaties");
    let model = w.bestand("Mijn projecten/hal 2 - definitief.ifcfem");
    let uit = bestanden_uit_argv(&argv(&[&tekst(&model)]), w.pad());
    assert_eq!(uit.projecten, vec![model]);
}

#[test]
fn het_programmapad_telt_niet_mee() {
    // Ook niet als het (vreemd genoeg) zelf een bestaand projectbestand is:
    // argv[0] is altijd het programma.
    let w = Werkmap::nieuw("programmapad");
    let model = w.bestand("hal.ifcfem");
    let alleen_programma = vec![tekst(&model)];
    assert!(bestanden_uit_argv(&alleen_programma, w.pad()).is_leeg());
    assert!(bestanden_uit_argv(&[], w.pad()).is_leeg());
}

#[test]
fn vlaggen_worden_genegeerd() {
    let w = Werkmap::nieuw("vlaggen");
    let model = w.bestand("hal.ifcfem");
    // Een bestand dat letterlijk "-x.ifcfem" heet, in de werkmap: als
    // argument is het een vlag, en die blijft een vlag.
    w.bestand("-x.ifcfem");
    let uit = bestanden_uit_argv(
        &argv(&["--no-sandbox", "-psn_0_12345", "--", "-x.ifcfem", &tekst(&model)]),
        w.pad(),
    );
    assert_eq!(uit.projecten, vec![model]);
    assert!(uit.andere.is_empty());
}

#[test]
fn een_argument_dat_geen_unicode_is_laat_de_start_niet_vallen() {
    // `std::env::args()` raakt op zo'n argument in paniek; de eerste start
    // leest daarom `args_os()` en geeft het hier als OsString door. Het
    // geldige bestand ernaast opent gewoon, de vlag blijft een vlag.
    let w = Werkmap::nieuw("niet-unicode-argument");
    let model = w.bestand("hal.ifcfem");
    let vreemd = niet_unicode(w.pad(), "weg", "ifcfem");
    assert!(vreemd.to_str().is_none(), "de proef moet echt geen geldige Unicode zijn");
    let vreemde_vlag = {
        let mut v = OsString::from("--");
        v.push(&vreemd);
        v
    };
    let argv = vec![
        OsString::from("C:\\Program Files\\Open FEM Studio\\open-fem-studio.exe"),
        vreemd,
        vreemde_vlag,
        model.clone().into_os_string(),
    ];
    let uit = bestanden_uit_argv_os(&argv, w.pad());
    assert_eq!(uit.projecten, vec![model]);
    assert!(uit.andere.is_empty());
}

/// Een bestaand projectbestand met zo'n naam valt af: de pagina krijgt paden
/// als JSON-tekst en zou het verminkt (U+FFFD) en dus onvindbaar krijgen. Niet
/// op macOS: APFS weigert een naam die geen UTF-8 is al bij het aanmaken.
#[cfg(any(windows, all(unix, not(target_os = "macos"))))]
#[test]
fn een_bestaand_bestand_met_een_naam_zonder_unicode_valt_af() {
    let w = Werkmap::nieuw("niet-unicode-bestand");
    let model = w.bestand("hal.ifcfem");
    let vreemd = niet_unicode(w.pad(), "hal", "ifcfem");
    fs::write(&vreemd, "{}").expect("bestand met een naam zonder geldige Unicode aanmaken");
    assert!(Path::new(&vreemd).is_file(), "het vreemde bestand bestaat echt");
    let argv = vec![
        OsString::from("open-fem-studio"),
        vreemd,
        model.clone().into_os_string(),
    ];
    let uit = bestanden_uit_argv_os(&argv, w.pad());
    assert_eq!(uit.projecten, vec![model], "alleen het bestand met een geldige naam");
    assert!(uit.andere.is_empty(), "het vreemde bestand ook niet als 'ander bestand'");
}

#[test]
fn een_bestand_dat_niet_bestaat_valt_af() {
    let w = Werkmap::nieuw("bestaat-niet");
    let weg = w.pad().join("verdwenen.ifcfem");
    assert!(bestanden_uit_argv(&argv(&[&tekst(&weg)]), w.pad()).is_leeg());
}

#[test]
fn een_map_met_een_projectextensie_is_geen_bestand() {
    let w = Werkmap::nieuw("map");
    let map = w.pad().join("archief.ifcfem");
    fs::create_dir_all(&map).unwrap();
    assert!(bestanden_uit_argv(&argv(&[&tekst(&map)]), w.pad()).is_leeg());
}

#[test]
fn een_relatief_pad_hoort_bij_de_werkmap_van_die_start() {
    // De opdrachtregel ("open-fem-studio hal.ifcfem"), en bij een tweede start
    // de werkmap van DIE start: de single-instance-plugin geeft hem mee.
    let w = Werkmap::nieuw("relatief");
    let model = w.bestand("sub/hal.ifcfem");
    let relatief = tekst(&Path::new("sub").join("hal.ifcfem"));
    let uit = bestanden_uit_argv(&argv(&[&relatief]), w.pad());
    assert_eq!(uit.projecten, vec![model.clone()]);
    // Met ".\" (of "./") ervoor: zelfde pad, zonder de punt erin.
    let met_punt = format!(".{}{relatief}", std::path::MAIN_SEPARATOR);
    let uit = bestanden_uit_argv(&argv(&[&met_punt]), w.pad());
    assert_eq!(uit.projecten, vec![model]);
}

#[test]
fn een_ander_bestaand_bestand_gaat_apart_voor_een_melding() {
    // "Openen met → Open FEM Studio" op een ander bestandstype: niet openen,
    // wel laten weten (de pagina meldt het). Geen fs-vrijgave voor zo'n pad.
    let w = Werkmap::nieuw("ander");
    let notitie = w.bestand("notities.txt");
    let ifc = w.bestand("gebouw.ifc");
    let model = w.bestand("hal.ifcfem");
    let uit = bestanden_uit_argv(
        &argv(&[&tekst(&notitie), &tekst(&model), &tekst(&ifc)]),
        w.pad(),
    );
    assert_eq!(uit.projecten, vec![model]);
    assert_eq!(uit.andere, vec![notitie, ifc]);
}

#[test]
fn twee_keer_hetzelfde_bestand_opent_eenmaal() {
    let w = Werkmap::nieuw("dubbel");
    let model = w.bestand("hal.ifcfem");
    let uit = bestanden_uit_argv(&argv(&[&tekst(&model), &tekst(&model)]), w.pad());
    assert_eq!(uit.projecten, vec![model]);
}

#[test]
fn de_extensietoets_kijkt_naar_de_laatste_extensie() {
    assert!(is_projectbestand(Path::new("/werk/hal.ifcfem")));
    assert!(is_projectbestand(Path::new("/werk/hal.IFCFEM2D")));
    assert!(is_projectbestand(Path::new("/home/ik/hal v2.ifcfem")));
    assert!(!is_projectbestand(Path::new("/werk/hal.ifcfem.bak")));
    assert!(!is_projectbestand(Path::new("/werk/hal.ifc")));
    assert!(!is_projectbestand(Path::new("/werk/ifcfem")));
    assert!(!is_projectbestand(Path::new("/werk/.ifcfem")));
}

#[test]
fn file_urls_van_macos_worden_paden() {
    // macOS geeft een dubbelklik als RunEvent::Opened met URL's, niet via argv.
    let w = Werkmap::nieuw("urls");
    let model = w.bestand("hal met spatie.ifcfem");
    let url = tauri::Url::from_file_path(&model).expect("file-URL");
    let web: tauri::Url = "https://example.org/hal.ifcfem".parse().unwrap();
    let paden = paden_uit_urls(&[web, url]);
    assert_eq!(paden, vec![model.clone()]);
    // Daarna dezelfde indeling als bij argv.
    let uit: Startbestanden = deel_in(paden, w.pad());
    assert_eq!(uit.projecten, vec![model]);
}

#[test]
fn de_wachtrij_geeft_elk_pad_eenmaal_af() {
    let rij = Wachtrij::default();
    assert!(rij.haal_op().is_empty());
    assert!(rij.voeg_toe(vec!["a.ifcfem".to_owned(), "b.ifcfem".to_owned()]));
    assert!(rij.voeg_toe(vec!["c.ifcfem".to_owned()]));
    assert!(!rij.voeg_toe(Vec::new()), "niets toegevoegd is geen reden voor een event");
    assert_eq!(rij.haal_op(), vec!["a.ifcfem", "b.ifcfem", "c.ifcfem"]);
    assert!(rij.haal_op().is_empty(), "een tweede ophaalronde krijgt niets dubbel");
}

#[test]
fn een_instantie_alleen_in_een_gewone_uitgave() {
    // (debugbuild, bedieningskanaal aan, eigen vindbestand, OPENAEC_EEN_INSTANTIE=1 in debug)
    assert!(een_instantie_bewaken(false, false, false, false), "de geïnstalleerde app");
    assert!(
        een_instantie_bewaken(false, true, false, false),
        "de gedocumenteerde MCP-stand (alleen OPENAEC_GUI_CONTROL=1) is de app van de gebruiker: \
         een dubbelklik opent daarin, niet in een tweede venster"
    );
    assert!(
        !een_instantie_bewaken(false, true, true, false),
        "kanaal én eigen vindbestand: een testscript start die instantie bewust naast die van de gebruiker"
    );
    assert!(
        een_instantie_bewaken(false, false, true, false),
        "een eigen vindbestand zonder kanaal betekent niets"
    );
    assert!(
        !een_instantie_bewaken(true, false, false, false),
        "npm run tauri dev mag niet stoppen omdat de geïnstalleerde app draait"
    );
    assert!(een_instantie_bewaken(true, false, false, true), "in debug op verzoek, om het te proberen");
    assert!(een_instantie_bewaken(true, true, false, true), "… ook met het kanaal aan");
    assert!(!een_instantie_bewaken(true, true, true, true), "een testinstantie gaat voor");
}

/// De fs-vrijgave in een nagebootste app (`tauri::test`) met de echte
/// fs-plugin: precies wat `readTextFile` op de pagina laat lezen.
///
/// De capability geeft alleen `**/*.ifcfem` en `**/*.ifcfem2d` vrij, en dat
/// patroon is hoofdlettergevoelig: zonder vrijgave in Rust zou een dubbelklik
/// op `HAL.IFCFEM` eindigen in "forbidden path". `meld` geeft het gemelde
/// projectbestand vrij — en niets anders: geen ander bestand in dezelfde map,
/// en geen gemeld bestand met een andere extensie.
#[test]
fn een_gemeld_projectbestand_is_leesbaar_en_verder_niets() {
    use open_fem_studio_lib::bestandskoppeling::meld;
    use tauri::Manager;
    use tauri_plugin_fs::FsExt;

    let w = Werkmap::nieuw("scope");
    let groot = w.bestand("Mijn map/HAL.IFCFEM");
    let ander_project = w.bestand("Mijn map/buurman.IFCFEM");
    let notitie = w.bestand("Mijn map/notities.txt");

    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_fs::init())
        .manage(Wachtrij::default())
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("nagebootste app");
    let scope = app.fs_scope();
    assert!(!scope.is_allowed(&groot), "vooraf is niets vrijgegeven");

    meld(app.handle(), deel_in(vec![groot.clone(), notitie.clone()], w.pad()));

    assert!(scope.is_allowed(&groot), "het gemelde projectbestand is leesbaar, zoals de pagina het noemt");
    assert!(!scope.is_allowed(&ander_project), "een ander bestand in dezelfde map niet");
    assert!(!scope.is_allowed(&notitie), "een gemeld bestand met een andere extensie niet");
    assert!(!scope.is_allowed(w.pad().join("Mijn map")), "de map niet");
    assert_eq!(
        app.state::<Wachtrij>().haal_op(),
        vec![tekst(&groot), tekst(&notitie)],
        "beide paden naar de pagina: het project om te openen, het andere voor de melding"
    );
}
