//! Compressed sparse row (CSR) assembly and a checked Jacobi-PCG solve.
//!
//! The solver requires a symmetric positive-definite free matrix. PCG detects
//! invalid diagonals, asymmetry, non-positive search curvature and failure to
//! converge, but it is not an inertia certificate for an unloaded mechanism.
//! Callers needing that guarantee must also use an independent rank/factor test.

#[derive(Clone, Debug)]
pub struct CsrMatrix {
    pub n: usize,
    pub row_offsets: Vec<usize>,
    pub columns: Vec<usize>,
    pub values: Vec<f64>,
}

#[derive(Clone, Debug)]
pub struct CsrAssembler {
    n: usize,
    entries: Vec<(usize, usize, f64)>,
}

/// Two-pass element assembly: retain column indices, rather than full
/// (row, column, value) triplets, while discovering the CSR sparsity pattern.
/// Numeric element contributions then accumulate directly into that pattern.
pub struct CsrPatternAssembler {
    matrix: CsrMatrix,
}

impl CsrPatternAssembler {
    /// Build a three-DOF-per-node pattern from element node connectivity.
    /// Discovering each 3×3 node block once keeps temporary storage at the
    /// node-graph scale rather than storing every scalar element contribution.
    pub fn from_node_blocks3<const N: usize>(
        node_count: usize,
        elements: &[[usize; N]],
        max_node_slots: usize,
        max_nonzeros: usize,
    ) -> Result<Self, String> {
        if node_count == 0 || N == 0 || elements.is_empty() {
            return Err("invalid block CSR pattern dimensions".into());
        }
        let n = node_count
            .checked_mul(3)
            .ok_or("block CSR DOF count overflow")?;
        let row_count = n.checked_add(1).ok_or("block CSR row count overflow")?;
        let mut counts = vec![0_usize; node_count];
        for nodes in elements {
            if nodes.iter().any(|&node| node >= node_count) {
                return Err("block CSR element contains an invalid node".into());
            }
            for &row in nodes {
                counts[row] = counts[row]
                    .checked_add(N)
                    .ok_or("block CSR row count overflow")?;
            }
        }
        let mut old_offsets = Vec::with_capacity(node_count + 1);
        old_offsets.push(0_usize);
        for count in counts {
            let next = old_offsets
                .last()
                .unwrap()
                .checked_add(count)
                .ok_or("block CSR slot count overflow")?;
            if next > max_node_slots {
                return Err("block CSR exceeds the temporary node-slot budget".into());
            }
            old_offsets.push(next);
        }
        let mut neighbors = vec![0_usize; old_offsets[node_count]];
        let mut cursors = old_offsets[..node_count].to_vec();
        for nodes in elements {
            for &row in nodes {
                let start = cursors[row];
                neighbors[start..start + N].copy_from_slice(nodes);
                cursors[row] += N;
            }
        }
        let mut node_offsets = vec![0_usize; node_count + 1];
        let mut used = 0_usize;
        for row in 0..node_count {
            let start = old_offsets[row];
            let end = old_offsets[row + 1];
            neighbors[start..end].sort_unstable();
            let mut previous = None;
            for read in start..end {
                let neighbor = neighbors[read];
                if previous != Some(neighbor) {
                    neighbors[used] = neighbor;
                    used += 1;
                    previous = Some(neighbor);
                }
            }
            node_offsets[row + 1] = used;
        }
        let nnz = used
            .checked_mul(9)
            .ok_or("block CSR nonzero count overflow")?;
        if nnz > max_nonzeros {
            return Err("block CSR exceeds the scalar nonzero budget".into());
        }
        let mut row_offsets = Vec::with_capacity(row_count);
        let mut columns = Vec::with_capacity(nnz);
        row_offsets.push(0);
        for node in 0..node_count {
            let row_neighbors = &neighbors[node_offsets[node]..node_offsets[node + 1]];
            for _component in 0..3 {
                for &other in row_neighbors {
                    for c in 0..3 {
                        columns.push(3 * other + c);
                    }
                }
                row_offsets.push(columns.len());
            }
        }
        Ok(Self {
            matrix: CsrMatrix {
                n,
                row_offsets,
                columns,
                values: vec![0.0; nnz],
            },
        })
    }

