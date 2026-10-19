//! Explicit release acceptance probe for a genuine three-dimensional cavity:
//! `cargo test --release -p openaec-native-fem --test volume_hex8_250k_cavity_validation -- --ignored --nocapture`
//!
//! The 12³ central cells of a 64³ brick are absent. Both the exterior and
//! closed cavity surfaces receive exact affine displacements; all other nodes
//! are free. Constant strain and stress therefore solve the continuum problem
//! exactly, even for warped isoparametric cells. The reference uses only the
//! displacement gradient and isotropic Hooke law, not element routines.

use std::time::Instant;

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeSupport,
};

const N: usize = 64;
const CAVITY_LO: usize = 26;
const CAVITY_HI: usize = 38;
const CELLS: usize = N * N * N - (CAVITY_HI - CAVITY_LO).pow(3);
const NODES: usize = (N + 1).pow(3) - (CAVITY_HI - CAVITY_LO - 1).pow(3);
const E_MPA: f64 = 31_000.0;
const NU: f64 = 0.23;
const GRAD_U: [[f64; 3]; 3] = [
    [0.0008, 0.00025, -0.0001],
    [-0.00015, -0.0003, 0.00016],
    [0.0002, -0.00004, 0.00045],
];
const TRANSLATION: [f64; 3] = [0.0001, -0.0002, 0.00005];

fn logical_node(i: usize, j: usize, k: usize) -> usize {
    (k * (N + 1) + j) * (N + 1) + i
}

fn inside_cavity_cell(i: usize, j: usize, k: usize) -> bool {
    (CAVITY_LO..CAVITY_HI).contains(&i)
        && (CAVITY_LO..CAVITY_HI).contains(&j)
        && (CAVITY_LO..CAVITY_HI).contains(&k)
}

fn unused_node(i: usize, j: usize, k: usize) -> bool {
    (CAVITY_LO + 1..CAVITY_HI).contains(&i)
        && (CAVITY_LO + 1..CAVITY_HI).contains(&j)
        && (CAVITY_LO + 1..CAVITY_HI).contains(&k)
}

fn boundary_kind(i: usize, j: usize, k: usize) -> u8 {
    if [i, j, k].into_iter().any(|q| q == 0 || q == N) {
        return 1; // exterior
    }
    if [i, j, k]
        .into_iter()
        .all(|q| (CAVITY_LO..=CAVITY_HI).contains(&q))
        && [i, j, k]
            .into_iter()
            .any(|q| q == CAVITY_LO || q == CAVITY_HI)
    {
        return 2; // cavity
    }
    0 // genuinely free interior node
}

fn position(i: usize, j: usize, k: usize) -> [f64; 3] {
    let [s, t, v] = [
        i as f64 / N as f64,
        j as f64 / N as f64,
        k as f64 / N as f64,
    ];
    let pi = std::f64::consts::PI;
    // Vanishes on the outer cube, but curves all three coordinates near the
    // internal cavity. The small amplitude preserves positive Jacobians.
    [
        s + 0.002 * (pi * s).sin() * (2.0 * pi * t).sin() * (pi * v).sin(),
        t + 0.002 * (pi * s).sin() * (pi * t).sin() * (2.0 * pi * v).sin(),
        v + 0.002 * (2.0 * pi * s).sin() * (pi * t).sin() * (pi * v).sin(),
    ]
}

fn exact_displacement(x: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|row| {
        TRANSLATION[row] + (0..3).map(|col| GRAD_U[row][col] * x[col]).sum::<f64>()
    })
}

