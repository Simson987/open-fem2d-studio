//! A shared Tet4 vertex is not a bending connection between two solid bodies.
//! A DKT plate and a frame that lie entirely on the restrained body must not
//! make zero-load iterative convergence certify the second body's free spin.

use openaec_native_fem::mixed3d::{
    solve, BendingPlate3dElement, Frame3dMixedElement, Mixed3dBackend, Mixed3dRequest,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const E_MPA: f64 = 1_200.0;
const NU: f64 = 0.2;

fn fixture(backend: Mixed3dBackend) -> Mixed3dRequest {
    // The first Tet occupies the positive octant; the second occupies the
    // negative octant and shares only node 0. Both have V=1/6 m³.
    let nodes = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, -1.0],
        [-1.0, 0.0, 0.0],
        [0.0, -1.0, 0.0],
    ];
    let mut prescribed_m = vec![[None; 3]; nodes.len()];
    for support in prescribed_m.iter_mut().take(4) {
        *support = [Some(0.0); 3];
    }
    let mut prescribed_rotations_rad = vec![[None; 3]; nodes.len()];
    for &node in &[0, 1] {
        prescribed_rotations_rad[node] = [Some(0.0); 3];
    }
    // Node 2 belongs only to the DKT, which has Rx and Ry but no drilling Rz.
    prescribed_rotations_rad[2] = [Some(0.0), Some(0.0), None];
    Mixed3dRequest {
        mesh: Mesh {
            nodes,
            tets: vec![[0, 1, 2, 3], [0, 5, 4, 6]],
        },
        solid_material: Volume3dMaterial {
            e_mpa: E_MPA,
            poisson: NU,
        },
        tet_materials: None,
        hexes: vec![],
        trusses: vec![],
        membranes: vec![],
        bending_plates: vec![BendingPlate3dElement {
            nodes: [0, 1, 2],
            e_mpa: 30_000.0,
            nu: NU,
            thickness_m: 0.1,
        }],
        membrane_tractions: vec![],
        frames: vec![Frame3dMixedElement {
            nodes: [0, 1],
            e_mpa: 200_000.0,
            poisson: 0.3,
            g_mpa: None,
            area_m2: 0.01,
            iy_m4: 1e-6,
            iz_m4: 1e-6,
            torsion_j_m4: 1e-6,
            roll_angle_rad: 0.0,
        }],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        loads_kn: vec![[0.0; 3]; 7],
        moments_knm: vec![],
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m,
        prescribed_rotations_rad,
        backend,
        max_front_dofs: 4096,
        threads: 1,
        max_pcg_iterations: 10_000,
    }
}

fn large_fixture(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut input = fixture(backend);
    // A has three noncollinear supported vertices and one free vertex. The
    // extra, separate fully supported Tet4s raise the global system above the
    // 128-DOF exact preflight cap without changing the vertex hinge at B.
    input.prescribed_m[3] = [None; 3];
    for index in 0..10 {
        let first = input.mesh.nodes.len();
        let x = 10.0 + 2.0 * index as f64;
        input.mesh.nodes.extend([
            [x, 0.0, 0.0],
            [x + 1.0, 0.0, 0.0],
            [x, 1.0, 0.0],
            [x, 0.0, 1.0],
        ]);
        input
            .mesh
            .tets
            .push([first, first + 1, first + 2, first + 3]);
        input.loads_kn.extend([[0.0; 3]; 4]);
        input.prescribed_m.extend([[Some(0.0); 3]; 4]);
        input.prescribed_rotations_rad.extend([[None; 3]; 4]);
    }
    // 47 nodes*3 translations + 3 frame-node rotations each + two DKT-only
    // rotations at node 2 = 149 total DOFs; the dense LDLT preflight is skipped.
    assert_eq!(input.mesh.nodes.len() * 3 + 8, 149);
    input
}

#[test]
fn zero_load_vertex_hinge_is_rejected_before_iterative_convergence() {
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::FrontalWave,
    ] {
        solve(&fixture(backend)).expect_err("direct solve must see the free solid rotations");
    }
    for backend in [
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        let error = solve(&fixture(backend))
            .expect_err("a zero RHS must not certify the unsupported second Tet4");
        assert!(
            error.contains("small coupled direct rank preflight")
                && (error.contains("pivot") || error.contains("singular")),
            "{backend:?}: {error}"
        );
    }
}

#[test]
fn stabilized_one_dof_shear_matches_independent_tet_reference() {
    // Fix the second solid except node 6 Uz. Its shape-function gradient is
    // (0,-1,0), so the only active stiffness is K=1000*mu*V kN/m.
    // Neither the frame nor DKT shares node 6, and both remain fixed.
    let mu_mpa = E_MPA / (2.0 * (1.0 + NU));
    let expected_uz_m = 1.0 / (1_000.0 * mu_mpa / 6.0);
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let mut input = fixture(backend);
        for node in 4..7 {
            input.prescribed_m[node] = [Some(0.0); 3];
        }
        input.prescribed_m[6][2] = None;
        input.loads_kn[6][2] = 1.0;
        let solved = solve(&input).unwrap_or_else(|error| panic!("{backend:?}: {error}"));
        assert!(
            (solved.nodal_displacements_m[6][2] - expected_uz_m).abs() < 1e-12,
            "{backend:?}: incorrect Tet4 shear displacement"
        );
        assert!(solved.nodal_reactions_kn[6][2].abs() < 1e-8);
        let reaction: f64 = solved.nodal_reactions_kn.iter().map(|force| force[2]).sum();
        assert!((reaction + 1.0).abs() < 1e-8);
        assert_eq!(solved.bending_plate_moments_knm_per_m.len(), 1);
        assert_eq!(solved.frame_end_forces_local.len(), 1);
    }
}

#[test]
fn large_vertex_hinge_rejects_zero_and_orthogonal_load_without_direct_preflight() {
    for loaded in [false, true] {
        for backend in [
            Mixed3dBackend::SparsePcg,
            Mixed3dBackend::MatrixFreePcg,
            Mixed3dBackend::Automatic,
        ] {
            let mut input = large_fixture(backend);
            if loaded {
                // This load is carried by supported body A and is orthogonal
                // to every free rigid rotation of body B.
                input.loads_kn[3][2] = 1.0;
            }
            let error = solve(&input)
                .expect_err("face-disconnected B has a rigid mode about shared vertex 0");
            assert!(
                error.contains("solid face-connected group") && error.contains("hinge"),
                "{backend:?}, loaded={loaded}: {error}"
            );
            assert!(!error.contains("direct rank preflight"));
        }
    }
}

#[test]
fn large_stabilized_model_keeps_the_independent_shear_displacement() {
    let mu_mpa = E_MPA / (2.0 * (1.0 + NU));
    let expected_uz_m = 1.0 / (1_000.0 * mu_mpa / 6.0);
    for backend in [
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        let mut input = large_fixture(backend);
        // Nodes 0, 4 and 5 are noncollinear, so the second Tet4's six rigid
        // modes are restrained. Keep one node-6 shear coordinate free.
        for node in 4..7 {
            input.prescribed_m[node] = [Some(0.0); 3];
        }
        input.prescribed_m[6][2] = None;
        input.loads_kn[6][2] = 1.0;
        let solved = solve(&input).unwrap_or_else(|error| panic!("{backend:?}: {error}"));
        assert!(
            (solved.nodal_displacements_m[6][2] - expected_uz_m).abs() < 1e-12,
            "{backend:?}: incorrect stabilized Tet4 shear displacement"
        );
        assert!(solved.nodal_reactions_kn[6][2].abs() < 1e-8);
    }
}
