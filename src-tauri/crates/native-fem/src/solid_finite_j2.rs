//! Experimental finite-strain, rate-independent J2 steel **material point**.
//!
//! This is a separate law from `solid_j2` (infinitesimal plasticity). The
//! specialization is the quadratic Hencky energy and the multiplicative
//! plastic-metric exponential return described by Ren, Rabczuk & Zhuang,
//! *Ductile fracture modeling by phase field, Hencky strain elasticity and
//! finite J2 plasticity*, arXiv:2302.13783, Eqs. (42)-(56), (62)-(63):
//! https://arxiv.org/pdf/2302.13783 . The multiplicative/return framework is
//! also due to Simo, CMAME 66 (1988), doi:10.1016/0045-7825(88)90076-X and
//! CMAME 68 (1988), doi:10.1016/0045-7825(88)90104-1.
//!
//! `F = Fe Fp`; `be = Fe Fe^T`; `e = 1/2 log(be)`. The reference-volume
//! energy is `W = kappa/2 (tr e)^2 + mu dev(e):dev(e)`, so Kirchhoff stress
//! `tau = kappa tr(e) I + 2 mu dev(e)` and first Piola `P = tau F^-T`.
//! Yield is `q = sqrt(3/2)||dev(tau)|| <= sigma_y + H alpha`; `alpha` is
//! accumulated equivalent plastic strain. Its radial return reduces `q` by
//! `3 mu delta_alpha`, with `delta_alpha = (q_trial - sigma_y - H alpha_n)
//! / (3 mu + H)`. The plastic metric is updated by the exponential map.
//!
//! The state stores a symmetric positive `Fp` representative of the plastic
//! metric `Cp = Fp^T Fp`. Plastic rotation is a gauge choice for this isotropic
//! law. `det(Fp) = 1` expresses isochoric plastic flow. `update` reads only a
//! committed state and returns a **trial** state. The caller must commit it
//! only after an accepted load step. `update_with_tangent` returns the
//! branch-consistent full `dP/dF` at fixed committed history. A global Tet4
//! integration and acceptance validation still remain separate work.

use serde::{Deserialize, Serialize};

