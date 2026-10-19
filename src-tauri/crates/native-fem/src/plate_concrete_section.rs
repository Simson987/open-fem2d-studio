//! Local plate-thickness integration of regularized plane-stress concrete.
//!
//! This module supplies a section trial only. The in-plane crack-band width is
//! a property of the plate mesh, not the layer thickness. No global cracked
//! plate equilibrium, crack-width design check or mesh-objectivity claim follows
//! from this local integration alone.

use crate::plane_stress_crack_band::{PlaneStressCrackBandMaterial, PlaneStressCrackBandState};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_REVISION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug)]
pub struct ConcreteLayer {
    pub thickness_m: f64,
    pub e_mpa: f64,
    pub poisson: f64,
    pub tensile_strength_mpa: f64,
    pub fracture_energy_n_per_m: f64,
    pub crack_band_width_m: f64,
}

#[derive(Clone, Copy, Debug)]
struct Fiber {
    z_m: f64,
    weight_m: f64,
    material: PlaneStressCrackBandMaterial,
}

#[derive(Clone, Debug)]
pub struct ConcretePlateSection {
    id: u64,
    max_abs_z_m: f64,
    fibers: Vec<Fiber>,
}

#[derive(Clone, Debug)]
pub struct ConcreteSectionState {
    id: u64,
    generation: u64,
    revision: u64,
    fibers: Vec<PlaneStressCrackBandState>,
}

#[derive(Clone, Debug)]
pub struct ConcreteSectionTrial {
    /// [Nx, Ny, Nxy, Mx, My, Mxy] in kN/m and kN·m/m.
    pub resultants: [f64; 6],
    /// Central difference at fixed committed history; may be indefinite in
    /// softening and must not be assumed suitable for an SPD linear solver.
    pub tangent: [[f64; 6]; 6],
    pub fiber_stress_kn_per_m2: Vec<[f64; 3]>,
    pub fiber_damage: Vec<f64>,
    next_state: ConcreteSectionState,
    source_generation: u64,
    source_revision: u64,
}

struct Evaluation {
    resultants: [f64; 6],
    stress: Vec<[f64; 3]>,
    damage: Vec<f64>,
    state: ConcreteSectionState,
}

impl ConcretePlateSection {
    pub fn new(layers: &[ConcreteLayer]) -> Result<Self, String> {
        if layers.is_empty() || layers.len() > 512 {
            return Err("concrete plate section requires 1..512 layers".into());
        }
        let mut total = 0.0;
        let mut materials = Vec::with_capacity(layers.len());
        for layer in layers {
            if !layer.thickness_m.is_finite() || layer.thickness_m <= 0.0 {
                return Err("concrete plate layer thickness must be positive".into());
            }
            total += layer.thickness_m;
            materials.push(PlaneStressCrackBandMaterial::from_fracture_energy(
                layer.e_mpa,
                layer.poisson,
                layer.tensile_strength_mpa,
                layer.fracture_energy_n_per_m,
                layer.crack_band_width_m,
            )?);
        }
        if !total.is_finite() || total <= 0.0 {
            return Err("concrete plate total thickness is invalid".into());
        }
        let mut fibers = Vec::with_capacity(2 * layers.len());
        let mut bottom = -0.5 * total;
        let root = 1.0 / 3.0_f64.sqrt();
        for (layer, &material) in layers.iter().zip(&materials) {
            let mid = bottom + 0.5 * layer.thickness_m;
            for sign in [-1.0, 1.0] {
                fibers.push(Fiber {
                    z_m: mid + sign * 0.5 * layer.thickness_m * root,
                    weight_m: 0.5 * layer.thickness_m,
                    material,
                });
            }
            bottom += layer.thickness_m;
        }
        let max_abs_z_m = fibers.iter().map(|f| f.z_m.abs()).fold(0.0, f64::max);
        if max_abs_z_m == 0.0 {
            return Err("concrete plate fiber coordinates lost precision".into());
        }
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        if id == u64::MAX {
            return Err("concrete plate identity space exhausted".into());
        }
        Ok(Self {
            id,
            max_abs_z_m,
            fibers,
        })
    }

    pub fn initial_state(&self) -> ConcreteSectionState {
        ConcreteSectionState {
            id: self.id,
            generation: 0,
            revision: 0,
            fibers: vec![PlaneStressCrackBandState::default(); self.fibers.len()],
        }
    }

