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
    /// Optional ordered, contiguous span segments with their own elastic E.
    /// The section inertia is shared by all segments.
    #[serde(default)]
    pub stiffness_segments: Vec<StiffnessSegment>,
    pub tendon: TendonProfile,
    pub initial_force_kn: f64,
    #[serde(default)]
    pub loss_fraction: f64,
    #[serde(default)]
    pub transfer_uniform_downward_kn_per_m: f64,
    #[serde(default)]
    pub service_uniform_downward_kn_per_m: f64,
    /// Concentrated downward forces for the transfer stage.
    #[serde(default)]
    pub transfer_point_loads: Vec<PointLoad>,
    /// Concentrated downward forces for the service stage.
    #[serde(default)]
    pub service_point_loads: Vec<PointLoad>,
    /// Piecewise-linear downward load segments for the transfer stage.
    #[serde(default)]
    pub transfer_line_loads: Vec<LineLoadSegment>,
    /// Piecewise-linear downward load segments for the service stage.
    #[serde(default)]
    pub service_line_loads: Vec<LineLoadSegment>,
    /// Optional extra result sections along the span, in metres from the left support.
    #[serde(default)]
    pub stations_x_m: Vec<f64>,
    /// Optional EC2 concrete shear resistance without shear links. Both the
    /// cracked and uncracked branches are returned; the caller supplies the
    /// design parameters and determines which section state applies.
    #[serde(default)]
    pub shear_without_links: Option<ShearWithoutLinksInput>,
    /// Optional variable-angle truss design of vertical links at each station.
    /// Norm-dependent parameters, including cot(theta), are explicit inputs.
    #[serde(default)]
    pub shear_links: Option<ShearLinksInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StiffnessSegment {
    pub start_m: f64,
    pub end_m: f64,
    pub e_mpa: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PointLoad {
    /// Position from the left support, in metres; supports themselves are excluded.
    pub position_m: f64,
    /// Downward force in kN. Negative values represent uplift.
    pub downward_kn: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineLoadSegment {
    /// Start position from the left support, in metres.
    pub start_m: f64,
    /// End position from the left support, in metres; must exceed `startM`.
    pub end_m: f64,
    /// Downward load intensity at `startM`, in kN/m. Negative is uplift.
    pub start_downward_kn_per_m: f64,
    /// Downward load intensity at `endM`, in kN/m. Negative is uplift.
    pub end_downward_kn_per_m: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShearWithoutLinksInput {
    pub web_width_mm: f64,
    pub height_mm: f64,
    pub effective_depth_mm: f64,
    pub fctd_mpa: f64,
    pub v_min_mpa: f64,
    pub k1: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShearLinksInput {
    pub web_width_mm: f64,
    pub effective_depth_mm: f64,
    pub lever_arm_mm: f64,
    pub alpha_cw: f64,
    pub nu1: f64,
    pub fcd_mpa: f64,
    pub fywd_mpa: f64,
    /// Explicitly selected cot(theta), restricted to EC2's 1.0..=2.5 range.
    pub cot_theta: f64,
    /// Optional area of all vertical legs in one stirrup, mm².
    #[serde(default)]
    pub provided_asw_mm2: Option<f64>,
    /// Required together with providedAswMm2; actual link resistance is then checked.
    #[serde(default)]
    pub provided_spacing_mm: Option<f64>,
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
    /// Vertical reactions use the same downward-positive sign as external loads.
    pub external_left_reaction_kn: f64,
    pub external_right_reaction_kn: f64,
    /// Reactions including the equivalent vertical action of the tendon profile.
    pub left_reaction_kn: f64,
    pub right_reaction_kn: f64,
    pub prestress_midspan_moment_knm: f64,
    pub external_midspan_moment_knm: f64,
    pub end_stress: FibreStresses,
    pub midspan_stress: FibreStresses,
    pub axial_shortening_m: f64,
    pub prestress_camber_m: f64,
    pub external_midspan_deflection_m: f64,
    pub total_midspan_deflection_m: f64,
    /// Section forces, fibre stresses and deflection at supports and quarter points.
    pub stations: Vec<StationResult>,
    /// Exact candidate sections for extrema of moment, shear, fibre stress,
    /// and deflection. These include both supports, midspan, and any other
    /// internal zero of the deflection slope.
    pub critical_stations: Vec<StationResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StationResult {
    pub x_m: f64,
    pub tendon_eccentricity_m: f64,
    pub effective_e_mpa: f64,
    pub external_moment_knm: f64,
    pub prestress_moment_knm: f64,
    pub total_moment_knm: f64,
    /// Positive follows the derivative of the reported total moment along +x.
    /// At a point load this is the right-hand shear; both sides are returned below.
    pub shear_kn: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shear_before_point_load_kn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shear_after_point_load_kn: Option<f64>,
    pub fibre_stress: FibreStresses,
    pub prestress_deflection_m: f64,
    pub external_deflection_m: f64,
    pub total_deflection_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shear_resistance_without_links: Option<ShearWithoutLinksResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shear_links: Option<ShearLinksResult>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShearWithoutLinksResult {
    /// Average concrete compression stress from the effective tendon force, MPa.
    pub sigma_cp_mpa: f64,
    /// Absolute design shear from the elastic station response, kN.
    pub v_ed_kn: f64,
    /// EC2 prestressed-beam cracked-section branch, kN.
    pub v_rdc_cracked_kn: f64,
    /// EC2 prestressed-beam uncracked-section branch, kN.
    pub v_rdc_uncracked_kn: f64,
    pub utilization_cracked: f64,
    pub utilization_uncracked: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShearLinksResult {
    pub v_ed_kn: f64,
    pub cot_theta: f64,
    /// Required Asw/s from VRd,s = (Asw/s) z fywd cot(theta), mm²/mm.
    pub required_asw_per_spacing_mm2_per_mm: f64,
    pub v_rd_max_kn: f64,
    pub utilization_concrete_strut: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provided_asw_per_spacing_mm2_per_mm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maximum_spacing_for_provided_asw_mm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v_rd_s_kn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v_rd_kn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub utilization_provided_links: Option<f64>,
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

fn point_load_left_reaction(span: f64, loads: &[PointLoad]) -> f64 {
    loads
        .iter()
        .map(|load| load.downward_kn * (span - load.position_m) / span)
        .sum()
}

fn point_load_right_reaction(span: f64, loads: &[PointLoad]) -> f64 {
    loads
        .iter()
        .map(|load| load.downward_kn * load.position_m / span)
        .sum()
}

fn point_load_moment_at(span: f64, loads: &[PointLoad], x: f64) -> f64 {
    point_load_left_reaction(span, loads) * x
        - loads
            .iter()
            .filter(|load| load.position_m < x)
            .map(|load| load.downward_kn * (x - load.position_m))
            .sum::<f64>()
}

fn point_load_shear_at(span: f64, loads: &[PointLoad], x: f64, include_at_x: bool) -> f64 {
    point_load_left_reaction(span, loads)
        - loads
            .iter()
            .filter(|load| load.position_m < x || (include_at_x && load.position_m == x))
            .map(|load| load.downward_kn)
            .sum::<f64>()
}

fn segment_intensity(load: &LineLoadSegment, x: f64) -> f64 {
    let ratio = (x - load.start_m) / (load.end_m - load.start_m);
    load.start_downward_kn_per_m
        + ratio * (load.end_downward_kn_per_m - load.start_downward_kn_per_m)
}

fn line_load_resultants(load: &LineLoadSegment) -> (f64, f64) {
    let length = load.end_m - load.start_m;
    let resultant = length * (load.start_downward_kn_per_m + load.end_downward_kn_per_m) / 2.0;
    let moment_about_left = load.start_m * resultant
        + length.powi(2) * (load.start_downward_kn_per_m + 2.0 * load.end_downward_kn_per_m) / 6.0;
    (resultant, moment_about_left)
}

fn line_load_left_reaction(span: f64, loads: &[LineLoadSegment]) -> f64 {
    loads
        .iter()
        .map(|load| {
            let (resultant, moment) = line_load_resultants(load);
            resultant - moment / span
        })
        .sum()
}

fn line_load_right_reaction(span: f64, loads: &[LineLoadSegment]) -> f64 {
    loads
        .iter()
        .map(|load| line_load_resultants(load).1 / span)
        .sum()
}

fn line_load_moment_at(span: f64, loads: &[LineLoadSegment], x: f64) -> f64 {
    line_load_left_reaction(span, loads) * x
        - loads
            .iter()
            .filter(|load| x > load.start_m)
            .map(|load| {
                let end = x.min(load.end_m);
                let length = end - load.start_m;
                let slope = (load.end_downward_kn_per_m - load.start_downward_kn_per_m)
                    / (load.end_m - load.start_m);
                let arm = x - load.start_m;
                load.start_downward_kn_per_m * (arm * length - length.powi(2) / 2.0)
                    + slope * (arm * length.powi(2) / 2.0 - length.powi(3) / 3.0)
            })
            .sum::<f64>()
}

fn external_shear_at(
    span: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    x: f64,
    include_at_x: bool,
) -> f64 {
    uniform_load * (span / 2.0 - x)
        + point_load_shear_at(span, point_loads, x, include_at_x)
        + line_load_left_reaction(span, line_loads)
        - line_loads
            .iter()
            .filter(|load| load.start_m < x || (include_at_x && load.start_m == x))
            .map(|load| {
                let end = x.min(load.end_m);
                let length = (end - load.start_m).max(0.0);
                length * (load.start_downward_kn_per_m + segment_intensity(load, end)) / 2.0
            })
            .sum::<f64>()
}

fn effective_e_at(request: &Request, x: f64) -> f64 {
    request
        .stiffness_segments
        .iter()
        .find(|segment| x >= segment.start_m && x < segment.end_m)
        .or_else(|| {
            request
                .stiffness_segments
                .last()
                .filter(|segment| x == segment.end_m)
        })
        .map_or(request.section.e_mpa, |segment| segment.e_mpa)
}

fn axial_compliance(request: &Request) -> f64 {
    if request.stiffness_segments.is_empty() {
        request.span_m / (request.section.e_mpa * 1000.0)
    } else {
        request
            .stiffness_segments
            .iter()
            .map(|segment| (segment.end_m - segment.start_m) / (segment.e_mpa * 1000.0))
            .sum()
    }
}

fn span_breaks(
    request: &Request,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
) -> Vec<f64> {
    let mut positions = vec![0.0, request.span_m];
    positions.extend(point_loads.iter().map(|load| load.position_m));
    positions.extend(
        line_loads
            .iter()
            .flat_map(|load| [load.start_m, load.end_m]),
    );
    positions.extend(
        request
            .stiffness_segments
            .iter()
            .flat_map(|segment| [segment.start_m, segment.end_m]),
    );
    positions.sort_by(f64::total_cmp);
    positions.dedup_by(|left, right| (*left - *right).abs() <= request.span_m * 1e-12);
    positions
}

fn moment_component_at(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    x: f64,
    prestress: bool,
) -> f64 {
    if prestress {
        let (end_eccentricity, mid_eccentricity) = request.tendon.offsets();
        let ratio = x / request.span_m;
        -force
            * (end_eccentricity
                + 4.0 * (mid_eccentricity - end_eccentricity) * ratio * (1.0 - ratio))
    } else {
        uniform_load * x * (request.span_m - x) / 2.0
            + point_load_moment_at(request.span_m, point_loads, x)
            + line_load_moment_at(request.span_m, line_loads, x)
    }
}

/// Integrate M(s)/EI(s), optionally multiplied by (kernel_x-s). On each
/// interval divided by load/stiffness boundaries the integrand is polynomial
/// of degree at most four, so four-point Gauss-Legendre is exact to roundoff.
fn moment_over_ei_integral(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    upper: f64,
    kernel_x: Option<f64>,
    prestress: bool,
) -> f64 {
    const NODES: [f64; 4] = [
        -0.861_136_311_594_052_6,
        -0.339_981_043_584_856_3,
        0.339_981_043_584_856_3,
        0.861_136_311_594_052_6,
    ];
    const WEIGHTS: [f64; 4] = [
        0.347_854_845_137_453_8,
        0.652_145_154_862_546_1,
        0.652_145_154_862_546_1,
        0.347_854_845_137_453_8,
    ];
    let mut breaks = span_breaks(request, point_loads, line_loads);
    breaks.retain(|position| *position < upper);
    breaks.push(upper);
    let mut integral = 0.0;
    for interval in breaks.windows(2) {
        let left = interval[0];
        let right = interval[1];
        if right <= left {
            continue;
        }
        let midpoint = (left + right) * 0.5;
        let half_width = (right - left) * 0.5;
        for i in 0..4 {
            let position = midpoint + half_width * NODES[i];
            let kernel = kernel_x.map_or(1.0, |x| x - position);
            let ei = effective_e_at(request, position) * 1000.0 * request.section.inertia_m4;
            integral += half_width
                * WEIGHTS[i]
                * kernel
                * moment_component_at(
                    request,
                    force,
                    uniform_load,
                    point_loads,
                    line_loads,
                    position,
                    prestress,
                )
                / ei;
        }
    }
    integral
}

fn deflection_component_at(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    x: f64,
    prestress: bool,
) -> f64 {
    let span = request.span_m;
    let initial_slope_integral = moment_over_ei_integral(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        span,
        Some(span),
        prestress,
    );
    let partial_integral = moment_over_ei_integral(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        x,
        Some(x),
        prestress,
    );
    x / span * initial_slope_integral - partial_integral
}

fn station_at(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    x: f64,
) -> StationResult {
    let span = request.span_m;
    let section = &request.section;
    let (end_eccentricity, mid_eccentricity) = request.tendon.offsets();
    let drape = mid_eccentricity - end_eccentricity;
    let ratio = x / span;
    let eccentricity = end_eccentricity + 4.0 * drape * ratio * (1.0 - ratio);
    let external_moment = uniform_load * x * (span - x) / 2.0
        + point_load_moment_at(span, point_loads, x)
        + line_load_moment_at(span, line_loads, x);
    let prestress_moment = -force * eccentricity;
    let total_moment = external_moment + prestress_moment;
    let eccentricity_slope = 4.0 * drape / span * (1.0 - 2.0 * ratio);
    let shear = external_shear_at(span, uniform_load, point_loads, line_loads, x, true)
        - force * eccentricity_slope;
    let prestress_deflection = deflection_component_at(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        x,
        true,
    );
    let external_deflection = deflection_component_at(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        x,
        false,
    );
    let at_point_load = point_loads
        .iter()
        .any(|load| (load.position_m - x).abs() <= span * 1e-12);
    let shear_before_point_load_kn = at_point_load.then(|| {
        external_shear_at(span, uniform_load, point_loads, line_loads, x, false)
            - force * eccentricity_slope
    });
    let shear_after_point_load_kn = at_point_load.then_some(shear);
    StationResult {
        x_m: x,
        tendon_eccentricity_m: eccentricity,
        effective_e_mpa: effective_e_at(request, x),
        external_moment_knm: external_moment,
        prestress_moment_knm: prestress_moment,
        total_moment_knm: total_moment,
        shear_kn: shear,
        shear_before_point_load_kn,
        shear_after_point_load_kn,
        fibre_stress: fibre_stresses(section, force, eccentricity, external_moment),
        prestress_deflection_m: prestress_deflection,
        external_deflection_m: external_deflection,
        total_deflection_m: prestress_deflection + external_deflection,
        shear_resistance_without_links: None,
        shear_links: None,
    }
}

/// EC2 Worked Examples (2017), Example 6.3: cracked and uncracked
/// shear-resistance branches for a prestressed rectangular beam without links.
/// `sigma_cp` is derived from the effective tendon force and gross section area.
fn shear_without_links_at(
    input: &ShearWithoutLinksInput,
    section: &Section,
    force_kn: f64,
    v_ed_kn: f64,
) -> ShearWithoutLinksResult {
    let sigma_cp_mpa = force_kn / (section.area_m2 * 1000.0);
    let v_rdc_cracked_kn =
        (input.v_min_mpa + input.k1 * sigma_cp_mpa) * input.web_width_mm * input.effective_depth_mm
            / 1000.0;
    let inertia_mm4 = input.web_width_mm * input.height_mm.powi(3) / 12.0;
    let first_moment_mm3 = input.web_width_mm * input.height_mm.powi(2) / 8.0;
    let v_rdc_uncracked_kn = inertia_mm4 * input.web_width_mm / first_moment_mm3
        * (input.fctd_mpa.powi(2) + input.fctd_mpa * sigma_cp_mpa).sqrt()
        / 1000.0;
    ShearWithoutLinksResult {
        sigma_cp_mpa,
        v_ed_kn,
        v_rdc_cracked_kn,
        v_rdc_uncracked_kn,
        utilization_cracked: v_ed_kn / v_rdc_cracked_kn,
        utilization_uncracked: v_ed_kn / v_rdc_uncracked_kn,
    }
}

/// EC2 Worked Examples (2017), Example 6.4, equations 6.8 and 6.9 for vertical
/// links. The selected cot(theta) and prestress coefficient alpha_cw are
/// caller inputs so the solver does not assume a National Annex or stress state.
fn shear_links_at(input: &ShearLinksInput, v_ed_kn: f64) -> ShearLinksResult {
    let cot = input.cot_theta;
    let v_rd_max_kn =
        input.alpha_cw * input.web_width_mm * input.lever_arm_mm * input.nu1 * input.fcd_mpa
            / (cot + 1.0 / cot)
            / 1000.0;
    let required_asw_per_spacing = if v_ed_kn == 0.0 {
        0.0
    } else {
        v_ed_kn * 1000.0 / (input.lever_arm_mm * input.fywd_mpa * cot)
    };
    let provided_ratio = input
        .provided_asw_mm2
        .zip(input.provided_spacing_mm)
        .map(|(asw, spacing)| asw / spacing);
    let maximum_spacing = match (input.provided_asw_mm2, required_asw_per_spacing) {
        (Some(asw), required) if required > 0.0 => Some(asw / required),
        _ => None,
    };
    let v_rd_s =
        provided_ratio.map(|ratio| ratio * input.lever_arm_mm * input.fywd_mpa * cot / 1000.0);
    let v_rd = v_rd_s.map(|steel| steel.min(v_rd_max_kn));
    ShearLinksResult {
        v_ed_kn,
        cot_theta: cot,
        required_asw_per_spacing_mm2_per_mm: required_asw_per_spacing,
        v_rd_max_kn,
        utilization_concrete_strut: v_ed_kn / v_rd_max_kn,
        provided_asw_per_spacing_mm2_per_mm: provided_ratio,
        maximum_spacing_for_provided_asw_mm: maximum_spacing,
        v_rd_s_kn: v_rd_s,
        v_rd_kn: v_rd,
        utilization_provided_links: v_rd.map(|capacity| v_ed_kn / capacity),
    }
}

fn deflection_slope(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    x: f64,
) -> f64 {
    let span = request.span_m;
    let prestress_initial_slope = moment_over_ei_integral(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        span,
        Some(span),
        true,
    ) / span;
    let external_initial_slope = moment_over_ei_integral(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        span,
        Some(span),
        false,
    ) / span;
    let prestress_area = moment_over_ei_integral(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        x,
        None,
        true,
    );
    let external_area = moment_over_ei_integral(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        x,
        None,
        false,
    );
    prestress_initial_slope + external_initial_slope - prestress_area - external_area
}

fn deflection_slope_derivative(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
    x: f64,
) -> f64 {
    -station_at(request, force, uniform_load, point_loads, line_loads, x).total_moment_knm
}

/// Isolate every root of a polynomial of degree at most three on [left, right].
/// Values at four equally spaced points determine the cubic; its derivative
/// roots split the interval into monotone parts before bisection.
fn cubic_roots_on_interval(mut value: impl FnMut(f64) -> f64, left: f64, right: f64) -> Vec<f64> {
    let width = right - left;
    let y0 = value(left);
    let y1 = value(left + width / 3.0);
    let y2 = value(left + width * 2.0 / 3.0);
    let y3 = value(right);
    let first = y1 - y0;
    let second = y2 - 2.0 * y1 + y0;
    let third = y3 - 3.0 * y2 + 3.0 * y1 - y0;
    // Newton forward polynomial in u = 3(x-left)/(right-left).
    let a = third / 6.0;
    let b = (second - third) / 2.0;
    let c = first - second / 2.0 + third / 3.0;
    let coefficient_scale = a.abs().max(b.abs()).max(c.abs()).max(y0.abs()).max(1.0);
    let epsilon = coefficient_scale * 1e-13;
    let mut cuts = vec![left, right];
    if a.abs() <= epsilon {
        if b.abs() > epsilon {
            let u = -c / (2.0 * b);
            if u > 0.0 && u < 3.0 {
                cuts.push(left + width * u / 3.0);
            }
        }
    } else {
        let discriminant = 4.0 * b * b - 12.0 * a * c;
        if discriminant >= 0.0 {
            let root = discriminant.sqrt();
            for u in [(-2.0 * b - root) / (6.0 * a), (-2.0 * b + root) / (6.0 * a)] {
                if u > 0.0 && u < 3.0 {
                    cuts.push(left + width * u / 3.0);
                }
            }
        }
    }
    cuts.sort_by(f64::total_cmp);
    let value_tolerance = coefficient_scale * 1e-11;
    let mut roots = Vec::new();
    for &cut in &cuts {
        if cut > left && cut < right && value(cut).abs() <= value_tolerance {
            roots.push(cut);
        }
    }
    for pair in cuts.windows(2) {
        let (mut a_x, mut b_x) = (pair[0], pair[1]);
        let mut a_value = value(a_x);
        let b_value = value(b_x);
        if a_value.abs() <= value_tolerance || b_value.abs() <= value_tolerance {
            continue;
        }
        if a_value.signum() == b_value.signum() {
            continue;
        }
        for _ in 0..80 {
            let middle = 0.5 * (a_x + b_x);
            let middle_value = value(middle);
            if middle_value == 0.0 {
                a_x = middle;
                b_x = middle;
                break;
            }
            if a_value.signum() == middle_value.signum() {
                a_x = middle;
                a_value = middle_value;
            } else {
                b_x = middle;
            }
        }
        roots.push(0.5 * (a_x + b_x));
    }
    roots.sort_by(f64::total_cmp);
    roots.dedup_by(|a, b| (*a - *b).abs() <= width * 1e-12);
    roots
}

/// Find moment/shear extrema and deflection extrema. Piecewise-linear load
/// intervals produce cubic moment and quadratic shear polynomials.
fn critical_positions(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
) -> Vec<f64> {
    let span = request.span_m;
    let (end_eccentricity, mid_eccentricity) = request.tendon.offsets();
    let drape = mid_eccentricity - end_eccentricity;
    let mut positions = vec![0.0, span, span / 2.0];
    positions.extend(point_loads.iter().map(|load| load.position_m));
    positions.extend(
        line_loads
            .iter()
            .flat_map(|load| [load.start_m, load.end_m]),
    );
    positions.extend(
        request
            .stiffness_segments
            .iter()
            .flat_map(|segment| [segment.start_m, segment.end_m]),
    );
    let mut partitions = vec![0.0, span];
    partitions.extend(point_loads.iter().map(|load| load.position_m));
    partitions.extend(
        line_loads
            .iter()
            .flat_map(|load| [load.start_m, load.end_m]),
    );
    partitions.extend(
        request
            .stiffness_segments
            .iter()
            .flat_map(|segment| [segment.start_m, segment.end_m]),
    );
    partitions.sort_by(f64::total_cmp);
    partitions.dedup_by(|left, right| (*left - *right).abs() <= span * 1e-12);

    // Split at every zero of total moment. Within each resulting interval the
    // deflection slope is monotone, so its roots are safely bracketed.
    let load_intervals = partitions.clone();
    for interval in load_intervals.windows(2) {
        let left = interval[0];
        let right = interval[1];
        let middle = 0.5 * (left + right);
        let mut net_load = uniform_load - 8.0 * force * drape / span.powi(2);
        let mut net_load_slope = 0.0;
        for load in line_loads
            .iter()
            .filter(|load| middle > load.start_m && middle < load.end_m)
        {
            net_load += segment_intensity(load, middle);
            net_load_slope += (load.end_downward_kn_per_m - load.start_downward_kn_per_m)
                / (load.end_m - load.start_m);
        }
        // dV/dx = -q_net. Its zero is an extremum of shear and can govern
        // shear reinforcement when a line load changes sign within a segment.
        if net_load_slope.abs() > 1e-14 {
            let shear_extremum = middle - net_load / net_load_slope;
            if shear_extremum > left + span * 1e-12 && shear_extremum < right - span * 1e-12 {
                positions.push(shear_extremum);
            }
        }
        partitions.extend(cubic_roots_on_interval(
            |x| {
                deflection_slope_derivative(
                    request,
                    force,
                    uniform_load,
                    point_loads,
                    line_loads,
                    x,
                )
            },
            left,
            right,
        ));
        positions.extend(cubic_roots_on_interval(
            |x| {
                let eccentricity_slope = 4.0 * drape / span * (1.0 - 2.0 * x / span);
                external_shear_at(
                    span,
                    uniform_load,
                    point_loads,
                    line_loads,
                    x,
                    (right - x).abs() > span * 1e-12,
                ) - force * eccentricity_slope
            },
            left,
            right,
        ));
    }
    partitions.sort_by(f64::total_cmp);
    partitions.dedup_by(|left, right| (*left - *right).abs() <= span * 1e-12);

    let minimum_e = request
        .stiffness_segments
        .iter()
        .map(|segment| segment.e_mpa)
        .fold(request.section.e_mpa, f64::min);
    let ei_min = minimum_e * 1000.0 * request.section.inertia_m4;
    let slope_scale = (uniform_load.abs()
        + force * (end_eccentricity.abs() + drape.abs()) / span.powi(2))
        * span.powi(3)
        / ei_min
        + point_loads
            .iter()
            .map(|load| load.downward_kn.abs() * span.powi(2) / ei_min)
            .sum::<f64>()
        + line_loads
            .iter()
            .map(|load| {
                load.start_downward_kn_per_m
                    .abs()
                    .max(load.end_downward_kn_per_m.abs())
                    * span.powi(3)
                    / ei_min
            })
            .sum::<f64>();
    let tolerance = slope_scale.max(1.0) * 1e-12;
    for &x in &partitions {
        if deflection_slope(request, force, uniform_load, point_loads, line_loads, x).abs()
            <= tolerance
        {
            positions.push(x);
        }
    }
    for interval in partitions.windows(2) {
        let mut left = interval[0];
        let mut f_left =
            deflection_slope(request, force, uniform_load, point_loads, line_loads, left);
        let mut right = interval[1];
        let f_right =
            deflection_slope(request, force, uniform_load, point_loads, line_loads, right);
        if f_left.abs() <= tolerance {
            positions.push(left);
        }
        if f_right.abs() <= tolerance {
            positions.push(right);
        } else if f_left.signum() != f_right.signum() {
            for _ in 0..80 {
                let middle = 0.5 * (left + right);
                let f_middle = deflection_slope(
                    request,
                    force,
                    uniform_load,
                    point_loads,
                    line_loads,
                    middle,
                );
                if f_middle == 0.0 {
                    left = middle;
                    right = middle;
                    break;
                }
                if f_left.signum() == f_middle.signum() {
                    left = middle;
                    f_left = f_middle;
                } else {
                    right = middle;
                }
            }
            positions.push(0.5 * (left + right));
        }
    }

    positions.sort_by(f64::total_cmp);
    positions.dedup_by(|left, right| (*left - *right).abs() <= span * 1e-10);
    positions
}

fn stage(
    request: &Request,
    force: f64,
    uniform_load: f64,
    point_loads: &[PointLoad],
    line_loads: &[LineLoadSegment],
) -> StageResult {
    let span = request.span_m;
    let section = &request.section;
    let (end_eccentricity, mid_eccentricity) = request.tendon.offsets();
    let drape = mid_eccentricity - end_eccentricity;
    let midspan_moment = uniform_load * span * span / 8.0
        + point_load_moment_at(span, point_loads, span / 2.0)
        + line_load_moment_at(span, line_loads, span / 2.0);
    // Constant eccentricity is an applied end moment. The parabolic part is
    // equivalent to an upward uniform load and equal/opposite end shears.
    let equivalent_load = 8.0 * force * drape / (span * span);
    let external_left_reaction = uniform_load * span / 2.0
        + point_load_left_reaction(span, point_loads)
        + line_load_left_reaction(span, line_loads);
    let external_right_reaction = uniform_load * span / 2.0
        + point_load_right_reaction(span, point_loads)
        + line_load_right_reaction(span, line_loads);
    let prestress_support_reaction = -4.0 * force * drape / span;
    let prestress_camber = deflection_component_at(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        span / 2.0,
        true,
    );
    let external_deflection = deflection_component_at(
        request,
        force,
        uniform_load,
        point_loads,
        line_loads,
        span / 2.0,
        false,
    );
    let station_positions = if request.stations_x_m.is_empty() {
        vec![0.0, 0.25 * span, 0.5 * span, 0.75 * span, span]
    } else {
        let mut positions = request.stations_x_m.clone();
        positions.push(0.0);
        positions.push(span);
        positions.sort_by(|a, b| a.partial_cmp(b).expect("station positions were validated"));
        positions.dedup_by(|a, b| *a == *b);
        positions
    };
    let mut stations: Vec<StationResult> = station_positions
        .into_iter()
        .map(|x| station_at(request, force, uniform_load, point_loads, line_loads, x))
        .collect();
    let mut critical_stations: Vec<StationResult> =
        critical_positions(request, force, uniform_load, point_loads, line_loads)
            .into_iter()
            .map(|x| station_at(request, force, uniform_load, point_loads, line_loads, x))
            .collect();
    if request.shear_without_links.is_some() || request.shear_links.is_some() {
        for station in stations.iter_mut().chain(critical_stations.iter_mut()) {
            let design_shear_kn = station
                .shear_before_point_load_kn
                .into_iter()
                .chain(station.shear_after_point_load_kn)
                .chain(std::iter::once(station.shear_kn))
                .map(f64::abs)
                .fold(0.0, f64::max);
            if let Some(shear_input) = &request.shear_without_links {
                station.shear_resistance_without_links = Some(shear_without_links_at(
                    shear_input,
                    section,
                    force,
                    design_shear_kn,
                ));
            }
            if let Some(links) = &request.shear_links {
                station.shear_links = Some(shear_links_at(links, design_shear_kn));
            }
        }
    }
    StageResult {
        force_kn: force,
        end_eccentricity_m: end_eccentricity,
        mid_eccentricity_m: mid_eccentricity,
        equivalent_uniform_upward_kn_per_m: equivalent_load,
        end_moment_knm: force * end_eccentricity,
        end_vertical_force_magnitude_kn: (4.0 * force * drape / span).abs(),
        external_left_reaction_kn: external_left_reaction,
        external_right_reaction_kn: external_right_reaction,
        left_reaction_kn: external_left_reaction + prestress_support_reaction,
        right_reaction_kn: external_right_reaction + prestress_support_reaction,
        prestress_midspan_moment_knm: -force * mid_eccentricity,
        external_midspan_moment_knm: midspan_moment,
        end_stress: fibre_stresses(section, force, end_eccentricity, 0.0),
        midspan_stress: fibre_stresses(section, force, mid_eccentricity, midspan_moment),
        axial_shortening_m: -force * axial_compliance(request) / section.area_m2,
        prestress_camber_m: prestress_camber,
        external_midspan_deflection_m: external_deflection,
        total_midspan_deflection_m: prestress_camber + external_deflection,
        stations,
        critical_stations,
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
    if !request.stiffness_segments.is_empty() {
        let tolerance = request.span_m * 1e-12;
        for (index, segment) in request.stiffness_segments.iter().enumerate() {
            if !segment.start_m.is_finite()
                || !segment.end_m.is_finite()
                || segment.start_m < 0.0
                || segment.end_m > request.span_m
                || segment.start_m >= segment.end_m
            {
                return Err(format!(
                    "stiffnessSegments[{index}] must have finite bounds with 0 <= startM < endM <= spanM"
                ));
            }
            positive(segment.e_mpa, &format!("stiffnessSegments[{index}].eMpa"))?;
            if index == 0 && segment.start_m.abs() > tolerance {
                return Err("stiffnessSegments must start at x=0 and cover the full span".into());
            }
            if index > 0
                && (segment.start_m - request.stiffness_segments[index - 1].end_m).abs() > tolerance
            {
                return Err(
                    "stiffnessSegments must be ordered, contiguous and non-overlapping".into(),
                );
            }
        }
        if (request.stiffness_segments.last().unwrap().end_m - request.span_m).abs() > tolerance {
            return Err("stiffnessSegments must cover the full span through x=spanM".into());
        }
    }
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
    if let Some(shear) = &request.shear_without_links {
        for (name, value) in [
            ("shearWithoutLinks.webWidthMm", shear.web_width_mm),
            ("shearWithoutLinks.heightMm", shear.height_mm),
            (
                "shearWithoutLinks.effectiveDepthMm",
                shear.effective_depth_mm,
            ),
            ("shearWithoutLinks.fctdMpa", shear.fctd_mpa),
            ("shearWithoutLinks.vMinMpa", shear.v_min_mpa),
        ] {
            positive(value, name)?;
        }
        if shear.effective_depth_mm >= shear.height_mm {
            return Err("shearWithoutLinks.effectiveDepthMm must be less than heightMm".into());
        }
        if !shear.k1.is_finite() || shear.k1 < 0.0 {
            return Err("shearWithoutLinks.k1 must be finite and nonnegative".into());
        }
    }
    if let Some(links) = &request.shear_links {
        for (name, value) in [
            ("shearLinks.webWidthMm", links.web_width_mm),
            ("shearLinks.effectiveDepthMm", links.effective_depth_mm),
            ("shearLinks.leverArmMm", links.lever_arm_mm),
            ("shearLinks.alphaCw", links.alpha_cw),
            ("shearLinks.nu1", links.nu1),
            ("shearLinks.fcdMpa", links.fcd_mpa),
            ("shearLinks.fywdMpa", links.fywd_mpa),
        ] {
            positive(value, name)?;
        }
        let total_depth_mm =
            (request.section.top_fibre_m + request.section.bottom_fibre_m) * 1000.0;
        if links.effective_depth_mm >= total_depth_mm
            || links.lever_arm_mm > links.effective_depth_mm
        {
            return Err(
                "shearLinks effective depth and lever arm must fit within the section depth".into(),
            );
        }
        if links.nu1 > 1.0 {
            return Err("shearLinks.nu1 must not exceed 1".into());
        }
        if !links.cot_theta.is_finite() || !(1.0..=2.5).contains(&links.cot_theta) {
            return Err("shearLinks.cotTheta must lie between 1.0 and 2.5".into());
        }
        match (links.provided_asw_mm2, links.provided_spacing_mm) {
            (Some(asw), Some(spacing)) => {
                positive(asw, "shearLinks.providedAswMm2")?;
                positive(spacing, "shearLinks.providedSpacingMm")?;
            }
            (None, None) => {}
            _ => {
                return Err(
                    "shearLinks.providedAswMm2 and providedSpacingMm must be supplied together"
                        .into(),
                )
            }
        }
    }
    let (end, mid) = request.tendon.offsets();
    if !end.is_finite() || !mid.is_finite() {
        return Err("tendon eccentricities must be finite".into());
    }
    for (index, x) in request.stations_x_m.iter().copied().enumerate() {
        if !x.is_finite() || x < 0.0 || x > request.span_m {
            return Err(format!(
                "stationsXM[{index}] must be finite and lie between 0 and spanM"
            ));
        }
    }
    for (stage_name, loads) in [
        ("transferPointLoads", &request.transfer_point_loads),
        ("servicePointLoads", &request.service_point_loads),
    ] {
        for (index, load) in loads.iter().enumerate() {
            if !load.position_m.is_finite()
                || load.position_m <= 0.0
                || load.position_m >= request.span_m
            {
                return Err(format!(
                    "{stage_name}[{index}].positionM must lie strictly between the supports"
                ));
            }
            if !load.downward_kn.is_finite() {
                return Err(format!("{stage_name}[{index}].downwardKn must be finite"));
            }
        }
    }
    for (stage_name, loads) in [
        ("transferLineLoads", &request.transfer_line_loads),
        ("serviceLineLoads", &request.service_line_loads),
    ] {
        for (index, load) in loads.iter().enumerate() {
            if !load.start_m.is_finite()
                || !load.end_m.is_finite()
                || load.start_m < 0.0
                || load.end_m > request.span_m
                || load.start_m >= load.end_m
            {
                return Err(format!(
                    "{stage_name}[{index}] must have finite bounds with 0 <= startM < endM <= spanM"
                ));
            }
            if !load.start_downward_kn_per_m.is_finite() || !load.end_downward_kn_per_m.is_finite()
            {
                return Err(format!(
                    "{stage_name}[{index}] load intensities must be finite"
                ));
            }
        }
    }
    Ok(ResultBeam {
        transfer: stage(
            request,
            request.initial_force_kn,
            request.transfer_uniform_downward_kn_per_m,
            &request.transfer_point_loads,
            &request.transfer_line_loads,
        ),
        service: stage(
            request,
            request.initial_force_kn * (1.0 - request.loss_fraction),
            request.service_uniform_downward_kn_per_m,
            &request.service_point_loads,
            &request.service_line_loads,
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

    #[test]
    fn piecewise_modulus_matches_independent_simpson_reference() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.service_uniform_downward_kn_per_m = 10.0;
        request.stiffness_segments = vec![
            StiffnessSegment {
                start_m: 0.0,
                end_m: 5.0,
                e_mpa: 30_000.0,
            },
            StiffnessSegment {
                start_m: 5.0,
                end_m: 10.0,
                e_mpa: 15_000.0,
            },
        ];

        let result = solve(&request).unwrap();
        close(result.service.external_left_reaction_kn, 50.0, 1e-12);
        close(result.service.external_right_reaction_kn, 50.0, 1e-12);
        close(result.service.external_midspan_moment_knm, 125.0, 1e-12);
        let midspan = result
            .service
            .stations
            .iter()
            .find(|station| station.x_m == 5.0)
            .unwrap();
        close(midspan.effective_e_mpa, 15_000.0, 1e-12);

        // Independent composite Simpson integration of the Green-function
        // expression, with 10,000 equal subintervals on each E segment.
        fn simpson<F: Fn(f64) -> f64>(start: f64, end: f64, intervals: usize, f: F) -> f64 {
            let step = (end - start) / intervals as f64;
            let mut sum = f(start) + f(end);
            for index in 1..intervals {
                sum += if index % 2 == 0 { 2.0 } else { 4.0 } * f(start + index as f64 * step);
            }
            sum * step / 3.0
        }
        let moment = |x: f64| 50.0 * x - 5.0 * x * x;
        let m_over_ei =
            |x: f64, e_mpa: f64| moment(x) / (e_mpa * 1000.0 * request.section.inertia_m4);
        let global_integral = simpson(0.0, 5.0, 10_000, |s| (10.0 - s) * m_over_ei(s, 30_000.0))
            + simpson(5.0, 10.0, 10_000, |s| (10.0 - s) * m_over_ei(s, 15_000.0));
        let local_integral = simpson(0.0, 5.0, 10_000, |s| (5.0 - s) * m_over_ei(s, 30_000.0));
        let reference_midspan_deflection = 0.5 * global_integral - local_integral;
        close(
            result.service.external_midspan_deflection_m,
            reference_midspan_deflection,
            1e-12,
        );
        close(
            result.service.axial_shortening_m,
            -800.0 * (5.0 / 30_000_000.0 + 5.0 / 15_000_000.0) / 0.5,
            1e-14,
        );
    }

    #[test]
    fn rejects_incomplete_or_discontinuous_modulus_segments() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.stiffness_segments = vec![StiffnessSegment {
            start_m: 0.0,
            end_m: 4.0,
            e_mpa: 30_000.0,
        }];
        assert!(solve(&request).unwrap_err().contains("full span"));

        request.stiffness_segments = vec![
            StiffnessSegment {
                start_m: 0.0,
                end_m: 4.0,
                e_mpa: 30_000.0,
            },
            StiffnessSegment {
                start_m: 5.0,
                end_m: 10.0,
                e_mpa: 15_000.0,
            },
        ];
        assert!(solve(&request).unwrap_err().contains("contiguous"));
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
            stiffness_segments: vec![],
            tendon: profile,
            initial_force_kn: 1000.0,
            loss_fraction: 0.2,
            transfer_uniform_downward_kn_per_m: 0.0,
            service_uniform_downward_kn_per_m: 16.0,
            transfer_point_loads: vec![],
            service_point_loads: vec![],
            transfer_line_loads: vec![],
            service_line_loads: vec![],
            stations_x_m: vec![],
            shear_without_links: None,
            shear_links: None,
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
        let mid = &result.service.stations[2];
        close(mid.x_m, 5.0, 1e-14);
        close(mid.tendon_eccentricity_m, 0.2, 1e-14);
        close(
            mid.external_moment_knm,
            result.service.external_midspan_moment_knm,
            1e-12,
        );
        close(
            mid.prestress_moment_knm,
            result.service.prestress_midspan_moment_knm,
            1e-12,
        );
        close(
            mid.total_moment_knm,
            mid.external_moment_knm + mid.prestress_moment_knm,
            1e-12,
        );
        close(
            mid.fibre_stress.top_mpa,
            result.service.midspan_stress.top_mpa,
            1e-12,
        );
        close(
            mid.fibre_stress.bottom_mpa,
            result.service.midspan_stress.bottom_mpa,
            1e-12,
        );
        close(
            mid.total_deflection_m,
            result.service.total_midspan_deflection_m,
            1e-14,
        );
        close(mid.shear_kn, 0.0, 1e-12);
        close(result.service.stations[0].total_deflection_m, 0.0, 1e-14);
        close(result.service.stations[4].total_deflection_m, 0.0, 1e-14);
        close(result.service.external_left_reaction_kn, 80.0, 1e-12);
        close(result.service.external_right_reaction_kn, 80.0, 1e-12);
        close(result.service.left_reaction_kn, 16.0, 1e-12);
        close(result.service.right_reaction_kn, 16.0, 1e-12);
        close(result.transfer.left_reaction_kn, -80.0, 1e-12);
        close(result.transfer.right_reaction_kn, -80.0, 1e-12);
        close(result.service.stations[1].shear_kn, 8.0, 1e-12);
        close(result.service.stations[3].shear_kn, -8.0, 1e-12);
        close(result.service.stations[0].shear_kn, 16.0, 1e-12);
        close(result.service.stations[4].shear_kn, -16.0, 1e-12);
        assert_eq!(
            result
                .service
                .critical_stations
                .iter()
                .map(|station| station.x_m)
                .collect::<Vec<_>>(),
            vec![0.0, 5.0, 10.0]
        );
    }

    #[test]
    fn service_point_load_matches_closed_form_and_reports_both_shear_sides() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.service_uniform_downward_kn_per_m = 0.0;
        request.transfer_uniform_downward_kn_per_m = 0.0;
        request.service_point_loads = vec![PointLoad {
            position_m: 5.0,
            downward_kn: 12.0,
        }];
        request.stations_x_m = vec![5.0];

        let result = solve(&request).unwrap();
        let service = &result.service;
        let middle = service
            .stations
            .iter()
            .find(|station| station.x_m == 5.0)
            .unwrap();
        close(middle.external_moment_knm, 30.0, 1e-12);
        close(middle.shear_before_point_load_kn.unwrap(), 6.0, 1e-12);
        close(middle.shear_after_point_load_kn.unwrap(), -6.0, 1e-12);
        close(middle.shear_kn, -6.0, 1e-12);
        close(service.external_midspan_moment_knm, 30.0, 1e-12);
        close(service.external_midspan_deflection_m, 1.0 / 2400.0, 1e-14);
        close(service.total_midspan_deflection_m, 1.0 / 2400.0, 1e-14);
        close(service.external_left_reaction_kn, 6.0, 1e-12);
        close(service.external_right_reaction_kn, 6.0, 1e-12);
        close(
            service.left_reaction_kn + service.right_reaction_kn,
            12.0,
            1e-12,
        );
        assert_eq!(
            service
                .critical_stations
                .iter()
                .map(|station| station.x_m)
                .collect::<Vec<_>>(),
            vec![0.0, 5.0, 10.0]
        );
        close(service.stations[0].shear_kn, 6.0, 1e-12);
        close(service.stations.last().unwrap().shear_kn, -6.0, 1e-12);
        close(result.transfer.external_midspan_moment_knm, 0.0, 1e-12);
    }

    #[test]
    fn partial_ramp_load_matches_independent_resultants_and_deflection_integral() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.service_uniform_downward_kn_per_m = 0.0;
        request.service_line_loads = vec![LineLoadSegment {
            start_m: 2.0,
            end_m: 7.0,
            start_downward_kn_per_m: 0.0,
            end_downward_kn_per_m: 20.0,
        }];
        request.stations_x_m = vec![2.0, 5.0, 7.0];

        let result = solve(&request).unwrap();
        let service = &result.service;
        let at = |x: f64| {
            service
                .stations
                .iter()
                .find(|station| (station.x_m - x).abs() < 1e-12)
                .unwrap()
        };
        // Triangle resultant = 50 kN at x=16/3 m: RA=70/3, RB=80/3 kN.
        close(at(2.0).shear_kn, 70.0 / 3.0, 1e-12);
        close(service.external_left_reaction_kn, 70.0 / 3.0, 1e-12);
        close(service.external_right_reaction_kn, 80.0 / 3.0, 1e-12);
        close(
            service.left_reaction_kn + service.right_reaction_kn,
            50.0,
            1e-12,
        );
        close(at(5.0).external_moment_knm, 296.0 / 3.0, 1e-12);
        close(at(5.0).shear_kn, 16.0 / 3.0, 1e-12);
        close(at(7.0).shear_kn, -80.0 / 3.0, 1e-12);
        close(service.external_midspan_moment_knm, 296.0 / 3.0, 1e-12);
        // Independent integration of q(s) times the simply-supported point-load
        // Green function gives this exact midspan value for EI=600000 kNm².
        close(
            service.external_midspan_deflection_m,
            0.001_596_833_333_333_333_4,
            1e-14,
        );

        // Critical candidates must bound a dense independent response sample.
        let sampled: Vec<_> = (0..=20_000)
            .map(|index| {
                station_at(
                    &request,
                    request.initial_force_kn,
                    0.0,
                    &[],
                    &request.service_line_loads,
                    10.0 * index as f64 / 20_000.0,
                )
            })
            .collect();
        let sampled_peak = sampled
            .iter()
            .map(|station| station.total_deflection_m)
            .fold(f64::NEG_INFINITY, f64::max);
        let critical_peak = service
            .critical_stations
            .iter()
            .map(|station| station.total_deflection_m)
            .fold(f64::NEG_INFINITY, f64::max);
        close(critical_peak, sampled_peak, 1e-8);
    }

    #[test]
    fn rejects_invalid_partial_line_load_bounds_or_intensities() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        for load in [
            LineLoadSegment {
                start_m: 4.0,
                end_m: 4.0,
                start_downward_kn_per_m: 1.0,
                end_downward_kn_per_m: 1.0,
            },
            LineLoadSegment {
                start_m: -0.1,
                end_m: 4.0,
                start_downward_kn_per_m: 1.0,
                end_downward_kn_per_m: 1.0,
            },
            LineLoadSegment {
                start_m: 4.0,
                end_m: 11.0,
                start_downward_kn_per_m: 1.0,
                end_downward_kn_per_m: 1.0,
            },
            LineLoadSegment {
                start_m: 1.0,
                end_m: 4.0,
                start_downward_kn_per_m: f64::NAN,
                end_downward_kn_per_m: 1.0,
            },
        ] {
            request.service_line_loads = vec![load];
            assert!(solve(&request).is_err());
        }
    }

    #[test]
    fn shear_envelope_finds_internal_extremum_when_partial_load_changes_sign() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.service_uniform_downward_kn_per_m = 0.0;
        request.service_line_loads = vec![LineLoadSegment {
            start_m: 2.0,
            end_m: 8.0,
            start_downward_kn_per_m: -20.0,
            end_downward_kn_per_m: 20.0,
        }];
        request.shear_links = Some(ShearLinksInput {
            web_width_mm: 200.0,
            effective_depth_mm: 500.0,
            lever_arm_mm: 450.0,
            alpha_cw: 1.0,
            nu1: 0.6,
            fcd_mpa: 30.0,
            fywd_mpa: 500.0,
            cot_theta: 1.5,
            provided_asw_mm2: None,
            provided_spacing_mm: None,
        });

        let result = solve(&request).unwrap();
        close(result.service.external_left_reaction_kn, -12.0, 1e-12);
        close(result.service.external_right_reaction_kn, 12.0, 1e-12);
        let governing = result
            .service
            .critical_stations
            .iter()
            .find(|station| (station.x_m - 5.0).abs() < 1e-10)
            .expect("q(x)=0 at x=5 m is the internal shear extremum");
        close(governing.shear_kn, 18.0, 1e-10);
        close(governing.shear_links.as_ref().unwrap().v_ed_kn, 18.0, 1e-10);
    }

    #[test]
    fn point_load_shear_design_uses_the_more_demanding_side_of_the_jump() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.service_uniform_downward_kn_per_m = 0.0;
        request.service_point_loads = vec![PointLoad {
            position_m: 4.0,
            downward_kn: 10.0,
        }];
        request.shear_links = Some(ShearLinksInput {
            web_width_mm: 200.0,
            effective_depth_mm: 500.0,
            lever_arm_mm: 450.0,
            alpha_cw: 1.0,
            nu1: 0.6,
            fcd_mpa: 30.0,
            fywd_mpa: 500.0,
            cot_theta: 1.5,
            provided_asw_mm2: None,
            provided_spacing_mm: None,
        });

        let result = solve(&request).unwrap();
        let station = result
            .service
            .critical_stations
            .iter()
            .find(|station| station.x_m == 4.0)
            .unwrap();
        close(station.shear_before_point_load_kn.unwrap(), 6.0, 1e-12);
        close(station.shear_after_point_load_kn.unwrap(), -4.0, 1e-12);
        close(station.shear_links.as_ref().unwrap().v_ed_kn, 6.0, 1e-12);
    }

    #[test]
    fn rejects_point_load_at_support_or_nonfinite_force() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.service_point_loads.push(PointLoad {
            position_m: 0.0,
            downward_kn: 1.0,
        });
        assert!(solve(&request)
            .unwrap_err()
            .contains("strictly between the supports"));

        request.service_point_loads[0].position_m = 5.0;
        request.service_point_loads[0].downward_kn = f64::NAN;
        assert!(solve(&request).unwrap_err().contains("must be finite"));
    }

    #[test]
    fn critical_stations_find_off_midspan_deflection_extrema() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.15,
        });
        request.loss_fraction = 0.0;
        request.service_uniform_downward_kn_per_m = 16.0;
        let service = solve(&request).unwrap().service;
        let positions: Vec<f64> = service
            .critical_stations
            .iter()
            .map(|station| station.x_m)
            .collect();

        // For this load and straight tendon, the slope has three internal
        // roots: r=(1±sqrt(0.75))/2 and r=0.5. A fixed quarter-point grid
        // misses both off-centre extrema.
        let expected = [
            0.0,
            5.0 * (1.0 - 0.75_f64.sqrt()),
            5.0,
            5.0 * (1.0 + 0.75_f64.sqrt()),
            10.0,
        ];
        assert_eq!(positions.len(), expected.len(), "{positions:?}");
        for (actual, expected) in positions.iter().zip(expected) {
            close(*actual, expected, 1e-9);
        }

        // Compare the reported candidates with an independent dense scan of
        // the closed-form section response for every result quantity.
        let sampled: Vec<_> = (0..=20_000)
            .map(|index| {
                station_at(
                    &request,
                    request.initial_force_kn,
                    16.0,
                    &[],
                    &[],
                    10.0 * index as f64 / 20_000.0,
                )
            })
            .collect();
        let dense_max = |value: fn(&StationResult) -> f64| {
            sampled.iter().map(value).fold(f64::NEG_INFINITY, f64::max)
        };
        let critical_max = |value: fn(&StationResult) -> f64| {
            service
                .critical_stations
                .iter()
                .map(value)
                .fold(f64::NEG_INFINITY, f64::max)
        };
        for value in [
            (|station: &StationResult| station.total_moment_knm) as fn(&StationResult) -> f64,
            |station: &StationResult| station.shear_kn.abs(),
            |station: &StationResult| station.fibre_stress.top_mpa,
            |station: &StationResult| station.fibre_stress.bottom_mpa,
            |station: &StationResult| station.total_deflection_m,
            |station: &StationResult| -station.total_deflection_m,
        ] {
            close(critical_max(value), dense_max(value), 1e-7);
        }
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
            stiffness_segments: vec![],
            tendon: TendonProfile::Straight {
                eccentricity_m: 31.005 * IN_M,
            },
            initial_force_kn: 924.4 * KIP_KN,
            loss_fraction: 0.0,
            transfer_uniform_downward_kn_per_m: 0.0,
            service_uniform_downward_kn_per_m: 0.0,
            transfer_point_loads: vec![],
            service_point_loads: vec![],
            transfer_line_loads: vec![],
            service_line_loads: vec![],
            stations_x_m: vec![],
            shear_without_links: None,
            shear_links: None,
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
    fn prestressed_shear_resistance_matches_ec2_worked_example_6_3() {
        // European Concrete Platform, EC2 Worked Examples (2017), Example 6.3.
        // Rectangular 100x200 mm section, d=175 mm, sigma_cp=5 MPa, fctd=1.66 MPa.
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.initial_force_kn = 100.0;
        request.loss_fraction = 0.0;
        request.section.area_m2 = 0.02;
        request.service_uniform_downward_kn_per_m = 0.0;
        request.shear_without_links = Some(ShearWithoutLinksInput {
            web_width_mm: 100.0,
            height_mm: 200.0,
            effective_depth_mm: 175.0,
            fctd_mpa: 1.66,
            v_min_mpa: 0.626,
            k1: 0.15,
        });

        let result = solve(&request).unwrap();
        let shear = result.service.stations[0]
            .shear_resistance_without_links
            .as_ref()
            .unwrap();
        close(shear.sigma_cp_mpa, 5.0, 1e-12);
        close(shear.v_rdc_cracked_kn, 24.08, 1e-12);
        close(shear.v_rdc_uncracked_kn, 44.33, 0.02);
        close(shear.v_ed_kn, 0.0, 1e-12);
        close(shear.utilization_cracked, 0.0, 1e-12);
        close(shear.utilization_uncracked, 0.0, 1e-12);
        assert!(result
            .transfer
            .stations
            .iter()
            .all(|station| { station.shear_resistance_without_links.is_some() }));
    }

    #[test]
    fn rejects_invalid_prestressed_shear_geometry() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.shear_without_links = Some(ShearWithoutLinksInput {
            web_width_mm: 100.0,
            height_mm: 200.0,
            effective_depth_mm: 200.0,
            fctd_mpa: 1.66,
            v_min_mpa: 0.626,
            k1: 0.15,
        });
        assert!(solve(&request)
            .unwrap_err()
            .contains("effectiveDepthMm must be less than heightMm"));
    }

    #[test]
    fn ec2_vertical_link_design_matches_worked_example_6_4() {
        // European Concrete Platform, EC2 Worked Examples (2017), Example 6.4:
        // VEd=600 kN, bw=200, z=675, fyd=391 MPa, cot(theta)=1.8.
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.span_m = 6.0;
        request.initial_force_kn = 0.001;
        request.section.area_m2 = 0.16;
        request.section.inertia_m4 = 0.008533333333333334;
        request.section.top_fibre_m = 0.4;
        request.section.bottom_fibre_m = 0.4;
        request.service_uniform_downward_kn_per_m = 200.0;
        request.shear_links = Some(ShearLinksInput {
            web_width_mm: 200.0,
            effective_depth_mm: 750.0,
            lever_arm_mm: 675.0,
            alpha_cw: 1.0,
            nu1: 0.616,
            fcd_mpa: 17.0,
            fywd_mpa: 391.0,
            cot_theta: 1.8,
            provided_asw_mm2: Some(226.0),
            provided_spacing_mm: Some(170.0),
        });

        let result = solve(&request).unwrap();
        let shear = result.service.stations[0].shear_links.as_ref().unwrap();
        close(shear.v_ed_kn, 600.0, 1e-12);
        close(shear.required_asw_per_spacing_mm2_per_mm, 1.263, 0.001);
        close(shear.v_rd_max_kn, 600.0, 0.2);
        close(
            shear.provided_asw_per_spacing_mm2_per_mm.unwrap(),
            226.0 / 170.0,
            1e-12,
        );
        assert!(shear.maximum_spacing_for_provided_asw_mm.unwrap() > 170.0);
        assert!(shear.v_rd_s_kn.unwrap() > 600.0);
        assert!(shear.v_rd_kn.unwrap() <= shear.v_rd_max_kn);
        assert!(shear.utilization_provided_links.unwrap() > 0.99);
    }

    #[test]
    fn rejects_invalid_truss_angle_and_incomplete_provided_links() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.0,
        });
        request.section.top_fibre_m = 0.4;
        request.section.bottom_fibre_m = 0.4;
        request.shear_links = Some(ShearLinksInput {
            web_width_mm: 200.0,
            effective_depth_mm: 750.0,
            lever_arm_mm: 675.0,
            alpha_cw: 1.0,
            nu1: 0.616,
            fcd_mpa: 17.0,
            fywd_mpa: 391.0,
            cot_theta: 2.6,
            provided_asw_mm2: None,
            provided_spacing_mm: None,
        });
        assert!(solve(&request)
            .unwrap_err()
            .contains("cotTheta must lie between 1.0 and 2.5"));
        request.shear_links.as_mut().unwrap().cot_theta = 1.8;
        request.shear_links.as_mut().unwrap().provided_asw_mm2 = Some(226.0);
        assert!(solve(&request)
            .unwrap_err()
            .contains("must be supplied together"));
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
    fn requested_stations_are_sorted_deduplicated_and_include_supports() {
        let mut request = baseline(TendonProfile::Parabolic {
            end_eccentricity_m: 0.0,
            mid_eccentricity_m: 0.2,
        });
        request.stations_x_m = vec![5.0, 2.5, 2.5, 4.25];
        let result = solve(&request).unwrap();
        let positions: Vec<f64> = result
            .service
            .stations
            .iter()
            .map(|station| station.x_m)
            .collect();
        assert_eq!(positions, vec![0.0, 2.5, 4.25, 5.0, 10.0]);
    }

    #[test]
    fn rejects_requested_stations_outside_span_or_nonfinite() {
        let mut request = baseline(TendonProfile::Straight {
            eccentricity_m: 0.1,
        });
        for station in [-0.01, 10.01, f64::NAN, f64::INFINITY] {
            request.stations_x_m = vec![station];
            assert!(solve(&request).is_err(), "accepted station {station}");
        }
    }

    #[test]
    fn documented_examples_parse_and_solve() {
        for text in [
            include_str!("../examples/fhwa-prestressed-girder-camber.json"),
            include_str!("../examples/parabolic-prestressed-beam.json"),
            include_str!("../examples/ec2-prestressed-shear-example-6-3.json"),
            include_str!("../examples/ec2-prestressed-shear-links-example-6-4.json"),
            include_str!("../examples/point-loaded-prestressed-beam.json"),
            include_str!("../examples/partially-loaded-prestressed-beam.json"),
        ] {
            let request: Request = serde_json::from_str(text).unwrap();
            solve(&request).unwrap();
        }
    }
}
