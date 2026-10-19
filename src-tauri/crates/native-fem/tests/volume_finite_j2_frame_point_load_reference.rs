//! Independent off-centre transverse point-load references for a frame sharing
//! nodes with a finite-strain J2 Tet4 and elastic horizontal XY-DKT plate.
//!
//! The work-equivalent vector is P times the four Euler--Bernoulli Hermite
//! shape functions at the load abscissa, as in University of Florida EML 4500
//! lecture 05, slide 32: https://web.mae.ufl.edu/nkim/eml5526/lect05.pdf
//! Local +Y and +Z are global +Y/+Z for this +X, zero-roll frame. Positive
//! local +Y bending slope is +Rz; positive local +Z slope is -Ry.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_frame_coupled, FiniteJ2CoupledBendingPlate, FiniteJ2CoupledFrame,
    FiniteJ2CoupledFrameMemberPointLoad, FiniteJ2FrameCoupledRequest, FiniteJ2FrameTarget,
    FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const SOLID_E_MPA: f64 = 120.0;
const NU: f64 = 0.2;
const PLATE_E_MPA: f64 = 30_000.0;
const PLATE_T_M: f64 = 0.1;
const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_I_M4: f64 = 1e-6;
const L: f64 = 1.0;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

#[derive(Clone, Copy, Debug)]
enum Plane {
    LocalY,
    LocalZ,
}

impl Plane {
    fn force_axis(self) -> usize {
        match self {
            Self::LocalY => 1,
            Self::LocalZ => 2,
        }
    }

    fn moment_axis(self) -> usize {
        match self {
            Self::LocalY => 5,
            Self::LocalZ => 4,
        }
    }

    fn rotation_axis(self) -> usize {
        match self {
            Self::LocalY => 2,
            Self::LocalZ => 1,
        }
    }

    fn slope_rotation_sign(self) -> f64 {
        match self {
            Self::LocalY => 1.0,
            Self::LocalZ => -1.0,
        }
    }

    fn point(self, p: f64, a: f64) -> FiniteJ2CoupledFrameMemberPointLoad {
        FiniteJ2CoupledFrameMemberPointLoad {
            element: 0,
            py_kn: if self.force_axis() == 1 { p } else { 0.0 },
            pz_kn: if self.force_axis() == 2 { p } else { 0.0 },
            position_m: a,
        }
    }

    fn equivalent(self, p: f64, a: f64) -> [f64; 12] {
        // N1=1-3t²+2t³, N2=L(t-2t²+t³), N3=3t²-2t³,
        // N4=L(-t²+t³); +Z rotation is -Ry, changing N2/N4 signs.
        let t = a / L;
        let n = [
            1.0 - 3.0 * t * t + 2.0 * t * t * t,
            L * (t - 2.0 * t * t + t * t * t),
            3.0 * t * t - 2.0 * t * t * t,
            L * (-t * t + t * t * t),
        ];
        let mut f = [0.0; 12];
        match self {
            Self::LocalY => {
                for (i, dof) in [1, 5, 7, 11].into_iter().enumerate() {
                    f[dof] = p * n[i];
                }
            }
            Self::LocalZ => {
                for (i, dof) in [2, 4, 8, 10].into_iter().enumerate() {
                    f[dof] = p * n[i] * if i % 2 == 0 { 1.0 } else { -1.0 };
                }
            }
        }
        f
    }
}

fn solid_shear_force_kn(gamma: f64) -> f64 {
    // Incompressible simple shear F=I+gamma(e_i⊗e_x): principal logarithmic
    // stretches ±asinh(gamma/2),0. Differentiate W=2µ asinh(gamma/2)^2 and
    // multiply by the reference Tet4 volume 1/6 m³. This is finite-strain.
    let mu_mpa = SOLID_E_MPA / (2.0 * (1.0 + NU));
    let p_mpa = 2.0 * mu_mpa * (gamma / 2.0).asinh() / (1.0 + (gamma / 2.0).powi(2)).sqrt();
    1_000.0 * p_mpa / 6.0
}

fn plate_guided_stiffness_kn_per_m() -> f64 {
    // Exact right-triangle DKT coefficient for node 1 Uz with all rotations
    // held: Kww=D(45-3ν)/8, D=Et³/[12(1-ν²)].
    let d = 1_000.0 * PLATE_E_MPA * PLATE_T_M.powi(3) / (12.0 * (1.0 - NU.powi(2)));
    d * (45.0 - 3.0 * NU) / 8.0
}

