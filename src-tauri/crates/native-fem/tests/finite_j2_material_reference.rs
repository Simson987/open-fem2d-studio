//! Independent material-point references for multiplicative finite-strain J2.
//!
//! The diagonal references reduce the Hencky return to a scalar consistency
//! equation. The shear reference derives log(B) from its two eigenvalues.
//! Neither calculation calls the constitutive implementation for its expected
//! stress or plastic increment.

use openaec_native_fem::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel};
use openaec_native_fem::solid_j2::{J2State, J2Steel};

type Matrix = [[f64; 3]; 3];

fn material() -> FiniteJ2Steel {
    FiniteJ2Steel {
        youngs_mpa: 210_000.0,
        poisson: 0.3,
        yield_mpa: 250.0,
        hardening_mpa: 2_000.0,
    }
}

fn mu() -> f64 {
    210_000.0 / (2.0 * 1.3)
}

fn bulk() -> f64 {
    210_000.0 / (3.0 * (1.0 - 2.0 * 0.3))
}

fn diagonal(a: f64, b: f64, c: f64) -> Matrix {
    [[a, 0.0, 0.0], [0.0, b, 0.0], [0.0, 0.0, c]]
}

fn matmul(a: Matrix, b: Matrix) -> Matrix {
    let mut c = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            for k in 0..3 {
                c[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    c
}

fn transpose(a: Matrix) -> Matrix {
    let mut t = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            t[i][j] = a[j][i];
        }
    }
    t
}

fn determinant(a: Matrix) -> f64 {
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
}

