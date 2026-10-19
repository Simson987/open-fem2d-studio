//! Total-Lagrangian, fully integrated Hex8 action for finite-strain J2 steel.
//!
//! Geometry is prepared once in the reference configuration. Each of the eight
//! Gauss points keeps its own committed history; evaluation returns trial
//! histories without modifying the committed array. Coordinates and
//! displacements are metres, stresses MPa, forces kN, and tangents kN/m.

use crate::hex8::CORNER_SIGNS;
use crate::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel, FiniteJ2Update, Tensor3};

const MPA_M2_TO_KN: f64 = 1_000.0;

/// Reference gradients and integration weights, ordered with ξ outermost,
/// η middle and ζ innermost, negative before positive on each axis.
#[derive(Clone, Debug)]
pub struct FiniteJ2Hex8Geometry {
    pub gauss_gradients: [[[f64; 3]; 8]; 8],
    pub gauss_weights_m3: [f64; 8],
    pub volume_m3: f64,
}

#[derive(Clone, Debug)]
pub struct FiniteJ2Hex8Action {
    /// Material-point outputs, including uncommitted candidate history.
    pub gauss_points: [FiniteJ2Update; 8],
    pub deformation_gradients: [Tensor3; 8],
    pub internal_force_kn: [f64; 24],
    /// Row-major 24×24 consistent tangent, if requested.
    pub tangent_kn_per_m: Option<[f64; 576]>,
}

impl FiniteJ2Hex8Geometry {
    /// Prepare one reference Hex8 with corner order (000, 100, 110, 010,
    /// 001, 101, 111, 011). Rejects collapsed or inverted Jacobians at all
    /// integration points and corners; curved faces are not represented.
    pub fn new(coordinates_m: [[f64; 3]; 8]) -> Result<Self, String> {
        if coordinates_m.iter().flatten().any(|v| !v.is_finite()) {
            return Err("finite J2 Hex8 coordinates must be finite".into());
        }
        let mut size: f64 = 0.0;
        for point in &coordinates_m {
            for axis in 0..3 {
                size = size.max((point[axis] - coordinates_m[0][axis]).abs());
            }
        }
        if size == 0.0 || !size.is_finite() {
            return Err("finite J2 Hex8 has zero or non-finite size".into());
        }
        let determinant_floor = 1e-12 * size * size * size;
        if !determinant_floor.is_finite() || determinant_floor == 0.0 {
            return Err("finite J2 Hex8 geometry scale is unrepresentable".into());
        }

        let g = 1.0 / 3.0_f64.sqrt();
        let mut gauss_gradients = [[[0.0; 3]; 8]; 8];
        let mut gauss_weights_m3 = [0.0; 8];
        let mut index = 0;
        for &xi in &[-g, g] {
            for &eta in &[-g, g] {
                for &zeta in &[-g, g] {
                    let (gradients, determinant) =
                        reference_gradients(&coordinates_m, [xi, eta, zeta], determinant_floor)?;
                    gauss_gradients[index] = gradients;
                    gauss_weights_m3[index] = determinant;
                    index += 1;
                }
            }
        }
        // A trilinear map can be acceptable at the Gauss points while a
        // corner folds. Explicit corner checks catch that common bad input.
        for corner in CORNER_SIGNS {
            reference_gradients(&coordinates_m, corner, determinant_floor)?;
        }
        let volume_m3: f64 = gauss_weights_m3.iter().sum();
        if !volume_m3.is_finite() || volume_m3 <= 0.0 {
            return Err("finite J2 Hex8 reference volume is non-finite".into());
        }
        Ok(Self {
            gauss_gradients,
            gauss_weights_m3,
            volume_m3,
        })
    }
}

/// Evaluate eight material points from *committed* history. The tangent is
/// branch-consistent away from the yield switch; an exact derivative does not
/// exist on that switch. The caller commits `gauss_points[*].state` only after
/// convergence and acceptance of the load step.
pub fn evaluate(
    material: FiniteJ2Steel,
    committed: &[FiniteJ2State; 8],
    geometry: &FiniteJ2Hex8Geometry,
    displacements_m: [[f64; 3]; 8],
    with_tangent: bool,
) -> Result<FiniteJ2Hex8Action, String> {
    evaluate_mode(
        material,
        committed,
        geometry,
        displacements_m,
        with_tangent,
        false,
    )
}

