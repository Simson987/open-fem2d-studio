//! Independent elastic references for XY-DKT plates in the shared 3D iterative
//! solvers. Small cases derive stiffness from continuum energy; the scale case
//! uses the Navier sine series for a simply supported point-loaded square.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest};
use serde_json::{json, Value};

const P_KN: f64 = 10.0;
const TET_E_MPA: f64 = 120.0;
const NU: f64 = 0.2;
const PLATE_E_MPA: f64 = 30_000.0;
const FRAME_E_MPA: f64 = 200_000.0;
const FRAME_IY_M4: f64 = 1e-6;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn coupled_fixture(thickness_m: f64, reversed: bool, backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut fixture: Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json"))
            .expect("parse coupled Tet4/frame fixture");
    let input = &mut fixture["input"];
    input["solidMaterial"]["eMpa"] = json!(TET_E_MPA);
    input["frames"][0]["eMpa"] = json!(FRAME_E_MPA);
    input["frames"][0]["iyM4"] = json!(FRAME_IY_M4);
    input["loadsKn"][1] = json!([0.0, 0.0, P_KN]);
    input["loadsKn"][4] = json!([0.0, 0.0, 0.0]);
    input["prescribedM"][4] = json!([0.0, 0.0, 0.0]);
    input["prescribedRotationsRad"][0] = json!([0.0, 0.0, null]);
    input["prescribedRotationsRad"][2] = json!([0.0, 0.0, null]);
    input["prescribedRotationsRad"][4] = json!([0.0, 0.0, 0.0]);
    input["bendingPlates"] = json!([{
        "nodes": if reversed { [0, 2, 1] } else { [0, 1, 2] },
        "eMpa": PLATE_E_MPA,
        "nu": NU,
        "thicknessM": thickness_m
    }]);
    input["backend"] = serde_json::to_value(backend).unwrap();
    input["threads"] = json!(4);
    serde_json::from_value(input.take()).expect("deserialize coupled fixture")
}

fn one_dof_stiffness(thickness_m: f64) -> (f64, f64, f64) {
    // Tet4: V=1/6, gamma_zx=uz at node 1, hence K=mu*V in kN/m.
    let tet = 1_000.0 * (TET_E_MPA / (2.0 * (1.0 + NU))) / 6.0;
    // DKT over the unit right triangle: exact curvature integrals are
    // Ix²=15/4, Iy²=3/4, Ixy=3/8, Itwist²=9/4. Applying isotropic D gives
    // Kww=D*(45-3nu)/8, independent of the element implementation.
    let d_kn_m = 1_000.0 * PLATE_E_MPA * thickness_m.powi(3) / (12.0 * (1.0 - NU * NU));
    let plate = d_kn_m * (45.0 - 3.0 * NU) / 8.0;
    // Guided Euler-Bernoulli member, both end rotations fixed, L=1 m.
    let frame = 12.0 * 1_000.0 * FRAME_E_MPA * FRAME_IY_M4;
    (tet, plate, frame)
}

#[test]
fn iterative_plate_tet_frame_parallel_stiffness_and_winding() {
    for backend in [
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        for thickness in [0.1, 0.2] {
            let (tet, plate, frame) = one_dof_stiffness(thickness);
            let expected = P_KN / (tet + plate + frame);
            for reversed in [false, true] {
                let result = solve(&coupled_fixture(thickness, reversed, backend))
                    .unwrap_or_else(|e| panic!("{backend:?}, reversed={reversed}: {e}"));
                let expected_backend = if backend == Mixed3dBackend::Automatic {
                    Mixed3dBackend::MatrixFreePcg
                } else {
                    backend
                };
                assert_eq!(result.backend_used, expected_backend);
                assert!(result.linear_iterations > 0);
                assert!(result.relative_residual < 1e-8);
                near(
                    result.nodal_displacements_m[1][2],
                    expected,
                    2e-10,
                    "shared uz",
                );
                near(
                    result.nodal_reactions_kn[4][2],
                    -frame * expected,
                    2e-7,
                    "frame tip reaction (kN)",
                );
                near(
                    result.solid_element_stress_mpa[0][5],
                    TET_E_MPA / (2.0 * (1.0 + NU)) * expected,
                    2e-8,
                    "Tet4 shear stress (MPa)",
                );
                let sum_rz: f64 = result.nodal_reactions_kn.iter().map(|r| r[2]).sum();
                near(sum_rz, -P_KN, 2e-7, "global vertical reaction (kN)");
                near(
                    result.nodal_reactions_kn[1][2],
                    0.0,
                    2e-7,
                    "free residual (kN)",
                );
            }
        }
    }
}

