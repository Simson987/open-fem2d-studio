use openaec_native_fem::mixed3d::{solve, Mixed3dRequest};
use serde_json::{json, Value};

fn fixture(with_plate: bool) -> Mixed3dRequest {
    let mut input = json!({
        "mesh": {"nodes": [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [2.0, 0.0, 0.0]], "tets": []},
        "solidMaterial": {"eMpa": 1000.0, "poisson": 0.2},
        "hexes": [], "trusses": [],
        "frames": [{"nodes": [1, 3], "eMpa": 200000.0, "poisson": 0.3,
            "areaM2": 0.02, "iyM4": 0.0001, "izM4": 0.0001, "torsionJM4": 0.0002}],
        "loadsKn": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
        "momentsKnm": [[0.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
        "prescribedM": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
        "prescribedRotationsRad": [[null, null, null], [0.0, null, 0.0], [null, null, null], [0.0, 0.0, 0.0]],
        "backend": "sparseDirect"
    });
    if with_plate {
        input["bendingPlates"] =
            json!([{"nodes": [0, 1, 2], "eMpa": 30000.0, "nu": 0.2, "thicknessM": 0.1}]);
        input["prescribedRotationsRad"][0] = json!([0.0, 0.0, null]);
        input["prescribedRotationsRad"][2] = json!([0.0, 0.0, null]);
    }
    serde_json::from_value(input).unwrap()
}

#[test]
fn plate_and_frame_share_physical_rotation_dof() {
    let frame_only = solve(&fixture(false)).unwrap();
    let coupled = solve(&fixture(true)).unwrap();
    let frame_ry = frame_only.nodal_rotations_rad[1].unwrap()[1];
    let coupled_ry = coupled.nodal_rotations_rad[1].unwrap()[1];
    assert!(frame_ry > 0.0 && coupled_ry > 0.0 && coupled_ry < frame_ry);
    assert!(coupled.relative_residual < 1e-8);
    assert_eq!(coupled.nodal_rotations_rad[0].unwrap()[2], 0.0);
    assert_eq!(coupled.nodal_moment_reactions_knm[2].unwrap()[2], 0.0);
}

#[test]
fn plate_only_node_rejects_drilling_moment_and_support() {
    let mut base: Value = serde_json::to_value(fixture(true)).unwrap();
    base["frames"] = json!([]);
    base["prescribedRotationsRad"][1] = json!([0.0, 0.0, null]);
    base["prescribedRotationsRad"][3] = json!([null, null, null]);
    let mut with_moment = base.clone();
    with_moment["momentsKnm"][1] = json!([0.0, 0.0, 1.0]);
    let error = solve(&serde_json::from_value::<Mixed3dRequest>(with_moment).unwrap()).unwrap_err();
    assert!(error.contains("drilling rz moment/rotation"), "{error}");
    base["prescribedRotationsRad"][1] = json!([0.0, 0.0, 0.0]);
    let error = solve(&serde_json::from_value::<Mixed3dRequest>(base).unwrap()).unwrap_err();
    assert!(error.contains("drilling rz moment/rotation"), "{error}");
}

#[test]
fn plate_only_in_plane_force_and_nonhorizontal_triangle_are_rejected() {
    let mut base: Value = serde_json::to_value(fixture(true)).unwrap();
    base["frames"] = json!([]);
    base["momentsKnm"][1] = json!([0.0, 0.0, 0.0]);
    base["prescribedRotationsRad"][1] = json!([0.0, null, null]);
    base["prescribedRotationsRad"][3] = json!([null, null, null]);
    base["loadsKn"][1] = json!([1.0, 0.0, 0.0]);
    let error =
        solve(&serde_json::from_value::<Mixed3dRequest>(base.clone()).unwrap()).unwrap_err();
    assert!(error.contains("in-plane load/displacement"), "{error}");
    base["loadsKn"][1] = json!([0.0, 0.0, 0.0]);
    base["mesh"]["nodes"][2][2] = json!(0.01);
    let error = solve(&serde_json::from_value::<Mixed3dRequest>(base).unwrap()).unwrap_err();
    assert!(error.contains("horizontal XY"), "{error}");
}