pub type Tensor3 = [[f64; 3]; 3];
/// Row-major `dP_ij/dF_kl`: row `3*i+j`, column `3*k+l`, MPa.
pub type Tangent9 = [[f64; 9]; 9];

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiniteJ2Steel {
    pub youngs_mpa: f64,
    pub poisson: f64,
    pub yield_mpa: f64,
    /// `H = d(sigma_y)/d(alpha)`, MPa; same convention as `solid_j2`.
    pub hardening_mpa: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FiniteJ2State {
    /// Plastic deformation gradient in the symmetric positive gauge.
    pub fp: Tensor3,
    pub equivalent_plastic_strain: f64,
}

impl Default for FiniteJ2State {
    fn default() -> Self {
        Self {
            fp: identity(),
            equivalent_plastic_strain: 0.0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct FiniteJ2Update {
    /// Candidate history. The caller decides whether to commit it.
    pub state: FiniteJ2State,
    pub first_piola_mpa: Tensor3,
    pub kirchhoff_mpa: Tensor3,
    /// Recoverable elastic energy per unit reference volume, MPa.
    pub elastic_energy_mpa: f64,
    pub equivalent_plastic_increment: f64,
    pub von_mises_mpa: f64,
    pub yielded: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct FiniteJ2TangentUpdate {
    pub point: FiniteJ2Update,
    pub tangent_mpa: Tangent9,
}

impl FiniteJ2Steel {
    pub fn new(
        youngs_mpa: f64,
        poisson: f64,
        yield_mpa: f64,
        hardening_mpa: f64,
    ) -> Result<Self, String> {
        if !youngs_mpa.is_finite() || youngs_mpa <= 0.0 {
            return Err("finite J2 Young's modulus must be finite and positive".into());
        }
        if !poisson.is_finite() || poisson <= -1.0 || poisson >= 0.5 {
            return Err("finite J2 Poisson's ratio must be finite and in (-1, 0.5)".into());
        }
        if !yield_mpa.is_finite() || yield_mpa <= 0.0 {
            return Err("finite J2 yield stress must be finite and positive".into());
        }
        if !hardening_mpa.is_finite() || hardening_mpa < 0.0 {
            return Err("finite J2 hardening modulus must be finite and nonnegative".into());
        }
        Ok(Self {
            youngs_mpa,
            poisson,
            yield_mpa,
            hardening_mpa,
        })
    }

    pub fn shear_modulus_mpa(self) -> f64 {
        self.youngs_mpa / (2.0 * (1.0 + self.poisson))
    }

    pub fn bulk_modulus_mpa(self) -> f64 {
        self.youngs_mpa / (3.0 * (1.0 - 2.0 * self.poisson))
    }

    /// Update from the *committed* plastic state at a given total deformation
    /// gradient. Newton trials may call this repeatedly with the same state.
    pub fn update(
        self,
        committed: &FiniteJ2State,
        deformation_gradient: Tensor3,
    ) -> Result<FiniteJ2Update, String> {
        // Fields are public, so construction through `new` is not guaranteed.
        Self::new(
            self.youngs_mpa,
            self.poisson,
            self.yield_mpa,
            self.hardening_mpa,
        )?;
        validate_finite(&deformation_gradient, "deformation gradient")?;
        validate_finite(&committed.fp, "committed Fp")?;
        if !committed.equivalent_plastic_strain.is_finite()
            || committed.equivalent_plastic_strain < 0.0
        {
            return Err("finite J2 committed equivalent plastic strain must be nonnegative".into());
        }
        let det_f = determinant(&deformation_gradient);
        if !det_f.is_finite() || det_f <= 1e-12 {
            return Err("finite J2 requires a positive, nonsingular det(F)".into());
        }
        let det_fp = determinant(&committed.fp);
        if !det_fp.is_finite() || (det_fp - 1.0).abs() > 1e-6 {
            return Err("finite J2 committed Fp must be isochoric".into());
        }
        // This API fixes the otherwise arbitrary plastic rotation by storing
        // the symmetric positive square root of Cp. Reject history that does
        // not obey that gauge rather than silently changing its meaning.
        symmetric_function(&committed.fp, |eigen| eigen, true)?;
        let fp_inverse = inverse(&committed.fp)?;
        let fe_trial = multiply(&deformation_gradient, &fp_inverse);
        let be_trial = multiply(&fe_trial, &transpose(&fe_trial));
        let e_trial = symmetric_function(&be_trial, |eigen| 0.5 * eigen.ln(), true)?;
        let tr_e = trace(&e_trial);
        let mut dev_e = e_trial;
        for (i, row) in dev_e.iter_mut().enumerate() {
            row[i] -= tr_e / 3.0;
        }
        let mu = self.shear_modulus_mpa();
        let bulk = self.bulk_modulus_mpa();
        let mut trial_deviator = scale(&dev_e, 2.0 * mu);
        let q_trial = (1.5 * inner(&trial_deviator, &trial_deviator)).sqrt();
        let old_yield = self.yield_mpa + self.hardening_mpa * committed.equivalent_plastic_strain;
        if !q_trial.is_finite() || !old_yield.is_finite() {
            return Err("finite J2 trial yield values are non-finite".into());
        }
        let yielded = q_trial > old_yield + 1e-12 * q_trial.max(old_yield).max(1.0);
        let delta_alpha = if yielded {
            (q_trial - old_yield) / (3.0 * mu + self.hardening_mpa)
        } else {
            0.0
        };
        let mut state = *committed;
        let mut elastic_e = e_trial;
        if yielded {
            // Associated flow normal to q in the current principal frame.
            let flow_normal = scale(&trial_deviator, 1.5 / q_trial);
            elastic_e = subtract(&e_trial, &scale(&flow_normal, delta_alpha));
            // be_{n+1} = exp(-2 delta_alpha n) be_trial. Both symmetric
            // tensors commute for isotropic Hencky elasticity.
            let be_new = symmetric_function(&scale(&elastic_e, 2.0), f64::exp, false)?;
            let f_inverse = inverse(&deformation_gradient)?;
            let cp_inverse = multiply(&multiply(&f_inverse, &be_new), &transpose(&f_inverse));
            // Isotropic response depends on Cp, not plastic rotation. Choose
            // Fp=sqrt(Cp)=inverse(sqrt(Cp^-1)) as a fixed symmetric gauge.
            state.fp = symmetric_function(&cp_inverse, |eigen| 1.0 / eigen.sqrt(), true)?;
            state.equivalent_plastic_strain += delta_alpha;
            if !state.equivalent_plastic_strain.is_finite()
                || (determinant(&state.fp) - 1.0).abs() > 1e-7
            {
                return Err("finite J2 plastic metric lost isochoricity".into());
            }
        }
        let mean = bulk * trace(&elastic_e);
        let mut deviator = elastic_e;
        for (i, row) in deviator.iter_mut().enumerate() {
            row[i] -= trace(&elastic_e) / 3.0;
        }
        trial_deviator = scale(&deviator, 2.0 * mu);
        let mut tau = trial_deviator;
        for (i, row) in tau.iter_mut().enumerate() {
            row[i] += mean;
        }
        let p = multiply(&tau, &transpose(&inverse(&deformation_gradient)?));
        let energy = 0.5 * bulk * trace(&elastic_e).powi(2) + mu * inner(&deviator, &deviator);
        let q = (1.5 * inner(&trial_deviator, &trial_deviator)).sqrt();
        if !energy.is_finite() || !q.is_finite() || !all_finite(&tau) || !all_finite(&p) {
            return Err("finite J2 update produced non-finite output".into());
        }
        Ok(FiniteJ2Update {
            state,
            first_piola_mpa: p,
            kirchhoff_mpa: tau,
            elastic_energy_mpa: energy,
            equivalent_plastic_increment: delta_alpha,
            von_mises_mpa: q,
            yielded,
        })
    }

    /// Exact directional linearization of this material-point return map,
    /// holding `committed` fixed. The derivative is branch-specific and is
    /// undefined at the elastic/plastic switching surface.
    ///
    /// For `be = F Cp^-1 F^T`, `e = log(be)/2`, the spectral Fréchet
    /// derivative gives `de = L_log(be)[dbe]/2`. On the plastic branch,
    /// `dev(tau) = 2 mu r dev(e)` with
    /// `r = (H + 3 mu Y/q_trial)/(3 mu + H)` and constant `Y = sigma_y+H alpha_n`.
    /// Finally `dP = d(tau) F^-T - tau F^-T dF^T F^-T`.
    pub fn update_with_tangent(
        self,
        committed: &FiniteJ2State,
        deformation_gradient: Tensor3,
    ) -> Result<FiniteJ2TangentUpdate, String> {
        self.update_with_branch_tangent(committed, deformation_gradient, false)
    }

    /// Semismooth Newton choice at the yield switch. The classical derivative
    /// is undefined there, so this explicitly selects the branch used by
    /// `update`: elastic if the trial state has not yielded, plastic otherwise.
    /// Away from the switch it equals `update_with_tangent`. This is only a
    /// one-sided Newton Jacobian; `update_with_tangent` keeps its strict contract.
    pub fn update_with_one_sided_tangent(
        self,
        committed: &FiniteJ2State,
        deformation_gradient: Tensor3,
    ) -> Result<FiniteJ2TangentUpdate, String> {
        self.update_with_branch_tangent(committed, deformation_gradient, true)
    }

    fn update_with_branch_tangent(
        self,
        committed: &FiniteJ2State,
        deformation_gradient: Tensor3,
        allow_switch: bool,
    ) -> Result<FiniteJ2TangentUpdate, String> {
        let point = self.update(committed, deformation_gradient)?;
        let fp_inverse = inverse(&committed.fp)?;
        let fe = multiply(&deformation_gradient, &fp_inverse);
        let be = multiply(&fe, &transpose(&fe));
        let (eigenvalues, eigenvectors) = symmetric_eigen(&be, true)?;
        let e_trial = spectral_reconstruct(&eigenvalues, &eigenvectors, |x| 0.5 * x.ln())?;
        let tr_e = trace(&e_trial);
        let mut dev_e = e_trial;
        for (i, row) in dev_e.iter_mut().enumerate() {
            row[i] -= tr_e / 3.0;
        }
        let mu = self.shear_modulus_mpa();
        let bulk = self.bulk_modulus_mpa();
        let s_trial = scale(&dev_e, 2.0 * mu);
        let q_trial = (1.5 * inner(&s_trial, &s_trial)).sqrt();
        let old_yield = self.yield_mpa + self.hardening_mpa * committed.equivalent_plastic_strain;
        if !allow_switch && (q_trial - old_yield).abs() <= 1e-9 * q_trial.max(old_yield).max(1.0) {
            return Err("finite J2 tangent is undefined at the elastic/plastic switch".into());
        }
        let denominator = 3.0 * mu + self.hardening_mpa;
        let radial_factor = if point.yielded {
            (self.hardening_mpa + 3.0 * mu * old_yield / q_trial) / denominator
        } else {
            1.0
        };
        let f_inverse_t = transpose(&inverse(&deformation_gradient)?);
        let mut tangent = [[0.0; 9]; 9];
        for k in 0..3 {
            for l in 0..3 {
                let mut df = [[0.0; 3]; 3];
                df[k][l] = 1.0;
                let dfe = multiply(&df, &fp_inverse);
                let dbe_left = multiply(&dfe, &transpose(&fe));
                let dbe_right = transpose(&dbe_left);
                let dbe = add(&dbe_left, &dbe_right);
                let de = scale(&frechet_log(&eigenvalues, &eigenvectors, &dbe)?, 0.5);
                let dtrace = trace(&de);
                let mut ddev = de;
                for (i, row) in ddev.iter_mut().enumerate() {
                    row[i] -= dtrace / 3.0;
                }
                let dr = if point.yielded {
                    // dq = (3/2q) s:ds, where ds=2 mu dev(de).
                    let dq = 3.0 * mu * inner(&s_trial, &ddev) / q_trial;
                    -3.0 * mu * old_yield * dq / (denominator * q_trial * q_trial)
                } else {
                    0.0
                };
                let mut dtau = add(
                    &scale(&ddev, 2.0 * mu * radial_factor),
                    &scale(&dev_e, 2.0 * mu * dr),
                );
                for (i, row) in dtau.iter_mut().enumerate() {
                    row[i] += bulk * dtrace;
                }
                let dp_material = multiply(&dtau, &f_inverse_t);
                let dp_geometry = multiply(
                    &multiply(&point.first_piola_mpa, &transpose(&df)),
                    &f_inverse_t,
                );
                let dp = subtract(&dp_material, &dp_geometry);
                for i in 0..3 {
                    for j in 0..3 {
                        tangent[3 * i + j][3 * k + l] = dp[i][j];
                    }
                }
            }
        }
        if tangent.iter().flatten().any(|value| !value.is_finite()) {
            return Err("finite J2 tangent produced non-finite output".into());
        }
        Ok(FiniteJ2TangentUpdate {
            point,
            tangent_mpa: tangent,
        })
    }
}

fn identity() -> Tensor3 {
    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
}
fn trace(a: &Tensor3) -> f64 {
    a[0][0] + a[1][1] + a[2][2]
}
fn inner(a: &Tensor3, b: &Tensor3) -> f64 {
    (0..3)
        .flat_map(|i| (0..3).map(move |j| a[i][j] * b[i][j]))
        .sum()
}
fn determinant(a: &Tensor3) -> f64 {
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
}
fn inverse(a: &Tensor3) -> Result<Tensor3, String> {
    let det = determinant(a);
    if !det.is_finite() || det.abs() <= 1e-14 {
        return Err("finite J2 encountered a singular matrix".into());
    }
    let inv = [
        [
            (a[1][1] * a[2][2] - a[1][2] * a[2][1]) / det,
            (a[0][2] * a[2][1] - a[0][1] * a[2][2]) / det,
            (a[0][1] * a[1][2] - a[0][2] * a[1][1]) / det,
        ],
        [
            (a[1][2] * a[2][0] - a[1][0] * a[2][2]) / det,
            (a[0][0] * a[2][2] - a[0][2] * a[2][0]) / det,
            (a[0][2] * a[1][0] - a[0][0] * a[1][2]) / det,
        ],
        [
            (a[1][0] * a[2][1] - a[1][1] * a[2][0]) / det,
            (a[0][1] * a[2][0] - a[0][0] * a[2][1]) / det,
            (a[0][0] * a[1][1] - a[0][1] * a[1][0]) / det,
        ],
    ];
    validate_finite(&inv, "matrix inverse")?;
    Ok(inv)
}
fn transpose(a: &Tensor3) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[j][i]))
}
fn multiply(a: &Tensor3, b: &Tensor3) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| (0..3).map(|k| a[i][k] * b[k][j]).sum()))
}
fn scale(a: &Tensor3, factor: f64) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[i][j] * factor))
}
fn add(a: &Tensor3, b: &Tensor3) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[i][j] + b[i][j]))
}
fn subtract(a: &Tensor3, b: &Tensor3) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[i][j] - b[i][j]))
}
fn all_finite(a: &Tensor3) -> bool {
    a.iter().flatten().all(|v| v.is_finite())
}
fn validate_finite(a: &Tensor3, name: &str) -> Result<(), String> {
    if all_finite(a) {
        Ok(())
    } else {
        Err(format!("finite J2 {name} must be finite"))
    }
}

