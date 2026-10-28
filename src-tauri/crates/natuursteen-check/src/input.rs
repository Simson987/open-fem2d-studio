//! Invoer van de natuursteentoets (issue #99).
//!
//! Eenheden: doorsnede en opleglengte in mm, overspanning in m, sterkten en
//! E-modulus in N/mm², krachten in kN, momenten in kNm, lijnlasten in kN/m,
//! volumiek gewicht in kN/m³. Normaalkracht: DRUK POSITIEF (zoals de
//! metselwerktoets; een natuurstenen element draagt vooral druk).

use crate::statistiek::Verdeling;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Een waarde die niet uit een norm volgt maar uit een richtlijn, een
/// productverklaring of een eigen keuze — altijd met haar bron. Een lege
/// bron wordt geweigerd.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct Normwaarde {
    pub waarde: f64,
    pub bron: String,
}

/// Een sterkte: uit losse proefresultaten (karakteristieke waarde volgens
/// NEN-EN 1990 bijlage D) of als opgegeven karakteristieke waarde.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(tag = "soort")]
#[serde(deny_unknown_fields)]
pub enum SterkteOpgave {
    /// De losse proefuitkomsten (minstens 3) en hun verdeling; `bron` is het
    /// proefrapport.
    Proefresultaten { waarden: Vec<f64>, verdeling: Verdeling, bron: String },
    /// Een opgegeven karakteristieke waarde, bijvoorbeeld de "lower expected
    /// value" uit een productverklaring (EN 1469 / EN 12372), met bron.
    Karakteristiek { waarde: f64, bron: String },
}

/// Proefmethode voor de buigsterkte. Alleen voor het rapport: de toets
/// rekent niet om tussen de methoden.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub enum Buigproef {
    /// EN 12372: geconcentreerde last (driepuntsbuiging).
    En12372,
    /// EN 13161: constant moment (vierpuntsbuiging); doorgaans lager.
    En13161,
}

/// Een factor ≤ 1 op de sterkte voor vochttoestand, vorst, belastingsduur of
/// iets anders, met bron.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct Reductiefactor {
    /// Bijvoorbeeld "vochttoestand", "vorst", "belastingsduur".
    pub naam: String,
    /// 0 < waarde ≤ 1.
    pub waarde: f64,
    pub bron: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct NatuursteenMateriaal {
    /// Naam van de steen, bijvoorbeeld "Belgisch hardsteen".
    pub steensoort: String,
    pub buigproef: Buigproef,
    /// Buigsterkte (EN 12372 of EN 13161), N/mm².
    pub buigsterkte: SterkteOpgave,
    /// Druksterkte (EN 1926), N/mm². Nodig voor druk en oplegdruk.
    #[serde(default)]
    #[ts(optional)]
    pub druksterkte: Option<SterkteOpgave>,
    /// Karakteristieke schuifsterkte `f_vk`, N/mm², met bron. Er is geen
    /// EN-proefnorm voor; zonder deze waarde wordt afschuiving niet getoetst.
    #[serde(default)]
    #[ts(optional)]
    pub schuifsterkte: Option<Normwaarde>,
    /// Materiaalfactor `γ_M`, met bron (richtlijn of eigen keuze).
    pub gamma_m: Normwaarde,
    /// Factoren voor vocht, vorst en belastingsduur, elk met bron. Verplicht
    /// veld; een lege lijst betekent uitdrukkelijk "geen".
    pub reductiefactoren: Vec<Reductiefactor>,
    /// Elasticiteitsmodulus (EN 14146), N/mm², met bron. Nodig voor de doorbuiging.
    #[serde(default)]
    #[ts(optional)]
    pub e_modulus: Option<Normwaarde>,
    /// Volumiek gewicht (EN 1936), kN/m³, met bron. Nodig als het eigen
    /// gewicht moet worden meegenomen.
    #[serde(default)]
    #[ts(optional)]
    pub volumiek_gewicht: Option<Normwaarde>,
}

