//! Independent finite-element kernels. The input uses metres, kN and MPa.
//! These kernels are opt-in until their reference suite covers production use.

pub mod crack_width;
pub mod csr;
pub mod csr_gmres;
pub mod csr_ldlt;
pub mod dispatch;
pub mod frame2d;
pub mod frame3d;
pub mod frontal;
pub mod hex8;
pub mod hex8_loads;
pub mod hex8_matrix_free;
pub mod hybrid_plate;
mod j2_pcg_support;
pub mod material2d;
pub mod math;
pub mod matrix_free_gmres;
pub mod mixed2d;
pub mod mixed3d;
mod mixed3d_frame;
mod mixed3d_membrane;
pub mod plane_stress_crack_band;
pub mod plate2d;
pub mod plate_bending;
pub mod plate_concrete_section;
pub mod plate_fiber_section;
pub mod prestressed_beam;
pub mod quad2d;
pub mod reinforced_plate;
pub mod section;
pub mod solid_concrete_damage;
pub mod solid_finite_j2;
pub mod solid_finite_j2_hex8;
pub mod solid_finite_j2_membrane;
pub mod solid_finite_j2_tet;
pub mod solid_finite_membrane;
pub mod solid_finite_plastic_truss;
pub mod solid_finite_truss;
pub mod solid_j2;
pub mod three_layer;
pub mod volume3d;
pub mod volume3d_concrete_damage;
pub mod volume3d_finite_j2;
pub mod volume3d_gnl;
pub mod volume3d_j2;
pub mod volume_hex8;

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
/// stores plastic strain and tensile damage along one request's load path.
/// The 3D frame kernel retains axial history when `loadPath` is supplied;
/// its bending response remains a member-level secant approximation.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum MaterialLaw {
    Elastic,
    SteelBilinear {
        #[serde(alias = "yield_mpa")]
        yield_mpa: f64,
        #[serde(alias = "hardening_ratio")]
        hardening_ratio: f64,
    },
    ConcreteCracking {
        #[serde(alias = "tensile_mpa")]
        tensile_mpa: f64,
        #[serde(alias = "residual_ratio")]
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

#[cfg(test)]
mod material_law_wire_tests {
    use super::{Analysis, MaterialLaw};

    #[test]
    fn material_law_accepts_app_camel_case_and_existing_snake_case_inputs() {
        let camel: MaterialLaw = serde_json::from_str(
            r#"{"kind":"steelBilinear","yieldMpa":235.0,"hardeningRatio":0.02}"#,
        )
        .unwrap();
        let snake: MaterialLaw = serde_json::from_str(
            r#"{"kind":"steelBilinear","yield_mpa":235.0,"hardening_ratio":0.02}"#,
        )
        .unwrap();
        assert!(matches!(
            camel,
            MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.02
            }
        ));
        assert!(matches!(
            snake,
            MaterialLaw::SteelBilinear {
                yield_mpa: 235.0,
                hardening_ratio: 0.02
            }
        ));
    }

    #[test]
    fn geometric_shell_accepts_app_material_law_map_and_combined_analysis() {
        let shell: crate::hybrid_plate::GeometricShellRequest = serde_json::from_str(
            r#"{"bending":{"nodes":[],"materials":[],"quads":[]},"analysis":"combined","materialLaws":{"1":{"kind":"concreteCracking","tensileMpa":3.0,"residualRatio":0.02}}}"#,
        )
        .unwrap();
        assert_eq!(shell.analysis, Analysis::Combined);
        assert!(matches!(
            shell.material_laws.get(&1),
            Some(MaterialLaw::ConcreteCracking {
                tensile_mpa: 3.0,
                residual_ratio: 0.02
            })
        ));
    }
}
