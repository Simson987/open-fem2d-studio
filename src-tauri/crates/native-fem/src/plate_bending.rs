//! Three-node Discrete Kirchhoff Triangle (DKT) for elastic and secant-E plate bending.
//! Nodal DOFs are [w, theta_x, theta_y], with theta_x=-dw/dy and theta_y=dw/dx.
//! Geometry is in m, E in MPa, forces in kN and moments in kN m.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::math::{check_sparse_inertia_if_fits, constrained_solve, Matrix};
use crate::positive;
use crate::quad2d::{ModulusCurve, OrthotropicMaterial};

fn default_tolerance() -> f64 {
    1e-8
}

fn default_iterations() -> usize {
    40
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinearBackend {
    #[default]
    Existing,
    FrontalWave,
}

pub(crate) fn add_support_spring_stiffness(springs: &[(usize, f64)], matrix: &mut Matrix) {
    for &(dof, stiffness) in springs {
        matrix.add(dof, dof, stiffness);
    }
}

pub(crate) fn support_spring_reaction(
    springs: &[(usize, f64)],
    displacement: &[f64],
    dof: usize,
) -> f64 {
    -springs
        .iter()
        .filter(|(spring_dof, _)| *spring_dof == dof)
        .map(|(_, stiffness)| stiffness * displacement[dof])
        .sum::<f64>()
}

pub(crate) fn collect_support_springs(
    supports: &[Support],
    node_index: &HashMap<usize, usize>,
    dofs_per_node: usize,
    offsets: [usize; 3],
) -> Result<Vec<(usize, f64)>, String> {
    let mut springs = Vec::new();
    let mut fixed_dofs = HashSet::new();
    for support in supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown plate support node")?;
        for (fixed, stiffness, offset, label) in [
            (support.w, support.kw_kn_per_m, offsets[0], "w"),
            (
                support.theta_x,
                support.ktheta_x_knm_per_rad,
                offsets[1],
                "thetaX",
            ),
            (
                support.theta_y,
                support.ktheta_y_knm_per_rad,
                offsets[2],
                "thetaY",
            ),
        ] {
            let dof = dofs_per_node * index + offset;
            if fixed {
                fixed_dofs.insert(dof);
            }
            if let Some(stiffness) = stiffness {
                positive(stiffness, "plate support spring stiffness")?;
                if fixed {
                    return Err(format!(
                        "plate support node {} is both fixed and spring-supported in {label}",
                        support.node_id
                    ));
                }
                springs.push((dof, stiffness));
            }
        }
    }
    if let Some((dof, _)) = springs.iter().find(|(dof, _)| fixed_dofs.contains(dof)) {
        let node_index_for_dof = dof / dofs_per_node;
        let node_id = node_index
            .iter()
            .find_map(|(id, index)| (*index == node_index_for_dof).then_some(*id))
            .unwrap_or_default();
        let offset = dof % dofs_per_node;
        let label = offsets
            .iter()
            .position(|candidate| *candidate == offset)
            .map(|axis| ["w", "thetaX", "thetaY"][axis])
            .unwrap_or("unknown");
        return Err(format!(
            "plate support node {node_id} is both fixed and spring-supported in {label}"
        ));
    }
    Ok(springs)
}

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
    pub nu: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Triangle {
    pub id: usize,
    pub node_ids: [usize; 3],
    pub material_id: usize,
    pub thickness_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Support {
    pub node_id: usize,
    pub w: bool,
    pub theta_x: bool,
    pub theta_y: bool,
    /// Vertical spring stiffness in kN/m.
    #[serde(default)]
    pub kw_kn_per_m: Option<f64>,
    /// Local x rotational spring stiffness in kN m/rad.
    #[serde(default)]
    pub ktheta_x_knm_per_rad: Option<f64>,
    /// Local y rotational spring stiffness in kN m/rad.
    #[serde(default)]
    pub ktheta_y_knm_per_rad: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Load {
    pub node_id: usize,
    pub fz: f64,
    pub mx: f64,
    pub my: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    #[serde(default)]
    pub orthotropic_materials: Vec<OrthotropicMaterial>,
    #[serde(default)]
    pub modulus_curves: Vec<ModulusCurve>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default)]
    pub linear_backend: LinearBackend,
    /// Maximum free DOFs in the active frontal wave; defaults to 4096.
    #[serde(default)]
    pub frontal_max_front_dofs: Option<usize>,
    pub triangles: Vec<Triangle>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: usize,
    pub w_m: f64,
    pub theta_x_rad: f64,
    pub theta_y_rad: f64,
    pub reaction_fz_kn: f64,
    pub reaction_mx_knm: f64,
    pub reaction_my_knm: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementResult {
    pub triangle_id: usize,
    /// [m_x, m_y, m_xy] at the centroid, in kN m / m.
    pub moment_knm_per_m: [f64; 3],
    pub effective_e_mpa: f64,
    pub max_fibre_strain: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBending {
    pub nodes: Vec<NodeResult>,
    pub elements: Vec<ElementResult>,
    pub relative_residual: f64,
    pub linear_backend_used: LinearBackend,
    pub frontal_maximum_front_dofs: Option<usize>,
}

#[derive(Clone, Copy)]
struct Side {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    e: f64,
}

fn side(i: &Node, j: &Node) -> Side {
    let dx = i.x - j.x;
    let dy = i.y - j.y;
    let l2 = dx * dx + dy * dy;
    Side {
        a: -dx / l2,
        b: 0.75 * dx * dy / l2,
        c: (0.25 * dx * dx - 0.5 * dy * dy) / l2,
        d: -dy / l2,
        e: (0.25 * dy * dy - 0.5 * dx * dx) / l2,
    }
}

fn twice_area(nodes: [&Node; 3]) -> f64 {
    (nodes[1].x - nodes[0].x) * (nodes[2].y - nodes[0].y)
        - (nodes[2].x - nodes[0].x) * (nodes[1].y - nodes[0].y)
}

fn max_principal_fibre_strain(curvature: [f64; 3], thickness_m: f64) -> f64 {
    let [kx, ky, engineering_kxy] = curvature;
    let mean = 0.5 * (kx + ky);
    let radius = (0.25 * (kx - ky).powi(2) + 0.25 * engineering_kxy.powi(2)).sqrt();
    (mean.abs() + radius) * thickness_m * 0.5
}

/// Curvature-displacement matrix evaluated at barycentric coordinates.
pub fn b_matrix(nodes: [&Node; 3], l: [f64; 3]) -> Result<[[f64; 9]; 3], String> {
    let area2 = twice_area(nodes);
    if !area2.is_finite() || area2.abs() < 1e-12 {
        return Err("DKT triangle has zero area".into());
    }
    let mut hx = [[0.0; 9]; 3];
    let mut hy = [[0.0; 9]; 3];
    for i in 0..3 {
        hx[i][3 * i + 2] += 4.0 * l[i] - 1.0;
        hy[i][3 * i + 1] -= 4.0 * l[i] - 1.0;
    }
    for (i, j) in [(0, 1), (1, 2), (2, 0)] {
        let s = side(nodes[i], nodes[j]);
        for (direction, derivative) in [(i, 4.0 * l[j]), (j, 4.0 * l[i])] {
            hx[direction][3 * i] -= 1.5 * s.a * derivative;
            hx[direction][3 * j] += 1.5 * s.a * derivative;
            hx[direction][3 * i + 1] += s.b * derivative;
            hx[direction][3 * j + 1] += s.b * derivative;
            hx[direction][3 * i + 2] -= s.c * derivative;
            hx[direction][3 * j + 2] -= s.c * derivative;
            hy[direction][3 * i] -= 1.5 * s.d * derivative;
            hy[direction][3 * j] += 1.5 * s.d * derivative;
            hy[direction][3 * i + 1] += s.e * derivative;
            hy[direction][3 * j + 1] += s.e * derivative;
            hy[direction][3 * i + 2] -= s.b * derivative;
            hy[direction][3 * j + 2] -= s.b * derivative;
        }
    }
    let dx = [
        (nodes[1].y - nodes[2].y) / area2,
        (nodes[2].y - nodes[0].y) / area2,
        (nodes[0].y - nodes[1].y) / area2,
    ];
    let dy = [
        (nodes[2].x - nodes[1].x) / area2,
        (nodes[0].x - nodes[2].x) / area2,
        (nodes[1].x - nodes[0].x) / area2,
    ];
    Ok(std::array::from_fn(|row| {
        std::array::from_fn(|dof| match row {
            0 => (0..3).map(|i| dx[i] * hx[i][dof]).sum(),
            1 => (0..3).map(|i| dy[i] * hy[i][dof]).sum(),
            _ => (0..3)
                .map(|i| dy[i] * hx[i][dof] + dx[i] * hy[i][dof])
                .sum(),
        })
    }))
}

#[cfg(test)]
fn rigidity(
    material: &Material,
    thickness: f64,
    orthotropic: Option<&OrthotropicMaterial>,
) -> [[f64; 3]; 3] {
    rigidity_with_scale(material, thickness, orthotropic, 1.0)
}

fn rigidity_with_scale(
    material: &Material,
    thickness: f64,
    orthotropic: Option<&OrthotropicMaterial>,
    modulus_scale: f64,
) -> [[f64; 3]; 3] {
    if let Some(orthotropic) = orthotropic {
        let scale = thickness.powi(3) / 12.0 * 1000.0 * modulus_scale;
        let e1 = orthotropic.e1_mpa * scale;
        let e2 = orthotropic.e2_mpa * scale;
        let g12 = orthotropic.g12_mpa * scale;
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        let inverse = 1.0 / (1.0 - orthotropic.nu12 * nu21);
        let local = [
            [e1 * inverse, orthotropic.nu12 * e2 * inverse, 0.0],
            [orthotropic.nu12 * e2 * inverse, e2 * inverse, 0.0],
            [0.0, 0.0, g12],
        ];
        let (s, c) = orthotropic.angle_rad.sin_cos();
        let transform = [
            [c * c, s * s, c * s],
            [s * s, c * c, -c * s],
            [-2.0 * c * s, 2.0 * c * s, c * c - s * s],
        ];
        return std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                (0..3)
                    .flat_map(|a| {
                        (0..3).map(move |b| transform[a][i] * local[a][b] * transform[b][j])
                    })
                    .sum()
            })
        });
    }
    let factor = material.e_mpa * modulus_scale * 1000.0 * thickness.powi(3)
        / (12.0 * (1.0 - material.nu * material.nu));
    [
        [factor, factor * material.nu, 0.0],
        [factor * material.nu, factor, 0.0],
        [0.0, 0.0, factor * (1.0 - material.nu) / 2.0],
    ]
}

