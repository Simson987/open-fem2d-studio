//! Large finite-strain plastic Tet4 + embedded Tri3 sheet + truss acceptance.
//! A membrane sheet has free interior nodes, and one of those nodes also
//! anchors an axial truss. The 35³ mesh contains 257,250 Tet4 and 2,450
//! Tri3; only its explicit release test uses that costly size.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_membrane_coupled, FiniteJ2CoupledMembrane, FiniteJ2CoupledTruss,
    FiniteJ2MembraneCoupledRequest, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn index(i: usize, j: usize, k: usize, cells: usize) -> usize {
    (k * (cells + 1) + j) * (cells + 1) + i
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}

fn check_patch(cells: usize) {
    let started = std::time::Instant::now();
    let mesh = Mesh::structured([cells; 3]).unwrap();
    let middle = cells / 2;
    let center = index(middle, middle, middle, cells);
    let anchor = index(cells, middle, middle, cells);
    let mut membranes = Vec::with_capacity(2 * cells * cells);
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
                    thickness_m: 0.01,
                    plasticity: None,
                });
            }
        }
    }
    let a: f64 = 0.004;
    let sx = a.exp();
    let sy = (-a).exp();
    let request = FiniteJ2MembraneCoupledRequest {
        volume: FiniteJ2TetRequest {
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: mesh
                    .nodes
                    .iter()
                    .map(|&[x, y, z]| {
                        if [x, y, z].iter().any(|&v| v == 0.0 || v == 1.0) {
                            [Some((sx - 1.0) * x), Some((sy - 1.0) * y), Some(0.0)]
                        } else {
                            [None; 3]
                        }
                    })
                    .collect(),
            }],
            mesh: mesh.clone(),
            steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
            element_steels: None,
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        },
        trusses: vec![FiniteJ2CoupledTruss {
            nodes: [center, anchor],
            youngs_mpa: 210_000.0,
            area_m2: 0.0001,
            plasticity: None,
        }],
        membranes,
    };
    let result = solve_membrane_coupled(&request).unwrap();
    assert_eq!(result.element_states.len(), 6 * cells * cells * cells);
    assert_eq!(result.membrane_stress_mpa.len(), 2 * cells * cells);
    assert_eq!(result.truss_axial_force_kn.len(), 1);
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
    );
    assert!(result.true_free_residual_kn < 1e-3);
    assert!(result
        .element_states
        .iter()
        .any(|state| state.equivalent_plastic_strain > 0.0));

    let displaced = |node: usize| {
        std::array::from_fn::<_, 3, _>(|axis| {
            mesh.nodes[node][axis] + result.nodal_displacements_m[node][axis]
        })
    };
    let p = displaced(center);
    let q = displaced(anchor);
    let original = (0..3)
        .map(|axis| (mesh.nodes[anchor][axis] - mesh.nodes[center][axis]).powi(2))
        .sum::<f64>()
        .sqrt();
    let current = (0..3)
        .map(|axis| (q[axis] - p[axis]).powi(2))
        .sum::<f64>()
        .sqrt();
    let stretch = current / original;
    let expected_truss = 1_000.0 * 210_000.0 * 0.0001 * (stretch * stretch - 1.0) / 2.0 * stretch;
    assert!((result.truss_axial_force_kn[0] - expected_truss).abs() < 1e-8);

    // On the first triangle of the central square, the reference edges are
    // h along x and h along x+y. Reconstruct g1 and g2 directly from its
    // deformed vertices, then evaluate the independent plane-stress law.
    let triangle = 2 * (middle * cells + middle);
    let [na, nb, nd] = request.membranes[triangle].nodes;
    assert_eq!(na, center);
    let h = 1.0 / cells as f64;
    let xa = displaced(na);
    let xb = displaced(nb);
    let xd = displaced(nd);
    let g1 = std::array::from_fn::<_, 3, _>(|axis| (xb[axis] - xa[axis]) / h);
    let g2 = std::array::from_fn::<_, 3, _>(|axis| (xd[axis] - xb[axis]) / h);
    let e11 = (dot(g1, g1) - 1.0) / 2.0;
    let e22 = (dot(g2, g2) - 1.0) / 2.0;
    let gamma12 = dot(g1, g2);
    let plane = 70_000.0 / (1.0 - 0.25_f64.powi(2));
    let expected_stress = [
        plane * (e11 + 0.25 * e22),
        plane * (0.25 * e11 + e22),
        70_000.0 * gamma12 / 2.5,
    ];
    for axis in 0..3 {
        assert!(
            (result.membrane_stress_mpa[triangle][axis] - expected_stress[axis]).abs() < 2e-6,
            "membrane component {axis}: {} != {}",
            result.membrane_stress_mpa[triangle][axis],
            expected_stress[axis]
        );
    }
    let affine_e11 = (sx * sx - 1.0) / 2.0;
    let affine_e22 = (sy * sy - 1.0) / 2.0;
    let affine_s11 = plane * (affine_e11 + 0.25 * affine_e22);
    assert!(
        (result.membrane_stress_mpa[triangle][0] - affine_s11).abs() > 0.01,
        "the free-node truss must make the membrane field nonaffine"
    );
    let reaction_sum: [f64; 3] =
        std::array::from_fn(|axis| result.nodal_reactions_kn.iter().map(|r| r[axis]).sum());
    assert!(reaction_sum.iter().all(|value| value.abs() < 1e-3));
    eprintln!(
        "finite-J2 mixed: {} Tet4, {} Tri3, 1 truss, {} DOF, 4 threads; N={:.6} kN, S11={:.6} MPa, residual {:.3e} kN, {:.2?}",
        mesh.tets.len(), request.membranes.len(), mesh.nodes.len() * 3,
        result.truss_axial_force_kn[0], result.membrane_stress_mpa[triangle][0],
        result.true_free_residual_kn, started.elapsed()
    );
}

#[test]
fn mixed_3072_tet_128_membrane_patch() {
    check_patch(8);
}

#[test]
#[ignore = "34,992 Tet4 plus 648 Tri3; run explicitly in release"]
fn mixed_34992_tet_648_membrane_patch() {
    check_patch(18);
}

#[test]
#[ignore = "257,250 Tet4 plus 2,450 Tri3; run explicitly in release with sufficient RAM"]
fn mixed_257250_tet_2450_membrane_patch() {
    check_patch(35);
}
