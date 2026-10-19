//! Small-strain, plane-stress thickness fibers for a plate section.
//!
//! Coordinates and thickness are metres, E is MPa, stresses are kN/m².
//! Generalized strain is `[εx, εy, γxy, κx, κy, κxy]`, with curvature in 1/m.
//! A fiber at `z` has `[εx, εy, γxy] + z [κx, κy, κxy]`.
//! Generalized stress is `[Nx, Ny, Nxy, Mx, My, Mxy]`; N is kN/m and M is
//! kN·m/m. Each layer uses two-point Gauss-Legendre integration in thickness:
//! `z = z_mid ± h/(2√3)`, each weight `h/2`. Thus elastic A/B/D terms are
//! integrated exactly, including unsymmetric stacks.
//! For plastic bending the caller must refine the thickness layers until the
//! moving yield front and section tangent converge.
//!
//! This is a section kernel only. It does not supply a plate element, shear
//! deformation, geometric nonlinearity, crack-width law, or mesh regularization.

use crate::material2d::{self, State as MaterialState};
use crate::MaterialLaw;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SECTION_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_STATE_REVISION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layer {
    pub thickness_m: f64,
    pub e_mpa: f64,
    pub nu: f64,
    pub law: MaterialLaw,
}

#[derive(Clone, Copy, Debug)]
struct Fiber {
    z_m: f64,
    weight_m: f64,
    e_mpa: f64,
    nu: f64,
    law: MaterialLaw,
}

#[derive(Clone, Debug)]
pub struct PlateFiberSection {
    thickness_m: f64,
    fibers: Vec<Fiber>,
    max_abs_z_m: f64,
    section_id: u64,
}

/// One committed constitutive state per thickness integration point.
#[derive(Clone, Debug)]
pub struct SectionState {
    fibers: Vec<MaterialState>,
    section_id: u64,
    generation: u64,
    revision: u64,
}

#[derive(Clone, Debug)]
pub struct SectionTrial {
    pub resultants: [f64; 6],
    /// Central finite-difference derivative of resultants with respect to
    /// generalized strain, evaluated entirely from the supplied committed state.
    /// At a yield switch a unique classical derivative need not exist.
    pub tangent: [[f64; 6]; 6],
    state: SectionState,
    /// Plane-stress `[σx, σy, τxy]` in kN/m², in layer/Gauss order.
    pub fiber_stress: Vec<[f64; 3]>,
    source_generation: u64,
    source_revision: u64,
}

#[derive(Clone, Debug)]
pub struct BendingInverseResult {
    pub generalized_strain: [f64; 6],
    pub trial: SectionTrial,
    /// `[Nx, Ny, Nxy, Mx-Mx_target, My-My_target, Mxy-Mxy_target]`.
    /// Force entries are kN/m; moment entries are kN·m/m.
    pub residual: [f64; 6],
    /// Euclidean norm of `[h·N, M-M_target]` in kN, where `h` is total thickness.
    pub scaled_residual_norm_kn: f64,
    pub membrane_residual_norm_kn_per_m: f64,
    pub moment_residual_norm_kn_m_per_m: f64,
    pub iterations: usize,
    pub line_search_halvings: usize,
}

struct Evaluation {
    resultants: [f64; 6],
    state: SectionState,
    fiber_stress: Vec<[f64; 3]>,
}

impl SectionState {
    pub fn fiber_states(&self) -> &[MaterialState] {
        &self.fibers
    }
}

impl SectionTrial {
    pub fn fiber_states(&self) -> &[MaterialState] {
        &self.state.fibers
    }
}

