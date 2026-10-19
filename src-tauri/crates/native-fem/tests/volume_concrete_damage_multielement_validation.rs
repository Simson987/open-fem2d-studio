//! Analytical uniaxial patch check for the experimental Tet4 damage route.
//! Refining the cross section leaves the prescribed crack-band width unchanged;
//! this tests this homogeneous coupon only, not arbitrary 3D mesh objectivity.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetLinearBackend, ConcreteTetOptions, ConcreteTetRequest, ConcreteTetTarget,
};

const E: f64 = 30_000.0; // MPa
const NU: f64 = 0.2;
const FT: f64 = 3.0; // MPa
const GF: f64 = 100.0; // N/m
const WIDTH: f64 = 0.1; // m, axial crack-band width supplied by the caller

fn mesh(cross_divisions: usize) -> Mesh {
    let n = cross_divisions;
    let id = |i: usize, j: usize, k: usize| i * (n + 1) * (n + 1) + j * (n + 1) + k;
    let mut nodes = Vec::new();
    for i in 0..=1 {
        for j in 0..=n {
            for k in 0..=n {
                nodes.push([
                    WIDTH * i as f64,
                    WIDTH * j as f64 / n as f64,
                    WIDTH * k as f64 / n as f64,
                ]);
            }
        }
    }
    let mut tets = Vec::new();
    for j in 0..n {
        for k in 0..n {
            let a = id(0, j, k);
            let b = id(1, j, k);
            let c = id(0, j + 1, k);
            let d = id(1, j + 1, k);
            let e = id(0, j, k + 1);
            let f = id(1, j, k + 1);
            let g = id(0, j + 1, k + 1);
            let h = id(1, j + 1, k + 1);
            tets.extend([
                [a, b, d, h],
                [a, d, c, h],
                [a, c, g, h],
                [a, g, e, h],
                [a, e, f, h],
                [a, f, b, h],
            ]);
        }
    }
    Mesh { nodes, tets }
}

fn target(mesh: &Mesh, axial_strain: f64) -> ConcreteTetTarget {
    let mut prescribed_m = vec![[None; 3]; mesh.nodes.len()];
    for (index, &[x, y, z]) in mesh.nodes.iter().enumerate() {
        // The two end faces prescribe axial strain; the sides are free.
        prescribed_m[index][0] = Some(axial_strain * x);
        if x == 0.0 && y == 0.0 && z == 0.0 {
            prescribed_m[index][1] = Some(0.0);
            prescribed_m[index][2] = Some(0.0);
        }
        if x == 0.0 && y == WIDTH && z == 0.0 {
            prescribed_m[index][2] = Some(0.0);
        }
    }
    ConcreteTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn request(mesh: Mesh, targets: Vec<ConcreteTetTarget>) -> ConcreteTetRequest {
    ConcreteTetRequest {
        mesh,
        e_mpa: E,
        poisson: NU,
        tensile_strength_mpa: FT,
        fracture_energy_n_per_m: GF,
        crack_band_width_m: WIDTH,
        element_materials: None,
        targets,
        options: ConcreteTetOptions::default(),
    }
}

fn near(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

#[test]
fn transverse_refinement_matches_closed_form_tension_and_unloading() {
    // Independent 1D reference: sigma = ft exp[-(eps-eps0)/beta] after
    // eps0=ft/E. The full monotonic work h*integral(sigma d eps)=Gf gives
    // beta=Gf/(1e6*h*ft)-eps0/2. On unloading, the secant slope is frozen.
    let onset = FT / E;
    let beta = GF / (1e6 * WIDTH * FT) - onset / 2.0;
    let peak_strain = onset + beta;
    let unloaded_strain = peak_strain / 4.0;
    let peak_stress = FT * (-1.0_f64).exp();
    let damage = 1.0 - peak_stress / (E * peak_strain);
    let unloaded_stress = (1.0 - damage) * E * unloaded_strain;
    let area = WIDTH * WIDTH;

    for divisions in [1, 2] {
        let mesh = mesh(divisions);
        let peak = solve(&request(mesh.clone(), vec![target(&mesh, peak_strain)])).unwrap();
        let unloaded = solve(&request(
            mesh.clone(),
            vec![target(&mesh, peak_strain), target(&mesh, unloaded_strain)],
        ))
        .unwrap();

        for (result, strain, stress) in [
            (&peak, peak_strain, peak_stress),
            (&unloaded, unloaded_strain, unloaded_stress),
        ] {
            assert_eq!(result.element_states.len(), mesh.tets.len());
            near(result.true_free_residual_kn, 0.0, 1e-7);
            for step in &result.accepted_steps {
                assert!(step.true_free_residual_kn <= 1e-7);
            }
            for (index, &[x, y, z]) in mesh.nodes.iter().enumerate() {
                let [ux, uy, uz] = result.nodal_displacements_m[index];
                near(ux, strain * x, 1e-9);
                near(uy, -NU * strain * y, 1e-9);
                near(uz, -NU * strain * z, 1e-9);
            }
            for ((sigma, &d), state) in result
                .element_stress_mpa
                .iter()
                .zip(&result.element_damage)
                .zip(&result.element_states)
            {
                near(sigma[0], stress, 1e-7);
                for component in &sigma[1..] {
                    near(*component, 0.0, 1e-7);
                }
                near(d, damage, 1e-8);
                near(state.max_equivalent_strain, peak_strain, 1e-9);
            }
            let left: f64 = mesh
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, node)| node[0] == 0.0)
                .map(|(i, _)| result.nodal_reactions_kn[i][0])
                .sum();
            let right: f64 = mesh
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, node)| node[0] == WIDTH)
                .map(|(i, _)| result.nodal_reactions_kn[i][0])
                .sum();
            near(right, 1e3 * area * stress, 1e-6);
            near(left, -right, 1e-6);
        }
        assert!(unloaded
            .accepted_steps
            .iter()
            .any(|step| step.target_index == 1));
    }
}

