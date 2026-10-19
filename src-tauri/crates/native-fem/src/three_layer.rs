//! Blaauwendraad three-layer checks for shell resultants.
//!
//! This is a postprocessor: callers provide already-combined design resultants
//! and explicit code/material values. It does not infer combinations, cracking,
//! detailing, anchorage or National Annex choices.

use serde::{Deserialize, Serialize};

use crate::positive;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellForces {
    /// Membrane forces, tension positive, kN/m.
    pub nx: f64,
    pub ny: f64,
    pub nxy: f64,
    /// Moments, kNm/m.
    pub mx: f64,
    pub my: f64,
    pub mxy: f64,
    /// Transverse shear forces, kN/m.
    pub vx: f64,
    pub vy: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FaceReinforcement {
    /// Reinforcement per metre in local x/y directions, mm²/m.
    pub as_x: f64,
    pub as_y: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompressionModel {
    /// Blaauwendraad et al. (2021), full fcd for the outer skins.
    Blaauwendraad2021,
    /// EN 1992-2 Annex F reduction for cracked compression diagonals.
    Ec2AnnexF,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CoreCheck {
    pub v_rdc_kn_per_m: f64,
    /// Truss-model cotangent parameter tan(theta), 0.4..=1.0.
    pub tan_theta: f64,
    pub provided_shear_mm2_per_m2: f64,
    pub diagonal_limit_mpa: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreeLayerInput {
    pub forces: ShellForces,
    pub thickness_mm: f64,
    pub top_skin_mm: f64,
    pub bottom_skin_mm: f64,
    pub top_reinforcement: FaceReinforcement,
    pub bottom_reinforcement: FaceReinforcement,
    pub fcd_mpa: f64,
    pub fyd_mpa: f64,
    /// EC2 cracked-strut factor nu-prime, explicitly selected by caller.
    pub nu_prime: f64,
    pub compression_model: CompressionModel,
    #[serde(default)]
    pub core: Option<CoreCheck>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreeLayerConfiguration {
    pub thickness_mm: f64,
    pub top_skin_mm: f64,
    pub bottom_skin_mm: f64,
    pub top_reinforcement: FaceReinforcement,
    pub bottom_reinforcement: FaceReinforcement,
    pub fcd_mpa: f64,
    pub fyd_mpa: f64,
    pub nu_prime: f64,
    pub compression_model: CompressionModel,
    #[serde(default)]
    pub core: Option<CoreCheck>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinForces {
    pub nx: f64,
    pub ny: f64,
    pub nxy: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinCheck {
    pub forces: SkinForces,
    #[serde(rename = "requiredAsXmm2PerM")]
    pub required_as_x_mm2_per_m: f64,
    #[serde(rename = "requiredAsYmm2PerM")]
    pub required_as_y_mm2_per_m: f64,
    pub concrete_compression_mpa: f64,
    pub compression_limit_mpa: f64,
    pub utilization_as_x: f64,
    pub utilization_as_y: f64,
    pub utilization_compression: f64,
    /// Governing membrane region: reinforcement in both directions, only x,
    /// only y, or compression-only. This is independent of the selected
    /// compression-strength model.
    pub reinforcement_case: String,
    /// EC2 Annex F stress branch used to derive the local skin resultants.
    pub annex_f_branch: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreResult {
    pub vx_kn_per_m: f64,
    pub vy_kn_per_m: f64,
    pub resultant_kn_per_m: f64,
    pub direction_deg: f64,
    pub shear_reinforcement_required: Option<bool>,
    pub required_shear_mm2_per_m2: Option<f64>,
    pub diagonal_stress_mpa: Option<f64>,
    pub utilization_shear: Option<f64>,
    pub utilization_diagonal: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreeLayerResult {
    pub lever_arm_mm: f64,
    pub top: SkinCheck,
    pub bottom: SkinCheck,
    pub core: CoreResult,
    pub status: String,
    pub not_assessed: Vec<String>,
}

/// One already-combined shell-resultant sample from a membrane and/or plate
/// solver. `id` should uniquely identify an element integration point.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreeLayerSample {
    pub id: String,
    pub position_m: [f64; 2],
    pub forces: ShellForces,
}

/// Batch form for passing resultants from another solver without repeating
/// the section, reinforcement and material choices for every sample.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreeLayerBatchInput {
    pub configuration: ThreeLayerConfiguration,
    pub samples: Vec<ThreeLayerSample>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocatedThreeLayerResult {
    pub id: String,
    pub position_m: [f64; 2],
    pub result: ThreeLayerResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreeLayerBatchResult {
    pub checked_points: usize,
    pub status: String,
    pub results: Vec<LocatedThreeLayerResult>,
}

#[derive(Clone, Copy, Debug)]
struct Distribution {
    lever_arm_mm: f64,
    top: SkinForces,
    bottom: SkinForces,
}

fn finite_forces(f: ShellForces) -> bool {
    [f.nx, f.ny, f.nxy, f.mx, f.my, f.mxy, f.vx, f.vy]
        .iter()
        .all(|v| v.is_finite())
}

/// Distribute membrane forces and moments to the two skins while preserving
/// both force equilibrium and the applied moment, including unequal skins.
fn distribute(f: ShellForces, h: f64, top_t: f64, bottom_t: f64) -> Result<Distribution, String> {
    if !finite_forces(f) {
        return Err("shell forces must be finite".into());
    }
    positive(h, "thicknessMm")?;
    positive(top_t, "topSkinMm")?;
    positive(bottom_t, "bottomSkinMm")?;
    if top_t + bottom_t >= h {
        return Err("outer skin thicknesses must sum to less than total thickness".into());
    }
    let top_arm = (h - top_t) / 2.0;
    let bottom_arm = (h - bottom_t) / 2.0;
    let z = top_arm + bottom_arm;
    let split = |n: f64, m: f64| {
        (
            (n * bottom_arm - 1000.0 * m) / z,
            (n * top_arm + 1000.0 * m) / z,
        )
    };
    let (tx, bx) = split(f.nx, f.mx);
    let (ty, by) = split(f.ny, f.my);
    let (txy, bxy) = split(f.nxy, f.mxy);
    Ok(Distribution {
        lever_arm_mm: z,
        top: SkinForces {
            nx: tx,
            ny: ty,
            nxy: txy,
        },
        bottom: SkinForces {
            nx: bx,
            ny: by,
            nxy: bxy,
        },
    })
}

fn finite_nonnegative(v: f64, name: &str) -> Result<(), String> {
    if v.is_finite() && v >= 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and nonnegative"))
    }
}

fn skin_check(
    n: SkinForces,
    thickness: f64,
    steel: FaceReinforcement,
    fcd: f64,
    fyd: f64,
    nu: f64,
    model: CompressionModel,
) -> SkinCheck {
    let cx = -n.nx / thickness;
    let cy = -n.ny / thickness;
    let tau = n.nxy.abs() / thickness;
    let x_is_y = cy > cx;
    let high = cx.max(cy);
    let low = cx.min(cy);
    let (ftx, fty, sigma, branch) = if high > 0.0 && low > 0.0 && high * low > tau * tau {
        (
            (0.0),
            (0.0),
            (high + low) / 2.0 + ((high - low) / 2.0).hypot(tau),
            "F.1(3)",
        )
    } else if high <= tau {
        (tau - high, tau - low, 2.0 * tau, "F.2-F.4")
    } else {
        (
            0.0,
            tau * tau / high - low,
            high * (1.0 + (tau / high).powi(2)),
            "F.5-F.7",
        )
    };
    let asx = (if x_is_y { fty } else { ftx }).max(0.0) * thickness * 1000.0 / fyd;
    let asy = (if x_is_y { ftx } else { fty }).max(0.0) * thickness * 1000.0 / fyd;
    let reinforcement_case = match (asx > 1e-6, asy > 1e-6) {
        (true, true) => "both-directions",
        (true, false) => "x-only",
        (false, true) => "y-only",
        (false, false) => "compression-only",
    };
    let cracked = asx > 1e-6 || asy > 1e-6;
    let limit = match model {
        CompressionModel::Blaauwendraad2021 => fcd,
        CompressionModel::Ec2AnnexF if cracked => 0.6 * nu * fcd,
        CompressionModel::Ec2AnnexF => fcd,
    };
    let utilization = |required: f64, provided: f64| {
        if required == 0.0 {
            0.0
        } else if provided == 0.0 {
            f64::MAX
        } else {
            (required / provided).min(f64::MAX)
        }
    };
    SkinCheck {
        forces: n,
        required_as_x_mm2_per_m: asx,
        required_as_y_mm2_per_m: asy,
        concrete_compression_mpa: sigma,
        compression_limit_mpa: limit,
        utilization_as_x: utilization(asx, steel.as_x),
        utilization_as_y: utilization(asy, steel.as_y),
        utilization_compression: sigma / limit,
        reinforcement_case: reinforcement_case.into(),
        annex_f_branch: branch.into(),
    }
}

pub fn check(input: &ThreeLayerInput) -> Result<ThreeLayerResult, String> {
    positive(input.fcd_mpa, "fcdMpa")?;
    positive(input.fyd_mpa, "fydMpa")?;
    positive(input.nu_prime, "nuPrime")?;
    if input.nu_prime > 1.0 {
        return Err("nuPrime must not exceed 1".into());
    }
    for (name, value) in [
        ("topAsX", input.top_reinforcement.as_x),
        ("topAsY", input.top_reinforcement.as_y),
        ("bottomAsX", input.bottom_reinforcement.as_x),
        ("bottomAsY", input.bottom_reinforcement.as_y),
    ] {
        finite_nonnegative(value, name)?;
    }
    if let Some(core) = input.core {
        positive(core.v_rdc_kn_per_m, "core.vRdcKnPerM")?;
        positive(core.diagonal_limit_mpa, "core.diagonalLimitMpa")?;
        if !core.tan_theta.is_finite() || !(0.4..=1.0).contains(&core.tan_theta) {
            return Err("core.tanTheta must lie between 0.4 and 1.0".into());
        }
        finite_nonnegative(core.provided_shear_mm2_per_m2, "core.providedShearMm2PerM2")?;
    }
    let d = distribute(
        input.forces,
        input.thickness_mm,
        input.top_skin_mm,
        input.bottom_skin_mm,
    )?;
    let v = input.forces.vx.hypot(input.forces.vy);
    let core = input.core;
    let required = core.map(|c| v > c.v_rdc_kn_per_m);
    let asv = match (core, required) {
        (Some(c), Some(true)) => Some(v / d.lever_arm_mm * c.tan_theta * 1e6 / input.fyd_mpa),
        _ => None,
    };
    let diagonal = match (core, required) {
        (Some(c), Some(true)) => Some(v / d.lever_arm_mm * (c.tan_theta + 1.0 / c.tan_theta)),
        _ => None,
    };
    // Blaauwendraad (2021), Eq. (22): core compression shifts tensile forces
    // into both skins in the direction of the principal shear resultant.
    let shift = match (core, required) {
        (Some(c), Some(true)) if v > 0.0 => [
            0.5 * input.forces.vx.powi(2) / (v * c.tan_theta),
            0.5 * input.forces.vy.powi(2) / (v * c.tan_theta),
            0.5 * input.forces.vx * input.forces.vy / (v * c.tan_theta),
        ],
        _ => [0.0; 3],
    };
    let shifted = |mut n: SkinForces| {
        n.nx += shift[0];
        n.ny += shift[1];
        n.nxy += shift[2];
        n
    };
    let top = skin_check(
        shifted(d.top),
        input.top_skin_mm,
        input.top_reinforcement,
        input.fcd_mpa,
        input.fyd_mpa,
        input.nu_prime,
        input.compression_model,
    );
    let bottom = skin_check(
        shifted(d.bottom),
        input.bottom_skin_mm,
        input.bottom_reinforcement,
        input.fcd_mpa,
        input.fyd_mpa,
        input.nu_prime,
        input.compression_model,
    );
    let util_shear = match (core, asv) {
        (Some(c), Some(a)) if required == Some(true) => {
            Some(if c.provided_shear_mm2_per_m2 == 0.0 {
                f64::MAX
            } else {
                (a / c.provided_shear_mm2_per_m2).min(f64::MAX)
            })
        }
        (Some(_), Some(_)) => Some(0.0),
        _ => None,
    };
    let util_diagonal = match (core, diagonal) {
        (Some(c), Some(s)) if required == Some(true) => {
            Some((s / c.diagonal_limit_mpa).min(f64::MAX))
        }
        (Some(_), Some(_)) => Some(0.0),
        _ => None,
    };
    let numeric = [
        d.lever_arm_mm,
        v,
        top.forces.nx,
        top.forces.ny,
        top.forces.nxy,
        bottom.forces.nx,
        bottom.forces.ny,
        bottom.forces.nxy,
        top.required_as_x_mm2_per_m,
        top.required_as_y_mm2_per_m,
        top.concrete_compression_mpa,
        top.utilization_as_x,
        top.utilization_as_y,
        top.utilization_compression,
        bottom.required_as_x_mm2_per_m,
        bottom.required_as_y_mm2_per_m,
        bottom.concrete_compression_mpa,
        bottom.utilization_as_x,
        bottom.utilization_as_y,
        bottom.utilization_compression,
    ];
    if !numeric.iter().all(|value| value.is_finite())
        || asv.map_or(false, |value| !value.is_finite())
        || diagonal.map_or(false, |value| !value.is_finite())
    {
        return Err("three-layer calculation exceeded finite numeric range".into());
    }
    let mut utilizations = vec![
        top.utilization_as_x,
        top.utilization_as_y,
        top.utilization_compression,
        bottom.utilization_as_x,
        bottom.utilization_as_y,
        bottom.utilization_compression,
    ];
    utilizations.extend(util_shear);
    utilizations.extend(util_diagonal);
    if !utilizations.iter().all(|v| v.is_finite()) {
        return Err("three-layer calculation exceeded finite numeric range".into());
    }
    let mut not_assessed = vec![
        "shell cracking state".into(),
        "automatic layer sizing and reinforcement eccentricity".into(),
        "reinforcement anchorage and detailing".into(),
        "National Annex and project applicability".into(),
    ];
    if core.is_none() {
        not_assessed.push("core layer shear resistance".into());
    }
    Ok(ThreeLayerResult {
        lever_arm_mm: d.lever_arm_mm,
        top,
        bottom,
        core: CoreResult {
            vx_kn_per_m: input.forces.vx,
            vy_kn_per_m: input.forces.vy,
            resultant_kn_per_m: v,
            direction_deg: input.forces.vy.atan2(input.forces.vx).to_degrees(),
            shear_reinforcement_required: required,
            required_shear_mm2_per_m2: asv,
            diagonal_stress_mpa: diagonal,
            utilization_shear: util_shear,
            utilization_diagonal: util_diagonal,
        },
        status: if utilizations.iter().any(|u| *u > 1.0) {
            "partial_check_exceeded"
        } else {
            "partial_check_passes"
        }
        .into(),
        not_assessed,
    })
}

/// Check membrane/plate resultants supplied by an upstream solver. Each
/// sample is evaluated independently using the same explicit section setup.
pub fn check_batch(input: &ThreeLayerBatchInput) -> Result<ThreeLayerBatchResult, String> {
    if input.samples.is_empty() {
        return Err("three-layer batch has no resultants".into());
    }
    let mut ids = std::collections::HashSet::with_capacity(input.samples.len());
    let mut results = Vec::with_capacity(input.samples.len());
    for sample in &input.samples {
        if sample.id.trim().is_empty() || !ids.insert(sample.id.as_str()) {
            return Err("three-layer batch sample IDs must be nonempty and unique".into());
        }
        if !sample.position_m.iter().all(|value| value.is_finite()) {
            return Err(format!(
                "three-layer sample {} has a non-finite position",
                sample.id
            ));
        }
        let config = &input.configuration;
        let case = ThreeLayerInput {
            forces: sample.forces,
            thickness_mm: config.thickness_mm,
            top_skin_mm: config.top_skin_mm,
            bottom_skin_mm: config.bottom_skin_mm,
            top_reinforcement: config.top_reinforcement,
            bottom_reinforcement: config.bottom_reinforcement,
            fcd_mpa: config.fcd_mpa,
            fyd_mpa: config.fyd_mpa,
            nu_prime: config.nu_prime,
            compression_model: config.compression_model,
            core: config.core,
        };
        results.push(LocatedThreeLayerResult {
            id: sample.id.clone(),
            position_m: sample.position_m,
            result: check(&case)?,
        });
    }
    let status = if results
        .iter()
        .any(|entry| entry.result.status == "partial_check_exceeded")
    {
        "partial_check_exceeded"
    } else {
        "partial_check_passes"
    };
    Ok(ThreeLayerBatchResult {
        checked_points: results.len(),
        status: status.into(),
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(forces: ShellForces) -> ThreeLayerInput {
        ThreeLayerInput {
            forces,
            thickness_mm: 300.0,
            top_skin_mm: 100.0,
            bottom_skin_mm: 100.0,
            top_reinforcement: FaceReinforcement {
                as_x: 5000.0,
                as_y: 5000.0,
            },
            bottom_reinforcement: FaceReinforcement {
                as_x: 5000.0,
                as_y: 5000.0,
            },
            fcd_mpa: 20.0,
            fyd_mpa: 400.0,
            nu_prime: 0.8,
            compression_model: CompressionModel::Blaauwendraad2021,
            core: None,
        }
    }

    fn configuration() -> ThreeLayerConfiguration {
        ThreeLayerConfiguration {
            thickness_mm: 300.0,
            top_skin_mm: 100.0,
            bottom_skin_mm: 100.0,
            top_reinforcement: FaceReinforcement {
                as_x: 5000.0,
                as_y: 5000.0,
            },
            bottom_reinforcement: FaceReinforcement {
                as_x: 5000.0,
                as_y: 5000.0,
            },
            fcd_mpa: 20.0,
            fyd_mpa: 400.0,
            nu_prime: 0.8,
            compression_model: CompressionModel::Blaauwendraad2021,
            core: None,
        }
    }

    #[test]
    fn published_cement_example_matches_blaauwendraad_three_layer_forces() {
        // Blaauwendraad et al. (2021), Wapenen van Schijven en Platen, pp. 7-8.
        let mut i = input(ShellForces {
            nx: 495.0,
            ny: 400.0,
            nxy: -330.0,
            mx: 0.0,
            my: 0.0,
            mxy: 0.0,
            vx: 0.0,
            vy: 0.0,
        });
        let r = check(&i).unwrap();
        assert!(
            (((r.top.required_as_x_mm2_per_m + r.bottom.required_as_x_mm2_per_m) * 400.0 / 1000.0)
                - 825.0)
                .abs()
                < 1e-9
        );
        assert!(
            (((r.top.required_as_y_mm2_per_m + r.bottom.required_as_y_mm2_per_m) * 400.0 / 1000.0)
                - 730.0)
                .abs()
                < 1e-9
        );
        assert!(
            (((r.top.concrete_compression_mpa + r.bottom.concrete_compression_mpa) * 100.0)
                - 660.0)
                .abs()
                < 1e-9
        );
        assert_eq!(r.top.compression_limit_mpa, 20.0);
        i.forces.nx = -495.0;
        let one_way = check(&i).unwrap();
        assert!(
            (one_way.top.required_as_x_mm2_per_m + one_way.bottom.required_as_x_mm2_per_m).abs()
                < 1e-12
        );
        assert!(
            (((one_way.top.required_as_y_mm2_per_m + one_way.bottom.required_as_y_mm2_per_m)
                * 400.0
                / 1000.0)
                - 620.0)
                .abs()
                < 1e-9
        );
        assert!(
            (((one_way.top.concrete_compression_mpa + one_way.bottom.concrete_compression_mpa)
                * 100.0)
                - 715.0)
                .abs()
                < 0.1
        );
    }

    #[test]
    fn blaauwendraad_four_membrane_cases_match_cement_equations() {
        let evaluate = |forces| {
            skin_check(
                forces,
                100.0,
                FaceReinforcement {
                    as_x: 10_000.0,
                    as_y: 10_000.0,
                },
                20.0,
                400.0,
                0.8,
                CompressionModel::Blaauwendraad2021,
            )
        };

        // Cement 2021/8, pp. 7-10, four regions of the membrane-force plane.
        // Values are per metre of skin; steel stress is 400 MPa.
        let two_way = evaluate(SkinForces {
            nx: 495.0,
            ny: 400.0,
            nxy: -330.0,
        });
        assert_eq!(two_way.annex_f_branch, "F.2-F.4");
        assert_eq!(two_way.reinforcement_case, "both-directions");
        assert!((two_way.required_as_x_mm2_per_m * 400.0 / 1000.0 - 825.0).abs() < 1e-9);
        assert!((two_way.required_as_y_mm2_per_m * 400.0 / 1000.0 - 730.0).abs() < 1e-9);
        assert!((two_way.concrete_compression_mpa * 100.0 - 660.0).abs() < 1e-9);

        let x_only = evaluate(SkinForces {
            nx: 100.0,
            ny: -500.0,
            nxy: 200.0,
        });
        assert_eq!(x_only.annex_f_branch, "F.5-F.7");
        assert_eq!(x_only.reinforcement_case, "x-only");
        assert!((x_only.required_as_x_mm2_per_m * 400.0 / 1000.0 - 180.0).abs() < 1e-9);
        assert_eq!(x_only.required_as_y_mm2_per_m, 0.0);
        assert!((x_only.concrete_compression_mpa * 100.0 - 580.0).abs() < 1e-9);

        let y_only = evaluate(SkinForces {
            nx: -500.0,
            ny: 100.0,
            nxy: -200.0,
        });
        assert_eq!(y_only.annex_f_branch, "F.5-F.7");
        assert_eq!(y_only.reinforcement_case, "y-only");
        assert_eq!(y_only.required_as_x_mm2_per_m, 0.0);
        assert!((y_only.required_as_y_mm2_per_m * 400.0 / 1000.0 - 180.0).abs() < 1e-9);
        assert!((y_only.concrete_compression_mpa * 100.0 - 580.0).abs() < 1e-9);

        let all_compression = evaluate(SkinForces {
            nx: -500.0,
            ny: -400.0,
            nxy: 200.0,
        });
        let principal_compression = 4.5 + 4.25_f64.sqrt();
        assert_eq!(all_compression.annex_f_branch, "F.1(3)");
        assert_eq!(all_compression.reinforcement_case, "compression-only");
        assert_eq!(all_compression.required_as_x_mm2_per_m, 0.0);
        assert_eq!(all_compression.required_as_y_mm2_per_m, 0.0);
        assert!((all_compression.concrete_compression_mpa - principal_compression).abs() < 1e-12);
    }

    #[test]
    fn blaauwendraad_membrane_branches_are_continuous_at_region_boundaries() {
        let evaluate = |forces| {
            skin_check(
                forces,
                100.0,
                FaceReinforcement {
                    as_x: 10_000.0,
                    as_y: 10_000.0,
                },
                20.0,
                400.0,
                0.8,
                CompressionModel::Blaauwendraad2021,
            )
        };
        let transition_to_x_only = evaluate(SkinForces {
            nx: 100.0,
            ny: -200.0,
            nxy: 200.0,
        });
        assert!(
            (transition_to_x_only.required_as_x_mm2_per_m * 400.0 / 1000.0 - 300.0).abs() < 1e-9
        );
        assert_eq!(transition_to_x_only.required_as_y_mm2_per_m, 0.0);
        assert!((transition_to_x_only.concrete_compression_mpa * 100.0 - 400.0).abs() < 1e-9);

        let transition_to_all_compression = evaluate(SkinForces {
            nx: -100.0,
            ny: -400.0,
            nxy: 200.0,
        });
        assert_eq!(transition_to_all_compression.required_as_x_mm2_per_m, 0.0);
        assert_eq!(transition_to_all_compression.required_as_y_mm2_per_m, 0.0);
        assert!(
            (transition_to_all_compression.concrete_compression_mpa * 100.0 - 500.0).abs() < 1e-9
        );
    }

    #[test]
    fn force_distribution_preserves_force_and_moment_for_unequal_skins() {
        let f = ShellForces {
            nx: 80.0,
            ny: -30.0,
            nxy: 12.0,
            mx: 15.0,
            my: -9.0,
            mxy: 4.0,
            vx: 6.0,
            vy: 8.0,
        };
        let d = distribute(f, 300.0, 60.0, 90.0).unwrap();
        for (top, bottom, n, m) in [
            (d.top.nx, d.bottom.nx, f.nx, f.mx),
            (d.top.ny, d.bottom.ny, f.ny, f.my),
            (d.top.nxy, d.bottom.nxy, f.nxy, f.mxy),
        ] {
            assert!((top + bottom - n).abs() < 1e-10);
            assert!(((bottom * 105.0 - top * 120.0) / 1000.0 - m).abs() < 1e-10);
        }
    }

    #[test]
    fn published_ec2_examples_648_and_93_match_skin_resultants() {
        let e648 = ShellForces {
            nx: -9096.0,
            ny: -1779.0,
            nxy: 5.0,
            mx: 470.0,
            my: -239.0,
            mxy: -14.0,
            vx: -5.0,
            vy: -6.0,
        };
        let d648 = distribute(e648, 1500.0, 140.0, 140.0).unwrap();
        assert!((d648.lever_arm_mm - 1360.0).abs() < 1e-12);
        assert!((d648.top.nx - -4893.3).abs() < 0.4);
        assert!((d648.top.ny - -713.5).abs() < 0.4);
        assert!((d648.top.nxy - 13.0).abs() < 0.3);
        assert!((d648.bottom.nx - -4202.2).abs() < 0.4);
        assert!((d648.bottom.ny - -1065.1).abs() < 0.4);
        assert!((d648.bottom.nxy - -7.7).abs() < 0.3);

        let e93 = ShellForces {
            nx: -4610.0,
            ny: -5746.0,
            nxy: -63.0,
            mx: -671.0,
            my: 499.0,
            mxy: -75.0,
            vx: -150.0,
            vy: 89.0,
        };
        let d93 = distribute(e93, 963.0, 140.0, 140.0).unwrap();
        assert!((d93.lever_arm_mm - 823.0).abs() < 1e-12);
        assert!((d93.top.nx - -1489.8).abs() < 0.5);
        assert!((d93.top.ny - -3479.6).abs() < 0.5);
        assert!((d93.top.nxy - 59.3).abs() < 0.5);
        assert!((d93.bottom.nx - -3120.5).abs() < 0.5);
        assert!((d93.bottom.ny - -2266.7).abs() < 0.5);
        assert!((d93.bottom.nxy - -122.3).abs() < 0.5);
    }

    #[test]
    fn published_core_shear_shifts_both_skins_and_checks_stirrups() {
        let mut i = input(ShellForces {
            nx: 0.0,
            ny: 0.0,
            nxy: 0.0,
            mx: 0.0,
            my: 0.0,
            mxy: 0.0,
            vx: 3.0,
            vy: 4.0,
        });
        i.top_skin_mm = 60.0;
        i.bottom_skin_mm = 60.0;
        i.core = Some(CoreCheck {
            v_rdc_kn_per_m: 4.0,
            tan_theta: 1.0,
            provided_shear_mm2_per_m2: 100.0,
            diagonal_limit_mpa: 12.0,
        });
        let r = check(&i).unwrap();
        assert!(
            (r.core.required_shear_mm2_per_m2.unwrap() - 5.0 / 240.0 * 1e6 / 400.0).abs() < 1e-10
        );
        assert!((r.core.diagonal_stress_mpa.unwrap() - 10.0 / 240.0).abs() < 1e-12);
        for skin in [&r.top, &r.bottom] {
            assert!((skin.forces.nx - 0.9).abs() < 1e-12);
            assert!((skin.forces.ny - 1.6).abs() < 1e-12);
            assert!((skin.forces.nxy - 1.2).abs() < 1e-12);
        }
    }

    #[test]
    fn cement_2021_cantilever_reproduces_design_shear_stirrup_demand() {
        // Braam & Blaauwendraad (2021), Cement 2021/8, example 1 / Fig. 14:
        // 8 m cantilever under 30 kN/m² gives VEd=240 kN/m at the support.
        // The paper's published example is used for the shear resultant;
        // z=500 mm and fyd=435 MPa are explicit design inputs from the
        // documented Rust reference case, not values stated in Fig. 14.
        let mut i = input(ShellForces {
            nx: 0.0,
            ny: 0.0,
            nxy: 0.0,
            mx: 0.0,
            my: 0.0,
            mxy: 0.0,
            vx: 0.0,
            vy: 240.0,
        });
        i.thickness_mm = 600.0;
        i.top_skin_mm = 100.0;
        i.bottom_skin_mm = 100.0;
        i.fyd_mpa = 435.0;
        i.core = Some(CoreCheck {
            v_rdc_kn_per_m: 205.34,
            tan_theta: 1.0,
            provided_shear_mm2_per_m2: 1_103.448_275_862_069,
            diagonal_limit_mpa: 7.36,
        });

        let result = check(&i).unwrap();
        assert_eq!(result.core.shear_reinforcement_required, Some(true));
        assert!((result.core.resultant_kn_per_m - 240.0).abs() < 1e-12);
        assert!(
            (result.core.required_shear_mm2_per_m2.unwrap() - 1_103.448_275_862_069).abs() < 1e-9
        );
        assert!((result.core.diagonal_stress_mpa.unwrap() - 0.96).abs() < 1e-12);
        assert!((result.core.utilization_shear.unwrap() - 1.0).abs() < 1e-12);
        assert!((result.top.forces.ny - 120.0).abs() < 1e-12);
        assert!((result.bottom.forces.ny - 120.0).abs() < 1e-12);
    }

    #[test]
    fn invalid_layer_geometry_and_core_model_are_rejected() {
        let mut i = input(ShellForces {
            nx: 0.0,
            ny: 0.0,
            nxy: 0.0,
            mx: 0.0,
            my: 0.0,
            mxy: 0.0,
            vx: 0.0,
            vy: 0.0,
        });
        i.top_skin_mm = 150.0;
        i.bottom_skin_mm = 150.0;
        assert!(check(&i).is_err());
        i.top_skin_mm = 60.0;
        i.bottom_skin_mm = 60.0;
        i.core = Some(CoreCheck {
            v_rdc_kn_per_m: 20.0,
            tan_theta: 1.2,
            provided_shear_mm2_per_m2: 100.0,
            diagonal_limit_mpa: 12.0,
        });
        assert!(check(&i).is_err());
    }

    #[test]
    fn batch_checks_external_shell_resultants_and_rejects_duplicate_ids() {
        let configuration = configuration();
        let batch = ThreeLayerBatchInput {
            configuration,
            samples: vec![
                ThreeLayerSample {
                    id: "element-1-gauss-1".into(),
                    position_m: [0.25, 0.25],
                    forces: ShellForces {
                        nx: 100.0,
                        ny: 0.0,
                        nxy: 0.0,
                        mx: 0.0,
                        my: 0.0,
                        mxy: 0.0,
                        vx: 0.0,
                        vy: 0.0,
                    },
                },
                ThreeLayerSample {
                    id: "element-1-gauss-2".into(),
                    position_m: [0.75, 0.75],
                    forces: ShellForces {
                        nx: 200.0,
                        ny: 0.0,
                        nxy: 0.0,
                        mx: 0.0,
                        my: 0.0,
                        mxy: 0.0,
                        vx: 0.0,
                        vy: 0.0,
                    },
                },
            ],
        };
        let result = check_batch(&batch).unwrap();
        assert_eq!(result.checked_points, 2);
        assert_eq!(result.results[0].result.top.required_as_x_mm2_per_m, 125.0);
        assert_eq!(result.results[1].result.top.required_as_x_mm2_per_m, 250.0);
        let mut duplicate = batch;
        duplicate.samples[1].id = duplicate.samples[0].id.clone();
        assert!(check_batch(&duplicate).is_err());
    }
}
