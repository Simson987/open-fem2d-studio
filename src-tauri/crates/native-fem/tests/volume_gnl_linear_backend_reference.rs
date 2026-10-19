//! Independent scalar reference for the three experimental Tet4 GNL linear
//! algebra backends. The nonlinear equilibrium solution is determined by
//! bisection of the uniaxial nominal stress law, not by another FE solver.
//!
//! At nu=0 and constrained transverse displacement, each homogeneous layer
//! has P = F*E*e*(1+beta*e²/2), e=(F²-1)/2. In a two-layer bar P is common
//! to both layers, while their stretches and effective moduli differ.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetFaceTraction, GnlTetLinearBackend, GnlTetMaterial, GnlTetOptions, GnlTetRequest,
    GnlTetResult, GnlTetTarget,
};

const BACKENDS: [GnlTetLinearBackend; 3] = [
    GnlTetLinearBackend::Dense,
    GnlTetLinearBackend::SparseDirect,
    GnlTetLinearBackend::FrontalWave,
];

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn nominal_mpa(stretch: f64, young_mpa: f64, beta: f64) -> f64 {
    let green = (stretch * stretch - 1.0) / 2.0;
    stretch * young_mpa * green * (1.0 + beta * green * green / 2.0)
}

fn bisect_stretch(stress_mpa: f64, young_mpa: f64, beta: f64) -> f64 {
    let (mut low, mut high) = (0.8, 1.2);
    assert!(nominal_mpa(low, young_mpa, beta) < stress_mpa);
    assert!(nominal_mpa(high, young_mpa, beta) > stress_mpa);
    for _ in 0..100 {
        let middle = (low + high) / 2.0;
        if nominal_mpa(middle, young_mpa, beta) < stress_mpa {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}

fn faces_at_x(mesh: &Mesh, x: f64) -> Vec<(usize, [usize; 3], f64)> {
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

fn traction_target(mesh: &Mesh, stress_mpa: f64) -> GnlTetTarget {
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
        face_tractions: faces_at_x(mesh, 1.0)
            .iter()
            .map(|&(element, face_nodes, _)| GnlTetFaceTraction {
                element,
                face_nodes,
                traction_kn_per_m2: [1_000.0 * stress_mpa, 0.0, 0.0],
            })
            .collect(),
    }
}

fn request(
    mesh: Mesh,
    young_mpa: [f64; 2],
    beta: [f64; 2],
    stresses_mpa: &[f64],
    backend: GnlTetLinearBackend,
) -> GnlTetRequest {
    let two_layers = mesh.nodes.iter().any(|point| point[0] == 0.5);
    let element_layer = |tet: &[usize; 4]| -> usize {
        if two_layers && tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0 > 0.5 {
            1
        } else {
            0
        }
    };
    GnlTetRequest {
        e_mpa: young_mpa[0],
        poisson: 0.0,
        element_materials: two_layers.then(|| {
            mesh.tets
                .iter()
                .map(|tet| GnlTetMaterial {
                    e_mpa: young_mpa[element_layer(tet)],
                    poisson: 0.0,
                })
                .collect()
        }),
        element_energy_beta: Some(
            mesh.tets
                .iter()
                .map(|tet| beta[element_layer(tet)])
                .collect(),
        ),
        targets: stresses_mpa
            .iter()
            .map(|&stress| traction_target(&mesh, stress))
            .collect(),
        options: GnlTetOptions {
            linear_backend: backend,
            ..GnlTetOptions::default()
        },
        mesh,
    }
}

fn check_reference(
    mesh: &Mesh,
    result: &GnlTetResult,
    young_mpa: [f64; 2],
    beta: [f64; 2],
    stress_mpa: f64,
) {
    let two_layers = mesh.nodes.iter().any(|point| point[0] == 0.5);
    let stretches = [
        bisect_stretch(stress_mpa, young_mpa[0], beta[0]),
        if two_layers {
            bisect_stretch(stress_mpa, young_mpa[1], beta[1])
        } else {
            1.0
        },
    ];
    let left_faces = faces_at_x(mesh, 0.0);
    for (node, point) in mesh.nodes.iter().enumerate() {
        let x = point[0];
        let expected_ux = if two_layers && x > 0.5 {
            0.5 * (stretches[0] - 1.0) + (x - 0.5) * (stretches[1] - 1.0)
        } else {
            x * (stretches[0] - 1.0)
        };
        close(
            result.nodal_displacements_m[node][0],
            expected_ux,
            3e-10,
            &format!("node {node} axial displacement"),
        );
        let expected_rx = if x == 0.0 {
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
            expected_rx,
            1e-4,
            &format!("node {node} axial reaction"),
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
                1e-4,
                &format!("node {node} transverse reaction {axis}"),
            );
        }
    }
    for (element, tet) in mesh.tets.iter().enumerate() {
        let layer =
            if two_layers && tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0 > 0.5 {
                1
            } else {
                0
            };
        let green_xx = (stretches[layer].powi(2) - 1.0) / 2.0;
        let effective_e = young_mpa[layer] * (1.0 + beta[layer] * green_xx * green_xx / 2.0);
        close(
            result.element_effective_e_mpa[element],
            effective_e,
            1e-6,
            &format!("element {element} effective E"),
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
    close(result.true_free_residual_kn, 0.0, 1e-4, "free residual");
}

#[test]
fn three_linear_backends_match_independent_nonlinear_cube_reference() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    assert_eq!(mesh.tets.len(), 6);
    close(
        faces_at_x(&mesh, 1.0).iter().map(|face| face.2).sum(),
        1.0,
        1e-12,
        "loaded face area",
    );
    let stresses = [7.0, -3.0, 0.0];
    for backend in BACKENDS {
        for prefix in 1..=stresses.len() {
            let result = solve(&request(
                mesh.clone(),
                [100.0, 100.0],
                [40.0, 40.0],
                &stresses[..prefix],
                backend,
            ))
            .unwrap();
            assert_eq!(result.linear_backend_used, backend);
            assert_eq!(
                result.accepted_steps.last().unwrap().target_index,
                prefix - 1
            );
            check_reference(
                &mesh,
                &result,
                [100.0, 100.0],
                [40.0, 40.0],
                stresses[prefix - 1],
            );
        }
    }
}

#[test]
fn three_linear_backends_match_independent_two_layer_reference() {
    let mesh = Mesh::structured([2, 1, 1]).unwrap();
    assert_eq!(mesh.tets.len(), 12);
    let young = [100.0, 180.0];
    let beta = [30.0, -12.0];
    for backend in BACKENDS {
        let result = solve(&request(mesh.clone(), young, beta, &[8.0], backend)).unwrap();
        assert_eq!(result.linear_backend_used, backend);
        check_reference(&mesh, &result, young, beta, 8.0);
    }
}

#[test]
fn all_three_backends_reject_a_rotation_mechanism() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    for backend in BACKENDS {
        let mut bad = request(mesh.clone(), [100.0; 2], [20.0; 2], &[0.0], backend);
        bad.targets[0].prescribed_m = mesh
            .nodes
            .iter()
            .enumerate()
            .map(|(node, _)| if node == 0 { [Some(0.0); 3] } else { [None; 3] })
            .collect();
        assert!(
            solve(&bad).is_err(),
            "{backend:?} accepted a rigid rotation"
        );
    }
}

#[test]
fn automatic_recovers_sparse_storage_on_nonlinear_loading_and_unloading() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let stresses = [7.0, -3.0, 0.0];
    let regular = solve(&request(
        mesh.clone(),
        [100.0; 2],
        [40.0; 2],
        &stresses[..1],
        GnlTetLinearBackend::Automatic,
    ))
    .unwrap();
    assert_eq!(
        regular.linear_backend_used,
        GnlTetLinearBackend::SparseDirect
    );
    assert_eq!(regular.frontal_fallbacks, 0);
    check_reference(&mesh, &regular, [100.0; 2], [40.0; 2], stresses[0]);
    let mut model = request(
        mesh.clone(),
        [100.0; 2],
        [40.0; 2],
        &stresses,
        GnlTetLinearBackend::Automatic,
    );
    model.options.max_factor_entries = 4; // Four free diagonals fit; off-diagonal fill does not.
    for prefix in 1..=stresses.len() {
        model.targets.truncate(prefix);
        let result = solve(&model).unwrap();
        assert_eq!(result.linear_backend_used, GnlTetLinearBackend::FrontalWave);
        assert!(result.frontal_fallbacks >= prefix);
        check_reference(&mesh, &result, [100.0; 2], [40.0; 2], stresses[prefix - 1]);
        model = request(
            mesh.clone(),
            [100.0; 2],
            [40.0; 2],
            &stresses,
            GnlTetLinearBackend::Automatic,
        );
        model.options.max_factor_entries = 4;
    }
}

