//! Version 1 acceptance model for a shared Tet4/Hex8/bending-frame node.
//!
//! The fixture leaves only the common node's z translation free in the
//! solids. On the unit Hex8, the three squared shape-function derivatives
//! each integrate to 1/9. At the right-angle Tet4 corner, they each equal
//! one and its volume is 1/6. Thus both solids have an independently known
//! scalar z stiffness, in parallel. The frame's Euler-Bernoulli compliance
//! is in series with that stiffness. No assembled-element stiffness is used
//! to form the expected answer.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};
use openaec_native_fem::mixed3d::{
    solve, Frame3dMixedElement, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest, Mixed3dResult,
    Truss3dElement,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const E_SOLID_MPA: f64 = 1_200.0;
const NU_SOLID: f64 = 0.2;
const E_FRAME_MPA: f64 = 20_000.0;
const IY_FRAME_M4: f64 = 0.005;
const FORCE_KN: f64 = 10.0;
const FRAME_LENGTH_M: f64 = 2.0;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.14e}, expected={expected:.14e}, tolerance={tolerance:.2e}"
    );
}

fn fixture(backend: Mixed3dBackend, threads: usize, iy_m4: f64) -> NativeFemRequest {
    let mut model: serde_json::Value = serde_json::from_str(include_str!(
        "../examples/mixed3d-tet4-hex8-frame-matrixfree-v1.json"
    ))
    .expect("versioned reference JSON parses");
    assert_eq!(model["kind"], "mixed3d");
    model["input"]["backend"] = serde_json::to_value(backend).unwrap();
    model["input"]["threads"] = serde_json::json!(threads);
    model["input"]["frames"][0]["iyM4"] = serde_json::json!(iy_m4);
    serde_json::from_value(model).expect("reference JSON conforms to public dispatch schema")
}

fn run_fixture(backend: Mixed3dBackend, threads: usize, iy_m4: f64) -> Mixed3dResult {
    match solve_native_fem(fixture(backend, threads, iy_m4)).expect("public dispatch solve") {
        NativeFemResult::Mixed3d(result) => result,
        _ => panic!("versioned mixed3d JSON dispatched to another result"),
    }
}

#[test]
fn mixed_tet_hex_timber_frame_uses_independent_shear_modulus_for_torsion() {
    let mut model: serde_json::Value = serde_json::from_str(include_str!(
        "../examples/mixed3d-tet4-hex8-frame-matrixfree-v1.json"
    ))
    .unwrap();
    model["input"]["frames"][0]["eMpa"] = serde_json::json!(11_500.0);
    model["input"]["frames"][0]["gMpa"] = serde_json::json!(650.0);
    model["input"]["loadsKn"][11] = serde_json::json!([0.0, 0.0, 0.0]);
    model["input"]["momentsKnm"][11] = serde_json::json!([0.5, 0.0, 0.0]);
    let request: NativeFemRequest = serde_json::from_value(model).unwrap();
    let result = match solve_native_fem(request).unwrap() {
        NativeFemResult::Mixed3d(value) => value,
        _ => panic!("expected mixed3d result"),
    };
    let expected_twist = 0.5 * FRAME_LENGTH_M / (650_000.0 * 0.01);
    near(result.nodal_rotations_rad[11].unwrap()[0], expected_twist, 1e-10, "GL24h GJ torsion");
}

fn analytic_reference(iy_m4: f64) -> (f64, f64, f64) {
    let mu = E_SOLID_MPA / (2.0 * (1.0 + NU_SOLID));
    let lambda = E_SOLID_MPA * NU_SOLID / ((1.0 + NU_SOLID) * (1.0 - 2.0 * NU_SOLID));
    let k_hex_kn_per_m = 1_000.0 * (lambda + 4.0 * mu) / 9.0;
    let k_tet_kn_per_m = 1_000.0 * (lambda + 4.0 * mu) / 6.0;
    let base_uz = FORCE_KN / (k_hex_kn_per_m + k_tet_kn_per_m);
    let ei_kn_m2 = 1_000.0 * E_FRAME_MPA * iy_m4;
    let beam_uz = FORCE_KN * FRAME_LENGTH_M.powi(3) / (3.0 * ei_kn_m2);
    let tip_rotation_y = -FORCE_KN * FRAME_LENGTH_M.powi(2) / (2.0 * ei_kn_m2);
    (base_uz, base_uz + beam_uz, tip_rotation_y)
}

