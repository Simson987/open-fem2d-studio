//! Total-Lagrangian two-node 3D truss with Green axial strain.
//!
//! The reference energy is `0.5 * E * A * L0 * strain²`, where
//! `strain = (|x2+u2-x1-u1|²-L0²)/(2 L0²)`. Differentiating this energy
//! gives both the internal nodal force and the consistent material plus
//! geometric tangent. Stress is MPa, area m², coordinates m and force kN.

#[derive(Clone, Copy, Debug)]
pub struct FiniteTrussAction {
    /// Current axial force `E * A * Green strain * current_length/reference_length`, positive in tension.
    pub axial_force_kn: f64,
    pub internal_force_kn: [f64; 6],
    /// Row-major 6×6 tangent in kN/m when requested.
    pub tangent_kn_per_m: Option<[f64; 36]>,
}

pub fn evaluate(
    reference: [[f64; 3]; 2],
    displacement: [[f64; 3]; 2],
    youngs_mpa: f64,
    area_m2: f64,
    with_tangent: bool,
) -> Result<FiniteTrussAction, String> {
    if !youngs_mpa.is_finite()
        || youngs_mpa <= 0.0
        || !area_m2.is_finite()
        || area_m2 <= 0.0
        || reference
            .iter()
            .flatten()
            .chain(displacement.iter().flatten())
            .any(|x| !x.is_finite())
    {
        return Err("finite truss needs finite coordinates, positive E and area".into());
    }
    let original = std::array::from_fn::<_, 3, _>(|i| reference[1][i] - reference[0][i]);
    let length2 = original.iter().map(|value| value * value).sum::<f64>();
    if !length2.is_finite() || length2 <= 0.0 {
        return Err("finite truss needs distinct reference nodes".into());
    }
    let current =
        std::array::from_fn::<_, 3, _>(|i| original[i] + displacement[1][i] - displacement[0][i]);
    let current2 = current.iter().map(|value| value * value).sum::<f64>();
    if !current2.is_finite() || current2 <= 0.0 {
        return Err("finite truss collapsed or current length overflowed".into());
    }
    let length = length2.sqrt();
    let strain = (current2 / length2 - 1.0) / 2.0;
    let ea_kn = 1_000.0 * youngs_mpa * area_m2;
    let reference_axial_kn = ea_kn * strain;
    let coefficient = reference_axial_kn / length;
    let axial_force_kn = coefficient * current2.sqrt();
    let mut force = [0.0; 6];
    for axis in 0..3 {
        force[axis] = -coefficient * current[axis];
        force[3 + axis] = coefficient * current[axis];
    }
    let tangent = with_tangent.then(|| {
        let mut stiffness = [0.0; 36];
        for a in 0..3 {
            for b in 0..3 {
                let block = ea_kn / length
                    * ((if a == b { strain } else { 0.0 }) + current[a] * current[b] / length2);
                for end_a in 0..2 {
                    for end_b in 0..2 {
                        let sign = if end_a == end_b { 1.0 } else { -1.0 };
                        stiffness[(3 * end_a + a) * 6 + 3 * end_b + b] = sign * block;
                    }
                }
            }
        }
        stiffness
    });
    if !axial_force_kn.is_finite()
        || force.iter().any(|x| !x.is_finite())
        || tangent
            .as_ref()
            .is_some_and(|values| values.iter().any(|x| !x.is_finite()))
    {
        return Err("finite truss action overflowed".into());
    }
    Ok(FiniteTrussAction {
        axial_force_kn,
        internal_force_kn: force,
        tangent_kn_per_m: tangent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tangent_matches_centered_force_difference_and_rigid_rotation() {
        let x = [[0.2, -0.1, 0.4], [1.3, 0.5, 0.8]];
        let u = [[0.02, -0.03, 0.01], [0.2, 0.04, -0.02]];
        let action = evaluate(x, u, 210_000.0, 0.002, true).unwrap();
        let tangent = action.tangent_kn_per_m.unwrap();
        let h = 1e-6;
        for column in 0..6 {
            let mut plus = u;
            let mut minus = u;
            plus[column / 3][column % 3] += h;
            minus[column / 3][column % 3] -= h;
            let fp = evaluate(x, plus, 210_000.0, 0.002, false)
                .unwrap()
                .internal_force_kn;
            let fm = evaluate(x, minus, 210_000.0, 0.002, false)
                .unwrap()
                .internal_force_kn;
            for row in 0..6 {
                let numerical = (fp[row] - fm[row]) / (2.0 * h);
                let scale = tangent[row * 6 + column].abs().max(1.0);
                assert!((numerical - tangent[row * 6 + column]).abs() / scale < 2e-8);
            }
        }
        let rotated = [[0.0, 0.0, 0.0], [-1.0, 1.0, 0.0]];
        let rotation = evaluate(
            [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
            rotated,
            210_000.0,
            0.002,
            false,
        )
        .unwrap();
        assert!(rotation.axial_force_kn.abs() < 1e-12);
    }
}
