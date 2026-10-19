//! EC2 7.3.4 crack-width postprocessor for reinforced and bonded prestressed
//! concrete. Section response is supplied by the caller; this module checks
//! crack spacing and width and never substitutes gross-section stresses.

use nen_en_1992_1_1::scheurwijdte::{
    alpha_e, h_c_ef_mm, rekverschil, scheurafstand, w_k_mm, ScheurafstandBron,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    /// Reinforcement stress in the cracked section, MPa. For pretensioned
    /// members controlled by bonded tendons, enter Δσp from zero concrete
    /// strain at the tendon level (EC2 7.3.4(2)).
    pub sigma_s_mpa: f64,
    /// Rectangular section width and height in mm. The neutral axis is
    /// measured from the compression edge of the cracked section.
    pub width_mm: f64,
    pub height_mm: f64,
    pub effective_depth_mm: f64,
    pub neutral_axis_mm: f64,
    /// Area of bonded ordinary reinforcement in Ac,eff, mm².
    #[serde(default)]
    pub bonded_reinforcement_area_mm2: f64,
    /// Bond-adjusted area of bonded prestressing steel used in (7.10), mm².
    /// Supply the value required by the selected Eurocode/National Annex
    /// edition; the applicable ξ₁ exponent is not inferred here.
    #[serde(default)]
    pub effective_bonded_prestressing_area_mm2: f64,
    /// Effective concrete area Ac,eff is calculated from width and h_c,eff.
    pub cover_to_longitudinal_steel_mm: f64,
    pub bar_or_tendon_diameter_mm: f64,
    /// Actual spacing of bonded reinforcement/tendons in the tension zone.
    /// If absent or above 5(c + Ø/2), EC2 7.3.4(3) uses 7.14.
    #[serde(default)]
    pub spacing_mm: Option<f64>,
    /// Material and explicit design choices.
    pub f_ck_mpa: f64,
    pub f_ct_eff_mpa: f64,
    pub e_cm_mpa: f64,
    pub k_t: f64,
    /// 0.8 for high-bond bars or 1.6 for effectively smooth tendons.
    pub k1: f64,
    /// 0.5 for bending, 1.0 for pure tension, or the EC2 7.13 value.
    pub k2: f64,
    /// Applicable crack-width limit from the selected National Annex, mm.
    pub w_max_mm: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Result {
    pub effective_tension_height_mm: f64,
    pub effective_concrete_area_mm2: f64,
    pub effective_reinforcement_ratio: f64,
    pub strain_difference: f64,
    pub tension_stiffening_floor_governs: bool,
    pub maximum_crack_spacing_mm: f64,
    pub crack_spacing_equation: String,
    pub crack_width_mm: f64,
    pub allowable_crack_width_mm: f64,
    pub utilization: f64,
    pub passes: bool,
}

fn finite_positive(name: &str, value: f64) -> std::result::Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} moet eindig en groter dan nul zijn"))
    }
}

