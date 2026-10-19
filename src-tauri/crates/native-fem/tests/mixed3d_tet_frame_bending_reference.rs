//! Independent serial-compliance reference for a shared-node Tet4 + bending frame.
//!
//! Lengths and displacements are m, forces kN, stresses and E MPa, rotations
//! radians, moments kNm. The single Tet4 has V=1/6 m³. With only node 1's z
//! translation free, its shear stiffness is 1000 μV kN/m. A frame starts at
//! that node, has its base rotation fixed, and carries a +z tip force F. Its
//! bending displacement is FL³/(3·1000 E Iy); the two compliances are in
//! series. This reference does not depend on assembled element matrices.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest};
use serde_json::Value;

const F_KN: f64 = 10.0;
const E_SOLID_MPA: f64 = 1_200.0;
const NU_SOLID: f64 = 0.2;
const E_FRAME_MPA: f64 = 200_000.0;
const ORIGINAL_IY_M4: f64 = 1e-4;
const V_M3: f64 = 1.0 / 6.0;
const L_M: f64 = 1.0;

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.14e}, expected={expected:.14e}, tolerance={tolerance:.2e}"
    );
}

fn number(value: &Value) -> f64 {
    value.as_f64().expect("numeric result component")
}

fn reference(iy_m4: f64) -> (f64, f64, f64, f64) {
    let mu_mpa = E_SOLID_MPA / (2.0 * (1.0 + NU_SOLID));
    let solid_u_m = F_KN / (1_000.0 * mu_mpa * V_M3);
    let ei_kn_m2 = 1_000.0 * E_FRAME_MPA * iy_m4;
    let beam_u_m = F_KN * L_M.powi(3) / (3.0 * ei_kn_m2);
    let tip_rotation_y_rad = -F_KN * L_M.powi(2) / (2.0 * ei_kn_m2);
    (
        solid_u_m,
        solid_u_m + beam_u_m,
        tip_rotation_y_rad,
        mu_mpa * solid_u_m,
    )
}

fn model(backend: Mixed3dBackend, iy_m4: f64) -> Mixed3dRequest {
    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("parse reference fixture");
    assert_eq!(fixture["kind"], "mixed3d");
    fixture["input"]["backend"] = serde_json::to_value(backend).unwrap();
    fixture["input"]["frames"][0]["iyM4"] = serde_json::json!(iy_m4);
    serde_json::from_value(fixture["input"].take()).expect("deserialize mixed Tet4/frame request")
}

fn check_reference(backend: Mixed3dBackend, iy_m4: f64) -> Value {
    let solution = solve(&model(backend, iy_m4)).expect("coupled Tet4/frame solve");
    let result = serde_json::to_value(&solution).expect("serialize result");
    let (solid_u, tip_u, tip_theta_y, sigma_zx) = reference(iy_m4);

    near(number(&result["nodalDisplacementsM"][1][2]), solid_u, 1e-11);
    near(number(&result["nodalDisplacementsM"][4][2]), tip_u, 1e-11);
    near(number(&result["nodalRotationsRad"][1][1]), 0.0, 1e-13);
    near(
        number(&result["nodalRotationsRad"][4][1]),
        tip_theta_y,
        1e-11,
    );
    // Stress ordering: [xx, yy, zz, xy, yz, zx]. The frame carries no
    // stiffness in the solid, so the Tet4's shear remains independent of Iy.
    near(
        number(&result["solidElementStressMpa"][0][5]),
        sigma_zx,
        1e-9,
    );
    near(number(&result["nodalReactionsKn"][0][2]), -F_KN, 1e-7);
    near(
        number(&result["nodalMomentReactionsKnm"][1][1]).abs(),
        F_KN * L_M,
        1e-7,
    );

    let end_forces = &result["frameEndForcesLocal"][0];
    near(number(&end_forces[0][2]).abs(), F_KN, 1e-7);
    near(number(&end_forces[1][2]).abs(), F_KN, 1e-7);
    near(number(&end_forces[0][4]).abs(), F_KN * L_M, 1e-7);
    near(number(&end_forces[1][4]), 0.0, 1e-7);

    let global_vertical_balance: f64 = result["nodalReactionsKn"]
        .as_array()
        .expect("one reaction vector per node")
        .iter()
        .map(|reaction| number(&reaction[2]))
        .sum();
    near(global_vertical_balance + F_KN, 0.0, 1e-7);
    assert!(solution.relative_residual < 1e-9);
    result
}