    pub fn fiber_positions_m(&self) -> Vec<f64> {
        self.fibers.iter().map(|fiber| fiber.z_m).collect()
    }

    pub fn fiber_weights_m(&self) -> Vec<f64> {
        self.fibers.iter().map(|fiber| fiber.weight_m).collect()
    }

    fn evaluate(
        &self,
        strain: [f64; 6],
        committed: &ConcreteSectionState,
    ) -> Result<Evaluation, String> {
        if strain.iter().any(|value| !value.is_finite()) {
            return Err("non-finite concrete plate generalized strain".into());
        }
        if committed.id != self.id || committed.fibers.len() != self.fibers.len() {
            return Err("concrete plate state belongs to a different section".into());
        }
        let mut resultants = [0.0; 6];
        let mut stress = Vec::with_capacity(self.fibers.len());
        let mut damage = Vec::with_capacity(self.fibers.len());
        let mut states = Vec::with_capacity(self.fibers.len());
        for (fiber, previous) in self.fibers.iter().zip(&committed.fibers) {
            let local = std::array::from_fn(|i| strain[i] + fiber.z_m * strain[i + 3]);
            let response = fiber.material.evaluate(local, *previous)?;
            for i in 0..3 {
                resultants[i] += fiber.weight_m * response.stress[i];
                resultants[i + 3] += fiber.weight_m * fiber.z_m * response.stress[i];
            }
            stress.push(response.stress);
            damage.push(response.damage);
            states.push(response.next_state);
        }
        if resultants.iter().any(|value| !value.is_finite()) {
            return Err("non-finite concrete plate resultants".into());
        }
        Ok(Evaluation {
            resultants,
            stress,
            damage,
            state: ConcreteSectionState {
                id: committed.id,
                generation: committed.generation,
                revision: committed.revision,
                fibers: states,
            },
        })
    }

    pub fn trial(
        &self,
        strain: [f64; 6],
        committed: &ConcreteSectionState,
    ) -> Result<ConcreteSectionTrial, String> {
        let baseline = self.evaluate(strain, committed)?;
        let mut tangent = [[0.0; 6]; 6];
        for column in 0..6 {
            let scale = if column < 3 { 1.0 } else { self.max_abs_z_m };
            let step = (1e-8 / scale).max(strain[column].abs() * 1e-5);
            let mut plus = strain;
            let mut minus = strain;
            plus[column] += step;
            minus[column] -= step;
            let upper = self.evaluate(plus, committed)?.resultants;
            let lower = self.evaluate(minus, committed)?.resultants;
            for row in 0..6 {
                tangent[row][column] = (upper[row] - lower[row]) / (2.0 * step);
                if !tangent[row][column].is_finite() {
                    return Err("non-finite concrete plate tangent".into());
                }
            }
        }
        Ok(ConcreteSectionTrial {
            resultants: baseline.resultants,
            tangent,
            fiber_stress_kn_per_m2: baseline.stress,
            fiber_damage: baseline.damage,
            next_state: baseline.state,
            source_generation: committed.generation,
            source_revision: committed.revision,
        })
    }

    pub fn commit(
        &self,
        committed: &mut ConcreteSectionState,
        trial: &ConcreteSectionTrial,
    ) -> Result<(), String> {
        if committed.id != self.id
            || trial.next_state.id != self.id
            || committed.generation != trial.source_generation
            || committed.revision != trial.source_revision
        {
            return Err("concrete plate trial does not match committed history".into());
        }
        let generation = committed
            .generation
            .checked_add(1)
            .ok_or("concrete plate generation overflow")?;
        let revision = NEXT_REVISION.fetch_add(1, Ordering::Relaxed);
        if revision == u64::MAX {
            return Err("concrete plate revision space exhausted".into());
        }
        *committed = trial.next_state.clone();
        committed.generation = generation;
        committed.revision = revision;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layer(thickness: f64, e: f64) -> ConcreteLayer {
        ConcreteLayer {
            thickness_m: thickness,
            e_mpa: e,
            poisson: 0.0,
            tensile_strength_mpa: 3.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 0.1,
        }
    }

    fn near(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "{actual:.12e} != {expected:.12e}"
        );
    }

