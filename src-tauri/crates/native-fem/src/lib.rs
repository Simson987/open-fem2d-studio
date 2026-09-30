//! Independent finite-element kernels. The input uses metres, kN and MPa.
//! These kernels are opt-in until their reference suite covers production use.

pub mod frame3d;
pub mod hybrid_plate;
pub mod material2d;
pub mod math;
pub mod plate2d;
pub mod plate_bending;
pub mod prestressed_beam;
pub mod quad2d;
pub mod reinforced_plate;

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

/// Material laws shared by the experimental kernels. The 2D membrane kernel
/// stores plastic strain and tensile damage along one request's load path;
/// the 3D frame kernel still uses a monotonic effective-E envelope.
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
