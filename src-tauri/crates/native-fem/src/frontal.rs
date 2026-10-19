//! Element-by-element symmetric frontal (wavefront) direct solver.
//!
//! Each element enters the active front in input order. A free degree of
//! freedom is eliminated immediately after its last contributing element has
//! entered; Schur complements stay in the front, and the eliminated rows are
//! retained for back substitution. No assembled global stiffness is stored.
//!
//! This solver requires a symmetric positive-definite *restrained* stiffness.
//! It rejects zero/negative pivots, asymmetric or non-finite elements, and
//! front widths beyond the caller's bound. Element ordering determines memory
//! use: the active stiffness needs O(w²) memory for front width `w`, while
//! retained elimination rows need O(nw) in the worst case. This is a direct
//! alternative for moderate fronts, not a scalable substitute for iterative
//! sparse or matrix-free methods on arbitrary million-DOF meshes.

pub const DEFAULT_MAX_ACCEPTED_RELATIVE_RESIDUAL: f64 = 1e-8;
const MAX_ITERATIVE_REFINEMENT_STEPS: usize = 3;

#[derive(Clone, Debug)]
pub struct FrontalElement {
    /// Global zero-based degree-of-freedom indices.
    pub dofs: Vec<usize>,
    /// Row-major symmetric element stiffness, dimension `dofs.len()²`.
    pub stiffness: Vec<f64>,
}

#[derive(Clone, Copy, Debug)]
pub struct FrontalOptions {
    /// Maximum number of free DOFs simultaneously present in the front.
    pub max_front_dofs: usize,
    /// Reject a pivot at or below this fraction of its assembled diagonal.
    pub relative_pivot_tolerance: f64,
}

impl Default for FrontalOptions {
    fn default() -> Self {
        Self {
            max_front_dofs: 4096,
            relative_pivot_tolerance: 1e-12,
        }
    }
}

#[derive(Clone, Debug)]
pub struct FrontalResult {
    pub displacements: Vec<f64>,
    /// `K u - f`, including reactions at prescribed DOFs.
    pub reactions: Vec<f64>,
    pub maximum_front_dofs: usize,
    pub free_dofs: usize,
    /// Infinity norm of the free residual, divided by the larger of 1 and
    /// the maximum absolute free reduced right-hand side. Solutions above
    /// Values above the configured limit are rejected before a result is returned.
    pub relative_free_residual: f64,
}

struct EliminatedRow {
    dof: usize,
    diagonal: f64,
    rhs: f64,
    neighbors: Vec<(usize, f64)>,
}

/// Solve `K u = f` with Dirichlet values, assembling element by element.
///
/// `loads.len()` defines the total number of global DOFs. Every free DOF must
/// appear in at least one element. Prescribed DOFs may be absent; their
/// reaction then equals minus their applied load.
pub fn solve(
    elements: &[FrontalElement],
    loads: &[f64],
    prescribed: &[Option<f64>],
    options: FrontalOptions,
) -> Result<FrontalResult, String> {
    solve_with_residual_limit(
        elements,
        loads,
        prescribed,
        options,
        DEFAULT_MAX_ACCEPTED_RELATIVE_RESIDUAL,
    )
}