fn frame_guided_stiffness_kn_per_m() -> f64 {
    12.0 * 1_000.0 * FRAME_E_MPA * FRAME_I_M4 / L.powi(3)
}

fn model(
    backend: FiniteJ2TetLinearBackend,
    plane: Plane,
    p: f64,
    a: f64,
) -> FiniteJ2FrameCoupledRequest {
    let mut prescribed = vec![[Some(0.0); 3]; 5];
    prescribed[1][plane.force_axis()] = None;
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
            steel: FiniteJ2Steel::new(SOLID_E_MPA, NU, 1e9, 0.0).unwrap(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; 5],
                prescribed_m: prescribed,
                body_forces: vec![],
                face_tractions: vec![],
            }],
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
            iy_m4: FRAME_I_M4,
            iz_m4: FRAME_I_M4,
            torsion_j_m4: FRAME_I_M4,
            roll_angle_rad: 0.0,
        }],
        bending_plates: vec![FiniteJ2CoupledBendingPlate {
            nodes: [0, 1, 2],
            youngs_mpa: PLATE_E_MPA,
            poisson: NU,
            thickness_m: PLATE_T_M,
        }],
        frame_targets: vec![FiniteJ2FrameTarget {
            moments_kn_m: vec![[0.0; 3]; 5],
            prescribed_rotation_rad: vec![[Some(0.0); 3]; 5],
        }],
        frame_member_load_targets: vec![],
        frame_member_point_load_targets: vec![vec![plane.point(p, a)]],
    }
}

#[test]
fn offcentre_point_loads_recover_exact_cantilever_tip_and_end_actions() {
    for (plane, p, a) in [(Plane::LocalY, -4.0, 0.37), (Plane::LocalZ, 3.0, 0.68)] {
        let equivalent = plane.equivalent(p, a);
        let (force1, moment1, force2, moment2) = match plane {
            Plane::LocalY => (equivalent[1], equivalent[5], equivalent[7], equivalent[11]),
            Plane::LocalZ => (
                equivalent[2],
                -equivalent[4],
                equivalent[8],
                -equivalent[10],
            ),
        };
        near(force1 + force2, p, 1e-13, "point-load resultant");
        near(
            moment1 + force2 * L + moment2,
            p * a,
            1e-13,
            "point-load moment balance",
        );
        for backend in [
            FiniteJ2TetLinearBackend::Dense,
            FiniteJ2TetLinearBackend::SparseGmres,
            FiniteJ2TetLinearBackend::FrontalWave,
            FiniteJ2TetLinearBackend::MatrixFreeGmres,
            FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
            FiniteJ2TetLinearBackend::Automatic,
        ] {
            let mut input = model(backend, plane, p, a);
            // Clamp the shared Tet4/DKT surface. The extra frame tip is free
            // in one transverse translation and its conjugate rotation.
            input.volume.targets[0].prescribed_m[1][plane.force_axis()] = Some(0.0);
            input.volume.targets[0].prescribed_m[4][plane.force_axis()] = None;
            input.frame_targets[0].prescribed_rotation_rad[4][plane.rotation_axis()] = None;
            let solved = solve_frame_coupled(&input)
                .unwrap_or_else(|error| panic!("{backend:?}, {plane:?}: {error}"));
            let ei = 1_000.0 * FRAME_E_MPA * FRAME_I_M4;
            near(
                solved.nodal_displacements_m[4][plane.force_axis()],
                p * a * a * (3.0 * L - a) / (6.0 * ei),
                1e-10,
                "cantilever tip displacement",
            );
            near(
                solved.nodal_rotations_rad[4][plane.rotation_axis()],
                plane.slope_rotation_sign() * p * a * a / (2.0 * ei),
                1e-10,
                "cantilever tip rotation",
            );
            let end = solved.frame_end_forces_local[0];
            near(end[0][plane.force_axis()], -p, 1e-8, "root shear");
            near(
                end[0][plane.moment_axis()],
                -plane.slope_rotation_sign() * p * a,
                1e-8,
                "root bending moment",
            );
            near(end[1][plane.force_axis()], 0.0, 1e-8, "free tip shear");
            near(end[1][plane.moment_axis()], 0.0, 1e-8, "free tip moment");
            near(
                solved
                    .nodal_reactions_kn
                    .iter()
                    .map(|r| r[plane.force_axis()])
                    .sum(),
                -p,
                1e-8,
                "global force reaction",
            );
            near(
                solved.element_first_piola_mpa[0][plane.force_axis()][0],
                0.0,
                1e-10,
                "unloaded solid",
            );
        }
    }
}