#[test]
fn frame_bending_and_tet_shear_are_in_series_across_linear_backends() {
    let reference = check_reference(Mixed3dBackend::Dense, ORIGINAL_IY_M4);
    for backend in [
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let other = check_reference(backend, ORIGINAL_IY_M4);
        for node in [1, 4] {
            near(
                number(&other["nodalDisplacementsM"][node][2]),
                number(&reference["nodalDisplacementsM"][node][2]),
                1e-11,
            );
        }
        near(
            number(&other["nodalRotationsRad"][4][1]),
            number(&reference["nodalRotationsRad"][4][1]),
            1e-11,
        );
    }
}

#[test]
fn changing_frame_iy_changes_only_the_bending_share_of_tip_displacement() {
    let stiff = check_reference(Mixed3dBackend::Dense, ORIGINAL_IY_M4);
    let flexible = check_reference(Mixed3dBackend::Dense, ORIGINAL_IY_M4 / 4.0);
    near(
        number(&flexible["nodalDisplacementsM"][1][2]),
        number(&stiff["nodalDisplacementsM"][1][2]),
        1e-11,
    );
    let stiff_beam_bending =
        number(&stiff["nodalDisplacementsM"][4][2]) - number(&stiff["nodalDisplacementsM"][1][2]);
    let flexible_beam_bending = number(&flexible["nodalDisplacementsM"][4][2])
        - number(&flexible["nodalDisplacementsM"][1][2]);
    near(flexible_beam_bending, 4.0 * stiff_beam_bending, 1e-11);
    near(
        number(&flexible["solidElementStressMpa"][0][5]),
        number(&stiff["solidElementStressMpa"][0][5]),
        1e-10,
    );
}

#[test]
fn shared_tet_frame_transfers_bending_and_torsion_without_cross_coupling() {
    // The Tet4 allows only its shared corner's z translation. A torque about
    // the x-aligned frame must therefore twist only the frame; the independent
    // St Venant reference is theta_x = T L / (1000 G J). The simultaneous
    // transverse force still follows the serial Tet4 shear + beam bending
    // reference checked above.
    const TORQUE_KNM: f64 = 3.0;
    const FRAME_NU: f64 = 0.3;
    const J_M4: f64 = 0.0002;
    let g_mpa = E_FRAME_MPA / (2.0 * (1.0 + FRAME_NU));
    let twist_rad = TORQUE_KNM * L_M / (1_000.0 * g_mpa * J_M4);
    let (solid_u, tip_u, tip_theta_y, sigma_zx) = reference(ORIGINAL_IY_M4);

    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let mut input = model(backend, ORIGINAL_IY_M4);
        input.moments_knm[4][0] = TORQUE_KNM;
        let result = serde_json::to_value(solve(&input).expect("coupled bending/torsion solve"))
            .expect("serialize mixed result");
        near(number(&result["nodalDisplacementsM"][1][2]), solid_u, 1e-11);
        near(number(&result["nodalDisplacementsM"][4][2]), tip_u, 1e-11);
        near(
            number(&result["nodalRotationsRad"][4][1]),
            tip_theta_y,
            1e-11,
        );
        near(number(&result["nodalRotationsRad"][4][0]), twist_rad, 1e-11);
        near(
            number(&result["solidElementStressMpa"][0][5]),
            sigma_zx,
            1e-9,
        );
        near(
            number(&result["nodalMomentReactionsKnm"][1][0]),
            -TORQUE_KNM,
            1e-7,
        );
        let end_forces = &result["frameEndForcesLocal"][0];
        near(number(&end_forces[0][3]).abs(), TORQUE_KNM, 1e-7);
        near(number(&end_forces[1][3]).abs(), TORQUE_KNM, 1e-7);
    }
}

