//! Independent large-mesh objectivity and equilibrium check for StVK Tet4.
//!
//! A uniform simple shear followed by a rigid rotation has the same Green
//! strain and stored energy as the unrotated shear. Its first Piola stress is
//! rotated by the same spatial rotation. This 6^3-cell patch exceeds the
//! direct GNL limits (1029 DOF, 1296 Tet4), so it exercises sparse GMRES on
//! 375 genuinely free interior DOFs. The all-boundary reaction first moment
//! follows independently from virtual work: sum(r_a X_i) = 1000 V P_ai.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetLinearBackend, GnlTetOptions, GnlTetRequest, GnlTetTarget,
};

const E_MPA: f64 = 100.0;
const POISSON: f64 = 0.25;
const BETA: f64 = 24.0;
const SHEAR: f64 = 0.08;
const ANGLE: f64 = 0.3;

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn rotation(angle: f64) -> [[f64; 3]; 3] {
    let (sin, cos) = angle.sin_cos();
    [[cos, -sin, 0.0], [sin, cos, 0.0], [0.0, 0.0, 1.0]]
}

fn matmul(left: [[f64; 3]; 3], right: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    std::array::from_fn(|row| {
        std::array::from_fn(|col| {
            (0..3)
                .map(|index| left[row][index] * right[index][col])
                .sum()
        })
    })
}

fn deformation(angle: f64) -> [[f64; 3]; 3] {
    matmul(
        rotation(angle),
        [[1.0, SHEAR, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    )
}

fn is_boundary(point: [f64; 3]) -> bool {
    point
        .iter()
        .any(|&coordinate| coordinate == 0.0 || coordinate == 1.0)
}

fn target(mesh: &Mesh, angle: f64) -> GnlTetTarget {
    let f = deformation(angle);
    let prescribed_m = mesh
        .nodes
        .iter()
        .map(|&point| {
            if is_boundary(point) {
                std::array::from_fn(|axis| {
                    Some((0..3).map(|col| f[axis][col] * point[col]).sum::<f64>() - point[axis])
                })
            } else {
                [None; 3]
            }
        })
        .collect();
    GnlTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn independent_strain_and_stress(angle: f64) -> ([[f64; 3]; 3], [[f64; 3]; 3], f64) {
    // H = I + gamma e_x tensor e_y. The rigid rotation cancels from H^T H.
    let green = [
        [0.0, SHEAR / 2.0, 0.0],
        [SHEAR / 2.0, SHEAR * SHEAR / 2.0, 0.0],
        [0.0, 0.0, 0.0],
    ];
    let mu = E_MPA / (2.0 * (1.0 + POISSON));
    let lambda = E_MPA * POISSON / ((1.0 + POISSON) * (1.0 - 2.0 * POISSON));
    let trace = SHEAR * SHEAR / 2.0;
    let s0: [[f64; 3]; 3] = std::array::from_fn(|row| {
        std::array::from_fn(|col| {
            2.0 * mu * green[row][col] + if row == col { lambda * trace } else { 0.0 }
        })
    });
    let w0 = 0.5
        * (0..3)
            .flat_map(|row| (0..3).map(move |col| green[row][col] * s0[row][col]))
            .sum::<f64>();
    let factor = 1.0 + BETA * w0 / E_MPA;
    let p = matmul(deformation(angle), s0).map(|row| row.map(|value| value * factor));
    (green, p, E_MPA * factor)
}

#[test]
fn sparse_gmres_rotated_shear_preserves_green_strain_and_reaction_work() {
    let mesh = Mesh::structured([6, 6, 6]).unwrap();
    assert_eq!(mesh.nodes.len(), 343);
    assert_eq!(mesh.tets.len(), 1296);
    assert_eq!(
        mesh.nodes.iter().filter(|&&p| !is_boundary(p)).count() * 3,
        375
    );
    let result = solve(&GnlTetRequest {
        mesh: mesh.clone(),
        e_mpa: E_MPA,
        poisson: POISSON,
        element_materials: None,
        element_energy_beta: Some(vec![BETA; mesh.tets.len()]),
        targets: vec![target(&mesh, 0.0), target(&mesh, ANGLE)],
        options: GnlTetOptions {
            linear_backend: GnlTetLinearBackend::SparseGmres,
            ..GnlTetOptions::default()
        },
    })
    .unwrap();

    assert_eq!(result.linear_backend_used, GnlTetLinearBackend::SparseGmres);
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 1);
    close(
        result.accepted_steps.last().unwrap().target_fraction,
        1.0,
        1e-12,
        "final load fraction",
    );
    assert!(result.true_free_residual_kn < 1e-5);

    let f = deformation(ANGLE);
    let (green, p, effective_e) = independent_strain_and_stress(ANGLE);
    for (node, &point) in mesh.nodes.iter().enumerate() {
        for axis in 0..3 {
            let expected = (0..3).map(|col| f[axis][col] * point[col]).sum::<f64>() - point[axis];
            close(
                result.nodal_displacements_m[node][axis],
                expected,
                2e-8,
                &format!("node {node} displacement axis {axis}"),
            );
        }
    }
    for element in 0..mesh.tets.len() {
        close(
            result.element_effective_e_mpa[element],
            effective_e,
            2e-6,
            &format!("element {element} effective E"),
        );
        for row in 0..3 {
            for col in 0..3 {
                close(
                    result.element_green_strain[element][row][col],
                    green[row][col],
                    2e-8,
                    &format!("element {element} Green strain {row}{col}"),
                );
                close(
                    result.element_first_piola_mpa[element][row][col],
                    p[row][col],
                    1e-5,
                    &format!("element {element} first Piola {row}{col}"),
                );
            }
        }
    }

    for spatial in 0..3 {
        let force_sum: f64 = result.nodal_reactions_kn.iter().map(|r| r[spatial]).sum();
        close(force_sum, 0.0, 2e-5, &format!("force balance {spatial}"));
        for reference in 0..3 {
            let reaction_work: f64 = mesh
                .nodes
                .iter()
                .zip(&result.nodal_reactions_kn)
                .map(|(point, reaction)| reaction[spatial] * point[reference])
                .sum();
            close(
                reaction_work,
                1_000.0 * p[spatial][reference],
                2e-3,
                &format!("reaction first moment {spatial}{reference}"),
            );
        }
    }
}
