//! The automatic J2 backend may retry a factor-storage exhaustion with the
//! frontal solver. Independent elastic-series and plastic-shear references
//! verify the resulting equilibrium; a mechanism must still fail.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{
    solve, J2TetFaceTraction, J2TetLinearBackend, J2TetOptions, J2TetRequest, J2TetTarget,
};

fn near(actual: f64, expected: f64, tolerance: f64, name: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{name}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn layer(x: f64) -> usize {
    ((3.0 * x).floor() as usize).min(2)
}

fn steels() -> [J2Steel; 3] {
    [
        J2Steel::new(100_000.0, 0.0, 180.0, 1_000.0).unwrap(),
        J2Steel::new(160_000.0, 0.0, 240.0, 2_500.0).unwrap(),
        J2Steel::new(220_000.0, 0.0, 300.0, 4_000.0).unwrap(),
    ]
}

fn request(mesh: &Mesh, targets: Vec<J2TetTarget>, automatic: bool) -> J2TetRequest {
    let layers = steels();
    let element_steels = mesh
        .tets
        .iter()
        .map(|tet| {
            let x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            layers[layer(x)]
        })
        .collect();
    let mut options = J2TetOptions::default();
    if automatic {
        options.linear_backend = J2TetLinearBackend::Automatic;
        options.max_factor_entries = 1; // Below original free stiffness storage.
    }
    J2TetRequest {
        mesh: mesh.clone(),
        steel: layers[0],
        element_steels: Some(element_steels),
        targets,
        options,
    }
}

fn axial_target(mesh: &Mesh, stress_mpa: f64) -> J2TetTarget {
    let mut face_tractions = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face_nodes in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if face_nodes.iter().all(|&node| mesh.nodes[node][0] == 1.0) {
                face_tractions.push(J2TetFaceTraction {
                    element,
                    face_nodes,
                    traction_kn_per_m2: [1_000.0 * stress_mpa, 0.0, 0.0],
                });
            }
        }
    }
    assert_eq!(face_tractions.len(), 2);
    J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions,
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                [
                    if point[0] == 0.0 { Some(0.0) } else { None },
                    Some(0.0),
                    Some(0.0),
                ]
            })
            .collect(),
    }
}

fn shear_target(mesh: &Mesh, gamma: f64) -> J2TetTarget {
    J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .enumerate()
            .map(|(node, point)| {
                // Three free transverse DOFs force a factorization but the
                // exact affine simple shear has zero stress in their direction.
                [
                    Some(gamma * point[1]),
                    Some(0.0),
                    if [1, 2, 5].contains(&node) {
                        None
                    } else {
                        Some(0.0)
                    },
                ]
            })
            .collect(),
    }
}

#[test]
fn automatic_fallback_recovers_elastic_heterogeneous_bar() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = steels();
    let stress = 95.0;
    let target = axial_target(&mesh, stress);
    let sparse = solve(&request(&mesh, vec![target.clone()], false)).unwrap();
    let automatic = solve(&request(&mesh, vec![target], true)).unwrap();
    assert_eq!(sparse.linear_backend_used, J2TetLinearBackend::SparseDirect);
    assert_eq!(
        automatic.linear_backend_used,
        J2TetLinearBackend::FrontalWave
    );
    assert!(automatic.frontal_fallbacks > 0);
    let serialized = serde_json::to_value(&automatic).unwrap();
    assert_eq!(serialized["linearBackendUsed"], "frontalWave");
    assert!(serialized["frontalFallbacks"].as_u64().unwrap() > 0);

    let start = [
        0.0,
        stress / layers[0].youngs_mpa / 3.0,
        stress / layers[0].youngs_mpa / 3.0 + stress / layers[1].youngs_mpa / 3.0,
    ];
    for (node, point) in mesh.nodes.iter().enumerate() {
        let i = layer(point[0]);
        let expected = start[i] + stress / layers[i].youngs_mpa * (point[0] - i as f64 / 3.0);
        near(
            automatic.nodal_displacements_m[node][0],
            expected,
            2e-10,
            "series u_x",
        );
        near(
            automatic.nodal_displacements_m[node][0],
            sparse.nodal_displacements_m[node][0],
            2e-10,
            "fallback/sparse parity",
        );
    }
    let reaction: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 0.0)
        .map(|(node, _)| automatic.nodal_reactions_kn[node][0])
        .sum();
    near(reaction, -1_000.0 * stress, 2e-5, "left reaction");
    near(automatic.true_free_residual_kn, 0.0, 2e-5, "free residual");
}

#[test]
fn automatic_fallback_preserves_plastic_shear_history_through_unloading() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = steels();
    let (peak_gamma, final_gamma) = (0.006, 0.0056);
    let targets = vec![
        shear_target(&mesh, peak_gamma),
        shear_target(&mesh, final_gamma),
    ];
    let sparse = solve(&request(&mesh, targets.clone(), false)).unwrap();
    let automatic = solve(&request(&mesh, targets, true)).unwrap();
    assert_eq!(
        automatic.linear_backend_used,
        J2TetLinearBackend::FrontalWave
    );
    assert!(automatic.frontal_fallbacks >= 2);
    for (element, tet) in mesh.tets.iter().enumerate() {
        let x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
        let steel = layers[layer(x)];
        let g = steel.youngs_mpa / 2.0;
        let p =
            (3.0_f64.sqrt() * g * peak_gamma - steel.yield_mpa) / (3.0 * g + steel.hardening_mpa);
        let peak_tau = (steel.yield_mpa + steel.hardening_mpa * p) / 3.0_f64.sqrt();
        let expected_tau = peak_tau + g * (final_gamma - peak_gamma);
        near(
            automatic.element_states[element].equivalent_plastic_strain,
            p,
            2e-9,
            "plastic strain",
        );
        near(
            automatic.element_states[element].stress_mpa[0][1],
            expected_tau,
            2e-6,
            "unloaded shear stress",
        );
        near(
            automatic.element_states[element].stress_mpa[0][1],
            sparse.element_states[element].stress_mpa[0][1],
            2e-6,
            "fallback/sparse stress parity",
        );
    }
    near(automatic.true_free_residual_kn, 0.0, 1e-8, "free residual");
}

#[test]
fn automatic_does_not_hide_mechanisms_or_invalid_options() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let mut prescribed = vec![[None; 3]; mesh.nodes.len()];
    prescribed[0] = [Some(0.0); 3];
    let target = J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: prescribed,
    };
    let mut unstable = request(&mesh, vec![target], true);
    unstable.options.min_step_fraction = 0.25;
    let error = solve(&unstable).unwrap_err();
    assert!(
        error.contains("singular") || error.contains("pivot"),
        "{error}"
    );
    unstable.options.max_factor_entries = 0;
    let error = solve(&unstable).unwrap_err();
    assert!(
        error.contains("invalid J2 Tet4 Newton/step options"),
        "{error}"
    );
}
