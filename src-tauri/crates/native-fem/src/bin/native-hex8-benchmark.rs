//! Run with `cargo run --release -p openaec-native-fem --bin native-hex8-benchmark`
//! or pass a path to another GridBenchmark JSON file. `--typed [config.json]`
//! exercises the full typed volumeHex8 request without printing its large
//! per-node and per-Gauss-point response.

use std::time::Instant;

use openaec_native_fem::hex8_matrix_free::{run_grid_benchmark, GridBenchmark, Mesh};
use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8VolumeCell, Hex8VolumeLoad, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

fn node_index(i: usize, j: usize, k: usize, nx: usize, ny: usize) -> usize {
    (k * (ny + 1) + j) * (nx + 1) + i
}

fn typed_benchmark(
    request: GridBenchmark,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let started = Instant::now();
    let [nx, ny, nz] = request.cells;
    let mesh = Mesh::structured(request.cells)?;
    let mut loads = vec![[0.0; 3]; mesh.nodes.len()];
    let expected_force_kn = request.e_mpa * 0.001 * 1_000.0;
    let face_node_force = expected_force_kn / (4.0 * ny as f64 * nz as f64);
    for k in 0..nz {
        for j in 0..ny {
            for (jj, kk) in [(j, k), (j + 1, k), (j + 1, k + 1), (j, k + 1)] {
                loads[node_index(nx, jj, kk, nx, ny)][0] += face_node_force;
            }
        }
    }
    let mut supports = Vec::with_capacity((ny + 1) * (nz + 1));
    for k in 0..=nz {
        for j in 0..=ny {
            let mut displacement_m = [Some(0.0), None, None];
            if j == 0 && k == 0 {
                displacement_m[1] = Some(0.0);
                displacement_m[2] = Some(0.0);
            } else if j == ny && k == 0 {
                displacement_m[2] = Some(0.0);
            }
            supports.push(Hex8VolumeSupport {
                node: node_index(0, j, k, nx, ny),
                displacement_m,
            });
        }
    }
    let right_face_force_kn: f64 = loads.iter().map(|force| force[0]).sum();
    let input = Hex8VolumeRequest {
        nodes: mesh.nodes,
        materials: vec![Hex8VolumeMaterial {
            e_mpa: request.e_mpa,
            poisson: request.poisson,
        }],
        elements: mesh
            .hexes
            .into_iter()
            .map(|nodes| Hex8VolumeCell { nodes, material: 0 })
            .collect(),
        loads: loads
            .into_iter()
            .enumerate()
            .filter(|(_, force)| force.iter().any(|value| *value != 0.0))
            .map(|(node, force_kn)| Hex8VolumeLoad { node, force_kn })
            .collect(),
        body_forces: vec![],
        face_tractions: vec![],
        supports,
        tolerance: request.tolerance,
        max_iterations: request.max_iterations,
        structured_grid_cells: Some(request.cells),
        threads: request.threads,
        linear_backend: Default::default(),
    };
    let elements = input.elements.len();
    let nodes = input.nodes.len();
    let solve_started = Instant::now();
    let result = solve_hex8_volume(input)?;
    let solve_seconds = solve_started.elapsed().as_secs_f64();
    let max_displacement_error_m = result
        .nodal_displacements_m
        .iter()
        .enumerate()
        .flat_map(|(node, displacement)| {
            let x = (node % (nx + 1)) as f64 / nx as f64;
            let y = (node / (nx + 1) % (ny + 1)) as f64 / ny as f64;
            let z = (node / ((nx + 1) * (ny + 1))) as f64 / nz as f64;
            [
                (displacement[0] - 0.001 * x).abs(),
                (displacement[1] + request.poisson * 0.001 * y).abs(),
                (displacement[2] + request.poisson * 0.001 * z).abs(),
            ]
        })
        .fold(0.0, f64::max);
    let mut left_face_reaction_kn = 0.0;
    for k in 0..=nz {
        for j in 0..=ny {
            left_face_reaction_kn += result.nodal_reactions_kn[node_index(0, j, k, nx, ny)][0];
        }
    }
    let expected_stress_mpa = request.e_mpa * 0.001;
    let max_stress_error_mpa = result
        .element_gauss_stress_mpa
        .iter()
        .flatten()
        .map(|stress| {
            (stress[0] - expected_stress_mpa).abs().max(
                stress[1..]
                    .iter()
                    .copied()
                    .map(f64::abs)
                    .fold(0.0, f64::max),
            )
        })
        .fold(0.0, f64::max);
    Ok(serde_json::json!({
        "nodes": nodes,
        "elements": elements,
        "dofs": 3 * nodes,
        "threads": request.threads,
        "iterations": result.iterations,
        "relativeResidual": result.relative_residual,
        "csrNonzeros": result.csr_nonzeros,
        "maxDisplacementErrorM": max_displacement_error_m,
        "maxStressErrorMpa": max_stress_error_mpa,
        "rightFaceForceKn": right_face_force_kn,
        "leftFaceReactionKn": left_face_reaction_kn,
        "expectedForceKn": expected_force_kn,
        "solveSeconds": solve_seconds,
        "elapsedSeconds": started.elapsed().as_secs_f64(),
    }))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let typed = matches!(args.next().as_deref(), Some("--typed"));
    let path = if typed {
        args.next()
    } else {
        std::env::args().nth(1)
    };
    let input = if let Some(path) = path {
        std::fs::read_to_string(path)?
    } else {
        include_str!("../../examples/hex8-250k.json").to_owned()
    };
    let request: GridBenchmark = serde_json::from_str(&input)?;
    if typed {
        println!(
            "{}",
            serde_json::to_string_pretty(&typed_benchmark(request)?)?
        );
        return Ok(());
    }
    let started = Instant::now();
    let result = run_grid_benchmark(request)?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "result": result,
            "elapsedSeconds": started.elapsed().as_secs_f64(),
        }))?
    );
    Ok(())
}
