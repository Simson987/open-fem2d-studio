//! Independent series-spring check on a connected, nonrectangular Hex8 mesh.
//! The L-shaped cross-section is identical at every x station, so for ν = 0
//! uniaxial stress is exact even though the nine cells have different shapes.
//! Node IDs and element traversal are deliberately unrelated to grid order.

use openaec_native_fem::volume_hex8::{
    solve_hex8_volume, Hex8LinearBackend, Hex8VolumeCell, Hex8VolumeMaterial, Hex8VolumeRequest,
    Hex8VolumeResponse, Hex8VolumeSupport,
};

const X: [f64; 4] = [0.0, 0.23, 0.61, 1.17];
const E_MPA: [f64; 3] = [24_000.0, 57_000.0, 35_000.0];
const END_U_M: f64 = 0.0013;
const SECTION_CELLS: [(usize, usize); 3] = [(0, 0), (1, 0), (0, 1)];

fn old_node(i: usize, j: usize, k: usize) -> usize {
    let section_index = match (j, k) {
        (0, 0) => 0,
        (1, 0) => 1,
        (2, 0) => 2,
        (0, 1) => 3,
        (1, 1) => 4,
        (2, 1) => 5,
        (0, 2) => 6,
        (1, 2) => 7,
        _ => unreachable!(),
    };
    8 * i + section_index
}

fn shuffled(old: usize) -> usize {
    // 11 and 32 are coprime, yielding a full permutation of the 32 nodes.
    (11 * old + 7) % 32
}

fn yz(j: usize, k: usize) -> [f64; 2] {
    let j = j as f64;
    let k = k as f64;
    [j + 0.13 * k + 0.035 * j * k, k + 0.08 * j - 0.025 * j * k]
}

fn section_area_m2() -> f64 {
    // Shoelace area of the outside L boundary, independent of the FE mapping.
    let boundary = [(0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2)];
    let twice_area: f64 = (0..boundary.len())
        .map(|n| {
            let a = yz(boundary[n].0, boundary[n].1);
            let b = yz(
                boundary[(n + 1) % boundary.len()].0,
                boundary[(n + 1) % boundary.len()].1,
            );
            a[0] * b[1] - a[1] * b[0]
        })
        .sum();
    twice_area.abs() / 2.0
}

fn sigma_mpa() -> f64 {
    let compliance: f64 = (0..3).map(|i| (X[i + 1] - X[i]) / E_MPA[i]).sum();
    END_U_M / compliance
}

fn exact_ux(i: usize) -> f64 {
    let sigma = sigma_mpa();
    (0..i)
        .map(|layer| sigma * (X[layer + 1] - X[layer]) / E_MPA[layer])
        .sum()
}

fn model() -> Hex8VolumeRequest {
    let mut nodes = vec![[0.0; 3]; 32];
    let mut stations = vec![0; 32];
    let mut supports = Vec::new();
    for i in 0..4 {
        for &(j, k) in &[
            (0, 0),
            (1, 0),
            (2, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (0, 2),
            (1, 2),
        ] {
            let node = shuffled(old_node(i, j, k));
            let [y, z] = yz(j, k);
            nodes[node] = [X[i], y, z];
            stations[node] = i;
            if i == 0 {
                supports.push(Hex8VolumeSupport {
                    node,
                    displacement_m: [Some(0.0); 3],
                });
            } else if i == 3 {
                supports.push(Hex8VolumeSupport {
                    node,
                    displacement_m: [Some(END_U_M), None, None],
                });
            }
        }
    }
    let mut elements = Vec::new();
    for i in 0..3 {
        for &(j, k) in &SECTION_CELLS {
            elements.push(Hex8VolumeCell {
                nodes: [
                    old_node(i, j, k),
                    old_node(i + 1, j, k),
                    old_node(i + 1, j + 1, k),
                    old_node(i, j + 1, k),
                    old_node(i, j, k + 1),
                    old_node(i + 1, j, k + 1),
                    old_node(i + 1, j + 1, k + 1),
                    old_node(i, j + 1, k + 1),
                ]
                .map(shuffled),
                material: i,
            });
        }
    }
    elements.rotate_left(4);
    elements.reverse();
    supports.reverse();
    assert_eq!(stations.iter().filter(|&&i| i == 0).count(), 8);
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
        tolerance: 1e-11,
        max_iterations: 1000,
        structured_grid_cells: None,
        threads: 1,
        linear_backend: Hex8LinearBackend::MatrixFreeGeneral,
    }
}

fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "actual {actual:e}, expected {expected:e}, tolerance {tolerance:e}"
    );
}

fn check_engineering_solution(
    request: &Hex8VolumeRequest,
    output: &Hex8VolumeResponse,
    solver_used: &str,
) {
    assert_eq!(output.solver_used, solver_used);
    if solver_used == "matrixFreeGeneral" {
        assert_eq!(output.csr_nonzeros, 0);
    } else {
        assert!(output.csr_nonzeros > 0);
    }
    assert!(output.relative_residual < 1e-10);
    let sigma = sigma_mpa();
    for (node, coordinate) in request.nodes.iter().enumerate() {
        let i = X.iter().position(|&x| x == coordinate[0]).unwrap();
        let expected = [exact_ux(i), 0.0, 0.0];
        for axis in 0..3 {
            close(
                output.nodal_displacements_m[node][axis],
                expected[axis],
                2e-11,
            );
            if i > 0 && i < 3 {
                close(output.nodal_reactions_kn[node][axis], 0.0, 2e-6);
            }
        }
    }
    for stress in output.element_gauss_stress_mpa.iter().flatten() {
        for (actual, expected) in stress.iter().zip([sigma, 0.0, 0.0, 0.0, 0.0, 0.0]) {
            close(*actual, expected, 2e-7);
        }
    }
    let end_force_kn = 1000.0 * sigma * section_area_m2();
    for (station, sign) in [(0, -1.0), (3, 1.0)] {
        let mut reaction = [0.0; 3];
        for (node, coordinate) in request.nodes.iter().enumerate() {
            if coordinate[0] == X[station] {
                for axis in 0..3 {
                    reaction[axis] += output.nodal_reactions_kn[node][axis];
                }
            }
        }
        close(reaction[0], sign * end_force_kn, 2e-5);
        close(reaction[1], 0.0, 2e-5);
        close(reaction[2], 0.0, 2e-5);
    }
}

#[test]
fn l_section_layered_series_solution_survives_shuffled_connectivity_and_four_threads() {
    let one_thread_request = model();
    assert_eq!(one_thread_request.elements.len(), 9);
    assert_eq!(one_thread_request.nodes.len(), 32);
    let one_thread = solve_hex8_volume(one_thread_request.clone()).unwrap();
    assert_eq!(one_thread.threads, 1);
    check_engineering_solution(&one_thread_request, &one_thread, "matrixFreeGeneral");

    let mut four_thread_request = one_thread_request.clone();
    four_thread_request.threads = 4;
    let four_thread = solve_hex8_volume(four_thread_request.clone()).unwrap();
    assert_eq!(four_thread.threads, 4);
    check_engineering_solution(&four_thread_request, &four_thread, "matrixFreeGeneral");

    let mut sparse_request = one_thread_request.clone();
    sparse_request.linear_backend = Hex8LinearBackend::Sparse;
    let sparse = solve_hex8_volume(sparse_request.clone()).unwrap();
    check_engineering_solution(&sparse_request, &sparse, "sparse");

    for (single, parallel) in one_thread
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(four_thread.nodal_displacements_m.iter().flatten())
    {
        close(*parallel, *single, 2e-12);
    }
    for (single, parallel) in one_thread
        .nodal_reactions_kn
        .iter()
        .flatten()
        .zip(four_thread.nodal_reactions_kn.iter().flatten())
    {
        close(*parallel, *single, 2e-6);
    }
    for reference in [&one_thread, &sparse] {
        for (actual, expected) in four_thread
            .nodal_displacements_m
            .iter()
            .flatten()
            .zip(reference.nodal_displacements_m.iter().flatten())
        {
            close(*actual, *expected, 2e-11);
        }
        for (actual, expected) in four_thread
            .nodal_reactions_kn
            .iter()
            .flatten()
            .zip(reference.nodal_reactions_kn.iter().flatten())
        {
            close(*actual, *expected, 2e-5);
        }
        for (actual, expected) in four_thread
            .element_gauss_stress_mpa
            .iter()
            .flatten()
            .flatten()
            .zip(
                reference
                    .element_gauss_stress_mpa
                    .iter()
                    .flatten()
                    .flatten(),
            )
        {
            close(*actual, *expected, 2e-7);
        }
    }
}
