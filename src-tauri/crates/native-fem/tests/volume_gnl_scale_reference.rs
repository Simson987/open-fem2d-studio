//! Independent finite-deformation patch test beyond the original 180-DOF
//! experimental GNL bound. A homogeneous affine uniaxial stretch is an exact
//! Tet4 solution with zero body force and constant first Piola stress.
//!
//! Boundary reactions are integrated independently over the triangulated
//! reference end faces. Interior nodes are left free, so each backend must
//! actually solve a 192-unknown nonlinear equilibrium system.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetLinearBackend, GnlTetOptions, GnlTetRequest, GnlTetResult, GnlTetTarget,
};

const CELLS: [usize; 3] = [5, 5, 5];
const YOUNG_MPA: f64 = 100.0;
const STRETCH: f64 = 1.03;

fn close(actual: f64, expected: f64, absolute: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= absolute,
        "{label}: got {actual:.12e}, expected {expected:.12e}, tolerance {absolute:.3e}"
    );
}

fn is_boundary(point: [f64; 3]) -> bool {
    point.iter().any(|&x| x == 0.0 || x == 1.0)
}

fn end_face_weights(mesh: &Mesh) -> Vec<f64> {
    let mut weights = vec![0.0; mesh.nodes.len()];
    for tet in &mesh.tets {
        for face in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            let x = mesh.nodes[face[0]][0];
            if (x != 0.0 && x != 1.0) || !face.iter().all(|&node| mesh.nodes[node][0] == x) {
                continue;
            }
            let a = mesh.nodes[face[0]];
            let b = mesh.nodes[face[1]];
            let c = mesh.nodes[face[2]];
            let signed_twice_area = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
            let nodal_area = signed_twice_area.abs() / 6.0;
            for node in face {
                weights[node] += nodal_area;
            }
        }
    }
    weights
}

fn request(mesh: Mesh, beta: f64, backend: GnlTetLinearBackend) -> GnlTetRequest {
    let nodes = mesh.nodes.len();
    let elements = mesh.tets.len();
    let prescribed_m = mesh
        .nodes
        .iter()
        .map(|&point| {
            if is_boundary(point) {
                [Some((STRETCH - 1.0) * point[0]), Some(0.0), Some(0.0)]
            } else {
                [None; 3]
            }
        })
        .collect();
    GnlTetRequest {
        mesh,
        e_mpa: YOUNG_MPA,
        poisson: 0.0,
        element_materials: None,
        element_energy_beta: Some(vec![beta; elements]),
        targets: vec![GnlTetTarget {
            loads_kn: vec![[0.0; 3]; nodes],
            prescribed_m,
            body_forces: vec![],
            face_tractions: vec![],
        }],
        options: GnlTetOptions {
            linear_backend: backend,
            ..GnlTetOptions::default()
        },
    }
}

fn check_affine_reference(mesh: &Mesh, result: &GnlTetResult, beta: f64) {
    let green_xx = (STRETCH * STRETCH - 1.0) / 2.0;
    let material_scale = 1.0 + beta * green_xx * green_xx / 2.0;
    let nominal_xx_mpa = STRETCH * YOUNG_MPA * green_xx * material_scale;
    let weights = end_face_weights(mesh);
    close(
        mesh.nodes
            .iter()
            .enumerate()
            .filter(|(_, point)| point[0] == 0.0)
            .map(|(node, _)| weights[node])
            .sum(),
        1.0,
        1e-12,
        "left reference area",
    );
    close(
        mesh.nodes
            .iter()
            .enumerate()
            .filter(|(_, point)| point[0] == 1.0)
            .map(|(node, _)| weights[node])
            .sum(),
        1.0,
        1e-12,
        "right reference area",
    );

    for (node, &point) in mesh.nodes.iter().enumerate() {
        for axis in 0..3 {
            let expected_u = if axis == 0 {
                (STRETCH - 1.0) * point[0]
            } else {
                0.0
            };
            close(
                result.nodal_displacements_m[node][axis],
                expected_u,
                2e-9,
                &format!("node {node} displacement {axis}"),
            );
            let expected_reaction = if axis == 0 && point[0] == 0.0 {
                -1_000.0 * nominal_xx_mpa * weights[node]
            } else if axis == 0 && point[0] == 1.0 {
                1_000.0 * nominal_xx_mpa * weights[node]
            } else {
                0.0
            };
            close(
                result.nodal_reactions_kn[node][axis],
                expected_reaction,
                2e-4,
                &format!("node {node} reaction {axis}"),
            );
        }
    }
    for element in 0..mesh.tets.len() {
        close(
            result.element_effective_e_mpa[element],
            YOUNG_MPA * material_scale,
            2e-6,
            &format!("element {element} effective E"),
        );
        for row in 0..3 {
            for col in 0..3 {
                close(
                    result.element_green_strain[element][row][col],
                    if row == 0 && col == 0 { green_xx } else { 0.0 },
                    2e-9,
                    &format!("element {element} Green strain {row}{col}"),
                );
                close(
                    result.element_first_piola_mpa[element][row][col],
                    if row == 0 && col == 0 {
                        nominal_xx_mpa
                    } else {
                        0.0
                    },
                    2e-5,
                    &format!("element {element} nominal stress {row}{col}"),
                );
            }
        }
    }
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 0);
    close(
        result.accepted_steps.last().unwrap().target_fraction,
        1.0,
        1e-12,
        "target",
    );
    assert!(
        result.true_free_residual_kn < 2e-4,
        "free residual {} kN",
        result.true_free_residual_kn
    );
}

#[test]
fn sparse_and_frontal_gnl_solve_192_free_dof_affine_patches() {
    let mesh = Mesh::structured(CELLS).unwrap();
    assert_eq!(mesh.nodes.len(), 216);
    assert_eq!(mesh.tets.len(), 750);
    let free_nodes = mesh
        .nodes
        .iter()
        .filter(|&&point| !is_boundary(point))
        .count();
    assert_eq!(free_nodes * 3, 192);
    for beta in [0.0, 24.0] {
        for backend in [
            GnlTetLinearBackend::SparseDirect,
            GnlTetLinearBackend::FrontalWave,
        ] {
            let result = solve(&request(mesh.clone(), beta, backend)).unwrap();
            assert_eq!(result.linear_backend_used, backend);
            check_affine_reference(&mesh, &result, beta);
        }
    }
}

#[test]
fn automatic_recovers_factor_fill_on_750_nonlinear_tets() {
    let mesh = Mesh::structured(CELLS).unwrap();
    let mut input = request(mesh.clone(), 24.0, GnlTetLinearBackend::Automatic);
    // All 192 free diagonals fit; their off-diagonal LDLT factor fill does not.
    input.options.max_factor_entries = 192;
    let result = solve(&input).unwrap();
    assert_eq!(result.linear_backend_used, GnlTetLinearBackend::FrontalWave);
    assert!(result.frontal_fallbacks > 0);
    check_affine_reference(&mesh, &result, 24.0);
}
