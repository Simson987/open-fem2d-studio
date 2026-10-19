//! Experimental small-strain Tet4 J2 volume solver with global Newton steps.
//!
//! Mesh coordinates and displacements are metres, stress/moduli MPa, force kN.
//! A constant-strain Tet4 has one J2 material point. Every Newton evaluation
//! starts from the last *committed* displacement and material history; trial
//! histories are committed only after a load step meets its true free residual.
//! Failed steps are discarded and retried at half the interpolation increment.
//! Sparse direct and frontal solves are bounded to small validation models.
//! An opt-in CSR-PCG path accepts larger face-connected, rigidly restrained
//! meshes with strictly positive isotropic hardening. It has no global
//! arc-length, contact, finite-strain or softening control.

use crate::csr::{CsrMatrix, CsrPatternAssembler, PcgOptions};
use crate::csr_ldlt::{solve_constrained_ldlt, SparseLdlt};
use crate::frontal::{self, FrontalElement, FrontalOptions};
use crate::solid_j2::{J2State, J2Steel, Tensor3};
use crate::volume3d::Mesh;
use serde::{Deserialize, Serialize};

const MAX_DOFS: usize = 1_800;
const MAX_ELEMENTS: usize = 3_000;
const MAX_PCG_DOFS: usize = 150_000;
const MAX_PCG_ELEMENTS: usize = 300_000;
const MAX_FRONT_DOFS: usize = 256;
const STRESS_TO_FORCE: f64 = 1_000.0; // MPa*m² -> kN

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2TetTarget {
    /// One [Fx,Fy,Fz] nodal load in kN per node.
    pub loads_kn: Vec<[f64; 3]>,
    /// Constant force density in the reference volume, kN/m³.
    #[serde(default)]
    pub body_forces: Vec<J2TetBodyForce>,
    /// Constant nominal traction on a reference triangular face, kN/m².
    #[serde(default)]
    pub face_tractions: Vec<J2TetFaceTraction>,
    /// None is free, Some(value) prescribes the displacement in metres.
    pub prescribed_m: Vec<[Option<f64>; 3]>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2TetBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2TetFaceTraction {
    pub element: usize,
    /// Three distinct global node indices of the named Tet4 face.
    pub face_nodes: [usize; 3],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct J2TetOptions {
    pub residual_tolerance: f64,
    pub max_newton_iterations: usize,
    pub max_line_search_halvings: usize,
    pub min_step_fraction: f64,
    pub max_step_cutbacks: usize,
    pub max_factor_entries: usize,
    pub linear_backend: J2TetLinearBackend,
    /// Maximum simultaneous free DOFs in the opt-in frontal wavefront.
    pub max_front_dofs: usize,
    /// Thread count for the opt-in CSR Jacobi-PCG tangent solve.
    pub pcg_threads: usize,
    pub pcg_max_iterations: usize,
    pub pcg_relative_tolerance: f64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum J2TetLinearBackend {
    #[default]
    SparseDirect,
    /// Opt-in iterative tangent solve for face-connected, sufficiently
    /// restrained Tet4 meshes with strictly positive isotropic hardening.
    SparsePcg,
    FrontalWave,
    /// Try sparse direct first; recover only a factor-entry budget error frontally.
    Automatic,
}

impl Default for J2TetOptions {
    fn default() -> Self {
        Self {
            residual_tolerance: 1e-9,
            max_newton_iterations: 20,
            max_line_search_halvings: 10,
            min_step_fraction: 1.0 / 1_024.0,
            max_step_cutbacks: 20,
            max_factor_entries: 250_000,
            linear_backend: J2TetLinearBackend::SparseDirect,
            max_front_dofs: MAX_FRONT_DOFS,
            pcg_threads: 1,
            pcg_max_iterations: 10_000,
            pcg_relative_tolerance: 1e-10,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2TetRequest {
    pub mesh: Mesh,
    pub steel: J2Steel,
    /// Optional material for each Tet4 in `mesh.tets` order. When omitted,
    /// `steel` supplies every element, preserving the original request format.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_steels: Option<Vec<J2Steel>>,
    /// Sequential absolute targets, so later entries may unload/reverse.
    pub targets: Vec<J2TetTarget>,
    #[serde(default)]
    pub options: J2TetOptions,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedStep {
    pub target_index: usize,
    pub target_fraction: f64,
    pub newton_iterations: usize,
    pub true_free_residual_kn: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2TetResult {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    pub element_states: Vec<J2State>,
    pub accepted_steps: Vec<AcceptedStep>,
    pub cutbacks: usize,
    pub true_free_residual_kn: f64,
    pub linear_backend_used: J2TetLinearBackend,
    /// Number of accepted load steps that switched from sparse to frontal.
    /// `linear_backend_used` describes the final accepted step and can be
    /// sparseDirect even when an earlier step fell back frontally.
    pub frontal_fallbacks: usize,
}

#[derive(Clone, Copy, Debug)]
struct Tet {
    nodes: [usize; 4],
    gradients: [[f64; 3]; 4],
    volume: f64,
}

#[derive(Debug)]
struct Evaluation {
    internal_kn: Vec<f64>,
    trial_states: Vec<J2State>,
    tangent: Option<Tangent>,
}

#[derive(Debug)]
enum Tangent {
    Sparse(CsrMatrix),
    Frontal(Vec<FrontalElement>),
}

#[derive(Debug)]
struct ConvergedStep {
    displacement: Vec<f64>,
    evaluation: Evaluation,
    iterations: usize,
    residual: f64,
    backend_used: J2TetLinearBackend,
    frontal_fallbacks: usize,
}

pub fn solve(request: &J2TetRequest) -> Result<J2TetResult, String> {
    let mesh = &request.mesh;
    let dofs = mesh
        .nodes
        .len()
        .checked_mul(3)
        .ok_or("J2 Tet4 DOF count overflow")?;
    let (max_dofs, max_elements) =
        if request.options.linear_backend == J2TetLinearBackend::SparsePcg {
            (MAX_PCG_DOFS, MAX_PCG_ELEMENTS)
        } else {
            (MAX_DOFS, MAX_ELEMENTS)
        };
    if dofs == 0 || dofs > max_dofs || mesh.tets.is_empty() || mesh.tets.len() > max_elements {
        return Err(format!(
            "experimental J2 Tet4 limit for selected backend: 1..={max_dofs} DOF and 1..={max_elements} elements"
        ));
    }
    J2Steel::new(
        request.steel.youngs_mpa,
        request.steel.poisson,
        request.steel.yield_mpa,
        request.steel.hardening_mpa,
    )?;
    let steels = if let Some(element_steels) = &request.element_steels {
        if element_steels.len() != mesh.tets.len() {
            return Err(format!(
                "J2 Tet4 elementSteels length {} differs from mesh.tets length {}",
                element_steels.len(),
                mesh.tets.len()
            ));
        }
        for (element_index, steel) in element_steels.iter().enumerate() {
            J2Steel::new(
                steel.youngs_mpa,
                steel.poisson,
                steel.yield_mpa,
                steel.hardening_mpa,
            )
            .map_err(|cause| format!("J2 Tet4 elementSteels[{element_index}]: {cause}"))?;
        }
        element_steels.clone()
    } else {
        vec![request.steel; mesh.tets.len()]
    };
    let options = request.options;
    if !options.residual_tolerance.is_finite()
        || options.residual_tolerance <= 0.0
        || options.residual_tolerance >= 1.0
        || options.max_newton_iterations == 0
        || options.max_step_cutbacks == 0
        || !options.min_step_fraction.is_finite()
        || options.min_step_fraction <= 0.0
        || options.min_step_fraction > 1.0
        || options.max_factor_entries == 0
        || options.pcg_threads == 0
        || options.pcg_threads > 32
        || options.pcg_max_iterations == 0
        || !options.pcg_relative_tolerance.is_finite()
        || options.pcg_relative_tolerance <= 0.0
        || options.pcg_relative_tolerance >= 1.0
    {
        return Err("invalid J2 Tet4 Newton/step options".into());
    }
    if options.max_front_dofs == 0 || options.max_front_dofs > MAX_FRONT_DOFS {
        return Err(format!(
            "J2 Tet4 maxFrontDofs must be in 1..={MAX_FRONT_DOFS}"
        ));
    }
    let tets = prepare_tets(mesh)?;
    let first = request
        .targets
        .first()
        .ok_or("J2 Tet4 needs at least one load target")?;
    let support_mask = validate_target(first, mesh.nodes.len(), None)?;
    if !support_mask.iter().any(|fixed| *fixed) {
        return Err("J2 Tet4 model has no prescribed DOF".into());
    }
    if options.linear_backend == J2TetLinearBackend::SparsePcg {
        if steels.iter().any(|steel| steel.hardening_mpa <= 0.0) {
            return Err(
                "J2 Tet4 sparsePcg requires strictly positive hardening for every element".into(),
            );
        }
        crate::j2_pcg_support::validate(mesh, &support_mask)?;
    }
    for target in &request.targets[1..] {
        validate_target(target, mesh.nodes.len(), Some(&support_mask))?;
    }
    let target_loads = request
        .targets
        .iter()
        .map(|target| assemble_target_loads(target, mesh, &tets))
        .collect::<Result<Vec<_>, _>>()?;
    let mut committed_displacement = vec![0.0; dofs];
    let mut committed_loads = vec![0.0; dofs];
    let mut committed_prescribed = vec![None; dofs];
    for dof in 0..dofs {
        if support_mask[dof] {
            committed_prescribed[dof] = Some(0.0);
        }
    }
    let mut history = vec![J2State::default(); tets.len()];
    let mut accepted_steps = Vec::new();
    let mut cutbacks = 0;
    let mut frontal_fallbacks = 0;
    let mut final_backend_used = match options.linear_backend {
        J2TetLinearBackend::Automatic => J2TetLinearBackend::SparseDirect,
        selected => selected,
    };
    let mut final_eval = evaluate(
        &tets,
        &steels,
        &committed_displacement,
        &committed_displacement,
        &history,
        false,
        options.linear_backend,
    )?;
    let mut final_residual = 0.0;
    for (target_index, (target, target_loads)) in
        request.targets.iter().zip(&target_loads).enumerate()
    {
        let target_prescribed = flatten_prescribed(target);
        let segment_start_loads = committed_loads.clone();
        let segment_start_prescribed = committed_prescribed.clone();
        let mut fraction: f64 = 0.0;
        let mut increment: f64 = 1.0;
        while fraction < 1.0 - 1e-14 {
            let next = (fraction + increment).min(1.0);
            let loads: Vec<f64> = segment_start_loads
                .iter()
                .zip(target_loads)
                // A finite pair of opposite endpoint loads may have an
                // unrepresentable difference. Blend the endpoints directly.
                .map(|(start, end)| (1.0 - next) * start + next * end)
                .collect();
            if loads.iter().any(|value| !value.is_finite()) {
                return Err(format!(
                    "J2 Tet4 target {target_index}: interpolated load overflow"
                ));
            }
            let prescribed: Vec<Option<f64>> = segment_start_prescribed
                .iter()
                .zip(&target_prescribed)
                .map(|(start, end)| match (start, end) {
                    (Some(a), Some(b)) => Some((1.0 - next) * a + next * b),
                    (None, None) => None,
                    _ => unreachable!("support mask checked for every target"),
                })
                .collect();
            if prescribed.iter().flatten().any(|value| !value.is_finite()) {
                return Err(format!(
                    "J2 Tet4 target {target_index}: interpolated displacement overflow"
                ));
            }
            match solve_one_step(
                &tets,
                &steels,
                &committed_displacement,
                &history,
                &loads,
                &prescribed,
                options,
            ) {
                Ok(step) => {
                    committed_displacement = step.displacement;
                    history = step.evaluation.trial_states.clone();
                    committed_loads = loads;
                    committed_prescribed = prescribed;
                    final_residual = step.residual;
                    final_eval = step.evaluation;
                    final_backend_used = step.backend_used;
                    frontal_fallbacks += step.frontal_fallbacks;
                    fraction = next;
                    accepted_steps.push(AcceptedStep {
                        target_index,
                        target_fraction: fraction,
                        newton_iterations: step.iterations,
                        true_free_residual_kn: final_residual,
                    });
                    increment = (increment * 1.5).min(1.0 - fraction);
                }
                Err(cause) => {
                    cutbacks += 1;
                    increment *= 0.5;
                    if cutbacks > options.max_step_cutbacks || increment < options.min_step_fraction
                    {
                        return Err(format!(
                            "J2 Tet4 target {target_index} failed after {cutbacks} cutbacks near fraction {fraction:.6}: {cause}"
                        ));
                    }
                    // No committed array or history was changed on this path.
                }
            }
        }
    }
    let nodal_displacements_m = committed_displacement
        .chunks_exact(3)
        .map(|v| [v[0], v[1], v[2]])
        .collect();
    let reactions = final_eval
        .internal_kn
        .iter()
        .zip(&committed_loads)
        .map(|(internal, load)| internal - load)
        .collect::<Vec<_>>();
    if reactions.iter().any(|value| !value.is_finite()) {
        return Err("J2 Tet4 reaction force overflow".into());
    }
    let nodal_reactions_kn = reactions
        .chunks_exact(3)
        .map(|v| [v[0], v[1], v[2]])
        .collect();
    Ok(J2TetResult {
        nodal_displacements_m,
        nodal_reactions_kn,
        element_states: history,
        accepted_steps,
        cutbacks,
        true_free_residual_kn: final_residual,
        linear_backend_used: final_backend_used,
        frontal_fallbacks,
    })
}

fn solve_one_step(
    tets: &[Tet],
    steels: &[J2Steel],
    committed_displacement: &[f64],
    history: &[J2State],
    loads: &[f64],
    prescribed: &[Option<f64>],
    options: J2TetOptions,
) -> Result<ConvergedStep, String> {
    let mut displacement = committed_displacement.to_vec();
    for (dof, value) in prescribed.iter().enumerate() {
        if let Some(value) = value {
            displacement[dof] = *value;
        }
    }
    let delta_constraints: Vec<Option<f64>> =
        prescribed.iter().map(|value| value.map(|_| 0.0)).collect();
    let mut reference = 1.0_f64.max(free_norm(loads, prescribed)?);
    let mut backend_used = match options.linear_backend {
        J2TetLinearBackend::Automatic => J2TetLinearBackend::SparseDirect,
        selected => selected,
    };
    let mut frontal_fallbacks = 0;
    if backend_used == J2TetLinearBackend::SparsePcg {
        // A displacement-driven large model can have a narrow, strongly
        // yielded boundary layer when all free DOFs start at the old state.
        // Preserve the old free-force reference, then form one elastic
        // predictor from the committed state with the full target support
        // increment. Plastic history remains frozen until Newton converges.
        let boundary = evaluate(
            tets,
            steels,
            &displacement,
            committed_displacement,
            history,
            false,
            backend_used,
        )?;
        let boundary_residual = loads
            .iter()
            .zip(&boundary.internal_kn)
            .map(|(external, internal)| external - internal)
            .collect::<Vec<_>>();
        reference = reference.max(free_norm(&boundary_residual, prescribed)?);
        let baseline = evaluate(
            tets,
            steels,
            committed_displacement,
            committed_displacement,
            history,
            true,
            backend_used,
        )?;
        let baseline_residual = loads
            .iter()
            .zip(&baseline.internal_kn)
            .map(|(external, internal)| external - internal)
            .collect::<Vec<_>>();
        let prescribed_increment = prescribed
            .iter()
            .enumerate()
            .map(|(dof, value)| value.map(|target| target - committed_displacement[dof]))
            .collect::<Vec<_>>();
        let correction = solve_tangent(
            baseline
                .tangent
                .as_ref()
                .expect("predictor tangent assembled"),
            &baseline_residual,
            &prescribed_increment,
            options,
        )?;
        for dof in 0..displacement.len() {
            displacement[dof] = committed_displacement[dof] + correction[dof];
            if let Some(value) = prescribed[dof] {
                displacement[dof] = value;
            }
            if !displacement[dof].is_finite() {
                return Err(format!(
                    "J2 elastic predictor displacement overflow at DOF {dof}"
                ));
            }
        }
    }
    for iteration in 0..=options.max_newton_iterations {
        let mut evaluation = evaluate(
            tets,
            steels,
            &displacement,
            committed_displacement,
            history,
            true,
            backend_used,
        )?;
        let residual: Vec<f64> = loads
            .iter()
            .zip(&evaluation.internal_kn)
            .map(|(external, internal)| external - internal)
            .collect();
        let true_norm = free_norm(&residual, prescribed)?;
        if iteration == 0 {
            reference = reference.max(true_norm);
        }
        if true_norm <= options.residual_tolerance * reference {
            let certificate = certify_tangent(
                evaluation.tangent.as_ref().expect("tangent assembled"),
                prescribed,
                options,
            );
            if let Err(cause) = certificate {
                if may_recover_factor_budget(options.linear_backend, backend_used, &cause) {
                    backend_used = J2TetLinearBackend::FrontalWave;
                    frontal_fallbacks += 1;
                    evaluation = evaluate(
                        tets,
                        steels,
                        &displacement,
                        committed_displacement,
                        history,
                        true,
                        backend_used,
                    )?;
                    certify_tangent(
                        evaluation.tangent.as_ref().expect("frontal tangent assembled"),
                        prescribed,
                        options,
                    )
                    .map_err(|recovery| {
                        format!("J2 converged tangent sparse budget: {cause}; frontal recovery failed: {recovery}")
                    })?;
                } else {
                    return Err(format!("J2 converged tangent is unstable: {cause}"));
                }
            }
            return Ok(ConvergedStep {
                displacement,
                evaluation,
                iterations: iteration,
                residual: true_norm,
                backend_used,
                frontal_fallbacks,
            });
        }
        if iteration == options.max_newton_iterations {
            return Err(format!(
                "Newton reached {} iterations: true free residual {true_norm:.6e} kN",
                options.max_newton_iterations
            ));
        }
        let tangent = evaluation.tangent.as_ref().expect("tangent assembled");
        let correction = match solve_tangent(tangent, &residual, &delta_constraints, options) {
            Ok(correction) => correction,
            Err(cause)
                if may_recover_factor_budget(options.linear_backend, backend_used, &cause) =>
            {
                backend_used = J2TetLinearBackend::FrontalWave;
                frontal_fallbacks += 1;
                evaluation = evaluate(
                    tets,
                    steels,
                    &displacement,
                    committed_displacement,
                    history,
                    true,
                    backend_used,
                )?;
                solve_tangent(
                    evaluation
                        .tangent
                        .as_ref()
                        .expect("frontal tangent assembled"),
                    &residual,
                    &delta_constraints,
                    options,
                )
                .map_err(|recovery| {
                    format!(
                        "J2 sparse tangent budget: {cause}; frontal recovery failed: {recovery}"
                    )
                })?
            }
            Err(cause) => return Err(format!("J2 tangent factorization failed: {cause}")),
        };
        let mut accepted = false;
        let mut scale = 1.0;
        for _ in 0..=options.max_line_search_halvings {
            let mut candidate = displacement.clone();
            for dof in 0..candidate.len() {
                if prescribed[dof].is_none() {
                    candidate[dof] += scale * correction[dof];
                }
            }
            let candidate_eval = evaluate(
                tets,
                steels,
                &candidate,
                committed_displacement,
                history,
                false,
                backend_used,
            )?;
            let candidate_residual: Vec<f64> = loads
                .iter()
                .zip(&candidate_eval.internal_kn)
                .map(|(external, internal)| external - internal)
                .collect();
            let candidate_norm = free_norm(&candidate_residual, prescribed)?;
            if candidate_norm <= options.residual_tolerance * reference
                || candidate_norm < true_norm * (1.0 - 1e-4 * scale)
            {
                displacement = candidate;
                accepted = true;
                break;
            }
            scale *= 0.5;
        }
        if !accepted {
            return Err(format!(
                "J2 Newton line search stalled at iteration {iteration} (residual {true_norm:.6e} kN)"
            ));
        }
    }
    unreachable!("Newton loop returns on convergence or iteration limit")
}

fn solve_tangent(
    tangent: &Tangent,
    rhs: &[f64],
    prescribed: &[Option<f64>],
    options: J2TetOptions,
) -> Result<Vec<f64>, String> {
    match tangent {
        Tangent::Sparse(matrix) => match options.linear_backend {
            J2TetLinearBackend::SparsePcg => Ok(matrix
                .solve_constrained_with_threads(
                    rhs,
                    prescribed,
                    PcgOptions {
                        relative_tolerance: options.pcg_relative_tolerance,
                        absolute_tolerance: 0.0,
                        max_iterations: options.pcg_max_iterations,
                    },
                    options.pcg_threads,
                )?
                .displacements),
            _ => Ok(
                solve_constrained_ldlt(matrix, rhs, prescribed, options.max_factor_entries)?
                    .displacements,
            ),
        },
        Tangent::Frontal(elements) => Ok(frontal::solve(
            elements,
            rhs,
            prescribed,
            FrontalOptions {
                max_front_dofs: options.max_front_dofs,
                ..FrontalOptions::default()
            },
        )?
        .displacements),
    }
}

fn may_recover_factor_budget(
    requested: J2TetLinearBackend,
    active: J2TetLinearBackend,
    cause: &str,
) -> bool {
    requested == J2TetLinearBackend::Automatic
        && active == J2TetLinearBackend::SparseDirect
        && cause.starts_with("LDLT factor entry limit ")
}

fn certify_tangent(
    tangent: &Tangent,
    prescribed: &[Option<f64>],
    options: J2TetOptions,
) -> Result<(), String> {
    match tangent {
        Tangent::Sparse(matrix) => {
            if options.linear_backend == J2TetLinearBackend::SparsePcg {
                // The solve preflight established a face-connected, rigidly
                // restrained mesh and H>0, which make the material/geometry
                // tangent positive definite in exact arithmetic. A zero-RHS
                // PCG call alone cannot reveal a hidden mechanism; the
                // preflight is required before this diagonal/symmetry check.
                let zero_rhs = vec![0.0; prescribed.len()];
                let zero_constraints = prescribed
                    .iter()
                    .map(|v| v.map(|_| 0.0))
                    .collect::<Vec<_>>();
                solve_tangent(tangent, &zero_rhs, &zero_constraints, options)?;
            } else {
                SparseLdlt::factor(matrix, prescribed, options.max_factor_entries)?;
            }
        }
        Tangent::Frontal(_) => {
            let zero_rhs = vec![0.0; prescribed.len()];
            let zero_constraints = prescribed
                .iter()
                .map(|v| v.map(|_| 0.0))
                .collect::<Vec<_>>();
            solve_tangent(tangent, &zero_rhs, &zero_constraints, options)?;
        }
    }
    Ok(())
}

fn evaluate(
    tets: &[Tet],
    steels: &[J2Steel],
    displacement: &[f64],
    committed_displacement: &[f64],
    history: &[J2State],
    with_tangent: bool,
    linear_backend: J2TetLinearBackend,
) -> Result<Evaluation, String> {
    if with_tangent && linear_backend == J2TetLinearBackend::Automatic {
        return Err(
            "J2 automatic backend must select sparse or frontal before tangent evaluation".into(),
        );
    }
    let mut internal_kn = vec![0.0; displacement.len()];
    let mut trial_states = Vec::with_capacity(tets.len());
    let mut assembler = if with_tangent
        && matches!(
            linear_backend,
            J2TetLinearBackend::SparseDirect | J2TetLinearBackend::SparsePcg
        ) {
        let nodes: Vec<[usize; 4]> = tets.iter().map(|tet| tet.nodes).collect();
        let (max_slots, max_nonzeros) = if linear_backend == J2TetLinearBackend::SparsePcg {
            (40_000_000, 30_000_000)
        } else {
            (1_000_000, 3_000_000)
        };
        Some(CsrPatternAssembler::from_node_blocks3(
            displacement.len() / 3,
            &nodes,
            max_slots,
            max_nonzeros,
        )?)
    } else {
        None
    };
    let mut frontal_elements = if with_tangent && linear_backend == J2TetLinearBackend::FrontalWave
    {
        Some(Vec::with_capacity(tets.len()))
    } else {
        None
    };
    for (element_index, tet) in tets.iter().enumerate() {
        let mut gradient_u = [[0.0; 3]; 3];
        for local in 0..4 {
            for component in 0..3 {
                let dof = 3 * tet.nodes[local] + component;
                let delta_u = displacement[dof] - committed_displacement[dof];
                for direction in 0..3 {
                    gradient_u[component][direction] += delta_u * tet.gradients[local][direction];
                }
            }
        }
        let mut strain_increment: Tensor3 = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                strain_increment[i][j] = 0.5 * (gradient_u[i][j] + gradient_u[j][i]);
            }
        }
        let update = steels[element_index]
            .update(&history[element_index], strain_increment)
            .map_err(|error| format!("element {element_index}: {error}"))?;
        trial_states.push(update.state);
        let stress = [
            update.state.stress_mpa[0][0],
            update.state.stress_mpa[1][1],
            update.state.stress_mpa[2][2],
            update.state.stress_mpa[0][1],
            update.state.stress_mpa[1][2],
            update.state.stress_mpa[2][0],
        ];
        let b = strain_displacement(tet);
        let dofs = tet.nodes.map(|node| [3 * node, 3 * node + 1, 3 * node + 2]);
        let dofs: Vec<usize> = dofs.into_iter().flatten().collect();
        let weight = STRESS_TO_FORCE * tet.volume;
        for local in 0..12 {
            let nodal = (0..6).map(|a| b[a][local] * stress[a]).sum::<f64>();
            internal_kn[dofs[local]] += weight * nodal;
        }
        if with_tangent {
            let mut local_stiffness = [0.0; 144];
            for row in 0..12 {
                for col in 0..12 {
                    let mut value = 0.0;
                    for a in 0..6 {
                        for c in 0..6 {
                            value += b[a][row] * update.algorithmic_tangent_mpa[a][c] * b[c][col];
                        }
                    }
                    local_stiffness[row * 12 + col] = weight * value;
                }
            }
            if let Some(assembler) = &mut assembler {
                assembler.add_element(&dofs, &local_stiffness)?;
            } else if let Some(elements) = &mut frontal_elements {
                elements.push(FrontalElement {
                    dofs,
                    stiffness: local_stiffness.to_vec(),
                });
            }
        }
    }
    if internal_kn.iter().any(|value| !value.is_finite()) {
        return Err("non-finite J2 Tet4 internal force".into());
    }
    Ok(Evaluation {
        internal_kn,
        trial_states,
        tangent: if let Some(assembler) = assembler {
            Some(Tangent::Sparse(assembler.build()))
        } else {
            frontal_elements.map(Tangent::Frontal)
        },
    })
}

fn strain_displacement(tet: &Tet) -> [[f64; 12]; 6] {
    let mut b = [[0.0; 12]; 6];
    for local in 0..4 {
        let [gx, gy, gz] = tet.gradients[local];
        let d = 3 * local;
        b[0][d] = gx;
        b[1][d + 1] = gy;
        b[2][d + 2] = gz;
        b[3][d] = gy;
        b[3][d + 1] = gx;
        b[4][d + 1] = gz;
        b[4][d + 2] = gy;
        b[5][d + 2] = gx;
        b[5][d] = gz;
    }
    b
}

fn free_norm(vector: &[f64], prescribed: &[Option<f64>]) -> Result<f64, String> {
    let mut norm = 0.0_f64;
    for (value, fixed) in vector.iter().zip(prescribed) {
        if fixed.is_none() {
            if !value.is_finite() {
                return Err("non-finite J2 Tet4 free force/residual".into());
            }
            // hypot scales before squaring, so finite forces above sqrt(f64::MAX)
            // do not create an infinite reference and a false Newton success.
            norm = norm.hypot(*value);
            if !norm.is_finite() {
                return Err("J2 Tet4 free force/residual norm overflow".into());
            }
        }
    }
    Ok(norm)
}

fn validate_target(
    target: &J2TetTarget,
    nodes: usize,
    expected_support_mask: Option<&[bool]>,
) -> Result<Vec<bool>, String> {
    if target.loads_kn.len() != nodes || target.prescribed_m.len() != nodes {
        return Err("J2 Tet4 target needs one load/support triplet per node".into());
    }
    let loads = flatten_loads(target);
    let prescribed = flatten_prescribed(target);
    if loads.iter().any(|value| !value.is_finite())
        || prescribed.iter().flatten().any(|value| !value.is_finite())
    {
        return Err("J2 Tet4 target contains a non-finite load or displacement".into());
    }
    let mask: Vec<bool> = prescribed.iter().map(Option::is_some).collect();
    if expected_support_mask.is_some_and(|expected| expected != mask) {
        return Err("J2 Tet4 support pattern must remain fixed across targets".into());
    }
    Ok(mask)
}

fn flatten_loads(target: &J2TetTarget) -> Vec<f64> {
    target.loads_kn.iter().flatten().copied().collect()
}

fn assemble_target_loads(
    target: &J2TetTarget,
    mesh: &Mesh,
    tets: &[Tet],
) -> Result<Vec<f64>, String> {
    let mut loads = flatten_loads(target);
    // For linear Tet4 shape functions, integral(N_i dV) = V/4 and
    // integral(N_i dA) = A/3 on a triangular reference face.
    for (index, body) in target.body_forces.iter().enumerate() {
        let tet = tets
            .get(body.element)
            .ok_or_else(|| format!("body force {index}: element index outside mesh"))?;
        if body.force_kn_per_m3.iter().any(|value| !value.is_finite()) {
            return Err(format!("body force {index}: non-finite force density"));
        }
        for &node in &tet.nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                loads[dof] += tet.volume * body.force_kn_per_m3[component] / 4.0;
                if !loads[dof].is_finite() {
                    return Err(format!("body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in target.face_tractions.iter().enumerate() {
        let tet = tets
            .get(face.element)
            .ok_or_else(|| format!("face traction {index}: element index outside mesh"))?;
        if face
            .traction_kn_per_m2
            .iter()
            .any(|value| !value.is_finite())
            || face.face_nodes.iter().enumerate().any(|(local, node)| {
                !tet.nodes.contains(node) || face.face_nodes[..local].contains(node)
            })
        {
            return Err(format!("face traction {index}: invalid face or traction"));
        }
        let [a, b, c] = face.face_nodes.map(|node| mesh.nodes[node]);
        let normal = cross(sub(b, a), sub(c, a));
        let area = dot(normal, normal).sqrt() / 2.0;
        if !area.is_finite() || area <= 0.0 {
            return Err(format!("face traction {index}: degenerate face"));
        }
        for &node in &face.face_nodes {
            for component in 0..3 {
                let dof = 3 * node + component;
                loads[dof] += area * face.traction_kn_per_m2[component] / 3.0;
                if !loads[dof].is_finite() {
                    return Err(format!("face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    Ok(loads)
}

fn flatten_prescribed(target: &J2TetTarget) -> Vec<Option<f64>> {
    target.prescribed_m.iter().flatten().copied().collect()
}

fn prepare_tets(mesh: &Mesh) -> Result<Vec<Tet>, String> {
    if mesh
        .nodes
        .iter()
        .flatten()
        .any(|coordinate| !coordinate.is_finite())
    {
        return Err("J2 Tet4 mesh has non-finite coordinates".into());
    }
    let mut result = Vec::with_capacity(mesh.tets.len());
    for (element_index, nodes) in mesh.tets.iter().copied().enumerate() {
        if nodes.iter().any(|node| *node >= mesh.nodes.len())
            || (0..4).any(|i| nodes[..i].contains(&nodes[i]))
        {
            return Err(format!(
                "element {element_index}: invalid or duplicate node"
            ));
        }
        let [p0, p1, p2, p3] = nodes.map(|node| mesh.nodes[node]);
        let a = sub(p1, p0);
        let b = sub(p2, p0);
        let c = sub(p3, p0);
        let det = dot(a, cross(b, c));
        let scale = dot(a, a).sqrt().max(dot(b, b).sqrt()).max(dot(c, c).sqrt());
        if !det.is_finite() || scale == 0.0 || det.abs() <= 1e-12 * scale.powi(3) {
            return Err(format!("element {element_index}: degenerate Tet4"));
        }
        let g1 = mul(cross(b, c), 1.0 / det);
        let g2 = mul(cross(c, a), 1.0 / det);
        let g3 = mul(cross(a, b), 1.0 / det);
        let g0 = mul(add(add(g1, g2), g3), -1.0);
        result.push(Tet {
            nodes,
            gradients: [g0, g1, g2, g3],
            volume: det.abs() / 6.0,
        });
    }
    Ok(result)
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: [f64; 3], value: f64) -> [f64; 3] {
    [a[0] * value, a[1] * value, a[2] * value]
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

    fn coupon_target(mesh: &Mesh, axial_strain: f64) -> J2TetTarget {
        let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
        for (index, &[x, y, z]) in mesh.nodes.iter().enumerate() {
            if x == 0.0 || x == 1.0 {
                prescribed_m[index][0] = Some(axial_strain * x);
            }
            if x == 0.0 && y == 0.0 && z == 0.0 {
                prescribed_m[index][1] = Some(0.0);
                prescribed_m[index][2] = Some(0.0);
            }
            if x == 0.0 && y == 1.0 && z == 0.0 {
                prescribed_m[index][2] = Some(0.0);
            }
        }
        J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m,
        }
    }

    fn close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() < tolerance,
            "actual {actual:.12e}, expected {expected:.12e}"
        );
    }

    fn unit_tetrahedron() -> Mesh {
        Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        }
    }

    #[test]
    fn reference_body_and_face_loads_use_consistent_tet4_weights() {
        let mesh = unit_tetrahedron();
        let tets = prepare_tets(&mesh).unwrap();
        let target = J2TetTarget {
            loads_kn: vec![[0.0; 3], [0.0; 3], [0.0; 3], [0.0, 0.0, 3.0]],
            body_forces: vec![J2TetBodyForce {
                element: 0,
                force_kn_per_m3: [24.0, 0.0, 0.0],
            }],
            face_tractions: vec![J2TetFaceTraction {
                element: 0,
                face_nodes: [0, 1, 2],
                traction_kn_per_m2: [0.0, 12.0, 0.0],
            }],
            prescribed_m: vec![[Some(0.0); 3]; 4],
        };
        let loads = assemble_target_loads(&target, &mesh, &tets).unwrap();
        assert_eq!(
            loads,
            [1.0, 2.0, 0.0, 1.0, 2.0, 0.0, 1.0, 2.0, 0.0, 1.0, 0.0, 3.0]
        );
        let result = solve(&J2TetRequest {
            mesh,
            steel: J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap(),
            element_steels: None,
            targets: vec![target],
            options: J2TetOptions::default(),
        })
        .unwrap();
        for (reaction, load) in result.nodal_reactions_kn.iter().flatten().zip(loads) {
            close(*reaction, -load, 1e-12);
        }
    }

    #[test]
    fn distributed_loads_reject_invalid_geometry_and_nonfinite_values() {
        let mesh = unit_tetrahedron();
        let tets = prepare_tets(&mesh).unwrap();
        let mut target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; 4],
            body_forces: vec![J2TetBodyForce {
                element: 1,
                force_kn_per_m3: [1.0, 0.0, 0.0],
            }],
            face_tractions: Vec::new(),
            prescribed_m: vec![[Some(0.0); 3]; 4],
        };
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("element index"));
        target.body_forces[0].element = 0;
        target.body_forces[0].force_kn_per_m3[0] = f64::INFINITY;
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("non-finite"));
        target.body_forces.clear();
        target.face_tractions.push(J2TetFaceTraction {
            element: 0,
            face_nodes: [0, 1, 1],
            traction_kn_per_m2: [1.0, 0.0, 0.0],
        });
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("invalid face"));
        target.face_tractions[0].face_nodes = [0, 1, 4];
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("invalid face"));
        target.face_tractions[0].face_nodes = [0, 1, 2];
        target.face_tractions[0].traction_kn_per_m2[0] = f64::NAN;
        assert!(assemble_target_loads(&target, &mesh, &tets)
            .unwrap_err()
            .contains("invalid face"));
    }

    #[test]
    fn coupon_plastic_loading_and_elastic_unloading_match_one_d_solution() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let peak = 0.004;
        let unload = 0.0035;
        let p =
            (steel.youngs_mpa * peak - steel.yield_mpa) / (steel.youngs_mpa + steel.hardening_mpa);
        let peak_sigma = steel.yield_mpa + steel.hardening_mpa * p;
        let unload_sigma = steel.youngs_mpa * (unload - p);
        let peak_result = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![coupon_target(&mesh, peak)],
            options: J2TetOptions::default(),
        })
        .unwrap();
        let full_result = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![coupon_target(&mesh, peak), coupon_target(&mesh, unload)],
            options: J2TetOptions::default(),
        })
        .unwrap();
        for (result, sigma) in [(&peak_result, peak_sigma), (&full_result, unload_sigma)] {
            let right_force: f64 = mesh
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, point)| point[0] == 1.0)
                .map(|(index, _)| result.nodal_reactions_kn[index][0])
                .sum();
            close(right_force, sigma * 1_000.0, 1e-4);
            close(result.true_free_residual_kn, 0.0, 1e-4);
        }
        for state in &full_result.element_states {
            close(state.equivalent_plastic_strain, p, 1e-10);
            close(state.stress_mpa[0][0], unload_sigma, 1e-7);
            close(state.stress_mpa[1][1], 0.0, 1e-7);
        }
        assert!(full_result
            .accepted_steps
            .iter()
            .any(|step| step.target_index == 1));
    }

    #[test]
    fn mixed_affine_patch_with_free_interior_node_and_multiple_tets() {
        let mesh = grid(2, 2, 2);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let affine = |p: [f64; 3]| {
            let [x, y, z] = p;
            [
                0.004 * x + 0.0003 * y,
                -0.0015 * y + 0.0002 * z,
                -0.0015 * z,
            ]
        };
        let mut prescribed_m = Vec::new();
        let mut interior = None;
        for (index, &point) in mesh.nodes.iter().enumerate() {
            if point == [0.5, 0.5, 0.5] {
                prescribed_m.push([None; 3]);
                interior = Some(index);
            } else {
                prescribed_m.push(affine(point).map(Some));
            }
        }
        let result = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![J2TetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                body_forces: Vec::new(),
                face_tractions: Vec::new(),
                prescribed_m,
            }],
            options: J2TetOptions::default(),
        })
        .unwrap();
        let interior = interior.unwrap();
        let expected = affine(mesh.nodes[interior]);
        for (actual, expected) in result.nodal_displacements_m[interior].iter().zip(expected) {
            close(*actual, expected, 1e-10);
        }
        assert!(result
            .element_states
            .iter()
            .all(|state| state.equivalent_plastic_strain > 0.0));
        close(result.true_free_residual_kn, 0.0, 1e-5);
    }

    #[test]
    fn missing_supports_or_tiny_factor_budget_fail_explicitly() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let no_supports = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[None; 3]; mesh.nodes.len()],
        };
        assert!(solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![no_supports],
            options: J2TetOptions::default(),
        })
        .unwrap_err()
        .contains("no prescribed DOF"));
        let mut options = J2TetOptions::default();
        options.max_factor_entries = 1;
        options.min_step_fraction = 0.25;
        let error = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![coupon_target(&mesh, 0.004)],
            options,
        })
        .unwrap_err();
        assert!(error.contains("factor entry limit"), "{error}");
    }

    #[test]
    fn zero_load_mechanism_is_rejected_despite_zero_residual() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[None; 3]; mesh.nodes.len()],
        };
        target.prescribed_m[0] = [Some(0.0); 3];
        let mut options = J2TetOptions::default();
        options.min_step_fraction = 0.25;
        let error = solve(&J2TetRequest {
            mesh,
            steel,
            element_steels: None,
            targets: vec![target],
            options,
        })
        .unwrap_err();
        assert!(
            error.contains("pivot") || error.contains("unstable"),
            "{error}"
        );
    }

    #[test]
    fn frontal_matches_sparse_on_plastic_coupon_and_reports_selected_backend() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let target = coupon_target(&mesh, 0.004);
        let request = J2TetRequest {
            mesh,
            steel,
            element_steels: None,
            targets: vec![target],
            options: J2TetOptions::default(),
        };
        let sparse = solve(&request).unwrap();
        let mut frontal_request = request.clone();
        frontal_request.options.linear_backend = J2TetLinearBackend::FrontalWave;
        let frontal = solve(&frontal_request).unwrap();
        assert_eq!(frontal.linear_backend_used, J2TetLinearBackend::FrontalWave);
        assert_eq!(sparse.linear_backend_used, J2TetLinearBackend::SparseDirect);
        assert_eq!(
            serde_json::to_value(&frontal).unwrap()["linearBackendUsed"],
            "frontalWave"
        );
        for (a, b) in frontal
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(sparse.nodal_displacements_m.iter().flatten())
        {
            close(*a, *b, 1e-9);
        }
        for (a, b) in frontal
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(sparse.nodal_reactions_kn.iter().flatten())
        {
            close(*a, *b, 1e-5);
        }
        for (a, b) in frontal.element_states.iter().zip(&sparse.element_states) {
            close(
                a.equivalent_plastic_strain,
                b.equivalent_plastic_strain,
                1e-9,
            );
        }
    }

    #[test]
    fn frontal_rejects_too_small_front_and_zero_load_mechanism() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut options = J2TetOptions::default();
        options.linear_backend = J2TetLinearBackend::FrontalWave;
        options.max_front_dofs = 1;
        options.min_step_fraction = 0.25;
        let error = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![coupon_target(&mesh, 0.004)],
            options,
        })
        .unwrap_err();
        assert!(error.contains("wavefront exceeded maximum"), "{error}");
        options.max_front_dofs = 256;
        let mut target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[None; 3]; mesh.nodes.len()],
        };
        target.prescribed_m[0] = [Some(0.0); 3];
        let error = solve(&J2TetRequest {
            mesh,
            steel,
            element_steels: None,
            targets: vec![target],
            options,
        })
        .unwrap_err();
        assert!(
            error.contains("pivot") || error.contains("unstable"),
            "{error}"
        );
    }

    #[test]
    fn automatic_recovers_only_sparse_factor_budget_and_keeps_frontal_for_step() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut request = J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![coupon_target(&mesh, 0.004)],
            options: J2TetOptions::default(),
        };
        let sparse = solve(&request).unwrap();
        request.options.linear_backend = J2TetLinearBackend::Automatic;
        let automatic_sparse = solve(&request).unwrap();
        assert_eq!(
            automatic_sparse.linear_backend_used,
            J2TetLinearBackend::SparseDirect
        );
        assert_eq!(automatic_sparse.frontal_fallbacks, 0);
        request.options.max_factor_entries = 1;
        let automatic_frontal = solve(&request).unwrap();
        assert_eq!(
            automatic_frontal.linear_backend_used,
            J2TetLinearBackend::FrontalWave
        );
        assert_eq!(automatic_frontal.frontal_fallbacks, 1);
        assert_eq!(
            serde_json::to_value(&automatic_frontal).unwrap()["frontalFallbacks"],
            1
        );
        for (a, b) in automatic_frontal
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(sparse.nodal_reactions_kn.iter().flatten())
        {
            close(*a, *b, 1e-5);
        }
        for (a, b) in automatic_frontal
            .element_states
            .iter()
            .zip(&sparse.element_states)
        {
            close(
                a.equivalent_plastic_strain,
                b.equivalent_plastic_strain,
                1e-9,
            );
        }
        request.options.max_front_dofs = 1;
        request.options.min_step_fraction = 0.25;
        let error = solve(&request).unwrap_err();
        assert!(
            error.contains("frontal recovery failed")
                && error.contains("wavefront exceeded maximum"),
            "{error}"
        );
    }

    #[test]
    fn automatic_never_recovers_non_budget_failure() {
        assert!(may_recover_factor_budget(
            J2TetLinearBackend::Automatic,
            J2TetLinearBackend::SparseDirect,
            "LDLT factor entry limit 1 is below 2 free diagonals"
        ));
        assert!(!may_recover_factor_budget(
            J2TetLinearBackend::Automatic,
            J2TetLinearBackend::SparseDirect,
            "non-positive LDLT pivot"
        ));
        assert!(!may_recover_factor_budget(
            J2TetLinearBackend::Automatic,
            J2TetLinearBackend::FrontalWave,
            "LDLT factor entry limit 1 is below 2 free diagonals"
        ));
        assert!(!may_recover_factor_budget(
            J2TetLinearBackend::SparseDirect,
            J2TetLinearBackend::SparseDirect,
            "LDLT factor entry limit 1 is below 2 free diagonals"
        ));
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[None; 3]; mesh.nodes.len()],
        };
        target.prescribed_m[0] = [Some(0.0); 3];
        let mut options = J2TetOptions::default();
        options.linear_backend = J2TetLinearBackend::Automatic;
        options.min_step_fraction = 0.25;
        let error = solve(&J2TetRequest {
            mesh,
            steel,
            element_steels: None,
            targets: vec![target],
            options,
        })
        .unwrap_err();
        assert!(
            error.contains("pivot") || error.contains("unstable"),
            "{error}"
        );
        assert!(!error.contains("frontal recovery"), "{error}");
    }

    #[test]
    fn adaptive_cutback_retries_from_last_committed_state() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut options = J2TetOptions::default();
        options.max_newton_iterations = 2;
        options.max_step_cutbacks = 30;
        options.min_step_fraction = 1.0 / 4_096.0;
        let result = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![coupon_target(&mesh, 0.004)],
            options,
        })
        .unwrap();
        assert!(result.cutbacks > 0);
        let expected_p =
            (steel.youngs_mpa * 0.004 - steel.yield_mpa) / (steel.youngs_mpa + steel.hardening_mpa);
        for state in result.element_states {
            close(state.equivalent_plastic_strain, expected_p, 1e-9);
        }
    }

    #[test]
    fn nodal_force_on_multi_tet_block_balances_reactions() {
        let mesh = grid(2, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[None; 3]; mesh.nodes.len()],
        };
        for (index, point) in mesh.nodes.iter().enumerate() {
            if point[0] == 0.0 {
                target.prescribed_m[index] = [Some(0.0); 3];
            }
            if point[0] == 1.0 {
                target.loads_kn[index][0] = 0.25;
            }
        }
        let result = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![target],
            options: J2TetOptions::default(),
        })
        .unwrap();
        let support_x: f64 = mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node[0] == 0.0)
            .map(|(index, _)| result.nodal_reactions_kn[index][0])
            .sum();
        close(support_x, -1.0, 1e-8);
        close(result.true_free_residual_kn, 0.0, 1e-8);
        assert!(result
            .element_states
            .iter()
            .all(|state| state.equivalent_plastic_strain == 0.0));
        let tip_x: f64 = mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node[0] == 1.0)
            .map(|(index, _)| result.nodal_displacements_m[index][0])
            .sum::<f64>()
            / 4.0;
        assert!(tip_x > 0.0 && tip_x < 1e-4, "tip displacement {tip_x}");
    }

    fn force_coupon_target(mesh: &Mesh, axial_stress_mpa: f64) -> J2TetTarget {
        let mut target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[None; 3]; mesh.nodes.len()],
        };
        for (index, &[x, y, z]) in mesh.nodes.iter().enumerate() {
            if x == 0.0 {
                target.prescribed_m[index][0] = Some(0.0);
            }
            if [x, y, z] == [0.0, 0.0, 0.0] {
                target.prescribed_m[index][1] = Some(0.0);
                target.prescribed_m[index][2] = Some(0.0);
            }
            if [x, y, z] == [0.0, 1.0, 0.0] {
                target.prescribed_m[index][2] = Some(0.0);
            }
            if x == 1.0 {
                // The right square is split along (y,z)=(0,0)--(1,1).
                // Consistent traction nodal weights: 1/3 at both diagonal
                // corners and 1/6 at the other two corners.
                let weight = if y == z { 1.0 / 3.0 } else { 1.0 / 6.0 };
                target.loads_kn[index][0] = axial_stress_mpa * 1_000.0 * weight;
            }
        }
        target
    }

    #[test]
    fn force_controlled_coupon_plastic_loading_then_unloading_matches_one_d() {
        let mesh = grid(1, 1, 1);
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let peak_stress = 260.0;
        let unloaded_stress = 100.0;
        let p = (peak_stress - steel.yield_mpa) / steel.hardening_mpa;
        let peak = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![force_coupon_target(&mesh, peak_stress)],
            options: J2TetOptions::default(),
        })
        .unwrap();
        let unloaded = solve(&J2TetRequest {
            mesh: mesh.clone(),
            steel,
            element_steels: None,
            targets: vec![
                force_coupon_target(&mesh, peak_stress),
                force_coupon_target(&mesh, unloaded_stress),
            ],
            options: J2TetOptions::default(),
        })
        .unwrap();
        for (result, stress, axial_strain, plastic_strain) in [
            (&peak, peak_stress, peak_stress / steel.youngs_mpa + p, p),
            (
                &unloaded,
                unloaded_stress,
                unloaded_stress / steel.youngs_mpa + p,
                p,
            ),
        ] {
            let support_force: f64 = mesh
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, node)| node[0] == 0.0)
                .map(|(index, _)| result.nodal_reactions_kn[index][0])
                .sum();
            close(support_force, -stress * 1_000.0, 1e-3);
            for (index, node) in mesh.nodes.iter().enumerate() {
                if node[0] == 1.0 {
                    close(result.nodal_displacements_m[index][0], axial_strain, 1e-8);
                }
            }
            for state in &result.element_states {
                close(state.stress_mpa[0][0], stress, 1e-6);
                close(state.stress_mpa[1][1], 0.0, 1e-6);
                close(state.stress_mpa[2][2], 0.0, 1e-6);
                close(state.equivalent_plastic_strain, plastic_strain, 1e-9);
            }
            close(result.true_free_residual_kn, 0.0, 1e-3);
        }
    }

    #[test]
    fn element_steels_follow_mesh_order_and_keep_independent_histories() {
        let mut mesh = unit_tetrahedron();
        mesh.nodes.extend(
            unit_tetrahedron()
                .nodes
                .into_iter()
                .map(|[x, y, z]| [x + 2.0, y, z]),
        );
        mesh.tets.push([4, 5, 6, 7]);
        let first = J2Steel::new(200_000.0, 0.30, 250.0, 2_000.0).unwrap();
        let second = J2Steel::new(150_000.0, 0.22, 120.0, 5_000.0).unwrap();
        let target = |strain: f64| J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: mesh
                .nodes
                .iter()
                .map(|point| [Some(strain * point[0]), Some(0.0), Some(0.0)])
                .collect(),
        };
        let targets = vec![target(0.004), target(0.0035)];
        let request = J2TetRequest {
            mesh,
            steel: first,
            element_steels: Some(vec![first, second]),
            targets,
            options: J2TetOptions::default(),
        };
        let result = solve(&request).unwrap();
        let peak = [[0.004, 0.0, 0.0], [0.0; 3], [0.0; 3]];
        let unload = [[-0.0005, 0.0, 0.0], [0.0; 3], [0.0; 3]];
        for (element, steel) in [first, second].into_iter().enumerate() {
            let peak_state = steel.update(&J2State::default(), peak).unwrap().state;
            let expected = steel.update(&peak_state, unload).unwrap().state;
            let actual = &result.element_states[element];
            for i in 0..3 {
                for j in 0..3 {
                    close(actual.stress_mpa[i][j], expected.stress_mpa[i][j], 1e-8);
                    close(
                        actual.plastic_strain[i][j],
                        expected.plastic_strain[i][j],
                        1e-10,
                    );
                }
            }
            close(
                actual.equivalent_plastic_strain,
                expected.equivalent_plastic_strain,
                1e-10,
            );
        }
        assert!(
            (result.element_states[0].stress_mpa[0][0] - result.element_states[1].stress_mpa[0][0])
                .abs()
                > 10.0
        );
    }

    #[test]
    fn element_steels_reject_bad_length_and_properties() {
        let mesh = unit_tetrahedron();
        let target = J2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: Vec::new(),
            face_tractions: Vec::new(),
            prescribed_m: vec![[Some(0.0); 3]; mesh.nodes.len()],
        };
        let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut request = J2TetRequest {
            mesh,
            steel,
            element_steels: Some(Vec::new()),
            targets: vec![target],
            options: J2TetOptions::default(),
        };
        request.element_steels = None;
        let legacy_json = serde_json::to_value(&request).unwrap();
        assert!(legacy_json.get("elementSteels").is_none());
        let legacy: J2TetRequest = serde_json::from_value(legacy_json).unwrap();
        assert!(legacy.element_steels.is_none());
        request.element_steels = Some(Vec::new());
        assert!(solve(&request)
            .unwrap_err()
            .contains("elementSteels length"));
        request.element_steels = Some(vec![J2Steel {
            youngs_mpa: f64::NAN,
            ..steel
        }]);
        assert!(solve(&request).unwrap_err().contains("elementSteels[0]"));
    }
}