fn exact_stress_mpa() -> [f64; 6] {
    let lambda = E_MPA * NU / ((1.0 + NU) * (1.0 - 2.0 * NU));
    let mu = E_MPA / (2.0 * (1.0 + NU));
    let trace = GRAD_U[0][0] + GRAD_U[1][1] + GRAD_U[2][2];
    [
        lambda * trace + 2.0 * mu * GRAD_U[0][0],
        lambda * trace + 2.0 * mu * GRAD_U[1][1],
        lambda * trace + 2.0 * mu * GRAD_U[2][2],
        mu * (GRAD_U[0][1] + GRAD_U[1][0]),
        mu * (GRAD_U[1][2] + GRAD_U[2][1]),
        mu * (GRAD_U[2][0] + GRAD_U[0][2]),
    ]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn traction_kn(area_vector: [f64; 3], sigma: [f64; 6]) -> [f64; 3] {
    [
        1_000.0
            * (sigma[0] * area_vector[0] + sigma[3] * area_vector[1] + sigma[5] * area_vector[2]),
        1_000.0
            * (sigma[3] * area_vector[0] + sigma[1] * area_vector[1] + sigma[4] * area_vector[2]),
        1_000.0
            * (sigma[5] * area_vector[0] + sigma[4] * area_vector[1] + sigma[2] * area_vector[2]),
    ]
}

fn integrate_face_reaction(
    face: [usize; 4],
    coordinates: &[[f64; 3]],
    stress: [f64; 6],
    reactions: &mut [[f64; 3]],
) {
    let q = 1.0 / 3.0_f64.sqrt();
    let points = face.map(|node| coordinates[node]);
    for xi in [-q, q] {
        for eta in [-q, q] {
            let shape = [
                (1.0 - xi) * (1.0 - eta) / 4.0,
                (1.0 + xi) * (1.0 - eta) / 4.0,
                (1.0 + xi) * (1.0 + eta) / 4.0,
                (1.0 - xi) * (1.0 + eta) / 4.0,
            ];
            let dxi = [
                -(1.0 - eta) / 4.0,
                (1.0 - eta) / 4.0,
                (1.0 + eta) / 4.0,
                -(1.0 + eta) / 4.0,
            ];
            let deta = [
                -(1.0 - xi) / 4.0,
                -(1.0 + xi) / 4.0,
                (1.0 + xi) / 4.0,
                (1.0 - xi) / 4.0,
            ];
            let mut tangent_xi = [0.0; 3];
            let mut tangent_eta = [0.0; 3];
            for local in 0..4 {
                for axis in 0..3 {
                    tangent_xi[axis] += dxi[local] * points[local][axis];
                    tangent_eta[axis] += deta[local] * points[local][axis];
                }
            }
            let force = traction_kn(cross(tangent_xi, tangent_eta), stress);
            for local in 0..4 {
                for axis in 0..3 {
                    reactions[face[local]][axis] += shape[local] * force[axis];
                }
            }
        }
    }
}

fn expected_boundary_reactions(
    coordinates: &[[f64; 3]],
    node_map: &[usize],
    stress: [f64; 6],
) -> Vec<[f64; 3]> {
    // The face cycles use logical directions (j,k), (k,i), (i,j), whose cross
    // products point along +x,+y,+z. Reverse the cycles on negative normals.
    // This is a continuum surface-traction integral, independent of Hex8 K.
    let mut reaction = vec![[0.0; 3]; NODES];
    let mut counts = [0_usize; 2];
    for axis in 0..3 {
        for (side, low, high, positive, kind) in [
            (0, 0, N, false, 0),
            (N, 0, N, true, 0),
            (CAVITY_LO, CAVITY_LO, CAVITY_HI, true, 1),
            (CAVITY_HI, CAVITY_LO, CAVITY_HI, false, 1),
        ] {
            for a in low..high {
                for b in low..high {
                    let mut face = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]].map(|[s, t]| {
                        let [i, j, k] = match axis {
                            0 => [side, s, t],
                            1 => [t, side, s],
                            _ => [s, t, side],
                        };
                        node_map[logical_node(i, j, k)]
                    });
                    if !positive {
                        face.swap(1, 3);
                    }
                    assert!(!face.contains(&usize::MAX));
                    integrate_face_reaction(face, coordinates, stress, &mut reaction);
                    counts[kind] += 1;
                }
            }
        }
    }
    assert_eq!(counts, [6 * N * N, 6 * (CAVITY_HI - CAVITY_LO).pow(2)]);
    reaction
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

