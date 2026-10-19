//! Plane-frame elements in m, kN and MPa. The plane is X/Y;
//! the 2D app maps its vertical Z coordinate and R_y rotation here explicitly.

use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::math::{constrained_solve, free_positive_definite, Matrix};
use crate::section::{equivalent_rectangular_fibers, integrate_section, FiberState};
use crate::{positive, Analysis, MaterialLaw};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: usize,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Material {
    pub id: usize,
    pub e_mpa: f64,
    #[serde(default)]
    pub law: MaterialLaw,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub id: usize,
    pub area_m2: f64,
    pub inertia_m4: f64,
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
    pub releases: EndReleases,
    #[serde(default)]
    pub springs: EndSprings,
    /// Winkler line stiffness in kN/m². Each end receives k*L/2 as a
    /// tributary global-Y spring, matching the existing FEM Studio solver.
    #[serde(default)]
    pub foundation_kn_per_m2: Option<f64>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndReleases {
    #[serde(default)]
    pub ux_start: bool,
    #[serde(default)]
    pub uy_start: bool,
    #[serde(default)]
    pub rz_start: bool,
    #[serde(default)]
    pub ux_end: bool,
    #[serde(default)]
    pub uy_end: bool,
    #[serde(default)]
    pub rz_end: bool,
}

impl EndReleases {
    fn any(self) -> bool {
        self.axes().iter().any(|(_, released)| *released)
    }

    fn axes(self) -> [(usize, bool); 6] {
        [
            (0, self.ux_start),
            (1, self.uy_start),
            (2, self.rz_start),
            (3, self.ux_end),
            (4, self.uy_end),
            (5, self.rz_end),
        ]
    }
}

/// Local connection stiffnesses between a member end and its structural node.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndSprings {
    #[serde(default)]
    pub ux_start_kn_per_m: Option<f64>,
    #[serde(default)]
    pub uy_start_kn_per_m: Option<f64>,
    #[serde(default)]
    pub rz_start_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub ux_end_kn_per_m: Option<f64>,
    #[serde(default)]
    pub uy_end_kn_per_m: Option<f64>,
    #[serde(default)]
    pub rz_end_knm_per_rad: Option<f64>,
}

impl EndSprings {
    fn axes(self) -> [Option<f64>; 6] {
        [
            self.ux_start_kn_per_m,
            self.uy_start_kn_per_m,
            self.rz_start_knm_per_rad,
            self.ux_end_kn_per_m,
            self.uy_end_kn_per_m,
            self.rz_end_knm_per_rad,
        ]
    }

    fn any(self) -> bool {
        self.axes().iter().any(Option::is_some)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub node_id: usize,
    pub ux: bool,
    pub uy: bool,
    pub rz: bool,
    #[serde(default)]
    pub kx_kn_per_m: Option<f64>,
    #[serde(default)]
    pub ky_kn_per_m: Option<f64>,
    #[serde(default)]
    pub krz_knm_per_rad: Option<f64>,
    #[serde(default)]
    pub ux_prescribed_m: Option<f64>,
    #[serde(default)]
    pub uy_prescribed_m: Option<f64>,
    #[serde(default)]
    pub rz_prescribed_rad: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NodalLoad {
    pub node_id: usize,
    pub fx: f64,
    pub fy: f64,
    pub mz: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberLoad {
    pub member_id: usize,
    pub qx_start_kn_per_m: f64,
    pub qx_end_kn_per_m: f64,
    pub qy_start_kn_per_m: f64,
    pub qy_end_kn_per_m: f64,
    #[serde(default)]
    pub start_position_m: Option<f64>,
    #[serde(default)]
    pub end_position_m: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemberPointLoad {
    pub member_id: usize,
    pub px_kn: f64,
    pub py_kn: f64,
    pub position_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThermalLoad {
    pub member_id: usize,
    pub delta_t_k: f64,
    pub alpha_per_k: f64,
    /// Temperature at local +Y minus temperature at local -Y, in kelvin.
    #[serde(default)]
    pub delta_t_gradient_k: f64,
    /// Distance between the two temperature faces, required for a gradient.
    #[serde(default)]
    pub depth_m: Option<f64>,
}

/// Conforming membrane elements that share the frame model's translational
/// node DOFs. Nodes in both meshes are addressed by the same IDs. This first
/// coupled path deliberately accepts only linear analysis; nonlinear material
/// histories need to be advanced in the same load-step loop before they can be
/// enabled here.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MembraneModel {
    #[serde(default)]
    pub materials: Vec<crate::plate2d::Material>,
    #[serde(default)]
    pub triangles: Vec<crate::plate2d::Triangle>,
    #[serde(default)]
    pub quads: Vec<crate::quad2d::Quad>,
    #[serde(default)]
    pub orthotropic_materials: Vec<crate::quad2d::OrthotropicMaterial>,
    #[serde(default)]
    pub modulus_curves: Vec<crate::quad2d::ModulusCurve>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinearBackend {
    #[default]
    Existing,
    FrontalWave,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub analysis: Analysis,
    #[serde(default)]
    pub linear_backend: LinearBackend,
    /// Maximum active free DOFs in the opt-in frontal solve (default 4096).
    #[serde(default)]
    pub frontal_max_front_dofs: Option<usize>,
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
    /// Optional conforming CST/Q4 membrane sharing this model's X/Y DOFs.
    #[serde(default)]
    pub membrane: Option<MembraneModel>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
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
    pub displacement: [f64; 3],
    pub reaction: [f64; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberResult {
    pub member_id: usize,
    /// Local nodal forces [N1, V1, M1, N2, V2, M2].
    pub local_end_forces: [f64; 6],
    pub stations_m: Vec<f64>,
    pub normal_force_kn: Vec<f64>,
    pub shear_force_kn: Vec<f64>,
    pub bending_moment_knm: Vec<f64>,
    pub deflection_m: Vec<f64>,
    pub axial_disp_m: Vec<f64>,
    pub rotation_rad: Vec<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub axial_history: Option<AxialHistory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_history: Option<SectionHistory>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AxialHistory {
    pub plastic_strain: f64,
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
    pub tangent_e_mpa: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionHistory {
    pub maximum_abs_plastic_strain: f64,
    pub maximum_equivalent_plastic_strain: f64,
    pub maximum_tensile_damage: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result2D {
    pub nodes: Vec<NodeResult>,
    pub members: Vec<MemberResult>,
    pub equilibrium_residual: f64,
    pub iterations: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frontal_maximum_front_dofs: Option<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub membrane_triangles: Vec<crate::plate2d::ElementResult>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub membrane_quads: Vec<crate::quad2d::QuadResult>,
}

#[derive(Clone)]
struct Element {
    dofs: [usize; 6],
    length: f64,
    transform: [[f64; 6]; 6],
    local_stiffness: [[f64; 6]; 6],
    local_load: [f64; 6],
    ea_kn: f64,
    ei_knm2: f64,
    area_m2: f64,
    thermal_strain: f64,
    thermal_curvature: f64,
    material: Material,
    releases: EndReleases,
    springs: EndSprings,
    raw_stiffness: Option<[[f64; 6]; 6]>,
    raw_load: Option<[f64; 6]>,
}

/// Preserve member boundaries for the wavefront solve. The opt-in linear
/// path keeps these condensed member matrices and nodal vectors, without
/// assembling a global matrix.
fn frontal_frame_elements(
    members: &[Member],
    elements: &HashMap<usize, Element>,
    springs: &[f64],
) -> Vec<FrontalElement> {
    let mut last_member = vec![None; springs.len()];
    for (index, member) in members.iter().enumerate() {
        for &dof in &elements[&member.id].dofs {
            last_member[dof] = Some(index);
        }
    }
    let mut springs_after_member = vec![Vec::new(); members.len()];
    for (dof, &stiffness) in springs.iter().enumerate() {
        if stiffness > 0.0 {
            if let Some(index) = last_member[dof] {
                springs_after_member[index].push(dof);
            }
        }
    }
    let mut result = Vec::with_capacity(members.len() + springs.len());
    for (index, member) in members.iter().enumerate() {
        let element = &elements[&member.id];
        let mut stiffness = vec![0.0; 36];
        for i in 0..6 {
            for j in 0..6 {
                stiffness[6 * i + j] = (0..6)
                    .flat_map(|a| {
                        (0..6).map(move |b| {
                            element.transform[a][i]
                                * element.local_stiffness[a][b]
                                * element.transform[b][j]
                        })
                    })
                    .sum();
            }
        }
        result.push(FrontalElement {
            dofs: element.dofs.to_vec(),
            stiffness,
        });
        for &dof in &springs_after_member[index] {
            result.push(FrontalElement {
                dofs: vec![dof],
                stiffness: vec![springs[dof]],
            });
        }
    }
    for (dof, &stiffness) in springs.iter().enumerate() {
        if stiffness > 0.0 && last_member[dof].is_none() {
            result.push(FrontalElement {
                dofs: vec![dof],
                stiffness: vec![stiffness],
            });
        }
    }
    result
}

fn shape(length: f64, position: f64) -> ([f64; 6], [f64; 6]) {
    let t = position / length;
    let axial = [1.0 - t, 0.0, 0.0, t, 0.0, 0.0];
    let transverse = [
        0.0,
        1.0 - 3.0 * t * t + 2.0 * t * t * t,
        length * (t - 2.0 * t * t + t * t * t),
        0.0,
        3.0 * t * t - 2.0 * t * t * t,
        length * (-t * t + t * t * t),
    ];
    (axial, transverse)
}

fn add_member_load(local: &mut [f64; 6], load: &MemberLoad, length: f64) -> Result<(), String> {
    let a = load.start_position_m.unwrap_or(0.0);
    let b = load.end_position_m.unwrap_or(length);
    if ![
        a,
        b,
        load.qx_start_kn_per_m,
        load.qx_end_kn_per_m,
        load.qy_start_kn_per_m,
        load.qy_end_kn_per_m,
    ]
    .iter()
    .all(|v| v.is_finite())
        || a < 0.0
        || b > length + 1e-10
        || b <= a
    {
        return Err(format!(
            "invalid distributed load on member {}",
            load.member_id
        ));
    }
    // Three-point Gauss exactly integrates a cubic Hermite shape times a
    // linearly varying pressure over any subspan.
    let abscissas = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    for (&xi, &weight) in abscissas.iter().zip(&weights) {
        let position = (a + b) / 2.0 + xi * (b - a) / 2.0;
        let fraction = (position - a) / (b - a);
        let px = load.qx_start_kn_per_m * (1.0 - fraction) + load.qx_end_kn_per_m * fraction;
        let py = load.qy_start_kn_per_m * (1.0 - fraction) + load.qy_end_kn_per_m * fraction;
        let (axial, transverse) = shape(length, position);
        for i in 0..6 {
            local[i] += (axial[i] * px + transverse[i] * py) * weight * (b - a) / 2.0;
        }
    }
    Ok(())
}

fn integrated_load(load: &MemberLoad, length: f64, x: f64, axial: bool, power: u32) -> f64 {
    let a = load.start_position_m.unwrap_or(0.0);
    let b = load.end_position_m.unwrap_or(length).min(x);
    if b <= a {
        return 0.0;
    }
    let original_end = load.end_position_m.unwrap_or(length);
    let (start, end) = if axial {
        (load.qx_start_kn_per_m, load.qx_end_kn_per_m)
    } else {
        (load.qy_start_kn_per_m, load.qy_end_kn_per_m)
    };
    let abscissas = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    let factorial = match power {
        0 | 1 => 1.0,
        2 => 2.0,
        3 => 6.0,
        _ => unreachable!(),
    };
    abscissas
        .iter()
        .zip(&weights)
        .map(|(&xi, &weight)| {
            let position = (a + b) / 2.0 + xi * (b - a) / 2.0;
            let fraction = (position - a) / (original_end - a);
            let q = start * (1.0 - fraction) + end * fraction;
            q * (x - position).powi(power as i32) / factorial * weight * (b - a) / 2.0
        })
        .sum()
}

fn local_displacement(element: &Element, u: &[f64]) -> [f64; 6] {
    std::array::from_fn(|i| {
        (0..6)
            .map(|j| element.transform[i][j] * u[element.dofs[j]])
            .sum()
    })
}

fn axial_strain(element: &Element, d: &[f64; 6]) -> f64 {
    (d[3] - d[0]) / element.length
}

fn condense_connections(element: &mut Element) -> Result<(), String> {
    if !element.releases.any() && !element.springs.any() {
        return Ok(());
    }
    element.raw_stiffness = Some(element.local_stiffness);
    element.raw_load = Some(element.local_load);
    for ((axis, released), spring) in element
        .releases
        .axes()
        .into_iter()
        .zip(element.springs.axes())
    {
        let spring = if released { None } else { spring };
        if !released && spring.is_none() {
            continue;
        }
        let k_spring = spring.unwrap_or(0.0);
        let member_stiffness = element.local_stiffness[axis][axis];
        let pivot = member_stiffness + k_spring;
        let axis_scale = element.raw_stiffness.unwrap()[axis][axis].abs();
        if !pivot.is_finite() || pivot < -axis_scale * 1e-12 {
            return Err("invalid 2D frame release condensation pivot".into());
        }
        if pivot <= axis_scale * 1e-12 {
            // A second release can remove the remaining rigid-body stiffness.
            // It is valid only when the member load is also self-equilibrated.
            if element.local_stiffness[axis]
                .iter()
                .any(|v| v.abs() > axis_scale * 1e-10)
                || element.local_load[axis].abs() > 1e-9
            {
                return Err("unbalanced load on disconnected 2D frame release".into());
            }
            element.local_stiffness[axis] = [0.0; 6];
            for row in 0..6 {
                element.local_stiffness[row][axis] = 0.0;
            }
            element.local_load[axis] = 0.0;
            continue;
        }
        let column = std::array::from_fn::<_, 6, _>(|i| element.local_stiffness[i][axis]);
        let load = element.local_load[axis];
        for i in 0..6 {
            if i == axis {
                continue;
            }
            element.local_load[i] -= column[i] * load / pivot;
            for j in 0..6 {
                if j != axis {
                    element.local_stiffness[i][j] -= column[i] * column[j] / pivot;
                }
            }
        }
        for other in 0..6 {
            if other == axis {
                continue;
            }
            element.local_stiffness[axis][other] = k_spring * column[other] / pivot;
            element.local_stiffness[other][axis] = element.local_stiffness[axis][other];
        }
        element.local_stiffness[axis][axis] = k_spring * member_stiffness / pivot;
        element.local_load[axis] = k_spring * load / pivot;
    }
    Ok(())
}

/// Recover the physical member-end displacement behind releases and springs.
fn connected_local_displacement(
    element: &Element,
    mut d: [f64; 6],
    load_factor: f64,
    geometric: bool,
    axial_override: Option<f64>,
    released_material_strain: Option<f64>,
) -> [f64; 6] {
    let nodal_displacement = d;
    let Some(mut k) = element.raw_stiffness else {
        return d;
    };
    if geometric {
        let kg = geometric_local(
            element,
            axial_override.unwrap_or_else(|| axial_force(element, &d)),
        );
        for i in 0..6 {
            for j in 0..6 {
                k[i][j] += kg[i][j];
            }
        }
    }
    let f = element.raw_load.unwrap().map(|value| value * load_factor);
    let connected: Vec<(usize, f64)> = element
        .releases
        .axes()
        .into_iter()
        .zip(element.springs.axes())
        .filter_map(|((axis, release), spring)| {
            (release || spring.is_some())
                .then_some((axis, if release { 0.0 } else { spring.unwrap_or(0.0) }))
        })
        .collect();
    let released: Vec<usize> = connected.iter().map(|(axis, _)| *axis).collect();
    // Row reduction preserves a nodal displacement as the gauge for a free
    // rigid-body motion when both ends of one local direction are released.
    let n = released.len();
    let mut a = [[0.0; 7]; 6];
    for (row, &axis) in released.iter().enumerate() {
        for (column, &other) in released.iter().enumerate() {
            a[row][column] = k[axis][other];
        }
        let spring = connected[row].1;
        a[row][row] += spring;
        a[row][n] = f[axis]
            - (0..6)
                .filter(|j| !released.contains(j))
                .map(|j| k[axis][j] * d[j])
                .sum::<f64>()
            + spring * d[axis];
    }
    let mut pivots = Vec::new();
    let mut rank = 0;
    for column in 0..n {
        let best = (rank..n)
            .max_by(|&i, &j| a[i][column].abs().total_cmp(&a[j][column].abs()))
            .unwrap();
        let magnitude = a[best][column].abs();
        let scale = (0..n).map(|row| a[row][row].abs()).fold(0.0_f64, f64::max);
        if magnitude <= scale * 1e-12 {
            continue;
        }
        a.swap(rank, best);
        for row in (rank + 1)..n {
            let factor = a[row][column] / a[rank][column];
            for col in column..=n {
                a[row][col] -= factor * a[rank][col];
            }
        }
        pivots.push(column);
        rank += 1;
    }
    for row in (0..rank).rev() {
        let column = pivots[row];
        let remainder = ((column + 1)..n)
            .map(|j| a[row][j] * d[released[j]])
            .sum::<f64>();
        d[released[column]] = (a[row][n] - remainder) / a[row][column];
    }
    if let Some(force) = axial_override {
        if !element.releases.ux_start {
            if let Some(spring) = element.springs.ux_start_kn_per_m {
                d[0] = nodal_displacement[0] + force / spring;
            }
        }
        if !element.releases.ux_end {
            if let Some(spring) = element.springs.ux_end_kn_per_m {
                d[3] = nodal_displacement[3] - force / spring;
            }
        }
    }
    if let Some(strain) = released_material_strain {
        let total_extension = (strain + load_factor * element.thermal_strain) * element.length;
        match (element.releases.ux_start, element.releases.ux_end) {
            (true, true) => {
                d[0] = nodal_displacement[0];
                d[3] = d[0] + total_extension;
            }
            (true, false) => d[0] = nodal_displacement[3] - total_extension,
            (false, true) => d[3] = nodal_displacement[0] + total_extension,
            (false, false) => {}
        }
    }
    d
}

fn axial_force(element: &Element, d: &[f64; 6]) -> f64 {
    // Average elastic axial force, tension positive.
    let left = (0..6)
        .map(|j| element.local_stiffness[0][j] * d[j])
        .sum::<f64>()
        - element.local_load[0];
    let right = (0..6)
        .map(|j| element.local_stiffness[3][j] * d[j])
        .sum::<f64>()
        - element.local_load[3];
    (right - left) / 2.0
}

fn geometric_local(element: &Element, axial: f64) -> [[f64; 6]; 6] {
    let l = element.length;
    let geometric = [
        [36.0, 3.0 * l, -36.0, 3.0 * l],
        [3.0 * l, 4.0 * l * l, -3.0 * l, -l * l],
        [-36.0, -3.0 * l, 36.0, -3.0 * l],
        [3.0 * l, -l * l, -3.0 * l, 4.0 * l * l],
    ];
    let axes = [1, 2, 4, 5];
    let mut kg = [[0.0; 6]; 6];
    for (a, &i) in axes.iter().enumerate() {
        for (b, &j) in axes.iter().enumerate() {
            kg[i][j] = axial * geometric[a][b] / (30.0 * l);
        }
    }
    kg
}

fn geometric_assembly(
    elements: &HashMap<usize, Element>,
    nodal_f: &[f64],
    springs: &[f64],
    u: &[f64],
) -> Result<(Matrix, Vec<f64>), String> {
    let mut k = Matrix::zeros(u.len())?;
    let mut f = nodal_f.to_vec();
    for element in elements.values() {
        let d = local_displacement(element, u);
        let kg = geometric_local(element, axial_force(element, &d));
        let mut assembled = element.clone();
        assembled.local_stiffness = element.raw_stiffness.unwrap_or(element.local_stiffness);
        assembled.local_load = element.raw_load.unwrap_or(element.local_load);
        for i in 0..6 {
            for j in 0..6 {
                assembled.local_stiffness[i][j] += kg[i][j];
            }
        }
        condense_connections(&mut assembled)?;
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i]
                            * assembled.local_stiffness[a][b]
                            * element.transform[b][j];
                    }
                }
                k.add(element.dofs[i], element.dofs[j], value);
            }
            for j in 0..6 {
                f[element.dofs[i]] += element.transform[j][i] * assembled.local_load[j];
            }
        }
    }
    for (dof, &spring) in springs.iter().enumerate() {
        if spring > 0.0 {
            k.add(dof, dof, spring);
        }
    }
    Ok((k, f))
}

fn geometric_coupled_solve(
    frame: &Request,
    membrane: &MembraneModel,
    elements: &HashMap<usize, Element>,
    initial_stiffness: &Matrix,
    initial_load: &[f64],
    nodal_load: &[f64],
    springs: &[f64],
    prescribed: &[Option<f64>],
) -> Result<(Vec<f64>, Vec<f64>, usize), String> {
    let membrane_states = MembraneStates::new(membrane);
    let mut displacement = constrained_solve(initial_stiffness, initial_load, prescribed)?.0;
    let mut increment_constraints = vec![None; prescribed.len()];
    for (index, value) in prescribed.iter().enumerate() {
        if value.is_some() {
            increment_constraints[index] = Some(0.0);
        }
    }
    let mut converged = false;
    let mut iterations = 0;
    for iteration in 1..=frame.max_iterations {
        let (mut tangent, external) =
            geometric_assembly(elements, nodal_load, springs, &displacement)?;
        let frame_internal = tangent.mul(&displacement);
        let (membrane_internal, membrane_tangent) = assemble_conforming_membrane(
            frame,
            membrane,
            &displacement,
            Analysis::Geometric,
            &membrane_states,
        )?;
        tangent.add_matrix(&membrane_tangent)?;
        free_positive_definite(&tangent, prescribed)?;
        let residual: Vec<f64> = external
            .iter()
            .zip(frame_internal)
            .zip(membrane_internal)
            .map(|((load, frame_force), plate_force)| load - frame_force - plate_force)
            .collect();
        if geometric_free_residual_ratio(nodal_load, &residual, prescribed)? <= frame.tolerance {
            converged = true;
            iterations = iteration;
            break;
        }
        let (increment, _) = constrained_solve(&tangent, &residual, &increment_constraints)?;
        for (value, delta) in displacement.iter_mut().zip(increment) {
            *value += delta;
        }
        iterations = iteration;
    }
    if !converged {
        return Err(format!(
            "coupled 2D frame/membrane GNL did not converge in {} iterations",
            frame.max_iterations
        ));
    }
    let (frame_tangent, external) =
        geometric_assembly(elements, nodal_load, springs, &displacement)?;
    let (membrane_internal, _) = assemble_conforming_membrane(
        frame,
        membrane,
        &displacement,
        Analysis::Geometric,
        &membrane_states,
    )?;
    let frame_internal = frame_tangent.mul(&displacement);
    let reactions = frame_internal
        .iter()
        .zip(external)
        .zip(membrane_internal)
        .map(|((frame_force, load), plate_force)| frame_force + plate_force - load)
        .collect();
    Ok((displacement, reactions, iterations))
}

fn geometric_free_residual_ratio(
    nodal_load: &[f64],
    residual: &[f64],
    prescribed: &[Option<f64>],
) -> Result<f64, String> {
    if nodal_load.len() != residual.len() || residual.len() != prescribed.len() {
        return Err("coupled 2D frame/membrane residual size mismatch".into());
    }
    let mut load_norm: f64 = 0.0;
    let mut residual_norm: f64 = 0.0;
    for ((&load, &force), constraint) in nodal_load.iter().zip(residual).zip(prescribed) {
        if !load.is_finite() || !force.is_finite() {
            return Err("non-finite coupled 2D frame/membrane residual or load".into());
        }
        if constraint.is_none() {
            load_norm = load_norm.hypot(load);
            residual_norm = residual_norm.hypot(force);
        }
    }
    if !load_norm.is_finite() || !residual_norm.is_finite() {
        return Err("coupled 2D frame/membrane residual norm exceeds finite range".into());
    }
    Ok(residual_norm / load_norm.max(1.0))
}

#[derive(Clone, Default)]
struct MembraneStates {
    triangles: Vec<crate::material2d::State>,
    quads: Vec<[crate::material2d::State; 4]>,
}

impl MembraneStates {
    fn new(membrane: &MembraneModel) -> Self {
        Self {
            triangles: vec![crate::material2d::State::default(); membrane.triangles.len()],
            quads: vec![[crate::material2d::State::default(); 4]; membrane.quads.len()],
        }
    }
}

#[derive(Clone, Copy, Default)]
struct AxialState {
    plastic_strain: f64,
    equivalent_plastic_strain: f64,
    tensile_damage: f64,
}

#[derive(Clone, Copy)]
struct AxialResponse {
    stress_mpa: f64,
    tangent_e_mpa: f64,
    state: AxialState,
}

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
            let hardening = e * hardening_ratio / (1.0 - hardening_ratio);
            let excess = trial.abs() - yield_mpa - hardening * previous.equivalent_plastic_strain;
            if excess <= 0.0 {
                return AxialResponse {
                    stress_mpa: trial,
                    tangent_e_mpa: e,
                    state: previous,
                };
            }
            let increment = excess / (e + hardening);
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
            let elastic = e * strain;
            let candidate = if elastic > tensile_mpa {
                1.0 - (tensile_mpa + residual_ratio * (elastic - tensile_mpa)) / elastic
            } else {
                0.0
            };
            let damage = previous.tensile_damage.max(candidate).clamp(0.0, 1.0);
            let growing = candidate > previous.tensile_damage + 1e-12;
            AxialResponse {
                stress_mpa: (1.0 - damage) * elastic,
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

fn axial_spring_compliance(element: &Element) -> f64 {
    let start = if element.releases.ux_start {
        0.0
    } else {
        element.springs.ux_start_kn_per_m.map_or(0.0, |k| 1.0 / k)
    };
    let end = if element.releases.ux_end {
        0.0
    } else {
        element.springs.ux_end_kn_per_m.map_or(0.0, |k| 1.0 / k)
    };
    start + end
}

/// Material response at a nodal extension with axial end springs in series.
/// The returned stress and state belong to the member material strain; spring
/// extension is removed from the imposed nodal extension by local equilibrium.
fn effective_axial_response(
    element: &Element,
    nodal_extension: f64,
    load_factor: f64,
    previous: AxialState,
) -> Result<AxialResponse, String> {
    if element.releases.ux_start || element.releases.ux_end {
        let strain = free_material_axial_strain(&element.material, previous);
        return Ok(axial_response(&element.material, strain, previous));
    }
    let target = nodal_extension - load_factor * element.thermal_strain * element.length;
    let compliance = axial_spring_compliance(element);
    let initial = target / element.length;
    if compliance == 0.0 {
        return Ok(axial_response(&element.material, initial, previous));
    }
    let residual = |strain: f64| {
        let response = axial_response(&element.material, strain, previous);
        strain * element.length + response.stress_mpa * 1000.0 * element.area_m2 * compliance
            - target
    };
    let mut span = initial.abs().max(1e-9);
    let (mut low, mut high) = (initial - span, initial + span);
    let mut bracketed = residual(low) <= 0.0 && residual(high) >= 0.0;
    for _ in 0..80 {
        if bracketed {
            break;
        }
        span *= 2.0;
        low = initial - span;
        high = initial + span;
        bracketed = residual(low) <= 0.0 && residual(high) >= 0.0;
    }
    if !bracketed {
        return Err("could not bracket axial material-spring equilibrium".into());
    }
    let tolerance = 1e-12 * element.length.max(target.abs()).max(1e-12);
    for _ in 0..100 {
        let strain = (low + high) / 2.0;
        let value = residual(strain);
        if value.abs() <= tolerance {
            return Ok(axial_response(&element.material, strain, previous));
        }
        if value < 0.0 {
            low = strain;
        } else {
            high = strain;
        }
    }
    Ok(axial_response(
        &element.material,
        (low + high) / 2.0,
        previous,
    ))
}

fn free_material_axial_strain(material: &Material, state: AxialState) -> f64 {
    match material.law {
        MaterialLaw::SteelBilinear { .. } => state.plastic_strain,
        MaterialLaw::Elastic | MaterialLaw::ConcreteCracking { .. } => 0.0,
    }
}

fn axial_tangent_with_springs(element: &Element, tangent_e_mpa: f64) -> f64 {
    if element.releases.ux_start || element.releases.ux_end {
        return 0.0;
    }
    let material_ea = tangent_e_mpa * 1000.0 * element.area_m2;
    let compliance = axial_spring_compliance(element);
    if material_ea <= 0.0 {
        return 0.0;
    }
    1.0 / (element.length / material_ea + compliance)
}

#[derive(Clone, Copy)]
struct NonlinearSectionCorrection {
    tangent: [[f64; 6]; 6],
    internal: [f64; 6],
    trial_states: [[FiberState; 3]; 2],
    axial_force_kn: f64,
}

/// Return tangent K and internal force for a trial displacement. Material
/// state is only committed after a load increment reaches equilibrium.
fn material_system(
    elements: &HashMap<usize, Element>,
    u: &[f64],
    states: &HashMap<usize, AxialState>,
    section_states: &HashMap<usize, [[FiberState; 3]; 2]>,
    springs: &[f64],
    geometric: bool,
    load_factor: f64,
    membrane: Option<(&Request, &MembraneModel, &MembraneStates)>,
) -> Result<
    (
        Matrix,
        Vec<f64>,
        Vec<f64>,
        HashMap<usize, [[FiberState; 3]; 2]>,
    ),
    String,
> {
    let mut tangent = Matrix::zeros(u.len())?;
    let mut member_load = vec![0.0; u.len()];
    let mut axial_correction = vec![0.0; u.len()];
    let mut section_force_correction = vec![0.0; u.len()];
    let mut section_tangent_corrections = Vec::with_capacity(elements.len());
    let mut trial_section_states = HashMap::with_capacity(elements.len());
    let mut tangent_corrections = Vec::with_capacity(elements.len());
    for (&id, element) in elements {
        let mut d = local_displacement(element, u);
        let response = effective_axial_response(element, d[3] - d[0], load_factor, states[&id])?;
        let section_active = uses_fiber_section(element);
        let recovered_connection = has_nonlinear_connection(element);
        let joint_local = d;
        let section_correction = if section_active && recovered_connection {
            let (recovered, correction) = recover_section_connection_dofs(
                element,
                d,
                load_factor,
                &section_states[&id],
                geometric,
            )?;
            d = recovered;
            trial_section_states.insert(id, correction.trial_states);
            Some(correction)
        } else if section_active {
            let previous = section_states[&id];
            let correction = section_material_correction(element, &d, load_factor, &previous)?;
            trial_section_states.insert(id, correction.trial_states);
            Some(correction)
        } else {
            None
        };
        let n = section_correction
            .as_ref()
            .map(|correction| correction.axial_force_kn)
            .unwrap_or(response.stress_mpa * 1000.0 * element.area_m2);
        let mut assembled = element.clone();
        assembled.local_stiffness = element.raw_stiffness.unwrap_or(element.local_stiffness);
        assembled.local_load = element.raw_load.unwrap_or(element.local_load);
        if geometric {
            let kg = geometric_local(element, n);
            for i in 0..6 {
                for j in 0..6 {
                    assembled.local_stiffness[i][j] += kg[i][j];
                }
            }
        }
        let mut recovered_section_force = None;
        if let Some(correction) = &section_correction {
            if recovered_connection {
                let base_internal = local_product_2d(&assembled.local_stiffness, &d);
                let section_internal: [f64; 6] =
                    std::array::from_fn(|i| base_internal[i] + correction.internal[i]);
                for i in 0..6 {
                    for j in 0..6 {
                        assembled.local_stiffness[i][j] += correction.tangent[i][j];
                    }
                }
                recovered_section_force = Some((section_internal, joint_local));
            } else {
                section_tangent_corrections.push((element, correction.tangent));
                for i in 0..6 {
                    section_force_correction[element.dofs[i]] += (0..6)
                        .map(|j| element.transform[j][i] * correction.internal[j])
                        .sum::<f64>();
                }
            }
        }
        condense_connections(&mut assembled)?;
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i]
                            * assembled.local_stiffness[a][b]
                            * element.transform[b][j];
                    }
                }
                tangent.add(element.dofs[i], element.dofs[j], value);
            }
            for j in 0..6 {
                member_load[element.dofs[i]] += element.transform[j][i] * assembled.local_load[j];
            }
        }
        if let Some((physical_internal, joint)) = recovered_section_force {
            let condensed_internal = local_product_2d(&assembled.local_stiffness, &joint);
            let raw_load = element.raw_load.unwrap_or(element.local_load);
            for i in 0..6 {
                let offset =
                    physical_internal[i] - load_factor * raw_load[i] - condensed_internal[i]
                        + load_factor * assembled.local_load[i];
                section_force_correction[element.dofs[i]] += (0..6)
                    .map(|j| element.transform[j][i] * offset)
                    .sum::<f64>();
            }
        }
        let elastic_k = axial_tangent_with_springs(element, element.material.e_mpa);
        let elastic_n =
            elastic_k * (d[3] - d[0] - load_factor * element.thermal_strain * element.length);
        if !section_active {
            let correction = n - elastic_n;
            for (axis, sign) in [(0, -1.0), (3, 1.0)] {
                for i in 0..6 {
                    axial_correction[element.dofs[i]] +=
                        sign * correction * element.transform[axis][i];
                }
            }
            let delta_axial =
                axial_tangent_with_springs(element, response.tangent_e_mpa) - elastic_k;
            tangent_corrections.push((element, delta_axial));
        }
    }
    for (dof, &spring) in springs.iter().enumerate() {
        if spring > 0.0 {
            tangent.add(dof, dof, spring);
        }
    }
    let mut internal = tangent.mul(u);
    let membrane_internal = if let Some((frame, membrane, states)) = membrane {
        let (internal, membrane_tangent) = assemble_conforming_membrane(
            frame,
            membrane,
            u,
            if geometric {
                Analysis::Combined
            } else {
                Analysis::Material
            },
            states,
        )?;
        tangent.add_matrix(&membrane_tangent)?;
        internal
    } else {
        vec![0.0; u.len()]
    };
    for (((force, correction), section_correction), membrane_force) in internal
        .iter_mut()
        .zip(&axial_correction)
        .zip(&section_force_correction)
        .zip(&membrane_internal)
    {
        *force += correction;
        *force += section_correction;
        *force += membrane_force;
    }
    for (element, delta_axial) in tangent_corrections {
        for (row, row_sign) in [(0, 1.0), (3, -1.0)] {
            for (col, col_sign) in [(0, 1.0), (3, -1.0)] {
                let value = row_sign * col_sign * delta_axial;
                for i in 0..6 {
                    for j in 0..6 {
                        tangent.add(
                            element.dofs[i],
                            element.dofs[j],
                            element.transform[row][i] * value * element.transform[col][j],
                        );
                    }
                }
            }
        }
    }
    for (element, delta_k) in section_tangent_corrections {
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i] * delta_k[a][b] * element.transform[b][j];
                    }
                }
                tangent.add(element.dofs[i], element.dofs[j], value);
            }
        }
    }
    Ok((tangent, internal, member_load, trial_section_states))
}

