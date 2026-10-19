//! Explicit release acceptance probe for a large, connected L-section Hex8 mesh:
//! `cargo test --release -p openaec-native-fem --test volume_hex8_large_l_topology_validation -- --ignored --nocapture`
//!
//! This is an extruded, nonrectangular topology with shuffled global node IDs
//! and element order. It does not represent arbitrary 3D mesh connectivity.

use std::time::Instant;

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

const N: usize = 70;
const HALF: usize = N / 2;
const SECTION_NODES: usize = (N + 1) * (N + 1) - HALF * HALF;
const SECTION_CELLS: usize = N * N - HALF * HALF;
const NODES: usize = (N + 1) * SECTION_NODES;
const CELLS: usize = N * SECTION_CELLS;
const END_U_M: f64 = 0.001;
const E_MPA: [f64; 3] = [30_000.0, 47_000.0, 24_000.0];

fn section_node(j: usize, k: usize) -> usize {
    assert!(j <= N && k <= N && !(j > HALF && k > HALF));
    if k <= HALF {
        k * (N + 1) + j
    } else {
        (HALF + 1) * (N + 1) + (k - HALF - 1) * (HALF + 1) + j
    }
}

fn node(i: usize, j: usize, k: usize) -> usize {
    // 73 is coprime with 270,936, so this visits every global node ID once.
    (73 * (i * SECTION_NODES + section_node(j, k)) + 17) % NODES
}

fn x(i: usize) -> f64 {
    let t = i as f64 / N as f64;
    t * (0.92 + 0.08 * t)
}

fn yz(j: usize, k: usize) -> [f64; 2] {
    let y = j as f64 / N as f64;
    let z = k as f64 / N as f64;
    // The warp vanishes on every exterior L-boundary segment, including the
    // reentrant edges. Thus its exact section area remains the affine value.
    let warp = 0.003
        * (std::f64::consts::PI * j as f64 / HALF as f64).sin()
        * (std::f64::consts::PI * k as f64 / HALF as f64).sin();
    [y + 0.1 * z + warp, z + 0.06 * y + 0.5 * warp]
}

fn exact_series_solution() -> (f64, Vec<f64>) {
    // ν = 0 makes piecewise affine ux, zero transverse displacement, and
    // uniform sigma_x an exact continuum solution for these x-only layers.
    let compliance: f64 = (0..N).map(|i| (x(i + 1) - x(i)) / E_MPA[i % 3]).sum();
    let sigma = END_U_M / compliance;
    let mut ux = vec![0.0; N + 1];
    for i in 0..N {
        ux[i + 1] = ux[i] + sigma * (x(i + 1) - x(i)) / E_MPA[i % 3];
    }
    (sigma, ux)
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

fn model() -> (Hex8VolumeRequest, Vec<usize>) {
    let mut nodes = vec![[0.0; 3]; NODES];
    let mut station_by_node = vec![usize::MAX; NODES];
    let mut supports = Vec::with_capacity(2 * SECTION_NODES);
    for i in 0..=N {
        for k in 0..=N {
            for j in 0..=N {
                if j > HALF && k > HALF {
                    continue;
                }
                let index = node(i, j, k);
                let [y, z] = yz(j, k);
                assert_eq!(station_by_node[index], usize::MAX);
                nodes[index] = [x(i), y, z];
                station_by_node[index] = i;
                if i == 0 {
                    supports.push(Hex8VolumeSupport {
                        node: index,
                        displacement_m: [Some(0.0); 3],
                    });
                } else if i == N {
                    supports.push(Hex8VolumeSupport {
                        node: index,
                        displacement_m: [Some(END_U_M), None, None],
                    });
                }
            }
        }
    }
    assert!(!station_by_node.contains(&usize::MAX));

    let mut shuffled_elements = vec![None; CELLS];
    let mut ordinal = 0;
    for i in 0..N {
        for k in 0..N {
            for j in 0..N {
                if j >= HALF && k >= HALF {
                    continue;
                }
                let cell = Hex8VolumeCell {
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
                };
                // 73 is also coprime with 257,250. This permutation mixes
                // layers and section positions in the solver's traversal.
                let position = (73 * ordinal + 19) % CELLS;
                assert!(shuffled_elements[position].replace(cell).is_none());
                ordinal += 1;
            }
        }
    }
    assert_eq!(ordinal, CELLS);
    let elements = shuffled_elements.into_iter().map(Option::unwrap).collect();
    (
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
            max_iterations: 1_500,
            structured_grid_cells: None,
            threads: 4,
            linear_backend: Hex8LinearBackend::MatrixFreeGeneralLarge,
        },
        station_by_node,
    )
}

