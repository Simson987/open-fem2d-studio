//! One reproducible model containing a Hex8 block, two Tet4 wedges filling
//! its right-hand face, and an embedded diagonal truss. All share global DOFs.
//! This is a backend/equilibrium acceptance model; the separate affine patch
//! supplies an independent elasticity reference for the mixed interface.

use openaec_native_fem::dispatch::{solve_native_fem, NativeFemRequest, NativeFemResult};

fn run(backend: &str) -> openaec_native_fem::mixed3d::Mixed3dResult {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../examples/mixed3d-hex8-tet4-truss.json")).unwrap();
    value["input"]["backend"] = backend.into();
    let request: NativeFemRequest = serde_json::from_value(value).unwrap();
    match solve_native_fem(request).expect("mixed 3D solve") {
        NativeFemResult::Mixed3d(result) => result,
        _ => panic!("mixed3d request dispatched to the wrong result"),
    }
}

#[test]
fn tetrahedra_hex_and_diagonal_truss_share_one_stable_solution() {
    let dense = run("dense");
    assert_eq!(dense.nodal_displacements_m.len(), 9);
    assert_eq!(dense.solid_element_stress_mpa.len(), 2);
    assert_eq!(dense.hex_gauss_stress_mpa.len(), 1);
    assert_eq!(dense.truss_axial_force_kn.len(), 1);
    assert!(dense.nodal_displacements_m[8][0] > 0.0);
    assert!(dense.truss_axial_force_kn[0] > 0.0);
    assert!(dense.relative_residual < 1e-9);
    for axis in 0..3 {
        let total_reaction: f64 = dense.nodal_reactions_kn.iter().map(|node| node[axis]).sum();
        let applied = if axis == 0 { 10.0 } else { 0.0 };
        assert!((total_reaction + applied).abs() < 1e-8);
    }
    for backend in ["sparseDirect", "sparsePcg", "matrixFreePcg", "frontalWave"] {
        let result = run(backend);
        assert!(result.relative_residual < 1e-9);
        for (actual, reference) in result
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(dense.nodal_displacements_m.iter().flatten())
        {
            assert!(
                (actual - reference).abs() < 1e-11,
                "{backend}: displacement mismatch"
            );
        }
        for (actual, reference) in result
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(dense.nodal_reactions_kn.iter().flatten())
        {
            assert!(
                (actual - reference).abs() < 1e-7,
                "{backend}: reaction mismatch"
            );
        }
        assert!((result.truss_axial_force_kn[0] - dense.truss_axial_force_kn[0]).abs() < 1e-8);
    }
}
