//! Fixed-support equilibrium at extreme but finite target loads. Linear
//! interpolation must not form `end-start`, which overflows for opposite signs.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetOptions, ConcreteTetRequest, ConcreteTetTarget,
};

fn target(load: f64) -> ConcreteTetTarget {
    let mut loads_kn = vec![[0.0; 3]; 4];
    loads_kn[0][0] = load;
    ConcreteTetTarget {
        loads_kn,
        prescribed_m: vec![[Some(0.0); 3]; 4],
        body_forces: vec![],
        face_tractions: vec![],
    }
}

#[test]
fn opposite_finite_load_targets_keep_finite_exact_support_reactions() {
    let mesh = Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        tets: vec![[0, 1, 2, 3]],
    };
    let result = solve(&ConcreteTetRequest {
        mesh,
        e_mpa: 30_000.0,
        poisson: 0.2,
        tensile_strength_mpa: 3.0,
        fracture_energy_n_per_m: 100.0,
        crack_band_width_m: 0.1,
        element_materials: None,
        targets: vec![target(1e308), target(-1e308)],
        options: ConcreteTetOptions::default(),
    })
    .unwrap();
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 1);
    assert_eq!(result.nodal_reactions_kn[0][0], 1e308);
    assert!(result
        .nodal_reactions_kn
        .iter()
        .flatten()
        .all(|v| v.is_finite()));
    assert!(result
        .nodal_displacements_m
        .iter()
        .flatten()
        .all(|v| *v == 0.0));
    assert_eq!(result.true_free_residual_kn, 0.0);
}
