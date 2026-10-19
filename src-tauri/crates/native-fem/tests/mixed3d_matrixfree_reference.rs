//! Public mixed3d matrix-free acceptance checks with independent elasticity
//! references, including a coupled Tet4/Hex8/truss model above 600 DOFs.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::mixed3d::{
    solve, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest, Truss3dElement,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const NX: usize = 8;
const NY: usize = 6;
const NZ: usize = 4;
const SPLIT: usize = 4;
const E_MPA: f64 = 3_000.0;
const NU: f64 = 0.25;
const EPS: f64 = 0.001;
const TRUSS_E_MPA: f64 = 210_000.0;
const TRUSS_AREA_M2: f64 = 0.0002;

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.13e}, expected {expected:.13e}, tolerance {tolerance:.2e}"
    );
}

fn fixture_result(backend: &str) -> openaec_native_fem::mixed3d::Mixed3dResult {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../examples/mixed3d-hex8-tet4-truss.json")).unwrap();
    value["input"]["backend"] = backend.into();
    value["input"]["threads"] = 2.into();
    let request: NativeFemRequest = serde_json::from_value(value).unwrap();
    match solve_native_fem(request).expect("public mixed3d dispatch") {
        NativeFemResult::Mixed3d(result) => result,
        _ => panic!("mixed3d request dispatched to another result"),
    }
}

#[test]
fn matrixfree_matches_public_tet_hex_truss_fixture() {
    let dense = fixture_result("dense");
    let matrixfree = fixture_result("matrixFreePcg");
    assert_eq!(matrixfree.backend_used, Mixed3dBackend::MatrixFreePcg);
    assert_eq!(matrixfree.nodal_displacements_m.len(), 9);
    assert_eq!(matrixfree.solid_element_stress_mpa.len(), 2);
    assert_eq!(matrixfree.hex_gauss_stress_mpa.len(), 1);
    assert_eq!(matrixfree.truss_axial_force_kn.len(), 1);
    assert!(matrixfree.linear_iterations > 0);
    assert!(matrixfree.relative_residual < 1e-8);
    for (node, (actual, reference)) in matrixfree
        .nodal_displacements_m
        .iter()
        .zip(&dense.nodal_displacements_m)
        .enumerate()
    {
        for axis in 0..3 {
            close(
                actual[axis],
                reference[axis],
                1e-10,
                &format!("fixture node {node} u{axis}"),
            );
            close(
                matrixfree.nodal_reactions_kn[node][axis],
                dense.nodal_reactions_kn[node][axis],
                1e-5,
                &format!("fixture node {node} reaction {axis}"),
            );
        }
    }
    for (tet, (actual, reference)) in matrixfree
        .solid_element_stress_mpa
        .iter()
        .zip(&dense.solid_element_stress_mpa)
        .enumerate()
    {
        for axis in 0..6 {
            close(
                actual[axis],
                reference[axis],
                1e-7,
                &format!("fixture tet {tet} stress {axis}"),
            );
        }
    }
    for (hex, (actual, reference)) in matrixfree
        .hex_gauss_stress_mpa
        .iter()
        .zip(&dense.hex_gauss_stress_mpa)
        .enumerate()
    {
        for point in 0..8 {
            for axis in 0..6 {
                close(
                    actual[point][axis],
                    reference[point][axis],
                    1e-7,
                    &format!("fixture hex {hex} Gauss {point} stress {axis}"),
                );
            }
        }
    }
    close(
        matrixfree.truss_axial_force_kn[0],
        dense.truss_axial_force_kn[0],
        1e-6,
        "fixture truss",
    );
    for axis in 0..3 {
        let total: f64 = matrixfree.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        close(
            total,
            if axis == 0 { -10.0 } else { 0.0 },
            1e-6,
            "fixture equilibrium",
        );
    }
}

fn id(i: usize, j: usize, k: usize) -> usize {
    i + (NX + 1) * (j + (NY + 1) * k)
}

