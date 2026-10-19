//! Independent one-DOF reference for a *coupled* Tet4 and 3D truss.
//!
//! The two elements use the same displacement at node 1. With all other
//! translations restrained, their axial stiffnesses act in parallel. This
//! makes both the displacement and every restrained reaction available from
//! elasticity, without using either element implementation as an oracle.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest, Truss3dElement};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

#[test]
fn typed_dispatch_accepts_the_coupled_model() {
    use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest};

    let request =
        serde_json::json!({ "kind": "mixed3d", "input": model(Mixed3dBackend::FrontalWave) });
    let input: NativeFemRequest = serde_json::from_value(request).expect("typed mixed3d input");
    let output = serde_json::to_value(solve_native_fem(input).expect("typed mixed3d solve"))
        .expect("typed mixed3d output");
    assert_eq!(output["kind"], "mixed3d");
    assert_eq!(output["result"]["backendUsed"], "frontalWave");
    assert!(
        output["result"]["nodalDisplacementsM"][1][0]
            .as_f64()
            .unwrap()
            > 0.0
    );
}

const LOAD_KN: f64 = 10.0;
const SOLID_E_MPA: f64 = 1_200.0;
const POISSON: f64 = 0.2;
const TRUSS_E_MPA: f64 = 2_000.0;
const TRUSS_AREA_M2: f64 = 0.05;

