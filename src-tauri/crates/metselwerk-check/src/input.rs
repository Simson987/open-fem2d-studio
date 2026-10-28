//! Invoer van de metselwerktoets (issue #98).
//!
//! Eenheden: wanddikte en opleglengten in mm, hoogten en lengten in m,
//! sterkten in N/mm², krachten in kN (per meter wand: kN/m en kNm/m).
//! Drukkracht is POSITIEF (anders dan bij de staaftoetsen: een wand draagt
//! alleen druk, en een negatieve waarde wordt als "geen druk" geweigerd).

use nen_en_1996_1_1::slankheid::Steunranden;
use nen_en_1996_1_1::{Mortelsoort, Steengroep, Steensoort};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Een nationaal te kiezen waarde (NDP) met haar bron, bijvoorbeeld
/// "NEN-EN 1996-1-1 NB tabel 3.3" of een productverklaring. Een lege bron
/// wordt geweigerd: zo'n waarde is niet te verantwoorden.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct Normwaarde {
    pub waarde: f64,
    pub bron: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct MetselwerkMateriaal {
    pub steensoort: Steensoort,
    pub steengroep: Steengroep,
    pub mortel: Mortelsoort,
    /// Genormaliseerde gemiddelde druksterkte van de steen `f_b` (EN 772-1), N/mm².
    pub f_b_mpa: f64,
    /// Druksterkte van de mortel `f_m`, N/mm². Verplicht bij algemene mortel.
    #[serde(default)]
    #[ts(optional)]
    pub f_m_mpa: Option<f64>,
    /// De constante `K` van §3.6.1.2 (NDP, tabel 3.3 of NB), met bron.
    pub k: Normwaarde,
    /// Is er een langsvoeg (een voeg evenwijdig aan het wandvlak)? Dan wordt
    /// `K` met 0,8 vermenigvuldigd (§3.6.1.2). Verplicht, geen standaard.
    pub langsvoeg: bool,
    /// Materiaalfactor `γ_M` (NDP, §2.4.3 of NB), met bron.
    pub gamma_m: Normwaarde,
    /// `K_E` in `E = K_E · f_k` (NDP, §3.7.2), met bron. Nodig voor Φ_m.
    #[serde(default)]
    #[ts(optional)]
    pub k_e: Option<Normwaarde>,
    /// Eindkruipcoëfficiënt `φ_∞` (NDP, tabel 3.8), met bron. Nodig voor Φ_m.
    #[serde(default)]
    #[ts(optional)]
    pub phi_inf: Option<Normwaarde>,
    /// Initiële schuifsterkte `f_vk0` (NDP, tabel 3.4), N/mm², met bron.
    #[serde(default)]
    #[ts(optional)]
    pub f_vk0_mpa: Option<Normwaarde>,
    /// Zijn de stootvoegen gevuld (§3.6.2)? Verplicht, geen standaard.
    pub stootvoegen_gevuld: bool,
    /// Buigtreksterkte met het breukvlak evenwijdig aan de lintvoegen
    /// `f_xk1` (NDP, §3.6.3), N/mm², met bron.
    #[serde(default)]
    #[ts(optional)]
    pub f_xk1_mpa: Option<Normwaarde>,
    /// Buigtreksterkte met het breukvlak loodrecht op de lintvoegen
    /// `f_xk2` (NDP, §3.6.3), N/mm², met bron.
    #[serde(default)]
    #[ts(optional)]
    pub f_xk2_mpa: Option<Normwaarde>,
}

