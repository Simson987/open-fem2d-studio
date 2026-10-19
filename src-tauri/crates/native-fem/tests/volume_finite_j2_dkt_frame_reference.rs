//! Independent finite-strain Hencky shear + elastic DKT + guided 3D frame
//! reference on a single shared free displacement. The DKT plate itself is
//! deliberately linear; only the attached volume uses finite-strain J2.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_frame_coupled, FiniteJ2CoupledBendingPlate, FiniteJ2CoupledFrame,
    FiniteJ2FrameCoupledRequest, FiniteJ2FrameTarget, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const SOLID_E_MPA: f64 = 120.0;
const NU: f64 = 0.2;
const PLATE_E_MPA: f64 = 30_000.0;
const PLATE_T_M: f64 = 0.1;
const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_IY_M4: f64 = 1e-6;
const GAMMA: f64 = 0.08;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn solid_shear_force(gamma: f64) -> f64 {
    // F = I + gamma (e_z ⊗ e_x), det(F)=1. The principal logarithmic
    // stretches are ±asinh(gamma/2), 0; hence W=2*mu*asinh(gamma/2)^2.
    // Differentiating W with respect to gamma yields the nominal P_zx.
    // The unit tetrahedron contributes its reference volume V=1/6 m³.
    let mu = SOLID_E_MPA / (2.0 * (1.0 + NU));
    let p_zx = 2.0 * mu * (gamma / 2.0).asinh() / (1.0 + (gamma / 2.0).powi(2)).sqrt();
    1_000.0 * p_zx / 6.0
}

fn plate_stiffness() -> f64 {
    // For the right DKT triangle (0,0), (1,0), (0,1), with only node 1's
    // w active, exact curvature integration gives Kww=D*(45-3*nu)/8.
    let d = 1_000.0 * PLATE_E_MPA * PLATE_T_M.powi(3) / (12.0 * (1.0 - NU.powi(2)));
    d * (45.0 - 3.0 * NU) / 8.0
}

fn frame_stiffness() -> f64 {
    // A unit Euler-Bernoulli member along X, fixed end and restrained end
    // rotations, carries guided transverse force 12 E Iy * w / L³.
    12.0 * 1_000.0 * FRAME_E_MPA * FRAME_IY_M4
}

fn target(load_kn: f64) -> FiniteJ2TetTarget {
    let mut loads = vec![[0.0; 3]; 5];
    loads[1][2] = load_kn;
    let mut prescribed = vec![[Some(0.0); 3]; 5];
    prescribed[1][2] = None;
    FiniteJ2TetTarget {
        loads_kn: loads,
        prescribed_m: prescribed,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn frame_target() -> FiniteJ2FrameTarget {
    FiniteJ2FrameTarget {
        moments_kn_m: vec![[0.0; 3]; 5],
        prescribed_rotation_rad: vec![[Some(0.0); 3]; 5],
    }
}

fn model(backend: FiniteJ2TetLinearBackend, winding_reversed: bool) -> FiniteJ2FrameCoupledRequest {
    let load = solid_shear_force(GAMMA) + (plate_stiffness() + frame_stiffness()) * GAMMA;
    FiniteJ2FrameCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: Mesh {
                nodes: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                    [2.0, 0.0, 0.0],
                ],
                tets: vec![[0, 1, 2, 3]],
            },
            steel: FiniteJ2Steel::new(SOLID_E_MPA, NU, 1.0e9, 0.0).unwrap(),
            element_steels: None,
            targets: vec![target(load)],
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
            nodes: [1, 4],
            youngs_mpa: FRAME_E_MPA,
            poisson: NU,
            g_mpa: None,
            area_m2: 0.01,
            iy_m4: FRAME_IY_M4,
            iz_m4: FRAME_IY_M4,
            torsion_j_m4: FRAME_IY_M4,
            roll_angle_rad: 0.0,
        }],
        bending_plates: vec![FiniteJ2CoupledBendingPlate {
            nodes: if winding_reversed {
                [0, 2, 1]
            } else {
                [0, 1, 2]
            },
            youngs_mpa: PLATE_E_MPA,
            poisson: NU,
            thickness_m: PLATE_T_M,
        }],
        frame_targets: vec![frame_target()],
        frame_member_load_targets: vec![],
        frame_member_point_load_targets: vec![],
    }
}

