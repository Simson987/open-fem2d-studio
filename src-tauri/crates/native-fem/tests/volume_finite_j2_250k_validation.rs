//! Explicit 257,250-Tet4 four-thread finite-strain plastic acceptance.
//! A closed isochoric Hencky/J2 solution is imposed only on the boundary;
//! 117,912 interior displacement components remain free.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

#[test]
#[ignore = "257,250 finite-J2 Tet4; run explicitly in release with sufficient RAM"]
fn matrix_free_large_plastic_257250_tets_four_threads_matches_closed_solution() {
    let started = std::time::Instant::now();
    let mesh = Mesh::structured([35, 35, 35]).unwrap();
    assert_eq!(mesh.tets.len(), 257_250);
    assert_eq!(mesh.nodes.len() * 3, 139_968);
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
            linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
            matrix_free_threads: 4,
            ..FiniteJ2TetOptions::default()
        },
    };
    let result = solve(&request).unwrap();
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
    );
    assert_eq!(result.element_states.len(), 257_250);
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
    let max_u_error = mesh
        .nodes
        .iter()
        .enumerate()
        .fold(0.0_f64, |worst, (node, &p)| {
            let expected = [(sx - 1.0) * p[0], (sy - 1.0) * p[1], 0.0];
            worst.max(
                (0..3)
                    .map(|axis| (result.nodal_displacements_m[node][axis] - expected[axis]).abs())
                    .fold(0.0_f64, f64::max),
            )
        });
    assert!(max_u_error < 1e-6, "max u error {max_u_error}");
    let max_alpha_error = result
        .element_states
        .iter()
        .map(|state| (state.equivalent_plastic_strain - alpha).abs())
        .fold(0.0_f64, f64::max);
    let max_p_error = result
        .element_first_piola_mpa
        .iter()
        .map(|p| (p[0][0] - p11).abs().max((p[1][1] - p22).abs()))
        .fold(0.0_f64, f64::max);
    assert!(max_alpha_error < 1e-6, "max alpha error {max_alpha_error}");
    assert!(max_p_error < 1e-1, "max P error {max_p_error}");
    let right_reaction: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    assert!((right_reaction - 1_000.0 * p11).abs() < 1e-1);
    eprintln!(
        "finite-J2 250k: 257250 Tet4, 139968 DOF, 117912 free, 4 threads, {} steps, {} cutbacks, residual {:.3e} kN, {:.2?}",
        result.accepted_steps.len(), result.cutbacks, result.true_free_residual_kn, started.elapsed()
    );
}
