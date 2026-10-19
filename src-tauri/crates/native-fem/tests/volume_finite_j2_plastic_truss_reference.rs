//! Independent one-DOF force-driven Tet4 + finite-plastic-truss parallel test.
//! The reference uses a scalar Hencky solid stress and an independent 1D
//! logarithmic return map, then finds the unloaded root by bisection.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_coupled, FiniteJ2CoupledRequest, FiniteJ2CoupledTruss, FiniteJ2TetLinearBackend,
    FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget, FiniteJ2TrussPlasticity,
};

const SOLID_E: f64 = 100.0;
const POISSON: f64 = 0.3;
const BAR_E: f64 = 200_000.0;
const BAR_YIELD: f64 = 250.0;
const BAR_H: f64 = 1_000.0;
const BAR_AREA: f64 = 0.002;
const PEAK_STRETCH: f64 = 1.005;

fn solid_force(stretch: f64) -> f64 {
    let mu = SOLID_E / (2.0 * (1.0 + POISSON));
    let lame = SOLID_E * POISSON / ((1.0 + POISSON) * (1.0 - 2.0 * POISSON));
    1_000.0 * (lame + 2.0 * mu) * stretch.ln() / (6.0 * stretch)
}

fn peak_reference() -> (f64, f64, f64) {
    let strain = PEAK_STRETCH.ln();
    let trial = BAR_E * strain;
    let plastic = (trial - BAR_YIELD) / (BAR_E + BAR_H);
    let stress = trial - BAR_E * plastic;
    let force = solid_force(PEAK_STRETCH) + 1_000.0 * BAR_AREA * stress / PEAK_STRETCH;
    (force, plastic, stress)
}

fn unload_reference(plastic: f64) -> f64 {
    let residual = |stretch: f64| {
        solid_force(stretch) + 1_000.0 * BAR_AREA * BAR_E * (stretch.ln() - plastic) / stretch
    };
    let mut low = 1.0;
    let mut high = PEAK_STRETCH;
    assert!(residual(low) < 0.0 && residual(high) > 0.0);
    for _ in 0..80 {
        let middle = 0.5 * (low + high);
        if residual(middle) > 0.0 {
            high = middle;
        } else {
            low = middle;
        }
    }
    0.5 * (low + high)
}

fn target(force_kn: f64) -> FiniteJ2TetTarget {
    FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3], [force_kn, 0.0, 0.0], [0.0; 3], [0.0; 3]],
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

fn request(backend: FiniteJ2TetLinearBackend, loads: Vec<f64>) -> FiniteJ2CoupledRequest {
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
            steel: FiniteJ2Steel::new(SOLID_E, POISSON, 1.0e9, 100.0).unwrap(),
            element_steels: None,
            targets: loads.into_iter().map(target).collect(),
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
            plasticity: Some(FiniteJ2TrussPlasticity {
                yield_mpa: BAR_YIELD,
                hardening_mpa: BAR_H,
            }),
        }],
    }
}

#[test]
fn plastic_truss_and_elastic_solid_share_force_and_retain_history_after_unload() {
    let (peak_force, plastic, peak_stress) = peak_reference();
    let final_stretch = unload_reference(plastic);
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let peak = solve_coupled(&request(backend, vec![peak_force])).unwrap();
        assert!(
            (peak.nodal_displacements_m[1][0] - (PEAK_STRETCH - 1.0)).abs() < 1e-8,
            "{backend:?}: peak stretch"
        );
        assert!(
            (peak.truss_axial_force_kn[0] - 1_000.0 * BAR_AREA * peak_stress / PEAK_STRETCH).abs()
                < 1e-6,
            "{backend:?}: peak bar force"
        );
        let peak_state = peak.truss_states[0].unwrap();
        assert!(
            (peak_state.plastic_log_strain - plastic).abs() < 1e-9,
            "{backend:?}: peak plastic strain"
        );
        assert!((peak_state.accumulated_plastic_log_strain - plastic).abs() < 1e-9);
        assert!(
            (peak.truss_algorithmic_modulus_mpa[0].unwrap() - BAR_E * BAR_H / (BAR_E + BAR_H))
                .abs()
                < 1e-5
        );

        let unloaded = solve_coupled(&request(backend, vec![peak_force, 0.0])).unwrap();
        assert!(
            (unloaded.nodal_displacements_m[1][0] - (final_stretch - 1.0)).abs() < 1e-8,
            "{backend:?}: residual displacement"
        );
        let final_state = unloaded.truss_states[0].unwrap();
        assert!(
            (final_state.plastic_log_strain - plastic).abs() < 1e-9,
            "{backend:?}: plastic history must not roll back on unloading"
        );
        assert!((final_state.accumulated_plastic_log_strain - plastic).abs() < 1e-9);
        assert!((unloaded.truss_algorithmic_modulus_mpa[0].unwrap() - BAR_E).abs() < 1e-5);
        assert!(unloaded.true_free_residual_kn < 1e-5);
        let net_reaction: f64 = unloaded.nodal_reactions_kn.iter().map(|x| x[0]).sum();
        assert!(
            net_reaction.abs() < 1e-5,
            "{backend:?}: global force balance"
        );
    }
}

#[test]
fn invalid_plastic_truss_law_is_rejected_before_newton() {
    let mut input = request(FiniteJ2TetLinearBackend::Dense, vec![0.0]);
    input.trusses[0].plasticity.as_mut().unwrap().yield_mpa = -1.0;
    assert!(solve_coupled(&input).unwrap_err().contains("yield"));
}
