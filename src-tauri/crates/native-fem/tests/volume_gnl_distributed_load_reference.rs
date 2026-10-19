//! Independent reference checks for nominal distributed loads on GNL Tet4.
//!
//! A unit cube under uniform reference end-face traction has an exact
//! homogeneous uniaxial St Venant–Kirchhoff state when nu=0 and transverse
//! displacements are restrained. The other check integrates constant body
//! force and face traction by hand on a fully fixed unit tetrahedron.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetBodyForce, GnlTetFaceTraction, GnlTetOptions, GnlTetRequest, GnlTetResult,
    GnlTetTarget,
};

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn nominal_stress_mpa(young_mpa: f64, stretch: f64) -> f64 {
    // S_xx = E * (F² - 1)/2 and P_xx = F * S_xx.
    0.5 * young_mpa * (stretch.powi(3) - stretch)
}

fn reference_end_faces(mesh: &Mesh) -> Vec<(usize, [usize; 3], f64)> {
    let mut result = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if !face.iter().all(|&node| mesh.nodes[node][0] == 1.0) {
                continue;
            }
            let p = mesh.nodes[face[0]];
            let q = mesh.nodes[face[1]];
            let r = mesh.nodes[face[2]];
            let a = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
            let b = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
            let cross = [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ];
            let area = 0.5 * cross.iter().map(|x| x * x).sum::<f64>().sqrt();
            result.push((element, face, area));
        }
    }
    result
}

fn traction_target(mesh: &Mesh, stress_mpa: f64) -> GnlTetTarget {
    let traction_kn_per_m2 = 1_000.0 * stress_mpa;
    GnlTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: reference_end_faces(mesh)
            .into_iter()
            .map(|(element, face_nodes, _)| GnlTetFaceTraction {
                element,
                face_nodes,
                traction_kn_per_m2: [traction_kn_per_m2, 0.0, 0.0],
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

fn check_uniaxial_state(mesh: &Mesh, result: &GnlTetResult, young_mpa: f64, stretch: f64) {
    let nominal_stress = nominal_stress_mpa(young_mpa, stretch);
    for (node, point) in mesh.nodes.iter().enumerate() {
        close(
            result.nodal_displacements_m[node][0],
            (stretch - 1.0) * point[0],
            2e-10,
            &format!("node {node} axial displacement"),
        );
        for axis in 1..3 {
            close(
                result.nodal_displacements_m[node][axis],
                0.0,
                1e-12,
                &format!("node {node} transverse displacement {axis}"),
            );
        }
        if point[0] == 1.0 {
            close(
                result.nodal_reactions_kn[node][0],
                0.0,
                1e-5,
                &format!("free end node {node} reaction"),
            );
        }
    }
    for (element, green) in result.element_green_strain.iter().enumerate() {
        close(
            green[0][0],
            0.5 * (stretch * stretch - 1.0),
            2e-9,
            &format!("element {element} Green strain"),
        );
        close(
            result.element_first_piola_mpa[element][0][0],
            nominal_stress,
            1e-5,
            &format!("element {element} nominal stress"),
        );
        for row in 0..3 {
            for col in 0..3 {
                if row != 0 || col != 0 {
                    close(
                        green[row][col],
                        0.0,
                        2e-9,
                        &format!("element {element} Green strain {row}{col}"),
                    );
                    close(
                        result.element_first_piola_mpa[element][row][col],
                        0.0,
                        1e-5,
                        &format!("element {element} nominal stress {row}{col}"),
                    );
                }
            }
        }
    }
    let left_reaction: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 0.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(
        left_reaction,
        -1_000.0 * nominal_stress,
        1e-5,
        "supported face resultant",
    );
    close(
        result.true_free_residual_kn,
        0.0,
        1e-5,
        "true free residual",
    );
}

#[test]
fn nominal_end_traction_gives_analytic_finite_stretch_through_reversal_and_release() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let faces = reference_end_faces(&mesh);
    assert_eq!(faces.len(), 2);
    close(
        faces.iter().map(|(_, _, area)| area).sum(),
        1.0,
        1e-12,
        "loaded reference face area",
    );
    let young_mpa = 100.0;
    let stretches = [1.08, 0.96, 1.0];
    for prefix in 1..=stretches.len() {
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: young_mpa,
            poisson: 0.0,
            element_materials: None,
            element_energy_beta: None,
            targets: stretches[..prefix]
                .iter()
                .map(|&stretch| traction_target(&mesh, nominal_stress_mpa(young_mpa, stretch)))
                .collect(),
            options: GnlTetOptions::default(),
        })
        .unwrap();
        check_uniaxial_state(&mesh, &result, young_mpa, stretches[prefix - 1]);
        assert_eq!(
            result.accepted_steps.last().unwrap().target_index,
            prefix - 1
        );
    }
}

#[test]
fn constant_body_and_face_loads_have_exact_reference_nodal_reactions() {
    let mesh = Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        tets: vec![[0, 1, 2, 3]],
    };
    let body = [12.0, -6.0, 3.0];
    let traction = [2.0, 4.0, -8.0];
    let fixed = vec![[Some(0.0); 3]; 4];
    let combined = GnlTetTarget {
        loads_kn: vec![[0.0; 3]; 4],
        body_forces: vec![GnlTetBodyForce {
            element: 0,
            force_kn_per_m3: body,
        }],
        face_tractions: vec![GnlTetFaceTraction {
            element: 0,
            face_nodes: [1, 2, 3],
            traction_kn_per_m2: traction,
        }],
        prescribed_m: fixed.clone(),
    };
    let cleared = GnlTetTarget {
        loads_kn: vec![[0.0; 3]; 4],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: fixed,
    };
    for (targets, loaded) in [
        (vec![combined.clone()], true),
        (vec![combined, cleared], false),
    ] {
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 30_000.0,
            poisson: 0.0,
            element_materials: None,
            element_energy_beta: None,
            targets,
            options: GnlTetOptions::default(),
        })
        .unwrap();
        // Reference tetrahedron V=1/6 m³. The opposite triangular face has
        // A=sqrt(3)/2 m². Constant load's nodal shares are V*b/4 and A*t/3.
        for node in 0..4 {
            for axis in 0..3 {
                let expected = if loaded {
                    -body[axis] / 24.0
                        - if node == 0 {
                            0.0
                        } else {
                            traction[axis] * 3.0_f64.sqrt() / 6.0
                        }
                } else {
                    0.0
                };
                close(
                    result.nodal_reactions_kn[node][axis],
                    expected,
                    1e-12,
                    &format!("node {node} reaction {axis}"),
                );
                close(
                    result.nodal_displacements_m[node][axis],
                    0.0,
                    1e-12,
                    &format!("node {node} displacement {axis}"),
                );
            }
        }
        close(
            result.true_free_residual_kn,
            0.0,
            1e-12,
            "fixed model residual",
        );
    }
}
