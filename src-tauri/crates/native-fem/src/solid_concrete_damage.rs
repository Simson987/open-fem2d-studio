//! Experimental small-strain, 3D *tensile-only* scalar damage at one material
//! point. This is a Rankine effective-stress criterion with exponential
//! softening and unilateral stress recovery in compression. It is deliberately
//! narrower than a complete concrete damage/plasticity law.
//!
//! Basis: COMSOL Structural Mechanics, "Damage Models", strain-based Rankine
//! stress criterion, history variable, exponential softening, and positive/
//! negative effective-stress split:
//! <https://doc.comsol.com/6.3/doc/com.comsol.help.sme/sme_ug_theory.06.036.html>
//! The explicit crack-band energy relation for this exponential law is in
//! COMSOL Structural Mechanics Module User's Guide 5.6, equations (3-100)
//! and (3-101):
//! <https://doc.comsol.com/5.6/doc/com.comsol.help.sme/StructuralMechanicsModuleUsersGuide.pdf>.
//! The original Mazars concrete model and its separate tensile/compressive
//! damage modes are documented at
//! <https://biba1632.gitlab.io/code-aster-manuals/docs/reference/r7.01.08.html>.
//!
//! Stress and modulus are MPa; strains are dimensionless. Voigt strain uses
//! engineering shear `[exx, eyy, ezz, gamma_xy, gamma_yz, gamma_zx]`; stress
//! uses `[sxx, syy, szz, txy, tyz, tzx]`. `evaluate` is a pure trial update;
//! callers commit `next_state` only after their nonlinear equilibrium step is
//! accepted. The returned matrix is a *frozen-damage, frozen-projector secant*
//! that reproduces the current stress. It is not a consistent Newton tangent.
//!
//! Limitations: no compressive crushing/plasticity, crack closure hysteresis,
//! automatic crack-band length for arbitrary Tet4 shape/orientation, nonlocal
//! length, or multiaxial experimental calibration. `from_fracture_energy`
//! regularizes only the uniaxial monotonic tensile energy for a *caller-supplied*
//! localization width. It does not establish mesh objectivity for a general 3D
//! structure. This law is not a validated structural concrete design model.

#[derive(Clone, Copy, Debug)]
pub struct TensionDamageMaterial {
    pub e_mpa: f64,
    pub poisson: f64,
    pub tensile_strength_mpa: f64,
    /// Characteristic strain increment in the post-peak exponential law.
    /// Use `from_fracture_energy` to calibrate this to a caller-selected
    /// crack-band width; direct values have no spatial regularization.
    pub softening_strain: f64,
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TensionDamageState {
    /// Maximum positive effective principal stress divided by E ever reached.
    pub max_equivalent_strain: f64,
}

#[derive(Clone, Debug)]
pub struct TensionDamageResponse {
    pub stress_mpa: [f64; 6],
    /// Current trial equivalent strain, before taking the history maximum.
    pub equivalent_strain: f64,
    pub damage: f64,
    pub next_state: TensionDamageState,
    /// Fixed-damage and fixed-positive-stress-projector secant, in MPa.
    pub secant_mpa: [[f64; 6]; 6],
}

impl TensionDamageMaterial {
    /// Calibrate exponential post-peak softening to fracture energy per crack
    /// area for a specified crack-band width. `Gf` is N/m, `h` is m, while E
    /// and tensile strength are MPa. The full monotonic uniaxial work is
    /// `h ∫σ dε = Gf`, including the triangular elastic pre-peak work:
    ///
    /// `softening_strain = Gf/(h ft) - ft/(2E)` (with SI/MPa conversion).
    ///
    /// This is COMSOL 5.6 eqs. (3-100)–(3-101), rearranged because this API
    /// stores the *exponential denominator* directly. A non-positive result
    /// indicates a band too wide for a descending local stress–strain branch;
    /// it is rejected rather than silently creating snapback or negative
    /// dissipation. The caller must choose `h` from the FE discretization and
    /// crack orientation; this function cannot infer it from volume alone.
    pub fn from_fracture_energy(
        e_mpa: f64,
        poisson: f64,
        tensile_strength_mpa: f64,
        fracture_energy_n_per_m: f64,
        characteristic_length_m: f64,
    ) -> Result<Self, String> {
        if !fracture_energy_n_per_m.is_finite() || fracture_energy_n_per_m <= 0.0 {
            return Err("concrete fracture energy must be finite and positive".into());
        }
        if !characteristic_length_m.is_finite() || characteristic_length_m <= 0.0 {
            return Err("concrete crack-band length must be finite and positive".into());
        }
        // Validate elastic/strength inputs before their ratios are formed.
        let mut material = Self {
            e_mpa,
            poisson,
            tensile_strength_mpa,
            softening_strain: 1.0,
        };
        material.validate()?;
        let threshold = tensile_strength_mpa / e_mpa;
        let energy_density_mpa = 1e-6 * fracture_energy_n_per_m / characteristic_length_m;
        let softening_strain = energy_density_mpa / tensile_strength_mpa - 0.5 * threshold;
        if !softening_strain.is_finite() || softening_strain <= 0.0 {
            return Err(
                "concrete crack-band length exceeds the admissible energy/softening limit".into(),
            );
        }
        material.softening_strain = softening_strain;
        material.validate()?;
        Ok(material)
    }

