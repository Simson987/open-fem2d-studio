//! Total-Lagrangian Tet4 element action for the experimental finite J2 law.
//!
//! This element kernel accepts *prepared* reference gradients and volume. It
//! returns a trial material state; global Newton and load-step acceptance must
//! keep committed states unchanged until equilibrium has converged.

use crate::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel, FiniteJ2Update, Tensor3};

const MPA_M2_TO_KN: f64 = 1_000.0;

#[derive(Clone, Copy, Debug)]
pub struct FiniteJ2TetAction {
    pub material_point: FiniteJ2Update,
    pub deformation_gradient: Tensor3,
    pub internal_force_kn: [f64; 12],
    /// Row-major 12×12 consistent tangent in kN/m, if requested.
    pub tangent_kn_per_m: Option<[f64; 144]>,
}

/// Evaluate one constant-gradient Tet4 in the reference configuration.
/// `gradients` are ∇₀Nᵢ in 1/m and `volume_m3` is the positive reference
/// volume. Nodal displacements are in metres. The caller must supply a
/// conforming, nondegenerate reference element.
pub fn evaluate(
    material: FiniteJ2Steel,
    committed: &FiniteJ2State,
    gradients: [[f64; 3]; 4],
    volume_m3: f64,
    displacements_m: [[f64; 3]; 4],
    with_tangent: bool,
) -> Result<FiniteJ2TetAction, String> {
    evaluate_mode(
        material,
        committed,
        gradients,
        volume_m3,
        displacements_m,
        with_tangent,
        false,
    )
}

/// Return the explicitly selected one-sided Newton tangent at a yield switch.
/// The stress and trial history are unchanged; only the Jacobian branch is
/// chosen so an accepted state on the yield surface can be unloaded.
pub fn evaluate_with_one_sided_tangent(
    material: FiniteJ2Steel,
    committed: &FiniteJ2State,
    gradients: [[f64; 3]; 4],
    volume_m3: f64,
    displacements_m: [[f64; 3]; 4],
) -> Result<FiniteJ2TetAction, String> {
    evaluate_mode(
        material,
        committed,
        gradients,
        volume_m3,
        displacements_m,
        true,
        true,
    )
}

fn evaluate_mode(
    material: FiniteJ2Steel,
    committed: &FiniteJ2State,
    gradients: [[f64; 3]; 4],
    volume_m3: f64,
    displacements_m: [[f64; 3]; 4],
    with_tangent: bool,
    allow_switch: bool,
) -> Result<FiniteJ2TetAction, String> {
    if !volume_m3.is_finite() || volume_m3 <= 0.0 {
        return Err("finite J2 Tet4 requires positive reference volume".into());
    }
    if gradients.iter().flatten().any(|x| !x.is_finite())
        || displacements_m.iter().flatten().any(|x| !x.is_finite())
    {
        return Err("finite J2 Tet4 gradients and displacements must be finite".into());
    }
    let mut f = [[0.0; 3]; 3];
    for (a, row) in f.iter_mut().enumerate() {
        row[a] = 1.0;
        for (node, gradient) in gradients.iter().enumerate() {
            for i in 0..3 {
                row[i] += displacements_m[node][a] * gradient[i];
            }
        }
    }
    let (point, tangent) = if with_tangent {
        let update = if allow_switch {
            material.update_with_one_sided_tangent(committed, f)?
        } else {
            material.update_with_tangent(committed, f)?
        };
        (update.point, Some(update.tangent_mpa))
    } else {
        (material.update(committed, f)?, None)
    };
    let weight = MPA_M2_TO_KN * volume_m3;
    let mut force = [0.0; 12];
    for node in 0..4 {
        for a in 0..3 {
            force[3 * node + a] = weight
                * (0..3)
                    .map(|i| point.first_piola_mpa[a][i] * gradients[node][i])
                    .sum::<f64>();
        }
    }
    let stiffness = tangent.map(|c| {
        let mut k = [0.0; 144];
        for i in 0..4 {
            for a in 0..3 {
                for j in 0..4 {
                    for b in 0..3 {
                        k[(3 * i + a) * 12 + 3 * j + b] = weight
                            * (0..3)
                                .flat_map(|i_ref| {
                                    (0..3).map(move |j_ref| {
                                        gradients[i][i_ref]
                                            * c[3 * a + i_ref][3 * b + j_ref]
                                            * gradients[j][j_ref]
                                    })
                                })
                                .sum::<f64>();
                    }
                }
            }
        }
        k
    });
    if force.iter().any(|x| !x.is_finite())
        || stiffness
            .as_ref()
            .is_some_and(|k| k.iter().any(|x| !x.is_finite()))
    {
        return Err("finite J2 Tet4 response is non-finite".into());
    }
    Ok(FiniteJ2TetAction {
        material_point: point,
        deformation_gradient: f,
        internal_force_kn: force,
        tangent_kn_per_m: stiffness,
    })
}
