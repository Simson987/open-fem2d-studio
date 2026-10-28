//! Versioned Open FEM boundary around the pinned external 3D frame engine.
//!
//! The application and project format only depend on the types in this crate.
//! Engine types are constructed at this boundary, so another frame, plate,
//! or solid engine can implement the same application contract later.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

mod bedding;
mod globale_lasten;
mod knoopdraaiing;
mod kruisregel;
mod mechanisme;
mod montage;
mod opleggingen;
mod plaatbedding;
mod schijven;
mod shell;
mod orthotroop;
mod koppelingen;
pub use koppelingen::NodeLink3D;
pub use orthotroop::PlateOrthotropy3D;
mod trek_alleen;
mod tweede_orde;
mod veldmaximum;
mod mechanismevorm;
mod verloop;
pub use shell::{
    PlateAxes3D, PlateExtreme3D, PlateSummary3D, ShellElementResult3D, ShellNodeResult3D, ShellValues3D,
};

use rekenkern::{
    postprocess::diagrams_3d::{compute_diagrams_3d, ElementDiagram3D as EngineElementDiagram3D},
    solver::linear::solve_3d,
    types::{
        AnalysisResults3D, SolverElement3D, SolverInput3D, SolverLoad3D, SolverMaterial,
        SolverDistributedLoad3D, SolverNodalLoad3D, SolverNode3D, SolverPointLoad3D,
        SolverPlateElement, SolverQuadElement, SolverSection3D, SolverThermalLoad3D,
        SolverSupport3D,
    },
};
use serde::{Deserialize, Serialize};

/// Versie 2 voegt platen (schaalelementen), vlaklasten en tussenknopen op
/// staven toe. Een verzoek met versie 1 (alleen staven) blijft geldig.
pub const CONTRACT_VERSION: u32 = 2;
/// Oudste contractversie die nog wordt aangenomen.
pub const MIN_CONTRACT_VERSION: u32 = 1;
pub const ENGINE_ID: &str = "open-fem-3d";
pub const ENGINE_NAME: &str = "Open FEM 3D (externe kern)";
pub const ENGINE_REVISION: &str = "7d87e551b765c88956df95b375e0ef0befda53f7";

/// Aantal kernelementen per stuk staaf (tussen twee echte knopen: de
/// eindknopen, tussenknopen en grensknopen van een verlopende staaf) in de
/// knikanalyse en de tweede orde (controle oktober 2026, K4, #186). Eén
/// kubisch element met de consistente geometrische stijfheid geeft voor een
/// pendelstaaf N_cr = 12·EI/L² in plaats van π²·EI/L² (+21,6 %), en bij
/// scharnieren aan beide einden blijft alleen de koordestijfheid N/L over: de
/// staaf heeft dan geen eigen knikvorm. Met vier delen ligt N_cr 0,05 %
/// (scharnierend) tot 0,75 % (aan beide einden ingeklemd) boven de exacte
/// waarde. Het aantal geldt PER STUK, ongeacht het aantal stukken: een stuk
/// tussen twee tussensteunen knikt zelf, en twee delen per stuk gaven daar
/// nog +0,75 % (vier stukken van één element zelfs +21,6 %).
///
/// Alleen staven die in de eerste orde gedrukt zijn worden onderverdeeld
/// (`gedrukte_staven`): een getrokken of krachtloze staaf knikt niet zelf, en
/// voor haar aandeel in een knikvorm van het geheel is één element nauwkeurig
/// genoeg (de koordedraaiing zit exact in K_G). Dat houdt het stelsel van de
/// tweede orde zo klein als het kan. De adapter knipt de staaf intern, net als
/// een verlopende staaf (#73), en voegt de uitkomst weer samen tot de ene
/// staaf van het model. Een lineaire berekening rekent op het ongeknipte
/// model; alleen haar knikanalyse gebruikt het onderverdeelde.
pub(crate) const KNIKDELEN: usize = 4;

fn default_contract_version() -> u32 { CONTRACT_VERSION }
fn default_max_iterations() -> usize { 50 }
fn default_tolerance() -> f64 { 1e-8 }
fn default_buckling_modes() -> usize { 3 }

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AnalysisKind {
    Linear,
    PDelta,
}

impl Default for AnalysisKind {
    fn default() -> Self { Self::PDelta }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node3D {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material3D {
    pub id: usize,
    pub name: String,
    /// Young's modulus in N/mm² (MPa).
    pub e_mpa: f64,
    pub nu: f64,
    /// Expliciete schuifmodulus in N/mm². De externe isotrope kern gebruikt
    /// anders G = E / (2(1+nu)); hout heeft een onafhankelijke G_mean.
    #[serde(default)]
    pub g_mpa: Option<f64>,
    /// Lineaire uitzettingscoëfficiënt in 1/K. Ontbrekend gebruikt 12e-6.
    #[serde(default)]
    pub alpha_per_k: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section3D {
    pub id: usize,
    pub name: String,
    pub area_m2: f64,
    pub iy_m4: f64,
    pub iz_m4: f64,
    pub torsion_j_m4: f64,
    #[serde(default)]
    pub shear_area_y_m2: Option<f64>,
    #[serde(default)]
    pub shear_area_z_m2: Option<f64>,
    /// Werkelijke doorsnedehoogte in m langs lokaal z: de afstand tussen de
    /// vezels waartussen `deltaTGradientZK` werkt (EN 1991-1-5 §4(3), ΔT_M
    /// tussen boven- en onderkant). Verplicht bij een gradiënt in z (#221).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height_m: Option<f64>,
    /// Werkelijke doorsnedebreedte in m langs lokaal y, voor `deltaTGradientYK`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width_m: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndReleases3D {
    #[serde(default)] pub my_start: bool,
    #[serde(default)] pub my_end: bool,
    #[serde(default)] pub mz_start: bool,
    #[serde(default)] pub mz_end: bool,
    #[serde(default)] pub torsion_start: bool,
    #[serde(default)] pub torsion_end: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member3D {
    pub id: usize,
    pub start_node_id: usize,
    pub end_node_id: usize,
    pub material_id: usize,
    pub section_id: usize,
    #[serde(default)]
    pub releases: EndReleases3D,
    /// Roll around local member x, in radians.
    #[serde(default)]
    pub roll_angle_rad: Option<f64>,
    /// Knopen op de staafas tussen begin- en eindknoop, bijvoorbeeld de
    /// randknopen van een plaat langs deze staaf. De adapter knipt de staaf
    /// daar voor de kern en voegt krachten en lijnen weer samen tot deze ene
    /// staaf; staaflasten behouden hun positie langs de hele staaf.
    #[serde(default)]
    pub intermediate_node_ids: Vec<usize>,
    /// Trek-alleen: de staaf doet alleen mee zolang zij niet op druk staat.
    #[serde(default)]
    pub tension_only: bool,
    /// Bedding (grond) onder of naast de staaf; zie de module `bedding`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedding: Option<Bedding3D>,
    /// Verlopende staaf (#73): de staaf in n = lengte van deze lijst gelijke
    /// delen langs haar lengte (2 ≤ n ≤ 64); deel i, vanaf de beginknoop,
    /// rekent met doorsnede `partSectionIds[i]`. `sectionId` blijft de
    /// doorsnede van het begin (weergave en terugval). Zie de module `verloop`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub part_section_ids: Option<Vec<usize>>,
}

/// Bedding (Winkler) van een staaf: grondveren langs de hele staaf (#106).
/// Minstens één van beide beddingsconstanten is gegeven.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bedding3D {
    /// Beddingsconstante k in kN/m³ voor de verticale richting (globaal Z; de
    /// grond ligt onder de staaf). Niet toegestaan bij een (bijna) verticale
    /// staaf (|e_x·Z| > 0,95).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_kn_per_m3: Option<f64>,
    /// Contactbreedte b in m; de lijnstijfheid van de grond is k·b in kN/m per m.
    pub width_m: f64,
    /// Zijdelingse beddingsconstante in kN/m³: horizontaal loodrecht op de
    /// staafas, naar beide zijden en altijd lineair. Bij een staaf die steiler
    /// staat dan 45° (een (schoor)paal) werkt zij rondom, in twee richtingen
    /// loodrecht op de as; bij een loodrechte paal in globaal X en Y.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k_lateral_kn_per_m3: Option<f64>,
    /// Alleen druk: de verticale veren vallen weg waar de staaf omhoog komt.
    #[serde(default, skip_serializing_if = "is_false")]
    pub compression_only: bool,
}

/// Starre schijf in het horizontale vlak: X, Y en de rotatie om Z van alle
/// knopen bewegen als één star lichaam. Alle knopen liggen binnen 1 mm op
/// dezelfde hoogte en een knoop hoort bij hoogstens één schijf.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Diaphragm3D {
    pub id: usize,
    pub node_ids: Vec<usize>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support3D {
    pub node_id: usize,
    pub ux: bool,
    pub uy: bool,
    pub uz: bool,
    pub rx: bool,
    pub ry: bool,
    pub rz: bool,
    /// Translational spring stiffnesses in global axes, in kN/m.
    #[serde(default)] pub kx_kn_per_m: Option<f64>,
    #[serde(default)] pub ky_kn_per_m: Option<f64>,
    #[serde(default)] pub kz_kn_per_m: Option<f64>,
    /// Rotational spring stiffnesses in global axes, in kNm/rad.
    #[serde(default)] pub krx_knm_per_rad: Option<f64>,
    #[serde(default)] pub kry_knm_per_rad: Option<f64>,
    #[serde(default)] pub krz_knm_per_rad: Option<f64>,
    /// Opgelegde globale verplaatsingen op geblokkeerde vrijheidsgraden.
    /// Translaties zijn in m; rotaties in rad.
    #[serde(default)] pub ux_prescribed_m: Option<f64>,
    #[serde(default)] pub uy_prescribed_m: Option<f64>,
    #[serde(default)] pub uz_prescribed_m: Option<f64>,
    #[serde(default)] pub rx_prescribed_rad: Option<f64>,
    #[serde(default)] pub ry_prescribed_rad: Option<f64>,
    #[serde(default)] pub rz_prescribed_rad: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodalLoad3D {
    pub id: usize,
    pub node_id: usize,
    /// Forces in kN and moments in kNm.
    pub fx: f64,
    pub fy: f64,
    pub fz: f64,
    pub mx: f64,
    pub my: f64,
    pub mz: f64,
}

/// Trapezoidal line load in the member's local y/z axes.
/// Intensities are kN/m; optional positions are metres from the start node.
///
/// Met `globalDirection` is het een globale last (#80): de intensiteit
/// `qStartKnPerM` → `qEndKnPerM` werkt met teken langs globaal X, Y of Z (Z
/// negatief = omlaag), lineair verlopend over hetzelfde bereik. Standaard per
/// meter staaflengte; met `perProjection` per meter projectie van de staaf op
/// het vlak loodrecht op de lastrichting (sneeuw op een schuine spant). De
/// lokale velden zijn dan 0 of ontbreken. De adapter ontbindt de last in de
/// lokale assen (module `globale_lasten`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberLoad3D {
    pub id: usize,
    pub member_id: usize,
    #[serde(default)]
    pub qy_start_kn_per_m: f64,
    #[serde(default)]
    pub qy_end_kn_per_m: f64,
    #[serde(default)]
    pub qz_start_kn_per_m: f64,
    #[serde(default)]
    pub qz_end_kn_per_m: f64,
    #[serde(default)]
    pub start_position_m: Option<f64>,
    #[serde(default)]
    pub end_position_m: Option<f64>,
    /// Globale lastrichting; ontbreekt bij een lokale last.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub global_direction: Option<GlobalDirection3D>,
    /// Intensiteit van een globale last bij het begin van het bereik, kN/m.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub q_start_kn_per_m: Option<f64>,
    /// Intensiteit van een globale last bij het eind van het bereik, kN/m.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub q_end_kn_per_m: Option<f64>,
    /// Globale last per meter projectie in plaats van per meter staaflengte.
    #[serde(default, skip_serializing_if = "is_false")]
    pub per_projection: bool,
}

/// Globale richting van een staafbelasting; in JSON "x", "y" of "z".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalDirection3D {
    X,
    Y,
    Z,
}

impl GlobalDirection3D {
    /// De naam in het contract: "x", "y" of "z".
    pub fn as_str(self) -> &'static str {
        match self {
            Self::X => "x",
            Self::Y => "y",
            Self::Z => "z",
        }
    }
}

impl Serialize for GlobalDirection3D {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

/// Eigen inlezing, zodat een onbekende richting een Nederlandse melding geeft.
impl<'de> Deserialize<'de> for GlobalDirection3D {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let tekst = String::deserialize(deserializer)?;
        match tekst.as_str() {
            "x" => Ok(Self::X),
            "y" => Ok(Self::Y),
            "z" => Ok(Self::Z),
            anders => Err(serde::de::Error::custom(format!(
                "onbekende globale lastrichting \"{anders}\" in globalDirection; verwacht \"x\", \"y\" of \"z\"",
            ))),
        }
    }
}

/// Concentrated force on a member in its local y/z axes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberPointLoad3D {
    pub id: usize,
    pub member_id: usize,
    pub py_kn: f64,
    pub pz_kn: f64,
    pub position_m: f64,
}

/// Temperatuurbelasting op een staaf in de lokale doorsnederichtingen.
/// De uniforme waarde en beide verschillen over de doorsnede zijn in K.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThermalLoad3D {
    pub id: usize,
    pub member_id: usize,
    pub delta_t_uniform_k: f64,
    #[serde(default)]
    pub delta_t_gradient_y_k: f64,
    #[serde(default)]
    pub delta_t_gradient_z_k: f64,
}

/// Een vlakke plaat: dikte en materiaal van al haar schaalelementen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Plate3D {
    pub id: usize,
    pub material_id: usize,
    /// Plaatdikte in m.
    pub thickness_m: f64,
    /// Bedding (grond) onder de plaat; zie de module `plaatbedding` (#107).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bedding: Option<PlateBedding3D>,
    /// Orthotrope stijfheid in plaatassen (#79, #97). Ontbreekt het veld, dan
    /// rekent de plaat isotroop met E en ν van haar materiaal.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orthotropy: Option<PlateOrthotropy3D>,
}

/// Bedding (Winkler) van een plaat: grondveren loodrecht op het plaatvlak in
/// elke plaatknoop (#107). De grond ligt aan de onderzijde, de −z-zijde van de
/// plaatassen; bij een horizontale vloer globaal −Z.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlateBedding3D {
    /// Beddingsconstante k in kN/m³ loodrecht op het plaatvlak (> 0, eindig).
    pub k_kn_per_m3: f64,
    /// Alleen druk: de veren vallen weg waar de plaat van de grond komt.
    #[serde(default, skip_serializing_if = "is_false")]
    pub compression_only: bool,
}

