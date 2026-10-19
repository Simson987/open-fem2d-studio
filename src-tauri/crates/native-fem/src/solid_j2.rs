//! Small-strain, rate-independent 3D J2 steel material point.
//!
//! Stresses and moduli are MPa; strains are dimensionless. The full 3x3 tensor
//! representation uses physical shear strains `epsilon_xy`, not engineering
//! shear `gamma_xy`. The update assumes a symmetric strain increment and keeps
//! committed stress, plastic strain and accumulated equivalent plastic strain.
//! It returns the branch-consistent algorithmic 6x6 tangent, but does not
//! implement a global Newton scheme or committed/trial history management.
//!
//! Reference: Sandia National Laboratories, LAMÉ Manual, §4.13, J2 Plasticity
//! Model, especially Eqs. (4.44) and the predictor/corrector in §4.13.2:
//! https://www.sandia.gov/files/sierra/SM_LAME_5_28/main/models/j2_plasticity.html
//! The same radial-return concept is described by Idaho National Laboratory's
//! MOOSE Radial Return Stress Update documentation:
//! https://mooseframework.inl.gov/source/materials/RadialReturnStressUpdate.html
//!
//! For linear isotropic hardening, q_y = sigma_y + H*p. From q_trial and shear
//! modulus G, consistency gives delta_p = (q_trial - q_y)/(3G + H). The plastic
//! flow direction is 3*s_trial/(2*q_trial), and the deviatoric stress is
//! reduced radially by 3G*delta_p. Hydrostatic stress remains elastic.

use serde::{Deserialize, Serialize};

