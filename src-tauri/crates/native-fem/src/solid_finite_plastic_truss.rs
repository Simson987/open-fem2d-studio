//! Total-Lagrangian two-node steel truss with logarithmic strain and 1D plasticity.
//!
//! For reference length `L0`, current length `l`, and reference area `A`, let
//! `e = ln(l/L0)`. Stress `s = dψ/de` is conjugate to logarithmic strain per
//! reference volume; its unit is MPa. The reference energy is `A L0 ψ(e)`.
//! The return map uses the supplied *committed* state and returns a trial
//! state. The caller alone decides when to commit it, so repeated Newton
//! evaluations do not accumulate plastic strain.
//!
//! Writing `n = (x2+u2-x1-u1)/l`, differentiation gives the current axial
//! force `N = A L0 s/l`, and the nodal force `[-N n, N n]`. If
//! `C = ds/de` is the algorithmic modulus on the active return-map branch,
//! then the exact 3×3 relative-displacement tangent block is
//! `B = A L0/l² [s I + (C - 2s) n⊗n]`. The row-major 6×6 tangent is
//! `[[B, -B], [-B, B]]`. MPa × m² × 1000 gives kN.

#[derive(Clone, Copy, Debug)]
pub struct PlasticTrussMaterial {
    pub youngs_mpa: f64,
    pub yield_mpa: f64,
    /// Linear isotropic hardening modulus; zero gives perfect plasticity.
    pub hardening_mpa: f64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlasticTrussState {
    /// Signed plastic logarithmic axial strain.
    pub plastic_log_strain: f64,
    /// Accumulated absolute plastic logarithmic strain.
    pub accumulated_plastic_log_strain: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct PlasticTrussAction {
    pub logarithmic_strain: f64,
    /// Stress conjugate to logarithmic strain per reference volume.
    pub stress_mpa: f64,
    /// Algorithmic derivative of stress with respect to logarithmic strain.
    pub algorithmic_modulus_mpa: f64,
    /// Current axial force, positive in tension.
    pub axial_force_kn: f64,
    pub internal_force_kn: [f64; 6],
    /// Row-major 6×6 displacement tangent in kN/m, when requested.
    pub tangent_kn_per_m: Option<[f64; 36]>,
    /// Trial state; commit it only after the global load step converges.
    pub state: PlasticTrussState,
    pub plastic: bool,
}

pub fn evaluate(
    reference: [[f64; 3]; 2],
    displacement: [[f64; 3]; 2],
    material: PlasticTrussMaterial,
    committed: &PlasticTrussState,
    area_m2: f64,
    with_tangent: bool,
) -> Result<PlasticTrussAction, String> {
    if !material.youngs_mpa.is_finite()
        || material.youngs_mpa <= 0.0
        || !material.yield_mpa.is_finite()
        || material.yield_mpa <= 0.0
        || !material.hardening_mpa.is_finite()
        || material.hardening_mpa < 0.0
        || !area_m2.is_finite()
        || area_m2 <= 0.0
        || !committed.plastic_log_strain.is_finite()
        || !committed.accumulated_plastic_log_strain.is_finite()
        || committed.accumulated_plastic_log_strain < 0.0
        || reference
            .iter()
            .flatten()
            .chain(displacement.iter().flatten())
            .any(|value| !value.is_finite())
    {
        return Err("plastic finite truss needs finite coordinates and state, positive E, yield stress and area, and nonnegative hardening and accumulated plastic strain".into());
    }
    let original = std::array::from_fn::<_, 3, _>(|i| reference[1][i] - reference[0][i]);
    let reference_length = original[0].hypot(original[1]).hypot(original[2]);
    if !reference_length.is_finite() || reference_length <= 0.0 {
        return Err("plastic finite truss needs distinct reference nodes".into());
    }
    let current =
        std::array::from_fn::<_, 3, _>(|i| original[i] + displacement[1][i] - displacement[0][i]);
    let current_length = current[0].hypot(current[1]).hypot(current[2]);
    if !current_length.is_finite() || current_length <= 0.0 {
        return Err("plastic finite truss collapsed or current length overflowed".into());
    }
    let strain = (current_length / reference_length).ln();
    let elastic_trial = material.youngs_mpa * (strain - committed.plastic_log_strain);
    let yield_radius =
        material.yield_mpa + material.hardening_mpa * committed.accumulated_plastic_log_strain;
    if !strain.is_finite() || !elastic_trial.is_finite() || !yield_radius.is_finite() {
        return Err("plastic finite truss strain or stress overflowed".into());
    }

    let overstress = elastic_trial.abs() - yield_radius;
    let plastic = overstress > 0.0;
    let (stress, modulus, state) = if plastic {
        let direction = elastic_trial.signum();
        let increment = overstress / (material.youngs_mpa + material.hardening_mpa);
        let state = PlasticTrussState {
            plastic_log_strain: committed.plastic_log_strain + direction * increment,
            accumulated_plastic_log_strain: committed.accumulated_plastic_log_strain + increment,
        };
        let stress = elastic_trial - material.youngs_mpa * direction * increment;
        let modulus = material.youngs_mpa * material.hardening_mpa
            / (material.youngs_mpa + material.hardening_mpa);
        (stress, modulus, state)
    } else {
        (elastic_trial, material.youngs_mpa, *committed)
    };

    let direction = current.map(|component| component / current_length);
    let axial_force_kn = 1_000.0 * area_m2 * reference_length * stress / current_length;
    let mut force = [0.0; 6];
    for axis in 0..3 {
        force[axis] = -axial_force_kn * direction[axis];
        force[3 + axis] = axial_force_kn * direction[axis];
    }
    let tangent = with_tangent.then(|| {
        let coefficient = 1_000.0 * area_m2 * reference_length / (current_length * current_length);
        let mut stiffness = [0.0; 36];
        for a in 0..3 {
            for b in 0..3 {
                let isotropic = if a == b { stress } else { 0.0 };
                let block = coefficient
                    * (isotropic + (modulus - 2.0 * stress) * direction[a] * direction[b]);
                for end_a in 0..2 {
                    for end_b in 0..2 {
                        let sign = if end_a == end_b { 1.0 } else { -1.0 };
                        stiffness[(3 * end_a + a) * 6 + 3 * end_b + b] = sign * block;
                    }
                }
            }
        }
        stiffness
    });
    if !stress.is_finite()
        || !modulus.is_finite()
        || !state.plastic_log_strain.is_finite()
        || !state.accumulated_plastic_log_strain.is_finite()
        || !axial_force_kn.is_finite()
        || force.iter().any(|value| !value.is_finite())
        || tangent
            .as_ref()
            .is_some_and(|values| values.iter().any(|value| !value.is_finite()))
    {
        return Err("plastic finite truss action overflowed".into());
    }
    Ok(PlasticTrussAction {
        logarithmic_strain: strain,
        stress_mpa: stress,
        algorithmic_modulus_mpa: modulus,
        axial_force_kn,
        internal_force_kn: force,
        tangent_kn_per_m: tangent,
        state,
        plastic,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAT: PlasticTrussMaterial = PlasticTrussMaterial {
        youngs_mpa: 200_000.0,
        yield_mpa: 250.0,
        hardening_mpa: 1_000.0,
    };
    const X: [[f64; 3]; 2] = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]];

    fn axial(strain: f64, committed: PlasticTrussState) -> PlasticTrussAction {
        evaluate(
            X,
            [[0.0; 3], [strain.exp() - 1.0, 0.0, 0.0]],
            MAT,
            &committed,
            0.002,
            true,
        )
        .unwrap()
    }

    fn close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "actual={actual}, expected={expected}, tolerance={tolerance}"
        );
    }

