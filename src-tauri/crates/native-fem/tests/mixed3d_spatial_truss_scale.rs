//! A genuinely spatial, redundantly braced truss at thousands of members.
//! Every cuboid bay has all 28 node pairs, with shared section bars deduped.
//! It checks free residual, global force and moment balance, and small-model
//! backend parity without using the same displacement as its own oracle.

use std::collections::BTreeSet;

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest, Truss3dElement};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

fn model(bays: usize, backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut nodes = Vec::with_capacity(4 * (bays + 1));
    for station in 0..=bays {
        for &(y, z) in &[(-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5), (0.5, 0.5)] {
            nodes.push([station as f64, y, z]);
        }
    }
    let mut edges = BTreeSet::new();
    for bay in 0..bays {
        let local: Vec<usize> = (4 * bay..4 * bay + 8).collect();
        for i in 0..8 {
            for j in i + 1..8 {
                edges.insert((local[i], local[j]));
            }
        }
    }
    let trusses = edges
        .into_iter()
        .map(|(a, b)| Truss3dElement {
            nodes: [a, b],
            e_mpa: 210_000.0,
            area_m2: 0.001,
        })
        .collect();
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    loads_kn[4 * bays + 3] = [1.0, 0.0, -10.0];
    let mut prescribed_m = vec![[None; 3]; nodes.len()];
    for support in &mut prescribed_m[..4] {
        *support = [Some(0.0); 3];
    }
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![],
        },
        solid_material: Volume3dMaterial {
            e_mpa: 210_000.0,
            poisson: 0.3,
        },
        tet_materials: None,
        hexes: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        trusses,
        loads_kn,
        prescribed_m,
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        frames: vec![],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        moments_knm: vec![],
        prescribed_rotations_rad: vec![],
        backend,
        max_front_dofs: 64,
        threads: 4,
        max_pcg_iterations: 20_000,
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() < tolerance,
        "actual {actual:.9e}; expected {expected:.9e}; tolerance {tolerance:.2e}"
    );
}

fn check_equilibrium(
    request: &Mixed3dRequest,
    result: &openaec_native_fem::mixed3d::Mixed3dResult,
) {
    let mut total_force = [0.0; 3];
    let mut total_moment = [0.0; 3];
    for (index, &position) in request.mesh.nodes.iter().enumerate() {
        let force = std::array::from_fn::<_, 3, _>(|axis| {
            request.loads_kn[index][axis] + result.nodal_reactions_kn[index][axis]
        });
        for axis in 0..3 {
            total_force[axis] += force[axis];
        }
        total_moment[0] += position[1] * force[2] - position[2] * force[1];
        total_moment[1] += position[2] * force[0] - position[0] * force[2];
        total_moment[2] += position[0] * force[1] - position[1] * force[0];
    }
    for axis in 0..3 {
        close(total_force[axis], 0.0, 1e-6);
        close(total_moment[axis], 0.0, 1e-4);
    }
    assert!(result.relative_residual < 1e-8);
    assert_eq!(result.truss_axial_force_kn.len(), request.trusses.len());
    assert!(result
        .truss_axial_force_kn
        .iter()
        .all(|force| force.is_finite()));

    // For a linear pin-jointed truss, Clapeyron's theorem gives
    // F·u = sum(N² L / EA). This energy check uses member forces and
    // geometric lengths independently of the assembled global matrix.
    let external_work: f64 = request
        .loads_kn
        .iter()
        .zip(&result.nodal_displacements_m)
        .map(|(force, displacement)| {
            (0..3)
                .map(|axis| force[axis] * displacement[axis])
                .sum::<f64>()
        })
        .sum();
    let internal_work: f64 = request
        .trusses
        .iter()
        .zip(&result.truss_axial_force_kn)
        .map(|(bar, &normal_force)| {
            let [a, b] = bar.nodes.map(|node| request.mesh.nodes[node]);
            let length = (0..3)
                .map(|axis| (b[axis] - a[axis]).powi(2))
                .sum::<f64>()
                .sqrt();
            normal_force.powi(2) * length / (1_000.0 * bar.e_mpa * bar.area_m2)
        })
        .sum();
    let relative_work_error = (external_work - internal_work).abs() / external_work.abs();
    assert!(
        relative_work_error < 1e-5,
        "truss work mismatch: external={external_work:.9e}, internal={internal_work:.9e}, relative={relative_work_error:.3e}"
    );
}