/// Een enkelsteens wand of penant (t_ef = t, §5.5.1.3).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct WandGeometrie {
    /// Wanddikte `t`, mm.
    pub t_mm: f64,
    /// Vrije verdiepingshoogte `h`, m.
    pub h_m: f64,
    /// Lengte van het getoetste wanddeel (wand of penant), m. Bepaalt de
    /// doorsnede `A = t·l` (§6.1.2.1), de lengte voor afschuiving en de
    /// spreiding van een geconcentreerde last.
    pub l_m: f64,
    pub steunranden: Steunranden,
    /// Wordt de wand boven en onder door gewapend-betonvloeren gesteund
    /// (ρ_2 = 0,75, §5.5.1.2)? Bij `false` geldt ρ_2 = 1,0.
    pub betonvloeren: bool,
}

/// Verticale belasting per meter wand (UGT), boven, midden en onder. `M`
/// is het moment uit het vlak inclusief het aandeel van horizontale
/// belasting (dus `M/N` = `M_id/N_id + e_he`). De normaalkracht moet het
/// eigen gewicht van de wand tot dat niveau bevatten.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct VerticaleBelasting {
    pub n_boven_kn_m: f64,
    pub m_boven_knm_m: f64,
    pub n_midden_kn_m: f64,
    pub m_midden_knm_m: f64,
    pub n_onder_kn_m: f64,
    pub m_onder_knm_m: f64,
}

/// Een geconcentreerde last op de wand, bijvoorbeeld de oplegging van een
/// latei of balk (§6.1.3).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct GeconcentreerdeLast {
    pub naam: String,
    /// `N_Edc`, kN.
    pub n_edc_kn: f64,
    /// Opleglengte langs de wand, mm.
    pub l_b_mm: f64,
    /// Opleggingsbreedte dwars op de wand (≤ t), mm.
    pub b_mm: f64,
    /// `a_1`: afstand van het wandeinde tot de dichtstbijzijnde rand van de
    /// oplegging, mm.
    pub a1_mm: f64,
    /// `h_c`: hoogte van de wand tot het niveau van de last, m.
    pub h_c_m: f64,
    /// Excentriciteit van de last ten opzichte van het wandhart, mm (§6.1.3:
    /// hoogstens t/4).
    pub e_mm: f64,
}

/// Afschuiving in het vlak van het wanddeel (§6.2), over de hele lengte `l`.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct Afschuiving {
    /// `V_Ed`, kN.
    pub v_ed_kn: f64,
    /// Gelijktijdige drukkracht op het wanddeel, kN — de ongunstigste, dus
    /// doorgaans de KLEINSTE (§6.2).
    pub n_ed_kn: f64,
    /// Gelijktijdig moment in het vlak van de wand op het getoetste niveau, kNm.
    pub m_ed_knm: f64,
}

/// Richting van het breukvlak bij buiging uit het vlak (§3.6.3, figuur 3.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
pub enum Breukvlak {
    /// Evenwijdig aan de lintvoegen (`f_xk1`): de strook overspant verticaal.
    EvenwijdigAanLintvoegen,
    /// Loodrecht op de lintvoegen (`f_xk2`): de strook overspant horizontaal.
    LoodrechtOpLintvoegen,
}

/// Buiging uit het vlak van een wandstrook van 1 m (§6.3.1).
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct BuigingUitVlak {
    /// `M_Ed`, kNm per meter.
    pub m_ed_knm_m: f64,
    pub breukvlak: Breukvlak,
}

/// Invoer voor één metselwerkwand.
#[derive(Clone, Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../../design-mockup/src/lib/types/metselwerk/")]
#[serde(deny_unknown_fields)]
pub struct MetselwerkWandInput {
    pub wand_id: u32,
    pub naam: String,
    pub materiaal: MetselwerkMateriaal,
    pub geometrie: WandGeometrie,
    #[serde(default)]
    #[ts(optional)]
    pub verticaal: Option<VerticaleBelasting>,
    #[serde(default)]
    pub geconcentreerd: Vec<GeconcentreerdeLast>,
    #[serde(default)]
    #[ts(optional)]
    pub afschuiving: Option<Afschuiving>,
    #[serde(default)]
    #[ts(optional)]
    pub buiging: Option<BuigingUitVlak>,
}
