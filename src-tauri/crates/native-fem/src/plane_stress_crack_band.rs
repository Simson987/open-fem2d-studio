//! Experimental plane-stress tensile damage at one material point.
//!
//! This is the plane-stress reduction of `solid_concrete_damage`'s small-strain
//! Rankine effective-stress model. It shares that module's exponential
//! fracture-energy calibration and positive-principal-stress split. The caller
//! supplies an *in-plane* crack-band width; plate thickness or fiber spacing
//! is not a substitute for the in-plane localization length.
//!
//! The calibration follows COMSOL Structural Mechanics Module User's Guide
//! 5.6, equations (3-100) and (3-101),
//! <https://doc.comsol.com/5.6/doc/com.comsol.help.sme/StructuralMechanicsModuleUsersGuide.pdf>.
//! `evaluate` is a pure trial update. Commit `next_state` only after the global
//! equilibrium step is accepted. The returned matrix is a frozen-damage,
//! frozen-projector *secant*, not a consistent Newton tangent.
//!
//! Only uniaxial monotonic tensile work is calibrated to `Gf`. This material
//! has no compressive crushing/plasticity, cyclic closure law, crack-direction
//! tracking, nonlocal regularization, or demonstrated general-mesh objectivity.

use crate::solid_concrete_damage::{TensionDamageMaterial, TensionDamageState};

