use openaec_native_fem::frame3d::{solve, Request};
use serde_json::{json, Value};

fn cantilever() -> Value {
    json!({
        "schemaVersion": 1,
        "analysis": "linear",
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 2, "x": 2.0, "y": 0.0, "z": 0.0}
        ],
        "materials": [{"id": 1, "eMpa": 210000.0, "nu": 0.3}],
        "sections": [{"id": 1, "areaM2": 0.01, "iyM4": 0.00001,
            "izM4": 0.00002, "torsionJM4": 0.000001}],
        "members": [{"id": 1, "startNodeId": 1, "endNodeId": 2,
            "materialId": 1, "sectionId": 1}],
        "supports": [{"nodeId": 1, "ux": true, "uy": true, "uz": true,
            "rx": true, "ry": true, "rz": true}],
        "nodalLoads": [{"nodeId": 2, "fx": 120.0, "fy": -10.0,
            "fz": 6.0, "mx": 0.0, "my": 0.0, "mz": 0.0}]
    })
}

fn close(actual: f64, expected: f64) {
    let tolerance = 1e-9 * expected.abs().max(1.0);
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} != {expected}"
    );
}

#[test]
fn frontal_matches_dense_and_independent_axial_bending_solution() {
    let baseline = solve(&serde_json::from_value::<Request>(cantilever()).unwrap()).unwrap();
    let mut input = cantilever();
    input["linearBackend"] = json!("frontalWave");
    let frontal = solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap();

    // E is MPa in the request and kN/m² in these closed-form beam expressions.
    let e = 210_000_000.0;
    let l: f64 = 2.0;
    let tip = &frontal.nodes[1];
    close(tip.displacement[0], 120.0 * l / (e * 0.01));
    close(tip.displacement[1], -10.0 * l.powi(3) / (3.0 * e * 0.00002));
    close(tip.displacement[2], 6.0 * l.powi(3) / (3.0 * e * 0.00001));
    for (frontal_node, baseline_node) in frontal.nodes.iter().zip(&baseline.nodes) {
        for axis in 0..6 {
            close(
                frontal_node.displacement[axis],
                baseline_node.displacement[axis],
            );
            close(frontal_node.reaction[axis], baseline_node.reaction[axis]);
        }
    }
    for (actual, expected) in frontal.members[0]
        .local_end_forces
        .iter()
        .zip(baseline.members[0].local_end_forces)
    {
        close(*actual, expected);
    }
    assert!(frontal.equilibrium_residual < 1e-10);
}

#[test]
fn frontal_preserves_spring_and_prescribed_displacement_reporting() {
    let mut input = cantilever();
    input["supports"][0]["uxPrescribedM"] = json!(0.0003);
    input["supports"].as_array_mut().unwrap().push(json!({
        "nodeId": 2, "ux": false, "uy": false, "uz": false,
        "rx": false, "ry": false, "rz": false,
        "kyKnPerM": 1500.0
    }));
    let baseline = solve(&serde_json::from_value::<Request>(input.clone()).unwrap()).unwrap();
    input["linearBackend"] = json!("frontalWave");
    let frontal = solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap();
    for (actual_node, expected_node) in frontal.nodes.iter().zip(baseline.nodes) {
        for axis in 0..6 {
            close(
                actual_node.displacement[axis],
                expected_node.displacement[axis],
            );
            close(actual_node.reaction[axis], expected_node.reaction[axis]);
        }
    }
}

#[test]
fn frontal_preserves_thermal_and_point_member_loads_without_global_assembly() {
    let mut input = cantilever();
    input["materials"][0]["alphaPerK"] = json!(10e-6);
    input["thermalLoads"] = json!([{"id": 1, "memberId": 1,
        "deltaTUniformK": 25.0, "deltaTGradientYK": 7.0,
        "deltaTGradientZK": -9.0}]);
    input["memberPointLoads"] = json!([{"id": 1, "memberId": 1,
        "pyKn": 3.0, "pzKn": -2.0, "positionM": 0.75}]);
    let baseline = solve(&serde_json::from_value::<Request>(input.clone()).unwrap()).unwrap();
    input["linearBackend"] = json!("frontalWave");
    let frontal = solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap();
    for (actual_node, expected_node) in frontal.nodes.iter().zip(baseline.nodes) {
        for axis in 0..6 {
            close(
                actual_node.displacement[axis],
                expected_node.displacement[axis],
            );
            close(actual_node.reaction[axis], expected_node.reaction[axis]);
        }
    }
    for (actual, expected) in frontal.members[0]
        .local_end_forces
        .iter()
        .zip(baseline.members[0].local_end_forces)
    {
        close(*actual, expected);
    }
    assert!(frontal.equilibrium_residual < 1e-9);
}

#[test]
fn frontal_preserves_releases_member_loads_and_buckling_result() {
    let mut input = cantilever();
    input["members"][0]["releases"] = json!({"mzEnd": true});
    input["nodalLoads"] = json!([{"nodeId": 2, "fx": -120.0, "fy": 0.0,
        "fz": 0.0, "mx": 0.0, "my": 0.0, "mz": 0.0}]);
    input["memberLoads"] = json!([{"id": 1, "memberId": 1,
        "qyStartKnPerM": -2.0, "qyEndKnPerM": -2.0,
        "qzStartKnPerM": 0.0, "qzEndKnPerM": 0.0}]);
    input["bucklingModes"] = json!(1);
    let baseline = solve(&serde_json::from_value::<Request>(input.clone()).unwrap()).unwrap();
    input["linearBackend"] = json!("frontalWave");
    let frontal = solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap();
    for (actual_node, expected_node) in frontal.nodes.iter().zip(baseline.nodes) {
        for axis in 0..6 {
            close(
                actual_node.displacement[axis],
                expected_node.displacement[axis],
            );
            close(actual_node.reaction[axis], expected_node.reaction[axis]);
        }
    }
    for (actual, expected) in frontal.members[0]
        .local_end_forces
        .iter()
        .zip(baseline.members[0].local_end_forces)
    {
        close(*actual, expected);
    }
    let actual_buckling = serde_json::to_value(frontal.buckling).unwrap();
    let expected_buckling = serde_json::to_value(baseline.buckling).unwrap();
    assert_eq!(actual_buckling["status"], "available");
    assert_eq!(actual_buckling["status"], expected_buckling["status"]);
    close(
        actual_buckling["modes"][0]["loadFactor"].as_f64().unwrap(),
        expected_buckling["modes"][0]["loadFactor"]
            .as_f64()
            .unwrap(),
    );
}

#[test]
fn frontal_rejects_non_linear_modes_and_bounded_front_overflow() {
    for analysis in ["p-delta", "material", "combined"] {
        let mut input = cantilever();
        input["analysis"] = json!(analysis);
        input["linearBackend"] = json!("frontalWave");
        assert!(solve(&serde_json::from_value::<Request>(input).unwrap())
            .unwrap_err()
            .contains("requires linear analysis"));
    }
    let mut input = cantilever();
    input["linearBackend"] = json!("frontalWave");
    input["frontalMaxFrontDofs"] = json!(1);
    assert!(solve(&serde_json::from_value::<Request>(input).unwrap())
        .unwrap_err()
        .contains("wavefront exceeded maximum"));
}