fn close(actual: f64, expected: f64, absolute: f64, relative: f64, label: &str) {
    let tolerance = absolute + relative * expected.abs();
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn close_matrix(actual: Matrix, expected: Matrix, absolute: f64, relative: f64, label: &str) {
    for i in 0..3 {
        for j in 0..3 {
            close(
                actual[i][j],
                expected[i][j],
                absolute,
                relative,
                &format!("{label}[{i},{j}]"),
            );
        }
    }
}

#[test]
fn hydrostatic_logarithmic_dilation_stays_elastic() {
    let h = 0.001_f64;
    let stretch = h.exp();
    let response = material()
        .update(
            &FiniteJ2State::default(),
            diagonal(stretch, stretch, stretch),
        )
        .unwrap();
    let expected_p = 3.0 * bulk() * h / stretch;
    close_matrix(
        response.first_piola_mpa,
        diagonal(expected_p, expected_p, expected_p),
        1e-8,
        1e-10,
        "hydrostatic Piola",
    );
    close(
        response.elastic_energy_mpa,
        0.5 * bulk() * (3.0 * h).powi(2),
        1e-10,
        1e-10,
        "hydrostatic energy",
    );
    close(
        response.equivalent_plastic_increment,
        0.0,
        1e-14,
        0.0,
        "hydrostatic plastic increment",
    );
    close(determinant(response.state.fp), 1.0, 1e-12, 0.0, "det Fp");
}

#[test]
fn isochoric_diagonal_stretch_matches_scalar_return() {
    let a = 0.002_f64;
    let f1 = a.exp();
    let f2 = (-a).exp();
    let q_trial = 2.0 * mu() * 3.0_f64.sqrt() * a;
    let delta_alpha = (q_trial - 250.0) / (3.0 * mu() + 2_000.0);
    let z = 3.0_f64.sqrt() * delta_alpha / 2.0;
    let mandel_11 = 2.0 * mu() * (a - z);
    let expected_p = diagonal(mandel_11 / f1, -mandel_11 / f2, 0.0);

    let response = material()
        .update(&FiniteJ2State::default(), diagonal(f1, f2, 1.0))
        .unwrap();
    close(
        response.equivalent_plastic_increment,
        delta_alpha,
        1e-11,
        1e-9,
        "plastic increment",
    );
    close(
        response.state.equivalent_plastic_strain,
        delta_alpha,
        1e-11,
        1e-9,
        "accumulated plastic strain",
    );
    close_matrix(
        response.first_piola_mpa,
        expected_p,
        1e-6,
        1e-8,
        "diagonal Piola",
    );
    close_matrix(
        response.state.fp,
        diagonal(z.exp(), (-z).exp(), 1.0),
        1e-10,
        1e-8,
        "diagonal Fp",
    );
    close(determinant(response.state.fp), 1.0, 1e-12, 0.0, "det Fp");
}

#[test]
fn uniaxial_logarithmic_strain_matches_volumetric_plus_j2_return() {
    let a = 0.004_f64;
    let stretch = a.exp();
    let q_trial = 2.0 * mu() * a;
    let delta_alpha = (q_trial - 250.0) / (3.0 * mu() + 2_000.0);
    let mean = bulk() * a;
    let deviator_11 = 2.0 * mu() * (2.0 * a / 3.0 - delta_alpha);
    let deviator_22 = 2.0 * mu() * (-a / 3.0 + delta_alpha / 2.0);
    let expected_p = diagonal(
        (mean + deviator_11) / stretch,
        mean + deviator_22,
        mean + deviator_22,
    );
    let response = material()
        .update(&FiniteJ2State::default(), diagonal(stretch, 1.0, 1.0))
        .unwrap();
    close(
        response.equivalent_plastic_increment,
        delta_alpha,
        1e-11,
        1e-8,
        "uniaxial strain plastic increment",
    );
    close_matrix(
        response.first_piola_mpa,
        expected_p,
        1e-6,
        1e-8,
        "uniaxial strain Piola",
    );
    close(
        determinant(response.state.fp),
        1.0,
        1e-10,
        0.0,
        "uniaxial det Fp",
    );
}

#[test]
fn simple_shear_matches_analytic_logarithmic_eigenstrains() {
    let gamma = 0.004;
    let eta = (gamma / 2.0_f64).asinh();
    let q_trial = 2.0 * mu() * 3.0_f64.sqrt() * eta;
    let delta_alpha = (q_trial - 250.0) / (3.0 * mu() + 2_000.0);
    let stress_factor = 1.0 - 3.0 * mu() * delta_alpha / q_trial;
    let norm = (gamma * gamma + 4.0).sqrt();
    let tau_11 = stress_factor * 2.0 * mu() * eta * gamma / norm;
    let tau_12 = stress_factor * 2.0 * mu() * eta * 2.0 / norm;
    // P = tau F^{-T}, F = I + gamma e1 tensor e2.
    let expected_p = [
        [tau_11 - gamma * tau_12, tau_12, 0.0],
        [tau_12 + gamma * tau_11, -tau_11, 0.0],
        [0.0, 0.0, 0.0],
    ];
    let f = [[1.0, gamma, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    let response = material().update(&FiniteJ2State::default(), f).unwrap();
    close(
        response.equivalent_plastic_increment,
        delta_alpha,
        1e-10,
        1e-8,
        "shear plastic increment",
    );
    close_matrix(
        response.first_piola_mpa,
        expected_p,
        1e-5,
        1e-7,
        "shear Piola",
    );
    close(
        determinant(response.state.fp),
        1.0,
        1e-10,
        0.0,
        "shear det Fp",
    );
}

#[test]
fn superposed_rigid_rotation_rotates_stress_but_preserves_history() {
    let initial = material()
        .update(
            &FiniteJ2State::default(),
            diagonal(0.002_f64.exp(), (-0.002_f64).exp(), 1.0),
        )
        .unwrap();
    let committed = initial.state;
    let base_f = diagonal(0.003_f64.exp(), (-0.003_f64).exp(), 1.0);
    let theta = 0.7_f64;
    let q = [
        [theta.cos(), -theta.sin(), 0.0],
        [theta.sin(), theta.cos(), 0.0],
        [0.0, 0.0, 1.0],
    ];
    let base = material().update(&committed, base_f).unwrap();
    let rotated = material().update(&committed, matmul(q, base_f)).unwrap();
    close_matrix(
        rotated.first_piola_mpa,
        matmul(q, base.first_piola_mpa),
        1e-6,
        1e-8,
        "rotated Piola",
    );
    close_matrix(
        rotated.kirchhoff_mpa,
        matmul(matmul(q, base.kirchhoff_mpa), transpose(q)),
        1e-6,
        1e-8,
        "rotated Kirchhoff",
    );
    close_matrix(rotated.state.fp, base.state.fp, 1e-9, 1e-8, "rotated Fp");
    close(
        rotated.state.equivalent_plastic_strain,
        base.state.equivalent_plastic_strain,
        1e-10,
        1e-9,
        "rotated plastic strain",
    );
    close(
        rotated.elastic_energy_mpa,
        base.elastic_energy_mpa,
        1e-9,
        1e-9,
        "rotated energy",
    );
    close(
        determinant(committed.fp),
        1.0,
        1e-12,
        0.0,
        "unmodified committed Fp",
    );
}

#[test]
fn unload_to_plastic_deformation_then_reverse_has_no_trial_commit() {
    let a = 0.002_f64;
    let loaded = material()
        .update(
            &FiniteJ2State::default(),
            diagonal(a.exp(), (-a).exp(), 1.0),
        )
        .unwrap();
    let committed = loaded.state;
    let unload = material().update(&committed, committed.fp).unwrap();
    close_matrix(
        unload.first_piola_mpa,
        [[0.0; 3]; 3],
        1e-7,
        0.0,
        "unload Piola",
    );
    close(
        unload.equivalent_plastic_increment,
        0.0,
        1e-12,
        0.0,
        "unload plastic increment",
    );
    close(
        unload.state.equivalent_plastic_strain,
        committed.equivalent_plastic_strain,
        1e-12,
        0.0,
        "unload plastic history",
    );

    // A rejected trial update must not alter the committed state. On reverse
    // loading the scalar trial stress includes the retained positive plastic
    // logarithmic stretch z from the forward load.
    let z = committed.fp[0][0].ln();
    let q_reverse = 2.0 * mu() * 3.0_f64.sqrt() * (a + z);
    let expected_delta = (q_reverse - 250.0 - 2_000.0 * committed.equivalent_plastic_strain)
        / (3.0 * mu() + 2_000.0);
    let reversed = material()
        .update(&committed, diagonal((-a).exp(), a.exp(), 1.0))
        .unwrap();
    close(
        reversed.equivalent_plastic_increment,
        expected_delta,
        1e-10,
        1e-8,
        "reverse increment",
    );
    close(
        reversed.state.equivalent_plastic_strain,
        committed.equivalent_plastic_strain + expected_delta,
        1e-10,
        1e-8,
        "reverse history",
    );
    close(
        determinant(reversed.state.fp),
        1.0,
        1e-10,
        0.0,
        "reverse det Fp",
    );
    close(
        determinant(committed.fp),
        1.0,
        1e-12,
        0.0,
        "committed det Fp",
    );
}

#[test]
fn elastic_piola_is_finite_difference_derivative_of_hencky_energy() {
    let f = [
        [1.0002, 0.0001, 0.0],
        [0.00003, 0.9999, 0.00002],
        [0.0, 0.0, 1.0001],
    ];
    let committed = FiniteJ2State::default();
    let base = material().update(&committed, f).unwrap();
    close(
        base.equivalent_plastic_increment,
        0.0,
        1e-14,
        0.0,
        "elastic increment",
    );
    let h = 1e-6;
    for i in 0..3 {
        for j in 0..3 {
            let mut plus = f;
            plus[i][j] += h;
            let mut minus = f;
            minus[i][j] -= h;
            let e_plus = material()
                .update(&committed, plus)
                .unwrap()
                .elastic_energy_mpa;
            let e_minus = material()
                .update(&committed, minus)
                .unwrap()
                .elastic_energy_mpa;
            let independent_p = (e_plus - e_minus) / (2.0 * h);
            close(
                base.first_piola_mpa[i][j],
                independent_p,
                2e-5,
                5e-6,
                &format!("energy derivative P[{i},{j}]"),
            );
        }
    }
}

#[test]
fn finite_difference_tangent_matches_diagonal_elastic_and_plastic_derivatives() {
    let committed = FiniteJ2State::default();
    for a in [0.0001_f64, 0.002_f64] {
        let f1 = a.exp();
        let f2 = (-a).exp();
        let base = diagonal(f1, f2, 1.0);
        let q_trial = 2.0 * mu() * 3.0_f64.sqrt() * a;
        let yielded = q_trial > 250.0;
        let delta_alpha = if yielded {
            (q_trial - 250.0) / (3.0 * mu() + 2_000.0)
        } else {
            0.0
        };
        let z = 3.0_f64.sqrt() * delta_alpha / 2.0;
        let z_prime = if yielded {
            3.0 * mu() / (3.0 * mu() + 2_000.0)
        } else {
            0.0
        };
        let mandel_11 = 2.0 * mu() * (a - z);
        let mandel_11_prime = 2.0 * mu() * (1.0 - z_prime);
        let expected = diagonal(
            (mandel_11_prime - mandel_11) / f1,
            -(mandel_11_prime + mandel_11) / f2,
            0.0,
        );
        let production_tangent = material()
            .update_with_tangent(&committed, base)
            .unwrap()
            .tangent_mpa;
        let mut production_directional = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                production_directional[i][j] =
                    production_tangent[3 * i + j][0] * f1 - production_tangent[3 * i + j][4] * f2;
            }
        }
        close_matrix(
            production_directional,
            expected,
            1e-5,
            1e-8,
            if yielded {
                "plastic production dP/da"
            } else {
                "elastic production dP/da"
            },
        );

        // Independently perturb each component of F while holding the same
        // committed history. Contract the resulting 9x9 numerical dP/dF
        // with dF/da for the analytic isochoric diagonal path.
        let h = 1e-7;
        let mut tangent = [[[[0.0; 3]; 3]; 3]; 3];
        for k in 0..3 {
            for l in 0..3 {
                let mut plus = base;
                plus[k][l] += h;
                let mut minus = base;
                minus[k][l] -= h;
                let p_plus = material().update(&committed, plus).unwrap().first_piola_mpa;
                let p_minus = material()
                    .update(&committed, minus)
                    .unwrap()
                    .first_piola_mpa;
                for i in 0..3 {
                    for j in 0..3 {
                        tangent[i][j][k][l] = (p_plus[i][j] - p_minus[i][j]) / (2.0 * h);
                        assert!(tangent[i][j][k][l].is_finite());
                    }
                }
            }
        }
        let mut directional = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                directional[i][j] = tangent[i][j][0][0] * f1 - tangent[i][j][1][1] * f2;
            }
        }
        close_matrix(
            directional,
            expected,
            0.005,
            2e-6,
            if yielded {
                "plastic dP/da"
            } else {
                "elastic dP/da"
            },
        );
    }
}