#[test]
fn concrete_route_rejects_meshes_beyond_its_declared_bounds() {
    let mut too_many_dofs = mesh(1);
    too_many_dofs.nodes.resize(61, [0.0; 3]); // 183 DOF > 180
    let error = solve(&request(
        too_many_dofs.clone(),
        vec![target(&too_many_dofs, 0.0)],
    ))
    .unwrap_err();
    assert!(error.contains("1..=180 DOF"), "{error}");

    let mut too_many_tets = mesh(1);
    too_many_tets.tets.resize(301, too_many_tets.tets[0]);
    let error = solve(&request(
        too_many_tets.clone(),
        vec![target(&too_many_tets, 0.0)],
    ))
    .unwrap_err();
    assert!(error.contains("1..=300 elements"), "{error}");
}

#[test]
fn sparse_gmres_matches_dense_damage_unload_and_crosses_old_dof_limit() {
    let onset = FT / E;
    let beta = GF / (1e6 * WIDTH * FT) - onset / 2.0;
    let peak = onset + beta;
    let unload = peak / 4.0;
    let expected_damage = 1.0 - FT * (-1.0_f64).exp() / (E * peak);
    let expected_unload_stress = (1.0 - expected_damage) * E * unload;

    let small = mesh(2);
    let targets = vec![target(&small, peak), target(&small, unload)];
    let dense = solve(&request(small.clone(), targets.clone())).unwrap();
    let mut sparse_request = request(small.clone(), targets);
    sparse_request.options.linear_backend = ConcreteTetLinearBackend::SparseGmres;
    let sparse = solve(&sparse_request).unwrap();
    near(sparse.true_free_residual_kn, 0.0, 1e-7);
    for (a, b) in dense
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(sparse.nodal_displacements_m.iter().flatten())
    {
        near(*a, *b, 1e-9);
    }
    for (a, b) in dense.element_damage.iter().zip(&sparse.element_damage) {
        near(*a, *b, 1e-8);
    }

    let large = mesh(10);
    assert_eq!(large.nodes.len() * 3, 726);
    let mut large_request = request(
        large.clone(),
        vec![target(&large, peak), target(&large, unload)],
    );
    large_request.options.linear_backend = ConcreteTetLinearBackend::SparseGmres;
    let result = solve(&large_request).unwrap();
    assert_eq!(result.element_states.len(), 600);
    near(result.true_free_residual_kn, 0.0, 1e-7);
    for ((stress, &damage), state) in result
        .element_stress_mpa
        .iter()
        .zip(&result.element_damage)
        .zip(&result.element_states)
    {
        near(stress[0], expected_unload_stress, 1e-6);
        near(damage, expected_damage, 1e-8);
        near(state.max_equivalent_strain, peak, 1e-9);
    }
    let right: f64 = large
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| node[0] == WIDTH)
        .map(|(index, _)| result.nodal_reactions_kn[index][0])
        .sum();
    near(right, 1e3 * WIDTH * WIDTH * expected_unload_stress, 1e-6);
}

#[test]
fn sparse_gmres_rejects_an_unrestrained_zero_load_mechanism() {
    let mesh = mesh(1);
    let mut target = target(&mesh, 0.0);
    target.prescribed_m = vec![[None; 3]; mesh.nodes.len()];
    target.prescribed_m[0] = [Some(0.0); 3];
    let mut input = request(mesh, vec![target]);
    input.options.linear_backend = ConcreteTetLinearBackend::SparseGmres;
    input.options.max_cutbacks = 1;
    input.options.min_step_fraction = 0.75;
    let error = solve(&input).unwrap_err();
    assert!(
        error.contains("GMRES") || error.contains("singular"),
        "{error}"
    );
}
