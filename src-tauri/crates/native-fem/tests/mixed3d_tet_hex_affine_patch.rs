//! Affine elasticity patch across a shared Tet4/Hex8 face. Expected nodal
//! forces come from physical face tractions, independent of element stiffness.

use openaec_native_fem::mixed3d::{solve, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const E_MPA: f64 = 3_000.0;
const NU: f64 = 0.2;
const ORIGIN: [f64; 3] = [0.31, -0.22, 0.14];
// Physical columns for one full logical grid step in x, y, and z.
const BASIS: [[f64; 3]; 3] = [[0.82, 0.09, -0.04], [0.13, 0.68, 0.08], [0.07, -0.06, 0.91]];
const GRAD_U: [[f64; 3]; 3] = [
    [0.0011, 0.00019, -0.00014],
    [-0.00008, -0.00042, 0.00023],
    [0.00012, 0.00007, 0.00063],
];

fn index(i: usize, j: usize, k: usize) -> usize {
    i + 3 * j + 9 * k
}

fn physical(i: usize, j: usize, k: usize) -> [f64; 3] {
    std::array::from_fn(|axis| {
        ORIGIN[axis]
            + i as f64 * BASIS[0][axis]
            + j as f64 * BASIS[1][axis] / 2.0
            + k as f64 * BASIS[2][axis] / 2.0
    })
}

fn affine_u(x: [f64; 3]) -> [f64; 3] {
    let translation = [0.00013, -0.00007, 0.00011];
    std::array::from_fn(|axis| {
        translation[axis] + (0..3).map(|a| GRAD_U[axis][a] * x[a]).sum::<f64>()
    })
}

fn stress() -> [f64; 6] {
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

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|axis| a[axis] - b[axis])
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn outward_area_vector(nodes: &[[f64; 3]], element: &[usize], face: &[usize]) -> [f64; 3] {
    let a = nodes[face[0]];
    let b = nodes[face[1]];
    let c = nodes[face[2]];
    let mut area = cross(sub(b, a), sub(c, a)).map(|v| v / 2.0);
    if face.len() == 4 {
        let d = nodes[face[3]];
        let second = cross(sub(c, a), sub(d, a));
        for axis in 0..3 {
            area[axis] += second[axis] / 2.0;
        }
    }
    let face_center: [f64; 3] = std::array::from_fn(|axis| {
        face.iter().map(|&n| nodes[n][axis]).sum::<f64>() / face.len() as f64
    });
    let element_center: [f64; 3] = std::array::from_fn(|axis| {
        element.iter().map(|&n| nodes[n][axis]).sum::<f64>() / element.len() as f64
    });
    if (0..3)
        .map(|axis| area[axis] * (face_center[axis] - element_center[axis]))
        .sum::<f64>()
        < 0.0
    {
        area = area.map(|v| -v);
    }
    area
}

fn add_face_forces(
    forces: &mut [[f64; 3]],
    nodes: &[[f64; 3]],
    element: &[usize],
    face: &[usize],
    sigma: [f64; 6],
) {
    let [nx, ny, nz] = outward_area_vector(nodes, element, face);
    let traction = [
        sigma[0] * nx + sigma[3] * ny + sigma[5] * nz,
        sigma[3] * nx + sigma[1] * ny + sigma[4] * nz,
        sigma[5] * nx + sigma[4] * ny + sigma[2] * nz,
    ];
    for &node in face {
        for axis in 0..3 {
            // MPa·m² = MN; convert to kN. Linear triangle and planar
            // parallelogram quadrilateral integrate uniform traction equally.
            forces[node][axis] += 1_000.0 * traction[axis] / face.len() as f64;
        }
    }
}

fn fixture(backend: Mixed3dBackend) -> (Mixed3dRequest, Vec<[f64; 3]>) {
    // Four Hex8 cells fill the left half of the prism; 24 Tet4 cells fill
    // the right half. Their x=1 face shares all nine geometric nodes.
    let nodes: Vec<_> = (0..3)
        .flat_map(|k| (0..3).flat_map(move |j| (0..3).map(move |i| physical(i, j, k))))
        .collect();
    let regular = Mesh::structured([2, 2, 2]).unwrap();
    let tets: Vec<_> = regular
        .tets
        .into_iter()
        .filter(|tet| tet.iter().all(|&node| node % 3 >= 1))
        .collect();
    assert_eq!(tets.len(), 24);
    let hexes: Vec<_> = (0..2)
        .flat_map(|k| {
            (0..2).map(move |j| Hex8MixedElement {
                nodes: [
                    index(0, j, k),
                    index(1, j, k),
                    index(1, j + 1, k),
                    index(0, j + 1, k),
                    index(0, j, k + 1),
                    index(1, j, k + 1),
                    index(1, j + 1, k + 1),
                    index(0, j + 1, k + 1),
                ],
                e_mpa: E_MPA,
                poisson: NU,
            })
        })
        .collect();
    let sigma = stress();
    let mut internal = vec![[0.0; 3]; nodes.len()];
    for tet in &tets {
        for local in [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] {
            let face = local.map(|n| tet[n]);
            add_face_forces(&mut internal, &nodes, tet, &face, sigma);
        }
    }
    for hex in &hexes {
        for local in [
            [0, 3, 2, 1],
            [4, 5, 6, 7],
            [0, 1, 5, 4],
            [1, 2, 6, 5],
            [2, 3, 7, 6],
            [3, 0, 4, 7],
        ] {
            let face = local.map(|n| hex.nodes[n]);
            add_face_forces(&mut internal, &nodes, &hex.nodes, &face, sigma);
        }
    }
    let center = index(1, 1, 1);
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    // The two element families have different consistent nodal weights on
    // their shared face. Its independently integrated imbalance is applied
    // as a nodal force so the affine field is the exact discrete solution.
    loads_kn[center] = internal[center];
    let prescribed_m = nodes
        .iter()
        .enumerate()
        .map(|(node, &x)| {
            if node == center {
                [None; 3]
            } else {
                affine_u(x).map(Some)
            }
        })
        .collect();
    (
       Mixed3dRequest {
            bending_plates: vec![],
            mesh: Mesh { nodes, tets },
            solid_material: Volume3dMaterial {
                e_mpa: E_MPA,
                poisson: NU,
            },
            tet_materials: None,
            hexes,
            membranes: vec![],
            membrane_tractions: vec![],
            trusses: vec![],
            loads_kn,
            tet_body_forces: vec![],
            tet_face_tractions: vec![],
            hex_body_forces: vec![],
            hex_face_tractions: vec![],
            prescribed_m,
            frames: vec![],
            frame_member_loads: vec![],
            frame_member_point_loads: vec![],
            moments_knm: vec![],
            prescribed_rotations_rad: vec![],
            backend,
            max_front_dofs: 128,
            threads: 1,
            max_pcg_iterations: 10_000,
        },
        internal,
    )
}

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.13e}, expected {expected:.13e}, tolerance {tolerance:.2e}"
    );
}

