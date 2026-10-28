//! Resultaat van de natuursteentoets — op het gedeelde `NamedCheck`-contract.

use crate::input::ElementSoort;
use crate::statistiek::Statistiek;
use nen_en_1993_1_1_section::CheckStatus;
use serde::{Deserialize, Serialize};
use steel_check::NamedCheck;
use ts_rs::TS;

/// Herkomst van een karakteristieke sterkte.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub struct SterkteAfleiding {
    /// Karakteristieke waarde, in de eenheid van de grootheid (N/mm² of kN).
    pub karakteristiek: f64,
    /// Ingevuld als de waarde uit proefresultaten is afgeleid.
    pub statistiek: Option<Statistiek>,
    pub bron: String,
}

/// De rekenwaarden van de sterkten.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub struct NatuursteenSterkte {
    pub gamma_m: f64,
    /// Product van de reductiefactoren (1 als er geen zijn).
    pub k_totaal: f64,
    pub buig: SterkteAfleiding,
    /// `f_fd = k · f_fk / γ_M`.
    pub f_fd_mpa: f64,
    pub druk: Option<SterkteAfleiding>,
    pub f_cd_mpa: Option<f64>,
    pub f_vk_mpa: Option<f64>,
    pub f_vd_mpa: Option<f64>,
}

/// De gebruikte snedekrachten (UGT). `N` druk positief.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub struct Rekenkrachten {
    pub m_ed_knm: f64,
    pub v_ed_kn: f64,
    pub n_ed_kn: f64,
    /// Bij een ligger: de totale lijnlast incl. eventueel eigen gewicht.
    pub q_totaal_kn_m: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub struct NatuursteenElementResult {
    pub element_id: u32,
    pub naam: String,
    pub soort: ElementSoort,
    pub norm: String,
    pub sterkte: Option<NatuursteenSterkte>,
    pub krachten: Option<Rekenkrachten>,
    pub checks: Vec<NamedCheck>,
    pub uc_max: f64,
    /// `NotOk` zodra één toets niet voldoet; anders `NotApplicable` zolang
    /// er iets in `niet_getoetst` staat; alleen dan `Ok`.
    pub status: CheckStatus,
    pub governing_check_id: String,
    /// Wat gevraagd of nodig was maar niet getoetst is, elk met reden.
    pub niet_getoetst: Vec<String>,
    /// Uitgangspunten, opgegeven waarden met bron, en aannames.
    pub notes: Vec<String>,
}
