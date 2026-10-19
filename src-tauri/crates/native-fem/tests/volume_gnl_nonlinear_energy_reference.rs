//! Independent finite-stretch reference for experimental Tet4 nonlinear energy.
//!
//! With nu=0 and transverse displacement suppressed, the energy extension
//! W = W0 + beta*W0²/(2*E0) has exact nominal axial stress
//! P = F*E0*e*(1 + beta*e²/2), e=(F²-1)/2. A unit cube under nominal end
//! traction therefore reduces to a scalar equation solved here by bisection.
//! This reference uses no element stiffness, Newton iteration, or solver output
//! to determine the expected displacement and stress.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetFaceTraction, GnlTetOptions, GnlTetRequest, GnlTetResult, GnlTetTarget,
};

const YOUNG_MPA: f64 = 100.0;

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn nominal_stress_mpa(stretch: f64, beta: f64) -> f64 {
    let green = (stretch * stretch - 1.0) / 2.0;
    stretch * YOUNG_MPA * green * (1.0 + beta * green * green / 2.0)
}

fn independent_stretch_for_nominal_stress(stress_mpa: f64, beta: f64) -> f64 {
    // The tested loads lie on the strictly increasing positive-tangent branch.
    let (mut low, mut high) = (0.8, 1.2);
    assert!(nominal_stress_mpa(low, beta) < stress_mpa);
    assert!(nominal_stress_mpa(high, beta) > stress_mpa);
    for _ in 0..100 {
        let middle = (low + high) / 2.0;
        if nominal_stress_mpa(middle, beta) < stress_mpa {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}

fn reference_faces_at_x(mesh: &Mesh, x: f64) -> Vec<(usize, [usize; 3], f64)> {
    let mut result = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if !face.iter().all(|&node| mesh.nodes[node][0] == x) {
                continue;
            }
            let a = mesh.nodes[face[0]];
            let b = mesh.nodes[face[1]];
            let c = mesh.nodes[face[2]];
            let ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            let cross = [
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ];
            let area = cross.iter().map(|v| v * v).sum::<f64>().sqrt() / 2.0;
            result.push((element, face, area));
        }
    }
    result
}

fn traction_target(mesh: &Mesh, nominal_stress_mpa: f64) -> GnlTetTarget {
    GnlTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
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
        body_forces: vec![],
        face_tractions: reference_faces_at_x(mesh, 1.0)
            .into_iter()
            .map(|(element, face_nodes, _)| GnlTetFaceTraction {
                element,
                face_nodes,
                traction_kn_per_m2: [1_000.0 * nominal_stress_mpa, 0.0, 0.0],
            })
            .collect(),
    }
}