fn close(actual: f64, expected: f64, absolute_tolerance: f64) {
    assert!(
        (actual - expected).abs() <= absolute_tolerance,
        "actual {actual:.15e}, expected {expected:.15e}, tolerance {absolute_tolerance:.3e}"
    );
}

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    // Unit tetrahedron: V = 1/6 m³; grad(N1) = [1, 0, 0].
    // The truss shares nodes 0 and 1 with the solid, and its length is 1 m.
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        },
        solid_material: Volume3dMaterial {
            e_mpa: SOLID_E_MPA,
            poisson: POISSON,
        },
        tet_materials: None,
        hexes: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![Truss3dElement {
            nodes: [0, 1],
            e_mpa: TRUSS_E_MPA,
            area_m2: TRUSS_AREA_M2,
        }],
        loads_kn: vec![[0.0; 3], [LOAD_KN, 0.0, 0.0], [0.0; 3], [0.0; 3]],
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m: vec![
            [Some(0.0); 3],
            [None, Some(0.0), Some(0.0)],
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

/// From isotropic elasticity: εxx=u1x, all other strains zero; hence
/// k_tet=(λ+2μ)V and k_truss=EA/L, in kN/m after multiplying MPa by 1000.
fn reference() -> (f64, f64, f64, f64) {
    let lambda_mpa = SOLID_E_MPA * POISSON / ((1.0 + POISSON) * (1.0 - 2.0 * POISSON));
    let mu_mpa = SOLID_E_MPA / (2.0 * (1.0 + POISSON));
    let tet_stiffness_kn_per_m = (lambda_mpa + 2.0 * mu_mpa) * 1_000.0 / 6.0;
    let truss_stiffness_kn_per_m = TRUSS_E_MPA * TRUSS_AREA_M2 * 1_000.0;
    let displacement_m = LOAD_KN / (tet_stiffness_kn_per_m + truss_stiffness_kn_per_m);
    (
        displacement_m,
        tet_stiffness_kn_per_m,
        truss_stiffness_kn_per_m,
        lambda_mpa,
    )
}

#[test]
fn coupled_tet_and_truss_match_closed_form_displacement_stress_and_reactions() {
    let result = solve(&model(Mixed3dBackend::Dense)).expect("coupled dense solve");
    let (u, k_tet, k_truss, lambda_mpa) = reference();
    let tet_force_kn = k_tet * u;
    let truss_force_kn = k_truss * u;
    let transverse_reaction_kn = lambda_mpa * u * 1_000.0 / 6.0;

    assert_eq!(result.nodal_displacements_m.len(), 4);
    assert_eq!(result.nodal_reactions_kn.len(), 4);
    assert_eq!(result.solid_element_stress_mpa.len(), 1);
    assert_eq!(result.truss_axial_force_kn.len(), 1);
    close(result.nodal_displacements_m[1][0], u, 1e-12);
    close(result.nodal_displacements_m[1][1], 0.0, 1e-13);
    close(result.nodal_displacements_m[1][2], 0.0, 1e-13);
    close(result.truss_axial_force_kn[0], truss_force_kn, 1e-8);

    // σxx=(λ+2μ)u, σyy=σzz=λu. The Tet4 reaction at node 0 is the
    // negative of its axial share plus the truss reaction, totaling -10 kN.
    let stress = result.solid_element_stress_mpa[0];
    close(stress[0], tet_force_kn * 6.0 / 1_000.0, 1e-10);
    close(stress[1], lambda_mpa * u, 1e-10);
    close(stress[2], lambda_mpa * u, 1e-10);
    for shear in &stress[3..] {
        close(*shear, 0.0, 1e-12);
    }
    close(result.nodal_reactions_kn[0][0], -LOAD_KN, 1e-8);
    close(
        result.nodal_reactions_kn[0][1],
        -transverse_reaction_kn,
        1e-8,
    );
    close(
        result.nodal_reactions_kn[0][2],
        -transverse_reaction_kn,
        1e-8,
    );
    close(
        result.nodal_reactions_kn[2][1],
        transverse_reaction_kn,
        1e-8,
    );
    close(
        result.nodal_reactions_kn[3][2],
        transverse_reaction_kn,
        1e-8,
    );
    close(result.nodal_reactions_kn[1][0], 0.0, 1e-8);
    for axis in 0..3 {
        let sum_reactions: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        close(
            sum_reactions + if axis == 0 { LOAD_KN } else { 0.0 },
            0.0,
            1e-8,
        );
    }
    assert!(result.relative_residual < 1e-9);
}

#[test]
fn sparse_direct_and_frontal_match_dense_coupled_solution() {
    let dense = solve(&model(Mixed3dBackend::Dense)).expect("dense reference");
    for backend in [
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
    ] {
        let other = solve(&model(backend)).expect("alternative coupled backend");
        assert_eq!(other.backend_used, backend);
        for node in 0..4 {
            for axis in 0..3 {
                close(
                    other.nodal_displacements_m[node][axis],
                    dense.nodal_displacements_m[node][axis],
                    1e-12,
                );
                close(
                    other.nodal_reactions_kn[node][axis],
                    dense.nodal_reactions_kn[node][axis],
                    1e-8,
                );
            }
        }
        close(
            other.truss_axial_force_kn[0],
            dense.truss_axial_force_kn[0],
            1e-8,
        );
        for component in 0..6 {
            close(
                other.solid_element_stress_mpa[0][component],
                dense.solid_element_stress_mpa[0][component],
                1e-10,
            );
        }
        assert!(other.relative_residual < 1e-9);
        if backend == Mixed3dBackend::FrontalWave {
            assert!(other.frontal_maximum_front_dofs.unwrap_or(0) > 0);
        }
    }
}

#[test]
fn oblique_truss_transfers_axial_load_into_all_three_global_directions() {
    let mut request = model(Mixed3dBackend::Dense);
    // The affine tetrahedral shape functions are N1=x, N2=y-x, N3=z-x,
    // N0=1+x-y-z. Thus grad(N1) remains [1,0,0] and V remains 1/6 m³.
    // The shared truss now has length sqrt(3) and direction [1,1,1]/sqrt(3).
    request.mesh.nodes[1] = [1.0, 1.0, 1.0];
    let result = solve(&request).expect("oblique coupled solve");
    let (_, k_tet, _, _) = reference();
    let truss_axial_stiffness = TRUSS_E_MPA * TRUSS_AREA_M2 * 1_000.0 / 3.0_f64.sqrt();
    let truss_x_stiffness = truss_axial_stiffness / 3.0;
    let expected_u = LOAD_KN / (k_tet + truss_x_stiffness);
    let expected_axial = truss_axial_stiffness * expected_u / 3.0_f64.sqrt();
    let expected_transverse_force = expected_axial / 3.0_f64.sqrt();

    close(result.nodal_displacements_m[1][0], expected_u, 1e-12);
    close(result.truss_axial_force_kn[0], expected_axial, 1e-8);
    // Node 1's y and z translations are fixed, so its truss force becomes
    // restrained reaction in those two directions. Node 0 takes the opposite.
    close(
        result.nodal_reactions_kn[1][1],
        expected_transverse_force,
        1e-8,
    );
    close(
        result.nodal_reactions_kn[1][2],
        expected_transverse_force,
        1e-8,
    );
    for axis in 0..3 {
        let sum_reactions: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        close(
            sum_reactions + if axis == 0 { LOAD_KN } else { 0.0 },
            0.0,
            1e-8,
        );
    }
}
