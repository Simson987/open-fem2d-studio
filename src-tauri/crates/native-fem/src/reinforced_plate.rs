//! Reinforcement postprocessor for hybrid plate moment and shear resultants.
//! EC2 first-generation recommended expressions: 6.2.2/6.2.3 and 7.3.4.
//! No load combinations or National Annex factors are inferred here.

use serde::{Deserialize, Serialize};

use crate::positive;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LimitState {
    Ultimate,
    Service,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReinforcementSpec {
    /// Run separate requests for ULS shear and SLS crack checks.
    pub limit_state: LimitState,
    pub fck_mpa: f64,
    pub fctm_mpa: f64,
    pub gamma_c: f64,
    pub fyd_mpa: f64,
    pub fywd_mpa: f64,
    pub es_mpa: f64,
    /// Nominal concrete cover to the outside of the bars.
    pub cover_mm: f64,
    pub bar_diameter_mm: f64,
    /// Moment lever arm between the two sandwich skins. Defaults to the
    /// distance between top and bottom bar centrelines.
    #[serde(default)]
    pub lever_arm_mm: Option<f64>,
    pub top_x_mm2_per_m: f64,
    pub top_y_mm2_per_m: f64,
    pub bottom_x_mm2_per_m: f64,
    pub bottom_y_mm2_per_m: f64,
    #[serde(default)]
    pub shear_mm2_per_m2: f64,
    #[serde(default = "one")]
    pub tan_theta: f64,
    #[serde(default = "one")]
    pub alpha_cc: f64,
    /// C_Rd,c from the National Annex, if different from 0.18/gammaC.
    #[serde(default)]
    pub c_rdc: Option<f64>,
    #[serde(default)]
    pub long_term: bool,
    #[serde(default)]
    pub crack_limit_mm: Option<f64>,
}

fn one() -> f64 {
    1.0
}

impl ReinforcementSpec {
    pub fn validate(&self, thickness_m: f64) -> Result<(), String> {
        for (name, value) in [
            ("fckMpa", self.fck_mpa),
            ("fctmMpa", self.fctm_mpa),
            ("gammaC", self.gamma_c),
            ("fydMpa", self.fyd_mpa),
            ("fywdMpa", self.fywd_mpa),
            ("esMpa", self.es_mpa),
            ("barDiameterMm", self.bar_diameter_mm),
            ("alphaCc", self.alpha_cc),
        ] {
            positive(value, name)?;
        }
        if self.fck_mpa >= 250.0 {
            return Err("fckMpa must be below 250 for the selected strut factor".into());
        }
        if !self.cover_mm.is_finite() || self.cover_mm < 0.0 {
            return Err("invalid reinforcement coverMm".into());
        }
        if !self.tan_theta.is_finite() || !(0.4..=1.0).contains(&self.tan_theta) {
            return Err("tanTheta must lie between 0.4 and 1.0".into());
        }
        let h = thickness_m * 1000.0;
        if !h.is_finite() || h <= 2.0 * self.cover_mm + self.bar_diameter_mm {
            return Err("plate thickness must exceed two bar-centre covers".into());
        }
        if let Some(value) = self.lever_arm_mm {
            positive(value, "leverArmMm")?;
            if value >= h {
                return Err("leverArmMm must be smaller than plate thickness".into());
            }
        }
        if let Some(value) = self.c_rdc {
            positive(value, "cRdc")?;
        }
        if let Some(value) = self.crack_limit_mm {
            positive(value, "crackLimitMm")?;
        }
        for (name, value) in [
            ("topX", self.top_x_mm2_per_m),
            ("topY", self.top_y_mm2_per_m),
            ("bottomX", self.bottom_x_mm2_per_m),
            ("bottomY", self.bottom_y_mm2_per_m),
            ("shear", self.shear_mm2_per_m2),
        ] {
            if !value.is_finite() || value < 0.0 {
                return Err(format!("invalid {name} reinforcement area"));
            }
        }
        Ok(())
    }
    fn lever_arm_m(&self, thickness_m: f64) -> f64 {
        self.lever_arm_mm
            .unwrap_or(thickness_m * 1000.0 - 2.0 * self.cover_mm - self.bar_diameter_mm)
            / 1000.0
    }
    fn effective_depth_mm(&self, thickness_m: f64) -> f64 {
        thickness_m * 1000.0 - self.cover_mm - 0.5 * self.bar_diameter_mm
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShearCheck {
    pub demand_kn_per_m: f64,
    pub direction: [f64; 2],
    pub concrete_resistance_kn_per_m: f64,
    pub longitudinal_ratio: f64,
    pub needs_shear_reinforcement: bool,
    pub required_shear_mm2_per_m2: f64,
    pub provided_shear_mm2_per_m2: f64,
    pub provided_shear_resistance_kn_per_m: f64,
    pub shear_reinforcement_sufficient: bool,
    pub strut_stress_mpa: f64,
    pub strut_resistance_mpa: f64,
    pub strut_sufficient: bool,
    /// Additional in-plane membrane force per sandwich skin [nxx, nyy, nxy].
    pub shear_shift_skin_kn_per_m: [f64; 3],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongitudinalCheck {
    /// Top x, top y, bottom x, bottom y in mm²/m.
    pub required_mm2_per_m: [f64; 4],
    pub provided_mm2_per_m: [f64; 4],
    pub sufficient: [bool; 4],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrackCheck {
    pub cracked: bool,
    pub unreinforced_tension: bool,
    pub tensile_force_kn_per_m: f64,
    pub steel_stress_mpa: Option<f64>,
    pub effective_reinforcement_ratio: Option<f64>,
    pub maximum_spacing_mm: Option<f64>,
    pub mean_strain_difference: Option<f64>,
    pub characteristic_width_mm: Option<f64>,
    pub passes_limit: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinforcementResult {
    pub limit_state: LimitState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shear: Option<ShearCheck>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitudinal: Option<LongitudinalCheck>,
    /// Top x, top y, bottom x, bottom y at the *same solved load case*.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crack: Option<[CrackCheck; 4]>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedShear {
    pub position_m: [f64; 2],
    pub check: ShearCheck,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedCrack {
    pub position_m: [f64; 2],
    pub check: CrackCheck,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongitudinalEnvelope {
    /// Top x, top y, bottom x, bottom y.
    pub required_mm2_per_m: [f64; 4],
    pub provided_mm2_per_m: [f64; 4],
    pub sufficient: [bool; 4],
    pub governing_positions_m: [[f64; 2]; 4],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinforcementEnvelope {
    pub limit_state: LimitState,
    pub checked_points: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shear: Option<LocatedShear>,
    /// Largest sigma_c/(nu1*fcd) over all checked points.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_strut_utilization: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitudinal: Option<LongitudinalEnvelope>,
    /// Governing top x, top y, bottom x, bottom y.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub crack: Option<[LocatedCrack; 4]>,
}

/// Check element corners and integration points; choose the governing
/// demand independently for shear, each longitudinal direction and each
/// crack direction. Extrema between sample points remain unproven.
pub fn envelope(
    spec: &ReinforcementSpec,
    thickness_m: f64,
    ec_mpa: f64,
    samples: &[([f64; 2], [f64; 3], [f64; 2])],
) -> Result<ReinforcementEnvelope, String> {
    if samples.is_empty() {
        return Err("reinforcement envelope has no sample points".into());
    }
    let mut best_shear: Option<LocatedShear> = None;
    let mut max_strut_utilization = 0.0_f64;
    let mut longitudinal: Option<LongitudinalEnvelope> = None;
    let mut cracks: Option<[LocatedCrack; 4]> = None;
    for &(position, moment, shear) in samples {
        let point = check(spec, thickness_m, ec_mpa, moment, shear)?;
        if let Some(value) = point.shear {
            max_strut_utilization =
                max_strut_utilization.max(value.strut_stress_mpa / value.strut_resistance_mpa);
            let replace = match &best_shear {
                None => true,
                Some(best) => {
                    value.required_shear_mm2_per_m2 > best.check.required_shear_mm2_per_m2 + 1e-9
                        || ((value.required_shear_mm2_per_m2
                            - best.check.required_shear_mm2_per_m2)
                            .abs()
                            <= 1e-9
                            && value.demand_kn_per_m / value.concrete_resistance_kn_per_m
                                > best.check.demand_kn_per_m
                                    / best.check.concrete_resistance_kn_per_m)
                }
            };
            if replace {
                best_shear = Some(LocatedShear {
                    position_m: position,
                    check: value,
                });
            }
        }
        if let Some(value) = point.longitudinal {
            let entry = longitudinal.get_or_insert(LongitudinalEnvelope {
                required_mm2_per_m: [0.0; 4],
                provided_mm2_per_m: value.provided_mm2_per_m,
                sufficient: [true; 4],
                governing_positions_m: [position; 4],
            });
            for i in 0..4 {
                if value.required_mm2_per_m[i] > entry.required_mm2_per_m[i] {
                    entry.required_mm2_per_m[i] = value.required_mm2_per_m[i];
                    entry.governing_positions_m[i] = position;
                }
                entry.sufficient[i] =
                    entry.provided_mm2_per_m[i] + 1e-9 >= entry.required_mm2_per_m[i];
            }
        }
        if let Some(value) = point.crack {
            let entry = cracks.get_or_insert_with(|| {
                std::array::from_fn(|i| LocatedCrack {
                    position_m: position,
                    check: value[i].clone(),
                })
            });
            for i in 0..4 {
                let current = &entry[i].check;
                let candidate = &value[i];
                let replace = (candidate.unreinforced_tension && !current.unreinforced_tension)
                    || (candidate.unreinforced_tension == current.unreinforced_tension
                        && candidate.characteristic_width_mm.unwrap_or(0.0)
                            > current.characteristic_width_mm.unwrap_or(0.0));
                if replace {
                    entry[i] = LocatedCrack {
                        position_m: position,
                        check: candidate.clone(),
                    };
                }
            }
        }
    }
    Ok(ReinforcementEnvelope {
        limit_state: spec.limit_state,
        checked_points: samples.len(),
        shear: best_shear,
        maximum_strut_utilization: if spec.limit_state == LimitState::Ultimate {
            Some(max_strut_utilization)
        } else {
            None
        },
        longitudinal,
        crack: cracks,
    })
}

fn shell_forces(moment: [f64; 3], lever_arm_m: f64, sign: f64, shift: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| sign * moment[i] / lever_arm_m + shift[i])
}

fn orthogonal_tension(force: [f64; 3]) -> [f64; 2] {
    [
        (force[0] + force[2].abs()).max(0.0),
        (force[1] + force[2].abs()).max(0.0),
    ]
}

fn crack_formula(
    sigma_s: f64,
    cover_mm: f64,
    diameter_mm: f64,
    rho_eff: f64,
    fctm_mpa: f64,
    es_mpa: f64,
    ec_mpa: f64,
    long_term: bool,
) -> (f64, f64, f64) {
    // EC2 7.3.4: k1=0.8 ribbed bars, k2=0.5 bending,
    // k3=3.4 and k4=0.425 (recommended first-generation values).
    let spacing = 3.4 * cover_mm + 0.425 * 0.8 * 0.5 * diameter_mm / rho_eff;
    let kt = if long_term { 0.4 } else { 0.6 };
    let alpha_e = es_mpa / ec_mpa;
    let difference = ((sigma_s - kt * fctm_mpa / rho_eff * (1.0 + alpha_e * rho_eff)) / es_mpa)
        .max(0.6 * sigma_s / es_mpa);
    (spacing, difference, spacing * difference)
}

fn crack_check(
    spec: &ReinforcementSpec,
    force_kn_per_m: f64,
    area_mm2_per_m: f64,
    thickness_m: f64,
    lever_arm_m: f64,
    ec_mpa: f64,
) -> CrackCheck {
    let zero = || CrackCheck {
        cracked: false,
        unreinforced_tension: false,
        tensile_force_kn_per_m: force_kn_per_m,
        steel_stress_mpa: Some(0.0),
        effective_reinforcement_ratio: None,
        maximum_spacing_mm: None,
        mean_strain_difference: None,
        characteristic_width_mm: Some(0.0),
        passes_limit: spec.crack_limit_mm.map(|_| true),
    };
    if force_kn_per_m <= 0.0 {
        return zero();
    }
    let h = thickness_m * 1000.0;
    // Equivalent uncracked face stress from the orthogonal shell-force demand.
    let surface_stress = 6.0 * force_kn_per_m * lever_arm_m / (1000.0 * thickness_m.powi(2));
    if surface_stress <= spec.fctm_mpa {
        return zero();
    }
    if area_mm2_per_m == 0.0 {
        return CrackCheck {
            cracked: true,
            unreinforced_tension: true,
            tensile_force_kn_per_m: force_kn_per_m,
            steel_stress_mpa: None,
            effective_reinforcement_ratio: None,
            maximum_spacing_mm: None,
            mean_strain_difference: None,
            characteristic_width_mm: None,
            passes_limit: spec.crack_limit_mm.map(|_| false),
        };
    }
    let sigma_s = force_kn_per_m * 1000.0 / area_mm2_per_m;
    let d = spec.effective_depth_mm(thickness_m);
    let transformed = spec.es_mpa / ec_mpa * area_mm2_per_m;
    let neutral_axis =
        ((transformed * transformed + 2000.0 * transformed * d).sqrt() - transformed) / 1000.0;
    let h_eff = (2.5 * (h - d)).min((h - neutral_axis) / 3.0).min(h / 2.0);
    let rho_eff = area_mm2_per_m / (1000.0 * h_eff);
    let (spacing, difference, width) = crack_formula(
        sigma_s,
        spec.cover_mm,
        spec.bar_diameter_mm,
        rho_eff,
        spec.fctm_mpa,
        spec.es_mpa,
        ec_mpa,
        spec.long_term,
    );
    CrackCheck {
        cracked: true,
        unreinforced_tension: false,
        tensile_force_kn_per_m: force_kn_per_m,
        steel_stress_mpa: Some(sigma_s),
        effective_reinforcement_ratio: Some(rho_eff),
        maximum_spacing_mm: Some(spacing),
        mean_strain_difference: Some(difference),
        characteristic_width_mm: Some(width),
        passes_limit: spec.crack_limit_mm.map(|limit| width <= limit),
    }
}

pub fn check(
    spec: &ReinforcementSpec,
    thickness_m: f64,
    ec_mpa: f64,
    moment: [f64; 3],
    shear: [f64; 2],
) -> Result<ReinforcementResult, String> {
    spec.validate(thickness_m)?;
    positive(ec_mpa, "concrete elastic modulus")?;
    if !moment.iter().chain(&shear).all(|v| v.is_finite()) {
        return Err("non-finite plate resultants".into());
    }
    let v = shear[0].hypot(shear[1]);
    let direction = if v == 0.0 {
        [1.0, 0.0]
    } else {
        [shear[0] / v, shear[1] / v]
    };
    let mn = moment[0] * direction[0].powi(2)
        + moment[1] * direction[1].powi(2)
        + 2.0 * moment[2] * direction[0] * direction[1];
    let (asx, asy) = if mn > 0.0 {
        (spec.bottom_x_mm2_per_m, spec.bottom_y_mm2_per_m)
    } else if mn < 0.0 {
        (spec.top_x_mm2_per_m, spec.top_y_mm2_per_m)
    } else {
        (
            spec.top_x_mm2_per_m.min(spec.bottom_x_mm2_per_m),
            spec.top_y_mm2_per_m.min(spec.bottom_y_mm2_per_m),
        )
    };
    let as_n = asx * direction[0].powi(2) + asy * direction[1].powi(2);
    let d_mm = spec.effective_depth_mm(thickness_m);
    let rho = (as_n / (1000.0 * d_mm)).min(0.02);
    let k = (1.0 + (200.0 / d_mm).sqrt()).min(2.0);
    let crdc = spec.c_rdc.unwrap_or(0.18 / spec.gamma_c);
    let concrete_stress = (crdc * k * (100.0 * rho * spec.fck_mpa).cbrt())
        .max(0.035 * k.powf(1.5) * spec.fck_mpa.sqrt());
    let vrdc = concrete_stress * d_mm;
    let needs = v > vrdc;
    let dv = spec.lever_arm_m(thickness_m);
    let shear_stress_mpa = v / (1000.0 * dv);
    let required = if needs {
        1e6 * shear_stress_mpa * spec.tan_theta / spec.fywd_mpa
    } else {
        0.0
    };
    let provided_capacity =
        spec.shear_mm2_per_m2 / 1e6 * spec.fywd_mpa * 1000.0 * dv / spec.tan_theta;
    let strut_stress = shear_stress_mpa * (spec.tan_theta + 1.0 / spec.tan_theta);
    let strut_resistance =
        0.6 * (1.0 - spec.fck_mpa / 250.0) * spec.alpha_cc * spec.fck_mpa / spec.gamma_c;
    let shifted = if needs { 0.5 * v / spec.tan_theta } else { 0.0 };
    let shift = [
        shifted * direction[0].powi(2),
        shifted * direction[1].powi(2),
        shifted * direction[0] * direction[1],
    ];
    let shear_check = ShearCheck {
        demand_kn_per_m: v,
        direction,
        concrete_resistance_kn_per_m: vrdc,
        longitudinal_ratio: rho,
        needs_shear_reinforcement: needs,
        required_shear_mm2_per_m2: required,
        provided_shear_mm2_per_m2: spec.shear_mm2_per_m2,
        provided_shear_resistance_kn_per_m: provided_capacity,
        shear_reinforcement_sufficient: !needs || spec.shear_mm2_per_m2 + 1e-9 >= required,
        strut_stress_mpa: strut_stress,
        strut_resistance_mpa: strut_resistance,
        strut_sufficient: strut_stress <= strut_resistance,
        shear_shift_skin_kn_per_m: shift,
    };
    let z = dv;
    let top = orthogonal_tension(shell_forces(moment, z, -1.0, shift));
    let bottom = orthogonal_tension(shell_forces(moment, z, 1.0, shift));
    let requirements = [top[0], top[1], bottom[0], bottom[1]].map(|n| 1000.0 * n / spec.fyd_mpa);
    let provided = [
        spec.top_x_mm2_per_m,
        spec.top_y_mm2_per_m,
        spec.bottom_x_mm2_per_m,
        spec.bottom_y_mm2_per_m,
    ];
    let longitudinal = LongitudinalCheck {
        required_mm2_per_m: requirements,
        provided_mm2_per_m: provided,
        sufficient: std::array::from_fn(|i| provided[i] + 1e-9 >= requirements[i]),
    };
    // Service crack force excludes the ULS shear-induced shift.
    let top_sls = orthogonal_tension(shell_forces(moment, z, -1.0, [0.0; 3]));
    let bottom_sls = orthogonal_tension(shell_forces(moment, z, 1.0, [0.0; 3]));
    let sls = [top_sls[0], top_sls[1], bottom_sls[0], bottom_sls[1]];
    let crack =
        std::array::from_fn(|i| crack_check(spec, sls[i], provided[i], thickness_m, z, ec_mpa));
    Ok(match spec.limit_state {
        LimitState::Ultimate => ReinforcementResult {
            limit_state: spec.limit_state,
            shear: Some(shear_check),
            longitudinal: Some(longitudinal),
            crack: None,
        },
        LimitState::Service => ReinforcementResult {
            limit_state: spec.limit_state,
            shear: None,
            longitudinal: None,
            crack: Some(crack),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> ReinforcementSpec {
        ReinforcementSpec {
            limit_state: LimitState::Ultimate,
            fck_mpa: 20.0,
            fctm_mpa: 2.2,
            gamma_c: 1.5,
            fyd_mpa: 435.0,
            fywd_mpa: 435.0,
            es_mpa: 200_000.0,
            cover_mm: 40.0,
            bar_diameter_mm: 16.0,
            lever_arm_mm: Some(500.0),
            top_x_mm2_per_m: 2000.0,
            top_y_mm2_per_m: 2000.0,
            bottom_x_mm2_per_m: 2000.0,
            bottom_y_mm2_per_m: 2000.0,
            shear_mm2_per_m2: 0.0,
            tan_theta: 1.0,
            alpha_cc: 1.0,
            c_rdc: None,
            long_term: false,
            crack_limit_mm: Some(0.3),
        }
    }
    #[test]
    fn ec2_crack_formula_matches_published_bridge_example() {
        // Sétra/JRC bridge guide: sr,max≈408 mm, sigma_s=94 MPa,
        // epsilon difference=0.6*94/200000, wk≈0.12 mm.
        let (spacing, difference, width) =
            crack_formula(94.0, 30.0, 20.0, 0.0111, 3.2, 200_000.0, 34_077.0, false);
        assert!((spacing - 408.0).abs() < 2.0, "{spacing}");
        assert!((difference - 0.000282).abs() < 1e-9);
        assert!((width - 0.12).abs() < 0.01, "{width}");
    }
    #[test]
    fn shear_truss_and_sandwich_shift_follow_cement_equations() {
        let result = check(&spec(), 0.6, 30_000.0, [0.0, -750.0, 0.0], [0.0, 210.0]).unwrap();
        let shear = result.shear.unwrap();
        assert!(shear.needs_shear_reinforcement);
        assert_eq!(shear.direction, [0.0, 1.0]);
        assert!((shear.required_shear_mm2_per_m2 - 965.517241).abs() < 1e-5);
        assert!((shear.strut_stress_mpa - 0.84).abs() < 1e-12);
        assert!((shear.shear_shift_skin_kn_per_m[1] - 105.0).abs() < 1e-12);
        assert!(result.longitudinal.unwrap().required_mm2_per_m[1] > 0.0);
    }
    #[test]
    fn zero_shear_and_uncracked_moment_need_no_stirrups_or_crack_width() {
        let result = check(&spec(), 0.6, 30_000.0, [0.0, 1.0, 0.0], [0.0, 0.0]).unwrap();
        let shear = result.shear.unwrap();
        assert!(!shear.needs_shear_reinforcement);
        assert_eq!(shear.required_shear_mm2_per_m2, 0.0);
    }
    #[test]
    fn absent_tension_steel_is_reported_as_unreinforced() {
        let mut input = spec();
        input.limit_state = LimitState::Service;
        input.top_y_mm2_per_m = 0.0;
        let result = check(&input, 0.6, 30_000.0, [0.0, -750.0, 0.0], [0.0, 210.0]).unwrap();
        let crack = result.crack.unwrap();
        assert!(crack[1].unreinforced_tension);
        assert_eq!(crack[1].characteristic_width_mm, None);
        assert_eq!(crack[1].passes_limit, Some(false));
    }

    #[test]
    fn envelope_uses_support_edge_for_governing_shear_and_crack() {
        let samples = [
            ([0.0, 0.0], [0.0, -960.0, 0.0], [0.0, 240.0]),
            ([0.0, 1.0], [0.0, -750.0, 0.0], [0.0, 210.0]),
        ];
        let ultimate = envelope(&spec(), 0.6, 30_000.0, &samples).unwrap();
        let shear = ultimate.shear.unwrap();
        assert_eq!(shear.position_m, [0.0, 0.0]);
        assert!(shear.check.required_shear_mm2_per_m2 > 1000.0);
        assert_eq!(
            ultimate.longitudinal.unwrap().governing_positions_m[1],
            [0.0, 0.0]
        );
        let mut service = spec();
        service.limit_state = LimitState::Service;
        let service = envelope(&service, 0.6, 30_000.0, &samples).unwrap();
        let crack = service.crack.unwrap();
        assert_eq!(crack[1].position_m, [0.0, 0.0]);
        assert!(crack[1].check.characteristic_width_mm.unwrap() > 0.0);
        assert!(service.shear.is_none());
    }
}
