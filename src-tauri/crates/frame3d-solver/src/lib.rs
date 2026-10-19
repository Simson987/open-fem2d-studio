//! Versioned Open FEM boundary around the pinned Dedaliano/Stabileo engine.
//!
//! The application and project format only depend on the types in this crate.
//! Dedaliano types are constructed at this boundary, so another frame, plate,
//! or solid engine can implement the same application contract later.

use std::collections::{HashMap, HashSet};

use dedaliano_engine::{
    postprocess::diagrams_3d::{compute_diagrams_3d, ElementDiagram3D as EngineElementDiagram3D},
    solver::{buckling::solve_buckling_3d, linear::solve_3d, pdelta::solve_pdelta_3d},
    types::{
        AnalysisResults3D, SolverDistributedLoad3D, SolverElement3D, SolverInput3D, SolverLoad3D,
        SolverMaterial, SolverNodalLoad3D, SolverNode3D, SolverPointLoad3D, SolverSection3D,
        SolverSupport3D, SolverThermalLoad3D,
    },
};
use serde::{Deserialize, Serialize};

pub const CONTRACT_VERSION: u32 = 1;
pub const ENGINE_ID: &str = "dedaliano";
pub const ENGINE_NAME: &str = "Dedaliano / Stabileo";
pub const ENGINE_REVISION: &str = "7d87e551b765c88956df95b375e0ef0befda53f7";

fn default_contract_version() -> u32 {
    CONTRACT_VERSION
}
fn default_max_iterations() -> usize {
    50
}
fn default_tolerance() -> f64 {
    1e-8
}
fn default_buckling_modes() -> usize {
    3
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AnalysisKind {
    Linear,
    PDelta,
}

impl Default for AnalysisKind {
    fn default() -> Self {
        Self::PDelta
    }
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
    #[serde(default)]
    pub my_start: bool,
    #[serde(default)]
    pub my_end: bool,
    #[serde(default)]
    pub mz_start: bool,
    #[serde(default)]
    pub mz_end: bool,
    #[serde(default)]
    pub torsion_start: bool,
    #[serde(default)]
    pub torsion_end: bool,
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
    #[serde(default)]
    pub kx_kn_per_m: Option<f64>,
    #[serde(default)]
    pub ky_kn_per_m: Option<f64>,
    #[serde(default)]
    pub kz_kn_per_m: Option<f64>,
    /// Rotational spring stiffnesses in global axes, in kNm/rad.
    #[serde(default)]
    pub krx_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub kry_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub krz_knm_per_rad: Option<f64>,
    /// Opgelegde globale verplaatsingen op geblokkeerde vrijheidsgraden.
    /// Translaties zijn in m; rotaties in rad.
    #[serde(default)]
    pub ux_prescribed_m: Option<f64>,
    #[serde(default)]
    pub uy_prescribed_m: Option<f64>,
    #[serde(default)]
    pub uz_prescribed_m: Option<f64>,
    #[serde(default)]
    pub rx_prescribed_rad: Option<f64>,
    #[serde(default)]
    pub ry_prescribed_rad: Option<f64>,
    #[serde(default)]
    pub rz_prescribed_rad: Option<f64>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SolveRequest3D {
    #[serde(default = "default_contract_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub analysis: AnalysisKind,
    pub nodes: Vec<Node3D>,
    pub materials: Vec<Material3D>,
    pub sections: Vec<Section3D>,
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
        element_families: vec!["frame".into()],
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
    NotApplicable {
        reason: String,
    },
    Failed {
        reason: String,
    },
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
}

fn convert_member_diagram(value: EngineElementDiagram3D) -> MemberDiagram3D {
    MemberDiagram3D {
        member_id: value.element_id,
        points: value
            .points
            .into_iter()
            .map(|point| DiagramPoint3D {
                t: point.t,
                value: point.value,
            })
            .collect(),
        max_value: value.max_value,
        min_value: value.min_value,
        // Upstream bewaart hier de waarde met teken die de grootste absolute
        // waarde heeft. Aan de applicatiegrens maken we de naam ondubbelzinnig.
        max_abs_value: value.max_abs_value.abs(),
    }
}

fn finite(value: f64, label: &str) -> Result<(), String> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(format!("{label} is niet eindig"))
    }
}

