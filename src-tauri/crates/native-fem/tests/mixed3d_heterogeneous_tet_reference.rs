//! Two unit Tet4 sectors with distinct E/nu and a shared axial truss.
//! Their one free x-DOF is three exact parallel springs, giving a closed-form
//! reference independent of the assembled solver matrices.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest, Truss3dElement};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [0.0, -1.0, 0.0],
                [0.0, 0.0, -1.0],
            ],
            tets: vec![[0, 1, 2, 3], [0, 1, 4, 5]],
        },
        solid_material: Volume3dMaterial {
            e_mpa: 1200.0,
            poisson: 0.2,
        },
        tet_materials: Some(vec![
            Volume3dMaterial {
                e_mpa: 1200.0,
                poisson: 0.2,
            },
            Volume3dMaterial {
                e_mpa: 2400.0,
                poisson: 0.25,
            },
        ]),
        hexes: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![Truss3dElement {
            nodes: [0, 1],
            e_mpa: 2000.0,
            area_m2: 0.05,
        }],
        loads_kn: vec![
            [0.0; 3],
            [10.0, 0.0, 0.0],
            [0.0; 3],
            [0.0; 3],
            [0.0; 3],
            [0.0; 3],
        ],
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m: vec![
            [Some(0.0); 3],
            [None, Some(0.0), Some(0.0)],
            [Some(0.0); 3],
            [Some(0.0); 3],
            [Some(0.0); 3],
            [Some(0.0); 3],
        ],
        frames: vec![],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        moments_knm: vec![],
        prescribed_rotations_rad: vec![],
        backend,
        max_front_dofs: 24,
        threads: 1,
        max_pcg_iterations: 10_000,
    }
}

fn constrained_axial_stiffness(e: f64, nu: f64) -> f64 {
    let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mu = e / (2.0 * (1.0 + nu));
    1000.0 * (lambda + 2.0 * mu) / 6.0
}

#[test]
fn two_tet_materials_and_truss_match_independent_parallel_stiffness() {
    let k_a = constrained_axial_stiffness(1200.0, 0.2);
    let k_b = constrained_axial_stiffness(2400.0, 0.25);
    let k_truss = 1000.0 * 2000.0 * 0.05;
    let expected_u = 10.0 / (k_a + k_b + k_truss);
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
    ] {
        let result = solve(&model(backend)).expect("heterogeneous coupled solve");
        let u = result.nodal_displacements_m[1][0];
        assert!((u - expected_u).abs() < 1e-12);
        assert!((result.solid_element_stress_mpa[0][0] - 6.0 * k_a * u / 1000.0).abs() < 1e-10);
        assert!((result.solid_element_stress_mpa[1][0] - 6.0 * k_b * u / 1000.0).abs() < 1e-10);
        assert!((result.truss_axial_force_kn[0] - k_truss * u).abs() < 1e-10);
        assert!((result.nodal_reactions_kn[0][0] + 10.0).abs() < 1e-9);
        assert!(result.relative_residual < 1e-10);
    }
}

#[test]
fn tet_material_list_must_match_element_count() {
    let mut input = model(Mixed3dBackend::Dense);
    input.tet_materials.as_mut().unwrap().pop();
    assert!(solve(&input).unwrap_err().contains("tetMaterials count"));
}