fn check_small_reference(result: &Mixed3dResult, iy_m4: f64) {
    let (base_uz, tip_uz, tip_theta_y) = analytic_reference(iy_m4);
    assert_eq!(result.solid_element_stress_mpa.len(), 1);
    assert_eq!(result.hex_gauss_stress_mpa.len(), 1);
    assert_eq!(result.frame_end_forces_local.len(), 1);
    assert!(result.relative_residual < 1e-9);
    near(
        result.nodal_displacements_m[1][2],
        base_uz,
        1e-10,
        "shared node uz",
    );
    near(
        result.nodal_displacements_m[11][2],
        tip_uz,
        1e-10,
        "frame tip uz",
    );
    near(
        result.nodal_rotations_rad[11].unwrap()[1],
        tip_theta_y,
        1e-10,
        "frame tip ry",
    );
    // The Tet4 corner shape function has ∇N=(-1,+1,+1). With only uz free,
    // the zx shear stress is -μ uz, independently of the solver matrix.
    let mu = E_SOLID_MPA / (2.0 * (1.0 + NU_SOLID));
    near(
        result.solid_element_stress_mpa[0][5],
        -mu * base_uz,
        1e-7,
        "Tet4 zx shear",
    );
    near(
        result.frame_end_forces_local[0][0][2].abs(),
        FORCE_KN,
        1e-7,
        "frame base shear",
    );
    near(
        result.frame_end_forces_local[0][0][4].abs(),
        FORCE_KN * FRAME_LENGTH_M,
        1e-7,
        "frame base bending moment",
    );
    for axis in 0..3 {
        let reaction: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        near(
            reaction,
            if axis == 2 { -FORCE_KN } else { 0.0 },
            1e-6,
            "global force equilibrium",
        );
    }
}

#[test]
fn matrixfree_threads_one_and_four_match_independent_tet_hex_frame_reference() {
    let dense = run_fixture(Mixed3dBackend::Dense, 1, IY_FRAME_M4);
    check_small_reference(&dense, IY_FRAME_M4);
    for backend in [
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::FrontalWave,
    ] {
        let result = run_fixture(backend, 1, IY_FRAME_M4);
        check_small_reference(&result, IY_FRAME_M4);
        near(
            result.nodal_displacements_m[11][2],
            dense.nodal_displacements_m[11][2],
            1e-10,
            "direct/PCG frame tip parity",
        );
    }
    for threads in [1, 4] {
        let result = run_fixture(Mixed3dBackend::MatrixFreePcg, threads, IY_FRAME_M4);
        assert_eq!(result.backend_used, Mixed3dBackend::MatrixFreePcg);
        assert!(result.linear_iterations > 0);
        check_small_reference(&result, IY_FRAME_M4);
        near(
            result.nodal_displacements_m[11][2],
            dense.nodal_displacements_m[11][2],
            1e-10,
            "matrix-free frame tip parity",
        );
    }
}

#[test]
fn changing_frame_iy_changes_only_the_beam_share_of_displacement() {
    let stiff = run_fixture(Mixed3dBackend::MatrixFreePcg, 4, IY_FRAME_M4);
    let flexible = run_fixture(Mixed3dBackend::MatrixFreePcg, 4, IY_FRAME_M4 / 4.0);
    check_small_reference(&stiff, IY_FRAME_M4);
    check_small_reference(&flexible, IY_FRAME_M4 / 4.0);
    near(
        flexible.nodal_displacements_m[1][2],
        stiff.nodal_displacements_m[1][2],
        1e-10,
        "solid displacement independent of frame Iy",
    );
    let stiff_bending = stiff.nodal_displacements_m[11][2] - stiff.nodal_displacements_m[1][2];
    let flexible_bending =
        flexible.nodal_displacements_m[11][2] - flexible.nodal_displacements_m[1][2];
    near(
        flexible_bending,
        4.0 * stiff_bending,
        1e-10,
        "frame bending compliance scales with inverse Iy",
    );
}

