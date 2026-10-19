//! Total-Lagrangian, constant-gradient Tri3 membrane with finite J2 steel.
//!
//! The parent 3D law is the quadratic Hencky, multiplicative plastic-metric
//! return in [`crate::solid_finite_j2`]. At each Newton trial this element
//! constructs `F = [g1, g2, lambda*n]`, where `g1,g2` are current tangents
//! per unit *reference* in-plane coordinates and `n` is their unit normal.
//! Positive thickness stretch `lambda` is solved so `n · P[:,3] = 0`. For the
//! supported block-diagonal plastic history this also gives `P[:,3] = 0`.
//! The 9x9 Jacobian is the exact chain rule through the moving normal and the
//! scalar plane-stress solve, using the parent material's branch tangent.
//!
//! The thickness solve and local tangent follow the plane-stress return and
//! exact linearization principle of Simo & Taylor, IJNME 22 (1986),
//! doi:10.1002/nme.1620220310. A finite-strain shell formulation with a 3D
//! multiplicative J2 law and iterated thickness stretch is described by
//! Ambati, Kiendl & De Lorenzis, CMAME 340 (2018), 320-339,
//! doi:10.1016/j.cma.2018.05.023. The particular Hencky material update is
//! documented in `solid_finite_j2.rs` (Ren, Rabczuk & Zhuang, arXiv:2302.13783).
//!
//! Reference coordinates and displacements are metres; stress is MPa; force
//! is kN. This is a membrane only: no bending, drilling or wrinkling law.
//! Candidate history must be committed by the caller only after convergence.

use crate::solid_finite_j2::{FiniteJ2State, FiniteJ2Steel, FiniteJ2Update, Tangent9, Tensor3};

const MPA_M2_TO_KN: f64 = 1_000.0;

#[derive(Clone, Copy, Debug)]
pub struct FiniteJ2MembraneAction {
    /// Candidate plastic history and 3D stresses at the converged plane-stress point.
    pub material_point: FiniteJ2Update,
    /// Local reference-plane second Piola--Kirchhoff [S11, S22, S12], MPa.
    pub second_piola_mpa: [f64; 3],
    /// Current orthonormal local Cauchy [sigma11, sigma22, sigma12], MPa.
    /// Axis 1 follows the current first reference edge; axis 2 is n x axis 1.
    pub cauchy_mpa: [f64; 3],
    /// Current membrane resultant [N11, N22, N12], kN/m.
    pub force_resultant_kn_per_m: [f64; 3],
    pub thickness_stretch: f64,
    pub internal_force_kn: [f64; 9],
    /// Row-major 9x9 `d(internal_force)/d(displacement)`, kN/m.
    pub tangent_kn_per_m: Option<[f64; 81]>,
}

/// Evaluate a flat reference Tri3 with a possibly rotated/deformed current
/// surface. `committed` uses the parent material's symmetric positive gauge.
/// The normal direction of its plastic metric must stay uncoupled from the
/// in-plane axes, as produced by this element's own accepted updates.
pub fn evaluate(
    material: FiniteJ2Steel,
    committed: &FiniteJ2State,
    reference_m: [[f64; 3]; 3],
    displacement_m: [[f64; 3]; 3],
    thickness_m: f64,
    with_tangent: bool,
) -> Result<FiniteJ2MembraneAction, String> {
    evaluate_mode(
        material,
        committed,
        reference_m,
        displacement_m,
        thickness_m,
        with_tangent,
        false,
    )
}

/// Select a one-sided branch tangent at the elastic/plastic switch, matching
/// the parent 3D material's semismooth Newton convention.
pub fn evaluate_with_one_sided_tangent(
    material: FiniteJ2Steel,
    committed: &FiniteJ2State,
    reference_m: [[f64; 3]; 3],
    displacement_m: [[f64; 3]; 3],
    thickness_m: f64,
) -> Result<FiniteJ2MembraneAction, String> {
    evaluate_mode(
        material,
        committed,
        reference_m,
        displacement_m,
        thickness_m,
        true,
        true,
    )
}

