//! Constitutive point update for the plane-stress CST element.
//! Steel uses small-strain J2 return mapping with isotropic hardening.
//! Concrete uses irreversible tensile damage in the principal stress basis.

use crate::MaterialLaw;

#[derive(Clone, Copy, Debug, Default)]
pub struct State {
    /// [epsilon_px, epsilon_py, epsilon_pz, gamma_pxy]
    pub plastic_strain: [f64; 4],
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
    pub max_equivalent_strain: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Response {
    /// [sigma_x, sigma_y, tau_xy] in kN/m².
    pub stress: [f64; 3],
    pub state: State,
}

fn elastic_stress(e_mpa: f64, nu: f64, strain: [f64; 3]) -> [f64; 3] {
    let e = e_mpa * 1000.0;
    let factor = e / (1.0 - nu * nu);
    [
        factor * (strain[0] + nu * strain[1]),
        factor * (nu * strain[0] + strain[1]),
        e / (2.0 * (1.0 + nu)) * strain[2],
    ]
}

fn principal(stress: [f64; 3]) -> ([f64; 2], f64) {
    let centre = 0.5 * (stress[0] + stress[1]);
    let radius = ((0.5 * (stress[0] - stress[1])).powi(2) + stress[2].powi(2)).sqrt();
    (
        [centre + radius, centre - radius],
        0.5 * (2.0 * stress[2]).atan2(stress[0] - stress[1]),
    )
}

fn from_principal(values: [f64; 2], angle: f64) -> [f64; 3] {
    let (s, c) = angle.sin_cos();
    [
        values[0] * c * c + values[1] * s * s,
        values[0] * s * s + values[1] * c * c,
        (values[0] - values[1]) * s * c,
    ]
}

fn steel_trial(
    e_mpa: f64,
    nu: f64,
    strain: [f64; 3],
    ez: f64,
    previous: State,
    yield_mpa: f64,
    hardening_ratio: f64,
) -> ([f64; 4], State) {
    let e = e_mpa * 1000.0;
    let g = e / (2.0 * (1.0 + nu));
    let lambda = e * nu / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let ep = previous.plastic_strain;
    let elastic = [strain[0] - ep[0], strain[1] - ep[1], ez - ep[2]];
    let trace = elastic.iter().sum::<f64>();
    let trial = [
        2.0 * g * elastic[0] + lambda * trace,
        2.0 * g * elastic[1] + lambda * trace,
        2.0 * g * elastic[2] + lambda * trace,
        g * (strain[2] - ep[3]),
    ];
    let mean = (trial[0] + trial[1] + trial[2]) / 3.0;
    let s = [trial[0] - mean, trial[1] - mean, trial[2] - mean, trial[3]];
    let q = (1.5 * (s[0].powi(2) + s[1].powi(2) + s[2].powi(2) + 2.0 * s[3].powi(2))).sqrt();
    let tangent = hardening_ratio * e;
    if q <= yield_mpa * 1000.0 || tangent >= e || q == 0.0 {
        return (trial, previous);
    }
    let h = if tangent == 0.0 {
        0.0
    } else {
        e * tangent / (e - tangent)
    };
    let increment = ((q - yield_mpa * 1000.0 - h * previous.equivalent_plastic_strain)
        / (3.0 * g + h))
        .max(0.0);
    if increment == 0.0 {
        return (trial, previous);
    }
    let ratio = (1.0 - 3.0 * g * increment / q).max(0.0);
    let stress = [
        mean + ratio * s[0],
        mean + ratio * s[1],
        mean + ratio * s[2],
        ratio * s[3],
    ];
    let mut state = previous;
    for i in 0..3 {
        state.plastic_strain[i] += 1.5 * increment * s[i] / q;
    }
    state.plastic_strain[3] += 3.0 * increment * s[3] / q;
    state.equivalent_plastic_strain += increment;
    (stress, state)
}

pub fn update(
    e_mpa: f64,
    nu: f64,
    law: MaterialLaw,
    strain: [f64; 3],
    previous: State,
) -> Result<Response, String> {
    let elastic = elastic_stress(e_mpa, nu, strain);
    let result = match law {
        MaterialLaw::Elastic => Response {
            stress: elastic,
            state: previous,
        },
        MaterialLaw::ConcreteCracking {
            tensile_mpa,
            residual_ratio,
        } => {
            let (values, angle) = principal(elastic);
            let limit = tensile_mpa * 1000.0;
            let maximum = values[0].max(0.0);
            let candidate = if maximum > limit {
                1.0 - (limit + residual_ratio * (maximum - limit)) / maximum
            } else {
                0.0
            };
            let mut state = previous;
            state.tensile_damage = previous.tensile_damage.max(candidate).clamp(0.0, 1.0);
            let damaged = values.map(|value| {
                if value > 0.0 {
                    value * (1.0 - state.tensile_damage)
                } else {
                    value
                }
            });
            Response {
                stress: from_principal(damaged, angle),
                state,
            }
        }
        MaterialLaw::SteelBilinear {
            yield_mpa,
            hardening_ratio,
        } => {
            let ep = previous.plastic_strain;
            let mut ez = ep[2] - nu / (1.0 - nu) * (strain[0] - ep[0] + strain[1] - ep[1]);
            let mut converged = false;
            for _ in 0..30 {
                let (stress, _) =
                    steel_trial(e_mpa, nu, strain, ez, previous, yield_mpa, hardening_ratio);
                if stress[2].abs()
                    <= (e_mpa * 1000.0).max(stress[0].abs()).max(stress[1].abs()) * 1e-11
                {
                    converged = true;
                    break;
                }
                let step = 1e-9_f64.max(ez.abs() * 1e-5);
                let (above, _) = steel_trial(
                    e_mpa,
                    nu,
                    strain,
                    ez + step,
                    previous,
                    yield_mpa,
                    hardening_ratio,
                );
                let (below, _) = steel_trial(
                    e_mpa,
                    nu,
                    strain,
                    ez - step,
                    previous,
                    yield_mpa,
                    hardening_ratio,
                );
                let derivative = (above[2] - below[2]) / (2.0 * step);
                if !derivative.is_finite() || derivative.abs() < 1e-12 {
                    return Err("plane-stress plastic return mapping has zero derivative".into());
                }
                ez -= stress[2] / derivative;
                if !ez.is_finite() {
                    return Err("non-finite plane-stress plastic strain".into());
                }
            }
            if !converged {
                return Err("plane-stress plastic return mapping did not converge".into());
            }
            let (stress, state) =
                steel_trial(e_mpa, nu, strain, ez, previous, yield_mpa, hardening_ratio);
            Response {
                stress: [stress[0], stress[1], stress[3]],
                state,
            }
        }
    };
    if result.stress.iter().all(|value| value.is_finite()) {
        Ok(result)
    } else {
        Err("non-finite material stress".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steel_yield_leaves_permanent_strain_after_unloading() {
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 235.0,
            hardening_ratio: 0.02,
        };
        let loaded = update(210_000.0, 0.3, law, [0.004, -0.0012, 0.0], State::default()).unwrap();
        assert!(loaded.state.equivalent_plastic_strain > 0.0);
        let ep = loaded.state.plastic_strain;
        let unloaded = update(210_000.0, 0.3, law, [ep[0], ep[1], ep[3]], loaded.state).unwrap();
        assert!(unloaded.stress[0].abs() < 1e-5);
        assert!(unloaded.state.equivalent_plastic_strain >= loaded.state.equivalent_plastic_strain);
    }

    #[test]
    fn steel_uniaxial_response_matches_bilinear_curve() {
        let e = 210_000.0;
        let nu = 0.3;
        let fy = 235.0;
        let ratio = 0.02;
        let ex = 0.005;
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: fy,
            hardening_ratio: ratio,
        };
        let mut ey = -nu * ex;
        let mut response = update(e, nu, law, [ex, ey, 0.0], State::default()).unwrap();
        for _ in 0..20 {
            if response.stress[1].abs() < 1e-5 {
                break;
            }
            let step = 1e-8;
            let above = update(e, nu, law, [ex, ey + step, 0.0], State::default()).unwrap();
            let derivative = (above.stress[1] - response.stress[1]) / step;
            ey -= response.stress[1] / derivative;
            response = update(e, nu, law, [ex, ey, 0.0], State::default()).unwrap();
        }
        assert!(response.stress[1].abs() < 1e-5);
        let expected_mpa = fy + ratio * e * (ex - fy / e);
        assert!((response.stress[0] / 1000.0 - expected_mpa).abs() < 1e-3);
    }

    #[test]
    fn concrete_damage_persists_on_unloading() {
        let law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.02,
        };
        let loaded = update(30_000.0, 0.2, law, [0.001, 0.0, 0.0], State::default()).unwrap();
        let damage = loaded.state.tensile_damage;
        assert!(damage > 0.0);
        let unloaded = update(30_000.0, 0.2, law, [0.00001, 0.0, 0.0], loaded.state).unwrap();
        assert!((unloaded.state.tensile_damage - damage).abs() < 1e-12);
        assert!(unloaded.stress[0] < elastic_stress(30_000.0, 0.2, [0.00001, 0.0, 0.0])[0]);
    }
}