fn positive(value: f64, label: &str) -> Result<(), String> {
    finite(value, label)?;
    if value > 0.0 {
        Ok(())
    } else {
        Err(format!("{label} moet groter zijn dan nul"))
    }
}

fn unique_ids<T>(
    items: &[T],
    id: impl Fn(&T) -> usize,
    label: &str,
) -> Result<HashSet<usize>, String> {
    let mut ids = HashSet::new();
    for item in items {
        let value = id(item);
        if value == 0 {
            return Err(format!("{label}-id 0 is niet toegestaan"));
        }
        if !ids.insert(value) {
            return Err(format!("dubbele {label}-id {value}"));
        }
    }
    Ok(ids)
}

fn validate(request: &SolveRequest3D) -> Result<(), String> {
    if request.schema_version != CONTRACT_VERSION {
        return Err(format!(
            "onbekende 3D-contractversie {}; verwacht {CONTRACT_VERSION}",
            request.schema_version
        ));
    }
    if request.nodes.len() < 2 {
        return Err("een 3D-model heeft minstens twee knopen nodig".into());
    }
    if request.members.is_empty() {
        return Err("een 3D-model heeft minstens één staaf nodig".into());
    }
    if request.supports.is_empty() {
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
        finite(node.x, "knoop X")?;
        finite(node.y, "knoop Y")?;
        finite(node.z, "knoop Z")?;
    }
    for material in &request.materials {
        positive(material.e_mpa, &format!("E van materiaal {}", material.id))?;
        finite(material.nu, &format!("nu van materiaal {}", material.id))?;
        if !(-0.999..0.5).contains(&material.nu) {
            return Err(format!(
                "nu van materiaal {} moet tussen -0,999 en 0,5 liggen",
                material.id
            ));
        }
        if let Some(alpha) = material.alpha_per_k {
            positive(
                alpha,
                &format!("uitzettingscoëfficiënt van materiaal {}", material.id),
            )?;
        }
    }
    for section in &request.sections {
        positive(section.area_m2, &format!("A van doorsnede {}", section.id))?;
        positive(section.iy_m4, &format!("Iy van doorsnede {}", section.id))?;
        positive(section.iz_m4, &format!("Iz van doorsnede {}", section.id))?;
        positive(
            section.torsion_j_m4,
            &format!("J van doorsnede {}", section.id),
        )?;
    }
    let node_by_id: HashMap<_, _> = request.nodes.iter().map(|node| (node.id, node)).collect();
    for member in &request.members {
        let a = node_by_id.get(&member.start_node_id).ok_or_else(|| {
            format!(
                "staaf {} verwijst naar ontbrekende startknoop {}",
                member.id, member.start_node_id
            )
        })?;
        let b = node_by_id.get(&member.end_node_id).ok_or_else(|| {
            format!(
                "staaf {} verwijst naar ontbrekende eindknoop {}",
                member.id, member.end_node_id
            )
        })?;
        if member.start_node_id == member.end_node_id
            || ((a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)).sqrt() <= 1e-9
        {
            return Err(format!("staaf {} heeft geen bruikbare lengte", member.id));
        }
        if !material_ids.contains(&member.material_id) {
            return Err(format!(
                "staaf {} verwijst naar ontbrekend materiaal {}",
                member.id, member.material_id
            ));
        }
        if !section_ids.contains(&member.section_id) {
            return Err(format!(
                "staaf {} verwijst naar ontbrekende doorsnede {}",
                member.id, member.section_id
            ));
        }
        if let Some(roll) = member.roll_angle_rad {
            finite(roll, "rollAngleRad")?;
        }
    }
    let mut support_nodes = HashSet::new();
    for support in &request.supports {
        if !node_ids.contains(&support.node_id) {
            return Err(format!(
                "oplegging verwijst naar ontbrekende knoop {}",
                support.node_id
            ));
        }
        if !support_nodes.insert(support.node_id) {
            return Err(format!("dubbele oplegging op knoop {}", support.node_id));
        }
        let fixed = [
            support.ux, support.uy, support.uz, support.rx, support.ry, support.rz,
        ];
        let springs = [
            support.kx_kn_per_m,
            support.ky_kn_per_m,
            support.kz_kn_per_m,
            support.krx_knm_per_rad,
            support.kry_knm_per_rad,
            support.krz_knm_per_rad,
        ];
        let prescribed = [
            support.ux_prescribed_m,
            support.uy_prescribed_m,
            support.uz_prescribed_m,
            support.rx_prescribed_rad,
            support.ry_prescribed_rad,
            support.rz_prescribed_rad,
        ];
        for (index, spring) in springs.iter().enumerate() {
            if let Some(value) = spring {
                positive(
                    *value,
                    &format!("veerstijfheid {} op knoop {}", index + 1, support.node_id),
                )?;
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
                finite(
                    *value,
                    &format!(
                        "opgelegde verplaatsing {} op knoop {}",
                        index + 1,
                        support.node_id
                    ),
                )?;
                if !fixed[index] {
                    return Err(format!(
                        "opgelegde verplaatsing {} op knoop {} vereist een geblokkeerde vrijheidsgraad",
                        index + 1, support.node_id,
                    ));
                }
            }
        }
        if !fixed.into_iter().any(|value| value)
            && !springs.into_iter().any(|value| value.is_some())
        {
            return Err(format!(
                "oplegging op knoop {} blokkeert of veert geen vrijheidsgraad",
                support.node_id
            ));
        }
    }
    for load in &request.nodal_loads {
        if !node_ids.contains(&load.node_id) {
            return Err(format!(
                "belasting {} verwijst naar ontbrekende knoop {}",
                load.id, load.node_id
            ));
        }
        let values = [load.fx, load.fy, load.fz, load.mx, load.my, load.mz];
        if values.iter().any(|v| !v.is_finite()) {
            return Err(format!("belasting {} bevat geen eindige waarde", load.id));
        }
        if values.iter().all(|v| *v == 0.0) {
            return Err(format!("belasting {} bevat alleen nulwaarden", load.id));
        }
    }
    for load in &request.member_loads {
        if !member_ids.contains(&load.member_id) {
            return Err(format!(
                "staafbelasting {} verwijst naar ontbrekende staaf {}",
                load.id, load.member_id
            ));
        }
        let values = [
            load.qy_start_kn_per_m,
            load.qy_end_kn_per_m,
            load.qz_start_kn_per_m,
            load.qz_end_kn_per_m,
        ];
        if values.iter().any(|v| !v.is_finite()) {
            return Err(format!(
                "staafbelasting {} bevat geen eindige waarde",
                load.id
            ));
        }
        if values.iter().all(|v| *v == 0.0) {
            return Err(format!(
                "staafbelasting {} bevat alleen nulwaarden",
                load.id
            ));
        }
        let member = request
            .members
            .iter()
            .find(|member| member.id == load.member_id)
            .unwrap();
        let a_node = node_by_id[&member.start_node_id];
        let b_node = node_by_id[&member.end_node_id];
        let length = ((a_node.x - b_node.x).powi(2)
            + (a_node.y - b_node.y).powi(2)
            + (a_node.z - b_node.z).powi(2))
        .sqrt();
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
            return Err(format!(
                "staafpuntlast {} verwijst naar ontbrekende staaf {}",
                load.id, load.member_id
            ));
        }
        if !load.py_kn.is_finite()
            || !load.pz_kn.is_finite()
            || (load.py_kn == 0.0 && load.pz_kn == 0.0)
        {
            return Err(format!(
                "staafpuntlast {} bevat geen geldige niet-nulkracht",
                load.id
            ));
        }
        let member = request
            .members
            .iter()
            .find(|member| member.id == load.member_id)
            .unwrap();
        let a_node = node_by_id[&member.start_node_id];
        let b_node = node_by_id[&member.end_node_id];
        let length = ((a_node.x - b_node.x).powi(2)
            + (a_node.y - b_node.y).powi(2)
            + (a_node.z - b_node.z).powi(2))
        .sqrt();
        if !load.position_m.is_finite() || load.position_m < 0.0 || load.position_m > length + 1e-9
        {
            return Err(format!(
                "staafpuntlast {} heeft ongeldige positie {} m voor staaflengte {length} m",
                load.id, load.position_m,
            ));
        }
    }
    for load in &request.thermal_loads {
        if !member_ids.contains(&load.member_id) {
            return Err(format!(
                "temperatuurbelasting {} verwijst naar ontbrekende staaf {}",
                load.id, load.member_id
            ));
        }
        let values = [
            load.delta_t_uniform_k,
            load.delta_t_gradient_y_k,
            load.delta_t_gradient_z_k,
        ];
        if values.iter().any(|value| !value.is_finite()) || values.iter().all(|value| *value == 0.0)
        {
            return Err(format!(
                "temperatuurbelasting {} bevat geen geldige niet-nulwaarde",
                load.id
            ));
        }
    }
    Ok(())
}

