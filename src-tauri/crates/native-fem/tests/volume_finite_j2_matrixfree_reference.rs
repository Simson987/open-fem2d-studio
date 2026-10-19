//! Matrix-free finite-J2 regression above the dense limit: an affine cube
//! loads plastically and reverses, with free interior nodes and an independent
//! Hencky return-map stress/reaction reference.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn request(backend: FiniteJ2TetLinearBackend, threads: usize) -> FiniteJ2TetRequest {
    let mesh = Mesh::structured([3, 3, 3]).unwrap();
    let target = |a: f64| FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|&[x, y, z]| {
                if [x, y, z].iter().any(|&v| v == 0.0 || v == 1.0) {
                    [
                        Some((a.exp() - 1.0) * x),
                        Some(((-a).exp() - 1.0) * y),
                        Some(0.0),
                    ]
                } else {
                    [None; 3]
                }
            })
            .collect(),
    };
    FiniteJ2TetRequest {
        targets: vec![target(0.004), target(-0.004)],
        mesh,
        steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
        element_steels: None,
        options: FiniteJ2TetOptions {
            linear_backend: backend,
            matrix_free_threads: threads,
            ..FiniteJ2TetOptions::default()
        },
    }
}

#[test]
fn matrix_free_one_and_four_threads_match_sparse_and_closed_plastic_reversal() {
    let reference_request = request(FiniteJ2TetLinearBackend::SparseGmres, 1);
    assert_eq!(reference_request.mesh.tets.len(), 162);
    assert_eq!(reference_request.mesh.nodes.len() * 3, 192);
    let sparse = solve(&reference_request).unwrap();
    let mu = 210_000.0 / (2.0 * 1.3);
    let a = 0.004;
    let q1 = 2.0 * mu * 3.0_f64.sqrt() * a;
    let alpha1 = (q1 - 250.0) / (3.0 * mu + 2_000.0);
    let z1 = 3.0_f64.sqrt() * alpha1 / 2.0;
    let q2 = 2.0 * mu * 3.0_f64.sqrt() * (a + z1);
    let alpha2 = alpha1 + (q2 - 250.0 - 2_000.0 * alpha1) / (3.0 * mu + 2_000.0);
    let tau11 = 2.0 * mu * (-a - z1 + 3.0_f64.sqrt() * (alpha2 - alpha1) / 2.0);
    let p11 = tau11 / (-a).exp();
    for threads in [1, 4] {
        let result = solve(&request(FiniteJ2TetLinearBackend::MatrixFreeGmres, threads)).unwrap();
        assert_eq!(
            result.linear_backend_used,
            FiniteJ2TetLinearBackend::MatrixFreeGmres
        );
        assert_eq!(result.accepted_steps.last().unwrap().target_index, 1);
        assert!(result.true_free_residual_kn < 1e-5);
        for (node, &point) in reference_request.mesh.nodes.iter().enumerate() {
            let expected = [
                ((-a).exp() - 1.0) * point[0],
                (a.exp() - 1.0) * point[1],
                0.0,
            ];
            for axis in 0..3 {
                assert!((result.nodal_displacements_m[node][axis] - expected[axis]).abs() < 1e-8);
                assert!(
                    (result.nodal_displacements_m[node][axis]
                        - sparse.nodal_displacements_m[node][axis])
                        .abs()
                        < 1e-9
                );
            }
        }
        for (element, state) in result.element_states.iter().enumerate() {
            assert!((state.equivalent_plastic_strain - alpha2).abs() < 1e-7);
            assert!(
                (state.equivalent_plastic_strain
                    - sparse.element_states[element].equivalent_plastic_strain)
                    .abs()
                    < 1e-9
            );
            assert!((result.element_first_piola_mpa[element][0][0] - p11).abs() < 1e-4);
        }
        let right_reaction: f64 = reference_request
            .mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, point)| point[0] == 1.0)
            .map(|(node, _)| result.nodal_reactions_kn[node][0])
            .sum();
        assert!((right_reaction - 1_000.0 * p11).abs() < 1e-3);
    }
}