    #[test]
    fn elastic_asymmetric_abd_matches_closed_thickness_integral() {
        let section =
            ConcretePlateSection::new(&[layer(0.12, 30_000.0), layer(0.08, 20_000.0)]).unwrap();
        let trial = section.trial([0.0; 6], &section.initial_state()).unwrap();
        let q0 = 30_000_000.0;
        let q1 = 20_000_000.0;
        let a = 0.12 * q0 + 0.08 * q1;
        let b = q0 * ((0.02_f64).powi(2) - (-0.10_f64).powi(2)) / 2.0
            + q1 * ((0.10_f64).powi(2) - (0.02_f64).powi(2)) / 2.0;
        let d = q0 * ((0.02_f64).powi(3) - (-0.10_f64).powi(3)) / 3.0
            + q1 * ((0.10_f64).powi(3) - (0.02_f64).powi(3)) / 3.0;
        near(trial.tangent[0][0], a, 0.01);
        near(trial.tangent[0][3], b, 0.001);
        near(trial.tangent[3][3], d, 0.0001);
    }

    #[test]
    fn bending_damage_is_persisted_only_after_commit_and_unloads() {
        let section = ConcretePlateSection::new(&[layer(0.2, 30_000.0)]).unwrap();
        let mut state = section.initial_state();
        let high = section
            .trial([0.0, 0.0, 0.0, 0.003, 0.0, 0.0], &state)
            .unwrap();
        assert_eq!(high.fiber_damage[0], 0.0);
        assert!(high.fiber_damage[1] > 0.0);
        let before_commit = section.trial([0.0; 6], &state).unwrap();
        assert!(before_commit
            .fiber_damage
            .iter()
            .all(|damage| *damage == 0.0));
        section.commit(&mut state, &high).unwrap();
        let unload = section
            .trial([0.0, 0.0, 0.0, 0.0003, 0.0, 0.0], &state)
            .unwrap();
        assert!(unload.fiber_damage[1] >= high.fiber_damage[1]);
        assert!(unload.fiber_stress_kn_per_m2[1][0] < high.fiber_stress_kn_per_m2[1][0]);
        assert!(section.commit(&mut state, &high).is_err());
    }

    #[test]
    fn bending_resultants_converge_to_independent_softening_integral() {
        let base = layer(0.2, 30_000.0);
        let layers = vec![layer(0.2 / 128.0, 30_000.0); 128];
        let section = ConcretePlateSection::new(&layers).unwrap();
        let curvature = 0.003;
        let trial = section
            .trial(
                [0.0, 0.0, 0.0, curvature, 0.0, 0.0],
                &section.initial_state(),
            )
            .unwrap();
        let threshold = base.tensile_strength_mpa / base.e_mpa;
        let softening = 1e-6 * base.fracture_energy_n_per_m
            / (base.crack_band_width_m * base.tensile_strength_mpa)
            - 0.5 * threshold;
        let mut reference_n = 0.0;
        let mut reference_m = 0.0;
        let samples = 20_000;
        let dz = base.thickness_m / samples as f64;
        for index in 0..samples {
            let z = -0.5 * base.thickness_m + (index as f64 + 0.5) * dz;
            let strain = z * curvature;
            let stress_mpa = if strain <= threshold {
                base.e_mpa * strain
            } else {
                base.tensile_strength_mpa * (-(strain - threshold) / softening).exp()
            };
            reference_n += 1000.0 * stress_mpa * dz;
            reference_m += 1000.0 * stress_mpa * z * dz;
        }
        assert!(trial.fiber_damage.iter().any(|damage| *damage > 0.0));
        near(trial.resultants[0], reference_n, 0.002);
        near(trial.resultants[3], reference_m, 0.0002);
    }

    #[test]
    fn cracked_membrane_tangent_is_negative_and_not_forced_positive() {
        let section = ConcretePlateSection::new(&[layer(0.2, 30_000.0)]).unwrap();
        let virgin = section.initial_state();
        let strain = 0.0003;
        let trial = section
            .trial([strain, 0.0, 0.0, 0.0, 0.0, 0.0], &virgin)
            .unwrap();
        let base = layer(0.2, 30_000.0);
        let threshold = base.tensile_strength_mpa / base.e_mpa;
        let softening = 1e-6 * base.fracture_energy_n_per_m
            / (base.crack_band_width_m * base.tensile_strength_mpa)
            - 0.5 * threshold;
        let stress_mpa = base.tensile_strength_mpa * (-(strain - threshold) / softening).exp();
        let expected_tangent = -1000.0 * base.thickness_m * stress_mpa / softening;
        assert!(trial.tangent[0][0] < 0.0);
        near(trial.tangent[0][0], expected_tangent, 1.0);
    }
}