/// Solve with an explicit maximum true free residual for a bounded caller.
/// The returned residual is still measured against the original elements.
pub fn solve_with_residual_limit(
    elements: &[FrontalElement],
    loads: &[f64],
    prescribed: &[Option<f64>],
    options: FrontalOptions,
    max_relative_residual: f64,
) -> Result<FrontalResult, String> {
    if !max_relative_residual.is_finite()
        || !(0.0..=1e-4).contains(&max_relative_residual)
        || max_relative_residual == 0.0
    {
        return Err("invalid frontal true-residual limit".into());
    }
    let n = loads.len();
    if n == 0 || prescribed.len() != n {
        return Err("frontal matrix/vector size mismatch".into());
    }
    if options.max_front_dofs == 0
        || !options.relative_pivot_tolerance.is_finite()
        || !(0.0..1.0).contains(&options.relative_pivot_tolerance)
    {
        return Err("invalid frontal options".into());
    }
    if !loads.iter().all(|v| v.is_finite()) || !prescribed.iter().flatten().all(|v| v.is_finite()) {
        return Err("non-finite frontal load or prescribed displacement".into());
    }

    let mut last = vec![None; n];
    let mut diagonal_scale = vec![0.0_f64; n];
    let mut reduced_rhs = loads.to_vec();
    for (element_index, element) in elements.iter().enumerate() {
        let width = element.dofs.len();
        if width == 0 || width.checked_mul(width) != Some(element.stiffness.len()) {
            return Err(format!(
                "invalid frontal element {element_index} dimensions"
            ));
        }
        for (a, &dof) in element.dofs.iter().enumerate() {
            if dof >= n || element.dofs[..a].contains(&dof) {
                return Err(format!(
                    "invalid or repeated DOF in frontal element {element_index}"
                ));
            }
            if prescribed[dof].is_none() {
                last[dof] = Some(element_index);
                diagonal_scale[dof] += element.stiffness[a * width + a];
            }
            for b in 0..width {
                let value = element.stiffness[a * width + b];
                let reverse = element.stiffness[b * width + a];
                if !value.is_finite() || !reverse.is_finite() {
                    return Err(format!(
                        "non-finite frontal element {element_index} stiffness"
                    ));
                }
                let scale = value.abs().max(reverse.abs()).max(f64::MIN_POSITIVE);
                if (value - reverse).abs() > 1e-10 * scale {
                    return Err(format!(
                        "asymmetric frontal element {element_index} stiffness"
                    ));
                }
                if prescribed[dof].is_none() {
                    if let Some(fixed_value) = prescribed.get(element.dofs[b]).copied().flatten() {
                        reduced_rhs[dof] -= value * fixed_value;
                    }
                }
            }
        }
    }
    let free_dofs = prescribed.iter().filter(|v| v.is_none()).count();
    if (0..n).any(|dof| prescribed[dof].is_none() && last[dof].is_none()) {
        return Err("free frontal DOF has no contributing element".into());
    }
    if diagonal_scale
        .iter()
        .enumerate()
        .any(|(dof, &value)| prescribed[dof].is_none() && (!value.is_finite() || value <= 0.0))
    {
        return Err("non-positive frontal free diagonal".into());
    }
    if reduced_rhs.iter().any(|value| !value.is_finite()) {
        return Err("non-finite frontal reduced right-hand side".into());
    }

    let mut position = vec![None; n];
    let mut active = Vec::<usize>::new();
    let mut matrix = Vec::<Vec<f64>>::new();
    let mut rhs = Vec::<f64>::new();
    let mut rows = Vec::<EliminatedRow>::with_capacity(free_dofs);
    let mut maximum_front_dofs = 0;

    for (element_index, element) in elements.iter().enumerate() {
        let width = element.dofs.len();
        for &dof in &element.dofs {
            if prescribed[dof].is_some() || position[dof].is_some() {
                continue;
            }
            if active.len() == options.max_front_dofs {
                return Err(format!(
                    "frontal wavefront exceeded maximum of {} free DOFs at element {element_index}",
                    options.max_front_dofs
                ));
            }
            let p = active.len();
            active.push(dof);
            position[dof] = Some(p);
            for row in &mut matrix {
                row.push(0.0);
            }
            matrix.push(vec![0.0; p + 1]);
            rhs.push(loads[dof]);
        }
        maximum_front_dofs = maximum_front_dofs.max(active.len());

        for (a, &row_dof) in element.dofs.iter().enumerate() {
            let Some(row) = position[row_dof] else {
                continue;
            };
            for (b, &column_dof) in element.dofs.iter().enumerate() {
                let value = element.stiffness[a * width + b];
                if let Some(column) = position[column_dof] {
                    matrix[row][column] += value;
                } else if let Some(fixed_value) = prescribed[column_dof] {
                    rhs[row] -= value * fixed_value;
                }
            }
        }

        // All elements touching these DOFs have now entered the front. They
        // cannot couple to a later DOF and are safe to eliminate at once.
        let completed: Vec<usize> = active
            .iter()
            .copied()
            .filter(|&dof| last[dof] == Some(element_index))
            .collect();
        for dof in completed {
            let pivot_index = position[dof].expect("completed DOF remains active");
            let pivot = matrix[pivot_index][pivot_index];
            if !pivot.is_finite() || pivot <= options.relative_pivot_tolerance * diagonal_scale[dof]
            {
                return Err(format!(
                    "non-positive or singular frontal pivot at DOF {dof}: {pivot}"
                ));
            }
            let pivot_rhs = rhs[pivot_index];
            let neighbors: Vec<(usize, f64)> = active
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != pivot_index)
                .map(|(index, &other)| (other, matrix[pivot_index][index]))
                .collect();
            for i in 0..active.len() {
                if i == pivot_index {
                    continue;
                }
                let coupling = matrix[i][pivot_index];
                rhs[i] -= coupling * pivot_rhs / pivot;
                for j in 0..active.len() {
                    if j != pivot_index {
                        matrix[i][j] -= coupling * matrix[pivot_index][j] / pivot;
                    }
                }
            }
            if !rhs.iter().all(|v| v.is_finite())
                || matrix
                    .iter()
                    .flat_map(|row| row.iter())
                    .any(|v| !v.is_finite())
            {
                return Err("non-finite frontal Schur complement".into());
            }
            rows.push(EliminatedRow {
                dof,
                diagonal: pivot,
                rhs: pivot_rhs,
                neighbors,
            });
            active.remove(pivot_index);
            matrix.remove(pivot_index);
            rhs.remove(pivot_index);
            for row in &mut matrix {
                row.remove(pivot_index);
            }
            position[dof] = None;
            for (index, &other) in active.iter().enumerate() {
                position[other] = Some(index);
            }
        }
    }
    if !active.is_empty() || rows.len() != free_dofs {
        return Err("frontal elimination did not finish".into());
    }

    let mut displacements: Vec<f64> = prescribed
        .iter()
        .map(|value| value.unwrap_or(0.0))
        .collect();
    for row in rows.iter().rev() {
        let coupling: f64 = row
            .neighbors
            .iter()
            .map(|&(other, value)| value * displacements[other])
            .sum();
        displacements[row.dof] = (row.rhs - coupling) / row.diagonal;
        if !displacements[row.dof].is_finite() {
            return Err("non-finite frontal displacement".into());
        }
    }

    // Scale against the *free* reduced problem. Large, unrelated support
    // reactions must not hide a poor equilibrium residual at a free DOF.
    let rhs_scale = reduced_rhs
        .iter()
        .enumerate()
        .filter(|(dof, _)| prescribed[*dof].is_none())
        .map(|(_, value)| value.abs())
        .fold(1.0_f64, f64::max);
    let mut reactions = recover_reactions(elements, loads, &displacements)?;
    let mut relative_free_residual = free_residual(&reactions, prescribed, rhs_scale);
    // Reuse the frontal factors to correct roundoff in long, slender models.
    // The residual is recomputed from the original elements after each step;
    // a correction is accepted only when it actually reduces that residual.
    for _ in 0..MAX_ITERATIVE_REFINEMENT_STEPS {
        if relative_free_residual <= max_relative_residual {
            break;
        }
        let mut correction_rhs: Vec<f64> = reactions
            .iter()
            .enumerate()
            .map(|(dof, &reaction)| {
                if prescribed[dof].is_none() {
                    -reaction
                } else {
                    0.0
                }
            })
            .collect();
        for row in &rows {
            let pivot_rhs = correction_rhs[row.dof];
            for &(neighbor, coupling) in &row.neighbors {
                correction_rhs[neighbor] -= coupling * pivot_rhs / row.diagonal;
            }
        }
        let mut correction = vec![0.0; n];
        for row in rows.iter().rev() {
            let coupling: f64 = row
                .neighbors
                .iter()
                .map(|&(neighbor, value)| value * correction[neighbor])
                .sum();
            correction[row.dof] = (correction_rhs[row.dof] - coupling) / row.diagonal;
        }
        if correction.iter().any(|value| !value.is_finite()) {
            return Err("non-finite frontal iterative correction".into());
        }
        let mut candidate = displacements.clone();
        for (value, delta) in candidate.iter_mut().zip(correction) {
            *value += delta;
        }
        let candidate_reactions = recover_reactions(elements, loads, &candidate)?;
        let candidate_residual = free_residual(&candidate_reactions, prescribed, rhs_scale);
        if !candidate_residual.is_finite() || candidate_residual >= relative_free_residual {
            break;
        }
        displacements = candidate;
        reactions = candidate_reactions;
        relative_free_residual = candidate_residual;
    }
    if !relative_free_residual.is_finite() || relative_free_residual > max_relative_residual {
        return Err(format!(
            "frontal true free residual {relative_free_residual:.3e} exceeds {max_relative_residual:.1e}"
        ));
    }

    Ok(FrontalResult {
        displacements,
        reactions,
        maximum_front_dofs,
        free_dofs,
        relative_free_residual,
    })
}