fn evaluate_mode(
    material: FiniteJ2Steel,
    committed: &FiniteJ2State,
    reference_m: [[f64; 3]; 3],
    displacement_m: [[f64; 3]; 3],
    thickness_m: f64,
    with_tangent: bool,
    allow_switch: bool,
) -> Result<FiniteJ2MembraneAction, String> {
    if !thickness_m.is_finite() || thickness_m <= 0.0 {
        return Err("finite J2 membrane thickness must be finite and positive".into());
    }
    if reference_m
        .iter()
        .flatten()
        .chain(displacement_m.iter().flatten())
        .any(|x| !x.is_finite())
    {
        return Err("finite J2 membrane coordinates and displacements must be finite".into());
    }
    let coupling = committed.fp[0][2]
        .abs()
        .max(committed.fp[1][2].abs())
        .max(committed.fp[2][0].abs())
        .max(committed.fp[2][1].abs());
    if coupling > 1e-9 {
        return Err("finite J2 membrane requires an in-plane plastic metric".into());
    }
    let edge1 = sub(reference_m[1], reference_m[0]);
    let edge2 = sub(reference_m[2], reference_m[0]);
    let edge3 = sub(reference_m[2], reference_m[1]);
    let l1 = norm(edge1);
    let largest = l1.max(norm(edge2)).max(norm(edge3));
    if !l1.is_finite() || !largest.is_finite() || largest == 0.0 {
        return Err("finite J2 membrane has degenerate reference geometry".into());
    }
    let e1 = scale(edge1, 1.0 / l1);
    let x2 = dot(edge2, e1);
    let transverse = sub(edge2, scale(e1, x2));
    let y2 = norm(transverse);
    if !y2.is_finite() || y2 <= 1e-12 * largest {
        return Err("finite J2 membrane has collinear reference nodes".into());
    }
    let e2 = scale(transverse, 1.0 / y2);
    let gradients = [
        [-1.0 / l1, (x2 - l1) / (l1 * y2)],
        [1.0 / l1, -x2 / (l1 * y2)],
        [0.0, 1.0 / y2],
    ];
    let mut g = [e1, e2];
    for alpha in 0..2 {
        for node in 0..3 {
            g[alpha] = add(
                g[alpha],
                scale(displacement_m[node], gradients[node][alpha]),
            );
        }
    }
    let cross_g = cross(g[0], g[1]);
    let area_ratio = norm(cross_g);
    if !area_ratio.is_finite() || area_ratio <= 1e-12 {
        return Err("finite J2 membrane collapsed in current geometry".into());
    }
    let n = scale(cross_g, 1.0 / area_ratio);
    let make_f = |lambda: f64| -> Tensor3 {
        std::array::from_fn(|row| [g[0][row], g[1][row], lambda * n[row]])
    };
    let response = |lambda: f64| -> Result<(f64, FiniteJ2Update), String> {
        let point = material.update(committed, make_f(lambda))?;
        let p3 = std::array::from_fn(|i| point.first_piola_mpa[i][2]);
        Ok((dot(n, p3), point))
    };

    // Bracket the positive thickness root. Bisection avoids asking for the
    // undefined material Jacobian when an iterate lands on the yield switch.
    let stress_tol = 1e-12 * material.yield_mpa.max(1.0);
    let (initial, _) = response(1.0)?;
    let mut low = 1.0;
    let mut high = 1.0;
    if initial > stress_tol {
        for _ in 0..40 {
            low *= 0.5;
            if response(low)?.0 <= 0.0 {
                break;
            }
        }
        if response(low)?.0 > 0.0 {
            return Err("finite J2 membrane could not bracket thickness stretch".into());
        }
    } else if initial < -stress_tol {
        for _ in 0..40 {
            high *= 2.0;
            if response(high)?.0 >= 0.0 {
                break;
            }
        }
        if response(high)?.0 < 0.0 {
            return Err("finite J2 membrane could not bracket thickness stretch".into());
        }
    }
    let mut lambda = 1.0;
    if initial.abs() > stress_tol {
        for _ in 0..90 {
            lambda = 0.5 * (low + high);
            let r = response(lambda)?.0;
            if r.abs() <= stress_tol {
                break;
            }
            if r < 0.0 {
                low = lambda;
            } else {
                high = lambda;
            }
        }
    }
    let (residual, point) = response(lambda)?;
    if residual.abs() > stress_tol * 2.0 {
        return Err("finite J2 membrane thickness solve did not converge".into());
    }
    let p3 = std::array::from_fn(|i| point.first_piola_mpa[i][2]);
    if norm(p3) > 1e-8 * material.yield_mpa.max(1.0) {
        return Err("finite J2 membrane has unsupported transverse plastic shear".into());
    }
    let weight = MPA_M2_TO_KN * 0.5 * l1 * y2 * thickness_m;
    let c11 = dot(g[0], g[0]);
    let c22 = dot(g[1], g[1]);
    let c12 = dot(g[0], g[1]);
    let det_c = c11 * c22 - c12 * c12;
    let p1 = std::array::from_fn(|i| point.first_piola_mpa[i][0]);
    let p2 = std::array::from_fn(|i| point.first_piola_mpa[i][1]);
    let b11 = dot(g[0], p1);
    let b21 = dot(g[1], p1);
    let b12 = dot(g[0], p2);
    let b22 = dot(g[1], p2);
    let second_piola = [
        (c22 * b11 - c12 * b21) / det_c,
        (-c12 * b12 + c11 * b22) / det_c,
        0.5 * ((c22 * b12 - c12 * b22) + (-c12 * b11 + c11 * b21)) / det_c,
    ];
    let q1 = scale(g[0], 1.0 / norm(g[0]));
    let q2 = cross(n, q1);
    let tau = point.kirchhoff_mpa;
    let contract = |a: [f64; 3], b: [f64; 3]| -> f64 {
        (0..3)
            .flat_map(|i| (0..3).map(move |j| a[i] * tau[i][j] * b[j]))
            .sum::<f64>()
    };
    let jacobian = area_ratio * lambda;
    let cauchy = [
        contract(q1, q1) / jacobian,
        contract(q2, q2) / jacobian,
        contract(q1, q2) / jacobian,
    ];
    let force_resultant = cauchy.map(|stress| MPA_M2_TO_KN * thickness_m * lambda * stress);
    let mut force = [0.0; 9];
    for node in 0..3 {
        for a in 0..3 {
            force[3 * node + a] = weight
                * (0..2)
                    .map(|alpha| point.first_piola_mpa[a][alpha] * gradients[node][alpha])
                    .sum::<f64>();
        }
    }
    let tangent = if with_tangent {
        let c = if allow_switch {
            material.update_with_one_sided_tangent(committed, make_f(lambda))?
        } else {
            material.update_with_tangent(committed, make_f(lambda))?
        }
        .tangent_mpa;
        let mut dfl = [[0.0; 3]; 3];
        for a in 0..3 {
            dfl[a][2] = n[a];
        }
        let dpl = apply_tangent(&c, &dfl);
        let denominator = dot(n, std::array::from_fn(|a| dpl[a][2]));
        if !denominator.is_finite() || denominator.abs() <= 1e-12 * material.youngs_mpa {
            return Err("finite J2 membrane plane-stress tangent is singular".into());
        }
        let mut k = [0.0; 81];
        for col in 0..9 {
            let node = col / 3;
            let axis = col % 3;
            let mut dg = [[0.0; 3]; 2];
            for alpha in 0..2 {
                dg[alpha][axis] = gradients[node][alpha];
            }
            let dc = add(cross(dg[0], g[1]), cross(g[0], dg[1]));
            let dn = scale(sub(dc, scale(n, dot(n, dc))), 1.0 / area_ratio);
            let mut df = [[0.0; 3]; 3];
            for a in 0..3 {
                df[a] = [dg[0][a], dg[1][a], lambda * dn[a]];
            }
            let dp_fixed = apply_tangent(&c, &df);
            let p3_fixed = std::array::from_fn(|a| dp_fixed[a][2]);
            let dlambda = -(dot(dn, p3) + dot(n, p3_fixed)) / denominator;
            let dp = add_tensor(dp_fixed, scale_tensor(dpl, dlambda));
            for i in 0..3 {
                for a in 0..3 {
                    k[(3 * i + a) * 9 + col] = weight
                        * (0..2)
                            .map(|alpha| dp[a][alpha] * gradients[i][alpha])
                            .sum::<f64>();
                }
            }
        }
        Some(k)
    } else {
        None
    };
    if second_piola.iter().any(|x| !x.is_finite())
        || cauchy.iter().any(|x| !x.is_finite())
        || force_resultant.iter().any(|x| !x.is_finite())
        || force.iter().any(|x| !x.is_finite())
        || tangent
            .as_ref()
            .is_some_and(|k| k.iter().any(|x| !x.is_finite()))
    {
        return Err("finite J2 membrane response is non-finite".into());
    }
    Ok(FiniteJ2MembraneAction {
        material_point: point,
        second_piola_mpa: second_piola,
        cauchy_mpa: cauchy,
        force_resultant_kn_per_m: force_resultant,
        thickness_stretch: lambda,
        internal_force_kn: force,
        tangent_kn_per_m: tangent,
    })
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| a[i] * b[i]).sum()
}
fn norm(a: [f64; 3]) -> f64 {
    a.iter().fold(0.0_f64, |v, x| v.hypot(*x))
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] + b[i])
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}
fn scale(a: [f64; 3], x: f64) -> [f64; 3] {
    a.map(|v| v * x)
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn apply_tangent(c: &Tangent9, df: &Tensor3) -> Tensor3 {
    std::array::from_fn(|a| {
        std::array::from_fn(|i| {
            (0..3)
                .flat_map(|b| (0..3).map(move |j| c[3 * a + i][3 * b + j] * df[b][j]))
                .sum()
        })
    })
}
fn add_tensor(a: Tensor3, b: Tensor3) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[i][j] + b[i][j]))
}
fn scale_tensor(a: Tensor3, x: f64) -> Tensor3 {
    std::array::from_fn(|i| std::array::from_fn(|j| a[i][j] * x))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steel() -> FiniteJ2Steel {
        FiniteJ2Steel::new(210_000.0, 0.3, 250.0, 1_000.0).unwrap()
    }
    fn triangle() -> [[f64; 3]; 3] {
        [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    }
    fn axial(lambda_x: f64, lambda_y: f64) -> [[f64; 3]; 3] {
        [
            [0.0; 3],
            [lambda_x - 1.0, 0.0, 0.0],
            [0.0, lambda_y - 1.0, 0.0],
        ]
    }
    fn assert_close(actual: f64, expected: f64, rel: f64) {
        assert!(
            (actual - expected).abs() <= rel * expected.abs().max(1.0),
            "{actual} != {expected}"
        );
    }

    #[test]
    fn elastic_uniaxial_hencky_plane_stress_matches_closed_form() {
        let ex: f64 = 0.0005;
        let lx = ex.exp();
        let ly = (-0.3 * ex).exp();
        let a = evaluate(
            steel(),
            &FiniteJ2State::default(),
            triangle(),
            axial(lx, ly),
            0.02,
            true,
        )
        .unwrap();
        assert!(!a.material_point.yielded);
        assert_close(a.thickness_stretch, ly, 1e-12);
        assert_close(a.material_point.kirchhoff_mpa[0][0], 210_000.0 * ex, 1e-10);
        assert!(a.material_point.kirchhoff_mpa[1][1].abs() < 1e-7);
        assert!(a.material_point.kirchhoff_mpa[2][2].abs() < 1e-7);
        assert_close(
            a.internal_force_kn[3],
            1000.0 * 0.5 * 0.02 * 210_000.0 * ex / lx,
            1e-10,
        );
    }

    #[test]
    fn plastic_uniaxial_bilinear_hencky_matches_closed_form_and_unloads() {
        let ex: f64 = 0.01;
        let alpha = (210_000.0 * ex - 250.0) / 211_000.0;
        let sigma = 250.0 + 1_000.0 * alpha;
        let lateral = (-0.3 * sigma / 210_000.0 - 0.5 * alpha).exp();
        let lx = ex.exp();
        let a = evaluate(
            steel(),
            &FiniteJ2State::default(),
            triangle(),
            axial(lx, lateral),
            0.02,
            true,
        )
        .unwrap();
        assert!(a.material_point.yielded);
        assert_close(
            a.material_point.state.equivalent_plastic_strain,
            alpha,
            1e-9,
        );
        assert_close(a.material_point.kirchhoff_mpa[0][0], sigma, 1e-9);
        assert_close(a.thickness_stretch, lateral, 1e-10);
        assert_close(a.internal_force_kn[3], 10.0 * sigma / lx, 1e-9);
        assert_eq!(FiniteJ2State::default().equivalent_plastic_strain, 0.0);
        let unloaded = evaluate(
            steel(),
            &a.material_point.state,
            triangle(),
            axial((ex - 0.0005).exp(), lateral),
            0.02,
            false,
        )
        .unwrap();
        assert!(!unloaded.material_point.yielded);
        assert_close(
            unloaded.material_point.state.equivalent_plastic_strain,
            alpha,
            1e-12,
        );
    }

    #[test]
    fn rigid_rotation_has_zero_stress() {
        let u = [[0.0; 3], [-1.0, 1.0, 0.0], [0.0, -1.0, 1.0]];
        let a = evaluate(
            steel(),
            &FiniteJ2State::default(),
            triangle(),
            u,
            0.02,
            true,
        )
        .unwrap();
        assert!(a.internal_force_kn.iter().all(|v| v.abs() < 1e-7));
        assert!(a
            .material_point
            .kirchhoff_mpa
            .iter()
            .flatten()
            .all(|v| v.abs() < 1e-8));
        assert_close(a.thickness_stretch, 1.0, 1e-12);
    }

    fn check_tangent(committed: &FiniteJ2State, u: [[f64; 3]; 3]) {
        let x = [[0.2, 0.1, 0.3], [1.4, 0.4, 0.5], [0.6, 1.1, 0.8]];
        let action = evaluate(steel(), committed, x, u, 0.018, true).unwrap();
        let k = action.tangent_kn_per_m.unwrap();
        let h = 1e-7;
        for col in 0..9 {
            let mut up = u;
            let mut um = u;
            up[col / 3][col % 3] += h;
            um[col / 3][col % 3] -= h;
            let fp = evaluate(steel(), committed, x, up, 0.018, false)
                .unwrap()
                .internal_force_kn;
            let fm = evaluate(steel(), committed, x, um, 0.018, false)
                .unwrap()
                .internal_force_kn;
            for row in 0..9 {
                let numerical = (fp[row] - fm[row]) / (2.0 * h);
                assert_close(k[row * 9 + col], numerical, 5e-5);
            }
        }
        for row in 0..9 {
            for col in 0..9 {
                assert_close(k[row * 9 + col], k[col * 9 + row], 1e-8);
            }
        }
    }

    #[test]
    fn elastic_and_plastic_nine_by_nine_tangents_match_independent_force_differences() {
        check_tangent(
            &FiniteJ2State::default(),
            [
                [0.0; 3],
                [0.0002, 0.0001, -0.0001],
                [-0.0001, 0.0003, 0.0002],
            ],
        );
        check_tangent(
            &FiniteJ2State::default(),
            [[0.0; 3], [0.025, 0.004, -0.003], [-0.009, 0.011, 0.006]],
        );
        let committed = evaluate(
            steel(),
            &FiniteJ2State::default(),
            triangle(),
            axial(1.01, 0.995),
            0.018,
            false,
        )
        .unwrap()
        .material_point
        .state;
        check_tangent(
            &committed,
            [[0.0; 3], [0.025, 0.004, -0.003], [-0.009, 0.011, 0.006]],
        );
    }

    #[test]
    fn invalid_geometry_and_transverse_history_are_rejected() {
        let x = triangle();
        assert!(evaluate(
            steel(),
            &FiniteJ2State::default(),
            [x[0], x[1], x[1]],
            [[0.0; 3]; 3],
            0.02,
            false
        )
        .is_err());
        assert!(evaluate(
            steel(),
            &FiniteJ2State::default(),
            x,
            [[0.0; 3]; 3],
            0.0,
            false
        )
        .is_err());
        let mut state = FiniteJ2State::default();
        state.fp[0][2] = 0.01;
        assert!(evaluate(steel(), &state, x, [[0.0; 3]; 3], 0.02, false).is_err());
    }
}
