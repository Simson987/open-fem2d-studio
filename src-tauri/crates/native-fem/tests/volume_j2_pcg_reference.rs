//! Opt-in J2/CSR-PCG validation against an independent affine bar solution.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{
    solve, J2TetLinearBackend, J2TetOptions, J2TetRequest, J2TetTarget,
};

fn affine_request(cells: [usize; 3], strain: f64, yield_mpa: f64) -> J2TetRequest {
    let mesh = Mesh::structured(cells).unwrap();
    let target = J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                [
                    if point[0] == 0.0 || point[0] == 1.0 {
                        Some(strain * point[0])
                    } else {
                        None
                    },
                    Some(0.0),
                    Some(0.0),
                ]
            })
            .collect(),
    };
    J2TetRequest {
        mesh,
        steel: J2Steel::new(200_000.0, 0.0, yield_mpa, 2_000.0).unwrap(),
        element_steels: None,
        targets: vec![target],
        options: J2TetOptions::default(),
    }
}

// Independent diagonal small-strain J2 radial return for a single increment.
// Solve transverse plane-strain equilibrium sigma_yy(a,b,0)=0 by bisection.
fn plane_strain_layer(steel: J2Steel, axial_strain: f64) -> (f64, f64, f64, f64) {
    let response = |transverse_strain: f64| {
        let strain = [axial_strain, transverse_strain, 0.0];
        let trace = strain.iter().sum::<f64>();
        let mu = steel.youngs_mpa / (2.0 * (1.0 + steel.poisson));
        let bulk = steel.youngs_mpa / (3.0 * (1.0 - 2.0 * steel.poisson));
        let deviator = strain.map(|value| 2.0 * mu * (value - trace / 3.0));
        let trial_q = (1.5 * deviator.iter().map(|value| value * value).sum::<f64>()).sqrt();
        let plastic = ((trial_q - steel.yield_mpa) / (3.0 * mu + steel.hardening_mpa)).max(0.0);
        let radial = if plastic == 0.0 {
            1.0
        } else {
            (steel.yield_mpa + steel.hardening_mpa * plastic) / trial_q
        };
        let stress = deviator.map(|value| bulk * trace + radial * value);
        (stress, plastic)
    };
    let (mut lo, mut hi) = (-axial_strain, axial_strain);
    assert!(response(lo).0[1] < 0.0 && response(hi).0[1] > 0.0);
    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        if response(mid).0[1] < 0.0 {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let transverse = 0.5 * (lo + hi);
    let (stress, plastic) = response(transverse);
    assert!(stress[1].abs() < 1e-10);
    (transverse, stress[0], stress[2], plastic)
}

fn plane_strain_laminate_request(cells: [usize; 3]) -> (J2TetRequest, [J2Steel; 2]) {
    let mut request = affine_request(cells, 0.003, 100.0);
    let steels = [
        J2Steel::new(200_000.0, 0.2, 100.0, 2_000.0).unwrap(),
        J2Steel::new(100_000.0, 0.3, 150.0, 4_000.0).unwrap(),
    ];
    request.element_steels = Some(
        request
            .mesh
            .tets
            .iter()
            .map(|tet| {
                let y = tet
                    .iter()
                    .map(|&node| request.mesh.nodes[node][1])
                    .sum::<f64>()
                    / 4.0;
                if y < 0.4 {
                    steels[0]
                } else {
                    steels[1]
                }
            })
            .collect(),
    );
    for (point, prescribed) in request
        .mesh
        .nodes
        .iter()
        .zip(&mut request.targets[0].prescribed_m)
    {
        prescribed[1] = if point[1] == 0.0 { Some(0.0) } else { None };
    }
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.options.pcg_threads = 4;
    request.options.residual_tolerance = 1e-7;
    (request, steels)
}

fn check_plane_strain_laminate(
    request: &J2TetRequest,
    steels: [J2Steel; 2],
    result: &openaec_native_fem::volume3d_j2::J2TetResult,
) -> (f64, f64, f64, f64) {
    // A split load path has its own committed plastic history and requires
    // incremental reference integration rather than this virgin-state law.
    assert_eq!(result.accepted_steps.len(), 1);
    assert_eq!(result.cutbacks, 0);
    let lower = plane_strain_layer(steels[0], 0.003);
    let upper = plane_strain_layer(steels[1], 0.003);
    assert!(lower.3 > 0.0 && upper.3 > 0.0);
    let mut max_displacement_error = 0.0_f64;
    let mut right_reaction = 0.0_f64;
    let mut left_reaction = 0.0_f64;
    let mut bottom_z_reaction = 0.0_f64;
    let mut top_z_reaction = 0.0_f64;
    let mut anchored_y_reaction = 0.0_f64;
    for (node, point) in request.mesh.nodes.iter().enumerate() {
        let expected_y = if point[1] <= 0.4 {
            lower.0 * point[1]
        } else {
            lower.0 * 0.4 + upper.0 * (point[1] - 0.4)
        };
        let u = result.nodal_displacements_m[node];
        max_displacement_error = max_displacement_error
            .max((u[0] - 0.003 * point[0]).abs())
            .max((u[1] - expected_y).abs())
            .max(u[2].abs());
        if point[0] == 1.0 {
            right_reaction += result.nodal_reactions_kn[node][0];
        }
        if point[0] == 0.0 {
            left_reaction += result.nodal_reactions_kn[node][0];
        }
        if point[2] == 0.0 {
            bottom_z_reaction += result.nodal_reactions_kn[node][2];
        }
        if point[2] == 1.0 {
            top_z_reaction += result.nodal_reactions_kn[node][2];
        }
        if point[1] == 0.0 {
            anchored_y_reaction += result.nodal_reactions_kn[node][1];
        }
    }
    let mut max_stress_error = 0.0_f64;
    let mut max_plastic_error = 0.0_f64;
    let mut lower_count = 0_usize;
    for (state, steel) in result
        .element_states
        .iter()
        .zip(request.element_steels.as_ref().unwrap())
    {
        let expected = if steel.youngs_mpa == steels[0].youngs_mpa {
            lower_count += 1;
            lower
        } else {
            upper
        };
        max_stress_error = max_stress_error
            .max((state.stress_mpa[0][0] - expected.1).abs())
            .max(state.stress_mpa[1][1].abs())
            .max((state.stress_mpa[2][2] - expected.2).abs());
        max_plastic_error =
            max_plastic_error.max((state.equivalent_plastic_strain - expected.3).abs());
    }
    let expected_reaction = 1_000.0 * (0.4 * lower.1 + 0.6 * upper.1);
    let expected_z_reaction = 1_000.0 * (0.4 * lower.2 + 0.6 * upper.2);
    assert_eq!(lower_count * 5, request.mesh.tets.len() * 2);
    assert!(
        max_displacement_error < 2e-8,
        "displacement error {max_displacement_error}"
    );
    assert!(max_stress_error < 0.01, "stress error {max_stress_error}");
    assert!(
        max_plastic_error < 1e-7,
        "plastic error {max_plastic_error}"
    );
    assert!(
        (right_reaction - expected_reaction).abs() < 1.0,
        "right reaction {right_reaction}, expected {expected_reaction}"
    );
    assert!((left_reaction + expected_reaction).abs() < 1.0);
    assert!((top_z_reaction - expected_z_reaction).abs() < 1.0);
    assert!((bottom_z_reaction + expected_z_reaction).abs() < 1.0);
    assert!(anchored_y_reaction.abs() < 1.0);
    assert!(
        result.true_free_residual_kn < 0.1,
        "residual {}",
        result.true_free_residual_kn
    );
    (
        max_displacement_error,
        max_stress_error,
        max_plastic_error,
        right_reaction,
    )
}

#[test]
fn j2_pcg_plane_strain_laminate_has_free_y_interface_and_exact_stress_jump() {
    let (request, steels) = plane_strain_laminate_request([2, 5, 2]);
    let result = solve(&request).unwrap();
    check_plane_strain_laminate(&request, steels, &result);
    let mut direct_request = request.clone();
    direct_request.options.linear_backend = J2TetLinearBackend::SparseDirect;
    let direct = solve(&direct_request).unwrap();
    check_plane_strain_laminate(&direct_request, steels, &direct);
    assert_eq!(direct.accepted_steps.len(), result.accepted_steps.len());
}

#[test]
fn j2_pcg_medium_plane_strain_laminate_matches_reference() {
    let (request, steels) = plane_strain_laminate_request([10, 10, 10]);
    let result = solve(&request).unwrap();
    check_plane_strain_laminate(&request, steels, &result);
}

#[test]
#[ignore = "257,250-element free-interface J2/CSR-PCG release acceptance; run explicitly"]
fn j2_pcg_257k_free_interface_laminate_matches_plane_strain_reference() {
    let (request, steels) = plane_strain_laminate_request([35, 35, 35]);
    assert_eq!(request.mesh.tets.len(), 257_250);
    assert_eq!(request.mesh.nodes.len() * 3, 139_968);
    let start = std::time::Instant::now();
    let result = solve(&request).unwrap();
    let (du, ds, dp, reaction) = check_plane_strain_laminate(&request, steels, &result);
    eprintln!("J2 free-interface laminate 257250 Tet4/139968 DOF: displacement error {du:.3e} m, stress error {ds:.3e} MPa, plastic error {dp:.3e}, right reaction {reaction:.6e} kN, residual {:.3e} kN, {:.3}s",
        result.true_free_residual_kn, start.elapsed().as_secs_f64());
}

#[test]
fn j2_pcg_solves_more_than_direct_limit_against_affine_exact_solution() {
    let mut request = affine_request([8, 8, 7], 0.0005, 250.0);
    assert_eq!(request.mesh.nodes.len() * 3, 1_944);
    assert_eq!(request.mesh.tets.len(), 2_688);
    assert!(solve(&request).unwrap_err().contains("limit"));
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.options.pcg_threads = 4;
    let result = solve(&request).unwrap();
    assert_eq!(result.linear_backend_used, J2TetLinearBackend::SparsePcg);
    assert!(
        result.true_free_residual_kn < 1e-4,
        "{}",
        result.true_free_residual_kn
    );
    let mut right_reaction = 0.0;
    let mut left_reaction = 0.0;
    for (node, point) in request.mesh.nodes.iter().enumerate() {
        let exact = 0.0005 * point[0];
        assert!(
            (result.nodal_displacements_m[node][0] - exact).abs() < 2e-9,
            "node {node}: {} vs {exact}",
            result.nodal_displacements_m[node][0]
        );
        if point[0] == 1.0 {
            right_reaction += result.nodal_reactions_kn[node][0];
        }
        if point[0] == 0.0 {
            left_reaction += result.nodal_reactions_kn[node][0];
        }
    }
    // E*epsilon=100 MPa, unit face area, and 1 MPa*m² = 1000 kN.
    assert!((right_reaction - 100_000.0).abs() < 0.1, "{right_reaction}");
    assert!((left_reaction + 100_000.0).abs() < 0.1, "{left_reaction}");
    for state in &result.element_states {
        assert!((state.stress_mpa[0][0] - 100.0).abs() < 0.001);
        assert_eq!(state.equivalent_plastic_strain, 0.0);
    }
}

#[test]
fn j2_pcg_large_plastic_patch_matches_independent_radial_return() {
    let mut request = affine_request([8, 8, 7], 0.003, 100.0);
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.options.pcg_threads = 4;
    let result = solve(&request).unwrap();
    let e = 200_000.0;
    let h = 2_000.0;
    let strain = 0.003;
    let q_trial = e * strain; // nu=0: q_trial=2G*epsilon=E*epsilon.
    let expected_p = (q_trial - 100.0) / (1.5 * e + h);
    let q_returned = 100.0 + h * expected_p;
    let expected_sigma_x = e * strain / 3.0 + 2.0 * q_returned / 3.0;
    let mut right_reaction = 0.0;
    for (node, point) in request.mesh.nodes.iter().enumerate() {
        assert!((result.nodal_displacements_m[node][0] - strain * point[0]).abs() < 3e-9);
        if point[0] == 1.0 {
            right_reaction += result.nodal_reactions_kn[node][0];
        }
    }
    assert!(
        (right_reaction - 1_000.0 * expected_sigma_x).abs() < 0.2,
        "right reaction {right_reaction}, expected {}",
        1_000.0 * expected_sigma_x
    );
    for state in &result.element_states {
        assert!((state.equivalent_plastic_strain - expected_p).abs() < 1e-7);
        assert!((state.stress_mpa[0][0] - expected_sigma_x).abs() < 0.002);
    }
    assert!(result.true_free_residual_kn < 1e-4);
}

#[test]
fn j2_pcg_matches_direct_on_plastic_load_and_unload() {
    let mut request = affine_request([3, 1, 1], 0.003, 100.0);
    let mut unload = request.targets[0].clone();
    for point in &mut unload.prescribed_m {
        if point[0].is_some() {
            point[0] = Some(0.0);
        }
    }
    request.targets.push(unload);
    let direct = solve(&request).unwrap();
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    let pcg = solve(&request).unwrap();
    assert!(pcg
        .element_states
        .iter()
        .any(|state| state.equivalent_plastic_strain > 0.0));
    for (a, b) in direct
        .nodal_displacements_m
        .iter()
        .zip(&pcg.nodal_displacements_m)
    {
        for component in 0..3 {
            assert!((a[component] - b[component]).abs() < 1e-9);
        }
    }
    for (a, b) in direct
        .nodal_reactions_kn
        .iter()
        .zip(&pcg.nodal_reactions_kn)
    {
        for component in 0..3 {
            assert!((a[component] - b[component]).abs() < 1e-4);
        }
    }
    for (a, b) in direct.element_states.iter().zip(&pcg.element_states) {
        assert!((a.equivalent_plastic_strain - b.equivalent_plastic_strain).abs() < 1e-8);
    }
}

#[test]
fn j2_pcg_requires_positive_hardening() {
    let mut request = affine_request([1, 1, 1], 0.0005, 250.0);
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.steel.hardening_mpa = 0.0;
    assert!(solve(&request).unwrap_err().contains("positive hardening"));
}

#[test]
fn j2_pcg_rejects_a_hidden_vertex_hinge_even_with_zero_load() {
    let mut request = affine_request([1, 1, 1], 0.0, 250.0);
    request.mesh = Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, -1.0, 0.0],
            [0.0, 0.0, -1.0],
            [-1.0, 0.0, 0.0],
        ],
        tets: vec![[0, 1, 2, 3], [0, 4, 5, 6]],
    };
    let mut prescribed = vec![[None; 3]; request.mesh.nodes.len()];
    prescribed[0] = [Some(0.0); 3];
    prescribed[1][1] = Some(0.0);
    prescribed[1][2] = Some(0.0);
    prescribed[2][2] = Some(0.0);
    request.targets = vec![J2TetTarget {
        loads_kn: vec![[0.0; 3]; request.mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: prescribed,
    }];
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    let error = solve(&request).unwrap_err();
    assert!(
        error.contains("face-connected group") && error.contains("rank"),
        "{error}"
    );
}

