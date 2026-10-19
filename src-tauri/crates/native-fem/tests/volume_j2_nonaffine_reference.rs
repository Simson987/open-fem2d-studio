//! Independent non-affine equilibrium checks for the opt-in J2 Tet4 CSR-PCG path.
//!
//! Reconstruct constant Tet4 shape gradients directly from coordinates, then
//! integrate the reported stress into nodal forces. This verifies free-DOF
//! equilibrium, reactions, global force/moment balance and virtual work without
//! using the production assembler or tangent. The separately reconstructed
//! elastic stress and J2 yield surface check the reported material history.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{
    solve, J2TetFaceTraction, J2TetLinearBackend, J2TetOptions, J2TetRequest, J2TetResult,
    J2TetTarget,
};

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.into_iter().zip(b).map(|(x, y)| x * y).sum()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn subtract(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn tet_geometry(points: [[f64; 3]; 4]) -> (f64, [[f64; 3]; 4]) {
    let a = subtract(points[1], points[0]);
    let b = subtract(points[2], points[0]);
    let c = subtract(points[3], points[0]);
    let determinant = dot(a, cross(b, c));
    assert!(determinant.abs() > 1e-12);
    let mut gradients = [[0.0; 3]; 4];
    for (index, vector) in [cross(b, c), cross(c, a), cross(a, b)]
        .into_iter()
        .enumerate()
    {
        for component in 0..3 {
            gradients[index + 1][component] = vector[component] / determinant;
            gradients[0][component] -= gradients[index + 1][component];
        }
    }
    (determinant.abs() / 6.0, gradients)
}

fn nonaffine_request() -> J2TetRequest {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let mut loads_kn = vec![[0.0; 3]; mesh.nodes.len()];
    for (node, point) in mesh.nodes.iter().enumerate() {
        if *point == [1.0, 1.0, 1.0] {
            loads_kn[node] = [0.0, 40_000.0, -33_333.0];
        } else if *point == [1.0, 0.0, 0.0] {
            loads_kn[node] = [16_667.0, 0.0, 0.0];
        }
    }
    let prescribed_m = mesh
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
    let target = J2TetTarget {
        loads_kn,
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m,
    };
    let mut options = J2TetOptions::default();
    options.linear_backend = J2TetLinearBackend::SparsePcg;
    options.pcg_threads = 4;
    options.residual_tolerance = 1e-7;
    J2TetRequest {
        mesh,
        steel: J2Steel::new(200_000.0, 0.3, 180.0, 5_000.0).unwrap(),
        element_steels: None,
        targets: vec![target],
        options,
    }
}

#[test]
fn nonaffine_plastic_coupon_satisfies_independently_assembled_balance_and_work() {
    let request = nonaffine_request();
    let result = solve(&request).unwrap();
    assert_eq!(result.linear_backend_used, J2TetLinearBackend::SparsePcg);
    let mesh = &request.mesh;
    let target = &request.targets[0];
    let steel = request.steel;
    let mu = steel.youngs_mpa / (2.0 * (1.0 + steel.poisson));
    let lambda =
        steel.youngs_mpa * steel.poisson / ((1.0 + steel.poisson) * (1.0 - 2.0 * steel.poisson));
    let mut internal_kn = vec![[0.0; 3]; mesh.nodes.len()];
    let mut internal_work_kn_m = 0.0;
    let mut minimum_strain_xx = f64::INFINITY;
    let mut maximum_strain_xx = f64::NEG_INFINITY;
    let mut yielded = 0;
    let mut elastic = 0;
    let mut maximum_constitutive_error = 0.0_f64;

    for (element, nodes) in mesh.tets.iter().enumerate() {
        let points = nodes.map(|node| mesh.nodes[node]);
        let (volume, gradients) = tet_geometry(points);
        let mut displacement_gradient = [[0.0; 3]; 3];
        for (local, &node) in nodes.iter().enumerate() {
            for (i, row) in displacement_gradient.iter_mut().enumerate() {
                for j in 0..3 {
                    row[j] += result.nodal_displacements_m[node][i] * gradients[local][j];
                }
            }
        }
        let mut strain = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                strain[i][j] = 0.5 * (displacement_gradient[i][j] + displacement_gradient[j][i]);
            }
        }
        minimum_strain_xx = minimum_strain_xx.min(strain[0][0]);
        maximum_strain_xx = maximum_strain_xx.max(strain[0][0]);
        let state = &result.element_states[element];
        let elastic_trace: f64 = (0..3)
            .map(|i| strain[i][i] - state.plastic_strain[i][i])
            .sum();
        let mean_stress: f64 = (0..3).map(|i| state.stress_mpa[i][i]).sum::<f64>() / 3.0;
        let mut deviator_sq = 0.0;
        for i in 0..3 {
            for j in 0..3 {
                let expected = 2.0 * mu * (strain[i][j] - state.plastic_strain[i][j])
                    + if i == j { lambda * elastic_trace } else { 0.0 };
                maximum_constitutive_error =
                    maximum_constitutive_error.max((state.stress_mpa[i][j] - expected).abs());
                let deviator = state.stress_mpa[i][j] - if i == j { mean_stress } else { 0.0 };
                deviator_sq += deviator * deviator;
                internal_work_kn_m += 1_000.0 * volume * state.stress_mpa[i][j] * strain[i][j];
            }
        }
        let von_mises = (1.5 * deviator_sq).sqrt();
        let yield_strength =
            steel.yield_mpa + steel.hardening_mpa * state.equivalent_plastic_strain;
        assert!(von_mises <= yield_strength + 1e-5);
        if state.equivalent_plastic_strain > 1e-10 {
            yielded += 1;
            assert!((von_mises - yield_strength).abs() < 1e-5);
        } else {
            elastic += 1;
        }
        for (local, &node) in nodes.iter().enumerate() {
            for i in 0..3 {
                for j in 0..3 {
                    internal_kn[node][i] +=
                        1_000.0 * volume * state.stress_mpa[i][j] * gradients[local][j];
                }
            }
        }
    }

    assert!(
        yielded > 0 && elastic > 0,
        "yielded {yielded}, elastic {elastic}"
    );
    assert!(
        maximum_strain_xx - minimum_strain_xx > 1e-4,
        "insufficiently non-affine strain range"
    );
    assert!(maximum_constitutive_error < 1e-6);
    let mut maximum_force_error = 0.0_f64;
    let mut external_work_kn_m = 0.0;
    let mut total_force = [0.0; 3];
    let mut total_moment = [0.0; 3];
    for node in 0..mesh.nodes.len() {
        for i in 0..3 {
            let expected_reaction = internal_kn[node][i] - target.loads_kn[node][i];
            maximum_force_error = maximum_force_error
                .max((result.nodal_reactions_kn[node][i] - expected_reaction).abs());
            if target.prescribed_m[node][i].is_none() {
                maximum_force_error = maximum_force_error.max(expected_reaction.abs());
            }
            total_force[i] += target.loads_kn[node][i] + result.nodal_reactions_kn[node][i];
            external_work_kn_m += target.loads_kn[node][i] * result.nodal_displacements_m[node][i];
        }
        let net = [
            target.loads_kn[node][0] + result.nodal_reactions_kn[node][0],
            target.loads_kn[node][1] + result.nodal_reactions_kn[node][1],
            target.loads_kn[node][2] + result.nodal_reactions_kn[node][2],
        ];
        let moment = cross(mesh.nodes[node], net);
        for i in 0..3 {
            total_moment[i] += moment[i];
        }
    }
    let work_error = (internal_work_kn_m - external_work_kn_m).abs();
    eprintln!(
        "non-affine J2: {} yielded, {} elastic Tet4; strain xx range {:.3e}; constitutive {:.3e} MPa; force {:.3e} kN; work {:.3e} kN m; residual {:.3e} kN",
        yielded,
        elastic,
        maximum_strain_xx - minimum_strain_xx,
        maximum_constitutive_error,
        maximum_force_error,
        work_error,
        result.true_free_residual_kn,
    );
    assert!(result.true_free_residual_kn < 1e-3);
    assert!(maximum_force_error < 1e-3);
    assert!(work_error < 1e-5);
    assert!(total_force.iter().all(|force| force.abs() < 1e-3));
    assert!(total_moment.iter().all(|moment| moment.abs() < 1e-3));

    let mut direct_request = request.clone();
    direct_request.options.linear_backend = J2TetLinearBackend::SparseDirect;
    let direct = solve(&direct_request).unwrap();
    for (pcg, reference) in result
        .nodal_displacements_m
        .iter()
        .zip(&direct.nodal_displacements_m)
    {
        for i in 0..3 {
            assert!((pcg[i] - reference[i]).abs() < 1e-8);
        }
    }
    for (pcg, reference) in result
        .nodal_reactions_kn
        .iter()
        .zip(&direct.nodal_reactions_kn)
    {
        for i in 0..3 {
            assert!((pcg[i] - reference[i]).abs() < 1e-3);
        }
    }
    for (pcg, reference) in result.element_states.iter().zip(&direct.element_states) {
        assert!((pcg.equivalent_plastic_strain - reference.equivalent_plastic_strain).abs() < 1e-7);
        for i in 0..3 {
            for j in 0..3 {
                assert!((pcg.stress_mpa[i][j] - reference.stress_mpa[i][j]).abs() < 1e-3);
            }
        }
    }
}

