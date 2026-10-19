//! Independent Kirchhoff constant-curvature reference for recovered elastic
//! XY-DKT centroid moments in the shared finite-J2 Tet4/DKT/3D-frame route.
//! The plate remains a *linear* reference-surface law in this route; the
//! surrounding Tet4 uses the finite-strain J2 material implementation.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_frame_coupled, FiniteJ2CoupledBendingPlate, FiniteJ2CoupledFrame,
    FiniteJ2FrameCoupledRequest, FiniteJ2FrameTarget, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const E_PLATE_MPA: f64 = 30_000.0;
const NU: f64 = 0.2;
const KAPPA: [f64; 3] = [0.002, -0.001, 0.0006];
const TIP_LOAD_KN: f64 = 0.5;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn kirchhoff_moments(thickness_m: f64, curvature: [f64; 3]) -> [f64; 3] {
    // For κ=[w_xx,w_yy,2w_xy], M=D[κx+νκy, νκx+κy,
    // (1−ν)κxy/2]. MPa to kN/m² multiplies E by 1000.
    let d = E_PLATE_MPA * 1_000.0 * thickness_m.powi(3) / (12.0 * (1.0 - NU * NU));
    let [kx, ky, gamma_xy] = curvature;
    [
        d * (kx + NU * ky),
        d * (NU * kx + ky),
        d * (1.0 - NU) * gamma_xy / 2.0,
    ]
}

fn analytic_field(x: f64, y: f64, z: f64, curvature: [f64; 3]) -> ([f64; 3], [f64; 3]) {
    let [kx, ky, gamma_xy] = curvature;
    let w = 0.5 * kx * x * x + 0.5 * ky * y * y + 0.5 * gamma_xy * x * y;
    // Physical right-handed 3D rotations: Rx=dw/dy, Ry=-dw/dx. The XY-DKT
    // local kinematic rotation tuple is (-Rx,-Ry), so the mixed term matters.
    let rx = ky * y + 0.5 * gamma_xy * x;
    let ry = -kx * x - 0.5 * gamma_xy * y;
    ([ry * z, -rx * z, w], [rx, ry, 0.0])
}

fn patch(
    backend: FiniteJ2TetLinearBackend,
    reversed: bool,
    thickness_m: f64,
    curvatures: &[[f64; 3]],
) -> FiniteJ2FrameCoupledRequest {
    // Eight top-surface triangles form a 2×2 DKT patch. Each is also the
    // base of one positively oriented Tet4 to a shared apex, so every plate
    // vertex is genuinely volume-supported. The frame shares corner node 0.
    let mut nodes = Vec::new();
    for j in 0..=2 {
        for i in 0..=2 {
            nodes.push([i as f64 / 2.0, j as f64 / 2.0, 0.0]);
        }
    }
    nodes.push([0.0, 0.0, 1.0]); // volume apex: node 9
    nodes.push([-1.0, 0.0, 0.0]); // frame-only tip: node 10

    let id = |i: usize, j: usize| i + 3 * j;
    let mut faces = Vec::new();
    for j in 0..2 {
        for i in 0..2 {
            let (a, b, c, d) = (id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1));
            faces.extend([[a, b, d], [a, d, c]]);
        }
    }
    let tets = faces
        .iter()
        .map(|face| [face[0], face[1], face[2], 9])
        .collect();
    let bending_plates = faces
        .iter()
        .map(|&face| FiniteJ2CoupledBendingPlate {
            nodes: if reversed {
                [face[0], face[2], face[1]]
            } else {
                face
            },
            youngs_mpa: E_PLATE_MPA,
            poisson: NU,
            thickness_m,
        })
        .collect();
    let targets = curvatures
        .iter()
        .map(|&curvature| {
            let mut prescribed_m = nodes
                .iter()
                .map(|&[x, y, z]| analytic_field(x, y, z, curvature).0.map(Some))
                .collect::<Vec<_>>();
            // A genuine free frame bending displacement; all plate motions
            // are prescribed analytically so their recovery is kinematic and
            // independent of how the nonlinear solid resolves its stresses.
            prescribed_m[10][2] = None;
            let mut loads_kn = vec![[0.0; 3]; nodes.len()];
            loads_kn[10][2] = if curvature == [0.0; 3] {
                0.0
            } else {
                TIP_LOAD_KN
            };
            FiniteJ2TetTarget {
                loads_kn,
                prescribed_m,
                body_forces: vec![],
                face_tractions: vec![],
            }
        })
        .collect();
    let frame_targets = curvatures
        .iter()
        .map(|&curvature| {
            let mut prescribed_rotation_rad = nodes
                .iter()
                .map(|&[x, y, z]| analytic_field(x, y, z, curvature).1.map(Some))
                .collect::<Vec<_>>();
            prescribed_rotation_rad[10][1] = None;
            FiniteJ2FrameTarget {
                moments_kn_m: vec![[0.0; 3]; nodes.len()],
                prescribed_rotation_rad,
            }
        })
        .collect();
    FiniteJ2FrameCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: Mesh { nodes, tets },
            steel: FiniteJ2Steel::new(120.0, NU, 1e9, 0.0).unwrap(),
            element_steels: None,
            targets,
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                residual_tolerance: 1e-10,
                matrix_free_threads: 2,
                ..FiniteJ2TetOptions::default()
            },
        },
        hexes: vec![],
        hex_targets: vec![],
        trusses: vec![],
        membranes: vec![],
        frames: vec![FiniteJ2CoupledFrame {
            nodes: [0, 10],
            youngs_mpa: 200_000.0,
            poisson: NU,
            g_mpa: None,
            area_m2: 0.01,
            iy_m4: 1e-6,
            iz_m4: 1e-6,
            torsion_j_m4: 1e-6,
            roll_angle_rad: 0.0,
        }],
        bending_plates,
        frame_targets,
        frame_member_load_targets: vec![],
        frame_member_point_load_targets: vec![],
    }
}

