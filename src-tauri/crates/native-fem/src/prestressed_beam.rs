//! Elastic, simply supported prestressed beam reference calculator.
//! Input units are m, kN and MPa; tension and downward deflection are positive.
//! Prestress loss is an externally supplied fraction, not a loss prediction.

use crate::positive;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Section {
    pub area_m2: f64,
    pub inertia_m4: f64,
    pub top_fibre_m: f64,
    pub bottom_fibre_m: f64,
    pub e_mpa: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TendonProfile {
    Straight {
        eccentricity_m: f64,
    },
    Parabolic {
        end_eccentricity_m: f64,
        mid_eccentricity_m: f64,
    },
}

impl TendonProfile {
    fn offsets(&self) -> (f64, f64) {
        match *self {
            Self::Straight { eccentricity_m } => (eccentricity_m, eccentricity_m),
            Self::Parabolic {
                end_eccentricity_m,
                mid_eccentricity_m,
            } => (end_eccentricity_m, mid_eccentricity_m),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub span_m: f64,
    pub section: Section,
    pub tendon: TendonProfile,
    pub initial_force_kn: f64,
    #[serde(default)]
    pub loss_fraction: f64,
    #[serde(default)]
    pub transfer_uniform_downward_kn_per_m: f64,
    #[serde(default)]
    pub service_uniform_downward_kn_per_m: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FibreStresses {
    pub top_mpa: f64,
    pub bottom_mpa: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageResult {
    pub force_kn: f64,
    pub end_eccentricity_m: f64,
    pub mid_eccentricity_m: f64,
    pub equivalent_uniform_upward_kn_per_m: f64,
    pub end_moment_knm: f64,
    pub end_vertical_force_magnitude_kn: f64,
    pub prestress_midspan_moment_knm: f64,
    pub external_midspan_moment_knm: f64,
    pub end_stress: FibreStresses,
    pub midspan_stress: FibreStresses,
    pub axial_shortening_m: f64,
    pub prestress_camber_m: f64,
    pub external_midspan_deflection_m: f64,
    pub total_midspan_deflection_m: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBeam {
    pub transfer: StageResult,
    pub service: StageResult,
}

fn fibre_stresses(section: &Section, force: f64, eccentricity: f64, moment: f64) -> FibreStresses {
    let axial = -force / section.area_m2;
    let prestress_moment = force * eccentricity;
    let top = axial + (prestress_moment - moment) * section.top_fibre_m / section.inertia_m4;
    let bottom = axial + (moment - prestress_moment) * section.bottom_fibre_m / section.inertia_m4;
    FibreStresses {
        top_mpa: top / 1000.0,
        bottom_mpa: bottom / 1000.0,
    }
}

fn stage(request: &Request, force: f64, uniform_load: f64) -> StageResult {
    let span = request.span_m;
    let section = &request.section;
    let ei_knm2 = section.e_mpa * 1000.0 * section.inertia_m4;
    let ea_kn = section.e_mpa * 1000.0 * section.area_m2;
    let (end_eccentricity, mid_eccentricity) = request.tendon.offsets();
    let drape = mid_eccentricity - end_eccentricity;
    let midspan_moment = uniform_load * span * span / 8.0;
    // Constant eccentricity is an applied end moment. The parabolic part is
    // equivalent to an upward uniform load and equal/opposite end shears.
    let equivalent_load = 8.0 * force * drape / (span * span);
    let prestress_camber =
        -force * span * span / ei_knm2 * (end_eccentricity / 8.0 + 5.0 * drape / 48.0);
    let external_deflection = 5.0 * uniform_load * span.powi(4) / (384.0 * ei_knm2);
    StageResult {
        force_kn: force,
        end_eccentricity_m: end_eccentricity,
        mid_eccentricity_m: mid_eccentricity,
        equivalent_uniform_upward_kn_per_m: equivalent_load,
        end_moment_knm: force * end_eccentricity,
        end_vertical_force_magnitude_kn: (4.0 * force * drape / span).abs(),
        prestress_midspan_moment_knm: -force * mid_eccentricity,
        external_midspan_moment_knm: midspan_moment,
        end_stress: fibre_stresses(section, force, end_eccentricity, 0.0),
        midspan_stress: fibre_stresses(section, force, mid_eccentricity, midspan_moment),
        axial_shortening_m: -force * span / ea_kn,
        prestress_camber_m: prestress_camber,
        external_midspan_deflection_m: external_deflection,
        total_midspan_deflection_m: prestress_camber + external_deflection,
    }
}

pub fn solve(request: &Request) -> Result<ResultBeam, String> {
    positive(request.span_m, "spanM")?;
    positive(request.section.area_m2, "section.areaM2")?;
    positive(request.section.inertia_m4, "section.inertiaM4")?;
    positive(request.section.top_fibre_m, "section.topFibreM")?;
    positive(request.section.bottom_fibre_m, "section.bottomFibreM")?;
    positive(request.section.e_mpa, "section.eMpa")?;
    positive(request.initial_force_kn, "initialForceKn")?;
    if !request.loss_fraction.is_finite() || !(0.0..=1.0).contains(&request.loss_fraction) {
        return Err("lossFraction must lie between 0 and 1".into());
    }
    for (name, value) in [
        (
            "transferUniformDownwardKnPerM",
            request.transfer_uniform_downward_kn_per_m,
        ),
        (
            "serviceUniformDownwardKnPerM",
            request.service_uniform_downward_kn_per_m,
        ),
    ] {
        if !value.is_finite() {
            return Err(format!("{name} must be finite"));
        }
    }
    let (end, mid) = request.tendon.offsets();
    if !end.is_finite() || !mid.is_finite() {
        return Err("tendon eccentricities must be finite".into());
    }
    Ok(ResultBeam {
        transfer: stage(
            request,
            request.initial_force_kn,
            request.transfer_uniform_downward_kn_per_m,
        ),
        service: stage(
            request,
            request.initial_force_kn * (1.0 - request.loss_fraction),
            request.service_uniform_downward_kn_per_m,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{actual} != {expected}"
        );
    }

    fn baseline(profile: TendonProfile) -> Request {
        Request {
            span_m: 10.0,
            section: Section {
                area_m2: 0.5,
                inertia_m4: 0.02,
                top_fibre_m: 0.3,
                bottom_fibre_m: 0.3,
                e_mpa: 30_000.0,
            },
            tendon: profile,
            initial_force_kn: 1000.0,
            loss_fraction: 0.2,
            transfer_uniform_downward_kn_per_m: 0.0,
            service_uniform_downward_kn_per_m: 16.0,
        }
    }

    #[test]
    fn parabolic_tendon_balances_uniform_load_at_service() {
        let request = baseline(TendonProfile::Parabolic {
            end_eccentricity_m: 0.0,
            mid_eccentricity_m: 0.2,
        });
        let result = solve(&request).unwrap();
        close(
            result.transfer.equivalent_uniform_upward_kn_per_m,
            16.0,
            1e-12,
        );
        close(
            result.service.equivalent_uniform_upward_kn_per_m,
            12.8,
            1e-12,
        );
        close(
            result.transfer.prestress_camber_m,
            -5.0 / 48.0 * 1000.0 * 0.2 * 100.0 / 600_000.0,
            1e-14,
        );
        close(result.transfer.midspan_stress.top_mpa, 1.0, 1e-12);
        close(result.transfer.midspan_stress.bottom_mpa, -5.0, 1e-12);
        close(result.service.external_midspan_moment_knm, 200.0, 1e-12);
        close(
            result.service.axial_shortening_m,
            -800.0 * 10.0 / 15_000_000.0,
            1e-14,
        );
        close(
            result.service.total_midspan_deflection_m,
            1.0 / 1440.0,
            1e-14,
        );
    }

    #[test]
    fn straight_tendon_matches_fhwa_girder_camber_example() {
        // FHWA PSC girder example, design step 5.6: 924.4 kip, 31.005 in,
        // L=109 ft, E=4200 ksi, I=733320 in^4 -> 1.99 in upward.
        const KIP_KN: f64 = 4.448_221_615_260_5;
        const KSI_MPA: f64 = 6.894_757_293_168;
        const IN_M: f64 = 0.0254;
        let request = Request {
            span_m: 109.0 * 0.3048,
            section: Section {
                area_m2: 1085.0 * IN_M * IN_M,
                inertia_m4: 733_320.0 * IN_M.powi(4),
                top_fibre_m: 733_320.0 / 20_588.0 * IN_M,
                bottom_fibre_m: 733_320.0 / 20_157.0 * IN_M,
                e_mpa: 4200.0 * KSI_MPA,
            },
            tendon: TendonProfile::Straight {
                eccentricity_m: 31.005 * IN_M,
            },
            initial_force_kn: 924.4 * KIP_KN,
            loss_fraction: 0.0,
            transfer_uniform_downward_kn_per_m: 0.0,
            service_uniform_downward_kn_per_m: 0.0,
        };
        let result = solve(&request).unwrap();
        close(result.transfer.prestress_camber_m / IN_M, -1.99, 0.01);
        close(
            result.transfer.equivalent_uniform_upward_kn_per_m,
            0.0,
            1e-12,
        );
    }

    #[test]
    fn rejects_invalid_loss_and_section() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.1,
        });
        request.loss_fraction = 1.1;
        assert!(solve(&request).is_err());
        request.loss_fraction = 0.2;
        request.section.inertia_m4 = 0.0;
        assert!(solve(&request).is_err());
    }

    #[test]
    fn documented_examples_parse_and_solve() {
        for text in [
            include_str!("../examples/fhwa-prestressed-girder-camber.json"),
            include_str!("../examples/parabolic-prestressed-beam.json"),
        ] {
            let request: Request = serde_json::from_str(text).unwrap();
            solve(&request).unwrap();
        }
    }
}
