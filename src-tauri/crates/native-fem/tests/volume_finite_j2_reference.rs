//! Independent global Tet4 references for finite-strain J2 steel.
//!
//! The affine cube uses a hand-derived diagonal Hencky return. The force
//! balance reconstructs each Tet4's reference gradients and integrates
//! `1000 V P grad(N)` independently of the production assembly.

use openaec_native_fem::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel};
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetResult,
    FiniteJ2TetTarget,
};

fn close(actual: f64, expected: f64, absolute: f64, relative: f64, label: &str) {
    let tolerance = absolute + relative * expected.abs();
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn steel() -> FiniteJ2Steel {
    FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap()
}

fn mu() -> f64 {
    210_000.0 / (2.0 * 1.3)
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn geometry(mesh: &Mesh, tet: [usize; 4]) -> ([[f64; 3]; 4], f64) {
    let [a, b, c, d] = tet.map(|index| mesh.nodes[index]);
    let ab = sub(b, a);
    let ac = sub(c, a);
    let ad = sub(d, a);
    let six_volume = dot(ab, cross(ac, ad));
    assert!(six_volume > 1e-12);
    let g1 = cross(ac, ad).map(|component| component / six_volume);
    let g2 = cross(ad, ab).map(|component| component / six_volume);
    let g3 = cross(ab, ac).map(|component| component / six_volume);
    let g0 = std::array::from_fn(|axis| -g1[axis] - g2[axis] - g3[axis]);
    ([g0, g1, g2, g3], six_volume / 6.0)
}

fn force_balance(
    mesh: &Mesh,
    result: &FiniteJ2TetResult,
    target: &FiniteJ2TetTarget,
    absolute: f64,
) {
    let mut internal = vec![[0.0; 3]; mesh.nodes.len()];
    for (element, &tet) in mesh.tets.iter().enumerate() {
        let (gradients, volume) = geometry(mesh, tet);
        let p = result.element_first_piola_mpa[element];
        for (local, &node) in tet.iter().enumerate() {
            for axis in 0..3 {
                internal[node][axis] += 1_000.0 * volume * dot(p[axis], gradients[local]);
            }
        }
    }
    let mut free_squared = 0.0;
    let mut net = [0.0; 3];
    for node in 0..mesh.nodes.len() {
        for axis in 0..3 {
            let reaction = internal[node][axis] - target.loads_kn[node][axis];
            close(
                result.nodal_reactions_kn[node][axis],
                reaction,
                absolute,
                2e-9,
                "independently assembled reaction",
            );
            if target.prescribed_m[node][axis].is_none() {
                free_squared += reaction * reaction;
            }
            net[axis] += reaction + target.loads_kn[node][axis];
        }
    }
    close(
        result.true_free_residual_kn,
        free_squared.sqrt(),
        absolute,
        2e-8,
        "independently assembled free residual",
    );
    for (axis, value) in net.into_iter().enumerate() {
        close(
            value,
            0.0,
            absolute,
            0.0,
            &format!("global net force [{axis}]"),
        );
    }
}

fn virgin_element_stress(mesh: &Mesh, result: &FiniteJ2TetResult, absolute: f64) {
    for (element, &tet) in mesh.tets.iter().enumerate() {
        let (gradients, _) = geometry(mesh, tet);
        let mut f = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                f[i][j] = if i == j { 1.0 } else { 0.0 }
                    + (0..4)
                        .map(|local| {
                            result.nodal_displacements_m[tet[local]][i] * gradients[local][j]
                        })
                        .sum::<f64>();
            }
        }
        let point = steel().update(&FiniteJ2State::default(), f).unwrap();
        close(
            result.element_states[element].equivalent_plastic_strain,
            point.state.equivalent_plastic_strain,
            1e-9,
            1e-7,
            "virgin element plastic history",
        );
        for i in 0..3 {
            for j in 0..3 {
                close(
                    result.element_first_piola_mpa[element][i][j],
                    point.first_piola_mpa[i][j],
                    absolute,
                    1e-8,
                    "virgin element Piola",
                );
            }
        }
    }
}

