//! A low but admissible tensile threshold must not contaminate the elastic
//! Newton tangent through the numerical damage perturbation.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetOptions, ConcreteTetRequest, ConcreteTetTarget,
};

#[test]
fn subthreshold_load_converges_in_one_exact_elastic_newton_step() {
    let e = 30_000.0;
    let nu = 0.2;
    let ft = 3e-5;
    let displacement = 1e-10; // One tenth of ft/E.
    let c11 = e * (1.0 - nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let force = 1_000.0 * c11 * displacement / 6.0;
    let mesh = Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        tets: vec![[0, 1, 2, 3]],
    };
    let mut loads_kn = vec![[0.0; 3]; 4];
    loads_kn[1][0] = force;
    let mut prescribed_m = vec![[Some(0.0); 3]; 4];
    prescribed_m[1][0] = None;
    let options = ConcreteTetOptions {
        max_newton_iterations: 1,
        max_cutbacks: 1,
        min_step_fraction: 0.75,
        ..ConcreteTetOptions::default()
    };
    let result = solve(&ConcreteTetRequest {
        mesh,
        e_mpa: e,
        poisson: nu,
        tensile_strength_mpa: ft,
        fracture_energy_n_per_m: 1.0,
        crack_band_width_m: 1.0,
        element_materials: None,
        targets: vec![ConcreteTetTarget {
            loads_kn,
            prescribed_m,
            body_forces: vec![],
            face_tractions: vec![],
        }],
        options,
    })
    .unwrap();

    assert_eq!(result.accepted_steps.len(), 1);
    assert_eq!(result.accepted_steps[0].newton_iterations, 1);
    assert!((result.nodal_displacements_m[1][0] - displacement).abs() < 1e-15);
    assert_eq!(result.element_damage, vec![0.0]);
    assert!(result.true_free_residual_kn < 1e-10);
}