#[test]
fn automatic_frame_route_recovers_with_frontal_after_short_matrixfree_run() {
    let NativeFemRequest::Mixed3d(mut input) = fixture(Mixed3dBackend::Automatic, 4, IY_FRAME_M4)
    else {
        panic!("versioned fixture must be a mixed3d request");
    };
    input.max_pcg_iterations = 1;
    let recovered = solve(&input).expect("bounded frontal fallback for a frame-bearing model");
    assert_eq!(recovered.backend_used, Mixed3dBackend::FrontalWave);
    check_small_reference(&recovered, IY_FRAME_M4);
}

#[test]
fn unloaded_frame_hinged_at_one_solid_node_is_not_accepted_as_converged() {
    let NativeFemRequest::Mixed3d(mut input) =
        fixture(Mixed3dBackend::MatrixFreePcg, 4, IY_FRAME_M4)
    else {
        panic!("versioned fixture must be a mixed3d request");
    };
    input.prescribed_rotations_rad[1] = [None; 3];
    input.loads_kn.fill([0.0; 3]);
    let error = solve(&input).unwrap_err();
    assert!(
        error.contains("frame cluster") && error.contains("mechanism"),
        "{error}"
    );
    input.trusses.push(Truss3dElement {
        nodes: [11, 0],
        e_mpa: 2_000.0,
        area_m2: 0.01,
    });
    let error = solve(&input).unwrap_err();
    assert!(
        error.contains("frame cluster") && error.contains("mechanism"),
        "{error}"
    );
}

const NX: usize = 6;
const NY: usize = 5;
const NZ: usize = 5;

fn grid_id(i: usize, j: usize, k: usize) -> usize {
    i + (NX + 1) * (j + (NY + 1) * k)
}

fn moderate_mixed_model(backend: Mixed3dBackend, threads: usize) -> Mixed3dRequest {
    let mut nodes: Vec<[f64; 3]> = (0..=NZ)
        .flat_map(|k| {
            (0..=NY).flat_map(move |j| (0..=NX).map(move |i| [i as f64, j as f64, k as f64]))
        })
        .collect();
    let hexes: Vec<_> = (0..NZ)
        .flat_map(|k| {
            (0..NY).flat_map(move |j| {
                (0..NX).map(move |i| Hex8MixedElement {
                    nodes: [
                        grid_id(i, j, k),
                        grid_id(i + 1, j, k),
                        grid_id(i + 1, j + 1, k),
                        grid_id(i, j + 1, k),
                        grid_id(i, j, k + 1),
                        grid_id(i + 1, j, k + 1),
                        grid_id(i + 1, j + 1, k + 1),
                        grid_id(i, j + 1, k + 1),
                    ],
                    e_mpa: 3_000.0,
                    poisson: 0.25,
                })
            })
        })
        .collect();
    let base = grid_id(NX, 0, 0);
    let apex = nodes.len();
    nodes.push([NX as f64 + 1.0, -0.5, -0.5]);
    let tip = nodes.len();
    nodes.push([NX as f64 + 2.0, 0.0, 0.0]);
    let count = nodes.len();
    let mut loads_kn = vec![[0.0; 3]; count];
    loads_kn[tip][2] = 1.0;
    let prescribed_m = nodes
        .iter()
        .map(|point| {
            if point[0] == 0.0 {
                [Some(0.0); 3]
            } else {
                [None; 3]
            }
        })
        .collect();
    let mut prescribed_rotations_rad = vec![[None; 3]; count];
    prescribed_rotations_rad[base] = [Some(0.0); 3];
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![[base, grid_id(NX, 1, 0), grid_id(NX, 0, 1), apex]],
        },
        solid_material: Volume3dMaterial {
            e_mpa: 3_000.0,
            poisson: 0.25,
        },
        tet_materials: None,
        hexes,
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![],
        frames: vec![Frame3dMixedElement {
            nodes: [base, tip],
            e_mpa: 20_000.0,
            poisson: 0.3,
            g_mpa: None,
            area_m2: 0.02,
            iy_m4: 0.005,
            iz_m4: 0.005,
            torsion_j_m4: 0.01,
            roll_angle_rad: 0.0,
        }],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        loads_kn,
        moments_knm: vec![],
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m,
        prescribed_rotations_rad,
        backend,
        max_front_dofs: 4_096,
        threads,
        max_pcg_iterations: 10_000,
    }
}

