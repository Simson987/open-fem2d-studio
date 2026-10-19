//! Reproducible finite-J2 mixed-model matrix-free acceptance at 1,000 and
//! 4,096 Hex8 cells. The larger case is explicitly opted into for release runs.
//!
//! One interior x DOF is free. Its independently calculated Tet4, Tri3 and
//! truss nodal load balances their affine internal forces; the regular Hex8
//! patch contributes zero net interior force. Every other DOF follows the
//! prescribed homogeneous stretch, giving an analytic displacement and stress.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_hex_coupled, FiniteJ2CoupledMembrane, FiniteJ2CoupledTruss, FiniteJ2HexCell,
    FiniteJ2HexCoupledRequest, FiniteJ2HexTarget, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const STRAIN: f64 = 0.005;
const HEX_E: f64 = 1_000.0;
const HEX_NU: f64 = 0.3;
const HEX_YIELD: f64 = 1.0;
const HEX_H: f64 = 100.0;
const TET_E: f64 = 1_200.0;
const TET_NU: f64 = 0.25;
const MEMBRANE_E: f64 = 700.0;
const MEMBRANE_NU: f64 = 0.2;
const MEMBRANE_T: f64 = 0.001;
const TRUSS_E: f64 = 3_000.0;
const TRUSS_AREA: f64 = 0.0001;

fn index(i: usize, j: usize, k: usize, cells: usize) -> usize {
    (k * (cells + 1) + j) * (cells + 1) + i
}

fn close(actual: f64, expected: f64, absolute: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= absolute,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={absolute:.3e}"
    );
}

/// Virgin uniaxial Hencky return with fixed lateral logarithmic strains.
fn pxx_and_alpha(e: f64, nu: f64, yield_mpa: f64, hardening: f64) -> (f64, f64) {
    let log_stretch = (1.0 + STRAIN).ln();
    let mu = e / (2.0 * (1.0 + nu));
    let bulk = e / (3.0 * (1.0 - 2.0 * nu));
    let alpha = ((2.0 * mu * log_stretch - yield_mpa) / (3.0 * mu + hardening)).max(0.0);
    let tau_xx = bulk * log_stretch + 4.0 * mu * log_stretch / 3.0 - 2.0 * mu * alpha;
    (tau_xx / (1.0 + STRAIN), alpha)
}

fn request(cells: usize) -> (FiniteJ2HexCoupledRequest, f64, f64, f64, f64, f64) {
    assert!(cells >= 4 && cells % 2 == 0);
    let h = 1.0 / cells as f64;
    let nodes: Vec<[f64; 3]> = (0..=cells)
        .flat_map(|k| {
            (0..=cells).flat_map(move |j| {
                (0..=cells).map(move |i| [i as f64 * h, j as f64 * h, k as f64 * h])
            })
        })
        .collect();
    let mut hexes = Vec::with_capacity(cells * cells * cells);
    let hex_steel = FiniteJ2Steel::new(HEX_E, HEX_NU, HEX_YIELD, HEX_H).unwrap();
    for k in 0..cells {
        for j in 0..cells {
            for i in 0..cells {
                hexes.push(FiniteJ2HexCell {
                    nodes: [
                        index(i, j, k, cells),
                        index(i + 1, j, k, cells),
                        index(i + 1, j + 1, k, cells),
                        index(i, j + 1, k, cells),
                        index(i, j, k + 1, cells),
                        index(i + 1, j, k + 1, cells),
                        index(i + 1, j + 1, k + 1, cells),
                        index(i, j + 1, k + 1, cells),
                    ],
                    steel: hex_steel,
                });
            }
        }
    }
    let mid = cells / 2;
    let center = index(mid, mid, mid, cells);
    let x = index(mid + 1, mid, mid, cells);
    let y = index(mid, mid + 1, mid, cells);
    let z = index(mid, mid, mid + 1, cells);
    let (hex_pxx, hex_alpha) = pxx_and_alpha(HEX_E, HEX_NU, HEX_YIELD, HEX_H);
    let (tet_pxx, _) = pxx_and_alpha(TET_E, TET_NU, 1.0e9, 0.0);
    let stretch = 1.0 + STRAIN;
    let green = (stretch * stretch - 1.0) / 2.0;
    let membrane_sxx = MEMBRANE_E * green / (1.0 - MEMBRANE_NU * MEMBRANE_NU);
    let bar_axial_kn = 1_000.0 * TRUSS_E * TRUSS_AREA * green * stretch;
    // Center shape gradient of the Tet4/Tri3 is -1/h in x. Six-volume
    // h^3 and membrane area h^2/2 cancel one power of h in nodal force.
    // The regular surrounding Hex8 cells cancel exactly at this interior node.
    let center_load_kn = -1_000.0 * h * h * tet_pxx / 6.0
        - 1_000.0 * h * MEMBRANE_T * stretch * membrane_sxx / 2.0
        - bar_axial_kn;
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    loads_kn[center][0] = center_load_kn;
    let mut prescribed_m: Vec<_> = nodes
        .iter()
        .map(|point| [Some(STRAIN * point[0]), Some(0.0), Some(0.0)])
        .collect();
    prescribed_m[center][0] = None;
    (
        FiniteJ2HexCoupledRequest {
            volume: FiniteJ2TetRequest {
                mesh: Mesh {
                    nodes,
                    tets: vec![[center, x, y, z]],
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
                    linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                    matrix_free_threads: 4,
                    ..FiniteJ2TetOptions::default()
                },
            },
            hexes,
            hex_targets: vec![FiniteJ2HexTarget::default()],
            trusses: vec![FiniteJ2CoupledTruss {
                nodes: [center, x],
                youngs_mpa: TRUSS_E,
                area_m2: TRUSS_AREA,
                plasticity: None,
            }],
            membranes: vec![FiniteJ2CoupledMembrane {
                nodes: [center, x, y],
                youngs_mpa: MEMBRANE_E,
                poisson: MEMBRANE_NU,
                thickness_m: MEMBRANE_T,
                plasticity: None,
            }],
        },
        hex_pxx,
        hex_alpha,
        bar_axial_kn,
        tet_pxx,
        membrane_sxx,
    )
}