#[test]
#[ignore = "257,250-element J2/CSR-PCG release acceptance; run explicitly"]
fn j2_pcg_257k_tet_acceptance_matches_exact_elastic_patch() {
    let mut request = affine_request([35, 35, 35], 0.0005, 250.0);
    assert_eq!(request.mesh.tets.len(), 257_250);
    assert_eq!(request.mesh.nodes.len() * 3, 139_968);
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.options.pcg_threads = 4;
    let start = std::time::Instant::now();
    let result = solve(&request).unwrap();
    let max_displacement_error = request
        .mesh
        .nodes
        .iter()
        .enumerate()
        .map(|(node, point)| (result.nodal_displacements_m[node][0] - 0.0005 * point[0]).abs())
        .fold(0.0_f64, f64::max);
    let right_reaction = request
        .mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum::<f64>();
    let max_stress_error = result
        .element_states
        .iter()
        .map(|state| (state.stress_mpa[0][0] - 100.0).abs())
        .fold(0.0_f64, f64::max);
    eprintln!("J2 257250 Tet4/139968 DOF: {} steps, displacement error {max_displacement_error:.3e} m, stress error {max_stress_error:.3e} MPa, right reaction {right_reaction:.6e} kN, residual {:.3e} kN, {:.3}s",
        result.accepted_steps.len(), result.true_free_residual_kn, start.elapsed().as_secs_f64());
    assert!(max_displacement_error < 2e-8);
    assert!(max_stress_error < 0.01);
    assert!((right_reaction - 100_000.0).abs() < 1.0);
    assert!(result.true_free_residual_kn < 0.1);
}

