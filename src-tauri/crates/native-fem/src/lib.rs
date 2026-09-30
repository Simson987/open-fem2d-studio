//! Independent finite-element kernels. The input uses metres, kN and MPa.
//! These kernels are opt-in until their reference suite covers production use.

pub mod frame3d;
pub mod math;
pub mod plate2d;

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Analysis {
    #[default]
    Linear,
    Geometric,
    Material,
    Combined,
}

impl Analysis {
    pub fn geometric(self) -> bool {
        matches!(self, Self::Geometric | Self::Combined)
    }
    pub fn material(self) -> bool {
        matches!(self, Self::Material | Self::Combined)
    }
}

/// Monotonic stress envelopes. These are exploratory material nonlinear laws:
/// no plastic strain, crack history or unloading path is stored between solves.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MaterialLaw {
    Elastic,
    SteelBilinear {
        yield_mpa: f64,
        hardening_ratio: f64,
    },
    ConcreteCracking {
        tensile_mpa: f64,
        residual_ratio: f64,
    },
}

impl Default for MaterialLaw {
    fn default() -> Self {
        Self::Elastic
    }
}

pub(crate) fn positive(value: f64, name: &str) -> Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be finite and positive"))
    }
}
