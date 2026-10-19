//! Consistent uniform body-force and face-traction nodal vectors for a Hex8.
//!
//! Node order is `[000, 100, 110, 010, 001, 101, 111, 011]` and physical
//! coordinates are metres. Body-force density is kN/m³, traction is kN/m²,
//! and the returned eight nodal vectors are kN. The integrations are
//! `∫_Ω N_i b dV` with 2×2×2 Gauss points and `∫_Γ N_i t dA` with 2×2
//! Gauss points. This follows the standard mapped-shape/Jacobian quadrature
//! described by MFEM: <https://mfem.org/integration/>.
//!
//! `face_nodes` are *local* Hex8 indices in outward cyclic order. Cyclic
//! rotations of the six canonical faces are accepted; reversed order and
//! nonfaces are rejected. Geometric checks are at quadrature points, not a
//! proof that an arbitrarily warped cell is globally injective.

const SIGNS: [[f64; 3]; 8] = [
    [-1.0, -1.0, -1.0],
    [1.0, -1.0, -1.0],
    [1.0, 1.0, -1.0],
    [-1.0, 1.0, -1.0],
    [-1.0, -1.0, 1.0],
    [1.0, -1.0, 1.0],
    [1.0, 1.0, 1.0],
    [-1.0, 1.0, 1.0],
];

/// Outward-oriented local face cycles for the documented Hex8 node order.
pub const OUTWARD_FACES: [[usize; 4]; 6] = [
    [0, 4, 7, 3], // xi negative
    [1, 2, 6, 5], // xi positive
    [0, 1, 5, 4], // eta negative
    [2, 3, 7, 6], // eta positive
    [0, 3, 2, 1], // zeta negative
    [4, 5, 6, 7], // zeta positive
];

const GAUSS: [f64; 2] = [-0.577_350_269_189_625_8, 0.577_350_269_189_625_8];

/// Integrate a constant body-force density over a possibly distorted Hex8.
pub fn consistent_uniform_body_force(
    coordinates_m: [[f64; 3]; 8],
    force_density_kn_per_m3: [f64; 3],
) -> Result<[[f64; 3]; 8], String> {
    let length = validate_coordinates(&coordinates_m)?;
    if force_density_kn_per_m3
        .iter()
        .any(|value| !value.is_finite())
    {
        return Err("non-finite Hex8 body-force density".into());
    }
    let mut result = [[0.0; 3]; 8];
    for xi in GAUSS {
        for eta in GAUSS {
            for zeta in GAUSS {
                let (shape, derivative) = volume_shape([xi, eta, zeta]);
                let determinant = checked_volume_determinant(&coordinates_m, &derivative, length)?;
                for node in 0..8 {
                    for component in 0..3 {
                        result[node][component] +=
                            shape[node] * force_density_kn_per_m3[component] * determinant;
                    }
                }
            }
        }
    }
    if result.iter().flatten().any(|value| !value.is_finite()) {
        return Err("Hex8 body-force nodal load overflow".into());
    }
    Ok(result)
}

/// Integrate a constant traction over one outward-oriented local Hex8 face.
/// The returned vector has zero entries outside the selected face.
pub fn consistent_uniform_face_traction(
    coordinates_m: [[f64; 3]; 8],
    face_nodes: [usize; 4],
    traction_kn_per_m2: [f64; 3],
) -> Result<[[f64; 3]; 8], String> {
    let length = validate_coordinates(&coordinates_m)?;
    if traction_kn_per_m2.iter().any(|value| !value.is_finite()) {
        return Err("non-finite Hex8 face traction".into());
    }
    if !OUTWARD_FACES.iter().any(|canonical| {
        (0..4).any(|offset| (0..4).all(|i| face_nodes[i] == canonical[(i + offset) % 4]))
    }) {
        return Err("invalid or inward-oriented local Hex8 face nodes".into());
    }
    let center: [f64; 3] = std::array::from_fn(|component| {
        coordinates_m
            .iter()
            .map(|node| node[component])
            .sum::<f64>()
            / 8.0
    });
    let face = face_nodes.map(|node| coordinates_m[node]);
    let mut result = [[0.0; 3]; 8];
    for s in GAUSS {
        for t in GAUSS {
            let (shape, ds, dt) = face_shape(s, t);
            let mut point = [0.0; 3];
            let mut tangent_s = [0.0; 3];
            let mut tangent_t = [0.0; 3];
            for local in 0..4 {
                for component in 0..3 {
                    point[component] += shape[local] * face[local][component];
                    tangent_s[component] += ds[local] * face[local][component];
                    tangent_t[component] += dt[local] * face[local][component];
                }
            }
            let area_vector = cross(tangent_s, tangent_t);
            let area_scale = dot(area_vector, area_vector).sqrt();
            if !area_scale.is_finite() || area_scale <= 1e-12 * length.powi(2) {
                return Err("degenerate Hex8 traction face".into());
            }
            let outward = std::array::from_fn(|component| point[component] - center[component]);
            if dot(area_vector, outward) <= 1e-12 * area_scale * length {
                return Err("inward or folded Hex8 traction face".into());
            }
            for local in 0..4 {
                for component in 0..3 {
                    result[face_nodes[local]][component] +=
                        shape[local] * traction_kn_per_m2[component] * area_scale;
                }
            }
        }
    }
    if result.iter().flatten().any(|value| !value.is_finite()) {
        return Err("Hex8 face-traction nodal load overflow".into());
    }
    validate_volume_jacobians(&coordinates_m, length)?;
    Ok(result)
}

