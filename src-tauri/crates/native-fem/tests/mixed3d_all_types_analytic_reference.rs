//! Independent one-free-DOF reference for a shared Tet4, Hex8, Tri3 membrane,
//! axial truss and bending frame. No element stiffness matrix is used to form
//! the expected displacement: five continuum/section strain energies add.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::mixed3d::{Mixed3dBackend, Mixed3dResult};
use serde_json::{json, Value};

const FORCE_KN: f64 = 10.0;
const TET_E: f64 = 1_200.0;
const TET_NU: f64 = 0.2;
const HEX_E: f64 = 5_000.0;
const HEX_NU: f64 = 0.25;
const MEMBRANE_E: f64 = 3_000.0;
const MEMBRANE_NU: f64 = 0.25;
const MEMBRANE_THICKNESS_M: f64 = 0.08;
const TRUSS_E: f64 = 200_000.0;
const TRUSS_AREA_M2: f64 = 0.0001;
const FRAME_E: f64 = 210_000.0;
const FRAME_AREA_M2: f64 = 0.0002;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.2e}"
    );
}

fn lame(e: f64, nu: f64) -> (f64, f64) {
    (
        e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu)),
        e / (2.0 * (1.0 + nu)),
    )
}

fn reference_stiffness() -> [f64; 5] {
    let (tet_lambda, tet_mu) = lame(TET_E, TET_NU);
    let (hex_lambda, hex_mu) = lame(HEX_E, HEX_NU);
    [
        // Unit Tet4: volume 1/6 and ∇N at loaded node = (1,0,0).
        1_000.0 * (tet_lambda + 2.0 * tet_mu) / 6.0,
        // Unit Hex8: N at loaded corner = x(1-y)(1-z). The three
        // squared derivative integrals over the unit cube equal 1/9.
        1_000.0 * (hex_lambda + 4.0 * hex_mu) / 9.0,
        // Unit right triangle: area 1/2, plane-stress εxx = u, t = 0.08 m.
        1_000.0 * MEMBRANE_E / (1.0 - MEMBRANE_NU.powi(2)) * MEMBRANE_THICKNESS_M / 2.0,
        1_000.0 * TRUSS_E * TRUSS_AREA_M2,
        1_000.0 * FRAME_E * FRAME_AREA_M2,
    ]
}

fn run(backend: &str) -> Mixed3dResult {
    let mut value: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-all-types-analytic.json"))
            .expect("analytical fixture JSON");
    value["input"]["backend"] = backend.into();
    let input: NativeFemRequest = serde_json::from_value(value).expect("typed mixed3d input");
    let NativeFemResult::Mixed3d(result) =
        solve_native_fem(input).unwrap_or_else(|error| panic!("{backend}: {error}"))
    else {
        panic!("{backend}: wrong dispatcher result");
    };
    result
}

fn run_bending(backend: &str) -> Mixed3dResult {
    let mut value: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-all-types-analytic.json"))
            .expect("analytical fixture JSON");
    value["input"]["backend"] = backend.into();
    value["input"]["loadsKn"][1] = json!([0, FORCE_KN, 0]);
    value["input"]["prescribedM"][1] = json!([0, null, 0]);
    // Both end rotations are fixed. A clamped-guided Euler-Bernoulli member
    // has lateral stiffness 12EI/L³. Increase I so its share is measurable.
    value["input"]["frames"][0]["iyM4"] = json!(0.0001);
    value["input"]["frames"][0]["izM4"] = json!(0.0001);
    let input: NativeFemRequest = serde_json::from_value(value).expect("typed bending input");
    let NativeFemResult::Mixed3d(result) =
        solve_native_fem(input).unwrap_or_else(|error| panic!("{backend}: {error}"))
    else {
        panic!("{backend}: wrong dispatcher result");
    };
    result
}

