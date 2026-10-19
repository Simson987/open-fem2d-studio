//! Independent one-free-DOF energy and rigid-motion references for a horizontal
//! DKT Tri3 sharing nodes with a Tet4 and a 3D bending frame. The expected
//! stiffness is derived from curvature, continuum shear and beam theory; this
//! test does not call the standalone DKT element-stiffness implementation.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest};
use serde_json::{json, Value};

const LOAD_KN: f64 = 10.0;
const TET_E_MPA: f64 = 120.0;
const TET_NU: f64 = 0.2;
const PLATE_E_MPA: f64 = 30_000.0;
const PLATE_NU: f64 = 0.2;
const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_IY_M4: f64 = 1e-6;
const FRAME_LENGTH_M: f64 = 1.0;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn model(thickness_m: f64, reversed: bool, backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("parse Tet4/frame fixture");
    let input = &mut fixture["input"];
    input["solidMaterial"]["eMpa"] = json!(TET_E_MPA);
    input["frames"][0]["eMpa"] = json!(FRAME_E_MPA);
    input["frames"][0]["iyM4"] = json!(FRAME_IY_M4);
    input["loadsKn"][1] = json!([0.0, 0.0, LOAD_KN]);
    input["loadsKn"][4] = json!([0.0, 0.0, 0.0]);
    // Every DOF is held except shared node 1's z translation. Plate nodes
    // have two bending rotations; node 1 and the frame tip have all three.
    input["prescribedM"][4] = json!([0.0, 0.0, 0.0]);
    input["prescribedRotationsRad"][0] = json!([0.0, 0.0, null]);
    input["prescribedRotationsRad"][2] = json!([0.0, 0.0, null]);
    input["prescribedRotationsRad"][4] = json!([0.0, 0.0, 0.0]);
    input["bendingPlates"] = json!([{
        "nodes": if reversed { [0, 2, 1] } else { [0, 1, 2] },
        "eMpa": PLATE_E_MPA,
        "nu": PLATE_NU,
        "thicknessM": thickness_m
    }]);
    input["backend"] = serde_json::to_value(backend).unwrap();
    serde_json::from_value(input.take()).expect("deserialize coupled DKT/Tet4/frame request")
}

fn reference_stiffness(thickness_m: f64) -> (f64, f64, f64) {
    // Unit Tet4: V=1/6 and ∂N1/∂x=1. A node-1 z motion produces only
    // engineering shear gamma_zx=u, hence U=mu*V*u²/2.
    let mu_mpa = TET_E_MPA / (2.0 * (1.0 + TET_NU));
    let tet_k = 1_000.0 * mu_mpa / 6.0;

    // Right DKT triangle (0,0), (1,0), (0,1), node 1 w=1 and all other
    // w/rotations=0. Exact area integrals of the three curvature components
    // are ∫kx²=15/4, ∫ky²=3/4, ∫kx*ky=3/8, ∫kxy²=9/4. With isotropic
    // Kirchhoff rigidity D, this reduces to Kww=D*(45-3nu)/8.
    let rigidity = 1_000.0 * PLATE_E_MPA * thickness_m.powi(3) / (12.0 * (1.0 - PLATE_NU.powi(2)));
    let plate_k = rigidity * (45.0 - 3.0 * PLATE_NU) / 8.0;

    // The frame runs from (1,0,0) to (2,0,0). With both end rotations
    // restrained and the far end fixed, its guided transverse stiffness is
    // 12*E*Iy/L³, acting in parallel with the Tet4 and the DKT plate.
    let frame_k = 12.0 * 1_000.0 * FRAME_E_MPA * FRAME_IY_M4 / FRAME_LENGTH_M.powi(3);
    (tet_k, plate_k, frame_k)
}

fn check_loaded(thickness_m: f64, reversed: bool, backend: Mixed3dBackend) -> f64 {
    let result = solve(&model(thickness_m, reversed, backend))
        .unwrap_or_else(|error| panic!("{backend:?}, reversed={reversed}: {error}"));
    let (tet_k, plate_k, frame_k) = reference_stiffness(thickness_m);
    let expected_u = LOAD_KN / (tet_k + plate_k + frame_k);
    let u = result.nodal_displacements_m[1][2];
    near(u, expected_u, 2e-10, "shared z displacement");
    near(
        result.nodal_reactions_kn[4][2],
        -frame_k * expected_u,
        2e-7,
        "guided-frame tip reaction",
    );
    near(
        result.solid_element_stress_mpa[0][5],
        TET_E_MPA / (2.0 * (1.0 + TET_NU)) * expected_u,
        2e-8,
        "Tet4 sigma_zx",
    );
    near(
        result.nodal_reactions_kn[1][2],
        0.0,
        2e-7,
        "free DOF residual",
    );
    let vertical_reactions: f64 = result.nodal_reactions_kn.iter().map(|r| r[2]).sum();
    near(
        vertical_reactions,
        -LOAD_KN,
        2e-7,
        "global vertical balance",
    );
    assert_eq!(result.frame_end_forces_local.len(), 1);
    assert!(result.relative_residual < 1e-8, "relative residual");
    u
}

#[test]
fn xy_dkt_tet4_and_frame_add_stiffness_with_eightfold_thickness_change() {
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let mut forward = [0.0; 2];
        for (index, thickness) in [0.1, 0.2].into_iter().enumerate() {
            let u = check_loaded(thickness, false, backend);
            near(
                check_loaded(thickness, true, backend),
                u,
                2e-10,
                "triangle winding parity",
            );
            forward[index] = u;
        }
        let (tet_k, _, frame_k) = reference_stiffness(0.1);
        let plate_k_thin = LOAD_KN / forward[0] - tet_k - frame_k;
        let plate_k_thick = LOAD_KN / forward[1] - tet_k - frame_k;
        near(
            plate_k_thick / plate_k_thin,
            8.0,
            2e-5,
            "DKT bending stiffness scales with thickness cubed",
        );
    }
}

