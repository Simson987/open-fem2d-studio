//! Experimental total-Lagrangian finite-strain J2 Tet4 Newton solver.
//!
//! Dense, sparse GMRES, frontal and matrix-free GMRES paths are bounded validation solvers.
//! Coordinates/displacements are m, material stress MPa and nodal force kN.
//! Each evaluation uses the last accepted material history. Trial states are
//! committed only after the true free nodal residual converges. Inverted
//! elements, rank-deficient tangents and exhausted cutbacks are errors.
//! Body forces and face tractions are dead loads integrated over the reference
//! cell/face. They do not rotate or change area with the deformed geometry.

use crate::hex8_loads::{consistent_uniform_body_force, consistent_uniform_face_traction};
use crate::matrix_free_gmres;
use crate::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel, Tensor3};
use crate::solid_finite_j2_hex8::{self, FiniteJ2Hex8Geometry};
use crate::solid_finite_j2_membrane;
use crate::solid_finite_j2_tet;
use crate::solid_finite_membrane;
use crate::solid_finite_plastic_truss::{self, PlasticTrussMaterial, PlasticTrussState};
use crate::solid_finite_truss;
use crate::volume3d::Mesh;
use crate::{
    csr::{CsrMatrix, CsrPatternAssembler},
    csr_gmres::{solve_gmres, GmresOptions},
    frontal::{self, FrontalElement, FrontalOptions},
};
use crate::{frame3d, plate_bending};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