fn to_engine_input(request: &SolveRequest3D) -> SolverInput3D {
    let nodes = request
        .nodes
        .iter()
        .map(|node| {
            (
                node.id.to_string(),
                SolverNode3D {
                    id: node.id,
                    x: node.x,
                    y: node.y,
                    z: node.z,
                },
            )
        })
        .collect();
    let materials = request
        .materials
        .iter()
        .map(|material| {
            (
                material.id.to_string(),
                SolverMaterial {
                    id: material.id,
                    e: material.e_mpa,
                    nu: material.nu,
                },
            )
        })
        .collect();
    let sections = request
        .sections
        .iter()
        .map(|section| {
            (
                section.id.to_string(),
                SolverSection3D {
                    id: section.id,
                    name: Some(section.name.clone()),
                    a: section.area_m2,
                    iy: section.iy_m4,
                    iz: section.iz_m4,
                    j: section.torsion_j_m4,
                    cw: None,
                    as_y: section.shear_area_y_m2,
                    as_z: section.shear_area_z_m2,
                },
            )
        })
        .collect();
    let elements = request
        .members
        .iter()
        .map(|member| {
            (
                member.id.to_string(),
                SolverElement3D {
                    id: member.id,
                    elem_type: "frame".into(),
                    node_i: member.start_node_id,
                    node_j: member.end_node_id,
                    material_id: member.material_id,
                    section_id: member.section_id,
                    release_my_start: member.releases.my_start,
                    release_my_end: member.releases.my_end,
                    release_mz_start: member.releases.mz_start,
                    release_mz_end: member.releases.mz_end,
                    release_t_start: member.releases.torsion_start,
                    release_t_end: member.releases.torsion_end,
                    local_yx: None,
                    local_yy: None,
                    local_yz: None,
                    // Dedaliano's field is historically named without a unit, but its
                    // local-axis routine interprets the value as degrees. The Open FEM
                    // contract is explicit and uses radians.
                    roll_angle: member.roll_angle_rad.map(f64::to_degrees),
                },
            )
        })
        .collect();
    let supports = request
        .supports
        .iter()
        .enumerate()
        .map(|(index, support)| {
            (
                (index + 1).to_string(),
                SolverSupport3D {
                    node_id: support.node_id,
                    rx: support.ux,
                    ry: support.uy,
                    rz: support.uz,
                    rrx: support.rx,
                    rry: support.ry,
                    rrz: support.rz,
                    kx: support.kx_kn_per_m,
                    ky: support.ky_kn_per_m,
                    kz: support.kz_kn_per_m,
                    krx: support.krx_knm_per_rad,
                    kry: support.kry_knm_per_rad,
                    krz: support.krz_knm_per_rad,
                    dx: support.ux_prescribed_m,
                    dy: support.uy_prescribed_m,
                    dz: support.uz_prescribed_m,
                    drx: support.rx_prescribed_rad,
                    dry: support.ry_prescribed_rad,
                    drz: support.rz_prescribed_rad,
                    rw: None,
                    kw: None,
                    normal_x: None,
                    normal_y: None,
                    normal_z: None,
                    is_inclined: None,
                },
            )
        })
        .collect();
    let nodal_loads = request.nodal_loads.iter().map(|load| {
        SolverLoad3D::Nodal(SolverNodalLoad3D {
            node_id: load.node_id,
            fx: load.fx,
            fy: load.fy,
            fz: load.fz,
            mx: load.mx,
            my: load.my,
            mz: load.mz,
            bw: None,
        })
    });
    let distributed_loads = request.member_loads.iter().map(|load| {
        SolverLoad3D::Distributed(SolverDistributedLoad3D {
            element_id: load.member_id,
            q_yi: load.qy_start_kn_per_m,
            q_yj: load.qy_end_kn_per_m,
            q_zi: load.qz_start_kn_per_m,
            q_zj: load.qz_end_kn_per_m,
            a: load.start_position_m,
            b: load.end_position_m,
        })
    });
    let member_point_loads = request.member_point_loads.iter().map(|load| {
        SolverLoad3D::PointOnElement(SolverPointLoad3D {
            element_id: load.member_id,
            a: load.position_m,
            py: load.py_kn,
            pz: load.pz_kn,
        })
    });
    let thermal_loads = request.thermal_loads.iter().map(|load| {
        // De vastgezette engine gebruikt intern 12e-6/K. Schaal de ΔT's aan
        // deze adaptergrens zodat staal, beton en toekomstige materialen hun
        // expliciete projectwaarde behouden zonder het enginecontract te lekken.
        let alpha = request
            .members
            .iter()
            .find(|member| member.id == load.member_id)
            .and_then(|member| {
                request
                    .materials
                    .iter()
                    .find(|material| material.id == member.material_id)
            })
            .and_then(|material| material.alpha_per_k)
            .unwrap_or(12e-6);
        let scale = alpha / 12e-6;
        SolverLoad3D::Thermal(SolverThermalLoad3D {
            element_id: load.member_id,
            dt_uniform: load.delta_t_uniform_k * scale,
            dt_gradient_y: load.delta_t_gradient_y_k * scale,
            dt_gradient_z: load.delta_t_gradient_z_k * scale,
        })
    });
    let loads = nodal_loads
        .chain(distributed_loads)
        .chain(member_point_loads)
        .chain(thermal_loads)
        .collect();
    SolverInput3D {
        nodes,
        materials,
        sections,
        elements,
        supports,
        loads,
        constraints: vec![],
        left_hand: None,
        plates: HashMap::new(),
        quads: HashMap::new(),
        quad9s: HashMap::new(),
        solid_shells: HashMap::new(),
        curved_shells: HashMap::new(),
        curved_beams: vec![],
        connectors: HashMap::new(),
    }
}

