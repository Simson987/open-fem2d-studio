//! Resultaat van de metselwerktoets — op het gedeelde `NamedCheck`-contract.

use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1996_1_1::slankheid::EffectieveHoogte;
use serde::{Deserialize, Serialize};
use steel_check::NamedCheck;
use ts_rs::TS;

/// De materiaalgrootheden die in de toetsen gebruikt zijn.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub struct MetselwerkSterkte {
    pub alpha: f64,
    pub beta: f64,
    /// `K` zoals gebruikt (na een eventuele factor 0,8 voor een langsvoeg).
    pub k: f64,
    /// `f_b` en `f_m` zoals gebruikt (na afkappen op de grenzen van §3.6.1.2).
    pub f_b_mpa: f64,
    #[ts(optional)]
    pub f_m_mpa: Option<f64>,
    pub f_k_mpa: f64,
    pub gamma_m: f64,
    /// `f_d = f_k / γ_M`, zonder de factor voor een kleine doorsnede.
    pub f_d_mpa: f64,
    /// `E = K_E f_k`, als `K_E` is opgegeven.
    #[ts(optional)]
    pub e_mpa: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub struct MetselwerkWandResult {
    pub wand_id: u32,
    pub naam: String,
    pub norm: String,
    pub sterkte: Option<MetselwerkSterkte>,
    pub effectieve_hoogte: Option<EffectieveHoogte>,
    /// `h_ef / t_ef`.
    pub slankheid: Option<f64>,
    pub checks: Vec<NamedCheck>,
    pub uc_max: f64,
    /// `NotOk` zodra één toets niet voldoet; anders `NotApplicable` zolang
    /// er iets in `niet_getoetst` staat; alleen dan `Ok`.
    pub status: CheckStatus,
    pub governing_check_id: String,
    /// Wat voor deze wand gevraagd of nodig was maar niet getoetst is, elk
    /// met reden. Niet leeg ⇒ nooit "voldoet".
    pub niet_getoetst: Vec<String>,
    /// Uitgangspunten, gebruikte NB-waarden met bron, en aannames.
    pub notes: Vec<String>,
}