fn checked_volume_determinant(
    coordinates: &[[f64; 3]; 8],
    derivative: &[[f64; 3]; 8],
    length: f64,
) -> Result<f64, String> {
    let mut jacobian = [[0.0; 3]; 3];
    for node in 0..8 {
        for physical in 0..3 {
            for reference in 0..3 {
                jacobian[physical][reference] +=
                    coordinates[node][physical] * derivative[node][reference];
            }
        }
    }
    let determinant = dot(
        jacobian.map(|row| row[0]),
        cross(jacobian.map(|row| row[1]), jacobian.map(|row| row[2])),
    );
    if !determinant.is_finite() || determinant <= 1e-12 * length.powi(3) {
        return Err("inverted or degenerate Hex8 volume Jacobian".into());
    }
    Ok(determinant)
}

fn validate_volume_jacobians(coordinates: &[[f64; 3]; 8], length: f64) -> Result<(), String> {
    for xi in GAUSS {
        for eta in GAUSS {
            for zeta in GAUSS {
                let (_, derivative) = volume_shape([xi, eta, zeta]);
                checked_volume_determinant(coordinates, &derivative, length)?;
            }
        }
    }
    Ok(())
}

fn validate_coordinates(coordinates: &[[f64; 3]; 8]) -> Result<f64, String> {
    if coordinates.iter().flatten().any(|value| !value.is_finite()) {
        return Err("non-finite Hex8 coordinate".into());
    }
    let mut length = 0.0_f64;
    for i in 0..8 {
        for j in (i + 1)..8 {
            let separation = std::array::from_fn(|a| coordinates[i][a] - coordinates[j][a]);
            length = length.max(dot(separation, separation).sqrt());
        }
    }
    if !length.is_finite() || length <= 0.0 {
        return Err("degenerate Hex8 coordinates".into());
    }
    Ok(length)
}

fn volume_shape(reference: [f64; 3]) -> ([f64; 8], [[f64; 3]; 8]) {
    let mut shape = [0.0; 8];
    let mut derivative = [[0.0; 3]; 8];
    for node in 0..8 {
        let factor = std::array::from_fn::<_, 3, _>(|a| 1.0 + SIGNS[node][a] * reference[a]);
        shape[node] = factor.iter().product::<f64>() / 8.0;
        for a in 0..3 {
            derivative[node][a] = SIGNS[node][a] * factor[(a + 1) % 3] * factor[(a + 2) % 3] / 8.0;
        }
    }
    (shape, derivative)
}