fn recover_reactions(
    elements: &[FrontalElement],
    loads: &[f64],
    displacements: &[f64],
) -> Result<Vec<f64>, String> {
    let mut reactions: Vec<f64> = loads.iter().map(|&value| -value).collect();
    // Adjacent short beam elements can contribute large opposing forces at
    // the same DOF. Preserve their small true imbalance during accumulation.
    let mut reaction_compensation = vec![0.0; loads.len()];
    for element in elements {
        let width = element.dofs.len();
        for (a, &row_dof) in element.dofs.iter().enumerate() {
            let mut internal = 0.0;
            let mut local_compensation = 0.0;
            for (b, &column_dof) in element.dofs.iter().enumerate() {
                let contribution = element.stiffness[a * width + b] * displacements[column_dof];
                let corrected = contribution - local_compensation;
                let next = internal + corrected;
                local_compensation = (next - internal) - corrected;
                internal = next;
            }
            let corrected = internal - reaction_compensation[row_dof];
            let next = reactions[row_dof] + corrected;
            reaction_compensation[row_dof] = (next - reactions[row_dof]) - corrected;
            reactions[row_dof] = next;
        }
    }
    if reactions.iter().any(|value| !value.is_finite()) {
        return Err("non-finite frontal reaction or internal force".into());
    }
    Ok(reactions)
}

