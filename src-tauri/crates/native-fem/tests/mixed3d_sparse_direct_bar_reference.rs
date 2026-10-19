//! A 60-cell Hex8 bar exceeds the 600-DOF dense limit. With ν=0 and a
//! uniform end traction, the independent continuum solution is FL/(EA).

use openaec_native_fem::mixed3d::{solve, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const CELLS: usize = 60;
const END_FORCE_KN: f64 = 100.0;
const E_MPA: f64 = 1_000.0;

fn node(i: usize, corner: usize) -> usize {
    4 * i + corner
}

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut nodes = Vec::with_capacity(4 * (CELLS + 1));
    for i in 0..=CELLS {
        for (y, z) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)] {
            nodes.push([i as f64, y, z]);
        }
    }
    let hexes = (0..CELLS)
        .map(|i| Hex8MixedElement {
            nodes: [
                node(i, 0),
                node(i + 1, 0),
                node(i + 1, 1),
                node(i, 1),
                node(i, 3),
                node(i + 1, 3),
                node(i + 1, 2),
                node(i, 2),
            ],
            e_mpa: E_MPA,
            poisson: 0.0,
        })
        .collect();
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    for corner in 0..4 {
        loads_kn[node(CELLS, corner)][0] = END_FORCE_KN / 4.0;
    }
    let mut prescribed_m = vec![[None; 3]; nodes.len()];
    for corner in 0..4 {
        prescribed_m[node(0, corner)] = [Some(0.0); 3];
    }
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![],
        },
        solid_material: Volume3dMaterial {
            e_mpa: E_MPA,
            poisson: 0.0,
        },
        tet_materials: None,
        hexes,
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![],
        frames: vec![],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        loads_kn,
        moments_knm: vec![],
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m,
        prescribed_rotations_rad: vec![],
        backend,
        max_front_dofs: 4_096,
        threads: 2,
        max_pcg_iterations: 10_000,
    }
}

#[test]
fn sparse_direct_assembles_csr_above_dense_limit_and_matches_continuum_bar() {
    let input = model(Mixed3dBackend::SparseDirect);
    assert_eq!(input.mesh.nodes.len() * 3, 732);
    assert_eq!(input.hexes.len(), 60);
    let direct = solve(&input).expect("sparse LDLT 60-cell bar");
    assert_eq!(direct.backend_used, Mixed3dBackend::SparseDirect);
    assert!(direct.relative_residual < 1e-9);
    // E is MPa, force is kN, and cross-section is 1 m²:
    // σ = 100 kN/m² = 0.1 MPa; ε = σ/E = 1e-4; u(L=60 m)=0.006 m.
    let expected_m = END_FORCE_KN * CELLS as f64 / (1_000.0 * E_MPA);
    for corner in 0..4 {
        let u = direct.nodal_displacements_m[node(CELLS, corner)];
        assert!((u[0] - expected_m).abs() < 1e-9, "end node {corner}: {u:?}");
        assert!(u[1].abs() < 1e-10 && u[2].abs() < 1e-10);
    }
    let reaction: f64 = direct.nodal_reactions_kn.iter().map(|value| value[0]).sum();
    assert!((reaction + END_FORCE_KN).abs() < 1e-5);
    let pcg = solve(&model(Mixed3dBackend::SparsePcg)).expect("sparse PCG bar comparison");
    assert!(pcg.relative_residual < 1e-8);
    for corner in 0..4 {
        let a = direct.nodal_displacements_m[node(CELLS, corner)][0];
        let b = pcg.nodal_displacements_m[node(CELLS, corner)][0];
        assert!(
            (a - b).abs() < 1e-8,
            "direct/PCG end displacement: {a} vs {b}"
        );
    }
}

#[test]
fn sparse_direct_rejects_over_budget_dimension_before_factorization() {
    let mut input = model(Mixed3dBackend::SparseDirect);
    while input.mesh.nodes.len() * 3 <= 10_000 {
        input
            .mesh
            .nodes
            .push([1_000.0 + input.mesh.nodes.len() as f64, 0.0, 0.0]);
        input.loads_kn.push([0.0; 3]);
        input.prescribed_m.push([None; 3]);
    }
    let error = solve(&input).unwrap_err();
    assert!(
        error.contains("sparseDirect is limited to 10000 DOFs"),
        "{error}"
    );
}