pub type Tensor3 = [[f64; 3]; 3];
/// Rows: [sigma_xx, sigma_yy, sigma_zz, tau_xy, tau_yz, tau_zx]; columns:
/// [epsilon_xx, epsilon_yy, epsilon_zz, gamma_xy, gamma_yz, gamma_zx].
/// Engineering shear gamma_ij = 2*epsilon_ij is used only at this interface.
pub type Tangent6 = [[f64; 6]; 6];

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2Steel {
    pub youngs_mpa: f64,
    pub poisson: f64,
    pub yield_mpa: f64,
    /// H = d(yield stress)/d(equivalent plastic strain), in MPa.
    pub hardening_mpa: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct J2State {
    pub stress_mpa: Tensor3,
    pub plastic_strain: Tensor3,
    pub equivalent_plastic_strain: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct J2Update {
    pub state: J2State,
    pub yielded: bool,
    pub equivalent_plastic_increment: f64,
    pub von_mises_mpa: f64,
    /// Derivative of the returned stress with respect to this step's strain
    /// increment, holding the previous committed state fixed.
    pub algorithmic_tangent_mpa: Tangent6,
}

impl J2Steel {
    pub fn new(
        youngs_mpa: f64,
        poisson: f64,
        yield_mpa: f64,
        hardening_mpa: f64,
    ) -> Result<Self, String> {
        if !youngs_mpa.is_finite() || youngs_mpa <= 0.0 {
            return Err("J2 Young's modulus must be finite and positive".into());
        }
        if !poisson.is_finite() || poisson <= -1.0 || poisson >= 0.5 {
            return Err("J2 Poisson's ratio must be finite and between -1 and 0.5".into());
        }
        if !yield_mpa.is_finite() || yield_mpa <= 0.0 {
            return Err("J2 initial yield stress must be finite and positive".into());
        }
        if !hardening_mpa.is_finite() || hardening_mpa < 0.0 {
            return Err("J2 isotropic hardening modulus must be finite and nonnegative".into());
        }
        Ok(Self {
            youngs_mpa,
            poisson,
            yield_mpa,
            hardening_mpa,
        })
    }

    /// Construct from the measurable uniaxial post-yield tangent Et. For the
    /// model above Et = E*H/(E+H), hence H = E*Et/(E-Et).
    pub fn from_uniaxial_tangent(
        youngs_mpa: f64,
        poisson: f64,
        yield_mpa: f64,
        tangent_mpa: f64,
    ) -> Result<Self, String> {
        if !tangent_mpa.is_finite() || tangent_mpa < 0.0 || tangent_mpa >= youngs_mpa {
            return Err("J2 uniaxial tangent must be finite and in [0, E)".into());
        }
        let hardening_mpa = youngs_mpa * tangent_mpa / (youngs_mpa - tangent_mpa);
        Self::new(youngs_mpa, poisson, yield_mpa, hardening_mpa)
    }

    pub fn shear_modulus_mpa(self) -> f64 {
        self.youngs_mpa / (2.0 * (1.0 + self.poisson))
    }

    pub fn bulk_modulus_mpa(self) -> f64 {
        self.youngs_mpa / (3.0 * (1.0 - 2.0 * self.poisson))
    }

    /// Backward-Euler radial return from a committed state. The input is a
    /// *total* strain increment for this step; the previous plastic strain is
    /// retained in the returned state. Do not commit trial states from failed
    /// global Newton iterations.
    pub fn update(self, previous: &J2State, strain_increment: Tensor3) -> Result<J2Update, String> {
        validate_symmetric_finite(&strain_increment, "J2 strain increment")?;
        validate_symmetric_finite(&previous.stress_mpa, "J2 previous stress")?;
        validate_symmetric_finite(&previous.plastic_strain, "J2 previous plastic strain")?;
        if !previous.equivalent_plastic_strain.is_finite()
            || previous.equivalent_plastic_strain < 0.0
        {
            return Err("J2 previous equivalent plastic strain must be nonnegative".into());
        }
        let mu = self.shear_modulus_mpa();
        let lambda = self.bulk_modulus_mpa() - 2.0 * mu / 3.0;
        let trace_increment = trace(&strain_increment);
        let mut trial = previous.stress_mpa;
        for i in 0..3 {
            for j in 0..3 {
                trial[i][j] += 2.0 * mu * strain_increment[i][j];
                if i == j {
                    trial[i][j] += lambda * trace_increment;
                }
            }
        }
        if !finite_tensor(&trial) {
            return Err("J2 elastic trial stress is non-finite".into());
        }
        let mean = trace(&trial) / 3.0;
        let mut deviator = trial;
        for (i, row) in deviator.iter_mut().enumerate() {
            row[i] -= mean;
        }
        let q_trial = (1.5 * double_contract(&deviator, &deviator)).sqrt();
        let current_yield =
            self.yield_mpa + self.hardening_mpa * previous.equivalent_plastic_strain;
        if !q_trial.is_finite() || !current_yield.is_finite() {
            return Err("J2 trial invariant or yield stress is non-finite".into());
        }
        let yield_tolerance = 1e-12 * q_trial.max(current_yield).max(1.0);
        if q_trial <= current_yield + yield_tolerance {
            let mut state = *previous;
            state.stress_mpa = trial;
            return Ok(J2Update {
                state,
                yielded: false,
                equivalent_plastic_increment: 0.0,
                von_mises_mpa: q_trial,
                algorithmic_tangent_mpa: elastic_tangent(self.bulk_modulus_mpa(), mu),
            });
        }
        let delta_p = (q_trial - current_yield) / (3.0 * mu + self.hardening_mpa);
        // The positive form preserves a small nonzero hardening eigenvalue;
        // subtracting two nearly equal numbers can round the factor to zero.
        let radial_factor = (self.hardening_mpa + 3.0 * mu * current_yield / q_trial)
            / (3.0 * mu + self.hardening_mpa);
        if !delta_p.is_finite() || delta_p <= 0.0 || !radial_factor.is_finite() {
            return Err("J2 radial return produced invalid plastic multiplier".into());
        }
        let mut state = *previous;
        for i in 0..3 {
            for j in 0..3 {
                let flow = 1.5 * deviator[i][j] / q_trial;
                state.plastic_strain[i][j] += delta_p * flow;
                state.stress_mpa[i][j] = radial_factor * deviator[i][j];
                if i == j {
                    state.stress_mpa[i][j] += mean;
                }
            }
        }
        state.equivalent_plastic_strain += delta_p;
        if !finite_tensor(&state.stress_mpa)
            || !finite_tensor(&state.plastic_strain)
            || !state.equivalent_plastic_strain.is_finite()
        {
            return Err("J2 radial return produced non-finite history".into());
        }
        Ok(J2Update {
            state,
            yielded: true,
            equivalent_plastic_increment: delta_p,
            von_mises_mpa: von_mises(&state.stress_mpa),
            algorithmic_tangent_mpa: plastic_tangent(
                self.bulk_modulus_mpa(),
                mu,
                self.hardening_mpa,
                current_yield,
                q_trial,
                radial_factor,
                &deviator,
            ),
        })
    }
}

fn elastic_tangent(bulk: f64, mu: f64) -> Tangent6 {
    let lambda = bulk - 2.0 * mu / 3.0;
    let mut tangent = [[0.0; 6]; 6];
    for (row, values) in tangent.iter_mut().take(3).enumerate() {
        for (column, value) in values.iter_mut().take(3).enumerate() {
            *value = lambda + if row == column { 2.0 * mu } else { 0.0 };
        }
    }
    for (index, row) in tangent.iter_mut().enumerate().skip(3) {
        row[index] = mu;
    }
    tangent
}

/// Differentiate s_new = r(q_trial)*s_trial, with
/// r = 1 - 3G*(q_trial-Y_old)/[(3G+H)*q_trial].
/// The q derivative is 3G/q * (s_trial : d_epsilon), giving the last term.
fn plastic_tangent(
    bulk: f64,
    mu: f64,
    hardening: f64,
    old_yield: f64,
    q_trial: f64,
    radial_factor: f64,
    trial_deviator: &Tensor3,
) -> Tangent6 {
    let coefficient =
        9.0 * mu * mu * old_yield / ((3.0 * mu + hardening) * q_trial * q_trial * q_trial);
    let mut tangent = [[0.0; 6]; 6];
    for column in 0..6 {
        let basis = engineering_strain_basis(column);
        let volumetric = trace(&basis);
        let projection = double_contract(trial_deviator, &basis);
        let mut column_stress = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                let deviatoric_basis = basis[i][j] - if i == j { volumetric / 3.0 } else { 0.0 };
                column_stress[i][j] = 2.0 * mu * radial_factor * deviatoric_basis
                    - coefficient * trial_deviator[i][j] * projection;
                if i == j {
                    column_stress[i][j] += bulk * volumetric;
                }
            }
        }
        let stress_voigt = stress_voigt(&column_stress);
        for row in 0..6 {
            tangent[row][column] = stress_voigt[row];
        }
    }
    tangent
}

