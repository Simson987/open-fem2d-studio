//! Resultaat van de aluminiumtoets — op het gedeelde `NamedCheck`-contract,
//! zodat toetsingspaneel en rapport er zonder eigen weergave mee overweg
//! kunnen.

use crate::input::Lasstatus;
use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1999_1_1::{AluminiumLegering, Deelrol, Deelsoort};
use serde::{Deserialize, Serialize};
use steel_check::NamedCheck;
use ts_rs::TS;

/// De klassering van één plaatdeel voor één belasting (druk of buiging).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub struct AluDeelKlasse {
    pub rol: Deelrol,
    pub soort: Deelsoort,
    /// "druk" of "buiging".
    pub belasting: String,
    pub b_mm: f64,
    pub t_mm: f64,
    /// `η` (1 bij uniforme druk, 0,4 voor een lijf in zuivere buiging).
    pub eta: f64,
    pub beta: f64,
    /// `β₁`, `β₂`, `β₃` (al met ε vermenigvuldigd).
    pub beta_1: f64,
    pub beta_2: f64,
    pub beta_3: f64,
    pub klasse: u8,
    pub rho_c: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub struct AluClassificatie {
    pub epsilon: f64,
    /// Rijen van tabel 6.2 voor gelaste delen gebruikt?
    pub gelast: bool,
    pub klasse_druk: u8,
    pub klasse_buiging: u8,
    pub delen: Vec<AluDeelKlasse>,
}

/// Bruto en effectieve grootheden die in de toetsen gebruikt zijn (mm-eenheden).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub struct AluGrootheden {
    pub a_mm2: f64,
    pub i_y_mm4: f64,
    pub i_z_mm4: f64,
    pub w_el_y_mm3: f64,
    pub w_pl_y_mm3: f64,
    pub a_v_mm2: f64,
    /// `A_eff` bij druk: lokale plooi en (bij een las) HAZ.
    pub a_eff_mm2: f64,
    /// Weerstandsmoment waarmee `M_o,Rd` gerekend is (`α·W`).
    pub w_o_mm3: f64,
    /// `W_net` voor `M_u,Rd`.
    pub w_net_mm3: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub struct AluminiumBeamCheckResult {
    pub beam_id: u32,
    pub section_name: String,
    /// Aanduiding van de legering, bijv. "EN AW-6082 T6". Ook het
    /// herkenningsveld van dit resultaattype in de frontend.
    pub legering: String,
    /// De gebruikte tabelrij; `None` als de legering niet gevonden is.
    pub materiaal: Option<AluminiumLegering>,
    pub lasstatus: Lasstatus,
    pub norm: String,
    pub classificatie: Option<AluClassificatie>,
    pub grootheden: Option<AluGrootheden>,
    pub checks: Vec<NamedCheck>,
    pub uc_max: f64,
    /// `NotOk` zodra één toets niet voldoet; anders `NotApplicable` zolang
    /// er iets in `niet_getoetst` staat; alleen dan `Ok`.
    pub status: CheckStatus,
    pub governing_check_id: String,
    /// Wat voor déze staaf getoetst had moeten worden maar niet getoetst is,
    /// elk met reden. Niet leeg ⇒ nooit "voldoet".
    pub niet_getoetst: Vec<String>,
    pub notes: Vec<String>,
}
