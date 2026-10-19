//! Restarted GMRES for a matrix-free real tangent operator.
//!
//! Uses signed Jacobi left preconditioning, twice-reorthogonalized Arnoldi,
//! and a true (unscaled) residual check. Krylov convergence is not a rank or
//! structural-stability certificate. Based on Saad & Schultz (1986), SIAM
//! J. Sci. Stat. Comput. 7, 856–869, doi:10.1137/0907058.

use crate::csr_gmres::GmresOptions;

pub const DEFAULT_MAX_BASIS_SCALARS: usize = 32_000_000;

pub fn solve_operator<F>(
    rhs: &[f64],
    diagonal: &[f64],
    options: GmresOptions,
    product: F,
) -> Result<Vec<f64>, String>
where
    F: FnMut(&[f64]) -> Result<Vec<f64>, String>,
{
    solve_operator_with_basis_cap(rhs, diagonal, options, DEFAULT_MAX_BASIS_SCALARS, product)
}

pub fn solve_operator_with_basis_cap<F>(
    rhs: &[f64],
    diagonal: &[f64],
    options: GmresOptions,
    max_basis_scalars: usize,
    mut product: F,
) -> Result<Vec<f64>, String>
where
    F: FnMut(&[f64]) -> Result<Vec<f64>, String>,
{
    let n = rhs.len();
    if n == 0 || diagonal.len() != n || rhs.iter().any(|v| !v.is_finite()) {
        return Err(
            "matrix-free GMRES needs a finite, nonempty right-hand side and diagonal".into(),
        );
    }
    if options.restart == 0
        || options.max_iterations == 0
        || !options.relative_tolerance.is_finite()
        || options.relative_tolerance <= 0.0
        || options.relative_tolerance >= 1.0
    {
        return Err("invalid matrix-free GMRES options".into());
    }
    let restart = options.restart.min(n).min(options.max_iterations);
    if n.checked_mul(restart + 1)
        .ok_or("matrix-free GMRES basis overflow")?
        > max_basis_scalars
    {
        return Err(format!(
            "matrix-free GMRES basis exceeds the {max_basis_scalars}-scalar budget"
        ));
    }
    let mut inverse_diagonal = Vec::new();
    inverse_diagonal
        .try_reserve_exact(n)
        .map_err(|error| format!("matrix-free GMRES inverse diagonal allocation: {error}"))?;
    for (row, &value) in diagonal.iter().enumerate() {
        if !value.is_finite() || value.abs() <= f64::MIN_POSITIVE {
            return Err(format!(
                "matrix-free GMRES zero tangent diagonal at reduced DOF {row}"
            ));
        }
        let reciprocal = 1.0 / value;
        if !reciprocal.is_finite() {
            return Err(format!(
                "matrix-free GMRES invalid inverse diagonal at reduced DOF {row}"
            ));
        }
        inverse_diagonal.push(reciprocal);
    }
    let rhs_norm = norm(rhs)?;
    if rhs_norm == 0.0 {
        return fallible_zeroed(n, "zero result");
    }
    let target = options.relative_tolerance * rhs_norm;
    if !target.is_finite() || target == 0.0 {
        return Err(
            "matrix-free GMRES relative tolerance below representable residual scale".into(),
        );
    }
    let mut scaled_rhs = fallible_copy(rhs, "scaled right-hand side")?;
    scale_rows(&mut scaled_rhs, &inverse_diagonal)?;
    let scaled_target = options.relative_tolerance * norm(&scaled_rhs)?;
    let mut x = fallible_zeroed(n, "iterate")?;
    let mut true_residual = fallible_copy(rhs, "true residual")?;
    let mut iterations = 0;
    let mut previous_norm = rhs_norm;
    let mut stagnant_cycles = 0;
    while iterations < options.max_iterations {
        let mut initial = fallible_copy(&true_residual, "initial basis vector")?;
        scale_rows(&mut initial, &inverse_diagonal)?;
        let beta = norm(&initial)?;
        if beta == 0.0 {
            return Err(
                "matrix-free GMRES scaled residual vanished before true convergence".into(),
            );
        }
        for value in &mut initial {
            *value /= beta;
        }
        let inner_limit = restart.min(options.max_iterations - iterations);
        let mut basis = Vec::new();
        basis
            .try_reserve_exact(inner_limit + 1)
            .map_err(|error| format!("matrix-free GMRES basis allocation: {error}"))?;
        basis.push(initial);
        let mut h = vec![vec![0.0; inner_limit]; inner_limit + 1];
        let mut cosines = vec![0.0; inner_limit];
        let mut sines = vec![0.0; inner_limit];
        let mut g = vec![0.0; inner_limit + 1];
        g[0] = beta;
        let mut reached_cycle_end = false;
        for j in 0..inner_limit {
            let mut w = product(&basis[j])?;
            if w.len() != n {
                return Err("matrix-free GMRES product dimension mismatch".into());
            }
            scale_rows(&mut w, &inverse_diagonal)?;
            let original_norm = norm(&w)?;
            for _ in 0..2 {
                for i in 0..=j {
                    let projection = dot(&basis[i], &w)?;
                    h[i][j] += projection;
                    for (wk, vik) in w.iter_mut().zip(&basis[i]) {
                        *wk -= projection * vik;
                    }
                }
            }
            let next_norm = norm(&w)?;
            h[j + 1][j] = next_norm;
            let invariant = next_norm <= 64.0 * f64::EPSILON * original_norm;
            if !invariant {
                for value in &mut w {
                    *value /= next_norm;
                }
                basis.push(w);
            }
            for i in 0..j {
                let upper = h[i][j];
                let lower = h[i + 1][j];
                h[i][j] = cosines[i] * upper + sines[i] * lower;
                h[i + 1][j] = -sines[i] * upper + cosines[i] * lower;
            }
            let pivot = h[j][j].hypot(h[j + 1][j]);
            if !pivot.is_finite() || pivot == 0.0 {
                return Err(format!(
                    "matrix-free GMRES Arnoldi breakdown at iteration {}",
                    iterations + 1
                ));
            }
            cosines[j] = h[j][j] / pivot;
            sines[j] = h[j + 1][j] / pivot;
            h[j][j] = pivot;
            h[j + 1][j] = 0.0;
            let old_g = g[j];
            g[j] = cosines[j] * old_g;
            g[j + 1] = -sines[j] * old_g;
            iterations += 1;
            if invariant || g[j + 1].abs() <= scaled_target || j + 1 == inner_limit {
                let mut y = vec![0.0; j + 1];
                for i in (0..=j).rev() {
                    let mut value = g[i];
                    for k in i + 1..=j {
                        value -= h[i][k] * y[k];
                    }
                    y[i] = value / h[i][i];
                    if !y[i].is_finite() {
                        return Err(format!("matrix-free GMRES non-finite back substitution at iteration {iterations}"));
                    }
                }
                let mut candidate = fallible_copy(&x, "candidate iterate")?;
                for (coefficient, vector) in y.iter().zip(&basis) {
                    for (result, component) in candidate.iter_mut().zip(vector) {
                        *result += coefficient * component;
                    }
                }
                if candidate.iter().any(|v| !v.is_finite()) {
                    return Err(format!(
                        "matrix-free GMRES non-finite iterate at iteration {iterations}"
                    ));
                }
                let ax = product(&candidate)?;
                if ax.len() != n {
                    return Err("matrix-free GMRES product dimension mismatch".into());
                }
                true_residual = fallible_copy(rhs, "true residual")?;
                for (residual, a) in true_residual.iter_mut().zip(ax) {
                    *residual -= a;
                }
                let true_norm = norm(&true_residual)?;
                if true_norm <= target {
                    return Ok(candidate);
                }
                if invariant {
                    return Err(format!("matrix-free GMRES invariant Krylov subspace at iteration {iterations}, true residual {true_norm:.6e} exceeds {target:.6e}"));
                }
                if j + 1 == inner_limit {
                    if true_norm >= previous_norm * (1.0 - 1e-14) {
                        stagnant_cycles += 1;
                    } else {
                        stagnant_cycles = 0;
                    }
                    if stagnant_cycles >= 3 {
                        return Err(format!("matrix-free GMRES stagnated after {iterations} iterations, true residual {true_norm:.6e} exceeds {target:.6e}"));
                    }
                    previous_norm = true_norm;
                    x = candidate;
                    reached_cycle_end = true;
                    break;
                }
            }
        }
        if !reached_cycle_end {
            return Err("matrix-free GMRES ended without a complete restart cycle".into());
        }
    }
    let true_norm = norm(&true_residual)?;
    Err(format!("matrix-free GMRES failed in {} iterations, true residual {true_norm:.6e} exceeds {target:.6e}", options.max_iterations))
}

