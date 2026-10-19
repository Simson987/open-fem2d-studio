//! The app's factor-0.3 load combination previously stalled in the sparse
//! Newton line search. Automatic recovery must restart from the accepted
//! state with a bounded frontal tangent and retain the same residual limit.

use openaec_native_fem::dispatch::NativeFemRequest;
use openaec_native_fem::volume3d_finite_j2::{solve_frame_coupled, FiniteJ2TetLinearBackend};

#[test]
fn automatic_recovers_small_j2_frame_combination_without_relaxing_equilibrium() {
    let request: NativeFemRequest =
        serde_json::from_str(include_str!("fixtures/finite_j2_frame_combo_03.json")).unwrap();
    let NativeFemRequest::Volume3dFiniteJ2FrameCoupled(mut input) = request else {
        panic!("wrong fixture kind");
    };
    assert_eq!(input.volume.mesh.nodes.len(), 10);
    assert_eq!(input.volume.mesh.tets.len(), 2);
    assert_eq!(input.hexes.len(), 1);
    assert_eq!(input.frames.len(), 1);
    assert_eq!(input.volume.targets.len(), 2);
    assert_eq!(
        input.volume.options.linear_backend,
        FiniteJ2TetLinearBackend::Automatic
    );

    let automatic = solve_frame_coupled(&input).unwrap();
    assert_eq!(
        automatic.linear_backend_used,
        FiniteJ2TetLinearBackend::FrontalWave
    );
    assert!(automatic.frontal_fallbacks >= 1);
    assert!(automatic.true_free_residual_kn < 1e-8);

    input.volume.options.linear_backend = FiniteJ2TetLinearBackend::FrontalWave;
    let direct = solve_frame_coupled(&input).unwrap();
    assert_eq!(direct.frontal_fallbacks, 0);
    assert!(direct.true_free_residual_kn < 1e-8);
    for axis in 0..3 {
        assert!(
            (automatic.nodal_displacements_m[9][axis] - direct.nodal_displacements_m[9][axis])
                .abs()
                < 1e-8,
            "tip translation axis {axis}"
        );
        assert!(
            (automatic.nodal_rotations_rad[9][axis] - direct.nodal_rotations_rad[9][axis]).abs()
                < 1e-8,
            "tip rotation axis {axis}"
        );
    }
    for end in 0..2 {
        for dof in 0..6 {
            assert!(
                (automatic.frame_end_forces_local[0][end][dof]
                    - direct.frame_end_forces_local[0][end][dof])
                    .abs()
                    < 1e-5,
                "frame end {end} force {dof}"
            );
        }
    }

    // An oversized front must never be attempted, even when sparse Newton
    // stalls. A future sparse improvement may solve this case directly.
    input.volume.options.linear_backend = FiniteJ2TetLinearBackend::Automatic;
    input.volume.options.max_front_dofs = 1;
    match solve_frame_coupled(&input) {
        Ok(result) => {
            assert_eq!(
                result.linear_backend_used,
                FiniteJ2TetLinearBackend::SparseGmres
            );
            assert_eq!(result.frontal_fallbacks, 0);
        }
        Err(error) => assert!(error.contains("line search stalled"), "{error}"),
    }
}
