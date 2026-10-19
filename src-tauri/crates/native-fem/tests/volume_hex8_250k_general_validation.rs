//! Explicit release acceptance probe for the general Hex8 matrix-free route:
//! `cargo test --release -p openaec-native-fem --test volume_hex8_250k_general_validation -- --ignored --nocapture`
//!
//! The 63³ cells have distorted, extruded cross-sections and three material
//! moduli in x layers. Their connectivity is still structured. This checks a
//! large heterogeneous geometry, not arbitrary-topology throughput.

use std::time::Instant;

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

const N: usize = 63;
const END_U_M: f64 = 0.001;
const E_MPA: [f64; 3] = [30_000.0, 47_000.0, 24_000.0];

fn node(i: usize, j: usize, k: usize) -> usize {
    (k * (N + 1) + j) * (N + 1) + i
}

fn x(i: usize) -> f64 {
    let t = i as f64 / N as f64;
    t * (0.92 + 0.08 * t)
}

fn exact_series_solution() -> (f64, [f64; N + 1]) {
    // A unit-area bar in series has compliance Σ(dx/E). With ν = 0,
    // piecewise affine ux and zero transverse displacement solve elasticity
    // exactly on each extruded layer, independent of the interior yz warp.
    let compliance: f64 = (0..N).map(|i| (x(i + 1) - x(i)) / E_MPA[i % 3]).sum();
    let stress = END_U_M / compliance;
    let mut ux = [0.0; N + 1];
    for i in 0..N {
        ux[i + 1] = ux[i] + stress * (x(i + 1) - x(i)) / E_MPA[i % 3];
    }
    (stress, ux)
}

fn peak_rss_kib() -> Option<usize> {
    std::fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

fn model() -> Hex8VolumeRequest {
    let mut nodes = Vec::with_capacity((N + 1).pow(3));
    let mut supports = Vec::with_capacity(2 * (N + 1).pow(2));
    for k in 0..=N {
        for j in 0..=N {
            for i in 0..=N {
                let y = j as f64 / N as f64;
                let z = k as f64 / N as f64;
                let interior = (std::f64::consts::PI * y).sin() * (std::f64::consts::PI * z).sin();
                nodes.push([
                    x(i),
                    y + 0.006 * interior * (2.0 * std::f64::consts::PI * z).sin(),
                    z + 0.006 * interior * (2.0 * std::f64::consts::PI * y).sin(),
                ]);
                if i == 0 {
                    supports.push(Hex8VolumeSupport {
                        node: node(i, j, k),
                        displacement_m: [Some(0.0); 3],
                    });
                } else if i == N {
                    supports.push(Hex8VolumeSupport {
                        node: node(i, j, k),
                        displacement_m: [Some(END_U_M), None, None],
                    });
                }
            }
        }
    }

    let mut elements = Vec::with_capacity(N.pow(3));
    for k in 0..N {
        for j in 0..N {
            for i in 0..N {
                elements.push(Hex8VolumeCell {
                    nodes: [
                        node(i, j, k),
                        node(i + 1, j, k),
                        node(i + 1, j + 1, k),
                        node(i, j + 1, k),
                        node(i, j, k + 1),
                        node(i + 1, j, k + 1),
                        node(i + 1, j + 1, k + 1),
                        node(i, j + 1, k + 1),
                    ],
                    material: i % 3,
                });
            }
        }
    }

    Hex8VolumeRequest {
        nodes,
        materials: E_MPA
            .map(|e_mpa| Hex8VolumeMaterial {
                e_mpa,
                poisson: 0.0,
            })
            .into(),
        elements,
        loads: Vec::new(),
        body_forces: Vec::new(),
        face_tractions: Vec::new(),
        supports,
        tolerance: 1e-7,
        max_iterations: 1_000,
        structured_grid_cells: None,
        threads: 4,
        linear_backend: Hex8LinearBackend::MatrixFreeGeneralLarge,
    }
}

#[test]
#[ignore = "250,047 general Hex8 cells; run explicitly in release with adequate RAM"]
fn distorted_heterogeneous_250047_hexes_four_thread_series_solution() {
    let input = model();
    let nodes = (N + 1).pow(3);
    let cells = N.pow(3);
    assert_eq!(cells, 250_047);
    assert_eq!(nodes, 262_144);
    assert_eq!(nodes * 3, 786_432);
    assert_eq!(input.nodes.len(), nodes);
    assert_eq!(input.elements.len(), cells);

    let started = Instant::now();
    let output = solve_hex8_volume(input).expect("large general matrix-free Hex8 solve");
    let seconds = started.elapsed().as_secs_f64();
    let peak_kib = peak_rss_kib();
    assert_eq!(output.nodal_displacements_m.len(), nodes);
    assert_eq!(output.nodal_reactions_kn.len(), nodes);
    assert_eq!(output.element_gauss_stress_mpa.len(), cells);

    let (sigma, ux) = exact_series_solution();
    let mut max_displacement_error_m = 0.0_f64;
    let mut left_reaction_kn = 0.0;
    let mut right_reaction_kn = 0.0;
    for (index, actual) in output.nodal_displacements_m.iter().enumerate() {
        let station = index % (N + 1);
        for (component, expected) in actual.iter().zip([ux[station], 0.0, 0.0]) {
            max_displacement_error_m = max_displacement_error_m.max((component - expected).abs());
        }
        if station == 0 {
            left_reaction_kn += output.nodal_reactions_kn[index][0];
        } else if station == N {
            right_reaction_kn += output.nodal_reactions_kn[index][0];
        }
    }
    let max_stress_error_mpa = output
        .element_gauss_stress_mpa
        .iter()
        .flatten()
        .flat_map(|stress| {
            [
                (stress[0] - sigma).abs(),
                stress[1].abs(),
                stress[2].abs(),
                stress[3].abs(),
                stress[4].abs(),
                stress[5].abs(),
            ]
        })
        .fold(0.0_f64, f64::max);
    // Exterior yz coordinates remain a unit square; MPa × 1 m² = 1000 kN.
    let force_kn = 1_000.0 * sigma;
    eprintln!(
        "general large Hex8: {cells} cells, {nodes} nodes, {} DOF, 4 threads; \
         solve={seconds:.3}s, iterations={}, true relative residual={:.3e}, \
         max displacement error={max_displacement_error_m:.3e} m, \
         max Gauss stress error={max_stress_error_mpa:.3e} MPa, \
         left/right reaction=({left_reaction_kn:.6}, {right_reaction_kn:.6}) kN, \
         exact stress={sigma:.6} MPa, exact end force={force_kn:.6} kN, \
         peak VmHWM={peak_kib:?} KiB",
        nodes * 3,
        output.iterations,
        output.relative_residual,
    );
    assert_eq!(output.solver_used, "matrixFreeGeneralLarge");
    assert_eq!(output.threads, 4);
    assert_eq!(output.csr_nonzeros, 0);
    assert!(output.relative_residual < 1e-7);
    assert!(max_displacement_error_m < 1e-7);
    assert!(max_stress_error_mpa < 0.01);
    assert!((left_reaction_kn + force_kn).abs() < force_kn * 1e-5);
    assert!((right_reaction_kn - force_kn).abs() < force_kn * 1e-5);
}
