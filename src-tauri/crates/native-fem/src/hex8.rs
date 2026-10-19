//! Fully integrated trilinear Hex8 element for small-strain isotropic elasticity.
//!
//! Coordinates and displacements are in metres, E and stress in MPa, and nodal
//! forces in kN. Local DOFs are `[ux, uy, uz]` for each of the eight nodes.
//! The corner ordering is (000, 100, 110, 010, 001, 101, 111, 011).
//! This element uses 2×2×2 Gauss integration; it does not implement geometric
//! nonlinearity, material nonlinearity, or a nearly incompressible formulation.

/// Natural-coordinate signs in the required node ordering.
pub const CORNER_SIGNS: [[f64; 3]; 8] = [
    [-1.0, -1.0, -1.0],
    [1.0, -1.0, -1.0],
    [1.0, 1.0, -1.0],
    [-1.0, 1.0, -1.0],
    [-1.0, -1.0, 1.0],
    [1.0, -1.0, 1.0],
    [1.0, 1.0, 1.0],
    [-1.0, 1.0, 1.0],
];

/// Local stiffness and integrated physical volume of one Hex8 element.
#[derive(Clone, Debug)]
pub struct Hex8Element {
    pub stiffness: [[f64; 24]; 24],
    pub volume_m3: f64,
    /// Physical shape-function gradients at the 2×2×2 Gauss points, ordered
    /// with ξ outermost, η middle and ζ innermost (negative before positive).
    pub gauss_gradients: [[[f64; 3]; 8]; 8],
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

impl Hex8Element {
    /// Builds the 24×24 local stiffness by 2×2×2 Gauss integration.
    /// Rejects invalid material data, collapsed cells and nonpositive Jacobians.
    pub fn new(coordinates_m: [[f64; 3]; 8], e_mpa: f64, poisson: f64) -> Result<Self, String> {
        if !e_mpa.is_finite() || e_mpa <= 0.0 {
            return Err("Hex8 E must be positive and finite".into());
        }
        if !poisson.is_finite() || !(0.0..0.5).contains(&poisson) {
            return Err("Hex8 Poisson ratio must be in [0, 0.5)".into());
        }
        if coordinates_m.iter().flatten().any(|v| !v.is_finite()) {
            return Err("Hex8 coordinates must be finite".into());
        }
        let lambda = e_mpa * poisson / ((1.0 + poisson) * (1.0 - 2.0 * poisson)) * 1_000.0;
        let mu = e_mpa / (2.0 * (1.0 + poisson)) * 1_000.0;
        if !lambda.is_finite() || !mu.is_finite() {
            return Err("Hex8 material coefficients overflow".into());
        }

        // A translation-invariant geometry scale for checking Jacobian collapse.
        let mut size: f64 = 0.0;
        for point in &coordinates_m {
            for axis in 0..3 {
                size = size.max((point[axis] - coordinates_m[0][axis]).abs());
            }
        }
        if !size.is_finite() || size == 0.0 {
            return Err("Hex8 has zero or non-finite size".into());
        }
        let determinant_floor = 1e-12 * size * size * size;
        if !determinant_floor.is_finite() {
            return Err("Hex8 geometry scale overflows".into());
        }

        let mut stiffness = [[0.0; 24]; 24];
        let mut volume_m3 = 0.0;
        let mut gauss_gradients = [[[0.0; 3]; 8]; 8];
        let mut gauss_index = 0;
        let g = 1.0 / 3.0_f64.sqrt();
        for &xi in &[-g, g] {
            for &eta in &[-g, g] {
                for &zeta in &[-g, g] {
                    let mut natural_gradients = [[0.0; 3]; 8];
                    for (i, signs) in CORNER_SIGNS.iter().enumerate() {
                        let [sx, sy, sz] = *signs;
                        natural_gradients[i] = [
                            sx * (1.0 + sy * eta) * (1.0 + sz * zeta) / 8.0,
                            sy * (1.0 + sx * xi) * (1.0 + sz * zeta) / 8.0,
                            sz * (1.0 + sx * xi) * (1.0 + sy * eta) / 8.0,
                        ];
                    }

                    // Columns are ∂x/∂ξ, ∂x/∂η and ∂x/∂ζ.
                    let mut columns = [[0.0; 3]; 3];
                    for i in 0..8 {
                        for natural in 0..3 {
                            for physical in 0..3 {
                                columns[natural][physical] += (coordinates_m[i][physical]
                                    - coordinates_m[0][physical])
                                    * natural_gradients[i][natural];
                            }
                        }
                    }
                    let cofactors = [
                        cross(columns[1], columns[2]),
                        cross(columns[2], columns[0]),
                        cross(columns[0], columns[1]),
                    ];
                    let determinant = dot(columns[0], cofactors[0]);
                    if !determinant.is_finite() || determinant <= determinant_floor {
                        return Err(
                            "Hex8 has a collapsed or inverted Jacobian at a Gauss point".into()
                        );
                    }
                    let mut gradients = [[0.0; 3]; 8];
                    for i in 0..8 {
                        for physical in 0..3 {
                            for natural in 0..3 {
                                gradients[i][physical] += natural_gradients[i][natural]
                                    * cofactors[natural][physical]
                                    / determinant;
                            }
                        }
                    }

                    gauss_gradients[gauss_index] = gradients;
                    gauss_index += 1;

                    volume_m3 += determinant;
                    for i in 0..8 {
                        for j in 0..8 {
                            let grad_dot = dot(gradients[i], gradients[j]);
                            for a in 0..3 {
                                for b in 0..3 {
                                    // B_i^T D B_j in index notation. The two µ terms
                                    // account for the symmetric displacement gradient.
                                    let value = lambda * gradients[i][a] * gradients[j][b]
                                        + mu * gradients[i][b] * gradients[j][a]
                                        + if a == b { mu * grad_dot } else { 0.0 };
                                    stiffness[3 * i + a][3 * j + b] += determinant * value;
                                }
                            }
                        }
                    }
                }
            }
        }
        if !volume_m3.is_finite() || stiffness.iter().flatten().any(|v| !v.is_finite()) {
            return Err("Hex8 stiffness or volume overflows".into());
        }
        // The weak form is symmetric. Average reciprocal entries so roundoff
        // from different multiplication orders cannot make the CSR SPD check
        // reject an otherwise valid assembled element.
        for i in 0..24 {
            for j in i + 1..24 {
                let symmetric = 0.5 * (stiffness[i][j] + stiffness[j][i]);
                stiffness[i][j] = symmetric;
                stiffness[j][i] = symmetric;
            }
        }
        Ok(Self {
            stiffness,
            volume_m3,
            gauss_gradients,
        })
    }

