//! Versioned Open FEM boundary around the pinned external 3D frame engine.
//!
//! The application and project format only depend on the types in this crate.
//! Engine types are constructed at this boundary, so another frame, plate,
//! or solid engine can implement the same application contract later.

use std::collections::{HashMap, HashSet};

mod kruisregel;
mod montage;
mod schijven;
mod shell;
mod trek_alleen;
mod tweede_orde;
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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberLoad3D {
    pub id: usize,
    pub member_id: usize,
    pub qy_start_kn_per_m: f64,
    pub qy_end_kn_per_m: f64,
    pub qz_start_kn_per_m: f64,
    pub qz_end_kn_per_m: f64,
    #[serde(default)]
    pub start_position_m: Option<f64>,
    #[serde(default)]
    pub end_position_m: Option<f64>,
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
}

/// De montageverlenging van één trek-alleen staaf: zijn spanningsloze lengte
/// is L + Δ0. Negatief: het verband is korter gepast dan zijn tekenlengte.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TensionOnlyFitMember3D {
    pub member_id: usize,
    pub delta_mm: f64,
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

fn positive(value: f64, label: &str) -> Result<(), String> {
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
    if request.supports.is_empty() { return Err("een 3D-model heeft minstens één oplegging nodig".into()); }
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
        if let Some(alpha) = material.alpha_per_k {
            positive(alpha, &format!("uitzettingscoëfficiënt van materiaal {}", material.id))?;
        }
    }
    for section in &request.sections {
        positive(section.area_m2, &format!("A van doorsnede {}", section.id))?;
        positive(section.iy_m4, &format!("Iy van doorsnede {}", section.id))?;
        positive(section.iz_m4, &format!("Iz van doorsnede {}", section.id))?;
        positive(section.torsion_j_m4, &format!("J van doorsnede {}", section.id))?;
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
        if let Some(roll) = member.roll_angle_rad { finite(roll, "rollAngleRad")?; }
        member_stations(member, &node_by_id)?;
    }
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
        let values = [load.qy_start_kn_per_m, load.qy_end_kn_per_m,
            load.qz_start_kn_per_m, load.qz_end_kn_per_m];
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
    }
    let coordinates: HashMap<usize, [f64; 3]> = request.nodes.iter()
        .map(|node| (node.id, [node.x, node.y, node.z])).collect();
    let plate_geometry = shell::validate_shells(request, &coordinates)?;
    schijven::valideer(request)?;
    Ok(plate_geometry)
}

/// Tussenknopen van een staaf, geordend van begin naar eind, met hun afstand
/// tot de beginknoop (m). Leeg voor een ongeknipte staaf.
fn member_stations(member: &Member3D, node_by_id: &HashMap<usize, &Node3D>) -> Result<Vec<(usize, f64)>, String> {
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
}

#[derive(Debug, Clone)]
struct MemberParts {
    member_id: usize,
    length_m: f64,
    parts: Vec<MemberPart>,
}

/// Het kernmodel plus de vertaling terug naar het contract.
struct EngineModel {
    input: SolverInput3D,
    members: Vec<MemberParts>,
    /// `true` zodra minstens één staaf in delen gerekend wordt.
    split: bool,
    /// Kern-id's van de plaatelementen (voor het samenvatten van meldingen).
    shell_engine_ids: HashSet<usize>,
}

