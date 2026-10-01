//! Dense reference solve for small systems, sparse Jacobi-PCG for larger
//! positive-definite plate and membrane systems.

use std::collections::BTreeMap;

const DENSE_LIMIT: usize = 600;
const MAX_DOFS: usize = 20_000;

#[derive(Clone, Debug)]
pub struct Matrix {
    pub n: usize,
    data: Vec<f64>,
    sparse: Option<Vec<BTreeMap<usize, f64>>>,
}

impl Matrix {
    pub fn zeros(n: usize) -> Result<Self, String> {
        if n == 0 || n > MAX_DOFS {
            return Err(format!(
                "unsupported system size {n}; maximum is {MAX_DOFS}"
            ));
        }
        Ok(Self {
            n,
            data: if n <= DENSE_LIMIT {
                vec![0.0; n * n]
            } else {
                Vec::new()
            },
            sparse: (n > DENSE_LIMIT).then(|| vec![BTreeMap::new(); n]),
        })
    }
    pub fn get(&self, i: usize, j: usize) -> f64 {
        if let Some(rows) = &self.sparse {
            *rows[i].get(&j).unwrap_or(&0.0)
        } else {
            self.data[i * self.n + j]
        }
    }
    pub fn add(&mut self, i: usize, j: usize, value: f64) {
        if let Some(rows) = &mut self.sparse {
            *rows[i].entry(j).or_default() += value;
        } else {
            self.data[i * self.n + j] += value;
        }
    }
    pub fn mul(&self, x: &[f64]) -> Vec<f64> {
        if let Some(rows) = &self.sparse {
            return rows
                .iter()
                .map(|row| row.iter().map(|(&j, &v)| v * x[j]).sum())
                .collect();
        }
        (0..self.n)
            .map(|i| (0..self.n).map(|j| self.get(i, j) * x[j]).sum())
            .collect()
    }
}

/// Check that the restrained free stiffness has positive strain energy.
/// A non-positive pivot under compression signals a lost stable P-Delta branch.
pub fn free_positive_definite(k: &Matrix, prescribed: &[Option<f64>]) -> Result<(), String> {
    if prescribed.len() != k.n {
        return Err("matrix/constraint size mismatch".into());
    }
    if k.sparse.is_some() {
        return Err("frame stability inertia check is limited to 600 DOF".into());
    }
    let free: Vec<usize> = (0..k.n).filter(|&i| prescribed[i].is_none()).collect();
    let n = free.len();
    let mut lower = vec![0.0; n * n];
    for row in 0..n {
        let diagonal = k.get(free[row], free[row]);
        if !diagonal.is_finite() || diagonal <= 0.0 {
            return Err("non-positive free stiffness; unstable or invalid frame".into());
        }
        for col in 0..=row {
            let mut value = 0.5 * (k.get(free[row], free[col]) + k.get(free[col], free[row]));
            for p in 0..col {
                value -= lower[row * n + p] * lower[col * n + p];
            }
            if row == col {
                if !value.is_finite() || value <= diagonal * 1e-12 {
                    return Err(
                        "non-positive free stiffness; compression may have reached buckling".into(),
                    );
                }
                lower[row * n + col] = value.sqrt();
            } else {
                lower[row * n + col] = value / lower[col * n + col];
            }
        }
    }
    Ok(())
}

