//! Independent Saint-Venant torsion reference for optional frame shear
//! modulus in a shared finite-strain J2 Tet4 + Euler--Bernoulli frame system.
//! The beam has a unit reference length and one free tip twist; its exact
//! rotation is φ=T L/(1000 G J) with G in MPa and T in kN m.
//! T L/(G J) follows the torque/strain-energy derivation in Cornell's
//! Virtual Lab theory 5: https://courses.cit.cornell.edu/virtual_lab/chalktalks/theory/5.shtml

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_frame_coupled, FiniteJ2CoupledFrame, FiniteJ2FrameCoupledRequest, FiniteJ2FrameTarget,
    FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_NU: f64 = 0.25;
const FRAME_J_M4: f64 = 2e-5;
const FRAME_I_M4: f64 = 1e-6;
const FRAME_L_M: f64 = 1.0;
const T_KNM: f64 = 4.0;
const GAMMA: f64 = 0.02;
const SOLID_E_MPA: f64 = 120.0;
const SOLID_NU: f64 = 0.2;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn solid_shear_kn(gamma: f64) -> f64 {
    // F=I+gamma(e_z⊗e_x) has det F=1 and Hencky stretches ±asinh(gamma/2).
    // Differentiating W=2µ asinh(gamma/2)^2 gives P_zx. The Tet volume is 1/6.
    let mu = SOLID_E_MPA / (2.0 * (1.0 + SOLID_NU));
    let p_zx_mpa = 2.0 * mu * (gamma / 2.0).asinh() / (1.0 + (gamma / 2.0).powi(2)).sqrt();
    1_000.0 * p_zx_mpa / 6.0
}

fn guided_bending_kn(gamma: f64) -> f64 {
    12.0 * 1_000.0 * FRAME_E_MPA * FRAME_I_M4 * gamma / FRAME_L_M.powi(3)
}

fn absolute_target(gamma: f64) -> FiniteJ2TetTarget {
    let mut loads_kn = vec![[0.0; 3]; 5];
    loads_kn[1][2] = solid_shear_kn(gamma) + guided_bending_kn(gamma);
    let mut prescribed_m = vec![[Some(0.0); 3]; 5];
    prescribed_m[1][2] = None;
    FiniteJ2TetTarget {
        loads_kn,
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn frame_target(torque_knm: f64) -> FiniteJ2FrameTarget {
    let mut moments_kn_m = vec![[0.0; 3]; 5];
    moments_kn_m[4][0] = torque_knm;
    let mut prescribed_rotation_rad = vec![[Some(0.0); 3]; 5];
    prescribed_rotation_rad[4][0] = None;
    FiniteJ2FrameTarget {
        moments_kn_m,
        prescribed_rotation_rad,
    }
}

fn model(
    backend: FiniteJ2TetLinearBackend,
    frame_g_mpa: Option<f64>,
    path: &[(f64, f64)],
) -> FiniteJ2FrameCoupledRequest {
    FiniteJ2FrameCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: Mesh {
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                    [2.0, 0.0, 0.0],
                ],
                tets: vec![[0, 1, 2, 3]],
            },
            steel: FiniteJ2Steel::new(SOLID_E_MPA, SOLID_NU, 1e9, 0.0).unwrap(),
            element_steels: None,
            targets: path
                .iter()
                .map(|&(gamma, _)| absolute_target(gamma))
                .collect(),
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                residual_tolerance: 1e-10,
                matrix_free_threads: 2,
                ..FiniteJ2TetOptions::default()
            },
        },
        hexes: vec![],
        hex_targets: vec![],
        trusses: vec![],
        membranes: vec![],
        frames: vec![FiniteJ2CoupledFrame {
            nodes: [1, 4],
            youngs_mpa: FRAME_E_MPA,
            poisson: FRAME_NU,
            g_mpa: frame_g_mpa,
            area_m2: 0.01,
            iy_m4: FRAME_I_M4,
            iz_m4: FRAME_I_M4,
            torsion_j_m4: FRAME_J_M4,
            roll_angle_rad: 0.0,
        }],
        bending_plates: vec![],
        frame_targets: path
            .iter()
            .map(|&(_, torque)| frame_target(torque))
            .collect(),
        frame_member_load_targets: vec![],
        frame_member_point_load_targets: vec![],
    }
}