fn fallible_zeroed(len: usize, purpose: &str) -> Result<Vec<f64>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(len)
        .map_err(|error| format!("matrix-free GMRES {purpose} allocation: {error}"))?;
    values.resize(len, 0.0);
    Ok(values)
}

fn fallible_copy(values: &[f64], purpose: &str) -> Result<Vec<f64>, String> {
    let mut copy = Vec::new();
    copy.try_reserve_exact(values.len())
        .map_err(|error| format!("matrix-free GMRES {purpose} allocation: {error}"))?;
    copy.extend_from_slice(values);
    Ok(copy)
}

fn scale_rows(values: &mut [f64], inverse: &[f64]) -> Result<(), String> {
    for (value, weight) in values.iter_mut().zip(inverse) {
        *value *= weight;
        if !value.is_finite() {
            return Err("matrix-free GMRES non-finite scaled value".into());
        }
    }
    Ok(())
}

fn dot(a: &[f64], b: &[f64]) -> Result<f64, String> {
    let value: f64 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    value
        .is_finite()
        .then_some(value)
        .ok_or("matrix-free GMRES non-finite dot product".into())
}

fn norm(values: &[f64]) -> Result<f64, String> {
    let mut value = 0.0_f64;
    for &component in values {
        if !component.is_finite() {
            return Err("matrix-free GMRES non-finite vector".into());
        }
        value = value.hypot(component);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solves_nonsymmetric_system_with_true_residual() {
        let a = [[4.0, 1.0, 0.0], [2.0, 5.0, 1.0], [0.0, 1.0, 3.0]];
        let expected = [2.0, -1.0, 3.0];
        let rhs: Vec<_> = a
            .iter()
            .map(|row| row.iter().zip(expected).map(|(x, y)| x * y).sum())
            .collect();
        let actual = solve_operator(
            &rhs,
            &[4.0, 5.0, 3.0],
            GmresOptions {
                restart: 3,
                max_iterations: 9,
                relative_tolerance: 1e-12,
            },
            |v| {
                Ok(a.iter()
                    .map(|row| row.iter().zip(v).map(|(x, y)| x * y).sum())
                    .collect())
            },
        )
        .unwrap();
        for (x, y) in actual.iter().zip(expected) {
            assert!((x - y).abs() < 1e-11);
        }
    }

    #[test]
    fn rejects_nonconvergence_without_returning_an_iterate() {
        let error = solve_operator(
            &[1.0, 1.0],
            &[2.0, 3.0],
            GmresOptions {
                restart: 1,
                max_iterations: 1,
                relative_tolerance: 1e-12,
            },
            |v| Ok(vec![2.0 * v[0] + v[1], v[0] + 3.0 * v[1]]),
        )
        .unwrap_err();
        assert!(error.contains("failed") || error.contains("stagnated"));
    }
}