#[test]
fn moments_and_rotational_supports_without_a_frame_are_rejected() {
    let mut input = model(Mixed3dBackend::Dense, ORIGINAL_IY_M4);
    input.frames.clear();
    input.moments_knm[4][1] = 1.0;
    assert!(solve(&input).unwrap_err().contains("require a frame"));
    input.moments_knm[4][1] = 0.0;
    assert!(solve(&input).unwrap_err().contains("require a frame"));
}

#[test]
fn hex8_corner_and_frame_are_in_series_with_exact_integrated_shape_function_stiffness() {
    // On a unit cube, N1=x(1-y)(1-z). Hold every displacement but u1z
    // fixed. All three integrals of (∂N1/∂axis)² over the cube equal 1/9.
    // The exact Hex8 stiffness in this one-DOF subspace is therefore
    // 1000[(λ+2μ)+μ+μ]/9 = 1000(λ+4μ)/9 kN/m. A frame from (1,0,0) to
    // (2,0,0) adds the independent cantilever compliance in series.
    let lambda_mpa = E_SOLID_MPA * NU_SOLID / ((1.0 + NU_SOLID) * (1.0 - 2.0 * NU_SOLID));
    let mu_mpa = E_SOLID_MPA / (2.0 * (1.0 + NU_SOLID));
    let hex_stiffness = 1_000.0 * (lambda_mpa + 4.0 * mu_mpa) / 9.0;
    let hex_u = F_KN / hex_stiffness;
    let beam_u = F_KN * L_M.powi(3) / (3.0 * 1_000.0 * E_FRAME_MPA * ORIGINAL_IY_M4);

    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("parse reference fixture");
    let input = &mut fixture["input"];
    input["mesh"]["nodes"] = serde_json::json!([
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
        [2, 0, 0]
    ]);
    input["mesh"]["tets"] = serde_json::json!([]);
    input["hexes"] = serde_json::json!([{
        "nodes": [0, 1, 2, 3, 4, 5, 6, 7],
        "eMpa": E_SOLID_MPA,
        "poisson": NU_SOLID
    }]);
    input["frames"][0]["nodes"] = serde_json::json!([1, 8]);
    input["loadsKn"] = serde_json::json!([
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, F_KN]
    ]);
    input["momentsKnm"] = serde_json::to_value(vec![[0.0; 3]; 9]).unwrap();
    input["prescribedM"] = serde_json::json!([
        [0, 0, 0],
        [0, 0, null],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
        [null, null, null]
    ]);
    input["prescribedRotationsRad"] = serde_json::json!([
        [null, null, null],
        [0, 0, 0],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null]
    ]);

    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        input["backend"] = serde_json::to_value(backend).unwrap();
        let request: Mixed3dRequest =
            serde_json::from_value(input.clone()).expect("Hex8/frame request");
        let result = serde_json::to_value(solve(&request).expect("Hex8/frame solve")).unwrap();
        near(number(&result["nodalDisplacementsM"][1][2]), hex_u, 1e-11);
        near(
            number(&result["nodalDisplacementsM"][8][2]),
            hex_u + beam_u,
            1e-11,
        );
        near(number(&result["nodalReactionsKn"][8][2]), 0.0, 1e-8);
        near(
            number(&result["nodalMomentReactionsKnm"][1][1]).abs(),
            F_KN * L_M,
            1e-7,
        );

        let stresses = result["hexGaussStressMpa"][0]
            .as_array()
            .expect("eight Hex8 Gauss stresses");
        assert_eq!(stresses.len(), 8);
        let mean = |component| {
            stresses
                .iter()
                .map(|point| number(&point[component]))
                .sum::<f64>()
                / 8.0
        };
        near(mean(0), -lambda_mpa * hex_u / 4.0, 1e-9);
        near(mean(1), -lambda_mpa * hex_u / 4.0, 1e-9);
        near(mean(2), -(lambda_mpa + 2.0 * mu_mpa) * hex_u / 4.0, 1e-9);
        near(mean(3), 0.0, 1e-10);
        near(mean(4), -mu_mpa * hex_u / 4.0, 1e-9);
        near(mean(5), mu_mpa * hex_u / 4.0, 1e-9);
    }
}
