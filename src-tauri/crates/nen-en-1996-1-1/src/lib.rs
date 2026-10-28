//! `nen-en-1996-1-1` — rekenregels voor metselwerk volgens NEN-EN 1996-1-1
//! (Eurocode 6), eerste versie (issue #98).
//!
//! Alleen normregels, zonder keuze welke toets voor een wand geldt (dat doet
//! de toetscrate `metselwerk-check`):
//! - [`materiaal`]: de exponenten α en β van vergelijking (3.1)–(3.4) en de
//!   karakteristieke druksterkte `f_k = K f_b^α f_m^β` (§3.6.1.2);
//! - [`slankheid`]: de reductiefactor ρ_n voor de effectieve hoogte
//!   (§5.5.1.2), de initiële excentriciteit `e_init = h_ef/450` (§5.5.1.1)
//!   en de slankheidsgrens 27 (§5.5.1.4);
//! - [`capaciteit`]: Φ boven/onder (§6.1.2.2, vgl. 6.4/6.5) en Φ_m in het
//!   midden (bijlage G, met de kruipexcentriciteit e_k van vgl. 6.8);
//! - [`geconcentreerd`]: de verhogingsfactor β (§6.1.3, vgl. 6.10);
//! - [`afschuiving`]: `f_vk` (§3.6.2, vgl. 3.5/3.6) en de lengte van het
//!   gedrukte deel `l_c` (§6.2);
//! - buiging uit het vlak (§6.3.1, vgl. 6.15) staat in [`buiging`].
//!
//! # Wat hier bewust NIET in staat
//! Nationaal te kiezen parameters (NDP) zoals `K` (tabel 3.3), `γ_M`
//! (§2.4.3), `K_E` (§3.7.2), `φ_∞` (tabel 3.8), `f_vk0` (tabel 3.4) en
//! `f_xk1`/`f_xk2` (§3.6.3) hebben in de Nederlandse nationale bijlage eigen
//! waarden. Die zijn hier niet ingebakken: de toets vraagt ze als invoer
//! MET bron, zoals de rolschuifsterkte van CLT (zie `Normwaarde`).

pub mod afschuiving;
pub mod buiging;
pub mod capaciteit;
pub mod geconcentreerd;
pub mod materiaal;
pub mod slankheid;

pub use materiaal::{Mortelsoort, Steengroep, Steensoort};

/// De normaanduiding zoals die in elk resultaat en rapport staat.
pub const NORM: &str = "NEN-EN 1996-1-1+A1:2013";