#[test]
fn matrixfree_tet_hex_frame_above_dense_limit_has_657_free_dofs_and_thread_parity() {
    let reference_input = moderate_mixed_model(Mixed3dBackend::SparsePcg, 1);
    assert_eq!(reference_input.hexes.len(), 150);
    assert_eq!(reference_input.mesh.tets.len(), 1);
    assert_eq!(reference_input.mesh.nodes.len(), 254);
    // 254*3 translations + 2*3 rotations - 6*6 fixed face translations
    // - 3 fixed base rotations = 657 unconstrained DOFs.
    let free = reference_input
        .prescribed_m
        .iter()
        .flatten()
        .filter(|value| value.is_none())
        .count()
        + 3;
    assert_eq!(free, 657);
    assert!(free > 600);
    let reference = solve(&reference_input).expect("sparse PCG reference for moderate mixed mesh");
    assert_eq!(reference.backend_used, Mixed3dBackend::SparsePcg);
    assert!(reference.relative_residual < 1e-8);
    let tip = reference_input.mesh.nodes.len() - 1;
    assert!(reference.nodal_displacements_m[tip][2] > 0.0);
    let direct = solve(&moderate_mixed_model(Mixed3dBackend::SparseDirect, 1))
        .expect("CSR-assembled sparse LDLT above the dense 600-DOF boundary");
    assert_eq!(direct.backend_used, Mixed3dBackend::SparseDirect);
    assert!(direct.relative_residual < 1e-9);
    for (node, (actual, expected)) in direct
        .nodal_displacements_m
        .iter()
        .zip(&reference.nodal_displacements_m)
        .enumerate()
    {
        for axis in 0..3 {
            near(
                actual[axis],
                expected[axis],
                1e-9,
                &format!("sparse LDLT node={node}, axis={axis}"),
            );
        }
    }
    for axis in 0..3 {
        let total: f64 = direct
            .nodal_reactions_kn
            .iter()
            .map(|reaction| reaction[axis])
            .sum();
        near(
            total,
            if axis == 2 { -1.0 } else { 0.0 },
            1e-5,
            "sparse LDLT mixed frame force equilibrium",
        );
    }
    for threads in [1, 4] {
        let result = solve(&moderate_mixed_model(
            Mixed3dBackend::MatrixFreePcg,
            threads,
        ))
        .expect("matrix-free PCG moderate mixed mesh");
        assert_eq!(result.backend_used, Mixed3dBackend::MatrixFreePcg);
        assert!(result.linear_iterations > 0);
        assert!(result.relative_residual < 1e-8);
        for (node, (actual, expected)) in result
            .nodal_displacements_m
            .iter()
            .zip(&reference.nodal_displacements_m)
            .enumerate()
        {
            for axis in 0..3 {
                near(
                    actual[axis],
                    expected[axis],
                    1e-9,
                    &format!("threads={threads}, node={node}, displacement axis={axis}"),
                );
            }
        }
        near(
            result.nodal_rotations_rad[tip].unwrap()[1],
            reference.nodal_rotations_rad[tip].unwrap()[1],
            1e-9,
            "moderate frame tip rotation",
        );
        for axis in 0..3 {
            let total_reaction: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
            near(
                total_reaction,
                if axis == 2 { -1.0 } else { 0.0 },
                1e-5,
                "moderate global force equilibrium",
            );
        }
        for (actual, expected) in result.frame_end_forces_local[0]
            .iter()
            .flatten()
            .zip(reference.frame_end_forces_local[0].iter().flatten())
        {
            near(*actual, *expected, 1e-5, "moderate frame force parity");
        }
    }
}
