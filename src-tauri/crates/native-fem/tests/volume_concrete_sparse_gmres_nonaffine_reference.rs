//! Independent equilibrium and internal-work reconstruction for the opt-in
//! concrete Tet4 sparse GMRES route. The perturbed grid has non-affine end
//! displacements, nodal loads, and both damaged and intact material regions.
//! This verifies assembly consistency, not concrete-design validity.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetLinearBackend, ConcreteTetMaterial, ConcreteTetOptions, ConcreteTetRequest,
    ConcreteTetResult, ConcreteTetTarget,
};

fn near(actual: f64, expected: f64, tolerance: f64, name: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{name}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn mesh(divisions: usize) -> Mesh {
    let mut mesh = Mesh::structured([divisions; 3]).unwrap();
    for point in &mut mesh.nodes {
        let [x, y, z] = *point;
        if (0.0..1.0).contains(&x) && x > 0.0 && y > 0.0 && y < 1.0 && z > 0.0 && z < 1.0 {
            point[0] += 0.026 * (17.0 * x + 11.0 * y + 7.0 * z).sin();
            point[1] += 0.021 * (13.0 * x - 9.0 * y + 8.0 * z).cos();
            point[2] += 0.018 * (5.0 * x + 3.0 * y - 19.0 * z).sin();
        }
    }
    mesh
}

fn request(mesh: Mesh, backend: ConcreteTetLinearBackend) -> ConcreteTetRequest {
    let element_materials = mesh
        .tets
        .iter()
        .map(|tet| {
            let y = tet.iter().map(|&node| mesh.nodes[node][1]).sum::<f64>() / 4.0;
            let weak = y > 0.45;
            ConcreteTetMaterial {
                e_mpa: 30_000.0,
                poisson: 0.2,
                tensile_strength_mpa: if weak { 1.5 } else { 15.0 },
                fracture_energy_n_per_m: if weak { 200.0 } else { 5_000.0 },
                crack_band_width_m: 1.0 / 3.0,
            }
        })
        .collect();
    let targets = [0.65, 1.0]
        .into_iter()
        .map(|scale| {
            let mut loads_kn = vec![[0.0; 3]; mesh.nodes.len()];
            let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
            for (node, &[x, y, z]) in mesh.nodes.iter().enumerate() {
                if x == 0.0 {
                    prescribed_m[node] = [Some(0.0); 3];
                } else if x == 1.0 {
                    prescribed_m[node][0] = Some(scale * (0.00004 + 0.00016 * y * y));
                } else if y > 0.6 && z > 0.6 {
                    loads_kn[node][0] = scale * 12.0;
                    loads_kn[node][2] = -scale * 3.0;
                }
            }
            ConcreteTetTarget {
                loads_kn,
                prescribed_m,
                body_forces: vec![],
                face_tractions: vec![],
            }
        })
        .collect();
    let mut options = ConcreteTetOptions::default();
    options.linear_backend = backend;
    options.gmres_restart = 60;
    options.gmres_max_iterations = 5_000;
    ConcreteTetRequest {
        mesh,
        e_mpa: 30_000.0,
        poisson: 0.2,
        tensile_strength_mpa: 3.0,
        fracture_energy_n_per_m: 1_000.0,
        crack_band_width_m: 1.0 / 3.0,
        element_materials: Some(element_materials),
        targets,
        options,
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn reconstructed_forces_and_work(mesh: &Mesh, result: &ConcreteTetResult) -> (Vec<[f64; 3]>, f64) {
    let mut internal = vec![[0.0; 3]; mesh.nodes.len()];
    let mut stress_strain_work_kn_m = 0.0;
    for (element, tet) in mesh.tets.iter().enumerate() {
        let [p0, p1, p2, p3] = tet.map(|node| mesh.nodes[node]);
        let [a, b, c] = [sub(p1, p0), sub(p2, p0), sub(p3, p0)];
        let det = dot(a, cross(b, c));
        assert!(det.abs() > 1e-12, "degenerate reference Tet4 {element}");
        let g1 = cross(b, c).map(|v| v / det);
        let g2 = cross(c, a).map(|v| v / det);
        let g3 = cross(a, b).map(|v| v / det);
        let g0 = [
            -g1[0] - g2[0] - g3[0],
            -g1[1] - g2[1] - g3[1],
            -g1[2] - g2[2] - g3[2],
        ];
        let gradients = [g0, g1, g2, g3];
        let volume = det.abs() / 6.0;
        let [sxx, syy, szz, sxy, syz, szx] = result.element_stress_mpa[element];
        let mut displacement_gradient = [[0.0; 3]; 3];
        for (local, &node) in tet.iter().enumerate() {
            let u = result.nodal_displacements_m[node];
            let g = gradients[local];
            for i in 0..3 {
                for j in 0..3 {
                    displacement_gradient[i][j] += u[i] * g[j];
                }
            }
            internal[node][0] += 1_000.0 * volume * (sxx * g[0] + sxy * g[1] + szx * g[2]);
            internal[node][1] += 1_000.0 * volume * (sxy * g[0] + syy * g[1] + syz * g[2]);
            internal[node][2] += 1_000.0 * volume * (szx * g[0] + syz * g[1] + szz * g[2]);
        }
        stress_strain_work_kn_m += 1_000.0
            * volume
            * (sxx * displacement_gradient[0][0]
                + syy * displacement_gradient[1][1]
                + szz * displacement_gradient[2][2]
                + sxy * (displacement_gradient[0][1] + displacement_gradient[1][0])
                + syz * (displacement_gradient[1][2] + displacement_gradient[2][1])
                + szx * (displacement_gradient[2][0] + displacement_gradient[0][2]));
    }
    (internal, stress_strain_work_kn_m)
}

fn check_independent_balance(request: &ConcreteTetRequest, result: &ConcreteTetResult) {
    let (internal, local_work) = reconstructed_forces_and_work(&request.mesh, result);
    let final_target = request.targets.last().unwrap();
    let mut free_residual_sq = 0.0;
    let mut total_external = [0.0; 3];
    let mut total_reaction = [0.0; 3];
    let mut nodal_work = 0.0;
    for node in 0..request.mesh.nodes.len() {
        for axis in 0..3 {
            let external = final_target.loads_kn[node][axis];
            let reaction = internal[node][axis] - external;
            near(
                result.nodal_reactions_kn[node][axis],
                reaction,
                2e-5,
                "independent nodal reaction",
            );
            if final_target.prescribed_m[node][axis].is_none() {
                free_residual_sq += reaction * reaction;
            }
            total_external[axis] += external;
            total_reaction[axis] += reaction;
            nodal_work += result.nodal_displacements_m[node][axis] * internal[node][axis];
        }
    }
    for axis in 0..3 {
        near(
            total_reaction[axis] + total_external[axis],
            0.0,
            2e-5,
            "global force balance",
        );
    }
    near(nodal_work, local_work, 2e-6, "virtual-work identity");
    near(
        free_residual_sq.sqrt(),
        result.true_free_residual_kn,
        2e-5,
        "true free residual",
    );
}

#[test]
fn sparse_gmres_nonaffine_perturbed_192_dof_mesh_balances_with_mixed_damage() {
    let request = request(mesh(3), ConcreteTetLinearBackend::SparseGmres);
    assert_eq!(request.mesh.nodes.len() * 3, 192);
    assert_eq!(request.mesh.tets.len(), 162);
    let result = solve(&request).unwrap();
    check_independent_balance(&request, &result);
    assert!(result.element_damage.iter().any(|&d| d > 1e-4));
    assert!(result.element_damage.iter().any(|&d| d < 1e-12));
    assert!(result
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
}

#[test]
fn sparse_gmres_matches_dense_lu_on_smaller_nonaffine_same_geometry() {
    let small = mesh(2);
    let dense_request = request(small.clone(), ConcreteTetLinearBackend::DenseLu);
    let sparse_request = request(small, ConcreteTetLinearBackend::SparseGmres);
    let dense = solve(&dense_request).unwrap();
    let sparse = solve(&sparse_request).unwrap();
    check_independent_balance(&sparse_request, &sparse);
    for (a, b) in dense
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(sparse.nodal_displacements_m.iter().flatten())
    {
        near(*a, *b, 2e-8, "dense/sparse displacement");
    }
    for (a, b) in dense.element_damage.iter().zip(&sparse.element_damage) {
        near(*a, *b, 2e-6, "dense/sparse damage");
    }
    near(
        dense.true_free_residual_kn,
        sparse.true_free_residual_kn,
        2e-5,
        "dense/sparse residual",
    );
}