    pub fn validate(self) -> Result<(), String> {
        if !self.e_mpa.is_finite() || self.e_mpa <= 0.0 {
            return Err("concrete tensile damage E must be finite and positive".into());
        }
        if !self.poisson.is_finite() || self.poisson <= -1.0 || self.poisson >= 0.5 {
            return Err("concrete tensile damage Poisson ratio must lie in (-1, 0.5)".into());
        }
        if !self.tensile_strength_mpa.is_finite() || self.tensile_strength_mpa <= 0.0 {
            return Err("concrete tensile strength must be finite and positive".into());
        }
        if !self.softening_strain.is_finite() || self.softening_strain <= 0.0 {
            return Err("concrete softening strain must be finite and positive".into());
        }
        let threshold = self.tensile_strength_mpa / self.e_mpa;
        if !threshold.is_finite() || threshold <= 0.0 {
            return Err("concrete tensile threshold is not representable".into());
        }
        Ok(())
    }

    pub fn evaluate(
        self,
        strain: [f64; 6],
        state: TensionDamageState,
    ) -> Result<TensionDamageResponse, String> {
        self.validate()?;
        if strain.iter().any(|value| !value.is_finite())
            || !state.max_equivalent_strain.is_finite()
            || state.max_equivalent_strain < 0.0
        {
            return Err("non-finite concrete strain or invalid damage history".into());
        }
        let elastic = elastic_matrix(self.e_mpa, self.poisson);
        let effective = matvec(&elastic, &strain);
        if effective.iter().any(|value| !value.is_finite()) {
            return Err("non-finite effective concrete stress".into());
        }
        let (principal, directions) = symmetric_eigen(stress_tensor(effective));
        let equivalent_strain = principal.iter().copied().fold(0.0_f64, f64::max) / self.e_mpa;
        let next_state = TensionDamageState {
            max_equivalent_strain: state.max_equivalent_strain.max(equivalent_strain),
        };
        let threshold = self.tensile_strength_mpa / self.e_mpa;
        let kappa = next_state.max_equivalent_strain;
        let damage = if kappa <= threshold {
            0.0
        } else {
            1.0 - threshold / kappa * (-(kappa - threshold) / self.softening_strain).exp()
        };
        if !damage.is_finite() || !(0.0..=1.0).contains(&damage) {
            return Err("non-finite concrete tensile damage".into());
        }

        // P+ freezes the principal directions and selects only positive
        // effective principal stresses. C_sec=(I-d P+)C, so C_sec*strain is
        // exactly the split stress at this trial point, without a numerical
        // differentiation of the nonsmooth spectral projection.
        let mut secant_mpa = elastic;
        for column in 0..6 {
            let effective_column = std::array::from_fn(|row| elastic[row][column]);
            let positive =
                project_positive_principal(stress_tensor(effective_column), principal, directions);
            let positive_voigt = stress_voigt(positive);
            for row in 0..6 {
                secant_mpa[row][column] -= damage * positive_voigt[row];
            }
        }
        let stress_mpa = matvec(&secant_mpa, &strain);
        if stress_mpa.iter().any(|value| !value.is_finite()) {
            return Err("non-finite damaged concrete stress".into());
        }
        Ok(TensionDamageResponse {
            stress_mpa,
            equivalent_strain,
            damage,
            next_state,
            secant_mpa,
        })
    }
}

fn elastic_matrix(e: f64, nu: f64) -> [[f64; 6]; 6] {
    let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mu = e / (2.0 * (1.0 + nu));
    let mut c = [[0.0; 6]; 6];
    for row in 0..3 {
        for column in 0..3 {
            c[row][column] = lambda + if row == column { 2.0 * mu } else { 0.0 };
        }
    }
    for a in 3..6 {
        c[a][a] = mu;
    }
    c
}

fn matvec(matrix: &[[f64; 6]; 6], vector: &[f64; 6]) -> [f64; 6] {
    std::array::from_fn(|row| {
        (0..6)
            .map(|column| matrix[row][column] * vector[column])
            .sum()
    })
}

fn stress_tensor(s: [f64; 6]) -> [[f64; 3]; 3] {
    [[s[0], s[3], s[5]], [s[3], s[1], s[4]], [s[5], s[4], s[2]]]
}

fn stress_voigt(s: [[f64; 3]; 3]) -> [f64; 6] {
    [s[0][0], s[1][1], s[2][2], s[0][1], s[1][2], s[2][0]]
}

/// Jacobi eigensolver for a real symmetric 3×3 tensor. Eigenvectors are
/// columns of the returned matrix. The stress split is insensitive to their
/// ordering and to sign flips of individual eigenvectors.
fn symmetric_eigen(mut a: [[f64; 3]; 3]) -> ([f64; 3], [[f64; 3]; 3]) {
    let mut v = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for _ in 0..64 {
        let pairs = [(0, 1), (1, 2), (0, 2)];
        let &(p, q) = pairs
            .iter()
            .max_by(|&&(a0, b0), &&(a1, b1)| a[a0][b0].abs().total_cmp(&a[a1][b1].abs()))
            .unwrap();
        let scale = a
            .iter()
            .flat_map(|row| row.iter())
            .map(|value| value.abs())
            .fold(0.0_f64, f64::max);
        if scale == 0.0 || a[p][q].abs() <= 1e-14 * scale {
            break;
        }
        let tau = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
        let t = if tau >= 0.0 {
            1.0 / (tau + (1.0 + tau * tau).sqrt())
        } else {
            -1.0 / (-tau + (1.0 + tau * tau).sqrt())
        };
        let c = 1.0 / (1.0 + t * t).sqrt();
        let s = t * c;
        let app = a[p][p];
        let aqq = a[q][q];
        let apq = a[p][q];
        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0.0;
        a[q][p] = 0.0;
        for r in 0..3 {
            if r != p && r != q {
                let arp = a[r][p];
                let arq = a[r][q];
                a[r][p] = c * arp - s * arq;
                a[p][r] = a[r][p];
                a[r][q] = s * arp + c * arq;
                a[q][r] = a[r][q];
            }
            let vrp = v[r][p];
            let vrq = v[r][q];
            v[r][p] = c * vrp - s * vrq;
            v[r][q] = s * vrp + c * vrq;
        }
    }
    ([a[0][0], a[1][1], a[2][2]], v)
}

fn project_positive_principal(
    tensor: [[f64; 3]; 3],
    principal: [f64; 3],
    directions: [[f64; 3]; 3],
) -> [[f64; 3]; 3] {
    let mut projected = [[0.0; 3]; 3];
    for axis in 0..3 {
        if principal[axis] <= 0.0 {
            continue;
        }
        let n = std::array::from_fn::<_, 3, _>(|a| directions[a][axis]);
        let scalar: f64 = (0..3)
            .flat_map(|a| (0..3).map(move |b| n[a] * tensor[a][b] * n[b]))
            .sum();
        for a in 0..3 {
            for b in 0..3 {
                projected[a][b] += scalar * n[a] * n[b];
            }
        }
    }
    projected
}

#[cfg(test)]
mod tests {
    use super::{matvec, TensionDamageMaterial, TensionDamageState};