fn affine_target(mesh: &Mesh, a: f64) -> FiniteJ2TetTarget {
    let f1 = a.exp();
    let f2 = (-a).exp();
    FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|&[x, y, z]| {
                if [x, y, z] == [0.5, 0.5, 0.5] {
                    [None; 3]
                } else {
                    [Some((f1 - 1.0) * x), Some((f2 - 1.0) * y), Some(0.0)]
                }
            })
            .collect(),
    }
}

fn expected_forward(a: f64) -> (f64, f64, f64, f64) {
    let q = 2.0 * mu() * 3.0_f64.sqrt() * a;
    let alpha = (q - 250.0) / (3.0 * mu() + 2_000.0);
    let z = 3.0_f64.sqrt() * alpha / 2.0;
    let tau11 = 2.0 * mu() * (a - z);
    (tau11 / a.exp(), -tau11 / (-a).exp(), alpha, z)
}

fn expected_reverse(a: f64) -> (f64, f64, f64) {
    let (_, _, alpha1, z1) = expected_forward(a);
    let q2 = 2.0 * mu() * 3.0_f64.sqrt() * (a + z1);
    let delta_alpha2 = (q2 - 250.0 - 2_000.0 * alpha1) / (3.0 * mu() + 2_000.0);
    let tau11 = 2.0 * mu() * (-a - z1 + 3.0_f64.sqrt() * delta_alpha2 / 2.0);
    (tau11 / (-a).exp(), -tau11 / a.exp(), alpha1 + delta_alpha2)
}

fn check_affine_solution(
    mesh: &Mesh,
    result: &FiniteJ2TetResult,
    target: &FiniteJ2TetTarget,
    a: f64,
    expected_p11: f64,
    expected_p22: f64,
    expected_alpha: f64,
) {
    force_balance(mesh, result, target, 5e-6);
    let center = mesh
        .nodes
        .iter()
        .position(|point| *point == [0.5; 3])
        .unwrap();
    close(
        result.nodal_displacements_m[center][0],
        0.5 * (a.exp() - 1.0),
        2e-11,
        1e-8,
        "free center u_x",
    );
    close(
        result.nodal_displacements_m[center][1],
        0.5 * ((-a).exp() - 1.0),
        2e-11,
        1e-8,
        "free center u_y",
    );
    for (element, state) in result.element_states.iter().enumerate() {
        close(
            state.equivalent_plastic_strain,
            expected_alpha,
            2e-9,
            1e-7,
            "affine plastic strain",
        );
        let p = result.element_first_piola_mpa[element];
        close(p[0][0], expected_p11, 2e-6, 1e-8, "affine P11");
        close(p[1][1], expected_p22, 2e-6, 1e-8, "affine P22");
        for (row, column) in [(0, 1), (0, 2), (1, 0), (1, 2), (2, 0), (2, 1), (2, 2)] {
            close(p[row][column], 0.0, 2e-6, 0.0, "affine off-axis P");
        }
    }
    let right_x: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    let top_y: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[1] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][1])
        .sum();
    close(
        right_x,
        1_000.0 * expected_p11,
        5e-5,
        1e-8,
        "right nominal traction",
    );
    close(
        top_y,
        1_000.0 * expected_p22,
        5e-5,
        1e-8,
        "top nominal traction",
    );
    close(
        result.true_free_residual_kn,
        0.0,
        5e-6,
        0.0,
        "affine free residual",
    );
}

#[test]
fn affine_plastic_patch_and_reverse_match_hand_piola_and_reactions() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let a = 0.002_f64;
    let forward_target = affine_target(&mesh, a);
    let reverse_target = affine_target(&mesh, -a);
    let forward_request = FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel: steel(),
        element_steels: None,
        targets: vec![forward_target.clone()],
        options: FiniteJ2TetOptions::default(),
    };
    let forward = solve(&forward_request).unwrap();
    let (p11, p22, alpha1, _) = expected_forward(a);
    check_affine_solution(&mesh, &forward, &forward_target, a, p11, p22, alpha1);

    let reversed = solve(&FiniteJ2TetRequest {
        targets: vec![forward_target, reverse_target.clone()],
        ..forward_request
    })
    .unwrap();
    let (p11_reverse, p22_reverse, alpha2) = expected_reverse(a);
    assert!(alpha2 > alpha1);
    check_affine_solution(
        &mesh,
        &reversed,
        &reverse_target,
        -a,
        p11_reverse,
        p22_reverse,
        alpha2,
    );
    assert!(reversed
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
}

