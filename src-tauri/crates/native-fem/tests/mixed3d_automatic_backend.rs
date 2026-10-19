//! Automatic mixed3d solver selection: matrix-free PCG first, bounded frontal
//! fallback only for eligible nonconvergence. Exercise the typed public route.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::mixed3d::{Mixed3dBackend, Mixed3dResult};

fn fixture(backend: &str, max_pcg_iterations: Option<usize>) -> NativeFemRequest {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../examples/mixed3d-hex8-tet4-truss.json")).unwrap();
    value["input"]["backend"] = backend.into();
    if let Some(limit) = max_pcg_iterations {
        value["input"]["maxPcgIterations"] = limit.into();
    }
    serde_json::from_value(value).expect("typed mixed3d fixture")
}

fn solve_fixture(backend: &str, limit: Option<usize>) -> Mixed3dResult {
    match solve_native_fem(fixture(backend, limit)).expect("mixed3d fixture should solve") {
        NativeFemResult::Mixed3d(result) => result,
        _ => panic!("mixed3d request dispatched to another result"),
    }
}

fn assert_close(actual: f64, expected: f64, absolute: f64, relative: f64, context: &str) {
    let tolerance = absolute + relative * expected.abs();
    assert!(
        (actual - expected).abs() <= tolerance,
        "{context}: actual {actual:.13e}, reference {expected:.13e}, tolerance {tolerance:.2e}"
    );
}

fn assert_same_solution(actual: &Mixed3dResult, reference: &Mixed3dResult) {
    assert_eq!(
        actual.nodal_displacements_m.len(),
        reference.nodal_displacements_m.len()
    );
    assert_eq!(
        actual.solid_element_stress_mpa.len(),
        reference.solid_element_stress_mpa.len()
    );
    assert_eq!(
        actual.hex_gauss_stress_mpa.len(),
        reference.hex_gauss_stress_mpa.len()
    );
    assert_eq!(
        actual.truss_axial_force_kn.len(),
        reference.truss_axial_force_kn.len()
    );
    for (node, (displacement, expected)) in actual
        .nodal_displacements_m
        .iter()
        .zip(&reference.nodal_displacements_m)
        .enumerate()
    {
        for axis in 0..3 {
            assert_close(
                displacement[axis],
                expected[axis],
                1e-10,
                1e-8,
                &format!("node {node} displacement axis {axis}"),
            );
            assert_close(
                actual.nodal_reactions_kn[node][axis],
                reference.nodal_reactions_kn[node][axis],
                1e-5,
                1e-8,
                &format!("node {node} reaction axis {axis}"),
            );
        }
    }
    for (element, (stress, expected)) in actual
        .solid_element_stress_mpa
        .iter()
        .zip(&reference.solid_element_stress_mpa)
        .enumerate()
    {
        for component in 0..6 {
            assert_close(
                stress[component],
                expected[component],
                1e-7,
                1e-8,
                &format!("tet {element} stress component {component}"),
            );
        }
    }
    for (element, (gauss_points, expected_points)) in actual
        .hex_gauss_stress_mpa
        .iter()
        .zip(&reference.hex_gauss_stress_mpa)
        .enumerate()
    {
        for (point, (stress, expected)) in gauss_points.iter().zip(expected_points).enumerate() {
            for component in 0..6 {
                assert_close(
                    stress[component],
                    expected[component],
                    1e-7,
                    1e-8,
                    &format!("hex {element} Gauss point {point} component {component}"),
                );
            }
        }
    }
    for (element, (&force, &expected)) in actual
        .truss_axial_force_kn
        .iter()
        .zip(&reference.truss_axial_force_kn)
        .enumerate()
    {
        assert_close(
            force,
            expected,
            1e-6,
            1e-8,
            &format!("truss {element} axial force"),
        );
    }
}

#[test]
fn automatic_prefers_matrix_free_pcg_when_it_converges() {
    let direct = solve_fixture("dense", None);
    let automatic = solve_fixture("automatic", None);
    assert_eq!(automatic.backend_used, Mixed3dBackend::MatrixFreePcg);
    assert!(automatic.linear_iterations > 1);
    assert!(automatic.relative_residual < 1e-8);
    assert_same_solution(&automatic, &direct);
}

#[test]
fn automatic_recovers_from_one_iteration_limit_with_frontal_wave() {
    let explicit = solve_native_fem(fixture("matrixFreePcg", Some(1)))
        .expect_err("one PCG iteration must not converge for the mixed fixture");
    assert!(
        explicit.to_lowercase().contains("converg"),
        "unexpected explicit PCG failure: {explicit}"
    );

    let direct = solve_fixture("dense", None);
    let automatic = solve_fixture("automatic", Some(1));
    assert_eq!(automatic.backend_used, Mixed3dBackend::FrontalWave);
    assert!(automatic.frontal_maximum_front_dofs.is_some());
    assert!(automatic.relative_residual < 1e-8);
    assert_same_solution(&automatic, &direct);
}

#[test]
fn automatic_does_not_hide_invalid_input_behind_fallback() {
    let mut request = fixture("automatic", Some(1));
    let NativeFemRequest::Mixed3d(ref mut input) = request else {
        panic!("fixture did not parse as mixed3d");
    };
    input.trusses[0].area_m2 = 0.0;
    let error = solve_native_fem(request).expect_err("invalid truss must be rejected");
    assert!(
        error.contains("truss 0") && error.contains("area"),
        "invalid model error was lost: {error}"
    );
}
