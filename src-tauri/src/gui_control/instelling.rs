//! `gui_control::instelling` — de bewaarde instelling "Bediening door een
//! AI-assistent toestaan (MCP)" (issue #109).
//!
//! # Waar, en waarom daar
//!
//! In een eigen klein bestand, `ai-assistent.json`, in de app-datamap
//! (`%LOCALAPPDATA%\org.openaec.fem-studio\`, naast het vindbestand
//! `gui-control.json`). Rust is de enige eigenaar: het commando dat de
//! schakelaar omzet, bewaart de keuze en zet het kanaal aan of uit in één
//! beweging, en bij het starten leest Rust het bestand vóór er een venster
//! is. Zo kan de bewaarde stand nooit uit de pas lopen met wat de pagina via
//! de store-plugin (`preferences.json`, met vertraagd opslaan) zou schrijven.
//!
//! # Standaard aan
//!
//! Geen bestand of geen sleutel: aan, ook na een update. Een expliciete `false`
//! blijft uit. Een onleesbaar of ongeldig bestand blijft uit: zo kan een
//! beschadigd bestand nooit een eerdere bewuste keuze voor uit overrulen.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use serde_json::{Map, Value};

/// De naam van het bestand in de app-datamap.
pub const BESTANDSNAAM: &str = "ai-assistent.json";

/// De sleutel in dat bestand.
const SLEUTEL: &str = "bedieningToestaan";

/// Staat de bediening door een AI-assistent toe? Alleen een ontbrekend bestand
/// of een geldig object zonder sleutel gebruikt de standaardwaarde aan.
pub fn lees(pad: &Path) -> bool {
    let tekst = match fs::read_to_string(pad) {
        Ok(tekst) => tekst,
        Err(e) => return e.kind() == ErrorKind::NotFound,
    };
    match serde_json::from_str::<Value>(&tekst) {
        Ok(Value::Object(map)) => match map.get(SLEUTEL) {
            None => true,
            Some(Value::Bool(toestaan)) => *toestaan,
            Some(_) => false,
        },
        _ => false,
    }
}

/// Bewaar de keuze. Andere sleutels in het bestand blijven staan; de map
/// wordt aangemaakt. Via een tijdelijk bestand en hernoemen, zodat een
/// afgebroken schrijfactie geen half bestand achterlaat.
pub fn schrijf(pad: &Path, toestaan: bool) -> Result<(), String> {
    let mut inhoud = fs::read_to_string(pad)
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| match v {
            Value::Object(m) => Some(m),
            _ => None,
        })
        .unwrap_or_else(Map::new);
    inhoud.insert(SLEUTEL.into(), Value::Bool(toestaan));
    if let Some(map) = pad.parent() {
        fs::create_dir_all(map).map_err(|e| format!("{}: {e}", map.display()))?;
    }
    let tekst = serde_json::to_string_pretty(&Value::Object(inhoud)).expect("JSON-object") + "\n";
    let naam = pad.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tijdelijk = pad.with_file_name(format!("{naam}.{}.tmp", std::process::id()));
    fs::write(&tijdelijk, &tekst).map_err(|e| format!("{}: {e}", tijdelijk.display()))?;
    fs::rename(&tijdelijk, pad).map_err(|e| {
        let _ = fs::remove_file(&tijdelijk);
        format!("{}: {e}", pad.display())
    })
}

/// Start het kanaal bij het opstarten? Met `OPENAEC_GUI_CONTROL=1` altijd
/// (testscripts, ontwikkelwerk), en anders als de instelling aanstaat.
pub fn moet_starten(omgevingsvariabele: bool, instelling: bool) -> bool {
    omgevingsvariabele || instelling
}