pub fn element_stiffness(
    nodes: [&Node; 3],
    material: &Material,
    thickness: f64,
) -> Result<[[f64; 9]; 9], String> {
    element_stiffness_with_material(nodes, material, thickness, None)
}

/// Recover the elastic DKT bending-moment resultants at a triangle centroid.
/// `local_u` uses [w, theta_x, theta_y] with theta_x=-dw/dy and theta_y=dw/dx.
/// The returned [Mx, My, Mxy] follows global XY curvature signs, in kN m/m.
pub(crate) fn element_centroid_moment(
    nodes: [&Node; 3],
    material: &Material,
    thickness_m: f64,
    orthotropic: Option<&OrthotropicMaterial>,
    modulus_scale: f64,
    local_u: [f64; 9],
) -> Result<[f64; 3], String> {
    positive(material.e_mpa, "DKT E")?;
    positive(thickness_m, "DKT plate thickness")?;
    positive(modulus_scale, "DKT modulus scale")?;
    if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
        return Err("invalid DKT Poisson ratio".into());
    }
    if local_u.iter().any(|value| !value.is_finite()) {
        return Err("DKT centroid recovery has non-finite displacement".into());
    }
    let b = b_matrix(nodes, [1.0 / 3.0; 3])?;
    let curvature: [f64; 3] =
        std::array::from_fn(|axis| (0..9).map(|dof| b[axis][dof] * local_u[dof]).sum());
    let d = rigidity_with_scale(material, thickness_m, orthotropic, modulus_scale);
    let moment: [f64; 3] = std::array::from_fn(|axis| {
        (0..3)
            .map(|component| d[axis][component] * curvature[component])
            .sum()
    });
    if moment.iter().any(|value| !value.is_finite()) {
        return Err("DKT centroid moment is non-finite".into());
    }
    Ok(moment)
}