#[test]
fn infinitesimal_uniaxial_limit_approaches_existing_j2_quadratically() {
    for yield_mpa in [1.0e9, 50.0] {
        let finite = FiniteJ2Steel::new(210_000.0, 0.3, yield_mpa, 2_000.0).unwrap();
        let small = J2Steel::new(210_000.0, 0.3, yield_mpa, 2_000.0).unwrap();
        let mut stress_errors = [0.0; 2];
        let mut plastic_errors = [0.0; 2];
        for (index, engineering_strain) in [0.001_f64, 0.002_f64].into_iter().enumerate() {
            let finite_result = finite
                .update(
                    &FiniteJ2State::default(),
                    diagonal(1.0 + engineering_strain, 1.0, 1.0),
                )
                .unwrap();
            let small_result = small
                .update(&J2State::default(), diagonal(engineering_strain, 0.0, 0.0))
                .unwrap();
            assert_eq!(finite_result.yielded, small_result.yielded);
            stress_errors[index] =
                (finite_result.kirchhoff_mpa[0][0] - small_result.state.stress_mpa[0][0]).abs();
            plastic_errors[index] = (finite_result.state.equivalent_plastic_strain
                - small_result.state.equivalent_plastic_strain)
                .abs();
            assert!(
                stress_errors[index] < 3.0e5 * engineering_strain.powi(2),
                "small-strain stress error should be second order: {}",
                stress_errors[index]
            );
        }
        let stress_ratio = stress_errors[1] / stress_errors[0];
        assert!(
            (3.8..4.2).contains(&stress_ratio),
            "doubling strain should quadruple the leading stress difference; ratio={stress_ratio}"
        );
        if yield_mpa < 100.0 {
            let plastic_ratio = plastic_errors[1] / plastic_errors[0];
            assert!(
                (3.8..4.2).contains(&plastic_ratio),
                "plastic-history difference should be second order; ratio={plastic_ratio}"
            );
        }
    }
}

