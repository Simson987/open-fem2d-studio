//! A force-driven one-Tet4/one-truss parallel system. The solid uses an
//! independently evaluated homogeneous Hencky elastic stress, while the bar
//! uses its reference Green energy. Both share the one free nodal x-DOF.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_coupled, FiniteJ2CoupledRequest, FiniteJ2CoupledTruss, FiniteJ2TetLinearBackend,
    FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const STRETCH: f64 = 1.01;
const SOLID_E: f64 = 1_000.0;
const NU: f64 = 0.3;
const BAR_E: f64 = 200_000.0;
const BAR_AREA: f64 = 0.02;

fn target(load_kn: f64) -> FiniteJ2TetTarget {
    FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3], [load_kn, 0.0, 0.0], [0.0; 3], [0.0; 3]],
        prescribed_m: vec![
            [Some(0.0); 3],
            [None, Some(0.0), Some(0.0)],
            [Some(0.0); 3],
            [Some(0.0); 3],
        ],
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn expected() -> (f64, f64, f64) {
    let mu = SOLID_E / (2.0 * (1.0 + NU));
    let lame = SOLID_E * NU / ((1.0 + NU) * (1.0 - 2.0 * NU));
    let pxx_mpa = (lame + 2.0 * mu) * STRETCH.ln() / STRETCH;
    let bar_kn = 1_000.0 * BAR_E * BAR_AREA * (STRETCH * STRETCH - 1.0) * STRETCH / 2.0;
    (1_000.0 * pxx_mpa / 6.0 + bar_kn, pxx_mpa, bar_kn)
}

fn request(
    backend: FiniteJ2TetLinearBackend,
    targets: Vec<FiniteJ2TetTarget>,
) -> FiniteJ2CoupledRequest {
    FiniteJ2CoupledRequest {
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
            steel: FiniteJ2Steel::new(SOLID_E, NU, 1.0e9, 100.0).unwrap(),
            element_steels: None,
            targets,
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        },
        trusses: vec![FiniteJ2CoupledTruss {
            nodes: [0, 1],
            youngs_mpa: BAR_E,
            area_m2: BAR_AREA,
            plasticity: None,
        }],
    }
}

#[test]
fn all_tangent_backends_match_analytic_parallel_energy_and_unload() {
    let (force_kn, pxx_mpa, bar_kn) = expected();
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let solved = solve_coupled(&request(backend, vec![target(force_kn)])).unwrap();
        assert!(
            (solved.nodal_displacements_m[1][0] - (STRETCH - 1.0)).abs() < 1e-8,
            "{backend:?}: displacement"
        );
        assert!(
            (solved.element_first_piola_mpa[0][0][0] - pxx_mpa).abs() < 1e-6,
            "{backend:?}: solid Piola stress"
        );
        assert!(
            (solved.truss_axial_force_kn[0] - bar_kn).abs() < 1e-5,
            "{backend:?}: current axial force"
        );
        let reaction_x: f64 = solved.nodal_reactions_kn.iter().map(|value| value[0]).sum();
        assert!(
            (reaction_x + force_kn).abs() < 1e-5,
            "{backend:?}: global equilibrium"
        );
        assert!(
            solved.true_free_residual_kn < 1e-5,
            "{backend:?}: free residual"
        );
        let unloaded =
            solve_coupled(&request(backend, vec![target(force_kn), target(0.0)])).unwrap();
        assert!(
            unloaded.nodal_displacements_m[1][0].abs() < 1e-8,
            "{backend:?}: elastic unloading"
        );
        assert!(unloaded.truss_axial_force_kn[0].abs() < 1e-5);
    }
}

#[test]
fn invalid_truss_connectivity_and_area_are_rejected() {
    let mut input = request(FiniteJ2TetLinearBackend::Dense, vec![target(0.0)]);
    input.trusses[0].nodes = [1, 1];
    assert!(solve_coupled(&input).unwrap_err().contains("invalid node"));
    input.trusses[0].nodes = [0, 1];
    input.trusses[0].area_m2 = -1.0;
    assert!(solve_coupled(&input)
        .unwrap_err()
        .contains("positive E and area"));
}