/// Eén schaalelement van een plaat: drie knopen (DKT+CST-driehoek) of vier
/// knopen (MITC4-vierhoek), rondgaand langs de rand. Alle elementen van één
/// plaat liggen in één vlak.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellElement3D {
    pub id: usize,
    pub plate_id: usize,
    pub node_ids: Vec<usize>,
}

/// Gelijkmatige vlaklast op een hele plaat in globale assen, kN/m² van het
/// plaatmiddenvlak. Eigen gewicht is een vlaklast −ρ·g·t in Z.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SurfaceLoad3D {
    pub id: usize,
    pub plate_id: usize,
    pub qx_kn_per_m2: f64,
    pub qy_kn_per_m2: f64,
    pub qz_kn_per_m2: f64,
}

/// Montagelasten van de trek-alleen staven: de lasten die al op het frame
/// staan wanneer de verbanden gemonteerd worden, bijvoorbeeld de permanente
/// belasting. Zelfde vorm en keuring als de gewone lasten van het verzoek;
/// opgelegde steunpuntverplaatsingen horen bij het rekengeval, niet bij de
/// montage. Zie de module `montage`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TensionOnlyFit3D {
    #[serde(default)]
    pub nodal_loads: Vec<NodalLoad3D>,
    #[serde(default)]
    pub member_loads: Vec<MemberLoad3D>,
    #[serde(default)]
    pub member_point_loads: Vec<MemberPointLoad3D>,
    #[serde(default)]
    pub thermal_loads: Vec<ThermalLoad3D>,
    #[serde(default)]
    pub surface_loads: Vec<SurfaceLoad3D>,
}

fn is_false(value: &bool) -> bool { !*value }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SolveRequest3D {
    #[serde(default = "default_contract_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub analysis: AnalysisKind,
    pub nodes: Vec<Node3D>,
    pub materials: Vec<Material3D>,
    /// Mag leeg zijn of ontbreken bij een model met alleen platen.
    #[serde(default)]
    pub sections: Vec<Section3D>,
    #[serde(default)]
    pub members: Vec<Member3D>,
    #[serde(default)]
    pub supports: Vec<Support3D>,
    #[serde(default)]
    pub nodal_loads: Vec<NodalLoad3D>,
    #[serde(default)]
    pub member_loads: Vec<MemberLoad3D>,
    #[serde(default)]
    pub member_point_loads: Vec<MemberPointLoad3D>,
    #[serde(default)]
    pub thermal_loads: Vec<ThermalLoad3D>,
    #[serde(default)]
    pub plates: Vec<Plate3D>,
    #[serde(default)]
    pub shell_elements: Vec<ShellElement3D>,
    #[serde(default)]
    pub surface_loads: Vec<SurfaceLoad3D>,
    #[serde(default)]
    pub diaphragms: Vec<Diaphragm3D>,
    /// Knoopkoppelingen (#97): een slaafknoop volgt een meesterknoop op
    /// dezelfde plek in de gekozen globale vrijheidsgraden. Zie `koppelingen`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub node_links: Vec<NodeLink3D>,
    /// Trek-alleen staven gemonteerd onder deze lasten: hun spanningsloze
    /// lengte volgt de koorde in die toestand. Ontbreekt het veld, dan zijn
    /// ze spanningsloos in de onvervormde stand, zoals voorheen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tension_only_fit: Option<TensionOnlyFit3D>,
    /// Kruisregel: van twee trek-alleen staven die elkaar kruisen blijft
    /// altijd minstens één actief (die met de grootste normaalkracht).
    #[serde(default, skip_serializing_if = "is_false")]
    pub tension_only_cross_rule: bool,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_buckling_modes")]
    pub buckling_modes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub id: String,
    pub name: String,
    pub revision: String,
    pub license: String,
    pub analyses: Vec<String>,
    pub element_families: Vec<String>,
}

