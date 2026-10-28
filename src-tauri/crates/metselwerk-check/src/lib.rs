//! `metselwerk-check` — toetsing van metselwerkwanden volgens
//! NEN-EN 1996-1-1 (eerste versie, issue #98).
//!
//! De rekenregels staan in `nen-en-1996-1-1`; deze crate kiest per wand
//! welke regels gelden en levert het gedeelde `NamedCheck`-contract op.
//!
//! # Wel getoetst
//! Materiaal (`f_k = K f_b^α f_m^β`, §3.6.1.2; `f_d = f_k/γ_M`), slankheid
//! `h_ef/t_ef ≤ 27` met ρ_2/ρ_3/ρ_4 (§5.5.1), verticale belasting per meter
//! met Φ boven/onder (§6.1.2.2) en Φ_m halverwege (bijlage G, met kruip),
//! geconcentreerde lasten met β (§6.1.3), afschuiving in het vlak met `l_c`
//! en `f_vk` (§6.2, §3.6.2) en buiging uit het vlak van een wandstrook
//! (§6.3.1).
//!
//! # Nationaal te kiezen parameters
//! `K`, `γ_M`, `K_E`, `φ_∞`, `f_vk0`, `f_xk1`, `f_xk2` zijn invoer MET bron;
//! er zijn geen standaardwaarden. Een ontbrekende of bronloze waarde maakt de
//! toets die haar nodig heeft "niet getoetst" — nooit "voldoet".
//!
//! # Niet getoetst
//! Lichte mortel, lijmmortel met kunststeen/natuursteen, hol-gemetselde
//! lintvoegen, spouwmuren (t_ef), boogwerking (§6.3.2), momentcoëfficiënten
//! van bijlage E, gewapend metselwerk, en de wandvoet op de funderingsbalk.

pub mod input;
pub mod result;
pub mod toets;

pub use input::*;
pub use result::*;
pub use toets::{check_all_metselwerk_walls, check_metselwerk_wall};
