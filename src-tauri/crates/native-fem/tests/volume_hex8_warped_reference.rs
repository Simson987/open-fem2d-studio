//! Independent 3D patch test for distorted Hex8 cells. The exact affine
//! displacement and exterior traction integrals are derived without using the
//! element stiffness or shape-gradient implementation under test.

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, uniaxial_cube_example, Hex8LinearBackend, Hex8VolumeCell,
    Hex8VolumeMaterial, Hex8VolumeRequest, Hex8VolumeSupport,
};

const E_MPA: f64 = 32_000.0;
const NU: f64 = 0.25;
// Columns of a non-orthogonal physical transformation (metres per grid unit).
const A: [[f64; 3]; 3] = [[0.9, 0.2, 0.1], [0.12, 0.8, 0.18], [0.07, -0.13, 1.1]];
// Rows of the prescribed displacement gradient; includes shear and rotation.
const GRAD_U: [[f64; 3]; 3] = [
    [0.0009, 0.0002, -0.0001],
    [0.0003, -0.0004, 0.00025],
    [0.0004, -0.00015, 0.0006],
];

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn idx(i: usize, j: usize, k: usize) -> usize {
    i + 3 * j + 9 * k
}

fn exact_u(x: [f64; 3]) -> [f64; 3] {
    let translation = [0.00012, -0.00008, 0.00005];
    std::array::from_fn(|row| {
        translation[row] + (0..3).map(|col| GRAD_U[row][col] * x[col]).sum::<f64>()
    })
}

fn stress_mpa() -> [f64; 6] {
    let lambda = E_MPA * NU / ((1.0 + NU) * (1.0 - 2.0 * NU));
    let mu = E_MPA / (2.0 * (1.0 + NU));
    let trace = GRAD_U[0][0] + GRAD_U[1][1] + GRAD_U[2][2];
    [
        lambda * trace + 2.0 * mu * GRAD_U[0][0],
        lambda * trace + 2.0 * mu * GRAD_U[1][1],
        lambda * trace + 2.0 * mu * GRAD_U[2][2],
        mu * (GRAD_U[0][1] + GRAD_U[1][0]),
        mu * (GRAD_U[1][2] + GRAD_U[2][1]),
        mu * (GRAD_U[2][0] + GRAD_U[0][2]),
    ]
}

fn traction_kn(area_vector: [f64; 3], sigma: [f64; 6]) -> [f64; 3] {
    // MPa * m² = MN; result is kN. Symmetric tensor order xx,yy,zz,xy,yz,zx.
    [
        1000.0
            * (sigma[0] * area_vector[0] + sigma[3] * area_vector[1] + sigma[5] * area_vector[2]),
        1000.0
            * (sigma[3] * area_vector[0] + sigma[1] * area_vector[1] + sigma[4] * area_vector[2]),
        1000.0
            * (sigma[5] * area_vector[0] + sigma[4] * area_vector[1] + sigma[2] * area_vector[2]),
    ]
}

fn boundary_reaction(i: usize, j: usize, k: usize) -> [f64; 3] {
    let sigma = stress_mpa();
    let mut result = [0.0; 3];
    for (coordinate, a, b, other_a, other_b) in [
        (i, A[1], A[2], j, k),
        (j, A[2], A[0], k, i),
        (k, A[0], A[1], i, j),
    ] {
        if coordinate == 1 {
            continue;
        }
        let face_count = (if other_a == 1 { 2 } else { 1 }) * (if other_b == 1 { 2 } else { 1 });
        let sign = if coordinate == 0 { -1.0 } else { 1.0 };
        let oriented_area = cross(a, b).map(|v| sign * face_count as f64 * v / 4.0);
        let face_force = traction_kn(oriented_area, sigma);
        for axis in 0..3 {
            result[axis] += face_force[axis];
        }
    }
    result
}

