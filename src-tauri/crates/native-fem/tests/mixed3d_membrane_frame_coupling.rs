//! Regression for membrane forces assembled with solid and 12-DOF frame paths.

use openaec_native_fem::mixed3d::{solve, Membrane3dElement, Mixed3dBackend, Mixed3dRequest};
use serde_json::Value;

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("reference fixture");
    fixture["input"]["backend"] = serde_json::to_value(backend).unwrap();
    let mut request: Mixed3dRequest = serde_json::from_value(fixture["input"].take()).unwrap();
    request.membranes = vec![Membrane3dElement {
        nodes: [1, 2, 3],
        e_mpa: 30_000.0,
        nu: 0.2,
        thickness_m: 0.06,
    }];
    request
}

#[test]
fn inclined_membrane_shares_solid_and_bending_frame_translations() {
    let mut without = model(Mixed3dBackend::Dense);
    without.membranes.clear();
    let bare_tip = solve(&without).unwrap().nodal_displacements_m[4][2];
    let dense = solve(&model(Mixed3dBackend::Dense)).unwrap();
    assert!(dense.nodal_displacements_m[4][2] < bare_tip);
    assert_eq!(dense.membrane_stress_mpa.len(), 1);
    assert!(dense.membrane_stress_mpa[0].iter().any(|v| v.abs() > 1e-8));
    for backend in [
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        let solved = solve(&model(backend)).unwrap();
        assert!(
            (solved.nodal_displacements_m[4][2] - dense.nodal_displacements_m[4][2]).abs() < 1e-10,
            "{backend:?} frame tip"
        );
        for axis in 0..3 {
            assert!(
                (solved.membrane_stress_mpa[0][axis] - dense.membrane_stress_mpa[0][axis]).abs()
                    < 1e-7,
                "{backend:?} membrane stress {axis}"
            );
            assert!(
                (solved.membrane_resultants_kn_per_m[0][axis]
                    - 60.0 * solved.membrane_stress_mpa[0][axis])
                    .abs()
                    < 1e-8
            );
        }
        assert!(solved.relative_residual < 1e-8);
    }
}

#[test]
fn membrane_geometry_and_material_are_checked_on_both_paths() {
    for backend in [Mixed3dBackend::Dense, Mixed3dBackend::MatrixFreePcg] {
        let mut request = model(backend);
        request.membranes[0].nodes = [0, 1, 4];
        assert!(solve(&request).unwrap_err().contains("degenerate"));
        request.membranes[0].nodes = [1, 2, 3];
        request.membranes[0].thickness_m = 0.0;
        assert!(solve(&request).unwrap_err().contains("thickness"));
        request.membranes[0].thickness_m = 0.06;
        request.membranes[0].nu = 0.5;
        assert!(solve(&request).unwrap_err().contains("nu"));
    }
}