fn end_shear_request(cells: [usize; 3], shear_kn_per_m2: f64) -> J2TetRequest {
    let mesh = Mesh::structured(cells).unwrap();
    let mut face_tractions = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face_nodes in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if face_nodes.iter().all(|&node| mesh.nodes[node][0] == 1.0) {
                face_tractions.push(J2TetFaceTraction {
                    element,
                    face_nodes,
                    traction_kn_per_m2: [0.0, shear_kn_per_m2, 0.0],
                });
            }
        }
    }
    assert_eq!(face_tractions.len(), 2 * cells[1] * cells[2]);
    let target = J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions,
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
    let mut options = J2TetOptions::default();
    options.linear_backend = J2TetLinearBackend::SparsePcg;
    options.pcg_threads = 4;
    options.residual_tolerance = 1e-7;
    J2TetRequest {
        mesh,
        steel: J2Steel::new(200_000.0, 0.3, 180.0, 5_000.0).unwrap(),
        element_steels: None,
        targets: vec![target],
        options,
    }
}

fn check_end_shear_balance(request: &J2TetRequest, result: &J2TetResult) -> (usize, usize, f64) {
    assert_eq!(result.linear_backend_used, J2TetLinearBackend::SparsePcg);
    let mesh = &request.mesh;
    let target = &request.targets[0];
    let mut external = vec![[0.0; 3]; mesh.nodes.len()];
    let mut loaded_area = 0.0;
    for face in &target.face_tractions {
        let p = face.face_nodes.map(|node| mesh.nodes[node]);
        let area_vector = cross(subtract(p[1], p[0]), subtract(p[2], p[0]));
        let area = 0.5 * dot(area_vector, area_vector).sqrt();
        loaded_area += area;
        for node in face.face_nodes {
            for i in 0..3 {
                external[node][i] += face.traction_kn_per_m2[i] * area / 3.0;
            }
        }
    }
    assert!((loaded_area - 1.0).abs() < 1e-10);
    let mut internal = vec![[0.0; 3]; mesh.nodes.len()];
    let mut yielded = 0;
    let mut elastic = 0;
    let mut min_xx = f64::INFINITY;
    let mut max_xx = f64::NEG_INFINITY;
    for (element, nodes) in mesh.tets.iter().enumerate() {
        let (volume, gradients) = tet_geometry(nodes.map(|node| mesh.nodes[node]));
        let state = &result.element_states[element];
        if state.equivalent_plastic_strain > 1e-10 {
            yielded += 1;
        } else {
            elastic += 1;
        }
        let xx: f64 = nodes
            .iter()
            .enumerate()
            .map(|(local, &node)| result.nodal_displacements_m[node][0] * gradients[local][0])
            .sum();
        min_xx = min_xx.min(xx);
        max_xx = max_xx.max(xx);
        for (local, &node) in nodes.iter().enumerate() {
            for i in 0..3 {
                for j in 0..3 {
                    internal[node][i] +=
                        1_000.0 * volume * state.stress_mpa[i][j] * gradients[local][j];
                }
            }
        }
    }
    let mut force_balance = [0.0; 3];
    let mut moment_balance = [0.0; 3];
    let mut max_free_force = 0.0_f64;
    let mut max_reaction_error = 0.0_f64;
    let mut internal_work = 0.0;
    let mut external_work = 0.0;
    for node in 0..mesh.nodes.len() {
        for i in 0..3 {
            let reaction = result.nodal_reactions_kn[node][i];
            let independent_reaction = internal[node][i] - external[node][i];
            max_reaction_error = max_reaction_error.max((reaction - independent_reaction).abs());
            if target.prescribed_m[node][i].is_none() {
                max_free_force = max_free_force.max(independent_reaction.abs());
            }
            force_balance[i] += reaction + external[node][i];
            internal_work += internal[node][i] * result.nodal_displacements_m[node][i];
            external_work += external[node][i] * result.nodal_displacements_m[node][i];
        }
        let net = [
            result.nodal_reactions_kn[node][0] + external[node][0],
            result.nodal_reactions_kn[node][1] + external[node][1],
            result.nodal_reactions_kn[node][2] + external[node][2],
        ];
        let moment = cross(mesh.nodes[node], net);
        for i in 0..3 {
            moment_balance[i] += moment[i];
        }
    }
    let force_scale = target.face_tractions[0].traction_kn_per_m2[1].abs();
    assert!(
        yielded > 0 && elastic > 0,
        "yielded {yielded}, elastic {elastic}"
    );
    assert!(max_xx - min_xx > 1e-4, "strain range {}", max_xx - min_xx);
    assert!(result.true_free_residual_kn < force_scale * 1e-5);
    assert!(max_free_force < force_scale * 1e-5);
    assert!(max_reaction_error < force_scale * 1e-8);
    assert!(force_balance
        .iter()
        .all(|value| value.abs() < force_scale * 1e-5));
    assert!(moment_balance
        .iter()
        .all(|value| value.abs() < force_scale * 1e-5));
    assert!((internal_work - external_work).abs() < force_scale * 1e-5);
    (yielded, elastic, max_free_force)
}

