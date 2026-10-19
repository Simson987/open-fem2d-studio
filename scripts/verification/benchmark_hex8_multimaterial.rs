//! Reproducible large, heterogeneous Hex8 continuum benchmark.
//!
//! A 2 x 3 x 4 m layered solid has E = 30 and 24 GPa in alternating
//! x-directed cell layers (both with nu = 0.25). A consistent uniform
//! 1 MPa traction acts on x = 2 m. The opposite face has ux = 0, with
//! three additional constraints removing the remaining rigid modes.
//! There is no closed-form displacement field for the elastic interface;
//! verification uses the independently reapplied K*u, global force and
//! moment equilibrium, and one versus four worker agreement.

use std::time::Instant;

use openaec_native_fem::hex8_matrix_free::{Mesh, Operator, Solution};

const LENGTHS: [f64; 3] = [2.0, 3.0, 4.0];
const MATERIALS: [(f64, f64); 2] = [(30_000.0, 0.25), (24_000.0, 0.25)];
const TRACTION_MPA: f64 = 1.0;
const TOLERANCE: f64 = 1e-9;
const MAX_ITERATIONS: usize = 4_000;

fn node(i: usize, j: usize, k: usize, n: usize) -> usize {
    (k * (n + 1) + j) * (n + 1) + i
}

fn norm(values: impl IntoIterator<Item = f64>) -> f64 {
    values
        .into_iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt()
}

struct Check {
    true_relative_residual: f64,
    force_balance_relative: f64,
    moment_balance_relative: f64,
    left_face_reaction_kn: f64,
}

fn check(
    operator: &Operator,
    result: &Solution,
    loads: &[f64],
    prescribed: &[(usize, f64)],
    total_force_kn: f64,
) -> Result<Check, Box<dyn std::error::Error>> {
    let mut fixed = vec![false; operator.dofs()];
    for &(dof, _) in prescribed {
        fixed[dof] = true;
    }
    let ku = operator.apply(&result.displacements, 1)?;
    let free_residual = norm(
        ku.iter()
            .zip(loads)
            .zip(&fixed)
            .filter(|(_, is_fixed)| !**is_fixed)
            .map(|((internal, external), _)| internal - external),
    );
    let rhs_norm = norm(
        loads
            .iter()
            .zip(&fixed)
            .filter(|(_, is_fixed)| !**is_fixed)
            .map(|(load, _)| *load),
    );
    let mut force = [0.0; 3];
    let mut moment = [0.0; 3];
    let mut left_face_reaction_kn = 0.0;
    for (id, position) in operator.mesh.nodes.iter().enumerate() {
        let net = std::array::from_fn::<f64, 3, _>(|axis| {
            if fixed[3 * id + axis] {
                ku[3 * id + axis] - loads[3 * id + axis]
            } else {
                0.0
            }
        });
        for axis in 0..3 {
            force[axis] += net[axis] + loads[3 * id + axis];
        }
        moment[0] +=
            position[1] * (net[2] + loads[3 * id + 2]) - position[2] * (net[1] + loads[3 * id + 1]);
        moment[1] +=
            position[2] * (net[0] + loads[3 * id]) - position[0] * (net[2] + loads[3 * id + 2]);
        moment[2] +=
            position[0] * (net[1] + loads[3 * id + 1]) - position[1] * (net[0] + loads[3 * id]);
        if position[0] == 0.0 {
            left_face_reaction_kn += net[0];
        }
    }
    // Applied face traction has a nonzero moment about the origin. The
    // characteristic 4 m lever arm normalizes each global moment residual.
    Ok(Check {
        true_relative_residual: free_residual / rhs_norm.max(1.0),
        force_balance_relative: norm(force) / total_force_kn,
        moment_balance_relative: norm(moment) / (total_force_kn * LENGTHS[2]),
        left_face_reaction_kn,
    })
}