fn check_full_nominal_tangent(
    name: &str,
    committed: &FiniteJ2State,
    f: Matrix,
    expected_yielded: bool,
) {
    let response = material().update_with_tangent(committed, f).unwrap();
    assert_eq!(response.point.yielded, expected_yielded, "{name} branch");
    let h = 5e-7;
    let mut max_absolute_error = 0.0_f64;
    let mut max_tolerance_fraction = 0.0_f64;
    let mut max_component = (0, 0, 0, 0);
    for k in 0..3 {
        for l in 0..3 {
            let mut plus = f;
            plus[k][l] += h;
            let mut minus = f;
            minus[k][l] -= h;
            // The two evaluations always start at the same committed state.
            // They must stay on the same smooth return-map branch.
            let plus_response = material().update(committed, plus).unwrap();
            let minus_response = material().update(committed, minus).unwrap();
            assert_eq!(plus_response.yielded, expected_yielded, "{name} + branch");
            assert_eq!(minus_response.yielded, expected_yielded, "{name} - branch");
            for i in 0..3 {
                for j in 0..3 {
                    let numeric = (plus_response.first_piola_mpa[i][j]
                        - minus_response.first_piola_mpa[i][j])
                        / (2.0 * h);
                    let analytic = response.tangent_mpa[3 * i + j][3 * k + l];
                    let absolute_error = (analytic - numeric).abs();
                    let tolerance = 0.01 + 5e-6 * analytic.abs().max(numeric.abs());
                    let tolerance_fraction = absolute_error / tolerance;
                    if absolute_error > max_absolute_error {
                        max_absolute_error = absolute_error;
                        max_component = (i, j, k, l);
                    }
                    max_tolerance_fraction = max_tolerance_fraction.max(tolerance_fraction);
                    assert!(
                        absolute_error <= tolerance,
                        "{name} dP[{i},{j}]/dF[{k},{l}]: analytic={analytic:.12e}, \
                         central FD={numeric:.12e}, error={absolute_error:.3e}, \
                         tolerance={tolerance:.3e}"
                    );
                }
            }
        }
    }
    eprintln!(
        "{name}: 81 dP/dF terms, max absolute error={max_absolute_error:.6e} MPa \
         at dP[{},{}]/dF[{},{}], max error/tolerance={max_tolerance_fraction:.6e}",
        max_component.0, max_component.1, max_component.2, max_component.3,
    );
    assert_eq!(
        material()
            .update(committed, f)
            .unwrap()
            .state
            .equivalent_plastic_strain,
        response.point.state.equivalent_plastic_strain
    );
}

