//! Small dense reference solver. Explicit size limit prevents an accidental
//! O(n³) solve of a production mesh; a sparse backend can replace it later.

#[derive(Clone, Debug)]
pub struct Matrix {
    pub n: usize,
    pub data: Vec<f64>,
}

impl Matrix {
    pub fn zeros(n: usize) -> Result<Self, String> {
        if n == 0 || n > 600 {
            return Err(format!("unsupported dense system size {n}"));
        }
        Ok(Self {
            n,
            data: vec![0.0; n * n],
        })
    }
    pub fn get(&self, i: usize, j: usize) -> f64 {
        self.data[i * self.n + j]
    }
    pub fn add(&mut self, i: usize, j: usize, value: f64) {
        self.data[i * self.n + j] += value;
    }
    pub fn mul(&self, x: &[f64]) -> Vec<f64> {
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
    if !k.data.iter().chain(f).all(|v| v.is_finite()) {
        return Err("non-finite stiffness or load".into());
    }
    let free: Vec<usize> = (0..k.n).filter(|&i| prescribed[i].is_none()).collect();
    if !prescribed.iter().flatten().all(|v| v.is_finite()) {
        return Err("non-finite prescribed displacement".into());
    }
    let mut u: Vec<f64> = prescribed.iter().map(|v| v.unwrap_or(0.0)).collect();
    let m = free.len();
    if m > 0 {
        let mut a = vec![0.0; m * m];
        let mut b = vec![0.0; m];
        for (ri, &i) in free.iter().enumerate() {
            b[ri] = f[i]
                - (0..k.n)
                    .filter_map(|j| prescribed[j].map(|v| k.get(i, j) * v))
                    .sum::<f64>();
            for (cj, &j) in free.iter().enumerate() {
                a[ri * m + cj] = k.get(i, j);
            }
        }
        let solution = gaussian(&mut a, &mut b, m)?;
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
    fn detects_unstable_free_stiffness() {
        let mut k = Matrix::zeros(2).unwrap();
        k.add(0, 0, 10.0);
        k.add(1, 1, -1.0);
        assert!(free_positive_definite(&k, &[Some(0.0), None]).is_err());
    }
}