#[test]
fn braced_spatial_truss_5638_members_balances_force_and_moment() {
    let request = model(256, Mixed3dBackend::FrontalWave);
    assert_eq!(request.mesh.nodes.len(), 1_028);
    assert_eq!(request.trusses.len(), 5_638);
    let result = solve(&request).expect("spatial truss frontal solve");
    check_equilibrium(&request, &result);
    assert!(result.nodal_displacements_m.last().unwrap()[2] < 0.0);
}

#[test]
fn braced_spatial_truss_sparse_direct_matches_frontal() {
    let frontal = solve(&model(8, Mixed3dBackend::FrontalWave)).expect("frontal");
    let sparse = solve(&model(8, Mixed3dBackend::SparseDirect)).expect("sparse direct");
    let matrix_free = solve(&model(8, Mixed3dBackend::MatrixFreePcg)).expect("matrix-free PCG");
    for (a, b) in frontal
        .nodal_displacements_m
        .iter()
        .zip(&sparse.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-9);
        }
    }
    check_equilibrium(&model(8, Mixed3dBackend::FrontalWave), &frontal);
    check_equilibrium(&model(8, Mixed3dBackend::SparseDirect), &sparse);
    check_equilibrium(&model(8, Mixed3dBackend::MatrixFreePcg), &matrix_free);
    for (a, b) in frontal
        .nodal_displacements_m
        .iter()
        .zip(&matrix_free.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-9);
        }
    }
}

#[test]
fn sixty_four_bay_spatial_truss_matrix_free_matches_frontal() {
    let input = model(64, Mixed3dBackend::MatrixFreePcg);
    let matrix_free = solve(&input).expect("64-bay matrix-free spatial truss");
    let frontal = solve(&model(64, Mixed3dBackend::FrontalWave)).expect("64-bay frontal truss");
    check_equilibrium(&input, &matrix_free);
    check_equilibrium(&input, &frontal);
    let a = matrix_free.nodal_displacements_m.last().unwrap();
    let b = frontal.nodal_displacements_m.last().unwrap();
    for axis in 0..3 {
        close(a[axis], b[axis], 1e-7);
    }
}

#[test]
#[ignore = "large spatial automatic-backend acceptance; run explicitly in release"]
fn two_hundred_fifty_six_bay_spatial_truss_automatic_matches_frontal() {
    let input = model(256, Mixed3dBackend::Automatic);
    let automatic = solve(&input).expect("256-bay automatic spatial truss");
    let frontal =
        solve(&model(256, Mixed3dBackend::FrontalWave)).expect("256-bay frontal spatial truss");
    check_equilibrium(&input, &automatic);
    eprintln!("256-bay automatic backend: {:?}", automatic.backend_used);
    let a = automatic.nodal_displacements_m.last().unwrap();
    let b = frontal.nodal_displacements_m.last().unwrap();
    for axis in 0..3 {
        close(a[axis], b[axis], 1e-6);
    }
}

// A 64 m long, 16 m wide truss cage: 64 separate braced legs meet at one
// loaded free head. Each leg has four fixed root joints and four head bars.
// The common head couples all 64 legs, so this is one connected 3D model.
fn spatial_cage(arms_per_side: usize, bays: usize, backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut request = model(1, backend);
    request.mesh.nodes.clear();
    request.trusses.clear();
    request.loads_kn.clear();
    request.prescribed_m.clear();
    request.max_front_dofs = 64;
    let head = 0;
    request.mesh.nodes.push([bays as f64 + 1.0, 0.0, 0.0]);
    request.loads_kn.push([1.0, 0.0, -10.0]);
    request.prescribed_m.push([None; 3]);
    for row in 0..arms_per_side {
        for column in 0..arms_per_side {
            let mut leg = model(bays, Mixed3dBackend::FrontalWave);
            let y = 2.0 * (column as f64 - (arms_per_side as f64 - 1.0) / 2.0);
            let z = 2.0 * (row as f64 - (arms_per_side as f64 - 1.0) / 2.0);
            for node in &mut leg.mesh.nodes {
                node[1] += y;
                node[2] += z;
            }
            let offset = request.mesh.nodes.len();
            request.mesh.nodes.extend(leg.mesh.nodes);
            request.loads_kn.extend(vec![[0.0; 3]; leg.loads_kn.len()]);
            request.prescribed_m.extend(leg.prescribed_m);
            request
                .trusses
                .extend(leg.trusses.into_iter().map(|bar| Truss3dElement {
                    nodes: bar.nodes.map(|node| node + offset),
                    ..bar
                }));
            for corner in 0..4 {
                request.trusses.push(Truss3dElement {
                    nodes: [offset + 4 * bays + corner, head],
                    e_mpa: 210_000.0,
                    area_m2: 0.001,
                });
            }
        }
    }
    request
}

