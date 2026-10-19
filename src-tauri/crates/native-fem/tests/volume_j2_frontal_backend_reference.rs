//! Independent checks of the J2 Tet4 frontal wavefront against sparse direct.
//!
//! The series bar has a closed-form elastic displacement in each steel layer.
//! The shear coupon uses the scalar J2 consistency equation and elastic
//! unloading. These references do not use assembled FEM matrices or tangents.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{
    solve, J2TetFaceTraction, J2TetLinearBackend, J2TetOptions, J2TetRequest, J2TetTarget,
};

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn steels() -> [J2Steel; 3] {
    [
        J2Steel::new(100_000.0, 0.0, 180.0, 1_000.0).unwrap(),
        J2Steel::new(160_000.0, 0.0, 240.0, 2_500.0).unwrap(),
        J2Steel::new(220_000.0, 0.0, 300.0, 4_000.0).unwrap(),
    ]
}

fn layer(x: f64) -> usize {
    ((3.0 * x).floor() as usize).min(2)
}

fn request(mesh: &Mesh, targets: Vec<J2TetTarget>, backend: J2TetLinearBackend) -> J2TetRequest {
    let layers = steels();
    let element_steels = mesh
        .tets
        .iter()
        .map(|tet| {
            let center_x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            layers[layer(center_x)]
        })
        .collect();
    let mut options = J2TetOptions::default();
    options.linear_backend = backend;
    J2TetRequest {
        mesh: mesh.clone(),
        steel: layers[0],
        element_steels: Some(element_steels),
        targets,
        options,
    }
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
            .enumerate()
            .map(|(node, point)| {
                // Leave one otherwise unloaded transverse DOF free so both
                // Newton backends actually factor a tangent in this patch.
                [
                    Some(gamma * point[1]),
                    Some(0.0),
                    if node == 5 { None } else { Some(0.0) },
                ]
            })
            .collect(),
    }
}

#[test]
fn frontal_and_sparse_match_independent_heterogeneous_series_bar() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = steels();
    let stress = 95.0;
    let mut solutions = Vec::new();
    for backend in [
        J2TetLinearBackend::SparseDirect,
        J2TetLinearBackend::FrontalWave,
    ] {
        let result = solve(&request(&mesh, vec![axial_target(&mesh, stress)], backend)).unwrap();
        assert_eq!(result.linear_backend_used, backend);
        let layer_start = [
            0.0,
            stress / layers[0].youngs_mpa / 3.0,
            stress / layers[0].youngs_mpa / 3.0 + stress / layers[1].youngs_mpa / 3.0,
        ];
        for (node, point) in mesh.nodes.iter().enumerate() {
            let i = layer(point[0]);
            let expected =
                layer_start[i] + stress / layers[i].youngs_mpa * (point[0] - i as f64 / 3.0);
            near(
                result.nodal_displacements_m[node][0],
                expected,
                2e-10,
                "series u_x",
            );
        }
        for state in &result.element_states {
            near(state.stress_mpa[0][0], stress, 2e-6, "series sigma_x");
            near(
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
        near(left_reaction, -1_000.0 * stress, 2e-5, "support reaction");
        near(
            result.true_free_residual_kn,
            0.0,
            2e-5,
            "true free residual",
        );
        solutions.push(result);
    }
    for (a, b) in solutions[0]
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(solutions[1].nodal_displacements_m.iter().flatten())
    {
        near(*a, *b, 2e-10, "frontal/sparse displacement");
    }
}

#[test]
fn frontal_and_sparse_match_independent_plastic_shear_and_unloading() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = steels();
    let (peak_gamma, final_gamma) = (0.006, 0.0056);
    for backend in [
        J2TetLinearBackend::SparseDirect,
        J2TetLinearBackend::FrontalWave,
    ] {
        let result = solve(&request(
            &mesh,
            vec![
                shear_target(&mesh, peak_gamma),
                shear_target(&mesh, final_gamma),
            ],
            backend,
        ))
        .unwrap();
        assert_eq!(result.linear_backend_used, backend);
        for (element, tet) in mesh.tets.iter().enumerate() {
            let center_x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            let steel = layers[layer(center_x)];
            let g = steel.youngs_mpa / 2.0;
            let p = (3.0_f64.sqrt() * g * peak_gamma - steel.yield_mpa)
                / (3.0 * g + steel.hardening_mpa);
            let peak_tau = (steel.yield_mpa + steel.hardening_mpa * p) / 3.0_f64.sqrt();
            let expected_tau = peak_tau + g * (final_gamma - peak_gamma);
            near(
                result.element_states[element].equivalent_plastic_strain,
                p,
                2e-9,
                "plastic history",
            );
            near(
                result.element_states[element].stress_mpa[0][1],
                expected_tau,
                2e-6,
                "unloaded shear stress",
            );
        }
        near(result.nodal_displacements_m[5][2], 0.0, 2e-11, "free z");
        near(
            result.true_free_residual_kn,
            0.0,
            1e-8,
            "shear free residual",
        );
    }
}

#[test]
fn frontal_wavefront_limit_is_reported_and_default_backend_is_sparse() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    assert_eq!(
        J2TetOptions::default().linear_backend,
        J2TetLinearBackend::SparseDirect
    );
    let mut request = request(
        &mesh,
        vec![axial_target(&mesh, 95.0)],
        J2TetLinearBackend::FrontalWave,
    );
    request.options.max_front_dofs = 1;
    let error = solve(&request).unwrap_err();
    assert!(error.contains("wavefront exceeded"), "{error}");
}
