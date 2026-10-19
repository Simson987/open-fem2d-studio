//! Independent equilibrium checks for the Tet4 automatic solver fallback.
//! The specimen is slender and has a jump in Young's modulus, so one PCG
//! iteration cannot resolve its coupled free degrees of freedom.

use openaec_native_fem::volume3d::{
    solve_volume3d, Mesh, Volume3dElement, Volume3dLoad, Volume3dMaterial, Volume3dRequest,
    Volume3dResponse, Volume3dStrategy, Volume3dSupport,
};

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn specimen() -> Volume3dRequest {
    let mut mesh = Mesh::structured([3, 1, 1]).unwrap();
    // Six tetrahedra span each long, shallow segment of the cantilever.
    // Dimensions and the material contrast make the free stiffness ill
    // conditioned while keeping every tetrahedron geometrically valid.
    for point in &mut mesh.nodes {
        point[0] *= 6.0;
        point[1] *= 0.4;
        point[2] *= 0.3;
    }
    let loaded_node = mesh
        .nodes
        .iter()
        .position(|&point| point == [6.0, 0.4, 0.3])
        .unwrap();
    let supports = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 0.0)
        .map(|(node, _)| Volume3dSupport {
            node,
            displacement_m: [Some(0.0); 3],
        })
        .collect();
    Volume3dRequest {
        elements: mesh
            .tets
            .iter()
            .map(|&nodes| {
                let centroid_x = nodes.iter().map(|&id| mesh.nodes[id][0]).sum::<f64>() / 4.0;
                Volume3dElement {
                    nodes,
                    material: usize::from(centroid_x >= 3.0),
                }
            })
            .collect(),
        nodes: mesh.nodes,
        materials: vec![
            Volume3dMaterial {
                e_mpa: 2_000.0,
                poisson: 0.22,
            },
            Volume3dMaterial {
                e_mpa: 200_000.0,
                poisson: 0.31,
            },
        ],
        loads: vec![Volume3dLoad {
            node: loaded_node,
            force_kn: [0.7, -0.4, -1.2],
        }],
        body_forces: vec![],
        face_tractions: vec![],
        supports,
        threads: 2,
        tolerance: 1e-8,
        max_iterations: 1,
        solver_strategy: Volume3dStrategy::Automatic,
    }
}

fn assert_independent_equilibrium(model: &Volume3dRequest, result: &Volume3dResponse) {
    // Integrate the reported constant element stresses directly as
    // f_int = V B^T sigma. MPa is converted to kN/m² independently here.
    let mut internal = vec![[0.0_f64; 3]; model.nodes.len()];
    for (element, stress) in model.elements.iter().zip(&result.element_stress_mpa) {
        let [p0, p1, p2, p3] = element.nodes.map(|node| model.nodes[node]);
        let [a, b, c] = [sub(p1, p0), sub(p2, p0), sub(p3, p0)];
        let determinant = dot(a, cross(b, c));
        assert!(determinant.abs() > 0.0);
        let gradients =
            [cross(b, c), cross(c, a), cross(a, b)].map(|row| row.map(|value| value / determinant));
        let g0 = [
            -gradients.iter().map(|g| g[0]).sum::<f64>(),
            -gradients.iter().map(|g| g[1]).sum::<f64>(),
            -gradients.iter().map(|g| g[2]).sum::<f64>(),
        ];
        let [sxx, syy, szz, sxy, syz, szx] = *stress;
        let sigma = [[sxx, sxy, szx], [sxy, syy, syz], [szx, syz, szz]];
        for (&node, gradient) in
            element
                .nodes
                .iter()
                .zip([g0, gradients[0], gradients[1], gradients[2]])
        {
            for axis in 0..3 {
                internal[node][axis] +=
                    determinant.abs() / 6.0 * 1_000.0 * dot(sigma[axis], gradient);
            }
        }
    }
    let mut external = vec![[0.0_f64; 3]; model.nodes.len()];
    for load in &model.loads {
        for axis in 0..3 {
            external[load.node][axis] += load.force_kn[axis];
        }
    }
    let mut constrained = vec![[false; 3]; model.nodes.len()];
    for support in &model.supports {
        for axis in 0..3 {
            constrained[support.node][axis] = support.displacement_m[axis].is_some();
        }
    }
    let load_norm = external
        .iter()
        .flat_map(|v| v.iter())
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt();
    let mut free_residual_sq = 0.0;
    let mut total_force = [0.0_f64; 3];
    let mut total_moment = [0.0_f64; 3];
    for node in 0..model.nodes.len() {
        let force = [
            internal[node][0] - external[node][0],
            internal[node][1] - external[node][1],
            internal[node][2] - external[node][2],
        ];
        for axis in 0..3 {
            let reported = result.nodal_reactions_kn[node][axis];
            assert!(
                (force[axis] - reported).abs() < 1e-6,
                "reaction mismatch at node {node}, axis {axis}"
            );
            if !constrained[node][axis] {
                free_residual_sq += force[axis] * force[axis];
            }
            total_force[axis] += reported + external[node][axis];
        }
        let moment = cross(
            model.nodes[node],
            [
                result.nodal_reactions_kn[node][0] + external[node][0],
                result.nodal_reactions_kn[node][1] + external[node][1],
                result.nodal_reactions_kn[node][2] + external[node][2],
            ],
        );
        for axis in 0..3 {
            total_moment[axis] += moment[axis];
        }
    }
    let true_relative_residual = free_residual_sq.sqrt() / load_norm;
    assert!(
        true_relative_residual < 5e-8,
        "true residual {true_relative_residual:.3e}"
    );
    assert!(result.relative_residual < 5e-8);
    for axis in 0..3 {
        assert!(total_force[axis].abs() < 1e-6, "force balance, axis {axis}");
        assert!(
            total_moment[axis].abs() < 1e-6,
            "moment balance, axis {axis}"
        );
    }
}

#[test]
fn automatic_fallback_recovers_a_pcg_stagnation_with_true_equilibrium() {
    let model = specimen();
    let mut iterative = model.clone();
    iterative.solver_strategy = Volume3dStrategy::MatrixFree;
    let error = solve_volume3d(iterative).unwrap_err();
    assert!(error.contains("did not converge"), "{error}");

    let recovered = solve_volume3d(model.clone()).unwrap();
    assert_eq!(recovered.solver_used, Volume3dStrategy::Frontal);
    assert_eq!(recovered.iterations, 0);
    assert_independent_equilibrium(&model, &recovered);

    let mut direct = model.clone();
    direct.solver_strategy = Volume3dStrategy::SparseDirect;
    let reference = solve_volume3d(direct).unwrap();
    assert_independent_equilibrium(&model, &reference);
    for (fallback, sparse) in recovered
        .nodal_displacements_m
        .iter()
        .zip(&reference.nodal_displacements_m)
    {
        for axis in 0..3 {
            assert!((fallback[axis] - sparse[axis]).abs() < 1e-9);
        }
    }
}

#[test]
fn underrestrained_tet4_never_reports_a_solved_model() {
    let mut model = specimen();
    model.supports.truncate(1);
    for strategy in [
        Volume3dStrategy::Automatic,
        Volume3dStrategy::MatrixFree,
        Volume3dStrategy::Sparse,
        Volume3dStrategy::SparseDirect,
        Volume3dStrategy::Frontal,
    ] {
        model.solver_strategy = strategy;
        let error = solve_volume3d(model.clone()).unwrap_err();
        assert!(error.contains("rigid-body modes"), "{strategy:?}: {error}");
    }
}
