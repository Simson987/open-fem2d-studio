//! Nonaffine finite-strain Hex8 plasticity with many unconstrained DOFs.
//!
//! Reconstruct the eight-point reference quadrature independently from the
//! returned first-Piola stresses. This checks every nodal force and reaction,
//! including the loaded and clamped faces, without calling the element or
//! production assembler. A corner perturbation produces a nonuniform plastic
//! zone; assembled CSR and threaded matrix-free Newton must agree.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_hex_coupled, FiniteJ2HexCell, FiniteJ2HexCoupledRequest, FiniteJ2HexTarget,
    FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetResult,
    FiniteJ2TetTarget,
};

fn node(i: usize, j: usize, k: usize, n: usize) -> usize {
    (k * (n + 1) + j) * (n + 1) + i
}

fn request(n: usize, backend: FiniteJ2TetLinearBackend) -> FiniteJ2HexCoupledRequest {
    let h = 1.0 / n as f64;
    let nodes: Vec<_> = (0..=n)
        .flat_map(|k| {
            (0..=n)
                .flat_map(move |j| (0..=n).map(move |i| [i as f64 * h, j as f64 * h, k as f64 * h]))
        })
        .collect();
    let steel = FiniteJ2Steel::new(1_000.0, 0.3, 2.0, 100.0).unwrap();
    let mut hexes = Vec::with_capacity(n * n * n);
    for k in 0..n {
        for j in 0..n {
            for i in 0..n {
                hexes.push(FiniteJ2HexCell {
                    nodes: [
                        node(i, j, k, n),
                        node(i + 1, j, k, n),
                        node(i + 1, j + 1, k, n),
                        node(i, j + 1, k, n),
                        node(i, j, k + 1, n),
                        node(i + 1, j, k + 1, n),
                        node(i + 1, j + 1, k + 1, n),
                        node(i, j + 1, k + 1, n),
                    ],
                    steel,
                });
            }
        }
    }
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    // Integrate constant dead traction [3, 0, -0.5] MPa on x=1 as a
    // consistent nodal load. A distinct corner force breaks affinity.
    for j in 0..n {
        for k in 0..n {
            for (dj, dk) in [(0, 0), (1, 0), (1, 1), (0, 1)] {
                let load = &mut loads_kn[node(n, j + dj, k + dk, n)];
                load[0] += 1_000.0 * 3.0 * h * h / 4.0;
                load[2] -= 1_000.0 * 0.5 * h * h / 4.0;
            }
        }
    }
    loads_kn[node(n, n, n, n)][1] += 30.0;
    let prescribed_m = nodes
        .iter()
        .map(|point| {
            if point[0] == 0.0 {
                [Some(0.0); 3]
            } else {
                [None; 3]
            }
        })
        .collect();
    FiniteJ2HexCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: Mesh {
                nodes,
                tets: vec![],
            },
            steel,
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn,
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m,
            }],
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                matrix_free_threads: 4,
                residual_tolerance: 1e-7,
                gmres_relative_tolerance: 1e-9,
                ..FiniteJ2TetOptions::default()
            },
        },
        hexes,
        hex_targets: vec![FiniteJ2HexTarget::default()],
        trusses: vec![],
        membranes: vec![],
    }
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn verify(n: usize, request: &FiniteJ2HexCoupledRequest, result: &FiniteJ2TetResult) {
    let nodes = &request.volume.mesh.nodes;
    let target = &request.volume.targets[0];
    assert_eq!(result.hex_gauss_states.len(), n * n * n);
    assert_eq!(result.hex_gauss_first_piola_mpa.len(), n * n * n);
    assert_eq!(result.nodal_displacements_m.len(), nodes.len());
    assert!(result.true_free_residual_kn < 2e-3);
    let mut internal = vec![[0.0_f64; 3]; nodes.len()];
    let mut yielded = 0;
    let mut elastic = 0;
    let mut minimum_alpha = f64::INFINITY;
    let mut maximum_alpha = 0.0_f64;
    let signs = [
        [-1.0, -1.0, -1.0],
        [1.0, -1.0, -1.0],
        [1.0, 1.0, -1.0],
        [-1.0, 1.0, -1.0],
        [-1.0, -1.0, 1.0],
        [1.0, -1.0, 1.0],
        [1.0, 1.0, 1.0],
        [-1.0, 1.0, 1.0],
    ];
    let g = 1.0 / 3.0_f64.sqrt();
    let h = 1.0 / n as f64;
    let d_volume = h.powi(3) / 8.0;
    for (element, hex) in request.hexes.iter().enumerate() {
        for (point, [a, b, c]) in [-g, g]
            .into_iter()
            .flat_map(|a| {
                [-g, g]
                    .into_iter()
                    .flat_map(move |b| [-g, g].map(move |c| [a, b, c]))
            })
            .enumerate()
        {
            let alpha = result.hex_gauss_states[element][point].equivalent_plastic_strain;
            minimum_alpha = minimum_alpha.min(alpha);
            maximum_alpha = maximum_alpha.max(alpha);
            if alpha > 1e-7 {
                yielded += 1;
            } else {
                elastic += 1;
            }
            let stress = result.hex_gauss_first_piola_mpa[element][point];
            for (local, [sx, sy, sz]) in signs.into_iter().enumerate() {
                let gradient = [
                    sx * (1.0 + sy * b) * (1.0 + sz * c) / (4.0 * h),
                    sy * (1.0 + sx * a) * (1.0 + sz * c) / (4.0 * h),
                    sz * (1.0 + sx * a) * (1.0 + sy * b) / (4.0 * h),
                ];
                for axis in 0..3 {
                    for direction in 0..3 {
                        internal[hex.nodes[local]][axis] +=
                            1_000.0 * d_volume * stress[axis][direction] * gradient[direction];
                    }
                }
            }
        }
    }
    assert!(yielded > 0, "no plastic Gauss points");
    assert!(elastic > 0, "no elastic Gauss points");
    assert!(maximum_alpha - minimum_alpha > 1e-5);
    let mut max_force_error = 0.0_f64;
    let mut net_force = [0.0; 3];
    let mut net_moment = [0.0; 3];
    let mut internal_work = 0.0;
    let mut external_work = 0.0;
    for (index, point) in nodes.iter().enumerate() {
        let result_force = &result.nodal_reactions_kn[index];
        for axis in 0..3 {
            let expected = internal[index][axis] - target.loads_kn[index][axis];
            max_force_error = max_force_error.max((expected - result_force[axis]).abs());
            if target.prescribed_m[index][axis].is_none() {
                max_force_error = max_force_error.max(expected.abs());
            }
            net_force[axis] += result_force[axis] + target.loads_kn[index][axis];
            internal_work += internal[index][axis] * result.nodal_displacements_m[index][axis];
            external_work +=
                target.loads_kn[index][axis] * result.nodal_displacements_m[index][axis];
        }
        let current = [
            point[0] + result.nodal_displacements_m[index][0],
            point[1] + result.nodal_displacements_m[index][1],
            point[2] + result.nodal_displacements_m[index][2],
        ];
        let moment = cross(
            current,
            [
                result_force[0] + target.loads_kn[index][0],
                result_force[1] + target.loads_kn[index][1],
                result_force[2] + target.loads_kn[index][2],
            ],
        );
        for axis in 0..3 {
            net_moment[axis] += moment[axis];
        }
    }
    assert!(
        max_force_error < 2e-3,
        "nodal force error {max_force_error}"
    );
    assert!((internal_work - external_work).abs() < 2e-3);
    assert!(net_force.into_iter().all(|value| value.abs() < 2e-3));
    assert!(net_moment.into_iter().all(|value| value.abs() < 2e-3));
    eprintln!(
        "nonaffine finite-J2 Hex8: {n}^3 cells, {} free DOFs, {yielded} yielded and {elastic} elastic Gauss points, alpha [{minimum_alpha:.3e},{maximum_alpha:.3e}], max nodal force error {max_force_error:.3e} kN, true residual {:.3e} kN, {} steps, {} cutbacks, backend {:?}",
        3 * n * (n + 1) * (n + 1),
        result.true_free_residual_kn,
        result.accepted_steps.len(),
        result.cutbacks,
        result.linear_backend_used,
    );
}

