//! Resultaat van de toets voor koudgevormde profielen — op het gedeelde
//! `NamedCheck`-contract.

use nen_en_1993_1_1_section::CheckStatus;
use nen_en_1993_1_3::{EffectieveDoorsnede, KvStaalsoort};
use serde::{Deserialize, Serialize};
use steel_check::NamedCheck;
use ts_rs::TS;

/// Bruto grootheden (hartlijnmodel, met `δ` van §5.1(4)), mm-eenheden.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub struct KvGrootheden {
    pub a_mm2: f64,
    /// Zwaartepunt ten opzichte van de lijfhartlijn (y) en de halve hoogte (z).
    pub y_c_mm: f64,
    pub i_y_mm4: f64,
    pub i_z_mm4: f64,
    pub i_yz_mm4: f64,
    pub i_t_mm4: f64,
    pub i_w_mm6: f64,
    /// Dwarskrachtcentrum ten opzichte van het zwaartepunt.
    pub y_0_mm: f64,
    pub z_0_mm: f64,
    pub w_el_y_mm3: f64,
    /// `δ` van §5.1(4) (0 = hoeken verwaarloosd, §5.1(3)).
    pub delta: f64,
    /// Gemiddelde vloeigrens `f_ya` (§3.2.2), alleen voor trek gebruikt.
    pub f_ya: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
pub struct KoudgevormdBeamCheckResult {
    pub beam_id: u32,
    pub section_name: String,
    /// Staalsoort, bijv. "S350GD". Ook het herkenningsveld van dit
    /// resultaattype in de frontend.
    pub koudgevormd_staalsoort: String,
    /// De gebruikte rij van tabel 3.1a; `None` als ze niet gevonden is.
    pub materiaal: Option<KvStaalsoort>,
    pub norm: String,
    pub grootheden: Option<KvGrootheden>,
    pub effectief_druk: Option<EffectieveDoorsnede>,
    pub effectief_buiging: Option<EffectieveDoorsnede>,
    pub checks: Vec<NamedCheck>,
    pub uc_max: f64,
    /// `NotOk` zodra één toets niet voldoet; anders `NotApplicable` zolang er
    /// iets in `niet_getoetst` staat; alleen dan `Ok`.
    pub status: CheckStatus,
    pub governing_check_id: String,
    /// Wat voor déze staaf getoetst had moeten worden maar niet getoetst is,
    /// elk met reden. Niet leeg ⇒ nooit "voldoet".
    pub niet_getoetst: Vec<String>,
    pub notes: Vec<String>,
}