    /// Applies the local stiffness to nodal displacements, giving nodal forces in kN.
    pub fn apply(&self, displacements_m: [f64; 24]) -> [f64; 24] {
        let mut forces_kn = [0.0; 24];
        for (i, row) in self.stiffness.iter().enumerate() {
            forces_kn[i] = row.iter().zip(displacements_m).map(|(k, u)| k * u).sum();
        }
        forces_kn
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit_cube() -> [[f64; 3]; 8] {
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 1.0],
        ]
    }

    fn close(actual: f64, expected: f64, tolerance: f64) {
        assert!(
            (actual - expected).abs() <= tolerance,
            "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
        );
    }

    #[test]
    fn uniaxial_affine_patch_has_analytic_face_resultants() {
        let cube = unit_cube();
        let e = 210_000.0;
        let nu = 0.3;
        let epsilon = 0.001;
        let element = Hex8Element::new(cube, e, nu).unwrap();
        close(element.volume_m3, 1.0, 1e-13);
        let mut u = [0.0; 24];
        for (i, xyz) in cube.iter().enumerate() {
            u[3 * i] = epsilon * xyz[0];
            u[3 * i + 1] = -nu * epsilon * xyz[1];
            u[3 * i + 2] = -nu * epsilon * xyz[2];
        }
        let f = element.apply(u);
        let face_force = e * epsilon * 1_000.0 / 4.0;
        for (i, xyz) in cube.iter().enumerate() {
            close(
                f[3 * i],
                if xyz[0] == 0.0 {
                    -face_force
                } else {
                    face_force
                },
                1e-8,
            );
            close(f[3 * i + 1], 0.0, 1e-8);
            close(f[3 * i + 2], 0.0, 1e-8);
        }
        close(
            (0..8)
                .filter(|&i| cube[i][0] == 1.0)
                .map(|i| f[3 * i])
                .sum(),
            e * epsilon * 1_000.0,
            1e-8,
        );
    }

