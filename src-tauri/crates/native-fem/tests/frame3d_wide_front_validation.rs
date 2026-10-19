//! A small spatial frame whose connected loops require a genuine wavefront.
//! The independent check is global force and moment balance about the origin.

use openaec_native_fem::frame3d::{solve, Request};
use serde_json::{json, Value};

const LOADS: [(usize, [f64; 6]); 3] = [
    (9, [18.0, -7.0, 4.0, 1.2, -2.1, 0.7]),
    (11, [-3.0, 5.0, -8.0, -0.6, 1.4, -1.1]),
    (12, [7.0, -9.0, 3.0, 0.9, 0.8, -0.5]),
];

fn position(id: usize) -> [f64; 3] {
    let index = id - 1;
    [
        (index / 4) as f64 * 2.0,
        ((index / 2) % 2) as f64 * 1.7,
        (index % 2) as f64 * 1.3,
    ]
}

fn request(backend: &str, front_limit: usize) -> Request {
    let nodes: Vec<Value> = (1..=12)
        .map(|id| {
            let [x, y, z] = position(id);
            json!({"id": id, "x": x, "y": y, "z": z})
        })
        .collect();
    let mut members = Vec::new();
    for ix in 0..3 {
        for iy in 0..2 {
            for iz in 0..2 {
                let id = ix * 4 + iy * 2 + iz + 1;
                for neighbor in [
                    (ix < 2).then_some(id + 4),
                    (iy < 1).then_some(id + 2),
                    (iz < 1).then_some(id + 1),
                ]
                .into_iter()
                .flatten()
                {
                    members.push(json!({"id": members.len() + 1,
                        "startNodeId": id, "endNodeId": neighbor,
                        "materialId": 1, "sectionId": 1}));
                }
            }
        }
    }
    assert_eq!(members.len(), 20);
    let supports: Vec<Value> = (1..=4)
        .map(|id| {
            let mut support = json!({"nodeId": id, "ux": true, "uy": true,
                "uz": true, "rx": true, "ry": true, "rz": true});
            if id == 1 {
                support["uxPrescribedM"] = json!(0.0002);
            }
            support
        })
        .chain(std::iter::once(json!({"nodeId": 12,
            "ux": false, "uy": false, "uz": false,
            "rx": false, "ry": false, "rz": false,
            "kyKnPerM": 800.0})))
        .collect();
    let loads: Vec<Value> = LOADS
        .iter()
        .map(|(id, [fx, fy, fz, mx, my, mz])| {
            json!({"nodeId": id, "fx": fx, "fy": fy, "fz": fz,
                "mx": mx, "my": my, "mz": mz})
        })
        .collect();
    serde_json::from_value(json!({
        "schemaVersion": 1, "analysis": "linear", "linearBackend": backend,
        "frontalMaxFrontDofs": front_limit,
        "nodes": nodes,
        "materials": [{"id": 1, "eMpa": 210000.0, "nu": 0.3}],
        "sections": [{"id": 1, "areaM2": 0.012, "iyM4": 0.000018,
            "izM4": 0.000025, "torsionJM4": 0.000009}],
        "members": members, "supports": supports, "nodalLoads": loads
    }))
    .unwrap()
}

fn close(label: &str, actual: f64, expected: f64, scale: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance * scale.max(expected.abs()).max(1.0),
        "{label}: {actual:.12e} != {expected:.12e}"
    );
}

fn accumulate_wrench(result: &openaec_native_fem::frame3d::Result3D) -> [f64; 6] {
    let mut wrench = [0.0; 6];
    for node in &result.nodes {
        let r = position(node.node_id);
        let force = node.reaction;
        for axis in 0..3 {
            wrench[axis] += force[axis];
            wrench[axis + 3] += force[axis + 3];
        }
        wrench[3] += r[1] * force[2] - r[2] * force[1];
        wrench[4] += r[2] * force[0] - r[0] * force[2];
        wrench[5] += r[0] * force[1] - r[1] * force[0];
    }
    for (id, load) in LOADS {
        let r = position(id);
        for axis in 0..6 {
            wrench[axis] += load[axis];
        }
        wrench[3] += r[1] * load[2] - r[2] * load[1];
        wrench[4] += r[2] * load[0] - r[0] * load[2];
        wrench[5] += r[0] * load[1] - r[1] * load[0];
    }
    wrench
}

#[test]
fn connected_spatial_grid_front_matches_existing_and_balances_wrench() {
    // The spatial loops need more than one element's free DOFs at a time.
    let frontal = solve(&request("frontalWave", 30)).unwrap();
    let existing = solve(&request("existing", 30)).unwrap();
    assert_eq!(frontal.nodes.len(), 12);
    assert_eq!(frontal.members.len(), 20);
    assert!(frontal.equilibrium_residual < 1e-8);
    assert!(existing.equilibrium_residual < 1e-8);
    for (actual, reference) in frontal.nodes.iter().zip(&existing.nodes) {
        assert_eq!(actual.node_id, reference.node_id);
        for axis in 0..6 {
            close(
                "displacement",
                actual.displacement[axis],
                reference.displacement[axis],
                1.0,
                1e-8,
            );
            close(
                "reaction",
                actual.reaction[axis],
                reference.reaction[axis],
                100.0,
                1e-7,
            );
        }
    }
    for (actual, reference) in frontal.members.iter().zip(&existing.members) {
        assert_eq!(actual.member_id, reference.member_id);
        for axis in 0..12 {
            close(
                "member end force",
                actual.local_end_forces[axis],
                reference.local_end_forces[axis],
                100.0,
                1e-7,
            );
        }
    }
    close(
        "prescribed settlement",
        frontal.nodes[0].displacement[0],
        0.0002,
        1.0,
        1e-12,
    );
    close(
        "spring force",
        frontal.nodes[11].reaction[1],
        -800.0 * frontal.nodes[11].displacement[1],
        1.0,
        1e-9,
    );
    for (axis, resultant) in accumulate_wrench(&frontal).into_iter().enumerate() {
        close(
            &format!("global resultant {axis}"),
            resultant,
            0.0,
            100.0,
            2e-7,
        );
    }
    let overflow = solve(&request("frontalWave", 24))
        .err()
        .expect("24 free DOFs should be insufficient for this connected spatial grid");
    assert!(
        overflow.contains("wavefront exceeded maximum of 24 free DOFs"),
        "{overflow}"
    );
}