#[test]
#[ignore = "90,752-member connected spatial truss acceptance; run explicitly in release"]
fn ninety_thousand_member_spatial_cage_balances_force_moment_and_energy() {
    let input = spatial_cage(8, 64, Mixed3dBackend::FrontalWave);
    assert_eq!(input.mesh.nodes.len(), 16_641);
    assert_eq!(input.trusses.len(), 90_752);
    let result = solve(&input).expect("large connected truss cage frontal solve");
    assert_eq!(result.backend_used, Mixed3dBackend::FrontalWave);
    check_equilibrium(&input, &result);
    assert!(result.nodal_displacements_m[0][2] < 0.0);
    eprintln!(
        "spatial cage: {} bars, {} nodes, tip uz={:.9e} m, residual={:.3e}, max front={:?}",
        input.trusses.len(),
        input.mesh.nodes.len(),
        result.nodal_displacements_m[0][2],
        result.relative_residual,
        result.frontal_maximum_front_dofs
    );
}

#[test]
#[ignore = "large automatic fallback and memory-bound acceptance; run explicitly in release"]
fn ninety_thousand_member_automatic_recovers_with_bounded_front() {
    let mut input = spatial_cage(8, 64, Mixed3dBackend::Automatic);
    input.max_pcg_iterations = 1;
    let automatic = solve(&input).expect("large bounded automatic frontal fallback");
    assert_eq!(automatic.backend_used, Mixed3dBackend::FrontalWave);
    assert_eq!(automatic.frontal_maximum_front_dofs, Some(27));
    check_equilibrium(&input, &automatic);

    let direct =
        solve(&spatial_cage(8, 64, Mixed3dBackend::FrontalWave)).expect("direct frontal reference");
    for axis in 0..3 {
        close(
            automatic.nodal_displacements_m[0][axis],
            direct.nodal_displacements_m[0][axis],
            1e-8,
        );
    }

    input.max_front_dofs = 4_096;
    let error = solve(&input).expect_err("oversized fallback estimate must be rejected");
    assert!(error.contains("did not converge"), "{error}");
    assert!(error.contains("frontal fallback skipped"), "{error}");
}

#[test]
fn three_hundred_eighty_four_bay_truss_passes_after_frontal_refinement() {
    let input = model(384, Mixed3dBackend::FrontalWave);
    let result = solve(&input).expect("slender spatial truss frontal refinement");
    check_equilibrium(&input, &result);
    assert!(result.relative_residual < 1e-8);
}

#[test]
fn small_spatial_cage_matches_sparse_and_matrix_free_backends() {
    let frontal_input = spatial_cage(2, 8, Mixed3dBackend::FrontalWave);
    let frontal = solve(&frontal_input).expect("small cage frontal solve");
    check_equilibrium(&frontal_input, &frontal);
    for backend in [Mixed3dBackend::SparseDirect, Mixed3dBackend::MatrixFreePcg] {
        let input = spatial_cage(2, 8, backend);
        let result = solve(&input).expect("small cage alternative backend");
        check_equilibrium(&input, &result);
        for axis in 0..3 {
            close(
                result.nodal_displacements_m[0][axis],
                frontal.nodal_displacements_m[0][axis],
                1e-8,
            );
        }
    }
}
