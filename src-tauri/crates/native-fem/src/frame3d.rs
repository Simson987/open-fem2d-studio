//! Native 12-DOF Euler-Bernoulli frame element. Uses the same neutral JSON
//! field names and units as `frame3d-solver`, but no upstream solver code.
//! GNL is a tangent P-Delta iteration; FNL is a monotonic secant law.

use crate::math::{constrained_solve, free_positive_definite, Matrix};
use crate::{positive, MaterialLaw};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Analysis {
    #[default]
    Linear,
    PDelta,
    Material,
    Combined,
}
impl Analysis {
    fn geometric(self) -> bool {
        matches!(self, Self::PDelta | Self::Combined)
    }
    fn material(self) -> bool {
        matches!(self, Self::Material | Self::Combined)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub z: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: usize,
    pub e_mpa: f64,
    pub nu: f64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub alpha_per_k: Option<f64>,
    #[serde(default)]
    pub law: MaterialLaw,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub id: usize,
    pub area_m2: f64,
    pub iy_m4: f64,
    pub iz_m4: f64,
    pub torsion_j_m4: f64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub shear_area_y_m2: Option<f64>,
    #[serde(default)]
    pub shear_area_z_m2: Option<f64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Member {
    pub id: usize,
    pub start_node_id: usize,
    pub end_node_id: usize,
    pub material_id: usize,
    pub section_id: usize,
    #[serde(default)]
    pub roll_angle_rad: f64,
    #[serde(default)]
    pub releases: HashMap<String, bool>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub node_id: usize,
    pub ux: bool,
    pub uy: bool,
    pub uz: bool,
    pub rx: bool,
    pub ry: bool,
    pub rz: bool,
    #[serde(default)]
    pub kx_kn_per_m: Option<f64>,
    #[serde(default)]
    pub ky_kn_per_m: Option<f64>,
    #[serde(default)]
    pub kz_kn_per_m: Option<f64>,
    #[serde(default)]
    pub krx_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub kry_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub krz_knm_per_rad: Option<f64>,
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
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodalLoad {
    #[serde(default)]
    pub id: usize,
    pub node_id: usize,
    pub fx: f64,
    pub fy: f64,
    pub fz: f64,
    pub mx: f64,
    pub my: f64,
    pub mz: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberLoad {
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
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberPointLoad {
    pub id: usize,
    pub member_id: usize,
    pub py_kn: f64,
    pub pz_kn: f64,
    pub position_m: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    #[serde(default)]
    pub analysis: Analysis,
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    pub sections: Vec<Section>,
    pub members: Vec<Member>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub nodal_loads: Vec<NodalLoad>,
    #[serde(default)]
    pub member_loads: Vec<MemberLoad>,
    #[serde(default)]
    pub member_point_loads: Vec<MemberPointLoad>,
    #[serde(default)]
    pub thermal_loads: Vec<serde_json::Value>,
    #[serde(default)]
    pub buckling_modes: usize,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
}
fn default_schema() -> u32 {
    1
}
fn default_iterations() -> usize {
    50
}
fn default_tolerance() -> f64 {
    1e-8
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: usize,
    pub displacement: [f64; 6],
    pub reaction: [f64; 6],
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub member_id: usize,
    pub local_end_forces: [f64; 12],
    pub effective_e_mpa: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result3D {
    pub nodes: Vec<NodeResult>,
    pub members: Vec<MemberResult>,
    pub iterations: usize,
    pub relative_change: f64,
    pub equilibrium_residual: f64,
}

struct Element<'a> {
    id: usize,
    dofs: [usize; 12],
    length: f64,
    rotation: [[f64; 3]; 3],
    material: &'a Material,
    section: &'a Section,
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn norm(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
fn scale(a: [f64; 3], factor: f64) -> [f64; 3] {
    a.map(|v| v * factor)
}

fn axes(start: &Node, end: &Node, roll: f64) -> Result<(f64, [[f64; 3]; 3]), String> {
    let dx = [end.x - start.x, end.y - start.y, end.z - start.z];
    let length = norm(dx);
    positive(length, "member length")?;
    if !roll.is_finite() {
        return Err("non-finite member roll".into());
    }
    let ex = scale(dx, 1.0 / length);
    let up = if ex[2].abs() > 0.999 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    let ez0 = {
        let projection = dot(ex, up);
        let value = [
            up[0] - projection * ex[0],
            up[1] - projection * ex[1],
            up[2] - projection * ex[2],
        ];
        scale(value, 1.0 / norm(value))
    };
    let ey0 = cross(ez0, ex);
    let (s, c) = roll.sin_cos();
    let ey = [0, 1, 2].map(|i| c * ey0[i] + s * ez0[i]);
    let ez = [0, 1, 2].map(|i| c * ez0[i] - s * ey0[i]);
    Ok((length, [ex, ey, ez]))
}

fn add_pair(k: &mut [[f64; 12]; 12], a: usize, b: usize, stiffness: f64) {
    k[a][a] += stiffness;
    k[b][b] += stiffness;
    k[a][b] -= stiffness;
    k[b][a] -= stiffness;
}
fn add_block(k: &mut [[f64; 12]; 12], dofs: [usize; 4], block: [[f64; 4]; 4], scale: f64) {
    for i in 0..4 {
        for j in 0..4 {
            k[dofs[i]][dofs[j]] += scale * block[i][j];
        }
    }
}
fn bending(length: f64) -> [[f64; 4]; 4] {
    let l = length;
    [
        [
            12.0 / l.powi(3),
            6.0 / l.powi(2),
            -12.0 / l.powi(3),
            6.0 / l.powi(2),
        ],
        [6.0 / l.powi(2), 4.0 / l, -6.0 / l.powi(2), 2.0 / l],
        [
            -12.0 / l.powi(3),
            -6.0 / l.powi(2),
            12.0 / l.powi(3),
            -6.0 / l.powi(2),
        ],
        [6.0 / l.powi(2), 2.0 / l, -6.0 / l.powi(2), 4.0 / l],
    ]
}
fn geometric(length: f64) -> [[f64; 4]; 4] {
    let l = length;
    [
        [36.0, 3.0 * l, -36.0, 3.0 * l],
        [3.0 * l, 4.0 * l * l, -3.0 * l, -l * l],
        [-36.0, -3.0 * l, 36.0, -3.0 * l],
        [3.0 * l, -l * l, -3.0 * l, 4.0 * l * l],
    ]
}
fn local_stiffness(
    element: &Element<'_>,
    effective_e: f64,
    axial_n: f64,
    include_geometric: bool,
) -> [[f64; 12]; 12] {
    let mut k = [[0.0; 12]; 12];
    let l = element.length;
    let e = effective_e * 1000.0;
    let g = e / (2.0 * (1.0 + element.material.nu));
    add_pair(&mut k, 0, 6, e * element.section.area_m2 / l);
    add_pair(&mut k, 3, 9, g * element.section.torsion_j_m4 / l);
    let by = bending(l);
    add_block(&mut k, [1, 5, 7, 11], by, e * element.section.iz_m4);
    let sign = [1.0, -1.0, 1.0, -1.0];
    let bz = std::array::from_fn(|i| std::array::from_fn(|j| sign[i] * by[i][j] * sign[j]));
    add_block(&mut k, [2, 4, 8, 10], bz, e * element.section.iy_m4);
    if include_geometric {
        let gy = geometric(l);
        add_block(&mut k, [1, 5, 7, 11], gy, axial_n / (30.0 * l));
        let gz = std::array::from_fn(|i| std::array::from_fn(|j| sign[i] * gy[i][j] * sign[j]));
        add_block(&mut k, [2, 4, 8, 10], gz, axial_n / (30.0 * l));
    }
    k
}
fn transform(rotation: [[f64; 3]; 3]) -> [[f64; 12]; 12] {
    let mut t = [[0.0; 12]; 12];
    for block in 0..4 {
        for i in 0..3 {
            for j in 0..3 {
                t[3 * block + i][3 * block + j] = rotation[i][j];
            }
        }
    }
    t
}
fn mat_vec(k: &[[f64; 12]; 12], x: &[f64; 12]) -> [f64; 12] {
    std::array::from_fn(|i| (0..12).map(|j| k[i][j] * x[j]).sum())
}
fn local_displacement(element: &Element<'_>, u: &[f64]) -> [f64; 12] {
    let t = transform(element.rotation);
    let global = element.dofs.map(|dof| u[dof]);
    mat_vec(&t, &global)
}
fn hermite(length: f64, x: f64) -> [f64; 4] {
    let t = x / length;
    [
        1.0 - 3.0 * t * t + 2.0 * t * t * t,
        length * (t - 2.0 * t * t + t * t * t),
        3.0 * t * t - 2.0 * t * t * t,
        length * (-t * t + t * t * t),
    ]
}
fn add_transverse_load(local: &mut [f64; 12], length: f64, x: f64, py: f64, pz: f64) {
    let shape = hermite(length, x);
    for (index, dof) in [1, 5, 7, 11].into_iter().enumerate() {
        local[dof] += py * shape[index];
    }
    for (index, dof) in [2, 4, 8, 10].into_iter().enumerate() {
        local[dof] += pz * shape[index] * if index % 2 == 0 { 1.0 } else { -1.0 };
    }
}
fn effective_e(element: &Element<'_>, local: &[f64; 12], nonlinear: bool) -> f64 {
    let e = element.material.e_mpa;
    if !nonlinear {
        return e;
    }
    let l = element.length;
    let axial = (local[6] - local[0]) / l;
    let curvature_y =
        (local[10] - local[4]).abs() / l + 2.0 * (local[8] - local[2]).abs() / (l * l);
    let curvature_z =
        (local[11] - local[5]).abs() / l + 2.0 * (local[7] - local[1]).abs() / (l * l);
    let cy = (3.0 * element.section.iz_m4 / element.section.area_m2).sqrt();
    let cz = (3.0 * element.section.iy_m4 / element.section.area_m2).sqrt();
    let tensile = axial + curvature_y * cz + curvature_z * cy;
    let peak = axial.abs() + curvature_y * cz + curvature_z * cy;
    let (limit, hardening, strain) = match element.material.law {
        MaterialLaw::Elastic => return e,
        MaterialLaw::SteelBilinear {
            yield_mpa,
            hardening_ratio,
        } => (yield_mpa / e, hardening_ratio, peak),
        MaterialLaw::ConcreteCracking {
            tensile_mpa,
            residual_ratio,
        } => (tensile_mpa / e, residual_ratio, tensile),
    };
    if strain <= limit {
        e
    } else {
        e * (limit / strain + hardening * (1.0 - limit / strain))
    }
}
fn assemble(
    elements: &[Element<'_>],
    u: &[f64],
    nonlinear_material: bool,
    nonlinear_geometry: bool,
) -> Result<(Matrix, Vec<f64>), String> {
    let mut k = Matrix::zeros(u.len())?;
    let mut stiffnesses = Vec::with_capacity(elements.len());
    for element in elements {
        let local = local_displacement(element, u);
        let e = effective_e(element, &local, nonlinear_material);
        let axial = e * 1000.0 * element.section.area_m2 * (local[6] - local[0]) / element.length;
        let kl = local_stiffness(element, e, axial, nonlinear_geometry);
        let t = transform(element.rotation);
        for i in 0..12 {
            for j in 0..12 {
                let value: f64 = (0..12)
                    .flat_map(|a| (0..12).map(move |b| t[a][i] * kl[a][b] * t[b][j]))
                    .sum();
                k.add(element.dofs[i], element.dofs[j], value);
            }
        }
        stiffnesses.push(e);
    }
    Ok((k, stiffnesses))
}

pub fn solve(request: &Request) -> Result<Result3D, String> {
    if request.schema_version != 1 {
        return Err("unsupported 3D schema version".into());
    }
    if request.buckling_modes > 0 {
        return Err("native frame eigenvalue buckling is not implemented".into());
    }
    if request.nodes.len() < 2 || request.members.is_empty() {
        return Err("frame requires nodes and members".into());
    }
    if request.nodes.len() > 100 {
        return Err("3D frame stability verification is limited to 600 DOF".into());
    }
    if !request.thermal_loads.is_empty() {
        return Err("native frame thermal loads are not implemented".into());
    }
    positive(request.tolerance, "tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid iteration limit".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    if node_index.len() != request.nodes.len() {
        return Err("duplicate frame node id".into());
    }
    if request.nodes.iter().any(|node| {
        ![node.x, node.y, node.z]
            .iter()
            .all(|value| value.is_finite())
    }) {
        return Err("non-finite frame coordinate".into());
    }
    let material_index: HashMap<usize, &Material> =
        request.materials.iter().map(|m| (m.id, m)).collect();
    let section_index: HashMap<usize, &Section> =
        request.sections.iter().map(|s| (s.id, s)).collect();
    if material_index.len() != request.materials.len()
        || section_index.len() != request.sections.len()
    {
        return Err("duplicate material or section id".into());
    }
    for material in &request.materials {
        positive(material.e_mpa, "E")?;
        if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
            return Err("invalid Poisson ratio".into());
        }
        match material.law {
            MaterialLaw::Elastic => {}
            MaterialLaw::SteelBilinear {
                yield_mpa,
                hardening_ratio,
            } => {
                positive(yield_mpa, "steel yield")?;
                if !(0.0..=1.0).contains(&hardening_ratio) {
                    return Err("invalid hardening ratio".into());
                }
            }
            MaterialLaw::ConcreteCracking {
                tensile_mpa,
                residual_ratio,
            } => {
                positive(tensile_mpa, "concrete tensile strength")?;
                if !(0.0..=1.0).contains(&residual_ratio) {
                    return Err("invalid residual ratio".into());
                }
            }
        }
    }
    for section in &request.sections {
        positive(section.area_m2, "area")?;
        positive(section.iy_m4, "Iy")?;
        positive(section.iz_m4, "Iz")?;
        positive(section.torsion_j_m4, "J")?;
    }
    let mut used_ids = HashSet::new();
    let mut elements = Vec::with_capacity(request.members.len());
    for member in &request.members {
        if !used_ids.insert(member.id) {
            return Err("duplicate frame member id".into());
        }
        if member.releases.values().any(|&value| value) {
            return Err("native frame does not yet support end releases".into());
        }
        let start = *node_index
            .get(&member.start_node_id)
            .ok_or("unknown member start node")?;
        let end = *node_index
            .get(&member.end_node_id)
            .ok_or("unknown member end node")?;
        let (length, rotation) = axes(
            &request.nodes[start],
            &request.nodes[end],
            member.roll_angle_rad,
        )?;
        elements.push(Element {
            id: member.id,
            dofs: std::array::from_fn(|i| 6 * if i < 6 { start } else { end } + i % 6),
            length,
            rotation,
            material: *material_index
                .get(&member.material_id)
                .ok_or("unknown member material")?,
            section: *section_index
                .get(&member.section_id)
                .ok_or("unknown member section")?,
        });
    }
    let element_index: HashMap<usize, usize> = elements
        .iter()
        .enumerate()
        .map(|(i, element)| (element.id, i))
        .collect();
    let mut local_loads = vec![[0.0; 12]; elements.len()];
    for load in &request.member_loads {
        let index = *element_index
            .get(&load.member_id)
            .ok_or("unknown loaded frame member")?;
        let length = elements[index].length;
        let start = load.start_position_m.unwrap_or(0.0);
        let end = load.end_position_m.unwrap_or(length);
        if ![
            load.qy_start_kn_per_m,
            load.qy_end_kn_per_m,
            load.qz_start_kn_per_m,
            load.qz_end_kn_per_m,
            start,
            end,
        ]
        .iter()
        .all(|value| value.is_finite())
            || start < 0.0
            || end <= start
            || end > length + 1e-9
        {
            return Err("invalid frame member load or span".into());
        }
        if [
            load.qy_start_kn_per_m,
            load.qy_end_kn_per_m,
            load.qz_start_kn_per_m,
            load.qz_end_kn_per_m,
        ]
        .iter()
        .all(|value| *value == 0.0)
        {
            return Err("zero frame member load".into());
        }
        // Three-point Gauss integration is exact for Hermite shape functions
        // multiplied by a linearly varying intensity over this load segment.
        let abscissae = [-0.7745966692414834, 0.0, 0.7745966692414834];
        let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
        for (abscissa, weight) in abscissae.into_iter().zip(weights) {
            let x = (start + end) / 2.0 + (end - start) * abscissa / 2.0;
            let t = (x - start) / (end - start);
            let scale = weight * (end - start) / 2.0;
            let py = ((1.0 - t) * load.qy_start_kn_per_m + t * load.qy_end_kn_per_m) * scale;
            let pz = ((1.0 - t) * load.qz_start_kn_per_m + t * load.qz_end_kn_per_m) * scale;
            add_transverse_load(&mut local_loads[index], length, x, py, pz);
        }
    }
    for load in &request.member_point_loads {
        let index = *element_index
            .get(&load.member_id)
            .ok_or("unknown point-loaded frame member")?;
        let length = elements[index].length;
        if ![load.py_kn, load.pz_kn, load.position_m]
            .iter()
            .all(|value| value.is_finite())
            || (load.py_kn == 0.0 && load.pz_kn == 0.0)
            || load.position_m < 0.0
            || load.position_m > length + 1e-9
        {
            return Err("invalid frame member point load".into());
        }
        add_transverse_load(
            &mut local_loads[index],
            length,
            load.position_m.min(length),
            load.py_kn,
            load.pz_kn,
        );
    }
    let dofs = request.nodes.len() * 6;
    let mut prescribed = vec![None; dofs];
    let mut springs = vec![0.0; dofs];
    let mut supported_nodes = HashSet::new();
    for support in &request.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown support node")?;
        if !supported_nodes.insert(support.node_id) {
            return Err("duplicate frame support node".into());
        }
        let spring_values = [
            support.kx_kn_per_m,
            support.ky_kn_per_m,
            support.kz_kn_per_m,
            support.krx_knm_per_rad,
            support.kry_knm_per_rad,
            support.krz_knm_per_rad,
        ];
        let prescribed_values = [
            support.ux_prescribed_m,
            support.uy_prescribed_m,
            support.uz_prescribed_m,
            support.rx_prescribed_rad,
            support.ry_prescribed_rad,
            support.rz_prescribed_rad,
        ];
        let fixed = [
            support.ux, support.uy, support.uz, support.rx, support.ry, support.rz,
        ];
        for axis in 0..6 {
            let dof = 6 * index + axis;
            if let Some(value) = spring_values[axis] {
                positive(value, "support spring stiffness")?;
                if fixed[axis] {
                    return Err("support DOF cannot be both fixed and sprung".into());
                }
                springs[dof] = value;
            }
            if let Some(value) = prescribed_values[axis] {
                if !value.is_finite() {
                    return Err("non-finite prescribed displacement".into());
                }
                if !fixed[axis] {
                    return Err("prescribed displacement requires a fixed DOF".into());
                }
            }
            if fixed[axis] {
                prescribed[dof] = Some(prescribed_values[axis].unwrap_or(0.0));
            }
        }
        if !fixed.iter().any(|value| *value) && !spring_values.iter().any(Option::is_some) {
            return Err("support has no fixed or sprung DOF".into());
        }
    }
    let mut f = vec![0.0; dofs];
    for load in &request.nodal_loads {
        let index = *node_index.get(&load.node_id).ok_or("unknown load node")?;
        for (axis, value) in [load.fx, load.fy, load.fz, load.mx, load.my, load.mz]
            .iter()
            .enumerate()
        {
            f[6 * index + axis] += value;
        }
    }
    for (element, local_load) in elements.iter().zip(&local_loads) {
        let t = transform(element.rotation);
        for global_axis in 0..12 {
            let equivalent: f64 = (0..12)
                .map(|local_axis| t[local_axis][global_axis] * local_load[local_axis])
                .sum();
            f[element.dofs[global_axis]] += equivalent;
        }
    }
    let mut u = vec![0.0; dofs];
    let mut iterations = 0;
    let mut relative_change = 0.0;
    let mut converged = false;
    for _ in 0..request.max_iterations {
        iterations += 1;
        let (mut k, _) = assemble(
            &elements,
            &u,
            request.analysis.material(),
            request.analysis.geometric(),
        )?;
        for (dof, spring) in springs.iter().enumerate() {
            if *spring > 0.0 {
                k.add(dof, dof, *spring);
            }
        }
        if request.analysis.geometric() {
            free_positive_definite(&k, &prescribed)?;
        }
        let (candidate, _) = constrained_solve(&k, &f, &prescribed)?;
        let change = candidate
            .iter()
            .zip(&u)
            .map(|(a, b)| (a - b).powi(2))
            .sum::<f64>()
            .sqrt();
        let magnitude = candidate
            .iter()
            .map(|v| v * v)
            .sum::<f64>()
            .sqrt()
            .max(1e-12);
        relative_change = change / magnitude;
        u = candidate;
        if request.analysis == Analysis::Linear || relative_change <= request.tolerance {
            converged = true;
            break;
        }
    }
    if !converged {
        return Err(format!(
            "frame nonlinear iteration did not converge in {} steps",
            request.max_iterations
        ));
    }
    let (mut k, stiffnesses) = assemble(
        &elements,
        &u,
        request.analysis.material(),
        request.analysis.geometric(),
    )?;
    for (dof, spring) in springs.iter().enumerate() {
        if *spring > 0.0 {
            k.add(dof, dof, *spring);
        }
    }
    if request.analysis.geometric() {
        free_positive_definite(&k, &prescribed)?;
    }
    let reaction: Vec<f64> = k
        .mul(&u)
        .iter()
        .zip(&f)
        .map(|(ku, load)| ku - load)
        .collect();
    let equilibrium_residual = reaction
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, r)| r * r)
        .sum::<f64>()
        .sqrt()
        / f.iter().map(|v| v * v).sum::<f64>().sqrt().max(1.0);
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| NodeResult {
            node_id: node.id,
            displacement: std::array::from_fn(|axis| u[6 * index + axis]),
            reaction: std::array::from_fn(|axis| {
                let dof = 6 * index + axis;
                if prescribed[dof].is_some() {
                    reaction[dof]
                } else {
                    -springs[dof] * u[dof]
                }
            }),
        })
        .collect();
    let members = elements
        .iter()
        .zip(stiffnesses)
        .zip(&local_loads)
        .map(|((element, e), local_load)| {
            let local = local_displacement(element, &u);
            let axial =
                e * 1000.0 * element.section.area_m2 * (local[6] - local[0]) / element.length;
            let mut forces = mat_vec(
                &local_stiffness(element, e, axial, request.analysis.geometric()),
                &local,
            );
            for axis in 0..12 {
                forces[axis] -= local_load[axis];
            }
            MemberResult {
                member_id: element.id,
                local_end_forces: forces,
                effective_e_mpa: e,
            }
        })
        .collect();
    Ok(Result3D {
        nodes,
        members,
        iterations,
        relative_change,
        equilibrium_residual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn cantilever(analysis: Analysis, law: MaterialLaw, load: f64) -> Request {
        Request {
            analysis,
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                Node {
                    id: 2,
                    x: 2.0,
                    y: 0.0,
                    z: 0.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 210_000.0,
                nu: 0.3,
                name: String::new(),
                alpha_per_k: None,
                law,
            }],
            sections: vec![Section {
                id: 1,
                area_m2: 0.01,
                iy_m4: 1e-5,
                iz_m4: 2e-5,
                torsion_j_m4: 1e-6,
                name: String::new(),
                shear_area_y_m2: None,
                shear_area_z_m2: None,
            }],
            members: vec![Member {
                id: 1,
                start_node_id: 1,
                end_node_id: 2,
                material_id: 1,
                section_id: 1,
                roll_angle_rad: 0.0,
                releases: HashMap::new(),
            }],
            supports: vec![Support {
                node_id: 1,
                ux: true,
                uy: true,
                uz: true,
                rx: true,
                ry: true,
                rz: true,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
                kz_kn_per_m: None,
                krx_knm_per_rad: None,
                kry_knm_per_rad: None,
                krz_knm_per_rad: None,
                ux_prescribed_m: None,
                uy_prescribed_m: None,
                uz_prescribed_m: None,
                rx_prescribed_rad: None,
                ry_prescribed_rad: None,
                rz_prescribed_rad: None,
            }],
            nodal_loads: vec![NodalLoad {
                id: 1,
                node_id: 2,
                fx: 0.0,
                fy: load,
                fz: 0.0,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
            }],
            member_loads: vec![],
            member_point_loads: vec![],
            thermal_loads: vec![],
            schema_version: 1,
            buckling_modes: 0,
            max_iterations: 80,
            tolerance: 1e-8,
        }
    }
    #[test]
    fn linear_cantilever_matches_closed_form() {
        let result = solve(&cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0)).unwrap();
        let expected = 10.0 * 2.0_f64.powi(3) / (3.0 * 210_000_000.0 * 2e-5);
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-10);
        assert!((result.nodes[0].reaction[1] + 10.0).abs() < 1e-9);
        assert!((result.nodes[0].reaction[5] + 20.0).abs() < 1e-9);
    }
    #[test]
    fn sprung_cantilever_matches_parallel_equilibrium() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.nodal_loads[0].fz = -10.0;
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        end_support.ux = false;
        end_support.uy = false;
        end_support.uz = false;
        end_support.rx = false;
        end_support.ry = false;
        end_support.rz = false;
        end_support.kz_kn_per_m = Some(212.5);
        model.supports.push(end_support);
        // 3 E Iy / L³ = 787.5 kN/m, in parallel with the 212.5 kN/m spring.
        let result = solve(&model).unwrap();
        assert!((result.nodes[1].displacement[2] + 0.01).abs() < 1e-12);
        assert!((result.nodes[1].reaction[2] - 2.125).abs() < 1e-9);
        assert!((result.nodes[0].reaction[2] - 7.875).abs() < 1e-9);
        assert!(result.equilibrium_residual < 1e-10);

        model.analysis = Analysis::PDelta;
        let nonlinear = solve(&model).unwrap();
        assert!((nonlinear.nodes[1].displacement[2] + 0.01).abs() < 1e-10);
        assert!((nonlinear.nodes[1].reaction[2] - 2.125).abs() < 1e-9);

        model.supports[1].uz = true;
        assert!(solve(&model).unwrap_err().contains("both fixed and sprung"));
    }
    #[test]
    fn prescribed_axial_movement_matches_ea_over_l() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        end_support.ux_prescribed_m = Some(0.001);
        model.supports.push(end_support);
        let result = solve(&model).unwrap();
        assert!((result.nodes[1].displacement[0] - 0.001).abs() < 1e-14);
        assert!((result.nodes[0].reaction[0] + 1050.0).abs() < 1e-8);
        assert!((result.nodes[1].reaction[0] - 1050.0).abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-12);

        model.supports[1].ux = false;
        assert!(solve(&model).unwrap_err().contains("requires a fixed DOF"));
    }
    #[test]
    fn uniform_member_load_matches_cantilever_solution() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.member_loads.push(MemberLoad {
            id: 1,
            member_id: 1,
            qy_start_kn_per_m: 0.0,
            qy_end_kn_per_m: 0.0,
            qz_start_kn_per_m: -4.0,
            qz_end_kn_per_m: -4.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&model).unwrap();
        let expected = -4.0 * 2.0_f64.powi(4) / (8.0 * 210_000_000.0 * 1e-5);
        assert!((result.nodes[1].displacement[2] - expected).abs() < 1e-12);
        assert!((result.nodes[0].reaction[2] - 8.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[4] + 8.0).abs() < 1e-10);
        assert!(result.equilibrium_residual < 1e-10);
    }
    #[test]
    fn midspan_member_point_load_matches_cantilever_solution() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.member_point_loads.push(MemberPointLoad {
            id: 1,
            member_id: 1,
            py_kn: 0.0,
            pz_kn: -10.0,
            position_m: 1.0,
        });
        let result = solve(&model).unwrap();
        let expected = -10.0 * 1.0_f64.powi(2) * (3.0 * 2.0 - 1.0) / (6.0 * 210_000_000.0 * 1e-5);
        assert!((result.nodes[1].displacement[2] - expected).abs() < 1e-12);
        assert!((result.nodes[0].reaction[2] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[4] + 10.0).abs() < 1e-10);
    }
    #[test]
    fn invalid_member_loads_are_rejected() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.member_loads.push(MemberLoad {
            id: 1,
            member_id: 1,
            qy_start_kn_per_m: 0.0,
            qy_end_kn_per_m: 0.0,
            qz_start_kn_per_m: -4.0,
            qz_end_kn_per_m: -4.0,
            start_position_m: Some(1.5),
            end_position_m: Some(1.0),
        });
        assert!(solve(&model)
            .unwrap_err()
            .contains("invalid frame member load"));
        model.member_loads.clear();
        model.member_point_loads.push(MemberPointLoad {
            id: 1,
            member_id: 1,
            py_kn: 1.0,
            pz_kn: 0.0,
            position_m: 3.0,
        });
        assert!(solve(&model)
            .unwrap_err()
            .contains("invalid frame member point load"));
    }
    #[test]
    fn compression_amplifies_lateral_displacement() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0);
        model.nodal_loads[0].fx = -100.0;
        let linear = solve(&model).unwrap();
        model.analysis = Analysis::PDelta;
        let nonlinear = solve(&model).unwrap();
        assert!(nonlinear.nodes[1].displacement[1] > linear.nodes[1].displacement[1]);
    }
    #[test]
    fn steel_and_concrete_material_softening() {
        let elastic = solve(&cantilever(Analysis::Linear, MaterialLaw::Elastic, 500.0)).unwrap();
        let steel = solve(&cantilever(
            Analysis::Material,
            MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.05,
            },
            500.0,
        ))
        .unwrap();
        let concrete = solve(&cantilever(
            Analysis::Material,
            MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.05,
            },
            500.0,
        ))
        .unwrap();
        assert!(steel.nodes[1].displacement[1] > elastic.nodes[1].displacement[1]);
        assert!(concrete.nodes[1].displacement[1] > steel.nodes[1].displacement[1]);
    }
    #[test]
    fn compression_past_stability_limit_is_rejected() {
        let mut model = cantilever(Analysis::PDelta, MaterialLaw::Elastic, 10.0);
        model.nodal_loads[0].fx = -5000.0;
        assert!(solve(&model).unwrap_err().contains("stiffness"));
    }
    #[test]
    fn unsupported_thermal_load_and_buckling_are_rejected() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0);
        model.thermal_loads.push(serde_json::json!({"memberId": 1}));
        assert!(solve(&model).unwrap_err().contains("thermal loads"));
        model.thermal_loads.clear();
        model.buckling_modes = 1;
        assert!(solve(&model).unwrap_err().contains("buckling"));
    }
}
