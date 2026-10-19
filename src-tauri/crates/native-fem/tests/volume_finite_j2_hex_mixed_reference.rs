//! Independent finite-strain Hex8/Tet4/truss/Tri3 shared-node reference.
//!
//! The cube stretches in x while the adjoining tetrahedron, membrane and bar
//! compress in x. Their common node has one free DOF. The applied force is
//! computed from closed-form homogeneous element stresses and geometry, not
//! from the production element action or assembled tangent.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_hex_coupled, FiniteJ2CoupledMembrane, FiniteJ2CoupledTruss, FiniteJ2HexCell,
    FiniteJ2HexCoupledRequest, FiniteJ2HexTarget, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const DELTA_M: f64 = 0.03;
const HEX_E: f64 = 1_000.0;
const HEX_NU: f64 = 0.3;
const HEX_YIELD: f64 = 10.0;
const HEX_HARDENING: f64 = 100.0;
const TET_E: f64 = 1_200.0;
const TET_NU: f64 = 0.25;
const MEMBRANE_E: f64 = 700.0;
const MEMBRANE_NU: f64 = 0.2;
const MEMBRANE_THICKNESS_M: f64 = 0.02;
const TRUSS_E: f64 = 3_000.0;
const TRUSS_AREA_M2: f64 = 0.01;

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

/// Diagonal Hencky J2 return for F=diag(stretch,1,1), virgin material.
/// Returns (Pxx, accumulated equivalent plastic strain, tau_yy).
fn solid_uniaxial(
    youngs: f64,
    poisson: f64,
    yield_mpa: f64,
    hardening: f64,
    stretch: f64,
) -> (f64, f64, f64) {
    let log_stretch = stretch.ln();
    let mu = youngs / (2.0 * (1.0 + poisson));
    let bulk = youngs / (3.0 * (1.0 - 2.0 * poisson));
    let trial_q = 2.0 * mu * log_stretch.abs();
    let alpha = ((trial_q - yield_mpa) / (3.0 * mu + hardening)).max(0.0);
    let sign = log_stretch.signum();
    let tau_xx = bulk * log_stretch + 4.0 * mu * log_stretch / 3.0 - 2.0 * mu * alpha * sign;
    let tau_yy = bulk * log_stretch - 2.0 * mu * log_stretch / 3.0 + mu * alpha * sign;
    (tau_xx / stretch, alpha, tau_yy)
}

fn expected() -> (f64, f64, f64, f64, f64, f64, f64) {
    let hex_stretch = 1.0 + DELTA_M;
    let adjoining_stretch = 1.0 - DELTA_M;
    let (hex_pxx, hex_alpha, hex_tau_yy) =
        solid_uniaxial(HEX_E, HEX_NU, HEX_YIELD, HEX_HARDENING, hex_stretch);
    let (tet_pxx, tet_alpha, _) = solid_uniaxial(TET_E, TET_NU, 1.0e9, 0.0, adjoining_stretch);
    assert!(hex_alpha > 0.0 && tet_alpha == 0.0);

    // The cube's corner gets one quarter of the x-face force. The Tet4
    // apex receives minus its uniform Pxx times reference volume 1/6.
    let hex_force = 1_000.0 * hex_pxx / 4.0;
    let tet_force = -1_000.0 * tet_pxx / 6.0;
    let green = (adjoining_stretch * adjoining_stretch - 1.0) / 2.0;
    let membrane_sxx = MEMBRANE_E * green / (1.0 - MEMBRANE_NU.powi(2));
    // Tri3 reference area is 1/2 and grad(N_apex)_x = -1.
    let membrane_force = -1_000.0 * 0.5 * MEMBRANE_THICKNESS_M * adjoining_stretch * membrane_sxx;
    let truss_axial_kn = 1_000.0 * TRUSS_E * TRUSS_AREA_M2 * green * adjoining_stretch;
    let truss_force = -truss_axial_kn;
    (
        hex_force + tet_force + membrane_force + truss_force,
        hex_pxx,
        hex_alpha,
        hex_tau_yy / hex_stretch,
        tet_pxx,
        membrane_sxx,
        truss_axial_kn,
    )
}

