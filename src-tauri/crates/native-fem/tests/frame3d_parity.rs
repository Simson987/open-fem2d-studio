use frame3d_solver::{solve as solve_reference, SolveRequest3D};
use openaec_native_fem::frame3d::{solve as solve_native, Request};
use serde_json::{json, Value};

fn model() -> Value {
    json!({
        "schemaVersion": 1,
        "analysis": "linear",
        "bucklingModes": 0,
        "nodes": [
            {"id": 1, "x": 0.0, "y": 0.0, "z": 0.0},
            {"id": 2, "x": 2.0, "y": 0.0, "z": 0.0}
        ],
        "materials": [{"id": 1, "name": "steel", "eMpa": 210000.0, "nu": 0.3}],
        "sections": [{"id": 1, "name": "reference", "areaM2": 0.01,
            "iyM4": 0.00001, "izM4": 0.00002, "torsionJM4": 0.000001}],
        "members": [{"id": 1, "startNodeId": 1, "endNodeId": 2,
            "materialId": 1, "sectionId": 1}],
        "supports": [{"nodeId": 1, "ux": true, "uy": true, "uz": true,
            "rx": true, "ry": true, "rz": true}],
        "nodalLoads": []
    })
}

fn compare(model: Value) {
    let native = solve_native(&serde_json::from_value::<Request>(model.clone()).unwrap()).unwrap();
    let reference =
        solve_reference(serde_json::from_value::<SolveRequest3D>(model).unwrap()).unwrap();
    for node in &native.nodes {
        let displacement = reference
            .displacements
            .iter()
            .find(|v| v.node_id == node.node_id)
            .unwrap();
        let reaction = reference
            .reactions
            .iter()
            .find(|v| v.node_id == node.node_id);
        let expected_u = [
            displacement.ux,
            displacement.uy,
            displacement.uz,
            displacement.rx,
            displacement.ry,
            displacement.rz,
        ];
        let expected_r = reaction.map_or([0.0; 6], |reaction| {
            [
                reaction.fx,
                reaction.fy,
                reaction.fz,
                reaction.mx,
                reaction.my,
                reaction.mz,
            ]
        });
        for axis in 0..6 {
            let u_tolerance = 1e-8_f64.max(expected_u[axis].abs() * 1e-6);
            let r_tolerance = 1e-6_f64.max(expected_r[axis].abs() * 1e-6);
            assert!(
                (node.displacement[axis] - expected_u[axis]).abs() < u_tolerance,
                "node {} displacement axis {axis}: native={} reference={}",
                node.node_id,
                node.displacement[axis],
                expected_u[axis]
            );
            assert!(
                (node.reaction[axis] - expected_r[axis]).abs() < r_tolerance,
                "node {} reaction axis {axis}: native={} reference={}",
                node.node_id,
                node.reaction[axis],
                expected_r[axis]
            );
        }
    }
}

#[test]
fn support_spring_matches_existing_frame_solver() {
    let mut input = model();
    input["supports"].as_array_mut().unwrap().push(json!({
        "nodeId": 2, "ux": false, "uy": false, "uz": false,
        "rx": false, "ry": false, "rz": false, "kzKnPerM": 212.5
    }));
    input["nodalLoads"].as_array_mut().unwrap().push(json!({
        "id": 1, "nodeId": 2, "fx": 0.0, "fy": 0.0, "fz": -10.0,
        "mx": 0.0, "my": 0.0, "mz": 0.0
    }));
    compare(input.clone());
    input["analysis"] = json!("p-delta");
    compare(input);
}

#[test]
fn imposed_displacement_matches_existing_frame_solver() {
    let mut input = model();
    input["supports"].as_array_mut().unwrap().push(json!({
        "nodeId": 2, "ux": true, "uy": true, "uz": true,
        "rx": true, "ry": true, "rz": true, "uxPrescribedM": 0.001
    }));
    compare(input.clone());
    input["analysis"] = json!("p-delta");
    compare(input);
}

#[test]
fn rotational_spring_and_imposed_rotation_match_existing_solver() {
    let mut sprung = model();
    sprung["supports"].as_array_mut().unwrap().push(json!({
        "nodeId": 2, "ux": false, "uy": false, "uz": false,
        "rx": false, "ry": false, "rz": false, "kryKnmPerRad": 150.0
    }));
    sprung["nodalLoads"].as_array_mut().unwrap().push(json!({
        "id": 1, "nodeId": 2, "fx": 0.0, "fy": 0.0, "fz": 0.0,
        "mx": 0.0, "my": 10.0, "mz": 0.0
    }));
    compare(sprung);

    let mut rotated = model();
    rotated["supports"].as_array_mut().unwrap().push(json!({
        "nodeId": 2, "ux": true, "uy": true, "uz": true,
        "rx": true, "ry": true, "rz": true, "ryPrescribedRad": 0.01
    }));
    compare(rotated);
}

#[test]
fn member_line_and_point_loads_match_existing_solver() {
    let mut uniform = model();
    uniform["memberLoads"] = json!([{
        "id": 1, "memberId": 1,
        "qyStartKnPerM": 0.0, "qyEndKnPerM": 0.0,
        "qzStartKnPerM": -4.0, "qzEndKnPerM": -4.0
    }]);
    compare(uniform.clone());
    uniform["analysis"] = json!("p-delta");
    compare(uniform);

    let mut tapered = model();
    tapered["memberLoads"] = json!([{
        "id": 1, "memberId": 1,
        "qyStartKnPerM": 1.0, "qyEndKnPerM": 5.0,
        "qzStartKnPerM": -2.0, "qzEndKnPerM": -6.0,
        "startPositionM": 0.25, "endPositionM": 1.75
    }]);
    compare(tapered);

    let mut point = model();
    point["memberPointLoads"] = json!([{
        "id": 1, "memberId": 1, "pyKn": 3.0, "pzKn": -10.0,
        "positionM": 0.75
    }]);
    compare(point);
}

#[test]
fn uniform_and_gradient_thermal_loads_match_existing_solver() {
    let mut free = model();
    free["materials"][0]["alphaPerK"] = json!(10e-6);
    free["thermalLoads"] = json!([{
        "id": 1, "memberId": 1, "deltaTUniformK": 30.0,
        "deltaTGradientYK": 0.0, "deltaTGradientZK": 0.0
    }]);
    compare(free.clone());
    free["analysis"] = json!("p-delta");
    compare(free);

    let mut gradient = model();
    gradient["thermalLoads"] = json!([{
        "id": 1, "memberId": 1, "deltaTUniformK": 0.0,
        "deltaTGradientYK": 10.0, "deltaTGradientZK": -20.0
    }]);
    compare(gradient);
}
