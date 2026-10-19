//! Bounded sparse LDLᵀ factorization for symmetric positive-definite free systems.
//!
//! This is a direct alternative to PCG. Its `max_factor_entries` bounds the
//! number of stored diagonal and off-diagonal factor entries (including active
//! Schur entries); it is not a byte-accurate memory cap. Natural DOF ordering
//! may create substantial fill on large 3D meshes. No pivot permutation is
//! performed: a non-positive pivot rejects an unstable, singular or indefinite
//! free stiffness instead of silently regularizing it.

use std::collections::BTreeMap;

use crate::csr::CsrMatrix;

const MAX_ACCEPTED_RELATIVE_RESIDUAL: f64 = 1e-8;

#[derive(Clone, Debug)]
pub struct SparseLdlt<'a> {
    matrix: &'a CsrMatrix,
    global_dofs: usize,
    free: Vec<usize>,
    diagonal: Vec<f64>,
    // For each pivot i: (later row j, L[j,i]).
    lower_columns: Vec<Vec<(usize, f64)>>,
    pub factor_entries: usize,
}

#[derive(Clone, Debug)]
pub struct DirectResult {
    pub displacements: Vec<f64>,
    pub reactions: Vec<f64>,
    pub true_free_residual_norm: f64,
    pub factor_entries: usize,
}

impl<'a> SparseLdlt<'a> {
    pub fn factor(
        matrix: &'a CsrMatrix,
        prescribed: &[Option<f64>],
        max_factor_entries: usize,
    ) -> Result<Self, String> {
        if prescribed.len() != matrix.n
            || prescribed.iter().flatten().any(|value| !value.is_finite())
        {
            return Err("LDLT constraints must be finite and match the matrix".into());
        }
        if max_factor_entries == 0 {
            return Err("LDLT max_factor_entries must be positive".into());
        }
        validate_csr_symmetric(matrix)?;
        let free: Vec<usize> = (0..matrix.n)
            .filter(|&dof| prescribed[dof].is_none())
            .collect();
        if free.len() > max_factor_entries {
            return Err(format!(
                "LDLT factor entry limit {max_factor_entries} is below {} free diagonals",
                free.len()
            ));
        }
        let mut position = vec![None; matrix.n];
        for (index, &dof) in free.iter().enumerate() {
            position[dof] = Some(index);
        }
        let n = free.len();
        let mut upper = vec![BTreeMap::<usize, f64>::new(); n];
        let mut active_entries = 0usize;
        for (row, &global_row) in free.iter().enumerate() {
            for index in matrix.row_offsets[global_row]..matrix.row_offsets[global_row + 1] {
                if let Some(col) = position[matrix.columns[index]] {
                    if col >= row && matrix.values[index] != 0.0 {
                        upper[row].insert(col, matrix.values[index]);
                        active_entries += 1;
                        if active_entries > max_factor_entries {
                            return Err(format!(
                                "LDLT factor entry limit {max_factor_entries} exceeded by original free stiffness"
                            ));
                        }
                    }
                }
            }
        }
        let mut diagonal = vec![0.0; n];
        let mut lower_columns = vec![Vec::new(); n];
        let mut factor_entries = 0usize;
        for pivot in 0..n {
            let original = matrix_value(matrix, free[pivot], free[pivot]);
            let value = upper[pivot].get(&pivot).copied().unwrap_or(0.0);
            if !original.is_finite() || original <= 0.0 {
                return Err(format!(
                    "LDLT non-positive original diagonal at free DOF {}",
                    free[pivot]
                ));
            }
            if !value.is_finite() || value <= original * 1e-12 {
                return Err(format!(
                    "LDLT non-positive or near-zero pivot at free DOF {} (pivot {value:.6e}, original {original:.6e}); mechanism or indefinite stiffness",
                    free[pivot]
                ));
            }
            diagonal[pivot] = value;
            let neighbors: Vec<(usize, f64)> = upper[pivot]
                .iter()
                .filter(|(column, _)| **column > pivot)
                .map(|(&column, &entry)| (column, entry))
                .collect();
            let factors: Vec<(usize, f64)> = neighbors
                .iter()
                .map(|&(row, entry)| (row, entry / value))
                .collect();
            if factors.iter().any(|(_, entry)| !entry.is_finite()) {
                return Err(format!(
                    "LDLT non-finite factor at free DOF {}",
                    free[pivot]
                ));
            }
            let future_factor_entries = factor_entries
                .checked_add(1 + factors.len())
                .ok_or("LDLT factor entry count overflow")?;
            // The current pivot row's active entries become stored factors.
            let remaining_active = active_entries - upper[pivot].len();
            if future_factor_entries
                .checked_add(remaining_active)
                .ok_or("LDLT storage count overflow")?
                > max_factor_entries
            {
                return Err(format!(
                    "LDLT factor entry limit {max_factor_entries} exceeded at free DOF {}",
                    free[pivot]
                ));
            }
            for (i, &(row, entry_row)) in neighbors.iter().enumerate() {
                for &(col, entry_col) in &neighbors[i..] {
                    let correction = entry_row * entry_col / value;
                    let existed = upper[row].contains_key(&col);
                    let next = upper[row].get(&col).copied().unwrap_or(0.0) - correction;
                    if !next.is_finite() {
                        return Err(format!(
                            "LDLT non-finite Schur entry after free DOF {}",
                            free[pivot]
                        ));
                    }
                    if !existed {
                        let live_after_fill = active_entries
                            .checked_sub(upper[pivot].len())
                            .and_then(|remaining| remaining.checked_add(future_factor_entries))
                            .and_then(|total| total.checked_add(1))
                            .ok_or("LDLT storage count overflow")?;
                        if live_after_fill > max_factor_entries {
                            return Err(format!(
                                "LDLT factor entry limit {max_factor_entries} exceeded by fill at free DOF {}",
                                free[pivot]
                            ));
                        }
                        active_entries += 1;
                    }
                    upper[row].insert(col, next);
                }
            }
            active_entries -= upper[pivot].len();
            upper[pivot].clear();
            factor_entries = future_factor_entries;
            lower_columns[pivot] = factors;
        }
        Ok(Self {
            matrix,
            global_dofs: matrix.n,
            free,
            diagonal,
            lower_columns,
            factor_entries,
        })
    }

