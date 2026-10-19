//! Affine Hooke patch on a five-valent, conforming Hex8 star extruded through
//! three unequal layers. This connectivity cannot be indexed as a tensor grid.
//! Boundary nodal forces come from independent continuum surface traction
//! integration, without using element stiffness or volume shape gradients.

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeFaceTraction,
    Hex8VolumeMaterial, Hex8VolumeRequest, Hex8VolumeResponse, Hex8VolumeSupport,
};

const E: f64 = 31_000.0;
const NU: f64 = 0.27;
const Z: [f64; 4] = [0.0, 0.31, 0.79, 1.24];
const GRAD: [[f64; 3]; 3] = [
    [0.0008, -0.0003, 0.00015],
    [0.0002, -0.0005, 0.00012],
    [-0.0001, 0.00025, 0.0006],
];
const NODE_COUNT: usize = 44;

fn id(level: usize, section: usize) -> usize {
    (17 * (11 * level + section) + 9) % NODE_COUNT
}

fn vertex(i: usize) -> [f64; 2] {
    let angle = 2.0 * std::f64::consts::PI * i as f64 / 5.0;
    let radius = [1.0, 0.91, 1.08, 0.96, 1.04][i];
    [radius * angle.cos(), radius * angle.sin()]
}

fn section_point(section: usize) -> [f64; 2] {
    if section == 0 {
        [0.04, -0.03]
    } else if section <= 5 {
        vertex(section - 1)
    } else {
        let a = vertex(section - 6);
        let b = vertex((section - 5) % 5);
        [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]
    }
}

fn coordinate(level: usize, section: usize) -> [f64; 3] {
    let [s, t] = section_point(section);
    let z = Z[level];
    // A global affine skew leaves each exterior quad planar.
    let mut x = [
        0.3 + 0.93 * s + 0.14 * t + 0.11 * z,
        -0.2 - 0.07 * s + 0.87 * t + 0.16 * z,
        0.1 + 0.05 * s - 0.08 * t + 1.02 * z,
    ];
    if section == 0 && (level == 1 || level == 2) {
        // Interior-only distortion: exterior faces retain exact planar geometry.
        x[0] += 0.025 * level as f64;
        x[1] -= 0.018 * level as f64;
        x[2] += 0.013 * level as f64;
    }
    x
}

fn exact_u(x: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| {
        [0.0001, -0.00007, 0.00004][i] + (0..3).map(|j| GRAD[i][j] * x[j]).sum::<f64>()
    })
}

