//! Fiber-integrated uniaxial section response for nonlinear beam sections.
//!
//! The equivalent rectangular quadrature matches the supplied area and
//! second moments exactly for a linear strain field. The frame assemblers use
//! these section responses for nonlinear bending; see the solver roadmap for
//! element-level coupling and connection limitations.

use crate::{positive, MaterialLaw};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FiberState {
    pub plastic_strain: f64,
    pub equivalent_plastic_strain: f64,
    pub tensile_damage: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fiber {
    /// Area represented by this integration point, in m².
    pub area_m2: f64,
    /// Signed distance from the section reference axis, in m.
    pub y_m: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SectionResponse {
    /// Axial force, in kN.
    pub axial_kn: f64,
    /// Bending moment, in kN·m, using ε(y) = ε₀ - y κ.
    pub moment_kn_m: f64,
    /// Consistent section tangent [N, M] / [ε₀, κ], in kN and kN·m units.
    pub tangent: [[f64; 2]; 2],
    /// Trial states in the same order as the fibers. Commit only after an
    /// equilibrium/load step is accepted.
    pub trial_states: Vec<FiberState>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Fiber3D {
    /// Area represented by this integration point, in m².
    pub area_m2: f64,
    /// Local section coordinates, in m.
    pub y_m: f64,
    pub z_m: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SectionResponse3D {
    /// Resultants for ε = ε₀ + z κᵧ − y κ𝓏.
    pub axial_kn: f64,
    pub moment_y_kn_m: f64,
    pub moment_z_kn_m: f64,
    /// Consistent tangent for [N, Mᵧ, M𝓏] / [ε₀, κᵧ, κ𝓏].
    pub tangent: [[f64; 3]; 3],
    pub trial_states: Vec<FiberState>,
}

/// Three-point equivalent rectangular quadrature. The two outer fibers are
/// at ±sqrt(3 I/A), each with area A/6; the center fiber has area 2A/3.
/// This reproduces both A and I and has zero first moment.
pub fn equivalent_rectangular_fibers(area_m2: f64, inertia_m4: f64) -> Result<[Fiber; 3], String> {
    positive(area_m2, "section area")?;
    positive(inertia_m4, "section inertia")?;
    let y = (3.0 * inertia_m4 / area_m2).sqrt();
    if !y.is_finite() || y <= 0.0 {
        return Err("section fiber locations must be finite and positive".into());
    }
    Ok([
        Fiber {
            area_m2: area_m2 / 6.0,
            y_m: -y,
        },
        Fiber {
            area_m2: 2.0 * area_m2 / 3.0,
            y_m: 0.0,
        },
        Fiber {
            area_m2: area_m2 / 6.0,
            y_m: y,
        },
    ])
}

/// Nine-point equivalent rectangular quadrature. It exactly reproduces A,
/// Iy, Iz and the zero product inertia under linear section strains.
pub fn equivalent_rectangular_fibers_3d(
    area_m2: f64,
    iy_m4: f64,
    iz_m4: f64,
) -> Result<[Fiber3D; 9], String> {
    positive(area_m2, "section area")?;
    positive(iy_m4, "section Iy")?;
    positive(iz_m4, "section Iz")?;
    let y = (3.0 * iz_m4 / area_m2).sqrt();
    let z = (3.0 * iy_m4 / area_m2).sqrt();
    if !y.is_finite() || !z.is_finite() || y <= 0.0 || z <= 0.0 {
        return Err("3D section fiber locations must be finite and positive".into());
    }
    let coordinates = [(-1.0, 1.0 / 6.0), (0.0, 2.0 / 3.0), (1.0, 1.0 / 6.0)];
    let mut fibers = [Fiber3D {
        area_m2: 0.0,
        y_m: 0.0,
        z_m: 0.0,
    }; 9];
    for (iy, (y_sign, y_weight)) in coordinates.iter().copied().enumerate() {
        for (iz, (z_sign, z_weight)) in coordinates.iter().copied().enumerate() {
            fibers[iy * 3 + iz] = Fiber3D {
                area_m2: area_m2 * y_weight * z_weight,
                y_m: y_sign * y,
                z_m: z_sign * z,
            };
        }
    }
    Ok(fibers)
}

/// Integrate a uniaxial material law over a 3D section. Committed states must
/// come from the preceding converged load step, not another Newton trial.
pub fn integrate_section_3d(
    e_mpa: f64,
    law: MaterialLaw,
    fibers: &[Fiber3D],
    axial_strain: f64,
    curvature_y_per_m: f64,
    curvature_z_per_m: f64,
    previous_states: &[FiberState],
) -> Result<SectionResponse3D, String> {
    positive(e_mpa, "Young's modulus")?;
    if fibers.is_empty() {
        return Err("3D section must contain at least one fiber".into());
    }
    if fibers.len() != previous_states.len() {
        return Err("3D section fiber state count must match fiber count".into());
    }
    if !axial_strain.is_finite() || !curvature_y_per_m.is_finite() || !curvature_z_per_m.is_finite()
    {
        return Err("3D section strains must be finite".into());
    }
    validate_law(law)?;
    let mut response = SectionResponse3D {
        axial_kn: 0.0,
        moment_y_kn_m: 0.0,
        moment_z_kn_m: 0.0,
        tangent: [[0.0; 3]; 3],
        trial_states: Vec::with_capacity(fibers.len()),
    };
    for (fiber, previous) in fibers.iter().zip(previous_states) {
        positive(fiber.area_m2, "3D fiber area")?;
        if !fiber.y_m.is_finite() || !fiber.z_m.is_finite() {
            return Err("3D fiber coordinates must be finite".into());
        }
        let strain = axial_strain + fiber.z_m * curvature_y_per_m - fiber.y_m * curvature_z_per_m;
        let (stress, tangent_e, state) = material_response(e_mpa, law, strain, *previous);
        let b = [1.0, fiber.z_m, -fiber.y_m];
        let force = stress * fiber.area_m2 * 1000.0;
        response.axial_kn += force;
        response.moment_y_kn_m += fiber.z_m * force;
        response.moment_z_kn_m -= fiber.y_m * force;
        for i in 0..3 {
            for j in 0..3 {
                response.tangent[i][j] += tangent_e * fiber.area_m2 * b[i] * b[j] * 1000.0;
            }
        }
        response.trial_states.push(state);
    }
    Ok(response)
}

/// Integrate a uniaxial material law over fiber strains for given axial strain
/// and curvature. `previous_states` are committed states from the preceding
/// converged load step; passing trial states between Newton iterations would
/// incorrectly accumulate plastic strain/damage.
pub fn integrate_section(
    e_mpa: f64,
    law: MaterialLaw,
    fibers: &[Fiber],
    axial_strain: f64,
    curvature_per_m: f64,
    previous_states: &[FiberState],
) -> Result<SectionResponse, String> {
    positive(e_mpa, "Young's modulus")?;
    if fibers.is_empty() {
        return Err("section must contain at least one fiber".into());
    }
    if fibers.len() != previous_states.len() {
        return Err("fiber state count must match fiber count".into());
    }
    if !axial_strain.is_finite() || !curvature_per_m.is_finite() {
        return Err("section strains must be finite".into());
    }
    validate_law(law)?;

    let mut response = SectionResponse {
        axial_kn: 0.0,
        moment_kn_m: 0.0,
        tangent: [[0.0; 2]; 2],
        trial_states: Vec::with_capacity(fibers.len()),
    };
    for (fiber, previous) in fibers.iter().zip(previous_states) {
        positive(fiber.area_m2, "fiber area")?;
        if !fiber.y_m.is_finite() {
            return Err("fiber position must be finite".into());
        }
        let strain = axial_strain - fiber.y_m * curvature_per_m;
        let (stress, tangent_e, state) = material_response(e_mpa, law, strain, *previous);
        let ea = tangent_e * fiber.area_m2;
        let y_ea = fiber.y_m * ea;
        let y2_ea = fiber.y_m * y_ea;
        // MPa·m² = MN, converted to kN by ×1000.
        response.axial_kn += stress * fiber.area_m2 * 1000.0;
        response.moment_kn_m -= fiber.y_m * stress * fiber.area_m2 * 1000.0;
        response.tangent[0][0] += ea * 1000.0;
        response.tangent[0][1] -= y_ea * 1000.0;
        response.tangent[1][0] -= y_ea * 1000.0;
        response.tangent[1][1] += y2_ea * 1000.0;
        response.trial_states.push(state);
    }
    Ok(response)
}

fn validate_law(law: MaterialLaw) -> Result<(), String> {
    match law {
        MaterialLaw::Elastic => Ok(()),
        MaterialLaw::SteelBilinear {
            yield_mpa,
            hardening_ratio,
        } => {
            positive(yield_mpa, "steel yield stress")?;
            if hardening_ratio.is_finite() && (0.0..=1.0).contains(&hardening_ratio) {
                Ok(())
            } else {
                Err("steel hardening ratio must be finite and between 0 and 1".into())
            }
        }
        MaterialLaw::ConcreteCracking {
            tensile_mpa,
            residual_ratio,
        } => {
            positive(tensile_mpa, "concrete tensile strength")?;
            if residual_ratio.is_finite() && (0.0..=1.0).contains(&residual_ratio) {
                Ok(())
            } else {
                Err("concrete residual ratio must be finite and between 0 and 1".into())
            }
        }
    }
}

fn material_response(
    e: f64,
    law: MaterialLaw,
    strain: f64,
    previous: FiberState,
) -> (f64, f64, FiberState) {
    match law {
        MaterialLaw::Elastic => (e * strain, e, previous),
        MaterialLaw::SteelBilinear {
            yield_mpa,
            hardening_ratio,
        } => {
            let trial = e * (strain - previous.plastic_strain);
            if hardening_ratio == 1.0 {
                return (trial, e, previous);
            }
            let hardening = e * hardening_ratio / (1.0 - hardening_ratio);
            let excess = trial.abs() - yield_mpa - hardening * previous.equivalent_plastic_strain;
            if excess <= 0.0 {
                return (trial, e, previous);
            }
            let increment = excess / (e + hardening);
            let sign = trial.signum();
            (
                trial - sign * e * increment,
                hardening_ratio * e,
                FiberState {
                    plastic_strain: previous.plastic_strain + sign * increment,
                    equivalent_plastic_strain: previous.equivalent_plastic_strain + increment,
                    ..previous
                },
            )
        }
        MaterialLaw::ConcreteCracking {
            tensile_mpa,
            residual_ratio,
        } => {
            if strain <= 0.0 {
                return (e * strain, e, previous);
            }
            let elastic_stress = e * strain;
            let candidate = if elastic_stress > tensile_mpa {
                1.0 - (tensile_mpa + residual_ratio * (elastic_stress - tensile_mpa))
                    / elastic_stress
            } else {
                0.0
            };
            let damage = previous.tensile_damage.max(candidate).clamp(0.0, 1.0);
            let growing = candidate > previous.tensile_damage + 1e-12;
            (
                (1.0 - damage) * elastic_stress,
                if growing {
                    residual_ratio * e
                } else {
                    (1.0 - damage) * e
                },
                FiberState {
                    tensile_damage: damage,
                    ..previous
                },
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equivalent_fibers_match_area_centroid_and_inertia() {
        let fibers = equivalent_rectangular_fibers(0.3, 0.004).unwrap();
        let area: f64 = fibers.iter().map(|f| f.area_m2).sum();
        let first: f64 = fibers.iter().map(|f| f.area_m2 * f.y_m).sum();
        let inertia: f64 = fibers.iter().map(|f| f.area_m2 * f.y_m.powi(2)).sum();
        assert!((area - 0.3).abs() < 1e-14);
        assert!(first.abs() < 1e-14);
        assert!((inertia - 0.004).abs() < 1e-14);
    }

    #[test]
    fn equivalent_3d_fibers_match_both_inertias_and_product_inertia() {
        let (area, iy, iz) = (0.3, 0.002, 0.004);
        let fibers = equivalent_rectangular_fibers_3d(area, iy, iz).unwrap();
        let sum_area: f64 = fibers.iter().map(|f| f.area_m2).sum();
        let centroid_y: f64 = fibers.iter().map(|f| f.area_m2 * f.y_m).sum();
        let centroid_z: f64 = fibers.iter().map(|f| f.area_m2 * f.z_m).sum();
        let inertia_y: f64 = fibers.iter().map(|f| f.area_m2 * f.z_m.powi(2)).sum();
        let inertia_z: f64 = fibers.iter().map(|f| f.area_m2 * f.y_m.powi(2)).sum();
        let product: f64 = fibers.iter().map(|f| f.area_m2 * f.y_m * f.z_m).sum();
        assert!((sum_area - area).abs() < 1e-14);
        assert!(centroid_y.abs() < 1e-14 && centroid_z.abs() < 1e-14);
        assert!((inertia_y - iy).abs() < 1e-14);
        assert!((inertia_z - iz).abs() < 1e-14);
        assert!(product.abs() < 1e-14);
    }

    #[test]
    fn elastic_3d_section_matches_closed_form_three_axis_response() {
        let (area, iy, iz, e) = (0.3, 0.002, 0.004, 30_000.0);
        let fibers = equivalent_rectangular_fibers_3d(area, iy, iz).unwrap();
        let states = [FiberState::default(); 9];
        let (eps, ky, kz) = (1e-4, 0.002, -0.003);
        let r =
            integrate_section_3d(e, MaterialLaw::Elastic, &fibers, eps, ky, kz, &states).unwrap();
        assert!((r.axial_kn - e * area * eps * 1000.0).abs() < 1e-8);
        assert!((r.moment_y_kn_m - e * iy * ky * 1000.0).abs() < 1e-8);
        assert!((r.moment_z_kn_m - e * iz * kz * 1000.0).abs() < 1e-8);
        assert!((r.tangent[0][0] - e * area * 1000.0).abs() < 1e-8);
        assert!((r.tangent[1][1] - e * iy * 1000.0).abs() < 1e-8);
        assert!((r.tangent[2][2] - e * iz * 1000.0).abs() < 1e-8);
        assert!(r.tangent[0][1].abs() < 1e-9 && r.tangent[0][2].abs() < 1e-9);
        assert!(r.tangent[1][2].abs() < 1e-9);
    }

    #[test]
    fn biaxial_3d_steel_section_retains_plastic_history_after_unloading() {
        let fibers = equivalent_rectangular_fibers_3d(0.01, 1e-5, 2e-5).unwrap();
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 250.0,
            hardening_ratio: 0.01,
        };
        let committed = [FiberState::default(); 9];
        let loaded =
            integrate_section_3d(210_000.0, law, &fibers, 0.0, 0.04, 0.03, &committed).unwrap();

        assert!(loaded.moment_y_kn_m > 0.0);
        assert!(loaded.moment_z_kn_m > 0.0);
        assert!(loaded
            .trial_states
            .iter()
            .any(|state| state.equivalent_plastic_strain > 0.0));
        assert!(loaded.tangent[1][1] > 0.0 && loaded.tangent[2][2] > 0.0);

        let unloaded =
            integrate_section_3d(210_000.0, law, &fibers, 0.0, 0.0, 0.0, &loaded.trial_states)
                .unwrap();
        assert!(unloaded
            .trial_states
            .iter()
            .any(|state| state.equivalent_plastic_strain > 0.0));
        assert!(unloaded.axial_kn.abs() < 1e-8);
        assert!(unloaded.moment_y_kn_m.is_finite());
        assert!(unloaded.moment_z_kn_m.is_finite());
        assert!(unloaded.moment_y_kn_m.abs() > 1e-8);
        assert!(unloaded.moment_z_kn_m.abs() > 1e-8);
        assert_eq!(committed, [FiberState::default(); 9]);
    }

    #[test]
    fn biaxial_plastic_section_tangent_matches_finite_difference() {
        let e = 210_000.0;
        let fibers = equivalent_rectangular_fibers_3d(0.01, 1e-5, 2e-5).unwrap();
        let law = MaterialLaw::SteelBilinear {
            yield_mpa: 100.0,
            hardening_ratio: 0.1,
        };
        let previous = [FiberState::default(); 9];
        let strain = [0.0004, 0.03, 0.018];
        let response =
            integrate_section_3d(e, law, &fibers, strain[0], strain[1], strain[2], &previous)
                .unwrap();
        let resultants = |values: [f64; 3]| {
            let result =
                integrate_section_3d(e, law, &fibers, values[0], values[1], values[2], &previous)
                    .unwrap();
            [result.axial_kn, result.moment_y_kn_m, result.moment_z_kn_m]
        };
        let step = [1e-9, 1e-8, 1e-8];
        for column in 0..3 {
            let mut plus = strain;
            let mut minus = strain;
            plus[column] += step[column];
            minus[column] -= step[column];
            let positive = resultants(plus);
            let negative = resultants(minus);
            for row in 0..3 {
                let numerical = (positive[row] - negative[row]) / (2.0 * step[column]);
                let analytical = response.tangent[row][column];
                assert!(
                    (numerical - analytical).abs() <= 2e-6 * analytical.abs().max(1.0),
                    "tangent [{row},{column}]: finite difference {numerical}, section {analytical}"
                );
            }
        }
    }

    #[test]
    fn elastic_section_matches_closed_form_axial_and_bending_stiffness() {
        let a = 0.3;
        let i = 0.004;
        let fibers = equivalent_rectangular_fibers(a, i).unwrap();
        let states = [FiberState::default(); 3];
        let r = integrate_section(
            30_000.0,
            MaterialLaw::Elastic,
            &fibers,
            1e-4,
            0.002,
            &states,
        )
        .unwrap();
        assert!((r.axial_kn - 30_000.0 * a * 1e-4 * 1000.0).abs() < 1e-8);
        assert!((r.moment_kn_m - 30_000.0 * i * 0.002 * 1000.0).abs() < 1e-8);
        assert!((r.tangent[0][0] - 30_000.0 * a * 1000.0).abs() < 1e-8);
        assert!((r.tangent[1][1] - 30_000.0 * i * 1000.0).abs() < 1e-8);
        assert!(r.tangent[0][1].abs() < 1e-9);
    }

    #[test]
    fn steel_plasticity_is_fiber_local_and_trial_state_is_not_mutated() {
        let fibers = equivalent_rectangular_fibers(0.01, 1e-5).unwrap();
        let committed = [FiberState::default(); 3];
        let r = integrate_section(
            200_000.0,
            MaterialLaw::SteelBilinear {
                yield_mpa: 250.0,
                hardening_ratio: 0.01,
            },
            &fibers,
            0.0,
            0.03,
            &committed,
        )
        .unwrap();
        assert!(r.trial_states[0].equivalent_plastic_strain > 0.0);
        assert_eq!(r.trial_states[1], FiberState::default());
        assert!(r.trial_states[2].equivalent_plastic_strain > 0.0);
        assert_eq!(committed, [FiberState::default(); 3]);
        assert!(r.tangent[1][1] > 0.0);
    }

    #[test]
    fn concrete_cracking_tracks_independent_face_damage_and_unloading() {
        let fibers = equivalent_rectangular_fibers(0.2, 0.002).unwrap();
        let states = [FiberState::default(); 3];
        let law = MaterialLaw::ConcreteCracking {
            tensile_mpa: 3.0,
            residual_ratio: 0.02,
        };
        let loaded = integrate_section(30_000.0, law, &fibers, 0.0, 0.001, &states).unwrap();
        assert!(loaded.trial_states[0].tensile_damage > 0.0);
        assert_eq!(loaded.trial_states[1].tensile_damage, 0.0);
        assert_eq!(loaded.trial_states[2].tensile_damage, 0.0);
        let unloaded =
            integrate_section(30_000.0, law, &fibers, -0.0001, 0.0, &loaded.trial_states).unwrap();
        assert_eq!(
            unloaded.trial_states[0].tensile_damage,
            loaded.trial_states[0].tensile_damage
        );
    }

    #[test]
    fn invalid_section_inputs_are_rejected() {
        assert!(equivalent_rectangular_fibers(0.0, 1.0).is_err());
        assert!(integrate_section(30_000.0, MaterialLaw::Elastic, &[], 0.0, 0.0, &[]).is_err());
        let fibers = equivalent_rectangular_fibers(0.2, 0.002).unwrap();
        let states = [FiberState::default(); 3];
        assert!(integrate_section(
            30_000.0,
            MaterialLaw::SteelBilinear {
                yield_mpa: 250.0,
                hardening_ratio: 1.1
            },
            &fibers,
            0.0,
            0.0,
            &states,
        )
        .is_err());
    }
}
