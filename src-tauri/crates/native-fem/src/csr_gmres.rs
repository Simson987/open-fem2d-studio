//! Restarted GMRES for general real CSR systems.
//!
//! This is a Krylov fallback for finite, possibly nonsymmetric or indefinite
//! tangents. It uses signed Jacobi row scaling where usable, twice-reorthogonalized
//! modified Gram-Schmidt, and accepts a solution only after checking `b - A x`.
//! Krylov convergence does not certify matrix rank or structural stability.
//! Algorithm: Saad & Schultz, SIAM J. Sci. Stat. Comput. 7 (1986), 856–869,
//! https://doi.org/10.1137/0907058.

use crate::csr::CsrMatrix;

const MAX_BASIS_SCALARS: usize = 32_000_000;

#[derive(Clone, Copy, Debug)]
pub struct GmresOptions {
    pub restart: usize,
    pub max_iterations: usize,
    pub relative_tolerance: f64,
}

impl Default for GmresOptions {
    fn default() -> Self {
        Self {
            restart: 30,
            max_iterations: 3_000,
            relative_tolerance: 1e-10,
        }
    }
}

pub fn solve_gmres(
    matrix: &CsrMatrix,
    rhs: &[f64],
    options: GmresOptions,
) -> Result<Vec<f64>, String> {
    solve_gmres_with_threads(matrix, rhs, options, 1)
}

/// `threads` affects only CSR matrix-vector products. Arnoldi reduction stays
/// serial and deterministic. The basis storage is bounded at 32 million f64s.
pub fn solve_gmres_with_threads(
    matrix: &CsrMatrix,
    rhs: &[f64],
    options: GmresOptions,
    threads: usize,
) -> Result<Vec<f64>, String> {
    validate(matrix, rhs, options, threads)?;
    let n = matrix.n;
    let restart = options.restart.min(n).min(options.max_iterations);
    let mut inverse_diagonal = vec![1.0; n];
    for (row, inverse) in inverse_diagonal.iter_mut().enumerate() {
        let range = matrix.row_offsets[row]..matrix.row_offsets[row + 1];
        if let Ok(position) = matrix.columns[range.clone()].binary_search(&row) {
            let diagonal = matrix.values[range.start + position];
            let reciprocal = 1.0 / diagonal;
            if reciprocal.is_finite() && reciprocal != 0.0 {
                *inverse = reciprocal;
            }
        }
    }
    let rhs_norm = norm(rhs)?;
    if rhs_norm == 0.0 {
        return Ok(vec![0.0; n]);
    }
    let target = options.relative_tolerance * rhs_norm;
    if !target.is_finite() || target == 0.0 {
        return Err("GMRES relative tolerance is below the representable residual scale".into());
    }
    let mut scaled_rhs = rhs.to_vec();
    scale_rows(&mut scaled_rhs, &inverse_diagonal)?;
    let scaled_target = options.relative_tolerance * norm(&scaled_rhs)?;
    let mut x = vec![0.0; n];
    let mut true_residual = rhs.to_vec();
    let mut iterations = 0;
    let mut previous_norm = rhs_norm;
    let mut stagnant_cycles = 0;
    while iterations < options.max_iterations {
        let mut initial = true_residual.clone();
        scale_rows(&mut initial, &inverse_diagonal)?;
        let beta = norm(&initial)?;
        if beta == 0.0 {
            return Err("GMRES preconditioned residual vanished before true convergence".into());
        }
        for value in &mut initial {
            *value /= beta;
        }
        let inner_limit = restart.min(options.max_iterations - iterations);
        let mut basis = Vec::with_capacity(inner_limit + 1);
        basis.push(initial);
        let mut h = vec![vec![0.0; inner_limit]; inner_limit + 1];
        let mut cosines = vec![0.0; inner_limit];
        let mut sines = vec![0.0; inner_limit];
        let mut g = vec![0.0; inner_limit + 1];
        g[0] = beta;
        let mut reached_cycle_end = false;

        for j in 0..inner_limit {
            let mut w = matrix.mul_parallel(&basis[j], threads)?;
            scale_rows(&mut w, &inverse_diagonal)?;
            let original_norm = norm(&w)?;
            // A second pass limits loss of orthogonality on ill-conditioned
            // structural tangents without changing the Arnoldi subspace.
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
                    "GMRES Arnoldi breakdown at iteration {}; system may be singular",
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
                        return Err(format!(
                            "non-finite GMRES back substitution at iteration {iterations}"
                        ));
                    }
                }
                let mut candidate = x.clone();
                for (coefficient, vector) in y.iter().zip(&basis) {
                    for (result, component) in candidate.iter_mut().zip(vector) {
                        *result += coefficient * component;
                    }
                }
                if candidate.iter().any(|value| !value.is_finite()) {
                    return Err(format!(
                        "non-finite GMRES iterate at iteration {iterations}"
                    ));
                }
                let product = matrix.mul_parallel(&candidate, threads)?;
                true_residual = rhs.iter().zip(product).map(|(b, ax)| b - ax).collect();
                let true_norm = norm(&true_residual)?;
                if true_norm <= target {
                    return Ok(candidate);
                }
                if invariant {
                    return Err(format!(
                        "GMRES invariant Krylov subspace at iteration {iterations}, but true residual {true_norm:.6e} exceeds target {target:.6e}; singular or ill-conditioned system"
                    ));
                }
                if j + 1 == inner_limit {
                    if true_norm >= previous_norm * (1.0 - 1e-14) {
                        stagnant_cycles += 1;
                    } else {
                        stagnant_cycles = 0;
                    }
                    if stagnant_cycles >= 3 {
                        return Err(format!(
                            "GMRES stagnated after {iterations} iterations (true residual {true_norm:.6e}, target {target:.6e})"
                        ));
                    }
                    previous_norm = true_norm;
                    x = candidate;
                    reached_cycle_end = true;
                    break;
                }
            }
        }
        if !reached_cycle_end {
            return Err("GMRES ended without a complete restart cycle".into());
        }
    }
    let true_norm = norm(&true_residual)?;
    Err(format!(
        "GMRES failed to converge in {} iterations (true residual {true_norm:.6e}, target {target:.6e})",
        options.max_iterations
    ))
}

