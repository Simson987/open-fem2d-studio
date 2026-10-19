//! Experimental total-Lagrangian Tet4 St Venant–Kirchhoff volume solver.
//!
//! Green–Lagrange strain E=(FᵀF-I)/2, second Piola stress
//! S=λ tr(E)I+2µE, and first Piola stress P=F S. Reference-volume nodal
//! forces are V P Grad(N_i). The analytic tangent differentiates this P and
//! includes both material and geometric stiffness. Coordinates/displacements
//! are metres, moduli/stress MPa, forces kN.
//!
//! Primary references: K.-J. Bathe, MIT OpenCourseWare Lecture 12, "Total
//! Lagrangian Formulation", 2011, for E/S and linearization:
//! https://ocw.mit.edu/courses/2-094-finite-element-analysis-of-solids-and-fluids-ii-spring-2011/resources/mit2_094s11_lec12/
//! Idaho National Laboratory's St Venant–Kirchhoff implementation likewise
//! defines S from Green–Lagrange strain and isotropic elasticity:
//! https://tmap8.inl.gov/source/materials/lagrangian/ComputeStVenantKirchhoffStress.html
//! Optional dimensionless beta adds the explicitly defined research energy
//! W=W0+beta*W0²/(2E0), where W0=E:S0/2 and E0 is the element Young modulus.
//! This extension is not attributed to the St Venant–Kirchhoff references.
//!
//! This simple constitutive law is intended for moderate deformation research
//! checks. It is not a general steel/concrete design law; compression can lose
//! positive tangent definiteness. This bounded solver rejects that branch,
//! inverted elements, and rank-deficient free systems rather than regularizing.
//! Dense Newton assembly is limited to 180 DOFs. The sparse and frontal paths
//! retain element tangents without a dense global matrix and have separate,
//! bounded storage limits. Sparse GMRES permits larger models, but Krylov
//! convergence alone is not a proof of positive tangent definiteness or rank.

use crate::csr::{CsrAssembler, CsrMatrix, CsrPatternAssembler};
use crate::csr_gmres::{solve_gmres, GmresOptions};
use crate::csr_ldlt;
use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::volume3d::Mesh;
use serde::{Deserialize, Serialize};

