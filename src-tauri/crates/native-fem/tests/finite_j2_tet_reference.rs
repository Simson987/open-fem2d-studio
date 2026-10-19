use openaec_native_fem::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel};
use openaec_native_fem::solid_finite_j2_tet::evaluate;

const GRADIENTS: [[f64; 3]; 4] = [
    [-1.0, -1.0, -1.0],
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
];
const VOLUME: f64 = 1.0 / 6.0;

fn steel() -> FiniteJ2Steel {
    FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap()
}

fn assert_close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.12e}"
    );
}

#[test]
fn hydrostatic_affine_patch_has_analytical_forces_and_balanced_resultant() {
    let stretch: f64 = 1.001;
    let mut displacements = [[0.0; 3]; 4];
    for a in 1..4 {
        displacements[a][a - 1] = stretch - 1.0;
    }
    let action = evaluate(
        steel(),
        &FiniteJ2State::default(),
        GRADIENTS,
        VOLUME,
        displacements,
        true,
    )
    .unwrap();
    assert!(!action.material_point.yielded);
    let bulk = steel().bulk_modulus_mpa();
    let p_diagonal = 3.0 * bulk * stretch.ln() / stretch;
    for node in 0..4 {
        for axis in 0..3 {
            assert_close(
                action.internal_force_kn[3 * node + axis],
                1_000.0 * VOLUME * p_diagonal * GRADIENTS[node][axis],
                1e-8,
            );
        }
    }
    for axis in 0..3 {
        assert_close(
            (0..4)
                .map(|node| action.internal_force_kn[3 * node + axis])
                .sum(),
            0.0,
            1e-8,
        );
    }
}

#[test]
fn plastic_element_tangent_matches_all_144_force_derivatives() {
    let committed = FiniteJ2State::default();
    let mut displacements = [[0.0; 3]; 4];
    displacements[1][0] = 0.025;
    displacements[2][0] = 0.003;
    displacements[3][1] = -0.002;
    let base = evaluate(steel(), &committed, GRADIENTS, VOLUME, displacements, true).unwrap();
    assert!(base.material_point.yielded);
    let tangent = base.tangent_kn_per_m.unwrap();
    let step = 2e-7;
    for column in 0..12 {
        let mut plus = displacements;
        let mut minus = displacements;
        plus[column / 3][column % 3] += step;
        minus[column / 3][column % 3] -= step;
        let fp = evaluate(steel(), &committed, GRADIENTS, VOLUME, plus, false)
            .unwrap()
            .internal_force_kn;
        let fm = evaluate(steel(), &committed, GRADIENTS, VOLUME, minus, false)
            .unwrap()
            .internal_force_kn;
        for row in 0..12 {
            let numerical = (fp[row] - fm[row]) / (2.0 * step);
            let analytic = tangent[row * 12 + column];
            let tolerance = 0.2 + 2e-6 * analytic.abs().max(numerical.abs());
            assert_close(analytic, numerical, tolerance);
        }
    }
    // Each column represents an internal pairwise force system.
    for axis in 0..3 {
        for column in 0..12 {
            assert_close(
                (0..4)
                    .map(|node| tangent[(3 * node + axis) * 12 + column])
                    .sum(),
                0.0,
                1e-6,
            );
        }
    }
}
