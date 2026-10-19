//! Matrix-free scale check for a plastic finite-strain truss sharing a free
//! node with J2 Tet4 solids. The truss force and return map are reconstructed
//! from the deformed endpoint distance, independent of solver assembly.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve_coupled, FiniteJ2CoupledRequest, FiniteJ2CoupledTruss, FiniteJ2TetLinearBackend,
    FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget, FiniteJ2TrussPlasticity,
};

fn index(i: usize, j: usize, k: usize, cells: usize) -> usize {
    (k * (cells + 1) + j) * (cells + 1) + i
}

fn check_plastic_truss_patch(cells: usize) {
    let mesh = Mesh::structured([cells; 3]).unwrap();
    let center = index(cells / 2, cells / 2, cells / 2, cells);
    let anchored = index(cells, cells / 2, cells / 2, cells);
    let axial_log_strain = 0.004_f64;
    let transverse_log_strain = -0.004_f64;
    let stretch_x = axial_log_strain.exp();
    let stretch_y = transverse_log_strain.exp();
    let e = 210_000.0;
    let yield_mpa = 100.0;
    let hardening_mpa = 2_000.0;
    let area_m2 = 0.02;
    let request = FiniteJ2CoupledRequest {
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
                            [
                                Some((stretch_x - 1.0) * x),
                                Some((stretch_y - 1.0) * y),
                                Some(0.0),
                            ]
                        } else {
                            [None; 3]
                        }
                    })
                    .collect(),
            }],
            mesh: mesh.clone(),
            steel: FiniteJ2Steel::new(e, 0.3, 250.0, 2_000.0).unwrap(),
            element_steels: None,
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        },
        trusses: vec![FiniteJ2CoupledTruss {
            nodes: [center, anchored],
            youngs_mpa: e,
            area_m2,
            plasticity: Some(FiniteJ2TrussPlasticity {
                yield_mpa,
                hardening_mpa,
            }),
        }],
    };
    let result = solve_coupled(&request).unwrap();
    assert_eq!(result.element_states.len(), 6 * cells * cells * cells);
    assert_eq!(
        result.linear_backend_used,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
    );
    assert!(result.true_free_residual_kn < 1e-3);
    assert!(result
        .element_states
        .iter()
        .any(|state| state.equivalent_plastic_strain > 0.0));

    let p = mesh.nodes[center];
    let q = mesh.nodes[anchored];
    let up = result.nodal_displacements_m[center];
    let uq = result.nodal_displacements_m[anchored];
    let l0 = (0..3)
        .map(|axis| (q[axis] - p[axis]).powi(2))
        .sum::<f64>()
        .sqrt();
    let l = (0..3)
        .map(|axis| (q[axis] + uq[axis] - p[axis] - up[axis]).powi(2))
        .sum::<f64>()
        .sqrt();
    let log_strain = (l / l0).ln();
    let plastic_increment = (e * log_strain.abs() - yield_mpa).max(0.0) / (e + hardening_mpa);
    let signed_plastic = log_strain.signum() * plastic_increment;
    let history = result.truss_states[0].expect("plastic truss history");
    assert!(
        plastic_increment > 0.0,
        "the independent return map must yield"
    );
    assert!((history.plastic_log_strain - signed_plastic).abs() < 1e-9);
    assert!((history.accumulated_plastic_log_strain - plastic_increment).abs() < 1e-9);
    let expected_force_kn = 1_000.0 * area_m2 * l0 * e * (log_strain - signed_plastic) / l;
    assert!(
        (result.truss_axial_force_kn[0] - expected_force_kn).abs()
            < 1e-8 * expected_force_kn.abs().max(1.0)
    );
    let expected_tangent = e * hardening_mpa / (e + hardening_mpa);
    assert!((result.truss_algorithmic_modulus_mpa[0].unwrap() - expected_tangent).abs() < 1e-8);
    let affine_ux = (stretch_x - 1.0) * p[0];
    assert!(
        (up[0] - affine_ux).abs() > 1e-8,
        "the truss must move the free solid node"
    );
    for axis in 0..3 {
        let sum = result
            .nodal_reactions_kn
            .iter()
            .map(|r| r[axis])
            .sum::<f64>();
        assert!(
            sum.abs() < 1e-3,
            "global reaction imbalance in {axis}: {sum}"
        );
    }
}

#[test]
fn plastic_truss_with_3072_j2_tets_four_threads() {
    check_plastic_truss_patch(8);
}

#[test]
#[ignore = "34,992 Tet4 with plastic truss; run explicitly in release"]
fn plastic_truss_with_34992_j2_tets_four_threads() {
    check_plastic_truss_patch(18);
}
