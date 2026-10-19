//! Explicit large general-geometry Hex8 acceptance probe. Run with:
//! `cargo test --release -p openaec-native-fem --test volume_hex8_general_scale_validation -- --ignored --nocapture`
//! To run only the 40³-cell probe, add the
//! `distorted_heterogeneous_64000_hexes_four_thread_series_solution` filter
//! before `--`.
//!
//! Both the 20³- and 40³-cell meshes exceed the assembled route's
//! 4,000,000-triplet budget. Each x section is
//! geometrically identical but the interior yz nodes are distorted and x
//! spacing is nonuniform. Alternating x layers have different E and ν = 0.
//! Thus an independently derived series-spring solution has constant σxx,
//! piecewise linear ux, and zero uy/uz. It verifies this important class of
//! irregular meshes; it does not establish performance for arbitrary topology.

use std::time::Instant;

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

const SMALL_N: usize = 20;
const LARGE_N: usize = 40;
const END_DISPLACEMENT_M: f64 = 0.001;
const E_MPA: [f64; 2] = [30_000.0, 60_000.0];

fn node(n: usize, i: usize, j: usize, k: usize) -> usize {
    (k * (n + 1) + j) * (n + 1) + i
}

fn section_x(n: usize, i: usize) -> f64 {
    let t = i as f64 / n as f64;
    t * (0.92 + 0.08 * t)
}

fn exact_stress_mpa(n: usize) -> f64 {
    let compliance: f64 = (0..n)
        .map(|i| (section_x(n, i + 1) - section_x(n, i)) / E_MPA[i % 2])
        .sum();
    END_DISPLACEMENT_M / compliance
}

fn exact_ux(n: usize, i: usize, sigma: f64) -> f64 {
    (0..i)
        .map(|layer| sigma * (section_x(n, layer + 1) - section_x(n, layer)) / E_MPA[layer % 2])
        .sum()
}

fn peak_rss_kib() -> Option<usize> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status
        .lines()
        .find_map(|line| line.strip_prefix("VmHWM:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

fn model(n: usize) -> Hex8VolumeRequest {
    let mut nodes = Vec::with_capacity((n + 1).pow(3));
    let mut supports = Vec::new();
    for k in 0..=n {
        for j in 0..=n {
            for i in 0..=n {
                let y = j as f64 / n as f64;
                let z = k as f64 / n as f64;
                let shape = (std::f64::consts::PI * y).sin() * (std::f64::consts::PI * z).sin();
                // The same distorted cross-section is extruded along x. Its
                // exterior remains the unit square, with area exactly 1 m².
                nodes.push([
                    section_x(n, i),
                    y + 0.006 * shape * (2.0 * std::f64::consts::PI * z).sin(),
                    z + 0.006 * shape * (2.0 * std::f64::consts::PI * y).sin(),
                ]);
                if i == 0 {
                    supports.push(Hex8VolumeSupport {
                        node: node(n, i, j, k),
                        displacement_m: [Some(0.0); 3],
                    });
                } else if i == n {
                    supports.push(Hex8VolumeSupport {
                        node: node(n, i, j, k),
                        displacement_m: [Some(END_DISPLACEMENT_M), None, None],
                    });
                }
            }
        }
    }
    let mut elements = Vec::with_capacity(n.pow(3));
    for k in 0..n {
        for j in 0..n {
            for i in 0..n {
                elements.push(Hex8VolumeCell {
                    nodes: [
                        node(n, i, j, k),
                        node(n, i + 1, j, k),
                        node(n, i + 1, j + 1, k),
                        node(n, i, j + 1, k),
                        node(n, i, j, k + 1),
                        node(n, i + 1, j, k + 1),
                        node(n, i + 1, j + 1, k + 1),
                        node(n, i, j + 1, k + 1),
                    ],
                    material: i % 2,
                });
            }
        }
    }
    Hex8VolumeRequest {
        nodes,
        elements,
        materials: E_MPA
            .map(|e_mpa| Hex8VolumeMaterial {
                e_mpa,
                poisson: 0.0,
            })
            .into(),
        loads: Vec::new(),
        body_forces: Vec::new(),
        face_tractions: Vec::new(),
        supports,
        tolerance: 1e-7,
        max_iterations: 1_000,
        structured_grid_cells: None,
        threads: 4,
        linear_backend: Hex8LinearBackend::MatrixFreeGeneral,
    }
}

#[test]
#[ignore = "8,000 general Hex8 cells; explicit bounded release throughput probe"]
fn distorted_heterogeneous_8000_hexes_four_thread_series_solution() {
    verify_series_solution(SMALL_N);
}

#[test]
#[ignore = "64,000 general Hex8 cells; explicit bounded release throughput probe"]
fn distorted_heterogeneous_64000_hexes_four_thread_series_solution() {
    verify_series_solution(LARGE_N);
}

fn verify_series_solution(n: usize) {
    let input = model(n);
    let cells = n.pow(3);
    let nodes = (n + 1).pow(3);
    assert_eq!(input.elements.len(), cells);
    assert_eq!(input.nodes.len(), nodes);
    assert_eq!(input.nodes.len() * 3, nodes * 3);
    let started = Instant::now();
    let output = solve_hex8_volume(input).expect("general matrix-free Hex8 solve");
    let seconds = started.elapsed().as_secs_f64();
    let peak_kib = peak_rss_kib();
    assert_eq!(output.nodal_displacements_m.len(), nodes);
    assert_eq!(output.nodal_reactions_kn.len(), nodes);
    assert_eq!(output.element_gauss_stress_mpa.len(), cells);
    let sigma = exact_stress_mpa(n);
    let mut max_displacement_error_m = 0.0_f64;
    for (index, actual) in output.nodal_displacements_m.iter().enumerate() {
        let expected = [exact_ux(n, index % (n + 1), sigma), 0.0, 0.0];
        for axis in 0..3 {
            max_displacement_error_m =
                max_displacement_error_m.max((actual[axis] - expected[axis]).abs());
        }
    }
    let left_reaction_kn: f64 = output
        .nodal_reactions_kn
        .iter()
        .enumerate()
        .filter(|(index, _)| index % (n + 1) == 0)
        .map(|(_, reaction)| reaction[0])
        .sum();
    let right_reaction_kn: f64 = output
        .nodal_reactions_kn
        .iter()
        .enumerate()
        .filter(|(index, _)| index % (n + 1) == n)
        .map(|(_, reaction)| reaction[0])
        .sum();
    let force_kn = 1000.0 * sigma; // MPa × 1 m² = 1000 kN.
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
    eprintln!(
        "general Hex8: {cells} elements, {nodes} nodes, {} DOF, 4 threads; \
         solve={seconds:.3}s, iterations={}, true relative residual={:.3e}, \
         max |u-u_exact|={max_displacement_error_m:.3e} m, \
         max |stress-stress_exact|={max_stress_error_mpa:.3e} MPa, \
         left/right reaction=({left_reaction_kn:.6}, {right_reaction_kn:.6}) kN, \
         peak VmHWM={peak_kib:?} KiB",
        nodes * 3,
        output.iterations,
        output.relative_residual
    );
    assert_eq!(output.solver_used, "matrixFreeGeneral");
    assert_eq!(output.threads, 4);
    assert_eq!(output.csr_nonzeros, 0);
    assert!(output.relative_residual < 1e-7);
    assert!(max_displacement_error_m < 1e-7);
    assert!(max_stress_error_mpa < 0.01);
    assert!((left_reaction_kn + force_kn).abs() < force_kn * 1e-7);
    assert!((right_reaction_kn - force_kn).abs() < force_kn * 1e-7);
}
