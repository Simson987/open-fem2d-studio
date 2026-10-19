//! Independent equivalent-nodal-load reference for a shared Hex8/Tet4/truss
//! model. The reference uses only unit-cube/triangle volumes and areas, not
//! element stiffness matrices or the production load integration functions.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::mixed3d::Mixed3dResult;
use serde_json::{json, Value};

const BACKENDS: [&str; 5] = [
    "dense",
    "sparseDirect",
    "sparsePcg",
    "matrixFreePcg",
    "frontalWave",
];

fn close(actual: f64, expected: f64, tolerance: f64, context: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{context}: actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
    );
}

fn add(target: &mut [f64; 3], increment: [f64; 3]) {
    for axis in 0..3 {
        target[axis] += increment[axis];
    }
}

/// Hand-integrated consistent loads. The Hex8 is a unit cube, hence V=1 and
/// its +x face A=1. Tet4 [1,2,6,8] has base A=1/2 and height 1, hence V=1/6.
/// Constant body force divides by eight/four nodes; constant face traction
/// divides by four/three nodes, respectively.
fn manual_nodal_loads() -> Vec<[f64; 3]> {
    let mut loads = vec![[0.0; 3]; 9];
    for node in 0..8 {
        add(&mut loads[node], [1.0, -0.5, 0.25]); // [8,-4,2] * 1/8
    }
    for node in [1, 2, 6, 8] {
        add(&mut loads[node], [0.25, 0.125, -0.375]); // [6,3,-9] * (1/6)/4
    }
    for node in [1, 2, 6, 5] {
        add(&mut loads[node], [3.0, -2.0, 1.0]); // [12,-8,4] * 1/4
    }
    for node in [1, 2, 6] {
        add(&mut loads[node], [1.5, 1.0, -0.5]); // [9,6,-3] * (1/2)/3
    }
    add(&mut loads[8], [5.0, -2.0, 1.0]); // separate ordinary nodal load
    loads
}

fn input(backend: &str, threads: usize, distributed: bool, all_fixed: bool) -> Value {
    let mut value: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-hex8-tet4-truss.json")).unwrap();
    let model = &mut value["input"];
    // Retain both original Tet4 cells, Hex8, and the truss; both volume
    // families are loaded while all three stiffness families share DOFs.
    model["backend"] = backend.into();
    model["threads"] = threads.into();
    let mut nodal_loads = if distributed {
        let mut ordinary = vec![[0.0; 3]; 9];
        ordinary[8] = [5.0, -2.0, 1.0];
        ordinary
    } else {
        manual_nodal_loads()
    };
    model["loadsKn"] = json!(std::mem::take(&mut nodal_loads));
    if distributed {
        model["tetBodyForces"] = json!([{ "element": 0, "forceKnPerM3": [6.0, 3.0, -9.0] }]);
        model["tetFaceTractions"] =
            json!([{ "element": 0, "nodes": [1, 2, 6], "tractionKnPerM2": [9.0, 6.0, -3.0] }]);
        model["hexBodyForces"] = json!([{ "element": 0, "forceKnPerM3": [8.0, -4.0, 2.0] }]);
        model["hexFaceTractions"] = json!([{ "element": 0, "faceNodes": [1, 2, 6, 5], "tractionKnPerM2": [12.0, -8.0, 4.0] }]);
    }
    if all_fixed {
        model["prescribedM"] = json!(vec![[Some(0.0); 3]; 9]);
    }
    value
}

fn run(value: Value) -> Result<Mixed3dResult, String> {
    let request: NativeFemRequest = serde_json::from_value(value).map_err(|e| e.to_string())?;
    match solve_native_fem(request)? {
        NativeFemResult::Mixed3d(result) => Ok(result),
        _ => Err("mixed3d dispatched to another solver".into()),
    }
}

fn compare(a: &Mixed3dResult, b: &Mixed3dResult, backend: &str) {
    for (i, (a, b)) in a
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(b.nodal_displacements_m.iter().flatten())
        .enumerate()
    {
        close(*a, *b, 2e-10, &format!("{backend} displacement {i}"));
    }
    for (i, (a, b)) in a
        .nodal_reactions_kn
        .iter()
        .flatten()
        .zip(b.nodal_reactions_kn.iter().flatten())
        .enumerate()
    {
        close(*a, *b, 2e-6, &format!("{backend} reaction {i}"));
    }
    for (i, (a, b)) in a
        .truss_axial_force_kn
        .iter()
        .zip(&b.truss_axial_force_kn)
        .enumerate()
    {
        close(*a, *b, 2e-6, &format!("{backend} truss force {i}"));
    }
    assert!(a.relative_residual < 1e-8, "{backend} residual");
}

#[test]
fn mixed_distributed_loads_equal_hand_integrated_nodal_loads_on_every_backend() {
    let expected_loads = manual_nodal_loads();
    let expected_result = run(input("dense", 1, false, false)).unwrap();
    assert!(expected_result.nodal_displacements_m[8][0] > 0.0);
    assert!(expected_result.truss_axial_force_kn[0].abs() > 1e-6);
    assert!(expected_result.hex_gauss_stress_mpa[0]
        .iter()
        .flatten()
        .any(|v| v.abs() > 1e-6));
    for backend in BACKENDS {
        let thread_counts: &[usize] = if backend == "matrixFreePcg" {
            &[1, 4]
        } else {
            &[1]
        };
        for &threads in thread_counts {
            let actual = run(input(backend, threads, true, false))
                .unwrap_or_else(|e| panic!("{backend}/{threads}: {e}"));
            compare(&actual, &expected_result, backend);
            for axis in 0..3 {
                let applied: f64 = expected_loads.iter().map(|load| load[axis]).sum();
                let reaction: f64 = actual.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
                close(
                    reaction,
                    -applied,
                    2e-6,
                    &format!("{backend}/{threads} global force axis {axis}"),
                );
            }
        }
    }
}

#[test]
fn fully_fixed_reactions_expose_each_consistent_nodal_force() {
    let result = run(input("dense", 1, true, true)).unwrap();
    let expected = manual_nodal_loads();
    for (node, (reaction, force)) in result
        .nodal_reactions_kn
        .iter()
        .zip(expected.iter())
        .enumerate()
    {
        for axis in 0..3 {
            close(
                reaction[axis],
                -force[axis],
                1e-10,
                &format!("fixed reaction node {node} axis {axis}"),
            );
        }
    }
}

#[test]
fn malformed_tet_and_hex_faces_are_rejected() {
    let mut bad_tet = input("dense", 1, true, false);
    bad_tet["input"]["tetFaceTractions"][0]["nodes"] = json!([0, 1, 2]);
    assert!(run(bad_tet).is_err(), "foreign Tet4 node must be rejected");

    let mut bad_hex = input("dense", 1, true, false);
    bad_hex["input"]["hexFaceTractions"][0]["faceNodes"] = json!([0, 1, 2, 4]);
    assert!(
        run(bad_hex).is_err(),
        "non-face Hex8 nodes must be rejected"
    );

    let mut out_of_range = input("dense", 1, true, false);
    out_of_range["input"]["tetBodyForces"][0]["element"] = json!(999);
    assert!(
        run(out_of_range).is_err(),
        "unknown Tet4 element must be rejected"
    );
}