fn section_material_correction(
    element: &Element,
    d: &[f64; 6],
    load_factor: f64,
    previous: &[[FiberState; 3]; 2],
) -> Result<NonlinearSectionCorrection, String> {
    let fibers = equivalent_rectangular_fibers(
        element.area_m2,
        element.ei_knm2 / (element.material.e_mpa * 1000.0),
    )?;
    let mut delta_k = [[0.0; 6]; 6];
    let mut delta_r = [0.0; 6];
    let mut trial_states = *previous;
    let axial_strain = (d[3] - d[0]) / element.length - load_factor * element.thermal_strain;
    let elastic_ea = element.material.e_mpa * 1000.0 * element.area_m2;
    let elastic_ei = element.ei_knm2;
    let gauss = [0.5 - 0.5 / 3.0_f64.sqrt(), 0.5 + 0.5 / 3.0_f64.sqrt()];
    let axial_b = [
        -1.0 / element.length,
        0.0,
        0.0,
        1.0 / element.length,
        0.0,
        0.0,
    ];
    let mut axial_force = 0.0;
    for (point, xi) in gauss.into_iter().enumerate() {
        let length = element.length;
        let b = [
            0.0,
            (-6.0 + 12.0 * xi) / length.powi(2),
            (-4.0 + 6.0 * xi) / length,
            0.0,
            (6.0 - 12.0 * xi) / length.powi(2),
            (-2.0 + 6.0 * xi) / length,
        ];
        let curvature = b.iter().zip(d).map(|(bi, di)| bi * di).sum::<f64>()
            - load_factor * element.thermal_curvature;
        let section = integrate_section(
            element.material.e_mpa,
            element.material.law,
            &fibers,
            axial_strain,
            curvature,
            &previous[point],
        )?;
        trial_states[point].copy_from_slice(&section.trial_states);
        let scale = length / 2.0;
        let axial_delta = section.axial_kn - elastic_ea * axial_strain;
        let moment_delta = section.moment_kn_m - elastic_ei * curvature;
        axial_force += section.axial_kn / 2.0;
        for i in 0..6 {
            delta_r[i] += (axial_b[i] * axial_delta + b[i] * moment_delta) * scale;
            for j in 0..6 {
                delta_k[i][j] += scale
                    * (axial_b[i] * (section.tangent[0][0] - elastic_ea) * axial_b[j]
                        + axial_b[i] * section.tangent[0][1] * b[j]
                        + b[i] * section.tangent[1][0] * axial_b[j]
                        + b[i] * (section.tangent[1][1] - elastic_ei) * b[j]);
            }
        }
    }
    Ok(NonlinearSectionCorrection {
        tangent: delta_k,
        internal: delta_r,
        trial_states,
        axial_force_kn: axial_force,
    })
}

fn uses_fiber_section(element: &Element) -> bool {
    !matches!(element.material.law, MaterialLaw::Elastic)
}

fn has_nonlinear_connection(element: &Element) -> bool {
    element.releases.ux_start
        || element.releases.ux_end
        || element.releases.uy_start
        || element.releases.uy_end
        || element.releases.rz_start
        || element.releases.rz_end
        || element.springs.ux_start_kn_per_m.is_some()
        || element.springs.ux_end_kn_per_m.is_some()
        || element.springs.uy_start_kn_per_m.is_some()
        || element.springs.uy_end_kn_per_m.is_some()
        || element.springs.rz_start_knm_per_rad.is_some()
        || element.springs.rz_end_knm_per_rad.is_some()
}

fn local_product_2d(matrix: &[[f64; 6]; 6], vector: &[f64; 6]) -> [f64; 6] {
    std::array::from_fn(|row| (0..6).map(|col| matrix[row][col] * vector[col]).sum())
}

/// Recover member-side end DOFs behind releases and springs. The joint DOFs
/// remain in the frame; the local member-side DOFs are eliminated by static
/// condensation afterward.
fn recover_section_connection_dofs(
    element: &Element,
    mut local: [f64; 6],
    load_factor: f64,
    previous: &[[FiberState; 3]; 2],
    geometric: bool,
) -> Result<([f64; 6], NonlinearSectionCorrection), String> {
    let joint = local;
    let connected: Vec<(usize, f64)> = element
        .releases
        .axes()
        .into_iter()
        .zip(element.springs.axes())
        .map(|((dof, released), spring)| (dof, released, spring))
        .filter_map(|(dof, released, spring)| {
            (released || spring.is_some()).then_some((dof, if released { 0.0 } else { spring? }))
        })
        .collect();
    let connected_dofs: Vec<usize> = connected.iter().map(|(dof, _)| *dof).collect();
    let base_stiffness = element.raw_stiffness.unwrap_or(element.local_stiffness);
    let raw_load = element.raw_load.unwrap_or(element.local_load);
    let mut last_residual = [0.0; 6];

    for _ in 0..20 {
        let response = section_material_correction(element, &local, load_factor, previous)?;
        let mut base = base_stiffness;
        if geometric {
            let kg = geometric_local(element, response.axial_force_kn);
            for i in 0..6 {
                for j in 0..6 {
                    base[i][j] += kg[i][j];
                }
            }
        }
        let mut tangent = base;
        for i in 0..6 {
            for j in 0..6 {
                tangent[i][j] += response.tangent[i][j];
            }
        }
        for &(dof, spring) in &connected {
            tangent[dof][dof] += spring;
        }
        let base_internal = local_product_2d(&base, &local);
        let residual: [f64; 6] = std::array::from_fn(|dof| {
            base_internal[dof] + response.internal[dof] - load_factor * raw_load[dof]
                + connected
                    .iter()
                    .find(|(connected_dof, _)| *connected_dof == dof)
                    .map(|(_, spring)| spring * (local[dof] - joint[dof]))
                    .unwrap_or(0.0)
        });
        last_residual = residual;
        let scale = 1.0
            + connected_dofs
                .iter()
                .map(|&dof| (load_factor * raw_load[dof]).abs())
                .sum::<f64>()
            + connected
                .iter()
                .map(|(dof, spring)| spring * joint[*dof].abs())
                .sum::<f64>();
        if connected_dofs
            .iter()
            .all(|&dof| residual[dof].abs() <= 1e-9 * scale)
        {
            return Ok((local, response));
        }

        let mut reduced = Matrix::zeros(connected_dofs.len())?;
        for (row, &dof) in connected_dofs.iter().enumerate() {
            for (col, &other) in connected_dofs.iter().enumerate() {
                reduced.add(row, col, tangent[dof][other]);
            }
        }
        let rhs: Vec<f64> = connected_dofs.iter().map(|&dof| -residual[dof]).collect();
        let increment = constrained_solve(&reduced, &rhs, &vec![None; connected_dofs.len()])?.0;
        let residual_norm = connected_dofs
            .iter()
            .map(|&dof| residual[dof] * residual[dof])
            .sum::<f64>()
            .sqrt();
        let mut step = 1.0;
        let mut accepted = false;
        for _ in 0..16 {
            let mut candidate = local;
            for (index, &dof) in connected_dofs.iter().enumerate() {
                candidate[dof] += step * increment[index];
            }
            let candidate_response =
                section_material_correction(element, &candidate, load_factor, previous)?;
            let mut candidate_base = base_stiffness;
            if geometric {
                let kg = geometric_local(element, candidate_response.axial_force_kn);
                for i in 0..6 {
                    for j in 0..6 {
                        candidate_base[i][j] += kg[i][j];
                    }
                }
            }
            let candidate_internal = local_product_2d(&candidate_base, &candidate);
            let candidate_residual: [f64; 6] = std::array::from_fn(|dof| {
                candidate_internal[dof] + candidate_response.internal[dof]
                    - load_factor * raw_load[dof]
                    + connected
                        .iter()
                        .find(|(connected_dof, _)| *connected_dof == dof)
                        .map(|(_, spring)| spring * (candidate[dof] - joint[dof]))
                        .unwrap_or(0.0)
            });
            let candidate_norm = connected_dofs
                .iter()
                .map(|&dof| candidate_residual[dof] * candidate_residual[dof])
                .sum::<f64>()
                .sqrt();
            if candidate_norm < residual_norm * (1.0 - 1e-4 * step)
                || candidate_norm <= 1e-9 * scale
            {
                local = candidate;
                accepted = true;
                break;
            }
            step *= 0.5;
        }
        if !accepted {
            return Err(format!(
                "2D connected section line search stalled; end-connection residuals {:?}",
                connected_dofs
                    .iter()
                    .map(|&dof| residual[dof])
                    .collect::<Vec<_>>()
            ));
        }
    }
    Err(format!(
        "2D connected section DOFs did not converge; end-connection residuals {:?}",
        connected_dofs
            .iter()
            .map(|&dof| last_residual[dof])
            .collect::<Vec<_>>()
    ))
}

