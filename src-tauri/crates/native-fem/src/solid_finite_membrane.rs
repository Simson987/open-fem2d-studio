//! Total-Lagrangian Tri3 membrane embedded in 3D (translations only).
//!
//! The constant local surface gradients give current tangents `g_alpha`;
//! Green--Lagrange strain is `(g_alpha · g_beta - delta_alpha_beta)/2`.
//! The reference energy is `A0 * t0 * E:C:E / 2` with isotropic plane-stress
//! Saint-Venant--Kirchhoff elasticity. Differentiating it gives both internal
//! force and the consistent material plus geometric 9×9 tangent.
//! COMSOL's membrane theory documents the same reference Green strain and
//! second Piola--Kirchhoff stress measures:
//! https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_theory.06.141.html
//! https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_membrane.11.16.html
//! Stress is MPa, force kN, and coordinates/thickness are metres.
//!
//! This element has no bending stiffness, drilling rotation or wrinkling law.

#[derive(Clone, Copy, Debug)]
pub struct FiniteMembraneAction {
    /// Second Piola--Kirchhoff plane-stress components [S11, S22, S12] in MPa.
    pub stress_mpa: [f64; 3],
    pub internal_force_kn: [f64; 9],
    /// Row-major 9×9 consistent tangent in kN/m when requested.
    pub tangent_kn_per_m: Option<[f64; 81]>,
}