    pub fn new<D: AsRef<[usize]>>(
        n: usize,
        element_dofs: &[D],
        max_pattern_slots: usize,
        max_nonzeros: usize,
    ) -> Result<Self, String> {
        if n == 0 || element_dofs.is_empty() || max_pattern_slots == 0 || max_nonzeros == 0 {
            return Err("invalid CSR pattern dimensions or budget".into());
        }
        let mut counts = vec![0_usize; n];
        for dofs in element_dofs {
            let dofs = dofs.as_ref();
            if dofs.is_empty() || dofs.iter().any(|&dof| dof >= n) {
                return Err("CSR pattern element contains an invalid DOF".into());
            }
            for &row in dofs {
                counts[row] = counts[row]
                    .checked_add(dofs.len())
                    .ok_or("CSR pattern row count overflow")?;
            }
        }
        let row_count = n.checked_add(1).ok_or("CSR row count overflow")?;
        let mut old_offsets = Vec::with_capacity(row_count);
        old_offsets.push(0_usize);
        for count in counts {
            let next = old_offsets
                .last()
                .copied()
                .unwrap()
                .checked_add(count)
                .ok_or("CSR pattern slot count overflow")?;
            if next > max_pattern_slots {
                return Err("CSR pattern exceeds the temporary slot budget".into());
            }
            old_offsets.push(next);
        }
        let slots = old_offsets[n];
        let mut columns = vec![0_usize; slots];
        let mut cursors = old_offsets[..n].to_vec();
        for dofs in element_dofs {
            let dofs = dofs.as_ref();
            for &row in dofs {
                let start = cursors[row];
                columns[start..start + dofs.len()].copy_from_slice(dofs);
                cursors[row] += dofs.len();
            }
        }
        let mut row_offsets = vec![0_usize; row_count];
        let mut used = 0;
        for row in 0..n {
            let start = old_offsets[row];
            let end = old_offsets[row + 1];
            columns[start..end].sort_unstable();
            let mut previous = None;
            for read in start..end {
                let col = columns[read];
                if previous != Some(col) {
                    if used == max_nonzeros {
                        return Err("CSR pattern exceeds the nonzero budget".into());
                    }
                    columns[used] = col;
                    used += 1;
                    previous = Some(col);
                }
            }
            row_offsets[row + 1] = used;
        }
        columns.truncate(used);
        columns.shrink_to_fit();
        Ok(Self {
            matrix: CsrMatrix {
                n,
                row_offsets,
                columns,
                values: vec![0.0; used],
            },
        })
    }

    pub fn add_element(&mut self, dofs: &[usize], stiffness: &[f64]) -> Result<(), String> {
        let expected = dofs
            .len()
            .checked_mul(dofs.len())
            .ok_or("CSR local stiffness dimension overflow")?;
        if dofs.is_empty()
            || stiffness.len() != expected
            || dofs.iter().any(|&d| d >= self.matrix.n)
        {
            return Err("CSR numeric element dimensions or DOFs are invalid".into());
        }
        if stiffness.iter().any(|value| !value.is_finite()) {
            return Err("CSR numeric element contains non-finite stiffness".into());
        }
        for (i, &row) in dofs.iter().enumerate() {
            let start = self.matrix.row_offsets[row];
            let end = self.matrix.row_offsets[row + 1];
            for (j, &column) in dofs.iter().enumerate() {
                let value = stiffness[i * dofs.len() + j];
                if value == 0.0 {
                    continue;
                }
                let offset = self.matrix.columns[start..end]
                    .binary_search(&column)
                    .map_err(|_| "CSR numeric element is missing a pattern entry")?;
                let entry = &mut self.matrix.values[start + offset];
                *entry += value;
                if !entry.is_finite() {
                    return Err("CSR accumulated numeric entry overflowed".into());
                }
            }
        }
        Ok(())
    }

    pub fn build(mut self) -> CsrMatrix {
        let n = self.matrix.n;
        let mut row_offsets = vec![0_usize; n + 1];
        let mut used = 0;
        for row in 0..n {
            for read in self.matrix.row_offsets[row]..self.matrix.row_offsets[row + 1] {
                if self.matrix.values[read] != 0.0 {
                    self.matrix.columns[used] = self.matrix.columns[read];
                    self.matrix.values[used] = self.matrix.values[read];
                    used += 1;
                }
            }
            row_offsets[row + 1] = used;
        }
        self.matrix.columns.truncate(used);
        self.matrix.values.truncate(used);
        self.matrix.columns.shrink_to_fit();
        self.matrix.values.shrink_to_fit();
        self.matrix.row_offsets = row_offsets;
        self.matrix
    }
}

impl CsrAssembler {
    pub fn new(n: usize) -> Result<Self, String> {
        if n == 0 || n == usize::MAX {
            return Err("CSR system size must be positive and representable".into());
        }
        Ok(Self {
            n,
            entries: Vec::new(),
        })
    }

    pub fn add(&mut self, row: usize, column: usize, value: f64) -> Result<(), String> {
        if row >= self.n || column >= self.n {
            return Err(format!(
                "CSR entry ({row}, {column}) is outside {} DOFs",
                self.n
            ));
        }
        if !value.is_finite() {
            return Err(format!("non-finite CSR entry ({row}, {column})"));
        }
        if value != 0.0 {
            self.entries.push((row, column, value));
        }
        Ok(())
    }

