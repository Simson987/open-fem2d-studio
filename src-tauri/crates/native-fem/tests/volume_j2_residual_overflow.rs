//! Independent one-DOF Tet4 checks for J2 residual scaling.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{solve, J2TetOptions, J2TetRequest, J2TetTarget};

fn one_free_dof_request(load_kn: f64) -> J2TetRequest {
    let mesh = Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        tets: vec![[0, 1, 2, 3]],
    };
    let mut loads_kn = vec![[0.0; 3]; 4];
    loads_kn[1][0] = load_kn;
    let mut prescribed_m = vec![[Some(0.0); 3]; 4];
    prescribed_m[1][0] = None;
    J2TetRequest {
        mesh,
        steel: J2Steel::new(210_000.0, 0.3, 1e9, 1_000.0).unwrap(),
        element_steels: None,
        targets: vec![J2TetTarget {
            loads_kn,
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m,
        }],
        options: J2TetOptions::default(),
    }
}

#[test]
fn finite_load_that_overflows_squared_norm_never_converges_at_zero_displacement() {
    let mut request = one_free_dof_request(1e200);
    request.options.max_newton_iterations = 1;
    request.options.max_step_cutbacks = 1;
    request.options.min_step_fraction = 0.5;
    assert!(
        solve(&request).is_err(),
        "unbalanced 1e200 kN load was accepted"
    );
}

#[test]
fn ordinary_elastic_load_matches_independent_tet_stiffness() {
    let request = one_free_dof_request(1.0);
    let result = solve(&request).unwrap();
    let e = request.steel.youngs_mpa;
    let nu = request.steel.poisson;
    let constrained_modulus = e * (1.0 - nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    // Only node 1 x is free: B_xx = 1 and V = 1/6 m³.
    let stiffness_kn_per_m = 1_000.0 * constrained_modulus / 6.0;
    let expected_u = 1.0 / stiffness_kn_per_m;
    assert!((result.nodal_displacements_m[1][0] - expected_u).abs() < 1e-13);
    assert!(result.true_free_residual_kn < 1e-9);
}

#[test]
fn finite_opposite_support_loads_interpolate_without_overflow() {
    let mut request = one_free_dof_request(0.0);
    let mut first = request.targets[0].clone();
    first.prescribed_m[1][0] = Some(0.0);
    first.loads_kn[0][0] = 1e308;
    let mut second = first.clone();
    second.loads_kn[0][0] = -1e308;
    request.targets = vec![first, second];
    let result = solve(&request).unwrap();
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 1);
    assert_eq!(result.nodal_reactions_kn[0][0], 1e308);
    assert!(result
        .nodal_reactions_kn
        .iter()
        .flatten()
        .all(|value| value.is_finite()));
    assert_eq!(result.true_free_residual_kn, 0.0);
}
