//! Three-dimensional Tet4 parity and resource-limit tests for the selectable
//! matrix-free, assembled CSR, and elementwise frontal solver strategies.

use openaec_native_fem::volume3d::{
    solve_volume3d, Mesh, Volume3dElement, Volume3dLoad, Volume3dMaterial, Volume3dRequest,
    Volume3dResponse, Volume3dStrategy, Volume3dSupport,
};

fn request(cells: [usize; 3]) -> Volume3dRequest {
    let mesh = Mesh::structured(cells).unwrap();
    let materials = vec![
        Volume3dMaterial {
            e_mpa: 72_000.0,
            poisson: 0.23,
        },
        Volume3dMaterial {
            e_mpa: 205_000.0,
            poisson: 0.31,
        },
    ];
    let elements = mesh
        .tets
        .iter()
        .map(|&nodes| {
            let x_centroid = nodes.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            Volume3dElement {
                nodes,
                material: usize::from(x_centroid > 0.5),
            }
        })
        .collect();
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
        nodes: mesh.nodes,
        materials,
        elements,
        loads: Vec::new(),
        body_forces: Vec::new(),
        face_tractions: Vec::new(),
        supports,
        threads: 2,
        tolerance: 1e-10,
        max_iterations: 1500,
        solver_strategy: Volume3dStrategy::MatrixFree,
    }
}

fn assert_near(actual: f64, expected: f64, relative: f64, absolute: f64, label: &str) {
    let allowed = absolute.max(relative * actual.abs().max(expected.abs()));
    assert!(
        (actual - expected).abs() <= allowed,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, allowed={allowed:.3e}"
    );
}

fn assert_force_balance(response: &Volume3dResponse, nodes: &[[f64; 3]], loads: &[Volume3dLoad]) {
    let mut total_force = [0.0; 3];
    let mut total_moment = [0.0; 3];
    let mut accumulate = |point: [f64; 3], force: [f64; 3]| {
        for component in 0..3 {
            total_force[component] += force[component];
        }
        total_moment[0] += point[1] * force[2] - point[2] * force[1];
        total_moment[1] += point[2] * force[0] - point[0] * force[2];
        total_moment[2] += point[0] * force[1] - point[1] * force[0];
    };
    for (node, &point) in nodes.iter().enumerate() {
        accumulate(point, response.nodal_reactions_kn[node]);
    }
    for load in loads {
        accumulate(nodes[load.node], load.force_kn);
    }
    for component in 0..3 {
        assert_near(
            total_force[component],
            0.0,
            0.0,
            1e-7,
            "global force balance",
        );
        assert_near(
            total_moment[component],
            0.0,
            0.0,
            1e-7,
            "global moment balance",
        );
    }
}

#[test]
fn heterogeneous_2x2x2_tet4_mesh_matches_all_three_strategies() {
    let mut model = request([2, 2, 2]);
    assert_eq!(model.nodes.len(), 27);
    assert_eq!(model.elements.len(), 48);
    let find_node = |xyz: [f64; 3]| model.nodes.iter().position(|&point| point == xyz).unwrap();
    model.loads = vec![
        Volume3dLoad {
            node: find_node([1.0, 1.0, 1.0]),
            force_kn: [34.0, -12.0, 8.0],
        },
        Volume3dLoad {
            node: find_node([0.5, 0.5, 0.5]),
            force_kn: [-4.0, 3.0, -6.0],
        },
        Volume3dLoad {
            node: find_node([1.0, 0.0, 0.5]),
            force_kn: [2.0, 7.0, -5.0],
        },
    ];
    let mut outcomes = Vec::new();
    for strategy in [
        Volume3dStrategy::MatrixFree,
        Volume3dStrategy::Sparse,
        Volume3dStrategy::Frontal,
    ] {
        model.solver_strategy = strategy;
        let response = solve_volume3d(model.clone()).unwrap();
        assert_eq!(response.solver_used, strategy);
        assert!(response.relative_residual < 1e-8);
        assert_force_balance(&response, &model.nodes, &model.loads);
        outcomes.push(response);
    }

    let reference = &outcomes[0];
    let peak_displacement = reference
        .nodal_displacements_m
        .iter()
        .flat_map(|node| node.iter())
        .map(|value| value.abs())
        .fold(0.0_f64, f64::max);
    assert!(peak_displacement > 1e-7);
    let stress_range = reference
        .element_stress_mpa
        .iter()
        .map(|stress| stress[0])
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), value| {
            (lo.min(value), hi.max(value))
        });
    assert!(stress_range.1 - stress_range.0 > 1e-3);

    for outcome in outcomes.iter().skip(1) {
        for (node, (actual, expected)) in outcome
            .nodal_displacements_m
            .iter()
            .zip(&reference.nodal_displacements_m)
            .enumerate()
        {
            for component in 0..3 {
                assert_near(
                    actual[component],
                    expected[component],
                    2e-7,
                    1e-12,
                    &format!("node {node} displacement {component}"),
                );
            }
        }
        for (node, (actual, expected)) in outcome
            .nodal_reactions_kn
            .iter()
            .zip(&reference.nodal_reactions_kn)
            .enumerate()
        {
            for component in 0..3 {
                assert_near(
                    actual[component],
                    expected[component],
                    2e-7,
                    1e-7,
                    &format!("node {node} reaction {component}"),
                );
            }
        }
        for (element, (actual, expected)) in outcome
            .element_stress_mpa
            .iter()
            .zip(&reference.element_stress_mpa)
            .enumerate()
        {
            for component in 0..6 {
                assert_near(
                    actual[component],
                    expected[component],
                    2e-7,
                    1e-7,
                    &format!("element {element} stress {component}"),
                );
            }
        }
    }
}

#[test]
fn oversized_tet4_models_report_direct_backend_memory_limits() {
    // Frontal is currently capped at 10,000 global DOFs. 15³ cells generate
    // 16³ nodes and 12,288 DOFs, independent of wavefront ordering.
    let mut frontal_model = request([15, 15, 15]);
    frontal_model.solver_strategy = Volume3dStrategy::Frontal;
    let frontal_error = solve_volume3d(frontal_model).unwrap_err();
    assert!(
        frontal_error.contains("10.000 DOF") && frontal_error.contains("wavefront"),
        "{frontal_error}"
    );

    // Sparse direct factorization remains capped at 10,000 DOFs. Iterative
    // sparse CSR now handles this mesh, so only the direct path must reject it.
    let mut sparse_model = request([17, 17, 17]);
    sparse_model.solver_strategy = Volume3dStrategy::SparseDirect;
    let sparse_error = solve_volume3d(sparse_model).unwrap_err();
    assert!(
        sparse_error.contains("10.000 DOF") && sparse_error.contains("factorfill"),
        "{sparse_error}"
    );
}
