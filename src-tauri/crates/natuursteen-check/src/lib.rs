//! `natuursteen-check` — toetsing van natuurstenen elementen (issue #99),
//! eerste versie: lateien, dorpels, consoleplaten, vloerplaten, traptreden
//! en gevelplaten.
//!
//! Natuursteenmetselwerk (EN 771-6 als metselsteen) zit NIET hier maar in de
//! metselwerktoets (`metselwerk-check`, steensoort `Natuursteen`, groep 1).
//!
//! # Normbasis
//! Er is geen Eurocode voor het ontwerp van natuurstenen elementen. De toets
//! gebruikt daarom:
//! - de sterkten uit beproeving: buigsterkte EN 12372 (geconcentreerde last)
//!   of EN 13161 (constant moment), druksterkte EN 1926, breuklast bij het
//!   ankergat EN 13364;
//! - de karakteristieke waarde (5%-fractiel) uit de losse proefuitkomsten
//!   volgens NEN-EN 1990 bijlage D, §D.7.2 (V_X onbekend, normaal of
//!   lognormaal) — of een opgegeven karakteristieke waarde met bron;
//! - een materiaalfactor `γ_M` en reductiefactoren (vocht, vorst,
//!   belastingsduur) als OPGAVE MET BRON: er zijn geen standaardwaarden.
//!
//! # Wel getoetst
//! Buiging (trekrand, `σ_t = M/W` ≤ `f_f,d`), druk (drukrand ≤ `f_c,d`),
//! afschuiving (`τ = 1,5 V/A` ≤ `f_v,d`, alleen met opgegeven `f_vk`),
//! oplegdruk, doorbuiging (BGT, elastisch) en de verankering van een
//! gevelplaat (breuklast per anker tegen de ankerkracht).
//!
//! # Niet getoetst (gemeld in `niet_getoetst`, nooit "voldoet")
//! Knik van gedrukte elementen, kip van een hoge, niet zijdelings gesteunde
//! doorsnede, de plaatdikte en gatpositie volgens EN 1469, en elk onderdeel
//! waarvoor een sterkte ontbreekt.

pub mod input;
pub mod result;
pub mod statistiek;
pub mod toets;

pub use input::*;
pub use result::*;
pub use statistiek::{Statistiek, Verdeling};
pub use toets::{check_all_natuursteen_elements, check_natuursteen_element, NORM};