#[test]
fn iterative_plate_tet_frame_rigid_rotation_has_zero_internal_force() {
    let (rx, ry) = (0.01, -0.02);
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        for reversed in [false, true] {
            let mut input = coupled_fixture(0.1, reversed, backend);
            input.loads_kn.fill([0.0; 3]);
            let physical: Vec<[f64; 3]> = input
                .mesh
                .nodes
                .iter()
                .map(|&[x, y, z]| [ry * z, -rx * z, rx * y - ry * x])
                .collect();
            input.prescribed_m = physical.iter().copied().map(|u| u.map(Some)).collect();
            input.prescribed_m[1][2] = None;
            input.prescribed_rotations_rad[0] = [Some(rx), Some(ry), None];
            input.prescribed_rotations_rad[1] = [Some(rx), Some(ry), Some(0.0)];
            input.prescribed_rotations_rad[2] = [Some(rx), Some(ry), None];
            input.prescribed_rotations_rad[4] = [Some(rx), Some(ry), Some(0.0)];
            let result =
                solve(&input).unwrap_or_else(|e| panic!("{backend:?}, reversed={reversed}: {e}"));
            near(
                result.nodal_displacements_m[1][2],
                physical[1][2],
                2e-9,
                "free rigid uz",
            );
            for r in &result.nodal_reactions_kn {
                for &v in r {
                    near(v, 0.0, 3e-6, "rigid force reaction (kN)");
                }
            }
            for moments in result.nodal_moment_reactions_knm.iter().flatten() {
                for &v in moments {
                    near(v, 0.0, 3e-6, "rigid moment reaction (kNm)");
                }
            }
            for stress in &result.solid_element_stress_mpa {
                for &v in stress {
                    near(v, 0.0, 2e-7, "rigid Tet4 stress (MPa)");
                }
            }
            for end in result.frame_end_forces_local.iter().flatten() {
                for &v in end {
                    near(v, 0.0, 3e-6, "rigid frame end force");
                }
            }
        }
    }
}

#[test]
fn zero_load_underrestrained_plate_must_not_pass_pcg() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        // One restrained w leaves the two rigid tilts w=a*x+b*y unrestrained.
        // A zero load would otherwise make PCG report a spurious success.
        let input: Mixed3dRequest = serde_json::from_value(json!({
            "mesh": {"nodes": [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]], "tets": []},
            "solidMaterial": {"eMpa": TET_E_MPA, "poisson": NU},
            "trusses": [], "bendingPlates": [{"nodes": [0, 1, 2], "eMpa": PLATE_E_MPA, "nu": NU, "thicknessM": 0.1}],
            "loadsKn": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
            "prescribedM": [[null, null, 0.0], [null, null, null], [null, null, null]],
            "backend": backend
        })).unwrap();
        let error = solve(&input).expect_err("zero-load plate tilt mechanism must be rejected");
        assert!(
            error.contains("plate") && (error.contains("rigid") || error.contains("mechanism")),
            "{backend:?}: {error}"
        );
    }
}

const CELLS: usize = 60;
const GRID_NODES: usize = (CELLS + 1) * (CELLS + 1);
const STORED_SLOTS: usize = 5 * GRID_NODES;
const PHYSICAL_PLATE_DOFS: usize = 3 * GRID_NODES;
const FREE_PLATE_DOFS: usize = PHYSICAL_PLATE_DOFS - 4 * CELLS;

fn node(i: usize, j: usize) -> usize {
    i + (CELLS + 1) * j
}

