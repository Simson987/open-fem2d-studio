//! Experimental global Tet4 tension-damage route.
//!
//! Coordinates/displacements: m; stress/modulus: MPa; force: kN. Each Tet4
//! carries one `TensionDamageState`. All Newton trials use the last committed
//! history, and history advances only after a step satisfies true equilibrium.
//! The undamaged elastic branch uses its exact tangent; damaged states use a
//! centered numerical material Jacobian because the material law's `secant_mpa`
//! is then *not* its consistent tangent. The Jacobian may
//! be nonsymmetric or indefinite in softening. Small models use pivoted dense
//! LU; an explicit bounded CSR-GMRES route handles larger validation meshes.
//! Force control past peak can have no stable
//! solution; this solver reports failure rather than claiming branch tracing.
//!
//! The caller must supply a crack-band width. The local energy calibration
//! verifies uniaxial monotonic work only; it does not establish general 3D mesh
//! objectivity or structural concrete design validity.

use crate::csr::{CsrMatrix, CsrPatternAssembler};
use crate::csr_gmres::{solve_gmres, GmresOptions};
use crate::solid_concrete_damage::{TensionDamageMaterial, TensionDamageState};
use crate::volume3d::Mesh;

const MAX_DOFS: usize = 180;
const MAX_TETS: usize = 300;
const MAX_SPARSE_DOFS: usize = 12_000;
const MAX_SPARSE_TETS: usize = 20_000;
const MAX_SPARSE_NODE_SLOTS: usize = 320_000;
const MAX_SPARSE_NONZEROS: usize = 3_000_000;
const MPA_M2_TO_KN: f64 = 1_000.0;

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteTetTarget {
    pub loads_kn: Vec<[f64; 3]>,
    pub prescribed_m: Vec<[Option<f64>; 3]>,
    /// Constant reference-volume force density, kN/m³, per Tet4.
    #[serde(default)]
    pub body_forces: Vec<ConcreteTetBodyForce>,
    /// Constant nominal traction on a reference Tet4 face, kN/m².
    #[serde(default)]
    pub face_tractions: Vec<ConcreteTetFaceTraction>,
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteTetBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteTetFaceTraction {
    pub element: usize,
    /// Three distinct global node indices forming a face of `element`.
    pub face_nodes: [usize; 3],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ConcreteTetOptions {
    pub residual_tolerance: f64,
    pub max_newton_iterations: usize,
    pub max_line_search_halvings: usize,
    pub min_step_fraction: f64,
    pub max_cutbacks: usize,
    pub linear_backend: ConcreteTetLinearBackend,
    pub gmres_restart: usize,
    pub gmres_max_iterations: usize,
    pub gmres_relative_tolerance: f64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConcreteTetLinearBackend {
    #[default]
    DenseLu,
    SparseGmres,
}

impl Default for ConcreteTetOptions {
    fn default() -> Self {
        Self {
            residual_tolerance: 1e-9,
            max_newton_iterations: 25,
            max_line_search_halvings: 12,
            min_step_fraction: 1.0 / 2_048.0,
            max_cutbacks: 30,
            linear_backend: ConcreteTetLinearBackend::DenseLu,
            gmres_restart: 40,
            gmres_max_iterations: 4_000,
            gmres_relative_tolerance: 1e-10,
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteTetMaterial {
    pub e_mpa: f64,
    pub poisson: f64,
    pub tensile_strength_mpa: f64,
    pub fracture_energy_n_per_m: f64,
    pub crack_band_width_m: f64,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteTetRequest {
    pub mesh: Mesh,
    pub e_mpa: f64,
    pub poisson: f64,
    pub tensile_strength_mpa: f64,
    pub fracture_energy_n_per_m: f64,
    /// Explicit localization width used to calibrate the material law.
    pub crack_band_width_m: f64,
    /// Optional calibrated damage material for each Tet4, in mesh.tets order.
    #[serde(default)]
    pub element_materials: Option<Vec<ConcreteTetMaterial>>,
    pub targets: Vec<ConcreteTetTarget>,
    #[serde(default)]
    pub options: ConcreteTetOptions,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteAcceptedStep {
    pub target_index: usize,
    pub target_fraction: f64,
    pub newton_iterations: usize,
    pub true_free_residual_kn: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcreteTetResult {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    /// Final nominal stress [xx, yy, zz, xy, yz, zx] in MPa per Tet4.
    pub element_stress_mpa: Vec<[f64; 6]>,
    /// Final scalar tensile damage per Tet4, in [0, 1].
    pub element_damage: Vec<f64>,
    pub element_states: Vec<TensionDamageState>,
    pub accepted_steps: Vec<ConcreteAcceptedStep>,
    pub cutbacks: usize,
    pub true_free_residual_kn: f64,
    pub linear_backend_used: ConcreteTetLinearBackend,
}

#[derive(Clone, Copy, Debug)]
struct Tet {
    nodes: [usize; 4],
    gradients: [[f64; 3]; 4],
    volume: f64,
}

struct Evaluation {
    internal_kn: Vec<f64>,
    element_stress_mpa: Vec<[f64; 6]>,
    element_damage: Vec<f64>,
    trial_states: Vec<TensionDamageState>,
    tangent: Option<Tangent>,
}

enum Tangent {
    Dense(Vec<f64>),
    Sparse(CsrMatrix),
}

struct Step {
    displacement: Vec<f64>,
    evaluation: Evaluation,
    iterations: usize,
    residual: f64,
}

pub fn solve(request: &ConcreteTetRequest) -> Result<ConcreteTetResult, String> {
    let nodes = request.mesh.nodes.len();
    let dofs = nodes.checked_mul(3).ok_or("concrete Tet4 DOF overflow")?;
    let (max_dofs, max_tets) = match request.options.linear_backend {
        ConcreteTetLinearBackend::DenseLu => (MAX_DOFS, MAX_TETS),
        ConcreteTetLinearBackend::SparseGmres => (MAX_SPARSE_DOFS, MAX_SPARSE_TETS),
    };
    if dofs == 0
        || dofs > max_dofs
        || request.mesh.tets.is_empty()
        || request.mesh.tets.len() > max_tets
    {
        return Err(format!(
            "experimental concrete Tet4 {:?} limit: 1..={max_dofs} DOF, 1..={max_tets} elements",
            request.options.linear_backend
        ));
    }
    let global_material = TensionDamageMaterial::from_fracture_energy(
        request.e_mpa,
        request.poisson,
        request.tensile_strength_mpa,
        request.fracture_energy_n_per_m,
        request.crack_band_width_m,
    )?;
    let materials: Vec<TensionDamageMaterial> = match &request.element_materials {
        Some(element_materials) => {
            if element_materials.len() != request.mesh.tets.len() {
                return Err(format!(
                    "concrete elementMaterials needs {} entries, got {}",
                    request.mesh.tets.len(),
                    element_materials.len()
                ));
            }
            element_materials
                .iter()
                .enumerate()
                .map(|(index, material)| {
                    TensionDamageMaterial::from_fracture_energy(
                        material.e_mpa,
                        material.poisson,
                        material.tensile_strength_mpa,
                        material.fracture_energy_n_per_m,
                        material.crack_band_width_m,
                    )
                    .map_err(|error| format!("concrete elementMaterials[{index}]: {error}"))
                })
                .collect::<Result<_, _>>()?
        }
        None => vec![global_material; request.mesh.tets.len()],
    };
    let options = request.options;
    if !options.residual_tolerance.is_finite()
        || options.residual_tolerance <= 0.0
        || options.residual_tolerance >= 1.0
        || options.max_newton_iterations == 0
        || options.max_newton_iterations > 100
        || options.max_line_search_halvings > 30
        || options.max_cutbacks == 0
        || options.max_cutbacks > 100
        || !options.min_step_fraction.is_finite()
        || options.min_step_fraction <= 0.0
        || options.min_step_fraction > 1.0
        || options.gmres_restart == 0
        || options.gmres_restart > 200
        || options.gmres_max_iterations == 0
        || options.gmres_max_iterations > 100_000
        || !options.gmres_relative_tolerance.is_finite()
        || options.gmres_relative_tolerance <= 0.0
        || options.gmres_relative_tolerance >= 1.0
    {
        return Err("invalid concrete Tet4 Newton/step options".into());
    }
    let tets = prepare_tets(&request.mesh)?;
    let first = request
        .targets
        .first()
        .ok_or("concrete Tet4 needs a load target")?;
    let mask = validate_target(first, nodes, None)?;
    if !mask.iter().any(|&fixed| fixed) {
        return Err("concrete Tet4 has no prescribed DOF".into());
    }
    for target in &request.targets[1..] {
        validate_target(target, nodes, Some(&mask))?;
    }
    let target_loads: Vec<Vec<f64>> = request
        .targets
        .iter()
        .map(|target| assemble_target_loads(target, &request.mesh, &tets))
        .collect::<Result<_, _>>()?;
    let mut displacement = vec![0.0; dofs];
    let mut loads = vec![0.0; dofs];
    let mut prescribed: Vec<Option<f64>> = mask.iter().map(|&fixed| fixed.then_some(0.0)).collect();
    let mut history = vec![TensionDamageState::default(); tets.len()];
    let mut accepted_steps = Vec::new();
    let mut cutbacks = 0;
    let mut final_evaluation = evaluate(
        &tets,
        &materials,
        &displacement,
        &history,
        false,
        options.linear_backend,
    )?;
    let mut final_residual = 0.0;
    for (target_index, target) in request.targets.iter().enumerate() {
        let end_loads = &target_loads[target_index];
        let end_prescribed: Vec<Option<f64>> =
            target.prescribed_m.iter().flatten().copied().collect();
        let start_loads = loads.clone();
        let start_prescribed = prescribed.clone();
        let mut fraction: f64 = 0.0;
        let mut increment: f64 = 1.0;
        while fraction < 1.0 - 1e-14 {
            let next = (fraction + increment).min(1.0);
            let trial_loads: Vec<f64> = start_loads
                .iter()
                .zip(end_loads)
                // Both endpoints can be finite even when end-start overflows.
                .map(|(start, end)| (1.0 - next) * start + next * end)
                .collect();
            let trial_prescribed: Vec<Option<f64>> = start_prescribed
                .iter()
                .zip(&end_prescribed)
                .map(|(start, end)| match (start, end) {
                    (Some(a), Some(b)) => Some((1.0 - next) * a + next * b),
                    (None, None) => None,
                    _ => unreachable!("support mask was checked"),
                })
                .collect();
            if trial_loads.iter().any(|value| !value.is_finite())
                || trial_prescribed
                    .iter()
                    .flatten()
                    .any(|value| !value.is_finite())
            {
                return Err(format!(
                    "concrete Tet4 target {target_index}: load/displacement interpolation overflow"
                ));
            }
            match solve_one_step(
                &tets,
                &materials,
                &displacement,
                &history,
                &trial_loads,
                &trial_prescribed,
                options,
            ) {
                Ok(step) => {
                    displacement = step.displacement;
                    history = step.evaluation.trial_states.clone();
                    loads = trial_loads;
                    prescribed = trial_prescribed;
                    final_residual = step.residual;
                    final_evaluation = step.evaluation;
                    fraction = next;
                    accepted_steps.push(ConcreteAcceptedStep {
                        target_index,
                        target_fraction: fraction,
                        newton_iterations: step.iterations,
                        true_free_residual_kn: final_residual,
                    });
                    increment = (increment * 1.5).min(1.0 - fraction);
                }
                Err(error) => {
                    cutbacks += 1;
                    increment *= 0.5;
                    if cutbacks > options.max_cutbacks || increment < options.min_step_fraction {
                        return Err(format!("concrete Tet4 target {target_index} failed after {cutbacks} cutbacks near fraction {fraction:.6}: {error}"));
                    }
                    // Trials did not mutate displacement or committed history.
                }
            }
        }
    }
    let nodal_displacements_m = displacement
        .chunks_exact(3)
        .map(|v| [v[0], v[1], v[2]])
        .collect();
    let reactions = final_evaluation
        .internal_kn
        .iter()
        .zip(&loads)
        .map(|(internal, external)| internal - external)
        .collect::<Vec<_>>();
    if reactions.iter().any(|reaction| !reaction.is_finite()) {
        return Err("concrete Tet4 reaction overflow".into());
    }
    let nodal_reactions_kn = reactions
        .chunks_exact(3)
        .map(|v| [v[0], v[1], v[2]])
        .collect();
    Ok(ConcreteTetResult {
        nodal_displacements_m,
        nodal_reactions_kn,
        element_stress_mpa: final_evaluation.element_stress_mpa,
        element_damage: final_evaluation.element_damage,
        element_states: history,
        accepted_steps,
        cutbacks,
        true_free_residual_kn: final_residual,
        linear_backend_used: options.linear_backend,
    })
}

fn solve_one_step(
    tets: &[Tet],
    materials: &[TensionDamageMaterial],
    committed_displacement: &[f64],
    history: &[TensionDamageState],
    loads: &[f64],
    prescribed: &[Option<f64>],
    options: ConcreteTetOptions,
) -> Result<Step, String> {
    let mut u = committed_displacement.to_vec();
    for (dof, value) in prescribed.iter().enumerate() {
        if let Some(value) = value {
            u[dof] = *value;
        }
    }
    let free: Vec<usize> = (0..u.len())
        .filter(|&dof| prescribed[dof].is_none())
        .collect();
    let mut reference = free_norm(loads, &free).max(1.0);
    if !reference.is_finite() {
        return Err("concrete free load norm overflow".into());
    }
    for iteration in 0..=options.max_newton_iterations {
        let evaluation = evaluate(tets, materials, &u, history, true, options.linear_backend)?;
        let residual: Vec<f64> = loads
            .iter()
            .zip(&evaluation.internal_kn)
            .map(|(external, internal)| external - internal)
            .collect();
        let true_norm = free_norm(&residual, &free);
        if !true_norm.is_finite() {
            return Err("concrete free residual is non-finite".into());
        }
        if iteration == 0 {
            reference = reference.max(true_norm);
        }
        if true_norm <= options.residual_tolerance * reference {
            // Even zero-load equilibria need a free-rank check.
            if !free.is_empty() {
                solve_reduced(
                    evaluation.tangent.as_ref().unwrap(),
                    u.len(),
                    &free,
                    &vec![0.0; u.len()],
                    options,
                )?;
            }
            return Ok(Step {
                displacement: u,
                evaluation,
                iterations: iteration,
                residual: true_norm,
            });
        }
        if iteration == options.max_newton_iterations {
            return Err(format!("concrete Newton did not converge in {} iterations (true free residual {true_norm:.6e} kN)",options.max_newton_iterations));
        }
        let correction = solve_reduced(
            evaluation.tangent.as_ref().unwrap(),
            u.len(),
            &free,
            &residual,
            options,
        )?;
        let mut accepted = false;
        let mut scale = 1.0;
        for _ in 0..=options.max_line_search_halvings {
            let mut candidate = u.clone();
            for &dof in &free {
                candidate[dof] += scale * correction[dof];
            }
            let trial = evaluate(
                tets,
                materials,
                &candidate,
                history,
                false,
                options.linear_backend,
            )?;
            let candidate_residual: Vec<f64> = loads
                .iter()
                .zip(&trial.internal_kn)
                .map(|(external, internal)| external - internal)
                .collect();
            let candidate_norm = free_norm(&candidate_residual, &free);
            if candidate_norm.is_finite()
                && (candidate_norm <= options.residual_tolerance * reference
                    || candidate_norm < true_norm * (1.0 - 1e-4 * scale))
            {
                u = candidate;
                accepted = true;
                break;
            }
            scale *= 0.5;
        }
        if !accepted {
            return Err(format!(
                "concrete Newton line search stalled (residual {true_norm:.6e} kN)"
            ));
        }
    }
    unreachable!()
}

fn evaluate(
    tets: &[Tet],
    materials: &[TensionDamageMaterial],
    displacement: &[f64],
    history: &[TensionDamageState],
    with_tangent: bool,
    backend: ConcreteTetLinearBackend,
) -> Result<Evaluation, String> {
    let dofs = displacement.len();
    let mut internal_kn = vec![0.0; dofs];
    let mut element_stress_mpa = Vec::with_capacity(tets.len());
    let mut element_damage = Vec::with_capacity(tets.len());
    let mut trial_states = Vec::with_capacity(tets.len());
    let mut tangent = if with_tangent && backend == ConcreteTetLinearBackend::DenseLu {
        Some(vec![0.0; dofs * dofs])
    } else {
        None
    };
    let mut sparse = if with_tangent && backend == ConcreteTetLinearBackend::SparseGmres {
        let connectivity: Vec<[usize; 4]> = tets.iter().map(|tet| tet.nodes).collect();
        Some(CsrPatternAssembler::from_node_blocks3(
            dofs / 3,
            &connectivity,
            MAX_SPARSE_NODE_SLOTS,
            MAX_SPARSE_NONZEROS,
        )?)
    } else {
        None
    };
    for (element_index, tet) in tets.iter().enumerate() {
        let material = materials[element_index];
        let b = strain_displacement(tet);
        let dof_indices: [usize; 12] =
            std::array::from_fn(|local| 3 * tet.nodes[local / 3] + local % 3);
        let strain: [f64; 6] = std::array::from_fn(|row| {
            (0..12)
                .map(|col| b[row][col] * displacement[dof_indices[col]])
                .sum()
        });
        let response = material
            .evaluate(strain, history[element_index])
            .map_err(|error| format!("concrete element {element_index}: {error}"))?;
        element_stress_mpa.push(response.stress_mpa);
        element_damage.push(response.damage);
        trial_states.push(response.next_state);
        let weight = MPA_M2_TO_KN * tet.volume;
        for local in 0..12 {
            internal_kn[dof_indices[local]] += weight
                * (0..6)
                    .map(|row| b[row][local] * response.stress_mpa[row])
                    .sum::<f64>();
        }
        if with_tangent {
            // The undamaged branch is exactly linear. A fixed finite-difference
            // step can cross a small but valid tensile threshold even at zero
            // strain, giving Newton the tangent of a damaged material instead.
            let c = if response.damage == 0.0
                && response.equivalent_strain < material.tensile_strength_mpa / material.e_mpa
            {
                response.secant_mpa
            } else {
                let mut c = [[0.0; 6]; 6];
                for column in 0..6 {
                    let h = 1e-8_f64.max(strain[column].abs() * 1e-5);
                    let mut plus = strain;
                    let mut minus = strain;
                    plus[column] += h;
                    minus[column] -= h;
                    let high = material.evaluate(plus, history[element_index])?;
                    let low = material.evaluate(minus, history[element_index])?;
                    for row in 0..6 {
                        c[row][column] = (high.stress_mpa[row] - low.stress_mpa[row]) / (2.0 * h);
                    }
                }
                c
            };
            let mut local_stiffness = [0.0; 144];
            for local_row in 0..12 {
                for local_col in 0..12 {
                    let mut value = 0.0;
                    for a in 0..6 {
                        for cidx in 0..6 {
                            value += b[a][local_row] * c[a][cidx] * b[cidx][local_col];
                        }
                    }
                    local_stiffness[local_row * 12 + local_col] = weight * value;
                }
            }
            if let Some(tangent) = &mut tangent {
                for local_row in 0..12 {
                    for local_col in 0..12 {
                        tangent[dof_indices[local_row] * dofs + dof_indices[local_col]] +=
                            local_stiffness[local_row * 12 + local_col];
                    }
                }
            } else if let Some(sparse) = &mut sparse {
                sparse.add_element(&dof_indices, &local_stiffness)?;
            }
        }
    }
    if internal_kn.iter().any(|v| !v.is_finite())
        || tangent
            .as_ref()
            .is_some_and(|k| k.iter().any(|v| !v.is_finite()))
    {
        return Err("concrete Tet4 produced non-finite internal force or tangent".into());
    }
    Ok(Evaluation {
        internal_kn,
        element_stress_mpa,
        element_damage,
        trial_states,
        tangent: if let Some(tangent) = tangent {
            Some(Tangent::Dense(tangent))
        } else {
            sparse.map(|assembler| Tangent::Sparse(assembler.build()))
        },
    })
}

fn solve_reduced(
    tangent: &Tangent,
    n: usize,
    free: &[usize],
    rhs: &[f64],
    options: ConcreteTetOptions,
) -> Result<Vec<f64>, String> {
    match tangent {
        Tangent::Dense(matrix) => solve_reduced_lu(matrix, n, free, rhs),
        Tangent::Sparse(matrix) => solve_reduced_gmres(matrix, n, free, rhs, options),
    }
}

fn solve_reduced_gmres(
    matrix: &CsrMatrix,
    n: usize,
    free: &[usize],
    rhs: &[f64],
    options: ConcreteTetOptions,
) -> Result<Vec<f64>, String> {
    if matrix.n != n || rhs.len() != n {
        return Err("concrete sparse tangent dimension mismatch".into());
    }
    if free.is_empty() {
        return Ok(vec![0.0; n]);
    }
    let mut position = vec![usize::MAX; n];
    for (reduced, &global) in free.iter().enumerate() {
        position[global] = reduced;
    }
    let mut offsets = Vec::with_capacity(free.len() + 1);
    let mut columns = Vec::new();
    let mut values = Vec::new();
    let mut reduced_rhs = Vec::with_capacity(free.len());
    offsets.push(0);
    for &global_row in free {
        reduced_rhs.push(rhs[global_row]);
        for index in matrix.row_offsets[global_row]..matrix.row_offsets[global_row + 1] {
            let reduced_col = position[matrix.columns[index]];
            if reduced_col != usize::MAX {
                columns.push(reduced_col);
                values.push(matrix.values[index]);
            }
        }
        offsets.push(columns.len());
    }
    let reduced = CsrMatrix {
        n: free.len(),
        row_offsets: offsets,
        columns,
        values,
    };
    let zero_rhs = reduced_rhs.iter().all(|value| *value == 0.0);
    if zero_rhs {
        // A zero correction alone cannot detect a mechanism. This bounded
        // probe catches common singular free tangents; it is not a rank proof.
        for (index, value) in reduced_rhs.iter_mut().enumerate() {
            *value = 1.0 + (index % 7) as f64 / 7.0;
        }
    }
    let solved = solve_gmres(
        &reduced,
        &reduced_rhs,
        GmresOptions {
            restart: options.gmres_restart,
            max_iterations: options.gmres_max_iterations,
            relative_tolerance: options.gmres_relative_tolerance,
        },
    )?;
    let mut full = vec![0.0; n];
    if !zero_rhs {
        for (index, &global) in free.iter().enumerate() {
            full[global] = solved[index];
        }
    }
    Ok(full)
}

/// Gaussian elimination with partial row pivoting. The matrix may be
/// nonsymmetric/indefinite; a small pivot rejects a lost equilibrium branch.
fn solve_reduced_lu(
    matrix: &[f64],
    n: usize,
    free: &[usize],
    rhs: &[f64],
) -> Result<Vec<f64>, String> {
    let m = free.len();
    let mut a = vec![0.0; m * m];
    let mut b = vec![0.0; m];
    for (row, &global_row) in free.iter().enumerate() {
        b[row] = rhs[global_row];
        for (col, &global_col) in free.iter().enumerate() {
            a[row * m + col] = matrix[global_row * n + global_col];
        }
    }
    let scale = a.iter().map(|v| v.abs()).fold(0.0_f64, f64::max);
    if !scale.is_finite() || scale == 0.0 {
        return Err("concrete free tangent has zero or non-finite stiffness".into());
    }
    for pivot in 0..m {
        let best = (pivot..m)
            .max_by(|&r1, &r2| a[r1 * m + pivot].abs().total_cmp(&a[r2 * m + pivot].abs()))
            .unwrap();
        let value = a[best * m + pivot];
        if !value.is_finite() || value.abs() <= 1e-12 * scale {
            return Err(format!("concrete free tangent singular near pivot {pivot}"));
        }
        if best != pivot {
            for col in 0..m {
                a.swap(pivot * m + col, best * m + col);
            }
            b.swap(pivot, best);
        }
        for row in pivot + 1..m {
            let factor = a[row * m + pivot] / a[pivot * m + pivot];
            a[row * m + pivot] = 0.0;
            for col in pivot + 1..m {
                a[row * m + col] -= factor * a[pivot * m + col];
            }
            b[row] -= factor * b[pivot];
        }
    }
    let mut x = vec![0.0; m];
    for row in (0..m).rev() {
        let tail: f64 = (row + 1..m).map(|col| a[row * m + col] * x[col]).sum();
        x[row] = (b[row] - tail) / a[row * m + row];
    }
    if x.iter().any(|v| !v.is_finite()) {
        return Err("concrete Newton correction is non-finite".into());
    }
    let mut full = vec![0.0; n];
    for (index, &global) in free.iter().enumerate() {
        full[global] = x[index];
    }
    Ok(full)
}

fn free_norm(values: &[f64], free: &[usize]) -> f64 {
    free.iter().fold(0.0, |norm, &dof| norm.hypot(values[dof]))
}

fn validate_target(
    target: &ConcreteTetTarget,
    nodes: usize,
    mask: Option<&[bool]>,
) -> Result<Vec<bool>, String> {
    if target.loads_kn.len() != nodes || target.prescribed_m.len() != nodes {
        return Err("concrete target requires one load/support triplet per node".into());
    }
    if target.loads_kn.iter().flatten().any(|v| !v.is_finite())
        || target
            .prescribed_m
            .iter()
            .flatten()
            .flatten()
            .any(|v| !v.is_finite())
    {
        return Err("concrete target has non-finite load or displacement".into());
    }
    let actual: Vec<bool> = target
        .prescribed_m
        .iter()
        .flatten()
        .map(Option::is_some)
        .collect();
    if mask.is_some_and(|expected| actual != expected) {
        return Err("concrete support pattern must stay fixed across targets".into());
    }
    Ok(actual)
}

/// Integrate constant loads over the undeformed Tet4 and its triangular faces.
/// Linear shape functions give V/4 per volume node and A/3 per face node.
/// The result is the complete load vector for one target, so changing or
/// removing a distributed load follows the same path interpolation as nodal
/// loads. Face tractions are nominal loads per reference area.
fn assemble_target_loads(
    target: &ConcreteTetTarget,
    mesh: &Mesh,
    tets: &[Tet],
) -> Result<Vec<f64>, String> {
    let mut loads: Vec<f64> = target.loads_kn.iter().flatten().copied().collect();
    for body in &target.body_forces {
        let tet = tets
            .get(body.element)
            .ok_or_else(|| format!("concrete body force: invalid element {}", body.element))?;
        if body.force_kn_per_m3.iter().any(|v| !v.is_finite()) {
            return Err("concrete body force must be finite".into());
        }
        for &node in &tet.nodes {
            for axis in 0..3 {
                loads[3 * node + axis] += tet.volume * body.force_kn_per_m3[axis] / 4.0;
            }
        }
    }
    for face in &target.face_tractions {
        let tet = tets
            .get(face.element)
            .ok_or_else(|| format!("concrete face traction: invalid element {}", face.element))?;
        if face.traction_kn_per_m2.iter().any(|v| !v.is_finite()) {
            return Err("concrete face traction must be finite".into());
        }
        if (0..3).any(|i| face.face_nodes[..i].contains(&face.face_nodes[i]))
            || face.face_nodes.iter().any(|node| !tet.nodes.contains(node))
        {
            return Err(format!(
                "concrete face traction: nodes must form a face of element {}",
                face.element
            ));
        }
        let [p0, p1, p2] = face.face_nodes.map(|node| mesh.nodes[node]);
        let normal = cross(sub(p1, p0), sub(p2, p0));
        let area = 0.5 * dot(normal, normal).sqrt();
        if !area.is_finite() || area <= 0.0 {
            return Err("concrete face traction has invalid reference area".into());
        }
        for &node in &face.face_nodes {
            for axis in 0..3 {
                loads[3 * node + axis] += area * face.traction_kn_per_m2[axis] / 3.0;
            }
        }
    }
    if loads.iter().any(|v| !v.is_finite()) {
        return Err("concrete assembled target load is non-finite".into());
    }
    Ok(loads)
}

fn strain_displacement(tet: &Tet) -> [[f64; 12]; 6] {
    let mut b = [[0.0; 12]; 6];
    for local in 0..4 {
        let [gx, gy, gz] = tet.gradients[local];
        let col = 3 * local;
        b[0][col] = gx;
        b[1][col + 1] = gy;
        b[2][col + 2] = gz;
        b[3][col] = gy;
        b[3][col + 1] = gx;
        b[4][col + 1] = gz;
        b[4][col + 2] = gy;
        b[5][col + 2] = gx;
        b[5][col] = gz;
    }
    b
}

fn prepare_tets(mesh: &Mesh) -> Result<Vec<Tet>, String> {
    if mesh.nodes.iter().flatten().any(|v| !v.is_finite()) {
        return Err("concrete mesh has non-finite coordinate".into());
    }
    let mut prepared = Vec::with_capacity(mesh.tets.len());
    for (element_index, nodes) in mesh.tets.iter().copied().enumerate() {
        if nodes.iter().any(|&node| node >= mesh.nodes.len())
            || (0..4).any(|i| nodes[..i].contains(&nodes[i]))
        {
            return Err(format!(
                "concrete element {element_index}: invalid or duplicate node"
            ));
        }
        let [p0, p1, p2, p3] = nodes.map(|node| mesh.nodes[node]);
        let a = sub(p1, p0);
        let b = sub(p2, p0);
        let c = sub(p3, p0);
        let det = dot(a, cross(b, c));
        let scale = dot(a, a).sqrt().max(dot(b, b).sqrt()).max(dot(c, c).sqrt());
        if !det.is_finite() || scale == 0.0 || det.abs() <= 1e-12 * scale.powi(3) {
            return Err(format!("concrete element {element_index}: degenerate Tet4"));
        }
        let g1 = mul(cross(b, c), 1.0 / det);
        let g2 = mul(cross(c, a), 1.0 / det);
        let g3 = mul(cross(a, b), 1.0 / det);
        let g0 = mul(add(add(g1, g2), g3), -1.0);
        prepared.push(Tet {
            nodes,
            gradients: [g0, g1, g2, g3],
            volume: det.abs() / 6.0,
        });
    }
    Ok(prepared)
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: [f64; 3], v: f64) -> [f64; 3] {
    [a[0] * v, a[1] * v, a[2] * v]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cube(side: f64) -> Mesh {
        let nodes = vec![
            [0.0, 0.0, 0.0],
            [side, 0.0, 0.0],
            [0.0, side, 0.0],
            [side, side, 0.0],
            [0.0, 0.0, side],
            [side, 0.0, side],
            [0.0, side, side],
            [side, side, side],
        ];
        let tets = vec![
            [0, 1, 3, 7],
            [0, 3, 2, 7],
            [0, 2, 6, 7],
            [0, 6, 4, 7],
            [0, 4, 5, 7],
            [0, 5, 1, 7],
        ];
        Mesh { nodes, tets }
    }

    fn target(mesh: &Mesh, axial_strain: f64) -> ConcreteTetTarget {
        let side = mesh.nodes[1][0];
        let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
        for (index, &[x, y, z]) in mesh.nodes.iter().enumerate() {
            if x == 0.0 || x == side {
                prescribed_m[index][0] = Some(axial_strain * x);
            }
            if x == 0.0 && y == 0.0 && z == 0.0 {
                prescribed_m[index][1] = Some(0.0);
                prescribed_m[index][2] = Some(0.0);
            }
            if x == 0.0 && y == side && z == 0.0 {
                prescribed_m[index][2] = Some(0.0);
            }
        }
        ConcreteTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m,
            body_forces: vec![],
            face_tractions: vec![],
        }
    }

    fn near(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() < tolerance,
            "actual {actual:.12e}, expected {expected:.12e}"
        );
    }

    #[test]
    fn reference_body_force_and_face_traction_are_consistent_nodal_loads() {
        let mesh = Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        };
        let tets = prepare_tets(&mesh).unwrap();
        let mut target = ConcreteTetTarget {
            loads_kn: vec![[0.0; 3]; 4],
            prescribed_m: vec![[Some(0.0); 3]; 4],
            body_forces: vec![ConcreteTetBodyForce {
                element: 0,
                force_kn_per_m3: [24.0, -48.0, 72.0],
            }],
            face_tractions: vec![ConcreteTetFaceTraction {
                element: 0,
                face_nodes: [0, 2, 1],
                traction_kn_per_m2: [6.0, 0.0, -12.0],
            }],
        };
        let loads = assemble_target_loads(&target, &mesh, &tets).unwrap();
        for node in 0..4 {
            near(
                loads[3 * node],
                1.0 + if node == 3 { 0.0 } else { 1.0 },
                1e-12,
            );
            near(loads[3 * node + 1], -2.0, 1e-12);
            near(
                loads[3 * node + 2],
                3.0 + if node == 3 { 0.0 } else { -2.0 },
                1e-12,
            );
        }
        target.face_tractions.clear();
        let removed = assemble_target_loads(&target, &mesh, &tets).unwrap();
        near(removed[0], 1.0, 1e-12);
        target.body_forces[0].element = 1;
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("invalid element"));
        target.body_forces[0].element = 0;
        target.face_tractions.push(ConcreteTetFaceTraction {
            element: 0,
            face_nodes: [0, 0, 1],
            traction_kn_per_m2: [1.0, 0.0, 0.0],
        });
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("must form a face"));
        target.face_tractions[0].face_nodes = [0, 1, 99];
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("must form a face"));
    }

    #[test]
    fn tensile_coupon_softens_and_unloads_with_fixed_damage_history() {
        let mesh = cube(0.1);
        let e = 30_000.0;
        let nu = 0.2;
        let ft = 3.0;
        let gf = 100.0;
        let h = 0.1;
        let material = TensionDamageMaterial::from_fracture_energy(e, nu, ft, gf, h).unwrap();
        let onset = ft / e;
        let peak_strain = onset + material.softening_strain;
        let unloaded_strain = onset + 0.5 * material.softening_strain;
        let peak_stress = ft / std::f64::consts::E;
        let unloaded_stress = peak_stress * unloaded_strain / peak_strain;
        let request = |targets| ConcreteTetRequest {
            mesh: mesh.clone(),
            e_mpa: e,
            poisson: nu,
            tensile_strength_mpa: ft,
            fracture_energy_n_per_m: gf,
            crack_band_width_m: h,
            element_materials: None,
            targets,
            options: ConcreteTetOptions::default(),
        };
        let peak = solve(&request(vec![target(&mesh, peak_strain)])).unwrap();
        let unloaded = solve(&request(vec![
            target(&mesh, peak_strain),
            target(&mesh, unloaded_strain),
        ]))
        .unwrap();
        for (result, stress, strain) in [
            (&peak, peak_stress, peak_strain),
            (&unloaded, unloaded_stress, unloaded_strain),
        ] {
            let right_force: f64 = mesh
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, node)| node[0] == h)
                .map(|(index, _)| result.nodal_reactions_kn[index][0])
                .sum();
            near(right_force, stress * MPA_M2_TO_KN * h * h, 1e-5);
            for (index, node) in mesh.nodes.iter().enumerate() {
                if node[0] == h {
                    near(result.nodal_displacements_m[index][0], strain * h, 1e-10);
                }
            }
            for state in &result.element_states {
                near(state.max_equivalent_strain, peak_strain, 1e-10);
            }
            for (&stress_mpa, &damage) in
                result.element_stress_mpa.iter().zip(&result.element_damage)
            {
                near(stress_mpa[0], stress, 1e-8);
                near(damage, 1.0 - peak_stress / (e * peak_strain), 1e-10);
            }
            near(result.true_free_residual_kn, 0.0, 1e-5);
        }
        assert!(unloaded
            .accepted_steps
            .iter()
            .any(|step| step.target_index == 1));
    }

    #[test]
    fn uniform_element_materials_preserve_global_damage_solution() {
        let mesh = cube(0.1);
        let mut request = ConcreteTetRequest {
            mesh: mesh.clone(),
            e_mpa: 30_000.0,
            poisson: 0.2,
            tensile_strength_mpa: 3.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 0.1,
            element_materials: None,
            targets: vec![target(&mesh, 0.00015), target(&mesh, 0.00005)],
            options: ConcreteTetOptions::default(),
        };
        let baseline = solve(&request).unwrap();
        request.element_materials = Some(vec![
            ConcreteTetMaterial {
                e_mpa: request.e_mpa,
                poisson: request.poisson,
                tensile_strength_mpa: request.tensile_strength_mpa,
                fracture_energy_n_per_m: request.fracture_energy_n_per_m,
                crack_band_width_m: request.crack_band_width_m,
            };
            mesh.tets.len()
        ]);
        let explicit = solve(&request).unwrap();
        for (a, b) in baseline
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(explicit.nodal_reactions_kn.iter().flatten())
        {
            near(*a, *b, 1e-10);
        }
        for (a, b) in baseline.element_damage.iter().zip(&explicit.element_damage) {
            near(*a, *b, 1e-12);
        }
    }

    #[test]
    fn element_materials_require_exact_length_and_valid_calibration() {
        let mesh = cube(0.1);
        let mut request = ConcreteTetRequest {
            mesh: mesh.clone(),
            e_mpa: 30_000.0,
            poisson: 0.2,
            tensile_strength_mpa: 3.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 0.1,
            element_materials: Some(vec![]),
            targets: vec![target(&mesh, 0.0001)],
            options: ConcreteTetOptions::default(),
        };
        assert!(solve(&request)
            .unwrap_err()
            .contains("elementMaterials needs"));
        request.element_materials = Some(vec![
            ConcreteTetMaterial {
                e_mpa: request.e_mpa,
                poisson: request.poisson,
                tensile_strength_mpa: request.tensile_strength_mpa,
                fracture_energy_n_per_m: request.fracture_energy_n_per_m,
                crack_band_width_m: request.crack_band_width_m,
            };
            mesh.tets.len()
        ]);
        request.element_materials.as_mut().unwrap()[2].crack_band_width_m = 0.0;
        let error = solve(&request).unwrap_err();
        assert!(error.contains("elementMaterials[2]"), "{error}");
        assert!(error.contains("crack-band length"), "{error}");
    }

    #[test]
    fn crack_band_width_must_be_explicit_and_energetically_admissible() {
        let mesh = cube(0.1);
        let mut request = ConcreteTetRequest {
            mesh: mesh.clone(),
            e_mpa: 30_000.0,
            poisson: 0.2,
            tensile_strength_mpa: 3.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 0.0,
            element_materials: None,
            targets: vec![target(&mesh, 0.0001)],
            options: ConcreteTetOptions::default(),
        };
        assert!(solve(&request).unwrap_err().contains("crack-band length"));
        request.crack_band_width_m = 10.0;
        assert!(solve(&request).unwrap_err().contains("admissible"));
    }

    #[test]
    fn unloaded_rigid_rotation_is_not_accepted_as_equilibrium_solution() {
        let mesh = cube(0.1);
        let mut support = vec![[None; 3]; mesh.nodes.len()];
        support[0] = [Some(0.0); 3];
        let mut options = ConcreteTetOptions::default();
        options.min_step_fraction = 0.25;
        let error = solve(&ConcreteTetRequest {
            mesh: mesh.clone(),
            e_mpa: 30_000.0,
            poisson: 0.2,
            tensile_strength_mpa: 3.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 0.1,
            element_materials: None,
            targets: vec![ConcreteTetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                prescribed_m: support,
                body_forces: vec![],
                face_tractions: vec![],
            }],
            options,
        })
        .unwrap_err();
        assert!(error.contains("singular"), "{error}");
    }

    #[test]
    fn extreme_load_cannot_pass_equilibrium() {
        let mesh = cube(0.1);
        let mut target = target(&mesh, 0.0);
        target.loads_kn[1][1] = f64::MAX;
        target.loads_kn[3][1] = f64::MAX;
        let error = solve(&ConcreteTetRequest {
            mesh,
            e_mpa: 30_000.0,
            poisson: 0.2,
            tensile_strength_mpa: 3.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 0.1,
            element_materials: None,
            targets: vec![target],
            options: ConcreteTetOptions::default(),
        })
        .unwrap_err();
        assert!(error.contains("failed after"), "{error}");
    }
}
