use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, uniaxial_cube_example, Hex8LinearBackend, Hex8VolumeLoad,
};

#[test]
fn automatic_small_cube_uses_csr_and_reports_actual_backend() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::Automatic;
    let solved = solve_hex8_volume(model).unwrap();
    assert_eq!(solved.solver_used, "sparse");
    assert!(solved.csr_nonzeros > 0);
    assert!(solved.frontal_maximum_front_dofs.is_none());
    assert!((solved.nodal_displacements_m[1][0] - 0.001).abs() < 1e-11);
    assert!(solved.relative_residual < 1e-9);
}

#[test]
fn automatic_retries_pcg_nonconvergence_with_bounded_frontal_solve() {
    let mut model = uniaxial_cube_example();
    model.loads = vec![Hex8VolumeLoad {
        node: 6,
        force_kn: [100.0, 37.0, -19.0],
    }];
    model.max_iterations = 1;
    model.tolerance = 1e-10;

    let sparse_error = solve_hex8_volume(model.clone()).unwrap_err();
    assert!(sparse_error.contains("did not converge"), "{sparse_error}");

    model.linear_backend = Hex8LinearBackend::Automatic;
    let solved = solve_hex8_volume(model.clone()).unwrap();
    assert_eq!(solved.solver_used, "frontalWave");
    assert_eq!(solved.csr_nonzeros, 0);
    assert!(solved.frontal_maximum_front_dofs.unwrap() <= 256);
    assert!(solved.relative_residual < 1e-10);

    model.linear_backend = Hex8LinearBackend::FrontalWave;
    let reference = solve_hex8_volume(model).unwrap();
    for (actual, expected) in solved
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(reference.nodal_displacements_m.iter().flatten())
    {
        assert!((actual - expected).abs() < 1e-12);
    }
}

#[test]
fn automatic_rejects_support_mechanism_without_successful_fallback() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::Automatic;
    model.supports.truncate(1);
    let error = solve_hex8_volume(model).unwrap_err();
    assert!(
        error.contains("rigid-body") || error.contains("pivot"),
        "{error}"
    );
    assert!(!error.contains("frontal recovery failed"), "{error}");
}

#[test]
fn automatic_does_not_reinterpret_structured_fast_path() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::Automatic;
    model.structured_grid_cells = Some([1, 1, 1]);
    assert!(solve_hex8_volume(model)
        .unwrap_err()
        .contains("cannot be combined"));
}
