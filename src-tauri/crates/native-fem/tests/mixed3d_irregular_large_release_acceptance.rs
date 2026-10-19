//! Versioned irregular mixed3d acceptance model (v1).
//!
//! Run the large gate explicitly:
//! `cargo test --release -p openaec-native-fem --test mixed3d_irregular_large_release_acceptance -- --ignored --nocapture`
//!
//! A smooth geometric warp, an internal void and an L-shaped cut make this a
//! nonaffine numerical/equilibrium acceptance test. It is not an analytic
//! displacement/stress-field reference; the separate affine mixed3d release
//! gate supplies that independent check. Both solid families, a diagonal
//! truss and a bending frame share nodes. The frame base rotations are fixed
//! while its translations remain coupled to the solids.

use std::time::Instant;

use openaec_native_fem::mixed3d::{
    solve, Frame3dMixedElement, Hex8MixedElement, Mixed3dBackend, Mixed3dRequest, Mixed3dResult,
    Truss3dElement,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const TIP_FORCE_KN: [f64; 3] = [0.75, -0.8, 3.0];
const TIP_MOMENT_KNM: [f64; 3] = [0.1, 0.25, -0.15];

#[derive(Clone, Copy)]
struct Dimensions {
    nx: usize,
    ny: usize,
    nz: usize,
}

impl Dimensions {
    fn id(self, i: usize, j: usize, k: usize) -> usize {
        i + (self.nx + 1) * (j + (self.ny + 1) * k)
    }

    fn removed(self, i: usize, j: usize, k: usize) -> bool {
        let l_cut = i >= 3 * self.nx / 4 && j >= 2 * self.ny / 3;
        let inner_void = i >= self.nx / 8
            && i < self.nx / 4
            && j >= self.ny / 3
            && j < self.ny / 2
            && k >= self.nz / 3
            && k < self.nz / 2;
        l_cut || inner_void
    }
}

struct GeneratedModel {
    request: Mixed3dRequest,
    frame_base: usize,
    frame_tip: usize,
    solid_nodes: usize,
}

fn generated_model(dims: Dimensions, threads: usize, backend: Mixed3dBackend) -> GeneratedModel {
    assert!(dims.nx >= 8 && dims.ny >= 6 && dims.nz >= 6);
    assert_eq!(dims.nx % 2, 0);
    let split = dims.nx / 2;
    let Mesh { mut nodes, tets } =
        Mesh::structured([dims.nx, dims.ny, dims.nz]).expect("structured topology");
    // The warp is small compared with the smallest cell size. It preserves
    // positive Jacobians, but makes Hex8 maps nonconstant and Tet4 nonuniform.
    for k in 0..=dims.nz {
        for j in 0..=dims.ny {
            for i in 0..=dims.nx {
                let p = &mut nodes[dims.id(i, j, k)];
                p[0] += 0.002 * p[0] * (0.37 * j as f64).sin() * (0.23 * k as f64).sin();
                p[1] += 0.002 * (0.30 * i as f64).sin() * (0.21 * k as f64).sin();
                p[2] += 0.002 * (0.25 * i as f64).sin() * (0.27 * j as f64).sin();
            }
        }
    }

    let mut hexes = Vec::new();
    for k in 0..dims.nz {
        for j in 0..dims.ny {
            for i in 0..split {
                if dims.removed(i, j, k) {
                    continue;
                }
                hexes.push(Hex8MixedElement {
                    nodes: [
                        dims.id(i, j, k),
                        dims.id(i + 1, j, k),
                        dims.id(i + 1, j + 1, k),
                        dims.id(i, j + 1, k),
                        dims.id(i, j, k + 1),
                        dims.id(i + 1, j, k + 1),
                        dims.id(i + 1, j + 1, k + 1),
                        dims.id(i, j + 1, k + 1),
                    ],
                    e_mpa: if j < dims.ny / 2 { 8_000.0 } else { 11_000.0 },
                    poisson: 0.23,
                });
            }
        }
    }
    let mut selected_tets = Vec::new();
    let mut tet_materials = Vec::new();
    for tet in tets {
        let i = tet.iter().map(|&node| node % (dims.nx + 1)).min().unwrap();
        if i < split {
            continue;
        }
        let j = tet
            .iter()
            .map(|&node| node / (dims.nx + 1) % (dims.ny + 1))
            .min()
            .unwrap();
        let k = tet
            .iter()
            .map(|&node| node / ((dims.nx + 1) * (dims.ny + 1)))
            .min()
            .unwrap();
        if dims.removed(i, j, k) {
            continue;
        }
        selected_tets.push(tet);
        tet_materials.push(Volume3dMaterial {
            e_mpa: if k < dims.nz / 2 { 12_000.0 } else { 15_000.0 },
            poisson: 0.21,
        });
    }

    let truss_old = [
        dims.id(split - 1, dims.ny / 4, dims.nz / 4),
        dims.id(split + 2, dims.ny / 4 + 2, dims.nz / 4 + 1),
    ];
    let frame_base_old = dims.id(dims.nx - 2, dims.ny / 4, dims.nz / 2);
    let mut frame_tip_point = nodes[frame_base_old];
    frame_tip_point[0] += 0.15;
    let frame_tip_old = nodes.len();
    nodes.push(frame_tip_point);

    // Remove nodes inside the cavity or cut that no element uses. The compact
    // renumbering is deterministic and leaves exactly one extra frame tip.
    let mut used = vec![false; nodes.len()];
    for tet in &selected_tets {
        for &node in tet {
            used[node] = true;
        }
    }
    for hex in &hexes {
        for &node in &hex.nodes {
            used[node] = true;
        }
    }
    for node in [truss_old[0], truss_old[1], frame_base_old, frame_tip_old] {
        used[node] = true;
    }
    let mut map = vec![usize::MAX; nodes.len()];
    let mut compact_nodes = Vec::with_capacity(used.iter().filter(|&&v| v).count());
    for (old, &active) in used.iter().enumerate() {
        if active {
            map[old] = compact_nodes.len();
            compact_nodes.push(nodes[old]);
        }
    }
    for tet in &mut selected_tets {
        *tet = tet.map(|node| map[node]);
    }
    for hex in &mut hexes {
        hex.nodes = hex.nodes.map(|node| map[node]);
    }
    let frame_base = map[frame_base_old];
    let frame_tip = map[frame_tip_old];
    let solid_nodes = compact_nodes.len() - 1;
    let mut loads_kn = vec![[0.0; 3]; compact_nodes.len()];
    for j in [dims.ny / 8, dims.ny / 4, dims.ny / 2] {
        for k in [dims.nz / 6, dims.nz / 2, 5 * dims.nz / 6] {
            let node = map[dims.id(dims.nx, j, k)];
            assert_ne!(node, usize::MAX, "right-edge loaded node is unused");
            loads_kn[node][0] += 0.4;
            loads_kn[node][1] += 0.05;
            loads_kn[node][2] -= 0.3;
        }
    }
    loads_kn[frame_tip] = TIP_FORCE_KN;
    let mut moments_knm = vec![[0.0; 3]; compact_nodes.len()];
    moments_knm[frame_tip] = TIP_MOMENT_KNM;
    let prescribed_m = compact_nodes
        .iter()
        .map(|node| {
            if node[0].abs() < 1e-14 {
                [Some(0.0); 3]
            } else {
                [None; 3]
            }
        })
        .collect();
    let mut prescribed_rotations_rad = vec![[None; 3]; compact_nodes.len()];
    prescribed_rotations_rad[frame_base] = [Some(0.0); 3];
    let request = Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes: compact_nodes,
            tets: selected_tets,
        },
        solid_material: Volume3dMaterial {
            e_mpa: 12_000.0,
            poisson: 0.21,
        },
        tet_materials: Some(tet_materials),
        hexes,
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![Truss3dElement {
            nodes: truss_old.map(|node| map[node]),
            e_mpa: 210_000.0,
            area_m2: 0.0004,
        }],
        frames: vec![Frame3dMixedElement {
            nodes: [frame_base, frame_tip],
            e_mpa: 210_000.0,
            poisson: 0.3,
            g_mpa: None,
            area_m2: 0.003,
            iy_m4: 0.00002,
            iz_m4: 0.00003,
            torsion_j_m4: 0.00005,
            roll_angle_rad: 0.0,
        }],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        loads_kn,
        moments_knm,
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m,
        prescribed_rotations_rad,
        backend,
        max_front_dofs: 128,
        threads,
        max_pcg_iterations: 15_000,
    };
    GeneratedModel {
        request,
        frame_base,
        frame_tip,
        solid_nodes,
    }
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn check_result(model: &GeneratedModel, result: &Mixed3dResult) {
    let input = &model.request;
    assert_eq!(result.backend_used, input.backend);
    assert_eq!(result.nodal_displacements_m.len(), input.mesh.nodes.len());
    assert_eq!(result.nodal_reactions_kn.len(), input.mesh.nodes.len());
    assert_eq!(result.solid_element_stress_mpa.len(), input.mesh.tets.len());
    assert_eq!(result.hex_gauss_stress_mpa.len(), input.hexes.len());
    assert_eq!(result.truss_axial_force_kn.len(), 1);
    assert_eq!(result.frame_end_forces_local.len(), 1);
    assert!(result.linear_iterations > 0);
    assert!(
        result.relative_residual < 1e-8,
        "relative residual {}",
        result.relative_residual
    );

    let mut force_error = [0.0; 3];
    let mut moment_error = [0.0; 3];
    for (node, &position) in input.mesh.nodes.iter().enumerate() {
        let total_force = std::array::from_fn(|axis| {
            input.loads_kn[node][axis] + result.nodal_reactions_kn[node][axis]
        });
        let force_moment = cross(position, total_force);
        for axis in 0..3 {
            force_error[axis] += total_force[axis];
            moment_error[axis] += force_moment[axis] + input.moments_knm[node][axis];
        }
        if let Some(reaction) = result.nodal_moment_reactions_knm[node] {
            for axis in 0..3 {
                moment_error[axis] += reaction[axis];
            }
        }
    }
    for axis in 0..3 {
        assert!(
            force_error[axis].abs() < 5e-3,
            "force equilibrium axis {axis}: {} kN",
            force_error[axis]
        );
        assert!(
            moment_error[axis].abs() < 5e-3,
            "moment equilibrium axis {axis}: {} kNm",
            moment_error[axis]
        );
    }

    for value in result
        .nodal_displacements_m
        .iter()
        .flatten()
        .chain(result.solid_element_stress_mpa.iter().flatten())
        .chain(result.hex_gauss_stress_mpa.iter().flatten().flatten())
    {
        assert!(value.is_finite(), "nonfinite displacement or stress");
    }
    assert!(result.truss_axial_force_kn[0].is_finite());
    assert!(result.truss_axial_force_kn[0].abs() > 1e-5);
    let z = result.nodal_displacements_m[..model.solid_nodes]
        .iter()
        .map(|u| u[2]);
    let (min_z, max_z) = z.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| {
        (lo.min(v), hi.max(v))
    });
    assert!(max_z - min_z > 1e-7, "deformation is unexpectedly uniform");
    assert_eq!(result.nodal_rotations_rad[model.frame_base], Some([0.0; 3]));
    let tip_rotation = result.nodal_rotations_rad[model.frame_tip].unwrap();
    assert!(tip_rotation.iter().any(|v| v.abs() > 1e-7));

    // The single free frame tip has no other attached element. Its local
    // stiffness end vector must equal the applied tip wrench. The frame is
    // exactly along +x and has zero roll, so local and global axes coincide.
    for axis in 0..3 {
        let tip_force = result.frame_end_forces_local[0][1][axis];
        let tip_moment = result.frame_end_forces_local[0][1][axis + 3];
        assert!(
            (tip_force - TIP_FORCE_KN[axis]).abs() < 2e-4,
            "frame tip force axis {axis}: {tip_force}"
        );
        assert!(
            (tip_moment - TIP_MOMENT_KNM[axis]).abs() < 2e-4,
            "frame tip moment axis {axis}: {tip_moment}"
        );
    }
    let frame_shear = result.frame_end_forces_local[0][0][2].abs();
    assert!((frame_shear - TIP_FORCE_KN[2].abs()).abs() < 2e-4);
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

