//! Connected 101-arm 3D frame above 600 DOF. Each arm is a fixed-root
//! Euler-Bernoulli cantilever with independent axial, bending and torsion theory.

use openaec_native_fem::frame3d::{solve, Request};
use serde_json::{json, Value};

const ARMS: usize = 101;
const LENGTH: f64 = 12.0;
const E: f64 = 210_000_000.0; // eMpa converted to kN/m²
const NU: f64 = 0.3;
const AREA: f64 = 0.01;
const IY: f64 = 0.00001;
const IZ: f64 = 0.00002;
const J: f64 = 0.000001;
const TIP: [f64; 6] = [120.0, -10.0, 6.0, 2.0, 3.0, -4.0];

fn arm_length(arm: usize) -> f64 {
    LENGTH * (1.0 + arm as f64 / 1000.0)
}

fn request(backend: &str, front_limit: usize) -> Request {
    let mut nodes = vec![json!({"id": 1, "x": 0.0, "y": 0.0, "z": 0.0})];
    let mut members = Vec::<Value>::with_capacity(ARMS);
    let mut loads = Vec::<Value>::with_capacity(ARMS);
    for arm in 0..ARMS {
        let tip = arm + 2;
        nodes.push(json!({"id": tip, "x": arm_length(arm), "y": 0.0, "z": 0.0}));
        members.push(json!({"id": arm + 1, "startNodeId": 1,
            "endNodeId": tip, "materialId": 1, "sectionId": 1}));
        loads.push(json!({"nodeId": tip,
            "fx": TIP[0], "fy": TIP[1], "fz": TIP[2],
            "mx": TIP[3], "my": TIP[4], "mz": TIP[5]}));
    }
    serde_json::from_value(json!({
        "schemaVersion": 1,
        "analysis": "linear",
        "linearBackend": backend,
        "frontalMaxFrontDofs": front_limit,
        "nodes": nodes,
        "materials": [{"id": 1, "eMpa": E / 1000.0, "nu": NU}],
        "sections": [{"id": 1, "areaM2": AREA, "iyM4": IY,
            "izM4": IZ, "torsionJM4": J}],
        "members": members,
        "supports": [{"nodeId": 1, "ux": true, "uy": true, "uz": true,
            "rx": true, "ry": true, "rz": true}],
        "nodalLoads": loads
    }))
    .unwrap()
}

fn close(label: &str, actual: f64, expected: f64, scale: f64, relative: f64) {
    let tolerance = relative * scale.max(expected.abs());
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: {actual:.12e} != {expected:.12e} (tolerance {tolerance:.3e})"
    );
}

fn tip_displacement(length: f64) -> [f64; 6] {
    let [fx, fy, fz, mx, my, mz] = TIP;
    let g = E / (2.0 * (1.0 + NU));
    [
        fx * length / (E * AREA),
        fy * length.powi(3) / (3.0 * E * IZ) + mz * length.powi(2) / (2.0 * E * IZ),
        fz * length.powi(3) / (3.0 * E * IY) - my * length.powi(2) / (2.0 * E * IY),
        mx * length / (g * J),
        -fz * length.powi(2) / (2.0 * E * IY) + my * length / (E * IY),
        fy * length.powi(2) / (2.0 * E * IZ) + mz * length / (E * IZ),
    ]
}

fn member_end_forces(length: f64) -> [f64; 12] {
    let [fx, fy, fz, mx, my, mz] = TIP;
    [
        -fx,
        -fy,
        -fz,
        -mx,
        -my + length * fz,
        -mz - length * fy,
        fx,
        fy,
        fz,
        mx,
        my,
        mz,
    ]
}

