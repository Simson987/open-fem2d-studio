//! A genuinely coupled, multi-bay frame exercises a wider frontal wave than
//! the independent-arm scale check. Loads and restraints are intentionally
//! asymmetric to expose ordering, spring and prescribed-displacement errors.

use openaec_native_fem::frame2d::{solve, Request, Result2D};
use serde_json::{json, Value};

const BAYS: usize = 5;
const STOREYS: usize = 3;

fn node_id(column: usize, level: usize) -> usize {
    level * (BAYS + 1) + column + 1
}

fn model(backend: &str, front_limit: usize) -> Request {
    let mut nodes = Vec::<Value>::new();
    for level in 0..=STOREYS {
        for column in 0..=BAYS {
            nodes.push(json!({
                "id": node_id(column, level),
                "x": 4.0 * column as f64,
                "y": 3.2 * level as f64
            }));
        }
    }

    let mut members = Vec::<Value>::new();
    // Columns first, beams second: the coupled storeys keep many live DOFs
    // in the frontal wave before their final contributing member appears.
    for column in 0..=BAYS {
        for level in 0..STOREYS {
            members.push(json!({
                "id": members.len() + 1,
                "startNodeId": node_id(column, level),
                "endNodeId": node_id(column, level + 1),
                "materialId": 1,
                "sectionId": 1
            }));
        }
    }
    for level in 1..=STOREYS {
        for column in 0..BAYS {
            members.push(json!({
                "id": members.len() + 1,
                "startNodeId": node_id(column, level),
                "endNodeId": node_id(column + 1, level),
                "materialId": 1,
                "sectionId": 2
            }));
        }
    }

    let mut supports = Vec::<Value>::new();
    for column in 0..=BAYS {
        let mut support = json!({
            "nodeId": node_id(column, 0),
            "ux": true,
            "uy": true,
            "rz": true
        });
        if column == 2 {
            support["uyPrescribedM"] = json!(-0.0003);
        }
        supports.push(support);
    }
    supports.push(json!({
        "nodeId": node_id(BAYS, STOREYS),
        "ux": false, "uy": false, "rz": false,
        "kxKnPerM": 550.0,
        "kyKnPerM": 800.0,
        "krzKnmPerRad": 2500.0
    }));

    serde_json::from_value(json!({
        "analysis": "linear",
        "linearBackend": backend,
        "frontalMaxFrontDofs": front_limit,
        "nodes": nodes,
        "materials": [{"id": 1, "eMpa": 210000.0}],
        "sections": [
            {"id": 1, "areaM2": 0.015, "inertiaM4": 0.00008},
            {"id": 2, "areaM2": 0.011, "inertiaM4": 0.00005}
        ],
        "members": members,
        "supports": supports,
        "nodalLoads": [
            {"nodeId": node_id(0, STOREYS), "fx": 20.0, "fy": -8.0, "mz": 1.5},
            {"nodeId": node_id(2, STOREYS), "fx": 45.0, "fy": -12.0, "mz": -2.0},
            {"nodeId": node_id(BAYS, STOREYS), "fx": 70.0, "fy": -18.0, "mz": 3.0},
            {"nodeId": node_id(3, 1), "fx": -15.0, "fy": -6.0, "mz": 0.0}
        ]
    }))
    .unwrap()
}

fn close(label: &str, actual: f64, expected: f64, scale: f64) {
    let tolerance = 2e-8 * scale.abs().max(expected.abs()).max(1.0);
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: {actual:.12e} != {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn global_force_and_moment(result: &Result2D, request: &Request) -> [f64; 3] {
    result
        .nodes
        .iter()
        .zip(&request.nodes)
        .fold([0.0; 3], |mut total, (response, node)| {
            total[0] += response.reaction[0];
            total[1] += response.reaction[1];
            total[2] += node.x * response.reaction[1] - node.y * response.reaction[0]
                + response.reaction[2];
            total
        })
}

#[test]
fn wide_front_matches_existing_for_coupled_frame_and_balances_loads() {
    let frontal_request = model("frontalWave", 100);
    let frontal = solve(&frontal_request).unwrap();
    let existing = solve(&model("existing", 100)).unwrap();
    let width = frontal.frontal_maximum_front_dofs.unwrap();
    assert!(width >= 15, "front unexpectedly narrow: {width}");
    assert!(width <= 100);
    assert_eq!(existing.frontal_maximum_front_dofs, None);
    assert_eq!(frontal.nodes.len(), (BAYS + 1) * (STOREYS + 1));
    assert_eq!(frontal.members.len(), (BAYS + 1) * STOREYS + BAYS * STOREYS);
    assert!(frontal.equilibrium_residual < 1e-8);

    for (actual, expected) in frontal.nodes.iter().zip(&existing.nodes) {
        assert_eq!(actual.node_id, expected.node_id);
        for axis in 0..3 {
            close(
                "nodal displacement",
                actual.displacement[axis],
                expected.displacement[axis],
                1.0,
            );
            close(
                "nodal reaction",
                actual.reaction[axis],
                expected.reaction[axis],
                100.0,
            );
        }
    }
    for (actual, expected) in frontal.members.iter().zip(&existing.members) {
        assert_eq!(actual.member_id, expected.member_id);
        for axis in 0..6 {
            close(
                "member local end force",
                actual.local_end_forces[axis],
                expected.local_end_forces[axis],
                100.0,
            );
        }
    }

    let applied = frontal_request
        .nodal_loads
        .iter()
        .fold([0.0; 3], |mut total, load| {
            let node = frontal_request
                .nodes
                .iter()
                .find(|node| node.id == load.node_id)
                .unwrap();
            total[0] += load.fx;
            total[1] += load.fy;
            total[2] += node.x * load.fy - node.y * load.fx + load.mz;
            total
        });
    let reactions = global_force_and_moment(&frontal, &frontal_request);
    for axis in 0..3 {
        close(
            "global force and moment balance",
            reactions[axis],
            -applied[axis],
            2000.0,
        );
    }

    let error = solve(&model("frontalWave", width - 1)).unwrap_err();
    assert!(error.contains("wavefront exceeded maximum"), "{error}");
}
