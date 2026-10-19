//! Explicit large mixed3d release gate:
//! `cargo test --release -p openaec-native-fem --test mixed3d_matrixfree_250k_release_acceptance -- --ignored --nocapture`
//!
//! A conforming 42³ grid contains 37,044 Hex8 cells on one side and 222,264
//! Tet4 cells on the other. An interior diagonal truss shares solid nodes.
//! Nodal loads and expected reactions come from integrating the analytical
//! affine stress over element faces, independent of the solver's stiffness.

use std::time::Instant;

use openaec_native_fem::mixed3d::{
    solve, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest, Truss3dElement,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const N: usize = 42;
const SPLIT: usize = N / 2;
const E_MPA: f64 = 3_000.0;
const NU: f64 = 0.2;
const TRUSS_E_MPA: f64 = 210_000.0;
const TRUSS_AREA_M2: f64 = 0.0002;
// Rows are displacement components, columns are coordinate components.
const GRAD_U: [[f64; 3]; 3] = [
    [0.0011, 0.00019, -0.00014],
    [-0.00008, -0.00042, 0.00023],
    [0.00012, 0.00007, 0.00063],
];

fn id(i: usize, j: usize, k: usize) -> usize {
    i + (N + 1) * (j + (N + 1) * k)
}

fn affine(x: [f64; 3]) -> [f64; 3] {
    let translation = [0.00013, -0.00007, 0.00011];
    std::array::from_fn(|axis| {
        translation[axis] + (0..3).map(|a| GRAD_U[axis][a] * x[a]).sum::<f64>()
    })
}

fn exact_stress() -> [f64; 6] {
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

fn add_face_force(
    forces: &mut [[f64; 3]],
    nodes: &[[f64; 3]],
    element: &[usize],
    face: &[usize],
    sigma: [f64; 6],
) {
    let a = nodes[face[0]];
    let b = nodes[face[1]];
    let c = nodes[face[2]];
    let mut area = cross(sub(b, a), sub(c, a)).map(|v| v / 2.0);
    if face.len() == 4 {
        let d = nodes[face[3]];
        let remainder = cross(sub(c, a), sub(d, a));
        for axis in 0..3 {
            area[axis] += remainder[axis] / 2.0;
        }
    }
    let face_center: [f64; 3] = std::array::from_fn(|axis| {
        face.iter().map(|&node| nodes[node][axis]).sum::<f64>() / face.len() as f64
    });
    let element_center: [f64; 3] = std::array::from_fn(|axis| {
        element.iter().map(|&node| nodes[node][axis]).sum::<f64>() / element.len() as f64
    });
    if (0..3)
        .map(|axis| area[axis] * (face_center[axis] - element_center[axis]))
        .sum::<f64>()
        < 0.0
    {
        area = area.map(|v| -v);
    }
    let [nx, ny, nz] = area;
    let traction = [
        sigma[0] * nx + sigma[3] * ny + sigma[5] * nz,
        sigma[3] * nx + sigma[1] * ny + sigma[4] * nz,
        sigma[5] * nx + sigma[4] * ny + sigma[2] * nz,
    ];
    for &node in face {
        for axis in 0..3 {
            // MPa m² = MN, converted to kN. Constant traction integrates
            // equally to each linear triangle / planar quadrilateral node.
            forces[node][axis] += 1_000.0 * traction[axis] / face.len() as f64;
        }
    }
}

fn peak_rss_kib() -> Option<usize> {
    std::fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

fn model() -> (Mixed3dRequest, Vec<[f64; 3]>, f64) {
    let regular = Mesh::structured([N, N, N]).expect("structured grid");
    let nodes = regular.nodes;
    let tets: Vec<_> = regular
        .tets
        .into_iter()
        .filter(|tet| tet.iter().all(|&node| node % (N + 1) >= SPLIT))
        .collect();
    let hexes: Vec<_> = (0..N)
        .flat_map(|k| {
            (0..N).flat_map(move |j| {
                (0..SPLIT).map(move |i| Hex8MixedElement {
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
                    e_mpa: E_MPA,
                    poisson: NU,
                })
            })
        })
        .collect();
    let truss = Truss3dElement {
        nodes: [id(10, 18, 19), id(11, 19, 20)],
        e_mpa: TRUSS_E_MPA,
        area_m2: TRUSS_AREA_M2,
    };
    let a = nodes[truss.nodes[0]];
    let b = nodes[truss.nodes[1]];
    let delta = sub(b, a);
    let length = delta.iter().map(|v| v * v).sum::<f64>().sqrt();
    let direction = delta.map(|v| v / length);
    let displacement_delta = sub(affine(b), affine(a));
    let extension: f64 = (0..3)
        .map(|axis| direction[axis] * displacement_delta[axis])
        .sum();
    let truss_force_kn = 1_000.0 * TRUSS_E_MPA * TRUSS_AREA_M2 * extension / length;

    let sigma = exact_stress();
    let mut internal = vec![[0.0; 3]; nodes.len()];
    for tet in &tets {
        for local in [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] {
            add_face_force(&mut internal, &nodes, tet, &local.map(|n| tet[n]), sigma);
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
            add_face_force(
                &mut internal,
                &nodes,
                &hex.nodes,
                &local.map(|n| hex.nodes[n]),
                sigma,
            );
        }
    }
    for axis in 0..3 {
        internal[truss.nodes[0]][axis] -= truss_force_kn * direction[axis];
        internal[truss.nodes[1]][axis] += truss_force_kn * direction[axis];
    }
    let prescribed_m: Vec<_> = nodes
        .iter()
        .enumerate()
        .map(|(node, &x)| {
            let i = node % (N + 1);
            let j = node / (N + 1) % (N + 1);
            let k = node / ((N + 1) * (N + 1));
            if i == 0 || i == N || j == 0 || j == N || k == 0 || k == N {
                affine(x).map(Some)
            } else {
                [None; 3]
            }
        })
        .collect();
    let loads_kn = internal
        .iter()
        .zip(&prescribed_m)
        .map(|(&force, support)| {
            std::array::from_fn(|axis| {
                if support[axis].is_none() {
                    force[axis]
                } else {
                    0.0
                }
            })
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
            trusses: vec![truss],
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
            backend: Mixed3dBackend::MatrixFreePcg,
            max_front_dofs: 128,
            threads: 4,
            max_pcg_iterations: 10_000,
        },
        internal,
        truss_force_kn,
    )
}

#[test]
#[ignore = "259,308 coupled volume elements; run explicitly in release with adequate RAM"]
fn coupled_259308_elements_affine_traction_reaction_stress() {
    let (request, internal, truss_force_kn) = model();
    let nodes = (N + 1).pow(3);
    assert_eq!(request.mesh.nodes.len(), nodes);
    assert_eq!(request.hexes.len(), 37_044);
    assert_eq!(request.mesh.tets.len(), 222_264);
    assert_eq!(request.mesh.tets.len() + request.hexes.len(), 259_308);
    assert_eq!(request.trusses.len(), 1);
    assert!(request.prescribed_m[id(SPLIT, N / 2, N / 2)]
        .iter()
        .all(Option::is_none));

    let started = Instant::now();
    let result = solve(&request).expect("large coupled matrix-free solve");
    let seconds = started.elapsed().as_secs_f64();
    let peak_kib = peak_rss_kib();
    assert_eq!(result.backend_used, Mixed3dBackend::MatrixFreePcg);
    assert_eq!(result.nodal_displacements_m.len(), nodes);
    assert_eq!(result.nodal_reactions_kn.len(), nodes);
    assert_eq!(result.solid_element_stress_mpa.len(), 222_264);
    assert_eq!(result.hex_gauss_stress_mpa.len(), 37_044);
    assert_eq!(result.truss_axial_force_kn.len(), 1);
    assert!(result.linear_iterations > 0);

    let sigma = exact_stress();
    let mut max_u_error = 0.0_f64;
    let mut max_reaction_error = 0.0_f64;
    let mut reaction_sum = [0.0_f64; 3];
    for (node, &x) in request.mesh.nodes.iter().enumerate() {
        let expected_u = affine(x);
        for axis in 0..3 {
            max_u_error = max_u_error
                .max((result.nodal_displacements_m[node][axis] - expected_u[axis]).abs());
            let expected_reaction = internal[node][axis] - request.loads_kn[node][axis];
            max_reaction_error = max_reaction_error
                .max((result.nodal_reactions_kn[node][axis] - expected_reaction).abs());
            reaction_sum[axis] += result.nodal_reactions_kn[node][axis];
        }
    }
    let max_stress_error = result
        .solid_element_stress_mpa
        .iter()
        .chain(result.hex_gauss_stress_mpa.iter().flatten())
        .flat_map(|stress| (0..6).map(move |axis| (stress[axis] - sigma[axis]).abs()))
        .fold(0.0_f64, f64::max);
    let truss_error = (result.truss_axial_force_kn[0] - truss_force_kn).abs();
    let applied_sum: [f64; 3] =
        std::array::from_fn(|axis| request.loads_kn.iter().map(|load| load[axis]).sum());
    let equilibrium_error = (0..3)
        .map(|axis| (reaction_sum[axis] + applied_sum[axis]).abs())
        .fold(0.0_f64, f64::max);
    eprintln!(
        "mixed3d: 259308 volumes (222264 Tet4 + 37044 Hex8), 1 truss, \
         {nodes} nodes, {} DOF, 4 threads; solve={seconds:.3}s, \
         iterations={}, residual={:.3e}, peak VmHWM={peak_kib:?} KiB; \
         max displacement={max_u_error:.3e} m, reaction={max_reaction_error:.3e} kN, \
         stress={max_stress_error:.3e} MPa, truss={truss_error:.3e} kN, \
         equilibrium={equilibrium_error:.3e} kN",
        nodes * 3,
        result.linear_iterations,
        result.relative_residual,
    );
    assert!(result.relative_residual < 1e-8);
    assert!(max_u_error < 1e-7);
    assert!(max_reaction_error < 1e-2);
    assert!(max_stress_error < 1e-2);
    assert!(truss_error < 1e-4);
    assert!(equilibrium_error < 1e-3);
}
