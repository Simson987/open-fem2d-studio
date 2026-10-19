//! Independent cantilever and Tet4 shear-spring references for physical frame loads.
//! The load integrals below do not use the solver's Hermite equivalent loads.

use openaec_native_fem::mixed3d::{
    solve, Frame3dMemberLoad, Frame3dMemberPointLoad, Mixed3dBackend, Mixed3dRequest,
};

const E_SOLID_MPA: f64 = 1_200.0;
const NU_SOLID: f64 = 0.2;
const E_FRAME_MPA: f64 = 200_000.0;
const IY_M4: f64 = 1e-4;
const LENGTH_M: f64 = 1.0;

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.14e}, expected={expected:.14e}, tolerance={tolerance:.2e}"
    );
}

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut fixture: serde_json::Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("parse mixed Tet4/frame fixture");
    fixture["input"]["backend"] = serde_json::to_value(backend).unwrap();
    fixture["input"]["loadsKn"][4] = serde_json::json!([0, 0, 0]);
    serde_json::from_value(fixture["input"].take()).expect("mixed3d request")
}

fn shear_stiffness_kn_per_m() -> f64 {
    let mu_mpa = E_SOLID_MPA / (2.0 * (1.0 + NU_SOLID));
    1_000.0 * mu_mpa / 6.0
}

fn bending_stiffness_kn_m2() -> f64 {
    1_000.0 * E_FRAME_MPA * IY_M4
}

fn check_loaded_cantilever(
    request: &Mixed3dRequest,
    total_force_kn: f64,
    root_moment_knm: f64,
    expected_tip_bending_m: f64,
) {
    let result = solve(request).expect("loaded coupled Tet4/frame solve");
    let shared_m = total_force_kn / shear_stiffness_kn_per_m();
    near(result.nodal_displacements_m[1][2], shared_m, 1e-10);
    near(
        result.nodal_displacements_m[4][2],
        shared_m + expected_tip_bending_m,
        1e-10,
    );
    let end = result.frame_end_forces_local[0];
    near(end[0][2].abs(), total_force_kn.abs(), 1e-7);
    near(end[0][4].abs(), root_moment_knm.abs(), 1e-7);
    near(end[1][2], 0.0, 1e-7);
    near(end[1][4], 0.0, 1e-7);
    let reaction_sum: f64 = result
        .nodal_reactions_kn
        .iter()
        .map(|reaction| reaction[2])
        .sum();
    near(reaction_sum, -total_force_kn, 1e-7);
    near(
        result.nodal_moment_reactions_knm[1].unwrap()[1].abs(),
        root_moment_knm.abs(),
        1e-7,
    );
    assert!(result.relative_residual < 1e-8);
}

#[test]
fn uniform_line_load_reaches_shared_solid_and_recovers_free_frame_end() {
    let qz = -4.0;
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let mut request = model(backend);
        request.frame_member_loads.push(Frame3dMemberLoad {
            element: 0,
            qy_start_kn_per_m: 0.0,
            qy_end_kn_per_m: 0.0,
            qz_start_kn_per_m: qz,
            qz_end_kn_per_m: qz,
            start_position_m: 0.0,
            end_position_m: LENGTH_M,
        });
        check_loaded_cantilever(
            &request,
            qz * LENGTH_M,
            qz * LENGTH_M * LENGTH_M / 2.0,
            qz * LENGTH_M.powi(4) / (8.0 * bending_stiffness_kn_m2()),
        );
    }
}

#[test]
fn partial_trapezoid_and_point_load_follow_independent_influence_lines() {
    let (a, b, q0, q1) = (0.2_f64, 0.8_f64, -2.0_f64, -5.0_f64);
    let slope = (q1 - q0) / (b - a);
    let intercept = q0 - slope * a;
    let force = (q0 + q1) * (b - a) / 2.0;
    let root_moment = intercept * (b * b - a * a) / 2.0 + slope * (b.powi(3) - a.powi(3)) / 3.0;
    // A point load q(x) dx applied at x moves the free end by
    // q(x) x²(3L-x)/(6EI) dx. Integrate the linear trapezoid exactly.
    let primitive = |x: f64| {
        intercept * (LENGTH_M * x.powi(3) - x.powi(4) / 4.0)
            + slope * (3.0 * LENGTH_M * x.powi(4) / 4.0 - x.powi(5) / 5.0)
    };
    let tip_bending = (primitive(b) - primitive(a)) / (6.0 * bending_stiffness_kn_m2());
    for backend in [Mixed3dBackend::Dense, Mixed3dBackend::MatrixFreePcg] {
        let mut request = model(backend);
        request.frame_member_loads.push(Frame3dMemberLoad {
            element: 0,
            qy_start_kn_per_m: 0.0,
            qy_end_kn_per_m: 0.0,
            qz_start_kn_per_m: q0,
            qz_end_kn_per_m: q1,
            start_position_m: a,
            end_position_m: b,
        });
        check_loaded_cantilever(&request, force, root_moment, tip_bending);
    }

    let (p, x) = (-4.0_f64, 0.4_f64);
    let mut request = model(Mixed3dBackend::MatrixFreePcg);
    request
        .frame_member_point_loads
        .push(Frame3dMemberPointLoad {
            element: 0,
            py_kn: 0.0,
            pz_kn: p,
            position_m: x,
        });
    check_loaded_cantilever(
        &request,
        p,
        p * x,
        p * x * x * (3.0 * LENGTH_M - x) / (6.0 * bending_stiffness_kn_m2()),
    );
}

#[test]
fn invalid_frame_load_indices_positions_and_intensities_are_rejected() {
    let mut request = model(Mixed3dBackend::MatrixFreePcg);
    let line = Frame3dMemberLoad {
        element: 0,
        qy_start_kn_per_m: 1.0,
        qy_end_kn_per_m: 1.0,
        qz_start_kn_per_m: 0.0,
        qz_end_kn_per_m: 0.0,
        start_position_m: 0.0,
        end_position_m: 1.0,
    };
    request
        .frame_member_loads
        .push(Frame3dMemberLoad { element: 1, ..line });
    assert!(solve(&request)
        .unwrap_err()
        .contains("frame element outside model"));
    request.frame_member_loads[0] = Frame3dMemberLoad {
        end_position_m: 1.1,
        ..line
    };
    assert!(solve(&request)
        .unwrap_err()
        .contains("invalid intensity or span"));
    request.frame_member_loads[0] = Frame3dMemberLoad {
        qy_start_kn_per_m: f64::NAN,
        ..line
    };
    assert!(solve(&request)
        .unwrap_err()
        .contains("invalid intensity or span"));
    request.frame_member_loads.clear();
    request
        .frame_member_point_loads
        .push(Frame3dMemberPointLoad {
            element: 0,
            py_kn: 1.0,
            pz_kn: 0.0,
            position_m: 1.1,
        });
    assert!(solve(&request)
        .unwrap_err()
        .contains("invalid force or position"));
    request.frames.clear();
    assert!(solve(&request)
        .unwrap_err()
        .contains("requires an attached frame"));
}