#[derive(Clone)]
struct ExpandedSegment {
    member_id: usize,
    start_position_m: f64,
    end_position_m: f64,
}

struct ExpandedMember {
    segments: Vec<ExpandedSegment>,
}

/// The nonlinear axial law is integrated independently on the two sides of
/// an interior axial point load. Create hidden frame nodes/elements here so
/// callers can submit the same unsplit member they model in the app.
pub fn solve(request: &Request) -> Result<Result2D, String> {
    if request.linear_backend == LinearBackend::FrontalWave {
        if request.analysis != Analysis::Linear {
            return Err("2D frontalWave backend requires linear analysis".into());
        }
        if request.membrane.is_some() {
            return Err("2D frontalWave backend does not support coupled membranes".into());
        }
    }
    if !request.analysis.material() || request.member_point_loads.is_empty() {
        return solve_single(request);
    }
    let (expanded_request, expanded_members, hidden_nodes) = expand_material_point_loads(request)?;
    if expanded_members.is_empty() {
        return solve_single(request);
    }
    let mut result = solve_single(&expanded_request)?;
    merge_expanded_members(request, expanded_members, hidden_nodes, &mut result)?;
    Ok(result)
}

fn expand_material_point_loads(
    request: &Request,
) -> Result<(Request, HashMap<usize, ExpandedMember>, HashSet<usize>), String> {
    let node_by_id: HashMap<usize, &Node> =
        request.nodes.iter().map(|node| (node.id, node)).collect();
    let member_by_id: HashMap<usize, &Member> = request
        .members
        .iter()
        .map(|member| (member.id, member))
        .collect();
    let mut lengths = HashMap::new();
    let mut split_members = HashSet::new();
    for load in &request.member_point_loads {
        let member = *member_by_id
            .get(&load.member_id)
            .ok_or("unknown point-loaded member")?;
        let start = *node_by_id
            .get(&member.start_node_id)
            .ok_or("unknown start node")?;
        let end = *node_by_id
            .get(&member.end_node_id)
            .ok_or("unknown end node")?;
        let length = (end.x - start.x).hypot(end.y - start.y);
        positive(length, "member length")?;
        lengths.insert(member.id, length);
        if ![load.position_m, load.px_kn, load.py_kn]
            .iter()
            .all(|value| value.is_finite())
            || load.position_m < 0.0
            || load.position_m > length
        {
            return Err("invalid 2D member point load".into());
        }
        // Keep the split even when a combination scales this case to zero.
        // Every combination must expose the same stations for superposition.
        if load.position_m > 0.0 && load.position_m < length {
            split_members.insert(member.id);
        }
    }
    if split_members.is_empty() {
        return Ok((request.clone(), HashMap::new(), HashSet::new()));
    }

    let mut expanded = request.clone();
    let mut used_node_ids: HashSet<usize> = request.nodes.iter().map(|node| node.id).collect();
    let mut used_member_ids: HashSet<usize> =
        request.members.iter().map(|member| member.id).collect();
    let mut next_node_id = used_node_ids.iter().copied().max().unwrap_or(0);
    let mut next_member_id = used_member_ids.iter().copied().max().unwrap_or(0);
    let mut hidden_nodes = HashSet::new();
    let mut expanded_members = HashMap::new();
    let mut new_nodes = Vec::new();
    let mut new_nodal_loads = Vec::new();
    let mut new_members = Vec::new();
    let mut new_member_loads = Vec::new();
    let mut new_thermal_loads = Vec::new();
    let mut removed_point_load_members = HashSet::new();

    let allocate_id =
        |used: &mut HashSet<usize>, next: &mut usize, what: &str| -> Result<usize, String> {
            loop {
                *next = next
                    .checked_add(1)
                    .ok_or_else(|| format!("no 2D frame {what} ids remain"))?;
                if used.insert(*next) {
                    return Ok(*next);
                }
            }
        };

    for member in request
        .members
        .iter()
        .filter(|member| split_members.contains(&member.id))
    {
        let length = lengths[&member.id];
        let start = node_by_id[&member.start_node_id];
        let end = node_by_id[&member.end_node_id];
        let dx = (end.x - start.x) / length;
        let dy = (end.y - start.y) / length;
        let mut positions: Vec<f64> = request
            .member_point_loads
            .iter()
            .filter(|load| {
                load.member_id == member.id && load.position_m > 0.0 && load.position_m < length
            })
            .map(|load| load.position_m)
            .collect();
        positions.sort_by(f64::total_cmp);
        positions.dedup_by(|a, b| (*a - *b).abs() <= 1e-10);

        let mut position_nodes = Vec::with_capacity(positions.len() + 2);
        position_nodes.push((0.0, member.start_node_id));
        for position in &positions {
            let node_id = allocate_id(&mut used_node_ids, &mut next_node_id, "node")?;
            hidden_nodes.insert(node_id);
            position_nodes.push((*position, node_id));
            new_nodes.push(Node {
                id: node_id,
                x: start.x + dx * position,
                y: start.y + dy * position,
            });
        }
        position_nodes.push((length, member.end_node_id));

        let mut segment_mappings = Vec::with_capacity(position_nodes.len() - 1);
        for (index, pair) in position_nodes.windows(2).enumerate() {
            let (segment_start, start_node_id) = pair[0];
            let (segment_end, end_node_id) = pair[1];
            let segment_id = if index == 0 {
                member.id
            } else {
                allocate_id(&mut used_member_ids, &mut next_member_id, "member")?
            };
            let mut child = member.clone();
            child.id = segment_id;
            child.start_node_id = start_node_id;
            child.end_node_id = end_node_id;
            if index > 0 {
                child.releases.ux_start = false;
                child.releases.uy_start = false;
                child.releases.rz_start = false;
                child.springs.ux_start_kn_per_m = None;
                child.springs.uy_start_kn_per_m = None;
                child.springs.rz_start_knm_per_rad = None;
            }
            if index + 1 < position_nodes.len() - 1 {
                child.releases.ux_end = false;
                child.releases.uy_end = false;
                child.releases.rz_end = false;
                child.springs.ux_end_kn_per_m = None;
                child.springs.uy_end_kn_per_m = None;
                child.springs.rz_end_knm_per_rad = None;
            }
            new_members.push(child);
            segment_mappings.push(ExpandedSegment {
                member_id: segment_id,
                start_position_m: segment_start,
                end_position_m: segment_end,
            });
        }
        expanded_members.insert(
            member.id,
            ExpandedMember {
                segments: segment_mappings.clone(),
            },
        );
        removed_point_load_members.insert(member.id);

        // Transfer concentrated member loads to their exactly coincident new
        // nodes, preserving local-to-global directions for skew members.
        for load in request
            .member_point_loads
            .iter()
            .filter(|load| load.member_id == member.id)
        {
            let node_id = if load.position_m == 0.0 {
                member.start_node_id
            } else if load.position_m == length {
                member.end_node_id
            } else {
                position_nodes
                    .iter()
                    .find(|(position, _)| (*position - load.position_m).abs() <= 1e-10)
                    .ok_or("could not locate split point-load node")?
                    .1
            };
            new_nodal_loads.push(NodalLoad {
                node_id,
                fx: dx * load.px_kn - dy * load.py_kn,
                fy: dy * load.px_kn + dx * load.py_kn,
                mz: 0.0,
            });
        }

        for load in request
            .member_loads
            .iter()
            .filter(|load| load.member_id == member.id)
        {
            let a = load.start_position_m.unwrap_or(0.0);
            let b = load.end_position_m.unwrap_or(length);
            if ![
                a,
                b,
                load.qx_start_kn_per_m,
                load.qx_end_kn_per_m,
                load.qy_start_kn_per_m,
                load.qy_end_kn_per_m,
            ]
            .iter()
            .all(|value| value.is_finite())
                || a < 0.0
                || b > length
                || b <= a
            {
                return Err(format!("invalid distributed load on member {}", member.id));
            }
            for segment in &segment_mappings {
                let clipped_start = a.max(segment.start_position_m);
                let clipped_end = b.min(segment.end_position_m);
                if clipped_end <= clipped_start {
                    continue;
                }
                let value_at = |x: f64, start: f64, end: f64| {
                    let fraction = (x - a) / (b - a);
                    start * (1.0 - fraction) + end * fraction
                };
                new_member_loads.push(MemberLoad {
                    member_id: segment.member_id,
                    qx_start_kn_per_m: value_at(
                        clipped_start,
                        load.qx_start_kn_per_m,
                        load.qx_end_kn_per_m,
                    ),
                    qx_end_kn_per_m: value_at(
                        clipped_end,
                        load.qx_start_kn_per_m,
                        load.qx_end_kn_per_m,
                    ),
                    qy_start_kn_per_m: value_at(
                        clipped_start,
                        load.qy_start_kn_per_m,
                        load.qy_end_kn_per_m,
                    ),
                    qy_end_kn_per_m: value_at(
                        clipped_end,
                        load.qy_start_kn_per_m,
                        load.qy_end_kn_per_m,
                    ),
                    start_position_m: Some(clipped_start - segment.start_position_m),
                    end_position_m: Some(clipped_end - segment.start_position_m),
                });
            }
        }
        for load in request
            .thermal_loads
            .iter()
            .filter(|load| load.member_id == member.id)
        {
            for segment in &segment_mappings {
                let mut child = load.clone();
                child.member_id = segment.member_id;
                new_thermal_loads.push(child);
            }
        }
    }

    expanded.nodes.extend(new_nodes);
    expanded.members = request
        .members
        .iter()
        .filter(|member| !split_members.contains(&member.id))
        .cloned()
        .chain(new_members)
        .collect();
    expanded.nodal_loads.extend(new_nodal_loads);
    expanded.member_loads = request
        .member_loads
        .iter()
        .filter(|load| !split_members.contains(&load.member_id))
        .cloned()
        .chain(new_member_loads)
        .collect();
    expanded.thermal_loads = request
        .thermal_loads
        .iter()
        .filter(|load| !split_members.contains(&load.member_id))
        .cloned()
        .chain(new_thermal_loads)
        .collect();
    expanded
        .member_point_loads
        .retain(|load| !removed_point_load_members.contains(&load.member_id));
    Ok((expanded, expanded_members, hidden_nodes))
}

fn merge_expanded_members(
    original: &Request,
    expanded_members: HashMap<usize, ExpandedMember>,
    hidden_nodes: HashSet<usize>,
    result: &mut Result2D,
) -> Result<(), String> {
    let expanded_results: HashMap<usize, MemberResult> = result
        .members
        .drain(..)
        .map(|member| (member.member_id, member))
        .collect();
    let mut merged = Vec::with_capacity(original.members.len());
    for original_member in &original.members {
        let Some(expanded_member) = expanded_members.get(&original_member.id) else {
            if let Some(member) = expanded_results.get(&original_member.id) {
                merged.push(member.clone());
            }
            continue;
        };
        let mut pieces = Vec::with_capacity(expanded_member.segments.len());
        for segment in &expanded_member.segments {
            let piece = expanded_results
                .get(&segment.member_id)
                .ok_or("missing solved 2D frame segment")?;
            pieces.push((segment, piece));
        }
        let first = pieces.first().ok_or("empty split 2D frame member")?.1;
        let last = pieces.last().unwrap().1;
        let mut local_end_forces = [0.0; 6];
        local_end_forces[..3].copy_from_slice(&first.local_end_forces[..3]);
        local_end_forces[3..].copy_from_slice(&last.local_end_forces[3..]);
        let mut stations_m = Vec::new();
        let mut normal_force_kn = Vec::new();
        let mut shear_force_kn = Vec::new();
        let mut bending_moment_knm = Vec::new();
        let mut deflection_m = Vec::new();
        let mut axial_disp_m = Vec::new();
        let mut rotation_rad = Vec::new();
        let mut histories = Vec::new();
        let mut section_histories = Vec::new();
        for (segment, piece) in pieces {
            for index in 0..piece.stations_m.len() {
                stations_m.push(segment.start_position_m + piece.stations_m[index]);
                normal_force_kn.push(piece.normal_force_kn[index]);
                shear_force_kn.push(piece.shear_force_kn[index]);
                bending_moment_knm.push(piece.bending_moment_knm[index]);
                deflection_m.push(piece.deflection_m[index]);
                axial_disp_m.push(piece.axial_disp_m[index]);
                rotation_rad.push(piece.rotation_rad[index]);
            }
            if let Some(history) = &piece.axial_history {
                histories.push(history.clone());
            }
            if let Some(history) = &piece.section_history {
                section_histories.push(history.clone());
            }
        }
        let axial_history = histories.into_iter().max_by(|a, b| {
            a.equivalent_plastic_strain
                .total_cmp(&b.equivalent_plastic_strain)
        });
        let section_history = section_histories.into_iter().reduce(|mut worst, current| {
            worst.maximum_abs_plastic_strain = worst
                .maximum_abs_plastic_strain
                .max(current.maximum_abs_plastic_strain);
            worst.maximum_equivalent_plastic_strain = worst
                .maximum_equivalent_plastic_strain
                .max(current.maximum_equivalent_plastic_strain);
            worst.maximum_tensile_damage = worst
                .maximum_tensile_damage
                .max(current.maximum_tensile_damage);
            worst
        });
        merged.push(MemberResult {
            member_id: original_member.id,
            local_end_forces,
            stations_m,
            normal_force_kn,
            shear_force_kn,
            bending_moment_knm,
            deflection_m,
            axial_disp_m,
            rotation_rad,
            axial_history,
            section_history,
        });
    }
    result
        .nodes
        .retain(|node| !hidden_nodes.contains(&node.node_id));
    result.members = merged;
    Ok(())
}