fn check_response(backend: FiniteJ2TetLinearBackend, g_mpa: Option<f64>, expected_g_mpa: f64) {
    let result = solve_frame_coupled(&model(backend, g_mpa, &[(GAMMA, T_KNM)]))
        .unwrap_or_else(|error| panic!("{backend:?}, G={g_mpa:?}: {error}"));
    let phi = T_KNM * FRAME_L_M / (1_000.0 * expected_g_mpa * FRAME_J_M4);
    near(
        result.nodal_rotations_rad[4][0],
        phi,
        2e-9,
        "free tip twist",
    );
    near(
        result.nodal_reaction_moments_kn_m[1][0],
        -T_KNM,
        2e-7,
        "root torsion reaction",
    );
    near(
        result.nodal_reaction_moments_kn_m[4][0],
        0.0,
        2e-7,
        "free torsion residual",
    );
    near(
        result.frame_end_forces_local[0][0][3],
        -T_KNM,
        2e-7,
        "local root torsion",
    );
    near(
        result.frame_end_forces_local[0][1][3],
        T_KNM,
        2e-7,
        "local tip torsion",
    );
    near(
        result.nodal_displacements_m[1][2],
        GAMMA,
        2e-8,
        "shared finite-shear displacement",
    );
    near(
        result.element_first_piola_mpa[0][2][0] * 1_000.0 / 6.0,
        solid_shear_kn(GAMMA),
        2e-5,
        "finite-strain Tet4 first Piola shear force",
    );
    near(
        result.nodal_reactions_kn[1][2],
        0.0,
        2e-5,
        "shared free shear residual",
    );
    near(
        result.nodal_reactions_kn[4][2],
        -guided_bending_kn(GAMMA),
        2e-5,
        "guided frame reaction",
    );
    assert!(result.true_free_residual_kn < 2e-5);
}

#[test]
fn explicit_g_controls_torsion_without_changing_e_bending_or_j2_shear() {
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        check_response(backend, Some(40_000.0), 40_000.0);
        check_response(backend, Some(100_000.0), 100_000.0);
    }
}

#[test]
fn missing_g_uses_isotropic_shear_modulus_exactly() {
    let isotropic = FRAME_E_MPA / (2.0 * (1.0 + FRAME_NU));
    near(isotropic, 80_000.0, 1e-12, "isotropic G");
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
    ] {
        check_response(backend, None, isotropic);
        check_response(backend, Some(isotropic), isotropic);
    }
}

#[test]
fn absolute_torque_and_shear_targets_unload_then_reload() {
    let g = 60_000.0;
    let path = [(GAMMA, T_KNM), (0.0, 0.0), (GAMMA, T_KNM)];
    let reloaded =
        solve_frame_coupled(&model(FiniteJ2TetLinearBackend::Dense, Some(g), &path)).unwrap();
    let single =
        solve_frame_coupled(&model(FiniteJ2TetLinearBackend::Dense, Some(g), &path[..1])).unwrap();
    near(
        reloaded.nodal_rotations_rad[4][0],
        single.nodal_rotations_rad[4][0],
        2e-9,
        "reloaded twist",
    );
    near(
        reloaded.nodal_displacements_m[1][2],
        single.nodal_displacements_m[1][2],
        2e-8,
        "reloaded solid shear",
    );
    let unloaded =
        solve_frame_coupled(&model(FiniteJ2TetLinearBackend::Dense, Some(g), &path[..2])).unwrap();
    near(
        unloaded.nodal_rotations_rad[4][0],
        0.0,
        2e-9,
        "unloaded twist",
    );
    near(
        unloaded.nodal_displacements_m[1][2],
        0.0,
        2e-8,
        "unloaded solid shear",
    );
    assert!(reloaded
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    assert!(reloaded
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 2));
}

#[test]
fn frame_shear_modulus_must_be_positive_and_finite() {
    for invalid in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let error = solve_frame_coupled(&model(
            FiniteJ2TetLinearBackend::Dense,
            Some(invalid),
            &[(GAMMA, T_KNM)],
        ))
        .unwrap_err();
        assert!(error.contains("G") || error.contains("shear"), "{error}");
    }
}