fn nonaffine_target(mesh: &Mesh, load_scale: f64) -> FiniteJ2TetTarget {
    let mut target = FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                if point[0] == 0.0 {
                    [Some(0.0); 3]
                } else {
                    [None; 3]
                }
            })
            .collect(),
    };
    for (node, point) in mesh.nodes.iter().enumerate() {
        if point[0] == 1.0 {
            target.loads_kn[node] = [
                load_scale * 35_000.0 * (1.0 + point[1]),
                load_scale * -15_000.0 * (1.0 + point[2]),
                load_scale * 5_000.0,
            ];
        }
    }
    target
}

#[test]
fn nonaffine_nodal_load_reactions_match_independent_tet4_force_assembly() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let target = nonaffine_target(&mesh, 1.0);
    let result = solve(&FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel: steel(),
        element_steels: None,
        targets: vec![target.clone()],
        options: FiniteJ2TetOptions::default(),
    })
    .unwrap();
    force_balance(&mesh, &result, &target, 2e-5);
    close(
        result.true_free_residual_kn,
        0.0,
        2e-5,
        0.0,
        "nonaffine free residual",
    );
    let maximum_displacement = result
        .nodal_displacements_m
        .iter()
        .flatten()
        .map(|value| value.abs())
        .fold(0.0_f64, f64::max);
    assert!(maximum_displacement > 0.0);
    // Rebuild each element F from independently reconstructed gradients.
    virgin_element_stress(&mesh, &result, 2e-6);
    assert!(
        result
            .element_states
            .iter()
            .any(|state| state.equivalent_plastic_strain > 0.0),
        "the nonaffine force case must exercise plastic history"
    );
}