fn face_shape(s: f64, t: f64) -> ([f64; 4], [f64; 4], [f64; 4]) {
    let signs = [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0]];
    let mut shape = [0.0; 4];
    let mut ds = [0.0; 4];
    let mut dt = [0.0; 4];
    for a in 0..4 {
        shape[a] = (1.0 + signs[a][0] * s) * (1.0 + signs[a][1] * t) / 4.0;
        ds[a] = signs[a][0] * (1.0 + signs[a][1] * t) / 4.0;
        dt[a] = signs[a][1] * (1.0 + signs[a][0] * s) / 4.0;
    }
    (shape, ds, dt)
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::{
        consistent_uniform_body_force, consistent_uniform_face_traction, cross, dot, OUTWARD_FACES,
    };

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

    fn totals(coordinates: [[f64; 3]; 8], nodal: [[f64; 3]; 8]) -> ([f64; 3], [f64; 3]) {
        let mut force = [0.0; 3];
        let mut moment = [0.0; 3];
        for node in 0..8 {
            for a in 0..3 {
                force[a] += nodal[node][a];
            }
            let contribution = cross(coordinates[node], nodal[node]);
            for a in 0..3 {
                moment[a] += contribution[a];
            }
        }
        (force, moment)
    }

    fn near(actual: [f64; 3], expected: [f64; 3]) {
        for a in 0..3 {
            assert!(
                (actual[a] - expected[a]).abs() < 1e-11 * expected[a].abs().max(1.0),
                "component {a}: actual {}, expected {}",
                actual[a],
                expected[a]
            );
        }
    }

    #[test]
    fn unit_cube_body_force_has_exact_nodal_values_force_and_moment() {
        let coordinates = unit_cube();
        let body = [2.0, -3.0, 4.0];
        let nodal = consistent_uniform_body_force(coordinates, body).unwrap();
        for load in nodal {
            near(load, body.map(|component| component / 8.0));
        }
        let (force, moment) = totals(coordinates, nodal);
        near(force, body);
        near(moment, cross([0.5, 0.5, 0.5], body));
    }

    #[test]
    fn unit_cube_traction_has_exact_nodal_values_force_and_moment() {
        let coordinates = unit_cube();
        let traction = [5.0, 2.0, -1.0];
        let nodal =
            consistent_uniform_face_traction(coordinates, OUTWARD_FACES[1], traction).unwrap();
        for (node, load) in nodal.iter().enumerate() {
            let expected = if OUTWARD_FACES[1].contains(&node) {
                traction.map(|component| component / 4.0)
            } else {
                [0.0; 3]
            };
            near(*load, expected);
        }
        let (force, moment) = totals(coordinates, nodal);
        near(force, traction);
        near(moment, cross([1.0, 0.5, 0.5], traction));
    }

    #[test]
    fn affine_skew_cell_matches_independent_parallelepiped_resultants() {
        let origin = [1.0, -2.0, 0.5];
        let ex = [2.0, 0.2, 0.0];
        let ey = [0.4, 1.5, 0.1];
        let ez = [0.1, 0.3, 1.2];
        let mut coordinates = unit_cube();
        for point in &mut coordinates {
            let reference = *point;
            for a in 0..3 {
                point[a] =
                    origin[a] + reference[0] * ex[a] + reference[1] * ey[a] + reference[2] * ez[a];
            }
        }
        let volume = dot(ex, cross(ey, ez));
        let face_area = dot(cross(ey, ez), cross(ey, ez)).sqrt();
        let body = [1.5, -2.0, 0.75];
        let traction = [-4.0, 1.0, 2.5];
        let body_nodal = consistent_uniform_body_force(coordinates, body).unwrap();
        let face_nodal =
            consistent_uniform_face_traction(coordinates, OUTWARD_FACES[1], traction).unwrap();
        let (body_force, body_moment) = totals(coordinates, body_nodal);
        let (face_force, face_moment) = totals(coordinates, face_nodal);
        let body_centroid = std::array::from_fn(|a| origin[a] + 0.5 * (ex[a] + ey[a] + ez[a]));
        let face_centroid = std::array::from_fn(|a| origin[a] + ex[a] + 0.5 * (ey[a] + ez[a]));
        let expected_body = body.map(|value| value * volume);
        let expected_face = traction.map(|value| value * face_area);
        near(body_force, expected_body);
        near(body_moment, cross(body_centroid, expected_body));
        near(face_force, expected_face);
        near(face_moment, cross(face_centroid, expected_face));
    }

    #[test]
    fn rejects_nonfaces_reverse_orientation_and_degenerate_geometry() {
        let coordinates = unit_cube();
        assert!(
            consistent_uniform_face_traction(coordinates, [0, 1, 2, 4], [1.0; 3])
                .unwrap_err()
                .contains("face nodes")
        );
        assert!(
            consistent_uniform_face_traction(coordinates, [1, 5, 6, 2], [1.0; 3])
                .unwrap_err()
                .contains("inward-oriented")
        );
        let mut inverted = coordinates;
        inverted.swap(0, 1);
        assert!(consistent_uniform_body_force(inverted, [1.0; 3])
            .unwrap_err()
            .contains("inverted"));
        let mut collapsed = coordinates;
        collapsed[5] = collapsed[1];
        collapsed[6] = collapsed[2];
        assert!(
            consistent_uniform_face_traction(collapsed, OUTWARD_FACES[1], [1.0; 3])
                .unwrap_err()
                .contains("degenerate")
        );
    }

    #[test]
    fn cyclic_face_start_is_equivalent_and_inverted_cell_is_rejected() {
        let coordinates = unit_cube();
        let canonical =
            consistent_uniform_face_traction(coordinates, [1, 2, 6, 5], [2.0, 1.0, 0.0]).unwrap();
        let rotated =
            consistent_uniform_face_traction(coordinates, [6, 5, 1, 2], [2.0, 1.0, 0.0]).unwrap();
        for node in 0..8 {
            near(canonical[node], rotated[node]);
        }
        let mut inverted = coordinates;
        inverted.swap(0, 1);
        assert!(consistent_uniform_face_traction(inverted, OUTWARD_FACES[3], [1.0; 3]).is_err());
    }
}