pub fn engine_info() -> EngineInfo {
    EngineInfo {
        id: ENGINE_ID.into(),
        name: ENGINE_NAME.into(),
        revision: ENGINE_REVISION.into(),
        license: "AGPL-3.0".into(),
        analyses: vec!["linear".into(), "p-delta".into(), "buckling".into()],
        element_families: vec!["frame".into(), "shell".into()],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Displacement3D {
    pub node_id: usize,
    pub ux: f64,
    pub uy: f64,
    pub uz: f64,
    pub rx: f64,
    pub ry: f64,
    pub rz: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reaction3D {
    pub node_id: usize,
    pub fx: f64,
    pub fy: f64,
    pub fz: f64,
    pub mx: f64,
    pub my: f64,
    pub mz: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberForces3D {
    pub member_id: usize,
    pub length_m: f64,
    pub n_start_kn: f64,
    pub n_end_kn: f64,
    pub vy_start_kn: f64,
    pub vy_end_kn: f64,
    pub vz_start_kn: f64,
    pub vz_end_kn: f64,
    pub torsion_start_knm: f64,
    pub torsion_end_knm: f64,
    pub my_start_knm: f64,
    pub my_end_knm: f64,
    pub mz_start_knm: f64,
    pub mz_end_knm: f64,
}

/// Eén exact door de rekenkern bemonsterd punt van een staafdiagram.
/// `t` loopt van 0 bij de beginknoop tot 1 bij de eindknoop.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramPoint3D {
    pub t: f64,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDiagram3D {
    pub member_id: usize,
    pub points: Vec<DiagramPoint3D>,
    pub max_value: f64,
    pub min_value: f64,
    /// Grootste absolute waarde; altijd positief in het Open FEM-contract.
    pub max_abs_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagrams3D {
    pub moment_y: Vec<MemberDiagram3D>,
    pub moment_z: Vec<MemberDiagram3D>,
    pub shear_y: Vec<MemberDiagram3D>,
    pub shear_z: Vec<MemberDiagram3D>,
    pub axial: Vec<MemberDiagram3D>,
    pub torsion: Vec<MemberDiagram3D>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondOrderSummary {
    pub iterations: usize,
    pub converged: bool,
    pub stable: bool,
    pub max_amplification: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BucklingModeSummary {
    pub mode: usize,
    pub load_factor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberBucklingData {
    pub member_id: usize,
    pub axial_force_kn: f64,
    pub critical_force_kn: f64,
    pub effective_length_factor: f64,
    pub effective_length_m: f64,
    pub length_m: f64,
    pub slenderness_y: f64,
    pub slenderness_z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum BucklingSummary {
    Available {
        modes: Vec<BucklingModeSummary>,
        members: Vec<MemberBucklingData>,
    },
    NotApplicable { reason: String },
    Failed { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EquilibriumSummary {
    pub relative_residual: f64,
    pub residual_ok: bool,
    pub max_imbalance_kn: f64,
    pub equilibrium_ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveResult3D {
    pub schema_version: u32,
    pub engine: EngineInfo,
    pub analysis: AnalysisKind,
    pub displacements: Vec<Displacement3D>,
    pub reactions: Vec<Reaction3D>,
    pub member_forces: Vec<MemberForces3D>,
    /// Volledige snedekrachtlijnen inclusief de kromming onder verdeelde lasten.
    pub diagrams: Diagrams3D,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub second_order: Option<SecondOrderSummary>,
    pub buckling: BucklingSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equilibrium: Option<EquilibriumSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub solver_path: Option<String>,
    pub diagnostics: Vec<String>,
    /// Per plaat: assen, oppervlakte, lastresultante en uiterste knoopwaarden.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plates: Vec<PlateSummary3D>,
    /// Plaatgrootheden in het midden van elk schaalelement, in plaatassen.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shell_elements: Vec<ShellElementResult3D>,
    /// Knoopgemiddelden per plaat, in plaatassen (voor contouren en extremen).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shell_nodes: Vec<ShellNodeResult3D>,
    /// Trek-alleen staven die in de eindtoestand op druk staan en niet
    /// meedoen, oplopend. Zij staan met nul-krachten in de uitvoer.
    pub inactive_members: Vec<usize>,
    /// Aantal statusrondes van de trek-alleen-lus; 0 zonder trek-alleen staven.
    pub tension_only_rounds: usize,
    /// Montageverlenging Δ0 per trek-alleen staaf, oplopend op staaf-id; alleen
    /// bij een verzoek met `tensionOnlyFit`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tension_only_fit: Vec<TensionOnlyFitMember3D>,
    /// Trek-alleen staven die alleen dankzij de kruisregel actief zijn, oplopend.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cross_rule_members: Vec<usize>,
    /// Per staaf op bedding: zakking en grondlast per rekenknoop, oplopend op
    /// staaf-id. Leeg (en weggelaten) zonder staven op bedding.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bedding: Vec<MemberBedding3D>,
    /// Per plaat op bedding: zakking en gronddruk per plaatknoop, oplopend op
    /// plaat-id. Leeg (en weggelaten) zonder platen op bedding (#107).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub plate_bedding: Vec<PlateBeddingResult3D>,
    /// Alleen bij tweede orde (P-Δ): per staaf de kernelementen waarmee de
    /// geometrische stijfheid K_G is gerekend, in volgorde langs de staaf, met
    /// hun normaalkracht en het verschil van de translaties van hun
    /// eindknopen. Een gedrukte staaf rekent in vier delen per stuk
    /// (`KNIKDELEN`), elk met zijn eigen N; de momentensom van lasten en
    /// reacties in de onvervormde stand is Σ N·(e_x × Δu) over al deze delen
    /// (`openFem3DSecondOrderMomentKnm` in de app). Leeg (en weggelaten) bij
    /// een lineaire berekening.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub second_order_parts: Vec<SecondOrderMember3D>,
    /// Alleen binnen de adapter, niet in het contract: per staaf met een
    /// axiale lijnlast uit een globale last N_vast van de hele staaf aan begin
    /// en eind (zie `globale_lasten`). De trek-alleen-lus trekt die af van
    /// `n_start_kn`/`n_end_kn` en kijkt zo naar de normaalkracht zonder de
    /// eigen axiale last.
    #[serde(skip)]
    pub(crate) n_vast_einden: BTreeMap<usize, [f64; 2]>,
}

/// De delen van één staaf in de geometrische stijfheid van de tweede orde
/// (zie `SolveResult3D::second_order_parts`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondOrderMember3D {
    pub member_id: usize,
    pub parts: Vec<SecondOrderPart3D>,
}

/// Eén kernelement van een staaf in K_G: de normaalkracht waarmee het rekent
/// (kN, trek positief; bij een last langs de staafas het gemiddelde over het
/// element) en u_eind − u_begin van zijn eindknopen (globaal, m).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondOrderPart3D {
    pub n_kn: f64,
    pub du_m: [f64; 3],
}

/// De montageverlenging van één trek-alleen staaf: zijn spanningsloze lengte
/// is L + Δ0. Negatief: het verband is korter gepast dan zijn tekenlengte.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TensionOnlyFitMember3D {
    pub member_id: usize,
    pub delta_mm: f64,
}

/// De grond onder één rekenknoop van een staaf op bedding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeddingPoint3D {
    /// Plaats langs de staaf, 0 bij de beginknoop en 1 bij de eindknoop.
    pub t: f64,
    /// Zakking in m, positief omlaag (−u_z).
    pub settlement_m: f64,
    /// Verticale lijnlast van de grond op de staaf in kN/m, positief omhoog:
    /// k·b·zakking; 0 waar de veer bij alleen druk is weggevallen.
    pub pressure_kn_per_m: f64,
    /// Zijdelingse lijnlast van de grond op de staaf in kN/m, alleen bij een
    /// zijdelingse bedding: de component langs de horizontale normaal n =
    /// Z × e_x (genormeerd), of bij een staaf steiler dan 45° (rondom) de
    /// grootte van de resultante loodrecht op de as.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lateral_kn_per_m: Option<f64>,
    /// `false` waar de verticale veer bij alleen druk is weggevallen.
    pub active: bool,
}

/// De bedding van één staaf in het resultaat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberBedding3D {
    pub member_id: usize,
    /// Per rekenknoop van de adapter, van begin tot eind (inclusief de einden).
    pub points: Vec<BeddingPoint3D>,
    pub max_pressure_kn_per_m: f64,
    pub min_pressure_kn_per_m: f64,
    pub max_settlement_m: f64,
    /// Som van de verticale veerkrachten op de staaf in kN, positief omhoog.
    pub total_reaction_kn: f64,
    /// Aandeel van de staaflengte zonder contact (alleen druk).
    pub lifted_fraction: f64,
}

/// De grond onder één knoop van een plaat op bedding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateBeddingNode3D {
    pub node_id: usize,
    /// Zakking in m langs −normaal (de grond in) positief: −u·z van de plaatassen.
    pub settlement_m: f64,
    /// Gronddruk k·zakking in kN/m², positief = druk; 0 waar de veer bij
    /// alleen druk is weggevallen.
    pub pressure_kn_per_m2: f64,
    /// `false` waar de veer bij alleen druk is weggevallen.
    pub active: bool,
}

/// De bedding van één plaat in het resultaat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlateBeddingResult3D {
    pub plate_id: usize,
    /// Per plaatknoop, oplopend op knoop-id.
    pub nodes: Vec<PlateBeddingNode3D>,
    pub max_pressure_kn_per_m2: f64,
    pub min_pressure_kn_per_m2: f64,
    pub max_settlement_m: f64,
    /// Som van de veerkrachten k·A_trib·zakking in kN, positief = de grond
    /// duwt de plaat langs +normaal.
    pub total_reaction_kn: f64,
    /// Aandeel van het plaatoppervlak zonder contact (alleen druk).
    pub lifted_fraction: f64,
}

fn convert_member_diagram(value: EngineElementDiagram3D) -> MemberDiagram3D {
    MemberDiagram3D {
        member_id: value.element_id,
        points: value.points.into_iter()
            .map(|point| DiagramPoint3D { t: point.t, value: point.value })
            .collect(),
        max_value: value.max_value,
        min_value: value.min_value,
        // Upstream bewaart hier de waarde met teken die de grootste absolute
        // waarde heeft. Aan de applicatiegrens maken we de naam ondubbelzinnig.
        max_abs_value: value.max_abs_value.abs(),
    }
}

fn finite(value: f64, label: &str) -> Result<(), String> {
    if value.is_finite() { Ok(()) } else { Err(format!("{label} is niet eindig")) }
}

pub(crate) fn positive(value: f64, label: &str) -> Result<(), String> {
    finite(value, label)?;
    if value > 0.0 { Ok(()) } else { Err(format!("{label} moet groter zijn dan nul")) }
}

fn unique_ids<T>(items: &[T], id: impl Fn(&T) -> usize, label: &str) -> Result<HashSet<usize>, String> {
    let mut ids = HashSet::new();
    for item in items {
        let value = id(item);
        if value == 0 { return Err(format!("{label}-id 0 is niet toegestaan")); }
        if !ids.insert(value) { return Err(format!("dubbele {label}-id {value}")); }
    }
    Ok(ids)
}

fn validate(request: &SolveRequest3D) -> Result<HashMap<usize, shell::PlateGeometry>, String> {
    if !(MIN_CONTRACT_VERSION..=CONTRACT_VERSION).contains(&request.schema_version) {
        return Err(format!(
            "onbekende 3D-contractversie {}; verwacht {MIN_CONTRACT_VERSION} t/m {CONTRACT_VERSION}",
            request.schema_version,
        ));
    }
    let uses_version_2 = !request.plates.is_empty() || !request.shell_elements.is_empty()
        || !request.surface_loads.is_empty()
        || request.members.iter().any(|member| !member.intermediate_node_ids.is_empty());
    if uses_version_2 && request.schema_version < 2 {
        return Err("platen, vlaklasten en tussenknopen op staven vereisen 3D-contractversie 2".into());
    }
    if request.nodes.len() < 2 { return Err("een 3D-model heeft minstens twee knopen nodig".into()); }
    if request.members.is_empty() && request.shell_elements.is_empty() {
        return Err("een 3D-model heeft minstens één staaf of plaatelement nodig".into());
    }
    // Een staaf of plaat op bedding ligt op grondveren; die tellen als oplegging.
    if request.supports.is_empty() && !request.members.iter().any(|member| member.bedding.is_some())
        && !request.plates.iter().any(|plate| plate.bedding.is_some())
    {
        return Err("een 3D-model heeft minstens één oplegging nodig".into());
    }
    if request.max_iterations == 0 || request.max_iterations > 10_000 {
        return Err("maxIterations moet tussen 1 en 10000 liggen".into());
    }
    positive(request.tolerance, "tolerance")?;

    let node_ids = unique_ids(&request.nodes, |v| v.id, "knoop")?;
    let material_ids = unique_ids(&request.materials, |v| v.id, "materiaal")?;
    let section_ids = unique_ids(&request.sections, |v| v.id, "doorsnede")?;
    let member_ids = unique_ids(&request.members, |v| v.id, "staaf")?;
    unique_ids(&request.nodal_loads, |v| v.id, "belasting")?;
    unique_ids(&request.member_loads, |v| v.id, "staafbelasting")?;
    unique_ids(&request.member_point_loads, |v| v.id, "staafpuntlast")?;
    unique_ids(&request.thermal_loads, |v| v.id, "temperatuurbelasting")?;

    for node in &request.nodes {
        finite(node.x, "knoop X")?; finite(node.y, "knoop Y")?; finite(node.z, "knoop Z")?;
    }
    for material in &request.materials {
        positive(material.e_mpa, &format!("E van materiaal {}", material.id))?;
        finite(material.nu, &format!("nu van materiaal {}", material.id))?;
        if !(-0.999..0.5).contains(&material.nu) {
            return Err(format!("nu van materiaal {} moet tussen -0,999 en 0,5 liggen", material.id));
        }
        if let Some(g) = material.g_mpa {
            positive(g, &format!("G van materiaal {}", material.id))?;
        }
        if let Some(alpha) = material.alpha_per_k {
            positive(alpha, &format!("uitzettingscoëfficiënt van materiaal {}", material.id))?;
        }
    }
    for section in &request.sections {
        positive(section.area_m2, &format!("A van doorsnede {}", section.id))?;
        positive(section.iy_m4, &format!("Iy van doorsnede {}", section.id))?;
        positive(section.iz_m4, &format!("Iz van doorsnede {}", section.id))?;
        positive(section.torsion_j_m4, &format!("J van doorsnede {}", section.id))?;
        if let Some(h) = section.height_m { positive(h, &format!("hoogte van doorsnede {}", section.id))?; }
        if let Some(b) = section.width_m { positive(b, &format!("breedte van doorsnede {}", section.id))?; }
        // Afschuifoppervlakken (issue #197): ontbreken mag (Euler-Bernoulli),
        // maar een opgegeven waarde moet eindig en positief zijn. Av = 0 gaf
        // anders een singuliere matrix met een misleidende melding over een
        // mechanisme, en NaN een uitkomst zonder getallen.
        if let Some(av) = section.shear_area_y_m2 {
            positive(av, &format!("Av,y (shearAreaYM2) van doorsnede {}", section.id))?;
        }
        if let Some(av) = section.shear_area_z_m2 {
            positive(av, &format!("Av,z (shearAreaZM2) van doorsnede {}", section.id))?;
        }
    }
    let node_by_id: HashMap<_, _> = request.nodes.iter().map(|node| (node.id, node)).collect();
    for member in &request.members {
        let a = node_by_id.get(&member.start_node_id)
            .ok_or_else(|| format!("staaf {} verwijst naar ontbrekende startknoop {}", member.id, member.start_node_id))?;
        let b = node_by_id.get(&member.end_node_id)
            .ok_or_else(|| format!("staaf {} verwijst naar ontbrekende eindknoop {}", member.id, member.end_node_id))?;
        if member.start_node_id == member.end_node_id ||
           ((a.x-b.x).powi(2) + (a.y-b.y).powi(2) + (a.z-b.z).powi(2)).sqrt() <= 1e-9 {
            return Err(format!("staaf {} heeft geen bruikbare lengte", member.id));
        }
        if !material_ids.contains(&member.material_id) {
            return Err(format!("staaf {} verwijst naar ontbrekend materiaal {}", member.id, member.material_id));
        }
        if !section_ids.contains(&member.section_id) {
            return Err(format!("staaf {} verwijst naar ontbrekende doorsnede {}", member.id, member.section_id));
        }
        verloop::keur(member, &section_ids)?;
        if let Some(roll) = member.roll_angle_rad { finite(roll, "rollAngleRad")?; }
        member_stations(member, &node_by_id)?;
    }
    bedding::valideer(request)?;
    plaatbedding::valideer(request)?;
    let mut support_nodes = HashSet::new();
    for support in &request.supports {
        if !node_ids.contains(&support.node_id) { return Err(format!("oplegging verwijst naar ontbrekende knoop {}", support.node_id)); }
        if !support_nodes.insert(support.node_id) { return Err(format!("dubbele oplegging op knoop {}", support.node_id)); }
        let fixed = [support.ux, support.uy, support.uz, support.rx, support.ry, support.rz];
        let springs = [support.kx_kn_per_m, support.ky_kn_per_m, support.kz_kn_per_m,
            support.krx_knm_per_rad, support.kry_knm_per_rad, support.krz_knm_per_rad];
        let prescribed = [support.ux_prescribed_m, support.uy_prescribed_m, support.uz_prescribed_m,
            support.rx_prescribed_rad, support.ry_prescribed_rad, support.rz_prescribed_rad];
        for (index, spring) in springs.iter().enumerate() {
            if let Some(value) = spring {
                positive(*value, &format!("veerstijfheid {} op knoop {}", index + 1, support.node_id))?;
                if fixed[index] {
                    return Err(format!(
                        "oplegging op knoop {} kan vrijheidsgraad {} niet tegelijk blokkeren en veren",
                        support.node_id, index + 1,
                    ));
                }
            }
        }
        for (index, value) in prescribed.iter().enumerate() {
            if let Some(value) = value {
                finite(*value, &format!("opgelegde verplaatsing {} op knoop {}", index + 1, support.node_id))?;
                if !fixed[index] {
                    return Err(format!(
                        "opgelegde verplaatsing {} op knoop {} vereist een geblokkeerde vrijheidsgraad",
                        index + 1, support.node_id,
                    ));
                }
            }
        }
        if !fixed.into_iter().any(|value| value) && !springs.into_iter().any(|value| value.is_some()) {
            return Err(format!("oplegging op knoop {} blokkeert of veert geen vrijheidsgraad", support.node_id));
        }
    }
    for load in &request.nodal_loads {
        if !node_ids.contains(&load.node_id) { return Err(format!("belasting {} verwijst naar ontbrekende knoop {}", load.id, load.node_id)); }
        let values = [load.fx, load.fy, load.fz, load.mx, load.my, load.mz];
        if values.iter().any(|v| !v.is_finite()) { return Err(format!("belasting {} bevat geen eindige waarde", load.id)); }
        if values.iter().all(|v| *v == 0.0) { return Err(format!("belasting {} bevat alleen nulwaarden", load.id)); }
    }
    for load in &request.member_loads {
        if !member_ids.contains(&load.member_id) {
            return Err(format!("staafbelasting {} verwijst naar ontbrekende staaf {}", load.id, load.member_id));
        }
        // De lokale waarden, of bij een globale last (#80) haar intensiteiten.
        let values = globale_lasten::keur_velden(load)?;
        if values.iter().any(|v| !v.is_finite()) {
            return Err(format!("staafbelasting {} bevat geen eindige waarde", load.id));
        }
        if values.iter().all(|v| *v == 0.0) {
            return Err(format!("staafbelasting {} bevat alleen nulwaarden", load.id));
        }
        let member = request.members.iter().find(|member| member.id == load.member_id).unwrap();
        let a_node = node_by_id[&member.start_node_id];
        let b_node = node_by_id[&member.end_node_id];
        let length = ((a_node.x-b_node.x).powi(2) + (a_node.y-b_node.y).powi(2) +
            (a_node.z-b_node.z).powi(2)).sqrt();
        let a = load.start_position_m.unwrap_or(0.0);
        let b = load.end_position_m.unwrap_or(length);
        if !a.is_finite() || !b.is_finite() || a < 0.0 || b <= a || b > length + 1e-9 {
            return Err(format!(
                "staafbelasting {} heeft ongeldig bereik [{a}, {b}] m voor staaflengte {length} m",
                load.id,
            ));
        }
    }
    for load in &request.member_point_loads {
        if !member_ids.contains(&load.member_id) {
            return Err(format!("staafpuntlast {} verwijst naar ontbrekende staaf {}", load.id, load.member_id));
        }
        if !load.py_kn.is_finite() || !load.pz_kn.is_finite() ||
            (load.py_kn == 0.0 && load.pz_kn == 0.0) {
            return Err(format!("staafpuntlast {} bevat geen geldige niet-nulkracht", load.id));
        }
        let member = request.members.iter().find(|member| member.id == load.member_id).unwrap();
        let a_node = node_by_id[&member.start_node_id];
        let b_node = node_by_id[&member.end_node_id];
        let length = ((a_node.x-b_node.x).powi(2) + (a_node.y-b_node.y).powi(2) +
            (a_node.z-b_node.z).powi(2)).sqrt();
        if !load.position_m.is_finite() || load.position_m < 0.0 || load.position_m > length + 1e-9 {
            return Err(format!(
                "staafpuntlast {} heeft ongeldige positie {} m voor staaflengte {length} m",
                load.id, load.position_m,
            ));
        }
    }
    for load in &request.thermal_loads {
        if !member_ids.contains(&load.member_id) {
            return Err(format!("temperatuurbelasting {} verwijst naar ontbrekende staaf {}", load.id, load.member_id));
        }
        let values = [load.delta_t_uniform_k, load.delta_t_gradient_y_k, load.delta_t_gradient_z_k];
        if values.iter().any(|value| !value.is_finite()) || values.iter().all(|value| *value == 0.0) {
            return Err(format!("temperatuurbelasting {} bevat geen geldige niet-nulwaarde", load.id));
        }
        // κ = α·ΔT/h met de werkelijke hoogte (of breedte) over welke het
        // temperatuurverschil werkt (#221). Zonder die maat geen stille
        // aanname h = √(12I/A): die is alleen voor een massieve rechthoek juist
        // en geeft bij een I-profiel circa 30 % te weinig kromming.
        let member = request.members.iter().find(|member| member.id == load.member_id)
            .expect("staaf bestaat, net gecontroleerd");
        let section_ids: Vec<usize> = std::iter::once(member.section_id)
            .chain(member.part_section_ids.iter().flatten().copied()).collect();
        for section_id in section_ids {
            let Some(section) = request.sections.iter().find(|section| section.id == section_id) else { continue };
            if load.delta_t_gradient_z_k != 0.0 && section.height_m.is_none() {
                return Err(format!(
                    "temperatuurbelasting {}: doorsnede {} (\"{}\") mist de hoogte (heightM) langs lokaal z; \
                     een temperatuurverschil over de doorsnede vraagt de werkelijke profielhoogte (EN 1991-1-5)",
                    load.id, section.id, section.name,
                ));
            }
            if load.delta_t_gradient_y_k != 0.0 && section.width_m.is_none() {
                return Err(format!(
                    "temperatuurbelasting {}: doorsnede {} (\"{}\") mist de breedte (widthM) langs lokaal y; \
                     een temperatuurverschil over de doorsnede vraagt de werkelijke profielbreedte (EN 1991-1-5)",
                    load.id, section.id, section.name,
                ));
            }
        }
    }
    let coordinates: HashMap<usize, [f64; 3]> = request.nodes.iter()
        .map(|node| (node.id, [node.x, node.y, node.z])).collect();
    let plate_geometry = shell::validate_shells(request, &coordinates)?;
    schijven::valideer(request)?;
    koppelingen::valideer(request)?;
    Ok(plate_geometry)
}

/// Tussenknopen van een staaf, geordend van begin naar eind, met hun afstand
/// tot de beginknoop (m). Leeg voor een ongeknipte staaf.
pub(crate) fn member_stations(member: &Member3D, node_by_id: &HashMap<usize, &Node3D>) -> Result<Vec<(usize, f64)>, String> {
    if member.intermediate_node_ids.is_empty() { return Ok(vec![]); }
    let a = node_by_id[&member.start_node_id];
    let b = node_by_id[&member.end_node_id];
    let axis = [b.x - a.x, b.y - a.y, b.z - a.z];
    let length = shell::norm(axis);
    let direction = shell::scale(axis, 1.0 / length);
    let mut stations = Vec::with_capacity(member.intermediate_node_ids.len());
    for id in &member.intermediate_node_ids {
        let node = node_by_id.get(id)
            .ok_or_else(|| format!("staaf {} verwijst naar ontbrekende tussenknoop {id}", member.id))?;
        if *id == member.start_node_id || *id == member.end_node_id || stations.iter().any(|(other, _)| other == id) {
            return Err(format!("staaf {}: tussenknoop {id} is dubbel of een eindknoop", member.id));
        }
        let offset = [node.x - a.x, node.y - a.y, node.z - a.z];
        let along = shell::dot(offset, direction);
        let across = shell::norm(shell::sub(offset, shell::scale(direction, along)));
        if across > 1e-6 * length.max(1.0) {
            return Err(format!("staaf {}: tussenknoop {id} ligt {across:.3e} m naast de staafas", member.id));
        }
        if along <= 1e-9 * length || along >= length * (1.0 - 1e-9) {
            return Err(format!("staaf {}: tussenknoop {id} ligt niet tussen begin- en eindknoop", member.id));
        }
        stations.push((*id, along));
    }
    stations.sort_by(|p, q| p.1.total_cmp(&q.1));
    for pair in stations.windows(2) {
        if pair[1].1 - pair[0].1 <= 1e-9 * length {
            return Err(format!(
                "staaf {}: tussenknopen {} en {} liggen op dezelfde plaats", member.id, pair[0].0, pair[1].0,
            ));
        }
    }
    Ok(stations)
}

/// Een deel van een contractstaaf zoals de kern het rekent.
#[derive(Debug, Clone)]
struct MemberPart {
    engine_id: usize,
    start_m: f64,
    end_m: f64,
    /// Begin- en eindknoop van het deel in de kern.
    node_i: usize,
    node_j: usize,
    /// Voor de knikanalyse en de tweede orde is elk stuk van de staaf tussen
    /// twee echte knopen in `knikdelen` gelijke delen gerekend (`KNIKDELEN`);
    /// dit is deel `knikdeel` van zijn stuk. Zonder onderverdeling 0 van 1.
    /// Alleen voor de bemonstering van de lijnen (`knikpunt_blijft`).
    knikdeel: usize,
    knikdelen: usize,
}

#[derive(Debug, Clone)]
struct MemberParts {
    member_id: usize,
    length_m: f64,
    parts: Vec<MemberPart>,
    /// Verlopende staaf (`partSectionIds`, #73): de delen kunnen een andere
    /// doorsnede hebben (zie `merge_buckling_members`).
    tapered: bool,
}

/// Het kernmodel plus de vertaling terug naar het contract.
struct EngineModel {
    input: SolverInput3D,
    members: Vec<MemberParts>,
    /// `true` zodra minstens één staaf in delen gerekend wordt.
    split: bool,
    /// Kern-id's van de plaatelementen (voor het samenvatten van meldingen).
    shell_engine_ids: HashSet<usize>,
    /// Staven op bedding: rekenknopen en veren (leeg zonder bedding).
    bedding: bedding::Plan,
    /// Weggevallen verticale veren (alleen druk) in deze berekening.
    los: bedding::Los,
    /// Grondknopen en veerelementen van de bedding: alleen voor de kern.
    grond: bedding::Grond,
    /// Verlopende staven: de grensknopen tussen delen met een andere
    /// doorsnede (leeg zonder).
    verloop: verloop::Plan,
    /// Platen op bedding: veren, vasthouding in het plaatvlak (leeg zonder).
    plaat: plaatbedding::Kern,
    /// Axiale component van globale staaflasten per kerndeel (kern-id), voor
    /// de correctie van de normaalkrachten (zie `globale_lasten`).
    axiaal: BTreeMap<usize, Vec<globale_lasten::AxiaalDeel>>,
    /// Per staaf met een axiale lijnlast: N_vast van de hele staaf aan begin
    /// en eind (zie `globale_lasten`), voor de trek-alleen-lus.
    n_vast_einden: BTreeMap<usize, [f64; 2]>,
    /// Knopen die de adapter aanlegt om staven voor de knikanalyse en de
    /// tweede orde in delen te rekenen (`KNIKDELEN`); leeg zonder.
    knikknopen: Vec<usize>,
}

/// Wordt deze staaf voor de knikanalyse en de tweede orde onderverdeeld?
/// Alleen een staaf uit `gedrukt` (`gedrukte_staven`). Niet een trek-alleen
/// staaf: die draagt alleen trek, en valt zij in een statusronde weg, dan
/// bleven haar rekenknopen los hangen. Niet een staaf op bedding: die heeft
/// al minstens acht rekenknopen (module `bedding`).
fn knikdelen_nodig(member: &Member3D, gedrukt: &HashSet<usize>) -> bool {
    !member.tension_only && member.bedding.is_none() && gedrukt.contains(&member.id)
}

/// De staven die in een eerste-ordeoplossing van `model` ergens gedrukt zijn
/// (N < −1·10⁻⁶ kN in een van hun delen): die worden voor de knikanalyse en
/// de tweede orde onderverdeeld (`KNIKDELEN`).
fn gedrukte_staven(model: &EngineModel, lineair: &AnalysisResults3D) -> HashSet<usize> {
    let n_min: HashMap<usize, f64> = lineair.element_forces.iter()
        .map(|krachten| (krachten.element_id, krachten.n_start.min(krachten.n_end)))
        .collect();
    model.members.iter()
        .filter(|staaf| staaf.parts.iter().any(|deel| n_min.get(&deel.engine_id).is_some_and(|&n| n < -1e-6)))
        .map(|staaf| staaf.member_id)
        .collect()
}

/// Het kernmodel van `request`. `onderverdelen` zijn de staven die voor de
/// knikanalyse en de tweede orde in delen gaan (`KNIKDELEN`); `None` of een
/// lege set = het model zoals het is.
fn to_engine_input(
    request: &SolveRequest3D,
    los: &bedding::Los,
    onderverdelen: Option<&HashSet<usize>>,
) -> Result<EngineModel, String> {
    // Platen rekenen geen tweede orde en geen knik in de adapter
    // (`tweede_orde::alleen_staven`): daar is niets te onderverdelen.
    let geen = HashSet::new();
    let gedrukt = onderverdelen.filter(|_| request.shell_elements.is_empty()).unwrap_or(&geen);
    let onderverdelen = !gedrukt.is_empty();
    // Verlopende staven krijgen grensknopen tussen delen met een andere
    // doorsnede (module `verloop`); staven op bedding rekenknopen langs de
    // staaf (module `bedding`), met die grensknopen erbij.
    let verloop = verloop::Plan::bouw(request)?;
    let plan = bedding::Plan::bouw(request)?;
    let mut nodes: HashMap<String, SolverNode3D> = request.nodes.iter().map(|node| (node.id.to_string(), SolverNode3D {
        id: node.id, x: node.x, y: node.y, z: node.z,
    })).collect();
    for (id, punt) in &verloop.nieuwe_knopen {
        nodes.insert(id.to_string(), SolverNode3D { id: *id, x: punt[0], y: punt[1], z: punt[2] });
    }
    for (id, punt) in &plan.nieuwe_knopen {
        nodes.insert(id.to_string(), SolverNode3D { id: *id, x: punt[0], y: punt[1], z: punt[2] });
    }
    let materials = request.materials.iter().map(|material| (material.id.to_string(), SolverMaterial {
        id: material.id, e: material.e_mpa, nu: material.nu,
    })).collect();
    let mut sections: HashMap<String, SolverSection3D> = request.sections.iter().map(|section| (section.id.to_string(), SolverSection3D {
        id: section.id,
        name: Some(section.name.clone()),
        a: section.area_m2,
        iy: section.iy_m4,
        iz: section.iz_m4,
        j: section.torsion_j_m4,
        cw: None,
        as_y: section.shear_area_y_m2,
        as_z: section.shear_area_z_m2,
    })).collect();
    // De vastgepinde kern accepteert geen onafhankelijke G. Maak alleen voor
    // een materiaal met gMpa een eigen doorsnede: G_iso·J_eq = G·J (en
    // G_iso·As_eq = G·As voor Timoshenko). Zonder gMpa blijven de bestaande
    // doorsneden en ids letterlijk gelijk.
    let material_by_id: HashMap<usize, &Material3D> = request.materials.iter().map(|m| (m.id, m)).collect();
    let mut equivalent_sections: HashMap<(usize, usize), usize> = HashMap::new();
    let mut next_section_id = request.sections.iter().map(|s| s.id).max().unwrap_or(0) + 1;
    let node_by_id: HashMap<usize, &Node3D> = request.nodes.iter().map(|node| (node.id, node)).collect();

    // Een staaf met tussenknopen gaat in delen naar de kern. Het eerste deel
    // houdt de staaf-id; de overige delen en de plaatelementen krijgen id's
    // boven de hoogste staaf-id, zodat geen kern-id dubbel voorkomt.
    let mut next_engine_id = request.members.iter().map(|member| member.id).max().unwrap_or(0) + 1;
    let mut elements = HashMap::new();
    let mut member_parts = Vec::with_capacity(request.members.len());
    let mut split = false;
    // Knikknopen (`KNIKDELEN`) krijgen id's boven alle knopen tot nu toe: die
    // van het model, de grensknopen van verlopende staven en de rekenknopen
    // van een bedding. De grondknopen van een bedding volgen daarna.
    let mut volgende_knikknoop = if onderverdelen {
        nodes.values().map(|node| node.id).max().unwrap_or(0) + 1
    } else {
        0
    };
    let mut knikknopen: Vec<usize> = Vec::new();
    for member in &request.members {
        let a = node_by_id[&member.start_node_id];
        let b = node_by_id[&member.end_node_id];
        let length = ((a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)).sqrt();
        let grenzen = verloop.grenzen(member.id);
        let mut chain = match plan.staaf(member.id) {
            // Op bedding: begin, rekenknopen (met de bestaande tussenknopen en
            // de grensknopen van een verlopende staaf) en eind.
            Some(staaf) => staaf.keten(),
            None => {
                let stations = member_stations(member, &node_by_id)?;
                let mut chain = vec![(member.start_node_id, 0.0)];
                chain.extend(stations.iter().copied());
                // Nieuwe grensknopen van een verlopende staaf; een grens op een
                // tussenknoop zit al in de keten.
                if grenzen.iter().any(|grens| grens.nieuw) {
                    chain.extend(grenzen.iter().filter(|grens| grens.nieuw).map(|grens| (grens.knoop, grens.s)));
                    chain.sort_by(|p, q| p.1.total_cmp(&q.1));
                }
                chain.push((member.end_node_id, length));
                chain
            }
        };
        // Knikanalyse en tweede orde: elk stuk van de keten in `KNIKDELEN`
        // gelijke delen, ook als de staaf al uit meer stukken bestaat. De nieuwe
        // knopen liggen op de rechte staafas; staaflasten, temperatuur en de
        // eindvrijgaven verdelen zich zoals bij elke geknipte staaf.
        let onderverdeeld = onderverdelen && knikdelen_nodig(member, gedrukt);
        let per_stuk = if onderverdeeld { KNIKDELEN } else { 1 };
        if onderverdeeld {
            let mut fijn = Vec::with_capacity((chain.len() - 1) * per_stuk + 1);
            for stuk in chain.windows(2) {
                fijn.push(stuk[0]);
                for k in 1..per_stuk {
                    let s = stuk[0].1 + (stuk[1].1 - stuk[0].1) * k as f64 / per_stuk as f64;
                    let id = volgende_knikknoop;
                    volgende_knikknoop += 1;
                    let t = s / length;
                    nodes.insert(id.to_string(), SolverNode3D {
                        id, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
                    });
                    knikknopen.push(id);
                    fijn.push((id, s));
                }
            }
            fijn.push(*chain.last().expect("een keten heeft een eind"));
            chain = fijn;
        }
        split |= chain.len() > 2;
        let count = chain.len() - 1;
        // Torsie aan beide einden vrij bij een staaf op bedding of een
        // verlopende staaf zonder plaatknopen: de kern laat de hele torsie van
        // een deel vallen zodra één van zijn einden vrij is. Met de vrijgave op
        // het eerste én het laatste deel zouden de rekenknopen ertussen dan vrij
        // om de staafas draaien (de grondveren grijpen in de as aan; review
        // #106). Alleen het eerste deel krijgt de vrijgave: dat deel draagt geen
        // torsie, dus de staaf als geheel ook niet (mechanisch gelijk), en de
        // rekenknopen hangen in torsie aan de eindknoop. Plaatknopen houden die
        // draaiing zelf vast; daar blijft de verdeling zoals bij elke geknipte
        // staaf. De knikknopen (`KNIKDELEN`) zijn rekenknopen als die van een
        // bedding.
        let torsie_alleen_begin = (plan.staaf(member.id).is_some() || !grenzen.is_empty() || onderverdeeld)
            && member.releases.torsion_start
            && member.releases.torsion_end
            && member.intermediate_node_ids.is_empty();
        let mut parts = Vec::with_capacity(count);
        for index in 0..count {
            let engine_id = if index == 0 { member.id } else { let id = next_engine_id; next_engine_id += 1; id };
            let first = index == 0;
            let last = index + 1 == count;
            let original_section_id = verloop::doorsnede(member, chain[index].1, chain[index + 1].1, length);
            let section_id = if let Some(g) = material_by_id[&member.material_id].g_mpa {
                *equivalent_sections.entry((member.material_id, original_section_id)).or_insert_with(|| {
                    let material = material_by_id[&member.material_id];
                    let factor = g / (material.e_mpa / (2.0 * (1.0 + material.nu)));
                    let mut section = sections[&original_section_id.to_string()].clone();
                    let id = next_section_id;
                    next_section_id += 1;
                    section.id = id;
                    section.j *= factor;
                    section.as_y = section.as_y.map(|a| a * factor);
                    section.as_z = section.as_z.map(|a| a * factor);
                    sections.insert(id.to_string(), section);
                    id
                })
            } else {
                original_section_id
            };
            elements.insert(engine_id.to_string(), SolverElement3D {
                id: engine_id,
                elem_type: "frame".into(),
                node_i: chain[index].0,
                node_j: chain[index + 1].0,
                material_id: member.material_id,
                // De doorsnede van het deel waarin het midden van dit kernelement
                // ligt; zonder `partSectionIds` gewoon `sectionId`.
                section_id,
                release_my_start: first && member.releases.my_start,
                release_my_end: last && member.releases.my_end,
                release_mz_start: first && member.releases.mz_start,
                release_mz_end: last && member.releases.mz_end,
                release_t_start: first && member.releases.torsion_start,
                release_t_end: last && member.releases.torsion_end && !torsie_alleen_begin,
                local_yx: None,
                local_yy: None,
                local_yz: None,
                // The engine field is historically named without a unit, but its
                // local-axis routine interprets the value as degrees. The Open FEM
                // contract is explicit and uses radians.
                roll_angle: member.roll_angle_rad.map(f64::to_degrees),
            });
            parts.push(MemberPart {
                engine_id, start_m: chain[index].1, end_m: chain[index + 1].1,
                node_i: chain[index].0, node_j: chain[index + 1].0,
                knikdeel: index % per_stuk, knikdelen: per_stuk,
            });
        }
        // Alleen met grenzen hebben de delen werkelijk een andere doorsnede;
        // een verlopende staaf met overal dezelfde doorsnede, ook als zij voor
        // de knik is onderverdeeld, rekent als een prismatische staaf.
        member_parts.push(MemberParts {
            member_id: member.id, length_m: length, parts, tapered: !grenzen.is_empty(),
        });
    }
    let parts_by_member: HashMap<usize, &MemberParts> = member_parts.iter().map(|m| (m.member_id, m)).collect();

    let mut supports: HashMap<String, SolverSupport3D> = request.supports.iter().enumerate().map(|(index, support)| ((index + 1).to_string(), SolverSupport3D {
        node_id: support.node_id,
        rx: support.ux, ry: support.uy, rz: support.uz,
        rrx: support.rx, rry: support.ry, rrz: support.rz,
        kx: support.kx_kn_per_m, ky: support.ky_kn_per_m, kz: support.kz_kn_per_m,
        krx: support.krx_knm_per_rad, kry: support.kry_knm_per_rad, krz: support.krz_knm_per_rad,
        dx: support.ux_prescribed_m, dy: support.uy_prescribed_m, dz: support.uz_prescribed_m,
        drx: support.rx_prescribed_rad, dry: support.ry_prescribed_rad, drz: support.rz_prescribed_rad,
        rw: None, kw: None, normal_x: None, normal_y: None, normal_z: None,
        is_inclined: None,
    })).collect();
    let mut loads: Vec<SolverLoad3D> = request.nodal_loads.iter().map(|load| SolverLoad3D::Nodal(SolverNodalLoad3D {
        node_id: load.node_id,
        fx: load.fx, fy: load.fy, fz: load.fz,
        mx: load.mx, my: load.my, mz: load.mz,
        bw: None,
    })).collect();
    // Per kern-id. Een BTreeMap en geen extra HashMap: elke nieuwe HashMap
    // schuift de hashsleutels van de maps die daarna in deze draad ontstaan
    // (ook in de kern). Een verzoek zonder globale last volgt zo precies het
    // oude rekenpad.
    let mut axiaal: BTreeMap<usize, Vec<globale_lasten::AxiaalDeel>> = BTreeMap::new();
    // Per staaf-id: N_vast van de hele staaf aan begin en eind.
    let mut n_vast_einden: BTreeMap<usize, [f64; 2]> = BTreeMap::new();
    for load in &request.member_loads {
        let member = parts_by_member[&load.member_id];
        // Een globale last (#80) in lokale assen; een lokale last houdt haar
        // waarden exact (geen axiale component).
        let assen = load.global_direction.map(|_| {
            let staaf = request.members.iter().find(|staaf| staaf.id == load.member_id).expect("staaf is gekeurd");
            globale_lasten::assen(staaf, node_by_id[&staaf.start_node_id], node_by_id[&staaf.end_node_id])
        });
        let lokaal = globale_lasten::componenten(load, &assen.unwrap_or_default());
        let (qy, qz, qx) = (lokaal.qy, lokaal.qz, lokaal.qx);
        // Een globale last zonder dwarscomponent (langs de staafas) geeft de kern
        // geen verdeelde last.
        let dwars = assen.is_none() || qy.iter().chain(&qz).any(|q| *q != 0.0);
        if dwars && member.parts.len() == 1 {
            // Ongeknipte staaf: exact de oude doorgifte, zodat bestaande
            // uitkomsten bit-gelijk blijven.
            loads.push(SolverLoad3D::Distributed(SolverDistributedLoad3D {
                element_id: member.parts[0].engine_id,
                q_yi: qy[0],
                q_yj: qy[1],
                q_zi: qz[0],
                q_zj: qz[1],
                a: load.start_position_m,
                b: load.end_position_m,
            }));
        }
        let a = load.start_position_m.unwrap_or(0.0);
        let b = load.end_position_m.unwrap_or(member.length_m);
        let intensity = |q: [f64; 2], s: f64| q[0] + (q[1] - q[0]) * (s - a) / (b - a);
        if dwars && member.parts.len() > 1 {
            for part in &member.parts {
                let low = a.max(part.start_m);
                let high = b.min(part.end_m);
                if high - low <= 1e-12 * member.length_m.max(1.0) { continue; }
                loads.push(SolverLoad3D::Distributed(SolverDistributedLoad3D {
                    element_id: part.engine_id,
                    q_yi: intensity(qy, low),
                    q_yj: intensity(qy, high),
                    q_zi: intensity(qz, low),
                    q_zj: intensity(qz, high),
                    a: Some(low - part.start_m),
                    b: Some(high - part.start_m),
                }));
            }
        }
        // De axiale component: per kerndeel gelijkwaardige knooplasten langs
        // e_x, en de correctie van N in `convert_result` (`globale_lasten`).
        let Some([ex, _, _]) = assen else { continue };
        if qx.iter().all(|q| *q == 0.0) { continue; }
        // N_vast van de hele staaf aan begin en eind, voor de status van een
        // trek-alleen staaf (ook als de kern haar in delen rekent).
        let geheel = globale_lasten::AxiaalDeel { h: member.length_m, van: a, tot: b, q_van: qx[0], q_tot: qx[1] };
        let einden = n_vast_einden.entry(load.member_id).or_insert([0.0; 2]);
        einden[0] += geheel.n_vast(0.0);
        einden[1] += geheel.n_vast(member.length_m);
        for part in &member.parts {
            let low = a.max(part.start_m);
            let high = b.min(part.end_m);
            if high - low <= 1e-12 * member.length_m.max(1.0) { continue; }
            let deel = globale_lasten::AxiaalDeel {
                h: part.end_m - part.start_m,
                van: low - part.start_m,
                tot: high - part.start_m,
                q_van: intensity(qx, low),
                q_tot: intensity(qx, high),
            };
            let (begin, eind) = deel.knooplasten();
            for (node_id, kracht) in [(part.node_i, begin), (part.node_j, eind)] {
                if kracht == 0.0 { continue; }
                loads.push(SolverLoad3D::Nodal(SolverNodalLoad3D {
                    node_id,
                    fx: kracht * ex[0], fy: kracht * ex[1], fz: kracht * ex[2],
                    mx: 0.0, my: 0.0, mz: 0.0,
                    bw: None,
                }));
            }
            axiaal.entry(part.engine_id).or_default().push(deel);
        }
    }
    for load in &request.member_point_loads {
        let member = parts_by_member[&load.member_id];
        let part = member.parts.iter()
            .find(|part| load.position_m < part.end_m - 1e-12 * member.length_m.max(1.0))
            .unwrap_or_else(|| member.parts.last().unwrap());
        loads.push(SolverLoad3D::PointOnElement(SolverPointLoad3D {
            element_id: part.engine_id,
            a: if member.parts.len() == 1 { load.position_m }
                else { (load.position_m - part.start_m).clamp(0.0, part.end_m - part.start_m) },
            py: load.py_kn,
            pz: load.pz_kn,
        }));
    }
    for load in &request.thermal_loads {
        // De vastgezette engine gebruikt intern 12e-6/K. Schaal de ΔT's aan
        // deze adaptergrens zodat staal, beton en toekomstige materialen hun
        // expliciete projectwaarde behouden zonder het enginecontract te lekken.
        let alpha = request.members.iter().find(|member| member.id == load.member_id)
            .and_then(|member| request.materials.iter().find(|material| material.id == member.material_id))
            .and_then(|material| material.alpha_per_k)
            .unwrap_or(12e-6);
        let scale = alpha / 12e-6;
        let member = request.members.iter().find(|member| member.id == load.member_id)
            .expect("staaf bestaat, gecontroleerd in validate");
        let member_parts = &parts_by_member[&load.member_id];
        for part in &member_parts.parts {
            // De kern zet een gradiënt om met h = √(12I/A) (en b = √(12Iz/A)).
            // Schaal ΔT zo dat de kromming α·ΔT/h met de werkelijke maat
            // ontstaat: ΔT_kern = ΔT · h_kern / h (#221, EN 1991-1-5 §4).
            let section_id = verloop::doorsnede(member, part.start_m, part.end_m, member_parts.length_m);
            let section = request.sections.iter().find(|section| section.id == section_id)
                .expect("doorsnede bestaat, gecontroleerd in validate");
            let maat = |gradient: f64, werkelijk: Option<f64>, traagheid: f64| {
                if gradient == 0.0 { return 0.0; }
                let kern = (12.0 * traagheid / section.area_m2).sqrt();
                gradient * kern / werkelijk.expect("maat gecontroleerd in validate")
            };
            loads.push(SolverLoad3D::Thermal(SolverThermalLoad3D {
                element_id: part.engine_id,
                dt_uniform: load.delta_t_uniform_k * scale,
                dt_gradient_y: maat(load.delta_t_gradient_y_k, section.width_m, section.iz_m4) * scale,
                dt_gradient_z: maat(load.delta_t_gradient_z_k, section.height_m, section.iy_m4) * scale,
            }));
        }
    }

    // Platen: vierhoeken als MITC4, driehoeken als DKT+CST.
    let coordinates: HashMap<usize, [f64; 3]> = request.nodes.iter()
        .map(|node| (node.id, [node.x, node.y, node.z])).collect();
    let plate_by_id: HashMap<usize, &Plate3D> = request.plates.iter().map(|plate| (plate.id, plate)).collect();
    let mut plates = HashMap::new();
    let mut quads = HashMap::new();
    let mut shell_elements: Vec<&ShellElement3D> = request.shell_elements.iter().collect();
    shell_elements.sort_by_key(|element| element.id);
    let mut shell_engine_ids = HashSet::new();
    // Orthotrope platen (#79, #97): de stijfheid in plaatassen, per element
    // naar de eigen elementassen van de kern gedraaid.
    let orthotropic_axes = if request.plates.iter().any(|plate| plate.orthotropy.is_some()) {
        shell::validate_shells(request, &coordinates)?
    } else {
        HashMap::new()
    };
    for element in shell_elements {
        let plate = plate_by_id[&element.plate_id];
        let engine_id = next_engine_id;
        next_engine_id += 1;
        shell_engine_ids.insert(engine_id);
        if element.node_ids.len() == 4 {
            let nodes = [element.node_ids[0], element.node_ids[1], element.node_ids[2], element.node_ids[3]];
            let constitutive = plate.orthotropy.as_ref().map(|orthotropy| {
                let coords = nodes.map(|id| coordinates[&id]);
                let (e1, e2) = shell::element_axes(&coords);
                let in_plate = orthotroop::plate_stiffness(orthotropy, plate.thickness_m);
                let axes = &orthotropic_axes[&element.plate_id].axes;
                orthotroop::to_engine(&orthotroop::element_stiffness(&in_plate, e1, e2, axes))
            });
            quads.insert(engine_id.to_string(), SolverQuadElement {
                id: engine_id,
                nodes,
                material_id: plate.material_id,
                thickness: plate.thickness_m,
                constitutive,
            });
        } else {
            plates.insert(engine_id.to_string(), SolverPlateElement {
                id: engine_id,
                nodes: [element.node_ids[0], element.node_ids[1], element.node_ids[2]],
                material_id: plate.material_id,
                thickness: plate.thickness_m,
            });
        }
    }
    // Vlaklasten als consistente knoopkrachten (F_i = q·∫N_i dA).
    for (node_id, force) in shell::surface_load_nodal_forces(request, &coordinates) {
        loads.push(SolverLoad3D::Nodal(SolverNodalLoad3D {
            node_id, fx: force[0], fy: force[1], fz: force[2], mx: 0.0, my: 0.0, mz: 0.0, bw: None,
        }));
    }
    // Grondveren van de bedding: oplegveren en veerelementen naar grondknopen.
    let mut connectors = HashMap::new();
    let mut grond = plan.voeg_veren_toe(los, &mut nodes, &mut supports, &mut connectors, &mut next_engine_id);
    // Platen op bedding: veren in de plaatknopen en de vasthouding in het
    // plaatvlak (module `plaatbedding`). Zonder plaatbedding verandert er niets.
    let plaat = plaatbedding::Kern::bouw(request, los, &mut nodes, &mut supports, &mut connectors, &mut next_engine_id, &mut grond);
    let input = SolverInput3D {
        nodes, materials, sections, elements, supports, loads,
        constraints: schijven::koppelingen(request).0.into_iter()
            .chain(koppelingen::constraints(request)).collect(),
        left_hand: None,
        plates, quads, quad9s: HashMap::new(),
        solid_shells: HashMap::new(), curved_shells: HashMap::new(),
        curved_beams: vec![], connectors,
    };
    Ok(EngineModel {
        input, members: member_parts, split, shell_engine_ids, bedding: plan, los: los.clone(), grond, verloop, plaat,
        axiaal, n_vast_einden, knikknopen,
    })
}

impl EngineModel {
    /// Per staaf van het contract de delen waarmee de tweede orde K_G heeft
    /// gerekend, in volgorde langs de staaf (`secondOrderParts`).
    fn tweede_orde_delen(&self, delen: &HashMap<usize, (f64, [f64; 3])>) -> Vec<SecondOrderMember3D> {
        self.members.iter().filter_map(|staaf| {
            let parts: Vec<SecondOrderPart3D> = staaf.parts.iter()
                .filter_map(|deel| delen.get(&deel.engine_id))
                .map(|&(n_kn, du_m)| SecondOrderPart3D { n_kn, du_m })
                .collect();
            (parts.len() == staaf.parts.len()).then_some(SecondOrderMember3D { member_id: staaf.member_id, parts })
        }).collect()
    }
}

/// Knikgegevens per staaf van het contract: bij geknipte staven één regel
/// per hele staaf (zie `merge_buckling_members`).
fn buckling_per_member(model: &EngineModel, buckling: BucklingSummary) -> BucklingSummary {
    match buckling {
        BucklingSummary::Available { modes, members } if model.split => {
            let lambda_cr = modes.first().map(|mode| mode.load_factor).unwrap_or(0.0);
            BucklingSummary::Available { members: merge_buckling_members(members, model, lambda_cr), modes }
        }
        other => other,
    }
}

/// Knikgegevens van een geknipte staaf: het deel met de grootste
/// normaalkracht geeft N en N_cr = λ_cr·max|N|; de kniklengte hoort bij de
/// hele staaf. Bij een verlopende staaf (#73) blijven N en N_cr die van de
/// grootste |N|, maar de kniklengte en de slankheden komen van het deel met de
/// grootste spanning |N|/A (bij een constante N het kleinste deel): met de
/// knikkracht van dat deel, λ_cr·|N_deel|, en zijn doorsnede,
/// π·√(E·I_min/(λ_cr·|N_deel|)). Bij een constante N is dat dezelfde N_cr.
fn merge_buckling_members(
    members: Vec<MemberBucklingData>,
    model: &EngineModel,
    lambda_cr: f64,
) -> Vec<MemberBucklingData> {
    let by_engine: HashMap<usize, MemberBucklingData> = members.into_iter().map(|m| (m.member_id, m)).collect();
    let area = |part: &MemberPart| {
        let element = &model.input.elements[&part.engine_id.to_string()];
        model.input.sections.values().find(|s| s.id == element.section_id).map(|s| s.a).unwrap_or(1.0)
    };
    let mut merged = Vec::new();
    for member in &model.members {
        let candidates = || member.parts.iter()
            .filter_map(|part| by_engine.get(&part.engine_id).map(|data| (part, data)));
        let Some((_, data)) = candidates().max_by(|a, b| a.1.axial_force_kn.abs().total_cmp(&b.1.axial_force_kn.abs()))
        else { continue };
        if member.parts.len() == 1 {
            merged.push(data.clone());
            continue;
        }
        // Het deel dat de kniklengte en de slankheden geeft: bij een
        // verlopende staaf dat met de grootste |N|/A, anders dat met de
        // grootste |N| (hetzelfde deel als hierboven).
        let stressed = if member.tapered {
            candidates().max_by(|a, b| (a.1.axial_force_kn.abs() / area(a.0)).total_cmp(&(b.1.axial_force_kn.abs() / area(b.0))))
        } else {
            candidates().max_by(|a, b| a.1.axial_force_kn.abs().total_cmp(&b.1.axial_force_kn.abs()))
        };
        let Some((part, part_data)) = stressed else { continue };
        let element = &model.input.elements[&part.engine_id.to_string()];
        let material = model.input.materials.values().find(|m| m.id == element.material_id);
        let section = model.input.sections.values().find(|s| s.id == element.section_id);
        let critical_force = lambda_cr * data.axial_force_kn.abs();
        let part_critical_force = lambda_cr * part_data.axial_force_kn.abs();
        let (factor, effective, slender_y, slender_z) = match (material, section) {
            (Some(material), Some(section)) if critical_force > 1e-6 && part_critical_force > 1e-6 => {
                let effective = std::f64::consts::PI
                    * (material.e * 1000.0 * section.iy.min(section.iz) / part_critical_force).sqrt();
                let radius_y = if section.a > 1e-20 { (section.iy / section.a).sqrt() } else { 0.0 };
                let radius_z = if section.a > 1e-20 { (section.iz / section.a).sqrt() } else { 0.0 };
                (
                    effective / member.length_m, effective,
                    if radius_y > 1e-12 { effective / radius_y } else { 0.0 },
                    if radius_z > 1e-12 { effective / radius_z } else { 0.0 },
                )
            }
            _ => (1.0, member.length_m, data.slenderness_y, data.slenderness_z),
        };
        merged.push(MemberBucklingData {
            member_id: member.member_id,
            axial_force_kn: data.axial_force_kn,
            critical_force_kn: critical_force,
            effective_length_factor: factor,
            effective_length_m: effective,
            length_m: member.length_m,
            slenderness_y: slender_y,
            slenderness_z: slender_z,
        });
    }
    merged
}

/// Aantal intervallen tussen de vaste bemonsteringspunten van een
/// kerndiagram (de kern bemonstert elk element in 21 punten, plus de plaatsen
/// rond een puntlast).
const DIAGRAMSTAPPEN: usize = 20;

/// Blijft dit punt van een knikdeel staan? Van de vaste punten van de kern
/// alleen die op het raster van het hele stuk (`DIAGRAMSTAPPEN` intervallen
/// over het stuk), zodat een voor de knik onderverdeelde staaf even veel
/// punten op dezelfde plaatsen geeft als zonder onderverdeling; de extra
/// punten rond een puntlast blijven altijd.
fn knikpunt_blijft(part: &MemberPart, t: f64) -> bool {
    if part.knikdelen <= 1 { return true; }
    let stap = t * DIAGRAMSTAPPEN as f64;
    if (stap - stap.round()).abs() > 1e-6 { return true; }
    (part.knikdeel * DIAGRAMSTAPPEN + stap.round() as usize).is_multiple_of(part.knikdelen)
}

/// Voeg de diagrammen van de delen samen tot één lijn over de hele staaf. Op
/// een tussenknoop blijven beide waarden staan, zodat een sprong (bijvoorbeeld
/// door de plaatreactie op een randligger) zichtbaar blijft. Een knoop die de
/// adapter alleen voor de knikanalyse aanlegt (`KNIKDELEN`) draagt geen last:
/// daar loopt de lijn door en telt het punt één keer, en van de knikdelen
/// blijven alleen de punten op het raster van hun stuk (`knikpunt_blijft`).
fn merge_diagrams(parts_of: &[MemberParts], diagrams: Vec<EngineElementDiagram3D>) -> Vec<MemberDiagram3D> {
    let mut by_engine: HashMap<usize, EngineElementDiagram3D> =
        diagrams.into_iter().map(|diagram| (diagram.element_id, diagram)).collect();
    let mut merged = Vec::new();
    for member in parts_of {
        if member.parts.len() == 1 {
            if let Some(diagram) = by_engine.remove(&member.parts[0].engine_id) {
                merged.push(convert_member_diagram(diagram));
            }
            continue;
        }
        let mut points: Vec<DiagramPoint3D> = Vec::new();
        for part in &member.parts {
            let Some(diagram) = by_engine.remove(&part.engine_id) else { continue };
            let span = part.end_m - part.start_m;
            // Het beginpunt van een volgend knikdeel valt samen met het
            // eindpunt van het vorige.
            let doorlopend = part.knikdeel > 0;
            for point in diagram.points {
                if !knikpunt_blijft(part, point.t) { continue; }
                if doorlopend && point.t == 0.0 && !points.is_empty() { continue; }
                points.push(DiagramPoint3D { t: (part.start_m + point.t * span) / member.length_m, value: point.value });
            }
        }
        if points.is_empty() { continue; }
        let max_value = points.iter().map(|p| p.value).fold(f64::NEG_INFINITY, f64::max);
        let min_value = points.iter().map(|p| p.value).fold(f64::INFINITY, f64::min);
        merged.push(MemberDiagram3D {
            member_id: member.member_id,
            points,
            max_value,
            min_value,
            max_abs_value: max_value.abs().max(min_value.abs()),
        });
    }
    merged
}

/// Kwaliteitsmeldingen van de kern over plaatelementen, samengevat per soort:
/// een fijn net geeft anders honderden losse regels.
fn summarize_diagnostics(results: &AnalysisResults3D, shell_engine_ids: &HashSet<usize>, grond: &bedding::Grond) -> Vec<String> {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut messages = Vec::new();
    for item in &results.structured_diagnostics {
        // Grondknopen en veerelementen van de bedding bestaan alleen voor de
        // kern; een melding over hen (bijvoorbeeld twee grondknopen op één
        // plek onder een gedeelde eindknoop) zegt niets over het model.
        if grond.betreft(&item.node_ids, &item.element_ids) {
            continue;
        }
        // De kern toetst "nearly vertical" bij een staaf zonder oriëntatievector
        // tegen globaal Y, terwijl haar lokale assen (en Open FEM 3D) Z omhoog
        // gebruiken. Deze adapter geeft nooit een oriëntatievector mee, dus elke
        // staaf langs Y kreeg die melding en een echt bijna verticale staaf niet
        // (#61). Ze valt hier weg; het rapport toetst zelf met Z omhoog
        // (design-mockup/src/components/openFem3d/openFem3dMeldingen.ts).
        if format!("{:?}", item.code) == "SuspiciousLocalAxis" && item.message.contains("is nearly vertical") {
            continue;
        }
        let about_shells = !item.element_ids.is_empty()
            && item.element_ids.iter().all(|id| shell_engine_ids.contains(id));
        if about_shells {
            *counts.entry(format!("{:?}", item.code)).or_insert(0) += 1;
        } else {
            messages.push(item.message.clone());
        }
    }
    for (code, count) in counts {
        let text = match code.as_str() {
            "SmallMinAngle" => "met een hoek kleiner dan 10°",
            "HighAspectRatio" => "met een lengte-breedteverhouding boven 20",
            "PoorJacobianRatio" => "met een sterk vervormde vorm (Jacobiaanverhouding onder 0,1)",
            "HighWarping" => "die merkbaar scheluw zijn",
            _ => "met een kwaliteitsmelding van de kern",
        };
        messages.insert(0, format!("Plaatnet: {count} element(en) {text} ({code})."));
    }
    messages.extend(results.solver_diagnostics.iter().map(|item| item.message.clone()));
    messages
}

fn convert_result(
    request: &SolveRequest3D,
    model: &EngineModel,
    plate_geometry: &HashMap<usize, shell::PlateGeometry>,
    results: AnalysisResults3D,
    second_order: Option<SecondOrderSummary>,
    buckling: BucklingSummary,
) -> SolveResult3D {
    let mut results = results;
    // De kern neemt de veerstijfheid wel in K op, maar zijn generieke
    // reactiebouwer rapporteert alleen geblokkeerde vrijheidsgraden. Voeg de
    // kracht die de grondveer op het model uitoefent daarom aan hetzelfde
    // oplegreactieobject toe: R_s = -k·u.
    for support in &request.supports {
        let Some(displacement) = results.displacements.iter()
            .find(|value| value.node_id == support.node_id) else { continue };
        let Some(reaction) = results.reactions.iter_mut()
            .find(|value| value.node_id == support.node_id) else { continue };
        let spring_reaction = [
            -support.kx_kn_per_m.unwrap_or(0.0) * displacement.ux,
            -support.ky_kn_per_m.unwrap_or(0.0) * displacement.uy,
            -support.kz_kn_per_m.unwrap_or(0.0) * displacement.uz,
            -support.krx_knm_per_rad.unwrap_or(0.0) * displacement.rx,
            -support.kry_knm_per_rad.unwrap_or(0.0) * displacement.ry,
            -support.krz_knm_per_rad.unwrap_or(0.0) * displacement.rz,
        ];
        // Een veer en een blokkering op dezelfde vrijheidsgraad worden aan de
        // contractgrens geweigerd. Daarom is de veerwaarde hier de volledige
        // reactiecomponent. Dit werkt zowel voor de lineaire engine, die hem
        // al invult, als voor P-Delta, waar die component nog nul is.
        if support.kx_kn_per_m.is_some() { reaction.fx = spring_reaction[0]; }
        if support.ky_kn_per_m.is_some() { reaction.fy = spring_reaction[1]; }
        if support.kz_kn_per_m.is_some() { reaction.fz = spring_reaction[2]; }
        if support.krx_knm_per_rad.is_some() { reaction.mx = spring_reaction[3]; }
        if support.kry_knm_per_rad.is_some() { reaction.my = spring_reaction[4]; }
        if support.krz_knm_per_rad.is_some() { reaction.mz = spring_reaction[5]; }
    }
    if let Some(equilibrium) = results.equilibrium.as_mut() {
        if equilibrium.reaction_force_sum.len() >= 3 && equilibrium.applied_force_sum.len() >= 3 {
            equilibrium.reaction_force_sum[0] = results.reactions.iter().map(|value| value.fx).sum();
            equilibrium.reaction_force_sum[1] = results.reactions.iter().map(|value| value.fy).sum();
            equilibrium.reaction_force_sum[2] = results.reactions.iter().map(|value| value.fz).sum();
            equilibrium.max_imbalance = (0..3)
                .map(|index| (equilibrium.applied_force_sum[index] + equilibrium.reaction_force_sum[index]).abs())
                .fold(0.0, f64::max);
            let max_force = equilibrium.applied_force_sum.iter().take(3)
                .chain(equilibrium.reaction_force_sum.iter().take(3))
                .map(|value| value.abs()).fold(0.0, f64::max);
            equilibrium.equilibrium_ok = equilibrium.max_imbalance < 1e-6 * max_force.max(1.0);
        }
    }
    let mut engine_diagrams = compute_diagrams_3d(&results);
    // Veldextremen tussen de 21 vaste stations van de kern (#242): een extra
    // station waar de dwarskracht nul is, vóór de correcties hieronder zodat
    // die ook dat station bijwerken.
    veldmaximum::voeg_toe(&results.element_forces, &mut engine_diagrams);
    // Globale lijnlasten (#80): de axiale component als lijnlast in de N-lijn
    // en de eindnormaalkrachten van elk kerndeel, vóór de bedding en het
    // samenvoegen van geknipte staven (zie `globale_lasten`).
    if !model.axiaal.is_empty() {
        globale_lasten::corrigeer(&model.axiaal, &mut engine_diagrams.axial, &mut results.element_forces);
    }
    // Staven op bedding: de grond als verdeelde last in de normaal- en
    // dwarskrachten, op de lijnen van de delen en op de staafeinden hieronder
    // (zie `bedding::correctie`).
    // De verplaatsingen van alle knopen van de kern, met de rekenknopen.
    let bedding_displacements: HashMap<usize, [f64; 6]> = if model.bedding.is_empty() {
        HashMap::new()
    } else {
        results.displacements.iter().map(|d| (d.node_id, [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz])).collect()
    };
    let grondkrachten = if model.bedding.is_empty() {
        HashMap::new()
    } else {
        model.bedding.grondkrachten_lokaal(&model.los, &bedding_displacements)
    };
    if !grondkrachten.is_empty() {
        let lijsten = [&mut engine_diagrams.axial, &mut engine_diagrams.shear_y, &mut engine_diagrams.shear_z];
        for (as_, lijst) in lijsten.into_iter().enumerate() {
            let index: HashMap<usize, usize> = lijst.iter().enumerate().map(|(i, d)| (d.element_id, i)).collect();
            for member in &model.members {
                let (Some(staaf), Some(krachten)) = (model.bedding.staaf(member.member_id), grondkrachten.get(&member.member_id))
                    else { continue };
                for (deel, part) in member.parts.iter().enumerate() {
                    let Some(&i) = index.get(&part.engine_id) else { continue };
                    let h = part.end_m - part.start_m;
                    for point in &mut lijst[i].points {
                        point.value += bedding::correctie(staaf, krachten, deel, point.t * h)[as_];
                    }
                }
            }
        }
    }
    let diagrams = if model.split {
        Diagrams3D {
            moment_y: merge_diagrams(&model.members, engine_diagrams.moment_y),
            moment_z: merge_diagrams(&model.members, engine_diagrams.moment_z),
            shear_y: merge_diagrams(&model.members, engine_diagrams.shear_y),
            shear_z: merge_diagrams(&model.members, engine_diagrams.shear_z),
            axial: merge_diagrams(&model.members, engine_diagrams.axial),
            torsion: merge_diagrams(&model.members, engine_diagrams.torsion),
        }
    } else {
        Diagrams3D {
            moment_y: engine_diagrams.moment_y.into_iter().map(convert_member_diagram).collect(),
            moment_z: engine_diagrams.moment_z.into_iter().map(convert_member_diagram).collect(),
            shear_y: engine_diagrams.shear_y.into_iter().map(convert_member_diagram).collect(),
            shear_z: engine_diagrams.shear_z.into_iter().map(convert_member_diagram).collect(),
            axial: engine_diagrams.axial.into_iter().map(convert_member_diagram).collect(),
            torsion: engine_diagrams.torsion.into_iter().map(convert_member_diagram).collect(),
        }
    };
    let equilibrium = results.equilibrium.as_ref().map(|value| EquilibriumSummary {
        relative_residual: value.relative_residual,
        residual_ok: value.residual_ok,
        max_imbalance_kn: value.max_imbalance,
        equilibrium_ok: value.equilibrium_ok,
    });
    let solver_path = results.solver_run_meta.as_ref().map(|meta| meta.solver_path.clone());
    let diagnostics = summarize_diagnostics(&results, &model.shell_engine_ids, &model.grond);
    let to_contract = |value: &rekenkern::types::ElementForces3D, member_id: usize, length: f64| MemberForces3D {
        member_id, length_m: length,
        n_start_kn: value.n_start, n_end_kn: value.n_end,
        vy_start_kn: value.vy_start, vy_end_kn: value.vy_end,
        vz_start_kn: value.vz_start, vz_end_kn: value.vz_end,
        torsion_start_knm: value.mx_start, torsion_end_knm: value.mx_end,
        my_start_knm: value.my_start, my_end_knm: value.my_end,
        mz_start_knm: value.mz_start, mz_end_knm: value.mz_end,
    };
    let member_forces = if model.split {
        let by_engine: HashMap<usize, &rekenkern::types::ElementForces3D> =
            results.element_forces.iter().map(|value| (value.element_id, value)).collect();
        model.members.iter().filter_map(|member| {
            let first = by_engine.get(&member.parts.first()?.engine_id)?;
            let last = by_engine.get(&member.parts.last()?.engine_id)?;
            let mut forces = to_contract(first, member.member_id, member.length_m);
            forces.n_end_kn = last.n_end;
            forces.vy_end_kn = last.vy_end;
            forces.vz_end_kn = last.vz_end;
            forces.torsion_end_knm = last.mx_end;
            forces.my_end_knm = last.my_end;
            forces.mz_end_knm = last.mz_end;
            if let (Some(staaf), Some(krachten)) = (model.bedding.staaf(member.member_id), grondkrachten.get(&member.member_id)) {
                let laatste = member.parts.len() - 1;
                let begin = bedding::correctie(staaf, krachten, 0, 0.0);
                let eind = bedding::correctie(staaf, krachten, laatste, member.parts[laatste].end_m - member.parts[laatste].start_m);
                forces.n_start_kn += begin[0];
                forces.vy_start_kn += begin[1];
                forces.vz_start_kn += begin[2];
                forces.n_end_kn += eind[0];
                forces.vy_end_kn += eind[1];
                forces.vz_end_kn += eind[2];
            }
            Some(forces)
        }).collect()
    } else {
        results.element_forces.iter().map(|value| to_contract(value, value.element_id, value.length)).collect()
    };
    let shells = if request.shell_elements.is_empty() {
        None
    } else {
        let coordinates: HashMap<usize, [f64; 3]> = request.nodes.iter()
            .map(|node| (node.id, [node.x, node.y, node.z])).collect();
        let displacements: HashMap<usize, [f64; 6]> = results.displacements.iter()
            .map(|d| (d.node_id, [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz])).collect();
        Some(shell::recover_shell_results(request, plate_geometry, &coordinates, &displacements))
    };
    let (plates, shell_elements, shell_nodes) = match shells {
        Some(output) => (output.plates, output.elements, output.nodes),
        None => (vec![], vec![], vec![]),
    };
    // Bedding: zakking en grondlast per rekenknoop. Daarna blijven alleen de
    // modelknopen over (ook zonder de grensknopen van een verlopende staaf);
    // de veerkrachten van de rekenknopen en grondknopen zitten al in de
    // evenwichtssom hierboven.
    if !model.bedding.is_empty() || !model.verloop.nieuwe_knopen.is_empty() || !model.knikknopen.is_empty() {
        let model_nodes: HashSet<usize> = request.nodes.iter().map(|node| node.id).collect();
        results.displacements.retain(|value| model_nodes.contains(&value.node_id));
        results.reactions.retain(|value| model_nodes.contains(&value.node_id));
    }
    let bedding = if model.bedding.is_empty() {
        vec![]
    } else {
        model.bedding.resultaat(&model.los, &bedding_displacements)
    };
    // Platen op bedding: zakking en gronddruk per plaatknoop. De veerreacties
    // van plaatknopen zonder eigen oplegging en van de grondknopen zitten al in
    // de evenwichtssom hierboven, maar zijn geen oplegreacties van het model.
    let plate_bedding = if model.plaat.plan.is_empty() {
        vec![]
    } else {
        let verplaatsing: BTreeMap<usize, [f64; 6]> = results.displacements.iter()
            .map(|d| (d.node_id, [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz])).collect();
        let modelknopen: BTreeSet<usize> = request.nodes.iter().map(|node| node.id).collect();
        results.displacements.retain(|value| modelknopen.contains(&value.node_id));
        results.reactions.retain(|value| {
            modelknopen.contains(&value.node_id) && !model.plaat.steunknopen.contains(&value.node_id)
        });
        model.plaat.plan.resultaat(&model.los, &verplaatsing)
    };
    SolveResult3D {
        schema_version: CONTRACT_VERSION,
        engine: engine_info(),
        analysis: request.analysis,
        displacements: results.displacements.into_iter().map(|value| Displacement3D {
            node_id: value.node_id, ux: value.ux, uy: value.uy, uz: value.uz,
            rx: value.rx, ry: value.ry, rz: value.rz,
        }).collect(),
        reactions: results.reactions.into_iter().map(|value| Reaction3D {
            node_id: value.node_id, fx: value.fx, fy: value.fy, fz: value.fz,
            mx: value.mx, my: value.my, mz: value.mz,
        }).collect(),
        member_forces,
        diagrams,
        second_order,
        buckling,
        equilibrium,
        solver_path,
        diagnostics,
        plates,
        shell_elements,
        shell_nodes,
        inactive_members: vec![],
        tension_only_rounds: 0,
        tension_only_fit: vec![],
        cross_rule_members: vec![],
        bedding,
        plate_bedding,
        second_order_parts: vec![],
        n_vast_einden: model.n_vast_einden.clone(),
    }
}

/// Grens op de draaiing waarboven de kleine-verplaatsingentheorie niet meer
/// vanzelf geldt: 0,05 rad ≈ 2,9° (tan θ wijkt dan 0,08 % van θ af, maar de
/// geometrie van een staaf die zoveel draait verandert merkbaar). Voorstel
/// uit de controle van issue #244 (punt 054) — GEEN normeis.
const GROTE_DRAAIING_RAD: f64 = 0.05;
/// Grens op de verplaatsing: L/50 met L de grootste afmeting van het model.
/// Eveneens het voorstel uit de controle, geen normeis.
const GROTE_VERPLAATSING_NOEMER: f64 = 50.0;

/// Waarschuwing bij een uitkomst buiten de kleine-verplaatsingentheorie
/// (issue #244, punt 054). Zowel de lineaire berekening als de P-Δ-iteratie
/// rekenen met de onvervormde geometrie voor de evenwichtsrichtingen; een
/// draaiing van 12° of een zakking van L/19 (gemeten: plaat 6 × 3 m op twee
/// liggers met vrije r_x) gaf alleen solverdiagnostiek. Het resultaat blijft
/// staan; de melding zegt dat het buiten het geldigheidsgebied ligt.
fn grote_vervorming(request: &SolveRequest3D, solved: &SolveResult3D) -> Option<String> {
    let (mut laag, mut hoog) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for n in &request.nodes {
        for (i, c) in [n.x, n.y, n.z].into_iter().enumerate() {
            laag[i] = laag[i].min(c);
            hoog[i] = hoog[i].max(c);
        }
    }
    let l = (0..3).map(|i| hoog[i] - laag[i]).filter(|v| v.is_finite()).fold(0.0, f64::max);
    if !(l > 0.0) { return None; }
    let grens_u = l / GROTE_VERPLAATSING_NOEMER;
    let mut draai: Option<(f64, usize)> = None;
    let mut verpl: Option<(f64, usize)> = None;
    for d in &solved.displacements {
        let r = (d.rx * d.rx + d.ry * d.ry + d.rz * d.rz).sqrt();
        let u = (d.ux * d.ux + d.uy * d.uy + d.uz * d.uz).sqrt();
        if r.is_finite() && draai.is_none_or(|(m, _)| r > m) { draai = Some((r, d.node_id)); }
        if u.is_finite() && verpl.is_none_or(|(m, _)| u > m) { verpl = Some((u, d.node_id)); }
    }
    let mut delen = Vec::new();
    if let Some((r, knoop)) = draai.filter(|(r, _)| *r > GROTE_DRAAIING_RAD) {
        delen.push(format!(
            "draaiing {r:.4} rad ({:.1}°) bij knoop {knoop} > {GROTE_DRAAIING_RAD} rad",
            r.to_degrees()
        ));
    }
    if let Some((u, knoop)) = verpl.filter(|(u, _)| *u > grens_u) {
        delen.push(format!(
            "verplaatsing {:.1} mm bij knoop {knoop} = L/{:.0} > L/{GROTE_VERPLAATSING_NOEMER:.0} \
             (L = {:.3} m, grootste modelafmeting)",
            u * 1000.0,
            l / u,
            l
        ));
    }
    if delen.is_empty() { return None; }
    Some(format!(
        "WAARSCHUWING grote vervorming: {}. De berekening gaat uit van kleine verplaatsingen \
         (evenwicht in de onvervormde stand); bij deze vervorming geldt dat niet meer \
         vanzelf en zijn krachten en verplaatsingen niet betrouwbaar. Waarschijnlijk is \
         een vrijheidsgraad (bijna) niet gesteund of is de constructie te slap. Grenzen \
         {GROTE_DRAAIING_RAD} rad en L/{GROTE_VERPLAATSING_NOEMER:.0}: signaleringsgrenzen, \
         geen normeis.",
        delen.join("; ")
    ))
}

fn max_dof_magnitude(results: &AnalysisResults3D) -> f64 {
    results.displacements.iter()
        .flat_map(|value| [value.ux, value.uy, value.uz, value.rx, value.ry, value.rz])
        .map(f64::abs)
        .fold(0.0, f64::max)
}

/// Algemene uitleg bij een mechanisme; staat ook achter de specifieke melding
/// van `opleggingen` voor gevallen die die controle niet vangt.
pub(crate) const MECHANISME_UITLEG: &str = "Controleer per verbonden modeldeel drie onafhankelijke translatie- en rotatieblokkeringen. Bij 3D-staven moet torsie om de staafas op minstens één plaats zijn geblokkeerd, bijvoorbeeld met een inklemming, passende revolute-oplegging of rotatieveer.";

fn is_singular(detail: &str) -> bool {
    let normalized = detail.to_ascii_lowercase();
    normalized.contains("singular") || normalized.contains("mechanism")
}

fn solver_error(context: &str, error: impl std::fmt::Display) -> String {
    let detail = error.to_string();
    if is_singular(&detail) {
        return format!(
            "{context}: het model is een mechanisme of onvoldoende opgelegd (singuliere stijfheidsmatrix). {MECHANISME_UITLEG} Engine: {detail}",
        );
    }
    format!("{context}: {detail}")
}

/// Fout van de kern bij het oplossen van `request`. Bij een singuliere
/// stijfheidsmatrix zegt de controle op de opleggingen welk deel welke
/// beweging vrij heeft (#64).
fn engine_error(request: &SolveRequest3D, context: &str, error: impl std::fmt::Display) -> String {
    let detail = error.to_string();
    if is_singular(&detail) {
        return opleggingen::singuliere_fout(request, context, &detail);
    }
    format!("{context}: {detail}")
}

fn require_usable_solution(context: &str, results: &AnalysisResults3D) -> Result<(), String> {
    if let Some(equilibrium) = &results.equilibrium {
        if !equilibrium.residual_ok || !equilibrium.relative_residual.is_finite() {
            return Err(format!(
                "{context}: de numerieke oplossing is geweigerd omdat het relatieve solverresidu {:.3e} te groot is. Het model is waarschijnlijk een mechanisme of slecht geconditioneerd. Controleer per verbonden modeldeel de translatie- en rotatieblokkeringen; blokkeer bij 3D-staven ook torsie om de staafas met een inklemming, passende revolute-oplegging of rotatieveer.",
                equilibrium.relative_residual,
            ));
        }
    }
    if !max_dof_magnitude(results).is_finite() {
        return Err(format!(
            "{context}: de numerieke oplossing bevat geen eindige verplaatsingen. Controleer opleggingen, veren, staafstijfheden en mechanismen.",
        ));
    }
    Ok(())
}

/// Per rekenknoop die de adapter langs een staaf aanlegt (niet in het
/// verzoek): de staaf. Voor de meldingen over een mechanisme (#195).
fn rekenknopen(request: &SolveRequest3D, model: &EngineModel) -> BTreeMap<usize, usize> {
    let modelknopen: BTreeSet<usize> = request.nodes.iter().map(|node| node.id).collect();
    let mut uit = BTreeMap::new();
    for member in &model.members {
        for part in &member.parts {
            for knoop in [part.node_i, part.node_j] {
                if !modelknopen.contains(&knoop) { uit.insert(knoop, member.member_id); }
            }
        }
    }
    uit
}

/// Validate, route, solve, and translate one 3D request.
///
/// Trek-alleen staven en bedding met alleen druk lopen via een buitenlus
/// (`trek_alleen`) die elke ronde `solve_fixed` aanroept; zonder die twee is
/// dat één aanroep.
pub fn solve(request: SolveRequest3D) -> Result<SolveResult3D, String> {
    let plate_geometry = validate(&request)?;
    // Montagelasten: dezelfde keuring als de gewone lasten, op het verzoek
    // waarmee de montage ook gerekend wordt.
    if let Some(montage) = montage::verzoek(&request) {
        validate(&montage).map_err(|fout| format!("tensionOnlyFit: {fout}"))?;
    }
    // Kan een verbonden modeldeel als star lichaam bewegen (#64)? Bij platen
    // is dat een fout vóór het oplossen: de kern zou een mechanisme pas na een
    // dichte terugvaloplossing melden, en die is voor een fijn plaatnet
    // onbetaalbaar. Anders volgt een melding als de kern toch een oplossing vindt.
    let bevindingen = opleggingen::controleer(&request, &HashSet::new());
    if !request.shell_elements.is_empty() {
        if request.analysis == AnalysisKind::PDelta {
            return Err(
                "tweede-orde-analyse (P-Delta) met platen is nog niet beschikbaar: de geometrische stijfheid                  van de adapter kent alleen raamwerkstaven, geen plaatelementen. Reken dit model lineair                  (eerste orde)."
                    .into(),
            );
        }
        if bevindingen.iter().any(|bevinding| bevinding.tekort()) { return Err(opleggingen::plaatfout(&bevindingen)); }
    }
    let mut result = trek_alleen::los_op(&request, &plate_geometry)?;
    // De eindtoestand telt: trek-alleen staven op druk doen niet mee.
    let inactive: HashSet<usize> = result.inactive_members.iter().copied().collect();
    let bevindingen = if inactive.is_empty() { bevindingen } else { opleggingen::controleer(&request, &inactive) };
    if let Some(melding) = opleggingen::waarschuwing(&bevindingen) { result.diagnostics.insert(0, melding); }
    Ok(result)
}

/// De knikanalyse van een lineaire berekening op het onderverdeelde model
/// (`KNIKDELEN`): een eigen eerste-ordeoplossing geeft de normaalkracht per
/// deel, de knikfactoren komen uit dat model en de knikgegevens per staaf van
/// het model. Onderverdeeld worden de staven in `gedrukt`, de in de eerste
/// orde gedrukte staven (`gedrukte_staven`). `None` als er niets te
/// onderverdelen is (geen gedrukte staaf, of alleen trek-alleen staven en
/// staven op bedding), of zonder knikanalyse: dan geldt de knik van het model
/// zelf, precies als voorheen.
fn knik_onderverdeeld(
    request: &SolveRequest3D,
    los: &bedding::Los,
    buckling_modes: usize,
    gedrukt: &HashSet<usize>,
) -> Option<BucklingSummary> {
    if buckling_modes == 0 || !request.shell_elements.is_empty() || gedrukt.is_empty() {
        return None;
    }
    let mut model = match to_engine_input(request, los, Some(gedrukt)) {
        Ok(model) if model.knikknopen.is_empty() => return None,
        Ok(model) => model,
        Err(reden) => return Some(BucklingSummary::Failed { reason: reden }),
    };
    let draaiing = knoopdraaiing::Vastzetting::bepaal(&model.input);
    draaiing.pas_toe(&mut model.input);
    let context = "knikanalyse op de onderverdeelde staven";
    let mut results = match solve_3d(&model.input) {
        Ok(results) => results,
        Err(fout) => return Some(BucklingSummary::Failed { reason: solver_error(context, fout) }),
    };
    if let Err(reden) = tweede_orde::herstel_residu(&model.input, &mut results)
        .and_then(|_| require_usable_solution(context, &results))
    {
        return Some(BucklingSummary::Failed { reason: reden });
    }
    Some(buckling_per_member(&model, tweede_orde::knik_bij_eerste_orde(&model.input, &results, buckling_modes)))
}

/// Een staaf die in de eerste orde meer druk krijgt dan zijn eigen knikkracht.
struct BovenEulerlast {
    member_id: usize,
    doorsnede: String,
    lengte_m: f64,
    n_kn: f64,
    n_cr_kn: f64,
}

/// De staven waarvan de grootste drukkracht in de eerste orde boven de
/// eigen knikkracht π²·E·I_min/L² ligt (aan beide einden scharnierend,
/// L_cr = L), de zwaarst belaste eerst. Sinds de staven voor de knik in delen
/// worden gerekend (`KNIKDELEN`), knikt zo'n staaf zelf en is de tweede orde
/// instabiel; de melding noemt ze, zodat de gebruiker weet welke staaf het is.
fn staven_boven_eulerlast(request: &SolveRequest3D, model: &EngineModel, lineair: &AnalysisResults3D) -> Vec<BovenEulerlast> {
    let krachten: HashMap<usize, &rekenkern::types::ElementForces3D> =
        lineair.element_forces.iter().map(|krachten| (krachten.element_id, krachten)).collect();
    let mut uit: Vec<BovenEulerlast> = model.members.iter().filter_map(|delen| {
        let staaf = request.members.iter().find(|staaf| staaf.id == delen.member_id)?;
        let n_kn = delen.parts.iter()
            .filter_map(|deel| krachten.get(&deel.engine_id))
            .map(|k| k.n_start.min(k.n_end))
            .fold(f64::INFINITY, f64::min);
        let materiaal = request.materials.iter().find(|m| m.id == staaf.material_id)?;
        let i_min = delen.parts.iter()
            .filter_map(|deel| model.input.elements.get(&deel.engine_id.to_string()))
            .filter_map(|element| model.input.sections.values().find(|s| s.id == element.section_id))
            .map(|s| s.iy.min(s.iz))
            .fold(f64::INFINITY, f64::min);
        let n_cr_kn = std::f64::consts::PI.powi(2) * materiaal.e_mpa * 1000.0 * i_min / delen.length_m.powi(2);
        (n_kn < 0.0 && n_cr_kn.is_finite() && -n_kn > n_cr_kn).then(|| BovenEulerlast {
            member_id: staaf.id,
            doorsnede: request.sections.iter().find(|s| s.id == staaf.section_id).map(|s| s.name.clone()).unwrap_or_default(),
            lengte_m: delen.length_m,
            n_kn,
            n_cr_kn,
        })
    }).collect();
    uit.sort_by(|a, b| (b.n_kn.abs() / b.n_cr_kn).total_cmp(&(a.n_kn.abs() / a.n_cr_kn)));
    uit
}

/// Een melding van instabiliteit in de tweede orde, met de staven die hun
/// eigen knikkracht overschrijden (`staven_boven_eulerlast`).
fn met_eigen_knik(fout: String, staven: &[BovenEulerlast]) -> String {
    if staven.is_empty() || !fout.contains("instabiliteit") { return fout; }
    let komma = |waarde: f64, decimalen: usize| format!("{waarde:.decimalen$}").replace('.', ",");
    let lijst: Vec<String> = staven.iter().take(5).map(|staaf| format!(
        "staaf {} ({}, L = {} m): N = {} kN, N_cr = {} kN",
        staaf.member_id, staaf.doorsnede, komma(staaf.lengte_m, 3), komma(staaf.n_kn, 2), komma(staaf.n_cr_kn, 2),
    )).collect();
    let meer = if staven.len() > 5 { format!(" en nog {} staaf/staven", staven.len() - 5) } else { String::new() };
    format!(
        "{fout} In de eerste orde krijgen deze staven meer druk dan hun eigen knikkracht π²·E·I/L² (aan beide einden scharnierend, L_cr = L): {}{meer}. Zo'n staaf knikt zelf; maak een slank verband trek-alleen, steun de staaf tussentijds of kies een zwaarder profiel.",
        lijst.join("; "),
    )
}

/// Eén berekening met een vaste set staven en, bij bedding met alleen druk,
/// een vaste set weggevallen grondveren (`los`). De tweede orde en de
/// stabiliteitspoort (eerste knikfactor) rekent de adapter zelf, zie
/// `tweede_orde`.
pub(crate) fn solve_fixed(
    request: &SolveRequest3D,
    plate_geometry: &HashMap<usize, shell::PlateGeometry>,
    analysis: AnalysisKind,
    buckling_modes: usize,
    los: &bedding::Los,
) -> Result<SolveResult3D, String> {
    // Eerst het model zoals het is. Een lineaire berekening blijft daarop; de
    // tweede orde gaat daarna naar het model met de gedrukte staven in delen
    // (`KNIKDELEN`, `gedrukte_staven`).
    let mut model = to_engine_input(request, los, None)?;
    // Knoopdraaiingen die van geen element stijfheid krijgen (scharnierende
    // staafeinden) houdt de adapter vast; zie `knoopdraaiing` (#96).
    let mut draaiing = knoopdraaiing::Vastzetting::bepaal(&model.input);
    draaiing.pas_toe(&mut model.input);
    // Een fout die op een mechanisme kan wijzen, krijgt de bevindingen van de
    // controle op de opleggingen erbij (alleen als die iets vindt).
    let aanvullen = |fout: String| opleggingen::aanvullen(request, fout);
    let context = match analysis {
        AnalysisKind::Linear => "lineaire 3D-berekening",
        AnalysisKind::PDelta => "tweede-orde 3D-berekening",
    };
    // Issue #243 (punt 081): bij een mechanisme ook de knoop en de vrije
    // vrijheidsgraad noemen, uit de nulvorm van K (`mechanismevorm`).
    let met_vorm = |fout: String, input: &SolverInput3D| mechanismevorm::aanvullen(request, input, fout);
    // De eerste-ordeoplossing van de kern, gekeurd.
    let keur = |invoer: &SolverInput3D| -> Result<AnalysisResults3D, String> {
        let mut results = solve_3d(invoer).map_err(|error| engine_error(request, context, error))?;
        tweede_orde::herstel_residu(invoer, &mut results).map_err(aanvullen)?;
        require_usable_solution(context, &results).map_err(aanvullen)?;
        Ok(results)
    };
    let eerste = keur(&model.input);
    // Een fout van de kern die niet op een mechanisme wijst (een ongeldige
    // invoer), hoeft niet langs de proef.
    if let Err(fout) = &eerste {
        if !(fout.contains("singuliere stijfheidsmatrix") || fout.contains("solverresidu") || fout.contains("geen eindige verplaatsingen")) {
            return Err(met_vorm(fout.clone(), &model.input));
        }
    }
    // De proef op een mechanisme (#195, `mechanisme`): dezelfde ene
    // factorisatie als de proef van #110 die hij vervangt. Een regulier model
    // rekent verder precies zoals voorheen. Heeft het model een vrije beweging,
    // dan rekent de kern opnieuw met die beweging vastgehouden; stoot de
    // belasting haar aan, dan volgt een fout, anders een uitkomst met een
    // melding. Kan de controle zelf niet rekenen (dat hoort niet te gebeuren),
    // dan volgt het rekenpad van vóór #195, met een melding.
    let (mechanisme, niet_gecontroleerd) = match mechanisme::zoek(&model.input) {
        Ok(mechanisme) => (mechanisme, None),
        Err(fout) => (None, Some(format!(
            "Mechanisme: de controle op een mechanisme kon niet worden uitgevoerd ({fout}); de uitkomst is die van de kern zonder deze controle.",
        ))),
    };
    let staaf_van = if mechanisme.is_some() { rekenknopen(request, &model) } else { BTreeMap::new() };
    let mut results = match &mechanisme {
        None => eerste.map_err(|fout| met_vorm(fout, &model.input))?,
        Some(mechanisme) => keur(&mechanisme.invoer).map_err(|fout| met_vorm(fout, &mechanisme.invoer))?,
    };
    {
        let invoer = mechanisme.as_ref().map_or(&model.input, |m| &m.invoer);
        draaiing.controleer(context, request, invoer, &results)?;
    }
    if let Some(mechanisme) = &mechanisme {
        // Stoot de belasting de vrije beweging aan, dan ook de knoop en de
        // vrijheidsgraad erbij (#243, `mechanismevorm`).
        mechanisme
            .controleer(context, request, los, &staaf_van, &results, false)
            .map_err(|fout| met_vorm(fout, &model.input))?;
    }
    plaatbedding::controleer_vlak(context, &model.plaat)?;
    let gedrukt = gedrukte_staven(&model, &results);
    // Maken de drukkrachten een vrije beweging instabiel (knikfactor 0)?
    let instabiel = match &mechanisme {
        Some(mechanisme) => mechanisme.instabiel(&model.input, &results)?,
        None => false,
    };
    // De grootste kracht in de vasthouding van een plaat op bedding in haar vlak (#107).
    let vlakkracht: f64;
    let mut solved = match analysis {
        AnalysisKind::Linear => {
            vlakkracht = model.plaat.vlakkracht(&results);
            // De knik op het onderverdeelde model, als er iets te verdelen is;
            // de uitkomst hierboven blijft die van het model zoals het is. Een
            // vrije beweging die de drukkrachten instabiel maken, heeft
            // knikfactor 0: dan geen knikfactoren (de knikanalyse zou die
            // nulmode weglaten en een te hoge α_cr geven), maar de reden.
            let buckling = if instabiel && buckling_modes > 0 {
                BucklingSummary::Failed {
                    reason: "knikfactor 0: het model heeft een vrije beweging (mechanisme) die de drukkrachten van deze belasting instabiel maken; zie de meldingen over het mechanisme of de opleggingen.".into(),
                }
            } else {
                match knik_onderverdeeld(request, los, buckling_modes, &gedrukt) {
                    Some(buckling) => buckling,
                    None => buckling_per_member(&model, tweede_orde::knik_bij_eerste_orde(&model.input, &results, buckling_modes)),
                }
            };
            draaiing.ruim_op(&mut results);
            if let Some(mechanisme) = &mechanisme { mechanisme.ruim_op(&mut results, &draaiing); }
            convert_result(request, &model, plate_geometry, results, None, buckling)
        }
        AnalysisKind::PDelta => {
            if let (Some(mechanisme), true) = (&mechanisme, instabiel) {
                return Err(mechanisme.fout_instabiel(context, request, los, &staaf_van));
            }
            // De tweede orde rekent op het model met de gedrukte staven in
            // delen; de eerste orde daarvan is het beginpunt van de iteratie.
            // Zonder gedrukte staaf blijft het model zoals het is. Met een
            // mechanisme (dat de drukkrachten niet aanstoten, anders stond hier
            // al een fout) blijft het ook zo: de blokkeringen horen bij dit
            // model, en een gedeelde staaf zou een nieuwe proef vragen.
            let mut linear = results;
            let fijn = if mechanisme.is_none() { Some(to_engine_input(request, los, Some(&gedrukt))?) } else { None };
            if let Some(fijn) = fijn.filter(|fijn| !fijn.knikknopen.is_empty()) {
                model = fijn;
                draaiing = knoopdraaiing::Vastzetting::bepaal(&model.input);
                draaiing.pas_toe(&mut model.input);
                linear = solve_3d(&model.input).map_err(|error| engine_error(request, context, error))?;
                tweede_orde::herstel_residu(&model.input, &mut linear).map_err(aanvullen)?;
                require_usable_solution(context, &linear).map_err(aanvullen)?;
                draaiing.controleer(context, request, &model.input, &linear)?;
            }
            let input = mechanisme.as_ref().map_or(&model.input, |m| &m.invoer);
            vlakkracht = model.plaat.vlakkracht(&linear);
            let boven_eulerlast = staven_boven_eulerlast(request, &model, &linear);
            let mut second_order = tweede_orde::los_op(
                input, linear, request.max_iterations, request.tolerance, buckling_modes,
            ).map_err(|fout| met_eigen_knik(fout, &boven_eulerlast)).map_err(aanvullen)?;
            draaiing.controleer(context, request, input, &second_order.results)?;
            if let Some(mechanisme) = &mechanisme {
                mechanisme.controleer(context, request, los, &staaf_van, &second_order.results, true)?;
            }
            draaiing.ruim_op(&mut second_order.results);
            if let Some(mechanisme) = &mechanisme { mechanisme.ruim_op(&mut second_order.results, &draaiing); }
            let buckling = buckling_per_member(&model, second_order.buckling);
            let delen = model.tweede_orde_delen(&second_order.delen);
            let mut solved = convert_result(
                request, &model, plate_geometry, second_order.results, Some(second_order.summary), buckling,
            );
            solved.second_order_parts = delen;
            solved.diagnostics.extend(second_order.diagnostics);
            solved
        }
    };
    solved.diagnostics.extend(schijven::koppelingen(request).1);
    solved.diagnostics.extend(grote_vervorming(request, &solved));
    solved.diagnostics.extend(draaiing.melding(request));
    solved.diagnostics.extend(model.plaat.melding_vlak(vlakkracht));
    solved.diagnostics.extend(niet_gecontroleerd);
    if let Some(melding) = mechanisme.as_ref().and_then(|m| m.melding(request, los, &staaf_van, instabiel)) {
        solved.diagnostics.insert(0, melding);
    }
    Ok(solved)
}