fn validate(
    matrix: &CsrMatrix,
    rhs: &[f64],
    options: GmresOptions,
    threads: usize,
) -> Result<(), String> {
    if threads == 0 || threads > 32 {
        return Err("GMRES thread count must be between 1 and 32".into());
    }
    if matrix.n == 0 || rhs.len() != matrix.n || rhs.iter().any(|value| !value.is_finite()) {
        return Err("GMRES right-hand side must be finite and match a nonempty matrix".into());
    }
    if options.restart == 0
        || options.max_iterations == 0
        || !options.relative_tolerance.is_finite()
        || options.relative_tolerance <= 0.0
        || options.relative_tolerance >= 1.0
    {
        return Err("invalid GMRES restart, iteration limit, or relative tolerance".into());
    }
    let restart = options.restart.min(matrix.n).min(options.max_iterations);
    let basis_size = matrix
        .n
        .checked_mul(restart.checked_add(1).ok_or("GMRES basis size overflow")?)
        .ok_or("GMRES basis size overflow")?;
    let hessenberg_size = restart
        .checked_add(1)
        .and_then(|rows| rows.checked_mul(restart))
        .ok_or("GMRES Hessenberg size overflow")?;
    if basis_size > MAX_BASIS_SCALARS || hessenberg_size > MAX_BASIS_SCALARS {
        return Err(
            "GMRES Krylov storage exceeds the 32-million-scalar budget; reduce restart".into(),
        );
    }
    let expected_offsets = matrix
        .n
        .checked_add(1)
        .ok_or("GMRES CSR row count overflow")?;
    if matrix.row_offsets.len() != expected_offsets
        || matrix.columns.len() != matrix.values.len()
        || matrix.row_offsets.first() != Some(&0)
        || matrix.row_offsets.last() != Some(&matrix.values.len())
    {
        return Err("invalid GMRES CSR storage offsets or array lengths".into());
    }
    for row in 0..matrix.n {
        let start = matrix.row_offsets[row];
        let end = matrix.row_offsets[row + 1];
        if start > end || end > matrix.values.len() {
            return Err(format!("invalid GMRES CSR row offsets at DOF {row}"));
        }
        let mut previous = None;
        for index in start..end {
            let col = matrix.columns[index];
            if col >= matrix.n
                || previous.is_some_and(|p| col <= p)
                || !matrix.values[index].is_finite()
            {
                return Err(format!("invalid GMRES CSR column or value at DOF {row}"));
            }
            previous = Some(col);
        }
    }
    Ok(())
}

fn scale_rows(vector: &mut [f64], inverse_diagonal: &[f64]) -> Result<(), String> {
    for (value, inverse) in vector.iter_mut().zip(inverse_diagonal) {
        *value *= inverse;
        if !value.is_finite() {
            return Err("non-finite GMRES row-scaled value".into());
        }
    }
    Ok(())
}

fn dot(left: &[f64], right: &[f64]) -> Result<f64, String> {
    let value: f64 = left.iter().zip(right).map(|(a, b)| a * b).sum();
    if value.is_finite() {
        Ok(value)
    } else {
        Err("non-finite GMRES inner product".into())
    }
}