#[derive(Clone, Copy, Debug)]
pub struct PlaneStressCrackBandMaterial {
    core: TensionDamageMaterial,
    fracture_energy_n_per_m: f64,
    crack_band_width_m: f64,
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaneStressCrackBandState {
    /// Maximum positive effective principal stress divided by E.
    pub max_equivalent_strain: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct PlaneStressCrackBandResponse {
    /// `[sigma_x, sigma_y, tau_xy]` in kN/m², matching `material2d`.
    pub stress: [f64; 3],
    pub equivalent_strain: f64,
    pub damage: f64,
    pub next_state: PlaneStressCrackBandState,
    /// `[sigma_x, sigma_y, tau_xy]` versus `[epsilon_x, epsilon_y, gamma_xy]`
    /// in kN/m². Frozen-damage secant; not a consistent Newton tangent.
    pub secant: [[f64; 3]; 3],
}

impl PlaneStressCrackBandMaterial {
    pub fn from_fracture_energy(
        e_mpa: f64,
        poisson: f64,
        tensile_strength_mpa: f64,
        fracture_energy_n_per_m: f64,
        crack_band_width_m: f64,
    ) -> Result<Self, String> {
        let core = TensionDamageMaterial::from_fracture_energy(
            e_mpa,
            poisson,
            tensile_strength_mpa,
            fracture_energy_n_per_m,
            crack_band_width_m,
        )?;
        Ok(Self {
            core,
            fracture_energy_n_per_m,
            crack_band_width_m,
        })
    }

    pub fn e_mpa(self) -> f64 {
        self.core.e_mpa
    }

    pub fn poisson(self) -> f64 {
        self.core.poisson
    }

    pub fn tensile_strength_mpa(self) -> f64 {
        self.core.tensile_strength_mpa
    }

    pub fn softening_strain(self) -> f64 {
        self.core.softening_strain
    }

    pub fn fracture_energy_n_per_m(self) -> f64 {
        self.fracture_energy_n_per_m
    }

    pub fn crack_band_width_m(self) -> f64 {
        self.crack_band_width_m
    }

    pub fn evaluate(
        self,
        strain: [f64; 3],
        previous: PlaneStressCrackBandState,
    ) -> Result<PlaneStressCrackBandResponse, String> {
        if strain.iter().any(|value| !value.is_finite()) {
            return Err("non-finite plane-stress concrete strain".into());
        }
        // Elastic plane-stress condensation also enforces sigma_zz=0 after the
        // unilateral damage split: zero effective sigma_zz stays zero.
        let z_factor = -self.core.poisson / (1.0 - self.core.poisson);
        let strain3 = [
            strain[0],
            strain[1],
            z_factor * (strain[0] + strain[1]),
            strain[2],
            0.0,
            0.0,
        ];
        let response = self.core.evaluate(
            strain3,
            TensionDamageState {
                max_equivalent_strain: previous.max_equivalent_strain,
            },
        )?;
        let rows = [0, 1, 3];
        let mut secant = [[0.0; 3]; 3];
        for (i, &row) in rows.iter().enumerate() {
            for (j, &column) in rows.iter().enumerate() {
                let condensed = response.secant_mpa[row][column]
                    + if j < 2 {
                        z_factor * response.secant_mpa[row][2]
                    } else {
                        0.0
                    };
                secant[i][j] = 1000.0 * condensed;
            }
        }
        let stress = [
            1000.0 * response.stress_mpa[0],
            1000.0 * response.stress_mpa[1],
            1000.0 * response.stress_mpa[3],
        ];
        if stress.iter().any(|value| !value.is_finite())
            || secant.iter().flatten().any(|value| !value.is_finite())
        {
            return Err("non-finite plane-stress concrete response".into());
        }
        Ok(PlaneStressCrackBandResponse {
            stress,
            equivalent_strain: response.equivalent_strain,
            damage: response.damage,
            next_state: PlaneStressCrackBandState {
                max_equivalent_strain: response.next_state.max_equivalent_strain,
            },
            secant,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const E: f64 = 30_000.0;
    const NU: f64 = 0.2;
    const FT: f64 = 3.0;
    const GF: f64 = 100.0;

    fn near(actual: f64, expected: f64, relative: f64) {
        let scale = expected.abs().max(1.0);
        assert!(
            (actual - expected).abs() <= relative * scale,
            "actual={actual:.12e}, expected={expected:.12e}, relative={relative:.3e}"
        );
    }

    fn uniaxial_strain(ex: f64) -> [f64; 3] {
        [ex, -NU * ex, 0.0]
    }

    #[test]
    fn two_band_widths_have_independent_peak_and_full_uniaxial_work() {
        let threshold = FT / E;
        for h in [0.05, 0.20] {
            let material =
                PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, h).unwrap();
            let expected_softening = 1e-6 * GF / (h * FT) - 0.5 * threshold;
            near(material.softening_strain(), expected_softening, 1e-13);
            let peak = material
                .evaluate(
                    uniaxial_strain(threshold),
                    PlaneStressCrackBandState::default(),
                )
                .unwrap();
            near(peak.stress[0] / 1000.0, FT, 1e-12);
            near(peak.stress[1], 0.0, 1e-10);
            near(peak.damage, 0.0, 1e-12);

            // Independent trapezoidal integration of the evaluated material
            // curve, including the pre-peak triangle. MPa = MJ/m³.
            let end = threshold + 24.0 * expected_softening;
            let steps = 100_000;
            let dx = end / steps as f64;
            let mut work_mpa = 0.0;
            let mut previous_stress = 0.0;
            for i in 1..=steps {
                let ex = i as f64 * dx;
                let stress = material
                    .evaluate(uniaxial_strain(ex), PlaneStressCrackBandState::default())
                    .unwrap()
                    .stress[0]
                    / 1000.0;
                work_mpa += 0.5 * (previous_stress + stress) * dx;
                previous_stress = stress;
            }
            let work_n_per_m = 1e6 * h * work_mpa;
            near(work_n_per_m, GF, 3e-5);
        }
    }

    #[test]
    fn trial_history_unloads_and_reloads_without_mutating_committed_state() {
        let material =
            PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, 0.10).unwrap();
        let original = PlaneStressCrackBandState::default();
        let ex_peak = 0.0005;
        let trial = material
            .evaluate(uniaxial_strain(ex_peak), original)
            .unwrap();
        assert_eq!(original.max_equivalent_strain, 0.0);
        assert!(trial.damage > 0.0);
        let committed = trial.next_state;

        let ex_small = ex_peak * 0.25;
        let unload = material
            .evaluate(uniaxial_strain(ex_small), committed)
            .unwrap();
        near(
            unload.stress[0],
            (1.0 - trial.damage) * E * 1000.0 * ex_small,
            1e-12,
        );
        near(unload.damage, trial.damage, 1e-12);
        near(
            unload.next_state.max_equivalent_strain,
            committed.max_equivalent_strain,
            1e-12,
        );

        let reload = material
            .evaluate(uniaxial_strain(ex_peak), committed)
            .unwrap();
        near(reload.stress[0], trial.stress[0], 1e-12);
        let further = material
            .evaluate(uniaxial_strain(1.2 * ex_peak), committed)
            .unwrap();
        assert!(further.damage > trial.damage);
        assert!(further.next_state.max_equivalent_strain > committed.max_equivalent_strain);
    }

    #[test]
    fn compression_recovers_undamaged_elastic_stress_after_tensile_history() {
        let material =
            PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, 0.10).unwrap();
        let damaged = material
            .evaluate(uniaxial_strain(0.001), PlaneStressCrackBandState::default())
            .unwrap();
        let compression = material
            .evaluate(uniaxial_strain(-0.001), damaged.next_state)
            .unwrap();
        near(compression.stress[0] / 1000.0, -E * 0.001, 1e-12);
        near(compression.stress[1], 0.0, 1e-9);
        near(compression.damage, damaged.damage, 1e-12);
        near(
            compression.next_state.max_equivalent_strain,
            damaged.next_state.max_equivalent_strain,
            1e-12,
        );
    }

    #[test]
    fn condensed_secant_reproduces_stress_for_rotated_plane_stress() {
        let material =
            PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, 0.10).unwrap();
        let strain = [0.0004, -0.0001, 0.0003];
        let response = material
            .evaluate(strain, PlaneStressCrackBandState::default())
            .unwrap();
        for row in 0..3 {
            let recovered: f64 = (0..3).map(|j| response.secant[row][j] * strain[j]).sum();
            near(recovered, response.stress[row], 1e-11);
        }
        assert!(response.equivalent_strain > 0.0);
    }

    #[test]
    fn rejects_invalid_energy_band_and_history() {
        assert!(PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, 0.0, 0.1).is_err());
        assert!(PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, 0.0).is_err());
        assert!(PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, 1.0).is_err());
        assert!(PlaneStressCrackBandMaterial::from_fracture_energy(-E, NU, FT, GF, 0.1).is_err());
        assert!(PlaneStressCrackBandMaterial::from_fracture_energy(E, 0.5, FT, GF, 0.1).is_err());
        let material =
            PlaneStressCrackBandMaterial::from_fracture_energy(E, NU, FT, GF, 0.1).unwrap();
        assert!(material
            .evaluate([f64::NAN, 0.0, 0.0], PlaneStressCrackBandState::default())
            .is_err());
        assert!(material
            .evaluate(
                [0.0; 3],
                PlaneStressCrackBandState {
                    max_equivalent_strain: -1.0,
                },
            )
            .is_err());
    }
}
