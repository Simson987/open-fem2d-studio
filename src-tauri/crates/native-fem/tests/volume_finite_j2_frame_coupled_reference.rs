//! Independent infinitesimal reference for a Tet4 and a 12-DOF frame sharing
//! node 1 translations. A transverse force and two bending moments excite
//! both Euler--Bernoulli planes; an axial moment excites torsion.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_frame_coupled, FiniteJ2CoupledFrame, FiniteJ2FrameCoupledRequest, FiniteJ2FrameTarget,
    FiniteJ2HexCell, FiniteJ2HexTarget, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const SOLID_E: f64 = 100.0;
const FRAME_E: f64 = 200_000.0;
const NU: f64 = 0.3;
const IY: f64 = 1.5e-5;
const IZ: f64 = 1.0e-5;
const J: f64 = 2.0e-5;
const PY: f64 = 0.01;
const PZ: f64 = -0.007;
const MX: f64 = 0.003;
const MY: f64 = -0.002;
const MZ: f64 = 0.004;

fn request(backend: FiniteJ2TetLinearBackend) -> FiniteJ2FrameCoupledRequest {
    FiniteJ2FrameCoupledRequest {
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
            steel: FiniteJ2Steel::new(SOLID_E, NU, 1.0e9, 0.0).unwrap(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3], [0.0, PY, PZ], [0.0; 3], [0.0; 3]],
                prescribed_m: vec![
                    [Some(0.0); 3],
                    [Some(0.0), None, None],
                    [Some(0.0); 3],
                    [Some(0.0); 3],
                ],
                body_forces: vec![],
                face_tractions: vec![],
            }],
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                residual_tolerance: 1e-11,
                ..FiniteJ2TetOptions::default()
            },
        },
        hexes: vec![],
        hex_targets: vec![],
        trusses: vec![],
        membranes: vec![],
        frames: vec![FiniteJ2CoupledFrame {
            nodes: [0, 1],
            youngs_mpa: FRAME_E,
            poisson: NU,
            g_mpa: None,
            area_m2: 0.02,
            iy_m4: IY,
            iz_m4: IZ,
            torsion_j_m4: J,
            roll_angle_rad: 0.0,
        }],
        bending_plates: vec![],
        frame_targets: vec![FiniteJ2FrameTarget {
            moments_kn_m: vec![[0.0; 3], [MX, MY, MZ], [0.0; 3], [0.0; 3]],
            prescribed_rotation_rad: vec![[Some(0.0); 3], [None, None, None], [None; 3], [None; 3]],
        }],
        frame_member_load_targets: vec![],
        frame_member_point_load_targets: vec![],
    }
}

fn two_by_two(a: f64, b: f64, c: f64, force: f64, moment: f64) -> (f64, f64) {
    let determinant = a * c - b * b;
    (
        (c * force - b * moment) / determinant,
        (a * moment - b * force) / determinant,
    )
}

