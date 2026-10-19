//! Independent two-part reference for per-Tet4 J2 steel properties.
//!
//! Three equal layers under axial traction and restrained transverse strain
//! form a series bar while the axial stress is elastic: sigma_x = F/A and
//! u(x_i) = sum_j (sigma_x/E_j) L_j. A separate prescribed simple-shear patch
//! crosses yield in every layer. Its reference is the scalar J2 consistency
//! equation p = (sqrt(3) G gamma - sigma_y)/(3G+H), followed by an elastic
//! reversal. Neither reference uses the FEM tangent, assembly, or stress output.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{
    solve, J2TetFaceTraction, J2TetOptions, J2TetRequest, J2TetTarget,
};

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn layer(x: f64) -> usize {
    ((3.0 * x).floor() as usize).min(2)
}

fn steel_layers() -> [J2Steel; 3] {
    [
        J2Steel::new(100_000.0, 0.0, 180.0, 1_000.0).unwrap(),
        J2Steel::new(160_000.0, 0.0, 240.0, 2_500.0).unwrap(),
        J2Steel::new(220_000.0, 0.0, 300.0, 4_000.0).unwrap(),
    ]
}

fn element_steels(mesh: &Mesh, layers: &[J2Steel; 3]) -> Vec<J2Steel> {
    mesh.tets
        .iter()
        .map(|tet| {
            let x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            layers[layer(x)]
        })
        .collect()
}

fn right_faces(mesh: &Mesh) -> Vec<(usize, [usize; 3])> {
    let mut faces = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if face.iter().all(|&node| mesh.nodes[node][0] == 1.0) {
                faces.push((element, face));
            }
        }
    }
    assert_eq!(faces.len(), 2);
    faces
}

fn axial_target(mesh: &Mesh, stress_mpa: f64) -> J2TetTarget {
    J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: right_faces(mesh)
            .into_iter()
            .map(|(element, face_nodes)| J2TetFaceTraction {
                element,
                face_nodes,
                traction_kn_per_m2: [1_000.0 * stress_mpa, 0.0, 0.0],
            })
            .collect(),
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
            .map(|point| [Some(gamma * point[1]), Some(0.0), Some(0.0)])
            .collect(),
    }
}

fn request(mesh: &Mesh, steels: Option<Vec<J2Steel>>, targets: Vec<J2TetTarget>) -> J2TetRequest {
    J2TetRequest {
        mesh: mesh.clone(),
        steel: steel_layers()[0],
        element_steels: steels,
        targets,
        options: J2TetOptions::default(),
    }
}

#[test]
fn three_steel_series_bar_has_exact_elastic_traction_response() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = steel_layers();
    let stress_mpa = 95.0; // Below every initial yield stress.
    let result = solve(&request(
        &mesh,
        Some(element_steels(&mesh, &layers)),
        vec![axial_target(&mesh, stress_mpa)],
    ))
    .unwrap();

    let starts = [
        0.0,
        stress_mpa / layers[0].youngs_mpa / 3.0,
        stress_mpa / layers[0].youngs_mpa / 3.0 + stress_mpa / layers[1].youngs_mpa / 3.0,
    ];
    for (node, point) in mesh.nodes.iter().enumerate() {
        let i = layer(point[0]);
        let expected = starts[i] + stress_mpa / layers[i].youngs_mpa * (point[0] - i as f64 / 3.0);
        close(
            result.nodal_displacements_m[node][0],
            expected,
            2e-10,
            "series displacement",
        );
        close(
            result.nodal_displacements_m[node][1],
            0.0,
            1e-13,
            "transverse y",
        );
        close(
            result.nodal_displacements_m[node][2],
            0.0,
            1e-13,
            "transverse z",
        );
        if point[0] != 0.0 {
            close(
                result.nodal_reactions_kn[node][0],
                0.0,
                2e-5,
                "free axial residual",
            );
        }
    }
    for state in &result.element_states {
        close(
            state.stress_mpa[0][0],
            stress_mpa,
            2e-6,
            "elastic axial stress",
        );
        close(
            state.equivalent_plastic_strain,
            0.0,
            1e-13,
            "elastic history",
        );
    }
    let left_reaction: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 0.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(left_reaction, -1_000.0 * stress_mpa, 2e-5, "left reaction");
    close(result.true_free_residual_kn, 0.0, 2e-5, "free residual");
}

#[test]
fn distinct_yield_and_hardening_produce_independent_plastic_histories_after_reversal() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = steel_layers();
    let (peak_gamma, final_gamma) = (0.006, 0.0056);
    let result = solve(&request(
        &mesh,
        Some(element_steels(&mesh, &layers)),
        vec![
            shear_target(&mesh, peak_gamma),
            shear_target(&mesh, final_gamma),
        ],
    ))
    .unwrap();

    for (element, tet) in mesh.tets.iter().enumerate() {
        let x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
        let steel = layers[layer(x)];
        let shear_modulus = steel.youngs_mpa / 2.0; // All layers have nu=0.
        let trial_q = 3.0_f64.sqrt() * shear_modulus * peak_gamma;
        let p = (trial_q - steel.yield_mpa) / (3.0 * shear_modulus + steel.hardening_mpa);
        assert!(p > 0.0);
        let peak_tau = (steel.yield_mpa + steel.hardening_mpa * p) / 3.0_f64.sqrt();
        let final_tau = peak_tau + shear_modulus * (final_gamma - peak_gamma);
        assert!(3.0_f64.sqrt() * final_tau.abs() < steel.yield_mpa + steel.hardening_mpa * p);
        let state = &result.element_states[element];
        close(
            state.equivalent_plastic_strain,
            p,
            2e-9,
            "layer plastic history",
        );
        close(
            state.plastic_strain[0][1],
            3.0_f64.sqrt() * p / 2.0,
            2e-9,
            "plastic shear",
        );
        close(
            state.stress_mpa[0][1],
            final_tau,
            2e-6,
            "reversed shear stress",
        );
        for axis in 0..3 {
            close(state.stress_mpa[axis][axis], 0.0, 2e-6, "normal stress");
        }
    }
    for (node, point) in mesh.nodes.iter().enumerate() {
        close(
            result.nodal_displacements_m[node][0],
            final_gamma * point[1],
            2e-13,
            "shear patch",
        );
    }
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 1);
    close(
        result.true_free_residual_kn,
        0.0,
        1e-10,
        "all-prescribed residual",
    );
}

#[test]
fn uniform_element_steels_match_legacy_and_invalid_lists_are_rejected() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let steel = steel_layers()[0];
    let targets = vec![axial_target(&mesh, 80.0)];
    let legacy = solve(&request(&mesh, None, targets.clone())).unwrap();
    let explicit = solve(&request(
        &mesh,
        Some(vec![steel; mesh.tets.len()]),
        targets.clone(),
    ))
    .unwrap();
    for (a, b) in legacy
        .nodal_displacements_m
        .iter()
        .zip(&explicit.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-12, "legacy displacement parity");
        }
    }
    assert!(solve(&request(&mesh, Some(vec![steel]), targets.clone()))
        .unwrap_err()
        .contains("elementSteels length"));
    let mut invalid = vec![steel; mesh.tets.len()];
    invalid[1].hardening_mpa = -1.0;
    assert!(solve(&request(&mesh, Some(invalid), targets))
        .unwrap_err()
        .contains("elementSteels[1]"));
}