fn check_uniaxial_state(mesh: &Mesh, result: &GnlTetResult, stress_mpa: f64, beta: f64) {
    let stretch = independent_stretch_for_nominal_stress(stress_mpa, beta);
    let green_xx = (stretch * stretch - 1.0) / 2.0;
    let left_faces = reference_faces_at_x(mesh, 0.0);
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
            close(
                result.nodal_reactions_kn[node][axis],
                0.0,
                1e-5,
                &format!("node {node} transverse reaction {axis}"),
            );
        }
        let expected_axial_reaction = if point[0] == 0.0 {
            -1_000.0
                * stress_mpa
                * left_faces
                    .iter()
                    .filter(|(_, face, _)| face.contains(&node))
                    .map(|(_, _, area)| area / 3.0)
                    .sum::<f64>()
        } else {
            0.0
        };
        close(
            result.nodal_reactions_kn[node][0],
            expected_axial_reaction,
            1e-5,
            &format!("node {node} axial reaction"),
        );
    }
    for element in 0..mesh.tets.len() {
        close(
            result.element_effective_e_mpa[element],
            YOUNG_MPA * (1.0 + beta * green_xx * green_xx / 2.0),
            1e-7,
            &format!("element {element} effective modulus"),
        );
        for row in 0..3 {
            for col in 0..3 {
                close(
                    result.element_green_strain[element][row][col],
                    if row == 0 && col == 0 { green_xx } else { 0.0 },
                    2e-9,
                    &format!("element {element} Green {row}{col}"),
                );
                close(
                    result.element_first_piola_mpa[element][row][col],
                    if row == 0 && col == 0 {
                        stress_mpa
                    } else {
                        0.0
                    },
                    1e-5,
                    &format!("element {element} Piola {row}{col}"),
                );
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
    close(left_reaction, -1_000.0 * stress_mpa, 1e-5, "left reaction");
    close(result.true_free_residual_kn, 0.0, 1e-5, "free residual");
}

#[test]
fn nonlinear_energy_matches_independent_traction_reference_through_reversal_and_release() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    assert_eq!(mesh.tets.len(), 6);
    let faces = reference_faces_at_x(&mesh, 1.0);
    assert_eq!(faces.len(), 2);
    close(
        faces.iter().map(|face| face.2).sum(),
        1.0,
        1e-12,
        "reference end face area",
    );
    for beta in [40.0, -20.0] {
        let stresses = [7.0, -3.0, 0.0];
        for prefix in 1..=stresses.len() {
            let result = solve(&GnlTetRequest {
                mesh: mesh.clone(),
                e_mpa: YOUNG_MPA,
                poisson: 0.0,
                element_materials: None,
                element_energy_beta: Some(vec![beta; mesh.tets.len()]),
                targets: stresses[..prefix]
                    .iter()
                    .map(|&stress| traction_target(&mesh, stress))
                    .collect(),
                options: GnlTetOptions::default(),
            })
            .unwrap();
            check_uniaxial_state(&mesh, &result, stresses[prefix - 1], beta);
            assert_eq!(
                result.accepted_steps.last().unwrap().target_index,
                prefix - 1
            );
        }
    }
}

#[test]
fn per_element_beta_follows_mesh_order_under_affine_finite_strain() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let betas = [0.0, 10.0, -10.0, 25.0, -25.0, 40.0];
    assert_eq!(mesh.tets.len(), betas.len());
    let stretch = 1.08;
    let green_xx = (stretch * stretch - 1.0) / 2.0;
    let result = solve(&GnlTetRequest {
        mesh: mesh.clone(),
        e_mpa: YOUNG_MPA,
        poisson: 0.0,
        element_materials: None,
        element_energy_beta: Some(betas.to_vec()),
        targets: vec![GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m: mesh
                .nodes
                .iter()
                .map(|point| [Some((stretch - 1.0) * point[0]), Some(0.0), Some(0.0)])
                .collect(),
            body_forces: vec![],
            face_tractions: vec![],
        }],
        options: GnlTetOptions::default(),
    })
    .unwrap();
    for (element, &beta) in betas.iter().enumerate() {
        let expected_pxx = nominal_stress_mpa(stretch, beta);
        close(
            result.element_effective_e_mpa[element],
            YOUNG_MPA * (1.0 + beta * green_xx * green_xx / 2.0),
            1e-9,
            &format!("heterogeneous effective modulus element {element}"),
        );
        for row in 0..3 {
            for col in 0..3 {
                close(
                    result.element_green_strain[element][row][col],
                    if row == 0 && col == 0 { green_xx } else { 0.0 },
                    1e-12,
                    &format!("heterogeneous Green element {element} {row}{col}"),
                );
                close(
                    result.element_first_piola_mpa[element][row][col],
                    if row == 0 && col == 0 {
                        expected_pxx
                    } else {
                        0.0
                    },
                    1e-9,
                    &format!("heterogeneous Piola element {element} {row}{col}"),
                );
            }
        }
    }
    for axis in 0..3 {
        let resultant: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        close(resultant, 0.0, 1e-8, &format!("global reaction {axis}"));
    }
}

#[test]
fn zero_beta_matches_legacy_and_invalid_beta_lists_are_rejected() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let mut request = GnlTetRequest {
        mesh: mesh.clone(),
        e_mpa: YOUNG_MPA,
        poisson: 0.0,
        element_materials: None,
        element_energy_beta: None,
        targets: vec![traction_target(&mesh, 5.0)],
        options: GnlTetOptions::default(),
    };
    let legacy = solve(&request).unwrap();
    assert!(serde_json::to_value(&request)
        .unwrap()
        .get("elementEnergyBeta")
        .is_none());
    request.element_energy_beta = Some(vec![0.0; mesh.tets.len()]);
    let explicit = solve(&request).unwrap();
    assert!(serde_json::to_value(&request)
        .unwrap()
        .get("elementEnergyBeta")
        .unwrap()
        .is_array());
    for node in 0..mesh.nodes.len() {
        for axis in 0..3 {
            close(
                explicit.nodal_displacements_m[node][axis],
                legacy.nodal_displacements_m[node][axis],
                1e-12,
                &format!("beta zero displacement {node} {axis}"),
            );
            close(
                explicit.nodal_reactions_kn[node][axis],
                legacy.nodal_reactions_kn[node][axis],
                1e-8,
                &format!("beta zero reaction {node} {axis}"),
            );
        }
    }
    for element in 0..mesh.tets.len() {
        close(
            explicit.element_effective_e_mpa[element],
            legacy.element_effective_e_mpa[element],
            1e-12,
            &format!("beta zero effective modulus {element}"),
        );
        for row in 0..3 {
            for col in 0..3 {
                close(
                    explicit.element_first_piola_mpa[element][row][col],
                    legacy.element_first_piola_mpa[element][row][col],
                    1e-10,
                    &format!("beta zero Piola {element} {row}{col}"),
                );
            }
        }
    }
    request.element_energy_beta = Some(vec![0.0]);
    assert!(solve(&request).unwrap_err().contains("elementEnergyBeta"));
    request.element_energy_beta = Some(vec![f64::NAN; mesh.tets.len()]);
    assert!(solve(&request).unwrap_err().contains("elementEnergyBeta"));
}