fn run(n: usize) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let mesh = Mesh::structured_box([n; 3], LENGTHS)?;
    let material_indices = (0..n)
        .flat_map(|_| (0..n).flat_map(|_| (0..n).map(|i| i % 2)))
        .collect::<Vec<_>>();
    let counts = [
        material_indices.iter().filter(|&&m| m == 0).count(),
        material_indices.iter().filter(|&&m| m == 1).count(),
    ];
    let operator = Operator::new_with_materials(mesh, &MATERIALS, material_indices)?;
    let total_force_kn = TRACTION_MPA * LENGTHS[1] * LENGTHS[2] * 1_000.0;
    let face_corner_force_kn = total_force_kn / (4 * n * n) as f64;
    let mut loads = vec![0.0; operator.dofs()];
    for k in 0..n {
        for j in 0..n {
            for (jj, kk) in [(j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1)] {
                loads[3 * node(n, jj, kk, n)] += face_corner_force_kn;
            }
        }
    }
    let mut prescribed = Vec::with_capacity((n + 1) * (n + 1) + 3);
    for k in 0..=n {
        for j in 0..=n {
            prescribed.push((3 * node(0, j, k, n), 0.0));
        }
    }
    prescribed.push((3 * node(0, 0, 0, n) + 1, 0.0));
    prescribed.push((3 * node(0, 0, 0, n) + 2, 0.0));
    prescribed.push((3 * node(0, n, 0, n) + 2, 0.0));

    let four_started = Instant::now();
    let four = operator.solve(&loads, &prescribed, 4, TOLERANCE, MAX_ITERATIONS)?;
    let four_seconds = four_started.elapsed().as_secs_f64();
    let four_check = check(&operator, &four, &loads, &prescribed, total_force_kn)?;

    let one_started = Instant::now();
    let one = operator.solve(&loads, &prescribed, 1, TOLERANCE, MAX_ITERATIONS)?;
    let one_seconds = one_started.elapsed().as_secs_f64();
    let one_check = check(&operator, &one, &loads, &prescribed, total_force_kn)?;
    let max_displacement_difference_m = four
        .displacements
        .iter()
        .zip(&one.displacements)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f64::max);
    let max_reaction_difference_kn = four
        .reactions
        .iter()
        .zip(&one.reactions)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f64::max);
    let summary = serde_json::json!({
        "cells": [n,n,n],
        "lengthsM": LENGTHS,
        "elements": operator.mesh.hexes.len(),
        "nodes": operator.mesh.nodes.len(),
        "dofs": operator.dofs(),
        "materials": MATERIALS,
        "materialElementCounts": counts,
        "tractionMpa": TRACTION_MPA,
        "appliedForceKn": total_force_kn,
        "fourThreads": {
            "iterations": four.iterations,
            "reportedRelativeResidual": four.relative_residual,
            "independentTrueRelativeResidual": four_check.true_relative_residual,
            "forceBalanceRelative": four_check.force_balance_relative,
            "momentBalanceRelative": four_check.moment_balance_relative,
            "leftFaceReactionKn": four_check.left_face_reaction_kn,
            "solveSeconds": four_seconds,
        },
        "oneThread": {
            "iterations": one.iterations,
            "reportedRelativeResidual": one.relative_residual,
            "independentTrueRelativeResidual": one_check.true_relative_residual,
            "forceBalanceRelative": one_check.force_balance_relative,
            "momentBalanceRelative": one_check.moment_balance_relative,
            "leftFaceReactionKn": one_check.left_face_reaction_kn,
            "solveSeconds": one_seconds,
        },
        "oneVsFourMaxDisplacementDifferenceM": max_displacement_difference_m,
        "oneVsFourMaxReactionDifferenceKn": max_reaction_difference_kn,
        "elapsedSeconds": started.elapsed().as_secs_f64(),
    });
    println!("{}", serde_json::to_string_pretty(&summary)?);
    if four_check.true_relative_residual > 5.0 * TOLERANCE
        || one_check.true_relative_residual > 5.0 * TOLERANCE
        || four_check.force_balance_relative > 1e-8
        || one_check.force_balance_relative > 1e-8
        || four_check.moment_balance_relative > 1e-8
        || one_check.moment_balance_relative > 1e-8
        || max_displacement_difference_m > 1e-7
        || max_reaction_difference_kn / total_force_kn > 1e-6
    {
        return Err("heterogeneous Hex8 continuum benchmark failed".into());
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n = std::env::args()
        .nth(1)
        .map(|value| value.parse::<usize>())
        .transpose()?
        .unwrap_or(63);
    if n < 2 {
        return Err("cells per axis must be at least two".into());
    }
    run(n)
}