#[test]
#[ignore = "257,250-element plastic J2/CSR-PCG release acceptance; run explicitly"]
fn j2_pcg_257k_tet_plastic_acceptance_matches_radial_return() {
    let mut request = affine_request([35, 35, 35], 0.003, 100.0);
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.options.pcg_threads = 4;
    let start = std::time::Instant::now();
    let result = solve(&request).unwrap();
    let expected_p = (200_000.0 * 0.003 - 100.0) / (300_000.0 + 2_000.0);
    let expected_sigma_x = 200_000.0 * 0.003 / 3.0 + 2.0 * (100.0 + 2_000.0 * expected_p) / 3.0;
    let max_displacement_error = request
        .mesh
        .nodes
        .iter()
        .enumerate()
        .map(|(node, point)| (result.nodal_displacements_m[node][0] - 0.003 * point[0]).abs())
        .fold(0.0_f64, f64::max);
    let max_plastic_error = result
        .element_states
        .iter()
        .map(|state| (state.equivalent_plastic_strain - expected_p).abs())
        .fold(0.0_f64, f64::max);
    let max_stress_error = result
        .element_states
        .iter()
        .map(|state| (state.stress_mpa[0][0] - expected_sigma_x).abs())
        .fold(0.0_f64, f64::max);
    let right_reaction = request
        .mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum::<f64>();
    eprintln!("J2 plastic 257250 Tet4/139968 DOF: {} steps, displacement error {max_displacement_error:.3e} m, plastic error {max_plastic_error:.3e}, stress error {max_stress_error:.3e} MPa, right reaction {right_reaction:.6e} kN, residual {:.3e} kN, {:.3}s",
        result.accepted_steps.len(), result.true_free_residual_kn, start.elapsed().as_secs_f64());
    assert!(max_displacement_error < 2e-8);
    assert!(max_plastic_error < 1e-7);
    assert!(max_stress_error < 0.01);
    assert!((right_reaction - 1_000.0 * expected_sigma_x).abs() < 1.0);
    assert!(result.true_free_residual_kn < 0.1);
}

