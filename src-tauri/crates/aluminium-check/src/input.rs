//! Invoer van de aluminiumtoets.

use mechanics::ForcePoint;
use nen_en_1999_1_1::AluDoorsnede;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Of de staaf gelast is. Er is bewust GEEN standaardwaarde: een staaf
/// zonder opgave mag niet stil als ongelast doorgaan (issue #5), want zonder
/// HAZ-reductie is een gelaste doorsnede onveilig getoetst.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
pub enum Lasstatus {
    /// Niet opgegeven: de toets rekent veilig (alsof gelast) maar geeft geen
    /// "voldoet" — de status blijft "niet volledig getoetst".
    Onbekend,
    /// Bevestigd: nergens in de staaf een las.
    Geen,
    /// Gelast (MIG). Vereenvoudiging: de HELE doorsnede ligt in de HAZ
    /// (§6.1.6); de werkelijke zone `b_haz` wordt niet bepaald. Dat is veilig
    /// voor zowel langs- als dwarslassen.
    Gelast,
}

/// Invoer voor één aluminium staaf.
///
/// Krachten in kN en kNm, zoals bij de andere kernen: `n_ed` TREK-positief,
/// `my_ed` positief = trek in de onderste vezel.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/aluminium/")]
#[serde(deny_unknown_fields)]
pub struct AluminiumBeamCheckInput {
    pub beam_id: u32,
    /// Naam voor de kopregel, bijv. "ALU-I 200x100x6x10".
    pub section_name: String,
    pub doorsnede: AluDoorsnede,
    /// Legering, bijv. "EN AW-6082 T6" (zie `list_aluminium_alloys`).
    pub legering: String,
    pub lasstatus: Lasstatus,
    /// Staaflengte in m.
    pub length_m: f64,
    pub forces_envelope: Vec<ForcePoint>,
    /// Kniklengte voor knik in het vlak (om de sterke as y), m.
    pub buckling_length_y_m: f64,
    /// Kniklengte voor knik uit het vlak (om de zwakke as z), m.
    pub buckling_length_z_m: f64,
    /// De gebruiker verklaart dat kip (§6.3.2) niet kan optreden: de gedrukte
    /// rand is over de hele lengte zijdelings gesteund. Standaard `false`:
    /// dan blijft kip bij een buigend moment "niet getoetst".
    #[serde(default)]
    pub zijdelings_gesteund: bool,
    /// Grootste BGT-doorbuiging (mm, absolute waarde), optioneel.
    #[serde(default)]
    #[ts(optional)]
    pub deflection_mm: Option<f64>,
    /// Doorbuigingsgrens als noemer: `w ≤ L / noemer`. EN 1999-1-1 §7.2 geeft
    /// geen grens; het is een projecteis. Optioneel.
    #[serde(default)]
    #[ts(optional)]
    pub deflection_limit_numerator: Option<f64>,
}