fn check_case(cells: usize) {
    let started = std::time::Instant::now();
    let (request, hex_pxx, hex_alpha, bar_axial_kn, tet_pxx, membrane_sxx) = request(cells);
    assert!(hex_alpha > 0.0, "all Hex8 Gauss histories must plastify");
    let hex_count = cells * cells * cells;
    let node_count = (cells + 1).pow(3);
    assert_eq!(request.hexes.len(), hex_count);
    assert_eq!(request.volume.mesh.nodes.len(), node_count);
    assert_eq!(request.volume.mesh.nodes.len() * 3, 3 * node_count);
    let result = solve_hex_coupled(&request).unwrap();
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
    );
    assert_eq!(result.hex_gauss_states.len(), hex_count);
    assert_eq!(result.hex_gauss_first_piola_mpa.len(), hex_count);
    assert_eq!(result.element_states.len(), 1);
    assert_eq!(result.truss_axial_force_kn.len(), 1);
    assert_eq!(result.membrane_stress_mpa.len(), 1);
    let mut max_u_error = 0.0_f64;
    for (node, point) in request.volume.mesh.nodes.iter().enumerate() {
        let expected = [STRAIN * point[0], 0.0, 0.0];
        for axis in 0..3 {
            max_u_error =
                max_u_error.max((result.nodal_displacements_m[node][axis] - expected[axis]).abs());
        }
    }
    assert!(
        max_u_error < 2e-8,
        "maximum affine displacement error {max_u_error}"
    );
    let mut max_p_error = 0.0_f64;
    let mut max_alpha_error = 0.0_f64;
    for element in 0..hex_count {
        for gauss in 0..8 {
            max_p_error = max_p_error
                .max((result.hex_gauss_first_piola_mpa[element][gauss][0][0] - hex_pxx).abs());
            max_alpha_error = max_alpha_error.max(
                (result.hex_gauss_states[element][gauss].equivalent_plastic_strain - hex_alpha)
                    .abs(),
            );
        }
    }
    assert!(max_p_error < 2e-5, "maximum Hex8 Pxx error {max_p_error}");
    assert!(
        max_alpha_error < 2e-8,
        "maximum Hex8 alpha error {max_alpha_error}"
    );
    close(
        result.truss_axial_force_kn[0],
        bar_axial_kn,
        1e-5,
        "truss axial force",
    );
    close(
        result.element_first_piola_mpa[0][0][0],
        tet_pxx,
        2e-5,
        "Tet4 Pxx",
    );
    close(
        result.membrane_stress_mpa[0][0],
        membrane_sxx,
        2e-5,
        "Tri3 Sxx",
    );
    close(
        result.element_states[0].equivalent_plastic_strain,
        0.0,
        1e-12,
        "elastic Tet4",
    );
    assert!(result.true_free_residual_kn < 1e-4);
    for axis in 0..3 {
        let reaction: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        let applied: f64 = request.volume.targets[0]
            .loads_kn
            .iter()
            .map(|f| f[axis])
            .sum();
        close(reaction + applied, 0.0, 1e-4, "global equilibrium");
    }
    let right_face_reaction_x: f64 = request
        .volume
        .mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(
        right_face_reaction_x,
        1_000.0 * hex_pxx,
        2e-3,
        "right-face reaction",
    );
    eprintln!(
        "finite-J2 mixed scale: {hex_count} Hex8, 1 Tet4, 1 truss, 1 Tri3, {} DOF, 1 free, 4 threads, {} accepted steps, {} cutbacks, residual {:.3e} kN, {:.2?}",
        3 * node_count, result.accepted_steps.len(), result.cutbacks, result.true_free_residual_kn, started.elapsed()
    );
}

#[test]
fn thousand_hexes_with_tet_truss_membrane_match_affine_plastic_reference() {
    check_case(10);
}

#[test]
#[ignore = "release-scale acceptance; run explicitly with --ignored --release"]
fn four_thousand_hexes_with_tet_truss_membrane_match_affine_plastic_reference() {
    check_case(16);
}