#[test]
fn full_frame_force_moment_reference_and_backend_parity() {
    // Independent small-strain Tet4 shear: grad(N1)=(1,0,0), V=1/6.
    let solid_shear = 1_000.0 * SOLID_E / (2.0 * (1.0 + NU)) / 6.0;
    let eiy = 1_000.0 * FRAME_E * IY;
    let eiz = 1_000.0 * FRAME_E * IZ;
    let gj = 1_000.0 * FRAME_E / (2.0 * (1.0 + NU)) * J;
    let (expected_uy, expected_rz) =
        two_by_two(solid_shear + 12.0 * eiz, -6.0 * eiz, 4.0 * eiz, PY, MZ);
    let (expected_uz, expected_ry) =
        two_by_two(solid_shear + 12.0 * eiy, 6.0 * eiy, 4.0 * eiy, PZ, MY);
    let expected_rx = MX / gj;
    let mut baseline: Option<([f64; 3], [f64; 3])> = None;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let solved = solve_frame_coupled(&request(backend)).unwrap();
        let u = solved.nodal_displacements_m[1];
        let r = solved.nodal_rotations_rad[1];
        let end = solved.frame_end_forces_local[0];
        assert!((u[1] - expected_uy).abs() < 2e-9, "{backend:?} uy");
        assert!((u[2] - expected_uz).abs() < 2e-9, "{backend:?} uz");
        assert!((r[0] - expected_rx).abs() < 2e-9, "{backend:?} torsion");
        assert!((r[1] - expected_ry).abs() < 2e-9, "{backend:?} bending y");
        assert!((r[2] - expected_rz).abs() < 2e-9, "{backend:?} bending z");
        assert!(
            (end[1][3] - MX).abs() < 1e-8,
            "{backend:?} torsional end action"
        );
        assert!(
            (end[1][4] - MY).abs() < 1e-8,
            "{backend:?} y bending end action"
        );
        assert!(
            (end[1][5] - MZ).abs() < 1e-8,
            "{backend:?} z bending end action"
        );
        assert!(
            (end[1][1] + solid_shear * u[1] - PY).abs() < 1e-7,
            "{backend:?} coupled y shear"
        );
        assert!(
            (end[1][2] + solid_shear * u[2] - PZ).abs() < 1e-7,
            "{backend:?} coupled z shear"
        );
        assert!(solved.true_free_residual_kn < 1e-7, "{backend:?} residual");
        if let Some((u0, r0)) = baseline {
            for axis in 0..3 {
                assert!(
                    (u[axis] - u0[axis]).abs() < 1e-10,
                    "{backend:?} translation parity"
                );
                assert!(
                    (r[axis] - r0[axis]).abs() < 1e-10,
                    "{backend:?} rotation parity"
                );
            }
        } else {
            baseline = Some((u, r));
        }
    }
}

#[test]
fn typed_dispatch_carries_full_frame_results() {
    let json = serde_json::json!({
        "kind": "volume3dFiniteJ2FrameCoupled",
        "input": request(FiniteJ2TetLinearBackend::Dense),
    });
    let request: NativeFemRequest = serde_json::from_value(json).unwrap();
    let solved = solve_native_fem(request).unwrap();
    let NativeFemResult::Volume3dFiniteJ2FrameCoupled(result) = solved else {
        panic!("wrong dispatch result variant");
    };
    let serialized = serde_json::to_value(result).unwrap();
    assert!(serialized.get("frameEndForcesLocal").is_some());
}

#[test]
fn frame_target_rejects_moment_on_solid_only_node() {
    let mut input = request(FiniteJ2TetLinearBackend::Dense);
    input.frame_targets[0].moments_kn_m[2][0] = 1.0;
    assert!(solve_frame_coupled(&input)
        .unwrap_err()
        .contains("solid-only rotation"));
}

#[test]
fn hex8_shared_translation_drives_frame_bending() {
    let nodes = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ];
    let delta = 1e-5;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
    ] {
        let mut input = request(backend);
        input.volume.mesh = Mesh {
            nodes: nodes.clone(),
            tets: vec![],
        };
        input.volume.targets[0].loads_kn = vec![[0.0; 3]; 8];
        input.volume.targets[0].prescribed_m = vec![[Some(0.0); 3]; 8];
        input.volume.targets[0].prescribed_m[1][1] = Some(delta);
        input.hexes = vec![FiniteJ2HexCell {
            nodes: [0, 1, 2, 3, 4, 5, 6, 7],
            steel: FiniteJ2Steel::new(SOLID_E, NU, 1e9, 0.0).unwrap(),
        }];
        input.hex_targets = vec![FiniteJ2HexTarget::default()];
        input.frame_targets[0].moments_kn_m = vec![[0.0; 3]; 8];
        input.frame_targets[0].prescribed_rotation_rad = vec![[None; 3]; 8];
        input.frame_targets[0].prescribed_rotation_rad[0] = [Some(0.0); 3];
        input.frame_targets[0].prescribed_rotation_rad[1] = [Some(0.0), Some(0.0), None];
        let solved = solve_frame_coupled(&input).unwrap();
        let ei = 1_000.0 * FRAME_E * IZ;
        assert!((solved.nodal_rotations_rad[1][2] - 1.5 * delta).abs() < 1e-11);
        assert!((solved.frame_end_forces_local[0][1][1] - 3.0 * ei * delta).abs() < 1e-8);
        assert!(solved.frame_end_forces_local[0][1][5].abs() < 1e-8);
        assert_eq!(solved.hex_gauss_states.len(), 1);
    }
}
