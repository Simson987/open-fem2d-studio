//! A 300-Hex8 / 1,452-DOF affine patch exercises the mixed kernel's bounded
//! CSR-PCG backend beyond its dense limit, with independently known solution.

use openaec_native_fem::mixed3d::{solve, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const NX: usize = 10;
const NY: usize = 10;
const NZ: usize = 3;
const E: f64 = 3000.0;
const NU: f64 = 0.25;
const EPS: f64 = 0.001;

fn id(i: usize, j: usize, k: usize) -> usize {
    i + (NX + 1) * (j + (NY + 1) * k)
}

fn affine(x: [f64; 3]) -> [f64; 3] {
    [EPS * x[0], -NU * EPS * x[1], -NU * EPS * x[2]]
}

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    let nodes: Vec<_> = (0..=NZ)
        .flat_map(|k| {
            (0..=NY).flat_map(move |j| (0..=NX).map(move |i| [i as f64, j as f64, k as f64]))
        })
        .collect();
    let hexes: Vec<_> = (0..NZ)
        .flat_map(|k| {
            (0..NY).flat_map(move |j| {
                (0..NX).map(move |i| Hex8MixedElement {
                    nodes: [
                        id(i, j, k),
                        id(i + 1, j, k),
                        id(i + 1, j + 1, k),
                        id(i, j + 1, k),
                        id(i, j, k + 1),
                        id(i + 1, j, k + 1),
                        id(i + 1, j + 1, k + 1),
                        id(i, j + 1, k + 1),
                    ],
                    e_mpa: E,
                    poisson: NU,
                })
            })
        })
        .collect();
    let prescribed_m = nodes
        .iter()
        .enumerate()
        .map(|(node, &x)| {
            let i = node % (NX + 1);
            let j = node / (NX + 1) % (NY + 1);
            let k = node / ((NX + 1) * (NY + 1));
            if i == 0 || i == NX || j == 0 || j == NY || k == 0 || k == NZ {
                affine(x).map(Some)
            } else {
                [None; 3]
            }
        })
        .collect();
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![],
        },
        solid_material: Volume3dMaterial {
            e_mpa: E,
            poisson: NU,
        },
        tet_materials: None,
        hexes,
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![],
        loads_kn: vec![[0.0; 3]; (NX + 1) * (NY + 1) * (NZ + 1)],
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
        max_front_dofs: 64,
        threads: 1,
        max_pcg_iterations: 10_000,
    }
}

#[test]
fn csr_pcg_solves_affine_hex_grid_above_dense_limit() {
    let input = model(Mixed3dBackend::SparsePcg);
    assert_eq!(input.mesh.nodes.len() * 3, 1452);
    assert_eq!(input.hexes.len(), 300);
    let result = solve(&input).expect("mixed CSR-PCG affine patch");
    assert_eq!(result.backend_used, Mixed3dBackend::SparsePcg);
    assert!(result.linear_iterations > 0);
    assert!(result.relative_residual < 1e-8);
    for (node, &position) in input.mesh.nodes.iter().enumerate() {
        for axis in 0..3 {
            assert!(
                (result.nodal_displacements_m[node][axis] - affine(position)[axis]).abs() < 1e-9
            );
        }
    }
    for point in result.hex_gauss_stress_mpa.iter().flatten() {
        assert!((point[0] - E * EPS).abs() < 1e-7);
        assert!(point[1..].iter().all(|v| v.abs() < 1e-7));
    }
    assert!(solve(&model(Mixed3dBackend::Dense))
        .unwrap_err()
        .contains("600 DOFs"));
}

#[test]
fn oversized_mixed_local_matrix_storage_fails_before_assembly() {
    let mut input = model(Mixed3dBackend::SparsePcg);
    input.hexes = vec![input.hexes[0]; 14_000];
    assert!(solve(&input).unwrap_err().contains("8M entries"));
}