#[test]
fn finite_hencky_shear_dkt_and_guided_frame_share_newton_equilibrium() {
    let load = solid_shear_force(GAMMA) + (plate_stiffness() + frame_stiffness()) * GAMMA;
    // The finite-strain correction is resolvable at the chosen shear.
    let linear_solid = 1_000.0 * SOLID_E_MPA / (2.0 * (1.0 + NU)) * GAMMA / 6.0;
    assert!((linear_solid - solid_shear_force(GAMMA)).abs() > 0.1);
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        for reversed in [false, true] {
            let solved = solve_frame_coupled(&model(backend, reversed))
                .unwrap_or_else(|error| panic!("{backend:?}, reversed={reversed}: {error}"));
            near(solved.nodal_displacements_m[1][2], GAMMA, 2e-8, "shared uz");
            near(
                solved.element_first_piola_mpa[0][2][0],
                solid_shear_force(GAMMA) * 6.0 / 1_000.0,
                2e-7,
                "finite-strain solid P_zx",
            );
            near(
                solved.nodal_reactions_kn[4][2],
                -frame_stiffness() * GAMMA,
                2e-5,
                "guided frame tip reaction",
            );
            near(solved.nodal_reactions_kn[1][2], 0.0, 2e-5, "free residual");
            let sum_z: f64 = solved
                .nodal_reactions_kn
                .iter()
                .map(|reaction| reaction[2])
                .sum();
            near(sum_z, -load, 2e-5, "vertical equilibrium");
            near(
                solved.element_states[0].equivalent_plastic_strain,
                0.0,
                1e-14,
                "high-yield elastic solid",
            );
            assert!(solved.true_free_residual_kn < 2e-5);
        }
    }
}

#[test]
fn unloading_and_reloading_keep_elastic_plate_and_solid_reactions_consistent() {
    let mut input = model(FiniteJ2TetLinearBackend::Dense, false);
    let loaded = input.volume.targets[0].clone();
    input.volume.targets = vec![loaded.clone(), target(0.0)];
    input.frame_targets = vec![frame_target(), frame_target()];
    let unloaded = solve_frame_coupled(&input).unwrap();
    near(
        unloaded.nodal_displacements_m[1][2],
        0.0,
        2e-9,
        "unloaded uz",
    );
    near(
        unloaded.nodal_reactions_kn[4][2],
        0.0,
        2e-5,
        "unloaded frame reaction",
    );
    near(
        unloaded.element_states[0].equivalent_plastic_strain,
        0.0,
        1e-14,
        "unloaded elastic history",
    );
    input.volume.targets.push(loaded);
    input.frame_targets = vec![frame_target(), frame_target(), frame_target()];
    let solved = solve_frame_coupled(&input).unwrap();
    near(
        solved.nodal_displacements_m[1][2],
        GAMMA,
        2e-8,
        "reloaded uz",
    );
    near(
        solved.element_states[0].equivalent_plastic_strain,
        0.0,
        1e-14,
        "elastic history",
    );
    assert!(solved
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    assert!(solved
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 2));
    assert!(solved.true_free_residual_kn < 2e-5);
}

#[test]
fn coupled_dkt_rejects_nonhorizontal_and_nonvolume_vertices() {
    let mut input = model(FiniteJ2TetLinearBackend::Dense, false);
    input.bending_plates[0].nodes = [0, 1, 3];
    assert!(solve_frame_coupled(&input)
        .unwrap_err()
        .contains("horizontal XY"));
    input.bending_plates[0].nodes = [0, 1, 4];
    assert!(solve_frame_coupled(&input)
        .unwrap_err()
        .contains("Tet4/Hex8-supported"));
}