fn free_residual(reactions: &[f64], prescribed: &[Option<f64>], rhs_scale: f64) -> f64 {
    reactions
        .iter()
        .enumerate()
        .filter(|(dof, _)| prescribed[*dof].is_none())
        .map(|(_, value)| value.abs())
        .fold(0.0_f64, f64::max)
        / rhs_scale
}

#[cfg(test)]
mod tests {
    use super::{solve, solve_with_residual_limit, FrontalElement, FrontalOptions};

    fn spring(a: usize, b: usize, stiffness: f64) -> FrontalElement {
        FrontalElement {
            dofs: vec![a, b],
            stiffness: vec![stiffness, -stiffness, -stiffness, stiffness],
        }
    }

    #[test]
    fn spring_chain_matches_independent_series_solution_and_reactions() {
        let elements = vec![spring(0, 1, 10.0), spring(1, 2, 20.0)];
        let result = solve(
            &elements,
            &[0.0, 0.0, 10.0],
            &[Some(0.0), None, None],
            FrontalOptions::default(),
        )
        .unwrap();
        assert!((result.displacements[1] - 1.0).abs() < 1e-12);
        assert!((result.displacements[2] - 1.5).abs() < 1e-12);
        assert!((result.reactions[0] + 10.0).abs() < 1e-12);
        assert!(result.relative_free_residual < 1e-12);
        assert_eq!(result.maximum_front_dofs, 2);
    }

    #[test]
    fn caller_residual_limit_is_bounded_and_true_residual_is_reported() {
        let elements = vec![spring(0, 1, 10.0), spring(1, 2, 20.0)];
        let loads = [0.0, 0.0, 10.0];
        let prescribed = [Some(0.0), None, None];
        let accepted = solve_with_residual_limit(
            &elements,
            &loads,
            &prescribed,
            FrontalOptions::default(),
            1e-6,
        )
        .unwrap();
        assert!(accepted.relative_free_residual < 1e-12);
        assert!((accepted.displacements[2] - 1.5).abs() < 1e-12);
        assert!(solve_with_residual_limit(
            &elements,
            &loads,
            &prescribed,
            FrontalOptions::default(),
            1e-3,
        )
        .is_err());
    }

    #[test]
    fn prescribed_displacement_and_load_shift_rhs() {
        let elements = vec![spring(0, 1, 8.0), spring(1, 2, 4.0)];
        let result = solve(
            &elements,
            &[0.0, 2.0, 0.0],
            &[Some(1.0), None, Some(0.0)],
            FrontalOptions::default(),
        )
        .unwrap();
        // 8(u1-1) + 4u1 = 2.
        assert!((result.displacements[1] - 10.0 / 12.0).abs() < 1e-12);
        assert!(result.relative_free_residual < 1e-12);
    }

    #[test]
    fn two_overlapping_elements_recover_independent_three_by_three_solution() {
        // The assembled K is [[4,1,0],[1,3,1],[0,1,2]].
        // Multiplication by x=[1,2,3] gives the independently specified f.
        let elements = vec![
            FrontalElement {
                dofs: vec![0, 1],
                stiffness: vec![4.0, 1.0, 1.0, 2.0],
            },
            FrontalElement {
                dofs: vec![1, 2],
                stiffness: vec![1.0, 1.0, 1.0, 2.0],
            },
        ];
        let result = solve(
            &elements,
            &[6.0, 10.0, 8.0],
            &[None; 3],
            FrontalOptions::default(),
        )
        .unwrap();
        for (computed, expected) in result.displacements.iter().zip([1.0, 2.0, 3.0]) {
            assert!((computed - expected).abs() < 1e-12);
        }
        assert!(result.relative_free_residual < 1e-12);
    }