    fn material() -> TensionDamageMaterial {
        TensionDamageMaterial {
            e_mpa: 30_000.0,
            poisson: 0.2,
            tensile_strength_mpa: 3.0,
            softening_strain: 0.0002,
        }
    }

    fn uniaxial_strain(axial: f64) -> [f64; 6] {
        [
            axial,
            -material().poisson * axial,
            -material().poisson * axial,
            0.0,
            0.0,
            0.0,
        ]
    }

    fn near(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
        );
    }

    #[test]
    fn uniaxial_tension_has_analytical_peak_and_exponential_softening() {
        let m = material();
        let threshold = m.tensile_strength_mpa / m.e_mpa;
        let peak = m
            .evaluate(uniaxial_strain(threshold), TensionDamageState::default())
            .unwrap();
        near(peak.stress_mpa[0], m.tensile_strength_mpa, 1e-12);
        near(peak.damage, 0.0, 1e-14);
        let axial = threshold + m.softening_strain;
        let softened = m.evaluate(uniaxial_strain(axial), peak.next_state).unwrap();
        near(
            softened.stress_mpa[0],
            m.tensile_strength_mpa / std::f64::consts::E,
            1e-11,
        );
        assert!(softened.damage > 0.0);
        for component in 1..6 {
            near(softened.stress_mpa[component], 0.0, 1e-11);
        }
        let from_secant = matvec(&softened.secant_mpa, &uniaxial_strain(axial));
        for component in 0..6 {
            near(
                from_secant[component],
                softened.stress_mpa[component],
                1e-12,
            );
        }
    }