fn element_stiffness_with_material(
    nodes: [&Node; 3],
    material: &Material,
    thickness: f64,
    orthotropic: Option<&OrthotropicMaterial>,
) -> Result<[[f64; 9]; 9], String> {
    element_stiffness_with_scale(nodes, material, thickness, orthotropic, 1.0)
}

fn element_stiffness_with_scale(
    nodes: [&Node; 3],
    material: &Material,
    thickness: f64,
    orthotropic: Option<&OrthotropicMaterial>,
    modulus_scale: f64,
) -> Result<[[f64; 9]; 9], String> {
    positive(thickness, "DKT plate thickness")?;
    let area = twice_area(nodes).abs() / 2.0;
    if !area.is_finite() || area < 1e-12 {
        return Err("DKT triangle has zero area".into());
    }
    let d = rigidity_with_scale(material, thickness, orthotropic, modulus_scale);
    let mut k = [[0.0; 9]; 9];
    for gp in [
        [2.0 / 3.0, 1.0 / 6.0, 1.0 / 6.0],
        [1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0],
        [1.0 / 6.0, 1.0 / 6.0, 2.0 / 3.0],
    ] {
        let b = b_matrix(nodes, gp)?;
        for i in 0..9 {
            for j in 0..9 {
                k[i][j] += area / 3.0
                    * (0..3)
                        .flat_map(|a| (0..3).map(move |c| b[a][i] * d[a][c] * b[c][j]))
                        .sum::<f64>();
            }
        }
    }
    // The constitutive matrix is reciprocal. Separate i,j accumulation can
    // differ by roundoff, and a nearly cancelling global CSR entry may then
    // fail sparse LDLT's relative symmetry check. Store each mirrored pair
    // from the same average, without changing the symmetric energy.
    for i in 0..9 {
        for j in i + 1..9 {
            let reciprocal = 0.5 * (k[i][j] + k[j][i]);
            k[i][j] = reciprocal;
            k[j][i] = reciprocal;
        }
    }
    Ok(k)
}

fn frontal_linear_elements(
    request: &Request,
    element_node_indices: &[[usize; 3]],
    materials: &HashMap<usize, &Material>,
    orthotropic_materials: &HashMap<usize, &OrthotropicMaterial>,
    springs: &[(usize, f64)],
) -> Result<Vec<FrontalElement>, String> {
    let mut elements = Vec::with_capacity(request.triangles.len() + springs.len());
    for (element_index, triangle) in request.triangles.iter().enumerate() {
        let material = materials[&triangle.material_id];
        let indices = element_node_indices[element_index];
        let ke = element_stiffness_with_scale(
            indices.map(|i| &request.nodes[i]),
            material,
            triangle.thickness_m,
            orthotropic_materials.get(&triangle.material_id).copied(),
            1.0,
        )?;
        let dofs = (0..9).map(|i| 3 * indices[i / 3] + i % 3).collect();
        let stiffness = ke.into_iter().flatten().collect();
        elements.push(FrontalElement { dofs, stiffness });
    }
    // A spring must enter no later than the last element touching its DOF.
    // Otherwise that DOF might already have been eliminated from the front.
    for &(dof, stiffness) in springs {
        if let Some(element) = elements
            .iter_mut()
            .rev()
            .find(|element| element.dofs.contains(&dof))
        {
            let index = element.dofs.iter().position(|&item| item == dof).unwrap();
            let width = element.dofs.len();
            element.stiffness[index * width + index] += stiffness;
        } else {
            elements.push(FrontalElement {
                dofs: vec![dof],
                stiffness: vec![stiffness],
            });
        }
    }
    Ok(elements)
}