/// Select the one-sided Newton derivative at a yield switch, as in Tet4.
pub fn evaluate_with_one_sided_tangent(
    material: FiniteJ2Steel,
    committed: &[FiniteJ2State; 8],
    geometry: &FiniteJ2Hex8Geometry,
    displacements_m: [[f64; 3]; 8],
) -> Result<FiniteJ2Hex8Action, String> {
    evaluate_mode(material, committed, geometry, displacements_m, true, true)
}

/// Apply the exact local consistent tangent to one displacement direction
/// without constructing or retaining the 24×24 element matrix. The committed
/// history is held fixed, just as in `evaluate`. At the yield switch the same
/// one-sided Newton branch as `evaluate_with_one_sided_tangent` is selected.
pub(crate) fn tangent_product(
    material: FiniteJ2Steel,
    committed: &[FiniteJ2State; 8],
    geometry: &FiniteJ2Hex8Geometry,
    displacements_m: [[f64; 3]; 8],
    direction_m: [[f64; 3]; 8],
) -> Result<[f64; 24], String> {
    if displacements_m
        .iter()
        .chain(&direction_m)
        .flatten()
        .any(|x| !x.is_finite())
    {
        return Err("finite J2 Hex8 tangent product needs finite vectors".into());
    }
    let mut result = [0.0; 24];
    for gauss in 0..8 {
        let gradients = &geometry.gauss_gradients[gauss];
        let weight = MPA_M2_TO_KN * geometry.gauss_weights_m3[gauss];
        if !weight.is_finite() || weight <= 0.0 {
            return Err("finite J2 Hex8 prepared geometry is invalid".into());
        }
        let mut f = [[0.0; 3]; 3];
        let mut df = [[0.0; 3]; 3];
        for a in 0..3 {
            f[a][a] = 1.0;
            for node in 0..8 {
                for reference in 0..3 {
                    f[a][reference] += displacements_m[node][a] * gradients[node][reference];
                    df[a][reference] += direction_m[node][a] * gradients[node][reference];
                }
            }
        }
        let update = material
            .update_with_tangent(&committed[gauss], f)
            .or_else(|error| {
                if error == "finite J2 tangent is undefined at the elastic/plastic switch" {
                    material.update_with_one_sided_tangent(&committed[gauss], f)
                } else {
                    Err(error)
                }
            })?;
        let mut dp = [[0.0; 3]; 3];
        for a in 0..3 {
            for reference in 0..3 {
                for b in 0..3 {
                    for other_reference in 0..3 {
                        dp[a][reference] += update.tangent_mpa[3 * a + reference]
                            [3 * b + other_reference]
                            * df[b][other_reference];
                    }
                }
            }
        }
        for node in 0..8 {
            for a in 0..3 {
                for reference in 0..3 {
                    result[3 * node + a] += weight * gradients[node][reference] * dp[a][reference];
                }
            }
        }
    }
    if result.iter().any(|x| !x.is_finite()) {
        return Err("finite J2 Hex8 tangent product overflow".into());
    }
    Ok(result)
}

