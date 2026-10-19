//! Independent Euler-Bernoulli/Saint-Venant reference for a shared Tet4 +
//! full 3D frame under simultaneous shear force, bending moment and torque.
//! The one free solid translation carries the shear force; the beam base
//! rotations are fixed. Units: m, kN, kNm, MPa and radians.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest};
use serde_json::{json, Value};

const FORCE_Z_KN: f64 = 10.0;
const TIP_BENDING_Y_KNM: f64 = 3.0;
const TIP_TORQUE_X_KNM: f64 = 2.0;
const LENGTH_M: f64 = 1.0;
const SOLID_E_MPA: f64 = 1_200.0;
const SOLID_NU: f64 = 0.2;
const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_NU: f64 = 0.3;
const IY_M4: f64 = 0.0001;
const J_M4: f64 = 0.0002;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.14e}, expected={expected:.14e}, tolerance={tolerance:.2e}"
    );
}

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("Tet4/frame public fixture");
    fixture["input"]["backend"] = serde_json::to_value(backend).unwrap();
    fixture["input"]["loadsKn"][4] = json!([0.0, 0.0, FORCE_Z_KN]);
    fixture["input"]["momentsKnm"][4] = json!([TIP_TORQUE_X_KNM, TIP_BENDING_Y_KNM, 0.0]);
    serde_json::from_value(fixture["input"].take()).expect("coupled model")
}

#[test]
fn shared_solid_and_frame_match_tip_wrench_closed_form_on_four_backends() {
    let mu_solid = SOLID_E_MPA / (2.0 * (1.0 + SOLID_NU));
    let k_solid = 1_000.0 * mu_solid / 6.0;
    let shared_uz = FORCE_Z_KN / k_solid;
    let ei = 1_000.0 * FRAME_E_MPA * IY_M4;
    let gj = 1_000.0 * FRAME_E_MPA / (2.0 * (1.0 + FRAME_NU)) * J_M4;

    // For +z translation, a +y moment gives negative w and positive θy.
    let tip_uz = shared_uz + FORCE_Z_KN * LENGTH_M.powi(3) / (3.0 * ei)
        - TIP_BENDING_Y_KNM * LENGTH_M.powi(2) / (2.0 * ei);
    let tip_ry = -FORCE_Z_KN * LENGTH_M.powi(2) / (2.0 * ei) + TIP_BENDING_Y_KNM * LENGTH_M / ei;
    let tip_rx = TIP_TORQUE_X_KNM * LENGTH_M / gj;
    let support_my = FORCE_Z_KN * LENGTH_M - TIP_BENDING_Y_KNM;

    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::MatrixFreePcg,
    ] {
        let result = solve(&model(backend)).expect("shared Tet4/frame wrench solve");
        assert_eq!(result.backend_used, backend);
        near(
            result.nodal_displacements_m[1][2],
            shared_uz,
            1e-11,
            "solid uz",
        );
        near(result.nodal_displacements_m[4][2], tip_uz, 1e-11, "tip uz");
        near(
            result.nodal_rotations_rad[4].unwrap()[1],
            tip_ry,
            1e-11,
            "tip ry",
        );
        near(
            result.nodal_rotations_rad[4].unwrap()[0],
            tip_rx,
            1e-11,
            "tip rx",
        );
        near(
            result.solid_element_stress_mpa[0][5],
            mu_solid * shared_uz,
            1e-9,
            "Tet4 zx shear",
        );
        near(
            result.nodal_reactions_kn[0][2],
            -FORCE_Z_KN,
            1e-7,
            "solid support z reaction",
        );
        near(
            result.nodal_moment_reactions_knm[1].unwrap()[0],
            -TIP_TORQUE_X_KNM,
            1e-7,
            "base torque reaction",
        );
        near(
            result.nodal_moment_reactions_knm[1].unwrap()[1].abs(),
            support_my,
            1e-7,
            "base bending reaction",
        );
        near(
            result.frame_end_forces_local[0][0][2].abs(),
            FORCE_Z_KN,
            1e-7,
            "frame base shear",
        );
        near(
            result.frame_end_forces_local[0][0][3].abs(),
            TIP_TORQUE_X_KNM,
            1e-7,
            "frame base torque",
        );
        near(
            result.frame_end_forces_local[0][0][4].abs(),
            support_my,
            1e-7,
            "frame base bending",
        );
        assert!(result.relative_residual < 1e-9);
    }
}