/// Solve K u = f with prescribed displacements. Reactions use the original K.
pub fn constrained_solve(
    k: &Matrix,
    f: &[f64],
    prescribed: &[Option<f64>],
) -> Result<(Vec<f64>, Vec<f64>), String> {
    if f.len() != k.n || prescribed.len() != k.n {
        return Err("matrix/vector size mismatch".into());
    }
    if !k.data.iter().chain(f).all(|v| v.is_finite())
        || k.sparse.as_ref().is_some_and(|rows| {
            rows.iter()
                .flat_map(|row| row.values())
                .any(|v| !v.is_finite())
        })
    {
        return Err("non-finite stiffness or load".into());
    }
    let free: Vec<usize> = (0..k.n).filter(|&i| prescribed[i].is_none()).collect();
    if !prescribed.iter().flatten().all(|v| v.is_finite()) {
        return Err("non-finite prescribed displacement".into());
    }
    let mut u: Vec<f64> = prescribed.iter().map(|v| v.unwrap_or(0.0)).collect();
    let m = free.len();
    if m > 0 {
        let mut b = vec![0.0; m];
        let mut free_position = vec![None; k.n];
        for (position, &dof) in free.iter().enumerate() {
            free_position[dof] = Some(position);
        }
        for (ri, &i) in free.iter().enumerate() {
            b[ri] = f[i];
            if let Some(rows) = &k.sparse {
                for (&j, &value) in &rows[i] {
                    if let Some(p) = prescribed[j] {
                        b[ri] -= value * p;
                    }
                }
            } else {
                b[ri] -= (0..k.n)
                    .filter_map(|j| prescribed[j].map(|v| k.get(i, j) * v))
                    .sum::<f64>();
            }
        }
        let solution = if let Some(rows) = &k.sparse {
            sparse_pcg(rows, &free, &free_position, &b)?
        } else {
            let mut a = vec![0.0; m * m];
            for (ri, &i) in free.iter().enumerate() {
                for (cj, &j) in free.iter().enumerate() {
                    a[ri * m + cj] = k.get(i, j);
                }
            }
            gaussian(&mut a, &mut b, m)?
        };
        for (ri, &i) in free.iter().enumerate() {
            u[i] = solution[ri];
        }
    }
    let reaction = k
        .mul(&u)
        .iter()
        .zip(f)
        .map(|(ku, load)| ku - load)
        .collect();
    Ok((u, reaction))
}

fn sparse_pcg(
    rows: &[BTreeMap<usize, f64>],
    free: &[usize],
    free_position: &[Option<usize>],
    b: &[f64],
) -> Result<Vec<f64>, String> {
    // PCG requires a symmetric operator. Check the assembled free block
    // explicitly; an asymmetric tangent must never be silently symmetrised.
    for &row in free {
        for (&column, &value) in &rows[row] {
            if free_position[column].is_none() || column == row {
                continue;
            }
            let transpose = *rows[column].get(&row).unwrap_or(&0.0);
            let scale = value.abs().max(transpose.abs()).max(1.0);
            if (value - transpose).abs() > 1e-10 * scale {
                return Err(format!(
                    "asymmetric sparse stiffness at DOFs {row}, {column}"
                ));
            }
        }
    }
    let n = free.len();
    let mut inv_diag = vec![0.0; n];
    for (i, &dof) in free.iter().enumerate() {
        let diagonal = *rows[dof].get(&dof).unwrap_or(&0.0);
        if !diagonal.is_finite() || diagonal <= 0.0 {
            return Err(format!(
                "non-positive sparse stiffness diagonal at DOF {dof}"
            ));
        }
        inv_diag[i] = 1.0 / diagonal;
    }
    let mut x = vec![0.0; n];
    let mut residual = b.to_vec();
    let mut z: Vec<f64> = residual.iter().zip(&inv_diag).map(|(r, d)| r * d).collect();
    let mut direction = z.clone();
    let mut rz: f64 = residual.iter().zip(&z).map(|(r, z)| r * z).sum();
    let norm_b = b.iter().map(|v| v * v).sum::<f64>().sqrt();
    let target = 1e-10 * norm_b.max(1e-20);
    if norm_b == 0.0 {
        // A zero load has a zero residual even for a mechanism. Exercise the
        // free stiffness with a nonzero right-hand side before accepting it.
        // This detects mechanisms visible to this probe; it is not an inertia
        // certificate for an arbitrary large sparse matrix.
        let probe: Vec<f64> = free
            .iter()
            .map(|&dof| 1.0 + (dof % 31) as f64 / 31.0)
            .collect();
        sparse_pcg(rows, free, free_position, &probe)?;
        return Ok(x);
    }
    let max_iterations = 10 * n.max(1);
    for iteration in 0..max_iterations {
        let ad: Vec<f64> = free
            .iter()
            .map(|&dof| {
                rows[dof]
                    .iter()
                    .filter_map(|(&column, &value)| {
                        free_position[column].map(|j| value * direction[j])
                    })
                    .sum()
            })
            .collect();
        let curvature: f64 = direction.iter().zip(&ad).map(|(p, a)| p * a).sum();
        if !curvature.is_finite() || curvature <= 0.0 {
            return Err("non-positive sparse stiffness; system is unstable or not symmetric positive definite".into());
        }
        let alpha = rz / curvature;
        for i in 0..n {
            x[i] += alpha * direction[i];
            residual[i] -= alpha * ad[i];
        }
        let relative = residual.iter().map(|v| v * v).sum::<f64>().sqrt();
        if relative <= target {
            // Check the true residual before accepting a recurred CG residual.
            let true_norm = free
                .iter()
                .enumerate()
                .map(|(i, &dof)| {
                    let ax: f64 = rows[dof]
                        .iter()
                        .filter_map(|(&column, &value)| free_position[column].map(|j| value * x[j]))
                        .sum();
                    (b[i] - ax).powi(2)
                })
                .sum::<f64>()
                .sqrt();
            if true_norm <= target * 10.0 {
                return Ok(x);
            }
            return Err(format!(
                "sparse solve lost residual accuracy at iteration {iteration}"
            ));
        }
        z = residual.iter().zip(&inv_diag).map(|(r, d)| r * d).collect();
        let next_rz: f64 = residual.iter().zip(&z).map(|(r, z)| r * z).sum();
        if !next_rz.is_finite() || rz == 0.0 {
            break;
        }
        let beta = next_rz / rz;
        for i in 0..n {
            direction[i] = z[i] + beta * direction[i];
        }
        rz = next_rz;
    }
    Err(format!(
        "sparse solver did not converge within {max_iterations} iterations"
    ))
}

