//! Material-only steel-fiber bending in the 17-field hybrid Kirchhoff plate.
//! Membrane extension is locally free (N=0); this is not a coupled shell.

use super::*;
use crate::plate_fiber_section::{BendingInverseResult, SectionState};

const MAX_DENSE_FIBER_PLATE_DOFS: usize = 900;
const MAX_FRONTAL_FIBER_PLATE_DOFS: usize = 5_000;
const MAX_THICKNESS_INTEGRATION_POINTS: usize = 100_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiberQuad {
    pub quad_id: usize,
    /// Layers are ordered from the negative-z to positive-z face.
    pub layers: Vec<PlateFiberLayer>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiberMaterialPointResult {
    pub gauss_index: [usize; 2],
    pub position_m: [f64; 2],
    pub membrane_strain: [f64; 3],
    pub curvature_per_m: [f64; 3],
    pub moment_knm_per_m: [f64; 3],
    pub max_equivalent_plastic_strain: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiberElementResult {
    pub quad_id: usize,
    pub centre_moment_knm_per_m: [f64; 3],
    pub centre_shear_kn_per_m: [f64; 2],
    pub max_equivalent_plastic_strain: f64,
    pub material_points: Vec<FiberMaterialPointResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiberPlateResult {
    pub nodes: Vec<NodeResult>,
    pub elements: Vec<FiberElementResult>,
    pub iterations: usize,
    pub accepted_steps: usize,
    pub cutbacks: usize,
    pub relative_residual: f64,
    pub linear_backend_used: LinearBackend,
    pub frontal_maximum_front_dofs: Option<usize>,
}

struct FiberPoint {
    section: PlateFiberSection,
    committed: SectionState,
    initial_strain: [f64; 6],
    weight: f64,
    position: [f64; 2],
    gauss_index: [usize; 2],
    field: [[f64; 3]; 17],
}

struct FiberElement {
    hybrid: HybridElement,
    points: Vec<FiberPoint>,
}

struct ElementEval {
    inverse: Vec<BendingInverseResult>,
    compatibility: [f64; 17],
    beta: [[f64; 12]; 17],
    gamma: [f64; 17],
    tangent: [[f64; 12]; 12],
    force: [f64; 12],
    mixed_correction: [f64; 12],
    compatibility_scale: f64,
}

struct GlobalEval {
    elements: Vec<ElementEval>,
    tangent: Option<Matrix>,
    frontal_elements: Vec<FrontalElement>,
    residual: Vec<f64>,
    mixed_correction: Vec<f64>,
    global_relative: f64,
    mixed_relative: f64,
}

impl GlobalEval {
    fn merit(&self) -> f64 {
        self.global_relative.hypot(self.mixed_relative)
    }
}

fn norm(values: &[f64]) -> f64 {
    values.iter().map(|v| v * v).sum::<f64>().sqrt()
}

fn fiber_element_eval(
    element: &FiberElement,
    alpha: &[f64; 17],
    local_u: &[f64; 12],
) -> Result<ElementEval, String> {
    let mut h = Matrix::zeros(17)?;
    let mut curvature_integral = [0.0; 17];
    let mut inverse = Vec::with_capacity(element.points.len());
    for point in &element.points {
        let moment: [f64; 3] =
            std::array::from_fn(|i| (0..17).map(|a| point.field[a][i] * alpha[a]).sum());
        let local =
            point
                .section
                .solve_bending_moments(moment, &point.committed, point.initial_strain)?;
        let bending_tangent = point.section.effective_bending_tangent(&local.trial)?;
        let compliance = invert_symmetric_3(bending_tangent)?;
        for a in 0..17 {
            curvature_integral[a] += point.weight
                * (0..3)
                    .map(|i| point.field[a][i] * local.generalized_strain[3 + i])
                    .sum::<f64>();
            for b in 0..17 {
                let value: f64 = (0..3)
                    .flat_map(|i| {
                        (0..3)
                            .map(move |j| point.field[a][i] * compliance[i][j] * point.field[b][j])
                    })
                    .sum();
                h.add(a, b, point.weight * value);
            }
        }
        inverse.push(local);
    }
    let compatibility: [f64; 17] = std::array::from_fn(|a| {
        (0..12)
            .map(|j| element.hybrid.g[a][j] * local_u[j])
            .sum::<f64>()
            - curvature_integral[a]
    });
    let free = [None; 17];
    let gamma_vec = constrained_solve(&h, &compatibility, &free)?.0;
    let gamma: [f64; 17] = std::array::from_fn(|a| gamma_vec[a]);
    let mut beta = [[0.0; 12]; 17];
    for j in 0..12 {
        let rhs: [f64; 17] = std::array::from_fn(|a| element.hybrid.g[a][j]);
        let solution = constrained_solve(&h, &rhs, &free)?.0;
        for a in 0..17 {
            beta[a][j] = solution[a];
        }
    }
    let tangent = std::array::from_fn(|i| {
        std::array::from_fn(|j| (0..17).map(|a| element.hybrid.g[a][i] * beta[a][j]).sum())
    });
    let force = std::array::from_fn(|i| (0..17).map(|a| element.hybrid.g[a][i] * alpha[a]).sum());
    let mixed_correction =
        std::array::from_fn(|i| (0..17).map(|a| element.hybrid.g[a][i] * gamma[a]).sum());
    let compatibility_scale = norm(&curvature_integral)
        .max(norm(&compatibility))
        .max(1e-12);
    Ok(ElementEval {
        inverse,
        compatibility,
        beta,
        gamma,
        tangent,
        force,
        mixed_correction,
        compatibility_scale,
    })
}

fn evaluate_global(
    elements: &[FiberElement],
    alpha: &[[f64; 17]],
    u: &[f64],
    target: &[f64],
    load_norm: f64,
    springs: &[(usize, f64)],
    prescribed: &[Option<f64>],
    backend: LinearBackend,
) -> Result<GlobalEval, String> {
    let mut tangent = if backend == LinearBackend::Existing {
        Some(Matrix::zeros(u.len())?)
    } else {
        None
    };
    let mut frontal_elements = Vec::new();
    let mut residual = target.iter().map(|v| -*v).collect::<Vec<_>>();
    let mut mixed_correction = vec![0.0; u.len()];
    let mut evaluated = Vec::with_capacity(elements.len());
    let mut mixed_ratio_sq = 0.0;
    for (index, element) in elements.iter().enumerate() {
        let local_u = element.hybrid.dofs.map(|dof| u[dof]);
        let evaluated_element = fiber_element_eval(element, &alpha[index], &local_u)?;
        mixed_ratio_sq += (norm(&evaluated_element.compatibility)
            / evaluated_element.compatibility_scale)
            .powi(2);
        for i in 0..12 {
            let row = element.hybrid.dofs[i];
            residual[row] += evaluated_element.force[i];
            mixed_correction[row] += evaluated_element.mixed_correction[i];
            if let Some(matrix) = tangent.as_mut() {
                for j in 0..12 {
                    matrix.add(row, element.hybrid.dofs[j], evaluated_element.tangent[i][j]);
                }
            }
        }
        if backend == LinearBackend::FrontalWave {
            frontal_elements.push(FrontalElement {
                dofs: element.hybrid.dofs.to_vec(),
                stiffness: evaluated_element
                    .tangent
                    .iter()
                    .flatten()
                    .copied()
                    .collect(),
            });
        }
        evaluated.push(evaluated_element);
    }
    for &(dof, stiffness) in springs {
        if let Some(matrix) = tangent.as_mut() {
            matrix.add(dof, dof, stiffness);
        } else {
            frontal_elements.push(FrontalElement {
                dofs: vec![dof],
                stiffness: vec![stiffness],
            });
        }
        residual[dof] += stiffness * u[dof];
    }
    let global_relative = residual
        .iter()
        .enumerate()
        .filter(|(i, _)| prescribed[*i].is_none())
        .map(|(_, value)| value * value)
        .sum::<f64>()
        .sqrt()
        / load_norm;
    Ok(GlobalEval {
        elements: evaluated,
        tangent,
        frontal_elements,
        residual,
        mixed_correction,
        global_relative,
        mixed_relative: mixed_ratio_sq.sqrt(),
    })
}

/// Solve material-only, locally membrane-free bending of elastic/steel layers.
/// Each integration point owns its own section identity and material history.
pub fn solve_with_fiber_sections(
    request: &Request,
    sections: &[FiberQuad],
) -> Result<FiberPlateResult, String> {
    if !request.orthotropic_materials.is_empty()
        || !request.modulus_curves.is_empty()
        || request.reinforcement.is_some()
    {
        return Err(
            "fiber hybrid plate does not combine with orthotropy, modulus curves, or reinforcement"
                .into(),
        );
    }
    if request.nodes.len() < 4 || request.quads.is_empty() {
        return Err("fiber hybrid plate requires quads".into());
    }
    let dofs = 3 * request.nodes.len();
    let dof_limit = match request.linear_backend {
        LinearBackend::Existing => MAX_DENSE_FIBER_PLATE_DOFS,
        LinearBackend::FrontalWave => MAX_FRONTAL_FIBER_PLATE_DOFS,
    };
    if dofs > dof_limit {
        return Err(format!(
            "fiber hybrid plate exceeds the {dof_limit}-DOF selected Newton backend limit"
        ));
    }
    if request.linear_backend == LinearBackend::FrontalWave
        && request.frontal_max_front_dofs == Some(0)
    {
        return Err("fiber hybrid plate frontal maximum front DOFs must be positive".into());
    }
    positive(request.tolerance, "fiber hybrid plate tolerance")?;
    if request.max_iterations == 0 || request.max_iterations > 200 {
        return Err("invalid fiber hybrid plate iteration limit".into());
    }
    if !request.pressure_kn_m2.is_finite() {
        return Err("non-finite fiber hybrid pressure".into());
    }
    let node_index: HashMap<_, _> = request
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id, index))
        .collect();
    if node_index.len() != request.nodes.len()
        || request
            .nodes
            .iter()
            .any(|node| !node.x.is_finite() || !node.y.is_finite())
    {
        return Err("invalid fiber hybrid node IDs or coordinates".into());
    }
    let materials: HashMap<_, _> = request.materials.iter().map(|m| (m.id, m)).collect();
    if materials.len() != request.materials.len() {
        return Err("duplicate fiber hybrid material".into());
    }
    let mut section_by_quad = HashMap::new();
    for spec in sections {
        if section_by_quad.insert(spec.quad_id, spec).is_some() {
            return Err("duplicate fiber hybrid quad section".into());
        }
    }
    if section_by_quad.len() != request.quads.len() {
        return Err("fiber hybrid plate requires a section for every quad".into());
    }
    let thickness_points = sections.iter().try_fold(0usize, |total, spec| {
        let next = spec.layers.len().checked_mul(2 * NGAUSS * NGAUSS)?;
        total.checked_add(next)
    });
    if thickness_points.is_none_or(|count| count > MAX_THICKNESS_INTEGRATION_POINTS) {
        return Err(format!(
            "fiber hybrid plate exceeds the {MAX_THICKNESS_INTEGRATION_POINTS}-point thickness integration limit"
        ));
    }
    let mut quad_ids = HashSet::new();
    let mut elements = Vec::with_capacity(request.quads.len());
    for quad in &request.quads {
        if !quad_ids.insert(quad.id) {
            return Err("duplicate fiber hybrid quad".into());
        }
        let spec = section_by_quad
            .get(&quad.id)
            .ok_or("missing fiber hybrid quad section")?;
        let indices: [Option<usize>; 4] =
            std::array::from_fn(|i| node_index.get(&quad.node_ids[i]).copied());
        let indices = [
            indices[0].ok_or("unknown fiber hybrid quad node")?,
            indices[1].ok_or("unknown fiber hybrid quad node")?,
            indices[2].ok_or("unknown fiber hybrid quad node")?,
            indices[3].ok_or("unknown fiber hybrid quad node")?,
        ];
        if indices.iter().copied().collect::<HashSet<_>>().len() != 4 {
            return Err("fiber hybrid quad repeats a node".into());
        }
        let material = materials
            .get(&quad.material_id)
            .ok_or("unknown fiber hybrid material")?;
        let hybrid = element_with_constitutive(
            quad,
            indices.map(|i| &request.nodes[i]),
            std::array::from_fn(|j| 3 * indices[j / 3] + j % 3),
            material,
            None,
            None,
        )?;
        let mut points = Vec::with_capacity(NGAUSS * NGAUSS);
        for i in 0..NGAUSS {
            for j in 0..NGAUSS {
                // Distinct section identities prevent trial histories from
                // being committed into a different Gauss point.
                let section = PlateFiberSection::new(&spec.layers)?;
                if (section.thickness_m() - quad.thickness_m).abs()
                    > 1e-10 * section.thickness_m().max(quad.thickness_m)
                {
                    return Err("fiber hybrid section thickness differs from quad".into());
                }
                let (x, y, jac) = geometry(
                    indices.map(|index| &request.nodes[index]),
                    ROOTS[i],
                    ROOTS[j],
                )?;
                let field = fields(
                    (x - hybrid.centre[0]) / hybrid.scale,
                    (y - hybrid.centre[1]) / hybrid.scale,
                    hybrid.scale,
                )
                .map(|value| value.moment);
                points.push(FiberPoint {
                    committed: section.initial_state(),
                    section,
                    initial_strain: [0.0; 6],
                    weight: WEIGHTS[i] * WEIGHTS[j] * jac,
                    position: [x, y],
                    gauss_index: [i, j],
                    field,
                });
            }
        }
        elements.push(FiberElement { hybrid, points });
    }
    if section_by_quad.keys().any(|id| !quad_ids.contains(id)) {
        return Err("unknown fiber hybrid quad section".into());
    }
    let mut quad_pressures = HashMap::new();
    for pressure in &request.quad_pressures {
        if !quad_ids.contains(&pressure.quad_id)
            || !pressure.nodal_pressure_kn_m2.iter().all(|v| v.is_finite())
            || quad_pressures.insert(pressure.quad_id, pressure).is_some()
        {
            return Err("invalid fiber hybrid quad pressure".into());
        }
    }
    let mut edge_loads: HashMap<usize, Vec<&EdgeLoad>> = HashMap::new();
    for edge_load in &request.edge_loads {
        if !quad_ids.contains(&edge_load.quad_id)
            || edge_load.edge_index > 3
            || !edge_load.start_kn_per_m.is_finite()
            || !edge_load.end_kn_per_m.is_finite()
        {
            return Err("invalid fiber hybrid edge load".into());
        }
        edge_loads
            .entry(edge_load.quad_id)
            .or_default()
            .push(edge_load);
    }
    let springs = collect_support_springs(&request.supports, &node_index, 3, [0, 1, 2])?;
    let mut prescribed = vec![None; dofs];
    for support in &request.supports {
        let node = *node_index
            .get(&support.node_id)
            .ok_or("unknown fiber hybrid support node")?;
        for (offset, fixed) in [support.w, support.theta_x, support.theta_y]
            .into_iter()
            .enumerate()
        {
            if fixed {
                prescribed[3 * node + offset] = Some(0.0);
            }
        }
    }
    let mut load = vec![0.0; dofs];
    for item in &request.loads {
        let node = *node_index
            .get(&item.node_id)
            .ok_or("unknown fiber hybrid loaded node")?;
        load[3 * node] += item.fz;
        load[3 * node + 1] += item.mx;
        load[3 * node + 2] += item.my;
    }
    for element in &elements {
        let hybrid = &element.hybrid;
        let extra = quad_pressures
            .get(&hybrid.id)
            .map_or([0.0; 4], |pressure| pressure.nodal_pressure_kn_m2);
        for j in 0..4 {
            load[hybrid.dofs[3 * j]] += (0..4)
                .map(|a| hybrid.pressure_matrix[j][a] * (request.pressure_kn_m2 + extra[a]))
                .sum::<f64>();
        }
        if let Some(items) = edge_loads.get(&hybrid.id) {
            for item in items {
                let edge = item.edge_index;
                let next_node = (edge + 1) % 4;
                let [length, tx, ty, nx, ny] = hybrid.edges[edge];
                for q in 0..NGAUSS {
                    let s = 0.5 * (ROOTS[q] + 1.0);
                    let line_load = item.start_kn_per_m * (1.0 - s) + item.end_kn_per_m * s;
                    let weighted = length * WEIGHTS[q] * 0.5 * line_load;
                    for local_dof in 0..12 {
                        let (w, _) = edge_kinematics(
                            local_dof,
                            edge,
                            next_node,
                            s,
                            length,
                            [tx, ty],
                            [nx, ny],
                        );
                        load[hybrid.dofs[local_dof]] += weighted * w;
                    }
                }
            }
        }
    }
    let path = if request.load_path.is_empty() {
        vec![1.0]
    } else {
        request.load_path.clone()
    };
    if path.iter().any(|factor| !factor.is_finite()) {
        return Err("non-finite fiber hybrid load path".into());
    }
    let load_norm = norm(&load).max(1e-9);
    let mut u = vec![0.0; dofs];
    let mut alpha = vec![[0.0; 17]; elements.len()];
    let mut total_iterations = 0;
    let mut accepted_steps = 0;
    let mut cutbacks = 0;
    let mut last_eval = None;
    let mut frontal_maximum_front_dofs = None;
    let mut start_factor = 0.0;
    for &end_factor in &path {
        let mut accepted_factor = start_factor;
        let mut target_factor = end_factor;
        let mut segment_cutbacks = 0;
        loop {
            let accepted_u = u.clone();
            let accepted_alpha = alpha.clone();
            let target: Vec<f64> = load.iter().map(|value| target_factor * value).collect();
            let mut converged = false;
            for _ in 0..request.max_iterations {
                total_iterations += 1;
                let current = match evaluate_global(
                    &elements,
                    &alpha,
                    &u,
                    &target,
                    load_norm,
                    &springs,
                    &prescribed,
                    request.linear_backend,
                ) {
                    Ok(value) => value,
                    Err(_) => break,
                };
                if current.global_relative <= request.tolerance
                    && current.mixed_relative <= request.tolerance
                {
                    // Stage every point commit before mutating any accepted
                    // history, so a failed commit cannot partially advance it.
                    let mut staged = Vec::with_capacity(elements.len());
                    for (element, evaluated) in elements.iter().zip(&current.elements) {
                        let mut next = Vec::with_capacity(element.points.len());
                        for (point, inverse) in element.points.iter().zip(&evaluated.inverse) {
                            let mut state = point.committed.clone();
                            point.section.commit(&mut state, &inverse.trial)?;
                            next.push((state, inverse.generalized_strain));
                        }
                        staged.push(next);
                    }
                    for (element, states) in elements.iter_mut().zip(staged) {
                        for (point, (state, strain)) in element.points.iter_mut().zip(states) {
                            point.committed = state;
                            point.initial_strain = strain;
                        }
                    }
                    last_eval = Some(current);
                    accepted_steps += 1;
                    converged = true;
                    break;
                }
                let rhs: Vec<f64> = current
                    .residual
                    .iter()
                    .zip(&current.mixed_correction)
                    .map(|(r, mixed)| -r - mixed)
                    .collect();
                let correction = match request.linear_backend {
                    LinearBackend::Existing => match constrained_solve(
                        current.tangent.as_ref().expect("dense tangent"),
                        &rhs,
                        &prescribed,
                    ) {
                        Ok((value, _)) => value,
                        Err(_) => break,
                    },
                    LinearBackend::FrontalWave => {
                        let options = FrontalOptions {
                            max_front_dofs: request
                                .frontal_max_front_dofs
                                .unwrap_or(FrontalOptions::default().max_front_dofs),
                            ..FrontalOptions::default()
                        };
                        match frontal::solve(&current.frontal_elements, &rhs, &prescribed, options)
                        {
                            Ok(solved) => {
                                frontal_maximum_front_dofs = Some(
                                    frontal_maximum_front_dofs
                                        .unwrap_or(0_usize)
                                        .max(solved.maximum_front_dofs),
                                );
                                solved.displacements
                            }
                            Err(error) if error.contains("wavefront exceeded maximum") => {
                                return Err(format!("fiber hybrid plate {error}"));
                            }
                            Err(_) => break,
                        }
                    }
                };
                let mut alpha_increment = vec![[0.0; 17]; elements.len()];
                for (index, element) in elements.iter().enumerate() {
                    let local = element.hybrid.dofs.map(|dof| correction[dof]);
                    for a in 0..17 {
                        alpha_increment[index][a] = current.elements[index].gamma[a]
                            + (0..12)
                                .map(|j| current.elements[index].beta[a][j] * local[j])
                                .sum::<f64>();
                    }
                }
                let mut accepted_candidate = None;
                for halvings in 0..=12 {
                    let fraction = 2.0_f64.powi(-halvings);
                    let candidate_u: Vec<f64> = u
                        .iter()
                        .zip(&correction)
                        .map(|(value, delta)| value + fraction * delta)
                        .collect();
                    let candidate_alpha: Vec<[f64; 17]> = alpha
                        .iter()
                        .zip(&alpha_increment)
                        .map(|(values, delta)| {
                            std::array::from_fn(|a| values[a] + fraction * delta[a])
                        })
                        .collect();
                    let Ok(candidate) = evaluate_global(
                        &elements,
                        &candidate_alpha,
                        &candidate_u,
                        &target,
                        load_norm,
                        &springs,
                        &prescribed,
                        request.linear_backend,
                    ) else {
                        continue;
                    };
                    if candidate.merit() < current.merit() * (1.0 - 1e-4 * fraction)
                        || (candidate.global_relative <= request.tolerance
                            && candidate.mixed_relative <= request.tolerance)
                    {
                        accepted_candidate = Some((candidate_u, candidate_alpha));
                        break;
                    }
                }
                if let Some((next_u, next_alpha)) = accepted_candidate {
                    u = next_u;
                    alpha = next_alpha;
                } else {
                    break;
                }
            }
            if converged {
                accepted_factor = target_factor;
                if target_factor == end_factor {
                    break;
                }
                target_factor = end_factor;
            } else {
                u = accepted_u;
                alpha = accepted_alpha;
                segment_cutbacks += 1;
                cutbacks += 1;
                if segment_cutbacks > 24 {
                    return Err(format!(
                        "fiber hybrid plate Newton failed near load factor {target_factor} (last accepted {accepted_factor})"
                    ));
                }
                target_factor = accepted_factor + 0.5 * (target_factor - accepted_factor);
            }
        }
        start_factor = end_factor;
    }
    let final_eval = last_eval.ok_or("fiber hybrid plate did not accept a load step")?;
    let nodes = request
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| {
            let reaction = |dof: usize| {
                if prescribed[dof].is_some() {
                    final_eval.residual[dof]
                } else {
                    support_spring_reaction(&springs, &u, dof)
                }
            };
            NodeResult {
                node_id: node.id,
                w_m: u[3 * i],
                theta_x_rad: u[3 * i + 1],
                theta_y_rad: u[3 * i + 2],
                reaction_fz_kn: reaction(3 * i),
                reaction_mx_knm: reaction(3 * i + 1),
                reaction_my_knm: reaction(3 * i + 2),
            }
        })
        .collect();
    let mut element_results = Vec::with_capacity(elements.len());
    for (element, evaluated) in elements.iter().zip(&final_eval.elements) {
        let alpha = &alpha[element_results.len()];
        let fs = fields(0.0, 0.0, element.hybrid.scale);
        let centre_moment =
            std::array::from_fn(|i| (0..17).map(|a| alpha[a] * fs[a].moment[i]).sum());
        let centre_shear =
            std::array::from_fn(|i| (0..17).map(|a| alpha[a] * fs[a].divergence[i]).sum());
        let material_points: Vec<_> = element
            .points
            .iter()
            .zip(&evaluated.inverse)
            .map(|(point, inverse)| {
                let maximum = inverse
                    .trial
                    .fiber_states()
                    .iter()
                    .map(|state| state.equivalent_plastic_strain)
                    .fold(0.0_f64, f64::max);
                FiberMaterialPointResult {
                    gauss_index: point.gauss_index,
                    position_m: point.position,
                    membrane_strain: std::array::from_fn(|i| inverse.generalized_strain[i]),
                    curvature_per_m: std::array::from_fn(|i| inverse.generalized_strain[i + 3]),
                    moment_knm_per_m: std::array::from_fn(|i| inverse.trial.resultants[i + 3]),
                    max_equivalent_plastic_strain: maximum,
                }
            })
            .collect();
        let max_equivalent_plastic_strain = material_points
            .iter()
            .map(|point| point.max_equivalent_plastic_strain)
            .fold(0.0_f64, f64::max);
        element_results.push(FiberElementResult {
            quad_id: element.hybrid.id,
            centre_moment_knm_per_m: centre_moment,
            centre_shear_kn_per_m: centre_shear,
            max_equivalent_plastic_strain,
            material_points,
        });
    }
    Ok(FiberPlateResult {
        nodes,
        elements: element_results,
        iterations: total_iterations,
        accepted_steps,
        cutbacks,
        relative_residual: final_eval.global_relative,
        linear_backend_used: request.linear_backend,
        frontal_maximum_front_dofs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quad2d::{mesh_squares, SquareGrid};

    fn cantilever(pressure: f64) -> Request {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            cell_size_m: 1.0,
            material_id: 1,
            thickness_m: 0.2,
        })
        .unwrap();
        Request {
            nodes: mesh
                .nodes
                .iter()
                .map(|n| Node {
                    id: n.id,
                    x: n.x,
                    y: n.y,
                })
                .collect(),
            materials: vec![Material {
                id: 1,
                e_mpa: 30_000.0,
                nu: 0.0,
            }],
            orthotropic_materials: vec![],
            quads: mesh.quads,
            supports: mesh
                .left_node_ids
                .into_iter()
                .map(|node_id| Support {
                    node_id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                })
                .collect(),
            loads: vec![],
            edge_loads: vec![],
            pressure_kn_m2: pressure,
            quad_pressures: vec![],
            modulus_curves: vec![],
            reinforcement: None,
            load_path: vec![],
            tolerance: 1e-8,
            max_iterations: 40,
            linear_backend: LinearBackend::Existing,
            frontal_max_front_dofs: None,
        }
    }

    fn sections(request: &Request, law: MaterialLaw) -> Vec<FiberQuad> {
        let layer_count = if matches!(law, MaterialLaw::Elastic) {
            1
        } else {
            16
        };
        request
            .quads
            .iter()
            .map(|quad| FiberQuad {
                quad_id: quad.id,
                layers: (0..layer_count)
                    .map(|_| PlateFiberLayer {
                        thickness_m: quad.thickness_m / layer_count as f64,
                        e_mpa: 30_000.0,
                        nu: 0.0,
                        law,
                    })
                    .collect(),
            })
            .collect()
    }

    fn close(actual: f64, expected: f64, relative: f64) {
        assert!(
            (actual - expected).abs() <= relative * expected.abs().max(1e-6),
            "actual={actual:.12e}, expected={expected:.12e}"
        );
    }

    #[test]
    fn elastic_fiber_limit_matches_existing_mixed_hybrid_plate() {
        let request = cantilever(-1.0);
        let baseline = solve(&request).unwrap();
        let fiber =
            solve_with_fiber_sections(&request, &sections(&request, MaterialLaw::Elastic)).unwrap();
        assert_eq!(fiber.elements.len(), baseline.elements.len());
        assert_eq!(fiber.accepted_steps, 1);
        assert_eq!(fiber.cutbacks, 0);
        for (actual, expected) in fiber.nodes.iter().zip(&baseline.nodes) {
            close(actual.w_m, expected.w_m, 1e-7);
            close(actual.theta_x_rad, expected.theta_x_rad, 1e-7);
            close(actual.theta_y_rad, expected.theta_y_rad, 1e-7);
            close(actual.reaction_fz_kn, expected.reaction_fz_kn, 1e-7);
            close(actual.reaction_mx_knm, expected.reaction_mx_knm, 1e-7);
            close(actual.reaction_my_knm, expected.reaction_my_knm, 1e-7);
        }
        for (actual, expected) in fiber.elements.iter().zip(&baseline.elements) {
            for i in 0..3 {
                close(
                    actual.centre_moment_knm_per_m[i],
                    expected.moment_knm_per_m[i],
                    1e-7,
                );
            }
            assert_eq!(actual.material_points.len(), 16);
        }
        assert!(fiber.relative_residual < 1e-8);
    }

    #[test]
    fn frontal_fiber_elastic_backend_matches_dense_and_reports_wavefront() {
        let request = cantilever(-1.0);
        let layers = sections(&request, MaterialLaw::Elastic);
        let dense = solve_with_fiber_sections(&request, &layers).unwrap();
        let mut frontal_request = request.clone();
        frontal_request.linear_backend = LinearBackend::FrontalWave;
        frontal_request.frontal_max_front_dofs = Some(64);
        let frontal = solve_with_fiber_sections(&frontal_request, &layers).unwrap();
        assert_eq!(frontal.linear_backend_used, LinearBackend::FrontalWave);
        assert!(frontal.frontal_maximum_front_dofs.unwrap() > 0);
        assert!(frontal.relative_residual < 1e-8);
        for (actual, expected) in frontal.nodes.iter().zip(&dense.nodes) {
            close(actual.w_m, expected.w_m, 1e-7);
            close(actual.theta_x_rad, expected.theta_x_rad, 1e-7);
            close(actual.theta_y_rad, expected.theta_y_rad, 1e-7);
            close(actual.reaction_fz_kn, expected.reaction_fz_kn, 1e-7);
            close(actual.reaction_mx_knm, expected.reaction_mx_knm, 1e-7);
            close(actual.reaction_my_knm, expected.reaction_my_knm, 1e-7);
        }
    }

    #[test]
    fn frontal_fiber_rejects_explicitly_insufficient_wavefront() {
        let mut request = cantilever(-1.0);
        let layers = sections(&request, MaterialLaw::Elastic);
        request.linear_backend = LinearBackend::FrontalWave;
        request.frontal_max_front_dofs = Some(1);
        let error = solve_with_fiber_sections(&request, &layers).unwrap_err();
        assert!(error.contains("wavefront exceeded maximum"), "{error}");
    }

    #[test]
    #[ignore = "explicit 975-DOF frontal fiber plate scale gate"]
    fn frontal_fiber_solves_mesh_above_dense_dof_limit() {
        let mesh = mesh_squares(&SquareGrid {
            origin_x: 0.0,
            origin_y: 0.0,
            width_m: 2.0,
            height_m: 1.0,
            cell_size_m: 1.0 / 12.0,
            material_id: 1,
            thickness_m: 0.2,
        })
        .unwrap();
        let mut request = cantilever(-1.0);
        request.nodes = mesh
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect();
        request.quads = mesh.quads;
        request.supports = mesh
            .left_node_ids
            .into_iter()
            .map(|node_id| Support {
                node_id,
                w: true,
                theta_x: true,
                theta_y: true,
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect();
        assert!(3 * request.nodes.len() > MAX_DENSE_FIBER_PLATE_DOFS);
        request.linear_backend = LinearBackend::FrontalWave;
        request.frontal_max_front_dofs = Some(256);
        let sections = sections(&request, MaterialLaw::Elastic);
        let result = solve_with_fiber_sections(&request, &sections).unwrap();
        assert_eq!(result.linear_backend_used, LinearBackend::FrontalWave);
        assert!(result.frontal_maximum_front_dofs.unwrap() <= 256);
        assert!(result.relative_residual < 1e-8);
        close(
            result.nodes.iter().map(|node| node.reaction_fz_kn).sum(),
            2.0,
            1e-7,
        );
    }

    #[test]
    fn steel_fiber_load_path_retains_plasticity_and_permanent_deflection() {
        let mut request = cantilever(-8.0);
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 1.0,
            hardening_ratio: 0.02,
        };
        let fiber_sections = sections(&request, law);
        request.load_path = vec![0.5, 1.0];
        let peak = solve_with_fiber_sections(&request, &fiber_sections).unwrap();
        assert!(peak.relative_residual < 1e-8);
        assert!(peak
            .elements
            .iter()
            .any(|element| element.max_equivalent_plastic_strain > 0.0));
        let elastic = solve(&request).unwrap();
        let peak_tip = peak.nodes.last().unwrap().w_m;
        assert!(peak_tip.abs() > elastic.nodes.last().unwrap().w_m.abs());
        request.load_path.push(0.0);
        let unloaded = solve_with_fiber_sections(&request, &fiber_sections).unwrap();
        assert!(unloaded.relative_residual < 1e-8);
        assert!(unloaded.accepted_steps >= 3);
        assert!(unloaded.nodes.last().unwrap().w_m.abs() > 1e-8);
        assert!(unloaded.nodes.last().unwrap().w_m.abs() < peak_tip.abs());
        assert!(unloaded
            .elements
            .iter()
            .any(|element| element.max_equivalent_plastic_strain > 0.0));
        close(
            unloaded.nodes.iter().map(|node| node.reaction_fz_kn).sum(),
            0.0,
            1e-7,
        );
        close(
            peak.nodes.iter().map(|node| node.reaction_fz_kn).sum(),
            16.0,
            1e-7,
        );
    }

    #[test]
    fn frontal_fiber_plastic_path_matches_dense_history_and_reactions() {
        let mut request = cantilever(-8.0);
        request.load_path = vec![0.5, 1.0, 0.0];
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 1.0,
            hardening_ratio: 0.02,
        };
        let sections: Vec<_> = request
            .quads
            .iter()
            .map(|quad| FiberQuad {
                quad_id: quad.id,
                layers: vec![
                    PlateFiberLayer {
                        thickness_m: quad.thickness_m / 8.0,
                        e_mpa: 30_000.0,
                        nu: 0.0,
                        law,
                    };
                    8
                ],
            })
            .collect();
        let dense = solve_with_fiber_sections(&request, &sections).unwrap();
        request.linear_backend = LinearBackend::FrontalWave;
        request.frontal_max_front_dofs = Some(64);
        let frontal = solve_with_fiber_sections(&request, &sections).unwrap();
        assert_eq!(frontal.linear_backend_used, LinearBackend::FrontalWave);
        assert!(frontal.frontal_maximum_front_dofs.unwrap() > 0);
        assert!(frontal.relative_residual < 1e-8);
        assert!(frontal
            .elements
            .iter()
            .any(|element| element.max_equivalent_plastic_strain > 0.0));
        for (actual, expected) in frontal.nodes.iter().zip(&dense.nodes) {
            close(actual.w_m, expected.w_m, 1e-5);
            close(actual.reaction_fz_kn, expected.reaction_fz_kn, 1e-5);
        }
        for (actual, expected) in frontal.elements.iter().zip(&dense.elements) {
            close(
                actual.max_equivalent_plastic_strain,
                expected.max_equivalent_plastic_strain,
                1e-5,
            );
        }
    }

    #[test]
    fn asymmetric_elastic_stack_matches_existing_schur_condensation() {
        let request = cantilever(-1.0);
        let fiber_sections: Vec<_> = request
            .quads
            .iter()
            .map(|quad| FiberQuad {
                quad_id: quad.id,
                layers: vec![
                    PlateFiberLayer {
                        thickness_m: 0.1,
                        e_mpa: 10_000.0,
                        nu: 0.0,
                        law: MaterialLaw::Elastic,
                    },
                    PlateFiberLayer {
                        thickness_m: 0.1,
                        e_mpa: 30_000.0,
                        nu: 0.0,
                        law: MaterialLaw::Elastic,
                    },
                ],
            })
            .collect();
        let linear_sections: Vec<_> = fiber_sections
            .iter()
            .map(|quad| ElasticLayeredQuad {
                quad_id: quad.quad_id,
                layers: quad.layers.clone(),
            })
            .collect();
        let reference = solve_with_elastic_layered_sections(&request, &linear_sections).unwrap();
        let fiber = solve_with_fiber_sections(&request, &fiber_sections).unwrap();
        assert!(fiber.relative_residual < 1e-8);
        for (actual, expected) in fiber.nodes.iter().zip(&reference.nodes) {
            close(actual.w_m, expected.w_m, 1e-7);
            close(actual.theta_x_rad, expected.theta_x_rad, 1e-7);
            close(actual.theta_y_rad, expected.theta_y_rad, 1e-7);
            close(actual.reaction_fz_kn, expected.reaction_fz_kn, 1e-7);
        }
        for (actual, expected) in fiber.elements.iter().zip(&reference.elements) {
            for i in 0..3 {
                close(
                    actual.centre_moment_knm_per_m[i],
                    expected.moment_knm_per_m[i],
                    1e-7,
                );
            }
            assert!(actual
                .material_points
                .iter()
                .any(|point| point.membrane_strain.iter().any(|v| v.abs() > 1e-10)));
        }
    }

    #[test]
    fn constant_curvature_mixed_residual_matches_closed_plate_rigidity() {
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
                x: 1.0,
                y: 1.0,
            },
            Node {
                id: 4,
                x: 0.0,
                y: 1.0,
            },
        ];
        let quad = Quad {
            id: 1,
            node_ids: [1, 2, 3, 4],
            material_id: 1,
            thickness_m: 0.1,
        };
        let material = Material {
            id: 1,
            e_mpa: 30_000.0,
            nu: 0.2,
        };
        let hybrid = element_with_constitutive(
            &quad,
            [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
            std::array::from_fn(|i| i),
            &material,
            None,
            None,
        )
        .unwrap();
        let mut points = Vec::new();
        for i in 0..NGAUSS {
            for j in 0..NGAUSS {
                let section = PlateFiberSection::new(&[PlateFiberLayer {
                    thickness_m: 0.1,
                    e_mpa: 30_000.0,
                    nu: 0.2,
                    law: MaterialLaw::Elastic,
                }])
                .unwrap();
                let (x, y, jac) = geometry(
                    [&nodes[0], &nodes[1], &nodes[2], &nodes[3]],
                    ROOTS[i],
                    ROOTS[j],
                )
                .unwrap();
                points.push(FiberPoint {
                    committed: section.initial_state(),
                    section,
                    initial_strain: [0.0; 6],
                    weight: WEIGHTS[i] * WEIGHTS[j] * jac,
                    position: [x, y],
                    gauss_index: [i, j],
                    field: fields(x - 0.5, y - 0.5, 1.0).map(|field| field.moment),
                });
            }
        }
        let element = FiberElement { hybrid, points };
        let kappa = 0.001;
        let rigidity = 30_000.0 * 1000.0 * 0.1_f64.powi(3) / (12.0 * (1.0 - 0.2_f64.powi(2)));
        let mut alpha = [0.0; 17];
        alpha[0] = rigidity * kappa;
        alpha[6] = 0.2 * rigidity * kappa;
        let u = [
            0.0,
            0.0,
            0.0,
            0.5 * kappa,
            0.0,
            kappa,
            0.5 * kappa,
            0.0,
            kappa,
            0.0,
            0.0,
            0.0,
        ];
        let evaluation = fiber_element_eval(&element, &alpha, &u).unwrap();
        assert!(norm(&evaluation.compatibility) < 1e-10);
        for point in evaluation.inverse {
            close(point.generalized_strain[3], kappa, 1e-8);
            close(point.generalized_strain[4], 0.0, 1e-8);
            close(point.generalized_strain[5], 0.0, 1e-8);
        }
    }
}