fn evaluate_mode(
    material: FiniteJ2Steel,
    committed: &[FiniteJ2State; 8],
    geometry: &FiniteJ2Hex8Geometry,
    displacements_m: [[f64; 3]; 8],
    with_tangent: bool,
    allow_switch: bool,
) -> Result<FiniteJ2Hex8Action, String> {
    if displacements_m.iter().flatten().any(|v| !v.is_finite()) {
        return Err("finite J2 Hex8 displacements must be finite".into());
    }
    let mut force = [0.0; 24];
    let mut stiffness = with_tangent.then_some([0.0; 576]);
    let mut points = Vec::with_capacity(8);
    let mut deformation_gradients = [[[0.0; 3]; 3]; 8];
    for gauss in 0..8 {
        let gradients = &geometry.gauss_gradients[gauss];
        let weight = MPA_M2_TO_KN * geometry.gauss_weights_m3[gauss];
        if !weight.is_finite()
            || weight <= 0.0
            || gradients.iter().flatten().any(|v| !v.is_finite())
        {
            return Err("finite J2 Hex8 prepared geometry is invalid".into());
        }
        let mut f = [[0.0; 3]; 3];
        for a in 0..3 {
            f[a][a] = 1.0;
            for node in 0..8 {
                for reference in 0..3 {
                    f[a][reference] += displacements_m[node][a] * gradients[node][reference];
                }
            }
        }
        deformation_gradients[gauss] = f;
        let (point, tangent) = if with_tangent {
            let update = if allow_switch {
                material.update_with_one_sided_tangent(&committed[gauss], f)?
            } else {
                material.update_with_tangent(&committed[gauss], f)?
            };
            (update.point, Some(update.tangent_mpa))
        } else {
            (material.update(&committed[gauss], f)?, None)
        };
        for node in 0..8 {
            for a in 0..3 {
                for reference in 0..3 {
                    force[3 * node + a] +=
                        weight * point.first_piola_mpa[a][reference] * gradients[node][reference];
                }
            }
        }
        if let (Some(k), Some(c)) = (&mut stiffness, tangent) {
            for node_i in 0..8 {
                for a in 0..3 {
                    for node_j in 0..8 {
                        for b in 0..3 {
                            let row = 3 * node_i + a;
                            let column = 3 * node_j + b;
                            for reference_i in 0..3 {
                                for reference_j in 0..3 {
                                    k[row * 24 + column] += weight
                                        * gradients[node_i][reference_i]
                                        * c[3 * a + reference_i][3 * b + reference_j]
                                        * gradients[node_j][reference_j];
                                }
                            }
                        }
                    }
                }
            }
        }
        points.push(point);
    }
    if force.iter().any(|v| !v.is_finite())
        || stiffness
            .as_ref()
            .is_some_and(|k| k.iter().any(|v| !v.is_finite()))
    {
        return Err("finite J2 Hex8 response is non-finite".into());
    }
    Ok(FiniteJ2Hex8Action {
        gauss_points: points
            .try_into()
            .map_err(|_| "finite J2 Hex8 Gauss count mismatch")?,
        deformation_gradients,
        internal_force_kn: force,
        tangent_kn_per_m: stiffness,
    })
}

fn reference_gradients(
    coordinates_m: &[[f64; 3]; 8],
    natural: [f64; 3],
    determinant_floor: f64,
) -> Result<([[f64; 3]; 8], f64), String> {
    let [xi, eta, zeta] = natural;
    let mut natural_gradients = [[0.0; 3]; 8];
    for (node, [sx, sy, sz]) in CORNER_SIGNS.iter().copied().enumerate() {
        natural_gradients[node] = [
            sx * (1.0 + sy * eta) * (1.0 + sz * zeta) / 8.0,
            sy * (1.0 + sx * xi) * (1.0 + sz * zeta) / 8.0,
            sz * (1.0 + sx * xi) * (1.0 + sy * eta) / 8.0,
        ];
    }
    let mut columns = [[0.0; 3]; 3];
    for node in 0..8 {
        for n in 0..3 {
            for physical in 0..3 {
                columns[n][physical] += (coordinates_m[node][physical]
                    - coordinates_m[0][physical])
                    * natural_gradients[node][n];
            }
        }
    }
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let cofactors = [
        cross(columns[1], columns[2]),
        cross(columns[2], columns[0]),
        cross(columns[0], columns[1]),
    ];
    let determinant: f64 = (0..3)
        .map(|axis| columns[0][axis] * cofactors[0][axis])
        .sum();
    if !determinant.is_finite() || determinant <= determinant_floor {
        return Err("finite J2 Hex8 has a collapsed or inverted reference Jacobian".into());
    }
    let mut gradients = [[0.0; 3]; 8];
    for node in 0..8 {
        for physical in 0..3 {
            for n in 0..3 {
                gradients[node][physical] +=
                    natural_gradients[node][n] * cofactors[n][physical] / determinant;
            }
        }
    }
    if gradients.iter().flatten().any(|v| !v.is_finite()) {
        return Err("finite J2 Hex8 reference gradients are non-finite".into());
    }
    Ok((gradients, determinant))
}