#[test]
fn offcentre_point_loads_drive_shared_finite_shear_and_guided_frame() {
    for (plane, gamma, a) in [(Plane::LocalY, -0.018, 0.29), (Plane::LocalZ, 0.025, 0.71)] {
        let response = solid_shear_force_kn(gamma)
            + frame_guided_stiffness_kn_per_m() * gamma
            + if plane.force_axis() == 2 {
                plate_guided_stiffness_kn_per_m() * gamma
            } else {
                0.0
            };
        let n1 = 1.0 - 3.0 * (a / L).powi(2) + 2.0 * (a / L).powi(3);
        let p = response / n1;
        let equivalent = plane.equivalent(p, a);
        for backend in [
            FiniteJ2TetLinearBackend::Dense,
            FiniteJ2TetLinearBackend::SparseGmres,
            FiniteJ2TetLinearBackend::FrontalWave,
            FiniteJ2TetLinearBackend::MatrixFreeGmres,
            FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
            FiniteJ2TetLinearBackend::Automatic,
        ] {
            let solved = solve_frame_coupled(&model(backend, plane, p, a))
                .unwrap_or_else(|error| panic!("{backend:?}, {plane:?}: {error}"));
            near(
                solved.nodal_displacements_m[1][plane.force_axis()],
                gamma,
                2e-8,
                "shared displacement",
            );
            near(
                solved.nodal_reactions_kn[1][plane.force_axis()],
                0.0,
                2e-5,
                "free residual",
            );
            near(
                solved
                    .nodal_reactions_kn
                    .iter()
                    .map(|r| r[plane.force_axis()])
                    .sum(),
                -p,
                2e-5,
                "point-load global balance",
            );
            near(
                solved.element_first_piola_mpa[0][plane.force_axis()][0] * 1_000.0 / 6.0,
                solid_shear_force_kn(gamma),
                2e-5,
                "finite-strain Tet4 force",
            );
            let end = solved.frame_end_forces_local[0];
            let frame_force = frame_guided_stiffness_kn_per_m() * gamma;
            let axis = plane.force_axis();
            near(
                end[0][axis],
                frame_force - equivalent[axis],
                2e-5,
                "first-end shear after fixed-end correction",
            );
            near(
                end[1][axis],
                -frame_force - equivalent[6 + axis],
                2e-5,
                "second-end shear after fixed-end correction",
            );
            let frame_moment =
                plane.slope_rotation_sign() * 6.0 * 1_000.0 * FRAME_E_MPA * FRAME_I_M4 * gamma;
            let moment_axis = plane.moment_axis();
            near(
                end[0][moment_axis],
                frame_moment - equivalent[moment_axis],
                2e-5,
                "first-end moment after correction",
            );
            near(
                end[1][moment_axis],
                frame_moment - equivalent[6 + moment_axis],
                2e-5,
                "second-end moment after correction",
            );
            assert!(solved.true_free_residual_kn < 2e-5);
        }
    }
}

#[test]
fn point_load_targets_are_absolute_and_validate_position_and_count() {
    let plane = Plane::LocalZ;
    let a = 0.43;
    let p = 12.0;
    let mut input = model(FiniteJ2TetLinearBackend::Dense, plane, p, a);
    let loaded = solve_frame_coupled(&input).unwrap();

    input.frame_member_point_load_targets.clear();
    let baseline = solve_frame_coupled(&input).unwrap();
    near(
        baseline.nodal_displacements_m[1][2],
        0.0,
        1e-12,
        "unloaded baseline",
    );
    for end in baseline.frame_end_forces_local[0] {
        for force in end {
            near(force, 0.0, 1e-12, "unloaded end force");
        }
    }

    let target = input.volume.targets[0].clone();
    let frame_target = input.frame_targets[0].clone();
    input.volume.targets = vec![target.clone(), target.clone(), target];
    input.frame_targets = vec![frame_target.clone(), frame_target.clone(), frame_target];
    input.frame_member_point_load_targets =
        vec![vec![plane.point(p, a)], vec![], vec![plane.point(p, a)]];
    let reloaded = solve_frame_coupled(&input).unwrap();
    near(
        reloaded.nodal_displacements_m[1][2],
        loaded.nodal_displacements_m[1][2],
        2e-9,
        "absolute reload displacement",
    );
    for end in 0..2 {
        for axis in 0..6 {
            near(
                reloaded.frame_end_forces_local[0][end][axis],
                loaded.frame_end_forces_local[0][end][axis],
                2e-6,
                "absolute reload end action",
            );
        }
    }
    assert!(reloaded
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    assert!(reloaded
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 2));

    let mut invalid = model(FiniteJ2TetLinearBackend::Dense, plane, p, a);
    invalid.frame_member_point_load_targets[0][0].position_m = L + 0.1;
    assert!(solve_frame_coupled(&invalid)
        .unwrap_err()
        .contains("position"));
    invalid.frame_member_point_load_targets[0][0].position_m = a;
    invalid.frame_member_point_load_targets[0][0].element = 1;
    assert!(solve_frame_coupled(&invalid).unwrap_err().contains("frame"));
    invalid.frame_member_point_load_targets[0][0].element = 0;
    invalid.frame_member_point_load_targets[0][0].py_kn = f64::NAN;
    assert!(solve_frame_coupled(&invalid).unwrap_err().contains("force"));
    invalid.frame_member_point_load_targets[0][0].py_kn = 0.0;
    invalid.frame_member_point_load_targets.push(vec![]);
    assert!(solve_frame_coupled(&invalid)
        .unwrap_err()
        .contains("targets"));
}

