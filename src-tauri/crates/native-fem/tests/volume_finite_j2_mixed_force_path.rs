//! Force-driven, nonaffine plastic load/unload with shared Tet4, Tri3 and
//! truss nodes. Backend parity and equilibrium complement the large imposed
//! displacement acceptance: the reference is the independently assembled
//! load/reaction balance, not a closed displacement formula.

use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_finite_j2::{
    solve, solve_membrane_coupled, FiniteJ2CoupledMembrane, FiniteJ2CoupledTruss,
    FiniteJ2MembraneCoupledRequest, FiniteJ2TetLinearBackend, FiniteJ2TetOptions,
    FiniteJ2TetRequest, FiniteJ2TetTarget,
};

fn index(i: usize, j: usize, k: usize) -> usize {
    (k * 3 + j) * 3 + i
}

fn request(backend: FiniteJ2TetLinearBackend) -> FiniteJ2MembraneCoupledRequest {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let center = index(1, 1, 1);
    let mut peak_loads = vec![[0.0; 3]; mesh.nodes.len()];
    peak_loads[center] = [500_000.0, -250_000.0, 150_000.0];
    let prescribed = mesh
        .nodes
        .iter()
        .map(|&[x, y, z]| {
            if [x, y, z].iter().any(|&v| v == 0.0 || v == 1.0) {
                [Some(0.0); 3]
            } else {
                [None; 3]
            }
        })
        .collect::<Vec<_>>();
    let target = |loads_kn| FiniteJ2TetTarget {
        loads_kn,
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: prescribed.clone(),
    };
    let mut membranes = Vec::new();
    for j in 0..2 {
        for i in 0..2 {
            let a = index(i, j, 1);
            let b = index(i + 1, j, 1);
            let c = index(i, j + 1, 1);
            let d = index(i + 1, j + 1, 1);
            for nodes in [[a, b, d], [a, d, c]] {
                membranes.push(FiniteJ2CoupledMembrane {
                    nodes,
                    youngs_mpa: 70_000.0,
                    poisson: 0.25,
                    thickness_m: 0.02,
                    plasticity: None,
                });
            }
        }
    }
    FiniteJ2MembraneCoupledRequest {
        volume: FiniteJ2TetRequest {
            mesh,
            steel: FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap(),
            element_steels: None,
            targets: vec![target(peak_loads), target(vec![[0.0; 3]; 27])],
            options: FiniteJ2TetOptions {
                linear_backend: backend,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        },
        trusses: vec![FiniteJ2CoupledTruss {
            nodes: [center, index(2, 1, 1)],
            youngs_mpa: 210_000.0,
            area_m2: 0.002,
            plasticity: None,
        }],
        membranes,
    }
}

#[test]
fn plastic_force_driven_load_unload_matches_every_tangent_backend() {
    let mut reference: Option<([f64; 3], f64)> = None;
    for backend in [
        FiniteJ2TetLinearBackend::Dense,
        FiniteJ2TetLinearBackend::SparseGmres,
        FiniteJ2TetLinearBackend::FrontalWave,
        FiniteJ2TetLinearBackend::MatrixFreeGmres,
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
        FiniteJ2TetLinearBackend::Automatic,
    ] {
        let input = request(backend);
        let result = solve_membrane_coupled(&input).unwrap();
        let center_u = result.nodal_displacements_m[index(1, 1, 1)];
        let maximum_plastic_strain = result
            .element_states
            .iter()
            .map(|state| state.equivalent_plastic_strain)
            .fold(0.0_f64, f64::max);
        assert!(
            maximum_plastic_strain > 0.0,
            "{backend:?}: no retained plasticity"
        );
        assert!(
            center_u.iter().any(|value| value.abs() > 1e-5),
            "{backend:?}: unloading should retain a plastic displacement"
        );
        assert_eq!(result.membrane_stress_mpa.len(), 8);
        assert_eq!(result.truss_axial_force_kn.len(), 1);
        assert!(result
            .accepted_steps
            .iter()
            .any(|step| step.target_index == 1));
        assert!(result.true_free_residual_kn < 1e-3, "{backend:?}: residual");
        let reaction_sum: [f64; 3] = std::array::from_fn(|axis| {
            result
                .nodal_reactions_kn
                .iter()
                .map(|reaction| reaction[axis])
                .sum()
        });
        assert!(reaction_sum.iter().all(|value| value.abs() < 1e-3));
        let p = &input.volume.mesh.nodes;
        let u = &result.nodal_displacements_m;
        let a = index(1, 1, 1);
        let b = index(2, 1, 1);
        let l0 = 0.5;
        let l = (0..3)
            .map(|axis| (p[b][axis] + u[b][axis] - p[a][axis] - u[a][axis]).powi(2))
            .sum::<f64>()
            .sqrt();
        let stretch = l / l0;
        let expected_truss =
            1_000.0 * 210_000.0 * 0.002 * (stretch * stretch - 1.0) / 2.0 * stretch;
        assert!((result.truss_axial_force_kn[0] - expected_truss).abs() < 1e-8);
        if let Some((reference_u, reference_plastic)) = reference {
            for axis in 0..3 {
                assert!(
                    (center_u[axis] - reference_u[axis]).abs() < 1e-7,
                    "{backend:?}: center displacement parity"
                );
            }
            assert!((maximum_plastic_strain - reference_plastic).abs() < 1e-7);
        } else {
            reference = Some((center_u, maximum_plastic_strain));
            let baseline = solve(&input.volume).unwrap();
            let baseline_u = baseline.nodal_displacements_m[index(1, 1, 1)];
            assert!(
                (0..3).any(|axis| (center_u[axis] - baseline_u[axis]).abs() > 1e-8),
                "shared membrane/truss elements must change the free node"
            );
        }
    }
}