pub fn solve(input: &Request) -> std::result::Result<Result, String> {
    for (name, value) in [
        ("sigmaSMpa", input.sigma_s_mpa),
        ("widthMm", input.width_mm),
        ("heightMm", input.height_mm),
        ("effectiveDepthMm", input.effective_depth_mm),
        ("barOrTendonDiameterMm", input.bar_or_tendon_diameter_mm),
        ("fCkMpa", input.f_ck_mpa),
        ("fCtEffMpa", input.f_ct_eff_mpa),
        ("eCmMpa", input.e_cm_mpa),
        ("wMaxMm", input.w_max_mm),
    ] {
        finite_positive(name, value)?;
    }
    if !input.neutral_axis_mm.is_finite()
        || input.neutral_axis_mm < 0.0
        || input.neutral_axis_mm >= input.height_mm
    {
        return Err("neutralAxisMm moet tussen 0 en heightMm liggen".into());
    }
    if input.effective_depth_mm > input.height_mm {
        return Err("effectiveDepthMm mag niet groter zijn dan heightMm".into());
    }
    if input.neutral_axis_mm >= input.effective_depth_mm {
        return Err(
            "neutralAxisMm moet vóór de trekstaal liggen (kleiner dan effectiveDepthMm)".into(),
        );
    }
    finite_positive(
        "coverToLongitudinalSteelMm",
        input.cover_to_longitudinal_steel_mm,
    )?;
    if input.bonded_reinforcement_area_mm2 < 0.0
        || input.effective_bonded_prestressing_area_mm2 < 0.0
        || !input.bonded_reinforcement_area_mm2.is_finite()
        || !input.effective_bonded_prestressing_area_mm2.is_finite()
    {
        return Err("wapeningsoppervlakken moeten eindig en niet-negatief zijn".into());
    }
    if input.bonded_reinforcement_area_mm2 == 0.0
        && input.effective_bonded_prestressing_area_mm2 == 0.0
    {
        return Err("ten minste één hechtend wapeningsoppervlak is nodig".into());
    }
    if !input.k_t.is_finite() || (input.k_t - 0.4).abs() > 1e-9 && (input.k_t - 0.6).abs() > 1e-9 {
        return Err("kT moet 0,4 (langdurend) of 0,6 (kortdurend) zijn".into());
    }
    if !input.k1.is_finite() || (input.k1 - 0.8).abs() > 1e-9 && (input.k1 - 1.6).abs() > 1e-9 {
        return Err("k1 moet 0,8 (hoge aanhechting) of 1,6 (glad) zijn".into());
    }
    if !(0.5..=1.0).contains(&input.k2) || !input.k2.is_finite() {
        return Err("k2 moet tussen 0,5 en 1,0 liggen".into());
    }
    if let Some(spacing) = input.spacing_mm {
        finite_positive("spacingMm", spacing)?;
    }

    let h_cef = h_c_ef_mm(
        input.height_mm,
        input.effective_depth_mm,
        input.neutral_axis_mm,
    );
    let a_cef = input.width_mm * h_cef;
    finite_positive("AcEff", a_cef)?;
    // EC2 7.3.4(2), expression (7.10). The bond-adjusted Ap' is explicit
    // because the exponent on ξ1 depends on the applicable source edition.
    let equivalent_area =
        input.bonded_reinforcement_area_mm2 + input.effective_bonded_prestressing_area_mm2;
    let rho = equivalent_area / a_cef;
    let (eps, floor_governs) = rekverschil(
        input.sigma_s_mpa,
        input.k_t,
        input.f_ct_eff_mpa,
        rho,
        alpha_e(input.e_cm_mpa),
    )?;
    let spacing = scheurafstand(
        input.cover_to_longitudinal_steel_mm,
        input.bar_or_tendon_diameter_mm,
        rho,
        input.k1,
        input.k2,
        input.f_ck_mpa,
        input.spacing_mm,
        input.height_mm,
        input.neutral_axis_mm,
    )?;
    let wk = w_k_mm(spacing.s_r_max_mm, eps);
    let utilization = wk / input.w_max_mm;
    Ok(Result {
        effective_tension_height_mm: h_cef,
        effective_concrete_area_mm2: a_cef,
        effective_reinforcement_ratio: rho,
        strain_difference: eps,
        tension_stiffening_floor_governs: floor_governs,
        maximum_crack_spacing_mm: spacing.s_r_max_mm,
        crack_spacing_equation: match spacing.bron {
            ScheurafstandBron::Vergelijking7_11 => "7.11".into(),
            ScheurafstandBron::Vergelijking7_11NbBovengrens => "7.11 NB-bovengrens".into(),
            ScheurafstandBron::Vergelijking7_14 => "7.14".into(),
        },
        crack_width_mm: wk,
        allowable_crack_width_mm: input.w_max_mm,
        utilization,
        passes: utilization <= 1.0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tendon_only() -> Request {
        Request {
            sigma_s_mpa: 120.0, // supplied Δσp in the cracked section
            width_mm: 300.0,
            height_mm: 600.0,
            effective_depth_mm: 540.0,
            neutral_axis_mm: 120.0,
            bonded_reinforcement_area_mm2: 0.0,
            effective_bonded_prestressing_area_mm2: 588.0,
            cover_to_longitudinal_steel_mm: 60.0,
            bar_or_tendon_diameter_mm: 15.2,
            spacing_mm: Some(100.0),
            f_ck_mpa: 40.0,
            f_ct_eff_mpa: 3.5,
            e_cm_mpa: 35220.0,
            k_t: 0.4,
            k1: 1.6,
            k2: 0.5,
            w_max_mm: 0.2,
        }
    }

    #[test]
    fn bonded_prestressing_uses_effective_area_and_returns_width_and_utilization() {
        let result = solve(&tendon_only()).unwrap();
        assert!((result.effective_tension_height_mm - 150.0).abs() < 1e-9);
        assert!((result.effective_concrete_area_mm2 - 45_000.0).abs() < 1e-9);
        assert!((result.effective_reinforcement_ratio - 0.0130666666667).abs() < 1e-10);
        assert!(result.crack_width_mm > 0.0);
        assert!((result.utilization - result.crack_width_mm / 0.2).abs() < 1e-12);
        // Independent substitution into (7.8)–(7.11): the tension-stiffening
        // floor gives 0.6*120/200000, and the Dutch upper crack-spacing bound
        // gives max((50-0.8*40)*15.2, 15*15.2) = 273.6 mm.
        assert!(result.tension_stiffening_floor_governs);
        assert_eq!(result.crack_spacing_equation, "7.11 NB-bovengrens");
        assert!((result.maximum_crack_spacing_mm - 273.6).abs() < 1e-10);
        assert!((result.crack_width_mm - 0.098496).abs() < 1e-9);
    }

    #[test]
    fn rejects_missing_bonded_reinforcement_and_invalid_cover() {
        let mut request = tendon_only();
        request.effective_bonded_prestressing_area_mm2 = 0.0;
        assert!(solve(&request)
            .unwrap_err()
            .contains("hechtend wapeningsoppervlak"));
        let mut request = tendon_only();
        request.cover_to_longitudinal_steel_mm = 0.0;
        assert!(solve(&request)
            .unwrap_err()
            .contains("coverToLongitudinalSteelMm"));
    }

    #[test]
    fn rejects_neutral_axis_at_or_beyond_tension_reinforcement() {
        let mut request = tendon_only();
        request.neutral_axis_mm = request.effective_depth_mm;
        assert!(solve(&request).unwrap_err().contains("vóór de trekstaal"));

        let mut request = tendon_only();
        request.neutral_axis_mm = request.effective_depth_mm + 1.0;
        assert!(solve(&request).unwrap_err().contains("vóór de trekstaal"));
    }
}