    /// Reuse the same factor for another load case with the same support set.
    pub fn solve(
        &self,
        applied_load: &[f64],
        prescribed: &[Option<f64>],
    ) -> Result<DirectResult, String> {
        let matrix = self.matrix;
        if applied_load.len() != self.global_dofs
            || prescribed.len() != self.global_dofs
            || applied_load.iter().any(|value| !value.is_finite())
            || prescribed.iter().flatten().any(|value| !value.is_finite())
        {
            return Err("LDLT solve dimensions or finite-value check failed".into());
        }
        let free_pattern: Vec<usize> = (0..self.global_dofs)
            .filter(|&dof| prescribed[dof].is_none())
            .collect();
        if free_pattern != self.free {
            return Err("LDLT support pattern changed since factorization".into());
        }
        let mut displacements: Vec<f64> = prescribed
            .iter()
            .map(|value| value.unwrap_or(0.0))
            .collect();
        let fixed_product = matrix.mul(&displacements)?;
        let mut reduced: Vec<f64> = self
            .free
            .iter()
            .map(|&dof| applied_load[dof] - fixed_product[dof])
            .collect();
        if reduced.iter().any(|value| !value.is_finite()) {
            return Err("LDLT solve produced non-finite reduced right-hand side".into());
        }
        let reduced_rhs_norm = reduced
            .iter()
            .fold(0.0_f64, |norm, value| norm.hypot(*value));
        if !reduced_rhs_norm.is_finite() {
            return Err("LDLT reduced right-hand-side norm overflowed".into());
        }
        // L y = b, D z = y, Lᵀ x = z.
        for pivot in 0..self.free.len() {
            let yi = reduced[pivot];
            for &(row, lower) in &self.lower_columns[pivot] {
                reduced[row] -= lower * yi;
            }
        }
        for (index, value) in reduced.iter_mut().enumerate() {
            *value /= self.diagonal[index];
        }
        for pivot in (0..self.free.len()).rev() {
            for &(row, lower) in &self.lower_columns[pivot] {
                reduced[pivot] -= lower * reduced[row];
            }
        }
        if reduced.iter().any(|value| !value.is_finite()) {
            return Err("LDLT solve produced non-finite displacements".into());
        }
        for (index, &dof) in self.free.iter().enumerate() {
            displacements[dof] = reduced[index];
        }
        let internal = matrix.mul(&displacements)?;
        let reactions: Vec<f64> = internal
            .iter()
            .zip(applied_load)
            .map(|(force, applied)| force - applied)
            .collect();
        if reactions.iter().any(|value| !value.is_finite()) {
            return Err("LDLT solve produced non-finite reactions".into());
        }
        let true_free_residual_norm = self
            .free
            .iter()
            .fold(0.0_f64, |norm, &dof| norm.hypot(reactions[dof]));
        if !true_free_residual_norm.is_finite() {
            return Err("LDLT solve produced non-finite free residual".into());
        }
        let relative_free_residual = true_free_residual_norm / reduced_rhs_norm.max(1.0);
        if !relative_free_residual.is_finite()
            || relative_free_residual > MAX_ACCEPTED_RELATIVE_RESIDUAL
        {
            return Err(format!(
                "LDLT true free residual {relative_free_residual:.3e} exceeds {MAX_ACCEPTED_RELATIVE_RESIDUAL:.1e}"
            ));
        }
        Ok(DirectResult {
            displacements,
            reactions,
            true_free_residual_norm,
            factor_entries: self.factor_entries,
        })
    }
}