#[test]
fn plate_only_rotation_is_active_and_plate_only_drilling_moment_is_rejected() {
    let mut baseline = None;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let mut input = model(backend, false);
        input.volume.targets[0].loads_kn[1][2] = 0.0;
        input.volume.targets[0].prescribed_m[1][2] = Some(0.0);
        input.frame_targets[0].moments_kn_m[0][0] = 1.0;
        input.frame_targets[0].prescribed_rotation_rad[0][0] = None;
        let solved = solve_frame_coupled(&input).unwrap();
        let rx = solved.nodal_rotations_rad[0][0];
        assert!(rx.is_finite() && rx > 0.0, "{backend:?}: rx={rx}");
        near(
            solved.nodal_reaction_moments_kn_m[0][0],
            0.0,
            1e-7,
            "free rotation residual",
        );
        if let Some(reference) = baseline {
            near(rx, reference, 1e-9, "rotation backend parity");
        } else {
            baseline = Some(rx);
        }
    }
    let mut invalid = model(FiniteJ2TetLinearBackend::Dense, false);
    invalid.frame_targets[0].moments_kn_m[0][2] = 1.0;
    assert!(solve_frame_coupled(&invalid)
        .unwrap_err()
        .contains("solid-only rotation"));
}

#[test]
fn typed_dispatch_preserves_coupled_dkt_input_and_result() {
    let input = model(FiniteJ2TetLinearBackend::Dense, false);
    let value = serde_json::json!({
        "kind": "volume3dFiniteJ2FrameCoupled",
        "input": input,
    });
    let request: NativeFemRequest = serde_json::from_value(value).unwrap();
    let NativeFemResult::Volume3dFiniteJ2FrameCoupled(result) = solve_native_fem(request).unwrap()
    else {
        panic!("wrong dispatch result variant");
    };
    near(
        result.nodal_displacements_m[1][2],
        GAMMA,
        2e-8,
        "dispatched shared uz",
    );
    assert_eq!(result.nodal_rotations_rad.len(), 5);
    assert!(result.true_free_residual_kn < 2e-5);
}

#[test]
fn plastic_tet_history_is_unchanged_by_elastic_plate_on_a_prescribed_shear_path() {
    // Prescribing the same one active shear coordinate in both models makes
    // the Tet4 and frame histories identical. The *difference* in the nodal
    // reaction is then solely the independently integrated elastic DKT Kww*u.
    // This exercises committed J2 history in the shared assembly without
    // assuming or inventing a separate plate plasticity law.
    let path = [0.06, 0.0, 0.04];
    let mut plastic_history = Vec::with_capacity(path.len());
    for prefix in 1..=path.len() {
        let build = |with_plate: bool| {
            let mut input = model(FiniteJ2TetLinearBackend::Dense, false);
            input.volume.steel = FiniteJ2Steel::new(SOLID_E_MPA, NU, 1.0, 20.0).unwrap();
            input.volume.targets = path[..prefix]
                .iter()
                .map(|&gamma| {
                    let mut step = target(0.0);
                    step.prescribed_m[1][2] = Some(gamma);
                    step
                })
                .collect();
            input.frame_targets = vec![frame_target(); prefix];
            if !with_plate {
                input.bending_plates.clear();
            }
            input
        };
        let with_plate = solve_frame_coupled(&build(true)).unwrap();
        let without_plate = solve_frame_coupled(&build(false)).unwrap();
        let gamma = path[prefix - 1];
        near(
            with_plate.nodal_reactions_kn[1][2] - without_plate.nodal_reactions_kn[1][2],
            plate_stiffness() * gamma,
            2e-6,
            "plastic-path DKT reaction increment",
        );
        near(
            with_plate.element_states[0].equivalent_plastic_strain,
            without_plate.element_states[0].equivalent_plastic_strain,
            1e-12,
            "Tet4 committed plastic history",
        );
        for axis in 0..3 {
            for column in 0..3 {
                near(
                    with_plate.element_first_piola_mpa[0][axis][column],
                    without_plate.element_first_piola_mpa[0][axis][column],
                    1e-10,
                    "Tet4 first Piola stress",
                );
            }
        }
        assert!(with_plate
            .accepted_steps
            .iter()
            .any(|step| step.target_index == prefix - 1));
        plastic_history.push(with_plate.element_states[0].equivalent_plastic_strain);
    }
    assert!(plastic_history[0] > 0.0, "first shear target must yield");
    assert!(
        plastic_history[1] > 0.0,
        "unloading must retain J2 plastic history"
    );
    assert!(
        plastic_history[2] >= plastic_history[1],
        "reloading cannot erase J2 history"
    );
}