pub fn solve(request: &Request) -> Result<ResultBending, String> {
    if request.nodes.len() < 3 || request.triangles.is_empty() {
        return Err("DKT plate requires nodes and triangles".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id, i))
        .collect();
    if node_index.len() != request.nodes.len() {
        return Err("duplicate DKT node id".into());
    }
    if request
        .nodes
        .iter()
        .any(|node| !node.x.is_finite() || !node.y.is_finite())
    {
        return Err("non-finite DKT coordinate".into());
    }
    let materials: HashMap<usize, &Material> =
        request.materials.iter().map(|m| (m.id, m)).collect();
    if materials.len() != request.materials.len() {
        return Err("duplicate DKT material id".into());
    }
    for material in &request.materials {
        positive(material.e_mpa, "DKT E")?;
        if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
            return Err("invalid DKT Poisson ratio".into());
        }
    }
    let mut orthotropic_materials = HashMap::new();
    for orthotropic in &request.orthotropic_materials {
        if orthotropic_materials
            .insert(orthotropic.material_id, orthotropic)
            .is_some()
        {
            return Err("duplicate orthotropic DKT material id".into());
        }
        let material = materials
            .get(&orthotropic.material_id)
            .ok_or("unknown orthotropic DKT material")?;
        positive(orthotropic.e1_mpa, "orthotropic DKT E1")?;
        positive(orthotropic.e2_mpa, "orthotropic DKT E2")?;
        positive(orthotropic.g12_mpa, "orthotropic DKT G12")?;
        if !orthotropic.nu12.is_finite() || !orthotropic.angle_rad.is_finite() {
            return Err("non-finite orthotropic DKT material parameter".into());
        }
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        if !(1.0 - orthotropic.nu12 * nu21 > 0.0) {
            return Err("orthotropic DKT stiffness is not positive definite".into());
        }
        if (material.e_mpa - orthotropic.e1_mpa).abs() > orthotropic.e1_mpa * 1e-10 {
            return Err("DKT E must equal orthotropic E1".into());
        }
    }
    positive(request.tolerance, "DKT convergence tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid DKT iteration limit".into());
    }
    if request.linear_backend == LinearBackend::FrontalWave && !request.modulus_curves.is_empty() {
        return Err("frontalWave DKT requires elastic material without modulus curves".into());
    }
    let mut modulus_curves = HashMap::new();
    for curve in &request.modulus_curves {
        let material = materials
            .get(&curve.material_id)
            .ok_or("unknown DKT modulus-curve material")?;
        if modulus_curves.insert(curve.material_id, curve).is_some() {
            return Err("duplicate DKT modulus curve".into());
        }
        if curve.points.len() < 2
            || curve.points[0].strain != 0.0
            || (curve.points[0].e_mpa - material.e_mpa).abs() > material.e_mpa * 1e-10
        {
            return Err("DKT modulus curve must start at zero strain and material E".into());
        }
        for point in &curve.points {
            positive(point.e_mpa, "DKT modulus-curve E")?;
            if !point.strain.is_finite() || point.strain < 0.0 {
                return Err("invalid DKT modulus-curve strain".into());
            }
        }
        if curve
            .points
            .windows(2)
            .any(|pair| pair[1].strain <= pair[0].strain || pair[1].e_mpa > pair[0].e_mpa)
        {
            return Err("DKT modulus-curve strain must increase and E must not increase".into());
        }
    }
    let load_path = if request.load_path.is_empty() {
        vec![1.0]
    } else {
        request.load_path.clone()
    };
    if load_path
        .iter()
        .any(|factor| !factor.is_finite() || *factor < 0.0)
    {
        return Err("invalid DKT load path".into());
    }
    let mut element_ids = HashSet::new();
    let mut element_node_indices = Vec::with_capacity(request.triangles.len());
    for triangle in &request.triangles {
        if !element_ids.insert(triangle.id) {
            return Err("duplicate DKT triangle id".into());
        }
        let ids = triangle.node_ids.map(|id| {
            node_index
                .get(&id)
                .copied()
                .ok_or("unknown DKT triangle node")
        });
        let ids = [ids[0]?, ids[1]?, ids[2]?];
        if ids[0] == ids[1] || ids[1] == ids[2] || ids[2] == ids[0] {
            return Err("DKT triangle repeats a node".into());
        }
        materials
            .get(&triangle.material_id)
            .ok_or("unknown DKT material")?;
        positive(triangle.thickness_m, "DKT plate thickness")?;
        element_node_indices.push(ids);
    }
    let springs = collect_support_springs(&request.supports, &node_index, 3, [0, 1, 2])?;
    let dofs = 3 * request.nodes.len();
    let mut prescribed = vec![None; dofs];
    for support in &request.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown DKT support node")?;
        for (axis, fixed) in [support.w, support.theta_x, support.theta_y]
            .iter()
            .enumerate()
        {
            if *fixed {
                prescribed[3 * index + axis] = Some(0.0);
            }
        }
    }
    let mut f = vec![0.0; dofs];
    for load in &request.loads {
        let index = *node_index
            .get(&load.node_id)
            .ok_or("unknown DKT load node")?;
        for (axis, value) in [load.fz, load.mx, load.my].iter().enumerate() {
            f[3 * index + axis] += value;
        }
    }
    let mut effective_e: Vec<f64> = request
        .triangles
        .iter()
        .map(|triangle| materials[&triangle.material_id].e_mpa)
        .collect();
    let mut peak_strains: Vec<f64> = vec![0.0; request.triangles.len()];
    let (u, reaction, frontal_maximum_front_dofs) =
        if request.linear_backend == LinearBackend::FrontalWave {
            let elements = frontal_linear_elements(
                request,
                &element_node_indices,
                &materials,
                &orthotropic_materials,
                &springs,
            )?;
            let final_load: Vec<f64> = f
                .iter()
                .map(|value| value * load_path.last().copied().unwrap_or(1.0))
                .collect();
            let options = FrontalOptions {
                max_front_dofs: request
                    .frontal_max_front_dofs
                    .unwrap_or(FrontalOptions::default().max_front_dofs),
                ..FrontalOptions::default()
            };
            let solved = frontal::solve(&elements, &final_load, &prescribed, options)?;
            (
                solved.displacements,
                solved.reactions,
                Some(solved.maximum_front_dofs),
            )
        } else {
            let mut u = vec![0.0; dofs];
            for &load_factor in &load_path {
                let mut converged = false;
                for _ in 0..request.max_iterations {
                    let mut k = Matrix::zeros(dofs)?;
                    for (element_index, triangle) in request.triangles.iter().enumerate() {
                        let material = materials[&triangle.material_id];
                        let ke = element_stiffness_with_scale(
                            element_node_indices[element_index].map(|i| &request.nodes[i]),
                            material,
                            triangle.thickness_m,
                            orthotropic_materials.get(&triangle.material_id).copied(),
                            effective_e[element_index] / material.e_mpa,
                        )?;
                        let indices = element_node_indices[element_index];
                        for i in 0..9 {
                            for j in 0..9 {
                                k.add(
                                    3 * indices[i / 3] + i % 3,
                                    3 * indices[j / 3] + j % 3,
                                    ke[i][j],
                                );
                            }
                        }
                    }
                    add_support_spring_stiffness(&springs, &mut k);
                    check_sparse_inertia_if_fits(&k, &prescribed)?;
                    let scaled_load: Vec<f64> = f.iter().map(|value| value * load_factor).collect();
                    (u, _) = constrained_solve(&k, &scaled_load, &prescribed)?;
                    let mut max_modulus_change = 0.0_f64;
                    for (element_index, triangle) in request.triangles.iter().enumerate() {
                        let Some(curve) = modulus_curves.get(&triangle.material_id) else {
                            continue;
                        };
                        let local_u: [f64; 9] = std::array::from_fn(|dof| {
                            u[3 * element_node_indices[element_index][dof / 3] + dof % 3]
                        });
                        let points = [
                            [2.0 / 3.0, 1.0 / 6.0, 1.0 / 6.0],
                            [1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0],
                            [1.0 / 6.0, 1.0 / 6.0, 2.0 / 3.0],
                        ];
                        let strain = points.iter().try_fold(
                            peak_strains[element_index],
                            |peak, point| {
                                let b = b_matrix(
                                    element_node_indices[element_index].map(|i| &request.nodes[i]),
                                    *point,
                                )?;
                                let curvature: [f64; 3] = std::array::from_fn(|a| {
                                    (0..9).map(|j| b[a][j] * local_u[j]).sum()
                                });
                                Ok::<f64, String>(peak.max(max_principal_fibre_strain(
                                    curvature,
                                    triangle.thickness_m,
                                )))
                            },
                        )?;
                        peak_strains[element_index] = strain;
                        let target_e = curve.e_at(strain);
                        max_modulus_change = max_modulus_change.max(
                            (target_e - effective_e[element_index]).abs()
                                / effective_e[element_index].max(1.0),
                        );
                        effective_e[element_index] = target_e;
                    }
                    if max_modulus_change <= request.tolerance || modulus_curves.is_empty() {
                        converged = true;
                        break;
                    }
                }
                if !converged {
                    return Err("DKT secant-modulus iteration did not converge".into());
                }
            }
            // Reassemble once with the converged secant moduli so reported moments and
            // support reactions correspond to the final constitutive state.
            let mut k = Matrix::zeros(dofs)?;
            for (element_index, triangle) in request.triangles.iter().enumerate() {
                let material = materials[&triangle.material_id];
                let ke = element_stiffness_with_scale(
                    element_node_indices[element_index].map(|i| &request.nodes[i]),
                    material,
                    triangle.thickness_m,
                    orthotropic_materials.get(&triangle.material_id).copied(),
                    effective_e[element_index] / material.e_mpa,
                )?;
                let indices = element_node_indices[element_index];
                for i in 0..9 {
                    for j in 0..9 {
                        k.add(
                            3 * indices[i / 3] + i % 3,
                            3 * indices[j / 3] + j % 3,
                            ke[i][j],
                        );
                    }
                }
            }
            add_support_spring_stiffness(&springs, &mut k);
            let (u, reaction) = constrained_solve(
                &k,
                &f.iter()
                    .map(|value| value * load_path.last().copied().unwrap_or(1.0))
                    .collect::<Vec<_>>(),
                &prescribed,
            )?;
            (u, reaction, None)
        };
    let final_load: Vec<f64> = f
        .iter()
        .map(|value| value * load_path.last().copied().unwrap_or(1.0))
        .collect();
    let relative_residual = reaction
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, value)| value * value)
        .sum::<f64>()
        .sqrt()
        / final_load
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt()
            .max(1.0);
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| NodeResult {
            node_id: node.id,
            w_m: u[3 * i],
            theta_x_rad: u[3 * i + 1],
            theta_y_rad: u[3 * i + 2],
            reaction_fz_kn: if prescribed[3 * i].is_some() {
                reaction[3 * i]
            } else {
                support_spring_reaction(&springs, &u, 3 * i)
            },
            reaction_mx_knm: if prescribed[3 * i + 1].is_some() {
                reaction[3 * i + 1]
            } else {
                support_spring_reaction(&springs, &u, 3 * i + 1)
            },
            reaction_my_knm: if prescribed[3 * i + 2].is_some() {
                reaction[3 * i + 2]
            } else {
                support_spring_reaction(&springs, &u, 3 * i + 2)
            },
        })
        .collect();
    let mut elements = Vec::with_capacity(request.triangles.len());
    for (element_index, triangle) in request.triangles.iter().enumerate() {
        let indices = triangle.node_ids.map(|id| node_index[&id]);
        let local_u: [f64; 9] = std::array::from_fn(|dof| u[3 * indices[dof / 3] + dof % 3]);
        let material = materials[&triangle.material_id];
        let moment_knm_per_m = element_centroid_moment(
            indices.map(|i| &request.nodes[i]),
            material,
            triangle.thickness_m,
            orthotropic_materials.get(&triangle.material_id).copied(),
            effective_e[element_index] / material.e_mpa,
            local_u,
        )?;
        elements.push(ElementResult {
            triangle_id: triangle.id,
            moment_knm_per_m,
            effective_e_mpa: effective_e[element_index],
            max_fibre_strain: peak_strains[element_index],
        });
    }
    Ok(ResultBending {
        nodes,
        elements,
        relative_residual,
        linear_backend_used: request.linear_backend,
        frontal_maximum_front_dofs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plate_support_spring_conflicts_with_fixed_dof_across_rows() {
        let supports = [
            Support {
                node_id: 7,
                w: true,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            },
            Support {
                node_id: 7,
                w: false,
                theta_x: false,
                theta_y: false,
                kw_kn_per_m: Some(100.0),
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            },
        ];
        let node_index = HashMap::from([(7, 0)]);
        let error = collect_support_springs(&supports, &node_index, 3, [0, 1, 2]).unwrap_err();
        assert!(error.contains("node 7"));
        assert!(error.contains("fixed and spring-supported in w"));
    }

    #[test]
    fn rigid_body_modes_have_zero_element_force() {
        let nodes = [
            Node {
                id: 1,
                x: 0.1,
                y: 0.2,
            },
            Node {
                id: 2,
                x: 1.3,
                y: 0.4,
            },
            Node {
                id: 3,
                x: 0.5,
                y: 1.1,
            },
        ];
        let material = Material {
            id: 1,
            e_mpa: 210_000.0,
            nu: 0.3,
        };
        let k = element_stiffness([&nodes[0], &nodes[1], &nodes[2]], &material, 0.02).unwrap();
        for mode in 0..3 {
            let u: [f64; 9] = std::array::from_fn(|dof| {
                let node = &nodes[dof / 3];
                match (mode, dof % 3) {
                    (0, 0) => 1.0,
                    (1, 0) => node.y,
                    (1, 1) => -1.0,
                    (2, 0) => node.x,
                    (2, 2) => 1.0,
                    _ => 0.0,
                }
            });
            let force: [f64; 9] = std::array::from_fn(|i| (0..9).map(|j| k[i][j] * u[j]).sum());
            assert!(force.iter().all(|value| value.abs() < 1e-8));
        }
    }

    #[test]
    fn bending_patch_has_correct_moment_ratio() {
        let nodes = [
            Node {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            Node {
                id: 2,
                x: 1.0,
                y: 0.0,
            },
            Node {
                id: 3,
                x: 0.0,
                y: 1.0,
            },
        ];
        let material = Material {
            id: 1,
            e_mpa: 210_000.0,
            nu: 0.3,
        };
        let b = b_matrix([&nodes[0], &nodes[1], &nodes[2]], [1.0 / 3.0; 3]).unwrap();
        let u: [f64; 9] = std::array::from_fn(|dof| {
            let x = nodes[dof / 3].x;
            match dof % 3 {
                0 => 0.5e-3 * x * x,
                1 => 0.0,
                _ => 1e-3 * x,
            }
        });
        let curvature: [f64; 3] = std::array::from_fn(|a| (0..9).map(|i| b[a][i] * u[i]).sum());
        let d = rigidity(&material, 0.02, None);
        let moment: [f64; 3] =
            std::array::from_fn(|a| (0..3).map(|i| d[a][i] * curvature[i]).sum());
        assert!((moment[1] / moment[0] - 0.3).abs() < 1e-3);
        assert!(moment[0] > 0.0);
    }

    #[test]
    fn orthotropic_dkt_rigidity_matches_principal_axis_plate_constants() {
        let material = Material {
            id: 1,
            e_mpa: 1_000.0,
            nu: 0.0,
        };
        let orthotropic = OrthotropicMaterial {
            material_id: 1,
            e1_mpa: 1_000.0,
            e2_mpa: 500.0,
            nu12: 0.0,
            g12_mpa: 200.0,
            angle_rad: 0.0,
        };
        let d = rigidity(&material, 0.1, Some(&orthotropic));
        assert!((d[0][0] - 1_000.0 / 12.0).abs() < 1e-10);
        assert!((d[1][1] - 500.0 / 12.0).abs() < 1e-10);
        assert!((d[2][2] - 200.0 / 12.0).abs() < 1e-10);
        let rotated = rigidity(
            &material,
            0.1,
            Some(&OrthotropicMaterial {
                angle_rad: std::f64::consts::FRAC_PI_2,
                ..orthotropic
            }),
        );
        assert!((rotated[0][0] - d[1][1]).abs() < 1e-12);
        assert!((rotated[1][1] - d[0][0]).abs() < 1e-12);
    }

    #[test]
    fn dkt_twist_uses_engineering_curvature_for_principal_fibre_strain() {
        // With zero principal curvatures and engineering twist 2κ, the
        // principal curvatures are ±κ.
        assert!((max_principal_fibre_strain([0.0, 0.0, 0.02], 0.1) - 0.0005).abs() < 1e-12);
    }

    #[test]
    fn reversed_triangle_order_keeps_stiffness() {
        let nodes = [
            Node {
                id: 1,
                x: 0.0,
                y: 0.0,
            },
            Node {
                id: 2,
                x: 1.2,
                y: 0.1,
            },
            Node {
                id: 3,
                x: 0.2,
                y: 0.9,
            },
        ];
        let material = Material {
            id: 1,
            e_mpa: 210_000.0,
            nu: 0.3,
        };
        let original =
            element_stiffness([&nodes[0], &nodes[1], &nodes[2]], &material, 0.02).unwrap();
        let reversed =
            element_stiffness([&nodes[0], &nodes[2], &nodes[1]], &material, 0.02).unwrap();
        let mapping = [0, 1, 2, 6, 7, 8, 3, 4, 5];
        for i in 0..9 {
            for j in 0..9 {
                let tolerance = original[i][j].abs().max(1.0) * 1e-10;
                assert!((original[i][j] - reversed[mapping[i]][mapping[j]]).abs() < tolerance);
            }
        }
    }

    fn spring_fixture() -> Request {
        Request {
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                },
                Node {
                    id: 2,
                    x: 1.0,
                    y: 0.0,
                },
                Node {
                    id: 3,
                    x: 1.0,
                    y: 1.0,
                },
                Node {
                    id: 4,
                    x: 0.0,
                    y: 1.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 1000.0,
                nu: 0.2,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
            triangles: vec![
                Triangle {
                    id: 1,
                    node_ids: [1, 2, 3],
                    material_id: 1,
                    thickness_m: 0.1,
                },
                Triangle {
                    id: 2,
                    node_ids: [1, 3, 4],
                    material_id: 1,
                    thickness_m: 0.1,
                },
            ],
            supports: vec![
                Support {
                    node_id: 1,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                },
                Support {
                    node_id: 4,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                },
                Support {
                    node_id: 2,
                    w: false,
                    theta_x: false,
                    theta_y: false,
                    kw_kn_per_m: Some(50.0),
                    ktheta_x_knm_per_rad: Some(10.0),
                    ktheta_y_knm_per_rad: None,
                },
                Support {
                    node_id: 3,
                    w: false,
                    theta_x: false,
                    theta_y: false,
                    kw_kn_per_m: Some(50.0),
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: Some(10.0),
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fz: -0.5,
                    mx: 0.0,
                    my: 0.0,
                },
                Load {
                    node_id: 3,
                    fz: -0.5,
                    mx: 0.0,
                    my: 0.0,
                },
            ],
        }
    }

    #[test]
    fn dkt_support_springs_contribute_stiffness_and_reactions() {
        let result = solve(&spring_fixture()).unwrap();
        for node_id in [2, 3] {
            let node = result
                .nodes
                .iter()
                .find(|node| node.node_id == node_id)
                .unwrap();
            assert!((node.reaction_fz_kn + 50.0 * node.w_m).abs() < 1e-9);
            if node_id == 2 {
                assert!((node.reaction_mx_knm + 10.0 * node.theta_x_rad).abs() < 1e-9);
            } else {
                assert!((node.reaction_my_knm + 10.0 * node.theta_y_rad).abs() < 1e-9);
            }
        }
        assert!(
            (result
                .nodes
                .iter()
                .map(|node| node.reaction_fz_kn)
                .sum::<f64>()
                - 1.0)
                .abs()
                < 1e-9
        );
        assert!(result.relative_residual < 1e-9);
    }

    #[test]
    fn frontal_dkt_matches_existing_stiffness_spring_reactions_and_moments() {
        let request = spring_fixture();
        let reference = solve(&request).unwrap();
        let mut frontal_request = request.clone();
        frontal_request.linear_backend = LinearBackend::FrontalWave;
        let frontal = solve(&frontal_request).unwrap();
        assert_eq!(frontal.linear_backend_used, LinearBackend::FrontalWave);
        assert!(frontal.frontal_maximum_front_dofs.unwrap() > 0);
        assert!(frontal.relative_residual < 1e-9);
        for (actual, expected) in frontal.nodes.iter().zip(&reference.nodes) {
            for (a, b) in [
                (actual.w_m, expected.w_m),
                (actual.theta_x_rad, expected.theta_x_rad),
                (actual.theta_y_rad, expected.theta_y_rad),
                (actual.reaction_fz_kn, expected.reaction_fz_kn),
                (actual.reaction_mx_knm, expected.reaction_mx_knm),
                (actual.reaction_my_knm, expected.reaction_my_knm),
            ] {
                assert!((a - b).abs() < 1e-9, "frontal {a}, assembled {b}");
            }
        }
        for (actual, expected) in frontal.elements.iter().zip(&reference.elements) {
            for (a, b) in actual
                .moment_knm_per_m
                .iter()
                .zip(expected.moment_knm_per_m)
            {
                assert!((a - b).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn frontal_dkt_one_free_dof_matches_scalar_equilibrium() {
        let mut request = spring_fixture();
        request.linear_backend = LinearBackend::FrontalWave;
        request.supports = request
            .nodes
            .iter()
            .map(|node| Support {
                node_id: node.id,
                w: node.id != 2,
                theta_x: true,
                theta_y: true,
                kw_kn_per_m: (node.id == 2).then_some(50.0),
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        request.loads = vec![Load {
            node_id: 2,
            fz: -1.0,
            mx: 0.0,
            my: 0.0,
        }];
        let material = &request.materials[0];
        let local = element_stiffness(
            [&request.nodes[0], &request.nodes[1], &request.nodes[2]],
            material,
            0.1,
        )
        .unwrap();
        let expected_w = -1.0 / (local[3][3] + 50.0);
        let result = solve(&request).unwrap();
        let node = result.nodes.iter().find(|node| node.node_id == 2).unwrap();
        assert!((node.w_m - expected_w).abs() < 1e-12);
        assert!((node.reaction_fz_kn + 50.0 * node.w_m).abs() < 1e-12);
        assert!(result.relative_residual < 1e-12);
    }

    #[test]
    fn frontal_dkt_rejects_front_limit_and_unrestrained_mechanism() {
        let mut request = spring_fixture();
        request.linear_backend = LinearBackend::FrontalWave;
        request.frontal_max_front_dofs = Some(1);
        assert!(solve(&request).unwrap_err().contains("wavefront exceeded"));
        request.frontal_max_front_dofs = None;
        request.supports.clear();
        assert!(solve(&request).unwrap_err().contains("pivot"));
    }

    #[test]
    fn frontal_dkt_elements_allow_nonzero_dirichlet_values() {
        // Exercise the same local stiffness and spring mapping with a support
        // settlement. Public DKT supports currently expose fixed zero only.
        let request = spring_fixture();
        let index: HashMap<_, _> = request
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| (node.id, i))
            .collect();
        let node_indices: Vec<_> = request
            .triangles
            .iter()
            .map(|triangle| triangle.node_ids.map(|id| index[&id]))
            .collect();
        let materials: HashMap<_, _> = request.materials.iter().map(|m| (m.id, m)).collect();
        let springs = collect_support_springs(&request.supports, &index, 3, [0, 1, 2]).unwrap();
        let elements = frontal_linear_elements(
            &request,
            &node_indices,
            &materials,
            &HashMap::new(),
            &springs,
        )
        .unwrap();
        let mut assembled = Matrix::zeros(12).unwrap();
        for element in &elements {
            for (a, &i) in element.dofs.iter().enumerate() {
                for (b, &j) in element.dofs.iter().enumerate() {
                    assembled.add(i, j, element.stiffness[a * element.dofs.len() + b]);
                }
            }
        }
        let mut prescribed = vec![None; 12];
        for &i in &[0, 1, 2, 9, 10, 11] {
            prescribed[i] = Some(0.0);
        }
        prescribed[0] = Some(0.002);
        let mut loads = vec![0.0; 12];
        loads[3] = -0.5;
        loads[6] = -0.5;
        let expected = constrained_solve(&assembled, &loads, &prescribed).unwrap();
        let actual =
            frontal::solve(&elements, &loads, &prescribed, FrontalOptions::default()).unwrap();
        for (a, b) in actual.displacements.iter().zip(expected.0) {
            assert!((a - b).abs() < 1e-10);
        }
        for (a, b) in actual.reactions.iter().zip(expected.1) {
            assert!((a - b).abs() < 1e-9);
        }
    }

    #[test]
    fn dkt_orthotropic_secant_modulus_scales_all_axes_and_retains_peak_on_unload() {
        let make_request = |e1: f64, with_curve: bool| Request {
            nodes: vec![
                Node {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                },
                Node {
                    id: 2,
                    x: 1.0,
                    y: 0.0,
                },
                Node {
                    id: 3,
                    x: 1.0,
                    y: 1.0,
                },
                Node {
                    id: 4,
                    x: 0.0,
                    y: 1.0,
                },
                Node {
                    id: 5,
                    x: 0.5,
                    y: 0.5,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: e1,
                nu: 0.2,
            }],
            orthotropic_materials: vec![OrthotropicMaterial {
                material_id: 1,
                e1_mpa: e1,
                e2_mpa: e1 * 0.5,
                nu12: 0.2,
                g12_mpa: e1 * 0.2,
                angle_rad: 23_f64.to_radians(),
            }],
            modulus_curves: if with_curve {
                vec![ModulusCurve {
                    material_id: 1,
                    points: vec![
                        crate::quad2d::ModulusPoint {
                            strain: 0.0,
                            e_mpa: 1_000.0,
                        },
                        crate::quad2d::ModulusPoint {
                            strain: 1e-12,
                            e_mpa: 500.0,
                        },
                    ],
                }]
            } else {
                vec![]
            },
            load_path: if with_curve {
                vec![1.0, 0.0, 1.0]
            } else {
                vec![]
            },
            tolerance: 1e-9,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
            triangles: vec![
                Triangle {
                    id: 1,
                    node_ids: [1, 2, 5],
                    material_id: 1,
                    thickness_m: 0.1,
                },
                Triangle {
                    id: 2,
                    node_ids: [2, 3, 5],
                    material_id: 1,
                    thickness_m: 0.1,
                },
                Triangle {
                    id: 3,
                    node_ids: [3, 4, 5],
                    material_id: 1,
                    thickness_m: 0.1,
                },
                Triangle {
                    id: 4,
                    node_ids: [4, 1, 5],
                    material_id: 1,
                    thickness_m: 0.1,
                },
            ],
            supports: [1, 2, 3, 4]
                .into_iter()
                .map(|node_id| Support {
                    node_id,
                    w: true,
                    theta_x: false,
                    theta_y: false,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![Load {
                node_id: 5,
                fz: -1.0,
                mx: 0.0,
                my: 0.0,
            }],
        };
        let curved = solve(&make_request(1_000.0, true)).unwrap();
        let fixed_soft = solve(&make_request(500.0, false)).unwrap();
        assert!(curved.elements.iter().all(|element| {
            (element.effective_e_mpa - 500.0).abs() < 1e-8 && element.max_fibre_strain > 1e-12
        }));
        for (curved, fixed) in curved.nodes.iter().zip(&fixed_soft.nodes) {
            assert!((curved.w_m - fixed.w_m).abs() < 1e-10);
            assert!((curved.theta_x_rad - fixed.theta_x_rad).abs() < 1e-10);
            assert!((curved.theta_y_rad - fixed.theta_y_rad).abs() < 1e-10);
        }
        for (curved, fixed) in curved.elements.iter().zip(&fixed_soft.elements) {
            assert!((curved.effective_e_mpa - 500.0).abs() < 1e-8);
            for axis in 0..3 {
                assert!(
                    (curved.moment_knm_per_m[axis] - fixed.moment_knm_per_m[axis]).abs() < 1e-9
                );
            }
        }
    }
}
