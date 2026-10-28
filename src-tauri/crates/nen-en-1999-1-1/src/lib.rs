//! `nen-en-1999-1-1` — rekenregels voor aluminium constructies volgens
//! NEN-EN 1999-1-1 (Eurocode 9), eerste versie.
//!
//! De crate bevat alleen normregels: legeringen (§3.2, tabel 3.2b),
//! doorsnedeklassen en lokale plooi (§6.1.4, §6.1.5), doorsnedeweerstanden
//! (§6.2) en knik (§6.3.1). Welke regels per staaf gelden en hoe ze in een
//! toetsrapport komen, staat in de toetscrate `aluminium-check`.
//!
//! Partiële factoren: de aanbevolen waarden van tabel 6.1 (`γ_M1 = 1,10`,
//! `γ_M2 = 1,25`). Een Nederlandse nationale bijlage met afwijkende waarden is
//! hier niet verwerkt; de toets meldt dat.

pub mod doorsnede;
pub mod klasse;
pub mod knik;
pub mod materiaal;
pub mod weerstand;

pub use doorsnede::{AluDoorsnede, Deelrol, Factoren};
pub use klasse::Deelsoort;
pub use materiaal::{legering_namen, legeringen, zoek_legering, AluminiumLegering, Knikklasse};

/// De normaanduiding zoals die in elk resultaat en rapport staat.
pub const NORM: &str = "NEN-EN 1999-1-1:2007+A1:2009";