fn gaussian(a: &mut [f64], b: &mut [f64], n: usize) -> Result<Vec<f64>, String> {
    let scale = a.iter().fold(0.0_f64, |max, value| max.max(value.abs()));
    if scale == 0.0 {
        return Err("singular stiffness matrix".into());
    }
    for col in 0..n {
        let pivot = (col..n)
            .max_by(|&i, &j| a[i * n + col].abs().total_cmp(&a[j * n + col].abs()))
            .unwrap();
        if a[pivot * n + col].abs() <= scale * 1e-13 {
            return Err(format!(
                "singular or ill-conditioned stiffness matrix at DOF {col}"
            ));
        }
        if pivot != col {
            for j in 0..n {
                a.swap(col * n + j, pivot * n + j);
            }
            b.swap(col, pivot);
        }
        for row in col + 1..n {
            let factor = a[row * n + col] / a[col * n + col];
            a[row * n + col] = 0.0;
            for j in col + 1..n {
                a[row * n + j] -= factor * a[col * n + j];
            }
            b[row] -= factor * b[col];
        }
    }
    let mut x = vec![0.0; n];
    for row in (0..n).rev() {
        x[row] =
            (b[row] - (row + 1..n).map(|j| a[row * n + j] * x[j]).sum::<f64>()) / a[row * n + row];
    }
    Ok(x)
}