    #[test]
    fn analytic_loading_unloading_and_hardening() {
        let initial = PlasticTrussState::default();
        let elastic = axial(0.001, initial);
        close(elastic.stress_mpa, 200.0, 1e-10);
        close(elastic.axial_force_kn, 400.0 / 0.001_f64.exp(), 1e-9);
        assert!(!elastic.plastic);
        assert_eq!(elastic.state, initial);

        let loaded = axial(0.005, initial);
        let gamma = (1_000.0 - 250.0) / 201_000.0;
        close(loaded.stress_mpa, 1_000.0 - 200_000.0 * gamma, 1e-9);
        close(loaded.state.plastic_log_strain, gamma, 1e-12);
        close(loaded.state.accumulated_plastic_log_strain, gamma, 1e-12);
        close(
            loaded.algorithmic_modulus_mpa,
            200_000.0 * 1_000.0 / 201_000.0,
            1e-10,
        );
        assert!(loaded.plastic);

        // Calling again from the same committed state must not advance history.
        assert_eq!(axial(0.005, initial).state, loaded.state);
        let unloaded = axial(gamma, loaded.state);
        close(unloaded.stress_mpa, 0.0, 1e-9);
        assert!(!unloaded.plastic);
        assert_eq!(unloaded.state, loaded.state);

        let reloaded = axial(0.007, loaded.state);
        let trial = MAT.youngs_mpa * (0.007 - gamma);
        let gamma2 = (trial - (MAT.yield_mpa + MAT.hardening_mpa * gamma))
            / (MAT.youngs_mpa + MAT.hardening_mpa);
        close(
            reloaded.state.accumulated_plastic_log_strain,
            gamma + gamma2,
            1e-12,
        );
        close(
            reloaded.stress_mpa,
            MAT.yield_mpa + MAT.hardening_mpa * (gamma + gamma2),
            1e-9,
        );
    }

    #[test]
    fn compression_reversal_uses_signed_plastic_log_strain() {
        let action = axial(-0.005, PlasticTrussState::default());
        assert!(action.plastic);
        assert!(action.stress_mpa < 0.0);
        close(
            action.state.plastic_log_strain,
            -action.state.accumulated_plastic_log_strain,
            1e-12,
        );
        close(
            action.stress_mpa.abs(),
            250.0 + 1_000.0 * action.state.accumulated_plastic_log_strain,
            1e-9,
        );
    }

