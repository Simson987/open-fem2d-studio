//! Large, simply supported DKT square: backend parity and an independent
//! Navier series for a uniform transverse pressure.

use std::f64::consts::PI;

use openaec_native_fem::plate_bending::{
    self, LinearBackend, Load, Material, Node, Request, Support, Triangle,
};

const CELLS: usize = 14;
const SIDE_M: f64 = 2.0;
const PRESSURE_KN_M2: f64 = -1.0;
const E_MPA: f64 = 30_000.0;
const NU: f64 = 0.2;
const THICKNESS_M: f64 = 0.1;

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

    let mut triangles = Vec::with_capacity(2 * CELLS * CELLS);
    let mut nodal_forces = vec![0.0; nodes.len()];
    let triangle_area = spacing * spacing / 2.0;
    for y in 0..CELLS {
        for x in 0..CELLS {
            let lower_left = node_id(x, y);
            let lower_right = node_id(x + 1, y);
            let upper_right = node_id(x + 1, y + 1);
            let upper_left = node_id(x, y + 1);
            for node_ids in [
                [lower_left, lower_right, upper_right],
                [lower_left, upper_right, upper_left],
            ] {
                for id in node_ids {
                    // Integral of a constant pressure times each linear
                    // triangle corner shape function: q A / 3.
                    nodal_forces[id - 1] += PRESSURE_KN_M2 * triangle_area / 3.0;
                }
                triangles.push(Triangle {
                    id: triangles.len() + 1,
                    node_ids,
                    material_id: 1,
                    thickness_m: THICKNESS_M,
                });
            }
        }
    }
    let loads = nodal_forces
        .into_iter()
        .enumerate()
        .map(|(index, fz)| Load {
            node_id: index + 1,
            fz,
            mx: 0.0,
            my: 0.0,
        })
        .collect();

    Request {
        nodes,
        materials: vec![Material {
            id: 1,
            e_mpa: E_MPA,
            nu: NU,
        }],
        orthotropic_materials: vec![],
        modulus_curves: vec![],
        load_path: vec![],
        tolerance: 1e-8,
        max_iterations: 40,
        linear_backend: LinearBackend::FrontalWave,
        frontal_max_front_dofs: Some(64),
        triangles,
        supports,
        loads,
    }
}

fn navier_centre_deflection() -> f64 {
    // D nabla^4 w = q; on all four edges w = M_normal = 0.
    // Constant q has sine coefficient 16q/(pi^2 mn) for odd m,n.
    // The 101x101 odd-mode sum is converged well beyond the mesh error.
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

#[test]
fn frontal_dkt_above_600_dof_matches_existing_and_navier_square() {
    let request = square_request();
    let dofs = 3 * request.nodes.len();
    assert_eq!(dofs, 675);
    assert_eq!(request.triangles.len(), 392);
    let applied_fz: f64 = request.loads.iter().map(|load| load.fz).sum();
    assert!((applied_fz - PRESSURE_KN_M2 * SIDE_M.powi(2)).abs() < 1e-12);

    let frontal = plate_bending::solve(&request).unwrap();
    let mut existing_request = request;
    existing_request.linear_backend = LinearBackend::Existing;
    let existing = plate_bending::solve(&existing_request).unwrap();
    let centre = node_id(CELLS / 2, CELLS / 2) - 1;
    let analytical = navier_centre_deflection();
    let centre_w = frontal.nodes[centre].w_m;
    let navier_error = (centre_w / analytical - 1.0).abs();
    let front = frontal.frontal_maximum_front_dofs.unwrap();
    eprintln!(
        "DKT {} cells/side, {} triangles, {} DOF: w_center={centre_w:.9e} m, Navier={analytical:.9e} m, error={:.3}%, frontal residual={:.3e}, existing residual={:.3e}, max front={front}",
        CELLS, existing_request.triangles.len(), dofs, 100.0 * navier_error,
        frontal.relative_residual, existing.relative_residual,
    );
    assert!(front > 0 && front <= 64);
    assert!(frontal.relative_residual < 1e-8);
    assert!(existing.relative_residual < 1e-8);
    assert!(centre_w < 0.0 && analytical < 0.0);
    assert!(navier_error < 0.03, "Navier error: {navier_error:.3e}");

    for (a, b) in frontal.nodes.iter().zip(&existing.nodes) {
        let displacement_scale = analytical.abs();
        assert!((a.w_m - b.w_m).abs() < 1e-6 * displacement_scale);
        assert!((a.theta_x_rad - b.theta_x_rad).abs() < 1e-6 * displacement_scale / SIDE_M);
        assert!((a.theta_y_rad - b.theta_y_rad).abs() < 1e-6 * displacement_scale / SIDE_M);
        assert!((a.reaction_fz_kn - b.reaction_fz_kn).abs() < 1e-7);
        assert!((a.reaction_mx_knm - b.reaction_mx_knm).abs() < 1e-7);
        assert!((a.reaction_my_knm - b.reaction_my_knm).abs() < 1e-7);
    }
    for (a, b) in frontal.elements.iter().zip(&existing.elements) {
        for axis in 0..3 {
            assert!((a.moment_knm_per_m[axis] - b.moment_knm_per_m[axis]).abs() < 1e-7);
        }
    }
    let reaction_fz: f64 = frontal.nodes.iter().map(|node| node.reaction_fz_kn).sum();
    assert!((reaction_fz + applied_fz).abs() < 1e-8);
}
