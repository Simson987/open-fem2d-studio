//! A large, conforming Hex8 mesh with five-valent section vertices. Run with:
//! `cargo test --release -p openaec-native-fem --test volume_hex8_250k_five_valent_validation -- --ignored --nocapture`
//!
//! Separated 2 by 3 section blocks are replaced by five quadrilaterals
//! meeting at one interior vertex. This is not tensor-grid connectivity. The
//! section is extruded in x, so this test does not claim arbitrary 3D topology.
//! Alternating E layers and nu=0 admit an independent exact series solution.

use std::time::Instant;

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

const E_MPA: [f64; 3] = [30_000.0, 47_000.0, 24_000.0];
const END_U_M: f64 = 0.001;
const PERMUTATION: usize = 73;

struct Fixture {
    input: Hex8VolumeRequest,
    station: Vec<usize>,
    section: Vec<usize>,
    section_force_kn: Vec<f64>,
    ux: Vec<f64>,
    sigma_mpa: f64,
    section_cells: usize,
    centres_start: usize,
    centres_count: usize,
}

fn x(nx: usize, i: usize) -> f64 {
    let t = i as f64 / nx as f64;
    t * (0.92 + 0.08 * t)
}

fn exact_series(nx: usize) -> (f64, Vec<f64>) {
    let compliance: f64 = (0..nx)
        .map(|i| (x(nx, i + 1) - x(nx, i)) / E_MPA[i % 3])
        .sum();
    let sigma = END_U_M / compliance;
    let mut ux = vec![0.0; nx + 1];
    for i in 0..nx {
        ux[i + 1] = ux[i] + sigma * (x(nx, i + 1) - x(nx, i)) / E_MPA[i % 3];
    }
    (sigma, ux)
}