    /// Assemble a row-major local stiffness into global DOFs. Repeated global
    /// DOFs and contributions from adjacent elements are summed in `build`.
    pub fn add_element(&mut self, dofs: &[usize], stiffness: &[f64]) -> Result<(), String> {
        let expected = dofs
            .len()
            .checked_mul(dofs.len())
            .ok_or("CSR local stiffness dimension overflow")?;
        if stiffness.len() != expected {
            return Err(format!(
                "CSR local stiffness has {} values, expected {expected}",
                stiffness.len()
            ));
        }
        if dofs.iter().any(|&dof| dof >= self.n) {
            return Err("CSR element contains a DOF outside the system".into());
        }
        if stiffness.iter().any(|value| !value.is_finite()) {
            return Err("CSR element contains non-finite stiffness".into());
        }
        for (i, &row) in dofs.iter().enumerate() {
            for (j, &column) in dofs.iter().enumerate() {
                let value = stiffness[i * dofs.len() + j];
                if value != 0.0 {
                    self.entries.push((row, column, value));
                }
            }
        }
        Ok(())
    }

    pub fn build(mut self) -> Result<CsrMatrix, String> {
        self.entries
            .sort_unstable_by_key(|&(row, column, _)| (row, column));
        let mut row_offsets = vec![0; self.n + 1];
        let mut columns = Vec::with_capacity(self.entries.len());
        let mut values: Vec<f64> = Vec::with_capacity(self.entries.len());
        let mut current_row = 0;
        let mut previous: Option<(usize, usize)> = None;
        for (row, column, value) in self.entries {
            while current_row < row {
                row_offsets[current_row + 1] = values.len();
                current_row += 1;
            }
            if previous == Some((row, column)) {
                let last = values.last_mut().expect("duplicate has a preceding entry");
                *last += value;
                if !last.is_finite() {
                    return Err(format!(
                        "CSR accumulated entry ({row}, {column}) overflowed"
                    ));
                }
            } else {
                columns.push(column);
                values.push(value);
                previous = Some((row, column));
            }
        }
        while current_row < self.n {
            row_offsets[current_row + 1] = values.len();
            current_row += 1;
        }
        Ok(CsrMatrix {
            n: self.n,
            row_offsets,
            columns,
            values,
        })
    }
}

impl CsrMatrix {
    pub fn nnz(&self) -> usize {
        self.values.len()
    }

    pub fn mul(&self, x: &[f64]) -> Result<Vec<f64>, String> {
        if x.len() != self.n || x.iter().any(|value| !value.is_finite()) {
            return Err("CSR multiply requires a finite vector of matching length".into());
        }
        let mut product = vec![0.0; self.n];
        for (row, result) in product.iter_mut().enumerate() {
            for index in self.row_offsets[row]..self.row_offsets[row + 1] {
                *result += self.values[index] * x[self.columns[index]];
            }
            if !result.is_finite() {
                return Err(format!("non-finite CSR product at DOF {row}"));
            }
        }
        Ok(product)
    }