fn warped_patch() -> Hex8VolumeRequest {
    let mut request = uniaxial_cube_example();
    request.nodes.clear();
    request.elements.clear();
    request.loads.clear();
    request.supports.clear();
    request.materials = vec![Hex8VolumeMaterial {
        e_mpa: E_MPA,
        poisson: NU,
    }];
    for k in 0..3 {
        for j in 0..3 {
            for i in 0..3 {
                let mut x = [0.4, -0.2, 0.1];
                for axis in 0..3 {
                    x[axis] +=
                        i as f64 * A[0][axis] + j as f64 * A[1][axis] + k as f64 * A[2][axis];
                }
                if [i, j, k] == [1, 1, 1] {
                    // Distorts all eight cells while preserving planar outer faces.
                    x[0] += 0.09;
                    x[1] -= 0.06;
                    x[2] += 0.07;
                }
                if i != 1 || j != 1 || k != 1 {
                    request.supports.push(Hex8VolumeSupport {
                        node: idx(i, j, k),
                        displacement_m: exact_u(x).map(Some),
                    });
                }
                request.nodes.push(x);
            }
        }
    }
    for k in 0..2 {
        for j in 0..2 {
            for i in 0..2 {
                request.elements.push(Hex8VolumeCell {
                    nodes: [
                        idx(i, j, k),
                        idx(i + 1, j, k),
                        idx(i + 1, j + 1, k),
                        idx(i, j + 1, k),
                        idx(i, j, k + 1),
                        idx(i + 1, j, k + 1),
                        idx(i + 1, j + 1, k + 1),
                        idx(i, j + 1, k + 1),
                    ],
                    material: 0,
                });
            }
        }
    }
    request.tolerance = 1e-10;
    request
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
    );
}

#[test]
fn warped_eight_hex_patch_matches_affine_stress_and_exterior_reactions() {
    let request = warped_patch();
    let mut results = Vec::new();
    for backend in [
        Hex8LinearBackend::Sparse,
        Hex8LinearBackend::SparseDirect,
        Hex8LinearBackend::FrontalWave,
        Hex8LinearBackend::MatrixFreeGeneral,
        Hex8LinearBackend::MatrixFreeGeneralLarge,
        Hex8LinearBackend::Automatic,
    ] {
        let mut input = request.clone();
        input.linear_backend = backend;
        let output = solve_hex8_volume(input).unwrap();
        assert!(output.relative_residual < 1e-9);
        assert_eq!(
            output.solver_used,
            match backend {
                Hex8LinearBackend::Sparse => "sparse",
                Hex8LinearBackend::SparseDirect => "sparseDirect",
                Hex8LinearBackend::FrontalWave => "frontalWave",
                Hex8LinearBackend::MatrixFreeGeneral => "matrixFreeGeneral",
                Hex8LinearBackend::MatrixFreeGeneralLarge => "matrixFreeGeneralLarge",
                Hex8LinearBackend::Automatic => "sparse",
            }
        );
        for (node, &x) in request.nodes.iter().enumerate() {
            let u = exact_u(x);
            let i = node % 3;
            let j = (node / 3) % 3;
            let k = node / 9;
            let reaction = boundary_reaction(i, j, k);
            for axis in 0..3 {
                close(output.nodal_displacements_m[node][axis], u[axis], 1e-11);
                close(output.nodal_reactions_kn[node][axis], reaction[axis], 1e-6);
            }
        }
        for element in &output.element_gauss_stress_mpa {
            for gauss in element {
                for (actual, expected) in gauss.iter().zip(stress_mpa()) {
                    close(*actual, expected, 1e-8);
                }
            }
        }
        for axis in 0..3 {
            close(
                output.nodal_reactions_kn.iter().map(|r| r[axis]).sum(),
                0.0,
                1e-6,
            );
        }
        results.push(output);
    }
    for alternate in &results[1..] {
        for (sparse, other) in results[0]
            .nodal_displacements_m
            .iter()
            .zip(&alternate.nodal_displacements_m)
        {
            for axis in 0..3 {
                close(sparse[axis], other[axis], 1e-12);
            }
        }
    }
}

#[test]
fn severely_warped_cell_is_rejected_for_nonpositive_gauss_jacobian() {
    let mut request = warped_patch();
    // Drag the sole interior node through the opposite face of its adjacent
    // cells. This is a geometric inversion, not merely a permuted node list.
    let center = &mut request.nodes[idx(1, 1, 1)];
    for axis in 0..3 {
        center[axis] += 2.5 * A[0][axis];
    }
    for backend in [
        Hex8LinearBackend::Sparse,
        Hex8LinearBackend::SparseDirect,
        Hex8LinearBackend::FrontalWave,
        Hex8LinearBackend::MatrixFreeGeneral,
        Hex8LinearBackend::MatrixFreeGeneralLarge,
        Hex8LinearBackend::Automatic,
    ] {
        request.linear_backend = backend;
        let error = solve_hex8_volume(request.clone()).unwrap_err();
        assert!(error.contains("Jacobian"), "{error}");
    }
}
