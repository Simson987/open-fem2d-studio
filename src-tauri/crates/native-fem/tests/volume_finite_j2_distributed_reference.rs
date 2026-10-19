//! Independent reference checks for dead loads on finite-strain J2 Tet4.
//!
//! Constant body force and nominal face traction are integrated by hand in
//! the reference configuration. The mixed plastic case compares the resulting
//! nodal equivalents with explicitly applied dead nodal loads, including a
//! second (partially unloaded) target that exercises committed J2 history.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetBodyForce, FiniteJ2TetFaceTraction, FiniteJ2TetLinearBackend,
    FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn close(actual: f64, expected: f64, absolute: f64, relative: f64, label: &str) {
    let tolerance = absolute + relative * expected.abs();
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn steel() -> FiniteJ2Steel {
    FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap()
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.into_iter().zip(b).map(|(x, y)| x * y).sum()
}

fn reference_tet_volume(mesh: &Mesh, tet: [usize; 4]) -> f64 {
    let [a, b, c, d] = tet.map(|node| mesh.nodes[node]);
    let six_volume = dot(sub(b, a), cross(sub(c, a), sub(d, a)));
    assert!(six_volume > 0.0, "reference Tet4 orientation");
    six_volume / 6.0
}

fn reference_face_area(mesh: &Mesh, face: [usize; 3]) -> f64 {
    let [a, b, c] = face.map(|node| mesh.nodes[node]);
    let twice_area = cross(sub(b, a), sub(c, a));
    0.5 * dot(twice_area, twice_area).sqrt()
}

fn independent_nodal_equivalents(mesh: &Mesh, target: &FiniteJ2TetTarget) -> Vec<[f64; 3]> {
    let mut loads = target.loads_kn.clone();
    for body in &target.body_forces {
        let tet = mesh.tets[body.element];
        let share = reference_tet_volume(mesh, tet) / 4.0;
        for node in tet {
            for axis in 0..3 {
                loads[node][axis] += share * body.force_kn_per_m3[axis];
            }
        }
    }
    for face in &target.face_tractions {
        let share = reference_face_area(mesh, face.face_nodes) / 3.0;
        for node in face.face_nodes {
            for axis in 0..3 {
                loads[node][axis] += share * face.traction_kn_per_m2[axis];
            }
        }
    }
    loads
}

fn end_faces_at_x_one(mesh: &Mesh) -> Vec<(usize, [usize; 3])> {
    let mut faces = Vec::new();
    for (element, &tet) in mesh.tets.iter().enumerate() {
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
    faces
}

fn request(mesh: Mesh, targets: Vec<FiniteJ2TetTarget>, sparse: bool) -> FiniteJ2TetRequest {
    FiniteJ2TetRequest {
        mesh,
        steel: steel(),
        element_steels: None,
        targets,
        options: FiniteJ2TetOptions {
            linear_backend: if sparse {
                FiniteJ2TetLinearBackend::SparseGmres
            } else {
                FiniteJ2TetLinearBackend::Dense
            },
            ..FiniteJ2TetOptions::default()
        },
    }
}

#[test]
fn fixed_tetrahedron_has_exact_reference_body_and_face_reactions_then_unloads() {
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
    let loaded = FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; 4],
        body_forces: vec![FiniteJ2TetBodyForce {
            element: 0,
            force_kn_per_m3: body,
        }],
        // Deliberately reverse the face order: a specified global dead
        // traction has no orientation-dependent sign.
        face_tractions: vec![FiniteJ2TetFaceTraction {
            element: 0,
            face_nodes: [3, 2, 1],
            traction_kn_per_m2: traction,
        }],
        prescribed_m: fixed.clone(),
    };
    let cleared = FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; 4],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: fixed,
    };
    for (targets, expected_scale) in [(vec![loaded.clone()], 1.0), (vec![loaded, cleared], 0.0)] {
        let result = solve(&request(mesh.clone(), targets, false)).unwrap();
        assert_eq!(result.element_states.len(), 1);
        close(
            result.element_states[0].equivalent_plastic_strain,
            0.0,
            1e-14,
            0.0,
            "fixed material history",
        );
        for node in 0..4 {
            for axis in 0..3 {
                // V0 = 1/6 m³; opposite face area = sqrt(3)/2 m².
                // The four body shares are b/24, and the three face
                // shares are t*sqrt(3)/6. Internal force is zero here.
                let expected_reaction = -expected_scale
                    * (body[axis] / 24.0
                        + if node == 0 {
                            0.0
                        } else {
                            traction[axis] * 3.0_f64.sqrt() / 6.0
                        });
                close(
                    result.nodal_reactions_kn[node][axis],
                    expected_reaction,
                    1e-12,
                    0.0,
                    "fixed Tet4 reaction",
                );
                close(
                    result.nodal_displacements_m[node][axis],
                    0.0,
                    1e-14,
                    0.0,
                    "fixed Tet4 displacement",
                );
            }
        }
        close(
            result.true_free_residual_kn,
            0.0,
            1e-14,
            0.0,
            "no free DOFs",
        );
    }
}