fn model() -> (Hex8VolumeRequest, Vec<u8>, Vec<usize>) {
    // Compact the 11³ nodes strictly inside the missing block before
    // permuting IDs. Multiplication by 73 is a bijection for NODES and CELLS.
    let mut node_map = vec![usize::MAX; (N + 1).pow(3)];
    let mut nodes = vec![[0.0; 3]; NODES];
    let mut kinds = vec![0_u8; NODES];
    let mut supports = Vec::new();
    let mut compact = 0;
    for k in 0..=N {
        for j in 0..=N {
            for i in 0..=N {
                if unused_node(i, j, k) {
                    continue;
                }
                let shuffled = (73 * compact + 17) % NODES;
                let x = position(i, j, k);
                let kind = boundary_kind(i, j, k);
                node_map[logical_node(i, j, k)] = shuffled;
                nodes[shuffled] = x;
                kinds[shuffled] = kind;
                if kind != 0 {
                    supports.push(Hex8VolumeSupport {
                        node: shuffled,
                        displacement_m: exact_displacement(x).map(Some),
                    });
                }
                compact += 1;
            }
        }
    }
    assert_eq!(compact, NODES);
    assert_eq!(supports.len(), 25_444);
    assert_eq!(kinds.iter().filter(|&&kind| kind == 1).count(), 24_578);
    assert_eq!(kinds.iter().filter(|&&kind| kind == 2).count(), 866);

    let mut shuffled_elements = vec![None; CELLS];
    let mut ordinal = 0;
    for k in 0..N {
        for j in 0..N {
            for i in 0..N {
                if inside_cavity_cell(i, j, k) {
                    continue;
                }
                let corners = [
                    [i, j, k],
                    [i + 1, j, k],
                    [i + 1, j + 1, k],
                    [i, j + 1, k],
                    [i, j, k + 1],
                    [i + 1, j, k + 1],
                    [i + 1, j + 1, k + 1],
                    [i, j + 1, k + 1],
                ];
                let cell = Hex8VolumeCell {
                    nodes: corners.map(|[a, b, c]| node_map[logical_node(a, b, c)]),
                    material: 0,
                };
                assert!(!cell.nodes.contains(&usize::MAX));
                let shuffled = (73 * ordinal + 19) % CELLS;
                assert!(shuffled_elements[shuffled].replace(cell).is_none());
                ordinal += 1;
            }
        }
    }
    assert_eq!(ordinal, CELLS);
    let elements = shuffled_elements.into_iter().map(Option::unwrap).collect();
    (
        Hex8VolumeRequest {
            nodes,
            materials: vec![Hex8VolumeMaterial {
                e_mpa: E_MPA,
                poisson: NU,
            }],
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
        kinds,
        node_map,
    )
}

#[test]
#[ignore = "260,416 general Hex8 cells around a closed 3D cavity; run explicitly in release with adequate RAM"]
fn shuffled_warped_3d_cavity_affine_patch() {
    assert_eq!(CELLS, 260_416);
    assert_eq!(NODES, 273_294);
    let (input, kinds, node_map) = model();
    let coordinates = input.nodes.clone();
    let expected_reactions =
        expected_boundary_reactions(&coordinates, &node_map, exact_stress_mpa());
    let started = Instant::now();
    let output = solve_hex8_volume(input).expect("3D cavity matrix-free Hex8 solve");
    let seconds = started.elapsed().as_secs_f64();
    let peak_kib = peak_rss_kib();
    assert_eq!(output.nodal_displacements_m.len(), NODES);
    assert_eq!(output.nodal_reactions_kn.len(), NODES);
    assert_eq!(output.element_gauss_stress_mpa.len(), CELLS);

    let stress = exact_stress_mpa();
    let mut max_displacement_error_m = 0.0_f64;
    let mut max_gauss_stress_error_mpa = 0.0_f64;
    let mut boundary_reaction_kn = [[0.0; 3]; 2];
    let mut max_free_reaction_kn = 0.0_f64;
    let mut max_reaction_error_kn = 0.0_f64;
    let mut max_expected_reaction_kn = 0.0_f64;
    for (node, actual) in output.nodal_displacements_m.iter().enumerate() {
        let expected = exact_displacement(coordinates[node]);
        for axis in 0..3 {
            max_displacement_error_m =
                max_displacement_error_m.max((actual[axis] - expected[axis]).abs());
            if kinds[node] == 0 {
                max_free_reaction_kn =
                    max_free_reaction_kn.max(output.nodal_reactions_kn[node][axis].abs());
            } else {
                boundary_reaction_kn[(kinds[node] - 1) as usize][axis] +=
                    output.nodal_reactions_kn[node][axis];
            }
            max_reaction_error_kn = max_reaction_error_kn.max(
                (output.nodal_reactions_kn[node][axis] - expected_reactions[node][axis]).abs(),
            );
            max_expected_reaction_kn =
                max_expected_reaction_kn.max(expected_reactions[node][axis].abs());
        }
    }
    for gauss in output.element_gauss_stress_mpa.iter().flatten() {
        for axis in 0..6 {
            max_gauss_stress_error_mpa =
                max_gauss_stress_error_mpa.max((gauss[axis] - stress[axis]).abs());
        }
    }
    eprintln!(
        "3D cavity Hex8: {CELLS} cells, {NODES} compacted shuffled nodes, {} DOF, 4 threads; \
         solve={seconds:.3}s, iterations={}, true relative residual={:.3e}, \
         max displacement error={max_displacement_error_m:.3e} m, \
         max Gauss stress error={max_gauss_stress_error_mpa:.3e} MPa, \
         max per-node reaction error={max_reaction_error_kn:.3e} kN, \
         max analytic reaction={max_expected_reaction_kn:.3e} kN, \
         max free reaction={max_free_reaction_kn:.3e} kN, \
         exterior/cavity reaction sums=({:?}, {:?}) kN, \
         analytic stress={stress:?} MPa, peak VmHWM={peak_kib:?} KiB",
        NODES * 3,
        output.iterations,
        output.relative_residual,
        boundary_reaction_kn[0],
        boundary_reaction_kn[1],
    );
    assert_eq!(output.solver_used, "matrixFreeGeneralLarge");
    assert_eq!(output.threads, 4);
    assert_eq!(output.csr_nonzeros, 0);
    assert!(output.relative_residual < 1e-7);
    assert!(max_displacement_error_m < 1e-7);
    assert!(max_gauss_stress_error_mpa < 0.01);
    assert!(max_free_reaction_kn < 0.01);
    assert!(max_expected_reaction_kn > 1.0);
    assert!(max_reaction_error_kn < 0.01);
    // Constant stress has zero total force on each closed surface. The scale
    // is the largest analytic stress times the outer cube area (MPa*m²→kN).
    let force_scale_kn = 1_000.0 * stress.iter().map(|v| v.abs()).fold(0.0, f64::max);
    for boundary in boundary_reaction_kn {
        for component in boundary {
            assert!(component.abs() < force_scale_kn * 1e-5);
        }
    }
}

const E_LEFT_MPA: f64 = 31_000.0;
const E_RIGHT_MPA: f64 = 62_000.0;
const SERIES_STRESS_MPA: f64 = 21.0;

fn exact_series_displacement(x: [f64; 3]) -> [f64; 3] {
    // Two elastic layers in series: σxx is continuous, while εxx=σxx/E
    // changes at the mesh-aligned plane x=1/2. ν=0 leaves all other strains
    // and stresses zero. Rigid translation exercises nonzero supports.
    [
        1e-4 + SERIES_STRESS_MPA
            * (x[0].min(0.5) / E_LEFT_MPA + (x[0] - 0.5).max(0.0) / E_RIGHT_MPA),
        -2e-4,
        5e-5,
    ]
}

#[test]
#[ignore = "260,416 heterogeneous warped Hex8 cells around a closed cavity; run in release with adequate RAM"]
fn shuffled_warped_3d_cavity_two_material_series_patch() {
    let (mut input, kinds, node_map) = model();
    // Keep the material interface exactly planar in physical x while warping
    // y and z. Every cell then reproduces its own affine displacement field.
    for k in 0..=N {
        for j in 0..=N {
            for i in 0..=N {
                let node = node_map[logical_node(i, j, k)];
                if node != usize::MAX {
                    input.nodes[node][0] = i as f64 / N as f64;
                }
            }
        }
    }
    input.materials = vec![
        Hex8VolumeMaterial {
            e_mpa: E_LEFT_MPA,
            poisson: 0.0,
        },
        Hex8VolumeMaterial {
            e_mpa: E_RIGHT_MPA,
            poisson: 0.0,
        },
    ];
    let mut material_counts = [0_usize; 2];
    for cell in &mut input.elements {
        let min_x = cell
            .nodes
            .iter()
            .map(|&node| input.nodes[node][0])
            .fold(f64::INFINITY, f64::min);
        let max_x = cell
            .nodes
            .iter()
            .map(|&node| input.nodes[node][0])
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(max_x <= 0.5 || min_x >= 0.5);
        cell.material = usize::from(min_x >= 0.5);
        material_counts[cell.material] += 1;
    }
    assert_eq!(material_counts, [130_208, 130_208]);
    for support in &mut input.supports {
        support.displacement_m = exact_series_displacement(input.nodes[support.node]).map(Some);
    }
    let coordinates = input.nodes.clone();
    let stress = [SERIES_STRESS_MPA, 0.0, 0.0, 0.0, 0.0, 0.0];
    let expected_reactions = expected_boundary_reactions(&coordinates, &node_map, stress);
    let started = Instant::now();
    let output = solve_hex8_volume(input).expect("heterogeneous 3D cavity Hex8 solve");
    let seconds = started.elapsed().as_secs_f64();
    let mut max_displacement_error_m = 0.0_f64;
    let mut max_stress_error_mpa = 0.0_f64;
    let mut max_reaction_error_kn = 0.0_f64;
    let mut max_free_reaction_kn = 0.0_f64;
    let mut max_expected_reaction_kn = 0.0_f64;
    let mut boundary_reaction_kn = [[0.0_f64; 3]; 2];
    for (node, actual) in output.nodal_displacements_m.iter().enumerate() {
        let expected = exact_series_displacement(coordinates[node]);
        for component in 0..3 {
            max_displacement_error_m =
                max_displacement_error_m.max((actual[component] - expected[component]).abs());
            max_reaction_error_kn = max_reaction_error_kn.max(
                (output.nodal_reactions_kn[node][component] - expected_reactions[node][component])
                    .abs(),
            );
            max_expected_reaction_kn =
                max_expected_reaction_kn.max(expected_reactions[node][component].abs());
            if kinds[node] == 0 {
                max_free_reaction_kn =
                    max_free_reaction_kn.max(output.nodal_reactions_kn[node][component].abs());
            } else {
                boundary_reaction_kn[(kinds[node] - 1) as usize][component] +=
                    output.nodal_reactions_kn[node][component];
            }
        }
    }
    for gauss in output.element_gauss_stress_mpa.iter().flatten() {
        for component in 0..6 {
            max_stress_error_mpa =
                max_stress_error_mpa.max((gauss[component] - stress[component]).abs());
        }
    }
    eprintln!(
        "heterogeneous 3D cavity Hex8: cells={CELLS}, materials={material_counts:?}, threads={}, iterations={}, residual={:.3e}, displacement_error={max_displacement_error_m:.3e} m, stress_error={max_stress_error_mpa:.3e} MPa, reaction_error={max_reaction_error_kn:.3e} kN, max_expected_reaction={max_expected_reaction_kn:.3e} kN, free_reaction={max_free_reaction_kn:.3e} kN, exterior/cavity_sums={boundary_reaction_kn:?} kN, seconds={seconds:.3}, peak_kib={:?}",
        output.threads,
        output.iterations,
        output.relative_residual,
        peak_rss_kib(),
    );
    assert_eq!(output.solver_used, "matrixFreeGeneralLarge");
    assert_eq!(output.threads, 4);
    assert_eq!(output.element_gauss_stress_mpa.len(), CELLS);
    assert!(output.relative_residual < 1e-7);
    assert!(max_displacement_error_m < 1e-7);
    assert!(max_stress_error_mpa < 0.01);
    assert!(max_expected_reaction_kn > 1.0);
    assert!(max_reaction_error_kn < 0.02);
    assert!(max_free_reaction_kn < 0.02);
    for boundary in boundary_reaction_kn {
        for component in boundary {
            assert!(component.abs() < SERIES_STRESS_MPA * 1_000.0 * 1e-5);
        }
    }
}