fn buckling_summary(input: &SolverInput3D, modes: usize) -> BucklingSummary {
    if modes == 0 {
        return BucklingSummary::NotApplicable {
            reason: "knikanalyse is uitgeschakeld".into(),
        };
    }
    // The pinned upstream sparse Cholesky implementation can panic when a
    // later numeric matrix has a different sparsity pattern from its symbolic
    // factorization. A failed eigenvalue analysis must not kill the entire
    // frame calculation; report it explicitly so no buckling factor is used.
    let solved = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| solve_buckling_3d(input, modes))) {
        Ok(solved) => solved,
        Err(_) => return BucklingSummary::Failed {
            reason: "de externe knikoplosser kon deze matrix niet betrouwbaar factoriseren; geen knikfactor beschikbaar".into(),
        },
    };
    match solved {
        Ok(result) => {
            // The sparse generalized eigensolver can return a numerical zero
            // mode (typically about 1e-14) before the first physical buckling
            // mode. Presenting that as alpha_cr = 0 also corrupts Ncr and Lcr.
            // A load factor this small is many orders below the stability gate
            // used by the nonlinear solver and therefore cannot be a usable
            // physical eigenvalue for this contract.
            let load_factors: Vec<f64> = result
                .modes
                .iter()
                .map(|mode| mode.load_factor)
                .filter(|factor| factor.is_finite() && *factor > 1e-9)
                .collect();
            let Some(&lambda_cr) = load_factors.first() else {
                return BucklingSummary::Failed {
                    reason: "geen positieve fysieke knikfactor gevonden (alleen numerieke nulmodi)"
                        .into(),
                };
            };
            let summaries = load_factors
                .into_iter()
                .enumerate()
                .map(|(index, load_factor)| BucklingModeSummary {
                    mode: index + 1,
                    load_factor,
                })
                .collect();
            let members = result
                .element_data
                .into_iter()
                .map(|member| {
                    let critical_force = lambda_cr * member.axial_force.abs();
                    let recalculated = input
                        .elements
                        .values()
                        .find(|element| element.id == member.element_id)
                        .and_then(|element| {
                            Some((
                                input
                                    .materials
                                    .values()
                                    .find(|material| material.id == element.material_id)?,
                                input
                                    .sections
                                    .values()
                                    .find(|section| section.id == element.section_id)?,
                            ))
                        })
                        .map(|(material, section)| {
                            let e_kn_m2 = material.e * 1000.0;
                            let radius_y = if section.a > 1e-20 {
                                (section.iy / section.a).sqrt()
                            } else {
                                0.0
                            };
                            let radius_z = if section.a > 1e-20 {
                                (section.iz / section.a).sqrt()
                            } else {
                                0.0
                            };
                            let k_effective = if critical_force > 1e-6 {
                                std::f64::consts::PI
                                    * (e_kn_m2 * section.iy.min(section.iz) / critical_force).sqrt()
                                    / member.length
                            } else {
                                1.0
                            };
                            let effective_length = k_effective * member.length;
                            let slenderness_y = if radius_y > 1e-12 {
                                effective_length / radius_y
                            } else {
                                0.0
                            };
                            let slenderness_z = if radius_z > 1e-12 {
                                effective_length / radius_z
                            } else {
                                0.0
                            };
                            (k_effective, effective_length, slenderness_y, slenderness_z)
                        })
                        .unwrap_or((
                            member.k_effective,
                            member.effective_length,
                            member.slenderness_y,
                            member.slenderness_z,
                        ));
                    MemberBucklingData {
                        member_id: member.element_id,
                        axial_force_kn: member.axial_force,
                        critical_force_kn: critical_force,
                        effective_length_factor: recalculated.0,
                        effective_length_m: recalculated.1,
                        length_m: member.length,
                        slenderness_y: recalculated.2,
                        slenderness_z: recalculated.3,
                    }
                })
                .collect();
            BucklingSummary::Available {
                modes: summaries,
                members,
            }
        }
        Err(reason) if reason.contains("No free DOFs") => BucklingSummary::NotApplicable {
            reason: "alle vrijheidsgraden zijn voorgeschreven".into(),
        },
        Err(reason) if reason.contains("No compressed elements") => {
            BucklingSummary::NotApplicable {
                reason: "geen drukstaaf aanwezig".into(),
            }
        }
        Err(reason) => BucklingSummary::Failed { reason },
    }
}

