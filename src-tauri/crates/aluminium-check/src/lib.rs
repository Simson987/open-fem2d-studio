//! `aluminium-check` — staaftoetsing van aluminium volgens NEN-EN 1999-1-1
//! (eerste versie, issue #5).
//!
//! De rekenregels staan in `nen-en-1999-1-1`; deze crate kiest per staaf
//! welke regels gelden, evalueert ze over het hele krachtsverloop en levert
//! het gedeelde `NamedCheck`-contract op.
//!
//! # Wel getoetst
//! Doorsnedeklassen (§6.1.4, tabel 6.2), lokale plooi met `ρ_c` (§6.1.5),
//! trek (§6.2.3), druk (§6.2.4), buiging (§6.2.5), dwarskracht (§6.2.6),
//! buiging met dwarskracht (§6.2.8), normaalkracht met buiging (§6.2.9/6.2.10),
//! knik om beide assen (§6.3.1, ongelaste staven) en, als hij is opgegeven, de
//! BGT-doorbuiging tegen een projectgrens (§7.2).
//!
//! # Niet getoetst — en dan ook nooit "voldoet"
//! Kip (§6.3.2), druk met buiging als stabiliteitstoets (§6.3.3), knik van
//! gelaste staven (κ, tabel 6.5), plooi door afschuiving bij slanke lijven,
//! buiging om de zwakke as en torsie. Staat een daarvan voor een staaf open,
//! dan komt hij in `niet_getoetst` en is de status `NotApplicable`.
//!
//! # HAZ
//! De lasstatus is verplichte invoer zonder standaard. "Gelast" rekent de
//! hele doorsnede in de HAZ (veilig, `b_haz` niet bepaald); "onbekend" rekent
//! hetzelfde maar geeft nooit "voldoet".

pub mod input;
pub mod result;
pub mod toets;

pub use input::{AluminiumBeamCheckInput, Lasstatus};
pub use result::*;
pub use toets::{check_all_aluminium_beams, check_aluminium_beam};

/// De tabelrijen van de ondersteunde legeringen (voor keuzelijsten en de
/// lijsttool langs de drie wegen).
pub fn list_aluminium_alloys() -> Vec<nen_en_1999_1_1::AluminiumLegering> {
    nen_en_1999_1_1::legeringen()
}
