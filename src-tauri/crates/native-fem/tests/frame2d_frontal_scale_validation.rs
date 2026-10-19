//! A connected 201-arm frame with 606 total DOFs. The common root is fixed,
//! so every arm also has an independent cantilever solution for validation.

use openaec_native_fem::frame2d::{solve, Request};
use serde_json::{json, Value};

const ARMS: usize = 201;
const E: f64 = 210_000_000.0; // 210000 MPa in kN/m²
const AREA: f64 = 0.01;
const INERTIA: f64 = 0.000008;
const FX: f64 = 120.0;
const FY: f64 = -10.0;

fn length(arm: usize) -> f64 {
    3.0 * (1.0 + arm as f64 / 1000.0)
}

fn request(backend: &str, front_limit: usize) -> Request {
    let mut nodes = vec![json!({"id": 1, "x": 0.0, "y": 0.0})];
    let mut members = Vec::<Value>::with_capacity(ARMS);
    let mut loads = Vec::<Value>::with_capacity(ARMS);
    for arm in 0..ARMS {
        let tip = arm + 2;
        nodes.push(json!({"id": tip, "x": length(arm), "y": 0.0}));
        members.push(json!({"id": arm + 1, "startNodeId": 1,
            "endNodeId": tip, "materialId": 1, "sectionId": 1}));
        loads.push(json!({"nodeId": tip, "fx": FX, "fy": FY, "mz": 0.0}));
    }
    serde_json::from_value(json!({
        "analysis": "linear",
        "linearBackend": backend,
        "frontalMaxFrontDofs": front_limit,
        "nodes": nodes,
        "materials": [{"id": 1, "eMpa": E / 1000.0}],
        "sections": [{"id": 1, "areaM2": AREA, "inertiaM4": INERTIA}],
        "members": members,
        "supports": [{"nodeId": 1, "ux": true, "uy": true, "rz": true}],
        "nodalLoads": loads
    }))
    .unwrap()
}

fn close(label: &str, actual: f64, expected: f64, scale: f64) {
    let tolerance = 1e-8 * scale.max(expected.abs());
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: {actual:.12e} != {expected:.12e} (tolerance {tolerance:.3e})"
    );
}

#[test]
fn frontal_frame2d_above_600_dof_matches_existing_and_cantilever_theory() {
    assert_eq!(3 * (ARMS + 1), 606);
    let frontal = solve(&request("frontalWave", 3)).unwrap();
    let existing = solve(&request("existing", 3)).unwrap();
    assert_eq!(frontal.frontal_maximum_front_dofs, Some(3));
    assert_eq!(existing.frontal_maximum_front_dofs, None);
    assert_eq!(frontal.nodes.len(), ARMS + 1);
    assert_eq!(frontal.members.len(), ARMS);
    assert!(frontal.equilibrium_residual < 1e-8);
    assert!(existing.equilibrium_residual < 1e-8);

    let sum_length: f64 = (0..ARMS).map(length).sum();
    let root_expected = [-(ARMS as f64) * FX, -(ARMS as f64) * FY, -FY * sum_length];
    for axis in 0..3 {
        close(
            "root reaction",
            frontal.nodes[0].reaction[axis],
            root_expected[axis],
            root_expected[axis],
        );
        close(
            "root parity",
            frontal.nodes[0].reaction[axis],
            existing.nodes[0].reaction[axis],
            root_expected[axis],
        );
    }

    for arm in 0..ARMS {
        let l = length(arm);
        let expected = [
            FX * l / (E * AREA),
            FY * l.powi(3) / (3.0 * E * INERTIA),
            FY * l.powi(2) / (2.0 * E * INERTIA),
        ];
        let tip = arm + 1;
        assert_eq!(frontal.nodes[tip].node_id, arm + 2);
        for axis in 0..3 {
            close(
                "tip theory",
                frontal.nodes[tip].displacement[axis],
                expected[axis],
                expected[axis],
            );
            close(
                "tip parity",
                frontal.nodes[tip].displacement[axis],
                existing.nodes[tip].displacement[axis],
                expected[axis],
            );
            close(
                "free-tip reaction",
                frontal.nodes[tip].reaction[axis],
                0.0,
                1.0,
            );
        }
        for axis in 0..6 {
            close(
                "member force parity",
                frontal.members[arm].local_end_forces[axis],
                existing.members[arm].local_end_forces[axis],
                (FX.abs() + FY.abs() * l).max(1.0),
            );
        }
    }

    let error = solve(&request("frontalWave", 2)).unwrap_err();
    assert!(error.contains("wavefront exceeded maximum"), "{error}");
}