fn norm(vector: &[f64]) -> Result<f64, String> {
    let mut result = 0.0_f64;
    for value in vector {
        if !value.is_finite() {
            return Err("non-finite GMRES vector".into());
        }
        result = result.hypot(*value);
    }
    if result.is_finite() {
        Ok(result)
    } else {
        Err("non-finite GMRES vector norm".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn csr(rows: &[&[(usize, f64)]]) -> CsrMatrix {
        let mut row_offsets = vec![0];
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for row in rows {
            for &(column, value) in *row {
                columns.push(column);
                values.push(value);
            }
            row_offsets.push(columns.len());
        }
        CsrMatrix {
            n: rows.len(),
            row_offsets,
            columns,
            values,
        }
    }

    #[test]
    fn nonsymmetric_manufactured_solution_and_true_residual() {
        let matrix = csr(&[
            &[(0, 4.0), (1, -2.0)],
            &[(0, 1.0), (1, 3.0), (2, -1.0)],
            &[(1, 2.0), (2, 5.0)],
        ]);
        let exact = [1.0, -2.0, 3.0];
        let rhs = matrix.mul(&exact).unwrap();
        let answer = solve_gmres(
            &matrix,
            &rhs,
            GmresOptions {
                restart: 2,
                max_iterations: 60,
                relative_tolerance: 1e-12,
            },
        )
        .unwrap();
        for (found, expected) in answer.iter().zip(exact) {
            assert!((found - expected).abs() < 1e-10);
        }
        let check = matrix.mul(&answer).unwrap();
        assert!(
            check
                .iter()
                .zip(rhs)
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>()
                .sqrt()
                < 1e-10
        );
    }

    #[test]
    fn indefinite_and_zero_diagonal_invertible_systems() {
        let indefinite = csr(&[&[(0, -2.0), (1, 1.0)], &[(0, 1.0), (1, 3.0)]]);
        let x = solve_gmres(&indefinite, &[0.0, 7.0], GmresOptions::default()).unwrap();
        assert!((x[0] - 1.0).abs() < 1e-10 && (x[1] - 2.0).abs() < 1e-10);
        let zero_diagonal = csr(&[&[(1, 1.0)], &[(0, 2.0)]]);
        let x = solve_gmres(&zero_diagonal, &[3.0, 4.0], GmresOptions::default()).unwrap();
        assert!((x[0] - 2.0).abs() < 1e-10 && (x[1] - 3.0).abs() < 1e-10);
    }

    #[test]
    fn nonsymmetric_convection_diffusion_stencil_with_restarts() {
        let n = 200;
        let mut row_offsets = vec![0];
        let mut columns = Vec::new();
        let mut values = Vec::new();
        for row in 0..n {
            if row > 0 {
                columns.push(row - 1);
                values.push(-1.7);
            }
            columns.push(row);
            values.push(4.0);
            if row + 1 < n {
                columns.push(row + 1);
                values.push(-0.3);
            }
            row_offsets.push(columns.len());
        }
        let matrix = CsrMatrix {
            n,
            row_offsets,
            columns,
            values,
        };
        let exact: Vec<f64> = (0..n).map(|i| ((i + 1) as f64 * 0.07).sin()).collect();
        let rhs = matrix.mul(&exact).unwrap();
        let answer = solve_gmres_with_threads(
            &matrix,
            &rhs,
            GmresOptions {
                restart: 12,
                max_iterations: 100,
                relative_tolerance: 1e-11,
            },
            4,
        )
        .unwrap();
        let max_error = answer
            .iter()
            .zip(exact)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f64, f64::max);
        assert!(max_error < 1e-10, "max error {max_error}");
    }

    #[test]
    fn singular_inconsistent_and_invalid_storage_fail_closed() {
        let singular = csr(&[&[(0, 1.0)], &[]]);
        let error = solve_gmres(&singular, &[1.0, 1.0], GmresOptions::default()).unwrap_err();
        assert!(
            error.contains("breakdown")
                || error.contains("singular")
                || error.contains("stagnated"),
            "{error}"
        );
        let invalid = CsrMatrix {
            n: 2,
            row_offsets: vec![0, 2, 1],
            columns: vec![0, 1],
            values: vec![1.0, 1.0],
        };
        assert!(solve_gmres(&invalid, &[1.0, 1.0], GmresOptions::default()).is_err());
    }

    #[test]
    fn iteration_and_storage_budgets_are_enforced() {
        let matrix = csr(&[&[(0, 2.0), (1, -1.0)], &[(0, 0.1), (1, 2.0)]]);
        let error = solve_gmres(
            &matrix,
            &[1.0, 2.0],
            GmresOptions {
                restart: 1,
                max_iterations: 1,
                relative_tolerance: 1e-15,
            },
        )
        .unwrap_err();
        assert!(
            error.contains("converge") || error.contains("stagnated"),
            "{error}"
        );
        let oversized = CsrMatrix {
            n: 1_100_000,
            row_offsets: vec![],
            columns: vec![],
            values: vec![],
        };
        let error =
            solve_gmres(&oversized, &vec![0.0; oversized.n], GmresOptions::default()).unwrap_err();
        assert!(error.contains("storage"), "{error}");
    }
}
