//! Explicit 34,992-Tet4 nonlinear acceptance beyond the assembled GMRES cap.
//! The isochoric affine plastic solution is closed form, with 14,739 free
//! displacement components that require a global matrix-free Newton solve.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

#[test]
#[ignore = "release-scale check; run explicitly with --ignored --release"]
fn matrix_free_plastic_34992_tets_matches_closed_hencky_solution() {
    let started = std::time::Instant::now();
    let mesh = Mesh::structured([18, 18, 18]).unwrap();
    assert_eq!(mesh.tets.len(), 34_992);
    assert_eq!(mesh.nodes.len() * 3, 20_577);
    let a: f64 = 0.004;
    let sx = a.exp();
    let sy = (-a).exp();
    let prescribed_m = mesh
        .nodes
        .iter()
        .map(|&[x, y, z]| {
            if [x, y, z].iter().any(|&v| v == 0.0 || v == 1.0) {
                [Some((sx - 1.0) * x), Some((sy - 1.0) * y), Some(0.0)]
            } else {
                [None; 3]
            }
        })
        .collect();
    let request = FiniteJ2TetRequest {
        targets: vec![FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m,
        }],
        mesh: mesh.clone(),
        steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
        element_steels: None,
        options: FiniteJ2TetOptions {
            linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmres,
            matrix_free_threads: 4,
            ..FiniteJ2TetOptions::default()
        },
    };
    let result = solve(&request).unwrap();
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmres
    );
    assert_eq!(result.element_states.len(), 34_992);
    assert!(
        result.true_free_residual_kn < 1e-3,
        "residual {}",
        result.true_free_residual_kn
    );
    let mu = 210_000.0 / (2.0 * 1.3);
    let q = 2.0 * mu * 3.0_f64.sqrt() * a;
    let alpha = (q - 250.0) / (3.0 * mu + 2_000.0);
    let tau11 = 2.0 * mu * (a - 3.0_f64.sqrt() * alpha / 2.0);
    let p11 = tau11 / sx;
    let p22 = -tau11 / sy;
    let mut max_u_error = 0.0_f64;
    for (node, &point) in mesh.nodes.iter().enumerate() {
        let expected = [(sx - 1.0) * point[0], (sy - 1.0) * point[1], 0.0];
        for axis in 0..3 {
            max_u_error =
                max_u_error.max((result.nodal_displacements_m[node][axis] - expected[axis]).abs());
        }
    }
    assert!(max_u_error < 2e-7, "max u error {max_u_error}");
    let mut max_alpha_error = 0.0_f64;
    let mut max_p_error = 0.0_f64;
    for (element, state) in result.element_states.iter().enumerate() {
        max_alpha_error = max_alpha_error.max((state.equivalent_plastic_strain - alpha).abs());
        let p = result.element_first_piola_mpa[element];
        max_p_error = max_p_error
            .max((p[0][0] - p11).abs())
            .max((p[1][1] - p22).abs());
    }
    assert!(max_alpha_error < 2e-7, "max alpha error {max_alpha_error}");
    assert!(max_p_error < 2e-2, "max P error {max_p_error}");
    let right_reaction: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    assert!((right_reaction - 1_000.0 * p11).abs() < 2e-2);
    eprintln!(
        "finite-J2 matrix-free: 34992 Tet4, 20577 DOF, 14739 free, 4 threads, {} steps, {} cutbacks, residual {:.3e} kN, {:.2?}",
        result.accepted_steps.len(), result.cutbacks, result.true_free_residual_kn, started.elapsed()
    );
}
