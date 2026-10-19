//! Independent finite simple-shear patch validation for the public GNL Tet4 API.
//! For F = I + gamma e_x tensor e_y, E_xy = gamma/2 and E_yy = gamma^2/2.
//! St Venant–Kirchhoff gives P_xy = mu*gamma + (lambda/2 + mu)*gamma^3.
//! The top face of the unit cube therefore reacts with 1000*P_xy kN.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{solve, GnlTetOptions, GnlTetRequest, GnlTetTarget};

fn close(actual: f64, expected: f64, absolute: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= absolute,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {absolute:.3e}"
    );
}

fn shear_target(mesh: &Mesh, gamma: f64) -> GnlTetTarget {
    let prescribed_m = mesh
        .nodes
        .iter()
        .map(|&[x, y, z]| {
            if [x, y, z] == [0.5, 0.5, 0.5] {
                [None; 3]
            } else {
                [Some(gamma * y), Some(0.0), Some(0.0)]
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

#[test]
fn finite_simple_shear_and_load_reversal_match_nominal_traction() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let young = 80_000.0;
    let poisson = 0.25;
    let gamma: f64 = 0.08;
    let mu = young / (2.0 * (1.0 + poisson));
    let lambda = young * poisson / ((1.0 + poisson) * (1.0 - 2.0 * poisson));
    let expected_nominal_shear = mu * gamma + (0.5 * lambda + mu) * gamma.powi(3);

    for path in [vec![gamma], vec![gamma, -gamma]] {
        let final_gamma = *path.last().unwrap();
        let targets = path.iter().map(|&g| shear_target(&mesh, g)).collect();
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: young,
            poisson,
            element_materials: None,
            element_energy_beta: None,
            targets,
            options: GnlTetOptions::default(),
        })
        .unwrap();
        let top_reaction_x: f64 = mesh
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, point)| point[1] == 1.0)
            .map(|(node, _)| result.nodal_reactions_kn[node][0])
            .sum();
        let expected_top = expected_nominal_shear.copysign(final_gamma) * 1_000.0;
        close(top_reaction_x, expected_top, 1e-5, "top x reaction");

        let center = mesh
            .nodes
            .iter()
            .position(|point| *point == [0.5, 0.5, 0.5])
            .unwrap();
        close(
            result.nodal_displacements_m[center][0],
            0.5 * final_gamma,
            1e-11,
            "free center x displacement",
        );
        close(
            result.nodal_reactions_kn[center][0],
            0.0,
            1e-5,
            "free center x residual",
        );
        close(result.true_free_residual_kn, 0.0, 1e-5, "free residual");
        for strain in &result.element_green_strain {
            close(strain[0][1], 0.5 * final_gamma, 1e-10, "Green E_xy");
            close(strain[1][1], 0.5 * final_gamma.powi(2), 1e-10, "Green E_yy");
        }
        for stress in &result.element_first_piola_mpa {
            close(
                stress[0][1],
                expected_nominal_shear.copysign(final_gamma),
                1e-8,
                "first Piola P_xy",
            );
        }
    }
}