    #[test]
    fn uniaxial_compression_does_not_create_damage_and_recovers_after_tension() {
        let m = material();
        let axial = -0.0005;
        let virgin = m
            .evaluate(uniaxial_strain(axial), TensionDamageState::default())
            .unwrap();
        near(virgin.stress_mpa[0], m.e_mpa * axial, 1e-11);
        near(virgin.damage, 0.0, 1e-14);
        near(virgin.equivalent_strain, 0.0, 1e-14);
        let cracked = m
            .evaluate(uniaxial_strain(0.0005), TensionDamageState::default())
            .unwrap();
        let closed = m
            .evaluate(uniaxial_strain(axial), cracked.next_state)
            .unwrap();
        near(closed.stress_mpa[0], m.e_mpa * axial, 1e-11);
        near(
            closed.next_state.max_equivalent_strain,
            cracked.next_state.max_equivalent_strain,
            1e-14,
        );
        assert!(closed.damage > 0.0);
    }

    #[test]
    fn unloading_and_reloading_retain_irreversible_peak_history() {
        let m = material();
        let peak_strain = 0.0004;
        let peak = m
            .evaluate(uniaxial_strain(peak_strain), TensionDamageState::default())
            .unwrap();
        let half = m
            .evaluate(uniaxial_strain(peak_strain / 2.0), peak.next_state)
            .unwrap();
        near(half.damage, peak.damage, 1e-14);
        near(half.stress_mpa[0], 0.5 * peak.stress_mpa[0], 1e-11);
        let reload = m
            .evaluate(uniaxial_strain(peak_strain), half.next_state)
            .unwrap();
        near(reload.damage, peak.damage, 1e-14);
        near(reload.stress_mpa[0], peak.stress_mpa[0], 1e-11);
        let beyond = m
            .evaluate(uniaxial_strain(1.2 * peak_strain), reload.next_state)
            .unwrap();
        assert!(beyond.damage > peak.damage);
        assert!(beyond.next_state.max_equivalent_strain > reload.next_state.max_equivalent_strain);
    }