#[test]
#[ignore = "257,250 general Hex8 cells; run explicitly in release with adequate RAM"]
fn shuffled_large_l_section_layered_series_solution() {
    assert_eq!(SECTION_CELLS, 3_675);
    assert_eq!(CELLS, 257_250);
    assert_eq!(NODES, 270_936);
    assert_eq!(NODES * 3, 812_808);
    let (input, station_by_node) = model();
    assert_eq!(input.nodes.len(), NODES);
    assert_eq!(input.elements.len(), CELLS);

    let started = Instant::now();
    let output = solve_hex8_volume(input).expect("large L-section matrix-free Hex8 solve");
    let seconds = started.elapsed().as_secs_f64();
    let peak_kib = peak_rss_kib();
    assert_eq!(output.nodal_displacements_m.len(), NODES);
    assert_eq!(output.nodal_reactions_kn.len(), NODES);
    assert_eq!(output.element_gauss_stress_mpa.len(), CELLS);

    let (sigma, ux) = exact_series_solution();
    let mut max_displacement_error_m = 0.0_f64;
    let mut end_reactions_kn = [[0.0; 3]; 2];
    for (index, actual) in output.nodal_displacements_m.iter().enumerate() {
        let station = station_by_node[index];
        for (component, expected) in actual.iter().zip([ux[station], 0.0, 0.0]) {
            max_displacement_error_m = max_displacement_error_m.max((component - expected).abs());
        }
        if station == 0 || station == N {
            let end = usize::from(station == N);
            for axis in 0..3 {
                end_reactions_kn[end][axis] += output.nodal_reactions_kn[index][axis];
            }
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
    // The L is three quarters of the unit square. The affine yz map has
    // determinant 1 - 0.1*0.06; interior warping leaves its boundary fixed.
    let area_m2 = 0.75 * (1.0 - 0.1 * 0.06);
    let force_kn = 1_000.0 * sigma * area_m2;
    eprintln!(
        "large shuffled L-section Hex8: {CELLS} cells, {NODES} nodes, {} DOF, 4 threads; \
         solve={seconds:.3}s, iterations={}, true relative residual={:.3e}, \
         max displacement error={max_displacement_error_m:.3e} m, \
         max Gauss stress error={max_stress_error_mpa:.3e} MPa, \
         left/right reactions=({:?}, {:?}) kN, \
         exact stress={sigma:.6} MPa, area={area_m2:.6} m², \
         exact end force={force_kn:.6} kN, peak VmHWM={peak_kib:?} KiB",
        NODES * 3,
        output.iterations,
        output.relative_residual,
        end_reactions_kn[0],
        end_reactions_kn[1],
    );
    assert_eq!(output.solver_used, "matrixFreeGeneralLarge");
    assert_eq!(output.threads, 4);
    assert_eq!(output.csr_nonzeros, 0);
    assert!(output.relative_residual < 1e-7);
    assert!(max_displacement_error_m < 1e-7);
    assert!(max_stress_error_mpa < 0.01);
    for (end, sign) in [(0, -1.0), (1, 1.0)] {
        assert!((end_reactions_kn[end][0] - sign * force_kn).abs() < force_kn * 1e-5);
        assert!(end_reactions_kn[end][1].abs() < force_kn * 1e-5);
        assert!(end_reactions_kn[end][2].abs() < force_kn * 1e-5);
    }
}
