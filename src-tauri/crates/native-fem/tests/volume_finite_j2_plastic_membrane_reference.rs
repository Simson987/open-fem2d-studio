//! Independent analytic one-Tet4 + one-Tri3 finite-J2 plastic membrane check.
//! The solid remains elastic with prescribed lateral stretches. The membrane
//! has uniaxial Kirchhoff stress and a known bilinear Hencky return.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_membrane_coupled, FiniteJ2CoupledMembrane, FiniteJ2MembraneCoupledRequest,
    FiniteJ2MembranePlasticity, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest,
    FiniteJ2TetTarget,
};

fn request(backend: FiniteJ2TetLinearBackend) -> (FiniteJ2MembraneCoupledRequest, f64, f64, f64) {
    let e = 210_000.0;
    let nu = 0.3;
    let h = 1_000.0;
    let ex: f64 = 0.006;
    let alpha = (e * ex - 250.0) / (e + h);
    let sigma = 250.0 + h * alpha;
    let lx = ex.exp();
    let ly = (-nu * sigma / e - alpha / 2.0).exp();
    let lame = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mu = e / (2.0 * (1.0 + nu));
    let solid_p11 = (lame * (ex + ly.ln()) + 2.0 * mu * ex) / lx;
    let total_load = 1_000.0 * solid_p11 / 6.0 + 1_000.0 * 0.5 * 0.02 * sigma / lx;
    let mut loads = vec![[0.0; 3]; 4];
    loads[1][0] = total_load;
    let mut prescribed = vec![[Some(0.0); 3]; 4];
    prescribed[1][0] = None;
    prescribed[2][1] = Some(ly - 1.0);
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
                steel: FiniteJ2Steel::new(e, nu, 1e9, 0.0).unwrap(),
                element_steels: None,
                targets: vec![FiniteJ2TetTarget {
                    loads_kn: loads,
                    body_forces: vec![],
                    face_tractions: vec![],
                    prescribed_m: prescribed,
                }],
                options: FiniteJ2TetOptions {
                    linear_backend: backend,
                    matrix_free_threads: 2,
                    ..FiniteJ2TetOptions::default()
                },
            },
            trusses: vec![],
            membranes: vec![FiniteJ2CoupledMembrane {
                nodes: [0, 1, 2],
                youngs_mpa: e,
                poisson: nu,
                thickness_m: 0.02,
                plasticity: Some(FiniteJ2MembranePlasticity {
                    yield_mpa: 250.0,
                    hardening_mpa: h,
                }),
            }],
        },
        lx,
        ly,
        alpha,
    )
}

#[test]
fn plastic_membrane_coupled_force_and_history_match_analytic_reference_on_each_backend() {
    let mut dense_reference: Option<f64> = None;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let (input, lx, ly, alpha) = request(backend);
        let result = solve_membrane_coupled(&input).unwrap();
        let sigma = 250.0 + 1_000.0 * alpha;
        assert!(
            (result.nodal_displacements_m[1][0] - (lx - 1.0)).abs() < 1e-8,
            "{backend:?}"
        );
        assert!(
            (result.membrane_states[0].unwrap().equivalent_plastic_strain - alpha).abs() < 1e-8,
            "{backend:?}"
        );
        assert!(
            (result.membrane_thickness_stretch[0].unwrap() - ly).abs() < 1e-9,
            "{backend:?}"
        );
        let cauchy = result.membrane_cauchy_mpa[0].unwrap();
        assert!(
            (cauchy[0] - sigma / (lx * ly * ly)).abs() < 1e-5,
            "{backend:?}"
        );
        assert!(cauchy[1].abs() < 1e-5, "{backend:?}");
        assert!(cauchy[2].abs() < 1e-5, "{backend:?}");
        let resultant = result.membrane_force_resultant_kn_per_m[0].unwrap();
        assert!(
            (resultant[0] - 20.0 * sigma / (lx * ly)).abs() < 1e-4,
            "{backend:?}"
        );
        assert_eq!(result.membrane_stress_mpa[0], [0.0; 3]);
        assert!(result.membrane_kirchhoff_mpa[0].is_some());
        assert!(result.true_free_residual_kn < 1e-5);
        if let Some(reference) = dense_reference {
            assert!(
                (result.nodal_displacements_m[1][0] - reference).abs() < 1e-9,
                "{backend:?}"
            );
        } else {
            dense_reference = Some(result.nodal_displacements_m[1][0]);
        }
    }
}

#[test]
fn accepted_plastic_history_is_retained_during_elastic_unloading_target() {
    let (mut input, _, _, _) = request(FiniteJ2TetLinearBackend::Dense);
    let e = 210_000.0;
    let nu = 0.3;
    let h = 1_000.0;
    let ex1: f64 = 0.003;
    let alpha1 = (e * ex1 - 250.0) / (e + h);
    let sigma1 = 250.0 + h * alpha1;
    let ly1 = (-nu * sigma1 / e - alpha1 / 2.0).exp();
    let ex2: f64 = 0.0025;
    let sigma2 = e * (ex2 - alpha1);
    let ly2 = (-nu * sigma2 / e - alpha1 / 2.0).exp();
    let lame = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mu = e / (2.0 * (1.0 + nu));
    let target_at = |ex: f64, ly: f64, sigma: f64| {
        let lx = ex.exp();
        let solid_p11 = (lame * (ex + ly.ln()) + 2.0 * mu * ex) / lx;
        let mut target = input.volume.targets[0].clone();
        target.loads_kn[1][0] = 1_000.0 * solid_p11 / 6.0 + 10.0 * sigma / lx;
        target.prescribed_m[2][1] = Some(ly - 1.0);
        target
    };
    input.volume.targets = vec![target_at(ex1, ly1, sigma1), target_at(ex2, ly2, sigma2)];
    let result = solve_membrane_coupled(&input).unwrap();
    assert!((result.nodal_displacements_m[1][0] - (ex2.exp() - 1.0)).abs() < 1e-8);
    assert!((result.membrane_states[0].unwrap().equivalent_plastic_strain - alpha1).abs() < 1e-8);
    assert!((result.membrane_thickness_stretch[0].unwrap() - ly2).abs() < 1e-9);
    assert!((result.membrane_kirchhoff_mpa[0].unwrap()[0][0] - sigma2).abs() < 1e-5);
    assert!(result
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 0));
    assert!(result
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
}

#[test]
fn invalid_membrane_plasticity_is_rejected_before_newton() {
    let (mut input, _, _, _) = request(FiniteJ2TetLinearBackend::Dense);
    input.membranes[0].plasticity.as_mut().unwrap().yield_mpa = -1.0;
    assert!(solve_membrane_coupled(&input)
        .unwrap_err()
        .contains("yield stress"));
}