#[test]
fn mixed_dead_load_plastic_path_matches_independent_explicit_nodal_equivalents() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let faces = end_faces_at_x_one(&mesh);
    assert_eq!(faces.len(), 2);
    close(
        faces
            .iter()
            .map(|(_, face)| reference_face_area(&mesh, *face))
            .sum(),
        1.0,
        1e-14,
        0.0,
        "reference end area",
    );
    let supports: Vec<[Option<f64>; 3]> = mesh
        .nodes
        .iter()
        .map(|point| {
            if point[0] == 0.0 {
                [Some(0.0); 3]
            } else {
                [None; 3]
            }
        })
        .collect();
    let distributed_target = |scale: f64| FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: mesh
            .tets
            .iter()
            .enumerate()
            .map(|(element, _)| FiniteJ2TetBodyForce {
                element,
                force_kn_per_m3: if element % 2 == 0 {
                    [scale * 12_000.0, scale * -6_000.0, scale * 3_000.0]
                } else {
                    [scale * -3_000.0, scale * 2_000.0, scale * 1_000.0]
                },
            })
            .collect(),
        face_tractions: faces
            .iter()
            .enumerate()
            .map(
                |(face_index, &(element, face_nodes))| FiniteJ2TetFaceTraction {
                    element,
                    face_nodes,
                    traction_kn_per_m2: if face_index == 0 {
                        [scale * 350_000.0, scale * 8_000.0, 0.0]
                    } else {
                        [scale * 350_000.0, 0.0, scale * -5_000.0]
                    },
                },
            )
            .collect(),
        prescribed_m: supports.clone(),
    };
    let distributed_targets = [distributed_target(1.0), distributed_target(0.35)];
    let explicit_targets: Vec<_> = distributed_targets
        .iter()
        .map(|target| FiniteJ2TetTarget {
            loads_kn: independent_nodal_equivalents(&mesh, target),
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m: supports.clone(),
        })
        .collect();

    for sparse in [false, true] {
        let distributed = solve(&request(mesh.clone(), distributed_targets.to_vec(), sparse))
            .expect("mixed finite J2 distributed load path");
        let explicit = solve(&request(mesh.clone(), explicit_targets.clone(), sparse))
            .expect("equivalent finite J2 nodal load path");
        assert_eq!(
            distributed.linear_backend_used,
            explicit.linear_backend_used
        );
        assert!(distributed
            .accepted_steps
            .iter()
            .any(|step| step.target_index == 1));
        assert!(distributed
            .element_states
            .iter()
            .any(|state| state.equivalent_plastic_strain > 1e-5));
        close(
            distributed.true_free_residual_kn,
            0.0,
            2e-5,
            0.0,
            "distributed true free residual",
        );
        for node in 0..mesh.nodes.len() {
            for axis in 0..3 {
                close(
                    distributed.nodal_displacements_m[node][axis],
                    explicit.nodal_displacements_m[node][axis],
                    1e-10,
                    1e-8,
                    "distributed/explicit displacement",
                );
                close(
                    distributed.nodal_reactions_kn[node][axis],
                    explicit.nodal_reactions_kn[node][axis],
                    1e-4,
                    1e-8,
                    "distributed/explicit reaction",
                );
            }
        }
        for element in 0..mesh.tets.len() {
            close(
                distributed.element_states[element].equivalent_plastic_strain,
                explicit.element_states[element].equivalent_plastic_strain,
                1e-9,
                1e-7,
                "distributed/explicit J2 history",
            );
            for i in 0..3 {
                for j in 0..3 {
                    close(
                        distributed.element_first_piola_mpa[element][i][j],
                        explicit.element_first_piola_mpa[element][i][j],
                        1e-6,
                        1e-8,
                        "distributed/explicit first Piola",
                    );
                }
            }
        }
        // R + f_ext sums to zero in every Cartesian direction, even with
        // nonlinear material response and a nonaffine mesh displacement.
        let equivalent = independent_nodal_equivalents(&mesh, &distributed_targets[1]);
        for axis in 0..3 {
            let resultant: f64 = (0..mesh.nodes.len())
                .map(|node| distributed.nodal_reactions_kn[node][axis] + equivalent[node][axis])
                .sum();
            close(resultant, 0.0, 2e-4, 0.0, "mixed dead-load resultant");
        }
    }
}
