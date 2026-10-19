use openaec_native_fem::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel};
use openaec_native_fem::solid_finite_j2_hex8::{
    evaluate, evaluate_with_one_sided_tangent, FiniteJ2Hex8Geometry,
};

fn cube() -> [[f64; 3]; 8] {
    [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ]
}

fn steel() -> FiniteJ2Steel {
    FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 2_000.0).unwrap()
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.12e}"
    );
}

fn affine(coordinates: &[[f64; 3]; 8], f: [[f64; 3]; 3]) -> [[f64; 3]; 8] {
    let mut displacement = [[0.0; 3]; 8];
    for node in 0..8 {
        for a in 0..3 {
            displacement[node][a] = (0..3)
                .map(|reference| {
                    (f[a][reference] - f64::from(a == reference)) * coordinates[node][reference]
                })
                .sum();
        }
    }
    displacement
}

#[test]
fn elastic_and_plastic_uniaxial_reactions_follow_exact_hencky_return() {
    let coordinates = cube();
    let geometry = FiniteJ2Hex8Geometry::new(coordinates).unwrap();
    close(geometry.volume_m3, 1.0, 1e-14);
    let material = steel();
    let committed = [FiniteJ2State::default(); 8];
    for &axial_log_strain in &[0.0008, 0.02] {
        let alpha = ((material.youngs_mpa * axial_log_strain - material.yield_mpa)
            / (material.youngs_mpa + material.hardening_mpa))
            .max(0.0);
        let sigma = material.youngs_mpa * (axial_log_strain - alpha);
        let lateral_log_strain = -material.poisson * sigma / material.youngs_mpa - alpha / 2.0;
        let axial_stretch = axial_log_strain.exp();
        let lateral_stretch = lateral_log_strain.exp();
        let f = [
            [axial_stretch, 0.0, 0.0],
            [0.0, lateral_stretch, 0.0],
            [0.0, 0.0, lateral_stretch],
        ];
        let action = evaluate(
            material,
            &committed,
            &geometry,
            affine(&coordinates, f),
            true,
        )
        .unwrap();
        let p_xx = sigma / axial_stretch;
        for (node, coordinate) in coordinates.iter().enumerate() {
            let sign = if coordinate[0] == 0.0 { -1.0 } else { 1.0 };
            close(
                action.internal_force_kn[3 * node],
                sign * 250.0 * p_xx,
                2e-7,
            );
            close(action.internal_force_kn[3 * node + 1], 0.0, 2e-7);
            close(action.internal_force_kn[3 * node + 2], 0.0, 2e-7);
        }
        for point in action.gauss_points {
            close(point.state.equivalent_plastic_strain, alpha, 2e-12);
            close(point.von_mises_mpa, sigma, 2e-9);
            assert_eq!(point.yielded, alpha > 0.0);
        }
        close(
            (0..8)
                .filter(|&node| coordinates[node][0] == 1.0)
                .map(|node| action.internal_force_kn[3 * node])
                .sum(),
            1_000.0 * p_xx,
            4e-7,
        );
    }
}

#[test]
fn plastic_tangent_matches_all_nodal_force_derivatives() {
    let coordinates = cube();
    let geometry = FiniteJ2Hex8Geometry::new(coordinates).unwrap();
    let committed = [FiniteJ2State::default(); 8];
    let mut displacement = affine(
        &coordinates,
        [[1.025, 0.003, 0.0], [0.0, 0.998, 0.002], [0.0, 0.0, 0.997]],
    );
    displacement[6][0] += 0.002;
    let action = evaluate(steel(), &committed, &geometry, displacement, true).unwrap();
    assert!(action.gauss_points.iter().all(|point| point.yielded));
    let tangent = action.tangent_kn_per_m.unwrap();
    let step = 2e-7;
    for column in 0..24 {
        let mut plus = displacement;
        let mut minus = displacement;
        plus[column / 3][column % 3] += step;
        minus[column / 3][column % 3] -= step;
        let fp = evaluate(steel(), &committed, &geometry, plus, false)
            .unwrap()
            .internal_force_kn;
        let fm = evaluate(steel(), &committed, &geometry, minus, false)
            .unwrap()
            .internal_force_kn;
        for row in 0..24 {
            let numerical = (fp[row] - fm[row]) / (2.0 * step);
            let analytic = tangent[row * 24 + column];
            close(
                analytic,
                numerical,
                0.3 + 2e-6 * analytic.abs().max(numerical.abs()),
            );
        }
    }
    let scale = tangent
        .iter()
        .fold(0.0_f64, |maximum, value| maximum.max(value.abs()));
    for row in 0..24 {
        for column in 0..24 {
            close(
                tangent[row * 24 + column],
                tangent[column * 24 + row],
                1e-13 * scale,
            );
        }
    }
}

