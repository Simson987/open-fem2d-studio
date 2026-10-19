use openaec_native_fem::frame2d::{solve, Request, Result2D};
use serde_json::{json, Value};

fn cantilever() -> Value {
    json!({
        "analysis": "linear",
        "nodes": [{"id": 1, "x": 0.0, "y": 0.0}, {"id": 2, "x": 3.0, "y": 0.0}],
        "materials": [{"id": 1, "eMpa": 210000.0}],
        "sections": [{"id": 1, "areaM2": 0.01, "inertiaM4": 0.000008}],
        "members": [{"id": 1, "startNodeId": 1, "endNodeId": 2,
            "materialId": 1, "sectionId": 1}],
        "supports": [{"nodeId": 1, "ux": true, "uy": true, "rz": true}],
        "nodalLoads": [{"nodeId": 2, "fx": 120.0, "fy": -10.0, "mz": 0.0}]
    })
}

fn run(input: Value) -> Result2D {
    solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap()
}

fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() <= 1e-9 * expected.abs().max(1.0),
        "{actual:.12e} != {expected:.12e}"
    );
}

fn parity(input: Value) -> Result2D {
    let baseline = run(input.clone());
    assert_eq!(baseline.frontal_maximum_front_dofs, None);
    let mut frontal_input = input;
    frontal_input["linearBackend"] = json!("frontalWave");
    let frontal = run(frontal_input);
    assert!(frontal.frontal_maximum_front_dofs.unwrap() > 0);
    assert!(frontal.equilibrium_residual < 1e-8);
    for (actual, expected) in frontal.nodes.iter().zip(&baseline.nodes) {
        for axis in 0..3 {
            close(actual.displacement[axis], expected.displacement[axis]);
            close(actual.reaction[axis], expected.reaction[axis]);
        }
    }
    for (actual, expected) in frontal.members.iter().zip(&baseline.members) {
        for axis in 0..6 {
            close(
                actual.local_end_forces[axis],
                expected.local_end_forces[axis],
            );
        }
        for (a, b) in actual
            .bending_moment_knm
            .iter()
            .zip(&expected.bending_moment_knm)
        {
            close(*a, *b);
        }
        for (a, b) in actual.deflection_m.iter().zip(&expected.deflection_m) {
            close(*a, *b);
        }
    }
    frontal
}

#[test]
fn frontal_matches_independent_axial_and_bending_solution() {
    let result = parity(cantilever());
    let tip = &result.nodes[1];
    let e = 210_000_000.0;
    let l: f64 = 3.0;
    close(tip.displacement[0], 120.0 * l / (e * 0.01));
    close(
        tip.displacement[1],
        -10.0 * l.powi(3) / (3.0 * e * 0.000008),
    );
    close(
        tip.displacement[2],
        -10.0 * l.powi(2) / (2.0 * e * 0.000008),
    );
    close(result.nodes[0].reaction[0], -120.0);
    close(result.nodes[0].reaction[1], 10.0);
    close(result.nodes[0].reaction[2], 30.0);
}

