//! Independent work-equivalent transverse frame-load references in the
//! finite-strain J2 Tet4 + elastic XY-DKT + guided 3D frame system.
//!
//! The Euler--Bernoulli Hermite formulas are cross-checked against University
//! of Florida EML 4500 lecture 05, slide 32 (PDF page 16):
//! https://web.mae.ufl.edu/nkim/eml5526/lect05.pdf
//! Positive `qy` and `qz` act in the member's reference local +Y and +Z;
//! for our +X member with zero roll those are global +Y and +Z. The local +Z
//! slope is -Ry, so positive `qz` produces negative Ry at the first node.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_frame_coupled, FiniteJ2CoupledBendingPlate, FiniteJ2CoupledFrame,
    FiniteJ2CoupledFrameMemberLoad, FiniteJ2FrameCoupledRequest, FiniteJ2FrameTarget,
    FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};

const SOLID_E_MPA: f64 = 120.0;
const NU: f64 = 0.2;
const PLATE_E_MPA: f64 = 30_000.0;
const PLATE_T_M: f64 = 0.1;
const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_I_M4: f64 = 1e-6;
const FRAME_LENGTH_M: f64 = 1.0;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn hencky_tet_shear_kn(gamma: f64) -> f64 {
    // For F=I+gamma(e_i ⊗ e_x), det F=1 and principal Hencky stretches are
    // ±asinh(gamma/2). Differentiation of 2µ asinh(gamma/2)^2 times V0=1/6
    // gives the first Piola shear force. This is not the small-strain µ gamma.
    let mu_mpa = SOLID_E_MPA / (2.0 * (1.0 + NU));
    let p_mpa = 2.0 * mu_mpa * (gamma / 2.0).asinh() / (1.0 + (gamma / 2.0).powi(2)).sqrt();
    p_mpa * 1_000.0 / 6.0
}

fn dkt_guided_stiffness_kn_per_m() -> f64 {
    // Exact DKT curvature integral for (0,0),(1,0),(0,1) with only node 1
    // deflection free; all plate rotations fixed.
    let d = 1_000.0 * PLATE_E_MPA * PLATE_T_M.powi(3) / (12.0 * (1.0 - NU.powi(2)));
    d * (45.0 - 3.0 * NU) / 8.0
}

fn guided_frame_stiffness_kn_per_m() -> f64 {
    12.0 * 1_000.0 * FRAME_E_MPA * FRAME_I_M4 / FRAME_LENGTH_M.powi(3)
}

#[derive(Clone, Copy, Debug)]
enum ReferenceLoad {
    FullSpanLocalZ,
    HalfSpanLocalY,
}

impl ReferenceLoad {
    fn axis(self) -> usize {
        match self {
            Self::FullSpanLocalZ => 2,
            Self::HalfSpanLocalY => 1,
        }
    }

    fn shear(self, gamma: f64) -> f64 {
        hencky_tet_shear_kn(gamma)
            + guided_frame_stiffness_kn_per_m() * gamma
            + if self.axis() == 2 {
                dkt_guided_stiffness_kn_per_m() * gamma
            } else {
                0.0
            }
    }

    fn intensity_for(self, gamma: f64) -> f64 {
        // Work-equivalent force on the sole free translation at member node 1:
        // full uniform: qL/2. A triangular load rising from zero at x=0
        // to q at x=L/2 gives 29qL/160 at the first node.
        let first_force_fraction = match self {
            Self::FullSpanLocalZ => 0.5,
            Self::HalfSpanLocalY => 29.0 / 160.0,
        };
        self.shear(gamma) / (FRAME_LENGTH_M * first_force_fraction)
    }

    fn local_equivalent(self, q: f64) -> [f64; 12] {
        // Integrate cubic Hermite N_i over the physical load span. For a full
        // uniform span: [qL/2, +qL²/12, qL/2, -qL²/12] in a positive-slope
        // (+Rz) system. Local Z uses -Ry for positive slope, reversing signs.
        // For q(x)=2qx/L on x/L∈[0,1/2], the four integrals are
        // [29qL/160, qL²/30, 11qL/160, -3qL²/160]. The first two are
        // obtained directly from ∫0^(L/2) (2qx/L)N_1,2(x)dx.
        let l = FRAME_LENGTH_M;
        let mut f = [0.0; 12];
        match self {
            Self::FullSpanLocalZ => {
                f[2] = q * l / 2.0;
                f[4] = -q * l * l / 12.0;
                f[8] = q * l / 2.0;
                f[10] = q * l * l / 12.0;
            }
            Self::HalfSpanLocalY => {
                f[1] = 29.0 * q * l / 160.0;
                f[5] = q * l * l / 30.0;
                f[7] = 11.0 * q * l / 160.0;
                f[11] = -3.0 * q * l * l / 160.0;
            }
        }
        f
    }