fn affine(x: [f64; 3]) -> [f64; 3] {
    [EPS * x[0], -NU * EPS * x[1], -NU * EPS * x[2]]
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// Consistent nodal forces from constant uniaxial stress. This uses surface
/// traction and face area, independently of the finite-element matrices.
fn add_face_traction(
    internal: &mut [[f64; 3]],
    nodes: &[[f64; 3]],
    element: &[usize],
    face: &[usize],
) {
    let a = nodes[face[0]];
    let b = nodes[face[1]];
    let c = nodes[face[2]];
    let mut area = cross(sub(b, a), sub(c, a)).map(|v| v / 2.0);
    if face.len() == 4 {
        let d = nodes[face[3]];
        let other = cross(sub(c, a), sub(d, a));
        for axis in 0..3 {
            area[axis] += other[axis] / 2.0;
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
    for &node in face {
        // sigma_xx = E * eps; MPa*m^2 converts to kN by 1000.
        internal[node][0] += 1_000.0 * E_MPA * EPS * area[0] / face.len() as f64;
    }
}

fn affine_mixed_model(threads: usize) -> (Mixed3dRequest, Vec<[f64; 3]>) {
    let regular = Mesh::structured([NX, NY, NZ]).unwrap();
    let nodes = regular.nodes;
    let tets: Vec<_> = regular
        .tets
        .into_iter()
        .filter(|tet| tet.iter().all(|&node| node % (NX + 1) >= SPLIT))
        .collect();
    let hexes: Vec<_> = (0..NZ)
        .flat_map(|k| {
            (0..NY).flat_map(move |j| {
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
    let trusses = vec![Truss3dElement {
        nodes: [id(2, 3, 2), id(3, 3, 2)],
        e_mpa: TRUSS_E_MPA,
        area_m2: TRUSS_AREA_M2,
    }];
    let mut internal = vec![[0.0; 3]; nodes.len()];
    for tet in &tets {
        for local in [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] {
            let face = local.map(|n| tet[n]);
            add_face_traction(&mut internal, &nodes, tet, &face);
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
            add_face_traction(&mut internal, &nodes, &hex.nodes, &face);
        }
    }
    let truss_force = 1_000.0 * TRUSS_E_MPA * TRUSS_AREA_M2 * EPS;
    internal[trusses[0].nodes[0]][0] -= truss_force;
    internal[trusses[0].nodes[1]][0] += truss_force;
    let prescribed_m: Vec<_> = nodes
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
            trusses,
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
            max_front_dofs: 64,
            threads,
            max_pcg_iterations: 10_000,
        },
        internal,
    )
}

#[test]
fn matrixfree_affine_mixed_grid_matches_traction_and_truss_references() {
    for threads in [1, 4] {
        let (request, internal) = affine_mixed_model(threads);
        assert_eq!(request.mesh.nodes.len() * 3, 945);
        assert_eq!(request.hexes.len(), 96);
        assert_eq!(request.mesh.tets.len(), 576);
        assert_eq!(request.trusses.len(), 1);
        assert!(request.prescribed_m[id(SPLIT, 3, 2)]
            .iter()
            .all(Option::is_none));
        let result = solve(&request).expect("matrix-free mixed affine grid");
        assert_eq!(result.backend_used, Mixed3dBackend::MatrixFreePcg);
        assert!(result.linear_iterations > 0);
        assert!(result.relative_residual < 1e-8);
        for (node, &position) in request.mesh.nodes.iter().enumerate() {
            let expected_u = affine(position);
            for axis in 0..3 {
                close(
                    result.nodal_displacements_m[node][axis],
                    expected_u[axis],
                    1e-9,
                    &format!("threads {threads} node {node} displacement {axis}"),
                );
                close(
                    result.nodal_reactions_kn[node][axis],
                    internal[node][axis] - request.loads_kn[node][axis],
                    5e-4,
                    &format!("threads {threads} node {node} reaction {axis}"),
                );
            }
        }
        for (element, stress) in result.solid_element_stress_mpa.iter().enumerate() {
            close(
                stress[0],
                E_MPA * EPS,
                1e-5,
                &format!("tet {element} sigma_xx"),
            );
            for (axis, &component) in stress.iter().enumerate().skip(1) {
                close(
                    component,
                    0.0,
                    1e-5,
                    &format!("tet {element} stress {axis}"),
                );
            }
        }
        for (element, points) in result.hex_gauss_stress_mpa.iter().enumerate() {
            for (point, stress) in points.iter().enumerate() {
                close(
                    stress[0],
                    E_MPA * EPS,
                    1e-5,
                    &format!("hex {element} Gauss {point} sigma_xx"),
                );
                for (axis, &component) in stress.iter().enumerate().skip(1) {
                    close(
                        component,
                        0.0,
                        1e-5,
                        &format!("hex {element} Gauss {point} stress {axis}"),
                    );
                }
            }
        }
        close(
            result.truss_axial_force_kn[0],
            1_000.0 * TRUSS_E_MPA * TRUSS_AREA_M2 * EPS,
            1e-5,
            "affine truss force",
        );
    }
}
