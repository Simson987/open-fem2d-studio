//! The reference equilibrium of a fully fixed, unloaded Tet4 is zero
//! deformation and reaction equal to the negative applied nodal force.
//! Opposite finite load targets must remain finite during interpolation.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{solve, GnlTetOptions, GnlTetRequest, GnlTetTarget};

fn target(load: f64) -> GnlTetTarget {
    let mut loads_kn = vec![[0.0; 3]; 4];
    loads_kn[0][0] = load;
    GnlTetTarget {
        loads_kn,
        prescribed_m: vec![[Some(0.0); 3]; 4],
        body_forces: vec![],
        face_tractions: vec![],
    }
}

#[test]
fn finite_opposite_support_loads_keep_exact_finite_reaction() {
    let result = solve(&GnlTetRequest {
        mesh: Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        },
        e_mpa: 30_000.0,
        poisson: 0.2,
        element_materials: None,
        element_energy_beta: None,
        targets: vec![target(1e308), target(-1e308)],
        options: GnlTetOptions::default(),
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