fn solve_single(request: &Request) -> Result<Result2D, String> {
    if request.max_iterations == 0
        || request.max_iterations > 1000
        || !request.tolerance.is_finite()
        || request.tolerance <= 0.0
        || request.tolerance >= 1.0
    {
        return Err("invalid 2D frame iteration limit or tolerance".into());
    }
    if request.nodes.len() < 2 || request.members.is_empty() {
        return Err("2D frame requires nodes and members".into());
    }
    if !request.load_path.is_empty() {
        if !request.analysis.material()
            || request.load_path.len() > 100
            || request.load_path.iter().any(|factor| !factor.is_finite())
        {
            return Err("invalid 2D frame material load path".into());
        }
    }
    let mut node_index = HashMap::new();
    for (index, node) in request.nodes.iter().enumerate() {
        if node.id == 0
            || !node.x.is_finite()
            || !node.y.is_finite()
            || node_index.insert(node.id, index).is_some()
        {
            return Err("invalid or duplicate 2D frame node".into());
        }
    }
    let mut materials = HashMap::new();
    for material in &request.materials {
        positive(material.e_mpa, "E")?;
        match material.law {
            MaterialLaw::Elastic => {}
            MaterialLaw::SteelBilinear {
                yield_mpa,
                hardening_ratio,
            } => {
                positive(yield_mpa, "steel yield")?;
                if !hardening_ratio.is_finite() || !(0.0..=1.0).contains(&hardening_ratio) {
                    return Err("invalid steel hardening ratio".into());
                }
            }
            MaterialLaw::ConcreteCracking {
                tensile_mpa,
                residual_ratio,
            } => {
                positive(tensile_mpa, "concrete tensile strength")?;
                if !residual_ratio.is_finite() || !(0.0..=1.0).contains(&residual_ratio) {
                    return Err("invalid concrete residual ratio".into());
                }
            }
        }
        if material.id == 0 || materials.insert(material.id, material).is_some() {
            return Err("invalid or duplicate 2D frame material".into());
        }
    }
    let mut sections = HashMap::new();
    for section in &request.sections {
        positive(section.area_m2, "area")?;
        positive(section.inertia_m4, "inertia")?;
        if section.id == 0 || sections.insert(section.id, section).is_some() {
            return Err("invalid or duplicate 2D frame section".into());
        }
    }
    let total_dofs = 3 * request.nodes.len();
    let frontal_linear = request.linear_backend == LinearBackend::FrontalWave;
    // The frontal path assembles only member matrices and nodal vectors. In
    // particular it must not inherit Matrix's 20,000-DOF global limit.
    let mut k = if frontal_linear {
        None
    } else {
        Some(Matrix::zeros(total_dofs)?)
    };
    let mut f = vec![0.0; total_dofs];
    let mut elements = HashMap::new();
    let mut member_ids = HashSet::new();
    let mut released_rotations = vec![false; total_dofs];
    let mut assembled_nonzero_rows = vec![false; total_dofs];
    for member in &request.members {
        if member.id == 0 || !member_ids.insert(member.id) {
            return Err("invalid or duplicate 2D frame member".into());
        }
        if member
            .foundation_kn_per_m2
            .is_some_and(|value| !value.is_finite() || value <= 0.0)
        {
            return Err("invalid 2D frame foundation line stiffness".into());
        }
        if member
            .springs
            .axes()
            .iter()
            .flatten()
            .any(|value| !value.is_finite() || *value <= 0.0)
        {
            return Err("invalid 2D frame connection spring stiffness".into());
        }
        let start = *node_index
            .get(&member.start_node_id)
            .ok_or("unknown start node")?;
        let end = *node_index
            .get(&member.end_node_id)
            .ok_or("unknown end node")?;
        let material = materials
            .get(&member.material_id)
            .ok_or("unknown member material")?;
        let section = sections
            .get(&member.section_id)
            .ok_or("unknown member section")?;
        let dx = request.nodes[end].x - request.nodes[start].x;
        let dy = request.nodes[end].y - request.nodes[start].y;
        let length = dx.hypot(dy);
        positive(length, "member length")?;
        let c = dx / length;
        let s = dy / length;
        let mut transform = [[0.0; 6]; 6];
        for offset in [0, 3] {
            transform[offset][offset] = c;
            transform[offset][offset + 1] = s;
            transform[offset + 1][offset] = -s;
            transform[offset + 1][offset + 1] = c;
            transform[offset + 2][offset + 2] = 1.0;
        }
        let ea_l = material.e_mpa * 1000.0 * section.area_m2 / length;
        let ei_l3 = material.e_mpa * 1000.0 * section.inertia_m4 / length.powi(3);
        let mut local_stiffness = [[0.0; 6]; 6];
        local_stiffness[0][0] = ea_l;
        local_stiffness[0][3] = -ea_l;
        local_stiffness[3][0] = -ea_l;
        local_stiffness[3][3] = ea_l;
        let bending = [
            [12.0, 6.0 * length, -12.0, 6.0 * length],
            [
                6.0 * length,
                4.0 * length * length,
                -6.0 * length,
                2.0 * length * length,
            ],
            [-12.0, -6.0 * length, 12.0, -6.0 * length],
            [
                6.0 * length,
                2.0 * length * length,
                -6.0 * length,
                4.0 * length * length,
            ],
        ];
        for (i, &row) in [1, 2, 4, 5].iter().enumerate() {
            for (j, &column) in [1, 2, 4, 5].iter().enumerate() {
                local_stiffness[row][column] = bending[i][j] * ei_l3;
            }
        }
        let dofs = [
            3 * start,
            3 * start + 1,
            3 * start + 2,
            3 * end,
            3 * end + 1,
            3 * end + 2,
        ];
        if member.releases.rz_start {
            released_rotations[dofs[2]] = true;
        }
        if member.releases.rz_end {
            released_rotations[dofs[5]] = true;
        }
        let element = Element {
            dofs,
            length,
            transform,
            local_stiffness,
            local_load: [0.0; 6],
            ea_kn: material.e_mpa * 1000.0 * section.area_m2,
            ei_knm2: material.e_mpa * 1000.0 * section.inertia_m4,
            area_m2: section.area_m2,
            thermal_strain: 0.0,
            thermal_curvature: 0.0,
            material: (*material).clone(),
            releases: member.releases,
            springs: member.springs,
            raw_stiffness: None,
            raw_load: None,
        };
        elements.insert(member.id, element);
    }
    for load in &request.nodal_loads {
        let index = *node_index.get(&load.node_id).ok_or("unknown loaded node")?;
        if ![load.fx, load.fy, load.mz]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err("non-finite 2D nodal load".into());
        }
        for (axis, value) in [load.fx, load.fy, load.mz].iter().enumerate() {
            f[3 * index + axis] += value;
        }
    }
    let nodal_f = f.clone();
    for load in &request.member_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown loaded member")?;
        add_member_load(&mut element.local_load, load, element.length)?;
    }
    for load in &request.member_point_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown point-loaded member")?;
        if ![load.position_m, load.px_kn, load.py_kn]
            .iter()
            .all(|v| v.is_finite())
            || load.position_m < 0.0
            || load.position_m > element.length
        {
            return Err("invalid 2D member point load".into());
        }
        let (axial, transverse) = shape(element.length, load.position_m);
        for i in 0..6 {
            element.local_load[i] += axial[i] * load.px_kn + transverse[i] * load.py_kn;
        }
    }
    for load in &request.thermal_loads {
        let element = elements
            .get_mut(&load.member_id)
            .ok_or("unknown thermally loaded 2D frame member")?;
        if !load.delta_t_k.is_finite()
            || !load.delta_t_gradient_k.is_finite()
            || !load.alpha_per_k.is_finite()
            || load.alpha_per_k < 0.0
            || load.delta_t_gradient_k != 0.0
                && !load
                    .depth_m
                    .is_some_and(|depth| depth.is_finite() && depth > 0.0)
            || load
                .depth_m
                .is_some_and(|depth| !depth.is_finite() || depth <= 0.0)
        {
            return Err("invalid 2D frame thermal load".into());
        }
        let strain = load.alpha_per_k * load.delta_t_k;
        // Positive local curvature shortens the +Y face; a hotter +Y face
        // therefore imposes negative curvature.
        let curvature = -load.alpha_per_k * load.delta_t_gradient_k / load.depth_m.unwrap_or(1.0);
        if !strain.is_finite() || !curvature.is_finite() {
            return Err("invalid 2D frame thermal strain or curvature".into());
        }
        element.thermal_strain += strain;
        element.thermal_curvature += curvature;
        if !element.thermal_strain.is_finite() || !element.thermal_curvature.is_finite() {
            return Err("invalid combined 2D frame thermal strain or curvature".into());
        }
    }
    for element in elements.values_mut() {
        let force = element.ea_kn * element.thermal_strain;
        let moment = element.ei_knm2 * element.thermal_curvature;
        if !force.is_finite() || !moment.is_finite() {
            return Err("non-finite 2D frame thermal equivalent load".into());
        }
        element.local_load[0] -= force;
        element.local_load[3] += force;
        element.local_load[2] -= moment;
        element.local_load[5] += moment;
    }
    for element in elements.values_mut() {
        condense_connections(element)?;
        for i in 0..6 {
            for j in 0..6 {
                let mut value = 0.0;
                for a in 0..6 {
                    for b in 0..6 {
                        value += element.transform[a][i]
                            * element.local_stiffness[a][b]
                            * element.transform[b][j];
                    }
                }
                if value != 0.0 {
                    assembled_nonzero_rows[element.dofs[i]] = true;
                }
                if let Some(k) = &mut k {
                    k.add(element.dofs[i], element.dofs[j], value);
                }
            }
            for j in 0..6 {
                f[element.dofs[i]] += element.transform[j][i] * element.local_load[j];
            }
        }
    }
    if let Some(membrane) = &request.membrane {
        add_conforming_membrane_stiffness(
            request,
            membrane,
            k.as_mut()
                .expect("coupled membranes use the assembled matrix"),
        )?;
        // Membranes have no nodal rotation DOF. Mark it inactive so membrane-
        // only nodes do not introduce a free zero-stiffness rotation.
        for index in 0..request.nodes.len() {
            released_rotations[3 * index + 2] = true;
        }
    }
    let mut prescribed = vec![None; total_dofs];
    let mut spring_stiffness = vec![0.0; total_dofs];
    let mut support_stiffness = vec![0.0; total_dofs];
    for member in &request.members {
        if let Some(line_stiffness) = member.foundation_kn_per_m2 {
            let element = &elements[&member.id];
            let tributary = line_stiffness * element.length / 2.0;
            if !tributary.is_finite() {
                return Err("invalid 2D frame foundation tributary stiffness".into());
            }
            for end in [0, 3] {
                // The legacy solver also assigns 0.1% horizontal soil
                // friction. Keep the same global-axis convention here.
                spring_stiffness[element.dofs[end]] += 0.001 * tributary;
                spring_stiffness[element.dofs[end + 1]] += tributary;
            }
        }
    }
    for (dof, &stiffness) in spring_stiffness.iter().enumerate() {
        if stiffness > 0.0 {
            assembled_nonzero_rows[dof] = true;
            if let Some(k) = &mut k {
                k.add(dof, dof, stiffness);
            }
        }
    }
    let mut supported = HashSet::new();
    for support in &request.supports {
        let node = *node_index
            .get(&support.node_id)
            .ok_or("unknown support node")?;
        if !supported.insert(support.node_id) {
            return Err("duplicate 2D frame support".into());
        }
        let fixed = [support.ux, support.uy, support.rz];
        let values = [
            support.ux_prescribed_m,
            support.uy_prescribed_m,
            support.rz_prescribed_rad,
        ];
        let springs = [
            support.kx_kn_per_m,
            support.ky_kn_per_m,
            support.krz_knm_per_rad,
        ];
        for axis in 0..3 {
            if let Some(value) = values[axis] {
                if !fixed[axis] || !value.is_finite() {
                    return Err("invalid 2D prescribed displacement".into());
                }
            }
            if let Some(stiffness) = springs[axis] {
                positive(stiffness, "spring stiffness")?;
                if fixed[axis] {
                    return Err("2D support cannot fix and spring the same DOF".into());
                }
                assembled_nonzero_rows[3 * node + axis] = true;
                if let Some(k) = &mut k {
                    k.add(3 * node + axis, 3 * node + axis, stiffness);
                }
                spring_stiffness[3 * node + axis] += stiffness;
                support_stiffness[3 * node + axis] += stiffness;
            }
            if fixed[axis] {
                prescribed[3 * node + axis] = Some(values[axis].unwrap_or(0.0));
            }
        }
    }
    for dof in 0..total_dofs {
        if !released_rotations[dof] || prescribed[dof].is_some() {
            continue;
        }
        let connected = if let Some(k) = &k {
            k.get(dof, dof) != 0.0
                || (0..total_dofs).any(|other| k.get(dof, other) != 0.0 || k.get(other, dof) != 0.0)
        } else {
            assembled_nonzero_rows[dof]
        };
        if connected {
            continue;
        }
        if f[dof] != 0.0 {
            return Err("load on a disconnected 2D frame rotation".into());
        }
        prescribed[dof] = Some(0.0);
    }
    let mut states: HashMap<usize, AxialState> = elements
        .keys()
        .map(|&id| (id, AxialState::default()))
        .collect();
    let mut section_states: HashMap<usize, [[FiberState; 3]; 2]> = elements
        .keys()
        .map(|&id| (id, [[FiberState::default(); 3]; 2]))
        .collect();
    let mut membrane_states = request.membrane.as_ref().map(MembraneStates::new);
    let mut final_factor = 1.0;
    let mut iterations = 0;
    let mut frontal_maximum_front_dofs = None;
    let (u, reactions) = if request.analysis.material() {
        let mut u = vec![0.0; total_dofs];
        let path = if request.load_path.is_empty() {
            vec![1.0]
        } else {
            request.load_path.clone()
        };
        let initial_steps = if request
            .materials
            .iter()
            .any(|m| !matches!(m.law, MaterialLaw::Elastic))
        {
            10
        } else {
            1
        };
        let mut start = 0.0;
        for &end in &path {
            let direction = (end - start).signum();
            if direction == 0.0 {
                continue;
            }
            let maximum_step = (end - start).abs() / initial_steps as f64;
            let minimum_step = 1e-10 * (1.0 + start.abs().max(end.abs()));
            let mut step_size = maximum_step;
            let mut factor = start;
            let mut accepted_steps = 0;
            while direction * (end - factor) > 1e-12 * (1.0 + end.abs()) {
                accepted_steps += 1;
                if accepted_steps > 1000 {
                    return Err(format!(
                        "2D frame material load path exceeded 1000 increments before factor {end}"
                    ));
                }
                let next_factor = if step_size >= (end - factor).abs() {
                    end
                } else {
                    factor + direction * step_size
                };
                let constraints: Vec<Option<f64>> = prescribed
                    .iter()
                    .map(|value| value.map(|v| next_factor * v))
                    .collect();
                let mut trial_u = u.clone();
                let mut converged = false;
                let mut unstable_trial = false;
                let mut last_relative_change = f64::INFINITY;
                for _ in 0..request.max_iterations {
                    iterations += 1;
                    let (tangent, internal, member_load, _) = material_system(
                        &elements,
                        &trial_u,
                        &states,
                        &section_states,
                        &spring_stiffness,
                        request.analysis.geometric(),
                        next_factor,
                        request
                            .membrane
                            .as_ref()
                            .zip(membrane_states.as_ref())
                            .map(|(membrane, states)| (request, membrane, states)),
                    )?;
                    let target: Vec<f64> = nodal_f
                        .iter()
                        .zip(&member_load)
                        .map(|(nodal, member)| next_factor * (nodal + member))
                        .collect();
                    if request.analysis.geometric() {
                        if free_positive_definite(&tangent, &constraints).is_err() {
                            unstable_trial = true;
                            break;
                        }
                    }
                    let ku = tangent.mul(&trial_u);
                    let rhs: Vec<f64> = target
                        .iter()
                        .zip(&internal)
                        .zip(&ku)
                        .map(|((load, force), ku)| load - force + ku)
                        .collect();
                    let (candidate, _) = constrained_solve(&tangent, &rhs, &constraints)?;
                    let change = candidate
                        .iter()
                        .zip(&trial_u)
                        .map(|(a, b)| (a - b).powi(2))
                        .sum::<f64>()
                        .sqrt();
                    let magnitude = candidate
                        .iter()
                        .map(|v| v * v)
                        .sum::<f64>()
                        .sqrt()
                        .max(1e-12);
                    last_relative_change = change / magnitude;
                    trial_u = candidate;
                    if last_relative_change <= request.tolerance {
                        converged = true;
                        break;
                    }
                }
                if !converged {
                    step_size *= 0.5;
                    if step_size < minimum_step {
                        let reason = if unstable_trial {
                            "lost stable stiffness"
                        } else {
                            "did not converge"
                        };
                        return Err(format!("2D frame material iteration {reason} near load factor {next_factor} after load-step cutbacks (relative displacement change {last_relative_change})"));
                    }
                    continue;
                }
                let mut updated_states = HashMap::with_capacity(elements.len());
                for (&id, element) in &elements {
                    let d = local_displacement(element, &trial_u);
                    let response =
                        effective_axial_response(element, d[3] - d[0], next_factor, states[&id])?;
                    updated_states.insert(id, response.state);
                }
                let (_, _, _, updated_section_states) = material_system(
                    &elements,
                    &trial_u,
                    &states,
                    &section_states,
                    &spring_stiffness,
                    request.analysis.geometric(),
                    next_factor,
                    request
                        .membrane
                        .as_ref()
                        .zip(membrane_states.as_ref())
                        .map(|(membrane, states)| (request, membrane, states)),
                )?;
                states = updated_states;
                section_states.extend(updated_section_states);
                if let (Some(membrane), Some(membrane_states)) =
                    (&request.membrane, &mut membrane_states)
                {
                    commit_conforming_membrane(
                        request,
                        membrane,
                        &trial_u,
                        request.analysis,
                        membrane_states,
                    )?;
                }
                u = trial_u;
                factor = next_factor;
                step_size = (step_size * 1.5).min(maximum_step);
            }
            start = end;
        }
        final_factor = *path.last().unwrap();
        let (_, internal, member_load, _) = material_system(
            &elements,
            &u,
            &states,
            &section_states,
            &spring_stiffness,
            request.analysis.geometric(),
            final_factor,
            request
                .membrane
                .as_ref()
                .zip(membrane_states.as_ref())
                .map(|(membrane, states)| (request, membrane, states)),
        )?;
        f = nodal_f
            .iter()
            .zip(&member_load)
            .map(|(nodal, member)| nodal + member)
            .collect();
        let reactions = internal
            .iter()
            .zip(&f)
            .map(|(force, load)| force - final_factor * load)
            .collect();
        (u, reactions)
    } else if request.analysis.geometric() && request.membrane.is_some() {
        let membrane = request
            .membrane
            .as_ref()
            .ok_or("missing coupled membrane in geometric solve")?;
        let (u, reactions, coupled_iterations) = geometric_coupled_solve(
            request,
            membrane,
            &elements,
            k.as_ref()
                .expect("geometric membranes use the assembled matrix"),
            &f,
            &nodal_f,
            &spring_stiffness,
            &prescribed,
        )?;
        iterations = coupled_iterations;
        (u, reactions)
    } else if request.linear_backend == LinearBackend::FrontalWave {
        let frontal_elements =
            frontal_frame_elements(&request.members, &elements, &spring_stiffness);
        let solved = frontal::solve(
            &frontal_elements,
            &f,
            &prescribed,
            FrontalOptions {
                max_front_dofs: request.frontal_max_front_dofs.unwrap_or(4096),
                ..FrontalOptions::default()
            },
        )?;
        frontal_maximum_front_dofs = Some(solved.maximum_front_dofs);
        iterations = 1;
        (solved.displacements, solved.reactions)
    } else {
        let (mut u, _) = constrained_solve(
            k.as_ref()
                .expect("existing backend uses the assembled matrix"),
            &f,
            &prescribed,
        )?;
        iterations = 1;
        if request.analysis.geometric() {
            let mut converged = false;
            for iteration in 2..=request.max_iterations {
                let (candidate_k, candidate_f) =
                    geometric_assembly(&elements, &nodal_f, &spring_stiffness, &u)?;
                free_positive_definite(&candidate_k, &prescribed)?;
                let (candidate, _) = constrained_solve(&candidate_k, &candidate_f, &prescribed)?;
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
                u = candidate;
                iterations = iteration;
                if change / magnitude <= request.tolerance {
                    converged = true;
                    break;
                }
            }
            if !converged {
                return Err(format!(
                    "2D frame P-Delta did not converge in {} iterations",
                    request.max_iterations
                ));
            }
            let (geometric_k, geometric_f) =
                geometric_assembly(&elements, &nodal_f, &spring_stiffness, &u)?;
            k = Some(geometric_k);
            f = geometric_f;
            free_positive_definite(k.as_ref().unwrap(), &prescribed)?;
        }
        let reactions: Vec<f64> = k
            .as_ref()
            .expect("existing backend uses the assembled matrix")
            .mul(&u)
            .iter()
            .zip(&f)
            .map(|(ku, load)| ku - load)
            .collect();
        (u, reactions)
    };
    let max_load = f.iter().fold(1.0_f64, |maximum, &value| {
        maximum.max((final_factor * value).abs())
    });
    let equilibrium_residual = reactions
        .iter()
        .enumerate()
        .filter(|(dof, _)| prescribed[*dof].is_none())
        .fold(0.0_f64, |maximum, (_, value)| maximum.max(value.abs()))
        / max_load;
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| NodeResult {
            node_id: node.id,
            displacement: [u[3 * index], u[3 * index + 1], u[3 * index + 2]],
            reaction: [
                reactions[3 * index] - support_stiffness[3 * index] * u[3 * index],
                reactions[3 * index + 1] - support_stiffness[3 * index + 1] * u[3 * index + 1],
                reactions[3 * index + 2] - support_stiffness[3 * index + 2] * u[3 * index + 2],
            ],
        })
        .collect();
    let mut material_responses = HashMap::new();
    if request.analysis.material() {
        for member in &request.members {
            let element = &elements[&member.id];
            let nodal = local_displacement(element, &u);
            material_responses.insert(
                member.id,
                effective_axial_response(
                    element,
                    nodal[3] - nodal[0],
                    final_factor,
                    states[&member.id],
                )?,
            );
        }
    }
    let mut section_force_responses = HashMap::new();
    let mut section_local_displacements = HashMap::new();
    if request.analysis.material() {
        for member in &request.members {
            let element = &elements[&member.id];
            if !uses_fiber_section(element) {
                continue;
            }
            let nodal = local_displacement(element, &u);
            let (connected, correction) = if has_nonlinear_connection(element) {
                recover_section_connection_dofs(
                    element,
                    nodal,
                    final_factor,
                    &section_states[&member.id],
                    request.analysis.geometric(),
                )?
            } else {
                (
                    nodal,
                    section_material_correction(
                        element,
                        &nodal,
                        final_factor,
                        &section_states[&member.id],
                    )?,
                )
            };
            section_local_displacements.insert(member.id, connected);
            section_force_responses
                .insert(member.id, (correction.internal, correction.axial_force_kn));
        }
    }
    let section_histories: HashMap<usize, SectionHistory> = if request.analysis.material() {
        section_states
            .iter()
            .filter(|(id, _)| {
                let element = &elements[id];
                uses_fiber_section(element)
            })
            .map(|(&id, points)| {
                let states = points.iter().flatten();
                let mut history = SectionHistory {
                    maximum_abs_plastic_strain: 0.0,
                    maximum_equivalent_plastic_strain: 0.0,
                    maximum_tensile_damage: 0.0,
                };
                for state in states {
                    history.maximum_abs_plastic_strain = history
                        .maximum_abs_plastic_strain
                        .max(state.plastic_strain.abs());
                    history.maximum_equivalent_plastic_strain = history
                        .maximum_equivalent_plastic_strain
                        .max(state.equivalent_plastic_strain);
                    history.maximum_tensile_damage =
                        history.maximum_tensile_damage.max(state.tensile_damage);
                }
                (id, history)
            })
            .collect()
    } else {
        HashMap::new()
    };
    let members = request
        .members
        .iter()
        .map(|member| {
            let element = &elements[&member.id];
            let unrecovered = local_displacement(element, &u);
            let material_response = material_responses.get(&member.id).copied();
            let axial_override =
                material_response.map(|response| response.stress_mpa * 1000.0 * element.area_m2);
            let released_material_strain = material_response
                .filter(|_| element.releases.ux_start || element.releases.ux_end)
                .map(|response| free_material_axial_strain(&element.material, response.state));
            let local_displacement = section_local_displacements
                .get(&member.id)
                .copied()
                .unwrap_or_else(|| {
                    connected_local_displacement(
                        element,
                        unrecovered,
                        final_factor,
                        request.analysis.geometric(),
                        axial_override,
                        released_material_strain,
                    )
                });
            let stiffness = element
                .raw_stiffness
                .as_ref()
                .unwrap_or(&element.local_stiffness);
            let applied_load = element.raw_load.as_ref().unwrap_or(&element.local_load);
            let mut elastic_end_forces = [0.0; 6];
            for i in 0..6 {
                elastic_end_forces[i] = (0..6)
                    .map(|j| stiffness[i][j] * local_displacement[j])
                    .sum::<f64>()
                    - final_factor * applied_load[i];
            }
            let response = material_response;
            let axial = if let Some(response) = response {
                section_force_responses
                    .get(&member.id)
                    .map(|(_, section_axial)| *section_axial)
                    .unwrap_or(response.stress_mpa * 1000.0 * element.area_m2)
            } else {
                axial_force(element, &local_displacement)
            };
            let mut local_end_forces = elastic_end_forces;
            if request.analysis.material() {
                if let Some((section_force, _)) = section_force_responses.get(&member.id) {
                    for (force, correction) in local_end_forces.iter_mut().zip(section_force) {
                        *force += correction;
                    }
                } else {
                    let elastic_n = element.ea_kn
                        * (axial_strain(element, &local_displacement)
                            - final_factor * element.thermal_strain);
                    let correction = axial - elastic_n;
                    local_end_forces[0] -= correction;
                    local_end_forces[3] += correction;
                }
            }
            if request.analysis.geometric() {
                let kg = geometric_local(element, axial);
                for i in 0..6 {
                    local_end_forces[i] += (0..6)
                        .map(|j| kg[i][j] * local_displacement[j])
                        .sum::<f64>();
                }
            }
            let line_loads: Vec<&MemberLoad> = request
                .member_loads
                .iter()
                .filter(|load| load.member_id == member.id)
                .collect();
            let point_loads: Vec<&MemberPointLoad> = request
                .member_point_loads
                .iter()
                .filter(|load| load.member_id == member.id)
                .collect();
            let mut samples: Vec<(f64, bool)> = (0..=20)
                .map(|index| (element.length * index as f64 / 20.0, true))
                .collect();
            for point in &point_loads {
                samples.retain(|(x, _)| (x - point.position_m).abs() > 1e-10);
                samples.push((point.position_m, false));
                samples.push((point.position_m, true));
            }
            samples.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
            let mut stations_m = Vec::with_capacity(samples.len());
            let mut normal_force_kn = Vec::with_capacity(samples.len());
            let mut shear_force_kn = Vec::with_capacity(samples.len());
            let mut bending_moment_knm = Vec::with_capacity(samples.len());
            let mut deflection_m = Vec::with_capacity(samples.len());
            let mut axial_disp_m = Vec::with_capacity(samples.len());
            let mut rotation_rad = Vec::with_capacity(samples.len());
            for (x, right_side) in samples {
                let integral = |axial, power| {
                    line_loads
                        .iter()
                        .map(|load| integrated_load(load, element.length, x, axial, power))
                        .sum::<f64>()
                        * final_factor
                };
                let point = |axial, power| {
                    point_loads
                        .iter()
                        .filter(|load| {
                            load.position_m < x - 1e-10
                                || (right_side && (load.position_m - x).abs() <= 1e-10)
                        })
                        .map(|load| {
                            let force = if axial { load.px_kn } else { load.py_kn };
                            let distance = (x - load.position_m).max(0.0);
                            let factorial = match power {
                                0 | 1 => 1.0,
                                2 => 2.0,
                                3 => 6.0,
                                _ => unreachable!(),
                            };
                            force * distance.powi(power as i32) / factorial
                        })
                        .sum::<f64>()
                        * final_factor
                };
                stations_m.push(x);
                normal_force_kn.push(-local_end_forces[0] - integral(true, 0) - point(true, 0));
                shear_force_kn.push(local_end_forces[1] + integral(false, 0) + point(false, 0));
                axial_disp_m.push(if request.analysis.material() {
                    local_displacement[0]
                        + (local_displacement[3] - local_displacement[0]) * x / element.length
                } else {
                    local_displacement[0]
                        + final_factor * element.thermal_strain * x
                        + (-elastic_end_forces[0] * x - integral(true, 1) - point(true, 1))
                            / element.ea_kn
                });
                rotation_rad.push(
                    local_displacement[2]
                        + final_factor * element.thermal_curvature * x
                        + (-elastic_end_forces[2] * x
                            + elastic_end_forces[1] * x * x / 2.0
                            + integral(false, 2)
                            + point(false, 2))
                            / element.ei_knm2,
                );
                let deflection = local_displacement[1]
                    + local_displacement[2] * x
                    + final_factor * element.thermal_curvature * x * x / 2.0
                    + (-elastic_end_forces[2] * x * x / 2.0
                        + elastic_end_forces[1] * x.powi(3) / 6.0
                        + integral(false, 3)
                        + point(false, 3))
                        / element.ei_knm2;
                deflection_m.push(deflection);
                bending_moment_knm.push(
                    -local_end_forces[2]
                        + local_end_forces[1] * x
                        + integral(false, 1)
                        + point(false, 1)
                        + if request.analysis.geometric() {
                            axial * (deflection - local_displacement[1])
                        } else {
                            0.0
                        },
                );
            }
            MemberResult {
                member_id: member.id,
                local_end_forces,
                stations_m,
                normal_force_kn,
                shear_force_kn,
                bending_moment_knm,
                deflection_m,
                axial_disp_m,
                rotation_rad,
                axial_history: response.map(|response| AxialHistory {
                    plastic_strain: response.state.plastic_strain,
                    equivalent_plastic_strain: response.state.equivalent_plastic_strain,
                    tensile_damage: response.state.tensile_damage,
                    tangent_e_mpa: response.tangent_e_mpa,
                }),
                section_history: section_histories.get(&member.id).cloned(),
            }
        })
        .collect();
    let (membrane_triangles, membrane_quads) = if let Some(membrane) = &request.membrane {
        recover_conforming_membrane(
            request,
            membrane,
            &u,
            request.analysis,
            membrane_states
                .as_ref()
                .ok_or("missing coupled membrane history")?,
        )?
    } else {
        (Vec::new(), Vec::new())
    };
    Ok(Result2D {
        nodes,
        members,
        equilibrium_residual,
        iterations,
        frontal_maximum_front_dofs,
        membrane_triangles,
        membrane_quads,
    })
}