    fn member_load(self, q: f64) -> FiniteJ2CoupledFrameMemberLoad {
        let (qy_start, qy_end, qz, end_position_m) = match self {
            Self::FullSpanLocalZ => (0.0, 0.0, q, FRAME_LENGTH_M),
            Self::HalfSpanLocalY => (0.0, q, 0.0, FRAME_LENGTH_M / 2.0),
        };
        FiniteJ2CoupledFrameMemberLoad {
            element: 0,
            qy_start_kn_per_m: qy_start,
            qy_end_kn_per_m: qy_end,
            qz_start_kn_per_m: qz,
            qz_end_kn_per_m: qz,
            start_position_m: 0.0,
            end_position_m,
        }
    }
}

fn model(
    backend: FiniteJ2TetLinearBackend,
    load: ReferenceLoad,
    q: f64,
) -> FiniteJ2FrameCoupledRequest {
    let axis = load.axis();
    let mut prescribed = vec![[Some(0.0); 3]; 5];
    prescribed[1][axis] = None;
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
        frame_member_load_targets: vec![vec![load.member_load(q)]],
        frame_member_point_load_targets: vec![],
    }
}

#[test]
fn transverse_loads_in_both_local_planes_match_finite_shear_and_hermite_work() {
    for (kind, gamma) in [
        (ReferenceLoad::FullSpanLocalZ, 0.025),
        (ReferenceLoad::HalfSpanLocalY, -0.018),
    ] {
        let q = kind.intensity_for(gamma);
        let equivalent = kind.local_equivalent(q);
        // Independent force and moment balance of the load vector. The
        // triangular half-span resultant is qL/4 acting at x=L/3.
        let total = match kind {
            ReferenceLoad::FullSpanLocalZ => q * FRAME_LENGTH_M,
            ReferenceLoad::HalfSpanLocalY => q * FRAME_LENGTH_M / 4.0,
        };
        let (f1, m1, f2, m2) = match kind {
            ReferenceLoad::FullSpanLocalZ => (
                equivalent[2],
                -equivalent[4],
                equivalent[8],
                -equivalent[10],
            ),
            ReferenceLoad::HalfSpanLocalY => {
                (equivalent[1], equivalent[5], equivalent[7], equivalent[11])
            }
        };
        near(f1 + f2, total, 1e-12, "Hermite force balance");
        let centroid = match kind {
            ReferenceLoad::FullSpanLocalZ => FRAME_LENGTH_M / 2.0,
            ReferenceLoad::HalfSpanLocalY => FRAME_LENGTH_M / 3.0,
        };
        near(
            m1 + f2 * FRAME_LENGTH_M + m2,
            total * centroid,
            1e-12,
            "Hermite moment balance",
        );

        for backend in [
            FiniteJ2TetLinearBackend::Dense,
            FiniteJ2TetLinearBackend::SparseGmres,
            FiniteJ2TetLinearBackend::FrontalWave,
            FiniteJ2TetLinearBackend::MatrixFreeGmres,
            FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
            FiniteJ2TetLinearBackend::Automatic,
        ] {
            let input = model(backend, kind, q);
            let solved = solve_frame_coupled(&input)
                .unwrap_or_else(|error| panic!("{backend:?}, {kind:?}: {error}"));
            near(
                solved.nodal_displacements_m[1][kind.axis()],
                gamma,
                2e-8,
                "shared guided translation",
            );
            near(
                solved.nodal_reactions_kn[1][kind.axis()],
                0.0,
                2e-5,
                "free equilibrium",
            );
            near(
                solved
                    .nodal_reactions_kn
                    .iter()
                    .map(|r| r[kind.axis()])
                    .sum(),
                -total,
                2e-5,
                "total applied load equilibrium",
            );
            near(
                solved.element_first_piola_mpa[0][kind.axis()][0] * 1_000.0 / 6.0,
                hencky_tet_shear_kn(gamma),
                2e-5,
                "finite-strain solid force",
            );
            let end = solved.frame_end_forces_local[0];
            let (local_force_axis, local_moment_axis, a, b) = match kind {
                ReferenceLoad::FullSpanLocalZ => (2, 4, equivalent[4], equivalent[10]),
                ReferenceLoad::HalfSpanLocalY => (1, 5, equivalent[5], equivalent[11]),
            };
            let guided = guided_frame_stiffness_kn_per_m() * gamma;
            near(
                end[0][local_force_axis],
                guided - f1,
                2e-5,
                "first-end shear subtracts fixed-end load",
            );
            near(
                end[1][local_force_axis],
                -guided - f2,
                2e-5,
                "second-end shear subtracts fixed-end load",
            );
            let k_moment = 6.0
                * 1_000.0
                * FRAME_E_MPA
                * FRAME_I_M4
                * gamma
                * if kind.axis() == 2 { -1.0 } else { 1.0 };
            near(
                end[0][local_moment_axis],
                k_moment - a,
                2e-5,
                "first-end moment subtracts fixed-end load",
            );
            near(
                end[1][local_moment_axis],
                k_moment - b,
                2e-5,
                "second-end moment subtracts fixed-end load",
            );
            near(
                solved.element_states[0].equivalent_plastic_strain,
                0.0,
                1e-14,
                "elastic solid",
            );
            assert!(solved.true_free_residual_kn < 2e-5, "{backend:?}, {kind:?}");
        }
    }
}

