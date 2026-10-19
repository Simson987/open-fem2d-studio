//! Explicit release-scale acceptance for the bounded concrete Tet4 sparse
//! backend on the undamaged elastic branch. A homogeneous uniaxial-stress
//! field has a closed solution. This checks global assembly near the current
//! element/DOF caps; it does not validate large nonlinear crack paths.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetLinearBackend, ConcreteTetOptions, ConcreteTetRequest, ConcreteTetTarget,
};

fn near(actual: f64, expected: f64, tolerance: f64, name: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{name}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn affine_target(mesh: &Mesh, axial_strain: f64, poisson: f64) -> ConcreteTetTarget {
    let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
    for (node, &[x, y, z]) in mesh.nodes.iter().enumerate() {
        if x == 0.0 || x == 1.0 || y == 0.0 || y == 1.0 || z == 0.0 || z == 1.0 {
            prescribed_m[node] = [
                Some(axial_strain * x),
                Some(-poisson * axial_strain * y),
                Some(-poisson * axial_strain * z),
            ];
        }
    }
    ConcreteTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

#[test]
#[ignore = "explicit release-scale concrete sparse acceptance (10,368 Tet4)"]
fn sparse_elastic_affine_10368_tet_reference() {
    let mesh = Mesh::structured([12, 12, 12]).unwrap();
    assert_eq!(mesh.tets.len(), 10_368);
    assert_eq!(mesh.nodes.len() * 3, 6_591);
    let e = 30_000.0;
    let nu = 0.2;
    let ft = 3.0;
    let gf = 100.0;
    let band_width = 1.0 / 12.0;
    let onset = ft / e;
    let axial_strain = 0.5 * onset;
    let axial_stress = e * axial_strain;
    let mut options = ConcreteTetOptions::default();
    options.linear_backend = ConcreteTetLinearBackend::SparseGmres;
    options.gmres_restart = 60;
    options.gmres_max_iterations = 8_000;
    let request = ConcreteTetRequest {
        mesh: mesh.clone(),
        e_mpa: e,
        poisson: nu,
        tensile_strength_mpa: ft,
        fracture_energy_n_per_m: gf,
        crack_band_width_m: band_width,
        element_materials: None,
        targets: vec![affine_target(&mesh, axial_strain, nu)],
        options,
    };
    let free_dofs = request.targets[0]
        .prescribed_m
        .iter()
        .flatten()
        .filter(|value| value.is_none())
        .count();
    assert_eq!(free_dofs, 3_993);
    let result = solve(&request).unwrap();
    assert_eq!(
        result.linear_backend_used,
        ConcreteTetLinearBackend::SparseGmres
    );
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 0);
    for (node, &[x, y, z]) in mesh.nodes.iter().enumerate() {
        let expected = [
            axial_strain * x,
            -nu * axial_strain * y,
            -nu * axial_strain * z,
        ];
        for axis in 0..3 {
            near(
                result.nodal_displacements_m[node][axis],
                expected[axis],
                2e-8,
                "affine displacement",
            );
        }
    }
    for (stress, &element_damage) in result.element_stress_mpa.iter().zip(&result.element_damage) {
        near(stress[0], axial_stress, 1e-4, "axial stress");
        for &transverse in &stress[1..] {
            near(transverse, 0.0, 1e-4, "uniaxial transverse stress");
        }
        near(element_damage, 0.0, 1e-12, "undamaged state");
    }
    let mut left_reaction = 0.0;
    let mut right_reaction = 0.0;
    for (node, &[x, _, _]) in mesh.nodes.iter().enumerate() {
        if x == 0.0 {
            left_reaction += result.nodal_reactions_kn[node][0];
        } else if x == 1.0 {
            right_reaction += result.nodal_reactions_kn[node][0];
        }
    }
    near(
        right_reaction,
        1_000.0 * axial_stress,
        1e-2,
        "right face reaction",
    );
    near(left_reaction, -right_reaction, 1e-2, "global axial balance");
    assert!(result.true_free_residual_kn < 1e-3);
    eprintln!(
        "concrete sparse scale: {} Tet4, {} DOF, {} accepted steps, {} cutbacks, free residual {:.3e} kN",
        mesh.tets.len(),
        mesh.nodes.len() * 3,
        result.accepted_steps.len(),
        result.cutbacks,
        result.true_free_residual_kn
    );
}