    #[test]
    fn three_dimensional_shear_projection_is_finite_and_secant_reproduces_stress() {
        let m = material();
        let strain = [0.0002, -0.0001, 0.00003, 0.0003, -0.0002, 0.0001];
        let response = m.evaluate(strain, TensionDamageState::default()).unwrap();
        assert!(response.damage > 0.0);
        let mapped = matvec(&response.secant_mpa, &strain);
        for component in 0..6 {
            near(mapped[component], response.stress_mpa[component], 1e-11);
        }
        assert!(response.stress_mpa.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn pure_shear_matches_independent_principal_stress_split() {
        let m = material();
        let gamma_xy = 0.0004;
        let tau = m.e_mpa * gamma_xy / (2.0 * (1.0 + m.poisson));
        let response = m
            .evaluate(
                [0.0, 0.0, 0.0, gamma_xy, 0.0, 0.0],
                TensionDamageState::default(),
            )
            .unwrap();
        near(response.equivalent_strain, tau / m.e_mpa, 1e-14);
        // Principal effective stresses are (+tau, -tau, 0). After weakening
        // the positive one by (1-d), rotate them back by 45 degrees.
        near(response.stress_mpa[0], -0.5 * response.damage * tau, 1e-11);
        near(response.stress_mpa[1], -0.5 * response.damage * tau, 1e-11);
        near(
            response.stress_mpa[3],
            (1.0 - 0.5 * response.damage) * tau,
            1e-11,
        );
        near(response.stress_mpa[2], 0.0, 1e-11);
    }

    #[test]
    fn invalid_parameters_and_history_are_rejected() {
        let mut m = material();
        m.softening_strain = 0.0;
        assert!(m.evaluate([0.0; 6], TensionDamageState::default()).is_err());
        let m = material();
        assert!(m
            .evaluate([f64::NAN; 6], TensionDamageState::default())
            .is_err());
        assert!(m
            .evaluate(
                [0.0; 6],
                TensionDamageState {
                    max_equivalent_strain: -1.0
                }
            )
            .is_err());
    }

    fn integrated_tensile_work_n_per_m(material: TensionDamageMaterial, width_m: f64) -> f64 {
        let threshold = material.tensile_strength_mpa / material.e_mpa;
        let end = threshold + 24.0 * material.softening_strain;
        let steps = 12_000;
        let increment = end / steps as f64;
        let mut history = TensionDamageState::default();
        let mut previous = 0.0;
        let mut integral_mpa = 0.0;
        for step in 1..=steps {
            let axial = step as f64 * increment;
            let response = material.evaluate(uniaxial_strain(axial), history).unwrap();
            history = response.next_state;
            integral_mpa += 0.5 * (previous + response.stress_mpa[0]) * increment;
            previous = response.stress_mpa[0];
        }
        integral_mpa * 1e6 * width_m
    }

    #[test]
    fn two_crack_band_widths_dissipate_same_independent_target_energy() {
        let target_n_per_m = 100.0;
        for width_m in [0.05, 0.10] {
            let material = TensionDamageMaterial::from_fracture_energy(
                30_000.0,
                0.2,
                3.0,
                target_n_per_m,
                width_m,
            )
            .unwrap();
            let numerical = integrated_tensile_work_n_per_m(material, width_m);
            near(numerical, target_n_per_m, 5e-4);
            let threshold = material.tensile_strength_mpa / material.e_mpa;
            let postpeak = material
                .evaluate(
                    uniaxial_strain(threshold + material.softening_strain),
                    TensionDamageState::default(),
                )
                .unwrap();
            near(
                postpeak.stress_mpa[0],
                material.tensile_strength_mpa / std::f64::consts::E,
                1e-11,
            );
        }
    }

    #[test]
    fn crack_band_too_wide_for_available_fracture_energy_is_rejected() {
        // h_max = 2 E Gf / ft² = 2 * 30 GPa * 100 N/m / (3 MPa)² = 2/3 m.
        let edge =
            TensionDamageMaterial::from_fracture_energy(30_000.0, 0.2, 3.0, 100.0, 2.0 / 3.0);
        assert!(edge.is_err());
        let too_wide = TensionDamageMaterial::from_fracture_energy(30_000.0, 0.2, 3.0, 100.0, 1.0)
            .unwrap_err();
        assert!(too_wide.contains("crack-band length exceeds"));
    }
}