fn membrane_requests(
    frame: &Request,
    membrane: &MembraneModel,
    analysis: Analysis,
) -> (crate::plate2d::Request, crate::quad2d::Request) {
    let nodes: Vec<crate::plate2d::Node> = frame
        .nodes
        .iter()
        .map(|node| crate::plate2d::Node {
            id: node.id,
            x: node.x,
            y: node.y,
        })
        .collect();
    let triangles = crate::plate2d::Request {
        analysis,
        nodes: nodes.clone(),
        materials: membrane.materials.clone(),
        orthotropic_materials: membrane.orthotropic_materials.clone(),
        modulus_curves: membrane.modulus_curves.clone(),
        triangles: membrane.triangles.clone(),
        supports: Vec::new(),
        loads: Vec::new(),
        load_path: Vec::new(),
        tolerance: frame.tolerance,
        max_iterations: frame.max_iterations.min(200),
    };
    let quads = crate::quad2d::Request {
        analysis,
        nodes,
        materials: membrane.materials.clone(),
        orthotropic_materials: membrane.orthotropic_materials.clone(),
        modulus_curves: membrane.modulus_curves.clone(),
        quads: membrane.quads.clone(),
        supports: Vec::new(),
        loads: Vec::new(),
        load_path: Vec::new(),
        tolerance: frame.tolerance,
        max_iterations: frame.max_iterations.min(200),
    };
    (triangles, quads)
}

fn assemble_conforming_membrane(
    frame: &Request,
    membrane: &MembraneModel,
    frame_displacement: &[f64],
    analysis: Analysis,
    states: &MembraneStates,
) -> Result<(Vec<f64>, Matrix), String> {
    if membrane.triangles.is_empty() && membrane.quads.is_empty() {
        return Err("coupled 2D frame/membrane model has no membrane elements".into());
    }
    if frame_displacement.len() != 3 * frame.nodes.len()
        || states.triangles.len() != membrane.triangles.len()
        || states.quads.len() != membrane.quads.len()
    {
        return Err("coupled frame/membrane state or displacement size mismatch".into());
    }
    let (triangles, quads) = membrane_requests(frame, membrane, analysis);
    let displacement: Vec<f64> = frame_displacement
        .chunks_exact(3)
        .flat_map(|node| [node[0], node[1]])
        .collect();
    let (mut triangle_internal, triangle_stiffness) = crate::plate2d::assemble_mixed(
        &triangles,
        &displacement,
        analysis,
        &states.triangles,
        true,
    )?;
    let (quad_internal, quad_stiffness) =
        crate::quad2d::assemble_mixed(&quads, &displacement, analysis, &states.quads, true)?;
    for (force, quad_force) in triangle_internal.iter_mut().zip(quad_internal) {
        *force += quad_force;
    }
    let mut membrane_stiffness = triangle_stiffness;
    membrane_stiffness.add_matrix(&quad_stiffness)?;
    let mut frame_internal = vec![0.0; frame_displacement.len()];
    let mut frame_tangent = Matrix::zeros(frame_displacement.len())?;
    for i in 0..frame.nodes.len() {
        for axis_i in 0..2 {
            frame_internal[3 * i + axis_i] = triangle_internal[2 * i + axis_i];
            for j in 0..frame.nodes.len() {
                for axis_j in 0..2 {
                    let membrane_i = 2 * i + axis_i;
                    let membrane_j = 2 * j + axis_j;
                    let frame_i = 3 * i + axis_i;
                    let frame_j = 3 * j + axis_j;
                    frame_tangent.add(
                        frame_i,
                        frame_j,
                        membrane_stiffness.get(membrane_i, membrane_j),
                    );
                }
            }
        }
    }
    Ok((frame_internal, frame_tangent))
}

fn add_conforming_membrane_stiffness(
    frame: &Request,
    membrane: &MembraneModel,
    frame_stiffness: &mut Matrix,
) -> Result<(), String> {
    let states = MembraneStates::new(membrane);
    let zero = vec![0.0; 3 * frame.nodes.len()];
    let (_, tangent) =
        assemble_conforming_membrane(frame, membrane, &zero, Analysis::Linear, &states)?;
    frame_stiffness.add_matrix(&tangent)
}

fn commit_conforming_membrane(
    frame: &Request,
    membrane: &MembraneModel,
    frame_displacement: &[f64],
    analysis: Analysis,
    states: &mut MembraneStates,
) -> Result<(), String> {
    let (triangles, quads) = membrane_requests(frame, membrane, analysis);
    let displacement: Vec<f64> = frame_displacement
        .chunks_exact(3)
        .flat_map(|node| [node[0], node[1]])
        .collect();
    crate::plate2d::commit_mixed_states(
        &triangles,
        &displacement,
        analysis,
        &mut states.triangles,
    )?;
    crate::quad2d::commit_mixed_states(&quads, &displacement, analysis, &mut states.quads)
}

fn recover_conforming_membrane(
    frame: &Request,
    membrane: &MembraneModel,
    displacement: &[f64],
    analysis: Analysis,
    states: &MembraneStates,
) -> Result<
    (
        Vec<crate::plate2d::ElementResult>,
        Vec<crate::quad2d::QuadResult>,
    ),
    String,
