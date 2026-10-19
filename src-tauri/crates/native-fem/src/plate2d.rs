//! Three-node constant-strain membrane in plane stress. Geometry is in metres;
//! E and strengths are MPa; loads/reactions are kN. The nonlinear response is
//! material response stores state between load steps within one request.

use crate::material2d::{self, State};
use crate::math::{check_sparse_inertia_if_fits, constrained_solve, Matrix};
use crate::quad2d::{ModulusCurve, OrthotropicMaterial};
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
    pub nu: f64,
    #[serde(default)]
    pub law: MaterialLaw,
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
    pub ux: bool,
    pub uy: bool,
    /// Translational spring stiffness in kN/m; mutually exclusive with `ux`.
    #[serde(default)]
    pub kx_kn_per_m: Option<f64>,
    /// Translational spring stiffness in kN/m; mutually exclusive with `uy`.
    #[serde(default)]
    pub ky_kn_per_m: Option<f64>,
}

pub(crate) fn support_spring_dofs(
    supports: &[Support],
    node_index: &HashMap<usize, usize>,
) -> Result<Vec<(usize, f64)>, String> {
    let mut springs = Vec::new();
    let mut fixed_dofs = HashSet::new();
    for support in supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown support node")?;
        for (fixed, stiffness, dof, label) in [
            (support.ux, support.kx_kn_per_m, 2 * index, "x"),
            (support.uy, support.ky_kn_per_m, 2 * index + 1, "y"),
        ] {
            if fixed {
                fixed_dofs.insert(dof);
            }
            if let Some(stiffness) = stiffness {
                positive(stiffness, "support spring stiffness")?;
                if fixed {
                    return Err(format!(
                        "support node {} cannot be fixed and spring-supported in {label}",
                        support.node_id
                    ));
                }
                springs.push((dof, stiffness));
            }
        }
    }
    if let Some((dof, _)) = springs.iter().find(|(dof, _)| fixed_dofs.contains(dof)) {
        let node_index_for_dof = dof / 2;
        let node_id = node_index
            .iter()
            .find_map(|(id, index)| (*index == node_index_for_dof).then_some(*id))
            .unwrap_or_default();
        let label = if dof % 2 == 0 { "x" } else { "y" };
        return Err(format!(
            "support node {node_id} cannot be fixed and spring-supported in {label}"
        ));
    }
    Ok(springs)
}