pub fn solve_constrained_ldlt(
    matrix: &CsrMatrix,
    applied_load: &[f64],
    prescribed: &[Option<f64>],
    max_factor_entries: usize,
) -> Result<DirectResult, String> {
    SparseLdlt::factor(matrix, prescribed, max_factor_entries)?.solve(applied_load, prescribed)
}

fn matrix_value(matrix: &CsrMatrix, row: usize, col: usize) -> f64 {
    let entries = matrix.row_offsets[row]..matrix.row_offsets[row + 1];
    matrix.columns[entries.clone()]
        .binary_search(&col)
        .ok()
        .map(|index| matrix.values[entries.start + index])
        .unwrap_or(0.0)
}

fn validate_csr_symmetric(matrix: &CsrMatrix) -> Result<(), String> {
    if matrix.row_offsets.len() != matrix.n + 1
        || matrix.columns.len() != matrix.values.len()
        || matrix.row_offsets.first() != Some(&0)
        || matrix.row_offsets.last() != Some(&matrix.values.len())
    {
        return Err("invalid LDLT CSR storage".into());
    }
    for row in 0..matrix.n {
        let start = matrix.row_offsets[row];
        let end = matrix.row_offsets[row + 1];
        if start > end || end > matrix.values.len() {
            return Err(format!("invalid LDLT CSR offsets at DOF {row}"));
        }
        let mut previous = None;
        for index in start..end {
            let col = matrix.columns[index];
            if col >= matrix.n
                || previous.is_some_and(|p| col <= p)
                || !matrix.values[index].is_finite()
            {
                return Err(format!("invalid LDLT CSR entry at DOF {row}"));
            }
            previous = Some(col);
        }
    }
    for row in 0..matrix.n {
        for index in matrix.row_offsets[row]..matrix.row_offsets[row + 1] {
            let col = matrix.columns[index];
            let entry = matrix.values[index];
            let reverse = matrix_value(matrix, col, row);
            if (entry - reverse).abs() > 1e-11 * entry.abs().max(reverse.abs()).max(1e-30) {
                return Err(format!("asymmetric LDLT stiffness at DOFs {row}, {col}"));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::csr::{CsrAssembler, PcgOptions};

    #[test]
    fn independent_two_by_two_spd_solution() {
        // [4 1; 1 3] [1 2]ᵀ = [6 7]ᵀ.
        let mut assembly = CsrAssembler::new(2).unwrap();
        assembly
            .add_element(&[0, 1], &[4.0, 1.0, 1.0, 3.0])
            .unwrap();
        let matrix = assembly.build().unwrap();
        let solved = solve_constrained_ldlt(&matrix, &[6.0, 7.0], &[None, None], 3).unwrap();
        assert!((solved.displacements[0] - 1.0).abs() < 1e-12);
        assert!((solved.displacements[1] - 2.0).abs() < 1e-12);
        assert!(solved.true_free_residual_norm < 1e-12);
        assert_eq!(solved.factor_entries, 3);
    }

    #[test]
    fn unloaded_mechanism_is_rejected_by_second_pivot() {
        let mut assembly = CsrAssembler::new(2).unwrap();
        assembly
            .add_element(&[0, 1], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        let matrix = assembly.build().unwrap();
        let error = solve_constrained_ldlt(&matrix, &[0.0, 0.0], &[None, None], 3).unwrap_err();
        assert!(error.contains("pivot at free DOF 1"), "{error}");
    }

    #[test]
    fn ill_conditioned_spd_factor_cannot_report_false_success() {
        // A Hilbert-9 matrix has positive pivots here, but its unpivoted f64
        // factor can leave a true free residual above the direct-solve gate.
        let n = 9;
        let mut assembly = CsrAssembler::new(n).unwrap();
        for row in 0..n {
            for column in 0..n {
                assembly
                    .add(row, column, 1.0 / (row + column + 1) as f64)
                    .unwrap();
            }
        }
        let matrix = assembly.build().unwrap();
        let loads: Vec<f64> = (0..n).map(|i| (i % 3) as f64 / 10.0 + 0.1).collect();
        let error = solve_constrained_ldlt(&matrix, &loads, &vec![None; n], n * n).unwrap_err();
        assert!(error.contains("true free residual"), "{error}");
    }

    #[test]
    fn overflowing_reduced_norm_cannot_hide_free_residual() {
        let mut assembly = CsrAssembler::new(2).unwrap();
        assembly.add(0, 0, 1.0).unwrap();
        assembly.add(1, 1, 1.0).unwrap();
        let matrix = assembly.build().unwrap();
        let error =
            solve_constrained_ldlt(&matrix, &[f64::MAX, f64::MAX], &[None, None], 2).unwrap_err();
        assert!(error.contains("norm overflowed"), "{error}");
    }

    #[test]
    fn indefinite_matrix_is_rejected() {
        let mut assembly = CsrAssembler::new(2).unwrap();
        assembly
            .add_element(&[0, 1], &[1.0, 2.0, 2.0, 1.0])
            .unwrap();
        let matrix = assembly.build().unwrap();
        let error = solve_constrained_ldlt(&matrix, &[0.0, 0.0], &[None, None], 3).unwrap_err();
        assert!(error.contains("pivot at free DOF 1"), "{error}");
    }

    #[test]
    fn fill_limit_is_enforced_during_elimination() {
        // Eliminating node 0 of a three-leaf star creates a 3x3 clique.
        let mut assembly = CsrAssembler::new(4).unwrap();
        for leaf in 1..4 {
            assembly.add(0, leaf, -1.0).unwrap();
            assembly.add(leaf, 0, -1.0).unwrap();
            assembly.add(leaf, leaf, 2.0).unwrap();
        }
        assembly.add(0, 0, 4.0).unwrap();
        let matrix = assembly.build().unwrap();
        let error = solve_constrained_ldlt(&matrix, &[0.0; 4], &[None; 4], 7).unwrap_err();
        assert!(error.contains("exceeded by fill"), "{error}");
    }

    #[test]
    fn fill_limit_counts_each_new_schur_entry() {
        // Four leaves create six Schur off-diagonals, beyond ten live entries.
        let mut assembly = CsrAssembler::new(5).unwrap();
        for leaf in 1..5 {
            assembly.add(0, leaf, -1.0).unwrap();
            assembly.add(leaf, 0, -1.0).unwrap();
            assembly.add(leaf, leaf, 2.0).unwrap();
        }
        assembly.add(0, 0, 5.0).unwrap();
        let matrix = assembly.build().unwrap();
        let error = solve_constrained_ldlt(&matrix, &[0.0; 5], &[None; 5], 10).unwrap_err();
        assert!(error.contains("exceeded by fill"), "{error}");
    }

    #[test]
    fn prescribed_displacements_and_reactions_match_hand_solution() {
        let mut assembly = CsrAssembler::new(3).unwrap();
        assembly
            .add_element(&[0, 1], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        assembly
            .add_element(&[1, 2], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        let matrix = assembly.build().unwrap();
        let solved =
            solve_constrained_ldlt(&matrix, &[0.0, 1.0, 0.0], &[Some(0.0), None, Some(2.0)], 1)
                .unwrap();
        assert_eq!(solved.displacements, vec![0.0, 1.5, 2.0]);
        assert_eq!(solved.reactions, vec![-1.5, 0.0, 0.5]);
    }

    #[test]
    fn direct_and_csr_pcg_agree_on_nontrivial_system() {
        let n = 30;
        let mut assembly = CsrAssembler::new(n).unwrap();
        for i in 0..n {
            assembly.add(i, i, 4.0).unwrap();
            if i + 1 < n {
                assembly.add(i, i + 1, -1.0).unwrap();
                assembly.add(i + 1, i, -1.0).unwrap();
            }
        }
        let matrix = assembly.build().unwrap();
        let loads: Vec<f64> = (0..n).map(|i| 1.0 + (i % 5) as f64).collect();
        let direct = solve_constrained_ldlt(&matrix, &loads, &vec![None; n], 2 * n).unwrap();
        let pcg = matrix.solve_pcg(&loads, PcgOptions::default()).unwrap();
        let max_difference = direct
            .displacements
            .iter()
            .zip(&pcg.displacements)
            .map(|(a, b)| (a - b).abs())
            .fold(0.0, f64::max);
        assert!(max_difference < 1e-9, "difference {max_difference}");
    }

    #[test]
    fn fill_success_and_reused_factor_match_pcg() {
        let mut assembly = CsrAssembler::new(5).unwrap();
        for leaf in 1..5 {
            assembly.add(0, leaf, -1.0).unwrap();
            assembly.add(leaf, 0, -1.0).unwrap();
            assembly.add(leaf, leaf, 2.0).unwrap();
        }
        assembly.add(0, 0, 5.0).unwrap();
        let matrix = assembly.build().unwrap();
        let factor = SparseLdlt::factor(&matrix, &[None; 5], 15).unwrap();
        assert_eq!(factor.factor_entries, 15);
        for load in [[1.0, 0.0, 0.0, 0.0, 0.0], [0.0, 1.0, 2.0, 3.0, 4.0]] {
            let direct = factor.solve(&load, &[None; 5]).unwrap();
            let pcg = matrix.solve_pcg(&load, PcgOptions::default()).unwrap();
            for (a, b) in direct.displacements.iter().zip(&pcg.displacements) {
                assert!((a - b).abs() < 1e-12);
            }
        }
        let error = factor.solve(&[0.0; 5], &[Some(0.0), None, None, None, None]);
        assert!(error.unwrap_err().contains("support pattern changed"));
    }
}