#[test]
fn sparse_gmres_matches_dense_on_nonaffine_plastic_load_and_unload() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let full = nonaffine_target(&mesh, 1.0);
    let half = nonaffine_target(&mesh, 0.5);
    let base = FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel: steel(),
        element_steels: None,
        targets: vec![full, half.clone()],
        options: FiniteJ2TetOptions::default(),
    };
    let dense = solve(&base).unwrap();
    let sparse = solve(&FiniteJ2TetRequest {
        options: FiniteJ2TetOptions {
            linear_backend: FiniteJ2TetLinearBackend::SparseGmres,
            ..FiniteJ2TetOptions::default()
        },
        ..base
    })
    .unwrap();
    assert_eq!(dense.linear_backend_used, FiniteJ2TetLinearBackend::Dense);
    assert_eq!(
        sparse.linear_backend_used,
        FiniteJ2TetLinearBackend::SparseGmres
    );
    assert!(sparse
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    assert!(dense
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    assert!(sparse
        .element_states
        .iter()
        .any(|state| state.equivalent_plastic_strain > 0.0));
    force_balance(&mesh, &dense, &half, 2e-5);
    force_balance(&mesh, &sparse, &half, 2e-5);
    close(
        dense.true_free_residual_kn,
        0.0,
        2e-5,
        0.0,
        "dense unload residual",
    );
    close(
        sparse.true_free_residual_kn,
        0.0,
        2e-5,
        0.0,
        "sparse unload residual",
    );
    for node in 0..mesh.nodes.len() {
        for axis in 0..3 {
            close(
                sparse.nodal_displacements_m[node][axis],
                dense.nodal_displacements_m[node][axis],
                1e-8,
                1e-7,
                "dense/sparse displacement",
            );
            close(
                sparse.nodal_reactions_kn[node][axis],
                dense.nodal_reactions_kn[node][axis],
                0.01,
                1e-7,
                "dense/sparse reaction",
            );
        }
    }
    for element in 0..mesh.tets.len() {
        close(
            sparse.element_states[element].equivalent_plastic_strain,
            dense.element_states[element].equivalent_plastic_strain,
            2e-7,
            1e-5,
            "dense/sparse history",
        );
        for i in 0..3 {
            for j in 0..3 {
                close(
                    sparse.element_first_piola_mpa[element][i][j],
                    dense.element_first_piola_mpa[element][i][j],
                    1e-4,
                    1e-7,
                    "dense/sparse Piola",
                );
            }
        }
    }
}

#[test]
fn sparse_gmres_above_dense_cap_balances_nonaffine_plastic_model() {
    let mesh = Mesh::structured([3, 3, 3]).unwrap();
    assert!(mesh.nodes.len() * 3 > 120);
    let mut target = nonaffine_target(&mesh, 0.42);
    for (node, point) in mesh.nodes.iter().enumerate() {
        if point[0] == 1.0 {
            target.loads_kn[node][0] *= 1.0 + 0.1 * point[2];
        }
    }
    let dense_request = FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel: steel(),
        element_steels: None,
        targets: vec![target.clone()],
        options: FiniteJ2TetOptions::default(),
    };
    assert!(solve(&dense_request).unwrap_err().contains("Dense limit"));
    let result = solve(&FiniteJ2TetRequest {
        options: FiniteJ2TetOptions {
            linear_backend: FiniteJ2TetLinearBackend::SparseGmres,
            ..FiniteJ2TetOptions::default()
        },
        ..dense_request
    })
    .unwrap();
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::SparseGmres
    );
    force_balance(&mesh, &result, &target, 1e-3);
    virgin_element_stress(&mesh, &result, 2e-6);
    close(
        result.true_free_residual_kn,
        0.0,
        1e-3,
        0.0,
        "over-cap sparse free residual",
    );
    assert!(result
        .element_states
        .iter()
        .any(|state| state.equivalent_plastic_strain > 0.0));
}

#[test]
fn sparse_gmres_iteration_exhaustion_is_reported_as_failure() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let mut options = FiniteJ2TetOptions::default();
    options.linear_backend = FiniteJ2TetLinearBackend::SparseGmres;
    options.gmres_restart = 1;
    options.gmres_max_iterations = 1;
    options.gmres_relative_tolerance = 1e-12;
    options.max_cutbacks = 1;
    let error = solve(&FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel: steel(),
        element_steels: None,
        targets: vec![nonaffine_target(&mesh, 1.0)],
        options,
    })
    .unwrap_err();
    assert!(
        error.contains("GMRES")
            && (error.contains("converge") || error.contains("stagnated"))
            && error.contains("cutbacks"),
        "iteration exhaustion must remain an explicit failed solve: {error}"
    );
}

#[test]
fn failed_second_target_returns_error_instead_of_partially_committed_result() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let prescribed_m: Vec<[Option<f64>; 3]> = mesh
        .nodes
        .iter()
        .map(|point| {
            if point[0] == 0.0 {
                [Some(0.0); 3]
            } else {
                [None; 3]
            }
        })
        .collect();
    let zero = FiniteJ2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: prescribed_m.clone(),
    };
    let mut extreme = zero.clone();
    for (node, point) in mesh.nodes.iter().enumerate() {
        if point[0] == 1.0 {
            extreme.loads_kn[node] = [5_000.0, -1_000.0, 250.0];
        }
    }
    let mut options = FiniteJ2TetOptions::default();
    options.residual_tolerance = 1e-12;
    options.max_newton_iterations = 1;
    options.max_cutbacks = 1;
    let error = solve(&FiniteJ2TetRequest {
        mesh,
        steel: steel(),
        element_steels: None,
        targets: vec![zero, extreme],
        options,
    })
    .unwrap_err();
    assert!(
        error.contains("target 1 failed after") && error.contains("cutbacks"),
        "second target should exhaust cutbacks without returning a partial result: {error}"
    );
}
