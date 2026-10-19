//! Explicit release-only 250,047-Hex8 finite-J2 acceptance on four workers.
//! A prescribed affine stretch has a closed Hencky/J2 response; the central
//! eight nodes retain 24 free displacement components to exercise equilibrium.

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
#[ignore = "250,047 finite-J2 Hex8; run explicitly in release with sufficient RAM"]
fn streamed_plastic_250047_hexes_four_threads_matches_closed_solution() {
    const CELLS: usize = 63;
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
    for k in 31..=32 {
        for j in 31..=32 {
            for i in 31..=32 {
                prescribed_m[node(i, j, k, stride)] = [None; 3];
            }
        }
    }
    assert_eq!(
        prescribed_m
            .iter()
            .flatten()
            .filter(|value| value.is_none())
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
                gmres_restart: 8,
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
    assert_eq!(result.hex_gauss_first_piola_mpa.len(), CELLS.pow(3));

    // Under F=diag(1+STRAIN,1,1), the radial return is uniform. This
    // reference is computed from material constants, without calling the
    // solver's material-point routine.
    let mu = E / (2.0 * (1.0 + NU));
    let bulk = E / (3.0 * (1.0 - 2.0 * NU));
    let log_stretch = (1.0 + STRAIN).ln();
    let alpha = (2.0 * mu * log_stretch - YIELD) / (3.0 * mu + HARDENING);
    assert!(alpha > 0.0);
    let pxx =
        (bulk * log_stretch + 4.0 * mu * log_stretch / 3.0 - 2.0 * mu * alpha) / (1.0 + STRAIN);
    let pyy = bulk * log_stretch - 2.0 * mu * log_stretch / 3.0 + mu * alpha;
    let mut max_u_error = 0.0_f64;
    for (index, point) in request.volume.mesh.nodes.iter().enumerate() {
        let expected = [STRAIN * point[0], 0.0, 0.0];
        for axis in 0..3 {
            max_u_error =
                max_u_error.max((result.nodal_displacements_m[index][axis] - expected[axis]).abs());
        }
    }
    let mut max_alpha_error = 0.0_f64;
    let mut max_p_error = 0.0_f64;
    for (states, stresses) in result
        .hex_gauss_states
        .iter()
        .zip(&result.hex_gauss_first_piola_mpa)
    {
        for (state, p) in states.iter().zip(stresses.iter()) {
            max_alpha_error = max_alpha_error.max((state.equivalent_plastic_strain - alpha).abs());
            for row in 0..3 {
                for col in 0..3 {
                    let expected = if row != col {
                        0.0
                    } else if row == 0 {
                        pxx
                    } else {
                        pyy
                    };
                    max_p_error = max_p_error.max((p[row][col] - expected).abs());
                }
            }
        }
    }
    let mut left_reaction = 0.0_f64;
    let mut right_reaction = 0.0_f64;
    for (index, point) in request.volume.mesh.nodes.iter().enumerate() {
        if point[0] == 0.0 {
            left_reaction += result.nodal_reactions_kn[index][0];
        }
        if point[0] == 1.0 {
            right_reaction += result.nodal_reactions_kn[index][0];
        }
    }
    assert!(max_u_error < 2e-8, "max displacement error {max_u_error}");
    assert!(
        max_alpha_error < 2e-8,
        "max plastic strain error {max_alpha_error}"
    );
    assert!(max_p_error < 2e-5, "max first Piola error {max_p_error}");
    assert!((right_reaction - 1_000.0 * pxx).abs() < 2e-2);
    assert!((left_reaction + 1_000.0 * pxx).abs() < 2e-2);
    assert!(result.true_free_residual_kn < 1e-4);
    eprintln!(
        "streamed finite-J2 Hex8: {} cells, {} DOF, 24 free, 4 workers, {} steps, {} cutbacks, residual {:.3e} kN, max u {:.3e} m, max alpha {:.3e}, max P {:.3e} MPa, face reactions [{:.6}, {:.6}] kN, {:.2?}",
        CELLS.pow(3), stride.pow(3) * 3, result.accepted_steps.len(), result.cutbacks,
        result.true_free_residual_kn, max_u_error, max_alpha_error, max_p_error,
        left_reaction, right_reaction, started.elapsed()
    );
}