fn to_engine_input(request: &SolveRequest3D) -> Result<EngineModel, String> {
    let nodes = request.nodes.iter().map(|node| (node.id.to_string(), SolverNode3D {
        id: node.id, x: node.x, y: node.y, z: node.z,
    })).collect();
    let materials = request.materials.iter().map(|material| (material.id.to_string(), SolverMaterial {
        id: material.id, e: material.e_mpa, nu: material.nu,
    })).collect();
    let sections = request.sections.iter().map(|section| (section.id.to_string(), SolverSection3D {
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
    let node_by_id: HashMap<usize, &Node3D> = request.nodes.iter().map(|node| (node.id, node)).collect();

    // Een staaf met tussenknopen gaat in delen naar de kern. Het eerste deel
    // houdt de staaf-id; de overige delen en de plaatelementen krijgen id's
    // boven de hoogste staaf-id, zodat geen kern-id dubbel voorkomt.
    let mut next_engine_id = request.members.iter().map(|member| member.id).max().unwrap_or(0) + 1;
    let mut elements = HashMap::new();
    let mut member_parts = Vec::with_capacity(request.members.len());
    let mut split = false;
    for member in &request.members {
        let a = node_by_id[&member.start_node_id];
        let b = node_by_id[&member.end_node_id];
        let length = ((a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)).sqrt();
        let stations = member_stations(member, &node_by_id)?;
        let mut chain = vec![(member.start_node_id, 0.0)];
        chain.extend(stations.iter().copied());
        chain.push((member.end_node_id, length));
        split |= chain.len() > 2;
        let count = chain.len() - 1;
        let mut parts = Vec::with_capacity(count);
        for index in 0..count {
            let engine_id = if index == 0 { member.id } else { let id = next_engine_id; next_engine_id += 1; id };
            let first = index == 0;
            let last = index + 1 == count;
            elements.insert(engine_id.to_string(), SolverElement3D {
                id: engine_id,
                elem_type: "frame".into(),
                node_i: chain[index].0,
                node_j: chain[index + 1].0,
                material_id: member.material_id,
                section_id: member.section_id,
                release_my_start: first && member.releases.my_start,
                release_my_end: last && member.releases.my_end,
                release_mz_start: first && member.releases.mz_start,
                release_mz_end: last && member.releases.mz_end,
                release_t_start: first && member.releases.torsion_start,
                release_t_end: last && member.releases.torsion_end,
                local_yx: None,
                local_yy: None,
                local_yz: None,
                // The engine field is historically named without a unit, but its
                // local-axis routine interprets the value as degrees. The Open FEM
                // contract is explicit and uses radians.
                roll_angle: member.roll_angle_rad.map(f64::to_degrees),
            });
            parts.push(MemberPart { engine_id, start_m: chain[index].1, end_m: chain[index + 1].1 });
        }
        member_parts.push(MemberParts { member_id: member.id, length_m: length, parts });
    }
    let parts_by_member: HashMap<usize, &MemberParts> = member_parts.iter().map(|m| (m.member_id, m)).collect();

    let supports = request.supports.iter().enumerate().map(|(index, support)| ((index + 1).to_string(), SolverSupport3D {
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
    for load in &request.member_loads {
        let member = parts_by_member[&load.member_id];
        if member.parts.len() == 1 {
            // Ongeknipte staaf: exact de oude doorgifte, zodat bestaande
            // uitkomsten bit-gelijk blijven.
            loads.push(SolverLoad3D::Distributed(SolverDistributedLoad3D {
                element_id: member.parts[0].engine_id,
                q_yi: load.qy_start_kn_per_m,
                q_yj: load.qy_end_kn_per_m,
                q_zi: load.qz_start_kn_per_m,
                q_zj: load.qz_end_kn_per_m,
                a: load.start_position_m,
                b: load.end_position_m,
            }));
            continue;
        }
        let a = load.start_position_m.unwrap_or(0.0);
        let b = load.end_position_m.unwrap_or(member.length_m);
        let intensity = |start: f64, end: f64, s: f64| start + (end - start) * (s - a) / (b - a);
        for part in &member.parts {
            let low = a.max(part.start_m);
            let high = b.min(part.end_m);
            if high - low <= 1e-12 * member.length_m.max(1.0) { continue; }
            loads.push(SolverLoad3D::Distributed(SolverDistributedLoad3D {
                element_id: part.engine_id,
                q_yi: intensity(load.qy_start_kn_per_m, load.qy_end_kn_per_m, low),
                q_yj: intensity(load.qy_start_kn_per_m, load.qy_end_kn_per_m, high),
                q_zi: intensity(load.qz_start_kn_per_m, load.qz_end_kn_per_m, low),
                q_zj: intensity(load.qz_start_kn_per_m, load.qz_end_kn_per_m, high),
                a: Some(low - part.start_m),
                b: Some(high - part.start_m),
            }));
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
        for part in &parts_by_member[&load.member_id].parts {
            loads.push(SolverLoad3D::Thermal(SolverThermalLoad3D {
                element_id: part.engine_id,
                dt_uniform: load.delta_t_uniform_k * scale,
                dt_gradient_y: load.delta_t_gradient_y_k * scale,
                dt_gradient_z: load.delta_t_gradient_z_k * scale,
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
    for element in shell_elements {
        let plate = plate_by_id[&element.plate_id];
        let engine_id = next_engine_id;
        next_engine_id += 1;
        shell_engine_ids.insert(engine_id);
        if element.node_ids.len() == 4 {
            quads.insert(engine_id.to_string(), SolverQuadElement {
                id: engine_id,
                nodes: [element.node_ids[0], element.node_ids[1], element.node_ids[2], element.node_ids[3]],
                material_id: plate.material_id,
                thickness: plate.thickness_m,
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
    let input = SolverInput3D {
        nodes, materials, sections, elements, supports, loads,
        constraints: schijven::koppelingen(request).0, left_hand: None,
        plates, quads, quad9s: HashMap::new(),
        solid_shells: HashMap::new(), curved_shells: HashMap::new(),
        curved_beams: vec![], connectors: HashMap::new(),
    };
    Ok(EngineModel { input, members: member_parts, split, shell_engine_ids })
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
/// normaalkracht bepaalt N_cr; de kniklengte hoort bij de hele staaf.
fn merge_buckling_members(
    members: Vec<MemberBucklingData>,
    model: &EngineModel,
    lambda_cr: f64,
) -> Vec<MemberBucklingData> {
    let by_engine: HashMap<usize, MemberBucklingData> = members.into_iter().map(|m| (m.member_id, m)).collect();
    let mut merged = Vec::new();
    for member in &model.members {
        let governing = member.parts.iter()
            .filter_map(|part| by_engine.get(&part.engine_id).map(|data| (part, data)))
            .max_by(|a, b| a.1.axial_force_kn.abs().total_cmp(&b.1.axial_force_kn.abs()));
        let Some((part, data)) = governing else { continue };
        if member.parts.len() == 1 {
            merged.push(data.clone());
            continue;
        }
        let element = &model.input.elements[&part.engine_id.to_string()];
        let material = model.input.materials.values().find(|m| m.id == element.material_id);
        let section = model.input.sections.values().find(|s| s.id == element.section_id);
        let critical_force = lambda_cr * data.axial_force_kn.abs();
        let (factor, effective, slender_y, slender_z) = match (material, section) {
            (Some(material), Some(section)) if critical_force > 1e-6 => {
                let effective = std::f64::consts::PI
                    * (material.e * 1000.0 * section.iy.min(section.iz) / critical_force).sqrt();
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

/// Voeg de diagrammen van de delen samen tot één lijn over de hele staaf. Op
/// een tussenknoop blijven beide waarden staan, zodat een sprong (bijvoorbeeld
/// door de plaatreactie op een randligger) zichtbaar blijft.
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
        let mut points = Vec::new();
        for part in &member.parts {
            let Some(diagram) = by_engine.remove(&part.engine_id) else { continue };
            let span = part.end_m - part.start_m;
            points.extend(diagram.points.into_iter().map(|point| DiagramPoint3D {
                t: (part.start_m + point.t * span) / member.length_m,
                value: point.value,
            }));
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

/// Controleer vóór het oplossen dat elk verbonden modeldeel met platen als
/// star lichaam is vastgehouden. De kern zou een mechanisme pas na een dichte
/// terugvaloplossing melden, en die is voor een fijn plaatnet onbetaalbaar.
/// De kunstmatige draaiveer loodrecht op het plaatvlak telt hier niet mee.
fn check_rigid_body_restraint(request: &SolveRequest3D) -> Result<(), String> {
    let coordinates: HashMap<usize, [f64; 3]> = request.nodes.iter()
        .map(|node| (node.id, [node.x, node.y, node.z])).collect();
    let mut parent: HashMap<usize, usize> = coordinates.keys().map(|id| (*id, *id)).collect();
    fn find(parent: &mut HashMap<usize, usize>, id: usize) -> usize {
        let mut root = id;
        while parent[&root] != root { root = parent[&root]; }
        let mut current = id;
        while parent[&current] != root {
            let next = parent[&current];
            parent.insert(current, root);
            current = next;
        }
        root
    }
    let mut connected: HashSet<usize> = HashSet::new();
    let mut union = |parent: &mut HashMap<usize, usize>, ids: &[usize]| {
        for id in ids { connected.insert(*id); }
        for pair in ids.windows(2) {
            let a = find(parent, pair[0]);
            let b = find(parent, pair[1]);
            if a != b { parent.insert(a, b); }
        }
    };
    for member in &request.members {
        let mut chain = vec![member.start_node_id];
        chain.extend(member.intermediate_node_ids.iter().copied());
        chain.push(member.end_node_id);
        union(&mut parent, &chain);
    }
    for element in &request.shell_elements { union(&mut parent, &element.node_ids); }

    let mut components: std::collections::BTreeMap<usize, Vec<usize>> = std::collections::BTreeMap::new();
    let mut ids: Vec<usize> = coordinates.keys().copied().collect();
    ids.sort_unstable();
    for id in ids {
        let root = find(&mut parent, id);
        components.entry(root).or_default().push(id);
    }
    let supports: HashMap<usize, &Support3D> = request.supports.iter().map(|s| (s.node_id, s)).collect();
    const MODE_NAMES: [&str; 6] = [
        "verschuiving in X", "verschuiving in Y", "verschuiving in Z",
        "rotatie om X", "rotatie om Y", "rotatie om Z",
    ];
    for nodes in components.values() {
        let first = nodes[0];
        if nodes.len() == 1 && !connected.contains(&first) {
            let support = supports.get(&first);
            let full = support.is_some_and(|s| [s.ux, s.uy, s.uz, s.rx, s.ry, s.rz].iter().all(|v| *v));
            if full { continue; }
            return Err(format!(
                "knoop {first} hangt aan geen enkele staaf of plaat; verwijder hem of verbind hem met de constructie",
            ));
        }
        let centre = shell::scale(
            nodes.iter().fold([0.0; 3], |sum, id| shell::add(sum, coordinates[id])),
            1.0 / nodes.len() as f64,
        );
        let size = nodes.iter()
            .map(|id| shell::norm(shell::sub(coordinates[id], centre)))
            .fold(1.0_f64, f64::max);
        let mut gram = [[0.0_f64; 6]; 6];
        for id in nodes {
            let Some(support) = supports.get(id) else { continue };
            let restrained = [
                support.ux || support.kx_kn_per_m.is_some(),
                support.uy || support.ky_kn_per_m.is_some(),
                support.uz || support.kz_kn_per_m.is_some(),
                support.rx || support.krx_knm_per_rad.is_some(),
                support.ry || support.kry_knm_per_rad.is_some(),
                support.rz || support.krz_knm_per_rad.is_some(),
            ];
            let r = shell::sub(coordinates[id], centre);
            for (dof, fixed) in restrained.iter().enumerate() {
                if !fixed { continue; }
                // Rij van deze blokkering over de zes starre-lichaamsvormen;
                // rotaties zijn geschaald met 1/afmeting.
                let mut row = [0.0; 6];
                if dof < 3 {
                    row[dof] = 1.0;
                    for axis in 0..3 {
                        let mut e = [0.0; 3];
                        e[axis] = 1.0;
                        row[3 + axis] = shell::cross(e, r)[dof] / size;
                    }
                } else {
                    row[dof] = 1.0 / size;
                }
                for i in 0..6 { for j in 0..6 { gram[i][j] += row[i] * row[j]; } }
            }
        }
        let (values, vectors) = symmetric_eigen6(gram);
        let largest = values.iter().copied().fold(0.0_f64, f64::max);
        let mut free = Vec::new();
        for (index, value) in values.iter().enumerate() {
            if *value <= 1e-9 * largest.max(1e-12) || largest == 0.0 {
                let vector = vectors[index];
                let magnitude = vector.iter().map(|v| v * v).sum::<f64>().sqrt();
                for (mode, component) in vector.iter().enumerate() {
                    if component.abs() > 0.3 * magnitude && !free.contains(&MODE_NAMES[mode]) {
                        free.push(MODE_NAMES[mode]);
                    }
                }
            }
        }
        if !free.is_empty() {
            return Err(format!(
                "het model is een mechanisme: het deel met knoop {first} is onvoldoende opgelegd en kan als \
                 star lichaam bewegen ({}). Een plaat die alleen loodrecht op haar vlak is opgelegd heeft \
                 ook steun in haar vlak nodig, bijvoorbeeld twee richtingen in één knoop en één richting \
                 in een tweede knoop.",
                free.join(", "),
            ));
        }
    }
    Ok(())
}

/// Eigenwaarden en -vectoren van een symmetrische 6×6-matrix (Jacobi).
fn symmetric_eigen6(mut a: [[f64; 6]; 6]) -> ([f64; 6], [[f64; 6]; 6]) {
    let mut v = [[0.0; 6]; 6];
    for (i, row) in v.iter_mut().enumerate() { row[i] = 1.0; }
    for _sweep in 0..100 {
        let off: f64 = (0..6).flat_map(|i| (0..6).map(move |j| (i, j)))
            .filter(|(i, j)| i != j).map(|(i, j)| a[i][j] * a[i][j]).sum();
        if off < 1e-30 { break; }
        for p in 0..6 {
            for q in (p + 1)..6 {
                if a[p][q].abs() < 1e-300 { continue; }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let t = if theta == 0.0 { 1.0 } else { t };
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..6 {
                    let akp = a[k][p];
                    let akq = a[k][q];
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for k in 0..6 {
                    let apk = a[p][k];
                    let aqk = a[q][k];
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for k in 0..6 {
                    let vkp = v[k][p];
                    let vkq = v[k][q];
                    v[k][p] = c * vkp - s * vkq;
                    v[k][q] = s * vkp + c * vkq;
                }
            }
        }
    }
    let values = std::array::from_fn(|i| a[i][i]);
    // Kolom i van v is de eigenvector bij waarde i.
    let vectors = std::array::from_fn(|i| std::array::from_fn(|k| v[k][i]));
    (values, vectors)
}

/// Kwaliteitsmeldingen van de kern over plaatelementen, samengevat per soort:
/// een fijn net geeft anders honderden losse regels.
fn summarize_diagnostics(results: &AnalysisResults3D, shell_engine_ids: &HashSet<usize>) -> Vec<String> {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut messages = Vec::new();
    for item in &results.structured_diagnostics {
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
    let engine_diagrams = compute_diagrams_3d(&results);
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
    let diagnostics = summarize_diagnostics(&results, &model.shell_engine_ids);
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
    }
}

fn max_dof_magnitude(results: &AnalysisResults3D) -> f64 {
    results.displacements.iter()
        .flat_map(|value| [value.ux, value.uy, value.uz, value.rx, value.ry, value.rz])
        .map(f64::abs)
        .fold(0.0, f64::max)
}

fn solver_error(context: &str, error: impl std::fmt::Display) -> String {
    let detail = error.to_string();
    let normalized = detail.to_ascii_lowercase();
    if normalized.contains("singular") || normalized.contains("mechanism") {
        return format!(
            "{context}: het model is een mechanisme of onvoldoende opgelegd (singuliere stijfheidsmatrix). Controleer per verbonden modeldeel drie onafhankelijke translatie- en rotatieblokkeringen. Bij 3D-staven moet torsie om de staafas op minstens één plaats zijn geblokkeerd, bijvoorbeeld met een inklemming, passende revolute-oplegging of rotatieveer. Engine: {detail}",
        );
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

/// Validate, route, solve, and translate one 3D request.
///
/// Trek-alleen staven lopen via een buitenlus (`trek_alleen`) die elke ronde
/// `solve_fixed` aanroept; zonder trek-alleen staven is dat één aanroep.
pub fn solve(request: SolveRequest3D) -> Result<SolveResult3D, String> {
    let plate_geometry = validate(&request)?;
    // Montagelasten: dezelfde keuring als de gewone lasten, op het verzoek
    // waarmee de montage ook gerekend wordt.
    if let Some(montage) = montage::verzoek(&request) {
        validate(&montage).map_err(|fout| format!("tensionOnlyFit: {fout}"))?;
    }
    if !request.shell_elements.is_empty() {
        if request.analysis == AnalysisKind::PDelta {
            return Err(
                "tweede-orde-analyse (P-Delta) met platen is nog niet beschikbaar: de geometrische stijfheid                  van de adapter kent alleen raamwerkstaven, geen plaatelementen. Reken dit model lineair                  (eerste orde)."
                    .into(),
            );
        }
        check_rigid_body_restraint(&request)?;
    }
    trek_alleen::los_op(&request, &plate_geometry)
}

/// Eén berekening met een vaste set staven. De tweede orde en de
/// stabiliteitspoort (eerste knikfactor) rekent de adapter zelf, zie
/// `tweede_orde`.
pub(crate) fn solve_fixed(
    request: &SolveRequest3D,
    plate_geometry: &HashMap<usize, shell::PlateGeometry>,
    analysis: AnalysisKind,
    buckling_modes: usize,
) -> Result<SolveResult3D, String> {
    let model = to_engine_input(request)?;
    let input = &model.input;
    let mut solved = match analysis {
        AnalysisKind::Linear => {
            let mut results = solve_3d(input).map_err(|error| solver_error("lineaire 3D-berekening", error))?;
            tweede_orde::herstel_residu(input, &mut results)?;
            require_usable_solution("lineaire 3D-berekening", &results)?;
            let buckling = buckling_per_member(&model, tweede_orde::knik_bij_eerste_orde(input, &results, buckling_modes));
            convert_result(request, &model, plate_geometry, results, None, buckling)
        }
        AnalysisKind::PDelta => {
            let mut linear = solve_3d(input).map_err(|error| solver_error("tweede-orde 3D-berekening", error))?;
            tweede_orde::herstel_residu(input, &mut linear)?;
            require_usable_solution("tweede-orde 3D-berekening", &linear)?;
            let second_order = tweede_orde::los_op(
                input, linear, request.max_iterations, request.tolerance, buckling_modes,
            )?;
            let buckling = buckling_per_member(&model, second_order.buckling);
            let mut solved = convert_result(
                request, &model, plate_geometry, second_order.results, Some(second_order.summary), buckling,
            );
            solved.diagnostics.extend(second_order.diagnostics);
            solved
        }
    };
    solved.diagnostics.extend(schijven::koppelingen(request).1);
    Ok(solved)
}