#[test]
fn frontal_frame3d_above_600_dof_matches_existing_and_beam_theory() {
    assert_eq!(6 * (ARMS + 1), 612);
    // The fixed root leaves only one arm's six tip DOFs in the active front.
    let frontal = solve(&request("frontalWave", 6)).unwrap();
    let existing = solve(&request("existing", 6)).unwrap();
    assert_eq!(frontal.nodes.len(), ARMS + 1);
    assert_eq!(frontal.members.len(), ARMS);
    assert!(frontal.equilibrium_residual < 1e-8);
    assert!(existing.equilibrium_residual < 1e-8);

    let length_sum: f64 = (0..ARMS).map(arm_length).sum();
    let root_expected = [
        -(ARMS as f64) * TIP[0],
        -(ARMS as f64) * TIP[1],
        -(ARMS as f64) * TIP[2],
        -(ARMS as f64) * TIP[3],
        -(ARMS as f64) * TIP[4] + length_sum * TIP[2],
        -(ARMS as f64) * TIP[5] - length_sum * TIP[1],
    ];
    for axis in 0..6 {
        close(
            "root displacement",
            frontal.nodes[0].displacement[axis],
            0.0,
            1.0,
            1e-12,
        );
        close(
            "existing root displacement",
            existing.nodes[0].displacement[axis],
            0.0,
            1.0,
            1e-12,
        );
        close(
            "root reaction",
            frontal.nodes[0].reaction[axis],
            root_expected[axis],
            root_expected[axis].abs().max(1.0),
            2e-6,
        );
        close(
            "root reaction parity",
            frontal.nodes[0].reaction[axis],
            existing.nodes[0].reaction[axis],
            root_expected[axis].abs().max(1.0),
            2e-6,
        );
    }

    for arm in 0..ARMS {
        let length = arm_length(arm);
        let expected_u = tip_displacement(length);
        let expected_f = member_end_forces(length);
        let node_index = arm + 1;
        let a_node = &frontal.nodes[node_index];
        let b_node = &existing.nodes[node_index];
        assert_eq!(a_node.node_id, arm + 2);
        assert_eq!(b_node.node_id, arm + 2);
        for axis in 0..6 {
            let label = format!("arm {} tip DOF {axis}", arm + 1);
            close(
                &label,
                a_node.displacement[axis],
                expected_u[axis],
                expected_u[axis].abs().max(1e-8),
                2e-6,
            );
            close(
                &label,
                a_node.displacement[axis],
                b_node.displacement[axis],
                expected_u[axis].abs().max(1e-8),
                2e-6,
            );
            close(&label, a_node.reaction[axis], 0.0, 1.0, 2e-6);
            close(
                &label,
                a_node.reaction[axis],
                b_node.reaction[axis],
                1.0,
                2e-6,
            );
        }

        let a_member = &frontal.members[arm];
        let b_member = &existing.members[arm];
        assert_eq!(a_member.member_id, arm + 1);
        assert_eq!(b_member.member_id, arm + 1);
        let force_scale = [
            TIP[0].abs(),
            TIP[1].abs(),
            TIP[2].abs(),
            TIP[3].abs(),
            TIP[4].abs() + length * TIP[2].abs(),
            TIP[5].abs() + length * TIP[1].abs(),
        ];
        for axis in 0..12 {
            let label = format!("arm {} local force {axis}", arm + 1);
            let scale = force_scale[axis % 6].max(1.0);
            close(
                &label,
                a_member.local_end_forces[axis],
                expected_f[axis],
                scale,
                2e-6,
            );
            close(
                &label,
                a_member.local_end_forces[axis],
                b_member.local_end_forces[axis],
                scale,
                2e-6,
            );
        }
    }

    // Check the actual global force and moment resultants about the fixed node.
    let root = &frontal.nodes[0].reaction;
    for axis in 0..3 {
        close(
            "global force balance",
            root[axis] + (ARMS as f64) * TIP[axis],
            0.0,
            (ARMS as f64) * TIP[axis].abs(),
            2e-8,
        );
    }
    close(
        "global torsion balance",
        root[3] + (ARMS as f64) * TIP[3],
        0.0,
        (ARMS as f64) * TIP[3].abs(),
        2e-8,
    );
    close(
        "global y moment balance",
        root[4] + (ARMS as f64) * TIP[4] - length_sum * TIP[2],
        0.0,
        length_sum * TIP[2].abs(),
        2e-8,
    );
    close(
        "global z moment balance",
        root[5] + (ARMS as f64) * TIP[5] + length_sum * TIP[1],
        0.0,
        length_sum * TIP[1].abs(),
        2e-8,
    );

    let overflow = solve(&request("frontalWave", 5)).unwrap_err();
    assert!(overflow.contains("wavefront exceeded maximum of 5 free DOFs"));
}