#[test]
fn exact_member_end_positions_match_nodal_loads_and_correct_end_actions() {
    // N1(0)=N3(L)=1; all other Hermite terms vanish there. A member point
    // load at either endpoint must therefore give the same global solution as
    // an explicit nodal force, while local member-end recovery subtracts the
    // physical point load only in the member-load route.
    let p = 2.5;
    for (position_m, node, end_index) in [(0.0, 1, 0), (L, 4, 1)] {
        let physical = model(
            FiniteJ2TetLinearBackend::Dense,
            Plane::LocalZ,
            p,
            position_m,
        );
        let local = Plane::LocalZ.equivalent(p, position_m);
        near(
            local[2 + 6 * end_index],
            p,
            1e-14,
            "endpoint equivalent force",
        );
        for (axis, value) in local.iter().enumerate() {
            if axis != 2 + 6 * end_index {
                near(
                    *value,
                    0.0,
                    1e-14,
                    "endpoint has no spurious Hermite moment",
                );
            }
        }
        let mut nodal = physical.clone();
        nodal.frame_member_point_load_targets.clear();
        nodal.volume.targets[0].loads_kn[node][2] = p;
        let member_solved = solve_frame_coupled(&physical).unwrap();
        let nodal_solved = solve_frame_coupled(&nodal).unwrap();
        for node in 0..5 {
            for axis in 0..3 {
                near(
                    member_solved.nodal_displacements_m[node][axis],
                    nodal_solved.nodal_displacements_m[node][axis],
                    2e-10,
                    "member endpoint/nodal displacement parity",
                );
                near(
                    member_solved.nodal_reactions_kn[node][axis],
                    nodal_solved.nodal_reactions_kn[node][axis],
                    2e-8,
                    "member endpoint/nodal reaction parity",
                );
            }
        }
        for end in 0..2 {
            for axis in 0..6 {
                let expected_correction = if end == end_index && axis == 2 {
                    -p
                } else {
                    0.0
                };
                near(
                    member_solved.frame_end_forces_local[0][end][axis]
                        - nodal_solved.frame_end_forces_local[0][end][axis],
                    expected_correction,
                    2e-8,
                    "physical end-action correction",
                );
            }
        }
    }
}

#[test]
fn finite_zero_point_force_is_a_noop_with_valid_position() {
    let mut input = model(FiniteJ2TetLinearBackend::Dense, Plane::LocalZ, 0.0, 0.43);
    let with_record = solve_frame_coupled(&input).expect("zero point load is valid");
    input.frame_member_point_load_targets.clear();
    let baseline = solve_frame_coupled(&input).unwrap();
    for node in 0..5 {
        for axis in 0..3 {
            near(
                with_record.nodal_displacements_m[node][axis],
                baseline.nodal_displacements_m[node][axis],
                1e-13,
                "zero-force displacement parity",
            );
            near(
                with_record.nodal_reactions_kn[node][axis],
                baseline.nodal_reactions_kn[node][axis],
                1e-13,
                "zero-force reaction parity",
            );
        }
    }
    for end in 0..2 {
        for axis in 0..6 {
            near(
                with_record.frame_end_forces_local[0][end][axis],
                baseline.frame_end_forces_local[0][end][axis],
                1e-13,
                "zero-force member action parity",
            );
        }
    }
}