pub(crate) fn add_support_springs(
    springs: &[(usize, f64)],
    displacement: &[f64],
    internal: &mut [f64],
    tangent: &mut Matrix,
) {
    for &(dof, stiffness) in springs {
        internal[dof] += stiffness * displacement[dof];
        tangent.add(dof, dof, stiffness);
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Load {
    pub node_id: usize,
    pub fx: f64,
    pub fy: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub analysis: Analysis,
    pub nodes: Vec<Node>,
    pub materials: Vec<Material>,
    #[serde(default)]
    pub orthotropic_materials: Vec<OrthotropicMaterial>,
    #[serde(default)]
    pub modulus_curves: Vec<ModulusCurve>,
    pub triangles: Vec<Triangle>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
    /// Successive load factors. Each segment is subdivided for material updates.
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
}
fn default_tolerance() -> f64 {
    1e-8
}
fn default_iterations() -> usize {
    40
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeResult {
    pub node_id: usize,
    pub ux_m: f64,
    pub uy_m: f64,
    pub rx_kn: f64,
    pub ry_kn: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementResult {
    pub triangle_id: usize,
    pub strain: [f64; 3],
    pub stress_mpa: [f64; 3],
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
    pub effective_e_mpa: f64,
    pub max_equivalent_strain: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result2D {
    pub nodes: Vec<NodeResult>,
    pub elements: Vec<ElementResult>,
    pub iterations: usize,
    pub relative_residual: f64,
}

struct Element<'a> {
    id: usize,
    dofs: [usize; 6],
    gradients: [[f64; 2]; 3],
    area: f64,
    thickness: f64,
    material: &'a Material,
    orthotropic: Option<&'a OrthotropicMaterial>,
    modulus_curve: Option<&'a ModulusCurve>,
}

fn build_elements<'a>(
    request: &'a Request,
    node_index: &HashMap<usize, usize>,
) -> Result<Vec<Element<'a>>, String> {
    let materials: HashMap<usize, &Material> =
        request.materials.iter().map(|m| (m.id, m)).collect();
    let curves: HashMap<usize, &ModulusCurve> = request
        .modulus_curves
        .iter()
        .map(|curve| (curve.material_id, curve))
        .collect();
    let orthotropic: HashMap<usize, &OrthotropicMaterial> = request
        .orthotropic_materials
        .iter()
        .map(|material| (material.material_id, material))
        .collect();
    request
        .triangles
        .iter()
        .map(|triangle| {
            positive(triangle.thickness_m, "plate thickness")?;
            let material = *materials
                .get(&triangle.material_id)
                .ok_or_else(|| format!("triangle {} has unknown material", triangle.id))?;
            let ids: Vec<usize> = triangle
                .node_ids
                .iter()
                .map(|id| {
                    node_index
                        .get(id)
                        .copied()
                        .ok_or_else(|| format!("triangle {} has unknown node {id}", triangle.id))
                })
                .collect::<Result<_, _>>()?;
            if ids[0] == ids[1] || ids[1] == ids[2] || ids[2] == ids[0] {
                return Err(format!("triangle {} repeats a node", triangle.id));
            }
            let [a, b, c] = [ids[0], ids[1], ids[2]].map(|i| &request.nodes[i]);
            let twice_area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
            if !twice_area.is_finite() || twice_area.abs() < 1e-12 {
                return Err(format!("triangle {} has zero area", triangle.id));
            }
            let gradients = [
                [(b.y - c.y) / twice_area, (c.x - b.x) / twice_area],
                [(c.y - a.y) / twice_area, (a.x - c.x) / twice_area],
                [(a.y - b.y) / twice_area, (b.x - a.x) / twice_area],
            ];
            Ok(Element {
                id: triangle.id,
                dofs: [
                    2 * ids[0],
                    2 * ids[0] + 1,
                    2 * ids[1],
                    2 * ids[1] + 1,
                    2 * ids[2],
                    2 * ids[2] + 1,
                ],
                gradients,
                area: twice_area.abs() / 2.0,
                thickness: triangle.thickness_m,
                material,
                orthotropic: orthotropic.get(&triangle.material_id).copied(),
                modulus_curve: curves.get(&triangle.material_id).copied(),
            })
        })
        .collect()
}

fn orthotropic_constitutive(material: &OrthotropicMaterial, secant_scale: f64) -> [[f64; 3]; 3] {
    let e1 = material.e1_mpa * 1000.0 * secant_scale;
    let e2 = material.e2_mpa * 1000.0 * secant_scale;
    let g12 = material.g12_mpa * 1000.0 * secant_scale;
    let nu21 = material.nu12 * material.e2_mpa / material.e1_mpa;
    let inverse = 1.0 / (1.0 - material.nu12 * nu21);
    let local = [
        [e1 * inverse, material.nu12 * e2 * inverse, 0.0],
        [material.nu12 * e2 * inverse, e2 * inverse, 0.0],
        [0.0, 0.0, g12],
    ];
    let (s, c) = material.angle_rad.sin_cos();
    let transform = [
        [c * c, s * s, c * s],
        [s * s, c * c, -c * s],
        [-2.0 * c * s, 2.0 * c * s, c * c - s * s],
    ];
    std::array::from_fn(|i| {
        std::array::from_fn(|j| {
            (0..3)
                .flat_map(|a| (0..3).map(move |b| transform[a][i] * local[a][b] * transform[b][j]))
                .sum()
        })
    })
}

fn element_response(
    element: &Element<'_>,
    displacement: &[f64; 6],
    analysis: Analysis,
    previous: State,
) -> Result<([f64; 6], [f64; 3], [f64; 3], State), String> {
    let mut gradient = [[0.0; 2]; 2];
    for i in 0..3 {
        for direction in 0..2 {
            gradient[0][direction] += displacement[2 * i] * element.gradients[i][direction];
            gradient[1][direction] += displacement[2 * i + 1] * element.gradients[i][direction];
        }
    }
    let [ux, uy] = gradient[0];
    let [vx, vy] = gradient[1];
    let strain = if analysis.geometric() {
        [
            ux + 0.5 * (ux * ux + vx * vx),
            vy + 0.5 * (uy * uy + vy * vy),
            uy + vx + ux * uy + vx * vy,
        ]
    } else {
        [ux, vy, uy + vx]
    };
    let law = if analysis.material() {
        element.material.law
    } else {
        MaterialLaw::Elastic
    };
    let centre = 0.5 * (strain[0] + strain[1]);
    let radius = ((0.5 * (strain[0] - strain[1])).powi(2) + (0.5 * strain[2]).powi(2)).sqrt();
    let equivalent = (centre + radius).abs().max((centre - radius).abs());
    let maximum = previous.max_equivalent_strain.max(equivalent);
    let effective_e = if analysis.material() {
        element
            .modulus_curve
            .map_or(element.material.e_mpa, |curve| curve.e_at(maximum))
    } else {
        element.material.e_mpa
    };
    let mut response = if let Some(orthotropic) = element.orthotropic {
        if !matches!(law, MaterialLaw::Elastic) {
            return Err(
                "orthotropic triangle material currently requires an elastic material law".into(),
            );
        }
        let d = orthotropic_constitutive(orthotropic, effective_e / element.material.e_mpa);
        let stress = std::array::from_fn(|i| (0..3).map(|j| d[i][j] * strain[j]).sum());
        material2d::Response {
            stress,
            state: previous,
        }
    } else {
        material2d::update(effective_e, element.material.nu, law, strain, previous)?
    };
    if analysis.material() && element.modulus_curve.is_some() {
        response.state.max_equivalent_strain = maximum;
    }
    let stress = response.stress;
    let mut force = [0.0; 6];
    for i in 0..3 {
        let [nx, ny] = element.gradients[i];
        let (bx, by) = if analysis.geometric() {
            (
                [nx * (1.0 + ux), ny * uy, ny * (1.0 + ux) + nx * uy],
                [nx * vx, ny * (1.0 + vy), ny * vx + nx * (1.0 + vy)],
            )
        } else {
            ([nx, 0.0, ny], [0.0, ny, nx])
        };
        force[2 * i] =
            element.area * element.thickness * (0..3).map(|j| bx[j] * stress[j]).sum::<f64>();
        force[2 * i + 1] =
            element.area * element.thickness * (0..3).map(|j| by[j] * stress[j]).sum::<f64>();
    }
    Ok((force, strain, stress, response.state))
}

fn assemble(
    elements: &[Element<'_>],
    u: &[f64],
    analysis: Analysis,
    states: &[State],
    tangent: bool,
) -> Result<(Vec<f64>, Matrix), String> {
    let mut internal = vec![0.0; u.len()];
    let mut k = Matrix::zeros(u.len())?;
    for (index, element) in elements.iter().enumerate() {
        let local = element.dofs.map(|dof| u[dof]);
        let (force, _, _, _) = element_response(element, &local, analysis, states[index])?;
        for i in 0..6 {
            internal[element.dofs[i]] += force[i];
        }
        if tangent {
            for j in 0..6 {
                let step = 1e-7_f64.max(local[j].abs() * 1e-5);
                let mut plus = local;
                plus[j] += step;
                let mut minus = local;
                minus[j] -= step;
                let (f_plus, _, _, _) = element_response(element, &plus, analysis, states[index])?;
                let (f_minus, _, _, _) =
                    element_response(element, &minus, analysis, states[index])?;
                for i in 0..6 {
                    k.add(
                        element.dofs[i],
                        element.dofs[j],
                        (f_plus[i] - f_minus[i]) / (2.0 * step),
                    );
                }
            }
        }
    }
    Ok((internal, k))
}

/// Linear CST contribution for a coupled mixed triangle/Q4 global system.
/// `request.nodes` and the displacement vector use the same global ordering.
pub(crate) fn assemble_mixed(
    request: &Request,
    displacement: &[f64],
    analysis: Analysis,
    states: &[State],
    tangent: bool,
) -> Result<(Vec<f64>, Matrix), String> {
    if displacement.len() != 2 * request.nodes.len() {
        return Err("mixed plate displacement size mismatch".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let elements = build_elements(request, &node_index)?;
    if states.len() != elements.len() {
        return Err("mixed CST state count mismatch".into());
    }
    assemble(&elements, displacement, analysis, states, tangent)
}

pub(crate) fn commit_mixed_states(
    request: &Request,
    displacement: &[f64],
    analysis: Analysis,
    states: &mut [State],
) -> Result<(), String> {
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let elements = build_elements(request, &node_index)?;
    if states.len() != elements.len() {
        return Err("mixed CST state count mismatch".into());
    }
    for (index, element) in elements.iter().enumerate() {
        let local = element.dofs.map(|dof| displacement[dof]);
        states[index] = element_response(element, &local, analysis, states[index])?.3;
    }
    Ok(())
}

/// Recover CST membrane resultants at a displacement solved with a shared mesh.
pub(crate) fn recover_mixed(
    request: &Request,
    displacement: &[f64],
    analysis: Analysis,
    states: &[State],
) -> Result<Vec<ElementResult>, String> {
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    let elements = build_elements(request, &node_index)?;
    if states.len() != elements.len() {
        return Err("mixed CST state count mismatch".into());
    }
    elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            let local = element.dofs.map(|dof| displacement[dof]);
            let (_, strain, stress, _) =
                element_response(element, &local, analysis, states[index])?;
            Ok(ElementResult {
                triangle_id: element.id,
                strain,
                stress_mpa: stress.map(|value| value / 1000.0),
                equivalent_plastic_strain: states[index].equivalent_plastic_strain,
                tensile_damage: states[index].tensile_damage,
                effective_e_mpa: if analysis.material() {
                    element
                        .modulus_curve
                        .map_or(element.material.e_mpa, |curve| {
                            curve.e_at(states[index].max_equivalent_strain)
                        })
                } else {
                    element.material.e_mpa
                },
                max_equivalent_strain: states[index].max_equivalent_strain,
            })
        })
        .collect()
}

pub fn solve(request: &Request) -> Result<Result2D, String> {
    if request.nodes.len() < 3 || request.triangles.is_empty() {
        return Err("plate requires nodes and triangles".into());
    }
    positive(request.tolerance, "tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid iteration limit".into());
    }
    let ids: HashSet<usize> = request.nodes.iter().map(|n| n.id).collect();
    if ids.len() != request.nodes.len() {
        return Err("duplicate plate node id".into());
    }
    for node in &request.nodes {
        if !node.x.is_finite() || !node.y.is_finite() {
            return Err("non-finite plate coordinate".into());
        }
    }
    for material in &request.materials {
        positive(material.e_mpa, "E")?;
        if !material.nu.is_finite() || material.nu <= -1.0 || material.nu >= 0.5 {
            return Err("invalid plane-stress Poisson ratio".into());
        }
        match material.law {
            MaterialLaw::Elastic => {}
            MaterialLaw::SteelBilinear {
                yield_mpa,
                hardening_ratio,
            } => {
                positive(yield_mpa, "steel yield stress")?;
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
    let material_ids: HashSet<usize> = request.materials.iter().map(|m| m.id).collect();
    if material_ids.len() != request.materials.len() {
        return Err("duplicate plate material id".into());
    }
    let mut orthotropic_ids = HashSet::new();
    for orthotropic in &request.orthotropic_materials {
        if !orthotropic_ids.insert(orthotropic.material_id) {
            return Err("duplicate orthotropic plate material id".into());
        }
        let material = request
            .materials
            .iter()
            .find(|m| m.id == orthotropic.material_id)
            .ok_or("unknown orthotropic plate material")?;
        positive(orthotropic.e1_mpa, "orthotropic E1")?;
        positive(orthotropic.e2_mpa, "orthotropic E2")?;
        positive(orthotropic.g12_mpa, "orthotropic G12")?;
        if !orthotropic.nu12.is_finite() || !orthotropic.angle_rad.is_finite() {
            return Err("non-finite orthotropic material parameter".into());
        }
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        if !(1.0 - orthotropic.nu12 * nu21 > 0.0) {
            return Err("orthotropic plane-stress stiffness is not positive definite".into());
        }
        if (material.e_mpa - orthotropic.e1_mpa).abs() > orthotropic.e1_mpa * 1e-10 {
            return Err("isotropic E must equal orthotropic E1 for secant scaling".into());
        }
        if !matches!(material.law, MaterialLaw::Elastic) {
            return Err(
                "orthotropic triangle material currently requires an elastic material law".into(),
            );
        }
    }
    let mut curve_ids = HashSet::new();
    for curve in &request.modulus_curves {
        if !curve_ids.insert(curve.material_id) {
            return Err("duplicate plate modulus curve material id".into());
        }
        let material = request
            .materials
            .iter()
            .find(|m| m.id == curve.material_id)
            .ok_or("unknown plate modulus curve material")?;
        if !matches!(material.law, MaterialLaw::Elastic) {
            return Err("plate modulus curve requires elastic material law".into());
        }
        if curve.points.len() < 2
            || curve.points[0].strain != 0.0
            || (curve.points[0].e_mpa - material.e_mpa).abs() > material.e_mpa * 1e-10
        {
            return Err("plate modulus curve must start at zero strain with material E".into());
        }
        for point in &curve.points {
            positive(point.e_mpa, "plate curve E")?;
            if !point.strain.is_finite() || point.strain < 0.0 {
                return Err("invalid plate modulus curve strain".into());
            }
        }
        if curve
            .points
            .windows(2)
            .any(|pair| pair[1].strain <= pair[0].strain || pair[1].e_mpa > pair[0].e_mpa)
        {
            return Err("plate modulus curve strains must increase and E must not increase".into());
        }
    }
    let triangle_ids: HashSet<usize> = request.triangles.iter().map(|t| t.id).collect();
    if triangle_ids.len() != request.triangles.len() {
        return Err("duplicate plate triangle id".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id, i))
        .collect();
    let elements = build_elements(request, &node_index)?;
    let dofs = 2 * request.nodes.len();
    let springs = support_spring_dofs(&request.supports, &node_index)?;
    let mut prescribed = vec![None; dofs];
    for support in &request.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or("unknown support node")?;
        if support.ux {
            prescribed[2 * index] = Some(0.0);
        }
        if support.uy {
            prescribed[2 * index + 1] = Some(0.0);
        }
    }
    let mut load = vec![0.0; dofs];
    for force in &request.loads {
        let index = *node_index.get(&force.node_id).ok_or("unknown load node")?;
        load[2 * index] += force.fx;
        load[2 * index + 1] += force.fy;
    }
    let scale = load.iter().map(|f| f * f).sum::<f64>().sqrt().max(1.0);
    let substeps = if request.analysis == Analysis::Linear {
        1
    } else {
        10
    };
    let path = if request.load_path.is_empty() {
        vec![1.0]
    } else {
        request.load_path.clone()
    };
    if path.iter().any(|factor| !factor.is_finite()) {
        return Err("non-finite plate load path factor".into());
    }
    let mut u = vec![0.0; dofs];
    let mut states = vec![State::default(); elements.len()];
    let mut iterations = 0;
    let mut inertia_factor_available = None;
    let check_each_tangent = request.analysis != Analysis::Linear;
    let mut segment_start = 0.0;
    for (segment, &segment_end) in path.iter().enumerate() {
        for step in 1..=substeps {
            let mut accepted_factor =
                segment_start + (segment_end - segment_start) * (step - 1) as f64 / substeps as f64;
            let planned_factor =
                segment_start + (segment_end - segment_start) * step as f64 / substeps as f64;
            let mut target_factor = planned_factor;
            let mut cutbacks = 0;
            loop {
                let mut trial_u = u.clone();
                let mut converged = false;
                for _ in 0..request.max_iterations {
                    iterations += 1;
                    let (mut internal, mut k) =
                        assemble(&elements, &trial_u, request.analysis, &states, true)?;
                    add_support_springs(&springs, &trial_u, &mut internal, &mut k);
                    if inertia_factor_available.is_none()
                        || (check_each_tangent && inertia_factor_available == Some(true))
                    {
                        inertia_factor_available =
                            Some(check_sparse_inertia_if_fits(&k, &prescribed)?);
                    }
                    let residual: Vec<f64> = load
                        .iter()
                        .zip(internal)
                        .map(|(f, p)| target_factor * f - p)
                        .collect();
                    let free_norm = residual
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| prescribed[*i].is_none())
                        .map(|(_, r)| r * r)
                        .sum::<f64>()
                        .sqrt();
                    if free_norm / scale <= request.tolerance {
                        converged = true;
                        break;
                    }
                    let (increment, _) = constrained_solve(&k, &residual, &prescribed)?;
                    if !increment.iter().all(|value| value.is_finite()) {
                        return Err("non-finite plate increment".into());
                    }
                    for i in 0..dofs {
                        trial_u[i] += increment[i];
                    }
                }
                if converged {
                    u = trial_u;
                    if request.analysis.material() {
                        for (index, element) in elements.iter().enumerate() {
                            let local = element.dofs.map(|dof| u[dof]);
                            let (_, _, _, state) =
                                element_response(element, &local, request.analysis, states[index])?;
                            states[index] = state;
                        }
                    }
                    accepted_factor = target_factor;
                    if target_factor == planned_factor {
                        break;
                    }
                    target_factor = planned_factor;
                } else {
                    cutbacks += 1;
                    if cutbacks > 32 {
                        return Err(format!(
                            "plate nonlinear analysis did not converge after load-step cutbacks near factor {target_factor} (last converged {accepted_factor}) at path segment {} step {step}",
                            segment + 1
                        ));
                    }
                    target_factor = accepted_factor + 0.5 * (target_factor - accepted_factor);
                }
            }
        }
        segment_start = segment_end;
    }
    let (mut internal, mut tangent) = assemble(&elements, &u, request.analysis, &states, false)?;
    add_support_springs(&springs, &u, &mut internal, &mut tangent);
    let final_factor = *path.last().unwrap();
    let residual: Vec<f64> = internal
        .iter()
        .zip(&load)
        .map(|(a, b)| a - final_factor * b)
        .collect();
    let relative_residual = residual
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, r)| r * r)
        .sum::<f64>()
        .sqrt()
        / scale;
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| NodeResult {
            node_id: node.id,
            ux_m: u[2 * i],
            uy_m: u[2 * i + 1],
            rx_kn: if prescribed[2 * i].is_some() {
                residual[2 * i]
            } else {
                support_spring_reaction(&springs, &u, 2 * i)
            },
            ry_kn: if prescribed[2 * i + 1].is_some() {
                residual[2 * i + 1]
            } else {
                support_spring_reaction(&springs, &u, 2 * i + 1)
            },
        })
        .collect();
    let elements = elements
        .iter()
        .enumerate()
        .map(|(index, element)| {
            let local = element.dofs.map(|dof| u[dof]);
            let (_, strain, stress, _) =
                element_response(element, &local, request.analysis, states[index])?;
            Ok(ElementResult {
                triangle_id: element.id,
                strain,
                stress_mpa: stress.map(|value| value / 1000.0),
                equivalent_plastic_strain: states[index].equivalent_plastic_strain,
                tensile_damage: states[index].tensile_damage,
                effective_e_mpa: if request.analysis.material() {
                    element
                        .modulus_curve
                        .map_or(element.material.e_mpa, |curve| {
                            curve.e_at(states[index].max_equivalent_strain)
                        })
                } else {
                    element.material.e_mpa
                },
                max_equivalent_strain: states[index].max_equivalent_strain,
            })
        })
        .collect::<Result<_, String>>()?;
    Ok(Result2D {
        nodes,
        elements,
        iterations,
        relative_residual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_spring_cannot_duplicate_fixed_dof_across_support_rows() {
        let supports = [
            Support {
                node_id: 1,
                ux: true,
                uy: false,
                kx_kn_per_m: None,
                ky_kn_per_m: None,
            },
            Support {
                node_id: 1,
                ux: false,
                uy: false,
                kx_kn_per_m: Some(100.0),
                ky_kn_per_m: None,
            },
        ];
        let node_index = HashMap::from([(1, 0)]);
        let error = support_spring_dofs(&supports, &node_index).unwrap_err();
        assert!(error.contains("node 1"));
        assert!(error.contains("fixed and spring-supported in x"));
    }

    fn coupon(law: MaterialLaw, analysis: Analysis, load: f64) -> Request {
        Request {
            analysis,
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
                    x: 0.0,
                    y: 1.0,
                },
            ],
            materials: vec![Material {
                id: 1,
                e_mpa: 210_000.0,
                nu: 0.0,
                law,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            triangles: vec![Triangle {
                id: 1,
                node_ids: [1, 2, 3],
                material_id: 1,
                thickness_m: 0.1,
            }],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 2,
                    ux: false,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 3,
                    ux: true,
                    uy: false,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: load,
                    fy: 0.0,
                },
                Load {
                    node_id: 3,
                    fx: 0.0,
                    fy: load,
                },
            ],
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
        }
    }
    #[test]
    fn linear_coupon_matches_constant_strain_solution() {
        let result = solve(&coupon(MaterialLaw::Elastic, Analysis::Linear, 10.0)).unwrap();
        let expected = 10.0 / (0.05 * 210_000_000.0);
        assert!((result.nodes[1].ux_m - expected).abs() < 1e-11);
        assert!((result.nodes[2].uy_m - expected).abs() < 1e-11);
        assert!(result.relative_residual < 1e-8);
    }

    #[test]
    fn orthotropic_triangle_matches_axis_coupon_and_secant_modulus_curve() {
        let mut request = coupon(MaterialLaw::Elastic, Analysis::Linear, 10.0);
        request.materials[0].e_mpa = 1_000.0;
        request.materials[0].nu = 0.0;
        request.orthotropic_materials.push(OrthotropicMaterial {
            material_id: 1,
            e1_mpa: 1_000.0,
            e2_mpa: 500.0,
            nu12: 0.0,
            g12_mpa: 200.0,
            angle_rad: 0.0,
        });
        let result = solve(&request).unwrap();
        assert!((result.nodes[1].ux_m - 0.0002).abs() < 1e-11);
        assert!((result.nodes[2].uy_m - 0.0004).abs() < 1e-11);
        assert!((result.elements[0].stress_mpa[0] - 0.2).abs() < 1e-10);
        assert!((result.elements[0].stress_mpa[1] - 0.2).abs() < 1e-10);

        request.analysis = Analysis::Material;
        request.modulus_curves.push(ModulusCurve {
            material_id: 1,
            points: vec![
                crate::quad2d::ModulusPoint {
                    strain: 0.0,
                    e_mpa: 1_000.0,
                },
                crate::quad2d::ModulusPoint {
                    strain: 0.00001,
                    e_mpa: 500.0,
                },
            ],
        });
        let curved = solve(&request).unwrap();
        assert!((curved.nodes[1].ux_m - 0.0004).abs() < 1e-10);
        assert!((curved.nodes[2].uy_m - 0.0008).abs() < 1e-10);
        assert!((curved.elements[0].effective_e_mpa - 500.0).abs() < 1e-8);
    }

    #[test]
    fn linear_cst_translational_springs_match_axial_series_solution() {
        let request = Request {
            analysis: Analysis::Linear,
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
                nu: 0.0,
                law: MaterialLaw::Elastic,
            }],
            orthotropic_materials: vec![],
            modulus_curves: vec![],
            triangles: vec![
                Triangle {
                    id: 1,
                    node_ids: [1, 2, 3],
                    material_id: 1,
                    thickness_m: 0.001,
                },
                Triangle {
                    id: 2,
                    node_ids: [1, 3, 4],
                    material_id: 1,
                    thickness_m: 0.001,
                },
            ],
            supports: vec![
                Support {
                    node_id: 1,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 4,
                    ux: true,
                    uy: true,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 2,
                    ux: false,
                    uy: false,
                    kx_kn_per_m: Some(1000.0),
                    ky_kn_per_m: None,
                },
                Support {
                    node_id: 3,
                    ux: false,
                    uy: false,
                    kx_kn_per_m: Some(1000.0),
                    ky_kn_per_m: None,
                },
            ],
            loads: vec![
                Load {
                    node_id: 2,
                    fx: 50.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 3,
                    fx: 50.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![],
            tolerance: 1e-10,
            max_iterations: 40,
        };
        let result = solve(&request).unwrap();

        let expected_displacement = 100.0 / 3000.0;
        for node in result
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 3)
        {
            assert!((node.ux_m - expected_displacement).abs() < 1e-12);
            assert!((node.rx_kn + 1000.0 * expected_displacement).abs() < 1e-10);
        }
        assert!(result
            .elements
            .iter()
            .all(|element| (element.stress_mpa[0] - 1000.0 * expected_displacement).abs() < 1e-9));
        assert!((result.nodes.iter().map(|node| node.rx_kn).sum::<f64>() + 100.0).abs() < 1e-9);
        assert!(result.relative_residual < 1e-10);

        let geometric = solve(&Request {
            analysis: Analysis::Geometric,
            ..request
        })
        .unwrap();
        for node in geometric
            .nodes
            .iter()
            .filter(|node| node.node_id == 2 || node.node_id == 3)
        {
            assert!((node.rx_kn + 1000.0 * node.ux_m).abs() < 1e-7);
        }
        assert!((geometric.nodes.iter().map(|node| node.rx_kn).sum::<f64>() + 100.0).abs() < 1e-7);
        assert!(geometric.relative_residual < 1e-8);
    }
    #[test]
    fn secant_curve_softens_and_retains_peak_strain_on_unloading() {
        let mut model = coupon(MaterialLaw::Elastic, Analysis::Material, 2_000.0);
        model.modulus_curves = vec![ModulusCurve {
            material_id: 1,
            points: vec![
                crate::quad2d::ModulusPoint {
                    strain: 0.0,
                    e_mpa: 210_000.0,
                },
                crate::quad2d::ModulusPoint {
                    strain: 0.0005,
                    e_mpa: 100_000.0,
                },
            ],
        }];
        let elastic = solve(&coupon(MaterialLaw::Elastic, Analysis::Linear, 2_000.0)).unwrap();
        let loaded = solve(&model).unwrap();
        assert!(loaded.nodes[1].ux_m > elastic.nodes[1].ux_m);
        assert!(loaded.elements[0].effective_e_mpa < 210_000.0);
        assert!(loaded.elements[0].max_equivalent_strain > 0.0);
        model.load_path = vec![1.0, 0.0];
        let unloaded = solve(&model).unwrap();
        assert!(unloaded.elements[0].effective_e_mpa < 210_000.0);
        assert!(
            unloaded.elements[0].max_equivalent_strain >= loaded.elements[0].max_equivalent_strain
        );
        assert!(unloaded.nodes[1].ux_m.abs() < 1e-9);
        assert!(unloaded.relative_residual < 1e-7);
    }
    #[test]
    fn geometric_stiffening_changes_large_displacement() {
        let linear = solve(&coupon(MaterialLaw::Elastic, Analysis::Linear, 200_000.0)).unwrap();
        let geometric = solve(&coupon(
            MaterialLaw::Elastic,
            Analysis::Geometric,
            200_000.0,
        ))
        .unwrap();
        assert!(geometric.nodes[1].ux_m < linear.nodes[1].ux_m);
    }
    #[test]
    fn steel_yield_and_concrete_crack_increase_displacement() {
        let elastic = solve(&coupon(MaterialLaw::Elastic, Analysis::Linear, 20_000.0)).unwrap();
        let steel = solve(&coupon(
            MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.02,
            },
            Analysis::Material,
            20_000.0,
        ))
        .unwrap();
        let concrete = solve(&coupon(
            MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.02,
            },
            Analysis::Material,
            20_000.0,
        ))
        .unwrap();
        assert!(steel.nodes[1].ux_m > elastic.nodes[1].ux_m);
        assert!(concrete.nodes[1].ux_m > steel.nodes[1].ux_m);
    }
    #[test]
    fn steel_load_unload_path_keeps_plastic_deformation() {
        let mut model = coupon(
            MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.02,
            },
            Analysis::Material,
            20_000.0,
        );
        model.load_path = vec![1.0, 0.0];
        let result = solve(&model).unwrap();
        assert!(result.elements[0].equivalent_plastic_strain > 0.0);
        assert!(result.nodes[1].ux_m > 0.0);
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn concrete_load_unload_path_keeps_damage() {
        let mut model = coupon(
            MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.02,
            },
            Analysis::Material,
            500.0,
        );
        model.load_path = vec![1.0, 0.0];
        let result = solve(&model).unwrap();
        assert!(result.elements[0].tensile_damage > 0.0);
        assert!(result.relative_residual < 1e-8);
    }
    #[test]
    fn reversed_triangle_order_has_same_response() {
        let model = coupon(MaterialLaw::Elastic, Analysis::Linear, 10.0);
        let reference = solve(&model).unwrap();
        let mut reversed = model;
        reversed.triangles[0].node_ids.swap(1, 2);
        let actual = solve(&reversed).unwrap();
        for (a, b) in actual.nodes.iter().zip(reference.nodes.iter()) {
            assert!((a.ux_m - b.ux_m).abs() < 1e-12);
            assert!((a.uy_m - b.uy_m).abs() < 1e-12);
        }
    }
    #[test]
    fn unknown_input_field_is_rejected() {
        let mut value =
            serde_json::to_value(coupon(MaterialLaw::Elastic, Analysis::Linear, 10.0)).unwrap();
        value["planeStrain"] = serde_json::json!(true);
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
}
