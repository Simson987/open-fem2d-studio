//! Bounded coupled finite-J2 Tet4 / plastic Tri3 matrix-free acceptance.
//! The central sheet shares unconstrained nodes with the solid interior.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_membrane_coupled, FiniteJ2CoupledMembrane, FiniteJ2MembraneCoupledRequest,
    FiniteJ2MembranePlasticity, FiniteJ2TetLinearBackend, FiniteJ2TetOptions, FiniteJ2TetRequest,
    FiniteJ2TetTarget,
};

fn index(i: usize, j: usize, k: usize, cells: usize) -> usize {
    (k * (cells + 1) + j) * (cells + 1) + i
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|axis| a[axis] * b[axis]).sum()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[test]
fn plastic_membrane_3072_tet_128_tri_matrix_free_four_threads() {
    let started = std::time::Instant::now();
    let cells = 8;
    let middle = cells / 2;
    let mesh = Mesh::structured([cells; 3]).unwrap();
    assert_eq!(mesh.tets.len(), 3_072);
    assert_eq!(mesh.nodes.len(), 729);

    let mut membranes = Vec::with_capacity(128);
    for j in 0..cells {
        for i in 0..cells {
            let a = index(i, j, middle, cells);
            let b = index(i + 1, j, middle, cells);
            let c = index(i, j + 1, middle, cells);
            let d = index(i + 1, j + 1, middle, cells);
            for nodes in [[a, b, d], [a, d, c]] {
                membranes.push(FiniteJ2CoupledMembrane {
                    nodes,
                    youngs_mpa: 70_000.0,
                    poisson: 0.25,
                    thickness_m: 0.02,
                    plasticity: Some(FiniteJ2MembranePlasticity {
                        yield_mpa: 50.0,
                        hardening_mpa: 1_000.0,
                    }),
                });
            }
        }
    }
    assert_eq!(membranes.len(), 128);
    let center = index(middle, middle, middle, cells);
    assert!(membranes.iter().any(|m| m.nodes.contains(&center)));

    let ex: f64 = 0.004;
    let sx = ex.exp();
    let sy = (-ex).exp();
    let prescribed_m: Vec<[Option<f64>; 3]> = mesh
        .nodes
        .iter()
        .map(|&[x, y, z]| {
            if [x, y, z].iter().any(|&v| v == 0.0 || v == 1.0) {
                [Some((sx - 1.0) * x), Some((sy - 1.0) * y), Some(0.0)]
            } else {
                [None; 3]
            }
        })
        .collect();
    assert_eq!(prescribed_m[center], [None; 3]);
    let input = FiniteJ2MembraneCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh: mesh.clone(),
            steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m,
            }],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmres,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        },
        trusses: vec![],
        membranes,
    };
    let result = solve_membrane_coupled(&input).unwrap();
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmres
    );
    assert_eq!(result.element_states.len(), 3_072);
    assert_eq!(result.membrane_states.len(), 128);
    assert!(result.accepted_steps.last().is_some_and(|step| {
        step.target_index == 0 && (step.target_fraction - 1.0).abs() < 1e-14
    }));
    assert!(result
        .accepted_steps
        .iter()
        .all(|step| { step.true_free_residual_kn.is_finite() && step.newton_iterations > 0 }));
    assert!(result.true_free_residual_kn.is_finite());
    assert!(
        result.true_free_residual_kn < 1e-3,
        "residual {} kN",
        result.true_free_residual_kn
    );

    let plastic_tets = result
        .element_states
        .iter()
        .filter(|s| s.equivalent_plastic_strain > 1e-8)
        .count();
    let plastic_membranes = result
        .membrane_states
        .iter()
        .filter(|s| {
            s.as_ref()
                .is_some_and(|state| state.equivalent_plastic_strain > 1e-8)
        })
        .count();
    assert!(plastic_tets > 0, "no committed solid plastic history");
    assert!(
        plastic_membranes > 0,
        "no committed membrane plastic history"
    );

    // No applied nodal loads: the complete support reactions must balance.
    for axis in 0..3 {
        let sum: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
        assert!(
            sum.is_finite() && sum.abs() < 1e-3,
            "axis {axis} reaction sum {sum} kN"
        );
    }

    // Reconstruct the local membrane resultant using only the current
    // triangle geometry and global Kirchhoff tensor. For J = area_ratio *
    // thickness_stretch, N = 1000 * t0 * thickness_stretch * tau/J.
    let triangle = 2 * (middle * cells + middle);
    let membrane = &input.membranes[triangle];
    assert_eq!(membrane.nodes[0], center);
    let point = |node: usize| -> [f64; 3] {
        std::array::from_fn(|axis| {
            mesh.nodes[node][axis] + result.nodal_displacements_m[node][axis]
        })
    };
    let [a, b, d] = membrane.nodes.map(point);
    let h = 1.0 / cells as f64;
    let g1: [f64; 3] = std::array::from_fn(|axis| (b[axis] - a[axis]) / h);
    let g2: [f64; 3] = std::array::from_fn(|axis| (d[axis] - b[axis]) / h);
    let g1_length = dot(g1, g1).sqrt();
    let normal = cross(g1, g2);
    let area_ratio = dot(normal, normal).sqrt();
    assert!(area_ratio > 0.0);
    let q1 = g1.map(|value| value / g1_length);
    let unit_normal = normal.map(|value| value / area_ratio);
    let q2 = cross(unit_normal, q1);
    let tau = result.membrane_kirchhoff_mpa[triangle].unwrap();
    let component = |left: [f64; 3], right: [f64; 3]| -> f64 {
        (0..3)
            .flat_map(|i| (0..3).map(move |j| left[i] * tau[i][j] * right[j]))
            .sum()
    };
    let expected = [component(q1, q1), component(q2, q2), component(q1, q2)]
        .map(|stress| 1_000.0 * membrane.thickness_m * stress / area_ratio);
    let actual = result.membrane_force_resultant_kn_per_m[triangle].unwrap();
    for axis in 0..3 {
        assert!(
            (actual[axis] - expected[axis]).abs() < 1e-7,
            "resultant {axis}: {} != {} kN/m",
            actual[axis],
            expected[axis]
        );
    }
    let alpha = result.membrane_states[triangle]
        .unwrap()
        .equivalent_plastic_strain;
    assert!(
        alpha > 1e-8,
        "central membrane did not retain plastic strain"
    );
    eprintln!(
        "finite-J2 plastic membrane scale: 3072 Tet4, 128 Tri3, 2187 DOF, 4 threads, {plastic_tets} plastic Tet4, {plastic_membranes} plastic Tri3, center alpha {alpha:.3e}, residual {:.3e} kN, {:.2?}",
        result.true_free_residual_kn,
        started.elapsed()
    );
}
