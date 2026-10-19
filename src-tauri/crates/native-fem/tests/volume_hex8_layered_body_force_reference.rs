//! Independent 1D equilibrium reference for a heterogeneous Hex8 solid.
//!
//! With nu=0 and transverse motion restrained, axial stress follows
//! d(sigma)/dx = -b in each layer. Integrating this stress over each layer
//! gives exact nodal displacements for linear Hex8 elements, even when E and
//! body force jump at an interface. This also exercises a dead end traction.

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, uniaxial_cube_example, Hex8LinearBackend, Hex8VolumeBodyForce,
    Hex8VolumeCell, Hex8VolumeFaceTraction, Hex8VolumeMaterial, Hex8VolumeSupport,
};

const X: [f64; 4] = [0.0, 0.28, 0.83, 1.5];
const E_MPA: [f64; 3] = [24_000.0, 38_000.0, 16_000.0];
const BODY_KN_M3: [f64; 3] = [600.0, -250.0, 350.0];
const END_TRACTION_KN_M2: f64 = 900.0;

fn close(actual: f64, expected: f64, abs: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= abs,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={abs:.3e}"
    );
}

fn node(i: usize, corner: usize) -> usize {
    4 * i + corner
}

fn reference() -> ([f64; 4], [f64; 3], f64) {
    // Stress in kN/m² at the layer boundaries, with a right-end traction.
    let mut stress = [0.0; 4];
    stress[3] = END_TRACTION_KN_M2;
    for i in (0..3).rev() {
        stress[i] = stress[i + 1] + BODY_KN_M3[i] * (X[i + 1] - X[i]);
    }
    let mut displacement = [0.0; 4];
    let mut mean_stress_mpa = [0.0; 3];
    for i in 0..3 {
        let average_kn_m2 = 0.5 * (stress[i] + stress[i + 1]);
        mean_stress_mpa[i] = average_kn_m2 / 1_000.0;
        displacement[i + 1] =
            displacement[i] + average_kn_m2 * (X[i + 1] - X[i]) / (1_000.0 * E_MPA[i]);
    }
    (displacement, mean_stress_mpa, stress[0])
}

#[test]
fn layered_hex8_body_force_and_end_traction_match_1d_equilibrium() {
    let mut model = uniaxial_cube_example();
    model.nodes.clear();
    model.elements.clear();
    model.materials.clear();
    model.loads.clear();
    model.body_forces.clear();
    model.face_tractions.clear();
    model.supports.clear();
    model.structured_grid_cells = None;
    model.tolerance = 1e-11;
    for (i, &x) in X.iter().enumerate() {
        for (corner, (y, z)) in [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]
            .into_iter()
            .enumerate()
        {
            model.nodes.push([x, y, z]);
            model.supports.push(Hex8VolumeSupport {
                node: node(i, corner),
                displacement_m: [if i == 0 { Some(0.0) } else { None }, Some(0.0), Some(0.0)],
            });
        }
    }
    for i in 0..3 {
        model.materials.push(Hex8VolumeMaterial {
            e_mpa: E_MPA[i],
            poisson: 0.0,
        });
        model.elements.push(Hex8VolumeCell {
            nodes: [
                node(i, 0),
                node(i + 1, 0),
                node(i + 1, 1),
                node(i, 1),
                node(i, 2),
                node(i + 1, 2),
                node(i + 1, 3),
                node(i, 3),
            ],
            material: i,
        });
        model.body_forces.push(Hex8VolumeBodyForce {
            element: i,
            force_kn_per_m3: [BODY_KN_M3[i], 0.0, 0.0],
        });
    }
    model.face_tractions.push(Hex8VolumeFaceTraction {
        element: 2,
        face_nodes: [1, 2, 6, 5],
        traction_kn_per_m2: [END_TRACTION_KN_M2, 0.0, 0.0],
    });

    let (expected_u, expected_stress_mpa, left_stress_kn_m2) = reference();
    for backend in [
        Hex8LinearBackend::Sparse,
        Hex8LinearBackend::SparseDirect,
        Hex8LinearBackend::FrontalWave,
        Hex8LinearBackend::MatrixFreeGeneral,
        Hex8LinearBackend::Automatic,
    ] {
        model.linear_backend = backend;
        let result = solve_hex8_volume(model.clone()).expect("layered Hex8 equilibrium");
        assert!(result.relative_residual < 1e-9, "{backend:?}");
        for i in 0..4 {
            for corner in 0..4 {
                let p = node(i, corner);
                close(
                    result.nodal_displacements_m[p][0],
                    expected_u[i],
                    2e-10,
                    "ux",
                );
                close(result.nodal_displacements_m[p][1], 0.0, 1e-13, "uy");
                close(result.nodal_displacements_m[p][2], 0.0, 1e-13, "uz");
                close(
                    result.nodal_reactions_kn[p][0],
                    if i == 0 {
                        -left_stress_kn_m2 / 4.0
                    } else {
                        0.0
                    },
                    2e-5,
                    "nodal axial reaction",
                );
            }
        }
        for i in 0..3 {
            for stress in &result.element_gauss_stress_mpa[i] {
                close(
                    stress[0],
                    expected_stress_mpa[i],
                    2e-8,
                    "layer axial stress",
                );
                for (component, value) in stress[1..].iter().enumerate() {
                    close(*value, 0.0, 2e-8, &format!("stress component {component}"));
                }
            }
        }
        close(
            result.nodal_reactions_kn.iter().map(|r| r[0]).sum(),
            -END_TRACTION_KN_M2
                - BODY_KN_M3
                    .iter()
                    .enumerate()
                    .map(|(i, b)| b * (X[i + 1] - X[i]))
                    .sum::<f64>(),
            2e-5,
            "global axial balance",
        );
    }
}