fn gcd(mut a: usize, mut b: usize) -> usize {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn quad_geometry(points: [[f64; 2]; 4], a: f64, b: f64) -> ([f64; 4], f64) {
    let shape = [
        (1.0 - a) * (1.0 - b) / 4.0,
        (1.0 + a) * (1.0 - b) / 4.0,
        (1.0 + a) * (1.0 + b) / 4.0,
        (1.0 - a) * (1.0 + b) / 4.0,
    ];
    let da = [
        -(1.0 - b) / 4.0,
        (1.0 - b) / 4.0,
        (1.0 + b) / 4.0,
        -(1.0 + b) / 4.0,
    ];
    let db = [
        -(1.0 - a) / 4.0,
        -(1.0 + a) / 4.0,
        (1.0 + a) / 4.0,
        (1.0 - a) / 4.0,
    ];
    let mut dy_da = 0.0;
    let mut dz_da = 0.0;
    let mut dy_db = 0.0;
    let mut dz_db = 0.0;
    for n in 0..4 {
        dy_da += da[n] * points[n][0];
        dz_da += da[n] * points[n][1];
        dy_db += db[n] * points[n][0];
        dz_db += db[n] * points[n][1];
    }
    (shape, dy_da * dz_db - dz_da * dy_db)
}

fn fixture(nx: usize, ny: usize, nz: usize) -> Fixture {
    let width = ny + 1;
    let height = nz + 1;
    let mut patches = Vec::new();
    for k in (1..nz - 3).step_by(4) {
        for j in (1..ny - 2).step_by(3) {
            patches.push((j, k));
        }
    }
    let mut omitted = vec![false; width * height];
    let mut warp_y = vec![0.0; width * height];
    let mut warp_z = vec![0.0; width * height];
    let mut covered = vec![false; ny * nz];
    for &(j, k) in &patches {
        for dk in 0..3 {
            for dj in 0..2 {
                assert!(!std::mem::replace(
                    &mut covered[(k + dk) * ny + j + dj],
                    true
                ));
            }
        }
        omitted[(k + 1) * width + j + 1] = true;
        omitted[(k + 2) * width + j + 1] = true;
        // Bulge the three formerly collinear patch sides into neighboring
        // regular quads. This gives every Hex8 corner a positive Jacobian.
        warp_y[(k + 2) * width + j] -= 0.07 / ny as f64;
        warp_y[(k + 2) * width + j + 2] += 0.07 / ny as f64;
        warp_z[(k + 3) * width + j + 1] += 0.07 / nz as f64;
    }
    let mut grid = vec![usize::MAX; width * height];
    let mut section_points = Vec::new();
    for k in 0..height {
        for j in 0..width {
            let original = k * width + j;
            if omitted[original] {
                continue;
            }
            grid[original] = section_points.len();
            section_points.push([
                j as f64 / ny as f64 + warp_y[original],
                k as f64 / nz as f64 + warp_z[original],
            ]);
        }
    }
    let centres_start = section_points.len();
    for &(j, k) in &patches {
        section_points.push([(j as f64 + 1.07) / ny as f64, (k as f64 + 1.44) / nz as f64]);
    }
    let section_nodes = section_points.len();
    let nodes_count = (nx + 1) * section_nodes;
    assert_eq!(gcd(PERMUTATION, nodes_count), 1);
    let node = |i: usize, p: usize| (PERMUTATION * (i * section_nodes + p) + 17) % nodes_count;
    let mut section_quads = Vec::with_capacity(ny * nz - patches.len());
    for k in 0..nz {
        for j in 0..ny {
            if !covered[k * ny + j] {
                section_quads.push([
                    grid[k * width + j],
                    grid[k * width + j + 1],
                    grid[(k + 1) * width + j + 1],
                    grid[(k + 1) * width + j],
                ]);
            }
        }
    }
    for (patch_index, &(j, k)) in patches.iter().enumerate() {
        let perimeter = [
            (0, 0),
            (1, 0),
            (2, 0),
            (2, 1),
            (2, 2),
            (2, 3),
            (1, 3),
            (0, 3),
            (0, 2),
            (0, 1),
        ]
        .map(|(dj, dk)| grid[(k + dk) * width + j + dj]);
        assert!(perimeter.iter().all(|&p| p != usize::MAX));
        let centre = centres_start + patch_index;
        for sector in 0..5 {
            section_quads.push([
                centre,
                perimeter[(2 * sector + 9) % 10],
                perimeter[2 * sector],
                perimeter[(2 * sector + 1) % 10],
            ]);
        }
    }
    let section_cells = section_quads.len();
    assert_eq!(section_cells, ny * nz - patches.len());

    // Independent 2x2 surface integration of sigma*n on the end sections.
    // It provides the full nodal reaction distribution, not merely its sum.
    let (sigma_mpa, ux) = exact_series(nx);
    let mut section_force_kn = vec![0.0; section_nodes];
    let mut area = 0.0;
    let g = 1.0 / 3.0_f64.sqrt();
    for q in &section_quads {
        let points = q.map(|p| section_points[p]);
        for a in [-g, g] {
            for b in [-g, g] {
                let (shape, det) = quad_geometry(points, a, b);
                assert!(det > 0.0, "inverted or degenerate section quad: {q:?}");
                area += det;
                for local in 0..4 {
                    section_force_kn[q[local]] += 1_000.0 * sigma_mpa * shape[local] * det;
                }
            }
        }
    }
    for q in &section_quads {
        let points = q.map(|p| section_points[p]);
        for a in [-1.0, 1.0] {
            for b in [-1.0, 1.0] {
                let (_, det) = quad_geometry(points, a, b);
                assert!(det > 0.0, "nonpositive corner Jacobian: {q:?}");
            }
        }
    }
    assert!((area - 1.0).abs() < 1e-12, "section area={area}");
    assert!((section_force_kn.iter().sum::<f64>() - 1_000.0 * sigma_mpa).abs() < 1e-8);

    let mut nodes = vec![[0.0; 3]; nodes_count];
    let mut station = vec![usize::MAX; nodes_count];
    let mut section = vec![usize::MAX; nodes_count];
    let mut supports = Vec::with_capacity(2 * section_nodes);
    for i in 0..=nx {
        for (p, &[y, z]) in section_points.iter().enumerate() {
            let global = node(i, p);
            assert_eq!(station[global], usize::MAX);
            nodes[global] = [x(nx, i), y, z];
            station[global] = i;
            section[global] = p;
            if i == 0 {
                supports.push(Hex8VolumeSupport {
                    node: global,
                    displacement_m: [Some(0.0); 3],
                });
            } else if i == nx {
                supports.push(Hex8VolumeSupport {
                    node: global,
                    displacement_m: [Some(END_U_M), None, None],
                });
            }
        }
    }
    assert!(!station.contains(&usize::MAX));

    let cells_count = nx * section_cells;
    assert_eq!(gcd(PERMUTATION, cells_count), 1);
    let mut elements = vec![None; cells_count];
    for i in 0..nx {
        for (q_index, &q) in section_quads.iter().enumerate() {
            let ordinal = i * section_cells + q_index;
            let position = (PERMUTATION * ordinal + 19) % cells_count;
            assert!(elements[position]
                .replace(Hex8VolumeCell {
                    nodes: [
                        node(i, q[0]),
                        node(i, q[1]),
                        node(i, q[2]),
                        node(i, q[3]),
                        node(i + 1, q[0]),
                        node(i + 1, q[1]),
                        node(i + 1, q[2]),
                        node(i + 1, q[3]),
                    ],
                    material: i % E_MPA.len(),
                })
                .is_none());
        }
    }
    let elements = elements.into_iter().map(Option::unwrap).collect();
    Fixture {
        input: Hex8VolumeRequest {
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
            max_iterations: 1_500,
            structured_grid_cells: None,
            threads: 4,
            linear_backend: Hex8LinearBackend::MatrixFreeGeneralLarge,
        },
        station,
        section,
        section_force_kn,
        ux,
        sigma_mpa,
        section_cells,
        centres_start,
        centres_count: patches.len(),
    }
}

fn validate_topology(f: &Fixture, nx: usize, ny: usize, nz: usize) {
    let section_nodes = f.section_force_kn.len();
    let node =
        |i: usize, p: usize| (PERMUTATION * (i * section_nodes + p) + 17) % f.input.nodes.len();
    let mut valence = vec![0_u8; f.input.nodes.len()];
    let faces = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
    ];
    let mut all_faces = Vec::with_capacity(6 * f.input.elements.len());
    for cell in &f.input.elements {
        let mut sorted = cell.nodes;
        sorted.sort_unstable();
        for pair in sorted.windows(2) {
            assert_ne!(pair[0], pair[1], "cell repeats a node");
        }
        for &n in &cell.nodes {
            valence[n] += 1;
        }
        for local in faces {
            let mut face = local.map(|n| cell.nodes[n]);
            face.sort_unstable();
            all_faces.push(face);
        }
    }
    assert!(valence.iter().all(|&v| v > 0));
    for i in 0..=nx {
        for p in f.centres_start..f.centres_start + f.centres_count {
            assert_eq!(valence[node(i, p)], if i == 0 || i == nx { 5 } else { 10 });
        }
    }
    all_faces.sort_unstable();
    let mut boundary_faces = 0;
    let mut internal_faces = 0;
    let mut cursor = 0;
    while cursor < all_faces.len() {
        let mut end = cursor + 1;
        while end < all_faces.len() && all_faces[end] == all_faces[cursor] {
            end += 1;
        }
        match end - cursor {
            1 => boundary_faces += 1,
            2 => internal_faces += 1,
            count => panic!("nonmanifold face shared by {count} cells"),
        }
        cursor = end;
    }
    let expected_boundary = 2 * f.section_cells + nx * 2 * (ny + nz);
    assert_eq!(boundary_faces, expected_boundary);
    assert_eq!(
        boundary_faces + 2 * internal_faces,
        6 * f.input.elements.len()
    );
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

fn run(nx: usize, ny: usize, nz: usize) {
    let f = fixture(nx, ny, nz);
    validate_topology(&f, nx, ny, nz);
    let cells = f.input.elements.len();
    let nodes = f.input.nodes.len();
    let Fixture {
        input,
        station,
        section,
        section_force_kn,
        ux,
        sigma_mpa,
        ..
    } = f;
    let started = Instant::now();
    let result = solve_hex8_volume(input).expect("five-valent matrix-free Hex8 solve");
    let seconds = started.elapsed().as_secs_f64();
    assert_eq!(result.solver_used, "matrixFreeGeneralLarge");
    assert_eq!(result.threads, 4);
    assert_eq!(result.csr_nonzeros, 0);
    assert_eq!(result.nodal_displacements_m.len(), nodes);
    assert_eq!(result.nodal_reactions_kn.len(), nodes);
    assert_eq!(result.element_gauss_stress_mpa.len(), cells);
    let mut max_u_error = 0.0_f64;
    let mut max_r_error = 0.0_f64;
    let mut left_force = 0.0;
    let mut right_force = 0.0;
    for n in 0..nodes {
        let i = station[n];
        let expected_u = [ux[i], 0.0, 0.0];
        let expected_r = if i == 0 {
            [-section_force_kn[section[n]], 0.0, 0.0]
        } else if i == nx {
            [section_force_kn[section[n]], 0.0, 0.0]
        } else {
            [0.0; 3]
        };
        for axis in 0..3 {
            max_u_error =
                max_u_error.max((result.nodal_displacements_m[n][axis] - expected_u[axis]).abs());
            max_r_error =
                max_r_error.max((result.nodal_reactions_kn[n][axis] - expected_r[axis]).abs());
        }
        if i == 0 {
            left_force += result.nodal_reactions_kn[n][0];
        } else if i == nx {
            right_force += result.nodal_reactions_kn[n][0];
        }
    }
    let max_stress_error = result
        .element_gauss_stress_mpa
        .iter()
        .flatten()
        .flat_map(|s| {
            [
                (s[0] - sigma_mpa).abs(),
                s[1].abs(),
                s[2].abs(),
                s[3].abs(),
                s[4].abs(),
                s[5].abs(),
            ]
        })
        .fold(0.0_f64, f64::max);
    let force = sigma_mpa * 1_000.0;
    eprintln!(
        "five-valent Hex8: {cells} cells, {nodes} nodes, {} DOF, 4 threads; \
         solve={seconds:.3}s, iterations={}, residual={:.3e}, \
         max displacement error={max_u_error:.3e} m, max nodal reaction error={max_r_error:.3e} kN, \
         max Gauss stress error={max_stress_error:.3e} MPa, end reactions=({left_force:.6}, {right_force:.6}) kN, \
         exact end force={force:.6} kN, \
         peak VmHWM={:?} KiB",
        nodes * 3, result.iterations, result.relative_residual, peak_rss_kib(),
    );
    assert!(result.relative_residual < 1e-7);
    assert!(max_u_error < 2e-8);
    assert!(max_stress_error < 0.005);
    // Both 272- and 250,000-cell runs gave <2.3e-4 kN maximum nodal error.
    assert!(max_r_error < 1e-3);
    // The large run's largest end-force error was 1.416e-3 kN; allow ~4x.
    assert!((left_force + force).abs() < force * 2e-7);
    assert!((right_force - force).abs() < force * 2e-7);
}

#[test]
fn small_five_valent_section_affine_reference() {
    run(4, 8, 9); // 4 patches, 68 section cells, 272 Hex8 cells
}

#[test]
#[ignore = "250,000 five-valent Hex8 cells; run explicitly in release with adequate RAM"]
fn large_five_valent_250000_hexes_four_thread_reference() {
    // 52² regular section cells, with 204 six-to-five-cell replacements.
    assert_eq!(100 * (52 * 52 - 204), 250_000);
    run(100, 52, 52);
}