fn stress() -> [f64; 6] {
    let lambda = E * NU / ((1.0 + NU) * (1.0 - 2.0 * NU));
    let mu = E / (2.0 * (1.0 + NU));
    let tr = GRAD[0][0] + GRAD[1][1] + GRAD[2][2];
    [
        lambda * tr + 2.0 * mu * GRAD[0][0],
        lambda * tr + 2.0 * mu * GRAD[1][1],
        lambda * tr + 2.0 * mu * GRAD[2][2],
        mu * (GRAD[0][1] + GRAD[1][0]),
        mu * (GRAD[1][2] + GRAD[2][1]),
        mu * (GRAD[2][0] + GRAD[0][2]),
    ]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn traction(area: [f64; 3], s: [f64; 6]) -> [f64; 3] {
    [
        1000.0 * (s[0] * area[0] + s[3] * area[1] + s[5] * area[2]),
        1000.0 * (s[3] * area[0] + s[1] * area[1] + s[4] * area[2]),
        1000.0 * (s[5] * area[0] + s[4] * area[1] + s[2] * area[2]),
    ]
}

fn face_traction(nodes: &[[f64; 3]], face: [usize; 4]) -> [f64; 3] {
    let x = nodes[face[0]];
    let y = nodes[face[1]];
    let w = nodes[face[3]];
    let a = cross(
        std::array::from_fn(|i| y[i] - x[i]),
        std::array::from_fn(|i| w[i] - x[i]),
    );
    let norm = a.iter().map(|v| v * v).sum::<f64>().sqrt();
    traction(a.map(|v| v / norm), stress())
}

fn add_face_forces(nodes: &[[f64; 3]], face: [usize; 4], total: &mut [[f64; 3]]) {
    // Four-point surface integration of N_a σ n dA on the physical face.
    // Surface mapping uses only supplied coordinates and exact Hooke stress.
    let g = 1.0 / 3.0_f64.sqrt();
    for a in [-g, g] {
        for b in [-g, g] {
            let n = [
                (1.0 - a) * (1.0 - b) / 4.0,
                (1.0 + a) * (1.0 - b) / 4.0,
                (1.0 + a) * (1.0 + b) / 4.0,
                (1.0 - a) * (1.0 + b) / 4.0,
            ];
            let da = [
                -(1.0 - b) / 4.0,
                (1.0 - b) / 4.0,
                (1.0 + b) / 4.0,
                -(1.0 + b) / 4.0,
            ];
            let db = [
                -(1.0 - a) / 4.0,
                -(1.0 + a) / 4.0,
                (1.0 + a) / 4.0,
                (1.0 - a) / 4.0,
            ];
            let mut tangent_a = [0.0; 3];
            let mut tangent_b = [0.0; 3];
            for local in 0..4 {
                for axis in 0..3 {
                    tangent_a[axis] += da[local] * nodes[face[local]][axis];
                    tangent_b[axis] += db[local] * nodes[face[local]][axis];
                }
            }
            let force = traction(cross(tangent_a, tangent_b), stress());
            for local in 0..4 {
                for axis in 0..3 {
                    total[face[local]][axis] += n[local] * force[axis];
                }
            }
        }
    }
}

fn model() -> (Hex8VolumeRequest, Vec<[f64; 3]>) {
    let mut nodes = vec![[0.0; 3]; NODE_COUNT];
    let mut supports = Vec::new();
    for level in 0..4 {
        for section in 0..11 {
            let node = id(level, section);
            nodes[node] = coordinate(level, section);
            if level == 0 {
                supports.push(Hex8VolumeSupport {
                    node,
                    displacement_m: exact_u(nodes[node]).map(Some),
                });
            }
        }
    }
    let mut boundary_reactions = vec![[0.0; 3]; NODE_COUNT];
    let mut elements = Vec::new();
    let mut face_tractions = Vec::new();
    for level in 0..3 {
        for sector in 0..5 {
            let previous_mid = 6 + (sector + 4) % 5;
            let mid = 6 + sector;
            let ring = [0, previous_mid, 1 + sector, mid];
            let cell = Hex8VolumeCell {
                nodes: [
                    id(level, ring[0]),
                    id(level, ring[1]),
                    id(level, ring[2]),
                    id(level, ring[3]),
                    id(level + 1, ring[0]),
                    id(level + 1, ring[1]),
                    id(level + 1, ring[2]),
                    id(level + 1, ring[3]),
                ],
                material: 0,
            };
            let element_index = elements.len();
            for local in [[1, 2, 6, 5], [2, 3, 7, 6]] {
                face_tractions.push(Hex8VolumeFaceTraction {
                    element: element_index,
                    face_nodes: local,
                    traction_kn_per_m2: face_traction(&nodes, local.map(|n| cell.nodes[n])),
                });
            }
            if level == 0 {
                add_face_forces(
                    &nodes,
                    [0, 3, 2, 1].map(|n| cell.nodes[n]),
                    &mut boundary_reactions,
                );
            }
            if level == 2 {
                let local = [4, 5, 6, 7];
                face_tractions.push(Hex8VolumeFaceTraction {
                    element: element_index,
                    face_nodes: local,
                    traction_kn_per_m2: face_traction(&nodes, local.map(|n| cell.nodes[n])),
                });
            }
            elements.push(cell);
        }
    }
    // The five-valent star is topologically unstructured, and neither storage
    // order nor element traversal follows physical adjacency.
    let original_elements = elements.clone();
    elements.rotate_left(7);
    elements.reverse();
    for load in &mut face_tractions {
        load.element = elements
            .iter()
            .position(|cell| cell.nodes == original_elements[load.element].nodes)
            .unwrap();
    }
    supports.reverse();
    (
        Hex8VolumeRequest {
            nodes,
            materials: vec![Hex8VolumeMaterial {
                e_mpa: E,
                poisson: NU,
            }],
            elements,
            loads: Vec::new(),
            body_forces: Vec::new(),
            face_tractions,
            supports,
            tolerance: 1e-11,
            max_iterations: 1000,
            structured_grid_cells: None,
            threads: 1,
            linear_backend: Hex8LinearBackend::MatrixFreeGeneral,
        },
        boundary_reactions,
    )
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
    );
}

fn check(response: &Hex8VolumeResponse, input: &Hex8VolumeRequest, expected: &[[f64; 3]]) {
    assert!(response.relative_residual < 1e-9);
    for (i, &x) in input.nodes.iter().enumerate() {
        for axis in 0..3 {
            close(
                response.nodal_displacements_m[i][axis],
                exact_u(x)[axis],
                2e-11,
            );
            close(
                response.nodal_reactions_kn[i][axis],
                expected[i][axis],
                1e-5,
            );
        }
    }
    for gauss in response.element_gauss_stress_mpa.iter().flatten() {
        for (actual, expected) in gauss.iter().zip(stress()) {
            close(*actual, expected, 1e-8);
        }
    }
    for axis in 0..3 {
        close(
            response.nodal_reactions_kn.iter().map(|r| r[axis]).sum(),
            expected.iter().map(|r| r[axis]).sum(),
            1e-5,
        );
    }
}

#[test]
fn five_valent_hex_star_matches_hooke_tractions_with_shuffled_connectivity() {
    let (mut input, expected) = model();
    assert_eq!(input.elements.len(), 15);
    assert_eq!(input.nodes.len(), NODE_COUNT);

    let mut results = Vec::new();
    for (backend, threads, name) in [
        (Hex8LinearBackend::MatrixFreeGeneral, 1, "matrixFreeGeneral"),
        (Hex8LinearBackend::MatrixFreeGeneral, 4, "matrixFreeGeneral"),
        (Hex8LinearBackend::Sparse, 1, "sparse"),
    ] {
        input.linear_backend = backend;
        input.threads = threads;
        let result = solve_hex8_volume(input.clone()).unwrap();
        assert_eq!(result.solver_used, name);
        assert_eq!(result.threads, threads);
        assert_eq!(
            result.csr_nonzeros == 0,
            backend != Hex8LinearBackend::Sparse
        );
        check(&result, &input, &expected);
        results.push(result);
    }
    for other in &results[1..] {
        for (a, b) in results[0]
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(other.nodal_displacements_m.iter().flatten())
        {
            close(*a, *b, 1e-12);
        }
    }
}