    #[test]
    fn affine_shear_has_analytic_nodal_tractions_and_energy() {
        let cube = unit_cube();
        let element = Hex8Element::new(cube, 1_000.0, 0.25).unwrap();
        let gamma = 0.002;
        let mu = 1_000.0 / (2.0 * 1.25);
        let traction_kn_m2 = mu * gamma * 1_000.0;
        let mut u = [0.0; 24];
        for (i, xyz) in cube.iter().enumerate() {
            u[3 * i] = gamma * xyz[1];
        }
        let f = element.apply(u);
        for (i, xyz) in cube.iter().enumerate() {
            close(
                f[3 * i],
                traction_kn_m2 / 4.0 * if xyz[1] == 0.0 { -1.0 } else { 1.0 },
                1e-10,
            );
            close(
                f[3 * i + 1],
                traction_kn_m2 / 4.0 * if xyz[0] == 0.0 { -1.0 } else { 1.0 },
                1e-10,
            );
            close(f[3 * i + 2], 0.0, 1e-10);
        }
        close(
            u.iter().zip(f).map(|(a, b)| a * b).sum(),
            traction_kn_m2 * gamma,
            1e-10,
        );
    }

    #[test]
    fn six_rigid_body_modes_have_zero_force() {
        let cube = unit_cube();
        let element = Hex8Element::new(cube, 30_000.0, 0.2).unwrap();
        for mode in 0..6 {
            let mut u = [0.0; 24];
            for (i, [x, y, z]) in cube.iter().copied().enumerate() {
                let value = match mode {
                    0 => [1.0, 0.0, 0.0],
                    1 => [0.0, 1.0, 0.0],
                    2 => [0.0, 0.0, 1.0],
                    3 => [0.0, -z, y],
                    4 => [z, 0.0, -x],
                    _ => [-y, x, 0.0],
                };
                u[3 * i..3 * i + 3].copy_from_slice(&value);
            }
            for force in element.apply(u) {
                close(force, 0.0, 1e-7);
            }
        }
    }

    #[test]
    fn distorted_hex_is_symmetric_and_passes_affine_patch_balance() {
        let mut xyz = unit_cube();
        xyz[6] = [1.15, 1.1, 1.25];
        xyz[5] = [1.05, -0.05, 1.1];
        let element = Hex8Element::new(xyz, 25_000.0, 0.23).unwrap();
        assert!(element.volume_m3 > 1.0);
        let mut u = [0.0; 24];
        for (i, p) in xyz.iter().enumerate() {
            u[3 * i] = 0.001 * p[0] + 0.0005 * p[1];
            u[3 * i + 1] = -0.0002 * p[1];
            u[3 * i + 2] = 0.0003 * p[2];
        }
        let f = element.apply(u);
        for a in 0..3 {
            close((0..8).map(|i| f[3 * i + a]).sum(), 0.0, 1e-8);
        }
        for i in 0..24 {
            assert!(element.stiffness[i][i] > 0.0);
            for j in 0..24 {
                close(element.stiffness[i][j], element.stiffness[j][i], 1e-7);
            }
        }
    }

    #[test]
    fn invalid_material_and_degenerate_geometry_are_rejected() {
        let cube = unit_cube();
        assert!(Hex8Element::new(cube, 0.0, 0.2).is_err());
        assert!(Hex8Element::new(cube, 1_000.0, 0.5).is_err());
        let mut flat = cube;
        for point in &mut flat {
            point[2] = 0.0;
        }
        assert!(Hex8Element::new(flat, 1_000.0, 0.2).is_err());
        let mut inverted = cube;
        for point in &mut inverted {
            point[0] = 1.0 - point[0];
        }
        assert!(Hex8Element::new(inverted, 1_000.0, 0.2).is_err());
    }
}