#[test]
fn coupled_tet4_hex8_affine_patch_matches_integrated_tractions() {
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
    ] {
        let (request, internal) = fixture(backend);
        let result = solve(&request).expect("coupled affine patch solve");
        assert_eq!(result.backend_used, backend);
        assert_eq!(result.solid_element_stress_mpa.len(), 24);
        assert_eq!(result.hex_gauss_stress_mpa.len(), 4);
        assert!(result.relative_residual < 1e-9);
        for (node, &x) in request.mesh.nodes.iter().enumerate() {
            let expected_u = affine_u(x);
            for axis in 0..3 {
                close(
                    result.nodal_displacements_m[node][axis],
                    expected_u[axis],
                    2e-11,
                    &format!("{backend:?} node {node} displacement {axis}"),
                );
                close(
                    result.nodal_reactions_kn[node][axis],
                    internal[node][axis] - request.loads_kn[node][axis],
                    2e-7,
                    &format!("{backend:?} node {node} reaction {axis}"),
                );
            }
        }
        for (element, actual) in result.solid_element_stress_mpa.iter().enumerate() {
            for (axis, (&got, expected)) in actual.iter().zip(stress()).enumerate() {
                close(
                    got,
                    expected,
                    2e-9,
                    &format!("{backend:?} tet {element} stress {axis}"),
                );
            }
        }
        for (element, gauss_points) in result.hex_gauss_stress_mpa.iter().enumerate() {
            for (point, actual) in gauss_points.iter().enumerate() {
                for (axis, (&got, expected)) in actual.iter().zip(stress()).enumerate() {
                    close(
                        got,
                        expected,
                        2e-9,
                        &format!("{backend:?} hex {element} Gauss {point} stress {axis}"),
                    );
                }
            }
        }
    }
}