fn square_point_load(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut coordinates = Vec::with_capacity(GRID_NODES);
    let mut supports = Vec::with_capacity(GRID_NODES);
    let mut forces = vec![[0.0; 3]; GRID_NODES];
    let mut triangles = Vec::with_capacity(2 * CELLS * CELLS);
    for j in 0..=CELLS {
        for i in 0..=CELLS {
            coordinates.push([i as f64 / CELLS as f64, j as f64 / CELLS as f64, 0.0]);
            let boundary = i == 0 || j == 0 || i == CELLS || j == CELLS;
            supports.push([None, None, if boundary { Some(0.0) } else { None }]);
        }
    }
    for j in 0..CELLS {
        for i in 0..CELLS {
            let (a, b, c, d) = (
                node(i, j),
                node(i + 1, j),
                node(i, j + 1),
                node(i + 1, j + 1),
            );
            // Opposite diagonals on alternating cells avoid a preferred global bending direction.
            let pair = if (i + j) % 2 == 0 {
                [[a, b, d], [a, d, c]]
            } else {
                [[a, b, c], [b, d, c]]
            };
            for nodes in pair {
                triangles.push(
                    json!({"nodes": nodes, "eMpa": PLATE_E_MPA, "nu": NU, "thicknessM": 0.05}),
                );
            }
        }
    }
    forces[node(CELLS / 2, CELLS / 2)][2] = 1.0;
    serde_json::from_value(json!({
        "mesh": {"nodes": coordinates, "tets": []},
        "solidMaterial": {"eMpa": TET_E_MPA, "poisson": NU},
        "trusses": [], "bendingPlates": triangles,
        "loadsKn": forces,
        "prescribedM": supports,
        "threads": 4,
        "maxPcgIterations": 20000,
        "backend": backend
    }))
    .expect("square DKT model")
}

fn navier_center_deflection_m() -> f64 {
    // D ∇⁴w = P δ(x-L/2)δ(y-L/2), L=1 m. Expand w in the simply supported
    // sine basis. The load's (m,n) coefficient is 4P/L²*sin(mπ/2)sin(nπ/2),
    // while ∇⁴ contributes π⁴(m²+n²)²/L⁴. At the load point only odd m,n
    // remain, each with squared sine 1. Therefore
    // w_center = 4P L²/(π⁴ D) Σ_{m,n odd≥1} 1/(m²+n²)².
    // Truncating after odd m,n ≤399 leaves an O(N^-2) tail far below the
    // 0.5% finite-element discretization tolerance for this 60×60 DKT mesh.
    let e_kn_m2 = PLATE_E_MPA * 1_000.0;
    let d_kn_m = e_kn_m2 * 0.05_f64.powi(3) / (12.0 * (1.0 - NU * NU));
    let mut sum = 0.0;
    for m in (1..=399).step_by(2) {
        for n in (1..=399).step_by(2) {
            let square = (m * m + n * n) as f64;
            sum += 1.0 / (square * square);
        }
    }
    4.0 / (std::f64::consts::PI.powi(4) * d_kn_m) * sum
}

#[test]
#[ignore = "release scale gate: 18,605 stored slots, 10,923 free plate DOFs, 7,200 DKT triangles"]
fn over_ten_thousand_free_plate_dofs_match_navier_and_balance() {
    let expected = navier_center_deflection_m();
    let mut centers = Vec::new();
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let input = square_point_load(backend);
        let result =
            solve(&input).unwrap_or_else(|e| panic!("{backend:?} large XY-DKT solve: {e}"));
        assert_eq!(result.backend_used, backend);
        assert_eq!(result.nodal_displacements_m.len(), GRID_NODES);
        assert!(result.linear_iterations > 0);
        assert!(
            result.relative_residual < 1e-8,
            "{backend:?} residual={:.3e}",
            result.relative_residual
        );
        let actual = result.nodal_displacements_m[node(CELLS / 2, CELLS / 2)][2];
        let relative_error = ((actual - expected) / expected).abs();
        assert!(
            relative_error < 0.005,
            "{backend:?} center w={actual:.9e} m, Navier={expected:.9e} m, error={:.3}%",
            100.0 * relative_error
        );
        let reaction: f64 = result.nodal_reactions_kn.iter().map(|r| r[2]).sum();
        near(reaction, -1.0, 1e-6, "total z reaction (kN)");
        println!(
            "XY-DKT {backend:?}: nodes={GRID_NODES}, triangles={}, stored slots={STORED_SLOTS}, physical plate DOFs={PHYSICAL_PLATE_DOFS}, free DOFs={FREE_PLATE_DOFS}, PCG iterations={}, residual={:.3e}, center_w={:.9e} m, Navier={:.9e} m, error={:.3}%",
            2 * CELLS * CELLS,
            result.linear_iterations,
            result.relative_residual,
            actual,
            expected,
            100.0 * relative_error
        );
        centers.push(actual);
    }
    near(
        centers[0],
        centers[1],
        1e-10,
        "CSR/matrix-free center parity (m)",
    );
}
