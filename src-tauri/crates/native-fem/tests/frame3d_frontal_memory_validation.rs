//! A narrow-front bending frame above the reference Matrix 20,000-DOF limit.

use openaec_native_fem::frame3d::{solve, Request};
use serde_json::{json, Value};

#[test]
fn frontal_solves_more_than_twenty_thousand_global_dofs_without_global_matrix() {
    const ARMS: usize = 3334;
    const LENGTH: f64 = 2.0;
    const TIP: [f64; 6] = [10.0, -3.0, 4.0, 2.0, 1.5, -2.0];
    const E_MPA: f64 = 210_000.0;
    const AREA: f64 = 0.01;
    const IY: f64 = 0.00001;
    const IZ: f64 = 0.00002;
    const J: f64 = 0.000001;
    const NU: f64 = 0.3;
    let mut nodes = vec![json!({"id": 1, "x": 0.0, "y": 0.0, "z": 0.0})];
    let mut members = Vec::<Value>::with_capacity(ARMS);
    let mut loads = Vec::<Value>::with_capacity(ARMS);
    for arm in 0..ARMS {
        let tip = arm + 2;
        nodes.push(json!({"id": tip, "x": LENGTH, "y": 0.0, "z": 0.0}));
        members.push(json!({"id": arm + 1, "startNodeId": 1,
            "endNodeId": tip, "materialId": 1, "sectionId": 1}));
        loads.push(json!({"nodeId": tip, "fx": TIP[0], "fy": TIP[1],
            "fz": TIP[2], "mx": TIP[3], "my": TIP[4], "mz": TIP[5]}));
    }
    let request: Request = serde_json::from_value(json!({
        "schemaVersion": 1,
        "analysis": "linear",
        "linearBackend": "frontalWave",
        "frontalMaxFrontDofs": 6,
        "nodes": nodes,
        "materials": [{"id": 1, "eMpa": E_MPA, "nu": NU}],
        "sections": [{"id": 1, "areaM2": AREA, "iyM4": IY,
            "izM4": IZ, "torsionJM4": J}],
        "members": members,
        "supports": [{"nodeId": 1, "ux": true, "uy": true, "uz": true,
            "rx": true, "ry": true, "rz": true}],
        "nodalLoads": loads
    }))
    .unwrap();
    assert_eq!(6 * (ARMS + 1), 20_010);
    let result = solve(&request).unwrap();
    let e = E_MPA * 1000.0;
    let g = e / (2.0 * (1.0 + NU));
    let [fx, fy, fz, mx, my, mz] = TIP;
    let expected_displacement = [
        fx * LENGTH / (e * AREA),
        fy * LENGTH.powi(3) / (3.0 * e * IZ) + mz * LENGTH.powi(2) / (2.0 * e * IZ),
        fz * LENGTH.powi(3) / (3.0 * e * IY) - my * LENGTH.powi(2) / (2.0 * e * IY),
        mx * LENGTH / (g * J),
        -fz * LENGTH.powi(2) / (2.0 * e * IY) + my * LENGTH / (e * IY),
        fy * LENGTH.powi(2) / (2.0 * e * IZ) + mz * LENGTH / (e * IZ),
    ];
    let expected_root_reaction = [
        -(ARMS as f64) * fx,
        -(ARMS as f64) * fy,
        -(ARMS as f64) * fz,
        -(ARMS as f64) * mx,
        (ARMS as f64) * (-my + LENGTH * fz),
        (ARMS as f64) * (-mz - LENGTH * fy),
    ];
    let expected_member_end_forces = [
        -fx,
        -fy,
        -fz,
        -mx,
        -my + LENGTH * fz,
        -mz - LENGTH * fy,
        fx,
        fy,
        fz,
        mx,
        my,
        mz,
    ];
    assert_eq!(result.nodes.len(), ARMS + 1);
    assert_eq!(result.members.len(), ARMS);
    assert!(result.equilibrium_residual < 1e-8);
    let root = &result.nodes[0];
    let mut max_tip_error = 0.0_f64;
    let mut max_member_error = 0.0_f64;
    let mut max_root_error = 0.0_f64;
    for axis in 0..6 {
        let error = (root.reaction[axis] - expected_root_reaction[axis]).abs();
        max_root_error = max_root_error.max(error);
        assert!(error < 1e-5);
    }
    for node in result.nodes.iter().skip(1) {
        for axis in 0..6 {
            let error = (node.displacement[axis] - expected_displacement[axis]).abs();
            max_tip_error = max_tip_error.max(error);
            assert!(
                error < 1e-10,
                "node {} DOF {axis}: {} != {}",
                node.node_id,
                node.displacement[axis],
                expected_displacement[axis]
            );
        }
        assert!(node.reaction.iter().all(|value| value.abs() < 1e-7));
    }
    for member in &result.members {
        for axis in 0..12 {
            let error = (member.local_end_forces[axis] - expected_member_end_forces[axis]).abs();
            max_member_error = max_member_error.max(error);
            assert!(
                error < 1e-7,
                "member {} end force {axis}: {} != {}",
                member.member_id,
                member.local_end_forces[axis],
                expected_member_end_forces[axis]
            );
        }
    }
    eprintln!(
        "frame3d: {} members, {} nodes, {} DOF; equilibrium={:.3e}, max tip error={:.3e} m/rad, max member end-force error={:.3e} kN/kNm, max root reaction error={:.3e} kN/kNm",
        result.members.len(),
        result.nodes.len(),
        6 * result.nodes.len(),
        result.equilibrium_residual,
        max_tip_error,
        max_member_error,
        max_root_error,
    );
}
