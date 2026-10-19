//! A nonlinear solid and a finite-strain truss share a genuinely free node.
//! The 8³ case runs in the normal test suite; the 18³ and 35³ cases are
//! explicit release acceptances because they are expensive in debug builds.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_coupled, FiniteJ2CoupledRequest, FiniteJ2CoupledTruss, FiniteJ2TetLinearBackend,
    FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn index(i: usize, j: usize, k: usize, cells: usize) -> usize {
    (k * (cells + 1) + j) * (cells + 1) + i
}

fn check_coupled_patch(cells: usize) {
    let started = std::time::Instant::now();
    let mesh = Mesh::structured([cells; 3]).unwrap();
    let center = index(cells / 2, cells / 2, cells / 2, cells);
    let anchored = index(cells, cells / 2, cells / 2, cells);
    let a: f64 = 0.004;
    let sx = a.exp();
    let sy = (-a).exp();
    let area_m2 = 0.0001;
    let request = FiniteJ2CoupledRequest {
        volume: FiniteJ2TetRequest {
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: mesh
                    .nodes
                    .iter()
                    .map(|&[x, y, z]| {
                        if [x, y, z].iter().any(|&v| v == 0.0 || v == 1.0) {
                            [Some((sx - 1.0) * x), Some((sy - 1.0) * y), Some(0.0)]
                        } else {
                            [None; 3]
                        }
                    })
                    .collect(),
            }],
            mesh: mesh.clone(),
            steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
            element_steels: None,
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        },
        trusses: vec![FiniteJ2CoupledTruss {
            nodes: [center, anchored],
            youngs_mpa: 210_000.0,
            area_m2,
            plasticity: None,
        }],
    };
    let result = solve_coupled(&request).unwrap();
    assert_eq!(result.element_states.len(), 6 * cells * cells * cells);
    assert_eq!(result.truss_axial_force_kn.len(), 1);
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
    );
    assert!(result
        .element_states
        .iter()
        .any(|s| s.equivalent_plastic_strain > 0.0));
    assert!(result.true_free_residual_kn < 1e-3);

    // The truss law is independently evaluated from its *deformed* endpoint
    // distance, not from the solver's internal force or tangent arrays.
    let p = mesh.nodes[center];
    let q = mesh.nodes[anchored];
    let up = result.nodal_displacements_m[center];
    let uq = result.nodal_displacements_m[anchored];
    let l0 = (0..3).map(|i| (q[i] - p[i]).powi(2)).sum::<f64>().sqrt();
    let l = (0..3)
        .map(|i| (q[i] + uq[i] - p[i] - up[i]).powi(2))
        .sum::<f64>()
        .sqrt();
    let stretch = l / l0;
    let expected_kn = 1_000.0 * 210_000.0 * area_m2 * (stretch * stretch - 1.0) / 2.0 * stretch;
    let actual_kn = result.truss_axial_force_kn[0];
    assert!((actual_kn - expected_kn).abs() < 1e-8 * expected_kn.abs().max(1.0));
    let affine_center_ux = (sx - 1.0) * p[0];
    assert!(
        (up[0] - affine_center_ux).abs() > 1e-8,
        "the truss must alter the displacement of the free solid node"
    );
    let global_reaction = (0..3)
        .map(|axis| {
            result
                .nodal_reactions_kn
                .iter()
                .map(|r| r[axis])
                .sum::<f64>()
        })
        .collect::<Vec<_>>();
    assert!(
        global_reaction.iter().all(|r| r.abs() < 1e-3),
        "global reaction imbalance: {global_reaction:?}"
    );
    eprintln!(
        "finite-J2 coupled: {} Tet4, {} DOF, 4 threads, truss N {:.6} kN, center deviation {:.3e} m, residual {:.3e} kN, {:.2?}",
        mesh.tets.len(), mesh.nodes.len() * 3, actual_kn,
        up[0] - affine_center_ux, result.true_free_residual_kn, started.elapsed()
    );
}

#[test]
fn plastic_3072_tets_with_free_truss_node_four_threads() {
    check_coupled_patch(8);
}

#[test]
#[ignore = "34,992 Tet4 coupled finite-J2 acceptance; run explicitly in release"]
fn plastic_34992_tets_with_free_truss_node_four_threads() {
    check_coupled_patch(18);
}

#[test]
#[ignore = "257,250 Tet4 coupled finite-J2 acceptance; run explicitly in release with sufficient RAM"]
fn plastic_257250_tets_with_free_truss_node_four_threads() {
    check_coupled_patch(35);
}