fn convert_result(
    request: &SolveRequest3D,
    results: AnalysisResults3D,
    second_order: Option<SecondOrderSummary>,
    buckling: BucklingSummary,
) -> SolveResult3D {
    let mut results = results;
    // Dedaliano neemt de veerstijfheid wel in K op, maar zijn generieke
    // reactiebouwer rapporteert alleen geblokkeerde vrijheidsgraden. Voeg de
    // kracht die de grondveer op het model uitoefent daarom aan hetzelfde
    // oplegreactieobject toe: R_s = -k·u.
    for support in &request.supports {
        let Some(displacement) = results
            .displacements
            .iter()
            .find(|value| value.node_id == support.node_id)
        else {
            continue;
        };
        let Some(reaction) = results
            .reactions
            .iter_mut()
            .find(|value| value.node_id == support.node_id)
        else {
            continue;
        };
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
        if support.kx_kn_per_m.is_some() {
            reaction.fx = spring_reaction[0];
        }
        if support.ky_kn_per_m.is_some() {
            reaction.fy = spring_reaction[1];
        }
        if support.kz_kn_per_m.is_some() {
            reaction.fz = spring_reaction[2];
        }
        if support.krx_knm_per_rad.is_some() {
            reaction.mx = spring_reaction[3];
        }
        if support.kry_knm_per_rad.is_some() {
            reaction.my = spring_reaction[4];
        }
        if support.krz_knm_per_rad.is_some() {
            reaction.mz = spring_reaction[5];
        }
    }
    if let Some(equilibrium) = results.equilibrium.as_mut() {
        if equilibrium.reaction_force_sum.len() >= 3 && equilibrium.applied_force_sum.len() >= 3 {
            equilibrium.reaction_force_sum[0] =
                results.reactions.iter().map(|value| value.fx).sum();
            equilibrium.reaction_force_sum[1] =
                results.reactions.iter().map(|value| value.fy).sum();
            equilibrium.reaction_force_sum[2] =
                results.reactions.iter().map(|value| value.fz).sum();
            equilibrium.max_imbalance = (0..3)
                .map(|index| {
                    (equilibrium.applied_force_sum[index] + equilibrium.reaction_force_sum[index])
                        .abs()
                })
                .fold(0.0, f64::max);
            let max_force = equilibrium
                .applied_force_sum
                .iter()
                .take(3)
                .chain(equilibrium.reaction_force_sum.iter().take(3))
                .map(|value| value.abs())
                .fold(0.0, f64::max);
            equilibrium.equilibrium_ok = equilibrium.max_imbalance < 1e-6 * max_force.max(1.0);
        }
    }
    let engine_diagrams = compute_diagrams_3d(&results);
    let diagrams = Diagrams3D {
        moment_y: engine_diagrams
            .moment_y
            .into_iter()
            .map(convert_member_diagram)
            .collect(),
        moment_z: engine_diagrams
            .moment_z
            .into_iter()
            .map(convert_member_diagram)
            .collect(),
        shear_y: engine_diagrams
            .shear_y
            .into_iter()
            .map(convert_member_diagram)
            .collect(),
        shear_z: engine_diagrams
            .shear_z
            .into_iter()
            .map(convert_member_diagram)
            .collect(),
        axial: engine_diagrams
            .axial
            .into_iter()
            .map(convert_member_diagram)
            .collect(),
        torsion: engine_diagrams
            .torsion
            .into_iter()
            .map(convert_member_diagram)
            .collect(),
    };
    let equilibrium = results
        .equilibrium
        .as_ref()
        .map(|value| EquilibriumSummary {
            relative_residual: value.relative_residual,
            residual_ok: value.residual_ok,
            max_imbalance_kn: value.max_imbalance,
            equilibrium_ok: value.equilibrium_ok,
        });
    let solver_path = results
        .solver_run_meta
        .as_ref()
        .map(|meta| meta.solver_path.clone());
    let mut diagnostics: Vec<String> = results
        .structured_diagnostics
        .iter()
        .map(|item| item.message.clone())
        .collect();
    diagnostics.extend(
        results
            .solver_diagnostics
            .iter()
            .map(|item| item.message.clone()),
    );
    SolveResult3D {
        schema_version: CONTRACT_VERSION,
        engine: engine_info(),
        analysis: request.analysis,
        displacements: results
            .displacements
            .into_iter()
            .map(|value| Displacement3D {
                node_id: value.node_id,
                ux: value.ux,
                uy: value.uy,
                uz: value.uz,
                rx: value.rx,
                ry: value.ry,
                rz: value.rz,
            })
            .collect(),
        reactions: results
            .reactions
            .into_iter()
            .map(|value| Reaction3D {
                node_id: value.node_id,
                fx: value.fx,
                fy: value.fy,
                fz: value.fz,
                mx: value.mx,
                my: value.my,
                mz: value.mz,
            })
            .collect(),
        member_forces: results
            .element_forces
            .into_iter()
            .map(|value| MemberForces3D {
                member_id: value.element_id,
                length_m: value.length,
                n_start_kn: value.n_start,
                n_end_kn: value.n_end,
                vy_start_kn: value.vy_start,
                vy_end_kn: value.vy_end,
                vz_start_kn: value.vz_start,
                vz_end_kn: value.vz_end,
                torsion_start_knm: value.mx_start,
                torsion_end_knm: value.mx_end,
                my_start_knm: value.my_start,
                my_end_knm: value.my_end,
                mz_start_knm: value.mz_start,
                mz_end_knm: value.mz_end,
            })
            .collect(),
        diagrams,
        second_order,
        buckling,
        equilibrium,
        solver_path,
        diagnostics,
    }
}