#[test]
fn all_five_element_families_match_additive_energy_reference_on_every_backend() {
    let [tet_k, hex_k, membrane_k, truss_k, frame_k] = reference_stiffness();
    let u = FORCE_KN / (tet_k + hex_k + membrane_k + truss_k + frame_k);
    let (tet_lambda, tet_mu) = lame(TET_E, TET_NU);
    let (hex_lambda, hex_mu) = lame(HEX_E, HEX_NU);

    for backend in [
        "dense",
        "sparseDirect",
        "sparsePcg",
        "frontalWave",
        "matrixFreePcg",
        "automatic",
    ] {
        let result = run(backend);
        near(result.nodal_displacements_m[1][0], u, 1e-12, backend);
        near(result.relative_residual, 0.0, 1e-8, "free residual");
        assert_eq!(result.solid_element_stress_mpa.len(), 1);
        assert_eq!(result.hex_gauss_stress_mpa.len(), 1);
        assert_eq!(result.membrane_stress_mpa.len(), 1);
        assert_eq!(result.truss_axial_force_kn.len(), 1);
        assert_eq!(result.frame_end_forces_local.len(), 1);
        assert_eq!(result.nodal_rotations_rad[1], Some([0.0; 3]));

        near(
            result.solid_element_stress_mpa[0][0],
            (tet_lambda + 2.0 * tet_mu) * u,
            1e-8,
            "Tet4 σxx",
        );
        near(
            result.membrane_stress_mpa[0][0],
            MEMBRANE_E * u / (1.0 - MEMBRANE_NU.powi(2)),
            1e-8,
            "Tri3 σxx",
        );
        near(
            result.truss_axial_force_kn[0],
            truss_k * u,
            1e-8,
            "truss force",
        );
        near(
            result.frame_end_forces_local[0][1][0],
            frame_k * u,
            1e-8,
            "frame axial end force",
        );

        let mean = |component: usize| {
            result.hex_gauss_stress_mpa[0]
                .iter()
                .map(|stress| stress[component])
                .sum::<f64>()
                / 8.0
        };
        // Exact Gauss averages of N=x(1-y)(1-z): εxx=u/4,
        // γxy=γxz=-u/4, γyz=0.
        near(
            mean(0),
            (hex_lambda + 2.0 * hex_mu) * u / 4.0,
            1e-8,
            "Hex8 mean σxx",
        );
        near(mean(1), hex_lambda * u / 4.0, 1e-8, "Hex8 mean σyy");
        near(mean(3), -hex_mu * u / 4.0, 1e-8, "Hex8 mean τxy");
        near(mean(5), -hex_mu * u / 4.0, 1e-8, "Hex8 mean τzx");
        near(mean(4), 0.0, 1e-8, "Hex8 mean τyz");

        let reaction_x: f64 = result.nodal_reactions_kn.iter().map(|node| node[0]).sum();
        near(reaction_x, -FORCE_KN, 1e-7, "global force balance");
        if backend == "automatic" {
            assert_eq!(result.backend_used, Mixed3dBackend::MatrixFreePcg);
        }
    }
}

#[test]
fn shared_lateral_motion_matches_independent_shear_and_clamped_frame_energy() {
    let [_, hex_k, _, _, _] = reference_stiffness();
    let (_, tet_mu) = lame(TET_E, TET_NU);
    let membrane_mu = MEMBRANE_E / (2.0 * (1.0 + MEMBRANE_NU));
    let frame_k = 1_000.0 * 12.0 * FRAME_E * 0.0001;
    let expected = FORCE_KN
        / (1_000.0 * tet_mu / 6.0
            + hex_k
            + 1_000.0 * membrane_mu * MEMBRANE_THICKNESS_M / 2.0
            + frame_k);

    for backend in [
        "dense",
        "sparseDirect",
        "sparsePcg",
        "frontalWave",
        "matrixFreePcg",
        "automatic",
    ] {
        let result = run_bending(backend);
        near(
            result.nodal_displacements_m[1][1],
            expected,
            1e-12,
            "lateral u",
        );
        near(
            result.solid_element_stress_mpa[0][3],
            tet_mu * expected,
            1e-8,
            "Tet4 τxy",
        );
        near(
            result.membrane_stress_mpa[0][2],
            membrane_mu * expected,
            1e-8,
            "Tri3 τxy",
        );
        near(
            result.truss_axial_force_kn[0],
            0.0,
            1e-9,
            "transverse truss force",
        );
        let reaction_y: f64 = result.nodal_reactions_kn.iter().map(|node| node[1]).sum();
        near(reaction_y, -FORCE_KN, 1e-7, "lateral force balance");
        near(result.relative_residual, 0.0, 1e-8, "lateral free residual");
    }
}