#[test]
fn automatic_recovers_heterogeneous_elements_but_not_a_mechanism() {
    let mesh = Mesh::structured([2, 1, 1]).unwrap();
    let young = [100.0, 180.0];
    let beta = [30.0, -12.0];
    let mut model = request(
        mesh.clone(),
        young,
        beta,
        &[8.0],
        GnlTetLinearBackend::Automatic,
    );
    model.options.max_factor_entries = 8; // Eight free diagonals fit; factor fill does not.
    let result = solve(&model).unwrap();
    assert_eq!(result.linear_backend_used, GnlTetLinearBackend::FrontalWave);
    assert!(result.frontal_fallbacks > 0);
    check_reference(&mesh, &result, young, beta, 8.0);

    let mut narrow = model.clone();
    narrow.options.max_front_dofs = 1;
    let narrow_error = solve(&narrow).unwrap_err();
    assert!(
        narrow_error.contains("frontal recovery failed"),
        "{narrow_error}"
    );
    assert!(narrow_error.contains("front"), "{narrow_error}");

    model.targets[0].prescribed_m = mesh
        .nodes
        .iter()
        .enumerate()
        .map(|(node, _)| if node == 0 { [Some(0.0); 3] } else { [None; 3] })
        .collect();
    let error = solve(&model).unwrap_err();
    assert!(
        error.contains("pivot") || error.contains("singular"),
        "{error}"
    );
}

#[test]
fn automatic_rejects_invalid_factor_or_front_budget() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let mut model = request(
        mesh,
        [100.0; 2],
        [0.0; 2],
        &[0.0],
        GnlTetLinearBackend::Automatic,
    );
    model.options.max_factor_entries = 0;
    assert!(solve(&model).unwrap_err().contains("options"));
    model.options.max_factor_entries = 1;
    model.options.max_front_dofs = 0;
    assert!(solve(&model).unwrap_err().contains("options"));
}
