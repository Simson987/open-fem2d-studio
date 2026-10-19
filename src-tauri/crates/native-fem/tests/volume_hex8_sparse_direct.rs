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
fn sparse_direct_cube_matches_independent_uniaxial_solution() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::SparseDirect;
    assert_eq!(
        serde_json::to_value(&model).unwrap()["linearBackend"],
        "sparseDirect"
    );
    let solved = solve_hex8_volume(model.clone()).unwrap();
    assert_eq!(solved.solver_used, "sparseDirect");
    assert_eq!(solved.iterations, 0);
    assert!(solved.csr_nonzeros > 0);
    assert!(solved.frontal_maximum_front_dofs.is_none());
    assert!(solved.relative_residual < 1e-10);

    for (node, point) in model.nodes.iter().enumerate() {
        let expected = [0.001 * point[0], -0.0003 * point[1], -0.0003 * point[2]];
        for axis in 0..3 {
            close(
                solved.nodal_displacements_m[node][axis],
                expected[axis],
                1e-11,
            );
        }
    }
    for stress in solved.element_gauss_stress_mpa.iter().flatten() {
        close(stress[0], 210.0, 1e-7);
        for value in &stress[1..] {
            close(*value, 0.0, 1e-7);
        }
    }
    close(
        solved.nodal_reactions_kn.iter().map(|f| f[0]).sum(),
        -210_000.0,
        1e-5,
    );
}

#[test]
fn sparse_direct_warped_heterogeneous_two_cell_loads_match_csr() {
    let mut model = uniaxial_cube_example();
    model.nodes.extend_from_slice(&[
        [2.10, -0.03, 0.04],
        [2.06, 1.08, -0.02],
        [2.02, 0.01, 1.09],
        [2.14, 0.95, 1.04],
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
        node: 11,
        force_kn: [150.0, -36.0, 22.0],
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
    model.linear_backend = Hex8LinearBackend::SparseDirect;
    let direct = solve_hex8_volume(model).unwrap();
    assert_eq!(direct.solver_used, "sparseDirect");
    assert!(direct.relative_residual < 1e-9);
    for (actual, expected) in direct
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(csr.nodal_displacements_m.iter().flatten())
    {
        close(*actual, *expected, 1e-10);
    }
    for (actual, expected) in direct
        .nodal_reactions_kn
        .iter()
        .flatten()
        .zip(csr.nodal_reactions_kn.iter().flatten())
    {
        close(*actual, *expected, 1e-5);
    }
    for (actual, expected) in direct
        .element_gauss_stress_mpa
        .iter()
        .flatten()
        .flatten()
        .zip(csr.element_gauss_stress_mpa.iter().flatten().flatten())
    {
        close(*actual, *expected, 1e-7);
    }
}

#[test]
fn sparse_direct_rejects_mechanism_and_dimension_above_budget() {
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::SparseDirect;
    model.supports.truncate(1);
    let error = solve_hex8_volume(model).unwrap_err();
    assert!(
        error.contains("rigid-body") || error.contains("pivot"),
        "{error}"
    );

    // A valid 12×12×11-cell box has 2,028 nodes and 6,084 DOFs. The
    // direct route refuses it before factorization or global assembly.
    let mut model = uniaxial_cube_example();
    model.linear_backend = Hex8LinearBackend::SparseDirect;
    model.nodes.clear();
    model.elements.clear();
    let index = |i: usize, j: usize, k: usize| i + 13 * j + 13 * 13 * k;
    for k in 0..12 {
        for j in 0..13 {
            for i in 0..13 {
                model.nodes.push([i as f64, j as f64, k as f64]);
            }
        }
    }
    for k in 0..11 {
        for j in 0..12 {
            for i in 0..12 {
                model.elements.push(Hex8VolumeCell {
                    nodes: [
                        index(i, j, k),
                        index(i + 1, j, k),
                        index(i + 1, j + 1, k),
                        index(i, j + 1, k),
                        index(i, j, k + 1),
                        index(i + 1, j, k + 1),
                        index(i + 1, j + 1, k + 1),
                        index(i, j + 1, k + 1),
                    ],
                    material: 0,
                });
            }
        }
    }
    assert_eq!(model.nodes.len() * 3, 6_084);
    assert_eq!(model.elements.len(), 1_584);
    let error = solve_hex8_volume(model).unwrap_err();
    assert!(
        error.contains("sparseDirect is limited to 6000 DOFs"),
        "{error}"
    );
}