fn engineering_strain_basis(column: usize) -> Tensor3 {
    let mut strain = [[0.0; 3]; 3];
    if column < 3 {
        strain[column][column] = 1.0;
    } else {
        let (i, j) = match column {
            3 => (0, 1),
            4 => (1, 2),
            5 => (2, 0),
            _ => unreachable!("six engineering strain components"),
        };
        strain[i][j] = 0.5;
        strain[j][i] = 0.5;
    }
    strain
}

fn stress_voigt(stress: &Tensor3) -> [f64; 6] {
    [
        stress[0][0],
        stress[1][1],
        stress[2][2],
        stress[0][1],
        stress[1][2],
        stress[2][0],
    ]
}

pub fn von_mises(stress: &Tensor3) -> f64 {
    let mean = trace(stress) / 3.0;
    let mut deviator = *stress;
    for (i, row) in deviator.iter_mut().enumerate() {
        row[i] -= mean;
    }
    (1.5 * double_contract(&deviator, &deviator)).sqrt()
}

fn trace(tensor: &Tensor3) -> f64 {
    tensor[0][0] + tensor[1][1] + tensor[2][2]
}

fn double_contract(left: &Tensor3, right: &Tensor3) -> f64 {
    let mut sum = 0.0;
    for i in 0..3 {
        for j in 0..3 {
            sum += left[i][j] * right[i][j];
        }
    }
    sum
}

