//! Independent continuum patch test of the full typed Hex8 matrix-free route.
//!
//! A homogeneous box [2, 3, 4] m carries uniform x traction, represented
//! by consistent nodal loads on x = 2 m. The exact three-dimensional solution
//! is u = (eps*x, -nu*eps*y, -nu*eps*z), sigma_xx = E*eps, and all other
//! stresses zero. The restrained x-face reaction is -sigma_xx*Ly*Lz*1000 kN.
//! This verifies the typed request, 4-thread solve, every displacement and
//! every Gauss-point stress, and global force equilibrium at scale.

use std::time::Instant;

use openaec_native_fem::hex8_matrix_free::Mesh;
use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8VolumeCell, Hex8VolumeLoad, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

const LENGTHS: [f64; 3] = [2.0, 3.0, 4.0];
const E_MPA: f64 = 30_000.0;
const POISSON: f64 = 0.25;
const EPSILON: f64 = 0.001;
const THREADS: usize = 4;

fn node(i: usize, j: usize, k: usize, n: usize) -> usize {
    (k * (n + 1) + j) * (n + 1) + i
}

fn run(n: usize) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    let mesh = Mesh::structured_box([n; 3], LENGTHS)?;
    let area = LENGTHS[1] * LENGTHS[2];
    let stress = E_MPA * EPSILON;
    let total_force_kn = stress * area * 1_000.0;
    let force_per_face_corner = total_force_kn / (4 * n * n) as f64;
    let mut nodal_loads = vec![0.0; mesh.nodes.len()];
    for k in 0..n {
        for j in 0..n {
            for (jj, kk) in [(j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1)] {
                nodal_loads[node(n, jj, kk, n)] += force_per_face_corner;
            }
        }
    }
    let loads = nodal_loads
        .iter()
        .enumerate()
        .filter(|(_, force)| **force != 0.0)
        .map(|(node, force)| Hex8VolumeLoad {
            node,
            force_kn: [*force, 0.0, 0.0],
        })
        .collect();
    let mut supports = Vec::with_capacity((n + 1) * (n + 1));
    for k in 0..=n {
        for j in 0..=n {
            let mut displacement_m = [Some(0.0), None, None];
            if j == 0 && k == 0 {
                displacement_m[1] = Some(0.0);
                displacement_m[2] = Some(0.0);
            } else if j == n && k == 0 {
                displacement_m[2] = Some(0.0);
            }
            supports.push(Hex8VolumeSupport {
                node: node(0, j, k, n),
                displacement_m,
            });
        }
    }
    let request = Hex8VolumeRequest {
        nodes: mesh.nodes,
        materials: vec![Hex8VolumeMaterial {
            e_mpa: E_MPA,
            poisson: POISSON,
        }],
        elements: mesh
            .hexes
            .into_iter()
            .map(|nodes| Hex8VolumeCell { nodes, material: 0 })
            .collect(),
        loads,
        body_forces: vec![],
        face_tractions: vec![],
        supports,
        tolerance: 1e-9,
        max_iterations: 3_000,
        structured_grid_cells: Some([n; 3]),
        threads: THREADS,
    };
    let elements = request.elements.len();
    let nodes = request.nodes.len();
    let right_face_force_kn: f64 = nodal_loads.iter().sum();
    let solve_started = Instant::now();
    let result = solve_hex8_volume(request)?;
    let solve_seconds = solve_started.elapsed().as_secs_f64();

    let max_displacement_error_m = result
        .nodal_displacements_m
        .iter()
        .enumerate()
        .flat_map(|(id, value)| {
            let i = id % (n + 1);
            let j = id / (n + 1) % (n + 1);
            let k = id / ((n + 1) * (n + 1));
            let x = i as f64 / n as f64 * LENGTHS[0];
            let y = j as f64 / n as f64 * LENGTHS[1];
            let z = k as f64 / n as f64 * LENGTHS[2];
            [
                (value[0] - EPSILON * x).abs(),
                (value[1] + POISSON * EPSILON * y).abs(),
                (value[2] + POISSON * EPSILON * z).abs(),
            ]
        })
        .fold(0.0, f64::max);
    let max_stress_error_mpa = result
        .element_gauss_stress_mpa
        .iter()
        .flatten()
        .map(|sigma| {
            (sigma[0] - stress)
                .abs()
                .max(sigma[1..].iter().copied().map(f64::abs).fold(0.0, f64::max))
        })
        .fold(0.0, f64::max);
    let left_face_reaction_kn: f64 = (0..=n)
        .flat_map(|k| (0..=n).map(move |j| node(0, j, k, n)))
        .map(|id| result.nodal_reactions_kn[id][0])
        .sum();
    let force_balance_relative =
        (left_face_reaction_kn + right_face_force_kn).abs() / total_force_kn;

    let summary = serde_json::json!({
        "cells": [n, n, n],
        "lengthsM": LENGTHS,
        "nodes": nodes,
        "elements": elements,
        "dofs": nodes * 3,
        "threads": THREADS,
        "iterations": result.iterations,
        "relativeResidual": result.relative_residual,
        "csrNonzeros": result.csr_nonzeros,
        "maxDisplacementErrorM": max_displacement_error_m,
        "maxStressErrorMpa": max_stress_error_mpa,
        "rightFaceForceKn": right_face_force_kn,
        "leftFaceReactionKn": left_face_reaction_kn,
        "expectedForceKn": total_force_kn,
        "forceBalanceRelative": force_balance_relative,
        "solveSeconds": solve_seconds,
        "elapsedSeconds": started.elapsed().as_secs_f64(),
    });
    println!("{}", serde_json::to_string_pretty(&summary)?);
    if result.csr_nonzeros != 0
        || max_displacement_error_m > 1e-8
        || max_stress_error_mpa > 1e-2
        || force_balance_relative > 1e-8
        || result.relative_residual > 1e-9
    {
        return Err("rectangular Hex8 continuum patch check failed".into());
    }
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let n = std::env::args()
        .nth(1)
        .map(|value| value.parse::<usize>())
        .transpose()?
        .unwrap_or(63);
    if n == 0 {
        return Err("cells per axis must be positive".into());
    }
    run(n)
}