#[test]
fn nonaffine_plastic_hex8_agrees_across_sparse_and_threaded_matrixfree() {
    let n = 4;
    let sparse_request = request(n, FiniteJ2TetLinearBackend::SparseGmres);
    let started = std::time::Instant::now();
    let sparse = solve_hex_coupled(&sparse_request).unwrap();
    verify(n, &sparse_request, &sparse);
    eprintln!("sparse elapsed: {:.2?}", started.elapsed());
    let matrixfree_request = request(n, FiniteJ2TetLinearBackend::MatrixFreeGmresLarge);
    let started = std::time::Instant::now();
    let matrixfree = solve_hex_coupled(&matrixfree_request).unwrap();
    verify(n, &matrixfree_request, &matrixfree);
    eprintln!("matrixfree elapsed: {:.2?}", started.elapsed());
    let mut maximum_difference = 0.0_f64;
    for (a, b) in sparse
        .nodal_displacements_m
        .iter()
        .zip(&matrixfree.nodal_displacements_m)
    {
        for axis in 0..3 {
            maximum_difference = maximum_difference.max((a[axis] - b[axis]).abs());
        }
    }
    assert!(
        maximum_difference < 2e-7,
        "backend displacement difference {maximum_difference}"
    );
}

#[test]
#[ignore = "nonaffine release scale; run explicitly with --ignored --release"]
fn nonaffine_plastic_hex8_eight_cubed_matrixfree() {
    let n = 8;
    let request = request(n, FiniteJ2TetLinearBackend::MatrixFreeGmresLarge);
    let started = std::time::Instant::now();
    let result = solve_hex_coupled(&request).unwrap();
    verify(n, &request, &result);
    eprintln!("8^3 matrixfree elapsed: {:.2?}", started.elapsed());
}