const MAX_DENSE_DOFS: usize = 180;
const MAX_DIRECT_DOFS: usize = 900;
const MAX_DENSE_TETS: usize = 300;
const MAX_DIRECT_TETS: usize = 1_200;
const MAX_GMRES_DOFS: usize = 2_400;
const MAX_GMRES_TETS: usize = 3_600;
const MAX_GMRES_NODE_SLOTS: usize = 57_600;
const MAX_GMRES_NONZEROS: usize = 600_000;
const MAX_GMRES_RESTART: usize = 100;
const MAX_GMRES_ITERATIONS: usize = 10_000;
const MAX_FACTOR_ENTRIES: usize = 500_000;
const MAX_FRONT_DOFS: usize = 256;
const MAX_NEWTON_ITERATIONS: usize = 100;
const MAX_LINE_SEARCH_HALVINGS: usize = 24;
const MAX_CUTBACKS: usize = 64;
const MPA_M2_TO_KN: f64 = 1_000.0;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlTetTarget {
    pub loads_kn: Vec<[f64; 3]>,
    pub prescribed_m: Vec<[Option<f64>; 3]>,
    /// Dead body force per reference volume; equivalent nodal force V*b/4.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub body_forces: Vec<GnlTetBodyForce>,
    /// Nominal traction per reference face area; force A*t/3 per face node.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub face_tractions: Vec<GnlTetFaceTraction>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlTetBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlTetFaceTraction {
    pub element: usize,
    pub face_nodes: [usize; 3],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GnlTetLinearBackend {
    #[default]
    Dense,
    SparseDirect,
    SparseGmres,
    FrontalWave,
    /// Sparse direct first; recover only a diagnosed factor-storage limit.
    Automatic,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GnlTetOptions {
    pub residual_tolerance: f64,
    pub max_newton_iterations: usize,
    pub max_line_search_halvings: usize,
    pub min_step_fraction: f64,
    pub max_cutbacks: usize,
    /// Chooses a bounded Newton solve; only `dense` assembles a global dense tangent.
    pub linear_backend: GnlTetLinearBackend,
    /// Maximum stored LDLT factor entries for sparse and automatic solves.
    pub max_factor_entries: usize,
    /// Maximum simultaneous free DOFs for frontal and automatic recovery.
    pub max_front_dofs: usize,
    /// Restart width for opt-in sparse GMRES.
    pub gmres_restart: usize,
    /// Maximum Arnoldi iterations for opt-in sparse GMRES.
    pub gmres_max_iterations: usize,
    /// Required true linear residual relative to the right-hand side.
    pub gmres_relative_tolerance: f64,
}

impl Default for GnlTetOptions {
    fn default() -> Self {
        Self {
            residual_tolerance: 1e-10,
            max_newton_iterations: 25,
            max_line_search_halvings: 12,
            min_step_fraction: 1.0 / 2_048.0,
            max_cutbacks: 24,
            linear_backend: GnlTetLinearBackend::Dense,
            max_factor_entries: MAX_FACTOR_ENTRIES,
            max_front_dofs: MAX_FRONT_DOFS,
            gmres_restart: 40,
            gmres_max_iterations: 3_000,
            gmres_relative_tolerance: 1e-10,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlTetMaterial {
    pub e_mpa: f64,
    pub poisson: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlTetRequest {
    pub mesh: Mesh,
    pub e_mpa: f64,
    pub poisson: f64,
    /// Optional St Venant–Kirchhoff material for each Tet4, in mesh order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_materials: Option<Vec<GnlTetMaterial>>,
    /// Dimensionless hyperelastic energy coefficient per Tet4, in mesh order.
    /// None is the original St Venant–Kirchhoff law (all coefficients zero).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_energy_beta: Option<Vec<f64>>,
    pub targets: Vec<GnlTetTarget>,
    #[serde(default)]
    pub options: GnlTetOptions,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlAcceptedStep {
    pub target_index: usize,
    pub target_fraction: f64,
    pub newton_iterations: usize,
    pub true_free_residual_kn: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GnlTetResult {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    /// Green–Lagrange tensor per constant-strain Tet4.
    pub element_green_strain: Vec<[[f64; 3]; 3]>,
    /// First Piola–Kirchhoff stress P [spatial row, reference column] in MPa.
    pub element_first_piola_mpa: Vec<[[f64; 3]; 3]>,
    /// Secant material scale at the final state: (1+beta*W0/E0)*E0, MPa.
    pub element_effective_e_mpa: Vec<f64>,
    pub accepted_steps: Vec<GnlAcceptedStep>,
    pub cutbacks: usize,
    pub true_free_residual_kn: f64,
    pub linear_backend_used: GnlTetLinearBackend,
    /// Accepted load steps that switched from sparse direct to frontal.
    pub frontal_fallbacks: usize,
}

#[derive(Clone, Copy, Debug)]
struct Tet {
    nodes: [usize; 4],
    gradients: [[f64; 3]; 4],
    volume: f64,
}

struct Evaluation {
    internal_kn: Vec<f64>,
    tangent: Option<Vec<f64>>, // dense row-major global matrix for Dense only
    element_tangents: Option<Vec<[f64; 144]>>,
    green_strain: Vec<[[f64; 3]; 3]>,
    first_piola_mpa: Vec<[[f64; 3]; 3]>,
    effective_e_mpa: Vec<f64>,
}

struct Step {
    displacement: Vec<f64>,
    evaluation: Evaluation,
    iterations: usize,
    residual: f64,
    backend_used: GnlTetLinearBackend,
    frontal_fallbacks: usize,
}

pub fn solve(request: &GnlTetRequest) -> Result<GnlTetResult, String> {
    let nodes = request.mesh.nodes.len();
    let dofs = nodes.checked_mul(3).ok_or("GNL Tet4 DOF overflow")?;
    let (max_dofs, max_tets) = match request.options.linear_backend {
        GnlTetLinearBackend::Dense => (MAX_DENSE_DOFS, MAX_DENSE_TETS),
        GnlTetLinearBackend::SparseGmres => (MAX_GMRES_DOFS, MAX_GMRES_TETS),
        GnlTetLinearBackend::SparseDirect
        | GnlTetLinearBackend::FrontalWave
        | GnlTetLinearBackend::Automatic => (MAX_DIRECT_DOFS, MAX_DIRECT_TETS),
    };
    if dofs == 0
        || dofs > max_dofs
        || request.mesh.tets.is_empty()
        || request.mesh.tets.len() > max_tets
    {
        return Err(format!(
            "experimental GNL Tet4 limit for {:?}: 1..={max_dofs} DOF, 1..={max_tets} elements",
            request.options.linear_backend
        ));
    }
    let global_material = lame(request.e_mpa, request.poisson)?;
    let beta = match &request.element_energy_beta {
        Some(values) => {
            if values.len() != request.mesh.tets.len() {
                return Err(format!(
                    "GNL elementEnergyBeta needs {} entries, got {}",
                    request.mesh.tets.len(),
                    values.len()
                ));
            }
            for (index, value) in values.iter().enumerate() {
                if !value.is_finite() {
                    return Err(format!("GNL elementEnergyBeta[{index}] must be finite"));
                }
            }
            values.clone()
        }
        None => vec![0.0; request.mesh.tets.len()],
    };
    let materials: Vec<(f64, f64, f64, f64)> = match &request.element_materials {
        Some(element_materials) => {
            if element_materials.len() != request.mesh.tets.len() {
                return Err(format!(
                    "GNL elementMaterials needs {} entries, got {}",
                    request.mesh.tets.len(),
                    element_materials.len()
                ));
            }
            element_materials
                .iter()
                .enumerate()
                .map(|(index, material)| {
                    let (lambda, mu) = lame(material.e_mpa, material.poisson)
                        .map_err(|error| format!("GNL elementMaterials[{index}]: {error}"))?;
                    Ok::<_, String>((lambda, mu, material.e_mpa, beta[index]))
                })
                .collect::<Result<_, _>>()?
        }
        None => beta
            .iter()
            .map(|&value| (global_material.0, global_material.1, request.e_mpa, value))
            .collect(),
    };
    let opts = request.options;
    if !opts.residual_tolerance.is_finite()
        || opts.residual_tolerance <= 0.0
        || opts.residual_tolerance >= 1.0
        || !(1..=MAX_NEWTON_ITERATIONS).contains(&opts.max_newton_iterations)
        || opts.max_line_search_halvings > MAX_LINE_SEARCH_HALVINGS
        || !(1..=MAX_CUTBACKS).contains(&opts.max_cutbacks)
        || !opts.min_step_fraction.is_finite()
        || opts.min_step_fraction < 1e-12
        || opts.min_step_fraction > 1.0
        || !(1..=MAX_FACTOR_ENTRIES).contains(&opts.max_factor_entries)
        || !(1..=MAX_FRONT_DOFS).contains(&opts.max_front_dofs)
        || !(1..=MAX_GMRES_RESTART).contains(&opts.gmres_restart)
        || !(1..=MAX_GMRES_ITERATIONS).contains(&opts.gmres_max_iterations)
        || !opts.gmres_relative_tolerance.is_finite()
        || opts.gmres_relative_tolerance <= 0.0
        || opts.gmres_relative_tolerance >= 1.0
    {
        return Err("invalid GNL Tet4 Newton/step options".into());
    }
    let tets = prepare_tets(&request.mesh)?;
    let first = request
        .targets
        .first()
        .ok_or("GNL Tet4 needs a load target")?;
    let mask = validate_target(first, nodes, None)?;
    if !mask.iter().any(|&fixed| fixed) {
        return Err("GNL Tet4 has no prescribed DOF".into());
    }
    for target in &request.targets[1..] {
        validate_target(target, nodes, Some(&mask))?;
    }
    let target_loads: Vec<Vec<f64>> = request
        .targets
        .iter()
        .enumerate()
        .map(|(index, target)| {
            assemble_target_loads(target, &request.mesh, &tets)
                .map_err(|error| format!("GNL target {index}: {error}"))
        })
        .collect::<Result<_, _>>()?;
    let mut displacement = vec![0.0; dofs];
    let mut loads = vec![0.0; dofs];
    let mut prescribed: Vec<Option<f64>> = mask.iter().map(|&fixed| fixed.then_some(0.0)).collect();
    let mut accepted_steps = Vec::new();
    let mut cutbacks = 0;
    let mut final_evaluation = evaluate(&tets, &materials, &displacement, false)?;
    let mut final_residual = 0.0;
    let mut final_backend_used = match opts.linear_backend {
        GnlTetLinearBackend::Automatic => GnlTetLinearBackend::SparseDirect,
        selected => selected,
    };
    let mut frontal_fallbacks = 0;
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
                // Avoid overflow of end-start for opposite finite endpoints.
                .map(|(start, end)| (1.0 - next) * start + next * end)
                .collect();
            let trial_prescribed: Vec<Option<f64>> = start_prescribed
                .iter()
                .zip(&end_prescribed)
                .map(|(start, end)| match (start, end) {
                    (Some(a), Some(b)) => Some((1.0 - next) * a + next * b),
                    (None, None) => None,
                    _ => unreachable!("support mask validated"),
                })
                .collect();
            if trial_loads.iter().any(|v| !v.is_finite())
                || trial_prescribed.iter().flatten().any(|v| !v.is_finite())
            {
                return Err(format!(
                    "GNL Tet4 target {target_index}: load/displacement interpolation overflow"
                ));
            }
            match solve_one_step(
                &tets,
                &materials,
                &displacement,
                &trial_loads,
                &trial_prescribed,
                opts,
            ) {
                Ok(step) => {
                    displacement = step.displacement;
                    loads = trial_loads;
                    prescribed = trial_prescribed;
                    final_residual = step.residual;
                    final_evaluation = step.evaluation;
                    final_backend_used = step.backend_used;
                    frontal_fallbacks += step.frontal_fallbacks;
                    fraction = next;
                    accepted_steps.push(GnlAcceptedStep {
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
                    if cutbacks > opts.max_cutbacks || increment < opts.min_step_fraction {
                        return Err(format!("GNL Tet4 target {target_index} failed after {cutbacks} cutbacks near fraction {fraction:.6}: {error}"));
                    }
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
        return Err("GNL Tet4 reaction overflow".into());
    }
    let nodal_reactions_kn = reactions
        .chunks_exact(3)
        .map(|v| [v[0], v[1], v[2]])
        .collect();
    Ok(GnlTetResult {
        nodal_displacements_m,
        nodal_reactions_kn,
        element_green_strain: final_evaluation.green_strain,
        element_first_piola_mpa: final_evaluation.first_piola_mpa,
        element_effective_e_mpa: final_evaluation.effective_e_mpa,
        accepted_steps,
        cutbacks,
        true_free_residual_kn: final_residual,
        linear_backend_used: final_backend_used,
        frontal_fallbacks,
    })
}

fn solve_one_step(
    tets: &[Tet],
    materials: &[(f64, f64, f64, f64)],
    previous: &[f64],
    loads: &[f64],
    prescribed: &[Option<f64>],
    opts: GnlTetOptions,
) -> Result<Step, String> {
    let mut u = previous.to_vec();
    let mut backend_used = match opts.linear_backend {
        GnlTetLinearBackend::Automatic => GnlTetLinearBackend::SparseDirect,
        selected => selected,
    };
    let mut frontal_fallbacks = 0;
    let mut prescribed_increment = vec![0.0; u.len()];
    for (dof, value) in prescribed.iter().enumerate() {
        if let Some(value) = value {
            prescribed_increment[dof] = value - previous[dof];
            u[dof] = *value;
        }
    }
    let free: Vec<usize> = (0..u.len())
        .filter(|&dof| prescribed[dof].is_none())
        .collect();
    // Start displacement-driven steps with the tangent response to the
    // prescribed increment. Keeping free nodes at their old positions while
    // moving the boundary can invert elements even for a stress-free rigid
    // rotation whose final configuration is perfectly admissible.
    if !free.is_empty() && prescribed_increment.iter().any(|&delta| delta != 0.0) {
        if let Ok(previous_evaluation) =
            evaluate_for_backend(tets, materials, previous, backend_used)
        {
            let mut predictor_rhs: Vec<f64> = loads
                .iter()
                .zip(&previous_evaluation.internal_kn)
                .map(|(external, internal)| external - internal)
                .collect();
            let tangent_increment =
                tangent_product(&previous_evaluation, tets, &prescribed_increment);
            for &row in &free {
                predictor_rhs[row] -= tangent_increment[row];
            }
            if let Ok(correction) = solve_selected_backend(
                &previous_evaluation,
                tets,
                backend_used,
                &free,
                &predictor_rhs,
                opts,
            ) {
                let mut predicted = u.clone();
                for &dof in &free {
                    predicted[dof] += correction[dof];
                }
                if evaluate(tets, materials, &predicted, false).is_ok() {
                    u = predicted;
                }
            }
        }
    }
    let mut reference = free_norm(loads, &free)?.max(1.0);
    for iteration in 0..=opts.max_newton_iterations {
        let mut evaluation = evaluate_for_backend(tets, materials, &u, backend_used)?;
        let residual: Vec<f64> = loads
            .iter()
            .zip(&evaluation.internal_kn)
            .map(|(external, internal)| external - internal)
            .collect();
        if residual.iter().any(|value| !value.is_finite()) {
            return Err("GNL Tet4 true residual is non-finite".into());
        }
        let true_norm = free_norm(&residual, &free)?;
        if iteration == 0 {
            reference = reference.max(true_norm);
            // Displacement-controlled targets can have zero external force on
            // every free DOF while carrying large support reactions. Scale
            // their equilibrium tolerance to the actually imposed force
            // level rather than the arbitrary 1 kN floor alone.
            reference = reference.max(checked_norm(
                prescribed
                    .iter()
                    .enumerate()
                    .filter_map(|(dof, value)| value.map(|_| -residual[dof])),
            )?);
        }
        let displacement_scale = tets.iter().fold(0.0_f64, |largest, tet| {
            let reference = tet.nodes[0];
            tet.nodes[1..].iter().fold(largest, |largest, &node| {
                (0..3).fold(largest, |largest, axis| {
                    largest.max((u[3 * node + axis] - u[3 * reference + axis]).abs())
                })
            })
        });
        let diagonal = tangent_diagonal(&evaluation, tets, u.len());
        let tangent_scale = free
            .iter()
            .fold(0.0_f64, |largest, &dof| largest.max(diagonal[dof].abs()));
        // In an exactly stress-free finite rotation, FᵀF-I is limited by
        // floating-point cancellation. Its nodal force is of order eps*K*u,
        // so an absolute 1e-10 kN target can be unattainable even though the
        // equilibrium residual is at roundoff level.
        // Each assembled force sums multiple 12-DOF Tet4 contributions.
        // A few ulps per product and sum accumulate beyond a four-ulp bound
        // on a fine mesh, even for an exactly affine equilibrium field.
        let roundoff = 32.0 * f64::EPSILON * tangent_scale * displacement_scale;
        let convergence_limit = opts.residual_tolerance * reference + roundoff;
        if !convergence_limit.is_finite() {
            return Err("GNL Tet4 convergence scale overflow".into());
        }
        if true_norm <= convergence_limit {
            // Certify the free tangent even when the load and residual are zero.
            if !free.is_empty() {
                solve_with_budget_recovery(
                    &mut evaluation,
                    tets,
                    materials,
                    &u,
                    opts,
                    &mut backend_used,
                    &mut frontal_fallbacks,
                    &free,
                    &vec![0.0; u.len()],
                )?;
            }
            return Ok(Step {
                displacement: u,
                evaluation,
                iterations: iteration,
                residual: true_norm,
                backend_used,
                frontal_fallbacks,
            });
        }
        if iteration == opts.max_newton_iterations {
            return Err(format!(
                "GNL Newton failed after {} iterations (true residual {true_norm:.6e} kN)",
                opts.max_newton_iterations
            ));
        }
        let correction = solve_with_budget_recovery(
            &mut evaluation,
            tets,
            materials,
            &u,
            opts,
            &mut backend_used,
            &mut frontal_fallbacks,
            &free,
            &residual,
        )?;
        let mut accepted = false;
        let mut scale = 1.0;
        for _ in 0..=opts.max_line_search_halvings {
            let mut candidate = u.clone();
            for &dof in &free {
                candidate[dof] += scale * correction[dof];
            }
            if let Ok(trial) = evaluate(tets, materials, &candidate, false) {
                let trial_residual: Vec<f64> = loads
                    .iter()
                    .zip(&trial.internal_kn)
                    .map(|(external, internal)| external - internal)
                    .collect();
                if trial_residual.iter().all(|value| value.is_finite()) {
                    if let Ok(candidate_norm) = free_norm(&trial_residual, &free) {
                        if candidate_norm <= convergence_limit
                            || candidate_norm < true_norm * (1.0 - 1e-4 * scale)
                        {
                            u = candidate;
                            accepted = true;
                            break;
                        }
                    }
                }
            }
            scale *= 0.5;
        }
        if !accepted {
            return Err(format!(
                "GNL line search stalled (residual {true_norm:.6e} kN)"
            ));
        }
    }
    unreachable!()
}

fn solve_with_budget_recovery(
    evaluation: &mut Evaluation,
    tets: &[Tet],
    materials: &[(f64, f64, f64, f64)],
    u: &[f64],
    options: GnlTetOptions,
    backend_used: &mut GnlTetLinearBackend,
    frontal_fallbacks: &mut usize,
    free: &[usize],
    rhs: &[f64],
) -> Result<Vec<f64>, String> {
    match solve_selected_backend(evaluation, tets, *backend_used, free, rhs, options) {
        Ok(solution) => Ok(solution),
        Err(cause)
            if options.linear_backend == GnlTetLinearBackend::Automatic
                && *backend_used == GnlTetLinearBackend::SparseDirect
                && cause.starts_with("LDLT factor entry limit ") =>
        {
            let frontal =
                evaluate_for_backend(tets, materials, u, GnlTetLinearBackend::FrontalWave)?;
            let recovered = solve_selected_backend(
                &frontal,
                tets,
                GnlTetLinearBackend::FrontalWave,
                free,
                rhs,
                options,
            )
            .map_err(|error| {
                format!("GNL sparse tangent budget: {cause}; frontal recovery failed: {error}")
            })?;
            *evaluation = frontal;
            *backend_used = GnlTetLinearBackend::FrontalWave;
            *frontal_fallbacks += 1;
            Ok(recovered)
        }
        Err(error) => Err(error),
    }
}

fn evaluate(
    tets: &[Tet],
    materials: &[(f64, f64, f64, f64)],
    u: &[f64],
    with_tangent: bool,
) -> Result<Evaluation, String> {
    evaluate_mode(tets, materials, u, with_tangent, with_tangent)
}

fn evaluate_for_backend(
    tets: &[Tet],
    materials: &[(f64, f64, f64, f64)],
    u: &[f64],
    backend: GnlTetLinearBackend,
) -> Result<Evaluation, String> {
    evaluate_mode(
        tets,
        materials,
        u,
        true,
        backend == GnlTetLinearBackend::Dense,
    )
}

fn evaluate_mode(
    tets: &[Tet],
    materials: &[(f64, f64, f64, f64)],
    u: &[f64],
    with_tangent: bool,
    dense_tangent: bool,
) -> Result<Evaluation, String> {
    let n = u.len();
    let mut internal_kn = vec![0.0; n];
    let mut tangent = dense_tangent.then(|| vec![0.0; n * n]);
    let mut element_tangents = with_tangent.then(|| Vec::with_capacity(tets.len()));
    let mut green_strain = Vec::with_capacity(tets.len());
    let mut first_piola_mpa = Vec::with_capacity(tets.len());
    let mut effective_e_mpa = Vec::with_capacity(tets.len());
    for (element_index, tet) in tets.iter().enumerate() {
        let (lambda, mu, e_mpa, beta) = materials[element_index];
        let (force, local_tangent, e, p, effective_e) =
            element_action(tet, lambda, mu, e_mpa, beta, u, with_tangent)
                .map_err(|error| format!("GNL element {element_index}: {error}"))?;
        green_strain.push(e);
        first_piola_mpa.push(p);
        effective_e_mpa.push(effective_e);
        if let Some(elements) = &mut element_tangents {
            elements.push(local_tangent);
        }
        for local in 0..12 {
            let row = 3 * tet.nodes[local / 3] + local % 3;
            internal_kn[row] += force[local];
            if let Some(global) = &mut tangent {
                for col in 0..12 {
                    let global_col = 3 * tet.nodes[col / 3] + col % 3;
                    global[row * n + global_col] += local_tangent[local * 12 + col];
                }
            }
        }
    }
    if internal_kn.iter().any(|v| !v.is_finite())
        || first_piola_mpa
            .iter()
            .flatten()
            .flatten()
            .any(|v| !v.is_finite())
        || effective_e_mpa.iter().any(|v| !v.is_finite())
        || tangent
            .as_ref()
            .is_some_and(|k| k.iter().any(|v| !v.is_finite()))
    {
        return Err("non-finite GNL internal force or tangent".into());
    }
    Ok(Evaluation {
        internal_kn,
        tangent,
        element_tangents,
        green_strain,
        first_piola_mpa,
        effective_e_mpa,
    })
}

fn tangent_diagonal(evaluation: &Evaluation, tets: &[Tet], n: usize) -> Vec<f64> {
    if let Some(global) = &evaluation.tangent {
        return (0..n).map(|dof| global[dof * n + dof]).collect();
    }
    let mut diagonal = vec![0.0; n];
    for (tet, local) in tets
        .iter()
        .zip(evaluation.element_tangents.as_ref().unwrap())
    {
        for index in 0..12 {
            let dof = 3 * tet.nodes[index / 3] + index % 3;
            diagonal[dof] += local[index * 12 + index];
        }
    }
    diagonal
}

fn tangent_product(evaluation: &Evaluation, tets: &[Tet], vector: &[f64]) -> Vec<f64> {
    let n = vector.len();
    if let Some(global) = &evaluation.tangent {
        return (0..n)
            .map(|row| {
                (0..n)
                    .map(|column| global[row * n + column] * vector[column])
                    .sum()
            })
            .collect();
    }
    let mut product = vec![0.0; n];
    for (tet, local) in tets
        .iter()
        .zip(evaluation.element_tangents.as_ref().unwrap())
    {
        let dofs: [usize; 12] = std::array::from_fn(|index| 3 * tet.nodes[index / 3] + index % 3);
        for row in 0..12 {
            for col in 0..12 {
                product[dofs[row]] += local[row * 12 + col] * vector[dofs[col]];
            }
        }
    }
    product
}

fn element_action(
    tet: &Tet,
    lambda: f64,
    mu: f64,
    e_mpa: f64,
    beta: f64,
    u: &[f64],
    with_tangent: bool,
) -> Result<([f64; 12], [f64; 144], [[f64; 3]; 3], [[f64; 3]; 3], f64), String> {
    let mut f = [[0.0; 3]; 3];
    for (a, row) in f.iter_mut().enumerate() {
        row[a] = 1.0;
    }
    for local in 0..4 {
        for a in 0..3 {
            let ui = u[3 * tet.nodes[local] + a];
            for i in 0..3 {
                f[a][i] += ui * tet.gradients[local][i];
            }
        }
    }
    let jacobian = dot(f[0], cross(f[1], f[2]));
    if !jacobian.is_finite() || jacobian <= 1e-8 {
        return Err(format!(
            "non-positive or collapsed deformation determinant {jacobian:.6e}"
        ));
    }
    let mut e = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            e[i][j] = 0.5
                * ((0..3).map(|a| f[a][i] * f[a][j]).sum::<f64>() - if i == j { 1.0 } else { 0.0 });
        }
    }
    let tr = e[0][0] + e[1][1] + e[2][2];
    let mut s0 = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            s0[i][j] = 2.0 * mu * e[i][j] + if i == j { lambda * tr } else { 0.0 };
        }
    }
    // W = W0 + beta*W0²/(2E0), W0 = E:S0/2. Differentiation gives
    // S = factor*S0 and C = factor*C0 + (beta/E0)*S0⊗S0.
    let factor = if beta == 0.0 {
        1.0 // Preserve the original StVK path, including its arithmetic range.
    } else {
        let w0 = 0.5
            * (0..3)
                .flat_map(|i| (0..3).map(move |j| e[i][j] * s0[i][j]))
                .sum::<f64>();
        1.0 + beta * (w0 / e_mpa)
    };
    if !factor.is_finite() || factor <= 0.0 {
        return Err("non-positive or non-finite hyperelastic stress factor".into());
    }
    let s = s0.map(|row| row.map(|value| factor * value));
    let mut p = [[0.0; 3]; 3];
    for a in 0..3 {
        for i in 0..3 {
            p[a][i] = (0..3).map(|j| f[a][j] * s[j][i]).sum();
        }
    }
    let weight = MPA_M2_TO_KN * tet.volume;
    let mut force = [0.0; 12];
    for local in 0..4 {
        for a in 0..3 {
            force[3 * local + a] = weight * dot(p[a], tet.gradients[local]);
        }
    }
    let mut stiffness = [0.0; 144];
    if with_tangent {
        for i in 0..4 {
            for a in 0..3 {
                for j in 0..4 {
                    for b in 0..3 {
                        let gi = tet.gradients[i];
                        let gj = tet.gradients[j];
                        let sgj: [f64; 3] =
                            std::array::from_fn(|row| (0..3).map(|k| s[row][k] * gj[k]).sum());
                        let geometric = if a == b { dot(gi, sgj) } else { 0.0 };
                        let material0 = lambda * dot(f[a], gi) * dot(f[b], gj)
                            + mu * dot(f[a], f[b]) * dot(gi, gj)
                            + mu * dot(f[a], gj) * dot(f[b], gi);
                        let extra = if beta == 0.0 {
                            0.0
                        } else {
                            let s0gi: [f64; 3] = std::array::from_fn(|row| dot(s0[row], gi));
                            let s0gj: [f64; 3] = std::array::from_fn(|row| dot(s0[row], gj));
                            (beta / e_mpa) * dot(f[a], s0gi) * dot(f[b], s0gj)
                        };
                        stiffness[(3 * i + a) * 12 + 3 * j + b] =
                            weight * (geometric + factor * material0 + extra);
                    }
                }
            }
        }
    }
    if force.iter().any(|v| !v.is_finite()) || stiffness.iter().any(|v| !v.is_finite()) {
        return Err("non-finite GNL element response".into());
    }
    let effective_e = factor * e_mpa;
    if !effective_e.is_finite() {
        return Err("non-finite GNL effective modulus".into());
    }
    Ok((force, stiffness, e, p, effective_e))
}

fn solve_selected_backend(
    evaluation: &Evaluation,
    tets: &[Tet],
    backend: GnlTetLinearBackend,
    free: &[usize],
    rhs: &[f64],
    options: GnlTetOptions,
) -> Result<Vec<f64>, String> {
    let n = rhs.len();
    if backend == GnlTetLinearBackend::Dense {
        return solve_free_spd(evaluation.tangent.as_ref().unwrap(), n, free, rhs);
    }
    let element_tangents = evaluation.element_tangents.as_ref().unwrap();
    let mut prescribed = vec![Some(0.0); n];
    for &dof in free {
        prescribed[dof] = None;
    }
    let mut elements = Vec::with_capacity(tets.len());
    for (tet, local) in tets.iter().zip(element_tangents) {
        let dofs: [usize; 12] = std::array::from_fn(|index| 3 * tet.nodes[index / 3] + index % 3);
        let scale = (0..12)
            .map(|index| local[index * 12 + index].abs())
            .fold(0.0_f64, f64::max)
            .max(f64::MIN_POSITIVE);
        let mut symmetric = vec![0.0; 144];
        for row in 0..12 {
            for col in 0..=row {
                let forward = local[row * 12 + col];
                let reverse = local[col * 12 + row];
                if (forward - reverse).abs() > 1e-10 * scale {
                    return Err("GNL Tet4 element tangent is asymmetric".into());
                }
                let value = 0.5 * (forward + reverse);
                symmetric[row * 12 + col] = value;
                symmetric[col * 12 + row] = value;
            }
        }
        elements.push(FrontalElement {
            dofs: dofs.to_vec(),
            stiffness: symmetric,
        });
    }
    match backend {
        GnlTetLinearBackend::Dense => unreachable!(),
        GnlTetLinearBackend::SparseDirect => {
            let mut assembler = CsrAssembler::new(n)?;
            for element in &elements {
                assembler.add_element(&element.dofs, &element.stiffness)?;
            }
            let matrix = assembler.build()?;
            Ok(csr_ldlt::solve_constrained_ldlt(
                &matrix,
                rhs,
                &prescribed,
                options.max_factor_entries,
            )?
            .displacements)
        }
        GnlTetLinearBackend::SparseGmres => {
            let connectivity: Vec<[usize; 4]> = tets.iter().map(|tet| tet.nodes).collect();
            let mut assembler = CsrPatternAssembler::from_node_blocks3(
                n / 3,
                &connectivity,
                MAX_GMRES_NODE_SLOTS,
                MAX_GMRES_NONZEROS,
            )?;
            for element in &elements {
                assembler.add_element(&element.dofs, &element.stiffness)?;
            }
            solve_reduced_gmres(&assembler.build(), free, rhs, options)
        }
        GnlTetLinearBackend::FrontalWave => Ok(frontal::solve(
            &elements,
            rhs,
            &prescribed,
            FrontalOptions {
                max_front_dofs: options.max_front_dofs,
                ..FrontalOptions::default()
            },
        )?
        .displacements),
        GnlTetLinearBackend::Automatic => unreachable!("automatic selects a concrete backend"),
    }
}

fn solve_reduced_gmres(
    matrix: &CsrMatrix,
    free: &[usize],
    rhs: &[f64],
    options: GnlTetOptions,
) -> Result<Vec<f64>, String> {
    if matrix.n != rhs.len() {
        return Err("GNL sparse GMRES tangent dimension mismatch".into());
    }
    if free.is_empty() {
        return Ok(vec![0.0; matrix.n]);
    }
    let mut position = vec![usize::MAX; matrix.n];
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
    for row in 0..reduced.n {
        let mut diagonal = 0.0;
        for index in reduced.row_offsets[row]..reduced.row_offsets[row + 1] {
            if reduced.columns[index] == row {
                diagonal = reduced.values[index];
                break;
            }
        }
        if !diagonal.is_finite() || diagonal <= 0.0 {
            return Err(format!(
                "GNL sparse GMRES non-positive free tangent diagonal at DOF {}",
                free[row]
            ));
        }
    }
    let zero_rhs = reduced_rhs.iter().all(|value| *value == 0.0);
    if zero_rhs {
        // A zero right-hand side is solved by zero even for a singular tangent.
        // Probe a nonzero vector to catch common mechanisms. This is not a
        // mathematical rank certificate; direct LDLT remains the bounded
        // choice where strict rank/inertia detection is required.
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
    )
    .map_err(|error| format!("GNL sparse GMRES: {error}"))?;
    let mut full = vec![0.0; matrix.n];
    if !zero_rhs {
        for (index, &global) in free.iter().enumerate() {
            full[global] = solved[index];
        }
    }
    Ok(full)
}

fn solve_free_spd(
    matrix: &[f64],
    n: usize,
    free: &[usize],
    rhs: &[f64],
) -> Result<Vec<f64>, String> {
    let m = free.len();
    let mut l = vec![0.0; m * m];
    let mut b = vec![0.0; m];
    for (row, &dof) in free.iter().enumerate() {
        b[row] = rhs[dof];
    }
    for row in 0..m {
        let original = matrix[free[row] * n + free[row]];
        if !original.is_finite() || original <= 0.0 {
            return Err(format!(
                "GNL non-positive free tangent diagonal at DOF {}",
                free[row]
            ));
        }
        for col in 0..=row {
            let a = 0.5 * (matrix[free[row] * n + free[col]] + matrix[free[col] * n + free[row]]);
            let previous: f64 = (0..col).map(|k| l[row * m + k] * l[col * m + k]).sum();
            let value = a - previous;
            if row == col {
                if !value.is_finite() || value <= original * 1e-12 {
                    return Err(format!(
                        "GNL singular or negative free tangent pivot at DOF {}",
                        free[row]
                    ));
                }
                l[row * m + col] = value.sqrt();
            } else {
                l[row * m + col] = value / l[col * m + col];
            }
        }
    }
    let mut y = vec![0.0; m];
    for row in 0..m {
        let previous: f64 = (0..row).map(|col| l[row * m + col] * y[col]).sum();
        y[row] = (b[row] - previous) / l[row * m + row];
    }
    let mut x = vec![0.0; m];
    for row in (0..m).rev() {
        let previous: f64 = (row + 1..m).map(|col| l[col * m + row] * x[col]).sum();
        x[row] = (y[row] - previous) / l[row * m + row];
    }
    let mut full = vec![0.0; n];
    for (local, &global) in free.iter().enumerate() {
        full[global] = x[local];
    }
    if full.iter().any(|value| !value.is_finite()) {
        return Err("GNL Tet4 Newton correction is non-finite".into());
    }
    Ok(full)
}

fn lame(e: f64, nu: f64) -> Result<(f64, f64), String> {
    if !e.is_finite() || e <= 0.0 || !nu.is_finite() || nu <= -1.0 || nu >= 0.5 {
        return Err("GNL E must be positive and Poisson ratio in (-1,0.5)".into());
    }
    let mu = e / (2.0 * (1.0 + nu));
    let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    if !mu.is_finite() || !lambda.is_finite() {
        return Err("GNL Lamé moduli overflow".into());
    }
    Ok((lambda, mu))
}

fn checked_norm(values: impl IntoIterator<Item = f64>) -> Result<f64, String> {
    // Scaled sum of squares (LAPACK xLASSQ pattern): squaring raw kN values
    // can overflow while every force is finite. An unrepresentable norm is an
    // error, never an infinity that can satisfy a relative tolerance.
    let mut scale = 0.0_f64;
    let mut sumsq = 1.0_f64;
    for value in values {
        if !value.is_finite() {
            return Err("GNL Tet4 true residual/load is non-finite".into());
        }
        let abs = value.abs();
        if abs > 0.0 {
            if scale < abs {
                sumsq = 1.0 + sumsq * (scale / abs).powi(2);
                scale = abs;
            } else {
                sumsq += (abs / scale).powi(2);
            }
        }
    }
    let norm = if scale == 0.0 {
        0.0
    } else {
        scale * sumsq.sqrt()
    };
    if norm.is_finite() {
        Ok(norm)
    } else {
        Err("GNL Tet4 true residual/load norm overflow".into())
    }
}

fn free_norm(values: &[f64], free: &[usize]) -> Result<f64, String> {
    checked_norm(free.iter().map(|&dof| values[dof]))
}

fn assemble_target_loads(
    target: &GnlTetTarget,
    mesh: &Mesh,
    tets: &[Tet],
) -> Result<Vec<f64>, String> {
    let mut loads: Vec<f64> = target.loads_kn.iter().flatten().copied().collect();
    for (index, body) in target.body_forces.iter().enumerate() {
        let tet = tets
            .get(body.element)
            .ok_or_else(|| format!("bodyForces[{index}] has invalid element {}", body.element))?;
        if body.force_kn_per_m3.iter().any(|value| !value.is_finite()) {
            return Err(format!("bodyForces[{index}] has non-finite force"));
        }
        for &node in &tet.nodes {
            for axis in 0..3 {
                loads[3 * node + axis] += tet.volume * body.force_kn_per_m3[axis] / 4.0;
            }
        }
    }
    for (index, face) in target.face_tractions.iter().enumerate() {
        let tet = tets.get(face.element).ok_or_else(|| {
            format!(
                "faceTractions[{index}] has invalid element {}",
                face.element
            )
        })?;
        if face
            .traction_kn_per_m2
            .iter()
            .any(|value| !value.is_finite())
        {
            return Err(format!("faceTractions[{index}] has non-finite traction"));
        }
        if (0..3).any(|local| face.face_nodes[..local].contains(&face.face_nodes[local]))
            || face.face_nodes.iter().any(|node| !tet.nodes.contains(node))
        {
            return Err(format!(
                "faceTractions[{index}] must name three distinct nodes of element {}",
                face.element
            ));
        }
        let [a, b, c] = face.face_nodes.map(|node| mesh.nodes[node]);
        let area_vector = cross(sub(b, a), sub(c, a));
        let area = 0.5 * area_vector[0].hypot(area_vector[1]).hypot(area_vector[2]);
        if !area.is_finite() || area <= 0.0 {
            return Err(format!("faceTractions[{index}] has invalid reference area"));
        }
        for &node in &face.face_nodes {
            for axis in 0..3 {
                loads[3 * node + axis] += area * face.traction_kn_per_m2[axis] / 3.0;
            }
        }
    }
    if loads.iter().any(|value| !value.is_finite()) {
        return Err("assembled GNL target load overflow".into());
    }
    checked_norm(loads.iter().copied())?;
    Ok(loads)
}

fn validate_target(
    target: &GnlTetTarget,
    nodes: usize,
    mask: Option<&[bool]>,
) -> Result<Vec<bool>, String> {
    if target.loads_kn.len() != nodes || target.prescribed_m.len() != nodes {
        return Err("GNL target needs one load/support triplet per node".into());
    }
    if target.loads_kn.iter().flatten().any(|v| !v.is_finite())
        || target
            .prescribed_m
            .iter()
            .flatten()
            .flatten()
            .any(|v| !v.is_finite())
    {
        return Err("GNL target has non-finite load/displacement".into());
    }
    checked_norm(target.loads_kn.iter().flatten().copied())?;
    let actual: Vec<bool> = target
        .prescribed_m
        .iter()
        .flatten()
        .map(Option::is_some)
        .collect();
    if mask.is_some_and(|expected| actual != expected) {
        return Err("GNL support pattern must remain fixed".into());
    }
    Ok(actual)
}

fn prepare_tets(mesh: &Mesh) -> Result<Vec<Tet>, String> {
    if mesh.nodes.iter().flatten().any(|v| !v.is_finite()) {
        return Err("GNL mesh has non-finite coordinate".into());
    }
    let mut prepared = Vec::with_capacity(mesh.tets.len());
    for (element_index, nodes) in mesh.tets.iter().copied().enumerate() {
        if nodes.iter().any(|&node| node >= mesh.nodes.len())
            || (0..4).any(|i| nodes[..i].contains(&nodes[i]))
        {
            return Err(format!("GNL element {element_index}: invalid node"));
        }
        let [p0, p1, p2, p3] = nodes.map(|node| mesh.nodes[node]);
        let a = sub(p1, p0);
        let b = sub(p2, p0);
        let c = sub(p3, p0);
        let det = dot(a, cross(b, c));
        let scale = dot(a, a).sqrt().max(dot(b, b).sqrt()).max(dot(c, c).sqrt());
        if !det.is_finite() || scale == 0.0 || det.abs() <= 1e-12 * scale.powi(3) {
            return Err(format!("GNL element {element_index}: degenerate Tet4"));
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

    fn grid(nx: usize, ny: usize, nz: usize) -> Mesh {
        let index = |i: usize, j: usize, k: usize| (k * (ny + 1) + j) * (nx + 1) + i;
        let mut nodes = Vec::new();
        for k in 0..=nz {
            for j in 0..=ny {
                for i in 0..=nx {
                    nodes.push([
                        i as f64 / nx as f64,
                        j as f64 / ny as f64,
                        k as f64 / nz as f64,
                    ]);
                }
            }
        }
        let mut tets = Vec::new();
        for k in 0..nz {
            for j in 0..ny {
                for i in 0..nx {
                    let [a, b, c, d, e, f, g, h] = [
                        index(i, j, k),
                        index(i + 1, j, k),
                        index(i, j + 1, k),
                        index(i + 1, j + 1, k),
                        index(i, j, k + 1),
                        index(i + 1, j, k + 1),
                        index(i, j + 1, k + 1),
                        index(i + 1, j + 1, k + 1),
                    ];
                    tets.extend_from_slice(&[
                        [a, b, d, h],
                        [a, d, c, h],
                        [a, c, g, h],
                        [a, g, e, h],
                        [a, e, f, h],
                        [a, f, b, h],
                    ]);
                }
            }
        }
        Mesh { nodes, tets }
    }
    fn near(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() < tolerance,
            "actual {actual:.12e}, expected {expected:.12e}"
        );
    }
    fn boundary_target(mesh: &Mesh, displacement: impl Fn([f64; 3]) -> [f64; 3]) -> GnlTetTarget {
        let mut prescribed_m = Vec::new();
        for &point in &mesh.nodes {
            if point == [0.5, 0.5, 0.5] {
                prescribed_m.push([None; 3]);
            } else {
                prescribed_m.push(displacement(point).map(Some));
            }
        }
        GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m,
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
        }
    }

    #[test]
    fn affine_uniaxial_stretch_matches_total_lagrangian_nominal_force() {
        let mesh = grid(2, 2, 2);
        let e = 200_000.0;
        let nu = 0.3;
        let stretch = 1.05;
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: e,
            poisson: nu,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![boundary_target(&mesh, |[x, _, _]| {
                [(stretch - 1.0) * x, 0.0, 0.0]
            })],
            options: GnlTetOptions::default(),
        })
        .unwrap();
        let (lambda, mu) = lame(e, nu).unwrap();
        let green_xx = 0.5 * (stretch * stretch - 1.0);
        let nominal_xx = stretch * (lambda + 2.0 * mu) * green_xx;
        let right_force: f64 = mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node[0] == 1.0)
            .map(|(index, _)| result.nodal_reactions_kn[index][0])
            .sum();
        near(right_force, nominal_xx * MPA_M2_TO_KN, 1e-4);
        for strain in &result.element_green_strain {
            near(strain[0][0], green_xx, 1e-10);
            near(strain[1][1], 0.0, 1e-10);
        }
        for stress in &result.element_first_piola_mpa {
            near(stress[0][0], nominal_xx, 1e-8);
        }
        let center = mesh
            .nodes
            .iter()
            .position(|node| *node == [0.5, 0.5, 0.5])
            .unwrap();
        near(
            result.nodal_displacements_m[center][0],
            0.5 * (stretch - 1.0),
            1e-10,
        );
        near(result.true_free_residual_kn, 0.0, 1e-5);
    }

    #[test]
    fn two_material_affine_stretch_matches_independent_layer_tractions() {
        let mesh = grid(2, 1, 1);
        let stretch = 1.04;
        let layers = [(80_000.0, 0.2), (240_000.0, 0.3)];
        let element_materials = (0..mesh.tets.len())
            .map(|index| {
                let (e_mpa, poisson) = layers[index / 6];
                GnlTetMaterial { e_mpa, poisson }
            })
            .collect();
        let target = GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m: mesh
                .nodes
                .iter()
                .map(|point| [Some((stretch - 1.0) * point[0]), Some(0.0), Some(0.0)])
                .collect(),
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
        };
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 1.0, // Valid fallback; each element uses its own override.
            poisson: 0.0,
            element_materials: Some(element_materials),
            element_energy_beta: None,
            targets: vec![target],
            options: GnlTetOptions::default(),
        })
        .unwrap();

        // Uniform F=diag(stretch,1,1) yields Pxx=stretch*(lambda+2mu)*Exx.
        // Each half of the bar has unit cross-section, so its end traction
        // is 1000*Pxx kN, independently of how the six Tet4s subdivide it.
        let green_xx = 0.5 * (stretch * stretch - 1.0);
        let nominal = layers.map(|(e, nu)| {
            let mu = e / (2.0 * (1.0 + nu));
            let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
            stretch * (lambda + 2.0 * mu) * green_xx
        });
        for (index, stress) in result.element_first_piola_mpa.iter().enumerate() {
            near(stress[0][0], nominal[index / 6], 1e-8);
            near(result.element_green_strain[index][0][0], green_xx, 1e-12);
        }
        for (x, expected) in [
            (0.0, -nominal[0]),
            (0.5, nominal[0] - nominal[1]),
            (1.0, nominal[1]),
        ] {
            let reaction: f64 = mesh
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, point)| point[0] == x)
                .map(|(index, _)| result.nodal_reactions_kn[index][0])
                .sum();
            near(reaction, MPA_M2_TO_KN * expected, 1e-6);
        }
    }

    #[test]
    fn two_material_series_bar_converges_to_continuous_nominal_traction() {
        let mesh = grid(2, 2, 2);
        let left_e = 100_000.0;
        let right_e = 200_000.0;
        let left_stretch: f64 = 1.06;
        // For nu=0, Pxx=E*s*(s^2-1)/2. Solve the scalar series-bar
        // traction equation independently of the finite-element Newton solve.
        let left_traction = left_e * left_stretch * (left_stretch.powi(2) - 1.0) / 2.0;
        let mut low: f64 = 1.0;
        let mut high: f64 = left_stretch;
        for _ in 0..60 {
            let middle = 0.5 * (low + high);
            let traction = right_e * middle * (middle.powi(2) - 1.0) / 2.0;
            if traction < left_traction {
                low = middle;
            } else {
                high = middle;
            }
        }
        let right_stretch = 0.5 * (low + high);
        let element_materials = mesh
            .tets
            .iter()
            .map(|tet| {
                let x_centroid = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
                GnlTetMaterial {
                    e_mpa: if x_centroid < 0.5 { left_e } else { right_e },
                    poisson: 0.0,
                }
            })
            .collect();
        let displacement = |[x, _, _]: [f64; 3]| {
            let ux = if x <= 0.5 {
                (left_stretch - 1.0) * x
            } else {
                0.5 * (left_stretch - 1.0) + (right_stretch - 1.0) * (x - 0.5)
            };
            [ux, 0.0, 0.0]
        };
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 1.0,
            poisson: 0.0,
            element_materials: Some(element_materials),
            element_energy_beta: None,
            targets: vec![boundary_target(&mesh, displacement)],
            options: GnlTetOptions::default(),
        })
        .unwrap();
        let center = mesh
            .nodes
            .iter()
            .position(|point| *point == [0.5, 0.5, 0.5])
            .unwrap();
        near(
            result.nodal_displacements_m[center][0],
            displacement(mesh.nodes[center])[0],
            1e-9,
        );
        near(result.nodal_displacements_m[center][1], 0.0, 1e-9);
        near(result.nodal_displacements_m[center][2], 0.0, 1e-9);
        for stress in &result.element_first_piola_mpa {
            near(stress[0][0], left_traction, 1e-5);
        }
        near(result.true_free_residual_kn, 0.0, 1e-4);
    }

    #[test]
    fn per_element_material_input_is_checked_before_newton() {
        let mesh = grid(1, 1, 1);
        let target = GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m: vec![[Some(0.0); 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
        };
        let mut request = GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: Some(vec![GnlTetMaterial {
                e_mpa: 100_000.0,
                poisson: 0.2,
            }]),
            element_energy_beta: None,
            targets: vec![target],
            options: GnlTetOptions::default(),
        };
        assert!(solve(&request).unwrap_err().contains("needs 6 entries"));
        request.element_materials = Some(vec![
            GnlTetMaterial {
                e_mpa: 100_000.0,
                poisson: 0.2,
            };
            mesh.tets.len()
        ]);
        for (e, nu) in [(f64::NAN, 0.2), (0.0, 0.2), (100_000.0, 0.5)] {
            request.element_materials.as_mut().unwrap()[3] = GnlTetMaterial {
                e_mpa: e,
                poisson: nu,
            };
            assert!(solve(&request).unwrap_err().contains("elementMaterials[3]"));
        }
        request.element_materials.as_mut().unwrap()[3] = GnlTetMaterial {
            e_mpa: 100_000.0,
            poisson: 0.2,
        };
        request.e_mpa = f64::NAN;
        assert!(solve(&request)
            .unwrap_err()
            .contains("GNL E must be positive"));
    }

    #[test]
    fn rigid_rotation_has_zero_green_strain_and_zero_reactions() {
        let mesh = grid(2, 2, 2);
        for theta in [0.15_f64, 1.0_f64, 2.0_f64, 3.0_f64] {
            let c = theta.cos();
            let s = theta.sin();
            let rotated =
                |[x, y, _z]: [f64; 3]| [(c - 1.0) * x - s * y, s * x + (c - 1.0) * y, 0.0];
            let result = solve(&GnlTetRequest {
                mesh: mesh.clone(),
                e_mpa: 200_000.0,
                poisson: 0.3,
                element_materials: None,
                element_energy_beta: None,
                targets: vec![boundary_target(&mesh, rotated)],
                options: GnlTetOptions::default(),
            })
            .unwrap();
            let center = mesh
                .nodes
                .iter()
                .position(|node| *node == [0.5, 0.5, 0.5])
                .unwrap();
            let expected = rotated(mesh.nodes[center]);
            for a in 0..3 {
                near(result.nodal_displacements_m[center][a], expected[a], 1e-10);
            }
            for strain in &result.element_green_strain {
                for row in strain {
                    for value in row {
                        near(*value, 0.0, 1e-10);
                    }
                }
            }
            for reaction in &result.nodal_reactions_kn {
                for value in reaction {
                    near(*value, 0.0, 1e-4);
                }
            }
            near(result.true_free_residual_kn, 0.0, 1e-4);
        }
    }

    #[test]
    fn analytic_element_tangent_matches_finite_difference_force() {
        let mesh = grid(1, 1, 1);
        let tets = prepare_tets(&mesh).unwrap();
        let tet = &tets[0];
        let (lambda, mu) = lame(200_000.0, 0.3).unwrap();
        let mut u = vec![0.0; mesh.nodes.len() * 3];
        for (node, point) in mesh.nodes.iter().enumerate() {
            u[3 * node] = 0.03 * point[0] + 0.01 * point[1];
            u[3 * node + 1] = -0.005 * point[0] + 0.02 * point[1];
            u[3 * node + 2] = 0.01 * point[2];
        }
        let h = 1e-7;
        for beta in [0.0, 50.0, -50.0] {
            let (_, k, _, _, _) =
                element_action(tet, lambda, mu, 200_000.0, beta, &u, true).unwrap();
            for col in 0..12 {
                let global = 3 * tet.nodes[col / 3] + col % 3;
                let mut plus = u.clone();
                let mut minus = u.clone();
                plus[global] += h;
                minus[global] -= h;
                let (fp, _, _, _, _) =
                    element_action(tet, lambda, mu, 200_000.0, beta, &plus, false).unwrap();
                let (fm, _, _, _, _) =
                    element_action(tet, lambda, mu, 200_000.0, beta, &minus, false).unwrap();
                for row in 0..12 {
                    let fd = (fp[row] - fm[row]) / (2.0 * h);
                    let allowed = 1e-6 * k[row * 12 + col].abs().max(1e5);
                    assert!(
                        (fd - k[row * 12 + col]).abs() < allowed,
                        "beta={beta}: K[{row},{col}] analytic {:.9e}, finite diff {:.9e}",
                        k[row * 12 + col],
                        fd
                    );
                }
            }
        }
    }

    #[test]
    fn energy_beta_input_is_checked_and_zero_preserves_legacy_response() {
        let mesh = grid(1, 1, 1);
        let target = boundary_target(&mesh, |[x, _, _]| [0.02 * x, 0.0, 0.0]);
        let mut request = GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![target],
            options: GnlTetOptions::default(),
        };
        let legacy = solve(&request).unwrap();
        request.element_energy_beta = Some(vec![0.0; mesh.tets.len()]);
        let explicit_zero = solve(&request).unwrap();
        assert_eq!(
            legacy.element_first_piola_mpa,
            explicit_zero.element_first_piola_mpa
        );
        assert_eq!(legacy.nodal_reactions_kn, explicit_zero.nodal_reactions_kn);
        assert_eq!(legacy.element_effective_e_mpa, vec![200_000.0; 6]);
        assert_eq!(
            legacy.element_effective_e_mpa,
            explicit_zero.element_effective_e_mpa
        );
        request.element_energy_beta = Some(vec![1.0]);
        assert!(solve(&request)
            .unwrap_err()
            .contains("elementEnergyBeta needs 6"));
        request.element_energy_beta = Some(vec![0.0; mesh.tets.len()]);
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            request.element_energy_beta.as_mut().unwrap()[3] = value;
            assert!(solve(&request)
                .unwrap_err()
                .contains("elementEnergyBeta[3]"));
        }
    }

    #[test]
    fn nonlinear_tet_backends_agree_on_affine_hyperelastic_patch() {
        let mesh = grid(2, 2, 2);
        let target = boundary_target(&mesh, |[x, _, _]| [0.04 * x, 0.0, 0.0]);
        let mut request = GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: Some(vec![20.0; mesh.tets.len()]),
            targets: vec![target],
            options: GnlTetOptions::default(),
        };
        let dense = solve(&request).unwrap();
        assert_eq!(dense.linear_backend_used, GnlTetLinearBackend::Dense);
        for backend in [
            GnlTetLinearBackend::SparseDirect,
            GnlTetLinearBackend::SparseGmres,
            GnlTetLinearBackend::FrontalWave,
        ] {
            request.options.linear_backend = backend;
            let alternate = solve(&request).unwrap();
            assert_eq!(alternate.linear_backend_used, backend);
            for node in 0..mesh.nodes.len() {
                for axis in 0..3 {
                    near(
                        alternate.nodal_displacements_m[node][axis],
                        dense.nodal_displacements_m[node][axis],
                        1e-9,
                    );
                    near(
                        alternate.nodal_reactions_kn[node][axis],
                        dense.nodal_reactions_kn[node][axis],
                        1e-4,
                    );
                }
            }
            for element in 0..mesh.tets.len() {
                near(
                    alternate.element_first_piola_mpa[element][0][0],
                    dense.element_first_piola_mpa[element][0][0],
                    1e-7,
                );
                near(
                    alternate.element_effective_e_mpa[element],
                    dense.element_effective_e_mpa[element],
                    1e-7,
                );
            }
            near(alternate.true_free_residual_kn, 0.0, 1e-4);
        }
    }

    #[test]
    fn element_tangent_path_matches_dense_without_global_allocation() {
        let mesh = grid(2, 2, 2);
        let tets = prepare_tets(&mesh).unwrap();
        let (lambda, mu) = lame(200_000.0, 0.3).unwrap();
        let materials = vec![(lambda, mu, 200_000.0, 20.0); tets.len()];
        let mut u = vec![0.0; 3 * mesh.nodes.len()];
        let mut vector = u.clone();
        for (node, point) in mesh.nodes.iter().enumerate() {
            u[3 * node] = 0.02 * point[0] + 0.01 * point[1];
            u[3 * node + 1] = 0.015 * point[1];
            vector[3 * node] = point[0] - 0.4;
            vector[3 * node + 2] = 0.3 * point[2];
        }
        let dense =
            evaluate_for_backend(&tets, &materials, &u, GnlTetLinearBackend::Dense).unwrap();
        let elemental =
            evaluate_for_backend(&tets, &materials, &u, GnlTetLinearBackend::SparseDirect).unwrap();
        assert!(dense.tangent.is_some());
        assert!(elemental.tangent.is_none());
        for (a, b) in tangent_diagonal(&dense, &tets, u.len())
            .iter()
            .zip(tangent_diagonal(&elemental, &tets, u.len()))
        {
            near(*a, b, 1e-7);
        }
        for (a, b) in tangent_product(&dense, &tets, &vector)
            .iter()
            .zip(tangent_product(&elemental, &tets, &vector))
        {
            near(*a, b, 1e-6);
        }
    }

    #[test]
    fn all_nonlinear_backends_reject_zero_load_mechanism() {
        let mesh = grid(1, 1, 1);
        let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
        prescribed_m[0] = [Some(0.0); 3];
        let mut request = GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![GnlTetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                prescribed_m,
                body_forces: Vec::new(),
                face_tractions: Vec::new(),
            }],
            options: GnlTetOptions {
                min_step_fraction: 0.25,
                ..GnlTetOptions::default()
            },
        };
        for backend in [
            GnlTetLinearBackend::Dense,
            GnlTetLinearBackend::SparseDirect,
            GnlTetLinearBackend::SparseGmres,
            GnlTetLinearBackend::FrontalWave,
        ] {
            request.options.linear_backend = backend;
            let error = solve(&request).unwrap_err();
            assert!(
                error.contains("pivot") || error.contains("singular") || error.contains("GMRES"),
                "backend {backend:?}: {error}"
            );
        }
    }

    #[test]
    #[ignore = "large GNL sparse GMRES acceptance: run explicitly with --release --ignored"]
    fn sparse_gmres_affine_patch_exceeds_direct_dof_limit() {
        let mesh = grid(12, 8, 5); // 2,106 DOFs; direct GNL is limited to 900.
        let strain = 0.01;
        let target = GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m: mesh
                .nodes
                .iter()
                .map(|&[x, y, z]| {
                    if x == 0.0 || x == 1.0 || y == 0.0 || y == 1.0 || z == 0.0 || z == 1.0 {
                        [Some(strain * x), Some(0.0), Some(0.0)]
                    } else {
                        [None; 3]
                    }
                })
                .collect(),
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
        };
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![target],
            options: GnlTetOptions {
                linear_backend: GnlTetLinearBackend::SparseGmres,
                ..GnlTetOptions::default()
            },
        })
        .unwrap();
        assert_eq!(result.linear_backend_used, GnlTetLinearBackend::SparseGmres);
        for (node, point) in mesh.nodes.iter().enumerate() {
            near(
                result.nodal_displacements_m[node][0],
                strain * point[0],
                1e-8,
            );
            near(result.nodal_displacements_m[node][1], 0.0, 1e-8);
            near(result.nodal_displacements_m[node][2], 0.0, 1e-8);
        }
        near(result.true_free_residual_kn, 0.0, 1e-4);
    }

    #[test]
    fn negative_energy_beta_rejects_nonpositive_stress_factor() {
        let mesh = grid(1, 1, 1);
        let tets = prepare_tets(&mesh).unwrap();
        let (lambda, mu) = lame(200_000.0, 0.0).unwrap();
        let mut u = vec![0.0; mesh.nodes.len() * 3];
        for (index, point) in mesh.nodes.iter().enumerate() {
            u[3 * index] = 0.2 * point[0];
        }
        let error = element_action(&tets[0], lambda, mu, 200_000.0, -100.0, &u, true).unwrap_err();
        assert!(error.contains("stress factor"), "{error}");
    }

    #[test]
    fn zero_load_underrestrained_model_is_rejected() {
        let mesh = grid(1, 1, 1);
        let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
        prescribed_m[0] = [Some(0.0); 3];
        let mut options = GnlTetOptions::default();
        options.min_step_fraction = 0.25;
        let error = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![GnlTetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                prescribed_m,
                body_forces: Vec::new(),
                face_tractions: Vec::new(),
            }],
            options,
        })
        .unwrap_err();
        assert!(
            error.contains("pivot") || error.contains("singular"),
            "{error}"
        );
    }

    #[test]
    fn extreme_finite_loads_cannot_pass_relative_residual_check() {
        let mesh = grid(1, 1, 1);
        let mut loads_kn = vec![[0.0; 3]; mesh.nodes.len()];
        let prescribed_m: Vec<_> = mesh
            .nodes
            .iter()
            .map(|point| {
                if point[0] == 0.0 {
                    [Some(0.0); 3]
                } else {
                    [None, Some(0.0), Some(0.0)]
                }
            })
            .collect();
        let right: Vec<_> = mesh
            .nodes
            .iter()
            .enumerate()
            .filter_map(|(index, point)| (point[0] == 1.0).then_some(index))
            .collect();
        // Their Euclidean norm is finite, but naively squaring either force
        // overflows. The old residual comparison accepted this as converged.
        loads_kn[right[0]][0] = 1e308;
        loads_kn[right[1]][0] = 1e308;
        let error = solve(&GnlTetRequest {
            mesh,
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![GnlTetTarget {
                loads_kn,
                prescribed_m,
                body_forces: Vec::new(),
                face_tractions: Vec::new(),
            }],
            options: GnlTetOptions::default(),
        })
        .unwrap_err();
        assert!(
            error.contains("line search") || error.contains("overflow"),
            "{error}"
        );
        near(
            checked_norm([1e308, 1e308]).unwrap() / 1e308,
            2.0_f64.sqrt(),
            1e-12,
        );
        assert!(checked_norm([1.4e308, 1.4e308]).is_err());
    }

    #[test]
    fn unbounded_iteration_options_are_rejected() {
        let mesh = grid(1, 1, 1);
        let target = GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m: vec![[Some(0.0); 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
        };
        for options in [
            GnlTetOptions {
                max_newton_iterations: usize::MAX,
                ..GnlTetOptions::default()
            },
            GnlTetOptions {
                max_line_search_halvings: usize::MAX,
                ..GnlTetOptions::default()
            },
            GnlTetOptions {
                max_cutbacks: usize::MAX,
                ..GnlTetOptions::default()
            },
        ] {
            let error = solve(&GnlTetRequest {
                mesh: mesh.clone(),
                e_mpa: 200_000.0,
                poisson: 0.3,
                element_materials: None,
                element_energy_beta: None,
                targets: vec![target.clone()],
                options,
            })
            .unwrap_err();
            assert!(error.contains("options"), "{error}");
        }
    }

    #[test]
    fn distributed_load_inputs_are_validated_before_solving() {
        let mesh = Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        };
        let target = GnlTetTarget {
            loads_kn: vec![[0.0; 3]; 4],
            prescribed_m: vec![[Some(0.0); 3]; 4],
            body_forces: vec![GnlTetBodyForce {
                element: 0,
                force_kn_per_m3: [12.0, 0.0, 0.0],
            }],
            face_tractions: vec![GnlTetFaceTraction {
                element: 0,
                face_nodes: [1, 2, 3],
                traction_kn_per_m2: [0.0, 6.0, 0.0],
            }],
        };
        let mut request = GnlTetRequest {
            mesh,
            e_mpa: 200_000.0,
            poisson: 0.3,
            element_materials: None,
            element_energy_beta: None,
            targets: vec![target],
            options: GnlTetOptions::default(),
        };
        let result = solve(&request).unwrap();
        // Total body force is V*b=2 kN; the diagonal reference face has
        // area sqrt(3)/2 and therefore carries 3*sqrt(3) kN in y.
        near(
            result.nodal_reactions_kn.iter().map(|node| node[0]).sum(),
            -2.0,
            1e-12,
        );
        near(
            result.nodal_reactions_kn.iter().map(|node| node[1]).sum(),
            -3.0 * 3.0_f64.sqrt(),
            1e-12,
        );

        request.targets[0].body_forces[0].element = 1;
        assert!(solve(&request).unwrap_err().contains("bodyForces[0]"));
        request.targets[0].body_forces[0].element = 0;
        request.targets[0].body_forces[0].force_kn_per_m3[0] = f64::NAN;
        assert!(solve(&request).unwrap_err().contains("bodyForces[0]"));
        request.targets[0].body_forces[0].force_kn_per_m3[0] = 12.0;

        request.targets[0].face_tractions[0].element = 1;
        assert!(solve(&request).unwrap_err().contains("faceTractions[0]"));
        request.targets[0].face_tractions[0].element = 0;
        request.targets[0].face_tractions[0].face_nodes = [1, 1, 3];
        assert!(solve(&request).unwrap_err().contains("faceTractions[0]"));
        request.targets[0].face_tractions[0].face_nodes = [1, 2, 5];
        assert!(solve(&request).unwrap_err().contains("faceTractions[0]"));
        request.targets[0].face_tractions[0].face_nodes = [1, 2, 3];
        request.targets[0].face_tractions[0].traction_kn_per_m2[1] = f64::INFINITY;
        assert!(solve(&request).unwrap_err().contains("faceTractions[0]"));
    }

    #[test]
    fn camel_case_request_deserializes_with_default_options() {
        let mesh = grid(1, 1, 1);
        let input = serde_json::json!({
            "mesh": mesh,
            "eMpa": 200_000.0,
            "poisson": 0.3,
            "targets": [{
                "loadsKn": vec![[0.0; 3]; mesh.nodes.len()],
                "prescribedM": vec![[Some(0.0); 3]; mesh.nodes.len()],
            }],
        });
        let mut opt_in = input.clone();
        opt_in["options"] = serde_json::json!({
            "linearBackend": "sparseGmres",
            "gmresRestart": 24,
            "gmresMaxIterations": 800,
            "gmresRelativeTolerance": 1e-9,
        });
        let selected: GnlTetRequest = serde_json::from_value(opt_in).unwrap();
        assert_eq!(
            selected.options.linear_backend,
            GnlTetLinearBackend::SparseGmres
        );
        assert_eq!(selected.options.gmres_restart, 24);
        assert_eq!(selected.options.gmres_max_iterations, 800);
        near(selected.options.gmres_relative_tolerance, 1e-9, 1e-20);
        let request: GnlTetRequest = serde_json::from_value(input).unwrap();
        assert_eq!(request.options.max_newton_iterations, 25);
        assert_eq!(request.options.linear_backend, GnlTetLinearBackend::Dense);
        assert!(request.targets[0].body_forces.is_empty());
        assert!(request.targets[0].face_tractions.is_empty());
        let result = solve(&request).unwrap();
        let output = serde_json::to_value(result).unwrap();
        assert!(output.get("trueFreeResidualKn").is_some());
        assert!(output.get("nodalDisplacementsM").is_some());
        assert!(output.get("elementEffectiveEMpa").is_some());
        assert_eq!(output["linearBackendUsed"], "dense");
    }
}
