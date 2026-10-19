//! A connected 5,000-member truss checked against the closed-form bar law.
//! Every transverse displacement is restrained; the remaining 5,000 free
//! axial DOFs test global assembly and the frontal factorization at scale.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest, Truss3dElement};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const E_MPA: f64 = 210_000.0;
const AREA_M2: f64 = 0.001;
const BAR_LENGTH_M: f64 = 0.1;
const FORCE_KN: f64 = 10.0;

fn chain(members: usize, backend: Mixed3dBackend) -> Mixed3dRequest {
    let nodes = (0..=members)
        .map(|index| [index as f64 * BAR_LENGTH_M, 0.0, 0.0])
        .collect();
    let trusses = (0..members)
        .map(|index| Truss3dElement {
            nodes: [index, index + 1],
            e_mpa: E_MPA,
            area_m2: AREA_M2,
        })
        .collect();
    let mut loads_kn = vec![[0.0; 3]; members + 1];
    loads_kn[members][0] = FORCE_KN;
    let mut prescribed_m = vec![[None, Some(0.0), Some(0.0)]; members + 1];
    prescribed_m[0][0] = Some(0.0);
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![],
        },
        solid_material: Volume3dMaterial {
            e_mpa: E_MPA,
            poisson: 0.3,
        },
        tet_materials: None,
        hexes: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        trusses,
        loads_kn,
        prescribed_m,
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        frames: vec![],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        moments_knm: vec![],
        prescribed_rotations_rad: vec![],
        backend,
        max_front_dofs: 32,
        threads: 4,
        max_pcg_iterations: 20_000,
    }
}

fn check(members: usize, backend: Mixed3dBackend) {
    let result = solve(&chain(members, backend)).expect("connected axial truss solve");
    let total_length = members as f64 * BAR_LENGTH_M;
    let expected_tip = FORCE_KN * total_length / (1_000.0 * E_MPA * AREA_M2);
    let actual_tip = result.nodal_displacements_m[members][0];
    let tip_tolerance = if members >= 100_000 {
        1e-6 * expected_tip
    } else {
        2e-9
    };
    assert!(
        (actual_tip - expected_tip).abs() < tip_tolerance,
        "{members} bars: tip {actual_tip}, reference {expected_tip}"
    );
    if members >= 100_000 {
        eprintln!(
            "{members} bars: root reaction error {:.3e} kN",
            (result.nodal_reactions_kn[0][0] + FORCE_KN).abs()
        );
    }
    let force_tolerance = if members >= 100_000 { 1e-5 } else { 1e-7 };
    assert!((result.nodal_reactions_kn[0][0] + FORCE_KN).abs() < force_tolerance);
    assert!(result.relative_residual < 1e-8);
    assert_eq!(result.truss_axial_force_kn.len(), members);
    let max_force_error = result
        .truss_axial_force_kn
        .iter()
        .map(|force| (force - FORCE_KN).abs())
        .fold(0.0_f64, f64::max);
    if members >= 100_000 {
        eprintln!("{members} bars: max axial-force error {max_force_error:.3e} kN");
    }
    for &force in &result.truss_axial_force_kn {
        assert!(
            (force - FORCE_KN).abs() < force_tolerance,
            "member axial force {force}"
        );
    }
    assert!(result.solid_element_stress_mpa.is_empty());
}

#[test]
fn five_thousand_member_frontal_truss_matches_closed_form() {
    check(5_000, Mixed3dBackend::FrontalWave);
}

#[test]
#[ignore = "100,000-member frontal acceptance; run explicitly in release"]
fn one_hundred_thousand_member_frontal_truss_matches_closed_form() {
    check(100_000, Mixed3dBackend::FrontalWave);
}

#[test]
#[ignore = "large matrix-free acceptance; run explicitly in release"]
fn five_thousand_member_matrix_free_truss_matches_closed_form() {
    check(5_000, Mixed3dBackend::MatrixFreePcg);
}

#[test]
fn small_truss_matches_closed_form_across_backends() {
    check(64, Mixed3dBackend::SparseDirect);
    check(64, Mixed3dBackend::SparsePcg);
    check(64, Mixed3dBackend::MatrixFreePcg);
    check(64, Mixed3dBackend::FrontalWave);
    check(64, Mixed3dBackend::Automatic);
}

#[test]
fn unrestrained_disconnected_truss_is_rejected_even_with_zero_load() {
    for backend in [
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        let mut request = chain(4, backend);
        let offset = request.mesh.nodes.len();
        let second_nodes: Vec<_> = request
            .mesh
            .nodes
            .iter()
            .map(|&[x, y, z]| [x + 10.0, y, z])
            .collect();
        let second_trusses: Vec<_> = request
            .trusses
            .iter()
            .map(|truss| Truss3dElement {
                nodes: truss.nodes.map(|node| node + offset),
                ..truss.clone()
            })
            .collect();
        request.mesh.nodes.extend(second_nodes);
        request.trusses.extend(second_trusses);
        request.loads_kn.extend(vec![[0.0; 3]; offset]);
        request
            .prescribed_m
            .extend(vec![[None, Some(0.0), Some(0.0)]; offset]);
        let error = solve(&request).expect_err("unrestrained second chain must be rejected");
        assert!(error.contains("component"), "{error}");
    }
}