/// Positive load factors for (K + factor * Kg) phi = 0. The geometric
/// stiffness is negative for compression. This dense reference eigensolve is
/// deliberately bounded; large frames need a sparse shift-invert solver.
pub fn buckling_factors(
    k: &Matrix,
    kg: &Matrix,
    free: &[usize],
    modes: usize,
) -> Result<Vec<f64>, String> {
    let n = free.len();
    if k.n != kg.n || n == 0 || n > 120 {
        return Err(format!(
            "buckling eigenproblem supports 1..120 free DOF, got {n}"
        ));
    }
    let mut lower = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..=i {
            let mut value = k.get(free[i], free[j]);
            for p in 0..j {
                value -= lower[i * n + p] * lower[j * n + p];
            }
            if i == j {
                if !value.is_finite() || value <= k.get(free[i], free[i]) * 1e-12 {
                    return Err("buckling base stiffness is not positive definite".into());
                }
                lower[i * n + j] = value.sqrt();
            } else {
                lower[i * n + j] = value / lower[j * n + j];
            }
        }
    }
    // W = L^-1. C = W (-Kg) W^T is symmetric and has eigenvalues 1/factor.
    let mut inverse = vec![0.0; n * n];
    for column in 0..n {
        for row in column..n {
            let mut value = if row == column { 1.0 } else { 0.0 };
            for p in column..row {
                value -= lower[row * n + p] * inverse[p * n + column];
            }
            inverse[row * n + column] = value / lower[row * n + row];
        }
    }
    let mut product = vec![0.0; n * n];
    for i in 0..n {
        for p in 0..=i {
            let weight = inverse[i * n + p];
            for j in 0..n {
                product[i * n + j] -= weight * kg.get(free[p], free[j]);
            }
        }
    }
    let mut c = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..n {
            for p in 0..=j {
                c[i * n + j] += product[i * n + p] * inverse[j * n + p];
            }
        }
    }
    for i in 0..n {
        for j in 0..i {
            let symmetric = 0.5 * (c[i * n + j] + c[j * n + i]);
            c[i * n + j] = symmetric;
            c[j * n + i] = symmetric;
        }
    }
    let mut converged = false;
    for _ in 0..40 {
        let scale = (0..n).map(|i| c[i * n + i].abs()).fold(1e-30, f64::max);
        let mut max_off: f64 = 0.0;
        for p in 0..n {
            for q in (p + 1)..n {
                let apq = c[p * n + q];
                max_off = max_off.max(apq.abs());
                if apq.abs() <= scale * 1e-12 {
                    continue;
                }
                let tau = (c[q * n + q] - c[p * n + p]) / (2.0 * apq);
                let t =
                    (if tau >= 0.0 { 1.0 } else { -1.0 }) / (tau.abs() + (1.0 + tau * tau).sqrt());
                let cosine = 1.0 / (1.0 + t * t).sqrt();
                let sine = t * cosine;
                let app = c[p * n + p];
                let aqq = c[q * n + q];
                c[p * n + p] = app - t * apq;
                c[q * n + q] = aqq + t * apq;
                c[p * n + q] = 0.0;
                c[q * n + p] = 0.0;
                for row in 0..n {
                    if row == p || row == q {
                        continue;
                    }
                    let arp = c[row * n + p];
                    let arq = c[row * n + q];
                    c[row * n + p] = cosine * arp - sine * arq;
                    c[p * n + row] = c[row * n + p];
                    c[row * n + q] = sine * arp + cosine * arq;
                    c[q * n + row] = c[row * n + q];
                }
            }
        }
        if max_off <= scale * 1e-10 {
            converged = true;
            break;
        }
    }
    if !converged {
        return Err("buckling eigensolver did not converge".into());
    }
    let mut factors: Vec<f64> = (0..n)
        .map(|i| c[i * n + i])
        .filter(|eigen| eigen.is_finite() && *eigen > 1e-12)
        .map(|eigen| 1.0 / eigen)
        .collect();
    factors.sort_by(f64::total_cmp);
    factors.truncate(modes);
    Ok(factors)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prescribed_displacement_and_reaction() {
        let mut k = Matrix::zeros(2).unwrap();
        k.add(0, 0, 10.0);
        k.add(0, 1, -10.0);
        k.add(1, 0, -10.0);
        k.add(1, 1, 10.0);
        let (u, r) = constrained_solve(&k, &[0.0, 5.0], &[Some(0.0), None]).unwrap();
        assert!((u[1] - 0.5).abs() < 1e-12);
        assert!((r[0] + 5.0).abs() < 1e-12);
    }
    #[test]
    fn prescribed_nonzero_displacement_is_transferred_to_free_dof() {
        let mut k = Matrix::zeros(2).unwrap();
        k.add(0, 0, 10.0);
        k.add(0, 1, -10.0);
        k.add(1, 0, -10.0);
        k.add(1, 1, 10.0);
        let (u, r) = constrained_solve(&k, &[0.0, 0.0], &[Some(0.01), None]).unwrap();
        assert!((u[1] - 0.01).abs() < 1e-12);
        assert!(r.iter().all(|value| value.abs() < 1e-12));
    }
    #[test]
    fn detects_unstable_free_stiffness() {
        let mut k = Matrix::zeros(2).unwrap();
        k.add(0, 0, 10.0);
        k.add(1, 1, -1.0);
        assert!(free_positive_definite(&k, &[Some(0.0), None]).is_err());
    }
    #[test]
    fn generalized_buckling_factors_match_diagonal_reference() {
        let mut k = Matrix::zeros(2).unwrap();
        let mut kg = Matrix::zeros(2).unwrap();
        k.add(0, 0, 2.0);
        k.add(1, 1, 8.0);
        kg.add(0, 0, -1.0);
        kg.add(1, 1, -2.0);
        let factors = buckling_factors(&k, &kg, &[0, 1], 2).unwrap();
        assert!((factors[0] - 2.0).abs() < 1e-12);
        assert!((factors[1] - 4.0).abs() < 1e-12);
    }
    #[test]
    fn sparse_chain_over_dense_limit_has_exact_tip_displacement_and_reaction() {
        let n = 751;
        let mut k = Matrix::zeros(n).unwrap();
        for i in 0..n - 1 {
            k.add(i, i, 10.0);
            k.add(i, i + 1, -10.0);
            k.add(i + 1, i, -10.0);
            k.add(i + 1, i + 1, 10.0);
        }
        let mut f = vec![0.0; n];
        f[n - 1] = 1.0;
        let mut fixed = vec![None; n];
        fixed[0] = Some(0.0);
        let (u, r) = constrained_solve(&k, &f, &fixed).unwrap();
        assert!((u[n - 1] - 75.0).abs() < 1e-6, "{}", u[n - 1]);
        assert!((r[0] + 1.0).abs() < 1e-8, "{}", r[0]);
        fixed[0] = Some(0.01);
        let (u_shifted, r_shifted) = constrained_solve(&k, &f, &fixed).unwrap();
        assert!((u_shifted[n - 1] - 75.01).abs() < 1e-6);
        assert!((r_shifted[0] + 1.0).abs() < 1e-8);
    }
    #[test]
    fn sparse_solver_rejects_asymmetric_free_stiffness() {
        let mut k = Matrix::zeros(601).unwrap();
        for i in 0..601 {
            k.add(i, i, 1.0);
        }
        k.add(0, 1, 0.2);
        let mut f = vec![0.0; 601];
        f[0] = 1.0;
        let error = constrained_solve(&k, &f, &vec![None; 601]).unwrap_err();
        assert!(error.contains("asymmetric"), "{error}");
    }
    #[test]
    fn sparse_solver_keeps_small_nonzero_loads() {
        let mut k = Matrix::zeros(601).unwrap();
        for i in 0..601 {
            k.add(i, i, 2.0);
        }
        let mut f = vec![0.0; 601];
        f[600] = 1e-12;
        let (u, _) = constrained_solve(&k, &f, &vec![None; 601]).unwrap();
        assert!((u[600] - 5e-13).abs() < 1e-24, "{}", u[600]);
    }
    #[test]
    fn sparse_solver_rejects_loaded_mechanism() {
        let mut k = Matrix::zeros(601).unwrap();
        for i in 0..601 {
            k.add(i, i, 1.0);
        }
        k.add(0, 1, -1.0);
        k.add(1, 0, -1.0);
        let mut f = vec![0.0; 601];
        f[0] = 1.0;
        f[1] = 1.0;
        let error = constrained_solve(&k, &f, &vec![None; 601]).unwrap_err();
        assert!(error.contains("non-positive"), "{error}");
    }
    #[test]
    fn sparse_solver_rejects_unloaded_mechanism() {
        let mut k = Matrix::zeros(601).unwrap();
        for i in 0..601 {
            k.add(i, i, 1.0);
        }
        k.add(0, 1, -1.0);
        k.add(1, 0, -1.0);
        let error = constrained_solve(&k, &vec![0.0; 601], &vec![None; 601]).unwrap_err();
        assert!(
            error.contains("non-positive") || error.contains("did not converge"),
            "{error}"
        );
    }
    #[test]
    fn sparse_solver_accepts_stable_unloaded_system() {
        let mut k = Matrix::zeros(601).unwrap();
        for i in 0..601 {
            k.add(i, i, 1.0 + i as f64 / 601.0);
        }
        let (u, reaction) = constrained_solve(&k, &vec![0.0; 601], &vec![None; 601]).unwrap();
        assert!(u.iter().all(|value| *value == 0.0));
        assert!(reaction.iter().all(|value| *value == 0.0));
    }
}