#[test]
fn global_rigid_rotation_has_zero_plate_solid_and_frame_strain() {
    // Physical small rotation Ω=(rx,ry,0) gives u=Ω×r. The standalone DKT
    // convention is theta_x=-dw/dy and theta_y=dw/dx, so its local plate
    // rotations are (-rx,-ry). The coupled assembler must transform these
    // signs when sharing the frame's physical global rotation DOFs.
    let (rx, ry) = (0.01, -0.02);
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        for reversed in [false, true] {
            let mut input = model(0.1, reversed, backend);
            input.loads_kn.fill([0.0; 3]);
            let expected: Vec<[f64; 3]> = input
                .mesh
                .nodes
                .iter()
                .map(|&[x, y, z]| [ry * z, -rx * z, rx * y - ry * x])
                .collect();
            input.prescribed_m = expected.iter().copied().map(|u| u.map(Some)).collect();
            input.prescribed_m[1][2] = None;
            input.prescribed_rotations_rad[0] = [Some(rx), Some(ry), None];
            input.prescribed_rotations_rad[1] = [Some(rx), Some(ry), Some(0.0)];
            input.prescribed_rotations_rad[2] = [Some(rx), Some(ry), None];
            input.prescribed_rotations_rad[4] = [Some(rx), Some(ry), Some(0.0)];
            let result = solve(&input)
                .unwrap_or_else(|error| panic!("{backend:?}, reversed={reversed}: {error}"));
            for (node, prescribed) in expected.iter().enumerate() {
                for axis in 0..3 {
                    near(
                        result.nodal_displacements_m[node][axis],
                        prescribed[axis],
                        2e-9,
                        "rigid-body displacement",
                    );
                    near(
                        result.nodal_reactions_kn[node][axis],
                        0.0,
                        3e-6,
                        "rigid-body force reaction",
                    );
                }
                if let Some(moment_reaction) = result.nodal_moment_reactions_knm[node] {
                    for moment in moment_reaction {
                        near(moment, 0.0, 3e-6, "rigid-body moment reaction");
                    }
                }
            }
            for stress in &result.solid_element_stress_mpa {
                for component in stress {
                    near(*component, 0.0, 2e-7, "rigid-body Tet4 stress");
                }
            }
            for end in result.frame_end_forces_local.iter().flatten() {
                for force in end {
                    near(*force, 0.0, 3e-6, "rigid-body frame end force");
                }
            }
        }
    }
}

#[test]
fn bending_plate_pcg_routes_match_independent_coupled_reference() {
    let reference = check_loaded(0.1, false, Mixed3dBackend::Dense);
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let result = solve(&model(0.1, false, backend)).expect("plate PCG solve");
        near(
            result.nodal_displacements_m[1][2],
            reference,
            2e-10,
            "iterative DKT shared displacement",
        );
        assert_eq!(result.backend_used, backend);
        assert_eq!(result.nodal_rotations_rad[0].unwrap()[2], 0.0);
        assert_eq!(result.nodal_moment_reactions_knm[0].unwrap()[2], 0.0);
    }
}

#[test]
fn automatic_dkt_uses_bounded_frontal_fallback_after_short_pcg_run() {
    let mut input = model(0.1, false, Mixed3dBackend::Automatic);
    // Free one additional DKT rotation so a single PCG step cannot solve
    // the coupled plate/solid/frame system exactly.
    input.prescribed_rotations_rad[0][0] = None;
    input.max_pcg_iterations = 1;
    let automatic = solve(&input).expect("automatic DKT frontal fallback");
    assert_eq!(automatic.backend_used, Mixed3dBackend::FrontalWave);
    assert!(automatic.relative_residual < 1e-8);

    input.backend = Mixed3dBackend::Dense;
    let dense = solve(&input).expect("dense DKT fallback reference");
    near(
        automatic.nodal_displacements_m[1][2],
        dense.nodal_displacements_m[1][2],
        2e-10,
        "automatic DKT fallback displacement",
    );
    near(
        automatic.nodal_rotations_rad[0].unwrap()[0],
        dense.nodal_rotations_rad[0].unwrap()[0],
        2e-10,
        "automatic DKT fallback rotation",
    );
}

#[test]
fn zero_load_plate_attached_to_solid_at_one_node_rejects_tipping_modes() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let input: Mixed3dRequest = serde_json::from_value(json!({
            "mesh": {"nodes": [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
                               [2, 0, 0], [0, 2, 0]], "tets": [[0, 1, 2, 3]]},
            "solidMaterial": {"eMpa": 1200, "poisson": 0.2},
            "trusses": [],
            "bendingPlates": [{"nodes": [0, 4, 5], "eMpa": PLATE_E_MPA,
                               "nu": PLATE_NU, "thicknessM": 0.1}],
            "loadsKn": [[0, 0, 0], [0, 0, 0], [0, 0, 0],
                        [0, 0, 0], [0, 0, 0], [0, 0, 0]],
            "prescribedM": [[0, 0, 0], [0, 0, 0], [0, 0, 0],
                            [0, 0, 0], [null, null, null], [null, null, null]],
            "backend": backend
        }))
        .expect("one-node DKT/Tet4 attachment");
        let error =
            solve(&input).expect_err("unrestrained DKT tilts must fail before zero-load PCG");
        assert!(
            error.contains("bending plate cluster") && error.contains("rigid"),
            "{error}"
        );
    }
}