#[test]
fn full_81_component_nominal_tangent_matches_independent_central_differences() {
    let virgin = FiniteJ2State::default();
    check_full_nominal_tangent(
        "elastic virgin",
        &virgin,
        [
            [1.0002, 0.0001, 0.0],
            [0.00003, 0.9999, 0.00002],
            [0.0, 0.0, 1.0001],
        ],
        false,
    );
    check_full_nominal_tangent(
        "plastic virgin",
        &virgin,
        [[1.04, 0.02, 0.004], [0.003, 0.98, 0.01], [0.0, 0.001, 0.99]],
        true,
    );

    let preload = material()
        .update(
            &virgin,
            [[1.03, 0.04, 0.002], [0.01, 0.98, 0.003], [0.0, 0.0, 1.01]],
        )
        .unwrap();
    assert!(preload.yielded);
    let committed = preload.state;
    let theta = 0.43_f64;
    let rotation = [
        [theta.cos(), -theta.sin(), 0.0],
        [theta.sin(), theta.cos(), 0.0],
        [0.0, 0.0, 1.0],
    ];
    check_full_nominal_tangent(
        "plastic with rotated committed history",
        &committed,
        matmul(
            rotation,
            [[1.07, 0.05, 0.001], [0.01, 0.96, 0.005], [0.0, 0.0, 1.0]],
        ),
        true,
    );
    check_full_nominal_tangent(
        "unloaded rotated committed history",
        &committed,
        matmul(rotation, committed.fp),
        false,
    );
    close(
        determinant(committed.fp),
        1.0,
        1e-10,
        0.0,
        "tangent committed det Fp",
    );
}