> {
    if membrane.triangles.is_empty() && membrane.quads.is_empty() {
        return Err("coupled 2D frame/membrane model has no membrane elements".into());
    }
    let (triangles, quads) = membrane_requests(frame, membrane, analysis);
    let planar_displacement: Vec<f64> = displacement
        .chunks_exact(3)
        .flat_map(|node| [node[0], node[1]])
        .collect();
    Ok((
        crate::plate2d::recover_mixed(
            &triangles,
            &planar_displacement,
            analysis,
            &states.triangles,
        )?,
        crate::quad2d::recover_mixed(&quads, &planar_displacement, analysis, &states.quads)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coupled_geometric_residual_uses_finite_free_dof_norms() {
        // Squaring the finite 1e200 load overflowed to infinity and made the
        // finite 1e153 imbalance appear exactly converged.
        let relative = geometric_free_residual_ratio(&[1e200], &[1e153], &[None]).unwrap();
        assert!((relative / 1e-47 - 1.0).abs() < 1e-12);
        assert!(relative > 1e-50);

        // A large force applied directly to a fixed DOF is a reaction; it
        // must not hide an imbalance at the free DOF.
        let relative =
            geometric_free_residual_ratio(&[10.0, 1e200], &[1.0, 1e200], &[None, Some(0.0)])
                .unwrap();
        assert!((relative - 0.1).abs() < 1e-12);

        assert!(geometric_free_residual_ratio(&[1.0], &[f64::INFINITY], &[None]).is_err());
        assert!(
            geometric_free_residual_ratio(&[1.5e308, 1.5e308], &[1.0, 1.0], &[None, None]).is_err()
        );
    }

    fn cantilever() -> Request {
        Request {
            analysis: Analysis::Linear,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                },
                Node {
                    id: 2,
                    x: 3.0,
                    y: 0.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 210_000.0,
                law: MaterialLaw::Elastic,
            }],
            sections: vec![Section {
                id: 1,
                area_m2: 0.01,
                inertia_m4: 8e-6,
            }],
            members: vec![Member {
                id: 1,
                start_node_id: 1,
                end_node_id: 2,
                material_id: 1,
                section_id: 1,
                releases: EndReleases::default(),
                springs: EndSprings::default(),
                foundation_kn_per_m2: None,
            }],
            supports: vec![Support {
                node_id: 1,
                ux: true,
                uy: true,
                rz: true,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
                krz_knm_per_rad: None,
                ux_prescribed_m: None,
                uy_prescribed_m: None,
                rz_prescribed_rad: None,
            }],
            nodal_loads: vec![],
            member_loads: vec![],
            member_point_loads: vec![],
            thermal_loads: vec![],
            membrane: None,
            load_path: vec![],
            max_iterations: default_iterations(),
            tolerance: default_tolerance(),
        }
    }

    fn fixed_end(input: &mut Request) {
        let mut support = input.supports[0].clone();
        support.node_id = 2;
        input.supports.push(support);
    }

    #[test]
    fn conforming_cst_membrane_and_frame_share_translations_in_one_solve() {
        let mut input = cantilever();
        input.nodes.push(Node {
            id: 3,
            x: 3.0,
            y: 2.0,
        });
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 3,
            fx: 10.0,
            fy: 0.0,
            mz: 0.0,
        });
        input.membrane = Some(MembraneModel {
            materials: vec![crate::plate2d::Material {
                id: 2,
                e_mpa: 30_000.0,
                nu: 0.2,
                law: MaterialLaw::Elastic,
            }],
            triangles: vec![crate::plate2d::Triangle {
                id: 20,
                node_ids: [1, 2, 3],
                material_id: 2,
                thickness_m: 0.2,
            }],
            ..MembraneModel::default()
        });

        let result = solve(&input).unwrap();
        assert_eq!(result.membrane_triangles.len(), 1);
        assert!(result.membrane_quads.is_empty());
        assert!(result.nodes[1].displacement[0].abs() > 1e-8);
        assert!(result.nodes[2].displacement[0] > 0.0);
        assert!(result.membrane_triangles[0]
            .strain
            .iter()
            .any(|strain| strain.abs() > 1e-9));
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .any(|force| force.abs() > 1e-6));
        let reaction_x = result
            .nodes
            .iter()
            .map(|node| node.reaction[0])
            .sum::<f64>();
        assert!((reaction_x + 10.0).abs() < 1e-7);
        assert!(result.equilibrium_residual < 1e-8);
    }

    #[test]
    fn conforming_q4_membrane_and_frame_share_translations_in_one_solve() {
        let mut input = cantilever();
        input.nodes.extend([
            Node {
                id: 3,
                x: 3.0,
                y: 2.0,
            },
            Node {
                id: 4,
                x: 0.0,
                y: 2.0,
            },
        ]);
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 3,
            fx: 10.0,
            fy: 0.0,
            mz: 0.0,
        });
        input.membrane = Some(MembraneModel {
            materials: vec![crate::plate2d::Material {
                id: 2,
                e_mpa: 30_000.0,
                nu: 0.2,
                law: MaterialLaw::Elastic,
            }],
            quads: vec![crate::quad2d::Quad {
                id: 30,
                node_ids: [1, 2, 3, 4],
                material_id: 2,
                thickness_m: 0.2,
            }],
            ..MembraneModel::default()
        });

        let result = solve(&input).unwrap();
        assert!(result.membrane_triangles.is_empty());
        assert_eq!(result.membrane_quads.len(), 1);
        assert!(result.nodes[2].displacement[0] > 0.0);
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .any(|force| force.abs() > 1e-6));
        let reaction_x = result
            .nodes
            .iter()
            .map(|node| node.reaction[0])
            .sum::<f64>();
        assert!((reaction_x + 10.0).abs() < 1e-7);
        assert!(result.equilibrium_residual < 1e-8);
    }

    #[test]
    fn conforming_membrane_supports_geometric_analysis() {
        let mut input = cantilever();
        input.analysis = Analysis::Geometric;
        input.nodes.push(Node {
            id: 3,
            x: 3.0,
            y: 2.0,
        });
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 3,
            fx: 10.0,
            fy: 0.0,
            mz: 0.0,
        });
        input.membrane = Some(MembraneModel {
            materials: vec![crate::plate2d::Material {
                id: 2,
                e_mpa: 30_000.0,
                nu: 0.2,
                law: MaterialLaw::Elastic,
            }],
            triangles: vec![crate::plate2d::Triangle {
                id: 20,
                node_ids: [1, 2, 3],
                material_id: 2,
                thickness_m: 0.2,
            }],
            ..MembraneModel::default()
        });

        let result = solve(&input).unwrap();
        assert_eq!(result.membrane_triangles.len(), 1);
        assert!(result.membrane_triangles[0]
            .strain
            .iter()
            .any(|strain| strain.abs() > 1e-9));
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .any(|force| force.abs() > 1e-6));
        assert!(result.equilibrium_residual < 1e-7);
    }

    #[test]
    fn rotational_start_spring_adds_closed_form_cantilever_tip_rotation() {
        let mut input = cantilever();
        let k = 3500.0;
        input.members[0].springs.rz_start_knm_per_rad = Some(k);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let expected = -10.0 * 3.0_f64.powi(3) / (3.0 * ei) - 10.0 * 3.0_f64.powi(2) / k;
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-11);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-9);
        assert!((result.members[0].local_end_forces[2] - 30.0).abs() < 1e-9);
    }

    #[test]
    fn axial_start_spring_adds_series_extension() {
        let mut input = cantilever();
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 50.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ea = 210_000.0 * 1000.0 * 0.01;
        let expected = 50.0 * 3.0 / ea + 50.0 / 200_000.0;
        assert!((result.nodes[1].displacement[0] - expected).abs() < 1e-12);
        assert!((result.members[0].normal_force_kn[10] - 50.0).abs() < 1e-9);
        assert!((result.nodes[0].reaction[0] + 50.0).abs() < 1e-9);
    }

    #[test]
    fn two_axial_end_springs_sum_their_series_compliance() {
        let mut input = cantilever();
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        input.members[0].springs.ux_end_kn_per_m = Some(100_000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 50.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ea = 210_000.0 * 1000.0 * 0.01;
        let expected = 50.0 * (3.0 / ea + 1.0 / 200_000.0 + 1.0 / 100_000.0);
        assert!((result.nodes[1].displacement[0] - expected).abs() < 1e-12);
        assert!((result.members[0].axial_disp_m[0] - 50.0 / 200_000.0).abs() < 1e-12);
        assert!((result.members[0].normal_force_kn[10] - 50.0).abs() < 1e-9);
    }

    #[test]
    fn transverse_start_spring_adds_shear_extension() {
        let mut input = cantilever();
        input.members[0].springs.uy_start_kn_per_m = Some(1000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let expected = -10.0 * 3.0_f64.powi(3) / (3.0 * ei) - 10.0 / 1000.0;
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-11);
        assert!((result.members[0].deflection_m[0] + 0.01).abs() < 1e-11);
        assert!((result.members[0].local_end_forces[1] - 10.0).abs() < 1e-9);
    }

    #[test]
    fn rotational_spring_coexists_with_steel_axial_plasticity() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.members[0].springs.rz_start_knm_per_rad = Some(3500.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let mut elastic = input.clone();
        elastic.analysis = Analysis::Linear;
        elastic.materials[0].law = MaterialLaw::Elastic;
        let elastic = solve(&elastic).unwrap();
        assert!(result.nodes[1].displacement[0] > 3.0 * 3000.0 / (210_000.0 * 1000.0 * 0.01));
        assert!(result.nodes[1].displacement[0] > 0.0);
        assert!(result.nodes[1].displacement[1].abs() > elastic.nodes[1].displacement[1].abs());
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!((result.members[0].normal_force_kn[10] - 3000.0).abs() < 1e-6);
        assert!((result.members[0].local_end_forces[2] - 30.0).abs() < 1e-7);
        input.members[0].springs.ux_start_kn_per_m = Some(1000.0);
        let axial_spring = solve(&input).unwrap();
        assert!((axial_spring.members[0].normal_force_kn[10] - 3000.0).abs() < 1e-6);
        assert!(axial_spring.nodes[1].displacement[0] > result.nodes[1].displacement[0]);
    }

    #[test]
    fn transverse_spring_coexists_with_concrete_tension_damage() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.05,
        };
        input.members[0].springs.uy_start_kn_per_m = Some(1000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 100.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let mut elastic_input = input.clone();
        elastic_input.analysis = Analysis::Linear;
        elastic_input.materials[0].law = MaterialLaw::Elastic;
        let elastic = solve(&elastic_input).unwrap();
        assert!(result.nodes[1].displacement[1].abs() > elastic.nodes[1].displacement[1].abs());
        assert!(
            result.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .tensile_damage
                > 0.0
        );
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_tensile_damage
                > 0.0
        );
        assert!((result.members[0].normal_force_kn[10] - 100.0).abs() < 1e-5);
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn rotational_end_spring_under_udl_matches_slope_deflection() {
        let mut input = cantilever();
        fixed_end(&mut input);
        let ei = 210_000.0 * 1000.0 * 8e-6;
        let k = 4.0 * ei / 3.0;
        input.members[0].springs.rz_end_knm_per_rad = Some(k);
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -10.0,
            qy_end_kn_per_m: -10.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        let theta = (10.0 * 3.0_f64.powi(2) / 12.0) / (4.0 * ei / 3.0 + k);
        let m_end = k * theta;
        let m_start = 10.0 * 3.0_f64.powi(2) / 12.0 + 2.0 * ei / 3.0 * theta;
        assert!((result.members[0].local_end_forces[5].abs() - m_end).abs() < 1e-9);
        assert!((result.members[0].local_end_forces[2].abs() - m_start).abs() < 1e-9);
        assert!((result.nodes[0].reaction[1] + result.nodes[1].reaction[1] - 30.0).abs() < 1e-9);
    }

    #[test]
    fn release_overrides_parallel_end_spring_and_invalid_springs_are_rejected() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.rz_end = true;
        input.members[0].springs.rz_end_knm_per_rad = Some(1e6);
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -10.0,
            qy_end_kn_per_m: -10.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0].local_end_forces[5].abs() < 1e-9);
        input.members[0].springs.ux_start_kn_per_m = Some(f64::NAN);
        assert!(solve(&input).unwrap_err().contains("connection spring"));
    }

    #[test]
    fn axial_translation_release_allows_free_thermal_expansion() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.ux_start = true;
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 30.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-9));
        assert!((result.members[0].axial_disp_m[0] + 0.00108).abs() < 1e-12);
        assert!(result
            .nodes
            .iter()
            .all(|node| node.reaction[0].abs() < 1e-9));
    }

    #[test]
    fn transverse_translation_release_transfers_member_load_to_other_end() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.uy_start = true;
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -10.0,
            qy_end_kn_per_m: -10.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0].local_end_forces[1].abs() < 1e-8);
        assert!((result.nodes[1].reaction[1] - 30.0).abs() < 1e-8);
        assert!(result.nodes[0].reaction[1].abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-9);
    }

    #[test]
    fn two_axial_end_releases_are_valid_only_with_external_axial_restraint() {
        let mut input = cantilever();
        fixed_end(&mut input);
        input.members[0].releases.ux_start = true;
        input.members[0].releases.ux_end = true;
        assert!(solve(&input).unwrap().members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-9));
        input.supports[1].ux = false;
        assert!(solve(&input).unwrap_err().contains("singular"));
    }

    #[test]
    fn material_analysis_accepts_axial_translation_release_without_axial_load_transfer() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.members[0].releases.ux_start = true;
        fixed_end(&mut input);
        let result = solve(&input).unwrap();
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-9));
    }

    #[test]
    fn foundation_adds_tributary_stiffness_without_reporting_soil_as_support() {
        let mut input = cantilever();
        input.members[0].foundation_kn_per_m2 = Some(100.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let beam_tip_stiffness = 3.0 * 210_000.0 * 1000.0 * 8e-6 / 3.0_f64.powi(3);
        let soil_tip_stiffness = 100.0 * 3.0 / 2.0;
        let expected = -10.0 / (beam_tip_stiffness + soil_tip_stiffness);
        assert!((result.nodes[1].displacement[1] - expected).abs() < 1e-12);
        assert!(result.nodes[1].reaction[1].abs() < 1e-9);
        assert!((result.nodes[0].reaction[1] - 10.0 - soil_tip_stiffness * expected).abs() < 1e-9);
        assert!(result.equilibrium_residual < 1e-9);
    }

    #[test]
    fn foundation_rejects_nonpositive_or_nonfinite_stiffness() {
        for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            let mut input = cantilever();
            input.members[0].foundation_kn_per_m2 = Some(invalid);
            assert!(solve(&input).unwrap_err().contains("foundation"));
        }
    }

    #[test]
    fn geometric_foundation_frame_uses_sparse_stability_check() {
        let mut input = cantilever();
        input.nodes = (0..=200)
            .map(|index| Node {
                id: index + 1,
                x: index as f64,
                y: 0.0,
            })
            .collect();
        input.materials[0].e_mpa = 1000.0;
        input.sections[0].area_m2 = 1.0;
        input.sections[0].inertia_m4 = 0.001;
        input.members = (0..200)
            .map(|index| Member {
                id: index + 1,
                start_node_id: index + 1,
                end_node_id: index + 2,
                material_id: 1,
                section_id: 1,
                releases: EndReleases::default(),
                springs: EndSprings::default(),
                foundation_kn_per_m2: Some(1000.0),
            })
            .collect();
        input.nodal_loads.push(NodalLoad {
            node_id: 201,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let linear = solve(&input).unwrap();
        input.analysis = Analysis::Geometric;
        let geometric = solve(&input).unwrap();
        assert!(
            (linear.nodes[200].displacement[1] - geometric.nodes[200].displacement[1]).abs()
                < 1e-10
        );
        assert!(geometric.equilibrium_residual < 1e-8);
        assert!(geometric.iterations >= 2);
    }

    #[test]
    fn uniform_temperature_matches_free_and_restrained_axial_solutions() {
        let mut input = cantilever();
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 40.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let free = solve(&input).unwrap();
        assert!((free.nodes[1].displacement[0] - 0.00144).abs() < 1e-12);
        assert!(free.members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-8));
        assert!((free.members[0].axial_disp_m[10] - 0.00072).abs() < 1e-12);

        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let restrained = solve(&input).unwrap();
        assert!((restrained.nodes[0].reaction[0] - 1008.0).abs() < 1e-8);
        assert!((restrained.nodes[1].reaction[0] + 1008.0).abs() < 1e-8);
        assert!(restrained.members[0]
            .axial_disp_m
            .iter()
            .all(|u| u.abs() < 1e-11));
        assert!(restrained.equilibrium_residual < 1e-12);

        input.thermal_loads[0].alpha_per_k = f64::NAN;
        assert!(solve(&input).unwrap_err().contains("thermal load"));
        input.thermal_loads[0].alpha_per_k = 12e-6;
        input.thermal_loads[0].member_id = 99;
        assert!(solve(&input)
            .unwrap_err()
            .contains("unknown thermally loaded"));
    }

    #[test]
    fn thermal_gradient_matches_free_curvature_and_fixed_end_moments() {
        let mut input = cantilever();
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 0.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 40.0,
            depth_m: Some(0.2),
        });
        let curvature = -12e-6 * 40.0 / 0.2;
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            ..input.supports[0].clone()
        });
        let free = solve(&input).unwrap();
        assert!((free.members[0].deflection_m[10] + curvature * 3.0 * 3.0 / 8.0).abs() < 1e-11);
        assert!((free.members[0].rotation_rad[0] + curvature * 3.0 / 2.0).abs() < 1e-11);
        assert!(free.members[0]
            .bending_moment_knm
            .iter()
            .all(|m| m.abs() < 1e-9));
        assert!(free.nodes.iter().all(|node| node.reaction[1].abs() < 1e-9));

        input.supports[0].rz = true;
        input.supports[1].rz = true;
        let fixed = solve(&input).unwrap();
        let thermal_moment = 210_000.0 * 1000.0 * 8e-6 * curvature;
        assert!(fixed.members[0]
            .deflection_m
            .iter()
            .all(|v| v.abs() < 1e-11));
        assert!(fixed.members[0]
            .bending_moment_knm
            .iter()
            .all(|m| (m + thermal_moment).abs() < 1e-8));
        assert!((fixed.members[0].local_end_forces[2] - thermal_moment).abs() < 1e-8);
        assert!((fixed.members[0].local_end_forces[5] + thermal_moment).abs() < 1e-8);

        input.analysis = Analysis::Combined;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 100.0,
            hardening_ratio: 0.2,
        };
        input.supports[1].ux = true;
        input.thermal_loads[0].delta_t_k = 100.0;
        input.load_path = vec![1.0];
        let combined = solve(&input).unwrap();
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let reference = integrate_section(
            input.materials[0].e_mpa,
            input.materials[0].law,
            &fibers,
            -input.thermal_loads[0].alpha_per_k * input.thermal_loads[0].delta_t_k,
            -curvature,
            &[FiberState::default(); 3],
        )
        .unwrap();
        assert!(
            (combined.members[0].bending_moment_knm[10] - reference.moment_kn_m).abs() < 1e-8,
            "frame moment {} differs from coupled section moment {}",
            combined.members[0].bending_moment_knm[10],
            reference.moment_kn_m
        );
        assert!(
            combined.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                < 0.0
        );

        input.analysis = Analysis::Linear;
        input.load_path.clear();
        input.materials[0].law = MaterialLaw::Elastic;
        input.thermal_loads[0].delta_t_k = 0.0;
        input.members[0].releases = EndReleases {
            rz_start: true,
            rz_end: true,
            ..EndReleases::default()
        };
        let hinged = solve(&input).unwrap();
        assert!((hinged.members[0].deflection_m[10] + curvature * 3.0 * 3.0 / 8.0).abs() < 1e-11);
        assert!(hinged.members[0]
            .bending_moment_knm
            .iter()
            .all(|m| m.abs() < 1e-9));

        input.thermal_loads[0].depth_m = None;
        assert!(solve(&input).unwrap_err().contains("thermal load"));
        input.thermal_loads[0].depth_m = Some(-0.2);
        assert!(solve(&input).unwrap_err().contains("thermal load"));
    }

    #[test]
    fn thermal_steel_path_uses_mechanical_strain_and_retains_plasticity() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 100.0,
            hardening_ratio: 0.5,
        };
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 100.0,
            alpha_per_k: 1e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let free = solve(&input).unwrap();
        assert!((free.nodes[1].displacement[0] - 0.003).abs() < 1e-10);
        assert!(
            free.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                .abs()
                < 1e-12
        );

        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let peak = solve(&input).unwrap();
        assert!((peak.nodes[0].reaction[0] - 1550.0).abs() < 1e-7);
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        assert!((unloaded.nodes[0].reaction[0] + 550.0).abs() < 1e-7);
        assert!(
            (unloaded.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                + 0.0002619047619047619)
                .abs()
                < 1e-12
        );
        assert!(unloaded.equilibrium_residual < 1e-10);

        let documented: Request = serde_json::from_str(include_str!(
            "../examples/frame2d-thermal-steel-unload.json"
        ))
        .unwrap();
        let example = solve(&documented).unwrap();
        assert!((example.nodes[0].reaction[0] + 550.0).abs() < 1e-7);
    }

    #[test]
    fn restrained_cooling_retains_concrete_damage_on_partial_reheating() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 33_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.2,
        };
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: true,
            rz: true,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: -30.0,
            alpha_per_k: 1e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        input.load_path = vec![1.0, 0.0, 0.5];
        let result = solve(&input).unwrap();
        let history = result.members[0].axial_history.as_ref().unwrap();
        assert!((history.tensile_damage - (1.0 - 4.38 / 9.9)).abs() < 1e-10);
        assert!((result.nodes[0].reaction[0] + 21.9).abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn thermal_compression_amplifies_combined_geometric_material_sway() {
        let mut input = cantilever();
        input.analysis = Analysis::Combined;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: false,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            // Keep the beam below its fiber-yield/buckling interaction so
            // this case measures geometric amplification rather than collapse.
            fy: -1.0,
            mz: 0.0,
        });
        let baseline = solve(&input).unwrap();
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 10.0,
            alpha_per_k: 1.2e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let heated = solve(&input).unwrap();
        assert!(heated.nodes[1].displacement[1] < baseline.nodes[1].displacement[1]);
        assert!(heated.members[0].normal_force_kn[0] < -200.0);
        assert!(heated.equilibrium_residual < 1e-7);
    }

    #[test]
    fn tip_force_matches_euler_bernoulli_closed_form() {
        let mut input = cantilever();
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: -10.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!(
            (result.nodes[1].displacement[1] + 10.0 * 3.0_f64.powi(3) / (3.0 * ei)).abs() < 1e-12
        );
        assert!(
            (result.nodes[1].displacement[2] + 10.0 * 3.0_f64.powi(2) / (2.0 * ei)).abs() < 1e-12
        );
        assert!((result.nodes[0].reaction[1] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-10);
        assert!(
            (result.members[0].deflection_m[20] - result.nodes[1].displacement[1]).abs() < 1e-12
        );
        assert!(
            (result.members[0].rotation_rad[20] - result.nodes[1].displacement[2]).abs() < 1e-12
        );
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn p_delta_compression_amplifies_and_tension_reduces_tip_sway() {
        let mut input = cantilever();
        input.analysis = Analysis::Geometric;
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: -100.0,
            fy: -10.0,
            mz: 0.0,
        });
        let compression = solve(&input).unwrap();
        input.nodal_loads[0].fx = 100.0;
        let tension = solve(&input).unwrap();
        input.analysis = Analysis::Linear;
        let linear = solve(&input).unwrap();
        assert!(compression.nodes[1].displacement[1] < linear.nodes[1].displacement[1]);
        assert!(tension.nodes[1].displacement[1] > linear.nodes[1].displacement[1]);
        let wave = (100.0_f64 / (210_000.0 * 1000.0 * 8e-6)).sqrt();
        let exact = -10.0 / (100.0 * wave) * ((3.0 * wave).tan() - 3.0 * wave);
        assert!((compression.nodes[1].displacement[1] / exact - 1.0).abs() < 0.001);
        assert!(compression.iterations >= 2);
        assert!(compression.equilibrium_residual < 1e-8);
        assert!((compression.nodes[0].reaction[0] - 100.0).abs() < 1e-8);
        assert!(
            (compression.nodes[0].reaction[2]
                - (30.0 - 100.0 * compression.nodes[1].displacement[1]))
                .abs()
                < 1e-8
        );
        assert!(
            compression.members[0]
                .bending_moment_knm
                .last()
                .unwrap()
                .abs()
                < 1e-8
        );
    }

    #[test]
    fn p_delta_rejects_compression_above_euler_cantilever_load() {
        let mut input = cantilever();
        input.analysis = Analysis::Geometric;
        // Pcr = pi² EI/(4 L²) = 460.6 kN for this one-element column.
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: -600.0,
            fy: -1.0,
            mz: 0.0,
        });
        assert!(solve(&input)
            .unwrap_err()
            .contains("non-positive free stiffness"));
    }

    #[test]
    fn documented_cantilever_example_matches_closed_form() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-cantilever.json")).unwrap();
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!((result.nodes[1].displacement[1] + 10.0 * 27.0 / (3.0 * ei)).abs() < 1e-12);
        assert!((result.nodes[1].displacement[2] + 10.0 * 9.0 / (2.0 * ei)).abs() < 1e-12);
        assert!((result.nodes[0].reaction[1] - 10.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 30.0).abs() < 1e-10);
    }

    #[test]
    fn released_tip_rotation_recovers_cantilever_response_despite_fixed_joint_rotation() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!((result.nodes[1].displacement[1] + 10.0 * 27.0 / (3.0 * ei)).abs() < 1e-11);
        assert_eq!(result.nodes[1].displacement[2], 0.0);
        assert!(
            (result.members[0].rotation_rad.last().unwrap() + 10.0 * 9.0 / (2.0 * ei)).abs()
                < 1e-11
        );
        assert!(result.members[0].local_end_forces[5].abs() < 1e-9);
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-9);
    }

    #[test]
    fn two_end_releases_condense_distributed_load_and_inactive_rotations() {
        let mut input = cantilever();
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.members[0].releases = EndReleases {
            rz_start: true,
            rz_end: true,
            ..EndReleases::default()
        };
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        assert!((result.nodes[0].reaction[1] - 7.5).abs() < 1e-9);
        assert!((result.nodes[1].reaction[1] - 7.5).abs() < 1e-9);
        assert!(result.members[0].local_end_forces[2].abs() < 1e-9);
        assert!(result.members[0].local_end_forces[5].abs() < 1e-9);
        assert!((result.members[0].bending_moment_knm[10] - 5.0 * 9.0 / 8.0).abs() < 1e-9);
        input.analysis = Analysis::Geometric;
        let geometric = solve(&input).unwrap();
        assert!((geometric.members[0].bending_moment_knm[10] - 5.0 * 9.0 / 8.0).abs() < 1e-9);
    }

    #[test]
    fn p_delta_with_released_tip_recovers_beam_column_solution() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        input.analysis = Analysis::Geometric;
        input.nodal_loads[0].fx = -100.0;
        let result = solve(&input).unwrap();
        let wave = (100.0_f64 / (210_000.0 * 1000.0 * 8e-6)).sqrt();
        let exact = -10.0 / (100.0 * wave) * ((3.0 * wave).tan() - 3.0 * wave);
        assert!((result.nodes[1].displacement[1] / exact - 1.0).abs() < 0.001);
        assert!(result.members[0].local_end_forces[5].abs() < 1e-8);
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-8);
        assert!(result.equilibrium_residual < 1e-8);
        input.nodal_loads[0].fx = -600.0;
        assert!(solve(&input)
            .unwrap_err()
            .contains("non-positive free stiffness"));
    }

    #[test]
    fn material_path_with_release_scales_member_load_and_recovers_rotation() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        input.analysis = Analysis::Material;
        input.load_path = vec![0.5];
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let material = solve(&input).unwrap();
        input.analysis = Analysis::Linear;
        input.load_path.clear();
        input.nodal_loads[0].fy *= 0.5;
        input.member_loads[0].qy_start_kn_per_m *= 0.5;
        input.member_loads[0].qy_end_kn_per_m *= 0.5;
        let reference = solve(&input).unwrap();
        assert!(
            (material.nodes[1].displacement[1] - reference.nodes[1].displacement[1]).abs() < 1e-10
        );
        assert!(
            (material.members[0].rotation_rad.last().unwrap()
                - reference.members[0].rotation_rad.last().unwrap())
            .abs()
                < 1e-10
        );
        assert!(material.members[0].local_end_forces[5].abs() < 1e-9);
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(
            (combined.nodes[1].displacement[1] - reference.nodes[1].displacement[1]).abs() < 1e-10
        );
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-9);
    }

    #[test]
    fn combined_release_with_member_load_matches_elastic_p_delta() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-released-cantilever.json"))
                .unwrap();
        input.nodal_loads[0].fx = -100.0;
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -2.0,
            qy_end_kn_per_m: -2.0,
            start_position_m: None,
            end_position_m: None,
        });
        input.analysis = Analysis::Geometric;
        let geometric = solve(&input).unwrap();
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(
            (combined.nodes[1].displacement[1] - geometric.nodes[1].displacement[1]).abs() < 1e-8
        );
        assert!((combined.nodes[0].reaction[2] - geometric.nodes[0].reaction[2]).abs() < 1e-7);
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-8);
        assert!(combined.equilibrium_residual < 1e-8);
    }

    #[test]
    fn combined_release_retains_steel_plasticity_and_tension_stiffening() {
        let mut input: Request = serde_json::from_str(include_str!(
            "../examples/frame2d-combined-released-steel.json"
        ))
        .unwrap();
        input.analysis = Analysis::Material;
        let material = solve(&input).unwrap();
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(combined.nodes[1].displacement[0] > 0.0);
        assert!(material.nodes[1].displacement[0] > 0.0);
        assert!(combined.nodes[1].displacement[1] > material.nodes[1].displacement[1]);
        assert!(
            combined.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                > 0.0
        );
        assert!((combined.members[0].normal_force_kn[0] - 1500.0).abs() < 1e-5);
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-7);
        assert!(combined.equilibrium_residual < 1e-7);
        assert!(
            combined.iterations > 60,
            "the unload path should cut back a transient unstable Newton trial"
        );
    }

    #[test]
    fn uniform_load_and_midspan_point_force_match_resultants() {
        let mut input = cantilever();
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 0.0,
            py_kn: -4.0,
            position_m: 1.5,
        });
        let result = solve(&input).unwrap();
        assert!((result.nodes[0].reaction[1] - 19.0).abs() < 1e-10);
        assert!((result.nodes[0].reaction[2] - 28.5).abs() < 1e-10);
        assert!((result.members[0].local_end_forces[1] - 19.0).abs() < 1e-10);
        let stations = &result.members[0].stations_m;
        let jump = stations
            .windows(2)
            .position(|pair| (pair[0] - 1.5).abs() < 1e-12 && (pair[1] - 1.5).abs() < 1e-12)
            .unwrap();
        assert!(
            (result.members[0].shear_force_kn[jump + 1] - result.members[0].shear_force_kn[jump]
                + 4.0)
                .abs()
                < 1e-10
        );
        assert!(result.members[0].bending_moment_knm.last().unwrap().abs() < 1e-10);
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn simply_supported_uniform_load_matches_closed_form_midspan_field() {
        let mut input = cantilever();
        input.supports[0].rz = false;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 0.0,
            qx_end_kn_per_m: 0.0,
            qy_start_kn_per_m: -5.0,
            qy_end_kn_per_m: -5.0,
            start_position_m: None,
            end_position_m: None,
        });
        let result = solve(&input).unwrap();
        let ei = 210_000.0 * 1000.0 * 8e-6;
        assert!(
            (result.members[0].deflection_m[10] + 5.0 * 5.0 * 3.0_f64.powi(4) / (384.0 * ei)).abs()
                < 1e-12
        );
        assert!(
            (result.members[0].bending_moment_knm[10] - 5.0 * 3.0_f64.powi(2) / 8.0).abs() < 1e-10
        );
        assert!((result.nodes[0].reaction[1] - 7.5).abs() < 1e-10);
        assert!((result.nodes[1].reaction[1] - 7.5).abs() < 1e-10);
    }

    #[test]
    fn imposed_axial_displacement_gives_ea_delta_over_length() {
        let mut input = cantilever();
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: false,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: Some(0.001),
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        let result = solve(&input).unwrap();
        let expected = 210_000.0 * 1000.0 * 0.01 * 0.001 / 3.0;
        assert!((result.nodes[0].reaction[0] + expected).abs() < 1e-10);
        assert!((result.nodes[1].reaction[0] - expected).abs() < 1e-10);
    }

    #[test]
    fn axial_spring_reaction_completes_force_balance() {
        let mut input = cantilever();
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: false,
            rz: false,
            kx_kn_per_m: Some(700.0),
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 100.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let axial_stiffness = 210_000.0 * 1000.0 * 0.01 / 3.0;
        let displacement = 100.0 / (axial_stiffness + 700.0);
        assert!((result.nodes[1].displacement[0] - displacement).abs() < 1e-12);
        assert!((result.nodes[1].reaction[0] + 700.0 * displacement).abs() < 1e-10);
        assert!((result.nodes[0].reaction[0] + axial_stiffness * displacement).abs() < 1e-10);
        assert!(
            (result
                .nodes
                .iter()
                .map(|node| node.reaction[0])
                .sum::<f64>()
                + 100.0)
                .abs()
                < 1e-10
        );
    }

    #[test]
    fn material_axial_member_point_load_is_split_and_merged_back_to_one_member() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.nodes[1].x = 2.0;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 2550.0,
            py_kn: 0.0,
            position_m: 0.75,
        });
        let result = solve(&input).unwrap();
        assert_eq!(
            result.nodes.len(),
            2,
            "the internal node stays hidden from app output"
        );
        assert_eq!(
            result.members.len(),
            1,
            "the original member identity is retained"
        );
        assert_eq!(result.members[0].member_id, 1);
        let expected_strain = 250.0 / 210_000.0 + 5.0 / (0.02 * 210_000.0);
        assert!(
            (result.nodes[1].displacement[0] - 0.75 * expected_strain).abs() < 1e-8,
            "end displacement {} does not match point displacement {}",
            result.nodes[1].displacement[0],
            0.75 * expected_strain
        );
        let member = &result.members[0];
        let jump: Vec<f64> = member
            .stations_m
            .iter()
            .zip(&member.normal_force_kn)
            .filter(|(station, _)| (**station - 0.75).abs() < 1e-10)
            .map(|(_, force)| *force)
            .collect();
        assert_eq!(
            jump.len(),
            2,
            "the station is retained on both sides of the point load"
        );
        assert!(
            (jump[0] - 2550.0).abs() < 1e-5,
            "left segment carries the applied load"
        );
        assert!(
            jump[1].abs() < 1e-5,
            "the unloaded right segment has zero axial force"
        );
        assert!((result.nodes[0].reaction[0] + 2550.0).abs() < 1e-5);
        assert!((result.nodes[1].reaction[0]).abs() < 1e-5);
        assert!(
            member
                .axial_history
                .as_ref()
                .unwrap()
                .equivalent_plastic_strain
                > 0.0
        );

        input.analysis = Analysis::Linear;
        input.member_point_loads.clear();
        input.member_point_loads.push(MemberPointLoad {
            member_id: 99,
            px_kn: 0.0,
            py_kn: 1.0,
            position_m: 0.5,
        });
        assert!(
            solve(&input).is_err(),
            "unknown point-loaded member is rejected"
        );
    }

    #[test]
    fn material_point_load_split_preserves_clipped_varying_distributed_load() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.nodes[1].x = 3.0;
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 100.0,
            py_kn: 0.0,
            position_m: 1.0,
        });
        input.member_loads.push(MemberLoad {
            member_id: 1,
            qx_start_kn_per_m: 10.0,
            qx_end_kn_per_m: 30.0,
            qy_start_kn_per_m: 0.0,
            qy_end_kn_per_m: 0.0,
            start_position_m: Some(0.5),
            end_position_m: Some(2.5),
        });

        let (expanded, members, hidden_nodes) = expand_material_point_loads(&input).unwrap();
        assert_eq!(members[&1].segments.len(), 2);
        assert_eq!(hidden_nodes.len(), 1);
        assert_eq!(expanded.member_loads.len(), 2);
        let left = &expanded.member_loads[0];
        assert_eq!(left.start_position_m, Some(0.5));
        assert_eq!(left.end_position_m, Some(1.0));
        assert_eq!((left.qx_start_kn_per_m, left.qx_end_kn_per_m), (10.0, 15.0));
        let right = &expanded.member_loads[1];
        assert_eq!(right.start_position_m, Some(0.0));
        assert_eq!(right.end_position_m, Some(1.5));
        assert_eq!(
            (right.qx_start_kn_per_m, right.qx_end_kn_per_m),
            (15.0, 30.0)
        );

        let result = solve(&input).unwrap();
        assert_eq!(result.members.len(), 1);
        assert_eq!(result.nodes.len(), 2);
        assert!((result.nodes[0].reaction[0] + 140.0).abs() < 1e-7);
        assert!(result.equilibrium_residual < 1e-7);
    }

    #[test]
    fn material_axial_point_load_on_skew_member_keeps_global_force_direction() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.nodes[1].x = 3.0;
        input.nodes[1].y = 4.0;
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 100.0,
            py_kn: 0.0,
            position_m: 2.5,
        });

        let result = solve(&input).unwrap();
        assert_eq!(result.members.len(), 1);
        assert_eq!(result.nodes.len(), 2);
        assert!((result.nodes[0].reaction[0] + 60.0).abs() < 1e-7);
        assert!((result.nodes[0].reaction[1] + 80.0).abs() < 1e-7);
        assert!(result.equilibrium_residual < 1e-7);
    }

    #[test]
    fn material_point_load_split_copies_uniform_thermal_strain_to_each_segment() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.member_point_loads.push(MemberPointLoad {
            member_id: 1,
            px_kn: 1e-6,
            py_kn: 0.0,
            position_m: 1.0,
        });
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 100.0,
            alpha_per_k: 1e-5,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });

        let (expanded, members, _) = expand_material_point_loads(&input).unwrap();
        assert_eq!(expanded.thermal_loads.len(), 2);
        assert_eq!(
            expanded
                .thermal_loads
                .iter()
                .map(|load| load.member_id)
                .collect::<Vec<_>>(),
            members[&1]
                .segments
                .iter()
                .map(|segment| segment.member_id)
                .collect::<Vec<_>>()
        );
        let result = solve(&input).unwrap();
        assert!((result.nodes[1].displacement[0] - 0.003).abs() < 1e-9);
    }

    #[test]
    fn steel_axial_load_path_retains_closed_form_plastic_extension() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: 0.0,
            mz: 0.0,
        });
        let loaded = solve(&input).unwrap();
        let expected_strain = 250.0 / 210_000.0 + (300.0 - 250.0) / (0.02 * 210_000.0);
        assert!((loaded.nodes[1].displacement[0] - 3.0 * expected_strain).abs() < 1e-9);
        assert!((loaded.members[0].normal_force_kn[0] - 3000.0).abs() < 1e-6);
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        let expected_plastic = expected_strain - 300.0 / 210_000.0;
        assert!((unloaded.nodes[1].displacement[0] - 3.0 * expected_plastic).abs() < 1e-8);
        assert!(
            (unloaded.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                - expected_plastic)
                .abs()
                < 1e-8
        );
        assert!(unloaded.members[0].normal_force_kn[0].abs() < 1e-6);
        assert!(unloaded.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_load_path_matches_fiber_moment_curvature_solution() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.01,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            mz: 60.0,
        });

        let law = input.materials[0].law;
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let states = [FiberState::default(); 3];
        let moment_at = |curvature| {
            integrate_section(
                input.materials[0].e_mpa,
                law,
                &fibers,
                0.0,
                curvature,
                &states,
            )
            .unwrap()
            .moment_kn_m
        };
        let (mut low, mut high) = (0.0, 5.0);
        assert!(
            moment_at(high) > 60.0,
            "reference curvature must bracket the target moment"
        );
        for _ in 0..100 {
            let mid = 0.5 * (low + high);
            if moment_at(mid) < 60.0 {
                low = mid;
            } else {
                high = mid;
            }
        }
        let expected_rotation = 0.5 * (low + high) * 3.0;
        let result = solve(&input).unwrap();
        let rotation = result.nodes[1].displacement[2];
        assert!(
            (rotation - expected_rotation).abs() < 2e-5,
            "tip rotation {rotation} differs from fiber M-kappa result {expected_rotation}"
        );
        assert!((result.members[0].local_end_forces[5] - 60.0).abs() < 1e-5);
        assert!(rotation > 60.0 * 3.0 / (210_000.0 * 1000.0 * 8e-6));
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn multi_member_fnl_with_variable_modulus_matches_section_curvature() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.nodes = vec![
            Node {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            Node {
                id: 2,
                x: 1.2,
                y: 0.0,
            },
            Node {
                id: 3,
                x: 3.0,
                y: 0.0,
            },
        ];
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.01,
        };
        let moduli = [210_000.0, 170_000.0];
        input.materials = moduli
            .iter()
            .enumerate()
            .map(|(index, &e_mpa)| Material {
                id: index + 1,
                e_mpa,
                law,
            })
            .collect();
        input.members = (0..2)
            .map(|index| Member {
                id: index + 1,
                start_node_id: index + 1,
                end_node_id: index + 2,
                material_id: index + 1,
                section_id: 1,
                releases: EndReleases::default(),
                springs: EndSprings::default(),
                foundation_kn_per_m2: None,
            })
            .collect();
        input.nodal_loads.push(NodalLoad {
            node_id: 3,
            fx: 0.0,
            fy: 0.0,
            mz: 60.0,
        });

        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let mut curvatures = [0.0; 2];
        for (index, &e_mpa) in moduli.iter().enumerate() {
            let moment_at = |curvature| {
                integrate_section(e_mpa, law, &fibers, 0.0, curvature, &virgin)
                    .unwrap()
                    .moment_kn_m
            };
            let (mut low, mut high) = (0.0, 5.0);
            assert!(moment_at(high) > 60.0);
            for _ in 0..100 {
                let mid = 0.5 * (low + high);
                if moment_at(mid) < 60.0 {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            curvatures[index] = 0.5 * (low + high);
        }
        let lengths = [1.2, 1.8];
        let total_length = lengths.iter().sum::<f64>();
        let expected_rotation = curvatures[0] * lengths[0] + curvatures[1] * lengths[1];
        let expected_displacement = curvatures[0]
            * (lengths[0] * total_length - lengths[0].powi(2) / 2.0)
            + curvatures[1] * lengths[1].powi(2) / 2.0;

        let result = solve(&input).unwrap();
        assert!(
            (result.nodes[2].displacement[2] - expected_rotation).abs() < 2e-5,
            "multi-member FNL rotation {} differs from independent section result {expected_rotation}",
            result.nodes[2].displacement[2]
        );
        assert!(
            (result.nodes[2].displacement[1] - expected_displacement).abs() < 2e-4,
            "multi-member FNL displacement {} differs from independent integration {expected_displacement}",
            result.nodes[2].displacement[1]
        );
        assert_eq!(result.members.len(), 2);
        for member in &result.members {
            assert!((member.local_end_forces[5] - 60.0).abs() < 1e-5);
            assert!(
                member
                    .section_history
                    .as_ref()
                    .unwrap()
                    .maximum_equivalent_plastic_strain
                    > 0.0
            );
        }
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_and_axial_force_with_axial_end_spring_match_section_equilibrium() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.01,
        };
        let spring_stiffness = 200_000.0;
        let axial_force_kn = 3_000.0;
        let moment_kn_m = 60.0;
        input.members[0].springs.ux_start_kn_per_m = Some(spring_stiffness);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: axial_force_kn,
            fy: 0.0,
            mz: moment_kn_m,
        });

        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let e = input.materials[0].e_mpa;
        let law = input.materials[0].law;
        let mut strain = axial_force_kn / (e * input.sections[0].area_m2 * 1000.0);
        let mut curvature = moment_kn_m / (e * input.sections[0].inertia_m4 * 1000.0);
        for _ in 0..100 {
            let section = integrate_section(e, law, &fibers, strain, curvature, &virgin).unwrap();
            let residual_n = axial_force_kn - section.axial_kn;
            let residual_m = moment_kn_m - section.moment_kn_m;
            if residual_n.abs() < 1e-9 && residual_m.abs() < 1e-9 {
                break;
            }
            let [[k_nn, k_nm], [k_mn, k_mm]] = section.tangent;
            let determinant = k_nn * k_mm - k_nm * k_mn;
            let delta_strain = (k_mm * residual_n - k_nm * residual_m) / determinant;
            let delta_curvature = (k_nn * residual_m - k_mn * residual_n) / determinant;
            strain += delta_strain;
            curvature += delta_curvature;
        }
        let check = integrate_section(e, law, &fibers, strain, curvature, &virgin).unwrap();
        assert!((check.axial_kn - axial_force_kn).abs() < 1e-6);
        assert!((check.moment_kn_m - moment_kn_m).abs() < 1e-6);

        let result = solve(&input).unwrap();
        let expected_extension = strain * 3.0 + axial_force_kn / spring_stiffness;
        let expected_rotation = curvature * 3.0;
        assert!(
            (result.nodes[1].displacement[0] - expected_extension).abs() < 1e-8,
            "combined axial/bending FNL extension {} differs from section+spring result {expected_extension}",
            result.nodes[1].displacement[0]
        );
        assert!(
            (result.nodes[1].displacement[2] - expected_rotation).abs() < 2e-5,
            "combined axial/bending FNL rotation {} differs from section result {expected_rotation}",
            result.nodes[1].displacement[2]
        );
        assert!((result.members[0].normal_force_kn[10] - axial_force_kn).abs() < 1e-5);
        assert!((result.members[0].local_end_forces[5] - moment_kn_m).abs() < 1e-5);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn concrete_bending_and_axial_force_with_axial_end_spring_match_section_equilibrium() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.02,
        };
        let spring_stiffness = 200_000.0;
        let axial_force_kn = 20.0;
        let moment_kn_m = 1.0;
        input.members[0].springs.ux_start_kn_per_m = Some(spring_stiffness);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: axial_force_kn,
            fy: 0.0,
            mz: moment_kn_m,
        });

        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let e = input.materials[0].e_mpa;
        let law = input.materials[0].law;
        let mut strain = axial_force_kn / (e * input.sections[0].area_m2 * 1000.0);
        let mut curvature = moment_kn_m / (e * input.sections[0].inertia_m4 * 1000.0);
        for _ in 0..100 {
            let section = integrate_section(e, law, &fibers, strain, curvature, &virgin).unwrap();
            let residual_n = axial_force_kn - section.axial_kn;
            let residual_m = moment_kn_m - section.moment_kn_m;
            if residual_n.abs() < 1e-9 && residual_m.abs() < 1e-9 {
                break;
            }
            let [[k_nn, k_nm], [k_mn, k_mm]] = section.tangent;
            let determinant = k_nn * k_mm - k_nm * k_mn;
            let delta_strain = (k_mm * residual_n - k_nm * residual_m) / determinant;
            let delta_curvature = (k_nn * residual_m - k_mn * residual_n) / determinant;
            strain += delta_strain;
            curvature += delta_curvature;
        }
        let check = integrate_section(e, law, &fibers, strain, curvature, &virgin).unwrap();
        assert!((check.axial_kn - axial_force_kn).abs() < 1e-6);
        assert!((check.moment_kn_m - moment_kn_m).abs() < 1e-6);
        assert!(check
            .trial_states
            .iter()
            .any(|state| state.tensile_damage > 0.0));

        let result = solve(&input).unwrap();
        let expected_extension = strain * 3.0 + axial_force_kn / spring_stiffness;
        let expected_rotation = curvature * 3.0;
        assert!(
            (result.nodes[1].displacement[0] - expected_extension).abs() < 1e-8,
            "combined concrete N-M FNL extension {} differs from section+spring result {expected_extension}",
            result.nodes[1].displacement[0]
        );
        assert!(
            (result.nodes[1].displacement[2] - expected_rotation).abs() < 2e-5,
            "combined concrete N-M FNL rotation {} differs from section result {expected_rotation}",
            result.nodes[1].displacement[2]
        );
        assert!((result.members[0].normal_force_kn[10] - axial_force_kn).abs() < 1e-5);
        assert!((result.members[0].local_end_forces[5] - moment_kn_m).abs() < 1e-5);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_tensile_damage
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_with_axial_release_and_thermal_strain_keeps_zero_axial_force() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.01,
        };
        input.members[0].releases.ux_start = true;
        input.supports.push(Support {
            node_id: 2,
            ux: true,
            uy: false,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            mz: 60.0,
        });
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 40.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });

        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let mut low = 0.0;
        let mut high = 5.0;
        for _ in 0..100 {
            let mid = 0.5 * (low + high);
            let section = integrate_section(
                input.materials[0].e_mpa,
                input.materials[0].law,
                &fibers,
                0.0,
                mid,
                &virgin,
            )
            .unwrap();
            if section.moment_kn_m < 60.0 {
                low = mid;
            } else {
                high = mid;
            }
        }
        let expected_rotation = 0.5 * (low + high) * 3.0;

        let result = solve(&input).unwrap();
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .all(|force| force.abs() < 1e-7));
        assert!((result.nodes[1].displacement[2] - expected_rotation).abs() < 2e-5);
        assert!((result.members[0].local_end_forces[5] - 60.0).abs() < 1e-5);
        assert!((result.members[0].axial_disp_m[0] + 0.00144).abs() < 1e-9);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_at_rotational_release_matches_independent_moment_curvature_integration() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-fiber-steel-bending.json"))
                .unwrap();
        input.analysis = Analysis::Material;
        input.members[0].releases.rz_end = true;
        input.nodal_loads[0].mz = 0.0;
        input.nodal_loads[0].fy = -10.0;

        let element_length = 3.0;
        let applied_force = input.nodal_loads[0].fy;
        let law = input.materials[0].law;
        let e_mpa = input.materials[0].e_mpa;
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let curvature_at = |moment: f64| {
            let sign = moment.signum();
            let target = moment.abs();
            let moment_response = |curvature| {
                integrate_section(e_mpa, law, &fibers, 0.0, curvature, &virgin)
                    .unwrap()
                    .moment_kn_m
            };
            let (mut low, mut high) = (0.0, 5.0);
            for _ in 0..100 {
                let mid = 0.5 * (low + high);
                if moment_response(mid) < target {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            sign * 0.5 * (low + high)
        };

        // The member-side moment falls linearly to zero at the released end.
        // Integrate the resulting curvature independently with a fine midpoint
        // rule, solving M-kappa at every station.
        let divisions = 4_000;
        let dx = element_length / divisions as f64;
        let mut expected_displacement = 0.0;
        for index in 0..divisions {
            let x = (index as f64 + 0.5) * dx;
            let moment = applied_force * (element_length - x);
            expected_displacement += curvature_at(moment) * (element_length - x) * dx;
        }

        let result = solve(&input).unwrap();
        let actual_displacement = result.nodes[1].displacement[1];
        assert!(
            (actual_displacement - expected_displacement).abs() < 2e-4,
            "released-end tip displacement {actual_displacement} differs from independent M-kappa integration {expected_displacement}"
        );
        assert!(result.members[0].local_end_forces[5].abs() < 1e-7);
        assert!((result.nodes[0].reaction[1] + applied_force).abs() < 1e-7);
        assert!(result.equilibrium_residual < 1e-6);

        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!((combined.nodes[1].displacement[1] - actual_displacement).abs() < 1e-8);
        assert!(combined.members[0].local_end_forces[5].abs() < 1e-7);
        assert!(combined.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_with_rotational_spring_matches_independent_moment_curvature_integration() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-fiber-steel-bending.json"))
                .unwrap();
        input.analysis = Analysis::Material;
        input.nodal_loads[0].mz = 0.0;
        input.nodal_loads[0].fy = -20.0;
        input.members[0].springs.rz_start_knm_per_rad = Some(3500.0);

        let length = 3.0;
        let applied_force = input.nodal_loads[0].fy;
        let spring_stiffness = input.members[0].springs.rz_start_knm_per_rad.unwrap();
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let curvature_at = |moment: f64| {
            let sign = moment.signum();
            let target = moment.abs();
            let moment_response = |curvature| {
                integrate_section(
                    input.materials[0].e_mpa,
                    input.materials[0].law,
                    &fibers,
                    0.0,
                    curvature,
                    &virgin,
                )
                .unwrap()
                .moment_kn_m
            };
            let (mut low, mut high) = (0.0, 5.0);
            for _ in 0..100 {
                let mid = 0.5 * (low + high);
                if moment_response(mid) < target {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            sign * 0.5 * (low + high)
        };
        let divisions = 4_000;
        let dx = length / divisions as f64;
        let mut beam_displacement = 0.0;
        for index in 0..divisions {
            let x = (index as f64 + 0.5) * dx;
            let moment = applied_force * (length - x);
            beam_displacement += curvature_at(moment) * (length - x) * dx;
        }
        let spring_rotation = applied_force * length / spring_stiffness;
        let expected_tip_displacement = beam_displacement + spring_rotation * length;

        let mesh_elements = 16;
        let prototype = input.members[0].clone();
        input.nodes = (0..=mesh_elements)
            .map(|index| Node {
                id: index + 1,
                x: length * index as f64 / mesh_elements as f64,
                y: 0.0,
            })
            .collect();
        input.members = (0..mesh_elements)
            .map(|index| {
                let mut member = prototype.clone();
                member.id = index + 1;
                member.start_node_id = index + 1;
                member.end_node_id = index + 2;
                if index > 0 {
                    member.springs = EndSprings::default();
                }
                member
            })
            .collect();
        input.nodal_loads[0].node_id = mesh_elements + 1;

        let result = solve(&input).unwrap();
        let actual = result.nodes[mesh_elements].displacement[1];
        assert!(
            (actual - expected_tip_displacement).abs() < 1e-3,
            "rotational spring tip displacement {actual} differs from independent M-kappa plus spring result {expected_tip_displacement}"
        );
        assert!((result.members[0].local_end_forces[2] - 60.0).abs() < 1e-5);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_with_transverse_end_spring_matches_independent_integration() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-fiber-steel-bending.json"))
                .unwrap();
        input.analysis = Analysis::Material;
        input.nodal_loads[0].mz = 0.0;
        input.nodal_loads[0].fy = -20.0;

        let length = 3.0;
        let applied_force = input.nodal_loads[0].fy;
        let spring_stiffness = 500.0;
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let curvature_at = |moment: f64| {
            let sign = moment.signum();
            let target = moment.abs();
            let moment_response = |curvature| {
                integrate_section(
                    input.materials[0].e_mpa,
                    input.materials[0].law,
                    &fibers,
                    0.0,
                    curvature,
                    &virgin,
                )
                .unwrap()
                .moment_kn_m
            };
            let (mut low, mut high) = (0.0, 5.0);
            for _ in 0..100 {
                let mid = 0.5 * (low + high);
                if moment_response(mid) < target {
                    low = mid;
                } else {
                    high = mid;
                }
            }
            sign * 0.5 * (low + high)
        };

        let divisions = 4_000;
        let dx = length / divisions as f64;
        let mut beam_displacement = 0.0;
        for index in 0..divisions {
            let x = (index as f64 + 0.5) * dx;
            let moment = applied_force * (length - x);
            beam_displacement += curvature_at(moment) * (length - x) * dx;
        }
        let expected = beam_displacement + applied_force / spring_stiffness;

        let mesh_elements = 16;
        let prototype = input.members[0].clone();
        input.nodes = (0..=mesh_elements)
            .map(|index| Node {
                id: index + 1,
                x: length * index as f64 / mesh_elements as f64,
                y: 0.0,
            })
            .collect();
        input.members = (0..mesh_elements)
            .map(|index| {
                let mut member = prototype.clone();
                member.id = index + 1;
                member.start_node_id = index + 1;
                member.end_node_id = index + 2;
                member.springs = EndSprings::default();
                if index + 1 == mesh_elements {
                    member.springs.uy_end_kn_per_m = Some(spring_stiffness);
                }
                member
            })
            .collect();
        input.nodal_loads[0].node_id = mesh_elements + 1;

        let result = solve(&input).unwrap();
        let actual = result.nodes[mesh_elements].displacement[1];
        assert!(
            (actual - expected).abs() < 1e-3,
            "transverse spring tip displacement {actual} differs from independent M-kappa plus spring result {expected}"
        );
        assert!(result.members[mesh_elements - 1].local_end_forces[5].abs() < 1e-5);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_bending_with_transverse_release_matches_section_curvature() {
        let mut input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-fiber-steel-bending.json"))
                .unwrap();
        input.analysis = Analysis::Material;
        input.members[0].releases.uy_end = true;
        input.nodal_loads[0].fy = 0.0;
        input.nodal_loads[0].mz = 60.0;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });

        let length = 3.0;
        let moment = input.nodal_loads[0].mz;
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let section_moment = |curvature| {
            integrate_section(
                input.materials[0].e_mpa,
                input.materials[0].law,
                &fibers,
                0.0,
                curvature,
                &virgin,
            )
            .unwrap()
            .moment_kn_m
        };
        let (mut low, mut high) = (0.0, 5.0);
        for _ in 0..100 {
            let mid = 0.5 * (low + high);
            if section_moment(mid) < moment {
                low = mid;
            } else {
                high = mid;
            }
        }
        let expected_rotation = 0.5 * (low + high) * length;

        let result = solve(&input).unwrap();
        assert!(
            (result.nodes[1].displacement[2] - expected_rotation).abs() < 2e-4,
            "transverse-release end rotation {} differs from section-curvature result {expected_rotation}",
            result.nodes[1].displacement[2]
        );
        assert!(result.members[0].local_end_forces[4].abs() < 1e-7);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_equivalent_plastic_strain
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn concrete_bending_with_transverse_release_matches_section_curvature() {
        let mut input: Request = serde_json::from_str(include_str!(
            "../examples/frame2d-fiber-concrete-bending.json"
        ))
        .unwrap();
        input.members[0].releases.uy_end = true;
        input.nodal_loads[0].fy = 0.0;
        input.nodal_loads[0].mz = 2.0;
        input.supports.push(Support {
            node_id: 2,
            ux: false,
            uy: true,
            rz: false,
            kx_kn_per_m: None,
            ky_kn_per_m: None,
            krz_knm_per_rad: None,
            ux_prescribed_m: None,
            uy_prescribed_m: None,
            rz_prescribed_rad: None,
        });

        let length = 3.0;
        let moment = input.nodal_loads[0].mz;
        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let section_moment = |curvature| {
            // Concrete tension damage makes N-M response coupled. At each
            // curvature solve the free axial strain for zero normal force.
            let response_at = |axial_strain| {
                integrate_section(
                    input.materials[0].e_mpa,
                    input.materials[0].law,
                    &fibers,
                    axial_strain,
                    curvature,
                    &virgin,
                )
                .unwrap()
            };
            let (mut axial_low, mut axial_high) = (-0.01, 0.01);
            for _ in 0..100 {
                let axial_mid = 0.5 * (axial_low + axial_high);
                if response_at(axial_mid).axial_kn < 0.0 {
                    axial_low = axial_mid;
                } else {
                    axial_high = axial_mid;
                }
            }
            response_at(0.5 * (axial_low + axial_high)).moment_kn_m
        };
        let (mut low, mut high) = (0.0, 5.0);
        for _ in 0..100 {
            let mid = 0.5 * (low + high);
            if section_moment(mid) < moment {
                low = mid;
            } else {
                high = mid;
            }
        }
        let expected_rotation = 0.5 * (low + high) * length;

        let result = solve(&input).unwrap();
        assert!(
            (result.nodes[1].displacement[2] - expected_rotation).abs() < 2e-4,
            "concrete transverse-release end rotation {} differs from section-curvature result {expected_rotation}",
            result.nodes[1].displacement[2]
        );
        assert!(result.members[0].local_end_forces[4].abs() < 1e-7);
        assert!(
            result.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_tensile_damage
                > 0.0
        );
        assert!(result.equilibrium_residual < 1e-6);
    }

    #[test]
    fn concrete_bending_tracks_fiber_cracking_through_unloading() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        let law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.02,
        };
        input.materials[0].law = law;
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            mz: 0.6,
        });

        let fibers =
            equivalent_rectangular_fibers(input.sections[0].area_m2, input.sections[0].inertia_m4)
                .unwrap();
        let virgin = [FiberState::default(); 3];
        let moment_at = |curvature: f64| {
            let axial_at = |strain: f64| {
                integrate_section(30_000.0, law, &fibers, strain, curvature, &virgin)
                    .unwrap()
                    .axial_kn
            };
            let (mut low_strain, mut high_strain) = (-0.1, 0.1);
            for _ in 0..80 {
                let mid = 0.5 * (low_strain + high_strain);
                if axial_at(mid) < 0.0 {
                    low_strain = mid;
                } else {
                    high_strain = mid;
                }
            }
            let axial_strain = 0.5 * (low_strain + high_strain);
            integrate_section(30_000.0, law, &fibers, axial_strain, curvature, &virgin)
                .unwrap()
                .moment_kn_m
        };
        let (mut low, mut high) = (0.0, 0.5);
        assert!(
            moment_at(high) > 0.6,
            "reference curvature must bracket the target moment"
        );
        for _ in 0..80 {
            let mid = 0.5 * (low + high);
            if moment_at(mid) < 0.6 {
                low = mid;
            } else {
                high = mid;
            }
        }
        let expected_rotation = 0.5 * (low + high) * 3.0;
        let loaded = solve(&input).unwrap();
        assert!((loaded.nodes[1].displacement[2] - expected_rotation).abs() < 2e-5);
        assert!(
            loaded.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_tensile_damage
                > 0.0
        );
        assert!(loaded.equilibrium_residual < 1e-6);

        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        assert!(unloaded.nodes[1].displacement[2].abs() < 1e-8);
        assert!(
            unloaded.members[0]
                .section_history
                .as_ref()
                .unwrap()
                .maximum_tensile_damage
                > 0.0
        );
        assert!(unloaded.equilibrium_residual < 1e-6);
    }

    #[test]
    fn steel_plasticity_and_unloading_include_both_axial_end_springs() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        input.members[0].springs.ux_end_kn_per_m = Some(100_000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: 0.0,
            mz: 0.0,
        });
        let loaded = solve(&input).unwrap();
        let material_strain = 250.0 / 210_000.0 + 50.0 / (0.02 * 210_000.0);
        let start_spring_extension = 3000.0 / 200_000.0;
        let end_spring_extension = 3000.0 / 100_000.0;
        assert!(
            (loaded.nodes[1].displacement[0]
                - 3.0 * material_strain
                - start_spring_extension
                - end_spring_extension)
                .abs()
                < 1e-8
        );
        assert!((loaded.members[0].axial_disp_m[0] - start_spring_extension).abs() < 1e-8);
        assert!(
            (loaded.members[0].axial_disp_m[20]
                - (loaded.nodes[1].displacement[0] - end_spring_extension))
                .abs()
                < 1e-8
        );
        assert!((loaded.members[0].normal_force_kn[0] - 3000.0).abs() < 1e-6);
        assert!(
            (loaded.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .plastic_strain
                - (material_strain - 300.0 / 210_000.0))
                .abs()
                < 1e-8
        );
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        let permanent_strain = material_strain - 300.0 / 210_000.0;
        assert!((unloaded.nodes[1].displacement[0] - 3.0 * permanent_strain).abs() < 1e-8);
        assert!(unloaded.members[0].normal_force_kn[0].abs() < 1e-6);
        assert!(unloaded.members[0].axial_disp_m[0].abs() < 1e-8);
        assert!(unloaded.equilibrium_residual < 1e-6);
    }

    #[test]
    fn concrete_cracking_response_includes_axial_end_spring_extension() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.05,
        };
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 100.0,
            fy: 0.0,
            mz: 0.0,
        });
        let result = solve(&input).unwrap();
        let stress = 100.0 / 10.0;
        let strain = 3.0 / 30_000.0 + (stress - 3.0) / (0.05 * 30_000.0);
        let expected = 3.0 * strain + 100.0 / 200_000.0;
        assert!((result.nodes[1].displacement[0] - expected).abs() < 1e-8);
        assert!((result.members[0].normal_force_kn[10] - 100.0).abs() < 1e-6);
        let elastic_stress = 30_000.0 * strain;
        assert!(
            (result.members[0]
                .axial_history
                .as_ref()
                .unwrap()
                .tensile_damage
                - (1.0 - stress / elastic_stress))
                .abs()
                < 1e-10
        );
    }

    #[test]
    fn thermal_expansion_with_axial_end_spring_uses_series_restraint() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        fixed_end(&mut input);
        input.members[0].springs.ux_start_kn_per_m = Some(200_000.0);
        let delta_t = 40.0;
        let alpha = 12e-6;
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: delta_t,
            alpha_per_k: alpha,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let result = solve(&input).unwrap();
        let ea = 210_000.0 * 1000.0 * 0.01;
        let expected_force = -alpha * delta_t * 3.0 / (3.0 / ea + 1.0 / 200_000.0);
        assert!((result.members[0].normal_force_kn[10] - expected_force).abs() < 1e-6);
        assert!(
            (result.nodes[0].reaction[0] + expected_force).abs() < 1e-6,
            "root reaction={}, expected={}, normal force={}, displacements={:?}",
            result.nodes[0].reaction[0],
            -expected_force,
            result.members[0].normal_force_kn[10],
            [
                result.nodes[0].displacement[0],
                result.nodes[1].displacement[0]
            ]
        );
        assert!(
            (result.nodes[1].reaction[0] - expected_force).abs() < 1e-6,
            "tip reaction={}, expected={}, normal force={}, displacements={:?}",
            result.nodes[1].reaction[0],
            expected_force,
            result.members[0].normal_force_kn[10],
            [
                result.nodes[0].displacement[0],
                result.nodes[1].displacement[0]
            ]
        );
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn material_analysis_recovers_free_thermal_strain_at_axial_release() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        fixed_end(&mut input);
        input.members[0].releases.ux_start = true;
        input.thermal_loads.push(ThermalLoad {
            member_id: 1,
            delta_t_k: 40.0,
            alpha_per_k: 12e-6,
            delta_t_gradient_k: 0.0,
            depth_m: None,
        });
        let result = solve(&input).unwrap();
        assert!(result.members[0]
            .normal_force_kn
            .iter()
            .all(|n| n.abs() < 1e-8));
        assert!((result.members[0].axial_disp_m[0] + 0.00144).abs() < 1e-12);
        assert!(result.members[0].axial_disp_m[20].abs() < 1e-12);
        assert!(result
            .nodes
            .iter()
            .all(|node| node.reaction[0].abs() < 1e-8));
        assert!(result.equilibrium_residual < 1e-10);
    }

    #[test]
    fn documented_steel_unload_example_matches_closed_form() {
        let input: Request =
            serde_json::from_str(include_str!("../examples/frame2d-steel-unload.json")).unwrap();
        let result = solve(&input).unwrap();
        assert!((result.nodes[1].displacement[0] - 0.035).abs() < 1e-8);
        assert!(result.members[0].normal_force_kn[0].abs() < 1e-6);
    }

    #[test]
    fn concrete_axial_damage_persists_after_unloading() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].e_mpa = 30_000.0;
        input.materials[0].law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.2,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 60.0,
            fy: 0.0,
            mz: 0.0,
        });
        input.load_path = vec![1.0, 0.0];
        let unloaded = solve(&input).unwrap();
        let history = unloaded.members[0].axial_history.as_ref().unwrap();
        assert!(history.tensile_damage > 0.0);
        assert!(unloaded.nodes[1].displacement[0].abs() < 1e-8);
        assert!(unloaded.equilibrium_residual < 1e-6);
        input.load_path.push(0.5);
        let reloaded = solve(&input).unwrap();
        let reloaded_history = reloaded.members[0].axial_history.as_ref().unwrap();
        assert!((reloaded_history.tensile_damage - 2.0 / 3.0).abs() < 1e-8);
        assert!((reloaded_history.tangent_e_mpa - 10_000.0).abs() < 1e-7);
        assert!((reloaded.nodes[1].displacement[0] - 0.0009).abs() < 1e-9);
    }

    #[test]
    fn combined_material_and_geometry_uses_current_axial_force() {
        let mut input = cantilever();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.02,
        };
        input.nodal_loads.push(NodalLoad {
            node_id: 2,
            fx: 3000.0,
            fy: -10.0,
            mz: 0.0,
        });
        let material = solve(&input).unwrap();
        input.analysis = Analysis::Combined;
        let combined = solve(&input).unwrap();
        assert!(combined.nodes[1].displacement[1] > material.nodes[1].displacement[1]);
        assert!((combined.members[0].normal_force_kn[0] - 3000.0).abs() < 1e-5);
        assert!(combined.members[0].bending_moment_knm.last().unwrap().abs() < 1e-6);
        assert!(combined.equilibrium_residual < 1e-7);
    }

    #[test]
    fn combined_gnl_fnl_cantilever_matches_independent_beam_column_solution() {
        // An elastic cantilever carries the known flexural stiffness while a
        // parallel, rotation-released steel tie yields axially. Both members
        // contribute their current axial force to P-Delta, but the released
        // tie has no flexural stiffness. This separates the closed-form
        // beam-column benchmark from the material return mapping.
        let length = 2.0;
        let compression_kn = 200.0;
        let tip_force_kn = -10.0;
        let e_mpa = 210_000.0;
        let inertia_m4 = 1e-3;
        let fnl_area_m2 = 1e-4;
        let yield_mpa = 5.0;
        let hardening_ratio = 0.5;
        let mut mesh_errors = Vec::new();

        for segments in [4, 8, 16] {
            let nodes: Vec<Node> = (0..=segments)
                .map(|index| Node {
                    id: index + 1,
                    x: length * index as f64 / segments as f64,
                    y: 0.0,
                })
                .collect();
            let mut members = Vec::with_capacity(2 * segments);
            for index in 0..segments {
                let start_node_id = index + 1;
                let end_node_id = index + 2;
                members.push(Member {
                    id: 2 * index + 1,
                    start_node_id,
                    end_node_id,
                    material_id: 1,
                    section_id: 1,
                    releases: EndReleases::default(),
                    springs: EndSprings::default(),
                    foundation_kn_per_m2: None,
                });
                members.push(Member {
                    id: 2 * index + 2,
                    start_node_id,
                    end_node_id,
                    material_id: 2,
                    section_id: 2,
                    releases: EndReleases {
                        rz_start: true,
                        rz_end: true,
                        ..EndReleases::default()
                    },
                    springs: EndSprings::default(),
                    foundation_kn_per_m2: None,
                });
            }
            let mut input = cantilever();
            input.analysis = Analysis::Combined;
            input.nodes = nodes;
            input.materials = vec![
                Material {
                    id: 1,
                    e_mpa,
                    law: MaterialLaw::Elastic,
                },
                Material {
                    id: 2,
                    e_mpa,
                    law: MaterialLaw::SteelBilinear {
                        yield_mpa,
                        hardening_ratio,
                    },
                },
            ];
            input.sections = vec![
                Section {
                    id: 1,
                    area_m2: 0.01,
                    inertia_m4,
                },
                Section {
                    id: 2,
                    area_m2: fnl_area_m2,
                    inertia_m4: 1e-9,
                },
            ];
            input.members = members;
            input.supports[0].node_id = 1;
            input.nodal_loads = vec![NodalLoad {
                node_id: segments + 1,
                fx: -compression_kn,
                fy: tip_force_kn,
                mz: 0.0,
            }];
            input.load_path = vec![1.0];

            let result = solve(&input).unwrap();
            let plastic_tie = result
                .members
                .iter()
                .find(|member| member.member_id == 2 * segments)
                .unwrap();
            let plastic_history = plastic_tie.axial_history.as_ref().unwrap();
            assert!(plastic_history.equivalent_plastic_strain > 0.0);
            assert!(result.equilibrium_residual < 1e-7);

            // Closed-form elastic beam-column cantilever with compressive N
            // and a transverse tip force Q: w(L)=Q/N·(tan(kL)/k−L),
            // k²=N/(E·I). The yielded tie only supplies axial force.
            let k = (compression_kn / (e_mpa * 1000.0 * inertia_m4)).sqrt();
            let exact_tip = tip_force_kn / compression_kn * ((k * length).tan() / k - length);
            let calculated_tip = result.nodes[segments].displacement[1];
            mesh_errors.push((calculated_tip - exact_tip).abs() / exact_tip.abs());
        }
        assert!(
            mesh_errors[2] < mesh_errors[1],
            "mesh errors did not decrease: {mesh_errors:?}"
        );
        assert!(
            mesh_errors[2] < 0.01,
            "GNL/FNL differs from beam-column solution: {mesh_errors:?}"
        );
    }
}