#[test]
fn small_irregular_model_matches_sparse_pcg_and_matrix_free() {
    let dims = Dimensions {
        nx: 8,
        ny: 6,
        nz: 6,
    };
    let sparse_model = generated_model(dims, 1, Mixed3dBackend::SparsePcg);
    let sparse = solve(&sparse_model.request).expect("sparse reference for irregular mixed model");
    check_result(&sparse_model, &sparse);
    let matrix_free_model = generated_model(dims, 4, Mixed3dBackend::MatrixFreePcg);
    let matrix_free = solve(&matrix_free_model.request).expect("matrix-free irregular mixed model");
    check_result(&matrix_free_model, &matrix_free);
    let max_difference = sparse
        .nodal_displacements_m
        .iter()
        .flatten()
        .zip(matrix_free.nodal_displacements_m.iter().flatten())
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f64::max);
    assert!(
        max_difference < 1e-8,
        "backend displacement difference {max_difference} m"
    );
}

#[test]
#[ignore = "55,232 warped Tet4/Hex8 elements with a void, an L cut, a truss and a bending frame; run in release with adequate RAM"]
fn large_irregular_void_and_l_cut_matrix_free_four_threads() {
    let model = generated_model(
        Dimensions {
            nx: 32,
            ny: 24,
            nz: 24,
        },
        4,
        Mixed3dBackend::MatrixFreePcg,
    );
    let tets = model.request.mesh.tets.len();
    let hexes = model.request.hexes.len();
    assert_eq!(tets, 46_080);
    assert_eq!(hexes, 9_152);
    assert_eq!(tets + hexes, 55_232);
    assert!(model.solid_nodes < (32 + 1) * (24 + 1) * (24 + 1));
    let started = Instant::now();
    let result = solve(&model.request).expect("large warped mixed3d solve");
    let seconds = started.elapsed().as_secs_f64();
    check_result(&model, &result);
    eprintln!(
        "mixed3d irregular v1: {tets} Tet4 + {hexes} Hex8 = {} volumes, {} nodes, 1 truss, 1 frame; \
         4 threads, solve={seconds:.3}s, iterations={}, residual={:.3e}, peak VmHWM={:?} KiB",
        tets + hexes,
        model.request.mesh.nodes.len(),
        result.linear_iterations,
        result.relative_residual,
        peak_rss_kib()
    );
}