fn finite_tensor(tensor: &Tensor3) -> bool {
    tensor.iter().flatten().all(|value| value.is_finite())
}

fn validate_symmetric_finite(tensor: &Tensor3, name: &str) -> Result<(), String> {
    if !finite_tensor(tensor) {
        return Err(format!("{name} contains a non-finite component"));
    }
    for i in 0..3 {
        for j in (i + 1)..3 {
            let scale = tensor[i][j].abs().max(tensor[j][i].abs()).max(1.0);
            if (tensor[i][j] - tensor[j][i]).abs() > 1e-12 * scale {
                return Err(format!("{name} must be symmetric"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verify_all_tangent_columns(
        material: J2Steel,
        history: &J2State,
        increment: Tensor3,
        expected_plastic: bool,
    ) {
        let base = material.update(history, increment).unwrap();
        assert_eq!(base.yielded, expected_plastic);
        let step = 1e-7;
        for column in 0..6 {
            let mut plus = increment;
            let mut minus = increment;
            if column < 3 {
                plus[column][column] += step;
                minus[column][column] -= step;
            } else {
                let (i, j) = [(0, 1), (1, 2), (2, 0)][column - 3];
                // A unit engineering gamma changes each tensor shear by 1/2.
                plus[i][j] += step / 2.0;
                plus[j][i] += step / 2.0;
                minus[i][j] -= step / 2.0;
                minus[j][i] -= step / 2.0;
            }
            let high = material.update(history, plus).unwrap();
            let low = material.update(history, minus).unwrap();
            assert_eq!(high.yielded, expected_plastic);
            assert_eq!(low.yielded, expected_plastic);
            let high_stress = [
                high.state.stress_mpa[0][0],
                high.state.stress_mpa[1][1],
                high.state.stress_mpa[2][2],
                high.state.stress_mpa[0][1],
                high.state.stress_mpa[1][2],
                high.state.stress_mpa[2][0],
            ];
            let low_stress = [
                low.state.stress_mpa[0][0],
                low.state.stress_mpa[1][1],
                low.state.stress_mpa[2][2],
                low.state.stress_mpa[0][1],
                low.state.stress_mpa[1][2],
                low.state.stress_mpa[2][0],
            ];
            for row in 0..6 {
                let finite_difference = (high_stress[row] - low_stress[row]) / (2.0 * step);
                let analytic = base.algorithmic_tangent_mpa[row][column];
                let allowed = 1e-6 * material.youngs_mpa.max(analytic.abs());
                assert!(
                    (finite_difference - analytic).abs() < allowed,
                    "tangent [{row},{column}] analytic {analytic:.9e}, finite difference {finite_difference:.9e}"
                );
            }
        }
    }

    fn diagonal(xx: f64, yy: f64, zz: f64) -> Tensor3 {
        [[xx, 0.0, 0.0], [0.0, yy, 0.0], [0.0, 0.0, zz]]
    }

    fn close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "actual {actual:.12e}, expected {expected:.12e}"
        );
    }

    #[test]
    fn uniaxial_elastic_then_bilinear_plastic_matches_closed_form() {
        let e = 200_000.0;
        let nu = 0.3;
        let sy = 250.0;
        let h = 2_000.0;
        let material = J2Steel::new(e, nu, sy, h).unwrap();
        let elastic_eps = 0.0005;
        let elastic_sigma = e * elastic_eps;
        let elastic = material
            .update(
                &J2State::default(),
                diagonal(elastic_eps, -nu * elastic_eps, -nu * elastic_eps),
            )
            .unwrap();
        assert!(!elastic.yielded);
        close(elastic.state.stress_mpa[0][0], elastic_sigma, 1e-10);
        close(elastic.state.stress_mpa[1][1], 0.0, 1e-10);

        // Independent 1D balance: sigma=E(eps-p)=sy+H*p.
        let final_eps = 0.004;
        let p = (e * final_eps - sy) / (e + h);
        let sigma = sy + h * p;
        let lateral = -nu * sigma / e - p / 2.0;
        let previous_lateral = -nu * elastic_eps;
        let plastic = material
            .update(
                &elastic.state,
                diagonal(
                    final_eps - elastic_eps,
                    lateral - previous_lateral,
                    lateral - previous_lateral,
                ),
            )
            .unwrap();
        assert!(plastic.yielded);
        close(plastic.state.stress_mpa[0][0], sigma, 1e-9);
        close(plastic.state.stress_mpa[1][1], 0.0, 1e-9);
        close(plastic.state.stress_mpa[2][2], 0.0, 1e-9);
        close(plastic.state.equivalent_plastic_strain, p, 1e-13);
        close(plastic.state.plastic_strain[0][0], p, 1e-13);
        close(plastic.state.plastic_strain[1][1], -p / 2.0, 1e-13);
        close(plastic.von_mises_mpa, sy + h * p, 1e-9);
    }

    #[test]
    fn uniaxial_unloading_is_elastic_and_keeps_history() {
        let e = 200_000.0;
        let nu = 0.3;
        let sy = 250.0;
        let h = 2_000.0;
        let material = J2Steel::new(e, nu, sy, h).unwrap();
        let peak_eps = 0.004;
        let p = (e * peak_eps - sy) / (e + h);
        let peak_sigma = sy + h * p;
        let peak_lateral = -nu * peak_sigma / e - p / 2.0;
        let peak = material
            .update(
                &J2State::default(),
                diagonal(peak_eps, peak_lateral, peak_lateral),
            )
            .unwrap();
        let unload_eps = 0.0035;
        let unload_sigma = e * (unload_eps - p);
        let unload_lateral = -nu * unload_sigma / e - p / 2.0;
        let unloaded = material
            .update(
                &peak.state,
                diagonal(
                    unload_eps - peak_eps,
                    unload_lateral - peak_lateral,
                    unload_lateral - peak_lateral,
                ),
            )
            .unwrap();
        assert!(!unloaded.yielded);
        close(unloaded.state.stress_mpa[0][0], unload_sigma, 1e-9);
        close(unloaded.state.stress_mpa[1][1], 0.0, 1e-9);
        close(unloaded.state.equivalent_plastic_strain, p, 1e-13);
        close(unloaded.state.plastic_strain[0][0], p, 1e-13);
    }

    #[test]
    fn hydrostatic_strain_remains_elastic_far_above_uniaxial_yield_pressure() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let hydro = material
            .update(&J2State::default(), diagonal(0.01, 0.01, 0.01))
            .unwrap();
        let pressure = 3.0 * material.bulk_modulus_mpa() * 0.01;
        assert!(!hydro.yielded);
        for axis in 0..3 {
            close(hydro.state.stress_mpa[axis][axis], pressure, 1e-9);
        }
        close(hydro.von_mises_mpa, 0.0, 1e-9);
        close(hydro.state.equivalent_plastic_strain, 0.0, 0.0);
    }

    #[test]
    fn pure_shear_uses_physical_tensor_strain_and_sqrt_three_yield() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let physical_shear = 0.003;
        let mut strain = [[0.0; 3]; 3];
        strain[0][1] = physical_shear;
        strain[1][0] = physical_shear;
        let result = material.update(&J2State::default(), strain).unwrap();
        assert!(result.yielded);
        let mu = material.shear_modulus_mpa();
        let q_trial = 3.0_f64.sqrt() * 2.0 * mu * physical_shear;
        let p = (q_trial - material.yield_mpa) / (3.0 * mu + material.hardening_mpa);
        let expected_shear_stress =
            (material.yield_mpa + material.hardening_mpa * p) / 3.0_f64.sqrt();
        close(result.state.stress_mpa[0][1], expected_shear_stress, 1e-10);
        close(result.state.stress_mpa[1][0], expected_shear_stress, 1e-10);
        close(
            result.state.plastic_strain[0][1],
            3.0_f64.sqrt() * p / 2.0,
            1e-13,
        );
        close(
            result.von_mises_mpa,
            3.0_f64.sqrt() * expected_shear_stress,
            1e-10,
        );
    }

    #[test]
    fn uniaxial_tangent_constructor_uses_distinct_plastic_modulus() {
        let material = J2Steel::from_uniaxial_tangent(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let expected_h = 200_000.0 * 2_000.0 / 198_000.0;
        close(material.hardening_mpa, expected_h, 1e-10);
        let actual_tangent = material.youngs_mpa * material.hardening_mpa
            / (material.youngs_mpa + material.hardening_mpa);
        close(actual_tangent, 2_000.0, 1e-10);
    }

    #[test]
    fn invalid_or_asymmetric_strain_is_rejected() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 0.0).unwrap();
        let mut asymmetric = [[0.0; 3]; 3];
        asymmetric[0][1] = 0.01;
        assert!(material
            .update(&J2State::default(), asymmetric)
            .unwrap_err()
            .contains("symmetric"));
        assert!(J2Steel::new(200_000.0, 0.5, 250.0, 0.0).is_err());
    }

    #[test]
    fn elastic_tangent_matches_hooke_and_all_finite_difference_columns() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut increment = diagonal(0.0002, -0.0001, 0.00005);
        increment[0][1] = 0.00003;
        increment[1][0] = 0.00003;
        let result = material.update(&J2State::default(), increment).unwrap();
        let mu = material.shear_modulus_mpa();
        let lambda = material.bulk_modulus_mpa() - 2.0 * mu / 3.0;
        close(
            result.algorithmic_tangent_mpa[0][0],
            lambda + 2.0 * mu,
            1e-10,
        );
        close(result.algorithmic_tangent_mpa[0][1], lambda, 1e-10);
        close(result.algorithmic_tangent_mpa[3][3], mu, 1e-10);
        verify_all_tangent_columns(material, &J2State::default(), increment, false);
    }

    #[test]
    fn plastic_tangent_matches_finite_differences_in_all_six_directions() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let mut increment = diagonal(0.004, -0.001, 0.0003);
        increment[0][1] = 0.0005;
        increment[1][0] = 0.0005;
        increment[1][2] = -0.0003;
        increment[2][1] = -0.0003;
        increment[2][0] = 0.0002;
        increment[0][2] = 0.0002;
        verify_all_tangent_columns(material, &J2State::default(), increment, true);
        let tangent = material
            .update(&J2State::default(), increment)
            .unwrap()
            .algorithmic_tangent_mpa;
        for row in 0..6 {
            for col in 0..6 {
                close(tangent[row][col], tangent[col][row], 1e-9);
            }
        }
    }

    #[test]
    fn unloading_tangent_returns_to_elastic_hooke_slope() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let plastic = material
            .update(&J2State::default(), diagonal(0.004, -0.0015, -0.0015))
            .unwrap();
        assert!(plastic.yielded);
        let unload = diagonal(-0.0004, 0.00012, 0.00012);
        verify_all_tangent_columns(material, &plastic.state, unload, false);
    }

    #[test]
    fn reloading_tangent_accounts_for_existing_isotropic_hardening() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
        let first = material
            .update(&J2State::default(), diagonal(0.004, -0.0015, -0.0015))
            .unwrap();
        assert!(first.yielded);
        verify_all_tangent_columns(
            material,
            &first.state,
            diagonal(0.001, -0.0003, -0.0003),
            true,
        );
    }

    #[test]
    fn perfect_plasticity_tangent_matches_finite_differences() {
        let material = J2Steel::new(200_000.0, 0.3, 250.0, 0.0).unwrap();
        verify_all_tangent_columns(
            material,
            &J2State::default(),
            diagonal(0.004, -0.0012, -0.0012),
            true,
        );
    }
}
