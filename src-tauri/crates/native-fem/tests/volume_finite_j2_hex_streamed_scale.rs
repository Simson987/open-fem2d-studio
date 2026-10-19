//! Explicit release-only regular 32³ Hex8 plastic patch for the streamed
//! matrix-free tangent. Twenty-four interior displacement DOFs remain free;
//! the affine Hencky response and face reaction are independent references.
//! This intermediate acceptance does not certify a 250k-Hex8 solve.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_hex_coupled, FiniteJ2HexCell, FiniteJ2HexCoupledRequest, FiniteJ2HexTarget,
    FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn node(i: usize, j: usize, k: usize, stride: usize) -> usize {
    (k * stride + j) * stride + i
}

#[test]
#[ignore = "release-scale acceptance; run explicitly with --ignored --release"]
fn streamed_plastic_32768_hexes_has_affine_solution_with_24_free_dofs() {
    const CELLS: usize = 32;
    const STRAIN: f64 = 0.005;
    const E: f64 = 1_000.0;
    const NU: f64 = 0.3;
    const YIELD: f64 = 1.0;
    const HARDENING: f64 = 100.0;
    let started = std::time::Instant::now();
    let stride = CELLS + 1;
    let h = 1.0 / CELLS as f64;
    let mut nodes = Vec::with_capacity(stride.pow(3));
    for k in 0..=CELLS {
        for j in 0..=CELLS {
            for i in 0..=CELLS {
                nodes.push([i as f64 * h, j as f64 * h, k as f64 * h]);
            }
        }
    }
    let steel = FiniteJ2Steel::new(E, NU, YIELD, HARDENING).unwrap();
    let mut hexes = Vec::with_capacity(CELLS.pow(3));
    for k in 0..CELLS {
        for j in 0..CELLS {
            for i in 0..CELLS {
                hexes.push(FiniteJ2HexCell {
                    nodes: [
                        node(i, j, k, stride),
                        node(i + 1, j, k, stride),
                        node(i + 1, j + 1, k, stride),
                        node(i, j + 1, k, stride),
                        node(i, j, k + 1, stride),
                        node(i + 1, j, k + 1, stride),
                        node(i + 1, j + 1, k + 1, stride),
                        node(i, j + 1, k + 1, stride),
                    ],
                    steel,
                });
            }
        }
    }
    let mut prescribed_m: Vec<[Option<f64>; 3]> = nodes
        .iter()
        .map(|p| [Some(STRAIN * p[0]), Some(0.0), Some(0.0)])
        .collect();
    for k in 15..=16 {
        for j in 15..=16 {
            for i in 15..=16 {
                prescribed_m[node(i, j, k, stride)] = [None; 3];
            }
        }
    }
    assert_eq!(
        prescribed_m
            .iter()
            .flatten()
            .filter(|v| v.is_none())
            .count(),
        24
    );
    let request = FiniteJ2HexCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: Mesh {
                nodes,
                tets: vec![],
            },
            steel,
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; stride.pow(3)],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m,
            }],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                matrix_free_threads: 4,
                gmres_restart: 20,
                ..FiniteJ2TetOptions::default()
            },
        },
        hexes,
        hex_targets: vec![FiniteJ2HexTarget::default()],
        trusses: vec![],
        membranes: vec![],
    };
    let result = solve_hex_coupled(&request).unwrap();
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
    );
    assert_eq!(result.hex_gauss_states.len(), CELLS.pow(3));
    let mu = E / (2.0 * (1.0 + NU));
    let bulk = E / (3.0 * (1.0 - 2.0 * NU));
    let log_stretch = (1.0 + STRAIN).ln();
    let alpha = (2.0 * mu * log_stretch - YIELD) / (3.0 * mu + HARDENING);
    assert!(alpha > 0.0);
    let pxx =
        (bulk * log_stretch + 4.0 * mu * log_stretch / 3.0 - 2.0 * mu * alpha) / (1.0 + STRAIN);
    let mut max_u_error = 0.0_f64;
    for (index, point) in request.volume.mesh.nodes.iter().enumerate() {
        let expected = [STRAIN * point[0], 0.0, 0.0];
        for axis in 0..3 {
            max_u_error =
                max_u_error.max((result.nodal_displacements_m[index][axis] - expected[axis]).abs());
        }
    }
    assert!(max_u_error < 2e-8, "max displacement error {max_u_error}");
    for gauss in &result.hex_gauss_states[0] {
        assert!((gauss.equivalent_plastic_strain - alpha).abs() < 2e-8);
    }
    assert!((result.hex_gauss_first_piola_mpa[0][0][0][0] - pxx).abs() < 2e-5);
    let right_reaction: f64 = request
        .volume
        .mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[0] == 1.0)
        .map(|(index, _)| result.nodal_reactions_kn[index][0])
        .sum();
    assert!((right_reaction - 1_000.0 * pxx).abs() < 2e-2);
    assert!(result.true_free_residual_kn < 1e-4);
    eprintln!(
        "streamed finite-J2 Hex8: {} cells, {} DOF, 24 free, 4 workers, {} accepted steps, {} cutbacks, free residual {:.3e} kN, {:.2?}",
        CELLS.pow(3), stride.pow(3) * 3, result.accepted_steps.len(), result.cutbacks,
        result.true_free_residual_kn, started.elapsed()
    );
}
