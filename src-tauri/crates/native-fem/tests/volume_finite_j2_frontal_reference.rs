//! Independent affine plastic load/reversal reference for finite-J2 frontal
//! Newton. The center node is free, so the frontal factorization is exercised.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn target(mesh: &Mesh, a: f64) -> FiniteJ2TetTarget {
    let sx = a.exp();
    let sy = (-a).exp();
    FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|&[x, y, z]| {
                if [x, y, z] == [0.5; 3] {
                    [None; 3]
                } else {
                    [Some((sx - 1.0) * x), Some((sy - 1.0) * y), Some(0.0)]
                }
            })
            .collect(),
    }
}

fn request(backend: FiniteJ2TetLinearBackend) -> FiniteJ2TetRequest {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    FiniteJ2TetRequest {
        targets: vec![target(&mesh, 0.004), target(&mesh, -0.004)],
        mesh,
        steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
        element_steels: None,
        options: FiniteJ2TetOptions {
            linear_backend: backend,
            ..FiniteJ2TetOptions::default()
        },
    }
}

#[test]
fn frontal_matches_closed_hencky_j2_plastic_reversal_and_dense_solution() {
    let dense = solve(&request(FiniteJ2TetLinearBackend::Dense)).unwrap();
    let frontal = solve(&request(FiniteJ2TetLinearBackend::FrontalWave)).unwrap();
    assert_eq!(
        frontal.linear_backend_used,
        FiniteJ2TetLinearBackend::FrontalWave
    );
    assert_eq!(frontal.element_states.len(), 48);
    assert_eq!(frontal.accepted_steps.last().unwrap().target_index, 1);
    assert!(frontal.true_free_residual_kn < 1e-5);
    let mu = 210_000.0 / (2.0 * 1.3);
    let a = 0.004;
    let q1 = 2.0 * mu * 3.0_f64.sqrt() * a;
    let alpha1 = (q1 - 250.0) / (3.0 * mu + 2_000.0);
    let z1 = 3.0_f64.sqrt() * alpha1 / 2.0;
    let q2 = 2.0 * mu * 3.0_f64.sqrt() * (a + z1);
    let delta_alpha2 = (q2 - 250.0 - 2_000.0 * alpha1) / (3.0 * mu + 2_000.0);
    let expected_alpha = alpha1 + delta_alpha2;
    let tau11 = 2.0 * mu * (-a - z1 + 3.0_f64.sqrt() * delta_alpha2 / 2.0);
    let expected_p11 = tau11 / (-a).exp();
    let expected_p22 = -tau11 / a.exp();
    for (index, state) in frontal.element_states.iter().enumerate() {
        assert!((state.equivalent_plastic_strain - expected_alpha).abs() < 1e-7);
        assert!(
            (state.equivalent_plastic_strain
                - dense.element_states[index].equivalent_plastic_strain)
                .abs()
                < 1e-9
        );
        let p = frontal.element_first_piola_mpa[index];
        assert!((p[0][0] - expected_p11).abs() < 1e-4);
        assert!((p[1][1] - expected_p22).abs() < 1e-4);
        for axis in 0..3 {
            assert!(
                (p[axis][axis] - dense.element_first_piola_mpa[index][axis][axis]).abs() < 1e-6
            );
        }
    }
    let center = 13;
    let expected_u = [0.5 * ((-a).exp() - 1.0), 0.5 * (a.exp() - 1.0), 0.0];
    for axis in 0..3 {
        assert!((frontal.nodal_displacements_m[center][axis] - expected_u[axis]).abs() < 1e-9);
    }
    let right_reaction: f64 = request(FiniteJ2TetLinearBackend::FrontalWave)
        .mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[0] == 1.0)
        .map(|(node, _)| frontal.nodal_reactions_kn[node][0])
        .sum();
    assert!((right_reaction - 1_000.0 * expected_p11).abs() < 1e-3);
}