    #[test]
    fn perfect_plasticity_has_constant_yield_stress_and_zero_material_tangent() {
        let material = PlasticTrussMaterial {
            hardening_mpa: 0.0,
            ..MAT
        };
        let action = evaluate(
            X,
            [[0.0; 3], [0.01_f64.exp() - 1.0, 0.0, 0.0]],
            material,
            &PlasticTrussState::default(),
            0.002,
            true,
        )
        .unwrap();
        close(action.stress_mpa, 250.0, 1e-10);
        close(action.algorithmic_modulus_mpa, 0.0, 1e-12);
        close(
            action.state.plastic_log_strain,
            0.01 - 250.0 / 200_000.0,
            1e-12,
        );
    }

    #[test]
    fn rigid_rotation_preserves_stress_and_rotates_force() {
        let committed = PlasticTrussState {
            plastic_log_strain: 0.001,
            accumulated_plastic_log_strain: 0.001,
        };
        let stretch = 1.005;
        let horizontal = evaluate(
            X,
            [[0.0; 3], [stretch - 1.0, 0.0, 0.0]],
            MAT,
            &committed,
            0.002,
            false,
        )
        .unwrap();
        let rotated = evaluate(
            X,
            [[0.0; 3], [-1.0, stretch, 0.0]],
            MAT,
            &committed,
            0.002,
            false,
        )
        .unwrap();
        close(rotated.stress_mpa, horizontal.stress_mpa, 1e-10);
        assert_eq!(rotated.state, horizontal.state);
        close(rotated.internal_force_kn[3], 0.0, 1e-12);
        close(
            rotated.internal_force_kn[4],
            horizontal.axial_force_kn,
            1e-10,
        );
        let pure_rotation = evaluate(
            X,
            [[0.0; 3], [-1.0, 1.0, 0.0]],
            MAT,
            &PlasticTrussState::default(),
            0.002,
            false,
        )
        .unwrap();
        close(pure_rotation.axial_force_kn, 0.0, 1e-12);
    }

    fn check_tangent(
        displacement: [[f64; 3]; 2],
        committed: PlasticTrussState,
        expect_plastic: bool,
    ) {
        let reference = [[0.2, -0.1, 0.4], [1.3, 0.5, 0.8]];
        let action = evaluate(reference, displacement, MAT, &committed, 0.002, true).unwrap();
        assert_eq!(action.plastic, expect_plastic);
        let tangent = action.tangent_kn_per_m.unwrap();
        let h = 1e-6;
        for column in 0..6 {
            let mut plus = displacement;
            let mut minus = displacement;
            plus[column / 3][column % 3] += h;
            minus[column / 3][column % 3] -= h;
            let fp = evaluate(reference, plus, MAT, &committed, 0.002, false).unwrap();
            let fm = evaluate(reference, minus, MAT, &committed, 0.002, false).unwrap();
            assert_eq!(fp.plastic, expect_plastic);
            assert_eq!(fm.plastic, expect_plastic);
            for row in 0..6 {
                let numerical = (fp.internal_force_kn[row] - fm.internal_force_kn[row]) / (2.0 * h);
                let exact = tangent[row * 6 + column];
                let scale = exact.abs().max(1.0);
                assert!(
                    (numerical - exact).abs() / scale < 2e-7,
                    "row={row} column={column} numerical={numerical} exact={exact}"
                );
            }
        }
    }

    #[test]
    fn consistent_tangent_matches_finite_difference_on_both_branches() {
        check_tangent(
            [[0.02, -0.03, 0.01], [0.0205, -0.029, 0.011]],
            PlasticTrussState::default(),
            false,
        );
        check_tangent(
            [[0.02, -0.03, 0.01], [0.2, 0.04, -0.02]],
            PlasticTrussState::default(),
            true,
        );
        check_tangent(
            [[0.02, -0.03, 0.01], [-0.2, -0.1, -0.05]],
            PlasticTrussState::default(),
            true,
        );
    }

    #[test]
    fn invalid_geometry_and_material_are_rejected() {
        let state = PlasticTrussState::default();
        assert!(evaluate([X[0], X[0]], [[0.0; 3]; 2], MAT, &state, 0.002, true).is_err());
        assert!(evaluate(X, [[0.0; 3], [-1.0, 0.0, 0.0]], MAT, &state, 0.002, true).is_err());
        assert!(evaluate(
            X,
            [[0.0; 3], [f64::NAN, 0.0, 0.0]],
            MAT,
            &state,
            0.002,
            true
        )
        .is_err());
        assert!(evaluate(X, [[0.0; 3]; 2], MAT, &state, 0.0, true).is_err());
        assert!(evaluate(
            X,
            [[0.0; 3]; 2],
            PlasticTrussMaterial {
                hardening_mpa: -1.0,
                ..MAT
            },
            &state,
            0.002,
            true
        )
        .is_err());
    }
}
