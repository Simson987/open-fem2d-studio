use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, uniaxial_cube_example, Hex8LinearBackend, Hex8VolumeBodyForce,
    Hex8VolumeCell, Hex8VolumeFaceTraction, Hex8VolumeLoad, Hex8VolumeMaterial,
};

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
    );
}

#[test]
fn frontal_cube_matches_affine_solution_reactions_and_csr() {
    let mut model = uniaxial_cube_example();
    // A rigid translation of the exact uniaxial solution exercises nonzero
    // prescribed values without changing the analytical stress or reactions.
    for support in &mut model.supports {
        if support.displacement_m[0].is_some() {
            support.displacement_m[0] = Some(0.0001);
        }
    }
    let csr = solve_hex8_volume(model.clone()).unwrap();
    model.linear_backend = Hex8LinearBackend::FrontalWave;
    let frontal = solve_hex8_volume(model.clone()).unwrap();
    assert_eq!(frontal.solver_used, "frontalWave");
    assert_eq!(frontal.iterations, 0);
    assert_eq!(frontal.csr_nonzeros, 0);
    assert!(frontal.frontal_maximum_front_dofs.unwrap() > 0);
    assert!(frontal.relative_residual < 1e-9);
    for (node, point) in model.nodes.iter().enumerate() {
        let expected = [
            0.0001 + 0.001 * point[0],
            -0.0003 * point[1],
            -0.0003 * point[2],
        ];
        for axis in 0..3 {
            close(
                frontal.nodal_displacements_m[node][axis],
                expected[axis],
                1e-11,
            );
            close(
                frontal.nodal_displacements_m[node][axis],
                csr.nodal_displacements_m[node][axis],
                1e-11,
            );
            close(
                frontal.nodal_reactions_kn[node][axis],
                csr.nodal_reactions_kn[node][axis],
                1e-5,
            );
        }
    }
    for gauss in frontal.element_gauss_stress_mpa.iter().flatten() {
        close(gauss[0], 210.0, 1e-6);
        for component in &gauss[1..] {
            close(*component, 0.0, 1e-6);
        }
    }
    close(
        frontal
            .nodal_reactions_kn
            .iter()
            .map(|force| force[0])
            .sum(),
        -210_000.0,
        1e-5,
    );
}

#[test]
fn frontal_two_material_mixed_loads_match_csr_and_global_force_balance() {
    let mut model = uniaxial_cube_example();
    model.nodes.extend_from_slice(&[
        [2.0, 0.0, 0.0],
        [2.0, 1.0, 0.0],
        [2.0, 0.0, 1.0],
        [2.0, 1.0, 1.0],
    ]);
    model.materials.push(Hex8VolumeMaterial {
        e_mpa: 105_000.0,
        poisson: 0.25,
    });
    model.elements.push(Hex8VolumeCell {
        nodes: [1, 8, 9, 2, 5, 10, 11, 6],
        material: 1,
    });
    model.loads = vec![Hex8VolumeLoad {
        node: 8,
        force_kn: [100.0, 20.0, -10.0],
    }];
    model.body_forces = vec![Hex8VolumeBodyForce {
        element: 1,
        force_kn_per_m3: [4.0, 2.0, -3.0],
    }];
    model.face_tractions = vec![Hex8VolumeFaceTraction {
        element: 1,
        face_nodes: [1, 2, 6, 5],
        traction_kn_per_m2: [12.0, -4.0, 6.0],
    }];
    for support in &mut model.supports {
        if support.displacement_m[0].is_some() {
            support.displacement_m[0] = Some(0.0001);
        }
    }
    let csr = solve_hex8_volume(model.clone()).unwrap();
    model.linear_backend = Hex8LinearBackend::FrontalWave;
    let frontal = solve_hex8_volume(model).unwrap();
    assert_eq!(frontal.solver_used, "frontalWave");
    assert!(frontal.relative_residual < 1e-9);
    for (a, b) in frontal
        .nodal_displacements_m
        .iter()
        .zip(&csr.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-11);
        }
    }
    for (a, b) in frontal
        .nodal_reactions_kn
        .iter()
        .zip(&csr.nodal_reactions_kn)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-6);
        }
    }
    for (a, b) in frontal
        .element_gauss_stress_mpa
        .iter()
        .flatten()
        .zip(csr.element_gauss_stress_mpa.iter().flatten())
    {
        for axis in 0..6 {
            close(a[axis], b[axis], 1e-7);
        }
    }
    let expected = [-116.0, -18.0, 7.0];
    for (axis, force) in expected.into_iter().enumerate() {
        close(
            frontal
                .nodal_reactions_kn
                .iter()
                .map(|reaction| reaction[axis])
                .sum(),
            force,
            1e-6,
        );
    }
}

#[test]
fn frontal_rejects_unrestrained_rotation_and_bounded_size() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::FrontalWave;
    model.supports.truncate(1);
    let error = solve_hex8_volume(model.clone()).unwrap_err();
    assert!(
        error.contains("pivot") || error.contains("rigid-body"),
        "{error}"
    );

    let original = model.elements[0];
    model.elements = vec![original; 2_501];
    let error = solve_hex8_volume(model).unwrap_err();
    assert!(error.contains("limited"), "{error}");
}

#[test]
fn explicit_frontal_cannot_silently_select_matrix_free() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::FrontalWave;
    model.structured_grid_cells = Some([1, 1, 1]);
    assert!(solve_hex8_volume(model)
        .unwrap_err()
        .contains("cannot be combined"));
}