/// Soort element — alleen voor kop en rapport; het rekenschema volgt uit de belasting.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub enum ElementSoort {
    Latei,
    Dorpel,
    Consoleplaat,
    Vloerplaat,
    Traptrede,
    Gevelplaat,
}

/// Rechthoekige doorsnede `b × h` (bij een plaat: b = strookbreedte).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct Doorsnede {
    pub b_mm: f64,
    pub h_mm: f64,
}

/// Statisch schema van een ligger.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
pub enum Liggerschema {
    /// Vrij opgelegd op twee steunpunten; puntlast in het midden.
    VrijOpgelegd,
    /// Ingeklemde console; puntlast aan het vrije eind.
    Uitkragend,
}

/// De belasting in de uiterste grenstoestand.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(tag = "soort")]
#[serde(deny_unknown_fields)]
pub enum Belasting {
    /// Rekenwaarden van de snedekrachten in de maatgevende doorsnede.
    Krachten { m_ed_knm: f64, v_ed_kn: f64, n_ed_kn: f64 },
    /// Een ligger met een gelijkmatig verdeelde rekenlast en een puntlast;
    /// de toets bepaalt `M_Ed` en `V_Ed`. `gamma_g` (met bron) neemt het
    /// eigen gewicht mee (vraagt het volumiek gewicht van het materiaal);
    /// weglaten = `q_ed` bevat het eigen gewicht al.
    Ligger {
        schema: Liggerschema,
        l_m: f64,
        q_ed_kn_m: f64,
        f_ed_kn: f64,
        #[serde(default)]
        #[ts(optional)]
        gamma_g: Option<Normwaarde>,
    },
}

/// Oplegdruk onder een oplegging: `σ = F_Ed / (a · b)`.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct Oplegging {
    pub f_ed_kn: f64,
    /// Opleglengte in de lengterichting, mm.
    pub a_mm: f64,
}

/// Doorbuiging in de bruikbaarheidsgrenstoestand (alleen bij `Ligger`).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct Doorbuiging {
    /// Representatieve lijnlast zonder eigen gewicht, kN/m (het eigen gewicht
    /// komt erbij als `gamma_g` bij de belasting is opgegeven).
    pub q_ser_kn_m: f64,
    pub f_ser_kn: f64,
    /// De grens als noemer: `w ≤ l / grens`, met bron.
    pub grens: Normwaarde,
}

/// Verankering van een gevelplaat: breuklast bij het ankergat (EN 13364)
/// tegen de ankerkracht.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct Verankering {
    /// Breuklast per anker (EN 13364), kN.
    pub breuklast: SterkteOpgave,
    /// Factor op de karakteristieke breuklast, met bron.
    pub gamma: Normwaarde,
    /// Rekenwaarde van de ankerkracht (wind en eigen gewicht), kN.
    pub f_ed_kn: f64,
}

/// Invoer voor één natuurstenen element.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/natuursteen/")]
#[serde(deny_unknown_fields)]
pub struct NatuursteenElementInput {
    pub element_id: u32,
    pub naam: String,
    pub soort: ElementSoort,
    pub materiaal: NatuursteenMateriaal,
    pub doorsnede: Doorsnede,
    /// Is het element zijdelings gesteund (bijv. ingemetseld of verlijmd)?
    /// Verplicht, geen standaard: bij `false` en `h > b` wordt kip als
    /// "niet getoetst" gemeld.
    pub zijdelings_gesteund: bool,
    pub belasting: Belasting,
    #[serde(default)]
    #[ts(optional)]
    pub oplegging: Option<Oplegging>,
    #[serde(default)]
    #[ts(optional)]
    pub doorbuiging: Option<Doorbuiging>,
    #[serde(default)]
    #[ts(optional)]
    pub verankering: Option<Verankering>,
}