#[test]
#[ignore = "257,250-element heterogeneous plastic J2/CSR-PCG release acceptance; run explicitly"]
fn j2_pcg_257k_heterogeneous_plastic_series_matches_independent_solution() {
    let mut request = affine_request([35, 35, 35], 0.0, 100.0);
    let left = J2Steel::new(200_000.0, 0.0, 100.0, 2_000.0).unwrap();
    let right = J2Steel::new(100_000.0, 0.0, 150.0, 4_000.0).unwrap();
    let stress = 250.0;
    let series_strain = |steel: J2Steel| {
        let e = steel.youngs_mpa;
        let y = steel.yield_mpa;
        let h = steel.hardening_mpa;
        let denom = 1.5 * e + h;
        // sigma_x = E*epsilon/3 + 2*(Y + H*(E*epsilon-Y)/denom)/3
        (stress - 2.0 * (y - h * y / denom) / 3.0) / (e / 3.0 + 2.0 * h * e / (3.0 * denom))
    };
    let left_strain = series_strain(left);
    let right_strain = series_strain(right);
    let right_displacement = 0.4 * left_strain + 0.6 * right_strain;
    for (point, prescribed) in request
        .mesh
        .nodes
        .iter()
        .zip(&mut request.targets[0].prescribed_m)
    {
        if point[0] == 1.0 {
            prescribed[0] = Some(right_displacement);
        }
    }
    request.element_steels = Some(
        request
            .mesh
            .tets
            .iter()
            .map(|tet| {
                let x = tet
                    .iter()
                    .map(|&node| request.mesh.nodes[node][0])
                    .sum::<f64>()
                    / 4.0;
                if x < 0.4 {
                    left
                } else {
                    right
                }
            })
            .collect(),
    );
    request.options.linear_backend = J2TetLinearBackend::SparsePcg;
    request.options.pcg_threads = 4;
    let start = std::time::Instant::now();
    let result = solve(&request).unwrap();
    let mut max_displacement_error = 0.0_f64;
    let mut end_reaction = 0.0;
    for (node, point) in request.mesh.nodes.iter().enumerate() {
        let expected = if point[0] <= 0.4 {
            point[0] * left_strain
        } else {
            0.4 * left_strain + (point[0] - 0.4) * right_strain
        };
        max_displacement_error =
            max_displacement_error.max((result.nodal_displacements_m[node][0] - expected).abs());
        if point[0] == 1.0 {
            end_reaction += result.nodal_reactions_kn[node][0];
        }
    }
    let mut max_stress_error = 0.0_f64;
    let mut max_plastic_error = 0.0_f64;
    for (state, steel) in result
        .element_states
        .iter()
        .zip(request.element_steels.as_ref().unwrap())
    {
        let strain = if steel.youngs_mpa == left.youngs_mpa {
            left_strain
        } else {
            right_strain
        };
        let expected_p = (steel.youngs_mpa * strain - steel.yield_mpa)
            / (1.5 * steel.youngs_mpa + steel.hardening_mpa);
        max_stress_error = max_stress_error.max((state.stress_mpa[0][0] - stress).abs());
        max_plastic_error =
            max_plastic_error.max((state.equivalent_plastic_strain - expected_p).abs());
    }
    eprintln!("J2 heterogeneous plastic 257250 Tet4/139968 DOF: displacement error {max_displacement_error:.3e} m, plastic error {max_plastic_error:.3e}, stress error {max_stress_error:.3e} MPa, right reaction {end_reaction:.6e} kN, residual {:.3e} kN, {:.3}s",
        result.true_free_residual_kn, start.elapsed().as_secs_f64());
    assert!(max_displacement_error < 2e-8);
    assert!(max_plastic_error < 1e-7);
    assert!(max_stress_error < 0.01);
    assert!((end_reaction - 250_000.0).abs() < 1.0);
    assert!(result.true_free_residual_kn < 0.1);
}
