//! Large, simply supported hybrid Q4 square: frontal/backend parity and an
//! independent Navier series for uniform transverse pressure.

use std::f64::consts::PI;
use std::time::Instant;

use openaec_native_fem::hybrid_plate::{self, Request};
use openaec_native_fem::plate_bending::{LinearBackend, Material, Node, Support};
use openaec_native_fem::quad2d::Quad;

const CELLS: usize = 14;
const SIDE_M: f64 = 2.0;
const PRESSURE_KN_M2: f64 = -1.0;
const E_MPA: f64 = 30_000.0;
const NU: f64 = 0.2;
const THICKNESS_M: f64 = 0.1;
const MAX_FRONT_DOFS: usize = 64;

fn node_id(x: usize, y: usize) -> usize {
    1 + x + (CELLS + 1) * y
}

fn square_request() -> Request {
    let spacing = SIDE_M / CELLS as f64;
    let mut nodes = Vec::with_capacity((CELLS + 1).pow(2));
    let mut supports = Vec::with_capacity(4 * CELLS);
    for y in 0..=CELLS {
        for x in 0..=CELLS {
            let id = node_id(x, y);
            nodes.push(Node {
                id,
                x: spacing * x as f64,
                y: spacing * y as f64,
            });
            if x == 0 || x == CELLS || y == 0 || y == CELLS {
                supports.push(Support {
                    node_id: id,
                    w: true,
                    theta_x: false,
                    theta_y: false,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                });
            }
        }
    }
    let mut quads = Vec::with_capacity(CELLS * CELLS);
    for y in 0..CELLS {
        for x in 0..CELLS {
            quads.push(Quad {
                id: quads.len() + 1,
                node_ids: [
                    node_id(x, y),
                    node_id(x + 1, y),
                    node_id(x + 1, y + 1),
                    node_id(x, y + 1),
                ],
                material_id: 1,
                thickness_m: THICKNESS_M,
            });
        }
    }
    Request {
        nodes,
        materials: vec![Material {
            id: 1,
            e_mpa: E_MPA,
            nu: NU,
        }],
        orthotropic_materials: vec![],
        quads,
        supports,
        loads: vec![],
        edge_loads: vec![],
        pressure_kn_m2: PRESSURE_KN_M2,
        quad_pressures: vec![],
        modulus_curves: vec![],
        reinforcement: None,
        load_path: vec![],
        tolerance: 1e-8,
        max_iterations: 40,
        linear_backend: LinearBackend::FrontalWave,
        frontal_max_front_dofs: Some(MAX_FRONT_DOFS),
    }
}

fn navier_centre_deflection() -> f64 {
    // D ∇⁴w = q, with w = M_normal = 0 on all four edges.
    // The uniform load has sine coefficient 16q/(π²mn) for odd m and n.
    let rigidity = E_MPA * 1_000.0 * THICKNESS_M.powi(3) / (12.0 * (1.0 - NU * NU));
    let mut sum = 0.0;
    for m in (1_i32..=101).step_by(2) {
        for n in (1_i32..=101).step_by(2) {
            let sign = if ((m + n - 2) / 2) % 2 == 0 {
                1.0
            } else {
                -1.0
            };
            sum += sign / (f64::from(m * n) * f64::from((m * m + n * n).pow(2)));
        }
    }
    16.0 * PRESSURE_KN_M2 * SIDE_M.powi(4) * sum / (PI.powi(6) * rigidity)
}

fn assert_near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: frontal={actual:.12e}, existing={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

#[test]
fn frontal_hybrid_above_600_dof_matches_existing_and_navier_square() {
    let request = square_request();
    let dofs = 3 * request.nodes.len();
    assert_eq!(dofs, 675);
    assert_eq!(request.quads.len(), 196);

    let start = Instant::now();
    let frontal = hybrid_plate::solve(&request).unwrap();
    let frontal_time = start.elapsed();
    let mut existing_request = request;
    existing_request.linear_backend = LinearBackend::Existing;
    let start = Instant::now();
    let existing = hybrid_plate::solve(&existing_request).unwrap();
    let existing_time = start.elapsed();

    assert_eq!(frontal.linear_backend_used, LinearBackend::FrontalWave);
    assert_eq!(existing.linear_backend_used, LinearBackend::Existing);
    assert_eq!(frontal.nodes.len(), existing_request.nodes.len());
    assert_eq!(frontal.elements.len(), existing_request.quads.len());
    assert_eq!(existing.nodes.len(), frontal.nodes.len());
    assert_eq!(existing.elements.len(), frontal.elements.len());
    let front = frontal.frontal_maximum_front_dofs.unwrap();
    assert!(front > 0 && front <= MAX_FRONT_DOFS);
    assert!(frontal.relative_residual < 1e-8);
    assert!(existing.relative_residual < 1e-8);

    let analytical = navier_centre_deflection();
    let centre_w = frontal.nodes[node_id(CELLS / 2, CELLS / 2) - 1].w_m;
    let navier_error = (centre_w / analytical - 1.0).abs();
    eprintln!(
        "hybrid Q4 {CELLS}x{CELLS}, {dofs} DOF: w_center={centre_w:.9e} m, Navier={analytical:.9e} m, error={:.3}%, frontal residual={:.3e}, existing residual={:.3e}, max front={front}, frontal={frontal_time:?}, existing={existing_time:?}",
        100.0 * navier_error, frontal.relative_residual, existing.relative_residual,
    );
    assert!(centre_w < 0.0 && analytical < 0.0);
    assert!(navier_error < 0.03, "Navier error: {navier_error:.3e}");

    let displacement_scale = analytical.abs();
    for (a, b) in frontal.nodes.iter().zip(&existing.nodes) {
        assert_eq!(a.node_id, b.node_id);
        assert_near(a.w_m, b.w_m, 1e-6 * displacement_scale, "w");
        assert_near(
            a.theta_x_rad,
            b.theta_x_rad,
            1e-6 * displacement_scale / SIDE_M,
            "theta_x",
        );
        assert_near(
            a.theta_y_rad,
            b.theta_y_rad,
            1e-6 * displacement_scale / SIDE_M,
            "theta_y",
        );
        assert_near(a.reaction_fz_kn, b.reaction_fz_kn, 1e-7, "reaction_fz");
        assert_near(a.reaction_mx_knm, b.reaction_mx_knm, 1e-7, "reaction_mx");
        assert_near(a.reaction_my_knm, b.reaction_my_knm, 1e-7, "reaction_my");
    }
    for (a, b) in frontal.elements.iter().zip(&existing.elements) {
        assert_eq!(a.quad_id, b.quad_id);
        for axis in 0..3 {
            assert_near(
                a.moment_knm_per_m[axis],
                b.moment_knm_per_m[axis],
                1e-7,
                "centre moment",
            );
        }
        assert_eq!(a.resultant_samples.len(), b.resultant_samples.len());
        for (sample_a, sample_b) in a.resultant_samples.iter().zip(&b.resultant_samples) {
            assert_eq!(sample_a.position_m, sample_b.position_m);
            for axis in 0..3 {
                assert_near(
                    sample_a.moment_knm_per_m[axis],
                    sample_b.moment_knm_per_m[axis],
                    1e-7,
                    "sample moment",
                );
            }
        }
    }
    let reaction_fz: f64 = frontal.nodes.iter().map(|node| node.reaction_fz_kn).sum();
    assert_near(
        reaction_fz,
        -PRESSURE_KN_M2 * SIDE_M.powi(2),
        1e-8,
        "total vertical reaction",
    );
}