#[test]
#[ignore = "257,728 warped Tet4/Hex8 elements with a void, an L cut, a truss and a bending frame; run in release with adequate RAM"]
fn massive_irregular_250k_matrix_free_four_threads() {
    let model = generated_model(
        Dimensions {
            nx: 64,
            ny: 48,
            nz: 28,
        },
        4,
        Mixed3dBackend::MatrixFreePcg,
    );
    let tets = model.request.mesh.tets.len();
    let hexes = model.request.hexes.len();
    assert_eq!(tets, 215_040);
    assert_eq!(hexes, 42_688);
    assert_eq!(tets + hexes, 257_728);
    assert_eq!(model.request.mesh.nodes.len(), 84_746);
    let started = Instant::now();
    let result = solve(&model.request).expect("massive warped mixed3d solve");
    let seconds = started.elapsed().as_secs_f64();
    check_result(&model, &result);
    eprintln!(
        "mixed3d irregular v1: {tets} Tet4 + {hexes} Hex8 = {} volumes, {} nodes, 1 truss, 1 frame; \
         4 threads, solve={seconds:.3}s, iterations={}, residual={:.3e}, peak VmHWM={:?} KiB",
        tets + hexes,
        model.request.mesh.nodes.len(),
        result.linear_iterations,
        result.relative_residual,
        peak_rss_kib()
    );
}