/// Symmetric 3x3 spectral matrix function. `positive` requires positive
/// eigenvalues for logarithms and inverse square roots of metric tensors;
/// exponential input may have either sign.
fn symmetric_function(
    a: &Tensor3,
    function: impl Fn(f64) -> f64,
    positive: bool,
) -> Result<Tensor3, String> {
    let (eigenvalues, eigenvectors) = symmetric_eigen(a, positive)?;
    spectral_reconstruct(&eigenvalues, &eigenvectors, function)
}

fn spectral_reconstruct(
    eigenvalues: &[f64; 3],
    eigenvectors: &Tensor3,
    function: impl Fn(f64) -> f64,
) -> Result<Tensor3, String> {
    let mut diagonal = [[0.0; 3]; 3];
    for i in 0..3 {
        diagonal[i][i] = function(eigenvalues[i]);
    }
    let result = multiply(&multiply(eigenvectors, &diagonal), &transpose(eigenvectors));
    validate_finite(&result, "spectral result")?;
    Ok(result)
}

fn symmetric_eigen(a: &Tensor3, positive: bool) -> Result<([f64; 3], Tensor3), String> {
    validate_finite(a, "spectral tensor")?;
    let scale = a.iter().flatten().fold(1.0_f64, |m, v| m.max(v.abs()));
    if (0..3).any(|i| (i + 1..3).any(|j| (a[i][j] - a[j][i]).abs() > 1e-10 * scale)) {
        return Err("finite J2 spectral tensor is not symmetric".into());
    }
    let mut matrix = *a;
    let mut vectors = identity();
    for _ in 0..64 {
        let (p, q) = [(0, 1), (0, 2), (1, 2)]
            .into_iter()
            .max_by(|&(i, j), &(k, l)| matrix[i][j].abs().total_cmp(&matrix[k][l].abs()))
            .unwrap();
        if matrix[p][q].abs() <= 1e-14 * scale {
            break;
        }
        let angle = 0.5 * (2.0 * matrix[p][q]).atan2(matrix[q][q] - matrix[p][p]);
        let (s, c) = angle.sin_cos();
        let mut rotation = identity();
        rotation[p][p] = c;
        rotation[q][q] = c;
        rotation[p][q] = s;
        rotation[q][p] = -s;
        matrix = multiply(&multiply(&transpose(&rotation), &matrix), &rotation);
        vectors = multiply(&vectors, &rotation);
    }
    let largest_off_diagonal = matrix[0][1]
        .abs()
        .max(matrix[0][2].abs())
        .max(matrix[1][2].abs());
    if largest_off_diagonal > 1e-12 * scale {
        return Err("finite J2 spectral decomposition did not converge".into());
    }
    let mut eigenvalues = [0.0; 3];
    for i in 0..3 {
        if !matrix[i][i].is_finite() || (positive && matrix[i][i] <= 0.0) {
            return Err("finite J2 spectral tensor has an invalid eigenvalue".into());
        }
        eigenvalues[i] = matrix[i][i];
    }
    Ok((eigenvalues, vectors))
}

