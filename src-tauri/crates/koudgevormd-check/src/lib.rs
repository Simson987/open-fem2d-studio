//! `koudgevormd-check` — staaftoetsing van koudgevormde dunwandige
//! staalprofielen (C, Z, U) volgens NEN-EN 1993-1-3 (eerste versie, issue #4).
//!
//! De rekenregels staan in `nen-en-1993-1-3`; deze crate kiest per staaf
//! welke regels gelden, evalueert ze over het hele krachtsverloop en levert
//! het gedeelde `NamedCheck`-contract op.
//!
//! # Wel getoetst
//! Effectieve doorsnede bij druk en bij buiging (§5.5.2, EN 1993-1-5 §4.4;
//! randverstijver §5.5.3.2 met `χ_d`), trek met `f_ya` (§6.1.2), druk
//! (§6.1.3), buiging om de sterke as (§6.1.4.1), dwarskracht (§6.1.5),
//! normaalkracht + buiging + dwarskracht met de verschuiving `e_N`
//! (§6.1.8–6.1.10, lineaire vorm), knik om beide assen en (buig)torsieknik
//! (§6.2.2, §6.2.3), druk met buiging bij een zijdelings gesteunde staaf met
//! (6.36) (§6.2.5(2)) en, als hij is opgegeven, de BGT-doorbuiging tegen een
//! projectgrens (§7).
//!
//! # Niet getoetst — en dan ook nooit "voldoet"
//! Kip (§6.2.4) van een niet gesteunde staaf, de stabiliteit van een C/U op
//! druk met het extra moment `N·e_N,y` om de zwakke as, buiging om de zwakke
//! as, dwarskracht `V_y`, torsie, lokale lastinleiding (§6.1.7), gordingen met
//! dakbeschot (§10.1) en doorsneden buiten de maatgrenzen van §5.2. Staat
//! daarvan iets open voor een staaf, dan komt het in `niet_getoetst` en is de
//! status `NotApplicable`.

pub mod input;
pub mod result;
pub mod toets;

pub use input::KoudgevormdBeamCheckInput;
pub use result::*;
pub use toets::{check_all_koudgevormd_beams, check_koudgevormd_beam};

/// De rijen van tabel 3.1a die de kern kent (voor keuzelijsten en de
/// lijsttool langs de drie wegen).
pub fn list_koudgevormd_staalsoorten() -> Vec<nen_en_1993_1_3::KvStaalsoort> {
    nen_en_1993_1_3::staalsoorten()
}