    /// Row-disjoint CSR multiplication. Each row retains its serial summation
    /// order, so the result is deterministic across worker counts.
    pub fn mul_parallel(&self, x: &[f64], threads: usize) -> Result<Vec<f64>, String> {
        if threads == 0 || threads > 32 {
            return Err("CSR thread count must be between 1 and 32".into());
        }
        if threads == 1 || self.n < 256 {
            return self.mul(x);
        }
        if x.len() != self.n || x.iter().any(|value| !value.is_finite()) {
            return Err("CSR multiply requires a finite vector of matching length".into());
        }
        let mut product = vec![0.0; self.n];
        let rows_per_worker = self.n.div_ceil(threads);
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for (chunk, values) in product.chunks_mut(rows_per_worker).enumerate() {
                let first_row = chunk * rows_per_worker;
                handles.push(scope.spawn(move || -> Result<(), String> {
                    for (local_row, result) in values.iter_mut().enumerate() {
                        let row = first_row + local_row;
                        for index in self.row_offsets[row]..self.row_offsets[row + 1] {
                            *result += self.values[index] * x[self.columns[index]];
                        }
                        if !result.is_finite() {
                            return Err(format!("non-finite CSR product at DOF {row}"));
                        }
                    }
                    Ok(())
                }));
            }
            for handle in handles {
                handle.join().map_err(|_| "CSR worker panicked")??;
            }
            Ok::<_, String>(())
        })?;
        Ok(product)
    }

    /// Check storage and symmetry, then return the Jacobi inverse diagonal.
    fn checked_inverse_diagonal(&self) -> Result<Vec<f64>, String> {
        if self.row_offsets.len() != self.n + 1
            || self.columns.len() != self.values.len()
            || self.row_offsets.first() != Some(&0)
            || self.row_offsets.last() != Some(&self.values.len())
        {
            return Err("invalid CSR storage offsets or array lengths".into());
        }
        for row in 0..self.n {
            let start = self.row_offsets[row];
            let end = self.row_offsets[row + 1];
            if start > end || end > self.values.len() {
                return Err(format!("invalid CSR row offsets at DOF {row}"));
            }
            let mut previous = None;
            for index in start..end {
                let col = self.columns[index];
                if col >= self.n
                    || previous.is_some_and(|p| col <= p)
                    || !self.values[index].is_finite()
                {
                    return Err(format!("invalid CSR column or value at DOF {row}"));
                }
                previous = Some(col);
            }
        }
        let mut inverse = vec![0.0; self.n];
        let mut diagonals = vec![0.0; self.n];
        for row in 0..self.n {
            let start = self.row_offsets[row];
            let end = self.row_offsets[row + 1];
            let diagonal_index = self.columns[start..end]
                .binary_search(&row)
                .map_err(|_| format!("missing diagonal at DOF {row}; singular system"))?;
            let diagonal = self.values[start + diagonal_index];
            if diagonal <= 0.0 {
                return Err(format!(
                    "non-positive diagonal at DOF {row}; singular or indefinite system"
                ));
            }
            diagonals[row] = diagonal;
            inverse[row] = 1.0 / diagonal;
            if !inverse[row].is_finite() || inverse[row] == 0.0 {
                return Err(format!("unusable Jacobi diagonal at DOF {row}"));
            }
        }
        for row in 0..self.n {
            let start = self.row_offsets[row];
            let end = self.row_offsets[row + 1];
            for index in start..end {
                let col = self.columns[index];
                let value = self.values[index];
                let reverse_row = self.row_offsets[col]..self.row_offsets[col + 1];
                let reverse = self.columns[reverse_row.clone()]
                    .binary_search(&row)
                    .ok()
                    .map(|position| self.values[reverse_row.start + position])
                    .unwrap_or(0.0);
                // Reciprocal entries may differ by roundoff after cancellation
                // of much larger element contributions. Bound that error by
                // the diagonal stiffness scale as well as the entry itself.
                let scale = diagonals[row].sqrt() * diagonals[col].sqrt();
                if !scale.is_finite() {
                    return Err(format!("unusable CSR symmetry scale at DOFs {row}, {col}"));
                }
                let tolerance =
                    (1e-11 * value.abs().max(reverse.abs())).max(64.0 * f64::EPSILON * scale);
                if (value - reverse).abs() > tolerance {
                    return Err(format!("asymmetric CSR stiffness at DOFs {row}, {col}"));
                }
            }
        }
        Ok(inverse)
    }

    pub fn solve_pcg(&self, rhs: &[f64], options: PcgOptions) -> Result<PcgResult, String> {
        self.solve_pcg_with_threads(rhs, options, 1)
    }

    pub fn solve_pcg_with_threads(
        &self,
        rhs: &[f64],
        options: PcgOptions,
        threads: usize,
    ) -> Result<PcgResult, String> {
        if threads == 0 || threads > 32 {
            return Err("CSR thread count must be between 1 and 32".into());
        }
        if rhs.len() != self.n || rhs.iter().any(|value| !value.is_finite()) {
            return Err("CSR right-hand side must be finite and match the matrix".into());
        }
        if !options.relative_tolerance.is_finite()
            || options.relative_tolerance <= 0.0
            || !options.absolute_tolerance.is_finite()
            || options.absolute_tolerance < 0.0
            || options.max_iterations == 0
        {
            return Err("invalid CSR PCG tolerances or iteration limit".into());
        }
        let inverse = self.checked_inverse_diagonal()?;
        let rhs_norm = norm(rhs);
        let target = options
            .absolute_tolerance
            .max(options.relative_tolerance * rhs_norm);
        if !rhs_norm.is_finite() || !target.is_finite() {
            return Err("non-finite CSR PCG right-hand side norm or tolerance".into());
        }
        if rhs_norm == 0.0 {
            return Ok(PcgResult {
                displacements: vec![0.0; self.n],
                iterations: 0,
                true_residual_norm: 0.0,
                relative_residual: 0.0,
            });
        }
        let mut x = vec![0.0; self.n];
        let mut residual = rhs.to_vec();
        let preconditioned: Vec<f64> = residual
            .iter()
            .zip(&inverse)
            .map(|(r, diagonal)| r * diagonal)
            .collect();
        let mut direction = preconditioned.clone();
        let mut rz = dot(&residual, &preconditioned);
        if !rz.is_finite() || rz <= 0.0 {
            return Err("invalid initial PCG residual energy".into());
        }
        for iteration in 1..=options.max_iterations {
            let product = self.mul_parallel(&direction, threads)?;
            let curvature = dot(&direction, &product);
            if !curvature.is_finite() || curvature <= 0.0 {
                return Err(format!(
                    "non-positive PCG curvature at iteration {iteration}; singular or indefinite system"
                ));
            }
            let alpha = rz / curvature;
            if !alpha.is_finite() {
                return Err(format!("non-finite PCG step at iteration {iteration}"));
            }
            for i in 0..self.n {
                x[i] += alpha * direction[i];
                residual[i] -= alpha * product[i];
            }
            let recursive_norm = norm(&residual);
            if !recursive_norm.is_finite() || x.iter().any(|value| !value.is_finite()) {
                return Err(format!("non-finite PCG state at iteration {iteration}"));
            }
            if recursive_norm <= target || iteration % 50 == 0 {
                let true_product = self.mul_parallel(&x, threads)?;
                let true_residual: Vec<f64> = rhs
                    .iter()
                    .zip(&true_product)
                    .map(|(b, ax)| b - ax)
                    .collect();
                let true_norm = norm(&true_residual);
                if !true_norm.is_finite() {
                    return Err(format!(
                        "non-finite true PCG residual at iteration {iteration}"
                    ));
                }
                if true_norm <= target {
                    return Ok(PcgResult {
                        displacements: x,
                        iterations: iteration,
                        true_residual_norm: true_norm,
                        relative_residual: true_norm / rhs_norm,
                    });
                }
                // Restart with the actual residual if recurrence drifted.
                if recursive_norm <= target || true_norm > recursive_norm * 10.0 {
                    residual = true_residual;
                    let preconditioned: Vec<f64> = residual
                        .iter()
                        .zip(&inverse)
                        .map(|(r, diagonal)| r * diagonal)
                        .collect();
                    rz = dot(&residual, &preconditioned);
                    if !rz.is_finite() || rz <= 0.0 {
                        return Err(format!("PCG restart broke down at iteration {iteration}"));
                    }
                    direction.clone_from(&preconditioned);
                    continue;
                }
            }
            let next: Vec<f64> = residual
                .iter()
                .zip(&inverse)
                .map(|(r, diagonal)| r * diagonal)
                .collect();
            let next_rz = dot(&residual, &next);
            if !next_rz.is_finite() || next_rz <= 0.0 {
                return Err(format!(
                    "PCG residual energy broke down at iteration {iteration}"
                ));
            }
            let beta = next_rz / rz;
            for i in 0..self.n {
                direction[i] = next[i] + beta * direction[i];
            }
            rz = next_rz;
        }
        let true_product = self.mul_parallel(&x, threads)?;
        let true_norm = norm(
            &rhs.iter()
                .zip(&true_product)
                .map(|(b, ax)| b - ax)
                .collect::<Vec<_>>(),
        );
        Err(format!(
            "CSR PCG did not converge in {} iterations: true residual {:.6e}, target {:.6e}",
            options.max_iterations, true_norm, target
        ))
    }

    /// Solve with specified displacements. Supports need no positive diagonal
    /// in the original matrix; only the reduced free matrix must be SPD.
    /// `reactions` is K*u - applied_load at every global DOF.
    pub fn solve_constrained(
        &self,
        applied_load: &[f64],
        prescribed: &[Option<f64>],
        options: PcgOptions,
    ) -> Result<ConstrainedResult, String> {
        self.solve_constrained_with_threads(applied_load, prescribed, options, 1)
    }

    pub fn solve_constrained_with_threads(
        &self,
        applied_load: &[f64],
        prescribed: &[Option<f64>],
        options: PcgOptions,
        threads: usize,
    ) -> Result<ConstrainedResult, String> {
        if threads == 0 || threads > 32 {
            return Err("CSR thread count must be between 1 and 32".into());
        }
        if applied_load.len() != self.n
            || prescribed.len() != self.n
            || applied_load.iter().any(|value| !value.is_finite())
            || prescribed.iter().flatten().any(|value| !value.is_finite())
        {
            return Err("CSR loads/constraints must be finite and match the matrix".into());
        }
        let mut free_position = vec![None; self.n];
        let mut free = Vec::new();
        let mut displacement: Vec<f64> = prescribed
            .iter()
            .map(|value| value.unwrap_or(0.0))
            .collect();
        for (dof, value) in prescribed.iter().enumerate() {
            if value.is_none() {
                free_position[dof] = Some(free.len());
                free.push(dof);
            }
        }
        let fixed_product = self.mul_parallel(&displacement, threads)?;
        let mut iterations = 0;
        let mut true_residual_norm = 0.0;
        if !free.is_empty() {
            // Restrict an already assembled CSR matrix directly. Rebuilding the
            // free system through triplets would duplicate the largest sparse
            // allocation just before the iterative solve.
            let mut offsets = Vec::with_capacity(free.len() + 1);
            offsets.push(0_usize);
            for &global_row in &free {
                let count = (self.row_offsets[global_row]..self.row_offsets[global_row + 1])
                    .filter(|&index| free_position[self.columns[index]].is_some())
                    .count();
                offsets.push(
                    offsets
                        .last()
                        .unwrap()
                        .checked_add(count)
                        .ok_or("reduced CSR nonzero count overflow")?,
                );
            }
            let nonzeros = *offsets.last().unwrap();
            let mut columns = Vec::with_capacity(nonzeros);
            let mut values = Vec::with_capacity(nonzeros);
            let mut rhs = Vec::with_capacity(free.len());
            for &global_row in &free {
                rhs.push(applied_load[global_row] - fixed_product[global_row]);
                for index in self.row_offsets[global_row]..self.row_offsets[global_row + 1] {
                    if let Some(reduced_col) = free_position[self.columns[index]] {
                        columns.push(reduced_col);
                        values.push(self.values[index]);
                    }
                }
            }
            let reduced = CsrMatrix {
                n: free.len(),
                row_offsets: offsets,
                columns,
                values,
            };
            let solved = reduced.solve_pcg_with_threads(&rhs, options, threads)?;
            iterations = solved.iterations;
            true_residual_norm = solved.true_residual_norm;
            for (reduced, &global) in free.iter().enumerate() {
                displacement[global] = solved.displacements[reduced];
            }
        }
        let reactions = self
            .mul_parallel(&displacement, threads)?
            .iter()
            .zip(applied_load)
            .map(|(internal, applied)| internal - applied)
            .collect();
        Ok(ConstrainedResult {
            displacements: displacement,
            reactions,
            iterations,
            true_free_residual_norm: true_residual_norm,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PcgOptions {
    pub relative_tolerance: f64,
    pub absolute_tolerance: f64,
    pub max_iterations: usize,
}

impl Default for PcgOptions {
    fn default() -> Self {
        Self {
            relative_tolerance: 1e-10,
            absolute_tolerance: 1e-12,
            max_iterations: 10_000,
        }
    }
}

#[derive(Clone, Debug)]
pub struct PcgResult {
    pub displacements: Vec<f64>,
    pub iterations: usize,
    pub true_residual_norm: f64,
    pub relative_residual: f64,
}

#[derive(Clone, Debug)]
pub struct ConstrainedResult {
    pub displacements: Vec<f64>,
    pub reactions: Vec<f64>,
    pub iterations: usize,
    pub true_free_residual_norm: f64,
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(left, right)| left * right).sum()
}

fn norm(vector: &[f64]) -> f64 {
    // A squared norm overflows for finite entries above sqrt(f64::MAX).
    // Scaling first keeps PCG's residual and convergence target meaningful.
    let mut scale = 0.0_f64;
    for value in vector {
        if !value.is_finite() {
            return f64::NAN;
        }
        scale = scale.max(value.abs());
    }
    if scale == 0.0 {
        return 0.0;
    }
    scale
        * vector
            .iter()
            .map(|value| (value / scale).powi(2))
            .sum::<f64>()
            .sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tridiagonal(n: usize, diagonal: f64) -> CsrMatrix {
        let mut builder = CsrAssembler::new(n).unwrap();
        for i in 0..n {
            builder.add(i, i, diagonal).unwrap();
            if i + 1 < n {
                builder.add(i, i + 1, -1.0).unwrap();
                builder.add(i + 1, i, -1.0).unwrap();
            }
        }
        builder.build().unwrap()
    }

    #[test]
    fn spd_matches_independent_two_by_two_solution() {
        // [4 1; 1 3] [1 2]ᵀ = [6 7]ᵀ.
        let mut builder = CsrAssembler::new(2).unwrap();
        builder.add_element(&[0, 1], &[4.0, 1.0, 1.0, 3.0]).unwrap();
        let answer = builder
            .build()
            .unwrap()
            .solve_pcg(&[6.0, 7.0], PcgOptions::default())
            .unwrap();
        assert!((answer.displacements[0] - 1.0).abs() < 1e-12);
        assert!((answer.displacements[1] - 2.0).abs() < 1e-12);
        assert!(answer.true_residual_norm < 1e-12);
    }

    #[test]
    fn high_scale_spd_matches_analytical_two_by_two_solution() {
        // K = 1e308 [1 1/2; 1/2 1], f = 1e155 [1 0].
        // The exact displacement is 1e-153 [4/3 -2/3].
        let mut builder = CsrAssembler::new(2).unwrap();
        builder
            .add_element(&[0, 1], &[1e308, 5e307, 5e307, 1e308])
            .unwrap();
        let result = builder
            .build()
            .unwrap()
            .solve_pcg(
                &[1e155, 0.0],
                PcgOptions {
                    relative_tolerance: 1e-12,
                    ..PcgOptions::default()
                },
            )
            .unwrap();
        assert!((result.displacements[0] / 1e-153 - 4.0 / 3.0).abs() < 1e-12);
        assert!((result.displacements[1] / 1e-153 + 2.0 / 3.0).abs() < 1e-12);
        assert!(result.relative_residual < 1e-12);
        assert!(result.true_residual_norm.is_finite());
    }

    #[test]
    fn duplicate_element_contributions_are_summed_in_csr() {
        let mut builder = CsrAssembler::new(3).unwrap();
        builder
            .add_element(&[0, 1], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        builder
            .add_element(&[1, 2], &[2.0, -2.0, -2.0, 2.0])
            .unwrap();
        builder.add(1, 1, 3.0).unwrap();
        let matrix = builder.build().unwrap();
        assert_eq!(matrix.row_offsets, vec![0, 2, 5, 7]);
        assert_eq!(matrix.nnz(), 7);
        assert_eq!(matrix.mul(&[1.0, 2.0, 3.0]).unwrap(), vec![-1.0, 5.0, 2.0]);
    }

    #[test]
    fn pattern_assembly_matches_triplets_with_shared_and_reordered_dofs() {
        let dofs = [[2, 0, 1], [3, 2, 1], [1, 0, 2]];
        let stiffness = [
            [4.0, -1.0, 0.5, -1.0, 3.0, -0.4, 0.5, -0.4, 2.0],
            [2.0, -0.3, 0.2, -0.3, 5.0, -0.6, 0.2, -0.6, 4.0],
            [1.0, 0.1, -0.2, 0.1, 3.0, 0.0, -0.2, 0.0, 2.0],
        ];
        let mut expected = CsrAssembler::new(4).unwrap();
        let mut streamed = CsrPatternAssembler::new(4, &dofs, 27, 16).unwrap();
        for (local_dofs, local_k) in dofs.iter().zip(&stiffness) {
            expected.add_element(local_dofs, local_k).unwrap();
            streamed.add_element(local_dofs, local_k).unwrap();
        }
        let expected = expected.build().unwrap();
        let streamed = streamed.build();
        assert_eq!(streamed.row_offsets, expected.row_offsets);
        assert_eq!(streamed.columns, expected.columns);
        assert_eq!(streamed.values, expected.values);
        assert_eq!(
            streamed.mul(&[1.0, -2.0, 3.0, 0.5]).unwrap(),
            expected.mul(&[1.0, -2.0, 3.0, 0.5]).unwrap()
        );
    }

    #[test]
    fn pattern_assembly_rejects_temporary_and_final_memory_overruns() {
        let dofs = [[0, 1], [1, 2]];
        assert!(CsrPatternAssembler::new(3, &dofs, 7, 9)
            .err()
            .unwrap()
            .contains("temporary slot budget"));
        assert!(CsrPatternAssembler::new(3, &dofs, 8, 6)
            .err()
            .unwrap()
            .contains("nonzero budget"));
    }

    #[test]
    fn node_block_pattern_matches_triplet_tet_connectivity() {
        let nodes = [[2, 0, 1, 3], [4, 3, 2, 1]];
        let mut blocks = CsrPatternAssembler::from_node_blocks3(5, &nodes, 32, 225).unwrap();
        let mut triplets = CsrAssembler::new(15).unwrap();
        for (element, local_nodes) in nodes.iter().enumerate() {
            let dofs: Vec<_> = local_nodes
                .iter()
                .flat_map(|node| (0..3).map(move |c| 3 * node + c))
                .collect();
            let local: Vec<_> = (0..144)
                .map(|index| {
                    let (row, col) = (index / 12, index % 12);
                    let value = (row + col + element + 1) as f64;
                    if row == col {
                        value * 2.0
                    } else {
                        value
                    }
                })
                .collect();
            blocks.add_element(&dofs, &local).unwrap();
            triplets.add_element(&dofs, &local).unwrap();
        }
        let expected = triplets.build().unwrap();
        let actual = blocks.build();
        assert_eq!(actual.row_offsets, expected.row_offsets);
        assert_eq!(actual.columns, expected.columns);
        assert_eq!(actual.values, expected.values);
        assert_eq!(
            actual.mul(&[1.0; 15]).unwrap(),
            expected.mul(&[1.0; 15]).unwrap()
        );
        assert!(CsrPatternAssembler::from_node_blocks3(5, &nodes, 31, 225)
            .err()
            .unwrap()
            .contains("node-slot budget"));
        assert!(CsrPatternAssembler::from_node_blocks3(5, &nodes, 32, 150)
            .err()
            .unwrap()
            .contains("nonzero budget"));
    }

    #[test]
    fn isolated_dof_is_diagnosed_even_for_zero_rhs() {
        let mut builder = CsrAssembler::new(2).unwrap();
        builder.add(0, 0, 1.0).unwrap();
        let error = builder
            .build()
            .unwrap()
            .solve_pcg(&[0.0, 0.0], PcgOptions::default())
            .unwrap_err();
        assert!(error.contains("missing diagonal at DOF 1"), "{error}");
    }

    #[test]
    fn inconsistent_singular_system_reports_breakdown() {
        let mut builder = CsrAssembler::new(2).unwrap();
        builder
            .add_element(&[0, 1], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        let error = builder
            .build()
            .unwrap()
            .solve_pcg(&[1.0, 0.0], PcgOptions::default())
            .unwrap_err();
        assert!(
            error.contains("singular") || error.contains("did not converge"),
            "{error}"
        );
    }

    #[test]
    fn asymmetry_is_rejected_before_iteration() {
        let mut builder = CsrAssembler::new(2).unwrap();
        builder.add_element(&[0, 1], &[2.0, 1.0, 0.0, 2.0]).unwrap();
        let error = builder
            .build()
            .unwrap()
            .solve_pcg(&[1.0, 1.0], PcgOptions::default())
            .unwrap_err();
        assert!(error.contains("asymmetric"), "{error}");
    }

    #[test]
    fn near_zero_cancellation_is_tolerated_but_real_asymmetry_is_rejected() {
        // A multi-cell Hex8 assembly can cancel O(1e7) element entries to
        // ~1e-9. Different summation order leaves a few ULPs of asymmetry.
        let mut roundoff = CsrAssembler::new(2).unwrap();
        roundoff.add(0, 0, 1e7).unwrap();
        roundoff.add(1, 1, 1e7).unwrap();
        roundoff.add(0, 1, -9.313_225_746_154_785e-10).unwrap();
        roundoff.add(1, 0, -4.656_612_873_077_393e-10).unwrap();
        assert!(roundoff.build().unwrap().checked_inverse_diagonal().is_ok());

        let mut asymmetric = CsrAssembler::new(2).unwrap();
        asymmetric.add(0, 0, 1e7).unwrap();
        asymmetric.add(1, 1, 1e7).unwrap();
        asymmetric.add(0, 1, 1e-5).unwrap();
        asymmetric.add(1, 0, 0.0).unwrap();
        assert!(asymmetric
            .build()
            .unwrap()
            .checked_inverse_diagonal()
            .unwrap_err()
            .contains("asymmetric"));
    }

    #[test]
    fn constrained_spring_chain_matches_hand_calculation_and_reactions() {
        // Unit springs 0--1--2, u0 = 0, u2 = 2, external F1 = 1:
        // 2*u1 - u0 - u2 = 1, hence u1 = 1.5.
        let mut builder = CsrAssembler::new(3).unwrap();
        builder
            .add_element(&[0, 1], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        builder
            .add_element(&[1, 2], &[1.0, -1.0, -1.0, 1.0])
            .unwrap();
        let solved = builder
            .build()
            .unwrap()
            .solve_constrained(
                &[0.0, 1.0, 0.0],
                &[Some(0.0), None, Some(2.0)],
                PcgOptions::default(),
            )
            .unwrap();
        assert_eq!(solved.displacements, vec![0.0, 1.5, 2.0]);
        assert_eq!(solved.reactions, vec![-1.5, 0.0, 0.5]);
        assert!(solved.true_free_residual_norm < 1e-12);
    }

    #[test]
    fn parallel_csr_constrained_solution_matches_serial_rows() {
        let n = 1_024;
        let matrix = tridiagonal(n, 3.0);
        let exact: Vec<f64> = (0..n).map(|i| 0.2 + (i % 13) as f64 * 0.01).collect();
        let rhs = matrix.mul(&exact).unwrap();
        assert_eq!(matrix.mul_parallel(&exact, 4).unwrap(), rhs);
        let mut prescribed = vec![None; n];
        prescribed[0] = Some(exact[0]);
        prescribed[n - 1] = Some(exact[n - 1]);
        let options = PcgOptions {
            relative_tolerance: 1e-12,
            ..PcgOptions::default()
        };
        let serial = matrix
            .solve_constrained(&rhs, &prescribed, options)
            .unwrap();
        let parallel = matrix
            .solve_constrained_with_threads(&rhs, &prescribed, options, 4)
            .unwrap();
        assert_eq!(parallel.displacements, serial.displacements);
        assert_eq!(parallel.reactions, serial.reactions);
        let max_error = parallel
            .displacements
            .iter()
            .zip(&exact)
            .map(|(got, want)| (got - want).abs())
            .fold(0.0_f64, f64::max);
        assert!(
            max_error < 1e-11,
            "maximum displacement error {max_error:e}"
        );
    }

    #[test]
    fn fifty_thousand_dof_scale_and_true_residual() {
        let n = 50_000;
        let matrix = tridiagonal(n, 3.0);
        assert_eq!(matrix.nnz(), 3 * n - 2);
        let expected: Vec<f64> = (0..n).map(|i| 1.0 + (i % 7) as f64 * 0.01).collect();
        let rhs = matrix.mul(&expected).unwrap();
        let result = matrix
            .solve_pcg(
                &rhs,
                PcgOptions {
                    relative_tolerance: 1e-12,
                    ..PcgOptions::default()
                },
            )
            .unwrap();
        let max_error = result
            .displacements
            .iter()
            .zip(&expected)
            .map(|(actual, expected)| (actual - expected).abs())
            .fold(0.0, f64::max);
        assert!(max_error < 1e-9, "max error {max_error}");
        assert!(result.relative_residual < 1e-10);
    }
}
