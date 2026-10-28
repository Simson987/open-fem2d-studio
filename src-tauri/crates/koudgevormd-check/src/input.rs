//! Invoer van de toets voor koudgevormde profielen.

use mechanics::ForcePoint;
use nen_en_1993_1_3::KvDoorsnede;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Invoer voor één koudgevormde staaf.
///
/// Krachten in kN en kNm, zoals bij de andere kernen: `n_ed` TREK-positief,
/// `my_ed` positief = trek in de onderste vezel.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/koudgevormd/")]
#[serde(deny_unknown_fields)]
pub struct KoudgevormdBeamCheckInput {
    pub beam_id: u32,
    /// Naam voor de kopregel, bijv. "KV-C 200x70x20x2 r3".
    pub section_name: String,
    /// Doorsnede met buitenwerkse maten en de KERNdikte (zonder zinklaag).
    pub doorsnede: KvDoorsnede,
    /// Staalsoort uit tabel 3.1a, bijv. "S350GD" (zie `list_koudgevormd_staalsoorten`).
    pub staalsoort: String,
    /// Staaflengte in m.
    pub length_m: f64,
    pub forces_envelope: Vec<ForcePoint>,
    /// Kniklengte voor knik om de sterke as (y), m.
    pub buckling_length_y_m: f64,
    /// Kniklengte voor knik om de zwakke as (z), m.
    pub buckling_length_z_m: f64,
    /// Kniklengte voor (buig)torsieknik `l_T` (m). Weglaten = de staaflengte
    /// (gaffelopleggingen aan beide einden, welving vrij).
    #[serde(default)]
    #[ts(optional)]
    pub buckling_length_t_m: Option<f64>,
    /// De gebruiker verklaart dat de staaf over de hele lengte zijdelings EN
    /// tegen wringen gesteund is (bijv. door dakbeschot): kip (§6.2.4) kan dan
    /// niet optreden en een Z buigt om de y-as. Standaard `false`: kip blijft
    /// bij een buigend moment "niet getoetst".
    #[serde(default)]
    pub zijdelings_gesteund: bool,
    /// Grootste BGT-doorbuiging (mm, absolute waarde) uit de analyse met de
    /// bruto doorsnede, optioneel.
    #[serde(default)]
    #[ts(optional)]
    pub deflection_mm: Option<f64>,
    /// Doorbuigingsgrens als noemer: `w ≤ L / noemer` (projecteis). Optioneel.
    #[serde(default)]
    #[ts(optional)]
    pub deflection_limit_numerator: Option<f64>,
}
