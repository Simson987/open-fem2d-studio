//! Independent one-Tet4 + one Tri3 membrane parallel-force reference.
//! Only the common x DOF of node 1 is free. The solid has a diagonal
//! finite Hencky deformation; the membrane has plane-stress Green strain.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_membrane_coupled, FiniteJ2CoupledMembrane, FiniteJ2MembraneCoupledRequest,
    FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn request(backend: FiniteJ2TetLinearBackend) -> (FiniteJ2MembraneCoupledRequest, f64, f64) {
    let stretch = 1.005_f64;
    let youngs = 210_000.0;
    let poisson = 0.3;
    let lame = youngs * poisson / ((1.0 + poisson) * (1.0 - 2.0 * poisson));
    let mu = youngs / (2.0 * (1.0 + poisson));
    // Fixed lateral strains: tau11 = (lambda_Lame + 2 mu) ln(stretch),
    // P11 = tau11/stretch, and the one-Tet4 reference volume is 1/6 m³.
    let piola_solid = (lame + 2.0 * mu) * stretch.ln() / stretch;
    let green_membrane = (stretch * stretch - 1.0) / 2.0;
    let s11_membrane = 70_000.0 * green_membrane / (1.0 - 0.25 * 0.25);
    let volume_force = 1_000.0 * piola_solid / 6.0;
    let membrane_force = 1_000.0 * 0.5 * 0.02 * stretch * s11_membrane;
    let mut loads_kn = vec![[0.0; 3]; 4];
    loads_kn[1][0] = volume_force + membrane_force;
    let mut prescribed_m = vec![[Some(0.0); 3]; 4];
    prescribed_m[1][0] = None;
    (
        FiniteJ2MembraneCoupledRequest {
            volume: FiniteJ2TetRequest {
                mesh: Mesh {
                    nodes: vec![
                        [0.0, 0.0, 0.0],
                        [1.0, 0.0, 0.0],
                        [0.0, 1.0, 0.0],
                        [0.0, 0.0, 1.0],
                    ],
                    tets: vec![[0, 1, 2, 3]],
                },
                steel: FiniteJ2Steel::new(youngs, poisson, 1e9, 0.0).unwrap(),
                element_steels: None,
                targets: vec![FiniteJ2TetTarget {
                    loads_kn,
                    body_forces: vec![],
                    face_tractions: vec![],
                    prescribed_m,
                }],
                options: FiniteJ2TetOptions {
                    linear_backend: backend,
                    matrix_free_threads: 4,
                    ..FiniteJ2TetOptions::default()
                },
            },
            trusses: vec![],
            membranes: vec![FiniteJ2CoupledMembrane {
                nodes: [0, 1, 2],
                youngs_mpa: 70_000.0,
                poisson: 0.25,
                thickness_m: 0.02,
                plasticity: None,
            }],
        },
        piola_solid,
        s11_membrane,
    )
}

#[test]
fn all_backends_match_independent_solid_plus_membrane_force() {
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let (input, expected_piola, expected_membrane) = request(backend);
        let result = solve_membrane_coupled(&input).unwrap();
        assert!(result.membrane_states[0].is_none());
        assert!(result.membrane_thickness_stretch[0].is_none());
        assert!(result.membrane_kirchhoff_mpa[0].is_none());
        assert!(result.membrane_cauchy_mpa[0].is_none());
        assert!(result.membrane_force_resultant_kn_per_m[0].is_none());
        assert!(
            (result.nodal_displacements_m[1][0] - 0.005).abs() < 2e-8,
            "{backend:?}: displacement {:?}",
            result.nodal_displacements_m[1]
        );
        assert!(
            (result.element_first_piola_mpa[0][0][0] - expected_piola).abs() < 2e-4,
            "{backend:?}: solid Piola"
        );
        assert!(
            (result.membrane_stress_mpa[0][0] - expected_membrane).abs() < 3e-4,
            "{backend:?}: membrane stress"
        );
        // The lateral displacement is restrained, so S22 = nu * S11.
        assert!((result.membrane_stress_mpa[0][1] - 0.25 * expected_membrane).abs() < 2e-7);
        assert!(result.true_free_residual_kn < 1e-4);
        let total_reaction_x: f64 = result.nodal_reactions_kn.iter().map(|r| r[0]).sum();
        assert!((total_reaction_x + input.volume.targets[0].loads_kn[1][0]).abs() < 1e-4);
    }
}

#[test]
fn invalid_membrane_is_rejected() {
    let (mut input, _, _) = request(FiniteJ2TetLinearBackend::Dense);
    input.membranes[0].nodes = [0, 1, 1];
    assert!(solve_membrane_coupled(&input)
        .unwrap_err()
        .contains("invalid node"));
    input.membranes[0].nodes = [0, 1, 2];
    input.membranes[0].thickness_m = 0.0;
    assert!(solve_membrane_coupled(&input)
        .unwrap_err()
        .contains("thickness"));
}