    #[test]
    fn element_order_controls_front_width_and_limit() {
        let contiguous = vec![spring(0, 1, 10.0), spring(1, 2, 10.0), spring(2, 3, 10.0)];
        let spread = vec![spring(0, 1, 10.0), spring(2, 3, 10.0), spring(1, 2, 10.0)];
        let loads = [0.0, 0.0, 0.0, 1.0];
        let fixed = [Some(0.0), None, None, None];
        let a = solve(&contiguous, &loads, &fixed, FrontalOptions::default()).unwrap();
        let b = solve(&spread, &loads, &fixed, FrontalOptions::default()).unwrap();
        assert_eq!(a.maximum_front_dofs, 2);
        assert_eq!(b.maximum_front_dofs, 3);
        for (&ua, &ub) in a.displacements.iter().zip(&b.displacements) {
            assert!((ua - ub).abs() < 1e-12);
        }
        let err = solve(
            &spread,
            &loads,
            &fixed,
            FrontalOptions {
                max_front_dofs: 2,
                ..FrontalOptions::default()
            },
        )
        .unwrap_err();
        assert!(err.contains("wavefront exceeded"));
    }

    #[test]
    fn detects_unrestrained_rigid_mode() {
        let err = solve(
            &[spring(0, 1, 1.0)],
            &[0.0, 1.0],
            &[None, None],
            FrontalOptions::default(),
        )
        .unwrap_err();
        assert!(err.contains("singular frontal pivot"));
    }

    #[test]
    fn unloaded_unrestrained_mode_is_rejected_before_any_residual_check() {
        let err = solve(
            &[spring(0, 1, 1.0)],
            &[0.0, 0.0],
            &[None, None],
            FrontalOptions::default(),
        )
        .unwrap_err();
        assert!(err.contains("singular frontal pivot"), "{err}");
    }

    #[test]
    fn ill_conditioned_spd_factor_cannot_report_false_success() {
        // Hilbert-9 is SPD and passes the pivot threshold, but ordinary f64
        // elimination leaves a free residual well above 1e-8 for this load.
        let n = 9;
        let stiffness: Vec<f64> = (0..n)
            .flat_map(|i| (0..n).map(move |j| 1.0 / (i + j + 1) as f64))
            .collect();
        let loads: Vec<f64> = (0..n).map(|i| (i % 3) as f64 / 10.0 + 0.1).collect();
        let err = solve(
            &[FrontalElement {
                dofs: (0..n).collect(),
                stiffness,
            }],
            &loads,
            &vec![None; n],
            FrontalOptions::default(),
        )
        .unwrap_err();
        assert!(err.contains("true free residual"), "{err}");
    }

    #[test]
    fn unrelated_large_support_reaction_cannot_mask_free_residual() {
        let n = 5;
        let free_element = FrontalElement {
            dofs: (0..n).collect(),
            stiffness: (0..n)
                .flat_map(|i| (0..n).map(move |j| 1.0 / (i + j + 1) as f64))
                .collect(),
        };
        let free_loads: Vec<f64> = (0..n).map(|i| (i % 3) as f64 / 10.0 + 0.1).collect();
        let reference = solve(
            &[free_element.clone()],
            &free_loads,
            &vec![None; n],
            FrontalOptions::default(),
        )
        .unwrap();
        let mut loads = free_loads;
        loads.push(0.0);
        let combined = solve(
            &[
                free_element,
                FrontalElement {
                    dofs: vec![5],
                    stiffness: vec![1e12],
                },
            ],
            &loads,
            &[None, None, None, None, None, Some(1e3)],
            FrontalOptions::default(),
        )
        .unwrap();
        assert!(reference.relative_free_residual > 1e-14);
        assert_eq!(
            combined.relative_free_residual,
            reference.relative_free_residual
        );
        assert!(combined.reactions[5] > 1e14);
    }

    #[test]
    fn rejects_asymmetric_or_nonfinite_element() {
        let mut element = spring(0, 1, 1.0);
        element.stiffness[1] = -2.0;
        assert!(solve(
            &[element],
            &[0.0, 1.0],
            &[Some(0.0), None],
            FrontalOptions::default()
        )
        .unwrap_err()
        .contains("asymmetric"));
    }
}
