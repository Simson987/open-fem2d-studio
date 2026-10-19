//! Independent equivalent-nodal-load and equilibrium reference for a global
//! Tri3 traction on a shared Tet4/membrane/bending-frame system.

use openaec_native_fem::mixed3d::{
    solve, Membrane3dElement, Membrane3dSurfaceTraction, Mixed3dBackend, Mixed3dRequest,
};
use serde_json::Value;

const TRACTION: [f64; 3] = [2.0, -3.0, 4.0];

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("reference fixture");
    fixture["input"]["backend"] = serde_json::to_value(backend).unwrap();
    let mut request: Mixed3dRequest = serde_json::from_value(fixture["input"].take()).unwrap();
    request.membranes.push(Membrane3dElement {
        nodes: [1, 2, 3],
        e_mpa: 30_000.0,
        nu: 0.2,
        thickness_m: 0.06,
    });
    request
}

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.1e}"
    );
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[test]
fn inclined_membrane_traction_matches_hand_integrated_nodal_load_on_all_backends() {
    // Triangle corners (1,0,0), (0,1,0), (0,0,1) have area sqrt(3)/2.
    // Constant shape functions integrate to A/3 at each corner.
    let area = 3.0_f64.sqrt() / 2.0;
    let corner_force = TRACTION.map(|value| value * area / 3.0);
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let mut distributed = model(backend);
        distributed
            .membrane_tractions
            .push(Membrane3dSurfaceTraction {
                element: 0,
                traction_kn_per_m2: TRACTION,
            });
        let mut nodal = model(backend);
        for node in [1, 2, 3] {
            for axis in 0..3 {
                nodal.loads_kn[node][axis] += corner_force[axis];
            }
        }
        let actual = solve(&distributed).unwrap();
        let reference = solve(&nodal).unwrap();
        for node in 0..distributed.mesh.nodes.len() {
            for axis in 0..3 {
                near(
                    actual.nodal_displacements_m[node][axis],
                    reference.nodal_displacements_m[node][axis],
                    1e-11,
                    "displacement",
                );
                near(
                    actual.nodal_reactions_kn[node][axis],
                    reference.nodal_reactions_kn[node][axis],
                    1e-7,
                    "reaction",
                );
            }
        }
        for end in 0..2 {
            for component in 0..6 {
                near(
                    actual.frame_end_forces_local[0][end][component],
                    reference.frame_end_forces_local[0][end][component],
                    1e-7,
                    "frame end force",
                );
            }
        }
        // Sum the support force and moment about the global origin. The
        // applied frame-tip force is +10 kN in z at (2,0,0).
        let mut force = [0.0; 3];
        let mut moment = [0.0; 3];
        for (node, point) in distributed.mesh.nodes.iter().enumerate() {
            let reaction = actual.nodal_reactions_kn[node];
            let lever_moment = cross(*point, reaction);
            for axis in 0..3 {
                force[axis] += reaction[axis];
                moment[axis] += lever_moment[axis]
                    + actual.nodal_moment_reactions_knm[node].unwrap_or([0.0; 3])[axis];
            }
        }
        let traction_resultant = TRACTION.map(|value| value * area);
        let centroid = [1.0 / 3.0; 3];
        let traction_moment = cross(centroid, traction_resultant);
        for axis in 0..3 {
            let applied_force = traction_resultant[axis] + if axis == 2 { 10.0 } else { 0.0 };
            let applied_moment = traction_moment[axis] + if axis == 1 { -20.0 } else { 0.0 };
            near(force[axis] + applied_force, 0.0, 1e-7, "global force");
            near(moment[axis] + applied_moment, 0.0, 1e-7, "global moment");
        }
        assert!(actual.relative_residual < 1e-8);
    }
}

#[test]
fn membrane_traction_rejects_invalid_index_vector_and_accumulation() {
    let mut request = model(Mixed3dBackend::Dense);
    request.membrane_tractions.push(Membrane3dSurfaceTraction {
        element: 1,
        traction_kn_per_m2: TRACTION,
    });
    assert!(solve(&request).unwrap_err().contains("element index"));
    request.membrane_tractions[0].element = 0;
    request.membrane_tractions[0].traction_kn_per_m2[0] = f64::NAN;
    assert!(solve(&request).unwrap_err().contains("non-finite traction"));
    request.membrane_tractions[0].traction_kn_per_m2 = [f64::MAX; 3];
    for _ in 0..3 {
        request
            .membrane_tractions
            .push(request.membrane_tractions[0]);
    }
    assert!(solve(&request)
        .unwrap_err()
        .contains("accumulated nodal force overflow"));
}