impl PlateFiberSection {
    pub fn new(layers: &[Layer]) -> Result<Self, String> {
        if layers.is_empty() || layers.len() > 512 {
            return Err("plate fiber section requires 1..512 layers".into());
        }
        let mut thickness_m = 0.0;
        for (i, layer) in layers.iter().enumerate() {
            if !layer.thickness_m.is_finite() || layer.thickness_m <= 0.0 {
                return Err(format!(
                    "plate layer {i} thickness must be finite and positive"
                ));
            }
            if !layer.e_mpa.is_finite() || layer.e_mpa <= 0.0 {
                return Err(format!("plate layer {i} E must be finite and positive"));
            }
            if !layer.nu.is_finite() || layer.nu <= -1.0 || layer.nu >= 0.5 {
                return Err(format!(
                    "plate layer {i} Poisson ratio must be in (-1, 0.5)"
                ));
            }
            match layer.law {
                MaterialLaw::Elastic => {}
                MaterialLaw::SteelBilinear {
                    yield_mpa,
                    hardening_ratio,
                } => {
                    if !yield_mpa.is_finite()
                        || yield_mpa <= 0.0
                        || !hardening_ratio.is_finite()
                        || !(0.0..1.0).contains(&hardening_ratio)
                    {
                        return Err(format!("plate layer {i} has invalid steel law"));
                    }
                }
                MaterialLaw::ConcreteCracking { .. } => {
                    // material2d's local tensile-damage law has no characteristic
                    // length or fracture-energy parameter. Changing the layer
                    // partition would therefore change dissipated bending work.
                    return Err("concrete plate fibers require a source-backed crack-band/length regularization before bending FNL can be enabled".into());
                }
            }
            thickness_m += layer.thickness_m;
        }
        if !thickness_m.is_finite() || thickness_m <= 0.0 {
            return Err("plate fiber section has invalid total thickness".into());
        }
        let mut fibers = Vec::with_capacity(2 * layers.len());
        let mut bottom = -0.5 * thickness_m;
        let gauss = 1.0 / 3.0_f64.sqrt();
        for layer in layers {
            let mid = bottom + 0.5 * layer.thickness_m;
            for root in [-gauss, gauss] {
                fibers.push(Fiber {
                    z_m: mid + 0.5 * layer.thickness_m * root,
                    weight_m: 0.5 * layer.thickness_m,
                    e_mpa: layer.e_mpa,
                    nu: layer.nu,
                    law: layer.law,
                });
            }
            bottom += layer.thickness_m;
        }
        let max_abs_z_m = fibers.iter().map(|f| f.z_m.abs()).fold(0.0, f64::max);
        if max_abs_z_m == 0.0 || fibers.iter().any(|f| f.weight_m == 0.0) {
            return Err("plate fiber thickness is below floating-point resolution".into());
        }
        let section_id = NEXT_SECTION_ID
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| "plate fiber section identity space exhausted")?;
        Ok(Self {
            thickness_m,
            fibers,
            max_abs_z_m,
            section_id,
        })
    }

    pub fn initial_state(&self) -> SectionState {
        SectionState {
            fibers: vec![MaterialState::default(); self.fibers.len()],
            section_id: self.section_id,
            generation: 0,
            revision: 0,
        }
    }

    pub fn thickness_m(&self) -> f64 {
        self.thickness_m
    }

    pub fn fiber_positions_m(&self) -> Vec<f64> {
        self.fibers.iter().map(|f| f.z_m).collect()
    }

    pub fn fiber_weights_m(&self) -> Vec<f64> {
        self.fibers.iter().map(|f| f.weight_m).collect()
    }

    fn evaluate(
        &self,
        generalized_strain: [f64; 6],
        committed: &SectionState,
    ) -> Result<Evaluation, String> {
        if !generalized_strain.iter().all(|v| v.is_finite()) {
            return Err("plate generalized strain must be finite".into());
        }
        if committed.fibers.len() != self.fibers.len() || committed.section_id != self.section_id {
            return Err("plate fiber committed state does not match section".into());
        }
        let mut resultants = [0.0; 6];
        let mut states = Vec::with_capacity(self.fibers.len());
        let mut stresses = Vec::with_capacity(self.fibers.len());
        for (fiber, previous) in self.fibers.iter().zip(&committed.fibers) {
            if !previous.plastic_strain.iter().all(|v| v.is_finite())
                || !previous.equivalent_plastic_strain.is_finite()
                || previous.equivalent_plastic_strain < 0.0
                || !previous.tensile_damage.is_finite()
                || !(0.0..=1.0).contains(&previous.tensile_damage)
                || !previous.max_equivalent_strain.is_finite()
            {
                return Err("plate fiber committed state must be finite".into());
            }
            let strain = std::array::from_fn(|i| {
                generalized_strain[i] + fiber.z_m * generalized_strain[i + 3]
            });
            let response = material2d::update(fiber.e_mpa, fiber.nu, fiber.law, strain, *previous)?;
            for i in 0..3 {
                resultants[i] += fiber.weight_m * response.stress[i];
                resultants[i + 3] += fiber.weight_m * fiber.z_m * response.stress[i];
            }
            states.push(response.state);
            stresses.push(response.stress);
        }
        if !resultants.iter().all(|v| v.is_finite()) {
            return Err("plate fiber resultants are non-finite".into());
        }
        Ok(Evaluation {
            resultants,
            state: SectionState {
                fibers: states,
                section_id: self.section_id,
                generation: committed.generation,
                revision: committed.revision,
            },
            fiber_stress: stresses,
        })
    }

    /// Evaluate a trial strain from committed history without changing it.
    /// Tangent columns use a central perturbation giving approximately 1e-7
    /// maximum fiber strain, or 1e-5 relative to the generalized coordinate.
    pub fn trial(
        &self,
        generalized_strain: [f64; 6],
        committed: &SectionState,
    ) -> Result<SectionTrial, String> {
        let baseline = self.evaluate(generalized_strain, committed)?;
        let mut tangent = [[0.0; 6]; 6];
        for column in 0..6 {
            let fiber_scale = if column < 3 { 1.0 } else { self.max_abs_z_m };
            let step = (1e-7 / fiber_scale).max(generalized_strain[column].abs() * 1e-5);
            let mut above = generalized_strain;
            let mut below = generalized_strain;
            above[column] += step;
            below[column] -= step;
            let plus = self.evaluate(above, committed)?.resultants;
            let minus = self.evaluate(below, committed)?.resultants;
            for row in 0..6 {
                tangent[row][column] = (plus[row] - minus[row]) / (2.0 * step);
                if !tangent[row][column].is_finite() {
                    return Err("plate fiber tangent is non-finite".into());
                }
            }
        }
        Ok(SectionTrial {
            resultants: baseline.resultants,
            tangent,
            state: baseline.state,
            fiber_stress: baseline.fiber_stress,
            source_generation: committed.generation,
            source_revision: committed.revision,
        })
    }

    /// Accept the baseline trial history after a global Newton/load step.
    /// Discarding a trial leaves `committed` unchanged, including all fibers.
    pub fn commit(&self, committed: &mut SectionState, trial: &SectionTrial) -> Result<(), String> {
        if trial.state.fibers.len() != self.fibers.len()
            || committed.fibers.len() != self.fibers.len()
            || trial.state.section_id != self.section_id
            || committed.section_id != self.section_id
        {
            return Err("plate fiber state does not match section".into());
        }
        if trial.source_generation != committed.generation
            || trial.state.generation != trial.source_generation
            || trial.source_revision != committed.revision
            || trial.state.revision != trial.source_revision
        {
            return Err("plate fiber trial is stale relative to committed history".into());
        }
        let next_generation = committed
            .generation
            .checked_add(1)
            .ok_or("plate fiber history generation overflow")?;
        let next_revision = NEXT_STATE_REVISION
            .try_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| "plate fiber history revision space exhausted")?;
        *committed = trial.state.clone();
        committed.generation = next_generation;
        committed.revision = next_revision;
        Ok(())
    }

    /// Solve the six local section strains for zero membrane force and the
    /// prescribed bending moments. Newton is capped at 40 iterations with at
    /// most 18 line-search halvings each. With
    /// `tol=1e-8·|M_target|` kN for a nonzero target (1e-12 kN only for
    /// exactly zero target), success requires both `|N|≤tol/h` in
    /// kN/m and `|M−M_target|≤tol` in kN·m/m. Every evaluation starts from
    /// `committed`; call `commit` with the returned trial only after the parent
    /// element/global step is accepted.
    pub fn solve_bending_moments(
        &self,
        moments_kn_m_per_m: [f64; 3],
        committed: &SectionState,
        initial_generalized_strain: [f64; 6],
    ) -> Result<BendingInverseResult, String> {
        if !moments_kn_m_per_m.iter().all(|v| v.is_finite()) {
            return Err("prescribed plate bending moments must be finite".into());
        }
        let target_norm = moments_kn_m_per_m[0]
            .hypot(moments_kn_m_per_m[1])
            .hypot(moments_kn_m_per_m[2]);
        if !target_norm.is_finite() {
            return Err("prescribed plate bending moment norm is non-finite".into());
        }
        let tolerance = if target_norm == 0.0 {
            1e-12
        } else {
            1e-8 * target_norm
        };
        if tolerance == 0.0 {
            return Err(
                "prescribed plate bending moments are below inverse numerical resolution".into(),
            );
        }
        let mut strain = initial_generalized_strain;
        let mut trial = self.trial(strain, committed)?;
        let mut total_halvings = 0;
        for iteration in 0..=40 {
            let (residual, norm, membrane_norm, moment_norm) =
                bending_residual(&trial.resultants, &moments_kn_m_per_m, self.thickness_m)?;
            if membrane_norm <= tolerance / self.thickness_m && moment_norm <= tolerance {
                return Ok(BendingInverseResult {
                    generalized_strain: strain,
                    trial,
                    residual,
                    scaled_residual_norm_kn: norm,
                    membrane_residual_norm_kn_per_m: membrane_norm,
                    moment_residual_norm_kn_m_per_m: moment_norm,
                    iterations: iteration,
                    line_search_halvings: total_halvings,
                });
            }
            if iteration == 40 {
                return Err(format!("plate fiber bending inverse did not converge in 40 iterations; membrane residual {membrane_norm:.6e} kN/m, moment residual {moment_norm:.6e} kN·m/m"));
            }
            let increment =
                solve_stable_section_tangent(&trial.tangent, &residual, self.thickness_m)?;
            let mut accepted = false;
            for halvings in 0..=18 {
                let scale = 2.0_f64.powi(-(halvings as i32));
                let candidate = std::array::from_fn(|i| strain[i] + scale * increment[i]);
                let candidate_eval = match self.evaluate(candidate, committed) {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                let (_, candidate_norm, candidate_membrane_norm, candidate_moment_norm) =
                    bending_residual(
                        &candidate_eval.resultants,
                        &moments_kn_m_per_m,
                        self.thickness_m,
                    )?;
                if candidate_norm < norm * (1.0 - 1e-4 * scale)
                    || (candidate_membrane_norm <= tolerance / self.thickness_m
                        && candidate_moment_norm <= tolerance)
                {
                    strain = candidate;
                    trial = self.trial(strain, committed)?;
                    total_halvings += halvings;
                    accepted = true;
                    break;
                }
            }
            if !accepted {
                return Err(format!("plate fiber bending inverse line search stalled; membrane residual {membrane_norm:.6e} kN/m, moment residual {moment_norm:.6e} kN·m/m"));
            }
        }
        unreachable!("bounded section inverse Newton loop")
    }

    /// Tangent `dM/dκ` when the membrane force is held at zero.
    ///
    /// Eliminating the membrane strain from the local A/B/D tangent gives
    /// `D - C A⁻¹ B`. The supplied trial must belong to this section. The
    /// complete work-conjugate 6×6 tangent must be symmetric and positive
    /// definite to numerical tolerance; an unstable local constitutive branch
    /// is rejected instead of returning a misleading condensed stiffness.
    pub fn effective_bending_tangent(&self, trial: &SectionTrial) -> Result<[[f64; 3]; 3], String> {
        if trial.state.section_id != self.section_id
            || trial.state.fibers.len() != self.fibers.len()
            || trial.state.generation != trial.source_generation
            || trial.state.revision != trial.source_revision
        {
            return Err("plate fiber trial does not match section".into());
        }
        // This already checks the full work-conjugate tangent, including its
        // membrane/bending cross blocks and positive pivots after h scaling.
        solve_stable_section_tangent(&trial.tangent, &[0.0; 6], self.thickness_m)?;

        // Average reciprocal entries within the accepted finite-difference
        // symmetry tolerance, so the Schur complement remains symmetric.
        let a: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| 0.5 * (trial.tangent[i][j] + trial.tangent[j][i]))
        });
        let b: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| 0.5 * (trial.tangent[i][j + 3] + trial.tangent[j + 3][i]))
        });
        let d: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| {
                0.5 * (trial.tangent[i + 3][j + 3] + trial.tangent[j + 3][i + 3])
            })
        });
        let mut lower = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..=i {
                let mut value = a[i][j];
                for k in 0..j {
                    value -= lower[i][k] * lower[j][k];
                }
                if i == j {
                    if !value.is_finite() || value <= 0.0 {
                        return Err(
                            "plate fiber effective bending tangent has singular membrane block"
                                .into(),
                        );
                    }
                    lower[i][j] = value.sqrt();
                } else {
                    lower[i][j] = value / lower[j][j];
                }
            }
        }
        let mut a_inv_b = [[0.0; 3]; 3];
        for column in 0..3 {
            let mut intermediate = [0.0; 3];
            for i in 0..3 {
                let mut value = b[i][column];
                for j in 0..i {
                    value -= lower[i][j] * intermediate[j];
                }
                intermediate[i] = value / lower[i][i];
            }
            for i in (0..3).rev() {
                let mut value = intermediate[i];
                for j in (i + 1)..3 {
                    value -= lower[j][i] * a_inv_b[j][column];
                }
                a_inv_b[i][column] = value / lower[i][i];
            }
        }
        let effective: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| d[i][j] - (0..3).map(|k| b[k][i] * a_inv_b[k][j]).sum::<f64>())
        });
        if !effective.iter().flatten().all(|v| v.is_finite()) {
            return Err("plate fiber effective bending tangent is non-finite".into());
        }
        Ok(effective)
    }
}