#[test]
fn elastic_tangent_and_yield_switch_fallback() {
    let coordinates = cube();
    let geometry = FiniteJ2Hex8Geometry::new(coordinates).unwrap();
    let committed = [FiniteJ2State::default(); 8];
    let displacement = affine(
        &coordinates,
        [
            [1.0006, 0.0002, 0.0],
            [0.0, 0.9998, 0.0],
            [0.0, 0.0, 1.0001],
        ],
    );
    let action = evaluate(steel(), &committed, &geometry, displacement, true).unwrap();
    assert!(action.gauss_points.iter().all(|point| !point.yielded));
    let tangent = action.tangent_kn_per_m.unwrap();
    let step = 1e-7;
    for column in 0..24 {
        let mut plus = displacement;
        let mut minus = displacement;
        plus[column / 3][column % 3] += step;
        minus[column / 3][column % 3] -= step;
        let fp = evaluate(steel(), &committed, &geometry, plus, false)
            .unwrap()
            .internal_force_kn;
        let fm = evaluate(steel(), &committed, &geometry, minus, false)
            .unwrap()
            .internal_force_kn;
        for row in 0..24 {
            let numerical = (fp[row] - fm[row]) / (2.0 * step);
            let analytic = tangent[row * 24 + column];
            close(
                analytic,
                numerical,
                0.05 + 1e-6 * analytic.abs().max(numerical.abs()),
            );
        }
    }
    let axial_log_strain = steel().yield_mpa / steel().youngs_mpa;
    let lateral_log_strain = -steel().poisson * axial_log_strain;
    let on_switch = affine(
        &coordinates,
        [
            [axial_log_strain.exp(), 0.0, 0.0],
            [0.0, lateral_log_strain.exp(), 0.0],
            [0.0, 0.0, lateral_log_strain.exp()],
        ],
    );
    let fallback =
        evaluate_with_one_sided_tangent(steel(), &committed, &geometry, on_switch).unwrap();
    assert!(fallback.tangent_kn_per_m.is_some());
    for point in fallback.gauss_points {
        close(point.von_mises_mpa, steel().yield_mpa, 1e-8);
    }
}

#[test]
fn rigid_rotation_and_warped_affine_mapping_preserve_expected_response() {
    let mut coordinates = cube();
    coordinates[6] = [1.12, 0.94, 1.08];
    let geometry = FiniteJ2Hex8Geometry::new(coordinates).unwrap();
    let committed = [FiniteJ2State::default(); 8];
    let theta: f64 = 0.6;
    let f = [
        [theta.cos(), -theta.sin(), 0.0],
        [theta.sin(), theta.cos(), 0.0],
        [0.0, 0.0, 1.0],
    ];
    let action = evaluate(
        steel(),
        &committed,
        &geometry,
        affine(&coordinates, f),
        false,
    )
    .unwrap();
    for gauss_f in action.deformation_gradients {
        for a in 0..3 {
            for b in 0..3 {
                close(gauss_f[a][b], f[a][b], 5e-15);
            }
        }
    }
    for point in action.gauss_points {
        close(point.elastic_energy_mpa, 0.0, 1e-20);
        close(point.state.equivalent_plastic_strain, 0.0, 0.0);
    }
    for force in action.internal_force_kn {
        close(force, 0.0, 1e-7);
    }
}

#[test]
fn independent_gauss_histories_and_invalid_reference_or_current_geometry() {
    let coordinates = cube();
    let geometry = FiniteJ2Hex8Geometry::new(coordinates).unwrap();
    let committed = [FiniteJ2State::default(); 8];
    let mut displacement = affine(
        &coordinates,
        [[1.025, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    );
    displacement[6][0] += 0.015;
    let action = evaluate(steel(), &committed, &geometry, displacement, false).unwrap();
    let alpha: [f64; 8] = action
        .gauss_points
        .map(|point| point.state.equivalent_plastic_strain);
    assert!(alpha.iter().all(|value| *value > 0.0));
    assert!(
        alpha.iter().copied().fold(f64::NEG_INFINITY, f64::max)
            - alpha.iter().copied().fold(f64::INFINITY, f64::min)
            > 1e-4
    );
    assert_eq!(committed, [FiniteJ2State::default(); 8]);

    let mut inverted = coordinates;
    inverted.swap(0, 1);
    assert!(FiniteJ2Hex8Geometry::new(inverted)
        .unwrap_err()
        .contains("Jacobian"));
    let mut folded = coordinates;
    folded[6] = [0.2, 0.2, 0.2];
    assert!(FiniteJ2Hex8Geometry::new(folded)
        .unwrap_err()
        .contains("Jacobian"));
    let inverted_current = affine(
        &coordinates,
        [[-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    );
    assert!(evaluate(steel(), &committed, &geometry, inverted_current, false).is_err());
}