fn request(backend: FiniteJ2TetLinearBackend) -> FiniteJ2HexCoupledRequest {
    let (applied_force_kn, ..) = expected();
    // Hex8 [0,1]^3; Tet4 lies outside its x=1 face and shares node 1.
    // The membrane and truss also run from that node into the Tet4 region.
    let nodes = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
        [2.0, 0.0, 0.0],
        [2.0, 1.0, 0.0],
        [2.0, 0.0, 1.0],
    ];
    let mut prescribed_m = vec![[Some(0.0); 3]; nodes.len()];
    for &node in &[2, 5, 6] {
        prescribed_m[node][0] = Some(DELTA_M);
    }
    prescribed_m[1][0] = None;
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    loads_kn[1][0] = applied_force_kn;
    FiniteJ2HexCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: Mesh {
                nodes,
                tets: vec![[1, 8, 9, 10]],
            },
            steel: FiniteJ2Steel::new(TET_E, TET_NU, 1.0e9, 0.0).unwrap(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn,
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m,
            }],
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                matrix_free_threads: 2,
                ..FiniteJ2TetOptions::default()
            },
        },
        hexes: vec![FiniteJ2HexCell {
            nodes: [0, 1, 2, 3, 4, 5, 6, 7],
            steel: FiniteJ2Steel::new(HEX_E, HEX_NU, HEX_YIELD, HEX_HARDENING).unwrap(),
        }],
        hex_targets: vec![FiniteJ2HexTarget::default()],
        trusses: vec![FiniteJ2CoupledTruss {
            nodes: [1, 8],
            youngs_mpa: TRUSS_E,
            area_m2: TRUSS_AREA_M2,
            plasticity: None,
        }],
        membranes: vec![FiniteJ2CoupledMembrane {
            nodes: [1, 8, 9],
            youngs_mpa: MEMBRANE_E,
            poisson: MEMBRANE_NU,
            thickness_m: MEMBRANE_THICKNESS_M,
            plasticity: None,
        }],
    }
}

#[test]
fn mixed_shared_node_matches_independent_parallel_force_and_eight_hex_histories() {
    let (force, hex_pxx, hex_alpha, hex_cauchy_yy, tet_pxx, membrane_sxx, truss_force) = expected();
    let mut dense_displacement = None;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let solved = solve_hex_coupled(&request(backend)).unwrap();
        let displacement = solved.nodal_displacements_m[1][0];
        close(displacement, DELTA_M, 2e-8, "shared-node displacement");
        close(
            solved.element_first_piola_mpa[0][0][0],
            tet_pxx,
            1e-5,
            "Tet4 Pxx",
        );
        close(
            solved.membrane_stress_mpa[0][0],
            membrane_sxx,
            1e-5,
            "Tri3 Sxx",
        );
        close(
            solved.truss_axial_force_kn[0],
            truss_force,
            1e-5,
            "truss axial force",
        );
        assert_eq!(solved.hex_gauss_states.len(), 1);
        assert_eq!(solved.hex_gauss_first_piola_mpa.len(), 1);
        assert_eq!(solved.hex_gauss_cauchy_mpa.len(), 1);
        for gauss in 0..8 {
            close(
                solved.hex_gauss_states[0][gauss].equivalent_plastic_strain,
                hex_alpha,
                2e-8,
                "committed Hex8 Gauss plastic strain",
            );
            close(
                solved.hex_gauss_first_piola_mpa[0][gauss][0][0],
                hex_pxx,
                2e-5,
                "Hex8 Gauss Pxx",
            );
            close(
                solved.hex_gauss_cauchy_mpa[0][gauss][1][1],
                hex_cauchy_yy,
                2e-5,
                "Hex8 Gauss lateral Cauchy",
            );
        }
        close(
            solved.element_states[0].equivalent_plastic_strain,
            0.0,
            1e-12,
            "Tet4 remains elastic",
        );
        assert!(
            solved.true_free_residual_kn < 1e-4,
            "{backend:?}: free residual"
        );
        let reaction_x: f64 = solved.nodal_reactions_kn.iter().map(|r| r[0]).sum();
        close(reaction_x, -force, 1e-4, "global x equilibrium");
        for axis in 1..3 {
            let reaction: f64 = solved.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
            close(reaction, 0.0, 1e-4, "global lateral equilibrium");
        }
        if let Some(dense) = dense_displacement {
            close(displacement, dense, 1e-8, "backend parity");
        } else {
            dense_displacement = Some(displacement);
        }
    }
}