/// Fréchet derivative `L_log(B)[E]` for symmetric positive `B`, expressed in
/// the eigenbasis of `B`. The divided-difference limit at repeated eigenvalues
/// is `1/lambda`; a short even series avoids cancellation near coincidence.
fn frechet_log(
    eigenvalues: &[f64; 3],
    vectors: &Tensor3,
    direction: &Tensor3,
) -> Result<Tensor3, String> {
    let local = multiply(&multiply(&transpose(vectors), direction), vectors);
    let mut image = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            let a = eigenvalues[i];
            let b = eigenvalues[j];
            let quotient = if i == j {
                1.0 / a
            } else {
                let z = (a - b) / (a + b);
                if z.abs() < 1e-4 {
                    2.0 / (a + b) * (1.0 + z * z / 3.0 + z.powi(4) / 5.0)
                } else {
                    (a.ln() - b.ln()) / (a - b)
                }
            };
            image[i][j] = quotient * local[i][j];
        }
    }
    let result = multiply(&multiply(vectors, &image), &transpose(vectors));
    validate_finite(&result, "matrix logarithm derivative")?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steel() -> FiniteJ2Steel {
        FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap()
    }
    fn near(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{actual} != {expected} (tol {tolerance})"
        );
    }

    #[test]
    fn identity_and_rigid_rotation_have_zero_energy_and_stress() {
        let state = FiniteJ2State::default();
        let initial = steel().update(&state, identity()).unwrap();
        near(initial.elastic_energy_mpa, 0.0, 1e-10);
        near(initial.von_mises_mpa, 0.0, 1e-9);
        let angle: f64 = 0.72;
        let (s, c) = angle.sin_cos();
        let rotation = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]];
        let rotated = steel().update(&state, rotation).unwrap();
        near(rotated.elastic_energy_mpa, 0.0, 1e-9);
        near(rotated.von_mises_mpa, 0.0, 1e-8);
        near(rotated.state.equivalent_plastic_strain, 0.0, 0.0);
        assert!(!rotated.yielded);
    }

    #[test]
    fn plastic_return_is_isochoric_and_history_is_transactional() {
        let committed = FiniteJ2State::default();
        let f = [[1.03, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        let trial = steel().update(&committed, f).unwrap();
        assert!(trial.yielded);
        assert!(trial.equivalent_plastic_increment > 0.0);
        near(determinant(&trial.state.fp), 1.0, 1e-8);
        near(
            trial.von_mises_mpa,
            steel().yield_mpa + steel().hardening_mpa * trial.state.equivalent_plastic_strain,
            1e-7,
        );
        assert_eq!(committed, FiniteJ2State::default());
        let retry = steel().update(&committed, f).unwrap();
        near(
            retry.state.equivalent_plastic_strain,
            trial.state.equivalent_plastic_strain,
            1e-12,
        );
        // F=Fp removes the elastic part exactly while retaining plastic strain.
        let unloaded = steel().update(&trial.state, trial.state.fp).unwrap();
        assert!(!unloaded.yielded);
        near(unloaded.von_mises_mpa, 0.0, 1e-8);
        near(
            unloaded.state.equivalent_plastic_strain,
            trial.state.equivalent_plastic_strain,
            0.0,
        );
    }

    #[test]
    fn hydrostatic_path_is_elastic_for_j2() {
        let update = steel()
            .update(
                &FiniteJ2State::default(),
                [[1.1, 0.0, 0.0], [0.0, 1.1, 0.0], [0.0, 0.0, 1.1]],
            )
            .unwrap();
        assert!(!update.yielded);
        near(update.von_mises_mpa, 0.0, 1e-7);
        near(
            update.kirchhoff_mpa[0][0],
            3.0 * steel().bulk_modulus_mpa() * 1.1_f64.ln(),
            1e-7,
        );
    }

    #[test]
    fn small_strain_plastic_limit_approaches_existing_j2_law() {
        let finite = FiniteJ2Steel::new(210_000.0, 0.3, 20.0, 2_000.0).unwrap();
        let infinitesimal = crate::solid_j2::J2Steel::new(210_000.0, 0.3, 20.0, 2_000.0)
            .unwrap()
            .update(
                &crate::solid_j2::J2State::default(),
                [[2.0e-4, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
            )
            .unwrap();
        let large = finite
            .update(
                &FiniteJ2State::default(),
                [[1.0002, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            )
            .unwrap();
        assert!(large.yielded && infinitesimal.yielded);
        for i in 0..3 {
            near(
                large.kirchhoff_mpa[i][i],
                infinitesimal.state.stress_mpa[i][i],
                0.01,
            );
        }
        near(
            large.state.equivalent_plastic_strain,
            infinitesimal.state.equivalent_plastic_strain,
            2e-8,
        );
    }

    #[test]
    fn superposed_rotation_rotates_plastic_stress_and_piola() {
        let state = FiniteJ2State::default();
        let f = [[1.04, 0.02, 0.0], [0.0, 0.98, 0.01], [0.0, 0.0, 0.99]];
        let base = steel().update(&state, f).unwrap();
        let angle: f64 = 0.43;
        let (s, c) = angle.sin_cos();
        let rotation = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]];
        let rotated = steel().update(&state, multiply(&rotation, &f)).unwrap();
        let expected_tau = multiply(
            &multiply(&rotation, &base.kirchhoff_mpa),
            &transpose(&rotation),
        );
        let expected_p = multiply(&rotation, &base.first_piola_mpa);
        for i in 0..3 {
            for j in 0..3 {
                near(rotated.kirchhoff_mpa[i][j], expected_tau[i][j], 1e-7);
                near(rotated.first_piola_mpa[i][j], expected_p[i][j], 1e-7);
                near(rotated.state.fp[i][j], base.state.fp[i][j], 1e-9);
            }
        }
        near(rotated.elastic_energy_mpa, base.elastic_energy_mpa, 1e-8);
        near(
            rotated.state.equivalent_plastic_strain,
            base.state.equivalent_plastic_strain,
            1e-11,
        );
    }

    #[test]
    fn rejects_inverted_gradient_and_nonisochoric_history() {
        assert!(steel()
            .update(
                &FiniteJ2State::default(),
                [[-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
            )
            .is_err());
        let bad = FiniteJ2State {
            fp: [[2.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            ..Default::default()
        };
        assert!(steel().update(&bad, identity()).is_err());
        let shear_fp = FiniteJ2State {
            fp: [[1.0, 0.1, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
            ..Default::default()
        };
        assert!(steel().update(&shear_fp, identity()).is_err());
        let indefinite_fp = FiniteJ2State {
            fp: [[-1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0]],
            ..Default::default()
        };
        assert!(steel().update(&indefinite_fp, identity()).is_err());
    }

    #[test]
    fn rejects_invalid_public_material_fields_at_update() {
        let state = FiniteJ2State::default();
        for invalid in [
            FiniteJ2Steel {
                youngs_mpa: 0.0,
                ..steel()
            },
            FiniteJ2Steel {
                poisson: 0.5,
                ..steel()
            },
            FiniteJ2Steel {
                yield_mpa: 0.0,
                ..steel()
            },
            FiniteJ2Steel {
                hardening_mpa: -1.0,
                ..steel()
            },
        ] {
            assert!(invalid.update(&state, identity()).is_err());
        }
    }

    fn check_all_tangent_components(state: &FiniteJ2State, f: Tensor3, expected_yielded: bool) {
        let material = steel();
        let result = material.update_with_tangent(state, f).unwrap();
        assert_eq!(result.point.yielded, expected_yielded);
        let step = 2e-7;
        for k in 0..3 {
            for l in 0..3 {
                let mut plus = f;
                let mut minus = f;
                plus[k][l] += step;
                minus[k][l] -= step;
                let p_plus = material.update(state, plus).unwrap().first_piola_mpa;
                let p_minus = material.update(state, minus).unwrap().first_piola_mpa;
                for i in 0..3 {
                    for j in 0..3 {
                        let analytic = result.tangent_mpa[3 * i + j][3 * k + l];
                        let numeric = (p_plus[i][j] - p_minus[i][j]) / (2.0 * step);
                        let tolerance = 0.05 + 2e-5 * analytic.abs().max(numeric.abs());
                        assert!((analytic-numeric).abs() <= tolerance,
                            "dP[{i},{j}]/dF[{k},{l}]: analytic {analytic}, finite difference {numeric}, tolerance {tolerance}");
                    }
                }
            }
        }
        // This associative, isotropic incremental response is work-conjugate
        // in the reference frame, so its nominal tangent has major symmetry.
        for a in 0..9 {
            for b in 0..9 {
                let ab = result.tangent_mpa[a][b];
                let ba = result.tangent_mpa[b][a];
                let tolerance = 1e-6 * ab.abs().max(ba.abs()).max(1.0);
                assert!(
                    (ab - ba).abs() <= tolerance,
                    "nominal tangent lacks major symmetry at {a},{b}: {ab} vs {ba}"
                );
            }
        }
    }

    #[test]
    fn full_tangent_matches_fd_on_elastic_and_plastic_branches() {
        let state = FiniteJ2State::default();
        check_all_tangent_components(&state, identity(), false);
        check_all_tangent_components(
            &state,
            [
                [1.0002, 0.0001, 0.0],
                [0.00002, 0.9999, 0.00004],
                [0.0, 0.0, 1.0001],
            ],
            false,
        );
        check_all_tangent_components(
            &state,
            [[1.04, 0.02, 0.004], [0.003, 0.98, 0.01], [0.0, 0.001, 0.99]],
            true,
        );
    }

    #[test]
    fn full_tangent_matches_fd_after_rotation_and_unloading() {
        let state = FiniteJ2State::default();
        let original = [[1.03, 0.012, 0.0], [0.0, 0.98, 0.006], [0.0, 0.0, 0.995]];
        let angle: f64 = 0.7;
        let (s, c) = angle.sin_cos();
        let rotation = [[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]];
        check_all_tangent_components(&state, multiply(&rotation, &original), true);
        let plastic = steel().update(&state, original).unwrap();
        check_all_tangent_components(&plastic.state, plastic.state.fp, false);
    }

    #[test]
    fn tangent_rejects_nondifferentiable_yield_switch() {
        let material = steel();
        let axial_log_strain = material.yield_mpa / (2.0 * material.shear_modulus_mpa());
        let f = [
            [axial_log_strain.exp(), 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ];
        assert!(material.update(&FiniteJ2State::default(), f).is_ok());
        assert!(material
            .update_with_tangent(&FiniteJ2State::default(), f)
            .is_err());
        let one_sided = material
            .update_with_one_sided_tangent(&FiniteJ2State::default(), f)
            .unwrap();
        let mut inward = f;
        let h = 1e-7;
        inward[0][0] -= h;
        let p_inward = material
            .update(&FiniteJ2State::default(), inward)
            .unwrap()
            .first_piola_mpa[0][0];
        let finite_difference = (one_sided.point.first_piola_mpa[0][0] - p_inward) / h;
        let elastic_derivative = one_sided.tangent_mpa[0][0];
        assert!((elastic_derivative - finite_difference).abs() / elastic_derivative.abs() < 1e-5);
    }
}