pub fn evaluate(
    reference: [[f64; 3]; 3],
    displacement: [[f64; 3]; 3],
    youngs_mpa: f64,
    poisson: f64,
    thickness_m: f64,
    with_tangent: bool,
) -> Result<FiniteMembraneAction, String> {
    if reference
        .iter()
        .flatten()
        .chain(displacement.iter().flatten())
        .any(|x| !x.is_finite())
        || !youngs_mpa.is_finite()
        || youngs_mpa <= 0.0
        || !poisson.is_finite()
        || poisson <= -1.0
        || poisson >= 0.5
        || !thickness_m.is_finite()
        || thickness_m <= 0.0
    {
        return Err(
            "finite membrane needs finite coordinates, positive E/thickness and -1 < nu < 0.5"
                .into(),
        );
    }
    let edge1 = std::array::from_fn::<_, 3, _>(|i| reference[1][i] - reference[0][i]);
    let edge2 = std::array::from_fn::<_, 3, _>(|i| reference[2][i] - reference[0][i]);
    let edge3 = std::array::from_fn::<_, 3, _>(|i| reference[2][i] - reference[1][i]);
    let norm = |v: [f64; 3]| v.iter().fold(0.0_f64, |n, x| n.hypot(*x));
    let l1 = norm(edge1);
    let largest = l1.max(norm(edge2)).max(norm(edge3));
    if !l1.is_finite() || !largest.is_finite() || largest == 0.0 {
        return Err("finite membrane has degenerate reference geometry".into());
    }
    let e1 = edge1.map(|x| x / l1);
    let x2 = (0..3).map(|i| edge2[i] * e1[i]).sum::<f64>();
    let transverse = std::array::from_fn::<_, 3, _>(|i| edge2[i] - x2 * e1[i]);
    let y2 = norm(transverse);
    if !y2.is_finite() || y2 <= 1e-12 * largest {
        return Err("finite membrane has collinear reference nodes".into());
    }
    let e2 = transverse.map(|x| x / y2);
    let gradients = [
        [-1.0 / l1, (x2 - l1) / (l1 * y2)],
        [1.0 / l1, -x2 / (l1 * y2)],
        [0.0, 1.0 / y2],
    ];
    let mut g = [[0.0; 3]; 2];
    for alpha in 0..2 {
        for axis in 0..3 {
            g[alpha][axis] = (if alpha == 0 { e1[axis] } else { e2[axis] })
                + (0..3)
                    .map(|node| displacement[node][axis] * gradients[node][alpha])
                    .sum::<f64>();
        }
    }
    let current_cross = [
        g[0][1] * g[1][2] - g[0][2] * g[1][1],
        g[0][2] * g[1][0] - g[0][0] * g[1][2],
        g[0][0] * g[1][1] - g[0][1] * g[1][0],
    ];
    if !norm(current_cross).is_finite() || norm(current_cross) <= 1e-12 {
        return Err("finite membrane collapsed in current geometry".into());
    }
    let dot = |a: [f64; 3], b: [f64; 3]| (0..3).map(|i| a[i] * b[i]).sum::<f64>();
    let strain = [
        0.5 * (dot(g[0], g[0]) - 1.0),
        0.5 * (dot(g[1], g[1]) - 1.0),
        dot(g[0], g[1]), // engineering Green shear = 2 E12
    ];
    let plane = youngs_mpa / (1.0 - poisson * poisson);
    let shear = youngs_mpa / (2.0 * (1.0 + poisson));
    let stress = [
        plane * (strain[0] + poisson * strain[1]),
        plane * (poisson * strain[0] + strain[1]),
        shear * strain[2],
    ];
    let mut b = [[0.0; 9]; 3];
    for node in 0..3 {
        for axis in 0..3 {
            let col = 3 * node + axis;
            b[0][col] = gradients[node][0] * g[0][axis];
            b[1][col] = gradients[node][1] * g[1][axis];
            b[2][col] = gradients[node][1] * g[0][axis] + gradients[node][0] * g[1][axis];
        }
    }
    let scale = 1000.0 * 0.5 * l1 * y2 * thickness_m;
    let mut force = [0.0; 9];
    for col in 0..9 {
        force[col] = scale * (0..3).map(|row| b[row][col] * stress[row]).sum::<f64>();
    }
    let tangent = with_tangent.then(|| {
        let mut stiffness = [0.0; 81];
        for col in 0..9 {
            let d_stress = [
                plane * (b[0][col] + poisson * b[1][col]),
                plane * (poisson * b[0][col] + b[1][col]),
                shear * b[2][col],
            ];
            for row in 0..9 {
                let node_a = row / 3;
                let node_b = col / 3;
                let geometric = if row % 3 == col % 3 {
                    stress[0] * gradients[node_a][0] * gradients[node_b][0]
                        + stress[1] * gradients[node_a][1] * gradients[node_b][1]
                        + stress[2]
                            * (gradients[node_a][0] * gradients[node_b][1]
                                + gradients[node_a][1] * gradients[node_b][0])
                } else {
                    0.0
                };
                stiffness[row * 9 + col] =
                    scale * (geometric + (0..3).map(|i| b[i][row] * d_stress[i]).sum::<f64>());
            }
        }
        stiffness
    });
    if stress.iter().chain(force.iter()).any(|x| !x.is_finite())
        || tangent
            .as_ref()
            .is_some_and(|values| values.iter().any(|x| !x.is_finite()))
    {
        return Err("finite membrane action overflowed".into());
    }
    Ok(FiniteMembraneAction {
        stress_mpa: stress,
        internal_force_kn: force,
        tangent_kn_per_m: tangent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consistent_tangent_matches_all_centered_force_differences() {
        let x = [[0.2, 0.1, 0.3], [1.4, 0.4, 0.5], [0.6, 1.1, 0.8]];
        let u = [
            [0.03, -0.02, 0.01],
            [0.13, 0.06, -0.04],
            [-0.02, 0.08, 0.11],
        ];
        let action = evaluate(x, u, 210_000.0, 0.29, 0.018, true).unwrap();
        let tangent = action.tangent_kn_per_m.unwrap();
        let h = 1e-6;
        for col in 0..9 {
            let mut plus = u;
            let mut minus = u;
            plus[col / 3][col % 3] += h;
            minus[col / 3][col % 3] -= h;
            let fp = evaluate(x, plus, 210_000.0, 0.29, 0.018, false)
                .unwrap()
                .internal_force_kn;
            let fm = evaluate(x, minus, 210_000.0, 0.29, 0.018, false)
                .unwrap()
                .internal_force_kn;
            for row in 0..9 {
                let numerical = (fp[row] - fm[row]) / (2.0 * h);
                let expected = tangent[row * 9 + col];
                assert!(
                    (numerical - expected).abs() < 2e-7 * expected.abs().max(1.0),
                    "row {row}, col {col}: {numerical} != {expected}"
                );
            }
        }
        for row in 0..9 {
            for col in 0..9 {
                assert!((tangent[row * 9 + col] - tangent[col * 9 + row]).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn rigid_rotation_and_uniaxial_plane_stress_reference() {
        let x = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        let rotated = [[0.0, 0.0, 0.0], [-1.0, 1.0, 0.0], [0.0, -1.0, 1.0]];
        let action = evaluate(x, rotated, 210_000.0, 0.3, 0.02, false).unwrap();
        assert!(action.stress_mpa.iter().all(|s| s.abs() < 1e-9));
        assert!(action.internal_force_kn.iter().all(|f| f.abs() < 1e-8));

        let stretch_x = 1.1_f64;
        let green_x = (stretch_x * stretch_x - 1.0) / 2.0;
        let stretch_y = (1.0 - 2.0 * 0.3 * green_x).sqrt();
        let u = [
            [0.0; 3],
            [stretch_x - 1.0, 0.0, 0.0],
            [0.0, stretch_y - 1.0, 0.0],
        ];
        let action = evaluate(x, u, 210_000.0, 0.3, 0.02, false).unwrap();
        assert!((action.stress_mpa[0] - 210_000.0 * green_x).abs() < 1e-8);
        assert!(action.stress_mpa[1].abs() < 1e-8);
        assert!(action.stress_mpa[2].abs() < 1e-8);
        let expected_right_kn = 1000.0 * 0.5 * 0.02 * stretch_x * 210_000.0 * green_x;
        assert!((action.internal_force_kn[3] - expected_right_kn).abs() < 1e-8);
    }

    #[test]
    fn invalid_geometry_and_material_are_rejected() {
        let x = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];
        assert!(evaluate(x, [[0.0; 3]; 3], 210_000.0, 0.3, 0.0, true).is_err());
        assert!(evaluate(
            [x[0], x[1], x[1]],
            [[0.0; 3]; 3],
            210_000.0,
            0.3,
            0.02,
            true
        )
        .is_err());
    }
}