const MAX_DENSE_DOFS: usize = 120;
const MAX_DENSE_TETS: usize = 200;
const MAX_GMRES_DOFS: usize = 2_400;
const MAX_GMRES_TETS: usize = 3_600;
const MAX_GMRES_NODE_SLOTS: usize = 57_600;
const MAX_GMRES_NONZEROS: usize = 600_000;
const MAX_GMRES_RESTART: usize = 100;
const MAX_GMRES_ITERATIONS: usize = 10_000;
const MAX_MATRIX_FREE_DOFS: usize = 24_000;
const MAX_MATRIX_FREE_TETS: usize = 36_000;
const MAX_MATRIX_FREE_CACHE_SCALAR_EQUIVALENTS: usize = 5_184_000;
const MAX_MATRIX_FREE_THREADS: usize = 16;
// Explicit opt-in for large validation jobs. The default matrix-free path
// keeps its smaller 24k-DOF/36k-element limits.
// The explicit large route can describe a regular 63³ Hex8 grid (64³ nodes),
// provided the caller chooses a Krylov restart within the separate basis cap.
// This is admission capacity, not a validated 250k-Hex8 acceptance result.
const MAX_LARGE_MATRIX_FREE_DOFS: usize = 850_000;
const MAX_LARGE_MATRIX_FREE_TETS: usize = 300_000;
const MAX_LARGE_MATRIX_FREE_CACHE_SCALAR_EQUIVALENTS: usize = 43_200_000;
const MAX_LARGE_MATRIX_FREE_BASIS_SCALARS: usize = 8_000_000;
const MAX_LARGE_MATRIX_FREE_ESTIMATED_BYTES: usize = 4_294_967_296; // 4 GiB
const MAX_FRONTAL_DOFS: usize = 24_000;
const MAX_FRONTAL_TETS: usize = 36_000;
const MAX_FRONTAL_ESTIMATED_BYTES: usize = 256 * 1024 * 1024;
const MAX_FRONT_DOFS: usize = 1_024;
const MAX_TARGETS: usize = 64;
// The elastic DKT contribution is retained as a 9x9 matrix at every Newton
// evaluation. This first coupled slice does not claim large plate capacity.
const MAX_COUPLED_DKT_PLATES: usize = 10_000;
// Bound all reference-frame member-load records across the absolute target path.
const MAX_COUPLED_FRAME_MEMBER_LOADS: usize = 100_000;
const MAX_NEWTON: usize = 80;
const MAX_CUTBACKS: usize = 64;
const MAX_LINE_HALVINGS: usize = 24;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2TetTarget {
    /// Absolute dead nodal loads, one triplet per mesh node.
    pub loads_kn: Vec<[f64; 3]>,
    /// Absolute force density on reference Tet4 cells, in kN/m³.
    #[serde(default)]
    pub body_forces: Vec<FiniteJ2TetBodyForce>,
    /// Absolute nominal traction on reference triangular faces, in kN/m².
    #[serde(default)]
    pub face_tractions: Vec<FiniteJ2TetFaceTraction>,
    /// Absolute prescribed displacement; None means free.
    pub prescribed_m: Vec<[Option<f64>; 3]>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2TetBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2TetFaceTraction {
    pub element: usize,
    /// Three distinct global node indices on the selected Tet4 face.
    pub face_nodes: [usize; 3],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2TetOptions {
    pub residual_tolerance: f64,
    pub max_newton_iterations: usize,
    pub max_line_search_halvings: usize,
    pub max_cutbacks: usize,
    pub min_step_fraction: f64,
    /// Select a bounded tangent solver. Automatic starts with sparse GMRES and
    /// recovers to frontal after diagnosed Krylov/CSR failure or a stalled
    /// Newton step, if the bounded frontal front fits.
    pub linear_backend: FiniteJ2TetLinearBackend,
    /// Maximum simultaneous free DOFs in the frontal wave (default 256).
    pub max_front_dofs: usize,
    pub gmres_restart: usize,
    pub gmres_max_iterations: usize,
    pub gmres_relative_tolerance: f64,
    /// Opt-in total-Lagrangian von Karman axial/bending coupling for full
    /// 12-DOF frames. Rotations and relative displacements retain the bounded
    /// small-rotation admission domain; frame material stays elastic.
    pub geometric_frames: bool,
    /// Number of element-product workers for either matrix-free backend (1..=16).
    pub matrix_free_threads: usize,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FiniteJ2TetLinearBackend {
    #[default]
    Dense,
    SparseGmres,
    FrontalWave,
    MatrixFreeGmres,
    MatrixFreeGmresLarge,
    Automatic,
}

impl Default for FiniteJ2TetOptions {
    fn default() -> Self {
        Self {
            residual_tolerance: 1e-9,
            max_newton_iterations: 30,
            max_line_search_halvings: 12,
            max_cutbacks: 24,
            min_step_fraction: 1.0 / 4096.0,
            linear_backend: FiniteJ2TetLinearBackend::Dense,
            max_front_dofs: 256,
            gmres_restart: 40,
            gmres_max_iterations: 3_000,
            gmres_relative_tolerance: 1e-10,
            geometric_frames: false,
            matrix_free_threads: 1,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2TetRequest {
    pub mesh: Mesh,
    pub steel: FiniteJ2Steel,
    /// Optional per-element material in mesh order.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element_steels: Option<Vec<FiniteJ2Steel>>,
    pub targets: Vec<FiniteJ2TetTarget>,
    #[serde(default)]
    pub options: FiniteJ2TetOptions,
}

/// An elastic finite-strain truss sharing translational nodes with the J2 solids.
/// Its Green-strain axial law is deliberately separate from the solid J2 law.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledTruss {
    pub nodes: [usize; 2],
    pub youngs_mpa: f64,
    pub area_m2: f64,
    /// Optional one-dimensional logarithmic-strain steel plasticity.
    /// Without this law, the legacy elastic Green-strain truss is used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plasticity: Option<FiniteJ2TrussPlasticity>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2TrussPlasticity {
    pub yield_mpa: f64,
    pub hardening_mpa: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledRequest {
    pub volume: FiniteJ2TetRequest,
    pub trusses: Vec<FiniteJ2CoupledTruss>,
}

/// A geometrically nonlinear, plane-stress Tri3 membrane sharing translations
/// with finite-J2 Tet4 solids. It carries no bending or rotational DOFs.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledMembrane {
    pub nodes: [usize; 3],
    pub youngs_mpa: f64,
    pub poisson: f64,
    pub thickness_m: f64,
    /// Optional finite-strain, plane-stress J2 law. Without it the legacy
    /// plane-stress Saint-Venant--Kirchhoff membrane is retained.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plasticity: Option<FiniteJ2MembranePlasticity>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2MembranePlasticity {
    pub yield_mpa: f64,
    /// Isotropic hardening slope with respect to equivalent plastic strain.
    pub hardening_mpa: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2MembraneCoupledRequest {
    pub volume: FiniteJ2TetRequest,
    #[serde(default)]
    pub trusses: Vec<FiniteJ2CoupledTruss>,
    pub membranes: Vec<FiniteJ2CoupledMembrane>,
}

/// Hex8 solids, Tet4 solids, trusses and membranes share one translational system.
/// Each hex target supplies absolute dead loads at the matching volume target.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2HexCoupledRequest {
    pub volume: FiniteJ2TetRequest,
    pub hexes: Vec<FiniteJ2HexCell>,
    pub hex_targets: Vec<FiniteJ2HexTarget>,
    #[serde(default)]
    pub trusses: Vec<FiniteJ2CoupledTruss>,
    #[serde(default)]
    pub membranes: Vec<FiniteJ2CoupledMembrane>,
}

/// Opt-in Tet4/Hex8/line coupling. Frames have 12 DOFs and use linear elastic
/// reference-axis Euler--Bernoulli bending in both planes and Saint-Venant
/// torsion. They share only translations with solids. Solids use finite-strain
/// J2; trusses and membranes retain their separately selected laws. Frames
/// may opt into bounded von Karman axial/bending
/// coupling; their material, section and axes stay fixed. There is no frame
/// material plasticity, shear deformation, warping or end release here. Nodal
/// force, moment and transverse member loads are dead loads in fixed reference
/// axes. Trial states outside 0.1 rad nodal rotation or 10% relative end
/// displacement are rejected rather than extrapolated.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2FrameCoupledRequest {
    pub volume: FiniteJ2TetRequest,
    #[serde(default)]
    pub hexes: Vec<FiniteJ2HexCell>,
    #[serde(default)]
    pub hex_targets: Vec<FiniteJ2HexTarget>,
    #[serde(default)]
    pub trusses: Vec<FiniteJ2CoupledTruss>,
    #[serde(default)]
    pub membranes: Vec<FiniteJ2CoupledMembrane>,
    pub frames: Vec<FiniteJ2CoupledFrame>,
    /// Elastic horizontal XY-DKT bending on volume-supported surface nodes.
    /// The solid and frame laws keep their existing finite-strain behavior;
    /// this plate contribution has a constant reference stiffness.
    #[serde(default)]
    pub bending_plates: Vec<FiniteJ2CoupledBendingPlate>,
    /// One frame target per volume target. Moment units are kN m; rotations rad.
    pub frame_targets: Vec<FiniteJ2FrameTarget>,
    /// Absolute reference-axis member loads at each volume target. An empty
    /// outer list means no member loads throughout the path; otherwise its
    /// length must equal `volume.targets.len()`.
    #[serde(default)]
    pub frame_member_load_targets: Vec<Vec<FiniteJ2CoupledFrameMemberLoad>>,
    /// Absolute reference-axis transverse point loads at each volume target.
    /// Empty means none throughout; otherwise one list per volume target.
    #[serde(default)]
    pub frame_member_point_load_targets: Vec<Vec<FiniteJ2CoupledFrameMemberPointLoad>>,
}

/// Linearly varying dead transverse load on an elastic frame, in its fixed
/// reference local y/z axes. `element` indexes `frames`; positions are measured
/// from its first node, in metres. Intensities are kN/m.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledFrameMemberLoad {
    pub element: usize,
    pub qy_start_kn_per_m: f64,
    pub qy_end_kn_per_m: f64,
    pub qz_start_kn_per_m: f64,
    pub qz_end_kn_per_m: f64,
    pub start_position_m: f64,
    pub end_position_m: f64,
}

/// Dead transverse point force on a frame in its fixed reference local y/z
/// axes. `element` indexes `frames`; `position_m` is measured from its first
/// node. Positive `py_kn`/`pz_kn` act along positive local axes.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledFrameMemberPointLoad {
    pub element: usize,
    pub py_kn: f64,
    pub pz_kn: f64,
    pub position_m: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledBendingPlate {
    pub nodes: [usize; 3],
    pub youngs_mpa: f64,
    pub poisson: f64,
    pub thickness_m: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2CoupledFrame {
    pub nodes: [usize; 2],
    pub youngs_mpa: f64,
    pub poisson: f64,
    /// Optional independent shear modulus for Saint-Venant torsion only.
    /// Absent G retains the isotropic E/[2(1+nu)] relation. Bending stays
    /// Euler--Bernoulli with E; solid Tet4/Hex8 materials remain isotropic J2.
    #[serde(default)]
    pub g_mpa: Option<f64>,
    pub area_m2: f64,
    pub iy_m4: f64,
    pub iz_m4: f64,
    pub torsion_j_m4: f64,
    #[serde(default)]
    pub roll_angle_rad: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2FrameTarget {
    /// One global moment triplet per mesh node, including solid-only nodes.
    pub moments_kn_m: Vec<[f64; 3]>,
    /// One global rotation triplet per mesh node. Solid-only rotations must
    /// be prescribed zero or left None (automatically held at zero).
    pub prescribed_rotation_rad: Vec<[Option<f64>; 3]>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2HexCell {
    pub nodes: [usize; 8],
    pub steel: FiniteJ2Steel,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2HexTarget {
    #[serde(default)]
    pub body_forces: Vec<FiniteJ2HexBodyForce>,
    #[serde(default)]
    pub face_tractions: Vec<FiniteJ2HexFaceTraction>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2HexBodyForce {
    pub element: usize,
    pub force_kn_per_m3: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FiniteJ2HexFaceTraction {
    pub element: usize,
    /// Outward cyclic local indices in the selected Hex8 cell.
    pub face_nodes: [usize; 4],
    pub traction_kn_per_m2: [f64; 3],
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiniteJ2AcceptedStep {
    pub target_index: usize,
    pub target_fraction: f64,
    pub newton_iterations: usize,
    pub true_free_residual_kn: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FiniteJ2TetResult {
    pub nodal_displacements_m: Vec<[f64; 3]>,
    pub nodal_reactions_kn: Vec<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodal_rotations_rad: Vec<[f64; 3]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nodal_reaction_moments_kn_m: Vec<[f64; 3]>,
    /// Local unreleased member end actions in input-frame order. At each end:
    /// [axial, shear-y, shear-z, torsion, moment-y, moment-z] in kN/kN m.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub frame_end_forces_local: Vec<[[f64; 6]; 2]>,
    /// Elastic fixed-reference XY-DKT centroid [Mx, My, Mxy] in kN m/m,
    /// one per input bending triangle. These are not plate GNL/FNL resultants.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub bending_plate_moments_knm_per_m: Vec<[f64; 3]>,
    pub element_states: Vec<FiniteJ2State>,
    pub element_first_piola_mpa: Vec<Tensor3>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hex_gauss_states: Vec<[FiniteJ2State; 8]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hex_gauss_first_piola_mpa: Vec<[Tensor3; 8]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hex_gauss_cauchy_mpa: Vec<[Tensor3; 8]>,
    /// Current axial truss forces, positive in tension.
    pub truss_axial_force_kn: Vec<f64>,
    /// Committed one-dimensional truss history; null for elastic trusses.
    pub truss_states: Vec<Option<PlasticTrussState>>,
    /// Current algorithmic axial material modulus for plastic-law trusses.
    pub truss_algorithmic_modulus_mpa: Vec<Option<f64>>,
    /// Legacy elastic membrane second Piola--Kirchhoff [S11, S22, S12].
    /// Plastic entries are unused [0,0,0] placeholders; read `membrane_cauchy_mpa`.
    pub membrane_stress_mpa: Vec<[f64; 3]>,
    /// Committed finite J2 membrane history; null for legacy elastic membranes.
    pub membrane_states: Vec<Option<FiniteJ2State>>,
    /// Plane-stress thickness stretch; null for legacy elastic membranes.
    pub membrane_thickness_stretch: Vec<Option<f64>>,
    /// Current global Kirchhoff tensor; null for legacy elastic membranes.
    pub membrane_kirchhoff_mpa: Vec<Option<Tensor3>>,
    /// Current orthonormal local Cauchy [11,22,12]; null for elastic membranes.
    pub membrane_cauchy_mpa: Vec<Option<[f64; 3]>>,
    /// Current membrane force resultant [N11,N22,N12], kN/m; null for elastic.
    pub membrane_force_resultant_kn_per_m: Vec<Option<[f64; 3]>>,
    pub accepted_steps: Vec<FiniteJ2AcceptedStep>,
    pub cutbacks: usize,
    pub true_free_residual_kn: f64,
    pub linear_backend_used: FiniteJ2TetLinearBackend,
    pub frontal_fallbacks: usize,
}

#[derive(Clone, Copy, Debug)]
struct Tet {
    nodes: [usize; 4],
    gradients: [[f64; 3]; 4],
    volume: f64,
}

#[derive(Clone)]
struct Hex {
    nodes: [usize; 8],
    reference: [[f64; 3]; 8],
    geometry: Arc<FiniteJ2Hex8Geometry>,
    steel: FiniteJ2Steel,
    state: [FiniteJ2State; 8],
}

#[derive(Clone, Copy)]
struct Truss {
    nodes: [usize; 2],
    reference: [[f64; 3]; 2],
    youngs_mpa: f64,
    area_m2: f64,
    plasticity: Option<PlasticTrussMaterial>,
    state: Option<PlasticTrussState>,
}

#[derive(Clone, Copy)]
struct Membrane {
    nodes: [usize; 3],
    reference: [[f64; 3]; 3],
    youngs_mpa: f64,
    poisson: f64,
    thickness_m: f64,
    plasticity: Option<FiniteJ2Steel>,
    state: Option<FiniteJ2State>,
}

#[derive(Clone)]
struct Frame {
    nodes: [usize; 2],
    stiffness: [f64; 144],
    local_stiffness: [[f64; 12]; 12],
    rotation: [[f64; 3]; 3],
    length_m: f64,
    geometric: bool,
}

impl Frame {
    fn dofs(&self, nodes: usize) -> [usize; 12] {
        std::array::from_fn(|local| {
            let node = self.nodes[local / 6];
            if local % 6 < 3 {
                3 * node + local % 6
            } else {
                3 * nodes + 3 * node + local % 6 - 3
            }
        })
    }

    fn local_displacements(&self, global: &[f64; 12]) -> [f64; 12] {
        std::array::from_fn(|index| {
            let block = index / 3;
            let axis = index % 3;
            (0..3)
                .map(|j| self.rotation[axis][j] * global[3 * block + j])
                .sum()
        })
    }

    fn local_response(&self, q: &[f64; 12]) -> ([f64; 12], [[f64; 12]; 12]) {
        let mut force = std::array::from_fn(|row| {
            (0..12)
                .map(|col| self.local_stiffness[row][col] * q[col])
                .sum::<f64>()
        });
        let mut tangent = self.local_stiffness;
        if !self.geometric {
            return (force, tangent);
        }

        // Hermite bending slopes: G_ij = integral N'_i N'_j dx in each
        // transverse plane. The local z plane uses theta_y with opposite sign.
        // Axial energy is EA/(2L) [du + 1/2 q^T G q]^2. Its exact first and
        // second derivatives supply the internal force and symmetric tangent.
        let l = self.length_m;
        let block = [
            [36.0, 3.0 * l, -36.0, 3.0 * l],
            [3.0 * l, 4.0 * l * l, -3.0 * l, -l * l],
            [-36.0, -3.0 * l, 36.0, -3.0 * l],
            [3.0 * l, -l * l, -3.0 * l, 4.0 * l * l],
        ];
        let mut gram = [[0.0; 12]; 12];
        for (dofs, signs) in [
            ([1, 5, 7, 11], [1.0, 1.0, 1.0, 1.0]),
            ([2, 4, 8, 10], [1.0, -1.0, 1.0, -1.0]),
        ] {
            for i in 0..4 {
                for j in 0..4 {
                    gram[dofs[i]][dofs[j]] = signs[i] * signs[j] * block[i][j] / (30.0 * l);
                }
            }
        }
        let gram_q = std::array::from_fn::<_, 12, _>(|row| {
            (0..12).map(|col| gram[row][col] * q[col]).sum::<f64>()
        });
        let du = q[6] - q[0];
        let extension = du + 0.5 * (0..12).map(|i| q[i] * gram_q[i]).sum::<f64>();
        let d: [f64; 12] = std::array::from_fn(|i| match i {
            0 => -1.0,
            6 => 1.0,
            _ => 0.0,
        });
        let gradient: [f64; 12] = std::array::from_fn(|i| d[i] + gram_q[i]);
        let axial_k = self.local_stiffness[0][0];
        for row in 0..12 {
            // Remove the linear axial pair already contained in K_local.
            force[row] += axial_k * (extension * gradient[row] - du * d[row]);
            for col in 0..12 {
                tangent[row][col] += axial_k
                    * (gradient[row] * gradient[col] - d[row] * d[col]
                        + extension * gram[row][col]);
            }
        }
        (force, tangent)
    }

    fn response_global(&self, global: &[f64; 12]) -> ([f64; 12], [f64; 144]) {
        if !self.geometric {
            let force = std::array::from_fn(|row| {
                (0..12)
                    .map(|col| self.stiffness[12 * row + col] * global[col])
                    .sum()
            });
            return (force, self.stiffness);
        }
        let local = self.local_displacements(global);
        let (local_force, local_tangent) = self.local_response(&local);
        let force = std::array::from_fn(|row| {
            let block = row / 3;
            let axis = row % 3;
            (0..3)
                .map(|local_axis| {
                    self.rotation[local_axis][axis] * local_force[3 * block + local_axis]
                })
                .sum()
        });
        let mut tangent = [0.0; 144];
        for row in 0..12 {
            for col in 0..12 {
                let mut value = 0.0;
                for local_row in 0..3 {
                    for local_col in 0..3 {
                        value += self.rotation[local_row][row % 3]
                            * local_tangent[3 * (row / 3) + local_row][3 * (col / 3) + local_col]
                            * self.rotation[local_col][col % 3];
                    }
                }
                tangent[12 * row + col] = value;
            }
        }
        (force, tangent)
    }

    fn end_forces_local(
        &self,
        displacements: &[f64],
        nodes: usize,
        equivalent_load: Option<&[f64; 12]>,
    ) -> [[f64; 6]; 2] {
        let dofs = self.dofs(nodes);
        let global = dofs.map(|dof| displacements[dof]);
        let local = self.local_displacements(&global);
        let (force, _) = self.local_response(&local);
        std::array::from_fn(|end| {
            std::array::from_fn(|axis| {
                let index = 6 * end + axis;
                force[index] - equivalent_load.map_or(0.0, |load| load[index])
            })
        })
    }
}

struct Evaluation {
    internal: Vec<f64>,
    tangent: Option<Tangent>,
    states: Vec<FiniteJ2State>,
    first_piola: Vec<Tensor3>,
    hex_states: Vec<[FiniteJ2State; 8]>,
    hex_first_piola: Vec<[Tensor3; 8]>,
    hex_cauchy: Vec<[Tensor3; 8]>,
    truss_forces: Vec<f64>,
    truss_states: Vec<Option<PlasticTrussState>>,
    truss_moduli: Vec<Option<f64>>,
    membrane_stress: Vec<[f64; 3]>,
    membrane_states: Vec<Option<FiniteJ2State>>,
    membrane_thickness_stretch: Vec<Option<f64>>,
    membrane_kirchhoff: Vec<Option<Tensor3>>,
    membrane_cauchy: Vec<Option<[f64; 3]>>,
    membrane_force_resultant: Vec<Option<[f64; 3]>>,
}

enum Tangent {
    Dense(Vec<f64>),
    Sparse(CsrMatrix),
    Frontal(Vec<FrontalElement>),
    MatrixFree(MatrixFreeTangent),
}

struct MatrixFreeTangent {
    dofs: usize,
    elements: Vec<ElementTangent>,
    hexes: Vec<HexTangent>,
    trusses: Vec<TrussTangent>,
    membranes: Vec<MembraneTangent>,
    frames: Vec<FrameTangent>,
    plates: Vec<PlateTangent>,
    diagonal: Vec<f64>,
}

struct ElementTangent {
    dofs: [usize; 12],
    stiffness: [f64; 144],
}

struct HexTangent {
    dofs: [usize; 24],
    // The reference geometry is shared with the prepared Hex. Retain only the
    // Newton iterate and committed material history, not 576 stiffness entries.
    geometry: Arc<FiniteJ2Hex8Geometry>,
    steel: FiniteJ2Steel,
    committed: [FiniteJ2State; 8],
    displacements_m: [[f64; 3]; 8],
}

struct TrussTangent {
    dofs: [usize; 6],
    stiffness: [f64; 36],
}

struct MembraneTangent {
    dofs: [usize; 9],
    stiffness: [f64; 81],
}

struct FrameTangent {
    dofs: [usize; 12],
    stiffness: [f64; 144],
}

struct PlateTangent {
    dofs: [usize; 9],
    stiffness: [f64; 81],
}

#[derive(Clone)]
struct BendingPlate {
    nodes: [usize; 3],
    dofs: [usize; 9],
    stiffness: [f64; 81],
}

struct Step {
    u: Vec<f64>,
    evaluation: Evaluation,
    residual: f64,
    iterations: usize,
    backend_used: FiniteJ2TetLinearBackend,
    frontal_fallbacks: usize,
}

pub fn solve(request: &FiniteJ2TetRequest) -> Result<FiniteJ2TetResult, String> {
    solve_impl(request, &[], &[], &[], &[], &[], &[], &[], &[], &[])
}

pub fn solve_coupled(request: &FiniteJ2CoupledRequest) -> Result<FiniteJ2TetResult, String> {
    if request.trusses.is_empty() {
        return Err("finite J2 coupled route needs at least one truss".into());
    }
    solve_impl(
        &request.volume,
        &request.trusses,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
    )
}

pub fn solve_membrane_coupled(
    request: &FiniteJ2MembraneCoupledRequest,
) -> Result<FiniteJ2TetResult, String> {
    if request.membranes.is_empty() {
        return Err("finite J2 membrane coupled route needs at least one membrane".into());
    }
    solve_impl(
        &request.volume,
        &request.trusses,
        &request.membranes,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
    )
}

pub fn solve_hex_coupled(request: &FiniteJ2HexCoupledRequest) -> Result<FiniteJ2TetResult, String> {
    if request.hexes.is_empty() {
        return Err("finite J2 Hex8 coupled route needs at least one Hex8".into());
    }
    solve_impl(
        &request.volume,
        &request.trusses,
        &request.membranes,
        &request.hexes,
        &request.hex_targets,
        &[],
        &[],
        &[],
        &[],
        &[],
    )
}

pub fn solve_frame_coupled(
    request: &FiniteJ2FrameCoupledRequest,
) -> Result<FiniteJ2TetResult, String> {
    if request.frames.is_empty() {
        return Err("finite J2 frame coupled route needs at least one frame".into());
    }
    solve_impl(
        &request.volume,
        &request.trusses,
        &request.membranes,
        &request.hexes,
        &request.hex_targets,
        &request.frames,
        &request.frame_targets,
        &request.bending_plates,
        &request.frame_member_load_targets,
        &request.frame_member_point_load_targets,
    )
}

fn solve_impl(
    request: &FiniteJ2TetRequest,
    input_trusses: &[FiniteJ2CoupledTruss],
    input_membranes: &[FiniteJ2CoupledMembrane],
    input_hexes: &[FiniteJ2HexCell],
    hex_targets: &[FiniteJ2HexTarget],
    input_frames: &[FiniteJ2CoupledFrame],
    frame_targets: &[FiniteJ2FrameTarget],
    input_bending_plates: &[FiniteJ2CoupledBendingPlate],
    frame_member_load_targets: &[Vec<FiniteJ2CoupledFrameMemberLoad>],
    frame_member_point_load_targets: &[Vec<FiniteJ2CoupledFrameMemberPointLoad>],
) -> Result<FiniteJ2TetResult, String> {
    let n = request.mesh.nodes.len();
    let dofs = n
        .checked_mul(if input_frames.is_empty() { 3 } else { 6 })
        .ok_or("finite J2 Tet4 DOF count overflow")?;
    let automatic_large_frontal = request.options.linear_backend
        == FiniteJ2TetLinearBackend::Automatic
        && (dofs > MAX_GMRES_DOFS
            || request
                .mesh
                .tets
                .len()
                .checked_add(input_hexes.len())
                .is_none_or(|count| count > MAX_GMRES_TETS)
            || input_trusses.len() > MAX_GMRES_TETS
            || input_membranes.len() > MAX_GMRES_TETS
            || input_frames.len() > MAX_GMRES_TETS
            || input_bending_plates.len() > MAX_GMRES_TETS);
    let (max_dofs, max_tets) = match request.options.linear_backend {
        FiniteJ2TetLinearBackend::Dense => (MAX_DENSE_DOFS, MAX_DENSE_TETS),
        FiniteJ2TetLinearBackend::SparseGmres => (MAX_GMRES_DOFS, MAX_GMRES_TETS),
        FiniteJ2TetLinearBackend::FrontalWave => (MAX_FRONTAL_DOFS, MAX_FRONTAL_TETS),
        FiniteJ2TetLinearBackend::MatrixFreeGmres => (MAX_MATRIX_FREE_DOFS, MAX_MATRIX_FREE_TETS),
        FiniteJ2TetLinearBackend::MatrixFreeGmresLarge => {
            (MAX_LARGE_MATRIX_FREE_DOFS, MAX_LARGE_MATRIX_FREE_TETS)
        }
        FiniteJ2TetLinearBackend::Automatic if automatic_large_frontal => {
            (MAX_FRONTAL_DOFS, MAX_FRONTAL_TETS)
        }
        FiniteJ2TetLinearBackend::Automatic => (MAX_GMRES_DOFS, MAX_GMRES_TETS),
    };
    if !(1..=max_dofs).contains(&dofs)
        || request
            .mesh
            .tets
            .len()
            .checked_add(input_hexes.len())
            .is_none_or(|count| count == 0 || count > max_tets)
    {
        return Err(format!(
            "finite J2 Tet4 {:?} limit: 1..={max_dofs} DOF and 1..={max_tets} elements",
            request.options.linear_backend
        ));
    }
    if input_trusses.len() > max_tets
        || input_membranes.len() > max_tets
        || input_frames.len() > max_tets
        || input_bending_plates.len() > max_tets.min(MAX_COUPLED_DKT_PLATES)
    {
        return Err(format!(
            "finite J2 coupled route exceeds bounded truss, membrane, frame or DKT plate count"
        ));
    }
    if request.options.linear_backend == FiniteJ2TetLinearBackend::MatrixFreeGmres
        && request
            .mesh
            .tets
            .len()
            .checked_mul(144)
            .and_then(|count| {
                input_hexes
                    .len()
                    .checked_mul(
                        std::mem::size_of::<HexTangent>().div_ceil(std::mem::size_of::<f64>()),
                    )
                    .and_then(|extra| count.checked_add(extra))
            })
            .and_then(|count| {
                input_trusses
                    .len()
                    .checked_mul(36)
                    .and_then(|extra| count.checked_add(extra))
                    .and_then(|count| {
                        input_membranes
                            .len()
                            .checked_mul(81)
                            .and_then(|extra| count.checked_add(extra))
                            .and_then(|count| {
                                input_frames
                                    .len()
                                    .checked_mul(144)
                                    .and_then(|extra| count.checked_add(extra))
                                    .and_then(|count| {
                                        count.checked_add(
                                            input_bending_plates.len().checked_mul(81)?,
                                        )
                                    })
                            })
                    })
            })
            .ok_or("finite J2 matrix-free storage overflow")?
            > MAX_MATRIX_FREE_CACHE_SCALAR_EQUIVALENTS
    {
        return Err(
            "finite J2 matrix-free local tangent cache exceeds 5,184,000 scalar equivalents".into(),
        );
    }
    if request.options.linear_backend == FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
        && request
            .mesh
            .tets
            .len()
            .checked_mul(144)
            .and_then(|count| {
                input_hexes
                    .len()
                    .checked_mul(
                        std::mem::size_of::<HexTangent>().div_ceil(std::mem::size_of::<f64>()),
                    )
                    .and_then(|extra| count.checked_add(extra))
            })
            .and_then(|count| {
                input_trusses
                    .len()
                    .checked_mul(36)
                    .and_then(|extra| count.checked_add(extra))
                    .and_then(|count| {
                        input_membranes
                            .len()
                            .checked_mul(81)
                            .and_then(|extra| count.checked_add(extra))
                            .and_then(|count| {
                                input_frames
                                    .len()
                                    .checked_mul(144)
                                    .and_then(|extra| count.checked_add(extra))
                                    .and_then(|count| {
                                        count.checked_add(
                                            input_bending_plates.len().checked_mul(81)?,
                                        )
                                    })
                            })
                    })
            })
            .ok_or("finite J2 large matrix-free storage overflow")?
            > MAX_LARGE_MATRIX_FREE_CACHE_SCALAR_EQUIVALENTS
    {
        return Err(
            "finite J2 large matrix-free local tangent cache exceeds 43,200,000 scalar equivalents"
                .into(),
        );
    }
    if !(1..=MAX_TARGETS).contains(&request.targets.len()) {
        return Err(format!("finite J2 Tet4 needs 1..={MAX_TARGETS} targets"));
    }
    if !frame_member_load_targets.is_empty()
        && frame_member_load_targets.len() != request.targets.len()
    {
        return Err("finite J2 frameMemberLoadTargets must match volume.targets".into());
    }
    if !frame_member_point_load_targets.is_empty()
        && frame_member_point_load_targets.len() != request.targets.len()
    {
        return Err("finite J2 frameMemberPointLoadTargets must match volume.targets".into());
    }
    let frame_member_load_count = frame_member_load_targets
        .iter()
        .try_fold(0usize, |count, target| count.checked_add(target.len()))
        .ok_or("finite J2 frame member load count overflow")?;
    let frame_member_point_load_count = frame_member_point_load_targets
        .iter()
        .try_fold(0usize, |count, target| count.checked_add(target.len()))
        .ok_or("finite J2 frame member point load count overflow")?;
    if frame_member_load_count
        .checked_add(frame_member_point_load_count)
        .ok_or("finite J2 frame member load count overflow")?
        > MAX_COUPLED_FRAME_MEMBER_LOADS
    {
        return Err(format!(
            "finite J2 frame member loads exceed {MAX_COUPLED_FRAME_MEMBER_LOADS} line/point records across targets"
        ));
    }
    let frame_member_load_bytes = frame_member_load_count
        .checked_mul(std::mem::size_of::<FiniteJ2CoupledFrameMemberLoad>())
        .and_then(|bytes| {
            frame_member_point_load_count
                .checked_mul(std::mem::size_of::<FiniteJ2CoupledFrameMemberPointLoad>())
                .and_then(|point_bytes| bytes.checked_add(point_bytes))
        })
        .and_then(|bytes| {
            if frame_member_load_count + frame_member_point_load_count == 0 {
                Some(bytes)
            } else {
                input_frames
                    .len()
                    .checked_mul(std::mem::size_of::<[f64; 12]>())
                    .and_then(|equivalents| bytes.checked_add(equivalents))
            }
        })
        .ok_or("finite J2 frame member load memory estimate overflow")?;
    if !input_hexes.is_empty() && hex_targets.len() != request.targets.len() {
        return Err("finite J2 Hex8 hexTargets must match volume.targets".into());
    }
    let options = request.options;
    if !options.residual_tolerance.is_finite()
        || options.residual_tolerance <= 0.0
        || options.residual_tolerance >= 1.0
        || !(1..=MAX_NEWTON).contains(&options.max_newton_iterations)
        || options.max_line_search_halvings > MAX_LINE_HALVINGS
        || !(1..=MAX_CUTBACKS).contains(&options.max_cutbacks)
        || !options.min_step_fraction.is_finite()
        || options.min_step_fraction <= 0.0
        || options.min_step_fraction > 1.0
        || !(1..=MAX_GMRES_RESTART).contains(&options.gmres_restart)
        || !(1..=MAX_GMRES_ITERATIONS).contains(&options.gmres_max_iterations)
        || !options.gmres_relative_tolerance.is_finite()
        || options.gmres_relative_tolerance <= 0.0
        || options.gmres_relative_tolerance >= 1.0
        || !(1..=MAX_FRONT_DOFS).contains(&options.max_front_dofs)
        || !(1..=MAX_MATRIX_FREE_THREADS).contains(&options.matrix_free_threads)
    {
        return Err("invalid finite J2 Tet4 Newton/step options".into());
    }
    if options.linear_backend == FiniteJ2TetLinearBackend::FrontalWave || automatic_large_frontal {
        // The live front is bounded separately by max_front_dofs. Retained
        // elimination rows can still grow with every global DOF, so admit
        // larger coupled frame/solid models only under a storage estimate.
        let local_scalars = request
            .mesh
            .tets
            .len()
            .checked_mul(144)
            .and_then(|value| value.checked_add(input_hexes.len().checked_mul(576)?))
            .and_then(|value| value.checked_add(input_trusses.len().checked_mul(36)?))
            .and_then(|value| value.checked_add(input_membranes.len().checked_mul(81)?))
            .and_then(|value| value.checked_add(input_frames.len().checked_mul(144)?))
            .and_then(|value| value.checked_add(input_bending_plates.len().checked_mul(81)?))
            .ok_or("finite J2 frontal storage estimate overflow")?;
        let element_count = request.mesh.tets.len()
            + input_hexes.len()
            + input_trusses.len()
            + input_membranes.len()
            + input_frames.len()
            + input_bending_plates.len();
        let estimated_bytes = dofs
            .checked_mul(
                options
                    .max_front_dofs
                    .checked_mul(16)
                    .ok_or("finite J2 frontal storage estimate overflow")?
                    + 64,
            )
            .and_then(|value| {
                value.checked_add(
                    options
                        .max_front_dofs
                        .checked_mul(options.max_front_dofs)?
                        .checked_mul(8)?,
                )
            })
            .and_then(|value| value.checked_add(local_scalars.checked_mul(8)?))
            .and_then(|value| value.checked_add(element_count.checked_mul(64)?))
            .and_then(|value| value.checked_add(frame_member_load_bytes))
            .ok_or("finite J2 frontal storage estimate overflow")?;
        if estimated_bytes > MAX_FRONTAL_ESTIMATED_BYTES {
            return Err(format!(
                "finite J2 frontal storage estimate {estimated_bytes} bytes exceeds {MAX_FRONTAL_ESTIMATED_BYTES} byte budget"
            ));
        }
    }
    if options.linear_backend == FiniteJ2TetLinearBackend::MatrixFreeGmresLarge {
        let basis_scalars = dofs
            .checked_mul(options.gmres_restart.min(dofs) + 1)
            .ok_or("finite J2 large matrix-free GMRES basis size overflow")?;
        if basis_scalars > MAX_LARGE_MATRIX_FREE_BASIS_SCALARS {
            return Err(format!(
                "finite J2 large matrix-free GMRES basis exceeds {} scalars",
                MAX_LARGE_MATRIX_FREE_BASIS_SCALARS
            ));
        }
        let frame_memory = if input_frames.is_empty() {
            0
        } else {
            input_frames
                .len()
                .checked_mul(
                    std::mem::size_of::<Frame>()
                        + std::mem::size_of::<FrameTangent>()
                        + std::mem::size_of::<[[f64; 6]; 2]>(),
                )
                .and_then(|bytes| {
                    frame_targets
                        .len()
                        .checked_mul(n)?
                        .checked_mul(
                            std::mem::size_of::<[f64; 3]>() * 2
                                + std::mem::size_of::<[Option<f64>; 3]>(),
                        )?
                        .checked_add(bytes)
                })
                .and_then(|bytes| {
                    n.checked_mul(2 * std::mem::size_of::<[f64; 3]>())?
                        .checked_add(bytes)
                })
                .ok_or("finite J2 frame memory estimate overflow")?
        };
        let estimated = large_matrix_free_estimated_bytes_coupled(
            request,
            input_trusses.len(),
            input_membranes.len(),
            dofs,
        )?
        .checked_add(frame_memory)
        .ok_or("finite J2 frame memory estimate overflow")?
        .checked_add(
            input_bending_plates
                .len()
                .checked_mul(
                    std::mem::size_of::<FiniteJ2CoupledBendingPlate>()
                        + std::mem::size_of::<BendingPlate>() * 3
                        + std::mem::size_of::<[f64; 3]>(),
                )
                .ok_or("finite J2 DKT memory estimate overflow")?,
        )
        .ok_or("finite J2 DKT memory estimate overflow")?
        .checked_add(hex_large_estimated_bytes(input_hexes.len(), hex_targets)?)
        .and_then(|bytes| bytes.checked_add(frame_member_load_bytes))
        .ok_or("finite J2 Hex8 memory estimate overflow")?;
        if estimated > MAX_LARGE_MATRIX_FREE_ESTIMATED_BYTES {
            return Err(format!(
                "finite J2 large matrix-free estimated working set {estimated} bytes exceeds {}-byte budget",
                MAX_LARGE_MATRIX_FREE_ESTIMATED_BYTES
            ));
        }
    }
    let validate_steel = |steel: FiniteJ2Steel| {
        FiniteJ2Steel::new(
            steel.youngs_mpa,
            steel.poisson,
            steel.yield_mpa,
            steel.hardening_mpa,
        )
    };
    validate_steel(request.steel)?;
    let steels = if let Some(values) = &request.element_steels {
        if values.len() != request.mesh.tets.len() {
            return Err("finite J2 Tet4 elementSteels must match mesh.tets".into());
        }
        for (index, &steel) in values.iter().enumerate() {
            validate_steel(steel).map_err(|error| format!("elementSteels[{index}]: {error}"))?;
        }
        fallible_copy(values, "element steel")?
    } else {
        fallible_filled(request.mesh.tets.len(), request.steel, "element steel")?
    };
    let tets = prepare_tets(&request.mesh)?;
    let mut hexes = prepare_hexes(&request.mesh, input_hexes)?;
    let mut trusses = prepare_trusses(&request.mesh, input_trusses)?;
    let mut membranes = prepare_membranes(&request.mesh, input_membranes)?;
    let frames = prepare_frames(
        &request.mesh,
        input_frames,
        request.options.geometric_frames,
    )?;
    let bending_plates = prepare_bending_plates(&request.mesh, input_hexes, input_bending_plates)?;
    if !frames.is_empty() && frame_targets.len() != request.targets.len() {
        return Err("finite J2 frameTargets must match volume.targets".into());
    }
    let mut rotation_active = vec![[false; 3]; n];
    for frame in &frames {
        for &node in &frame.nodes {
            rotation_active[node] = [true; 3];
        }
    }
    for plate in &bending_plates {
        for &node in &plate.nodes {
            rotation_active[node][0] = true;
            rotation_active[node][1] = true;
        }
    }
    let mask = validate_target(&request.targets[0], n, None)?;
    let mut mask = mask;
    if !frames.is_empty() {
        mask.extend(validate_frame_target(
            &frame_targets[0],
            n,
            &rotation_active,
            None,
        )?);
    }
    if !mask.iter().any(|&fixed| fixed) {
        return Err("finite J2 Tet4 has no prescribed DOF".into());
    }
    for (index, target) in request.targets.iter().enumerate().skip(1) {
        validate_target(target, n, Some(&mask[..3 * n]))?;
        if !frames.is_empty() {
            validate_frame_target(
                &frame_targets[index],
                n,
                &rotation_active,
                Some(&mask[3 * n..]),
            )?;
        }
    }
    // Validate and assemble every absolute target before starting Newton. For
    // linear Tet4 interpolation, ∫N_i dV0 = V0/4 and ∫N_i dA0 = A0/3.
    let mut target_loads = Vec::new();
    target_loads
        .try_reserve_exact(request.targets.len())
        .map_err(|error| format!("finite J2 target load allocation: {error}"))?;
    let mut final_frame_equivalent = Vec::new();
    for (index, target) in request.targets.iter().enumerate() {
        let mut assembled = assemble_target_loads(target, &request.mesh, &tets)
            .and_then(|loads| {
                if input_hexes.is_empty() {
                    Ok(loads)
                } else {
                    assemble_hex_target_loads(loads, &hex_targets[index], &hexes)
                }
            })
            .map_err(|error| format!("finite J2 Tet4 target {index}: {error}"))?;
        if !frames.is_empty() {
            for triplet in &frame_targets[index].moments_kn_m {
                assembled.extend_from_slice(triplet);
            }
        }
        let member_loads = frame_member_load_targets
            .get(index)
            .map_or(&[][..], Vec::as_slice);
        let member_point_loads = frame_member_point_load_targets
            .get(index)
            .map_or(&[][..], Vec::as_slice);
        let equivalent = assemble_frame_member_load_target(
            &frames,
            member_loads,
            member_point_loads,
            &mut assembled,
            n,
        )
        .map_err(|error| format!("finite J2 Tet4 target {index}: {error}"))?;
        if index + 1 == request.targets.len() {
            final_frame_equivalent = equivalent;
        }
        target_loads.push(assembled);
    }
    let mut u = fallible_zeroed(dofs, "displacement")?;
    let mut loads = fallible_zeroed(dofs, "load")?;
    let mut prescribed: Vec<Option<f64>> = mask.iter().map(|&fixed| fixed.then_some(0.0)).collect();
    let mut history = fallible_filled(tets.len(), FiniteJ2State::default(), "history")?;
    let mut final_eval = evaluate_coupled(
        &tets,
        &hexes,
        &trusses,
        &membranes,
        &frames,
        &bending_plates,
        &steels,
        &history,
        &u,
        None,
    )?;
    let mut final_residual = 0.0;
    let mut accepted_steps = Vec::new();
    let mut cutbacks = 0;
    let mut backend_used = if automatic_large_frontal {
        FiniteJ2TetLinearBackend::FrontalWave
    } else if options.linear_backend == FiniteJ2TetLinearBackend::Automatic {
        FiniteJ2TetLinearBackend::SparseGmres
    } else {
        options.linear_backend
    };
    let mut frontal_fallbacks = 0;
    for (target_index, target) in request.targets.iter().enumerate() {
        let end_loads = &target_loads[target_index];
        let mut end_prescribed: Vec<Option<f64>> =
            target.prescribed_m.iter().flatten().copied().collect();
        if !frames.is_empty() {
            end_prescribed.extend(
                frame_targets[target_index]
                    .prescribed_rotation_rad
                    .iter()
                    .enumerate()
                    .flat_map(|(node, rotation)| {
                        let active = rotation_active[node];
                        rotation.iter().enumerate().map(move |(axis, value)| {
                            if active[axis] {
                                *value
                            } else {
                                Some(0.0)
                            }
                        })
                    }),
            );
        }
        let start_loads = loads.clone();
        let start_prescribed = prescribed.clone();
        let mut fraction = 0.0_f64;
        let mut increment = 1.0_f64;
        while fraction < 1.0 - 1e-14 {
            let next = (fraction + increment).min(1.0);
            let trial_loads: Vec<f64> = start_loads
                .iter()
                .zip(end_loads)
                .map(|(a, b)| (1.0 - next) * a + next * b)
                .collect();
            let trial_prescribed: Vec<Option<f64>> = start_prescribed
                .iter()
                .zip(&end_prescribed)
                .map(|(a, b)| match (a, b) {
                    (Some(a), Some(b)) => Some((1.0 - next) * a + next * b),
                    (None, None) => None,
                    _ => unreachable!("support mask validated"),
                })
                .collect();
            if trial_loads.iter().any(|x| !x.is_finite())
                || trial_prescribed.iter().flatten().any(|x| !x.is_finite())
            {
                return Err(format!(
                    "finite J2 Tet4 target {target_index}: interpolation overflow"
                ));
            }
            let step = solve_one_step(
                &tets,
                &hexes,
                &trusses,
                &membranes,
                &frames,
                &bending_plates,
                &steels,
                &history,
                &u,
                &trial_loads,
                &trial_prescribed,
                options,
                backend_used,
            )
            .or_else(|error| {
                // Restart from the last accepted state. Switching tangent
                // backends inside a stalled Newton path need not recover the
                // step, because the trial iterates already differ. A fresh
                // frontal solve keeps the same loads and convergence limit.
                if options.linear_backend == FiniteJ2TetLinearBackend::Automatic
                    && backend_used == FiniteJ2TetLinearBackend::SparseGmres
                    && error.starts_with("finite J2 Tet4 line search stalled")
                    && fits_frontal_recovery_front_coupled(
                        &tets,
                        &hexes,
                        &trusses,
                        &membranes,
                        &frames,
                        &bending_plates,
                        &trial_prescribed,
                        options.max_front_dofs,
                    )
                {
                    let mut step = solve_one_step(
                        &tets,
                        &hexes,
                        &trusses,
                        &membranes,
                        &frames,
                        &bending_plates,
                        &steels,
                        &history,
                        &u,
                        &trial_loads,
                        &trial_prescribed,
                        options,
                        FiniteJ2TetLinearBackend::FrontalWave,
                    )?;
                    step.frontal_fallbacks += 1;
                    Ok(step)
                } else {
                    Err(error)
                }
            });
            match step {
                Ok(step) => {
                    backend_used = step.backend_used;
                    frontal_fallbacks += step.frontal_fallbacks;
                    u = step.u;
                    history = step.evaluation.states.clone();
                    for (hex, state) in hexes.iter_mut().zip(&step.evaluation.hex_states) {
                        hex.state = *state;
                    }
                    for (truss, state) in trusses.iter_mut().zip(&step.evaluation.truss_states) {
                        truss.state = *state;
                    }
                    for (membrane, state) in
                        membranes.iter_mut().zip(&step.evaluation.membrane_states)
                    {
                        membrane.state = *state;
                    }
                    final_eval = step.evaluation;
                    final_residual = step.residual;
                    loads = trial_loads;
                    prescribed = trial_prescribed;
                    fraction = next;
                    accepted_steps.push(FiniteJ2AcceptedStep {
                        target_index,
                        target_fraction: next,
                        newton_iterations: step.iterations,
                        true_free_residual_kn: step.residual,
                    });
                    increment = (increment * 1.5).min(1.0 - fraction);
                }
                Err(error) => {
                    cutbacks += 1;
                    increment *= 0.5;
                    if cutbacks > options.max_cutbacks || increment < options.min_step_fraction {
                        return Err(format!(
                            "finite J2 Tet4 target {target_index} failed after {cutbacks} cutbacks near fraction {fraction:.6}: {error}"
                        ));
                    }
                }
            }
        }
    }
    let reactions: Vec<f64> = final_eval
        .internal
        .iter()
        .zip(&loads)
        .map(|(a, b)| a - b)
        .collect();
    if reactions.iter().any(|x| !x.is_finite()) {
        return Err("finite J2 Tet4 reaction overflow".into());
    }
    let bending_plate_moments_knm_per_m =
        recover_bending_plate_moments(&request.mesh, input_bending_plates, &u)?;
    Ok(FiniteJ2TetResult {
        nodal_displacements_m: u[..3 * n]
            .chunks_exact(3)
            .map(|x| [x[0], x[1], x[2]])
            .collect(),
        nodal_reactions_kn: reactions[..3 * n]
            .chunks_exact(3)
            .map(|x| [x[0], x[1], x[2]])
            .collect(),
        nodal_rotations_rad: u[3 * n..]
            .chunks_exact(3)
            .map(|x| [x[0], x[1], x[2]])
            .collect(),
        nodal_reaction_moments_kn_m: reactions[3 * n..]
            .chunks_exact(3)
            .map(|x| [x[0], x[1], x[2]])
            .collect(),
        frame_end_forces_local: frames
            .iter()
            .enumerate()
            .map(|(index, frame)| frame.end_forces_local(&u, n, final_frame_equivalent.get(index)))
            .collect(),
        bending_plate_moments_knm_per_m,
        element_states: history,
        element_first_piola_mpa: final_eval.first_piola,
        hex_gauss_states: final_eval.hex_states,
        hex_gauss_first_piola_mpa: final_eval.hex_first_piola,
        hex_gauss_cauchy_mpa: final_eval.hex_cauchy,
        truss_axial_force_kn: final_eval.truss_forces,
        truss_states: final_eval.truss_states,
        truss_algorithmic_modulus_mpa: final_eval.truss_moduli,
        membrane_stress_mpa: final_eval.membrane_stress,
        membrane_states: final_eval.membrane_states,
        membrane_thickness_stretch: final_eval.membrane_thickness_stretch,
        membrane_kirchhoff_mpa: final_eval.membrane_kirchhoff,
        membrane_cauchy_mpa: final_eval.membrane_cauchy,
        membrane_force_resultant_kn_per_m: final_eval.membrane_force_resultant,
        accepted_steps,
        cutbacks,
        true_free_residual_kn: final_residual,
        linear_backend_used: backend_used,
        frontal_fallbacks,
    })
}

/// Conservative peak-memory gate for the separately enabled large backend.
/// Includes input mesh/targets, two simultaneously live element tangents at a
/// target transition, committed/trial histories and stress results, Newton
/// vectors, worker accumulators and the largest Krylov basis. It is a budget,
/// not a prediction of an allocator's exact resident set.
#[cfg(test)]
fn large_matrix_free_estimated_bytes(
    request: &FiniteJ2TetRequest,
    dofs: usize,
) -> Result<usize, String> {
    large_matrix_free_estimated_bytes_coupled(request, 0, 0, dofs)
}

fn large_matrix_free_estimated_bytes_coupled(
    request: &FiniteJ2TetRequest,
    trusses: usize,
    membranes: usize,
    dofs: usize,
) -> Result<usize, String> {
    fn add(total: &mut usize, count: usize, bytes: usize) -> Result<(), String> {
        let part = count
            .checked_mul(bytes)
            .ok_or("finite J2 large matrix-free memory estimate overflow")?;
        *total = total
            .checked_add(part)
            .ok_or("finite J2 large matrix-free memory estimate overflow")?;
        Ok(())
    }
    let mut total = 0usize;
    let tets = request.mesh.tets.len();
    let per_tet = 2usize
        .checked_mul(std::mem::size_of::<ElementTangent>())
        .and_then(|value| value.checked_add(std::mem::size_of::<Tet>()))
        .and_then(|value| value.checked_add(8 * std::mem::size_of::<FiniteJ2State>()))
        .and_then(|value| value.checked_add(6 * std::mem::size_of::<Tensor3>()))
        .and_then(|value| value.checked_add(2 * std::mem::size_of::<FiniteJ2Steel>()))
        .ok_or("finite J2 large matrix-free memory estimate overflow")?;
    add(&mut total, tets, per_tet)?;
    add(
        &mut total,
        trusses,
        2 * std::mem::size_of::<TrussTangent>()
            + std::mem::size_of::<Truss>()
            + std::mem::size_of::<FiniteJ2CoupledTruss>(),
    )?;
    add(
        &mut total,
        membranes,
        2 * std::mem::size_of::<MembraneTangent>()
            + std::mem::size_of::<Membrane>()
            + std::mem::size_of::<FiniteJ2CoupledMembrane>()
            + 3 * std::mem::size_of::<Option<FiniteJ2State>>()
            + std::mem::size_of::<Option<Tensor3>>()
            + 2 * std::mem::size_of::<Option<[f64; 3]>>()
            + std::mem::size_of::<Option<f64>>(),
    )?;
    add(
        &mut total,
        request.mesh.nodes.len(),
        std::mem::size_of::<[f64; 3]>(),
    )?;
    add(&mut total, tets, std::mem::size_of::<[usize; 4]>())?;
    // Newton, reduced/free, reaction and product vectors, plus one full
    // accumulator per worker. The actual worker count is bounded at 16.
    add(
        &mut total,
        dofs,
        (32 + request.options.matrix_free_threads)
            .checked_mul(std::mem::size_of::<f64>())
            .ok_or("finite J2 large matrix-free memory estimate overflow")?,
    )?;
    let basis_vectors = request.options.gmres_restart.min(dofs) + 1;
    add(
        &mut total,
        dofs.checked_mul(basis_vectors)
            .ok_or("finite J2 large matrix-free memory estimate overflow")?,
        std::mem::size_of::<f64>(),
    )?;
    for target in &request.targets {
        add(
            &mut total,
            target.loads_kn.len(),
            std::mem::size_of::<[f64; 3]>(),
        )?;
        add(
            &mut total,
            target.prescribed_m.len(),
            std::mem::size_of::<[Option<f64>; 3]>(),
        )?;
        add(
            &mut total,
            target.body_forces.len(),
            std::mem::size_of::<FiniteJ2TetBodyForce>(),
        )?;
        add(
            &mut total,
            target.face_tractions.len(),
            std::mem::size_of::<FiniteJ2TetFaceTraction>(),
        )?;
        // Each absolute target is assembled into a full nodal load vector.
        add(&mut total, dofs, std::mem::size_of::<f64>())?;
    }
    // Leave 64 MiB for small vectors, allocator metadata and thread stacks.
    add(&mut total, 1, 64 * 1024 * 1024)?;
    Ok(total)
}

fn hex_large_estimated_bytes(hexes: usize, targets: &[FiniteJ2HexTarget]) -> Result<usize, String> {
    let per_hex = 2 * std::mem::size_of::<HexTangent>()
        + std::mem::size_of::<Hex>()
        + std::mem::size_of::<FiniteJ2Hex8Geometry>()
        + std::mem::size_of::<FiniteJ2HexCell>()
        + 8 * (8 * std::mem::size_of::<FiniteJ2State>() + 6 * std::mem::size_of::<Tensor3>());
    let mut total = hexes
        .checked_mul(per_hex)
        .ok_or("finite J2 Hex8 memory estimate overflow")?;
    for target in targets {
        total = total
            .checked_add(
                target
                    .body_forces
                    .len()
                    .checked_mul(std::mem::size_of::<FiniteJ2HexBodyForce>())
                    .ok_or("finite J2 Hex8 memory estimate overflow")?,
            )
            .and_then(|value| {
                value.checked_add(
                    target
                        .face_tractions
                        .len()
                        .checked_mul(std::mem::size_of::<FiniteJ2HexFaceTraction>())?,
                )
            })
            .ok_or("finite J2 Hex8 memory estimate overflow")?;
    }
    Ok(total)
}

fn solve_one_step(
    tets: &[Tet],
    hexes: &[Hex],
    trusses: &[Truss],
    membranes: &[Membrane],
    frames: &[Frame],
    plates: &[BendingPlate],
    steels: &[FiniteJ2Steel],
    history: &[FiniteJ2State],
    previous: &[f64],
    loads: &[f64],
    prescribed: &[Option<f64>],
    options: FiniteJ2TetOptions,
    initial_backend: FiniteJ2TetLinearBackend,
) -> Result<Step, String> {
    let mut backend_used = initial_backend;
    let mut frontal_fallbacks = 0;
    let mut u = previous.to_vec();
    let free: Vec<usize> = prescribed
        .iter()
        .enumerate()
        .filter_map(|(i, x)| x.is_none().then_some(i))
        .collect();
    let mut du_fixed = vec![0.0; u.len()];
    for (i, x) in prescribed.iter().enumerate() {
        if let Some(value) = x {
            du_fixed[i] = value - u[i];
            u[i] = *value;
        }
    }
    // Linear predictor for displacement-driven steps; failures are harmless
    // because Newton still starts from the exact prescribed boundary values.
    if !free.is_empty() && du_fixed.iter().any(|x| *x != 0.0) {
        if let Ok(old) = evaluate_coupled(
            tets,
            hexes,
            trusses,
            membranes,
            frames,
            plates,
            steels,
            history,
            previous,
            Some(backend_used),
        ) {
            let k = old.tangent.as_ref().unwrap();
            let mut rhs: Vec<f64> = loads
                .iter()
                .zip(&old.internal)
                .map(|(a, b)| a - b)
                .collect();
            if let Ok(product) = tangent_product(k, &du_fixed) {
                for &i in &free {
                    rhs[i] -= product[i];
                }
                if let Ok(delta) = solve_selected(k, &free, &rhs, options) {
                    let mut predicted = u.clone();
                    for &i in &free {
                        predicted[i] += delta[i];
                    }
                    if evaluate_coupled(
                        tets, hexes, trusses, membranes, frames, plates, steels, history,
                        &predicted, None,
                    )
                    .is_ok()
                    {
                        u = predicted;
                    }
                }
            }
        }
    }
    let mut reference = norm(free.iter().map(|&i| loads[i]))?.max(1.0);
    for iteration in 0..=options.max_newton_iterations {
        let mut evaluation = evaluate_with_recovery(
            tets,
            hexes,
            trusses,
            membranes,
            frames,
            plates,
            steels,
            history,
            &u,
            prescribed,
            options,
            &mut backend_used,
            &mut frontal_fallbacks,
        )?;
        let rhs: Vec<f64> = loads
            .iter()
            .zip(&evaluation.internal)
            .map(|(a, b)| a - b)
            .collect();
        let true_norm = norm(free.iter().map(|&i| rhs[i]))?;
        if iteration == 0 {
            reference = reference.max(true_norm);
            reference = reference.max(norm(
                prescribed
                    .iter()
                    .enumerate()
                    .filter_map(|(i, x)| x.map(|_| rhs[i])),
            )?);
        }
        let k = evaluation.tangent.as_ref().unwrap();
        let tangent_scale = free
            .iter()
            .fold(0.0_f64, |a, &i| a.max(tangent_diagonal(k, i).abs()));
        let displacement_scale = u.iter().fold(0.0_f64, |a, &x| a.max(x.abs()));
        let roundoff = 32.0 * f64::EPSILON * tangent_scale * displacement_scale;
        let limit = options.residual_tolerance * reference + roundoff;
        if !limit.is_finite() {
            return Err("finite J2 Tet4 convergence scale overflow".into());
        }
        if true_norm <= limit {
            // Rank check even for zero RHS; otherwise a mechanism could pass
            // because its residual happens to vanish at the initial state.
            solve_with_recovery(
                &mut evaluation,
                tets,
                hexes,
                trusses,
                membranes,
                frames,
                plates,
                steels,
                history,
                &u,
                prescribed,
                &free,
                &vec![0.0; u.len()],
                options,
                &mut backend_used,
                &mut frontal_fallbacks,
            )?;
            return Ok(Step {
                u,
                evaluation,
                residual: true_norm,
                iterations: iteration,
                backend_used,
                frontal_fallbacks,
            });
        }
        if iteration == options.max_newton_iterations {
            return Err(format!(
                "finite J2 Tet4 Newton failed, residual {true_norm:.6e} kN"
            ));
        }
        let delta = solve_with_recovery(
            &mut evaluation,
            tets,
            hexes,
            trusses,
            membranes,
            frames,
            plates,
            steels,
            history,
            &u,
            prescribed,
            &free,
            &rhs,
            options,
            &mut backend_used,
            &mut frontal_fallbacks,
        )?;
        let mut accepted = false;
        let mut scale = 1.0;
        for _ in 0..=options.max_line_search_halvings {
            let mut candidate = u.clone();
            for &i in &free {
                candidate[i] += scale * delta[i];
            }
            if let Ok(trial) = evaluate_coupled(
                tets, hexes, trusses, membranes, frames, plates, steels, history, &candidate, None,
            ) {
                if let Ok(candidate_norm) = norm(free.iter().map(|&i| loads[i] - trial.internal[i]))
                {
                    if candidate_norm <= limit || candidate_norm < true_norm * (1.0 - 1e-4 * scale)
                    {
                        u = candidate;
                        accepted = true;
                        break;
                    }
                }
            }
            scale *= 0.5;
        }
        if !accepted {
            return Err(format!(
                "finite J2 Tet4 line search stalled, residual {true_norm:.6e} kN"
            ));
        }
    }
    unreachable!()
}

fn retryable_sparse_failure(
    requested: FiniteJ2TetLinearBackend,
    active: FiniteJ2TetLinearBackend,
    cause: &str,
) -> bool {
    requested == FiniteJ2TetLinearBackend::Automatic
        && active == FiniteJ2TetLinearBackend::SparseGmres
        && (cause == "block CSR exceeds the temporary node-slot budget"
            || cause == "block CSR exceeds the scalar nonzero budget"
            || cause == "CSR pattern exceeds the temporary slot budget"
            || cause == "CSR pattern exceeds the nonzero budget"
            || cause.starts_with("finite J2 sparse GMRES: GMRES failed to converge in ")
            || cause.starts_with("finite J2 sparse GMRES: GMRES stagnated after "))
}

/// Match the frontal solver's pre-assembly free-DOF wavefront accounting.
/// A bounded front is a prerequisite for recovery, not a stability proof.
#[cfg(test)]
fn fits_frontal_recovery_front(tets: &[Tet], prescribed: &[Option<f64>], limit: usize) -> bool {
    fits_frontal_recovery_front_coupled(tets, &[], &[], &[], &[], &[], prescribed, limit)
}

fn fits_frontal_recovery_front_coupled(
    tets: &[Tet],
    hexes: &[Hex],
    trusses: &[Truss],
    membranes: &[Membrane],
    frames: &[Frame],
    plates: &[BendingPlate],
    prescribed: &[Option<f64>],
    limit: usize,
) -> bool {
    // The legacy wavefront estimate handles full 3/6-DOF elements only.
    // Never certify an automatic fallback that ignores DKT-only rotation
    // couplings; explicit frontal solves retain their own exact front cap.
    if !plates.is_empty() {
        return false;
    }
    let elements: Vec<&[usize]> = tets
        .iter()
        .map(|tet| tet.nodes.as_slice())
        .chain(hexes.iter().map(|hex| hex.nodes.as_slice()))
        .chain(trusses.iter().map(|truss| truss.nodes.as_slice()))
        .chain(membranes.iter().map(|membrane| membrane.nodes.as_slice()))
        .chain(frames.iter().map(|frame| frame.nodes.as_slice()))
        .collect();
    let mut last = vec![None; prescribed.len()];
    for (element, nodes) in elements.iter().enumerate() {
        for &node in *nodes {
            for axis in 0..if element >= elements.len() - frames.len() {
                6
            } else {
                3
            } {
                let dof = if axis < 3 {
                    3 * node + axis
                } else {
                    prescribed.len() / 2 + 3 * node + axis - 3
                };
                if prescribed[dof].is_none() {
                    last[dof] = Some(element);
                }
            }
        }
    }
    if prescribed
        .iter()
        .enumerate()
        .any(|(dof, value)| value.is_none() && last[dof].is_none())
    {
        return false;
    }
    let mut active = vec![false; prescribed.len()];
    let mut width = 0;
    for (element, nodes) in elements.iter().enumerate() {
        for &node in *nodes {
            for axis in 0..if element >= elements.len() - frames.len() {
                6
            } else {
                3
            } {
                let dof = if axis < 3 {
                    3 * node + axis
                } else {
                    prescribed.len() / 2 + 3 * node + axis - 3
                };
                if prescribed[dof].is_none() && !active[dof] {
                    active[dof] = true;
                    width += 1;
                    if width > limit {
                        return false;
                    }
                }
            }
        }
        for &node in *nodes {
            for axis in 0..if element >= elements.len() - frames.len() {
                6
            } else {
                3
            } {
                let dof = if axis < 3 {
                    3 * node + axis
                } else {
                    prescribed.len() / 2 + 3 * node + axis - 3
                };
                if active[dof] && last[dof] == Some(element) {
                    active[dof] = false;
                    width -= 1;
                }
            }
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn evaluate_with_recovery(
    tets: &[Tet],
    hexes: &[Hex],
    trusses: &[Truss],
    membranes: &[Membrane],
    frames: &[Frame],
    plates: &[BendingPlate],
    steels: &[FiniteJ2Steel],
    history: &[FiniteJ2State],
    u: &[f64],
    prescribed: &[Option<f64>],
    options: FiniteJ2TetOptions,
    backend_used: &mut FiniteJ2TetLinearBackend,
    frontal_fallbacks: &mut usize,
) -> Result<Evaluation, String> {
    match evaluate_coupled(
        tets,
        hexes,
        trusses,
        membranes,
        frames,
        plates,
        steels,
        history,
        u,
        Some(*backend_used),
    ) {
        Ok(evaluation) => Ok(evaluation),
        Err(cause)
            if retryable_sparse_failure(options.linear_backend, *backend_used, &cause)
                && fits_frontal_recovery_front_coupled(
                    tets,
                    hexes,
                    trusses,
                    membranes,
                    frames,
                    plates,
                    prescribed,
                    options.max_front_dofs,
                ) =>
        {
            let frontal = evaluate_coupled(
                tets,
                hexes,
                trusses,
                membranes,
                frames,
                plates,
                steels,
                history,
                u,
                Some(FiniteJ2TetLinearBackend::FrontalWave),
            )
            .map_err(|error| {
                format!("finite J2 automatic sparse storage failure: {cause}; frontal recovery failed: {error}")
            })?;
            *backend_used = FiniteJ2TetLinearBackend::FrontalWave;
            *frontal_fallbacks += 1;
            Ok(frontal)
        }
        Err(error) => Err(error),
    }
}

#[allow(clippy::too_many_arguments)]
fn solve_with_recovery(
    evaluation: &mut Evaluation,
    tets: &[Tet],
    hexes: &[Hex],
    trusses: &[Truss],
    membranes: &[Membrane],
    frames: &[Frame],
    plates: &[BendingPlate],
    steels: &[FiniteJ2Steel],
    history: &[FiniteJ2State],
    u: &[f64],
    prescribed: &[Option<f64>],
    free: &[usize],
    rhs: &[f64],
    options: FiniteJ2TetOptions,
    backend_used: &mut FiniteJ2TetLinearBackend,
    frontal_fallbacks: &mut usize,
) -> Result<Vec<f64>, String> {
    match solve_selected(evaluation.tangent.as_ref().unwrap(), free, rhs, options) {
        Ok(solution) => Ok(solution),
        Err(cause)
            if retryable_sparse_failure(options.linear_backend, *backend_used, &cause)
                && fits_frontal_recovery_front_coupled(
                    tets,
                    hexes,
                    trusses,
                    membranes,
                    frames,
                    plates,
                    prescribed,
                    options.max_front_dofs,
                ) =>
        {
            let frontal = evaluate_coupled(
                tets,
                hexes,
                trusses,
                membranes,
                frames,
                plates,
                steels,
                history,
                u,
                Some(FiniteJ2TetLinearBackend::FrontalWave),
            )
            .map_err(|error| {
                format!(
                    "finite J2 automatic sparse failure: {cause}; frontal recovery failed: {error}"
                )
            })?;
            let recovered = solve_selected(frontal.tangent.as_ref().unwrap(), free, rhs, options)
                .map_err(|error| {
                format!(
                    "finite J2 automatic sparse failure: {cause}; frontal recovery failed: {error}"
                )
            })?;
            *evaluation = frontal;
            *backend_used = FiniteJ2TetLinearBackend::FrontalWave;
            *frontal_fallbacks += 1;
            Ok(recovered)
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
fn evaluate(
    tets: &[Tet],
    steels: &[FiniteJ2Steel],
    history: &[FiniteJ2State],
    u: &[f64],
    backend: Option<FiniteJ2TetLinearBackend>,
) -> Result<Evaluation, String> {
    evaluate_coupled(tets, &[], &[], &[], &[], &[], steels, history, u, backend)
}

fn evaluate_coupled(
    tets: &[Tet],
    hexes: &[Hex],
    trusses: &[Truss],
    membranes: &[Membrane],
    frames: &[Frame],
    plates: &[BendingPlate],
    steels: &[FiniteJ2Steel],
    history: &[FiniteJ2State],
    u: &[f64],
    backend: Option<FiniteJ2TetLinearBackend>,
) -> Result<Evaluation, String> {
    let n = u.len();
    let mesh_nodes = if frames.is_empty() { n / 3 } else { n / 6 };
    let mut internal = vec![0.0; n];
    let mut dense = (backend == Some(FiniteJ2TetLinearBackend::Dense)).then(|| vec![0.0; n * n]);
    let mut sparse = if backend == Some(FiniteJ2TetLinearBackend::SparseGmres) {
        if hexes.is_empty()
            && trusses.is_empty()
            && membranes.is_empty()
            && frames.is_empty()
            && plates.is_empty()
        {
            let connectivity: Vec<[usize; 4]> = tets.iter().map(|tet| tet.nodes).collect();
            Some(CsrPatternAssembler::from_node_blocks3(
                n / 3,
                &connectivity,
                MAX_GMRES_NODE_SLOTS,
                MAX_GMRES_NONZEROS,
            )?)
        } else {
            let element_dofs: Vec<Vec<usize>> = tets
                .iter()
                .map(|tet| {
                    (0..12)
                        .map(|local| 3 * tet.nodes[local / 3] + local % 3)
                        .collect()
                })
                .chain(hexes.iter().map(|hex| {
                    (0..24)
                        .map(|local| 3 * hex.nodes[local / 3] + local % 3)
                        .collect()
                }))
                .chain(trusses.iter().map(|truss| {
                    (0..6)
                        .map(|local| 3 * truss.nodes[local / 3] + local % 3)
                        .collect()
                }))
                .chain(membranes.iter().map(|membrane| {
                    (0..9)
                        .map(|local| 3 * membrane.nodes[local / 3] + local % 3)
                        .collect()
                }))
                .chain(frames.iter().map(|frame| frame.dofs(mesh_nodes).to_vec()))
                .chain(plates.iter().map(|plate| plate.dofs.to_vec()))
                .collect();
            Some(CsrPatternAssembler::new(
                n,
                &element_dofs,
                MAX_GMRES_NODE_SLOTS * 12,
                MAX_GMRES_NONZEROS,
            )?)
        }
    } else {
        None
    };
    let mut frontal = (backend == Some(FiniteJ2TetLinearBackend::FrontalWave)).then(|| {
        Vec::with_capacity(
            tets.len()
                + hexes.len()
                + trusses.len()
                + membranes.len()
                + frames.len()
                + plates.len(),
        )
    });
    let mut matrix_free = if matches!(
        backend,
        Some(
            FiniteJ2TetLinearBackend::MatrixFreeGmres
                | FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
        )
    ) {
        let mut elements = Vec::new();
        elements
            .try_reserve_exact(tets.len())
            .map_err(|error| format!("finite J2 matrix-free element cache allocation: {error}"))?;
        let mut cached_hexes = Vec::new();
        cached_hexes
            .try_reserve_exact(hexes.len())
            .map_err(|error| format!("finite J2 matrix-free Hex8 cache allocation: {error}"))?;
        Some(MatrixFreeTangent {
            dofs: n,
            elements,
            hexes: cached_hexes,
            trusses: Vec::with_capacity(trusses.len()),
            membranes: Vec::with_capacity(membranes.len()),
            frames: Vec::with_capacity(frames.len()),
            plates: Vec::with_capacity(plates.len()),
            diagonal: fallible_zeroed(n, "matrix-free tangent diagonal")?,
        })
    } else {
        None
    };
    let mut states = Vec::with_capacity(tets.len());
    let mut first_piola = Vec::with_capacity(tets.len());
    for (element_index, tet) in tets.iter().enumerate() {
        let nodal_u = tet
            .nodes
            .map(|node| [u[3 * node], u[3 * node + 1], u[3 * node + 2]]);
        let strict = solid_finite_j2_tet::evaluate(
            steels[element_index],
            &history[element_index],
            tet.gradients,
            tet.volume,
            nodal_u,
            backend.is_some(),
        );
        let action = match strict {
            Ok(action) => action,
            Err(error)
                if backend.is_some()
                    && error == "finite J2 tangent is undefined at the elastic/plastic switch" =>
            {
                solid_finite_j2_tet::evaluate_with_one_sided_tangent(
                    steels[element_index],
                    &history[element_index],
                    tet.gradients,
                    tet.volume,
                    nodal_u,
                )
                .map_err(|error| format!("finite J2 Tet4 element {element_index}: {error}"))?
            }
            Err(error) => return Err(format!("finite J2 Tet4 element {element_index}: {error}")),
        };
        states.push(action.material_point.state);
        first_piola.push(action.material_point.first_piola_mpa);
        for local_row in 0..12 {
            let row = 3 * tet.nodes[local_row / 3] + local_row % 3;
            internal[row] += action.internal_force_kn[local_row];
            if let Some(global) = &mut dense {
                let local_k = action.tangent_kn_per_m.as_ref().unwrap();
                for local_col in 0..12 {
                    let col = 3 * tet.nodes[local_col / 3] + local_col % 3;
                    global[row * n + col] += local_k[local_row * 12 + local_col];
                }
            }
        }
        if let Some(assembler) = &mut sparse {
            let dofs: [usize; 12] =
                std::array::from_fn(|local| 3 * tet.nodes[local / 3] + local % 3);
            assembler.add_element(&dofs, action.tangent_kn_per_m.as_ref().unwrap())?;
        }
        if let Some(elements) = &mut frontal {
            let stiffness = checked_symmetric_frontal_stiffness(
                action.tangent_kn_per_m.as_ref().unwrap(),
                element_index,
            )?;
            elements.push(FrontalElement {
                dofs: (0..12)
                    .map(|local| 3 * tet.nodes[local / 3] + local % 3)
                    .collect(),
                stiffness,
            });
        }
        if let Some(tangent) = &mut matrix_free {
            let dofs: [usize; 12] =
                std::array::from_fn(|local| 3 * tet.nodes[local / 3] + local % 3);
            let stiffness = *action.tangent_kn_per_m.as_ref().unwrap();
            for local in 0..12 {
                tangent.diagonal[dofs[local]] += stiffness[local * 12 + local];
            }
            tangent.elements.push(ElementTangent { dofs, stiffness });
        }
    }
    let mut hex_states = Vec::with_capacity(hexes.len());
    let mut hex_first_piola = Vec::with_capacity(hexes.len());
    let mut hex_cauchy = Vec::with_capacity(hexes.len());
    for (index, hex) in hexes.iter().enumerate() {
        let nodal_u = hex
            .nodes
            .map(|node| [u[3 * node], u[3 * node + 1], u[3 * node + 2]]);
        let strict = solid_finite_j2_hex8::evaluate(
            hex.steel,
            &hex.state,
            &hex.geometry,
            nodal_u,
            backend.is_some(),
        );
        let action = match strict {
            Ok(action) => action,
            Err(error)
                if backend.is_some()
                    && error == "finite J2 tangent is undefined at the elastic/plastic switch" =>
            {
                solid_finite_j2_hex8::evaluate_with_one_sided_tangent(
                    hex.steel,
                    &hex.state,
                    &hex.geometry,
                    nodal_u,
                )
                .map_err(|error| format!("finite J2 Hex8 element {index}: {error}"))?
            }
            Err(error) => return Err(format!("finite J2 Hex8 element {index}: {error}")),
        };
        hex_states.push(action.gauss_points.each_ref().map(|point| point.state));
        hex_first_piola.push(
            action
                .gauss_points
                .each_ref()
                .map(|point| point.first_piola_mpa),
        );
        let mut gauss_cauchy = [[[0.0; 3]; 3]; 8];
        for gauss in 0..8 {
            gauss_cauchy[gauss] = cauchy_from_piola(
                action.gauss_points[gauss].first_piola_mpa,
                action.deformation_gradients[gauss],
            )
            .map_err(|error| format!("finite J2 Hex8 element {index} Gauss {gauss}: {error}"))?;
        }
        hex_cauchy.push(gauss_cauchy);
        let dofs: [usize; 24] = std::array::from_fn(|local| 3 * hex.nodes[local / 3] + local % 3);
        for row in 0..24 {
            internal[dofs[row]] += action.internal_force_kn[row];
            if let Some(global) = &mut dense {
                let local_k = action.tangent_kn_per_m.as_ref().unwrap();
                for col in 0..24 {
                    global[dofs[row] * n + dofs[col]] += local_k[row * 24 + col];
                }
            }
        }
        if let Some(assembler) = &mut sparse {
            assembler.add_element(&dofs, action.tangent_kn_per_m.as_ref().unwrap())?;
        }
        if let Some(elements) = &mut frontal {
            elements.push(FrontalElement {
                dofs: dofs.to_vec(),
                stiffness: checked_symmetric_frontal_matrix(
                    action.tangent_kn_per_m.as_ref().unwrap(),
                    24,
                    tets.len() + index,
                )?,
            });
        }
        if let Some(tangent) = &mut matrix_free {
            let stiffness = action.tangent_kn_per_m.as_ref().unwrap();
            for local in 0..24 {
                tangent.diagonal[dofs[local]] += stiffness[local * 24 + local];
            }
            tangent.hexes.push(HexTangent {
                dofs,
                geometry: Arc::clone(&hex.geometry),
                steel: hex.steel,
                committed: hex.state,
                displacements_m: nodal_u,
            });
        }
    }
    let mut truss_forces = Vec::with_capacity(trusses.len());
    let mut truss_states = Vec::with_capacity(trusses.len());
    let mut truss_moduli = Vec::with_capacity(trusses.len());
    for (index, truss) in trusses.iter().enumerate() {
        let nodal_u = truss
            .nodes
            .map(|node| [u[3 * node], u[3 * node + 1], u[3 * node + 2]]);
        let (axial_force_kn, internal_force_kn, tangent_kn_per_m, trial_state, modulus) =
            if let Some(material) = truss.plasticity {
                let action = solid_finite_plastic_truss::evaluate(
                    truss.reference,
                    nodal_u,
                    material,
                    &truss.state.expect("plastic truss has committed state"),
                    truss.area_m2,
                    backend.is_some(),
                )
                .map_err(|error| format!("finite J2 coupled truss {index}: {error}"))?;
                (
                    action.axial_force_kn,
                    action.internal_force_kn,
                    action.tangent_kn_per_m,
                    Some(action.state),
                    Some(action.algorithmic_modulus_mpa),
                )
            } else {
                let action = solid_finite_truss::evaluate(
                    truss.reference,
                    nodal_u,
                    truss.youngs_mpa,
                    truss.area_m2,
                    backend.is_some(),
                )
                .map_err(|error| format!("finite J2 coupled truss {index}: {error}"))?;
                (
                    action.axial_force_kn,
                    action.internal_force_kn,
                    action.tangent_kn_per_m,
                    None,
                    None,
                )
            };
        truss_forces.push(axial_force_kn);
        truss_states.push(trial_state);
        truss_moduli.push(modulus);
        let dofs: [usize; 6] = std::array::from_fn(|local| 3 * truss.nodes[local / 3] + local % 3);
        for local_row in 0..6 {
            let row = dofs[local_row];
            internal[row] += internal_force_kn[local_row];
            if let Some(global) = &mut dense {
                let local_k = tangent_kn_per_m.as_ref().unwrap();
                for local_col in 0..6 {
                    global[row * n + dofs[local_col]] += local_k[local_row * 6 + local_col];
                }
            }
        }
        if let Some(assembler) = &mut sparse {
            assembler.add_element(&dofs, tangent_kn_per_m.as_ref().unwrap())?;
        }
        if let Some(elements) = &mut frontal {
            elements.push(FrontalElement {
                dofs: dofs.to_vec(),
                stiffness: checked_symmetric_frontal_matrix(
                    &tangent_kn_per_m.unwrap(),
                    6,
                    tets.len() + hexes.len() + index,
                )?,
            });
        }
        if let Some(tangent) = &mut matrix_free {
            let stiffness = tangent_kn_per_m.unwrap();
            for local in 0..6 {
                tangent.diagonal[dofs[local]] += stiffness[local * 6 + local];
            }
            tangent.trusses.push(TrussTangent { dofs, stiffness });
        }
    }
    let mut membrane_stress = Vec::with_capacity(membranes.len());
    let mut membrane_states = Vec::with_capacity(membranes.len());
    let mut membrane_thickness_stretch = Vec::with_capacity(membranes.len());
    let mut membrane_kirchhoff = Vec::with_capacity(membranes.len());
    let mut membrane_cauchy = Vec::with_capacity(membranes.len());
    let mut membrane_force_resultant = Vec::with_capacity(membranes.len());
    for (index, membrane) in membranes.iter().enumerate() {
        let nodal_u = membrane
            .nodes
            .map(|node| [u[3 * node], u[3 * node + 1], u[3 * node + 2]]);
        let (stress, force, membrane_tangent, state, stretch, kirchhoff, cauchy, resultant) =
            if let Some(material) = membrane.plasticity {
                let committed = membrane
                    .state
                    .as_ref()
                    .expect("plastic membrane has history");
                let strict = solid_finite_j2_membrane::evaluate(
                    material,
                    committed,
                    membrane.reference,
                    nodal_u,
                    membrane.thickness_m,
                    backend.is_some(),
                );
                let action = match strict {
                    Ok(action) => action,
                    Err(error) if backend.is_some()
                        && error == "finite J2 tangent is undefined at the elastic/plastic switch" => {
                        solid_finite_j2_membrane::evaluate_with_one_sided_tangent(
                            material, committed, membrane.reference, nodal_u,
                            membrane.thickness_m,
                        ).map_err(|error| format!("finite J2 coupled membrane {index}: {error}"))?
                    }
                    Err(error) => return Err(format!("finite J2 coupled membrane {index}: {error}")),
                };
                (
                    [0.0; 3],
                    action.internal_force_kn,
                    action.tangent_kn_per_m,
                    Some(action.material_point.state),
                    Some(action.thickness_stretch),
                    Some(action.material_point.kirchhoff_mpa),
                    Some(action.cauchy_mpa),
                    Some(action.force_resultant_kn_per_m),
                )
            } else {
                let action = solid_finite_membrane::evaluate(
                    membrane.reference,
                    nodal_u,
                    membrane.youngs_mpa,
                    membrane.poisson,
                    membrane.thickness_m,
                    backend.is_some(),
                )
                .map_err(|error| format!("finite J2 coupled membrane {index}: {error}"))?;
                (
                    action.stress_mpa,
                    action.internal_force_kn,
                    action.tangent_kn_per_m,
                    None,
                    None,
                    None,
                    None,
                    None,
                )
            };
        membrane_stress.push(stress);
        membrane_states.push(state);
        membrane_thickness_stretch.push(stretch);
        membrane_kirchhoff.push(kirchhoff);
        membrane_cauchy.push(cauchy);
        membrane_force_resultant.push(resultant);
        let dofs: [usize; 9] =
            std::array::from_fn(|local| 3 * membrane.nodes[local / 3] + local % 3);
        for row in 0..9 {
            internal[dofs[row]] += force[row];
            if let Some(global) = &mut dense {
                let local_k = membrane_tangent.as_ref().unwrap();
                for col in 0..9 {
                    global[dofs[row] * n + dofs[col]] += local_k[row * 9 + col];
                }
            }
        }
        if let Some(assembler) = &mut sparse {
            assembler.add_element(&dofs, membrane_tangent.as_ref().unwrap())?;
        }
        if let Some(elements) = &mut frontal {
            elements.push(FrontalElement {
                dofs: dofs.to_vec(),
                stiffness: checked_symmetric_frontal_matrix(
                    &membrane_tangent.unwrap(),
                    9,
                    tets.len() + hexes.len() + trusses.len() + index,
                )?,
            });
        }
        if let Some(tangent) = &mut matrix_free {
            let stiffness = membrane_tangent.unwrap();
            for local in 0..9 {
                tangent.diagonal[dofs[local]] += stiffness[local * 9 + local];
            }
            tangent.membranes.push(MembraneTangent { dofs, stiffness });
        }
    }
    for (index, frame) in frames.iter().enumerate() {
        let dofs = frame.dofs(mesh_nodes);
        let nodal_u = dofs.map(|dof| u[dof]);
        // The bounded von Karman frame still assumes small rotations and
        // reference-axis Hermite bending interpolation.
        if nodal_u.iter().enumerate().any(|(local, value)| {
            if local % 6 >= 3 {
                value.abs() > 0.1
            } else {
                (nodal_u[6 + local % 6] - nodal_u[local % 6]).abs() > 0.1 * frame.length_m
            }
        }) {
            return Err(format!("finite J2 frame {index}: reference-axis linear law exceeded 0.1 rad or 10% relative end displacement"));
        }
        let (frame_force, frame_stiffness) = frame.response_global(&nodal_u);
        for row in 0..12 {
            internal[dofs[row]] += frame_force[row];
            if let Some(global) = &mut dense {
                for col in 0..12 {
                    global[dofs[row] * n + dofs[col]] += frame_stiffness[12 * row + col];
                }
            }
        }
        if let Some(assembler) = &mut sparse {
            assembler.add_element(&dofs, &frame_stiffness)?;
        }
        if let Some(elements) = &mut frontal {
            elements.push(FrontalElement {
                dofs: dofs.to_vec(),
                stiffness: checked_symmetric_frontal_matrix(
                    &frame_stiffness,
                    12,
                    tets.len() + hexes.len() + trusses.len() + membranes.len() + index,
                )?,
            });
        }
        if let Some(tangent) = &mut matrix_free {
            for row in 0..12 {
                tangent.diagonal[dofs[row]] += frame_stiffness[12 * row + row];
            }
            tangent.frames.push(FrameTangent {
                dofs,
                stiffness: frame_stiffness,
            });
        }
    }
    for (index, plate) in plates.iter().enumerate() {
        let dofs = plate.dofs;
        for row in 0..9 {
            let force: f64 = (0..9)
                .map(|col| plate.stiffness[9 * row + col] * u[dofs[col]])
                .sum();
            internal[dofs[row]] += force;
            if let Some(global) = &mut dense {
                for col in 0..9 {
                    global[dofs[row] * n + dofs[col]] += plate.stiffness[9 * row + col];
                }
            }
        }
        if let Some(assembler) = &mut sparse {
            assembler.add_element(&dofs, &plate.stiffness)?;
        }
        if let Some(elements) = &mut frontal {
            elements.push(FrontalElement {
                dofs: dofs.to_vec(),
                stiffness: checked_symmetric_frontal_matrix(
                    &plate.stiffness,
                    9,
                    tets.len()
                        + hexes.len()
                        + trusses.len()
                        + membranes.len()
                        + frames.len()
                        + index,
                )?,
            });
        }
        if let Some(tangent) = &mut matrix_free {
            for row in 0..9 {
                tangent.diagonal[dofs[row]] += plate.stiffness[9 * row + row];
            }
            tangent.plates.push(PlateTangent {
                dofs,
                stiffness: plate.stiffness,
            });
        }
    }
    let tangent = match (dense, sparse, frontal, matrix_free) {
        (Some(matrix), None, None, None) => Some(Tangent::Dense(matrix)),
        (None, Some(assembler), None, None) => Some(Tangent::Sparse(assembler.build())),
        (None, None, Some(mut elements), None) => {
            // Solids and frames are assembled in separate loops. Interleave
            // their element records by node order before frontal elimination;
            // otherwise a shared-node lattice retains nearly every volume
            // translation until the frame loop begins.
            elements.sort_by_key(|element| element.dofs.iter().copied().min());
            Some(Tangent::Frontal(elements))
        }
        (None, None, None, Some(elements)) => Some(Tangent::MatrixFree(elements)),
        (None, None, None, None) => None,
        _ => unreachable!(),
    };
    if internal.iter().any(|x| !x.is_finite())
        || tangent.as_ref().is_some_and(|k| match k {
            Tangent::Dense(matrix) => matrix.iter().any(|x| !x.is_finite()),
            Tangent::Sparse(matrix) => matrix.values.iter().any(|x| !x.is_finite()),
            Tangent::Frontal(elements) => elements
                .iter()
                .flat_map(|element| element.stiffness.iter())
                .any(|x| !x.is_finite()),
            Tangent::MatrixFree(tangent) => {
                tangent.diagonal.iter().any(|x| !x.is_finite())
                    || tangent
                        .elements
                        .iter()
                        .flat_map(|element| element.stiffness.iter())
                        .any(|x| !x.is_finite())
                    || tangent.hexes.iter().any(|element| {
                        element
                            .displacements_m
                            .iter()
                            .flatten()
                            .any(|x| !x.is_finite())
                            || element.committed.iter().any(|state| {
                                !state.equivalent_plastic_strain.is_finite()
                                    || state.fp.iter().flatten().any(|x| !x.is_finite())
                            })
                    })
                    || tangent
                        .trusses
                        .iter()
                        .flat_map(|element| element.stiffness.iter())
                        .any(|x| !x.is_finite())
                    || tangent
                        .membranes
                        .iter()
                        .flat_map(|element| element.stiffness.iter())
                        .any(|x| !x.is_finite())
                    || tangent
                        .frames
                        .iter()
                        .flat_map(|element| element.stiffness.iter())
                        .any(|x| !x.is_finite())
                    || tangent
                        .plates
                        .iter()
                        .flat_map(|element| element.stiffness.iter())
                        .any(|x| !x.is_finite())
            }
        })
    {
        return Err("finite J2 Tet4 assembled force/tangent overflow".into());
    }
    Ok(Evaluation {
        internal,
        tangent,
        states,
        first_piola,
        hex_states,
        hex_first_piola,
        hex_cauchy,
        truss_forces,
        truss_states,
        truss_moduli,
        membrane_stress,
        membrane_states,
        membrane_thickness_stretch,
        membrane_kirchhoff,
        membrane_cauchy,
        membrane_force_resultant,
    })
}

fn checked_symmetric_frontal_stiffness(
    local: &[f64; 144],
    element_index: usize,
) -> Result<Vec<f64>, String> {
    checked_symmetric_frontal_matrix(local, 12, element_index)
}

fn checked_symmetric_frontal_matrix(
    local: &[f64],
    width: usize,
    element_index: usize,
) -> Result<Vec<f64>, String> {
    if width.checked_mul(width) != Some(local.len()) {
        return Err(format!(
            "finite J2 frontalWave element {element_index}: invalid tangent dimensions"
        ));
    }
    let mut stiffness = local.to_vec();
    // dP/dF is major-symmetric away from a switching surface. The spectral
    // derivative can leave roundoff-level skew in nearly zero entries.
    // Frontal's pairwise relative check would reject those, so normalize
    // only after a matrix-norm check. Materially asymmetric tangents fail.
    let scale = stiffness
        .iter()
        .fold(0.0_f64, |a, &value| a.max(value.abs()));
    if !scale.is_finite() || scale == 0.0 {
        return Err(format!(
            "finite J2 frontalWave element {element_index}: invalid tangent scale"
        ));
    }
    for row in 0..width {
        for col in (row + 1)..width {
            let a = stiffness[row * width + col];
            let b = stiffness[col * width + row];
            if !a.is_finite() || !b.is_finite() || (a - b).abs() > 1e-13 * scale {
                return Err(format!(
                    "finite J2 frontalWave element {element_index}: material tangent is not symmetric"
                ));
            }
            let mean = (a + b) * 0.5;
            stiffness[row * width + col] = mean;
            stiffness[col * width + row] = mean;
        }
    }
    Ok(stiffness)
}

fn tangent_diagonal(tangent: &Tangent, row: usize) -> f64 {
    match tangent {
        Tangent::Dense(matrix) => {
            let n = (matrix.len() as f64).sqrt() as usize;
            matrix[row * n + row]
        }
        Tangent::Sparse(matrix) => {
            let start = matrix.row_offsets[row];
            let end = matrix.row_offsets[row + 1];
            matrix.columns[start..end]
                .binary_search(&row)
                .map(|offset| matrix.values[start + offset])
                .unwrap_or(0.0)
        }
        Tangent::Frontal(elements) => elements
            .iter()
            .map(|element| {
                element
                    .dofs
                    .iter()
                    .position(|&dof| dof == row)
                    .map(|local| element.stiffness[local * element.dofs.len() + local])
                    .unwrap_or(0.0)
            })
            .sum(),
        Tangent::MatrixFree(tangent) => tangent.diagonal[row],
    }
}

fn tangent_product(tangent: &Tangent, vector: &[f64]) -> Result<Vec<f64>, String> {
    match tangent {
        Tangent::Dense(matrix) => {
            let n = vector.len();
            Ok((0..n)
                .map(|row| (0..n).map(|col| matrix[row * n + col] * vector[col]).sum())
                .collect())
        }
        Tangent::Sparse(matrix) => matrix.mul_parallel(vector, 1),
        Tangent::Frontal(elements) => {
            let mut product = vec![0.0; vector.len()];
            for element in elements {
                let width = element.dofs.len();
                for (local_row, &row) in element.dofs.iter().enumerate() {
                    for (local_col, &column) in element.dofs.iter().enumerate() {
                        product[row] +=
                            element.stiffness[local_row * width + local_col] * vector[column];
                    }
                }
            }
            Ok(product)
        }
        Tangent::MatrixFree(tangent) => tangent.product(vector, 1),
    }
}

impl MatrixFreeTangent {
    /// Element products are accumulated in deterministic element order within
    /// each worker and worker order at reduction. No global matrix is built.
    fn product(&self, vector: &[f64], threads: usize) -> Result<Vec<f64>, String> {
        if vector.len() != self.dofs || vector.iter().any(|x| !x.is_finite()) {
            return Err("finite J2 matrix-free product needs a finite full DOF vector".into());
        }
        if !(1..=MAX_MATRIX_FREE_THREADS).contains(&threads) {
            return Err("finite J2 matrix-free thread count must be 1..=16".into());
        }
        let workers = threads.min(self.elements.len().max(1));
        let chunk = self.elements.len().div_ceil(workers);
        let mut result = fallible_zeroed(self.dofs, "matrix-free product")?;
        if workers == 1 {
            for element in &self.elements {
                element.accumulate_product(vector, &mut result);
            }
        } else {
            std::thread::scope(|scope| -> Result<(), String> {
                let mut handles = Vec::with_capacity(workers);
                for elements in self.elements.chunks(chunk) {
                    handles.push(
                        std::thread::Builder::new()
                            .spawn_scoped(scope, move || -> Result<Vec<f64>, String> {
                                let mut partial =
                                    fallible_zeroed(vector.len(), "matrix-free worker product")?;
                                for element in elements {
                                    element.accumulate_product(vector, &mut partial);
                                }
                                Ok(partial)
                            })
                            .map_err(|error| {
                                format!("finite J2 matrix-free worker spawn: {error}")
                            })?,
                    );
                }
                for handle in handles {
                    let partial = handle
                        .join()
                        .map_err(|_| "finite J2 matrix-free product worker panicked")??;
                    for (sum, value) in result.iter_mut().zip(partial) {
                        *sum += value;
                    }
                }
                Ok(())
            })?;
        }
        let hex_workers = threads.min(self.hexes.len().max(1));
        if hex_workers == 1 {
            for hex in &self.hexes {
                hex.accumulate_product(vector, &mut result)?;
            }
        } else {
            let chunk = self.hexes.len().div_ceil(hex_workers);
            std::thread::scope(|scope| -> Result<(), String> {
                let mut handles = Vec::with_capacity(hex_workers);
                for hexes in self.hexes.chunks(chunk) {
                    handles.push(
                        std::thread::Builder::new()
                            .spawn_scoped(scope, move || -> Result<Vec<f64>, String> {
                                let mut partial = fallible_zeroed(
                                    vector.len(),
                                    "matrix-free Hex8 worker product",
                                )?;
                                for hex in hexes {
                                    hex.accumulate_product(vector, &mut partial)?;
                                }
                                Ok(partial)
                            })
                            .map_err(|error| {
                                format!("finite J2 matrix-free Hex8 worker spawn: {error}")
                            })?,
                    );
                }
                for handle in handles {
                    let partial = handle
                        .join()
                        .map_err(|_| "finite J2 matrix-free Hex8 product worker panicked")??;
                    for (sum, value) in result.iter_mut().zip(partial) {
                        *sum += value;
                    }
                }
                Ok(())
            })?;
        }
        for truss in &self.trusses {
            truss.accumulate_product(vector, &mut result);
        }
        for membrane in &self.membranes {
            membrane.accumulate_product(vector, &mut result);
        }
        for frame in &self.frames {
            frame.accumulate_product(vector, &mut result);
        }
        for plate in &self.plates {
            plate.accumulate_product(vector, &mut result);
        }
        if result.iter().any(|x| !x.is_finite()) {
            return Err("finite J2 matrix-free product overflow".into());
        }
        Ok(result)
    }
}

impl ElementTangent {
    fn accumulate_product(&self, vector: &[f64], result: &mut [f64]) {
        for row in 0..12 {
            let mut value = 0.0;
            for column in 0..12 {
                value += self.stiffness[row * 12 + column] * vector[self.dofs[column]];
            }
            result[self.dofs[row]] += value;
        }
    }
}

impl HexTangent {
    fn accumulate_product(&self, vector: &[f64], result: &mut [f64]) -> Result<(), String> {
        // Reduced-system Krylov vectors are zero on prescribed DOFs. Skip
        // remote cells entirely when none of their 24 entries can contribute.
        if self.dofs.iter().all(|&dof| vector[dof] == 0.0) {
            return Ok(());
        }
        let direction = std::array::from_fn(|node| {
            std::array::from_fn(|axis| vector[self.dofs[3 * node + axis]])
        });
        let local = solid_finite_j2_hex8::tangent_product(
            self.steel,
            &self.committed,
            &self.geometry,
            self.displacements_m,
            direction,
        )?;
        for (row, value) in local.into_iter().enumerate() {
            result[self.dofs[row]] += value;
        }
        Ok(())
    }
}

impl TrussTangent {
    fn accumulate_product(&self, vector: &[f64], result: &mut [f64]) {
        for row in 0..6 {
            let mut value = 0.0;
            for column in 0..6 {
                value += self.stiffness[row * 6 + column] * vector[self.dofs[column]];
            }
            result[self.dofs[row]] += value;
        }
    }
}

impl MembraneTangent {
    fn accumulate_product(&self, vector: &[f64], result: &mut [f64]) {
        for row in 0..9 {
            let mut value = 0.0;
            for column in 0..9 {
                value += self.stiffness[row * 9 + column] * vector[self.dofs[column]];
            }
            result[self.dofs[row]] += value;
        }
    }
}

impl FrameTangent {
    fn accumulate_product(&self, vector: &[f64], result: &mut [f64]) {
        for row in 0..12 {
            let value: f64 = (0..12)
                .map(|column| self.stiffness[row * 12 + column] * vector[self.dofs[column]])
                .sum();
            result[self.dofs[row]] += value;
        }
    }
}

impl PlateTangent {
    fn accumulate_product(&self, vector: &[f64], result: &mut [f64]) {
        for row in 0..9 {
            let value: f64 = (0..9)
                .map(|column| self.stiffness[row * 9 + column] * vector[self.dofs[column]])
                .sum();
            result[self.dofs[row]] += value;
        }
    }
}

fn solve_reduced_matrix_free(
    tangent: &MatrixFreeTangent,
    free: &[usize],
    rhs: &[f64],
    options: FiniteJ2TetOptions,
) -> Result<Vec<f64>, String> {
    if tangent.dofs != rhs.len() {
        return Err("finite J2 matrix-free tangent dimension mismatch".into());
    }
    if free.is_empty() {
        return Ok(vec![0.0; tangent.dofs]);
    }
    let diagonal: Vec<f64> = free.iter().map(|&i| tangent.diagonal[i]).collect();
    let mut reduced_rhs: Vec<f64> = free.iter().map(|&i| rhs[i]).collect();
    // A zero RHS would trivially pass GMRES even for a mechanism. This generic
    // probe catches some mechanisms, but is not a full rank/inertia certificate.
    let zero_rhs = reduced_rhs.iter().all(|&value| value == 0.0);
    if zero_rhs {
        for (index, value) in reduced_rhs.iter_mut().enumerate() {
            *value = 1.0 + (index % 7) as f64 / 7.0;
        }
    }
    let basis_cap = if options.linear_backend == FiniteJ2TetLinearBackend::MatrixFreeGmresLarge {
        MAX_LARGE_MATRIX_FREE_BASIS_SCALARS
    } else {
        matrix_free_gmres::DEFAULT_MAX_BASIS_SCALARS
    };
    let solved = matrix_free_gmres::solve_operator_with_basis_cap(
        &reduced_rhs,
        &diagonal,
        GmresOptions {
            restart: options.gmres_restart,
            max_iterations: options.gmres_max_iterations,
            relative_tolerance: options.gmres_relative_tolerance,
        },
        basis_cap,
        |reduced_vector| {
            let mut full = vec![0.0; tangent.dofs];
            for (&global, &value) in free.iter().zip(reduced_vector) {
                full[global] = value;
            }
            let product = tangent.product(&full, options.matrix_free_threads)?;
            Ok(free.iter().map(|&global| product[global]).collect())
        },
    )
    .map_err(|error| format!("finite J2 {:?}: {error}", options.linear_backend))?;
    let mut full = vec![0.0; tangent.dofs];
    if !zero_rhs {
        for (&global, &value) in free.iter().zip(&solved) {
            full[global] = value;
        }
    }
    Ok(full)
}

fn solve_selected(
    tangent: &Tangent,
    free: &[usize],
    rhs: &[f64],
    options: FiniteJ2TetOptions,
) -> Result<Vec<f64>, String> {
    match tangent {
        Tangent::Dense(matrix) => solve_free(matrix, rhs.len(), free, rhs),
        Tangent::Sparse(matrix) => solve_reduced_gmres(matrix, free, rhs, options),
        Tangent::Frontal(elements) => {
            let mut prescribed = vec![Some(0.0); rhs.len()];
            for &dof in free {
                prescribed[dof] = None;
            }
            frontal::solve_with_residual_limit(
                elements,
                rhs,
                &prescribed,
                FrontalOptions {
                    max_front_dofs: options.max_front_dofs,
                    ..FrontalOptions::default()
                },
                options
                    .residual_tolerance
                    .max(frontal::DEFAULT_MAX_ACCEPTED_RELATIVE_RESIDUAL),
            )
            .map(|result| result.displacements)
            .map_err(|error| format!("finite J2 frontalWave: {error}"))
        }
        Tangent::MatrixFree(tangent) => solve_reduced_matrix_free(tangent, free, rhs, options),
    }
}

fn solve_reduced_gmres(
    matrix: &CsrMatrix,
    free: &[usize],
    rhs: &[f64],
    options: FiniteJ2TetOptions,
) -> Result<Vec<f64>, String> {
    if matrix.n != rhs.len() {
        return Err("finite J2 sparse GMRES tangent dimension mismatch".into());
    }
    if free.is_empty() {
        return Ok(vec![0.0; matrix.n]);
    }
    let mut position = vec![usize::MAX; matrix.n];
    for (reduced, &global) in free.iter().enumerate() {
        position[global] = reduced;
    }
    let mut row_offsets = Vec::with_capacity(free.len() + 1);
    let mut columns = Vec::new();
    let mut values = Vec::new();
    let mut reduced_rhs = Vec::with_capacity(free.len());
    row_offsets.push(0);
    for &global_row in free {
        reduced_rhs.push(rhs[global_row]);
        for index in matrix.row_offsets[global_row]..matrix.row_offsets[global_row + 1] {
            let reduced_col = position[matrix.columns[index]];
            if reduced_col != usize::MAX {
                columns.push(reduced_col);
                values.push(matrix.values[index]);
            }
        }
        row_offsets.push(columns.len());
    }
    let reduced = CsrMatrix {
        n: free.len(),
        row_offsets,
        columns,
        values,
    };
    for (row, &global) in free.iter().enumerate() {
        let start = reduced.row_offsets[row];
        let end = reduced.row_offsets[row + 1];
        let diagonal = reduced.columns[start..end]
            .binary_search(&row)
            .map(|offset| reduced.values[start + offset])
            .unwrap_or(0.0);
        if !diagonal.is_finite() || diagonal.abs() <= f64::MIN_POSITIVE {
            return Err(format!(
                "finite J2 sparse GMRES zero free tangent diagonal at DOF {global}"
            ));
        }
    }
    // GMRES solves a zero right-hand side with zero even for a mechanism.
    // A nonzero generic probe catches common mechanisms, but Krylov success
    // is not a rank/inertia certificate (unlike the small dense LU path).
    let zero_rhs = reduced_rhs.iter().all(|value| *value == 0.0);
    if zero_rhs {
        for (index, value) in reduced_rhs.iter_mut().enumerate() {
            *value = 1.0 + (index % 7) as f64 / 7.0;
        }
    }
    let solved = solve_gmres(
        &reduced,
        &reduced_rhs,
        GmresOptions {
            restart: options.gmres_restart,
            max_iterations: options.gmres_max_iterations,
            relative_tolerance: options.gmres_relative_tolerance,
        },
    )
    .map_err(|error| format!("finite J2 sparse GMRES: {error}"))?;
    let mut full = vec![0.0; matrix.n];
    if !zero_rhs {
        for (local, &global) in free.iter().enumerate() {
            full[global] = solved[local];
        }
    }
    Ok(full)
}

fn solve_free(k: &[f64], n: usize, free: &[usize], rhs: &[f64]) -> Result<Vec<f64>, String> {
    let m = free.len();
    let mut a = vec![0.0; m * m];
    let mut b = vec![0.0; m];
    let mut scale = 0.0_f64;
    for (row, &i) in free.iter().enumerate() {
        b[row] = rhs[i];
        for (col, &j) in free.iter().enumerate() {
            let value = k[i * n + j];
            a[row * m + col] = value;
            scale = scale.max(value.abs());
        }
    }
    if !scale.is_finite() || (m > 0 && scale == 0.0) {
        return Err("finite J2 Tet4 singular free tangent".into());
    }
    // General LU because a finite-strain material tangent is not assumed SPD.
    for col in 0..m {
        let pivot = (col..m)
            .max_by(|&r1, &r2| a[r1 * m + col].abs().total_cmp(&a[r2 * m + col].abs()))
            .unwrap();
        if a[pivot * m + col].abs() <= 1e-12 * scale {
            return Err(format!(
                "finite J2 Tet4 singular free tangent at DOF {}",
                free[col]
            ));
        }
        if pivot != col {
            for j in 0..m {
                a.swap(pivot * m + j, col * m + j);
            }
            b.swap(pivot, col);
        }
        for row in col + 1..m {
            let factor = a[row * m + col] / a[col * m + col];
            a[row * m + col] = 0.0;
            for j in col + 1..m {
                a[row * m + j] -= factor * a[col * m + j];
            }
            b[row] -= factor * b[col];
        }
    }
    let mut x = vec![0.0; m];
    for row in (0..m).rev() {
        let later: f64 = (row + 1..m).map(|j| a[row * m + j] * x[j]).sum();
        x[row] = (b[row] - later) / a[row * m + row];
    }
    if x.iter().any(|value| !value.is_finite()) {
        return Err("finite J2 Tet4 Newton correction overflow".into());
    }
    let mut full = vec![0.0; n];
    for (index, &dof) in free.iter().enumerate() {
        full[dof] = x[index];
    }
    Ok(full)
}

fn fallible_zeroed(len: usize, purpose: &str) -> Result<Vec<f64>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(len)
        .map_err(|error| format!("finite J2 {purpose} allocation: {error}"))?;
    values.resize(len, 0.0);
    Ok(values)
}

fn fallible_filled<T: Clone>(len: usize, value: T, purpose: &str) -> Result<Vec<T>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(len)
        .map_err(|error| format!("finite J2 {purpose} allocation: {error}"))?;
    values.resize(len, value);
    Ok(values)
}

fn fallible_copy<T: Clone>(input: &[T], purpose: &str) -> Result<Vec<T>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(input.len())
        .map_err(|error| format!("finite J2 {purpose} allocation: {error}"))?;
    values.extend_from_slice(input);
    Ok(values)
}

fn norm(values: impl IntoIterator<Item = f64>) -> Result<f64, String> {
    let mut value = 0.0_f64;
    for term in values {
        if !term.is_finite() {
            return Err("finite J2 Tet4 force/residual is non-finite".into());
        }
        value = value.hypot(term);
        if !value.is_finite() {
            return Err("finite J2 Tet4 force/residual norm overflow".into());
        }
    }
    Ok(value)
}

fn validate_target(
    target: &FiniteJ2TetTarget,
    nodes: usize,
    expected: Option<&[bool]>,
) -> Result<Vec<bool>, String> {
    if target.loads_kn.len() != nodes || target.prescribed_m.len() != nodes {
        return Err("finite J2 Tet4 target needs one load/support triplet per node".into());
    }
    if target.loads_kn.iter().flatten().any(|x| !x.is_finite())
        || target
            .prescribed_m
            .iter()
            .flatten()
            .flatten()
            .any(|x| !x.is_finite())
    {
        return Err("finite J2 Tet4 target contains non-finite load/displacement".into());
    }
    norm(target.loads_kn.iter().flatten().copied())?;
    let mask: Vec<bool> = target
        .prescribed_m
        .iter()
        .flatten()
        .map(Option::is_some)
        .collect();
    if expected.is_some_and(|previous| previous != mask) {
        return Err("finite J2 Tet4 support pattern must remain fixed".into());
    }
    Ok(mask)
}

fn validate_frame_target(
    target: &FiniteJ2FrameTarget,
    nodes: usize,
    rotation_active: &[[bool; 3]],
    expected: Option<&[bool]>,
) -> Result<Vec<bool>, String> {
    if target.moments_kn_m.len() != nodes || target.prescribed_rotation_rad.len() != nodes {
        return Err("finite J2 frame target needs one moment/rotation triplet per node".into());
    }
    let mut mask = Vec::with_capacity(3 * nodes);
    for node in 0..nodes {
        for axis in 0..3 {
            let moment = target.moments_kn_m[node][axis];
            let prescribed = target.prescribed_rotation_rad[node][axis];
            if !moment.is_finite() || prescribed.is_some_and(|value| !value.is_finite()) {
                return Err("finite J2 frame target has non-finite moment/rotation".into());
            }
            if !rotation_active[node][axis]
                && (moment != 0.0 || prescribed.is_some_and(|value| value != 0.0))
            {
                return Err("finite J2 frame target has action on solid-only rotation".into());
            }
            mask.push(!rotation_active[node][axis] || prescribed.is_some());
        }
    }
    norm(target.moments_kn_m.iter().flatten().copied())?;
    if expected.is_some_and(|previous| previous != mask) {
        return Err("finite J2 frame rotation support pattern must remain fixed".into());
    }
    Ok(mask)
}

fn prepare_frames(
    mesh: &Mesh,
    input: &[FiniteJ2CoupledFrame],
    geometric: bool,
) -> Result<Vec<Frame>, String> {
    let mut frames = Vec::new();
    frames
        .try_reserve_exact(input.len())
        .map_err(|error| format!("finite J2 frame allocation: {error}"))?;
    for (index, member) in input.iter().enumerate() {
        if member.nodes[0] >= mesh.nodes.len()
            || member.nodes[1] >= mesh.nodes.len()
            || member.nodes[0] == member.nodes[1]
        {
            return Err(format!("finite J2 frame {index}: invalid node"));
        }
        let start = mesh.nodes[member.nodes[0]];
        let end = mesh.nodes[member.nodes[1]];
        let matrices = frame3d::linear_member_matrices_with_shear(
            start,
            end,
            member.youngs_mpa,
            member.poisson,
            member.g_mpa,
            member.area_m2,
            member.iy_m4,
            member.iz_m4,
            member.torsion_j_m4,
            member.roll_angle_rad,
        )
        .map_err(|error| format!("finite J2 frame {index}: {error}"))?;
        let length_m = (0..3)
            .map(|axis| (end[axis] - start[axis]).powi(2))
            .sum::<f64>()
            .sqrt();
        frames.push(Frame {
            nodes: member.nodes,
            stiffness: std::array::from_fn(|row| matrices.global_stiffness[row / 12][row % 12]),
            local_stiffness: matrices.local_stiffness,
            rotation: matrices.rotation,
            length_m,
            geometric,
        });
    }
    Ok(frames)
}

/// Three-point Gauss integrates a linear intensity times each cubic Hermite
/// shape function exactly; point forces use the same shape at their reference
/// position. These fixed-axis dead loads enter Newton only through the target
/// external vector and are subtracted once in local end-force recovery.
fn assemble_frame_member_load_target(
    frames: &[Frame],
    member_loads: &[FiniteJ2CoupledFrameMemberLoad],
    member_point_loads: &[FiniteJ2CoupledFrameMemberPointLoad],
    global_loads: &mut [f64],
    nodes: usize,
) -> Result<Vec<[f64; 12]>, String> {
    if member_loads.is_empty() && member_point_loads.is_empty() {
        return Ok(Vec::new());
    }
    let mut equivalents = fallible_filled(frames.len(), [0.0; 12], "frame member loads")?;
    let abscissae = [-(3.0_f64 / 5.0).sqrt(), 0.0, (3.0_f64 / 5.0).sqrt()];
    let weights = [5.0 / 9.0, 8.0 / 9.0, 5.0 / 9.0];
    for (index, load) in member_loads.iter().enumerate() {
        let frame = frames.get(load.element).ok_or_else(|| {
            format!("finite J2 frame member load {index}: frame element outside model")
        })?;
        let length = frame.length_m;
        if ![
            load.qy_start_kn_per_m,
            load.qy_end_kn_per_m,
            load.qz_start_kn_per_m,
            load.qz_end_kn_per_m,
            load.start_position_m,
            load.end_position_m,
        ]
        .iter()
        .all(|value| value.is_finite())
            || load.start_position_m < 0.0
            || load.end_position_m <= load.start_position_m
            || load.end_position_m > length + 1e-9
        {
            return Err(format!(
                "finite J2 frame member load {index}: invalid intensity or reference span"
            ));
        }
        let a = load.start_position_m;
        let b = load.end_position_m.min(length);
        if b <= a {
            return Err(format!(
                "finite J2 frame member load {index}: invalid reference span"
            ));
        }
        for (abscissa, weight) in abscissae.into_iter().zip(weights) {
            let x = (a + b) / 2.0 + (b - a) * abscissa / 2.0;
            let fraction = (x - a) / (b - a);
            let scale = weight * (b - a) / 2.0;
            let py = ((1.0 - fraction) * load.qy_start_kn_per_m + fraction * load.qy_end_kn_per_m)
                * scale;
            let pz = ((1.0 - fraction) * load.qz_start_kn_per_m + fraction * load.qz_end_kn_per_m)
                * scale;
            frame3d::add_transverse_load(&mut equivalents[load.element], length, x, py, pz);
        }
    }
    for (index, load) in member_point_loads.iter().enumerate() {
        let frame = frames.get(load.element).ok_or_else(|| {
            format!("finite J2 frame member point load {index}: frame element outside model")
        })?;
        let length = frame.length_m;
        if ![load.py_kn, load.pz_kn, load.position_m]
            .iter()
            .all(|value| value.is_finite())
            || load.position_m < 0.0
            || load.position_m > length + 1e-9
        {
            return Err(format!(
                "finite J2 frame member point load {index}: invalid force or reference position"
            ));
        }
        frame3d::add_transverse_load(
            &mut equivalents[load.element],
            length,
            load.position_m.min(length),
            load.py_kn,
            load.pz_kn,
        );
    }
    for (index, (frame, local)) in frames.iter().zip(&equivalents).enumerate() {
        if local.iter().any(|value| !value.is_finite()) {
            return Err(format!(
                "finite J2 frame {index}: equivalent member load overflow"
            ));
        }
        let dofs = frame.dofs(nodes);
        for block in 0..4 {
            for global_axis in 0..3 {
                let force = (0..3)
                    .map(|axis| frame.rotation[axis][global_axis] * local[3 * block + axis])
                    .sum::<f64>();
                let dof = dofs[3 * block + global_axis];
                global_loads[dof] += force;
                if !global_loads[dof].is_finite() {
                    return Err(format!(
                        "finite J2 frame {index}: accumulated member load overflow"
                    ));
                }
            }
        }
    }
    Ok(equivalents)
}

fn prepare_bending_plates(
    mesh: &Mesh,
    hexes: &[FiniteJ2HexCell],
    input: &[FiniteJ2CoupledBendingPlate],
) -> Result<Vec<BendingPlate>, String> {
    let nodes = mesh.nodes.len();
    let mut volume_supported = vec![false; nodes];
    for tet in &mesh.tets {
        for &node in tet {
            if node < nodes {
                volume_supported[node] = true;
            }
        }
    }
    for hex in hexes {
        for &node in &hex.nodes {
            if node < nodes {
                volume_supported[node] = true;
            }
        }
    }
    let mut plates = Vec::new();
    plates
        .try_reserve_exact(input.len())
        .map_err(|error| format!("finite J2 DKT allocation: {error}"))?;
    for (index, plate) in input.iter().enumerate() {
        let [a, b, c] = plate.nodes;
        if a == b
            || b == c
            || c == a
            || plate
                .nodes
                .iter()
                .any(|&node| node >= nodes || !volume_supported[node])
        {
            return Err(format!(
                "finite J2 DKT {index}: vertices must be distinct Tet4/Hex8-supported mesh nodes"
            ));
        }
        let [p, q, r] = plate.nodes.map(|node| mesh.nodes[node]);
        if [p, q, r].iter().flatten().any(|value| !value.is_finite()) {
            return Err(format!("finite J2 DKT {index}: non-finite coordinate"));
        }
        let span = [q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1]]
            .iter()
            .fold(1.0_f64, |scale, value| scale.max(value.abs()));
        if (q[2] - p[2]).abs() > 1e-10 * span || (r[2] - p[2]).abs() > 1e-10 * span {
            return Err(format!(
                "finite J2 DKT {index}: only horizontal XY triangles are supported"
            ));
        }
        let twice_area = (q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]);
        if !twice_area.is_finite() || twice_area.abs() <= 1e-12 * span * span {
            return Err(format!("finite J2 DKT {index}: degenerate XY triangle"));
        }
        if !plate.youngs_mpa.is_finite()
            || plate.youngs_mpa <= 0.0
            || !plate.poisson.is_finite()
            || plate.poisson <= -1.0
            || plate.poisson >= 0.5
            || !plate.thickness_m.is_finite()
            || plate.thickness_m <= 0.0
        {
            return Err(format!("finite J2 DKT {index}: invalid E, nu or thickness"));
        }
        let local_nodes = [p, q, r].map(|point| plate_bending::Node {
            id: 0,
            x: point[0],
            y: point[1],
        });
        let material = plate_bending::Material {
            id: 0,
            e_mpa: plate.youngs_mpa,
            nu: plate.poisson,
        };
        let local = plate_bending::element_stiffness(
            [&local_nodes[0], &local_nodes[1], &local_nodes[2]],
            &material,
            plate.thickness_m,
        )
        .map_err(|error| format!("finite J2 DKT {index}: {error}"))?;
        // The DKT local rotations are [-rx,-ry] for physical global rotations.
        let signs = [1.0, -1.0, -1.0];
        let mut dofs = [0; 9];
        for (vertex, &node) in plate.nodes.iter().enumerate() {
            dofs[3 * vertex..3 * vertex + 3].copy_from_slice(&[
                3 * node + 2,
                3 * nodes + 3 * node,
                3 * nodes + 3 * node + 1,
            ]);
        }
        let stiffness = std::array::from_fn(|entry| {
            let (i, j) = (entry / 9, entry % 9);
            signs[i % 3] * local[i][j] * signs[j % 3]
        });
        if stiffness.iter().any(|value| !value.is_finite()) {
            return Err(format!("finite J2 DKT {index}: stiffness overflow"));
        }
        plates.push(BendingPlate {
            nodes: plate.nodes,
            dofs,
            stiffness,
        });
    }
    Ok(plates)
}

fn recover_bending_plate_moments(
    mesh: &Mesh,
    plates: &[FiniteJ2CoupledBendingPlate],
    displacements: &[f64],
) -> Result<Vec<[f64; 3]>, String> {
    let node_count = mesh.nodes.len();
    let mut moments = Vec::new();
    moments
        .try_reserve_exact(plates.len())
        .map_err(|error| format!("finite J2 DKT moment allocation: {error}"))?;
    for (index, plate) in plates.iter().enumerate() {
        let points = plate.nodes.map(|node| {
            let point = mesh.nodes[node];
            plate_bending::Node {
                id: 0,
                x: point[0],
                y: point[1],
            }
        });
        let material = plate_bending::Material {
            id: 0,
            e_mpa: plate.youngs_mpa,
            nu: plate.poisson,
        };
        let mut local_u = [0.0; 9];
        for (corner, &node) in plate.nodes.iter().enumerate() {
            local_u[3 * corner] = displacements[3 * node + 2];
            // The physical compact rotations map to DKT theta_x/y with the
            // same signs used to assemble the constant reference stiffness.
            local_u[3 * corner + 1] = -displacements[3 * node_count + 3 * node];
            local_u[3 * corner + 2] = -displacements[3 * node_count + 3 * node + 1];
        }
        moments.push(
            plate_bending::element_centroid_moment(
                [&points[0], &points[1], &points[2]],
                &material,
                plate.thickness_m,
                None,
                1.0,
                local_u,
            )
            .map_err(|error| format!("finite J2 DKT {index} centroid moment: {error}"))?,
        );
    }
    Ok(moments)
}

fn assemble_target_loads(
    target: &FiniteJ2TetTarget,
    mesh: &Mesh,
    tets: &[Tet],
) -> Result<Vec<f64>, String> {
    let load_dofs = target
        .loads_kn
        .len()
        .checked_mul(3)
        .ok_or("finite J2 Tet4 target load count overflow")?;
    let mut loads = Vec::new();
    loads
        .try_reserve_exact(load_dofs)
        .map_err(|error| format!("finite J2 Tet4 target load allocation: {error}"))?;
    for triplet in &target.loads_kn {
        loads.extend_from_slice(triplet);
    }
    for (index, body) in target.body_forces.iter().enumerate() {
        let tet = tets
            .get(body.element)
            .ok_or_else(|| format!("body force {index}: element index outside mesh"))?;
        if body.force_kn_per_m3.iter().any(|value| !value.is_finite()) {
            return Err(format!("body force {index}: non-finite force density"));
        }
        for &node in &tet.nodes {
            for axis in 0..3 {
                let dof = 3 * node + axis;
                loads[dof] += tet.volume * body.force_kn_per_m3[axis] / 4.0;
                if !loads[dof].is_finite() {
                    return Err(format!("body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in target.face_tractions.iter().enumerate() {
        let tet = tets
            .get(face.element)
            .ok_or_else(|| format!("face traction {index}: element index outside mesh"))?;
        if face
            .traction_kn_per_m2
            .iter()
            .any(|value| !value.is_finite())
            || face.face_nodes.iter().enumerate().any(|(local, node)| {
                !tet.nodes.contains(node) || face.face_nodes[..local].contains(node)
            })
        {
            return Err(format!("face traction {index}: invalid face or traction"));
        }
        let [a, b, c] = face.face_nodes.map(|node| mesh.nodes[node]);
        let normal = cross(sub(b, a), sub(c, a));
        let area = dot(normal, normal).sqrt() / 2.0;
        if !area.is_finite() || area <= 0.0 {
            return Err(format!("face traction {index}: degenerate reference face"));
        }
        for &node in &face.face_nodes {
            for axis in 0..3 {
                let dof = 3 * node + axis;
                loads[dof] += area * face.traction_kn_per_m2[axis] / 3.0;
                if !loads[dof].is_finite() {
                    return Err(format!("face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    Ok(loads)
}

fn assemble_hex_target_loads(
    mut loads: Vec<f64>,
    target: &FiniteJ2HexTarget,
    hexes: &[Hex],
) -> Result<Vec<f64>, String> {
    for (index, body) in target.body_forces.iter().enumerate() {
        let hex = hexes
            .get(body.element)
            .ok_or_else(|| format!("Hex8 body force {index}: element index outside mesh"))?;
        let equivalent = consistent_uniform_body_force(hex.reference, body.force_kn_per_m3)
            .map_err(|error| format!("Hex8 body force {index}: {error}"))?;
        for local in 0..8 {
            for axis in 0..3 {
                let dof = 3 * hex.nodes[local] + axis;
                loads[dof] += equivalent[local][axis];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 body force {index}: nodal force overflow"));
                }
            }
        }
    }
    for (index, face) in target.face_tractions.iter().enumerate() {
        let hex = hexes
            .get(face.element)
            .ok_or_else(|| format!("Hex8 face traction {index}: element index outside mesh"))?;
        let equivalent = consistent_uniform_face_traction(
            hex.reference,
            face.face_nodes,
            face.traction_kn_per_m2,
        )
        .map_err(|error| format!("Hex8 face traction {index}: {error}"))?;
        for local in 0..8 {
            for axis in 0..3 {
                let dof = 3 * hex.nodes[local] + axis;
                loads[dof] += equivalent[local][axis];
                if !loads[dof].is_finite() {
                    return Err(format!("Hex8 face traction {index}: nodal force overflow"));
                }
            }
        }
    }
    Ok(loads)
}

fn prepare_hexes(mesh: &Mesh, input: &[FiniteJ2HexCell]) -> Result<Vec<Hex>, String> {
    let mut result = Vec::new();
    result
        .try_reserve_exact(input.len())
        .map_err(|error| format!("finite J2 Hex8 geometry allocation: {error}"))?;
    for (index, hex) in input.iter().enumerate() {
        if hex.nodes.iter().any(|&node| node >= mesh.nodes.len())
            || (0..8).any(|local| hex.nodes[..local].contains(&hex.nodes[local]))
        {
            return Err(format!("finite J2 Hex8 element {index}: invalid node"));
        }
        FiniteJ2Steel::new(
            hex.steel.youngs_mpa,
            hex.steel.poisson,
            hex.steel.yield_mpa,
            hex.steel.hardening_mpa,
        )
        .map_err(|error| format!("finite J2 Hex8 element {index} steel: {error}"))?;
        let reference = hex.nodes.map(|node| mesh.nodes[node]);
        let geometry = FiniteJ2Hex8Geometry::new(reference)
            .map_err(|error| format!("finite J2 Hex8 element {index}: {error}"))?;
        result.push(Hex {
            nodes: hex.nodes,
            reference,
            geometry: Arc::new(geometry),
            steel: hex.steel,
            state: [FiniteJ2State::default(); 8],
        });
    }
    Ok(result)
}

fn cauchy_from_piola(piola: Tensor3, f: Tensor3) -> Result<Tensor3, String> {
    let det = dot(f[0], cross(f[1], f[2]));
    if !det.is_finite() || det <= 0.0 {
        return Err("inverted or non-finite deformation gradient".into());
    }
    let sigma: Tensor3 = std::array::from_fn(|i| {
        std::array::from_fn(|j| (0..3).map(|k| piola[i][k] * f[j][k]).sum::<f64>() / det)
    });
    if sigma.iter().flatten().any(|value| !value.is_finite()) {
        return Err("non-finite Cauchy stress".into());
    }
    Ok(sigma)
}

fn prepare_tets(mesh: &Mesh) -> Result<Vec<Tet>, String> {
    if mesh.nodes.iter().flatten().any(|x| !x.is_finite()) {
        return Err("finite J2 Tet4 mesh has non-finite coordinate".into());
    }
    let mut result = Vec::new();
    result
        .try_reserve_exact(mesh.tets.len())
        .map_err(|error| format!("finite J2 Tet4 geometry allocation: {error}"))?;
    for (element_index, nodes) in mesh.tets.iter().copied().enumerate() {
        if nodes.iter().any(|&node| node >= mesh.nodes.len())
            || (0..4).any(|i| nodes[..i].contains(&nodes[i]))
        {
            return Err(format!(
                "finite J2 Tet4 element {element_index}: invalid node"
            ));
        }
        let [p0, p1, p2, p3] = nodes.map(|node| mesh.nodes[node]);
        let a = sub(p1, p0);
        let b = sub(p2, p0);
        let c = sub(p3, p0);
        let det = dot(a, cross(b, c));
        let scale = dot(a, a).sqrt().max(dot(b, b).sqrt()).max(dot(c, c).sqrt());
        if !det.is_finite() || scale == 0.0 || det.abs() <= 1e-12 * scale.powi(3) {
            return Err(format!(
                "finite J2 Tet4 element {element_index}: degenerate geometry"
            ));
        }
        let g1 = mul(cross(b, c), 1.0 / det);
        let g2 = mul(cross(c, a), 1.0 / det);
        let g3 = mul(cross(a, b), 1.0 / det);
        let g0 = mul(add(add(g1, g2), g3), -1.0);
        result.push(Tet {
            nodes,
            gradients: [g0, g1, g2, g3],
            volume: det.abs() / 6.0,
        });
    }
    Ok(result)
}

fn prepare_trusses(mesh: &Mesh, input: &[FiniteJ2CoupledTruss]) -> Result<Vec<Truss>, String> {
    let mut result = Vec::new();
    result
        .try_reserve_exact(input.len())
        .map_err(|error| format!("finite J2 coupled truss allocation: {error}"))?;
    for (index, truss) in input.iter().enumerate() {
        if truss.nodes[0] >= mesh.nodes.len()
            || truss.nodes[1] >= mesh.nodes.len()
            || truss.nodes[0] == truss.nodes[1]
        {
            return Err(format!("finite J2 coupled truss {index}: invalid node"));
        }
        let reference = truss.nodes.map(|node| mesh.nodes[node]);
        let plasticity = truss.plasticity.map(|law| PlasticTrussMaterial {
            youngs_mpa: truss.youngs_mpa,
            yield_mpa: law.yield_mpa,
            hardening_mpa: law.hardening_mpa,
        });
        if let Some(material) = plasticity {
            solid_finite_plastic_truss::evaluate(
                reference,
                [[0.0; 3]; 2],
                material,
                &PlasticTrussState::default(),
                truss.area_m2,
                false,
            )
            .map_err(|error| format!("finite J2 coupled truss {index}: {error}"))?;
        } else {
            solid_finite_truss::evaluate(
                reference,
                [[0.0; 3]; 2],
                truss.youngs_mpa,
                truss.area_m2,
                false,
            )
            .map_err(|error| format!("finite J2 coupled truss {index}: {error}"))?;
        }
        result.push(Truss {
            nodes: truss.nodes,
            reference,
            youngs_mpa: truss.youngs_mpa,
            area_m2: truss.area_m2,
            plasticity,
            state: plasticity.map(|_| PlasticTrussState::default()),
        });
    }
    Ok(result)
}

fn prepare_membranes(
    mesh: &Mesh,
    input: &[FiniteJ2CoupledMembrane],
) -> Result<Vec<Membrane>, String> {
    let mut result = Vec::new();
    result
        .try_reserve_exact(input.len())
        .map_err(|error| format!("finite J2 coupled membrane allocation: {error}"))?;
    for (index, membrane) in input.iter().enumerate() {
        if membrane.nodes.iter().any(|&node| node >= mesh.nodes.len())
            || membrane.nodes[0] == membrane.nodes[1]
            || membrane.nodes[0] == membrane.nodes[2]
            || membrane.nodes[1] == membrane.nodes[2]
        {
            return Err(format!("finite J2 coupled membrane {index}: invalid node"));
        }
        let reference = membrane.nodes.map(|node| mesh.nodes[node]);
        let plasticity = if let Some(law) = membrane.plasticity {
            let material = FiniteJ2Steel::new(
                membrane.youngs_mpa,
                membrane.poisson,
                law.yield_mpa,
                law.hardening_mpa,
            )
            .map_err(|error| format!("finite J2 coupled membrane {index}: {error}"))?;
            solid_finite_j2_membrane::evaluate(
                material,
                &FiniteJ2State::default(),
                reference,
                [[0.0; 3]; 3],
                membrane.thickness_m,
                false,
            )
            .map_err(|error| format!("finite J2 coupled membrane {index}: {error}"))?;
            Some(material)
        } else {
            solid_finite_membrane::evaluate(
                reference,
                [[0.0; 3]; 3],
                membrane.youngs_mpa,
                membrane.poisson,
                membrane.thickness_m,
                false,
            )
            .map_err(|error| format!("finite J2 coupled membrane {index}: {error}"))?;
            None
        };
        result.push(Membrane {
            nodes: membrane.nodes,
            reference,
            youngs_mpa: membrane.youngs_mpa,
            poisson: membrane.poisson,
            thickness_m: membrane.thickness_m,
            plasticity,
            state: plasticity.map(|_| FiniteJ2State::default()),
        });
    }
    Ok(result)
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: [f64; 3], x: f64) -> [f64; 3] {
    [a[0] * x, a[1] * x, a[2] * x]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tet() -> Mesh {
        Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        }
    }

    fn steel() -> FiniteJ2Steel {
        FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 1_000.0).unwrap()
    }

    #[test]
    fn geometric_frame_tangent_matches_force_differences_and_compressive_stiffness() {
        let mesh = Mesh {
            nodes: vec![[0.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
            tets: vec![],
        };
        let member = FiniteJ2CoupledFrame {
            nodes: [0, 1],
            youngs_mpa: 210_000.0,
            poisson: 0.3,
            g_mpa: None,
            area_m2: 0.01,
            iy_m4: 1.2e-4,
            iz_m4: 0.8e-4,
            torsion_j_m4: 1.6e-4,
            roll_angle_rad: 0.0,
        };
        let frame = prepare_frames(&mesh, &[member], true).unwrap().remove(0);
        let q = [
            0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.002, 0.003, -0.002, 0.001, -0.004, 0.006,
        ];
        let (_, tangent) = frame.local_response(&q);
        let step = 1e-7;
        for col in 0..12 {
            let mut plus = q;
            let mut minus = q;
            plus[col] += step;
            minus[col] -= step;
            let (f_plus, _) = frame.local_response(&plus);
            let (f_minus, _) = frame.local_response(&minus);
            for row in 0..12 {
                let numerical = (f_plus[row] - f_minus[row]) / (2.0 * step);
                let scale = 1.0 + tangent[row][col].abs();
                assert!(
                    (numerical - tangent[row][col]).abs() < 1e-6 * scale,
                    "local ({row},{col}): analytical={}, FD={numerical}",
                    tangent[row][col]
                );
                assert!((tangent[row][col] - tangent[col][row]).abs() < 1e-10 * scale);
            }
        }
        let mut axial = [0.0; 12];
        axial[6] = -0.002;
        let (_, under_compression) = frame.local_response(&axial);
        let axial_kn = member.youngs_mpa * 1000.0 * member.area_m2 * axial[6] / 2.0;
        let expected_delta = axial_kn * 36.0 / (30.0 * 2.0);
        let actual_delta = under_compression[7][7] - frame.local_stiffness[7][7];
        assert!((actual_delta - expected_delta).abs() < 1e-8);
        assert!(
            actual_delta < 0.0,
            "compression must soften lateral bending"
        );
    }

    #[test]
    fn geometric_frame_sharing_tet_root_matches_cantilever_beam_column_limit() {
        let mesh = Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 0.0],
                [2.0, 0.0, 0.0],
            ],
            tets: vec![[0, 1, 2, 3]],
        };
        let target = |lateral_kn: f64| FiniteJ2TetTarget {
            loads_kn: vec![
                [0.0; 3],
                [0.0; 3],
                [0.0; 3],
                [0.0; 3],
                [-300.0, 0.0, -lateral_kn],
            ],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m: vec![
                [Some(0.0); 3],
                [Some(0.0); 3],
                [Some(0.0); 3],
                [Some(0.0); 3],
                [None; 3],
            ],
        };
        let rotations = FiniteJ2FrameTarget {
            moments_kn_m: vec![[0.0; 3]; 5],
            prescribed_rotation_rad: vec![
                [Some(0.0); 3],
                [None; 3],
                [None; 3],
                [None; 3],
                [None; 3],
            ],
        };
        let mut request = FiniteJ2FrameCoupledRequest {
            volume: FiniteJ2TetRequest {
                mesh,
                steel: steel(),
                element_steels: None,
                targets: vec![target(0.0), target(10.0)],
                options: FiniteJ2TetOptions {
                    geometric_frames: true,
                    ..FiniteJ2TetOptions::default()
                },
            },
            hexes: vec![],
            hex_targets: vec![],
            trusses: vec![],
            membranes: vec![],
            frames: vec![FiniteJ2CoupledFrame {
                nodes: [0, 4],
                youngs_mpa: 210_000.0,
                poisson: 0.3,
                g_mpa: None,
                area_m2: 0.01,
                iy_m4: 1e-5,
                iz_m4: 2e-5,
                torsion_j_m4: 2e-5,
                roll_angle_rad: 0.0,
            }],
            bending_plates: vec![],
            frame_targets: vec![rotations.clone(), rotations],
            frame_member_load_targets: vec![],
            frame_member_point_load_targets: vec![],
        };
        let nonlinear = solve_frame_coupled(&request).unwrap();
        request.volume.options.geometric_frames = false;
        let linear = solve_frame_coupled(&request).unwrap();
        let linear_tip = linear.nodal_displacements_m[4][2].abs();
        let nonlinear_tip = nonlinear.nodal_displacements_m[4][2].abs();
        let ei_kn_m2 = 210_000.0 * 1000.0 * 1e-5;
        let linear_reference = 10.0 * 2.0_f64.powi(3) / (3.0 * ei_kn_m2);
        let k = (300.0_f64 / ei_kn_m2).sqrt();
        let beam_column_reference = 10.0 / 300.0 * ((k * 2.0).tan() / k - 2.0);
        assert!((linear_tip - linear_reference).abs() < 1e-10);
        assert!(nonlinear_tip > linear_tip * 1.1);
        assert!(
            (nonlinear_tip / beam_column_reference - 1.0).abs() < 0.04,
            "one-element beam-column: {nonlinear_tip}, reference {beam_column_reference}"
        );
        assert!(nonlinear.true_free_residual_kn < 1e-7);
        assert_eq!(nonlinear.accepted_steps.len(), 2);
        assert_eq!(nonlinear.element_states[0].equivalent_plastic_strain, 0.0);
        assert!((nonlinear.nodal_reactions_kn[0][0] - 300.0).abs() < 1e-6);
        assert!((nonlinear.nodal_reactions_kn[0][2] - 10.0).abs() < 1e-6);
    }

    fn fully_prescribed_shear(gamma: f64) -> FiniteJ2TetTarget {
        let mesh = tet();
        FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m: mesh
                .nodes
                .iter()
                .map(|p| [Some(gamma * p[1]), Some(0.0), Some(0.0)])
                .collect(),
        }
    }

    #[test]
    fn affine_plastic_shear_reactions_and_committed_history() {
        let request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.02), fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions::default(),
        };
        let result = solve(&request).unwrap();
        assert_eq!(result.accepted_steps.len(), 2);
        assert_eq!(result.cutbacks, 0);
        assert!(result.element_states[0].equivalent_plastic_strain > 0.0);
        assert_eq!(result.true_free_residual_kn, 0.0);
        for axis in 0..3 {
            let total: f64 = result.nodal_reactions_kn.iter().map(|r| r[axis]).sum();
            assert!(total.abs() < 1e-8, "axis {axis}: {total}");
        }
        for node in result.nodal_displacements_m {
            assert!(node.iter().all(|x| x.abs() < 1e-14));
        }
        // An unloaded plastified element retains nonzero self-equilibrated
        // reaction at its kinematically fixed boundary.
        assert!(result
            .nodal_reactions_kn
            .iter()
            .flatten()
            .any(|x| x.abs() > 1e-4));
    }

    #[test]
    fn free_lateral_dofs_converge_through_plastic_step() {
        let mut prescribed = vec![[Some(0.0); 3]; 4];
        prescribed[3] = [None, None, Some(0.004)];
        let request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; 4],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: prescribed,
            }],
            options: FiniteJ2TetOptions::default(),
        };
        let result = solve(&request).unwrap();
        assert!(result.element_states[0].equivalent_plastic_strain > 0.0);
        assert!(result.nodal_displacements_m[3][2] > 0.003999999);
        assert!(result.true_free_residual_kn < 1e-5);
        assert!(result.nodal_reactions_kn[3][0].abs() < 1e-5);
        assert!(result.nodal_reactions_kn[3][1].abs() < 1e-5);
    }

    #[test]
    fn sparse_gmres_matches_dense_plastic_free_dof_solution() {
        let mut prescribed = vec![[Some(0.0); 3]; 4];
        prescribed[3] = [None, None, Some(0.004)];
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; 4],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: prescribed,
            }],
            options: FiniteJ2TetOptions::default(),
        };
        let dense = solve(&request).unwrap();
        request.options.linear_backend = FiniteJ2TetLinearBackend::SparseGmres;
        let sparse = solve(&request).unwrap();
        assert_eq!(
            sparse.linear_backend_used,
            FiniteJ2TetLinearBackend::SparseGmres
        );
        assert_eq!(sparse.frontal_fallbacks, 0);
        for (a, b) in dense
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(sparse.nodal_displacements_m.iter().flatten())
        {
            assert!((a - b).abs() < 1e-10);
        }
        for (a, b) in dense
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(sparse.nodal_reactions_kn.iter().flatten())
        {
            assert!((a - b).abs() < 1e-4);
        }
        assert!(
            (dense.element_states[0].equivalent_plastic_strain
                - sparse.element_states[0].equivalent_plastic_strain)
                .abs()
                < 1e-9
        );
    }

    #[test]
    fn automatic_uses_sparse_when_krylov_converges() {
        let mut prescribed = vec![[Some(0.0); 3]; 4];
        prescribed[3] = [None, None, Some(0.004)];
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; 4],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: prescribed,
            }],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::Automatic,
                ..FiniteJ2TetOptions::default()
            },
        };
        let automatic = solve(&request).unwrap();
        assert_eq!(
            automatic.linear_backend_used,
            FiniteJ2TetLinearBackend::SparseGmres
        );
        assert_eq!(automatic.frontal_fallbacks, 0);
        request.options.linear_backend = FiniteJ2TetLinearBackend::SparseGmres;
        let sparse = solve(&request).unwrap();
        for (actual, expected) in automatic
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(sparse.nodal_reactions_kn.iter().flatten())
        {
            assert!((actual - expected).abs() < 1e-7);
        }
        assert!(automatic.element_states[0].equivalent_plastic_strain > 0.0);
    }

    #[test]
    fn automatic_recovers_krylov_iteration_exhaustion_with_frontal() {
        let mesh = Mesh::structured([2, 2, 2]).unwrap();
        let target = FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m: mesh
                .nodes
                .iter()
                .map(|&[x, y, z]| {
                    if [x, y, z] == [0.5; 3] {
                        [None; 3]
                    } else {
                        [
                            Some(0.004 * x + 0.001 * x * y),
                            Some(-0.003 * y + 0.0007 * x * z),
                            Some(0.0005 * y * z),
                        ]
                    }
                })
                .collect(),
        };
        let mut request = FiniteJ2TetRequest {
            mesh,
            steel: steel(),
            element_steels: None,
            targets: vec![target.clone(), target],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::Automatic,
                gmres_restart: 1,
                gmres_max_iterations: 1,
                ..FiniteJ2TetOptions::default()
            },
        };
        let automatic = solve(&request).unwrap();
        assert_eq!(
            automatic.linear_backend_used,
            FiniteJ2TetLinearBackend::FrontalWave
        );
        assert_eq!(automatic.frontal_fallbacks, 1);
        assert_eq!(automatic.accepted_steps.len(), 2);
        request.options.linear_backend = FiniteJ2TetLinearBackend::FrontalWave;
        let frontal = solve(&request).unwrap();
        for (actual, expected) in automatic
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(frontal.nodal_displacements_m.iter().flatten())
        {
            assert!((actual - expected).abs() < 1e-8);
        }
        assert!(automatic.true_free_residual_kn < 1e-5);
    }

    #[test]
    fn automatic_recovery_classifies_only_krylov_exhaustion_and_csr_budgets() {
        let requested = FiniteJ2TetLinearBackend::Automatic;
        let active = FiniteJ2TetLinearBackend::SparseGmres;
        for cause in [
            "finite J2 sparse GMRES: GMRES failed to converge in 1 iterations",
            "finite J2 sparse GMRES: GMRES stagnated after 3 iterations",
            "block CSR exceeds the temporary node-slot budget",
            "block CSR exceeds the scalar nonzero budget",
            "CSR pattern exceeds the temporary slot budget",
            "CSR pattern exceeds the nonzero budget",
        ] {
            assert!(retryable_sparse_failure(requested, active, cause));
        }
        for cause in [
            "finite J2 sparse GMRES: GMRES Arnoldi breakdown at iteration 1; system may be singular",
            "finite J2 sparse GMRES: GMRES invariant Krylov subspace at iteration 1",
            "finite J2 sparse GMRES zero free tangent diagonal at DOF 7",
            "finite J2 Tet4 element 0: inverted tetrahedron",
            "finite J2 Tet4 Newton failed, residual 1e-3 kN",
            "finite J2 Tet4 line search stalled, residual 1e-3 kN",
        ] {
            assert!(!retryable_sparse_failure(requested, active, cause), "{cause}");
        }
        assert!(!retryable_sparse_failure(
            FiniteJ2TetLinearBackend::SparseGmres,
            active,
            "finite J2 sparse GMRES: GMRES failed to converge in 1 iterations"
        ));
        assert_eq!(
            serde_json::to_string(&FiniteJ2TetLinearBackend::Automatic).unwrap(),
            "\"automatic\""
        );
    }

    #[test]
    fn automatic_does_not_recover_invalid_geometry_or_a_rigid_mechanism() {
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::Automatic,
                ..FiniteJ2TetOptions::default()
            },
        };
        request.mesh.nodes[3][2] = 0.0;
        assert!(solve(&request).unwrap_err().contains("degenerate geometry"));

        request.mesh = tet();
        request.targets[0].prescribed_m = vec![[None; 3]; 4];
        request.targets[0].prescribed_m[0] = [Some(0.0); 3];
        assert!(
            solve(&request).is_err(),
            "rigid-body mechanism was accepted"
        );

        let prepared = prepare_tets(&request.mesh).unwrap();
        let supports: Vec<Option<f64>> = request.targets[0]
            .prescribed_m
            .iter()
            .flatten()
            .copied()
            .collect();
        assert!(fits_frontal_recovery_front(&prepared, &supports, 9));
        assert!(!fits_frontal_recovery_front(&prepared, &supports, 8));
    }

    #[test]
    fn matrix_free_matches_dense_and_sparse_plastic_load_unload_with_threads() {
        let mut prescribed = vec![[Some(0.0); 3]; 4];
        prescribed[3] = [None, None, Some(0.004)];
        let mut unloaded = prescribed.clone();
        unloaded[3][2] = Some(0.0);
        let target = |prescribed_m| FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; 4],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m,
        };
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![target(prescribed), target(unloaded)],
            options: FiniteJ2TetOptions::default(),
        };
        let dense = solve(&request).unwrap();
        request.options.linear_backend = FiniteJ2TetLinearBackend::SparseGmres;
        let sparse = solve(&request).unwrap();
        assert!(dense.element_states[0].equivalent_plastic_strain > 0.0);
        for threads in [1, 2, 4] {
            request.options.linear_backend = FiniteJ2TetLinearBackend::MatrixFreeGmres;
            request.options.matrix_free_threads = threads;
            let actual = solve(&request).unwrap();
            assert_eq!(
                actual.linear_backend_used,
                FiniteJ2TetLinearBackend::MatrixFreeGmres
            );
            assert_eq!(actual.accepted_steps.len(), dense.accepted_steps.len());
            for expected in [&dense, &sparse] {
                for (a, b) in actual
                    .nodal_displacements_m
                    .iter()
                    .flatten()
                    .zip(expected.nodal_displacements_m.iter().flatten())
                {
                    assert!(
                        (a - b).abs() < 1e-10,
                        "threads={threads}: displacement {a} vs {b}"
                    );
                }
                for (a, b) in actual
                    .nodal_reactions_kn
                    .iter()
                    .flatten()
                    .zip(expected.nodal_reactions_kn.iter().flatten())
                {
                    assert!(
                        (a - b).abs() < 1e-4,
                        "threads={threads}: reaction {a} vs {b}"
                    );
                }
                assert!(
                    (actual.element_states[0].equivalent_plastic_strain
                        - expected.element_states[0].equivalent_plastic_strain)
                        .abs()
                        < 1e-9
                );
            }
            assert!(actual.true_free_residual_kn < 1e-5);
        }
    }

    #[test]
    fn matrix_free_element_product_matches_dense_tangent_with_threads() {
        let mut mesh = tet();
        // Repeated connectivity is intentional here: eight overlapping local
        // matrices exercise multi-worker accumulation at shared global DOFs.
        mesh.tets = vec![[0, 1, 2, 3]; 8];
        let tets = prepare_tets(&mesh).unwrap();
        let steels = vec![steel(); 8];
        let histories = vec![FiniteJ2State::default(); 8];
        let mut u = vec![0.0; 12];
        u[9] = 0.003;
        u[10] = -0.001;
        let dense = evaluate(
            &tets,
            &steels,
            &histories,
            &u,
            Some(FiniteJ2TetLinearBackend::Dense),
        )
        .unwrap();
        let matrix_free = evaluate(
            &tets,
            &steels,
            &histories,
            &u,
            Some(FiniteJ2TetLinearBackend::MatrixFreeGmres),
        )
        .unwrap();
        let vector: Vec<f64> = (0..12).map(|index| (index as f64 - 5.0) / 7.0).collect();
        let expected = tangent_product(dense.tangent.as_ref().unwrap(), &vector).unwrap();
        let Tangent::MatrixFree(tangent) = matrix_free.tangent.as_ref().unwrap() else {
            panic!("missing matrix-free tangent")
        };
        for threads in [1, 2, 4] {
            let actual = tangent.product(&vector, threads).unwrap();
            for (&a, &b) in actual.iter().zip(&expected) {
                assert!(
                    (a - b).abs() < 1e-7 * b.abs().max(1.0),
                    "threads={threads}: {a} vs {b}"
                );
            }
        }
        for row in 0..12 {
            assert!(
                (tangent.diagonal[row] - tangent_diagonal(dense.tangent.as_ref().unwrap(), row))
                    .abs()
                    < 1e-9
            );
        }
    }

    #[test]
    fn streamed_warped_plastic_hex_product_matches_dense_in_mixed_system() {
        let mesh = Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [1.0, 1.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [1.0, 0.0, 1.0],
                [1.13, 1.04, 1.08],
                [-0.03, 1.0, 1.0],
                [0.0, 0.0, 1.8],
            ],
            tets: vec![[0, 1, 3, 8]],
        };
        let steel = FiniteJ2Steel::new(210_000.0, 0.3, 30.0, 1_000.0).unwrap();
        let hex_input = vec![
            FiniteJ2HexCell {
                nodes: [0, 1, 2, 3, 4, 5, 6, 7],
                steel,
            },
            FiniteJ2HexCell {
                nodes: [0, 1, 2, 3, 4, 5, 6, 7],
                steel,
            },
        ];
        let tets = prepare_tets(&mesh).unwrap();
        let hexes = prepare_hexes(&mesh, &hex_input).unwrap();
        let trusses = prepare_trusses(
            &mesh,
            &[FiniteJ2CoupledTruss {
                nodes: [1, 8],
                youngs_mpa: 200_000.0,
                area_m2: 0.001,
                plasticity: None,
            }],
        )
        .unwrap();
        let membranes = prepare_membranes(
            &mesh,
            &[FiniteJ2CoupledMembrane {
                nodes: [0, 1, 3],
                youngs_mpa: 30_000.0,
                poisson: 0.2,
                thickness_m: 0.01,
                plasticity: None,
            }],
        )
        .unwrap();
        let u: Vec<f64> = mesh
            .nodes
            .iter()
            .enumerate()
            .flat_map(|(node, p)| {
                [
                    0.012 * p[0] + 0.002 * p[1] + if node == 6 { 0.003 } else { 0.0 },
                    -0.004 * p[1] + 0.001 * p[2],
                    0.002 * p[2] + 0.0005 * p[0],
                ]
            })
            .collect();
        let histories = vec![FiniteJ2State::default(); tets.len()];
        let dense = evaluate_coupled(
            &tets,
            &hexes,
            &trusses,
            &membranes,
            &[],
            &[],
            &[steel],
            &histories,
            &u,
            Some(FiniteJ2TetLinearBackend::Dense),
        )
        .unwrap();
        let streamed = evaluate_coupled(
            &tets,
            &hexes,
            &trusses,
            &membranes,
            &[],
            &[],
            &[steel],
            &histories,
            &u,
            Some(FiniteJ2TetLinearBackend::MatrixFreeGmres),
        )
        .unwrap();
        assert!(streamed
            .hex_states
            .iter()
            .flatten()
            .any(|state| state.equivalent_plastic_strain > 0.0));
        assert!(std::mem::size_of::<HexTangent>() < std::mem::size_of::<[f64; 576]>() / 3);
        let direction: Vec<f64> = (0..u.len())
            .map(|dof| ((dof * 17 % 31) as f64 - 15.0) / 13.0)
            .collect();
        let expected = tangent_product(dense.tangent.as_ref().unwrap(), &direction).unwrap();
        let Tangent::MatrixFree(tangent) = streamed.tangent.as_ref().unwrap() else {
            panic!("missing matrix-free tangent")
        };
        assert!(Arc::ptr_eq(&hexes[0].geometry, &tangent.hexes[0].geometry));
        for workers in [1, 2, 4] {
            let actual = tangent.product(&direction, workers).unwrap();
            assert_eq!(
                actual,
                tangent.product(&direction, workers).unwrap(),
                "worker reduction must be deterministic"
            );
            for (row, (&a, &b)) in actual.iter().zip(&expected).enumerate() {
                assert!(
                    (a - b).abs() < 2e-8 * b.abs().max(1.0),
                    "workers={workers} row={row}: {a} vs {b}"
                );
                assert!(
                    (tangent.diagonal[row]
                        - tangent_diagonal(dense.tangent.as_ref().unwrap(), row))
                    .abs()
                        < 1e-9
                            * tangent_diagonal(dense.tangent.as_ref().unwrap(), row)
                                .abs()
                                .max(1.0)
                );
            }
        }
    }

    #[test]
    fn matrix_free_limits_and_thread_count_are_enforced_before_assembly() {
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmres,
                ..FiniteJ2TetOptions::default()
            },
        };
        request.options.matrix_free_threads = 0;
        assert!(solve(&request).unwrap_err().contains("options"));
        request.options.matrix_free_threads = MAX_MATRIX_FREE_THREADS + 1;
        assert!(solve(&request).unwrap_err().contains("options"));
        request.options.matrix_free_threads = 1;
        request.mesh.tets = vec![[0, 1, 2, 3]; MAX_MATRIX_FREE_TETS + 1];
        assert!(solve(&request).unwrap_err().contains("limit"));
        request.mesh = tet();
        request
            .mesh
            .nodes
            .resize(MAX_MATRIX_FREE_DOFS / 3 + 1, [0.0; 3]);
        assert!(solve(&request).unwrap_err().contains("limit"));
    }

    #[test]
    fn large_matrix_free_is_opt_in_and_matches_small_backend() {
        let mut prescribed = vec![[Some(0.0); 3]; 4];
        prescribed[3] = [None, None, Some(0.004)];
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; 4],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: prescribed,
            }],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmres,
                matrix_free_threads: 2,
                ..FiniteJ2TetOptions::default()
            },
        };
        let small = solve(&request).unwrap();
        request.options.linear_backend = FiniteJ2TetLinearBackend::MatrixFreeGmresLarge;
        let large = solve(&request).unwrap();
        assert_eq!(
            large.linear_backend_used,
            FiniteJ2TetLinearBackend::MatrixFreeGmresLarge
        );
        assert!(large.element_states[0].equivalent_plastic_strain > 0.0);
        for (a, b) in large
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(small.nodal_displacements_m.iter().flatten())
        {
            assert!((a - b).abs() < 1e-10);
        }
        for (a, b) in large
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(small.nodal_reactions_kn.iter().flatten())
        {
            assert!((a - b).abs() < 1e-4);
        }
        assert!((large.true_free_residual_kn - small.true_free_residual_kn).abs() < 1e-8);
    }

    #[test]
    fn large_matrix_free_rejects_size_and_basis_before_assembly() {
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                ..FiniteJ2TetOptions::default()
            },
        };
        request.mesh.tets = vec![[0, 1, 2, 3]; MAX_LARGE_MATRIX_FREE_TETS + 1];
        assert!(solve(&request).unwrap_err().contains("limit"));
        request.mesh = tet();
        request
            .mesh
            .nodes
            .resize(MAX_LARGE_MATRIX_FREE_DOFS / 3 + 1, [0.0; 3]);
        assert!(solve(&request).unwrap_err().contains("limit"));
        request.mesh.nodes.truncate(MAX_LARGE_MATRIX_FREE_DOFS / 3);
        request.options.gmres_restart = MAX_GMRES_RESTART;
        assert!(solve(&request).unwrap_err().contains("basis exceeds"));
    }

    #[test]
    fn large_matrix_free_memory_gate_counts_input_targets() {
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                ..FiniteJ2TetOptions::default()
            },
        };
        let baseline = large_matrix_free_estimated_bytes(&request, 12).unwrap();
        request.targets[0].body_forces.push(FiniteJ2TetBodyForce {
            element: 0,
            force_kn_per_m3: [1.0, 0.0, 0.0],
        });
        assert_eq!(
            large_matrix_free_estimated_bytes(&request, 12).unwrap() - baseline,
            std::mem::size_of::<FiniteJ2TetBodyForce>()
        );
    }

    #[test]
    fn large_matrix_free_budget_covers_requested_acceptance_shape() {
        // This is a sizing check only; an independent test must solve a real
        // connected 257,250-element mesh before scale is claimed as validated.
        let nodes = 46_656;
        let elements = 257_250;
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                matrix_free_threads: 4,
                ..FiniteJ2TetOptions::default()
            },
        };
        request.mesh.nodes.resize(nodes, [0.0; 3]);
        request.mesh.tets.resize(elements, [0, 1, 2, 3]);
        request.targets[0].loads_kn.resize(nodes, [0.0; 3]);
        request.targets[0].prescribed_m.resize(nodes, [None; 3]);
        let estimated = large_matrix_free_estimated_bytes(&request, nodes * 3).unwrap();
        assert!(
            estimated <= MAX_LARGE_MATRIX_FREE_ESTIMATED_BYTES,
            "acceptance shape estimate {estimated} exceeds budget"
        );
    }

    #[test]
    fn large_hex_streaming_budget_admits_250047_cell_shape_without_solving() {
        // Capacity accounting only: the 63³ nonlinear solve still requires a
        // release acceptance run, convergence proof and peak-RSS measurement.
        let cells = 63_usize.pow(3);
        let nodes = 64_usize.pow(3);
        let dofs = nodes * 3;
        assert!(dofs <= MAX_LARGE_MATRIX_FREE_DOFS);
        let basis = dofs * 9; // restart=8 plus the Arnoldi work vector
        assert!(basis <= MAX_LARGE_MATRIX_FREE_BASIS_SCALARS);
        let request = FiniteJ2TetRequest {
            mesh: Mesh {
                nodes: vec![[0.0; 3]; nodes],
                tets: vec![],
            },
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; nodes],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: vec![[Some(0.0); 3]; nodes],
            }],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::MatrixFreeGmresLarge,
                matrix_free_threads: 4,
                gmres_restart: 8,
                ..FiniteJ2TetOptions::default()
            },
        };
        let estimated = large_matrix_free_estimated_bytes_coupled(&request, 0, 0, dofs).unwrap()
            + hex_large_estimated_bytes(cells, &[]).unwrap();
        assert!(
            estimated <= MAX_LARGE_MATRIX_FREE_ESTIMATED_BYTES,
            "250047-Hex8 capacity estimate {estimated} exceeds 4 GiB"
        );
    }

    #[test]
    fn frontal_wave_matches_dense_plastic_free_dof_solution_and_rejects_mechanism() {
        let mut prescribed = vec![[Some(0.0); 3]; 4];
        prescribed[3] = [None, None, Some(0.004)];
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; 4],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: prescribed,
            }],
            options: FiniteJ2TetOptions::default(),
        };
        let dense = solve(&request).unwrap();
        request.options.linear_backend = FiniteJ2TetLinearBackend::FrontalWave;
        let frontal = solve(&request).unwrap();
        assert_eq!(
            frontal.linear_backend_used,
            FiniteJ2TetLinearBackend::FrontalWave
        );
        assert_eq!(frontal.frontal_fallbacks, 0);
        for (actual, expected) in frontal
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(dense.nodal_displacements_m.iter().flatten())
        {
            assert!((actual - expected).abs() < 1e-10);
        }
        for (actual, expected) in frontal
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(dense.nodal_reactions_kn.iter().flatten())
        {
            assert!((actual - expected).abs() < 1e-4);
        }
        request.options.max_front_dofs = 1;
        assert!(solve(&request)
            .unwrap_err()
            .contains("wavefront exceeded maximum"));
        request.options.max_front_dofs = MAX_FRONT_DOFS + 1;
        assert!(solve(&request)
            .unwrap_err()
            .contains("invalid finite J2 Tet4 Newton/step options"));
        request.options.max_front_dofs = 256;
        request.targets[0].prescribed_m = vec![[None; 3]; 4];
        request.targets[0].prescribed_m[0] = [Some(0.0); 3];
        assert!(solve(&request).unwrap_err().contains("frontal"));
    }

    #[test]
    fn large_frontal_admission_rejects_storage_above_budget() {
        let n = 8_000;
        let mut mesh = tet();
        mesh.nodes.resize(n, [2.0, 2.0, 2.0]);
        let mut request = FiniteJ2TetRequest {
            mesh,
            steel: steel(),
            element_steels: None,
            targets: vec![FiniteJ2TetTarget {
                loads_kn: vec![[0.0; 3]; n],
                body_forces: vec![],
                face_tractions: vec![],
                prescribed_m: vec![[None; 3]; n],
            }],
            options: FiniteJ2TetOptions {
                linear_backend: FiniteJ2TetLinearBackend::FrontalWave,
                max_front_dofs: 1_024,
                ..FiniteJ2TetOptions::default()
            },
        };
        for backend in [
            FiniteJ2TetLinearBackend::FrontalWave,
            FiniteJ2TetLinearBackend::Automatic,
        ] {
            request.options.linear_backend = backend;
            assert!(solve(&request)
                .unwrap_err()
                .contains("frontal storage estimate"));
        }
    }

    #[test]
    fn frontal_normalizes_only_roundoff_sized_element_asymmetry() {
        let mesh = tet();
        let prepared = prepare_tets(&mesh).unwrap();
        for a in [0.0, 1e-9, 1e-6, 1e-4, 0.01] {
            let u = mesh
                .nodes
                .iter()
                .map(|&[x, y, z]| {
                    [
                        ((a as f64).exp() - 1.0) * x,
                        ((-a as f64).exp() - 1.0) * y,
                        0.0 * z,
                    ]
                })
                .collect::<Vec<_>>();
            let element = solid_finite_j2_tet::evaluate(
                steel(),
                &FiniteJ2State::default(),
                prepared[0].gradients,
                prepared[0].volume,
                u.try_into().unwrap(),
                true,
            )
            .unwrap();
            let k = element.tangent_kn_per_m.unwrap();
            let normalized = checked_symmetric_frontal_stiffness(&k, 0).unwrap();
            let mut max_skew = 0.0_f64;
            let mut max_entry = 0.0_f64;
            for i in 0..12 {
                for j in 0..12 {
                    let skew = (k[i * 12 + j] - k[j * 12 + i]).abs();
                    max_skew = max_skew.max(skew);
                    max_entry = max_entry.max(k[i * 12 + j].abs());
                    assert_eq!(normalized[i * 12 + j], normalized[j * 12 + i]);
                }
            }
            assert!(
                max_skew <= 1e-13 * max_entry,
                "a={a:e}, ratio={:e}",
                max_skew / max_entry
            );
        }
        let mut nonsymmetric = [0.0; 144];
        for i in 0..12 {
            nonsymmetric[i * 12 + i] = 1.0;
        }
        nonsymmetric[1] = 1e-8;
        assert!(checked_symmetric_frontal_stiffness(&nonsymmetric, 0)
            .unwrap_err()
            .contains("not symmetric"));
    }

    #[test]
    fn sparse_gmres_options_are_bounded() {
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions::default(),
        };
        request.options.linear_backend = FiniteJ2TetLinearBackend::SparseGmres;
        request.options.gmres_restart = MAX_GMRES_RESTART + 1;
        assert!(solve(&request)
            .unwrap_err()
            .contains("invalid finite J2 Tet4 Newton/step options"));
        request.options.gmres_restart = 40;
        request.options.gmres_max_iterations = MAX_GMRES_ITERATIONS + 1;
        assert!(solve(&request)
            .unwrap_err()
            .contains("invalid finite J2 Tet4 Newton/step options"));
    }

    #[test]
    fn mechanism_and_support_change_are_rejected() {
        let mut target = fully_prescribed_shear(0.0);
        target.prescribed_m = vec![[None; 3]; 4];
        target.prescribed_m[0] = [Some(0.0); 3];
        let request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![target.clone()],
            options: FiniteJ2TetOptions::default(),
        };
        assert!(solve(&request)
            .unwrap_err()
            .contains("singular free tangent"));
        let mut request = request;
        request.options.linear_backend = FiniteJ2TetLinearBackend::SparseGmres;
        assert!(
            solve(&request).is_err(),
            "GMRES must reject this rigid mechanism"
        );
        request.options.linear_backend = FiniteJ2TetLinearBackend::Dense;
        request.targets.push(fully_prescribed_shear(0.0));
        assert!(solve(&request).unwrap_err().contains("support pattern"));
    }

    #[test]
    fn oversized_model_is_explicitly_rejected() {
        let mut mesh = tet();
        mesh.nodes.extend(std::iter::repeat_n([2.0, 2.0, 2.0], 37));
        let request = FiniteJ2TetRequest {
            mesh,
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions::default(),
        };
        assert!(solve(&request).unwrap_err().contains("limit"));
    }

    #[test]
    fn unknown_load_types_and_options_are_rejected_on_deserialization() {
        let request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions::default(),
        };
        let mut value = serde_json::to_value(&request).unwrap();
        value["targets"][0]["followerPressure"] = serde_json::json!(1.0);
        assert!(serde_json::from_value::<FiniteJ2TetRequest>(value).is_err());
        let mut value = serde_json::to_value(&request).unwrap();
        value["targets"][0]["faceTractions"] = serde_json::json!([{
            "element": 0,
            "faceNodes": [0, 1, 2],
            "tractionKnPerM2": [0.0, 0.0, 1.0],
            "follower": true
        }]);
        assert!(serde_json::from_value::<FiniteJ2TetRequest>(value).is_err());
        let mut value = serde_json::to_value(&request).unwrap();
        value["options"]["linearBackend"] = serde_json::json!("sparseDirect");
        assert!(serde_json::from_value::<FiniteJ2TetRequest>(value).is_err());
    }

    #[test]
    fn reference_distributed_loads_have_exact_consistent_nodal_values() {
        let mesh = tet();
        let prepared = prepare_tets(&mesh).unwrap();
        let mut target = fully_prescribed_shear(0.0);
        target.body_forces.push(FiniteJ2TetBodyForce {
            element: 0,
            force_kn_per_m3: [24.0, -48.0, 72.0],
        });
        target.face_tractions.push(FiniteJ2TetFaceTraction {
            element: 0,
            face_nodes: [0, 2, 1],
            traction_kn_per_m2: [6.0, 0.0, -12.0],
        });
        let loads = assemble_target_loads(&target, &mesh, &prepared).unwrap();
        for node in 0..4 {
            let face = if node == 3 { 0.0 } else { 1.0 };
            assert!((loads[3 * node] - (1.0 + face)).abs() < 1e-12);
            assert!((loads[3 * node + 1] + 2.0).abs() < 1e-12);
            assert!((loads[3 * node + 2] - (3.0 - 2.0 * face)).abs() < 1e-12);
        }
        let result = solve(&FiniteJ2TetRequest {
            mesh,
            steel: steel(),
            element_steels: None,
            targets: vec![target],
            options: FiniteJ2TetOptions::default(),
        })
        .unwrap();
        for (reaction, force) in result.nodal_reactions_kn.iter().flatten().zip(loads) {
            assert!((reaction + force).abs() < 1e-10);
        }
        assert_eq!(result.true_free_residual_kn, 0.0);
    }

    #[test]
    fn invalid_reference_loads_are_rejected_before_newton() {
        let mut request = FiniteJ2TetRequest {
            mesh: tet(),
            steel: steel(),
            element_steels: None,
            targets: vec![fully_prescribed_shear(0.0)],
            options: FiniteJ2TetOptions::default(),
        };
        request.targets[0].body_forces.push(FiniteJ2TetBodyForce {
            element: 1,
            force_kn_per_m3: [1.0, 0.0, 0.0],
        });
        assert!(solve(&request)
            .unwrap_err()
            .contains("body force 0: element"));
        request.targets[0].body_forces[0].element = 0;
        request.targets[0].body_forces[0].force_kn_per_m3[0] = f64::NAN;
        assert!(solve(&request)
            .unwrap_err()
            .contains("non-finite force density"));
        request.targets[0].body_forces.clear();
        request.targets[0]
            .face_tractions
            .push(FiniteJ2TetFaceTraction {
                element: 0,
                face_nodes: [0, 0, 1],
                traction_kn_per_m2: [1.0, 0.0, 0.0],
            });
        assert!(solve(&request)
            .unwrap_err()
            .contains("invalid face or traction"));
        request.targets[0].face_tractions[0].face_nodes = [0, 1, 99];
        assert!(solve(&request)
            .unwrap_err()
            .contains("invalid face or traction"));
    }

    #[test]
    fn hex_only_plastic_load_unload_commits_eight_gauss_histories() {
        let nodes = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 1.0],
        ];
        let steel = FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 1_000.0).unwrap();
        let target = |factor: f64| FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; 8],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m: nodes
                .iter()
                .map(|p| [Some(0.01 * factor * p[0]), Some(0.0), Some(0.0)])
                .collect(),
        };
        let targets = vec![target(1.0), target(0.0)];
        let request = FiniteJ2HexCoupledRequest {
            volume: FiniteJ2TetRequest {
                mesh: Mesh {
                    nodes,
                    tets: vec![],
                },
                steel,
                element_steels: None,
                targets,
                options: FiniteJ2TetOptions::default(),
            },
            hexes: vec![FiniteJ2HexCell {
                nodes: [0, 1, 2, 3, 4, 5, 6, 7],
                steel,
            }],
            hex_targets: vec![FiniteJ2HexTarget::default(), FiniteJ2HexTarget::default()],
            trusses: vec![],
            membranes: vec![],
        };
        let result = solve_hex_coupled(&request).unwrap();
        assert!(result.element_states.is_empty());
        assert_eq!(result.hex_gauss_states.len(), 1);
        assert!(result.hex_gauss_states[0]
            .iter()
            .all(|state| state.equivalent_plastic_strain > 0.0));
        assert!(result.hex_gauss_first_piola_mpa[0]
            .iter()
            .flatten()
            .flatten()
            .all(|value| value.is_finite()));
        assert!(result.hex_gauss_cauchy_mpa[0]
            .iter()
            .flatten()
            .flatten()
            .all(|value| value.is_finite()));
        assert!(result
            .nodal_displacements_m
            .iter()
            .flatten()
            .all(|value| value.abs() < 1e-10));
        assert!(result.true_free_residual_kn < 1e-8);
        let mut invalid = request.clone();
        invalid.hex_targets.pop();
        assert!(solve_hex_coupled(&invalid)
            .unwrap_err()
            .contains("hexTargets"));
        invalid = request.clone();
        invalid.hexes[0].nodes[1] = 0;
        assert!(solve_hex_coupled(&invalid)
            .unwrap_err()
            .contains("invalid node"));
        invalid = request.clone();
        invalid.hex_targets[0]
            .face_tractions
            .push(FiniteJ2HexFaceTraction {
                element: 0,
                face_nodes: [1, 5, 6, 2],
                traction_kn_per_m2: [1.0, 0.0, 0.0],
            });
        assert!(solve_hex_coupled(&invalid)
            .unwrap_err()
            .contains("face traction"));
    }
}
