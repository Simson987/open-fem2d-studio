//! `nen-en-1993-1-3` — rekenregels voor koudgevormde dunwandige staalprofielen
//! volgens NEN-EN 1993-1-3 (Eurocode 3, deel 1-3), eerste versie (issue #4).
//!
//! De crate bevat alleen normregels: staalsoorten (tabel 3.1a, deelverzameling),
//! de gemiddelde vloeigrens `f_ya` (§3.2.2), de dunwandige hartlijngeometrie
//! van C-, Z- en U-profielen met de invloed van afgeronde hoeken (§5.1) en de
//! maatgrenzen (§5.2), effectieve breedten met EN 1993-1-5 §4.4 (`ρ`) en de
//! randverstijver (§5.5.3, `χ_d`), doorsnedeweerstanden (§6.1) en knik
//! (§6.2.2, §6.2.3). Welke regels per staaf gelden en hoe ze in een
//! toetsrapport komen, staat in de toetscrate `koudgevormd-check`.
//!
//! # Bron
//! Er lag bij het schrijven geen normtekst (PDF) naast de code. De formules
//! zijn die van EN 1993-1-3:2006 en EN 1993-1-5:2006 zoals ze algemeen bekend
//! zijn; waar een keuze uit de norm niet zeker was, is de veilige variant
//! genomen en staat dat bij de functie (bijv. knikkromme c voor elke knikvorm,
//! tabel 6.1 kolom "zonder verstijving bij de oplegging"). Elke regel hoort
//! bij een normcontrole tegen de tekst te worden nagelopen.
//!
//! # Partiële factoren
//! De aanbevolen waarden van EN 1993-1-3 §2(3): `γ_M0 = 1,0`, `γ_M1 = 1,0`,
//! `γ_M2 = 1,25`. Een afwijkende waarde in de Nederlandse nationale bijlage is
//! hier niet verwerkt; de toets meldt dat.

pub mod doorsnede;
pub mod dunwandig;
pub mod effectief;
pub mod materiaal;
pub mod weerstand;

pub use doorsnede::{KvDoorsnede, Plaatdeel, Plaatrol};
pub use dunwandig::{Dunwandig, Strook};
pub use effectief::{DeelEffectief, EffectieveDoorsnede, Randverstijver};
pub use materiaal::{staalsoort_namen, staalsoorten, zoek_staalsoort, KvStaalsoort};

/// De normaanduiding zoals die in elk resultaat en rapport staat.
pub const NORM: &str = "NEN-EN 1993-1-3:2006";