#[test]
fn finite_j2_shared_system_recovers_quadratic_dkt_moments_in_input_order() {
    let expected = kirchhoff_moments(0.1, KAPPA);
    // Closed form, independent of the DKT recovery code: [4.6875,-1.5625,
    // 0.625] kN m/m for this material, thickness and curvature.
    near(expected[0], 4.6875, 1e-12, "analytic Mx");
    near(expected[1], -1.5625, 1e-12, "analytic My");
    near(expected[2], 0.625, 1e-12, "analytic Mxy");
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        for reversed in [false, true] {
            let solved = solve_frame_coupled(&patch(backend, reversed, 0.1, &[KAPPA]))
                .unwrap_or_else(|error| panic!("{backend:?}, reversed={reversed}: {error}"));
            assert_eq!(solved.bending_plate_moments_knm_per_m.len(), 8);
            assert_eq!(solved.element_states.len(), 8);
            assert_eq!(solved.frame_end_forces_local.len(), 1);
            for (triangle, moment) in solved.bending_plate_moments_knm_per_m.iter().enumerate() {
                for axis in 0..3 {
                    near(
                        moment[axis],
                        expected[axis],
                        2e-6,
                        &format!(
                            "{backend:?} winding={reversed} triangle={triangle} moment={axis}"
                        ),
                    );
                }
            }
            near(
                solved.nodal_displacements_m[4][2],
                analytic_field(0.5, 0.5, 0.0, KAPPA).0[2],
                1e-12,
                "interior plate w",
            );
            assert!(solved.nodal_displacements_m[10][2].abs() > 1e-5);
            assert!(solved.true_free_residual_kn < 1e-6);
        }
    }
}

#[test]
fn moment_recovery_uses_final_absolute_target_and_scales_with_t_cubed() {
    let path = [KAPPA, [0.0; 3], KAPPA];
    let unloaded = solve_frame_coupled(&patch(
        FiniteJ2TetLinearBackend::Dense,
        false,
        0.1,
        &path[..2],
    ))
    .unwrap();
    for moment in &unloaded.bending_plate_moments_knm_per_m {
        for &component in moment {
            near(component, 0.0, 1e-10, "unloaded plate moment");
        }
    }
    let thin =
        solve_frame_coupled(&patch(FiniteJ2TetLinearBackend::Dense, false, 0.1, &path)).unwrap();
    let thick =
        solve_frame_coupled(&patch(FiniteJ2TetLinearBackend::Dense, true, 0.2, &path)).unwrap();
    for (triangle, (a, b)) in thin
        .bending_plate_moments_knm_per_m
        .iter()
        .zip(&thick.bending_plate_moments_knm_per_m)
        .enumerate()
    {
        for axis in 0..3 {
            near(
                a[axis],
                kirchhoff_moments(0.1, KAPPA)[axis],
                2e-6,
                &format!("thin triangle={triangle} moment={axis}"),
            );
            near(b[axis], 8.0 * a[axis], 2e-5, "thickness cubed after reload");
        }
    }
    assert!(thin
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    assert!(thin
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 2));
    assert!(thin.true_free_residual_kn < 1e-6);
}

#[test]
fn heterogeneous_thickness_recovers_one_analytic_moment_per_input_triangle() {
    let mut input = patch(FiniteJ2TetLinearBackend::Dense, true, 0.1, &[KAPPA]);
    for (index, plate) in input.bending_plates.iter_mut().enumerate() {
        plate.thickness_m = 0.08 + index as f64 * 0.01;
    }
    let solved = solve_frame_coupled(&input).unwrap();
    assert_eq!(solved.bending_plate_moments_knm_per_m.len(), 8);
    for (index, plate) in input.bending_plates.iter().enumerate() {
        let expected = kirchhoff_moments(plate.thickness_m, KAPPA);
        for axis in 0..3 {
            near(
                solved.bending_plate_moments_knm_per_m[index][axis],
                expected[axis],
                2e-6,
                &format!("input triangle={index} moment={axis}"),
            );
        }
    }
}

#[test]
fn zero_curvature_and_absent_plates_have_no_recovered_moments() {
    let mut no_plate = patch(FiniteJ2TetLinearBackend::Dense, false, 0.1, &[[0.0; 3]]);
    let rigid = solve_frame_coupled(&no_plate).unwrap();
    assert_eq!(rigid.bending_plate_moments_knm_per_m.len(), 8);
    for moment in &rigid.bending_plate_moments_knm_per_m {
        for &component in moment {
            near(component, 0.0, 1e-10, "zero-curvature moment");
        }
    }
    no_plate.bending_plates.clear();
    let solved = solve_frame_coupled(&no_plate).unwrap();
    assert!(solved.bending_plate_moments_knm_per_m.is_empty());
}