#[test]
fn full_span_load_has_exact_cantilever_tip_and_zero_free_end_actions() {
    // With the volume-supported first frame end clamped, an unloaded Tet4 and
    // DKT contribute no displacement or force. The extra frame tip is free in
    // Uz and Ry. The single cubic Hermite member is exact at those DOFs for a
    // uniform load: w_tip=qL^4/(8EI), slope=qL^3/(6EI). Ry=-slope for local Z.
    let q = 3.0;
    let ei = 1_000.0 * FRAME_E_MPA * FRAME_I_M4;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let mut input = model(backend, ReferenceLoad::FullSpanLocalZ, q);
        input.volume.targets[0].prescribed_m[1][2] = Some(0.0);
        input.volume.targets[0].prescribed_m[4][2] = None;
        input.frame_targets[0].prescribed_rotation_rad[4][1] = None;
        let solved = solve_frame_coupled(&input)
            .unwrap_or_else(|error| panic!("{backend:?} cantilever: {error}"));
        near(
            solved.nodal_displacements_m[4][2],
            q * FRAME_LENGTH_M.powi(4) / (8.0 * ei),
            1e-10,
            "exact cantilever tip displacement",
        );
        near(
            solved.nodal_rotations_rad[4][1],
            -q * FRAME_LENGTH_M.powi(3) / (6.0 * ei),
            1e-10,
            "exact cantilever tip rotation",
        );
        near(
            solved.nodal_displacements_m[1][2],
            0.0,
            1e-12,
            "clamped solid/plate surface",
        );
        near(
            solved.element_first_piola_mpa[0][2][0],
            0.0,
            1e-10,
            "unloaded solid",
        );
        let end = solved.frame_end_forces_local[0];
        near(
            end[0][2],
            -q * FRAME_LENGTH_M,
            1e-8,
            "cantilever root shear",
        );
        near(
            end[0][4],
            q * FRAME_LENGTH_M.powi(2) / 2.0,
            1e-8,
            "cantilever root moment",
        );
        near(end[1][2], 0.0, 1e-8, "free tip shear");
        near(end[1][4], 0.0, 1e-8, "free tip moment");
        near(
            solved.nodal_reactions_kn.iter().map(|r| r[2]).sum(),
            -q * FRAME_LENGTH_M,
            1e-8,
            "cantilever global reaction",
        );
    }
}

#[test]
fn absolute_member_load_targets_unload_and_reload_without_accumulation() {
    let kind = ReferenceLoad::FullSpanLocalZ;
    let gamma = 0.016;
    let q = kind.intensity_for(gamma);
    let mut input = model(FiniteJ2TetLinearBackend::Dense, kind, q);
    let loaded = solve_frame_coupled(&input).unwrap();

    // Empty outer vector and explicit empty per-target vectors both mean zero
    // member load. The latter exercises the absolute target transition.
    input.frame_member_load_targets.clear();
    let no_load = solve_frame_coupled(&input).unwrap();
    near(
        no_load.nodal_displacements_m[1][2],
        0.0,
        1e-12,
        "zero-load baseline",
    );
    for end in no_load.frame_end_forces_local[0] {
        for force in end {
            near(force, 0.0, 1e-12, "zero-load member end action");
        }
    }

    let target = input.volume.targets[0].clone();
    let frame_target = input.frame_targets[0].clone();
    input.volume.targets = vec![target.clone(), target.clone(), target];
    input.frame_targets = vec![frame_target.clone(), frame_target.clone(), frame_target];
    input.frame_member_load_targets =
        vec![vec![kind.member_load(q)], vec![], vec![kind.member_load(q)]];
    let reloaded = solve_frame_coupled(&input).unwrap();
    near(
        reloaded.nodal_displacements_m[1][2],
        loaded.nodal_displacements_m[1][2],
        2e-9,
        "absolute load target reload",
    );
    for end in 0..2 {
        for axis in 0..6 {
            near(
                reloaded.frame_end_forces_local[0][end][axis],
                loaded.frame_end_forces_local[0][end][axis],
                2e-6,
                "reloaded member end action",
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
}

#[test]
fn invalid_member_index_or_load_span_is_rejected_before_newton() {
    let mut input = model(
        FiniteJ2TetLinearBackend::Dense,
        ReferenceLoad::FullSpanLocalZ,
        2.0,
    );
    input.frame_member_load_targets[0][0].element = 1;
    assert!(solve_frame_coupled(&input).unwrap_err().contains("frame"));
    input.frame_member_load_targets[0][0].element = 0;
    input.frame_member_load_targets[0][0].end_position_m = 1.1;
    assert!(solve_frame_coupled(&input).unwrap_err().contains("span"));
    input.frame_member_load_targets[0][0].end_position_m = 1.0;
    input.frame_member_load_targets[0][0].qz_start_kn_per_m = f64::NAN;
    assert!(solve_frame_coupled(&input)
        .unwrap_err()
        .contains("intensity"));
    input.frame_member_load_targets[0][0].qz_start_kn_per_m = 2.0;
    input.frame_member_load_targets.push(vec![]);
    assert!(solve_frame_coupled(&input).unwrap_err().contains("targets"));
}
