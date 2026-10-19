//! Opt-in scale acceptance for a plastifying finite-strain J2 Tet4 cube.
//! The affine isochoric Hencky solution is known analytically; 1,029 interior
//! displacement components remain free, so sparse Newton must solve them.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const A: f64 = 0.004;

#[test]
#[ignore = "release-scale check; run explicitly with --ignored --release"]
fn sparse_plastic_3072_tet_cube_matches_affine_hencky_reference() {
    let started = std::time::Instant::now();
    let mesh = Mesh::structured([8, 8, 8]).unwrap();
    assert_eq!(mesh.tets.len(), 3_072);
    assert_eq!(mesh.nodes.len() * 3, 2_187);
    let sx = A.exp();
    let sy = (-A).exp();
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
    let result = solve(&FiniteJ2TetRequest {
        steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
        element_steels: None,
        targets: vec![FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m,
            body_forces: vec![],
            face_tractions: vec![],
        }],
        mesh: mesh.clone(),
        options: FiniteJ2TetOptions {
            linear_backend: FiniteJ2TetLinearBackend::SparseGmres,
            ..FiniteJ2TetOptions::default()
        },
    })
    .unwrap();
    let mu = 210_000.0 / (2.0 * 1.3);
    let q_trial = 2.0 * mu * 3.0_f64.sqrt() * A;
    let alpha = (q_trial - 250.0) / (3.0 * mu + 2_000.0);
    let tau11 = 2.0 * mu * (A - 3.0_f64.sqrt() * alpha / 2.0);
    let p11 = tau11 / sx;
    let p22 = -tau11 / sy;
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::SparseGmres
    );
    assert_eq!(result.element_states.len(), 3_072);
    assert!(
        result.true_free_residual_kn < 1e-4,
        "residual {}",
        result.true_free_residual_kn
    );
    for (node, &point) in mesh.nodes.iter().enumerate() {
        let expected = [(sx - 1.0) * point[0], (sy - 1.0) * point[1], 0.0];
        for axis in 0..3 {
            assert!(
                (result.nodal_displacements_m[node][axis] - expected[axis]).abs() < 1e-8,
                "node {node}, axis {axis}"
            );
        }
    }
    for (element, state) in result.element_states.iter().enumerate() {
        assert!((state.equivalent_plastic_strain - alpha).abs() < 1e-8);
        let p = result.element_first_piola_mpa[element];
        assert!((p[0][0] - p11).abs() < 1e-5);
        assert!((p[1][1] - p22).abs() < 1e-5);
    }
    let end_x: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    let end_y: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[1] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][1])
        .sum();
    assert!((end_x - 1_000.0 * p11).abs() < 1e-3);
    assert!((end_y - 1_000.0 * p22).abs() < 1e-3);
    eprintln!(
        "finite-J2 scale: 3072 Tet4, 2187 DOF, {} accepted steps, {} cutbacks, residual {:.3e} kN, {:.2?}",
        result.accepted_steps.len(), result.cutbacks, result.true_free_residual_kn, started.elapsed()
    );
}
