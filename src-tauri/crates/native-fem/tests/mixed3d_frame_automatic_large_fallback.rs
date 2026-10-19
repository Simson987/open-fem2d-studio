//! More than 10,000 shared translational/rotational DOFs with narrow-front
//! bending members. Every arm has an independent Euler-Bernoulli cantilever
//! reference, while all arms share the same fixed root node.

use openaec_native_fem::mixed3d::{solve, Frame3dMixedElement, Mixed3dBackend, Mixed3dRequest};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const ARMS: usize = 2_000;
const E_MPA: f64 = 210_000.0;
const NU: f64 = 0.3;
const AREA_M2: f64 = 0.01;
const IY_M4: f64 = 0.00001;
const IZ_M4: f64 = 0.00002;
const J_M4: f64 = 0.000001;
const TIP_LOAD: [f64; 3] = [120.0, -10.0, 6.0];
const TIP_MOMENT: [f64; 3] = [2.0, 3.0, -4.0];

fn length(arm: usize) -> f64 {
    1.0 + arm as f64 / 10_000.0
}

fn model(backend: Mixed3dBackend, max_front_dofs: usize) -> Mixed3dRequest {
    let mut nodes = vec![[0.0; 3]];
    let mut frames = Vec::with_capacity(ARMS);
    for arm in 0..ARMS {
        nodes.push([length(arm), 0.0, 0.0]);
        frames.push(Frame3dMixedElement {
            nodes: [0, arm + 1],
            e_mpa: E_MPA,
            poisson: NU,
            g_mpa: None,
            area_m2: AREA_M2,
            iy_m4: IY_M4,
            iz_m4: IZ_M4,
            torsion_j_m4: J_M4,
            roll_angle_rad: 0.0,
        });
    }
    let mut loads_kn = vec![[0.0; 3]; ARMS + 1];
    let mut moments_knm = loads_kn.clone();
    for arm in 0..ARMS {
        loads_kn[arm + 1] = TIP_LOAD;
        moments_knm[arm + 1] = TIP_MOMENT;
    }
    let mut prescribed_m = vec![[None; 3]; ARMS + 1];
    prescribed_m[0] = [Some(0.0); 3];
    let mut prescribed_rotations_rad = prescribed_m.clone();
    prescribed_rotations_rad[0] = [Some(0.0); 3];
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![],
        },
        solid_material: Volume3dMaterial {
            e_mpa: E_MPA,
            poisson: NU,
        },
        tet_materials: None,
        hexes: vec![],
        trusses: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        frames,
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        loads_kn,
        moments_knm,
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m,
        prescribed_rotations_rad,
        backend,
        max_front_dofs,
        threads: 4,
        max_pcg_iterations: 1,
    }
}

fn close(actual: f64, expected: f64, scale: f64, label: &str) {
    let tolerance = 2e-7 * scale.max(expected.abs()).max(1e-8);
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn exact_tip(length: f64) -> [f64; 6] {
    let [fx, fy, fz] = TIP_LOAD;
    let [mx, my, mz] = TIP_MOMENT;
    let e = 1_000.0 * E_MPA;
    let g = e / (2.0 * (1.0 + NU));
    [
        fx * length / (e * AREA_M2),
        fy * length.powi(3) / (3.0 * e * IZ_M4) + mz * length.powi(2) / (2.0 * e * IZ_M4),
        fz * length.powi(3) / (3.0 * e * IY_M4) - my * length.powi(2) / (2.0 * e * IY_M4),
        mx * length / (g * J_M4),
        -fz * length.powi(2) / (2.0 * e * IY_M4) + my * length / (e * IY_M4),
        fy * length.powi(2) / (2.0 * e * IZ_M4) + mz * length / (e * IZ_M4),
    ]
}

#[test]
fn large_frame_automatic_falls_back_to_bounded_frontal_and_matches_beam_theory() {
    let input = model(Mixed3dBackend::Automatic, 16);
    let result = solve(&input).expect("large frame automatic fallback");
    assert_eq!(result.backend_used, Mixed3dBackend::FrontalWave);
    assert!(result.frontal_maximum_front_dofs.unwrap() <= 16);
    assert_eq!(result.nodal_displacements_m.len(), ARMS + 1);
    assert_eq!(result.frame_end_forces_local.len(), ARMS);
    assert!(result.relative_residual < 1e-8);

    for arm in 0..ARMS {
        let expected = exact_tip(length(arm));
        let actual = result.nodal_displacements_m[arm + 1];
        let rotation = result.nodal_rotations_rad[arm + 1].unwrap();
        for axis in 0..3 {
            close(
                actual[axis],
                expected[axis],
                expected[axis].abs(),
                "tip translation",
            );
            close(
                rotation[axis],
                expected[axis + 3],
                expected[axis + 3].abs(),
                "tip rotation",
            );
        }
    }
    let reaction = result.nodal_reactions_kn[0];
    for axis in 0..3 {
        close(
            reaction[axis],
            -(ARMS as f64) * TIP_LOAD[axis],
            (ARMS as f64) * TIP_LOAD[axis].abs(),
            "root force",
        );
    }
    let total_length: f64 = (0..ARMS).map(length).sum();
    let expected_root_moment = [
        -(ARMS as f64) * TIP_MOMENT[0],
        -(ARMS as f64) * TIP_MOMENT[1] + total_length * TIP_LOAD[2],
        -(ARMS as f64) * TIP_MOMENT[2] - total_length * TIP_LOAD[1],
    ];
    let root_moment = result.nodal_moment_reactions_knm[0].unwrap();
    for axis in 0..3 {
        close(
            root_moment[axis],
            expected_root_moment[axis],
            expected_root_moment[axis].abs(),
            "root moment",
        );
    }

    let oversized = model(Mixed3dBackend::Automatic, 4_096);
    let error = solve(&oversized).expect_err("oversized automatic frontal estimate");
    assert!(error.contains("did not converge"), "{error}");
    assert!(error.contains("frontal fallback skipped"), "{error}");
}