fn max_dof_magnitude(results: &AnalysisResults3D) -> f64 {
    results
        .displacements
        .iter()
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

/// Validate, route, solve, and translate one 3D frame request.
pub fn solve(request: SolveRequest3D) -> Result<SolveResult3D, String> {
    validate(&request)?;
    let input = to_engine_input(&request);
    // A P-Delta iteration may mathematically converge after the equilibrium
    // path has crossed the first bifurcation point. The pinned engine then
    // reports a finite, but sign-reversed, displacement and `is_stable=true`.
    // Always calculate one physical eigenmode as a stability gate, even when
    // the caller has disabled buckling output. Keep the public response faithful
    // to that reporting choice.
    let stability_buckling = if request.analysis == AnalysisKind::PDelta {
        Some(buckling_summary(&input, request.buckling_modes.max(1)))
    } else {
        None
    };
    let buckling = if request.buckling_modes == 0 {
        BucklingSummary::NotApplicable {
            reason: "knikanalyse is uitgeschakeld".into(),
        }
    } else if let Some(summary) = &stability_buckling {
        summary.clone()
    } else {
        buckling_summary(&input, request.buckling_modes)
    };
    match request.analysis {
        AnalysisKind::Linear => {
            let results =
                solve_3d(&input).map_err(|error| solver_error("lineaire 3D-berekening", error))?;
            require_usable_solution("lineaire 3D-berekening", &results)?;
            Ok(convert_result(&request, results, None, buckling))
        }
        AnalysisKind::PDelta => {
            if let Some(BucklingSummary::Failed { reason }) = &stability_buckling {
                return Err(format!(
                    "tweede-orde 3D-berekening is geblokkeerd omdat de stabiliteitscontrole faalde: {reason}"
                ));
            }
            if let Some(BucklingSummary::Available { modes, .. }) = &stability_buckling {
                if let Some(mode) = modes.first() {
                    if mode.load_factor <= 1.0 + 1e-6 {
                        return Err(format!(
                            "tweede-orde 3D-berekening wijst op instabiliteit: de eerste lineaire knikfactor alpha_cr={:.6} is kleiner dan of gelijk aan 1,0. De belasting bereikt of overschrijdt daarmee de kritieke last. Verlaag de belasting of voeg stabiliserende schoren, opleggingen of staafstijfheid toe.",
                            mode.load_factor,
                        ));
                    }
                }
            }
            let pdelta_solution = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(||
                solve_pdelta_3d(&input, request.max_iterations, request.tolerance)
            )) {
                Ok(solved) => solved,
                Err(_) => return Err(
                    "tweede-orde 3D-berekening is geweigerd: de externe matrixfactorisatie faalde voor dit model; geen betrouwbare tweede-orde-uitkomst beschikbaar"
                        .into(),
                ),
            };
            let result = match pdelta_solution {
                Ok(result) => result,
                Err(error) if error.to_string().contains("No free DOFs") => {
                    // Een volledig voorgeschreven model heeft wel geldige
                    // verplaatsingen, staafkrachten en reacties, maar geen
                    // onbekende DOF waarop P-Delta kan itereren.
                    let linear = solve_3d(&input).map_err(|linear_error| {
                        solver_error(
                            "lineaire 3D-berekening van volledig voorgeschreven model",
                            linear_error,
                        )
                    })?;
                    require_usable_solution(
                        "lineaire 3D-berekening van volledig voorgeschreven model",
                        &linear,
                    )?;
                    let summary = SecondOrderSummary {
                        iterations: 1,
                        converged: true,
                        stable: true,
                        max_amplification: 1.0,
                    };
                    let mut solved = convert_result(&request, linear, Some(summary), buckling);
                    solved.diagnostics.push(
                        "P-Delta-nultoestand: alle vrijheidsgraden zijn voorgeschreven; lineaire reacties zijn geldig en de tweede-orde-amplificatie is 1,0."
                            .into(),
                    );
                    return Ok(solved);
                }
                Err(error) => return Err(solver_error("tweede-orde 3D-berekening", error)),
            };
            if !result.converged {
                // The pinned engine uses a relative displacement change as its
                // convergence criterion. If every applied load acts on a
                // restrained degree of freedom, both norms are exactly zero
                // and the relative criterion can never be evaluated. That is
                // a valid P-Delta null state: there is no deformed geometry
                // from which a geometric stiffness contribution can arise.
                if max_dof_magnitude(&result.linear_results) <= 1e-20
                    && max_dof_magnitude(&result.results) <= 1e-20
                {
                    let summary = SecondOrderSummary {
                        iterations: 1,
                        converged: true,
                        stable: true,
                        max_amplification: 1.0,
                    };
                    let mut solved =
                        convert_result(&request, result.linear_results, Some(summary), buckling);
                    solved.diagnostics.push(
                        "P-Delta-nultoestand: geen vrije verplaatsing; lineaire reacties zijn geldig en de tweede-orde-amplificatie is 1,0."
                            .into(),
                    );
                    return Ok(solved);
                }
                return Err(format!(
                    "tweede-orde 3D-berekening convergeerde niet binnen {} iteraties",
                    result.iterations
                ));
            }
            if !result.is_stable {
                return Err(
                    "tweede-orde 3D-berekening wijst op instabiliteit: de tangentiële stijfheid is niet positief. Verlaag de belasting of voeg stabiliserende schoren, opleggingen of rotatieblokkeringen toe."
                        .into(),
                );
            }
            require_usable_solution("tweede-orde 3D-berekening", &result.results)?;
            let summary = SecondOrderSummary {
                iterations: result.iterations,
                converged: result.converged,
                stable: result.is_stable,
                max_amplification: result.b2_factor,
            };
            Ok(convert_result(
                &request,
                result.results,
                Some(summary),
                buckling,
            ))
        }
    }
}
