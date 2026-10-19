//! Coupled plane-stress solve for conforming CST and Q4 meshes.
//! Both element families share one global node/DOF vector, Newton system,
//! load path, and equilibrium checks while retaining family-specific histories.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::material2d::State;
use crate::math::{
    check_sparse_inertia_if_fits, constrained_solve, constrained_solve_sparse_direct,
};
use crate::plate2d::{self, ElementResult, Load, Material, Node, NodeResult, Support, Triangle};
use crate::quad2d::{self, ModulusCurve, OrthotropicMaterial, Quad, QuadResult};
use crate::{positive, Analysis, MaterialLaw};

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
    pub quads: Vec<Quad>,
    #[serde(default)]
    pub supports: Vec<Support>,
    #[serde(default)]
    pub loads: Vec<Load>,
    #[serde(default)]
    pub load_path: Vec<f64>,
    #[serde(default = "default_tolerance")]
    pub tolerance: f64,
    #[serde(default = "default_iterations")]
    pub max_iterations: usize,
    #[serde(default)]
    pub linear_backend: MixedLinearBackend,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MixedLinearBackend {
    #[default]
    Existing,
    SparseDirect,
    FrontalWave,
}

fn default_tolerance() -> f64 {
    1e-8
}

fn default_iterations() -> usize {
    40
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result2D {
    pub nodes: Vec<NodeResult>,
    pub triangles: Vec<ElementResult>,
    pub quads: Vec<QuadResult>,
    pub relative_residual: f64,
    /// True free residual of the final linear correction, or None when the
    /// initial field already met equilibrium without a correction.
    pub linear_solver_true_residual: Option<f64>,
    pub linear_backend_used: MixedLinearBackend,
    /// Peak free wavefront size for the opt-in elementwise direct route.
    pub frontal_maximum_front_dofs: Option<usize>,
}

/// Obtain the exact local CST/Q4 tangents from the existing element kernels,
/// then pass them directly to the wavefront factorization.  In particular,
/// this does not split an assembled global matrix into pretend elements.
fn frontal_linear_elements(
    request: &Request,
    node_index: &HashMap<usize, usize>,
    springs: &[(usize, f64)],
) -> Result<Vec<FrontalElement>, String> {
    let mut elements = Vec::with_capacity(request.triangles.len() + request.quads.len());
    for triangle in &request.triangles {
        let nodes: Vec<Node> = triangle
            .node_ids
            .iter()
            .map(|id| {
                node_index
                    .get(id)
                    .map(|&index| request.nodes[index].clone())
                    .ok_or_else(|| format!("triangle {} has unknown node {id}", triangle.id))
            })
            .collect::<Result<_, _>>()?;
        let material = request
            .materials
            .iter()
            .find(|m| m.id == triangle.material_id)
            .ok_or_else(|| format!("triangle {} has unknown material", triangle.id))?;
        let local_request = plate2d::Request {
            analysis: Analysis::Linear,
            nodes,
            materials: vec![material.clone()],
            orthotropic_materials: request
                .orthotropic_materials
                .iter()
                .filter(|m| m.material_id == material.id)
                .cloned()
                .collect(),
            modulus_curves: Vec::new(),
            triangles: vec![triangle.clone()],
            supports: Vec::new(),
            loads: Vec::new(),
            load_path: Vec::new(),
            tolerance: request.tolerance,
            max_iterations: request.max_iterations,
        };
        let (_, k) = plate2d::assemble_mixed(
            &local_request,
            &[0.0; 6],
            Analysis::Linear,
            &[State::default()],
            true,
        )?;
        let dofs: Vec<usize> = triangle
            .node_ids
            .iter()
            .flat_map(|id| {
                let i = node_index[id];
                [2 * i, 2 * i + 1]
            })
            .collect();
        let mut stiffness = Vec::with_capacity(36);
        for i in 0..6 {
            for j in 0..6 {
                stiffness.push(k.get(i, j));
            }
        }
        elements.push(FrontalElement { dofs, stiffness });
    }
    for quad in &request.quads {
        let nodes: Vec<Node> = quad
            .node_ids
            .iter()
            .map(|id| {
                node_index
                    .get(id)
                    .map(|&index| request.nodes[index].clone())
                    .ok_or_else(|| format!("quad {} has unknown node {id}", quad.id))
            })
            .collect::<Result<_, _>>()?;
        let material = request
            .materials
            .iter()
            .find(|m| m.id == quad.material_id)
            .ok_or_else(|| format!("quad {} has unknown material", quad.id))?;
        let local_request = quad2d::Request {
            analysis: Analysis::Linear,
            nodes,
            materials: vec![material.clone()],
            orthotropic_materials: request
                .orthotropic_materials
                .iter()
                .filter(|m| m.material_id == material.id)
                .cloned()
                .collect(),
            modulus_curves: Vec::new(),
            quads: vec![quad.clone()],
            supports: Vec::new(),
            loads: Vec::new(),
            load_path: Vec::new(),
            tolerance: request.tolerance,
            max_iterations: request.max_iterations,
        };
        let (_, k) = quad2d::assemble_mixed(
            &local_request,
            &[0.0; 8],
            Analysis::Linear,
            &[[State::default(); 4]],
            true,
        )?;
        let dofs: Vec<usize> = quad
            .node_ids
            .iter()
            .flat_map(|id| {
                let i = node_index[id];
                [2 * i, 2 * i + 1]
            })
            .collect();
        let mut stiffness = Vec::with_capacity(64);
        for i in 0..8 {
            for j in 0..8 {
                stiffness.push(k.get(i, j));
            }
        }
        elements.push(FrontalElement { dofs, stiffness });
    }
    // Attach each support spring to its last contributing element, so a
    // boundary full of springs does not remain active until the final element.
    for &(dof, value) in springs {
        if let Some(element) = elements.iter_mut().rev().find(|e| e.dofs.contains(&dof)) {
            let i = element.dofs.iter().position(|&item| item == dof).unwrap();
            element.stiffness[i * element.dofs.len() + i] += value;
        } else {
            elements.push(FrontalElement {
                dofs: vec![dof],
                stiffness: vec![value],
            });
        }
    }
    Ok(elements)
}

pub fn solve(request: &Request) -> Result<Result2D, String> {
    if request.triangles.is_empty() || request.quads.is_empty() {
        return Err("mixed plane-stress model requires both triangles and quads".into());
    }
    if request.nodes.len() < 4 {
        return Err("mixed plane-stress model requires at least four nodes".into());
    }
    positive(request.tolerance, "tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid mixed iteration limit".into());
    }
    if request.linear_backend != MixedLinearBackend::Existing
        && request.analysis != Analysis::Linear
    {
        return Err("mixed direct backends are validated only for linear analysis".into());
    }
    let node_index: HashMap<usize, usize> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    if node_index.len() != request.nodes.len() {
        return Err("duplicate mixed plate node id".into());
    }
    if request
        .nodes
        .iter()
        .any(|node| !node.x.is_finite() || !node.y.is_finite())
    {
        return Err("non-finite mixed plate coordinate".into());
    }
    let mut material_ids = HashSet::new();
    for material in &request.materials {
        if !material_ids.insert(material.id) {
            return Err("duplicate mixed plate material id".into());
        }
        positive(material.e_mpa, "E")?;
        if !material.nu.is_finite() || !(-1.0..0.5).contains(&material.nu) {
            return Err("invalid plane-stress Poisson ratio".into());
        }
    }
    let mut curve_ids = HashSet::new();
    for curve in &request.modulus_curves {
        if !curve_ids.insert(curve.material_id) {
            return Err("duplicate mixed modulus curve material id".into());
        }
        let material = request
            .materials
            .iter()
            .find(|material| material.id == curve.material_id)
            .ok_or("unknown mixed modulus curve material")?;
        if !matches!(material.law, MaterialLaw::Elastic) {
            return Err("mixed modulus curve requires elastic material law".into());
        }
        if curve.points.len() < 2
            || curve.points[0].strain != 0.0
            || (curve.points[0].e_mpa - material.e_mpa).abs() > material.e_mpa * 1e-10
        {
            return Err("mixed modulus curve must start at zero strain with material E".into());
        }
        for point in &curve.points {
            positive(point.e_mpa, "mixed modulus curve E")?;
            if !point.strain.is_finite() || point.strain < 0.0 {
                return Err("invalid mixed modulus curve strain".into());
            }
        }
        if curve
            .points
            .windows(2)
            .any(|pair| pair[1].strain <= pair[0].strain || pair[1].e_mpa > pair[0].e_mpa)
        {
            return Err("mixed modulus curve strains must increase and E must not increase".into());
        }
    }
    let mut orthotropic_ids = HashSet::new();
    for orthotropic in &request.orthotropic_materials {
        if !orthotropic_ids.insert(orthotropic.material_id) {
            return Err("duplicate mixed orthotropic material id".into());
        }
        let material = request
            .materials
            .iter()
            .find(|material| material.id == orthotropic.material_id)
            .ok_or("unknown mixed orthotropic material")?;
        positive(orthotropic.e1_mpa, "orthotropic E1")?;
        positive(orthotropic.e2_mpa, "orthotropic E2")?;
        positive(orthotropic.g12_mpa, "orthotropic G12")?;
        if !orthotropic.nu12.is_finite() || !orthotropic.angle_rad.is_finite() {
            return Err("non-finite mixed orthotropic material parameter".into());
        }
        let nu21 = orthotropic.nu12 * orthotropic.e2_mpa / orthotropic.e1_mpa;
        if 1.0 - orthotropic.nu12 * nu21 <= 0.0
            || (material.e_mpa - orthotropic.e1_mpa).abs() > orthotropic.e1_mpa * 1e-10
        {
            return Err("invalid mixed orthotropic plane-stress stiffness".into());
        }
    }
    let mut element_ids = HashSet::new();
    for triangle in &request.triangles {
        if !element_ids.insert(triangle.id) {
            return Err("duplicate mixed plate element id".into());
        }
    }
    for quad in &request.quads {
        if !element_ids.insert(quad.id) {
            return Err("duplicate mixed plate element id".into());
        }
    }
    for load in &request.loads {
        if !node_index.contains_key(&load.node_id) {
            return Err(format!("unknown mixed plate load node {}", load.node_id));
        }
        if !load.fx.is_finite() || !load.fy.is_finite() {
            return Err("non-finite mixed plate nodal load".into());
        }
    }

    let triangle_request = plate2d::Request {
        analysis: request.analysis,
        nodes: request.nodes.clone(),
        materials: request.materials.clone(),
        orthotropic_materials: request.orthotropic_materials.clone(),
        modulus_curves: request.modulus_curves.clone(),
        triangles: request.triangles.clone(),
        supports: Vec::new(),
        loads: Vec::new(),
        load_path: request.load_path.clone(),
        tolerance: request.tolerance,
        max_iterations: request.max_iterations,
    };
    let quad_request = quad2d::Request {
        analysis: request.analysis,
        nodes: request.nodes.clone(),
        materials: request.materials.clone(),
        orthotropic_materials: request.orthotropic_materials.clone(),
        modulus_curves: request.modulus_curves.clone(),
        quads: request.quads.clone(),
        supports: Vec::new(),
        loads: Vec::new(),
        load_path: request.load_path.clone(),
        tolerance: request.tolerance,
        max_iterations: request.max_iterations,
    };
    let dofs = 2 * request.nodes.len();
    let springs = plate2d::support_spring_dofs(&request.supports, &node_index)?;
    let mut prescribed = vec![None; dofs];
    for support in &request.supports {
        let index = *node_index
            .get(&support.node_id)
            .ok_or_else(|| format!("unknown mixed plate support node {}", support.node_id))?;
        if support.ux {
            prescribed[2 * index] = Some(0.0);
        }
        if support.uy {
            prescribed[2 * index + 1] = Some(0.0);
        }
    }
    let mut load = vec![0.0; dofs];
    for nodal in &request.loads {
        let index = node_index[&nodal.node_id];
        load[2 * index] += nodal.fx;
        load[2 * index + 1] += nodal.fy;
    }
    let scale = load
        .iter()
        .map(|force| force * force)
        .sum::<f64>()
        .sqrt()
        .max(1.0);
    let path = if request.load_path.is_empty() {
        vec![1.0]
    } else {
        request.load_path.clone()
    };
    if path.iter().any(|factor| !factor.is_finite()) {
        return Err("non-finite mixed load path factor".into());
    }
    let substeps = if request.analysis == Analysis::Linear {
        1
    } else {
        10
    };
    let mut u = vec![0.0; dofs];
    let mut triangle_states = vec![State::default(); request.triangles.len()];
    let mut quad_states = vec![[State::default(); 4]; request.quads.len()];
    let mut inertia_factor_available = None;
    let mut linear_solver_true_residual = None;
    let mut frontal_maximum_front_dofs = None;
    let frontal_elements = if request.linear_backend == MixedLinearBackend::FrontalWave {
        Some(frontal_linear_elements(request, &node_index, &springs)?)
    } else {
        None
    };
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
                    if let Some(elements) = &frontal_elements {
                        let target_load: Vec<f64> =
                            load.iter().map(|force| target_factor * force).collect();
                        let solved = frontal::solve(
                            elements,
                            &target_load,
                            &prescribed,
                            FrontalOptions::default(),
                        )?;
                        let true_norm = solved
                            .reactions
                            .iter()
                            .enumerate()
                            .filter(|(dof, _)| prescribed[*dof].is_none())
                            .map(|(_, residual)| residual * residual)
                            .sum::<f64>()
                            .sqrt();
                        if !true_norm.is_finite() || true_norm / scale > request.tolerance {
                            return Err(format!(
                                "mixed frontal free residual is too large: {true_norm}"
                            ));
                        }
                        linear_solver_true_residual = Some(true_norm);
                        frontal_maximum_front_dofs = Some(solved.maximum_front_dofs);
                        trial_u = solved.displacements;
                        converged = true;
                        break;
                    }
                    let (mut internal, mut tangent) = plate2d::assemble_mixed(
                        &triangle_request,
                        &trial_u,
                        request.analysis,
                        &triangle_states,
                        true,
                    )?;
                    let (quad_internal, quad_tangent) = quad2d::assemble_mixed(
                        &quad_request,
                        &trial_u,
                        request.analysis,
                        &quad_states,
                        true,
                    )?;
                    for (value, addition) in internal.iter_mut().zip(quad_internal) {
                        *value += addition;
                    }
                    tangent.add_matrix(&quad_tangent)?;
                    plate2d::add_support_springs(&springs, &trial_u, &mut internal, &mut tangent);
                    if inertia_factor_available.is_none()
                        || (check_each_tangent && inertia_factor_available == Some(true))
                    {
                        inertia_factor_available =
                            Some(check_sparse_inertia_if_fits(&tangent, &prescribed)?);
                    }
                    let residual: Vec<f64> = load
                        .iter()
                        .zip(internal)
                        .map(|(force, internal)| target_factor * force - internal)
                        .collect();
                    let free_norm = residual
                        .iter()
                        .enumerate()
                        .filter(|(dof, _)| prescribed[*dof].is_none())
                        .map(|(_, value)| value * value)
                        .sum::<f64>()
                        .sqrt();
                    if free_norm / scale <= request.tolerance {
                        if request.linear_backend == MixedLinearBackend::SparseDirect
                            && linear_solver_true_residual.is_none()
                        {
                            // A zero RHS is not proof of stability. Factor the
                            // free tangent even when no Newton correction is needed.
                            let checked =
                                constrained_solve_sparse_direct(&tangent, &residual, &prescribed)?;
                            linear_solver_true_residual = Some(checked.true_free_residual_norm);
                        }
                        converged = true;
                        break;
                    }
                    let increment = match request.linear_backend {
                        MixedLinearBackend::Existing => {
                            let (increment, _) =
                                constrained_solve(&tangent, &residual, &prescribed)?;
                            increment
                        }
                        MixedLinearBackend::SparseDirect => {
                            let solved =
                                constrained_solve_sparse_direct(&tangent, &residual, &prescribed)?;
                            linear_solver_true_residual = Some(solved.true_free_residual_norm);
                            solved.displacements
                        }
                        MixedLinearBackend::FrontalWave => unreachable!("handled above"),
                    };
                    if request.linear_backend == MixedLinearBackend::Existing {
                        let true_residual = tangent
                            .mul(&increment)
                            .iter()
                            .zip(&residual)
                            .enumerate()
                            .filter(|(dof, _)| prescribed[*dof].is_none())
                            .map(|(_, (ax, rhs))| (ax - rhs).powi(2))
                            .sum::<f64>()
                            .sqrt();
                        linear_solver_true_residual = Some(true_residual);
                    }
                    if !increment.iter().all(|value| value.is_finite()) {
                        return Err("non-finite mixed plate increment".into());
                    }
                    for dof in 0..dofs {
                        trial_u[dof] += increment[dof];
                    }
                }
                if converged {
                    u = trial_u;
                    if request.analysis.material() {
                        plate2d::commit_mixed_states(
                            &triangle_request,
                            &u,
                            request.analysis,
                            &mut triangle_states,
                        )?;
                        quad2d::commit_mixed_states(
                            &quad_request,
                            &u,
                            request.analysis,
                            &mut quad_states,
                        )?;
                    }
                    accepted_factor = target_factor;
                    if target_factor == planned_factor {
                        break;
                    }
                    target_factor = planned_factor;
                } else {
                    cutbacks += 1;
                    if cutbacks > 32 {
                        return Err(format!("mixed CST/Q4 analysis did not converge near load factor {target_factor} (last converged {accepted_factor}) at path segment {} step {step}", segment + 1));
                    }
                    target_factor = accepted_factor + 0.5 * (target_factor - accepted_factor);
                }
            }
        }
        segment_start = segment_end;
    }
    let (mut internal, mut tangent) = plate2d::assemble_mixed(
        &triangle_request,
        &u,
        request.analysis,
        &triangle_states,
        false,
    )?;
    let (quad_internal, quad_tangent) =
        quad2d::assemble_mixed(&quad_request, &u, request.analysis, &quad_states, false)?;
    for (value, addition) in internal.iter_mut().zip(quad_internal) {
        *value += addition;
    }
    tangent.add_matrix(&quad_tangent)?;
    plate2d::add_support_springs(&springs, &u, &mut internal, &mut tangent);
    let final_factor = *path.last().unwrap();
    let residual: Vec<f64> = internal
        .iter()
        .zip(&load)
        .map(|(internal, force)| internal - final_factor * force)
        .collect();
    let relative_residual = residual
        .iter()
        .enumerate()
        .filter(|(dof, _)| prescribed[*dof].is_none())
        .map(|(_, value)| value * value)
        .sum::<f64>()
        .sqrt()
        / scale;
    if !relative_residual.is_finite() || relative_residual > request.tolerance * 10.0 {
        return Err(format!(
            "mixed CST/Q4 solve residual is too large: {relative_residual}"
        ));
    }
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| NodeResult {
            node_id: node.id,
            ux_m: u[2 * index],
            uy_m: u[2 * index + 1],
            rx_kn: if prescribed[2 * index].is_some() {
                residual[2 * index]
            } else {
                plate2d::support_spring_reaction(&springs, &u, 2 * index)
            },
            ry_kn: if prescribed[2 * index + 1].is_some() {
                residual[2 * index + 1]
            } else {
                plate2d::support_spring_reaction(&springs, &u, 2 * index + 1)
            },
        })
        .collect();
    let triangles =
        plate2d::recover_mixed(&triangle_request, &u, request.analysis, &triangle_states)?;
    let quads = quad2d::recover_mixed(&quad_request, &u, request.analysis, &quad_states)?;
    Ok(Result2D {
        nodes,
        triangles,
        quads,
        relative_residual,
        linear_solver_true_residual,
        linear_backend_used: request.linear_backend,
        frontal_maximum_front_dofs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mixed_patch() -> Request {
        Request {
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
                    x: 2.0,
                    y: 0.0,
                },
                Node {
                    id: 4,
                    x: 0.0,
                    y: 1.0,
                },
                Node {
                    id: 5,
                    x: 1.0,
                    y: 1.0,
                },
                Node {
                    id: 6,
                    x: 2.0,
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
                    id: 10,
                    node_ids: [1, 2, 5],
                    material_id: 1,
                    thickness_m: 0.1,
                },
                Triangle {
                    id: 11,
                    node_ids: [1, 5, 4],
                    material_id: 1,
                    thickness_m: 0.1,
                },
            ],
            quads: vec![Quad {
                id: 12,
                node_ids: [2, 3, 6, 5],
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
                    node_id: 4,
                    ux: true,
                    uy: false,
                    kx_kn_per_m: None,
                    ky_kn_per_m: None,
                },
            ],
            loads: vec![
                Load {
                    node_id: 3,
                    fx: 50.0,
                    fy: 0.0,
                },
                Load {
                    node_id: 6,
                    fx: 50.0,
                    fy: 0.0,
                },
            ],
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: MixedLinearBackend::Existing,
        }
    }

    #[test]
    fn mixed_cst_q4_sparse_direct_matches_existing_and_reports_true_residual() {
        let reference = solve(&mixed_patch()).unwrap();
        let mut input = mixed_patch();
        input.linear_backend = MixedLinearBackend::SparseDirect;
        let wire = serde_json::to_value(&input).unwrap();
        assert_eq!(wire["linearBackend"], "sparseDirect");
        let input: Request = serde_json::from_value(wire).unwrap();
        let direct = solve(&input).unwrap();
        assert_eq!(direct.linear_backend_used, MixedLinearBackend::SparseDirect);
        assert!(direct.linear_solver_true_residual.unwrap() < 1e-9);
        assert!(direct.relative_residual < 1e-9);
        for (a, b) in reference.nodes.iter().zip(&direct.nodes) {
            assert!((a.ux_m - b.ux_m).abs() < 1e-10);
            assert!((a.uy_m - b.uy_m).abs() < 1e-10);
            assert!((a.rx_kn - b.rx_kn).abs() < 1e-7);
            assert!((a.ry_kn - b.ry_kn).abs() < 1e-7);
        }
        for (a, b) in reference.triangles.iter().zip(&direct.triangles) {
            for (left, right) in a.stress_mpa.iter().zip(b.stress_mpa) {
                assert!((left - right).abs() < 1e-9);
            }
        }
        for (a, b) in reference.quads.iter().zip(&direct.quads) {
            for (left, right) in a.average_stress_mpa.iter().zip(b.average_stress_mpa) {
                assert!((left - right).abs() < 1e-9);
            }
        }
        let mut nonlinear = input;
        nonlinear.analysis = Analysis::Geometric;
        assert!(solve(&nonlinear)
            .unwrap_err()
            .contains("validated only for linear"));

        let mut mechanism = mixed_patch();
        mechanism.linear_backend = MixedLinearBackend::SparseDirect;
        mechanism.loads.clear();
        mechanism.supports.truncate(1);
        assert!(solve(&mechanism).is_err());
    }

    #[test]
    fn mixed_cst_q4_frontal_matches_sparse_with_spring_and_reaction_balance() {
        let mut input = mixed_patch();
        input.supports.push(Support {
            node_id: 4,
            ux: false,
            uy: false,
            kx_kn_per_m: None,
            ky_kn_per_m: Some(25_000.0),
        });
        input.loads[1].fy = -12.0;
        input.linear_backend = MixedLinearBackend::SparseDirect;
        let sparse = solve(&input).unwrap();
        input.linear_backend = MixedLinearBackend::FrontalWave;
        let wire = serde_json::to_value(&input).unwrap();
        assert_eq!(wire["linearBackend"], "frontalWave");
        let input: Request = serde_json::from_value(wire).unwrap();
        let wave = solve(&input).unwrap();
        assert_eq!(wave.linear_backend_used, MixedLinearBackend::FrontalWave);
        assert!(wave.frontal_maximum_front_dofs.unwrap() < 2 * input.nodes.len());
        assert!(wave.linear_solver_true_residual.unwrap() < 1e-8);
        assert!(wave.relative_residual < 1e-8);
        for (a, b) in sparse.nodes.iter().zip(&wave.nodes) {
            assert!((a.ux_m - b.ux_m).abs() < 1e-10);
            assert!((a.uy_m - b.uy_m).abs() < 1e-10);
            assert!((a.rx_kn - b.rx_kn).abs() < 1e-7);
            assert!((a.ry_kn - b.ry_kn).abs() < 1e-7);
        }
        let rx: f64 = wave.nodes.iter().map(|node| node.rx_kn).sum();
        let ry: f64 = wave.nodes.iter().map(|node| node.ry_kn).sum();
        assert!((rx + 100.0).abs() < 1e-7);
        assert!((ry - 12.0).abs() < 1e-7);

        let mut nonlinear = input;
        nonlinear.analysis = Analysis::Material;
        assert!(solve(&nonlinear).unwrap_err().contains("only for linear"));
        let mut mechanism = mixed_patch();
        mechanism.linear_backend = MixedLinearBackend::FrontalWave;
        mechanism.loads.clear();
        mechanism.supports.truncate(1);
        assert!(solve(&mechanism).is_err());
    }

    #[test]
    fn mixed_frontal_elementwise_tangent_matches_sparse_with_nonzero_dirichlet() {
        let input = mixed_patch();
        let node_index: HashMap<usize, usize> = input
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| (node.id, i))
            .collect();
        let springs = vec![(7, 20_000.0)];
        let elements = frontal_linear_elements(&input, &node_index, &springs).unwrap();
        let triangle_request = plate2d::Request {
            analysis: Analysis::Linear,
            nodes: input.nodes.clone(),
            materials: input.materials.clone(),
            orthotropic_materials: input.orthotropic_materials.clone(),
            modulus_curves: input.modulus_curves.clone(),
            triangles: input.triangles.clone(),
            supports: Vec::new(),
            loads: Vec::new(),
            load_path: Vec::new(),
            tolerance: input.tolerance,
            max_iterations: input.max_iterations,
        };
        let quad_request = quad2d::Request {
            analysis: Analysis::Linear,
            nodes: input.nodes.clone(),
            materials: input.materials.clone(),
            orthotropic_materials: input.orthotropic_materials.clone(),
            modulus_curves: input.modulus_curves.clone(),
            quads: input.quads.clone(),
            supports: Vec::new(),
            loads: Vec::new(),
            load_path: Vec::new(),
            tolerance: input.tolerance,
            max_iterations: input.max_iterations,
        };
        let dofs = 2 * input.nodes.len();
        let (_, mut global) = plate2d::assemble_mixed(
            &triangle_request,
            &vec![0.0; dofs],
            Analysis::Linear,
            &vec![State::default(); input.triangles.len()],
            true,
        )
        .unwrap();
        let (_, quad_k) = quad2d::assemble_mixed(
            &quad_request,
            &vec![0.0; dofs],
            Analysis::Linear,
            &vec![[State::default(); 4]; input.quads.len()],
            true,
        )
        .unwrap();
        global.add_matrix(&quad_k).unwrap();
        global.add(7, 7, springs[0].1);
        let mut load = vec![0.0; dofs];
        load[4] = 50.0;
        load[10] = 50.0;
        load[11] = -12.0;
        let mut prescribed = vec![None; dofs];
        prescribed[0] = Some(0.002);
        prescribed[1] = Some(0.0);
        prescribed[6] = Some(0.0);
        let sparse = constrained_solve_sparse_direct(&global, &load, &prescribed).unwrap();
        let wave =
            frontal::solve(&elements, &load, &prescribed, FrontalOptions::default()).unwrap();
        assert!(wave.relative_free_residual < 1e-10);
        for (a, b) in sparse.displacements.iter().zip(&wave.displacements) {
            assert!((a - b).abs() < 1e-10);
        }
        for (a, b) in sparse.reactions.iter().zip(&wave.reactions) {
            assert!((a - b).abs() < 1e-7);
        }
    }

    #[test]
    fn shared_cst_q4_mesh_passes_constant_strain_patch_and_global_balance() {
        let result = solve(&mixed_patch()).unwrap();
        assert_eq!(result.triangles.len(), 2);
        assert_eq!(result.quads.len(), 1);
        for (index, node) in result.nodes.iter().enumerate() {
            let x = [0.0, 1.0, 2.0, 0.0, 1.0, 2.0][index];
            assert!((node.ux_m - 0.001 * x).abs() < 1e-10);
            assert!(node.uy_m.abs() < 1e-10);
        }
        for triangle in &result.triangles {
            assert!((triangle.stress_mpa[0] - 1.0).abs() < 1e-10);
            assert!(triangle.stress_mpa[1].abs() < 1e-10);
            assert!(triangle.stress_mpa[2].abs() < 1e-10);
        }
        for quad in &result.quads {
            assert!((quad.average_stress_mpa[0] - 1.0).abs() < 1e-10);
            assert!(quad.average_stress_mpa[1].abs() < 1e-10);
            assert!(quad.average_stress_mpa[2].abs() < 1e-10);
        }
        let reaction_x: f64 = result.nodes.iter().map(|node| node.rx_kn).sum();
        assert!((reaction_x + 100.0).abs() < 1e-10);
        assert!(result.relative_residual < 1e-9);
    }

    #[test]
    fn mixed_mesh_solves_geometric_nonlinearity_in_one_coupled_system() {
        let input = mixed_patch();
        let linear = solve(&input).unwrap();
        let mut nonlinear = input;
        nonlinear.analysis = Analysis::Combined;
        let result = solve(&nonlinear).unwrap();
        assert!(result.relative_residual < 1e-7);
        assert!(result
            .nodes
            .iter()
            .all(|node| node.ux_m.is_finite() && node.uy_m.is_finite()));
        assert!((result.nodes[2].ux_m - linear.nodes[2].ux_m).abs() > 1e-8);
    }

    #[test]
    fn mixed_mesh_updates_secant_modulus_with_load_path_history() {
        let mut input = mixed_patch();
        input.analysis = Analysis::Material;
        input.modulus_curves.push(ModulusCurve {
            material_id: 1,
            points: vec![
                crate::quad2d::ModulusPoint {
                    strain: 0.0,
                    e_mpa: 1000.0,
                },
                crate::quad2d::ModulusPoint {
                    strain: 0.01,
                    e_mpa: 500.0,
                },
            ],
        });
        input.load_path = vec![1.0, 0.0, 0.5];
        let result = solve(&input).unwrap();
        assert!(result.relative_residual < 1e-7);
        // At peak load, sigma = (1000 - 50000*eps)*eps = 1 MPa.
        // Unloading and reloading to half force retain the peak secant modulus.
        let peak_strain = (1000.0_f64 - (1_000_000.0_f64 - 200_000.0).sqrt()) / 100_000.0;
        let peak_e = 1000.0 - 50_000.0 * peak_strain;
        for element in &result.triangles {
            assert!((element.effective_e_mpa - peak_e).abs() < 1e-5);
            assert!((element.max_equivalent_strain - peak_strain).abs() < 1e-8);
            assert!((element.stress_mpa[0] - 0.5).abs() < 1e-6);
        }
        for point in &result.quads[0].gauss_points {
            assert!((point.effective_e_mpa - peak_e).abs() < 1e-5);
            assert!((point.max_equivalent_strain - peak_strain).abs() < 1e-8);
            assert!((point.stress_mpa[0] - 0.5).abs() < 1e-6);
        }
        assert!((result.nodes[2].ux_m - 1.0 / peak_e).abs() < 1e-8);
    }

    #[test]
    fn mixed_mesh_retains_cst_steel_plasticity_and_q4_concrete_damage() {
        let mut input = mixed_patch();
        input.analysis = Analysis::Material;
        input.materials[0].law = MaterialLaw::SteelBilinear {
            yield_mpa: 0.5,
            hardening_ratio: 0.2,
        };
        input.materials.push(Material {
            id: 2,
            e_mpa: 500.0,
            nu: 0.0,
            law: MaterialLaw::ConcreteCracking {
                tensile_mpa: 0.5,
                residual_ratio: 0.5,
            },
        });
        input.quads[0].material_id = 2;
        let result = solve(&input).unwrap();
        assert!(result
            .triangles
            .iter()
            .all(|element| element.equivalent_plastic_strain > 0.0));
        assert!(result.quads[0]
            .gauss_points
            .iter()
            .all(|point| point.tensile_damage > 0.0));
        assert!(result.relative_residual < 1e-7);
    }

    #[test]
    fn mixed_mesh_keeps_different_element_moduli_in_series() {
        let mut input = mixed_patch();
        input.materials.push(Material {
            id: 2,
            e_mpa: 500.0,
            nu: 0.0,
            law: MaterialLaw::Elastic,
        });
        input.quads[0].material_id = 2;
        let result = solve(&input).unwrap();
        // Two one-metre strips carry 100 kN through A=0.1 m². Their
        // extensions are 1 mm at 1000 MPa and 2 mm at 500 MPa.
        assert!((result.nodes[2].ux_m - 0.003).abs() < 1e-10);
        assert!((result.triangles[0].strain[0] - 0.001).abs() < 1e-10);
        assert!((result.quads[0].average_strain[0] - 0.002).abs() < 1e-10);
        assert!((result.triangles[0].stress_mpa[0] - 1.0).abs() < 1e-10);
        assert!((result.quads[0].average_stress_mpa[0] - 1.0).abs() < 1e-10);
    }
}