#[test]
fn end_shear_small_mesh_has_mixed_plasticity_and_independent_balance() {
    let request = end_shear_request([4, 4, 4], 60_000.0);
    let result = solve(&request).unwrap();
    let (yielded, elastic, max_free_force) = check_end_shear_balance(&request, &result);
    eprintln!("end shear 384 Tet4: {yielded} yielded, {elastic} elastic; max free force {max_free_force:.3e} kN; residual {:.3e} kN", result.true_free_residual_kn);
}

#[test]
#[ignore = "257,250 Tet4 nonlinear end-shear CSR-PCG release benchmark; run explicitly"]
fn end_shear_257k_tet4_release_benchmark_has_independent_balance() {
    let request = end_shear_request([35, 35, 35], 60_000.0);
    assert_eq!(request.mesh.tets.len(), 257_250);
    assert_eq!(request.mesh.nodes.len() * 3, 139_968);
    let start = std::time::Instant::now();
    let result = solve(&request).unwrap();
    let (yielded, elastic, max_free_force) = check_end_shear_balance(&request, &result);
    eprintln!("end shear 257250 Tet4/139968 DOF: {yielded} yielded, {elastic} elastic; max free force {max_free_force:.3e} kN; residual {:.3e} kN; {} accepted steps, {} cutbacks, {:.3}s", result.true_free_residual_kn, result.accepted_steps.len(), result.cutbacks, start.elapsed().as_secs_f64());
}