fn bending_residual(
    resultants: &[f64; 6],
    moments: &[f64; 3],
    thickness_m: f64,
) -> Result<([f64; 6], f64, f64, f64), String> {
    let residual =
        std::array::from_fn(|i| resultants[i] - if i < 3 { 0.0 } else { moments[i - 3] });
    let membrane_norm = residual[..3].iter().map(|v| v * v).sum::<f64>().sqrt();
    let moment_norm = residual[3..].iter().map(|v| v * v).sum::<f64>().sqrt();
    let norm = (thickness_m * membrane_norm).hypot(moment_norm);
    if !norm.is_finite() || !membrane_norm.is_finite() || !moment_norm.is_finite() {
        return Err("plate fiber bending inverse residual is non-finite".into());
    }
    Ok((residual, norm, membrane_norm, moment_norm))
}

/// Cholesky solve after work-conjugate scaling: `y=[ε,hκ]` and
/// `r'=[hN,M]`, making the A/B/D blocks comparable and preserving symmetry.
fn solve_stable_section_tangent(
    tangent: &[[f64; 6]; 6],
    residual: &[f64; 6],
    thickness_m: f64,
) -> Result<[f64; 6], String> {
    let row_scale = [thickness_m, thickness_m, thickness_m, 1.0, 1.0, 1.0];
    let column_scale = [1.0, 1.0, 1.0, thickness_m, thickness_m, thickness_m];
    let matrix: [[f64; 6]; 6] = std::array::from_fn(|i| {
        std::array::from_fn(|j| row_scale[i] * tangent[i][j] / column_scale[j])
    });
    let maximum = matrix.iter().flatten().map(|v| v.abs()).fold(0.0, f64::max);
    if !maximum.is_finite() || maximum == 0.0 {
        return Err("plate fiber bending inverse has singular or non-finite tangent".into());
    }
    let mut symmetric = [[0.0; 6]; 6];
    for i in 0..6 {
        for j in 0..6 {
            if (matrix[i][j] - matrix[j][i]).abs() > 1e-3 * maximum {
                return Err("plate fiber bending inverse has unstable asymmetric tangent".into());
            }
            symmetric[i][j] = 0.5 * (matrix[i][j] + matrix[j][i]);
        }
    }
    let mut lower = [[0.0; 6]; 6];
    for i in 0..6 {
        for j in 0..=i {
            let mut value = symmetric[i][j];
            for k in 0..j {
                value -= lower[i][k] * lower[j][k];
            }
            if i == j {
                if !value.is_finite() || value <= 1e-12 * maximum {
                    return Err(
                        "plate fiber bending inverse has singular or unstable non-positive tangent"
                            .into(),
                    );
                }
                lower[i][j] = value.sqrt();
            } else {
                lower[i][j] = value / lower[j][j];
            }
        }
    }
    let rhs: [f64; 6] = std::array::from_fn(|i| -row_scale[i] * residual[i]);
    let mut intermediate = [0.0; 6];
    for i in 0..6 {
        let mut value = rhs[i];
        for j in 0..i {
            value -= lower[i][j] * intermediate[j];
        }
        intermediate[i] = value / lower[i][i];
    }
    let mut scaled_increment = [0.0; 6];
    for i in (0..6).rev() {
        let mut value = intermediate[i];
        for j in (i + 1)..6 {
            value -= lower[j][i] * scaled_increment[j];
        }
        scaled_increment[i] = value / lower[i][i];
    }
    let increment = std::array::from_fn(|i| scaled_increment[i] / column_scale[i]);
    if !increment.iter().all(|v| v.is_finite()) {
        return Err("plate fiber bending inverse has non-finite Newton increment".into());
    }
    Ok(increment)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn elastic_q(e_mpa: f64, nu: f64) -> [[f64; 3]; 3] {
        let e = e_mpa * 1000.0;
        let c = e / (1.0 - nu * nu);
        [
            [c, c * nu, 0.0],
            [c * nu, c, 0.0],
            [0.0, 0.0, e / (2.0 * (1.0 + nu))],
        ]
    }

    // Independent 1D midpoint integration, split exactly at the yield front
    // found by bisection. This avoids the O(h) derivative error of a uniform
    // grid whose single cell happens to straddle the elastic/plastic switch.
    fn fine_steel_bending_moment(curvature: f64, steel: MaterialLaw) -> f64 {
        let mut elastic_end = 0.0;
        let mut plastic_start = 0.1;
        for _ in 0..50 {
            let z = 0.5 * (elastic_end + plastic_start);
            let point = material2d::update(
                210_000.0,
                0.3,
                steel,
                [z * curvature, 0.0, 0.0],
                MaterialState::default(),
            )
            .unwrap();
            if point.state.equivalent_plastic_strain > 0.0 {
                plastic_start = z;
            } else {
                elastic_end = z;
            }
        }
        let yield_z = 0.5 * (elastic_end + plastic_start);
        let mut moment = 0.0;
        for (lower, upper) in [(0.0, yield_z), (yield_z, 0.1)] {
            let dz = (upper - lower) / 2048.0;
            for i in 0..2048 {
                let z = lower + (i as f64 + 0.5) * dz;
                let point = material2d::update(
                    210_000.0,
                    0.3,
                    steel,
                    [z * curvature, 0.0, 0.0],
                    MaterialState::default(),
                )
                .unwrap();
                moment += 2.0 * dz * z * point.stress[0];
            }
        }
        moment
    }

    #[test]
    fn unsymmetric_elastic_stack_matches_closed_form_abd_and_units() {
        let layers = [
            Layer {
                thickness_m: 0.06,
                e_mpa: 210_000.0,
                nu: 0.3,
                law: MaterialLaw::Elastic,
            },
            Layer {
                thickness_m: 0.14,
                e_mpa: 70_000.0,
                nu: 0.2,
                law: MaterialLaw::Elastic,
            },
        ];
        let section = PlateFiberSection::new(&layers).unwrap();
        let strain = [0.0002, -0.0001, 0.0003, 0.002, -0.001, 0.0005];
        let trial = section.trial(strain, &section.initial_state()).unwrap();
        let mut expected = [[0.0; 6]; 6];
        let mut z0 = -0.1;
        for layer in layers {
            let z1 = z0 + layer.thickness_m;
            let moments = [
                z1 - z0,
                (z1 * z1 - z0 * z0) / 2.0,
                (z1 * z1 * z1 - z0 * z0 * z0) / 3.0,
            ];
            let q = elastic_q(layer.e_mpa, layer.nu);
            for i in 0..3 {
                for j in 0..3 {
                    expected[i][j] += q[i][j] * moments[0];
                    expected[i][j + 3] += q[i][j] * moments[1];
                    expected[i + 3][j] += q[i][j] * moments[1];
                    expected[i + 3][j + 3] += q[i][j] * moments[2];
                }
            }
            z0 = z1;
        }
        for i in 0..6 {
            let force: f64 = (0..6).map(|j| expected[i][j] * strain[j]).sum();
            assert!((trial.resultants[i] - force).abs() < 1e-8 * force.abs().max(1.0));
            for j in 0..6 {
                assert!(
                    (trial.tangent[i][j] - expected[i][j]).abs()
                        < 2e-8 * expected[i][j].abs().max(1.0),
                    "K[{i}][{j}]"
                );
            }
        }
        assert!(
            trial.tangent[0][3].abs() > 1e5,
            "unsymmetric B must be present"
        );
    }

    #[test]
    fn steel_pure_bending_and_unload_match_independent_fine_midpoint_quadrature() {
        let steel = MaterialLaw::SteelBilinear {
            yield_mpa: 235.0,
            hardening_ratio: 0.02,
        };
        let section = PlateFiberSection::new(&vec![
            Layer {
                thickness_m: 0.2 / 512.0,
                e_mpa: 210_000.0,
                nu: 0.3,
                law: steel,
            };
            512
        ])
        .unwrap();
        let mut committed = section.initial_state();
        let load = [0.0, 0.0, 0.0, 0.06, 0.0, 0.0];
        let loaded = section.trial(load, &committed).unwrap();
        let repeated = section.trial(load, &committed).unwrap();
        assert_eq!(loaded.resultants, repeated.resultants);
        assert!(committed
            .fibers
            .iter()
            .all(|state| state.equivalent_plastic_strain == 0.0));
        assert!(loaded
            .state
            .fibers
            .iter()
            .any(|state| state.equivalent_plastic_strain > 0.0));
        assert!(loaded.resultants[0].abs() < 1e-8);
        let nref = 8192;
        let dz = 0.2 / nref as f64;
        let mut fine_states = Vec::with_capacity(nref);
        let mut reference_loaded = [0.0; 6];
        let dk = 1e-5;
        for i in 0..nref {
            let z = -0.1 + (i as f64 + 0.5) * dz;
            let response = material2d::update(
                210_000.0,
                0.3,
                steel,
                [z * 0.06, 0.0, 0.0],
                MaterialState::default(),
            )
            .unwrap();
            for j in 0..3 {
                reference_loaded[j] += dz * response.stress[j];
                reference_loaded[j + 3] += dz * z * response.stress[j];
            }
            fine_states.push(response.state);
        }
        assert!((loaded.resultants[3] - reference_loaded[3]).abs() < 5e-5 * reference_loaded[3]);
        let reference_plastic_tangent = (fine_steel_bending_moment(0.06 + dk, steel)
            - fine_steel_bending_moment(0.06 - dk, steel))
            / (2.0 * dk);
        let mut convergence = Vec::new();
        for count in [64, 128, 256, 512] {
            let candidate = PlateFiberSection::new(&vec![
                Layer {
                    thickness_m: 0.2 / count as f64,
                    e_mpa: 210_000.0,
                    nu: 0.3,
                    law: steel,
                };
                count
            ])
            .unwrap();
            let value = candidate
                .trial(load, &candidate.initial_state())
                .unwrap()
                .tangent[3][3];
            let relative_error =
                (value - reference_plastic_tangent).abs() / reference_plastic_tangent.abs();
            convergence.push((count, value, relative_error));
        }
        // The derivative of a yielded fiber jumps at the moving yield front.
        // A fixed Gauss grid need not converge monotonically, but the 512-layer
        // result must improve substantially over the 64-layer result.
        assert!(
            convergence[3].2 < 0.25 * convergence[0].2,
            "plastic tangent quadrature convergence {convergence:?}"
        );
        assert!(
            (loaded.tangent[3][3] - reference_plastic_tangent).abs()
                < 3e-3 * reference_plastic_tangent.abs(),
            "section tangent {} fine midpoint tangent {}",
            loaded.tangent[3][3],
            reference_plastic_tangent,
        );
        section.commit(&mut committed, &loaded).unwrap();
        let unloaded = section.trial([0.0; 6], &committed).unwrap();
        let mut reference_unloaded = [0.0; 6];
        for (i, state) in fine_states.iter().enumerate() {
            let z = -0.1 + (i as f64 + 0.5) * dz;
            let response = material2d::update(210_000.0, 0.3, steel, [0.0; 3], *state).unwrap();
            for j in 0..3 {
                reference_unloaded[j] += dz * response.stress[j];
                reference_unloaded[j + 3] += dz * z * response.stress[j];
            }
        }
        assert!(
            unloaded.resultants[3] < 0.0,
            "plastic bending should leave a reversed residual moment"
        );
        assert!(
            (unloaded.resultants[3] - reference_unloaded[3]).abs()
                < 2e-4 * reference_unloaded[3].abs()
        );
        assert!(unloaded.resultants[0].abs() < 1e-8);
        assert!(committed
            .fibers
            .iter()
            .any(|state| state.equivalent_plastic_strain > 0.0));
    }

    #[test]
    fn concrete_requires_regularization_before_section_fnl() {
        let error = PlateFiberSection::new(&[Layer {
            thickness_m: 0.2,
            e_mpa: 30_000.0,
            nu: 0.2,
            law: MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.02,
            },
        }])
        .unwrap_err();
        assert!(error.contains("regularization"));
    }

    #[test]
    fn same_length_other_section_state_and_trial_are_rejected() {
        let first = PlateFiberSection::new(&[Layer {
            thickness_m: 0.2,
            e_mpa: 210_000.0,
            nu: 0.3,
            law: MaterialLaw::Elastic,
        }])
        .unwrap();
        let second = PlateFiberSection::new(&[Layer {
            thickness_m: 0.2,
            e_mpa: 70_000.0,
            nu: 0.3,
            law: MaterialLaw::Elastic,
        }])
        .unwrap();
        let mut first_state = first.initial_state();
        let second_state = second.initial_state();
        let second_trial = second.trial([0.0; 6], &second_state).unwrap();
        assert!(first
            .trial([0.0; 6], &second_state)
            .unwrap_err()
            .contains("does not match"));
        assert!(first
            .commit(&mut first_state, &second_trial)
            .unwrap_err()
            .contains("does not match"));
    }

    #[test]
    fn old_trial_cannot_overwrite_new_committed_history() {
        let section = PlateFiberSection::new(&[Layer {
            thickness_m: 0.2,
            e_mpa: 210_000.0,
            nu: 0.3,
            law: MaterialLaw::Elastic,
        }])
        .unwrap();
        let mut committed = section.initial_state();
        let first = section.trial([0.0001; 6], &committed).unwrap();
        let stale = section.trial([0.0002; 6], &committed).unwrap();
        section.commit(&mut committed, &first).unwrap();
        assert!(section
            .commit(&mut committed, &stale)
            .unwrap_err()
            .contains("stale"));
        let current = section.trial([0.0003; 6], &committed).unwrap();
        section.commit(&mut committed, &current).unwrap();
    }

    #[test]
    fn trial_from_one_committed_branch_cannot_overwrite_another() {
        let section = PlateFiberSection::new(&[Layer {
            thickness_m: 0.2,
            e_mpa: 210_000.0,
            nu: 0.3,
            law: MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.02,
            },
        }])
        .unwrap();
        let mut branch_a = section.initial_state();
        let mut branch_b = branch_a.clone();
        let first_a = section
            .trial([0.0, 0.0, 0.0, 0.06, 0.0, 0.0], &branch_a)
            .unwrap();
        let first_b = section
            .trial([0.0, 0.0, 0.0, 0.08, 0.0, 0.0], &branch_b)
            .unwrap();
        section.commit(&mut branch_a, &first_a).unwrap();
        section.commit(&mut branch_b, &first_b).unwrap();
        assert_eq!(branch_a.generation, branch_b.generation);
        assert_ne!(branch_a.revision, branch_b.revision);
        let second_a = section
            .trial([0.0, 0.0, 0.0, 0.07, 0.0, 0.0], &branch_a)
            .unwrap();
        assert!(section
            .commit(&mut branch_b, &second_a)
            .unwrap_err()
            .contains("stale"));
    }

    #[test]
    fn small_nonzero_moment_is_not_accepted_at_zero_strain() {
        let section = PlateFiberSection::new(&[Layer {
            thickness_m: 0.2,
            e_mpa: 30_000.0,
            nu: 0.2,
            law: MaterialLaw::Elastic,
        }])
        .unwrap();
        let target = 1e-9;
        let solved = section
            .solve_bending_moments([target, 0.0, 0.0], &section.initial_state(), [0.0; 6])
            .unwrap();
        assert!(solved.iterations > 0);
        assert!((solved.trial.resultants[3] - target).abs() < 1e-8 * target);
        assert!(solved.generalized_strain[3] > 0.0);
    }

    #[test]
    fn homogeneous_elastic_bending_inverse_matches_closed_form_d() {
        let e = 30_000.0;
        let nu = 0.2;
        let h: f64 = 0.2;
        let section = PlateFiberSection::new(&[Layer {
            thickness_m: h,
            e_mpa: e,
            nu,
            law: MaterialLaw::Elastic,
        }])
        .unwrap();
        let moment = [10.0, -5.0, 2.0];
        let solved = section
            .solve_bending_moments(moment, &section.initial_state(), [0.0; 6])
            .unwrap();
        let d = e * 1000.0 * h.powi(3) / 12.0;
        let expected = [
            (moment[0] - nu * moment[1]) / d,
            (moment[1] - nu * moment[0]) / d,
            moment[2] * 2.0 * (1.0 + nu) / d,
        ];
        for i in 0..3 {
            assert!(solved.generalized_strain[i].abs() < 1e-12);
            assert!(
                (solved.generalized_strain[i + 3] - expected[i]).abs()
                    < 1e-10 * expected[i].abs().max(1.0)
            );
            assert!(solved.residual[i].abs() < 1e-8);
            assert!(solved.residual[i + 3].abs() < 1e-8);
        }
        assert_eq!(solved.iterations, 1);
        assert!(solved.scaled_residual_norm_kn < 1e-8);
    }

    fn solve_3_reference(mut a: [[f64; 3]; 3], mut b: [f64; 3]) -> [f64; 3] {
        for k in 0..3 {
            let pivot = (k..3)
                .max_by(|&i, &j| a[i][k].abs().total_cmp(&a[j][k].abs()))
                .unwrap();
            a.swap(k, pivot);
            b.swap(k, pivot);
            for i in (k + 1)..3 {
                let ratio = a[i][k] / a[k][k];
                for j in k..3 {
                    a[i][j] -= ratio * a[k][j];
                }
                b[i] -= ratio * b[k];
            }
        }
        let mut x = [0.0; 3];
        for i in (0..3).rev() {
            x[i] = (b[i] - ((i + 1)..3).map(|j| a[i][j] * x[j]).sum::<f64>()) / a[i][i];
        }
        x
    }

    #[test]
    fn asymmetric_elastic_inverse_enforces_zero_n_with_abd_schur_complement() {
        let layers = [
            Layer {
                thickness_m: 0.06,
                e_mpa: 210_000.0,
                nu: 0.30,
                law: MaterialLaw::Elastic,
            },
            Layer {
                thickness_m: 0.14,
                e_mpa: 70_000.0,
                nu: 0.20,
                law: MaterialLaw::Elastic,
            },
        ];
        let section = PlateFiberSection::new(&layers).unwrap();
        let target = [12.0, -4.0, 1.5];
        let solved = section
            .solve_bending_moments(target, &section.initial_state(), [0.0; 6])
            .unwrap();
        let (mut a, mut b, mut d) = ([[0.0; 3]; 3], [[0.0; 3]; 3], [[0.0; 3]; 3]);
        let mut bottom = -0.1;
        for layer in layers {
            let top = bottom + layer.thickness_m;
            let factors = [
                top - bottom,
                (top * top - bottom * bottom) / 2.0,
                (top.powi(3) - bottom.powi(3)) / 3.0,
            ];
            let q = elastic_q(layer.e_mpa, layer.nu);
            for i in 0..3 {
                for j in 0..3 {
                    a[i][j] += factors[0] * q[i][j];
                    b[i][j] += factors[1] * q[i][j];
                    d[i][j] += factors[2] * q[i][j];
                }
            }
            bottom = top;
        }
        let a_inv_b: [[f64; 3]; 3] = {
            let mut columns = [[0.0; 3]; 3];
            for j in 0..3 {
                let solution = solve_3_reference(a, std::array::from_fn(|i| b[i][j]));
                for i in 0..3 {
                    columns[i][j] = solution[i];
                }
            }
            columns
        };
        let effective: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| d[i][j] - (0..3).map(|k| b[i][k] * a_inv_b[k][j]).sum::<f64>())
        });
        let expected_curvature = solve_3_reference(effective, target);
        let expected_membrane: [f64; 3] = std::array::from_fn(|i| {
            -(0..3)
                .map(|j| a_inv_b[i][j] * expected_curvature[j])
                .sum::<f64>()
        });
        assert!(
            expected_membrane[0].abs() > 1e-7,
            "asymmetric B must shift the neutral surface"
        );
        for i in 0..3 {
            assert!(
                (solved.generalized_strain[i] - expected_membrane[i]).abs()
                    < 1e-9 * expected_membrane[i].abs().max(1.0)
            );
            assert!(
                (solved.generalized_strain[i + 3] - expected_curvature[i]).abs()
                    < 1e-9 * expected_curvature[i].abs().max(1.0)
            );
            assert!(solved.residual[i].abs() < 1e-7);
            assert!(solved.residual[i + 3].abs() < 1e-7);
        }
    }

    #[test]
    fn condensed_bending_tangent_matches_independent_asymmetric_abd_and_inverse_sensitivity() {
        let layers = [
            Layer {
                thickness_m: 0.06,
                e_mpa: 210_000.0,
                nu: 0.30,
                law: MaterialLaw::Elastic,
            },
            Layer {
                thickness_m: 0.14,
                e_mpa: 70_000.0,
                nu: 0.20,
                law: MaterialLaw::Elastic,
            },
        ];
        let section = PlateFiberSection::new(&layers).unwrap();
        let committed = section.initial_state();
        let target = [12.0, -4.0, 1.5];
        let base = section
            .solve_bending_moments(target, &committed, [0.0; 6])
            .unwrap();
        let effective = section.effective_bending_tangent(&base.trial).unwrap();

        // Integrate Q, zQ and z²Q from layer boundaries, independently of
        // the section's two-point thickness quadrature and tangent assembly.
        let (mut a, mut b, mut d) = ([[0.0; 3]; 3], [[0.0; 3]; 3], [[0.0; 3]; 3]);
        let mut bottom = -0.1;
        for layer in layers {
            let top = bottom + layer.thickness_m;
            let factors = [
                top - bottom,
                0.5 * (top * top - bottom * bottom),
                (top.powi(3) - bottom.powi(3)) / 3.0,
            ];
            let q = elastic_q(layer.e_mpa, layer.nu);
            for i in 0..3 {
                for j in 0..3 {
                    a[i][j] += factors[0] * q[i][j];
                    b[i][j] += factors[1] * q[i][j];
                    d[i][j] += factors[2] * q[i][j];
                }
            }
            bottom = top;
        }
        assert!(b[0][0].abs() > 1e5);
        let mut a_inv_b = [[0.0; 3]; 3];
        for j in 0..3 {
            let column = solve_3_reference(a, std::array::from_fn(|i| b[i][j]));
            for i in 0..3 {
                a_inv_b[i][j] = column[i];
            }
        }
        let reference: [[f64; 3]; 3] = std::array::from_fn(|i| {
            std::array::from_fn(|j| d[i][j] - (0..3).map(|k| b[i][k] * a_inv_b[k][j]).sum::<f64>())
        });
        for i in 0..3 {
            for j in 0..3 {
                assert!(
                    (effective[i][j] - reference[i][j]).abs()
                        < 2e-8 * reference[i][j].abs().max(1.0),
                    "condensed K[{i}][{j}]={} reference={}",
                    effective[i][j],
                    reference[i][j]
                );
            }
        }

        // At N=0, perturbing one prescribed moment gives dκ/dM=S⁻¹.
        // This exercises the inverse solver through actual trial resultants.
        let delta = 1e-4;
        for j in 0..3 {
            let mut plus_target = target;
            let mut minus_target = target;
            plus_target[j] += delta;
            minus_target[j] -= delta;
            let plus = section
                .solve_bending_moments(plus_target, &committed, base.generalized_strain)
                .unwrap();
            let minus = section
                .solve_bending_moments(minus_target, &committed, base.generalized_strain)
                .unwrap();
            let expected =
                solve_3_reference(reference, std::array::from_fn(|i| (i == j) as u8 as f64));
            for i in 0..3 {
                let measured = (plus.generalized_strain[i + 3] - minus.generalized_strain[i + 3])
                    / (2.0 * delta);
                assert!(
                    (measured - expected[i]).abs() < 2e-7 * expected[i].abs().max(1e-8),
                    "inverse dκ[{i}]/dM[{j}]={measured} expected={}",
                    expected[i]
                );
            }
        }
    }

    #[test]
    fn condensed_bending_tangent_rejects_other_section_and_unstable_full_tangent() {
        let layer = Layer {
            thickness_m: 0.2,
            e_mpa: 30_000.0,
            nu: 0.2,
            law: MaterialLaw::Elastic,
        };
        let section = PlateFiberSection::new(&[layer]).unwrap();
        let other = PlateFiberSection::new(&[layer]).unwrap();
        let trial = section.trial([0.0; 6], &section.initial_state()).unwrap();
        assert!(other
            .effective_bending_tangent(&trial)
            .unwrap_err()
            .contains("does not match"));
        let mut unstable = trial;
        unstable.tangent[3][3] = -unstable.tangent[3][3];
        assert!(section
            .effective_bending_tangent(&unstable)
            .unwrap_err()
            .contains("unstable"));
    }

    fn fine_steel_section_response(
        strain: [f64; 6],
        law: MaterialLaw,
        previous: &[MaterialState],
    ) -> ([f64; 6], Vec<MaterialState>) {
        let n = previous.len();
        let dz = 0.2 / n as f64;
        let mut resultants = [0.0; 6];
        let mut states = Vec::with_capacity(n);
        for (i, old) in previous.iter().enumerate() {
            let z = -0.1 + (i as f64 + 0.5) * dz;
            let point_strain = std::array::from_fn(|j| strain[j] + z * strain[j + 3]);
            let response = material2d::update(210_000.0, 0.3, law, point_strain, *old).unwrap();
            for j in 0..3 {
                resultants[j] += dz * response.stress[j];
                resultants[j + 3] += dz * z * response.stress[j];
            }
            states.push(response.state);
        }
        (resultants, states)
    }

    #[test]
    fn steel_bending_inverse_and_unloading_match_independent_fine_fibers() {
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 235.0,
            hardening_ratio: 0.02,
        };
        let section = PlateFiberSection::new(&vec![
            Layer {
                thickness_m: 0.2 / 512.0,
                e_mpa: 210_000.0,
                nu: 0.3,
                law,
            };
            512
        ])
        .unwrap();
        let known = [0.0, 0.0, 0.0, 0.06, -0.012, 0.003];
        let fine_initial = vec![MaterialState::default(); 8192];
        let (fine_known, _) = fine_steel_section_response(known, law, &fine_initial);
        let target = [fine_known[3], fine_known[4], fine_known[5]];
        assert!(target[0].abs() > 1.0);
        let mut committed = section.initial_state();
        let loaded = section
            .solve_bending_moments(target, &committed, [0.0; 6])
            .unwrap();
        assert!(
            loaded.iterations > 1,
            "plastic inverse should require Newton updates"
        );
        assert!(loaded
            .trial
            .state
            .fibers
            .iter()
            .any(|s| s.equivalent_plastic_strain > 0.0));
        assert!(committed
            .fibers
            .iter()
            .all(|s| s.equivalent_plastic_strain == 0.0));
        let (fine_loaded, fine_states) =
            fine_steel_section_response(loaded.generalized_strain, law, &fine_initial);
        let target_scale = target.iter().map(|v| v * v).sum::<f64>().sqrt();
        for i in 0..3 {
            assert!(
                fine_loaded[i].abs() * 0.2 < 5e-4 * target_scale,
                "fine N[{i}]={}",
                fine_loaded[i]
            );
            assert!(
                (fine_loaded[i + 3] - target[i]).abs() < 5e-4 * target_scale,
                "fine M[{i}]={}",
                fine_loaded[i + 3]
            );
        }
        section.commit(&mut committed, &loaded.trial).unwrap();
        let unloaded = section
            .solve_bending_moments([0.0; 3], &committed, [0.0; 6])
            .unwrap();
        assert!(unloaded.iterations > 0);
        assert!(unloaded.scaled_residual_norm_kn < 1e-7);
        let (fine_unloaded, _) =
            fine_steel_section_response(unloaded.generalized_strain, law, &fine_states);
        for i in 0..3 {
            assert!(
                fine_unloaded[i].abs() * 0.2 < 5e-4 * target_scale,
                "fine unloaded N[{i}]={}",
                fine_unloaded[i]
            );
            assert!(
                fine_unloaded[i + 3].abs() < 5e-4 * target_scale,
                "fine unloaded M[{i}]={}",
                fine_unloaded[i + 3]
            );
        }
        assert!(committed
            .fibers
            .iter()
            .any(|s| s.equivalent_plastic_strain > 0.0));
    }

    #[test]
    fn singular_and_unstable_section_tangents_are_rejected() {
        let zero = [[0.0; 6]; 6];
        assert!(solve_stable_section_tangent(&zero, &[1.0; 6], 0.2)
            .unwrap_err()
            .contains("singular"));
        let mut negative = [[0.0; 6]; 6];
        for (i, row) in negative.iter_mut().enumerate() {
            row[i] = 1.0;
        }
        negative[3][3] = -1.0;
        assert!(solve_stable_section_tangent(&negative, &[1.0; 6], 0.2)
            .unwrap_err()
            .contains("non-positive"));
    }
}