#[test]
fn frontal_preserves_connection_springs_releases_member_loads_and_settlement() {
    let mut input = cantilever();
    input["nodes"] = json!([
        {"id": 1, "x": 0.0, "y": 0.0},
        {"id": 2, "x": 2.0, "y": 0.0},
        {"id": 3, "x": 4.0, "y": 0.0}
    ]);
    input["members"] = json!([
        {"id": 1, "startNodeId": 1, "endNodeId": 2, "materialId": 1,
            "sectionId": 1, "foundationKnPerM2": 250.0,
            "springs": {"rzStartKnmPerRad": 1500.0}},
        {"id": 2, "startNodeId": 2, "endNodeId": 3, "materialId": 1,
            "sectionId": 1, "releases": {"rzEnd": true},
            "springs": {"uxStartKnPerM": 12000.0}}
    ]);
    input["supports"] = json!([
        {"nodeId": 1, "ux": true, "uy": true, "rz": true,
            "uxPrescribedM": 0.0002, "uyPrescribedM": -0.0001},
        {"nodeId": 3, "ux": false, "uy": false, "rz": true,
            "kyKnPerM": 800.0}
    ]);
    input["nodalLoads"] = json!([
        {"nodeId": 3, "fx": 5.0, "fy": -10.0, "mz": 0.0}
    ]);
    input["memberLoads"] = json!([
        {"memberId": 1, "qxStartKnPerM": 0.0, "qxEndKnPerM": 0.0,
            "qyStartKnPerM": -2.0, "qyEndKnPerM": -4.0}
    ]);
    input["memberPointLoads"] = json!([
        {"memberId": 2, "pxKn": 2.0, "pyKn": -3.0, "positionM": 0.8}
    ]);
    input["thermalLoads"] = json!([
        {"memberId": 2, "deltaTK": 12.0, "alphaPerK": 0.000012}
    ]);
    parity(input);
}

#[test]
fn frontal_rejects_non_linear_membrane_front_limit_and_mechanism() {
    for analysis in ["geometric", "material", "combined"] {
        let mut input = cantilever();
        input["linearBackend"] = json!("frontalWave");
        input["analysis"] = json!(analysis);
        let error = solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap_err();
        assert!(error.contains("requires linear analysis"), "{error}");
    }
    let mut input = cantilever();
    input["linearBackend"] = json!("frontalWave");
    input["frontalMaxFrontDofs"] = json!(1);
    let error = solve(&serde_json::from_value::<Request>(input.clone()).unwrap()).unwrap_err();
    assert!(error.contains("wavefront exceeded maximum"), "{error}");

    input.as_object_mut().unwrap().remove("frontalMaxFrontDofs");
    input["supports"] = json!([]);
    let error = solve(&serde_json::from_value::<Request>(input.clone()).unwrap()).unwrap_err();
    assert!(error.contains("singular frontal pivot"), "{error}");

    input["membrane"] = json!({});
    let error = solve(&serde_json::from_value::<Request>(input).unwrap()).unwrap_err();
    assert!(
        error.contains("does not support coupled membranes"),
        "{error}"
    );
}

#[test]
fn frontal_solves_more_than_twenty_thousand_global_dofs_with_narrow_front() {
    // All transverse/rotational DOFs are restrained. The remaining 7000
    // axial springs are in series, so u_tip = P L/(EA). This also exceeds
    // the assembled Matrix backend's 20,000-DOF limit.
    let segments = 7000usize;
    let force_kn = 10.0;
    let mut input = cantilever();
    input["linearBackend"] = json!("frontalWave");
    input["frontalMaxFrontDofs"] = json!(4);
    input["nodes"] = Value::Array(
        (0..=segments)
            .map(|index| json!({"id": index + 1, "x": index as f64, "y": 0.0}))
            .collect(),
    );
    input["members"] = Value::Array(
        (0..segments)
            .map(|index| {
                json!({"id": index + 1, "startNodeId": index + 1,
            "endNodeId": index + 2, "materialId": 1, "sectionId": 1})
            })
            .collect(),
    );
    input["supports"] = Value::Array(
        (0..=segments)
            .map(|index| {
                json!({"nodeId": index + 1, "ux": index == 0,
            "uy": true, "rz": true})
            })
            .collect(),
    );
    input["nodalLoads"] = json!([{"nodeId": segments + 1,
        "fx": force_kn, "fy": 0.0, "mz": 0.0}]);
    let result = run(input);
    let ea_kn = 210_000.0 * 1000.0 * 0.01;
    close(
        result.nodes[segments].displacement[0],
        force_kn * segments as f64 / ea_kn,
    );
    close(result.nodes[0].reaction[0], -force_kn);
    assert!(result.frontal_maximum_front_dofs.unwrap() <= 4);
    assert!(result.equilibrium_residual < 1e-8);
}
