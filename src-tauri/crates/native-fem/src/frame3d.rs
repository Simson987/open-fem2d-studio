//! Native 12-DOF Euler-Bernoulli frame element. Uses the same neutral JSON
//! field names and units as `frame3d-solver`, but no upstream solver code.
//! GNL is a tangent P-Delta iteration. The default FNL path is a monotonic
//! secant law; an explicit load path retains axial plasticity or tensile damage.

use crate::math::{buckling_factors, constrained_solve, free_positive_definite, Matrix};
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
    pub releases: EndReleases,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndReleases {
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
impl EndReleases {
    fn any(self) -> bool {
        self.my_start
            || self.my_end
            || self.mz_start
            || self.mz_end
            || self.torsion_start
            || self.torsion_end
    }
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
pub struct ThermalLoad {
    pub id: usize,
    pub member_id: usize,
    pub delta_t_uniform_k: f64,
    #[serde(default)]
    pub delta_t_gradient_y_k: f64,
    #[serde(default)]
    pub delta_t_gradient_z_k: f64,
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
    pub thermal_loads: Vec<ThermalLoad>,
    #[serde(default)]
    pub load_path: Vec<f64>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axial_history: Option<AxialHistoryResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxialHistoryResult {
    pub plastic_strain: f64,
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
    pub tangent_e_mpa: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagramPoint {
    pub t: f64,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDiagram {
    pub member_id: usize,
    pub points: Vec<DiagramPoint>,
    pub max_value: f64,
    pub min_value: f64,
    pub max_abs_value: f64,
}
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagrams3D {
    pub moment_y: Vec<MemberDiagram>,
    pub moment_z: Vec<MemberDiagram>,
    pub shear_y: Vec<MemberDiagram>,
    pub shear_z: Vec<MemberDiagram>,
    pub axial: Vec<MemberDiagram>,
    pub torsion: Vec<MemberDiagram>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucklingMode {
    pub mode: usize,
    pub load_factor: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucklingMember {
    pub member_id: usize,
    pub axial_force_kn: f64,
    pub critical_force_kn: f64,
    pub effective_length_factor: f64,
    pub effective_length_m: f64,
    pub length_m: f64,
    pub slenderness_y: f64,
    pub slenderness_z: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum BucklingSummary {
    Available {
        modes: Vec<BucklingMode>,
        members: Vec<BucklingMember>,
    },
    NotApplicable {
        reason: String,
    },
    Failed {
        reason: String,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result3D {
    pub nodes: Vec<NodeResult>,
    pub members: Vec<MemberResult>,
    pub diagrams: Diagrams3D,
    pub buckling: BucklingSummary,
    pub iterations: usize,
    pub relative_change: f64,
    pub max_amplification: f64,
    pub equilibrium_residual: f64,
}

struct Element<'a> {
    id: usize,
    dofs: [usize; 12],
    length: f64,
    rotation: [[f64; 3]; 3],
    material: &'a Material,
    section: &'a Section,
    releases: EndReleases,
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
fn effective_e(
    element: &Element<'_>,
    local: &[f64; 12],
    nonlinear: bool,
    thermal_strain: f64,
) -> f64 {
    let e = element.material.e_mpa;
    if !nonlinear {
        return e;
    }
    let l = element.length;
    let axial = (local[6] - local[0]) / l - thermal_strain;
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

#[derive(Clone, Copy, Debug, Default)]
struct AxialState {
    plastic_strain: f64,
    equivalent_plastic_strain: f64,
    tensile_damage: f64,
}

#[derive(Clone, Copy, Debug)]
struct AxialResponse {
    stress_mpa: f64,
    tangent_e_mpa: f64,
    state: AxialState,
}

/// One-dimensional return mapping at fixed total axial strain. `previous`
/// is the state committed at the preceding load factor, never a trial state
/// from the current equilibrium iteration.
fn axial_response(material: &Material, strain: f64, previous: AxialState) -> AxialResponse {
    let e = material.e_mpa;
    match material.law {
        MaterialLaw::Elastic => AxialResponse {
            stress_mpa: e * strain,
            tangent_e_mpa: e,
            state: previous,
        },
        MaterialLaw::SteelBilinear {
            yield_mpa,
            hardening_ratio,
        } => {
            let trial = e * (strain - previous.plastic_strain);
            if hardening_ratio == 1.0 {
                return AxialResponse {
                    stress_mpa: trial,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let h = e * hardening_ratio / (1.0 - hardening_ratio);
            let excess = trial.abs() - yield_mpa - h * previous.equivalent_plastic_strain;
            if excess <= 0.0 {
                return AxialResponse {
                    stress_mpa: trial,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let increment = excess / (e + h);
            let sign = trial.signum();
            AxialResponse {
                stress_mpa: trial - sign * e * increment,
                tangent_e_mpa: hardening_ratio * e,
                state: AxialState {
                    plastic_strain: previous.plastic_strain + sign * increment,
                    equivalent_plastic_strain: previous.equivalent_plastic_strain + increment,
                    ..previous
                },
            }
        }
        MaterialLaw::ConcreteCracking {
            tensile_mpa,
            residual_ratio,
        } => {
            if strain <= 0.0 {
                return AxialResponse {
                    stress_mpa: e * strain,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let elastic_stress = e * strain;
            let candidate = if elastic_stress > tensile_mpa {
                1.0 - (tensile_mpa + residual_ratio * (elastic_stress - tensile_mpa))
                    / elastic_stress
            } else {
                0.0
            };
            let damage = previous.tensile_damage.max(candidate).clamp(0.0, 1.0);
            let growing = candidate > previous.tensile_damage + 1e-12;
            AxialResponse {
                stress_mpa: (1.0 - damage) * elastic_stress,
                tangent_e_mpa: if growing {
                    residual_ratio * e
                } else {
                    (1.0 - damage) * e
                },
                state: AxialState {
                    tensile_damage: damage,
                    ..previous
                },
            }
        }
    }
}
fn condense_releases(
    mut stiffness: [[f64; 12]; 12],
    mut load: [f64; 12],
    releases: EndReleases,
) -> Result<([[f64; 12]; 12], [f64; 12]), String> {
    // A torsion release at either end removes the member's torsion path.
    if releases.torsion_start || releases.torsion_end {
        for axis in [3, 9] {
            for other in 0..12 {
                stiffness[axis][other] = 0.0;
                stiffness[other][axis] = 0.0;
            }
            load[axis] = 0.0;
        }
    }
    for (axis, released) in [
        (4, releases.my_start),
        (10, releases.my_end),
        (5, releases.mz_start),
        (11, releases.mz_end),
    ] {
        if !released {
            continue;
        }
        let pivot = stiffness[axis][axis];
        if !pivot.is_finite() || pivot <= 0.0 {
            return Err("invalid frame release condensation pivot".into());
        }
        let column = std::array::from_fn::<_, 12, _>(|i| stiffness[i][axis]);
        let released_load = load[axis];
        for i in 0..12 {
            if i == axis {
                continue;
            }
            load[i] -= column[i] * released_load / pivot;
            for j in 0..12 {
                if j != axis {
                    stiffness[i][j] -= column[i] * column[j] / pivot;
                }
            }
        }
        for other in 0..12 {
            stiffness[axis][other] = 0.0;
            stiffness[other][axis] = 0.0;
        }
        load[axis] = 0.0;
    }
    Ok((stiffness, load))
}

/// Recover the internal bending rotations eliminated by a moment release.
/// The joint rotation may be restrained or shared with another member, so it
/// cannot be used to estimate the released member's fibre strain.
fn recovered_bending_rotations(
    mut local: [f64; 12],
    stiffness: &[[f64; 12]; 12],
    load: &[f64; 12],
    releases: EndReleases,
) -> Result<[f64; 12], String> {
    let released: Vec<usize> = [
        (4, releases.my_start),
        (10, releases.my_end),
        (5, releases.mz_start),
        (11, releases.mz_end),
    ]
    .into_iter()
    .filter_map(|(axis, active)| active.then_some(axis))
    .collect();
    if released.is_empty() {
        return Ok(local);
    }
    let mut system = Matrix::zeros(released.len())?;
    let rhs: Vec<f64> = released
        .iter()
        .map(|&axis| {
            load[axis]
                - (0..12)
                    .filter(|index| !released.contains(index))
                    .map(|index| stiffness[axis][index] * local[index])
                    .sum::<f64>()
        })
        .collect();
    for (row, &axis) in released.iter().enumerate() {
        for (col, &other) in released.iter().enumerate() {
            system.add(row, col, stiffness[axis][other]);
        }
    }
    let angles = constrained_solve(&system, &rhs, &vec![None; released.len()])?.0;
    for (index, &axis) in released.iter().enumerate() {
        local[axis] = angles[index];
    }
    Ok(local)
}

struct Assembly {
    stiffness: Matrix,
    effective_e: Vec<f64>,
    axial_response: Vec<Option<AxialResponse>>,
    member_load: Vec<f64>,
    local_stiffness: Vec<[[f64; 12]; 12]>,
    local_load: Vec<[f64; 12]>,
}
fn constraints_with_inactive_dofs(
    stiffness: &Matrix,
    load: &[f64],
    prescribed: &[Option<f64>],
    released_rotations: &[bool],
) -> Result<Vec<Option<f64>>, String> {
    let mut constraints = prescribed.to_vec();
    for axis in 0..stiffness.n {
        if !released_rotations[axis]
            || constraints[axis].is_some()
            || stiffness.get(axis, axis) != 0.0
        {
            continue;
        }
        if (0..stiffness.n)
            .any(|other| stiffness.get(axis, other) != 0.0 || stiffness.get(other, axis) != 0.0)
        {
            continue;
        }
        if load[axis] != 0.0 {
            return Err("load on a disconnected frame DOF".into());
        }
        // A released rotation without any attached stiffness has no unique
        // nodal value. Zero is a gauge choice; it is not a physical support.
        constraints[axis] = Some(0.0);
    }
    Ok(constraints)
}
fn assemble(
    elements: &[Element<'_>],
    u: &[f64],
    thermal_axial: &[f64],
    local_loads: &[[f64; 12]],
    nonlinear_material: bool,
    nonlinear_geometry: bool,
    axial_states: Option<&[AxialState]>,
) -> Result<Assembly, String> {
    let mut k = Matrix::zeros(u.len())?;
    let mut stiffnesses = Vec::with_capacity(elements.len());
    let mut axial_responses = Vec::with_capacity(elements.len());
    let mut member_force = vec![0.0; u.len()];
    let mut local_stiffnesses = Vec::with_capacity(elements.len());
    let mut condensed_loads = Vec::with_capacity(elements.len());
    for (index, element) in elements.iter().enumerate() {
        let local = local_displacement(element, u);
        let area = element.section.area_m2;
        let thermal_strain = thermal_axial[index] / (element.material.e_mpa * 1000.0 * area);
        let mut e = effective_e(element, &local, nonlinear_material, thermal_strain);
        let strain = (local[6] - local[0]) / element.length;
        let history_response = axial_states
            .map(|states| axial_response(element.material, strain - thermal_strain, states[index]));
        if nonlinear_material && element.releases.any() {
            for _ in 0..8 {
                let axial = history_response.map_or(
                    e * 1000.0 * area * strain - thermal_axial[index],
                    |response| response.stress_mpa * 1000.0 * area,
                );
                let trial_k = local_stiffness(element, e, axial, nonlinear_geometry);
                let recovered = recovered_bending_rotations(
                    local,
                    &trial_k,
                    &local_loads[index],
                    element.releases,
                )?;
                let next_e = effective_e(element, &recovered, true, thermal_strain);
                let change = (next_e - e).abs() / e;
                e = next_e;
                if change < 1e-10 {
                    break;
                }
            }
        }
        let axial = history_response.map_or(
            e * 1000.0 * area * strain - thermal_axial[index],
            |response| response.stress_mpa * 1000.0 * area,
        );
        let mut stiffness = local_stiffness(element, e, axial, nonlinear_geometry);
        let mut applied_load = local_loads[index];
        if let Some(response) = history_response {
            add_pair(
                &mut stiffness,
                0,
                6,
                (response.tangent_e_mpa - e) * 1000.0 * area / element.length,
            );
            // The thermal equivalent nodal load is already in local_loads.
            // Cancel it here: the return mapping uses mechanical strain, and
            // the tangent equation must recover sigma(strain - thermal_strain).
            let offset = (response.stress_mpa - response.tangent_e_mpa * strain) * 1000.0 * area
                + thermal_axial[index];
            applied_load[0] += offset;
            applied_load[6] -= offset;
        }
        let (kl, local_load) = condense_releases(stiffness, applied_load, element.releases)?;
        let t = transform(element.rotation);
        for i in 0..12 {
            for j in 0..12 {
                let value: f64 = (0..12)
                    .flat_map(|a| (0..12).map(move |b| t[a][i] * kl[a][b] * t[b][j]))
                    .sum();
                k.add(element.dofs[i], element.dofs[j], value);
            }
            let equivalent: f64 = (0..12)
                .map(|local_axis| t[local_axis][i] * local_load[local_axis])
                .sum();
            member_force[element.dofs[i]] += equivalent;
        }
        stiffnesses.push(e);
        axial_responses.push(history_response);
        local_stiffnesses.push(kl);
        condensed_loads.push(local_load);
    }
    Ok(Assembly {
        stiffness: k,
        effective_e: stiffnesses,
        axial_response: axial_responses,
        member_load: member_force,
        local_stiffness: local_stiffnesses,
        local_load: condensed_loads,
    })
}

fn member_diagram(
    member_id: usize,
    length: f64,
    forces: &[f64; 12],
    line_loads: &[&MemberLoad],
    point_loads: &[&MemberPointLoad],
    load_factor: f64,
    local_displacement: &[f64; 12],
    geometric: bool,
    kind: &str,
) -> MemberDiagram {
    use std::collections::BTreeSet;
    let mut positions: BTreeSet<i64> = (0..=20).map(|i| i * 50_000_000_000).collect();
    let transverse = matches!(kind, "momentY" | "momentZ" | "shearY" | "shearZ");
    if transverse {
        for load in line_loads {
            for x in [
                load.start_position_m.unwrap_or(0.0),
                load.end_position_m.unwrap_or(length),
            ] {
                positions.insert(((x / length) * 1e12).round() as i64);
            }
        }
        for load in point_loads {
            let t = load.position_m / length;
            for shifted in [t - 1e-6, t, t + 1e-6] {
                if (0.0..=1.0).contains(&shifted) {
                    positions.insert((shifted * 1e12).round() as i64);
                }
            }
        }
    }
    let mut points = Vec::with_capacity(positions.len());
    let mut max_value = f64::NEG_INFINITY;
    let mut min_value = f64::INFINITY;
    let mut max_abs_value: f64 = 0.0;
    for key in positions {
        let t = key as f64 / 1e12;
        let x = t * length;
        let (start, end) = match kind {
            "axial" => (-forces[0], forces[6]),
            "shearY" => (forces[1], -forces[7]),
            "shearZ" => (forces[2], -forces[8]),
            "torsion" => (forces[3], -forces[9]),
            "momentY" => (forces[4], -forces[10]),
            "momentZ" => (forces[5], -forces[11]),
            _ => unreachable!(),
        };
        let mut value = match kind {
            "momentY" => start + forces[2] * x,
            "momentZ" => start - forces[1] * x,
            "shearY" | "shearZ" => start,
            _ => start + t * (end - start),
        };
        if geometric && matches!(kind, "momentY" | "momentZ") {
            let h = hermite(length, x);
            let transverse = if kind == "momentZ" {
                h[0] * local_displacement[1]
                    + h[1] * local_displacement[5]
                    + h[2] * local_displacement[7]
                    + h[3] * local_displacement[11]
                    - local_displacement[1]
            } else {
                h[0] * local_displacement[2] - h[1] * local_displacement[4]
                    + h[2] * local_displacement[8]
                    - h[3] * local_displacement[10]
                    - local_displacement[2]
            };
            value += if kind == "momentZ" {
                -forces[6] * transverse
            } else {
                forces[6] * transverse
            };
        }
        for load in line_loads {
            let a = load.start_position_m.unwrap_or(0.0);
            let b = load.end_position_m.unwrap_or(length);
            if x <= a || b - a <= 1e-12 {
                continue;
            }
            let span = b - a;
            let s = x.min(b) - a;
            let (qi, qj) = if matches!(kind, "momentY" | "shearZ") {
                (load.qz_start_kn_per_m, load.qz_end_kn_per_m)
            } else {
                (load.qy_start_kn_per_m, load.qy_end_kn_per_m)
            };
            let dq = qj - qi;
            let integrated_force = load_factor * (qi * s + dq * s * s / (2.0 * span));
            let integrated_moment = load_factor
                * (qi * (s * (x - a) - s * s / 2.0)
                    + dq / span * (s * s * (x - a) / 2.0 - s * s * s / 3.0));
            value += match kind {
                "shearY" | "shearZ" => integrated_force,
                "momentY" => integrated_moment,
                "momentZ" => -integrated_moment,
                _ => 0.0,
            };
        }
        for load in point_loads {
            if load.position_m >= x - 1e-10 {
                continue;
            }
            let p = if matches!(kind, "momentY" | "shearZ") {
                load.pz_kn
            } else {
                load.py_kn
            };
            value += match kind {
                "shearY" | "shearZ" => load_factor * p,
                "momentY" => load_factor * p * (x - load.position_m),
                "momentZ" => -load_factor * p * (x - load.position_m),
                _ => 0.0,
            };
        }
        max_value = max_value.max(value);
        min_value = min_value.min(value);
        max_abs_value = max_abs_value.max(value.abs());
        points.push(DiagramPoint { t, value });
    }
    MemberDiagram {
        member_id,
        points,
        max_value,
        min_value,
        max_abs_value,
    }
}

fn member_diagrams(
    request: &Request,
    elements: &[Element<'_>],
    members: &[MemberResult],
    load_factor: f64,
    displacement: &[f64],
    local_loads: &[[f64; 12]],
) -> Result<Diagrams3D, String> {
    let mut diagrams = Diagrams3D::default();
    for (index, (element, member)) in elements.iter().zip(members).enumerate() {
        let line_loads: Vec<_> = request
            .member_loads
            .iter()
            .filter(|load| load.member_id == element.id)
            .collect();
        let point_loads: Vec<_> = request
            .member_point_loads
            .iter()
            .filter(|load| load.member_id == element.id)
            .collect();
        let mut local = local_displacement(element, displacement);
        if request.analysis.geometric() && element.releases.any() {
            let stiffness = local_stiffness(
                element,
                member.effective_e_mpa,
                member.local_end_forces[6],
                true,
            );
            local = recovered_bending_rotations(
                local,
                &stiffness,
                &local_loads[index],
                element.releases,
            )?;
        }
        let compute = |kind| {
            member_diagram(
                element.id,
                element.length,
                &member.local_end_forces,
                &line_loads,
                &point_loads,
                load_factor,
                &local,
                request.analysis.geometric(),
                kind,
            )
        };
        diagrams.moment_y.push(compute("momentY"));
        diagrams.moment_z.push(compute("momentZ"));
        diagrams.shear_y.push(compute("shearY"));
        diagrams.shear_z.push(compute("shearZ"));
        diagrams.axial.push(compute("axial"));
        diagrams.torsion.push(compute("torsion"));
    }
    Ok(diagrams)
}

fn buckling_summary(
    request: &Request,
    elements: &[Element<'_>],
    members: &[MemberResult],
    u: &[f64],
    thermal_axial: &[f64],
    local_loads: &[[f64; 12]],
    springs: &[f64],
    constraints: &[Option<f64>],
) -> BucklingSummary {
    if request.buckling_modes == 0 {
        return BucklingSummary::NotApplicable {
            reason: "Eigenknik niet aangevraagd.".into(),
        };
    }
    if !members
        .iter()
        .any(|member| member.local_end_forces[6] < -1e-8)
    {
        return BucklingSummary::NotApplicable {
            reason: "Geen drukstaaf aanwezig.".into(),
        };
    }
    let free: Vec<usize> = (0..u.len())
        .filter(|&dof| constraints[dof].is_none())
        .collect();
    if free.is_empty() {
        return BucklingSummary::NotApplicable {
            reason: "Alle vrijheidsgraden zijn voorgeschreven.".into(),
        };
    }
    if free.len() > 120 || u.len() > 600 {
        return BucklingSummary::Failed { reason: format!(
            "Eigenknik is beperkt tot 120 vrije en 600 totale vrijheidsgraden ({} vrij, {} totaal).",
            free.len(), u.len(),
        ) };
    }
    let calculate = || -> Result<BucklingSummary, String> {
        let mut elastic = assemble(
            elements,
            u,
            thermal_axial,
            local_loads,
            request.analysis.material(),
            false,
            None,
        )?;
        let geometric = assemble(
            elements,
            u,
            thermal_axial,
            local_loads,
            request.analysis.material(),
            true,
            None,
        )?;
        for (dof, spring) in springs.iter().enumerate() {
            if *spring > 0.0 {
                elastic.stiffness.add(dof, dof, *spring);
            }
        }
        let mut kg = Matrix::zeros(u.len())?;
        for i in 0..u.len() {
            for j in 0..u.len() {
                let difference = geometric.stiffness.get(i, j) - elastic.stiffness.get(i, j)
                    + if i == j { springs[i] } else { 0.0 };
                if difference != 0.0 {
                    kg.add(i, j, difference);
                }
            }
        }
        let factors = buckling_factors(&elastic.stiffness, &kg, &free, request.buckling_modes)?;
        if factors.is_empty() {
            return Ok(BucklingSummary::NotApplicable {
                reason: "Geen positieve fysieke knikmodus gevonden.".into(),
            });
        }
        let first_factor = factors[0];
        let modes = factors
            .into_iter()
            .enumerate()
            .map(|(index, load_factor)| BucklingMode {
                mode: index + 1,
                load_factor,
            })
            .collect();
        let member_data = elements
            .iter()
            .zip(members)
            .map(|(element, member)| {
                let axial_force_kn = member.local_end_forces[6];
                let critical_force_kn = first_factor * axial_force_kn.abs();
                let radius_y = (element.section.iy_m4 / element.section.area_m2).sqrt();
                let radius_z = (element.section.iz_m4 / element.section.area_m2).sqrt();
                let ei_min = member.effective_e_mpa
                    * 1000.0
                    * element.section.iy_m4.min(element.section.iz_m4);
                let effective_length_m = if critical_force_kn > 1e-8 {
                    std::f64::consts::PI * (ei_min / critical_force_kn).sqrt()
                } else {
                    element.length
                };
                BucklingMember {
                    member_id: element.id,
                    axial_force_kn,
                    critical_force_kn,
                    effective_length_factor: effective_length_m / element.length,
                    effective_length_m,
                    length_m: element.length,
                    slenderness_y: effective_length_m / radius_y,
                    slenderness_z: effective_length_m / radius_z,
                }
            })
            .collect();
        Ok(BucklingSummary::Available {
            modes,
            members: member_data,
        })
    };
    calculate().unwrap_or_else(|reason| BucklingSummary::Failed { reason })
}

pub fn solve(request: &Request) -> Result<Result3D, String> {
    if request.schema_version != 1 {
        return Err("unsupported 3D schema version".into());
    }
    if request.nodes.len() < 2 || request.members.is_empty() {
        return Err("frame requires nodes and members".into());
    }
    positive(request.tolerance, "tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid iteration limit".into());
    }
    if !request.load_path.is_empty() {
        if !request.analysis.material() {
            return Err("3D material load path requires material analysis".into());
        }
        if request.load_path.len() > 100
            || request.load_path.iter().any(|factor| !factor.is_finite())
        {
            return Err("invalid 3D material load path".into());
        }
        if request.buckling_modes > 0 {
            return Err("eigenbuckling with 3D material history is not implemented".into());
        }
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
            releases: member.releases,
        });
    }
    let element_index: HashMap<usize, usize> = elements
        .iter()
        .enumerate()
        .map(|(i, element)| (element.id, i))
        .collect();
    let mut local_loads = vec![[0.0; 12]; elements.len()];
    let mut thermal_axial = vec![0.0; elements.len()];
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
    for load in &request.thermal_loads {
        let index = *element_index
            .get(&load.member_id)
            .ok_or("unknown thermally loaded frame member")?;
        let values = [
            load.delta_t_uniform_k,
            load.delta_t_gradient_y_k,
            load.delta_t_gradient_z_k,
        ];
        if values.iter().any(|value| !value.is_finite()) || values.iter().all(|value| *value == 0.0)
        {
            return Err("invalid frame thermal load".into());
        }
        if request.analysis.material()
            && (load.delta_t_gradient_y_k != 0.0 || load.delta_t_gradient_z_k != 0.0)
        {
            return Err(
                "thermal gradients with frame material nonlinearity are not implemented".into(),
            );
        }
        let element = &elements[index];
        let alpha = element.material.alpha_per_k.unwrap_or(12e-6);
        if !alpha.is_finite() || alpha <= 0.0 {
            return Err("invalid frame thermal expansion coefficient".into());
        }
        let e = element.material.e_mpa * 1000.0;
        let area = element.section.area_m2;
        let hy = (12.0 * element.section.iz_m4 / area).sqrt();
        let hz = (12.0 * element.section.iy_m4 / area).sqrt();
        let axial = e * area * alpha * load.delta_t_uniform_k;
        let moment_y = e * element.section.iy_m4 * alpha * load.delta_t_gradient_z_k / hz;
        let moment_z = e * element.section.iz_m4 * alpha * load.delta_t_gradient_y_k / hy;
        let local = &mut local_loads[index];
        local[0] -= axial;
        local[6] += axial;
        local[4] -= moment_y;
        local[10] += moment_y;
        local[5] -= moment_z;
        local[11] += moment_z;
        thermal_axial[index] += axial;
    }
    let dofs = request.nodes.len() * 6;
    let mut released_rotations = vec![false; dofs];
    for element in &elements {
        if element.releases.my_start || element.releases.mz_start || element.releases.torsion_start
        {
            for local_axis in 3..6 {
                released_rotations[element.dofs[local_axis]] = true;
            }
        }
        if element.releases.my_end || element.releases.mz_end || element.releases.torsion_end {
            for local_axis in 9..12 {
                released_rotations[element.dofs[local_axis]] = true;
            }
        }
    }
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
    let mut nodal_f = vec![0.0; dofs];
    for load in &request.nodal_loads {
        let index = *node_index.get(&load.node_id).ok_or("unknown load node")?;
        for (axis, value) in [load.fx, load.fy, load.fz, load.mx, load.my, load.mz]
            .iter()
            .enumerate()
        {
            nodal_f[6 * index + axis] += value;
        }
    }
    let history_enabled = !request.load_path.is_empty()
        || (request.analysis.material() && !request.thermal_loads.is_empty());
    if history_enabled && request.buckling_modes > 0 {
        return Err("eigenbuckling with 3D material history is not implemented".into());
    }
    let path = if !request.load_path.is_empty() {
        request.load_path.clone()
    } else {
        vec![1.0]
    };
    let final_factor = *path.last().unwrap();
    let mut axial_states = vec![AxialState::default(); elements.len()];
    let mut u = vec![0.0; dofs];
    let mut iterations = 0;
    let mut relative_change = 0.0;
    let mut first_translation_max: f64 = 0.0;
    let mut final_nodal_f = vec![0.0; dofs];
    let mut final_local_loads = vec![[0.0; 12]; elements.len()];
    let mut final_prescribed = prescribed.clone();
    for factor in path {
        let step_nodal_f: Vec<f64> = nodal_f.iter().map(|value| factor * value).collect();
        let step_thermal_axial: Vec<f64> =
            thermal_axial.iter().map(|value| factor * value).collect();
        let step_local_loads: Vec<[f64; 12]> = local_loads
            .iter()
            .map(|load| load.map(|value| factor * value))
            .collect();
        let step_prescribed: Vec<Option<f64>> = prescribed
            .iter()
            .map(|value| value.map(|displacement| factor * displacement))
            .collect();
        let mut converged = false;
        for _ in 0..request.max_iterations {
            iterations += 1;
            let mut assembly = assemble(
                &elements,
                &u,
                &step_thermal_axial,
                &step_local_loads,
                request.analysis.material(),
                request.analysis.geometric(),
                history_enabled.then_some(axial_states.as_slice()),
            )?;
            for (dof, spring) in springs.iter().enumerate() {
                if *spring > 0.0 {
                    assembly.stiffness.add(dof, dof, *spring);
                }
            }
            let f: Vec<f64> = step_nodal_f
                .iter()
                .zip(&assembly.member_load)
                .map(|(nodal, member)| nodal + member)
                .collect();
            let solve_constraints = constraints_with_inactive_dofs(
                &assembly.stiffness,
                &f,
                &step_prescribed,
                &released_rotations,
            )?;
            if request.analysis.geometric() {
                free_positive_definite(&assembly.stiffness, &solve_constraints)?;
            }
            let (candidate, _) = constrained_solve(&assembly.stiffness, &f, &solve_constraints)?;
            if iterations == 1 {
                first_translation_max = candidate
                    .chunks_exact(6)
                    .flat_map(|node| node[..3].iter())
                    .map(|value| value.abs())
                    .fold(0.0, f64::max);
            }
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
        if history_enabled {
            let committed = assemble(
                &elements,
                &u,
                &step_thermal_axial,
                &step_local_loads,
                true,
                false,
                Some(&axial_states),
            )?;
            axial_states = committed
                .axial_response
                .iter()
                .map(|response| response.unwrap().state)
                .collect();
        }
        final_nodal_f = step_nodal_f;
        final_local_loads = step_local_loads;
        final_prescribed = step_prescribed;
    }
    let final_thermal_axial: Vec<f64> = thermal_axial
        .iter()
        .map(|value| final_factor * value)
        .collect();
    let mut assembly = assemble(
        &elements,
        &u,
        &final_thermal_axial,
        &final_local_loads,
        request.analysis.material(),
        request.analysis.geometric(),
        history_enabled.then_some(axial_states.as_slice()),
    )?;
    for (dof, spring) in springs.iter().enumerate() {
        if *spring > 0.0 {
            assembly.stiffness.add(dof, dof, *spring);
        }
    }
    let f: Vec<f64> = final_nodal_f
        .iter()
        .zip(&assembly.member_load)
        .map(|(nodal, member)| nodal + member)
        .collect();
    let solve_constraints = constraints_with_inactive_dofs(
        &assembly.stiffness,
        &f,
        &final_prescribed,
        &released_rotations,
    )?;
    if request.analysis.geometric() {
        free_positive_definite(&assembly.stiffness, &solve_constraints)?;
    }
    let reaction: Vec<f64> = assembly
        .stiffness
        .mul(&u)
        .iter()
        .zip(&f)
        .map(|(ku, load)| ku - load)
        .collect();
    let equilibrium_residual = reaction
        .iter()
        .enumerate()
        .filter(|(i, _)| final_prescribed[*i].is_none())
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
                if final_prescribed[dof].is_some() {
                    reaction[dof]
                } else {
                    -springs[dof] * u[dof]
                }
            }),
        })
        .collect();
    let members: Vec<MemberResult> = elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            let local_k = &assembly.local_stiffness[index];
            let local_load = &assembly.local_load[index];
            let local = local_displacement(element, &u);
            let mut forces = mat_vec(local_k, &local);
            for axis in 0..12 {
                forces[axis] -= local_load[axis];
            }
            let axial_history = history_enabled.then(|| {
                let state = axial_states[index];
                AxialHistoryResult {
                    plastic_strain: state.plastic_strain,
                    equivalent_plastic_strain: state.equivalent_plastic_strain,
                    tensile_damage: state.tensile_damage,
                    tangent_e_mpa: assembly.axial_response[index].unwrap().tangent_e_mpa,
                }
            });
            MemberResult {
                member_id: element.id,
                local_end_forces: forces,
                effective_e_mpa: assembly.effective_e[index],
                axial_history,
            }
        })
        .collect();
    let diagrams = member_diagrams(
        request,
        &elements,
        &members,
        final_factor,
        &u,
        &final_local_loads,
    )?;
    let buckling = buckling_summary(
        request,
        &elements,
        &members,
        &u,
        &final_thermal_axial,
        &local_loads,
        &springs,
        &solve_constraints,
    );
    let final_translation_max = u
        .chunks_exact(6)
        .flat_map(|node| node[..3].iter())
        .map(|value| value.abs())
        .fold(0.0, f64::max);
    let max_amplification = if first_translation_max > 1e-12 {
        (final_translation_max / first_translation_max).max(1.0)
    } else {
        1.0
    };
    Ok(Result3D {
        nodes,
        members,
        diagrams,
        buckling,
        iterations,
        relative_change,
        max_amplification,
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
                releases: EndReleases::default(),
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
            load_path: vec![],
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
    fn frame_over_600_dof_matches_axial_chain_solution_with_p_delta() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.nodes = (0..=100)
            .map(|index| Node {
                id: index + 1,
                x: index as f64,
                y: 0.0,
                z: 0.0,
            })
            .collect();
        model.members = (0..100)
            .map(|index| Member {
                id: index + 1,
                start_node_id: index + 1,
                end_node_id: index + 2,
                material_id: 1,
                section_id: 1,
                roll_angle_rad: 0.0,
                releases: EndReleases::default(),
            })
            .collect();
        model.supports = (0..=100)
            .map(|index| {
                let mut support = model.supports[0].clone();
                support.node_id = index + 1;
                support.ux = index == 0;
                support
            })
            .collect();
        model.nodal_loads[0].node_id = 101;
        model.nodal_loads[0].fx = 100.0;
        let expected = 100.0 * 100.0 / (210_000.0 * 1000.0 * 0.01);
        let linear = solve(&model).unwrap();
        assert!((linear.nodes[100].displacement[0] - expected).abs() < 1e-10);
        model.analysis = Analysis::PDelta;
        let geometric = solve(&model).unwrap();
        assert!((geometric.nodes[100].displacement[0] - expected).abs() < 1e-10);
        assert!(geometric.equilibrium_residual < 1e-8);
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
    fn released_end_moment_matches_propped_cantilever_solution() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.members[0].releases.my_end = true;
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        model.supports.push(end_support);
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
        assert!((result.nodes[0].reaction[2] - 5.0).abs() < 1e-10);
        assert!((result.nodes[1].reaction[2] - 3.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[4].abs() - 2.0).abs() < 1e-10);
        assert!(result.nodes[1].reaction[4].abs() < 1e-10);
        assert!(result.members[0].local_end_forces[10].abs() < 1e-10);
    }
    #[test]
    fn released_rotations_without_stiffness_do_not_make_a_loaded_beam_singular() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.members[0].releases.my_start = true;
        model.members[0].releases.my_end = true;
        model.supports[0].ry = false;
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        model.supports.push(end_support);
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
        assert!((result.nodes[0].reaction[2] - 4.0).abs() < 1e-10);
        assert!((result.nodes[1].reaction[2] - 4.0).abs() < 1e-10);
        assert!(result.members[0].local_end_forces[4].abs() < 1e-10);
        assert!(result.members[0].local_end_forces[10].abs() < 1e-10);
        model.nodal_loads[0].my = 1.0;
        assert!(solve(&model)
            .unwrap_err()
            .contains("load on a disconnected frame DOF"));
    }
    #[test]
    fn compression_amplifies_released_cantilever_deflection() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.members[0].releases.my_end = true;
        model.nodal_loads[0].fx = -100.0;
        model.nodal_loads[0].fz = -10.0;
        let linear = solve(&model).unwrap();
        model.analysis = Analysis::PDelta;
        let nonlinear = solve(&model).unwrap();
        assert!(nonlinear.nodes[1].displacement[2].abs() > linear.nodes[1].displacement[2].abs());
        assert!(nonlinear.members[0].local_end_forces[10].abs() < 1e-9);
        model.analysis = Analysis::Material;
        let material = solve(&model).unwrap();
        assert!((material.nodes[1].displacement[2] - linear.nodes[1].displacement[2]).abs() < 1e-9);
        assert!(material.members[0].local_end_forces[10].abs() < 1e-9);
    }
    #[test]
    fn geometric_moment_y_diagram_ends_at_released_member_moment() {
        let mut model = cantilever(Analysis::PDelta, MaterialLaw::Elastic, 0.0);
        model.members[0].releases.my_end = true;
        model.nodal_loads[0].fx = 100.0;
        model.nodal_loads[0].fz = 10.0;
        let mut tip = model.supports[0].clone();
        tip.node_id = 2;
        tip.ux = false;
        tip.uy = false;
        tip.uz = false;
        tip.rx = false;
        tip.ry = true;
        tip.rz = false;
        model.supports.push(tip);
        let result = solve(&model).unwrap();
        assert!(result.members[0].local_end_forces[10].abs() < 1e-8);
        assert!(
            result.diagrams.moment_y[0]
                .points
                .last()
                .unwrap()
                .value
                .abs()
                < 1e-7
        );
    }
    #[test]
    fn orphan_node_is_not_silently_constrained_as_a_release() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0);
        model.nodes.push(Node {
            id: 3,
            x: 5.0,
            y: 0.0,
            z: 0.0,
        });
        assert!(solve(&model).is_err());
    }
    #[test]
    fn unknown_release_axis_is_rejected_at_the_json_boundary() {
        let mut input =
            serde_json::to_value(cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0)).unwrap();
        input["members"][0]["releases"]["unknownAxis"] = serde_json::json!(true);
        assert!(serde_json::from_value::<Request>(input).is_err());
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
    fn free_and_restrained_thermal_expansion_match_axial_solution() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 0.0);
        model.materials[0].alpha_per_k = Some(10e-6);
        model.thermal_loads.push(ThermalLoad {
            id: 1,
            member_id: 1,
            delta_t_uniform_k: 30.0,
            delta_t_gradient_y_k: 0.0,
            delta_t_gradient_z_k: 0.0,
        });
        let free = solve(&model).unwrap();
        assert!((free.nodes[1].displacement[0] - 0.0006).abs() < 1e-12);
        assert!(free.nodes[0].reaction[0].abs() < 1e-8);
        assert!(free.members[0].local_end_forces[0].abs() < 1e-8);

        model.analysis = Analysis::PDelta;
        let second_order = solve(&model).unwrap();
        assert!((second_order.nodes[1].displacement[0] - 0.0006).abs() < 1e-12);
        assert!(second_order.nodes[0].reaction[0].abs() < 1e-8);

        model.analysis = Analysis::Linear;
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        model.supports.push(end_support);
        let restrained = solve(&model).unwrap();
        assert!((restrained.nodes[0].reaction[0] - 630.0).abs() < 1e-8);
        assert!((restrained.nodes[1].reaction[0] + 630.0).abs() < 1e-8);
    }
    #[test]
    fn uniform_thermal_steel_history_uses_mechanical_strain_and_retains_plasticity() {
        let mut model = cantilever(
            Analysis::Material,
            MaterialLaw::SteelBilinear {
                yield_mpa: 100.0,
                hardening_ratio: 0.5,
            },
            0.0,
        );
        model.materials[0].alpha_per_k = Some(10e-6);
        model.thermal_loads.push(ThermalLoad {
            id: 1,
            member_id: 1,
            delta_t_uniform_k: 100.0,
            delta_t_gradient_y_k: 0.0,
            delta_t_gradient_z_k: 0.0,
        });
        let free = solve(&model).unwrap();
        assert!((free.nodes[1].displacement[0] - 0.002).abs() < 1e-10);
        assert!(free.nodes[0].reaction[0].abs() < 1e-8);
        assert!(
            free.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .equivalent_plastic_strain
                < 1e-12
        );
        assert!((free.members[0].effective_e_mpa - 210_000.0).abs() < 1e-6);

        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        model.supports.push(end_support);
        let heated = solve(&model).unwrap();
        assert!((heated.nodes[0].reaction[0] - 1550.0).abs() < 1e-6);
        assert!((heated.nodes[1].reaction[0] + 1550.0).abs() < 1e-6);

        model.load_path = vec![1.0, 0.0];
        let cooled = solve(&model).unwrap();
        let plastic = (210.0 - 100.0) / 420_000.0;
        assert!(
            (cooled.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                + plastic)
                .abs()
                < 1e-10
        );
        assert!((cooled.nodes[0].reaction[0] + 210_000.0 * 1000.0 * 0.01 * plastic).abs() < 1e-6);
        assert!((cooled.nodes[1].reaction[0] - 210_000.0 * 1000.0 * 0.01 * plastic).abs() < 1e-6);
        assert!(cooled.equilibrium_residual < 1e-8);
        let example: Request = serde_json::from_str(include_str!(
            "../examples/frame3d-thermal-steel-unload.json"
        ))
        .unwrap();
        let example_result = solve(&example).unwrap();
        assert!((example_result.nodes[0].reaction[0] - cooled.nodes[0].reaction[0]).abs() < 1e-8);

        model.thermal_loads[0].delta_t_gradient_y_k = 1.0;
        assert!(solve(&model).unwrap_err().contains("thermal gradients"));
    }
    #[test]
    fn thermal_compression_amplifies_combined_geometric_material_sway() {
        let mut model = cantilever(Analysis::Material, MaterialLaw::Elastic, 10.0);
        model.materials[0].alpha_per_k = Some(10e-6);
        model.thermal_loads.push(ThermalLoad {
            id: 1,
            member_id: 1,
            delta_t_uniform_k: 30.0,
            delta_t_gradient_y_k: 0.0,
            delta_t_gradient_z_k: 0.0,
        });
        let mut axial_support = model.supports[0].clone();
        axial_support.node_id = 2;
        axial_support.uy = false;
        axial_support.uz = false;
        axial_support.rx = false;
        axial_support.ry = false;
        axial_support.rz = false;
        model.supports.push(axial_support);
        let first_order = solve(&model).unwrap();
        assert!((first_order.members[0].local_end_forces[6] + 630.0).abs() < 1e-6);
        model.analysis = Analysis::Combined;
        let combined = solve(&model).unwrap();
        assert!(combined.nodes[1].displacement[1] > first_order.nodes[1].displacement[1]);
        assert!(combined.equilibrium_residual < 1e-8);
    }
    #[test]
    fn restrained_cooling_retains_concrete_tensile_damage_on_reloading() {
        let mut model = cantilever(
            Analysis::Material,
            MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.2,
            },
            0.0,
        );
        model.materials[0].e_mpa = 33_000.0;
        model.materials[0].alpha_per_k = Some(10e-6);
        model.thermal_loads.push(ThermalLoad {
            id: 1,
            member_id: 1,
            delta_t_uniform_k: -30.0,
            delta_t_gradient_y_k: 0.0,
            delta_t_gradient_z_k: 0.0,
        });
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        model.supports.push(end_support);
        let cold = solve(&model).unwrap();
        assert!((cold.nodes[0].reaction[0] + 43.8).abs() < 1e-7);
        let damage = 1.0 - 4.38 / 9.9;
        assert!(
            (cold.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .tensile_damage
                - damage)
                .abs()
                < 1e-10
        );

        model.load_path = vec![1.0, 0.0, 0.5];
        let reloaded = solve(&model).unwrap();
        assert!(
            (reloaded.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .tensile_damage
                - damage)
                .abs()
                < 1e-10
        );
        assert!((reloaded.nodes[0].reaction[0] + 21.9).abs() < 1e-7);
        assert!((reloaded.nodes[1].reaction[0] - 21.9).abs() < 1e-7);
        assert!(reloaded.equilibrium_residual < 1e-8);
    }
    #[test]
    fn compression_amplifies_lateral_displacement() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0);
        model.nodal_loads[0].fx = -100.0;
        let linear = solve(&model).unwrap();
        model.analysis = Analysis::PDelta;
        let nonlinear = solve(&model).unwrap();
        assert!(nonlinear.nodes[1].displacement[1] > linear.nodes[1].displacement[1]);
        assert_eq!(linear.max_amplification, 1.0);
        assert!(nonlinear.max_amplification > 1.0);
        assert!(nonlinear.iterations > 1);
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
    fn axial_steel_and_concrete_secant_laws_match_closed_form() {
        for (law, elastic_e_mpa, load_kn, strength_mpa, post_ratio) in [
            (
                MaterialLaw::SteelBilinear {
                    yield_mpa: 100.0,
                    hardening_ratio: 0.5,
                },
                210_000.0,
                1500.0,
                100.0,
                0.5,
            ),
            (
                MaterialLaw::ConcreteCracking {
                    tensile_mpa: 3.0,
                    residual_ratio: 0.2,
                },
                33_000.0,
                60.0,
                3.0,
                0.2,
            ),
        ] {
            let mut model = cantilever(Analysis::Material, law, 0.0);
            model.materials[0].e_mpa = elastic_e_mpa;
            model.nodal_loads[0].fx = load_kn;
            let result = solve(&model).unwrap();
            let stress_mpa = load_kn / (1000.0 * model.sections[0].area_m2);
            let expected_strain = strength_mpa / elastic_e_mpa
                + (stress_mpa - strength_mpa) / (post_ratio * elastic_e_mpa);
            let expected_elongation = expected_strain * 2.0;
            assert!((result.nodes[1].displacement[0] - expected_elongation).abs() < 1e-7);
            assert!(result.members[0].effective_e_mpa < elastic_e_mpa);
            assert!(result.equilibrium_residual < 1e-7);
        }
    }
    #[test]
    fn axial_steel_load_path_retains_plastic_extension_after_unload() {
        let mut model = cantilever(
            Analysis::Material,
            MaterialLaw::SteelBilinear {
                yield_mpa: 100.0,
                hardening_ratio: 0.5,
            },
            0.0,
        );
        model.nodal_loads[0].fx = 1500.0;
        model.load_path = vec![1.0, 0.0];
        let result = solve(&model).unwrap();
        let expected_plastic_strain =
            (150.0 - 100.0) / (0.5 * 210_000.0) - (150.0 - 100.0) / 210_000.0;
        assert!((result.nodes[1].displacement[0] - 2.0 * expected_plastic_strain).abs() < 1e-9);
        let history = result.members[0].axial_history.as_ref().unwrap();
        assert!((history.plastic_strain - expected_plastic_strain).abs() < 1e-9);
        assert!((history.equivalent_plastic_strain - expected_plastic_strain).abs() < 1e-9);
        assert!(result.nodes[0].reaction[0].abs() < 1e-8);
        assert!(result.members[0].local_end_forces[6].abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-8);
    }
    #[test]
    fn axial_steel_history_with_end_release_recovers_cantilever_and_free_moment() {
        let model: Request = serde_json::from_str(include_str!(
            "../examples/frame3d-released-steel-history.json"
        ))
        .unwrap();
        let result = solve(&model).unwrap();
        let plastic_strain = (150.0 - 100.0) / (0.5 * 210_000.0) - (150.0 - 100.0) / 210_000.0;
        let expected_extension = 2.0 * (plastic_strain + 75.0 / 210_000.0);
        assert!((result.nodes[1].displacement[0] - expected_extension).abs() < 1e-8);
        let ei = result.members[0].effective_e_mpa * 1000.0 * model.sections[0].iz_m4;
        let expected_bending = 5.0 * 2.0_f64.powi(3) / (3.0 * ei);
        assert!((result.nodes[1].displacement[1] - expected_bending).abs() < 1e-8);
        assert!(
            (result.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                - plastic_strain)
                .abs()
                < 1e-8
        );
        assert!(result.members[0].local_end_forces[11].abs() < 1e-8);
        assert!(result.nodes[1].reaction[5].abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-8);
    }
    #[test]
    fn concrete_damage_with_end_release_persists_on_reload() {
        let mut model: Request = serde_json::from_str(include_str!(
            "../examples/frame3d-released-steel-history.json"
        ))
        .unwrap();
        model.materials[0].e_mpa = 33_000.0;
        model.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.2,
        };
        model.nodal_loads[0].fx = 60.0;
        let result = solve(&model).unwrap();
        let peak_strain = 3.0 / 33_000.0 + 3.0 / (0.2 * 33_000.0);
        let expected_damage = 1.0 - 6.0 / (33_000.0 * peak_strain);
        let expected_reload = 2.0 * 3.0 / ((1.0 - expected_damage) * 33_000.0);
        assert!((result.nodes[1].displacement[0] - expected_reload).abs() < 1e-8);
        assert!(
            (result.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .tensile_damage
                - expected_damage)
                .abs()
                < 1e-8
        );
        assert!(result.members[0].local_end_forces[11].abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-8);
    }
    #[test]
    fn combined_geometry_and_material_with_release_uses_reloaded_axial_force() {
        let mut model: Request = serde_json::from_str(include_str!(
            "../examples/frame3d-released-steel-history.json"
        ))
        .unwrap();
        let material = solve(&model).unwrap();
        model.analysis = Analysis::Combined;
        let combined = solve(&model).unwrap();
        assert!(combined.nodes[1].displacement[1] < material.nodes[1].displacement[1]);
        assert!((combined.members[0].local_end_forces[6] - 750.0).abs() < 1e-7);
        assert!(
            (combined.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                - material.members[0]
                    .axial_history
                    .as_ref()
                    .unwrap()
                    .plastic_strain)
                .abs()
                < 1e-8
        );
        assert!(combined.members[0].local_end_forces[11].abs() < 1e-8);
        assert!(
            combined.diagrams.moment_z[0]
                .points
                .last()
                .unwrap()
                .value
                .abs()
                < 1e-7
        );
        assert!(combined.equilibrium_residual < 1e-8);
    }
    #[test]
    fn axial_steel_imposed_movement_path_leaves_self_equilibrated_reactions() {
        let mut model = cantilever(
            Analysis::Material,
            MaterialLaw::SteelBilinear {
                yield_mpa: 100.0,
                hardening_ratio: 0.5,
            },
            0.0,
        );
        model.nodal_loads.clear();
        let mut end_support = model.supports[0].clone();
        end_support.node_id = 2;
        end_support.uy = false;
        end_support.uz = false;
        end_support.rx = false;
        end_support.ry = false;
        end_support.rz = false;
        end_support.ux_prescribed_m = Some(0.002);
        model.supports.push(end_support);
        model.load_path = vec![1.0, 0.0];
        let result = solve(&model).unwrap();
        assert!(result.nodes[1].displacement[0].abs() < 1e-12);
        let plastic_strain = result.members[0]
            .axial_history
            .as_ref()
            .unwrap()
            .plastic_strain;
        let expected_plastic_strain = (210.0 - 100.0) / 420_000.0;
        assert!((plastic_strain - expected_plastic_strain).abs() < 1e-10);
        let residual_force = 210_000.0 * 1000.0 * 0.01 * expected_plastic_strain;
        assert!((result.nodes[0].reaction[0] - residual_force).abs() < 1e-7);
        assert!((result.nodes[1].reaction[0] + residual_force).abs() < 1e-7);
    }
    #[test]
    fn axial_concrete_load_path_retains_damage_on_unload_and_reload() {
        let mut model = cantilever(
            Analysis::Material,
            MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.2,
            },
            0.0,
        );
        model.materials[0].e_mpa = 33_000.0;
        model.nodal_loads[0].fx = 60.0;
        model.load_path = vec![1.0, 0.0, 0.5];
        let result = solve(&model).unwrap();
        let history = result.members[0].axial_history.as_ref().unwrap();
        let peak_strain = 3.0 / 33_000.0 + 3.0 / (0.2 * 33_000.0);
        let expected_damage = 1.0 - 6.0 / (33_000.0 * peak_strain);
        assert!((history.tensile_damage - expected_damage).abs() < 1e-8);
        let expected_reload = 2.0 * 3.0 / ((1.0 - expected_damage) * 33_000.0);
        assert!((result.nodes[1].displacement[0] - expected_reload).abs() < 1e-8);
        assert!((result.members[0].local_end_forces[6] - 30.0).abs() < 1e-7);
        assert!((result.nodes[0].reaction[0] + 30.0).abs() < 1e-7);
        assert!(result.equilibrium_residual < 1e-8);
    }
    #[test]
    fn material_load_path_scales_member_load_diagrams_at_final_factor() {
        let mut model = cantilever(
            Analysis::Material,
            MaterialLaw::SteelBilinear {
                yield_mpa: 1000.0,
                hardening_ratio: 0.5,
            },
            0.0,
        );
        model.nodal_loads.clear();
        model.member_loads.push(MemberLoad {
            id: 1,
            member_id: 1,
            qy_start_kn_per_m: 2.0,
            qy_end_kn_per_m: 2.0,
            qz_start_kn_per_m: 0.0,
            qz_end_kn_per_m: 0.0,
            start_position_m: None,
            end_position_m: None,
        });
        model.load_path = vec![1.0, 0.0];
        let result = solve(&model).unwrap();
        assert!(result.nodes[1].displacement[1].abs() < 1e-10);
        assert!(result.diagrams.shear_y[0].max_abs_value < 1e-8);
        assert!(result.diagrams.moment_z[0].max_abs_value < 1e-8);
    }
    #[test]
    fn documented_axial_history_examples_parse_and_match_closed_form() {
        for (source, expected_displacement, expected_damage) in [
            (
                include_str!("../examples/frame-steel-axial-unload.json"),
                2.0 / 4200.0,
                0.0,
            ),
            (
                include_str!("../examples/frame-concrete-axial-reload.json"),
                6.0 / 11_000.0,
                2.0 / 3.0,
            ),
        ] {
            let request: Request = serde_json::from_str(source).unwrap();
            let result = solve(&request).unwrap();
            assert!((result.nodes[1].displacement[0] - expected_displacement).abs() < 1e-8);
            assert!(
                (result.members[0]
                    .axial_history
                    .as_ref()
                    .unwrap()
                    .tensile_damage
                    - expected_damage)
                    .abs()
                    < 1e-8
            );
        }
    }
    #[test]
    fn compression_past_stability_limit_is_rejected() {
        let mut model = cantilever(Analysis::PDelta, MaterialLaw::Elastic, 10.0);
        model.nodal_loads[0].fx = -5000.0;
        assert!(solve(&model).unwrap_err().contains("stiffness"));
    }
    #[test]
    fn invalid_thermal_load_is_rejected_and_euler_buckling_is_available() {
        let mut model = cantilever(Analysis::Linear, MaterialLaw::Elastic, 10.0);
        model.thermal_loads.push(ThermalLoad {
            id: 1,
            member_id: 1,
            delta_t_uniform_k: 0.0,
            delta_t_gradient_y_k: 0.0,
            delta_t_gradient_z_k: 0.0,
        });
        assert!(solve(&model)
            .unwrap_err()
            .contains("invalid frame thermal load"));
        model.thermal_loads[0].delta_t_uniform_k = 30.0;
        model.analysis = Analysis::Material;
        assert!((solve(&model).unwrap().nodes[1].displacement[0] - 0.00072).abs() < 1e-10);
        model.thermal_loads[0].delta_t_gradient_y_k = 1.0;
        assert!(solve(&model).unwrap_err().contains("thermal gradients"));
        model.thermal_loads.clear();
        model.analysis = Analysis::Linear;
        model.buckling_modes = 1;
        assert!(matches!(
            solve(&model).unwrap().buckling,
            BucklingSummary::NotApplicable { .. }
        ));
        model.nodal_loads[0].fx = -100.0;
        let result = solve(&model).unwrap();
        let BucklingSummary::Available { modes, members } = result.buckling else {
            panic!("compressed cantilever must have a buckling mode")
        };
        let euler = std::f64::consts::PI.powi(2) * 2100.0 / (4.0 * 2.0_f64.powi(2));
        assert!((modes[0].load_factor * 100.0 - euler).abs() / euler < 0.03);
        assert!((members[0].critical_force_kn - euler).abs() / euler < 0.03);
    }
}
