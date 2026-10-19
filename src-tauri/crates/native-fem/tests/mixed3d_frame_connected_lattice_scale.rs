//! Connected 3D bending frame with real transverse load transfer and torsion.
//! Members are ordered station by station so the frontal width is bounded by
//! two neighboring 4×4 sections, not by the total length of the structure.

use openaec_native_fem::mixed3d::{
    solve, Frame3dMixedElement, Mixed3dBackend, Mixed3dRequest, Mixed3dResult,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

const SIDE: usize = 4;
const E_MPA: f64 = 210_000.0;

fn id(station: usize, y: usize, z: usize) -> usize {
    station * SIDE * SIDE + y * SIDE + z
}

fn model(stations: usize, backend: Mixed3dBackend, iterations: usize) -> Mixed3dRequest {
    assert!(stations >= 2);
    let nodes: Vec<[f64; 3]> = (0..stations)
        .flat_map(|station| {
            (0..SIDE).flat_map(move |y| {
                (0..SIDE).map(move |z| [0.25 * station as f64, y as f64, z as f64])
            })
        })
        .collect();
    let mut frames = Vec::new();
    let mut add = |a: usize, b: usize| {
        frames.push(Frame3dMixedElement {
            nodes: [a, b],
            e_mpa: E_MPA,
            poisson: 0.3,
            g_mpa: None,
            area_m2: 0.02,
            iy_m4: 0.001,
            iz_m4: 0.001,
            torsion_j_m4: 0.002,
            roll_angle_rad: 0.0,
        });
    };
    for station in 0..stations {
        // Complete each station's transverse grid before starting its links
        // to the next station. The links are the last elements that touch the
        // previous section and make those DOFs eligible for elimination.
        for y in 0..SIDE {
            for z in 0..SIDE {
                if y + 1 < SIDE {
                    add(id(station, y, z), id(station, y + 1, z));
                }
                if z + 1 < SIDE {
                    add(id(station, y, z), id(station, y, z + 1));
                }
            }
        }
        if station + 1 < stations {
            for y in 0..SIDE {
                for z in 0..SIDE {
                    add(id(station, y, z), id(station + 1, y, z));
                }
            }
        }
    }
    let mut loads_kn = vec![[0.0; 3]; nodes.len()];
    let mut moments_knm = loads_kn.clone();
    let tip = id(stations - 1, SIDE - 1, SIDE - 1);
    loads_kn[tip] = [1.0, 0.0, -10.0];
    moments_knm[tip] = [0.0, 1.0, 0.0];
    let mut prescribed_m = vec![[None; 3]; nodes.len()];
    let mut prescribed_rotations_rad = prescribed_m.clone();
    for node in 0..SIDE * SIDE {
        prescribed_m[node] = [Some(0.0); 3];
        prescribed_rotations_rad[node] = [Some(0.0); 3];
    }
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes,
            tets: vec![],
        },
        solid_material: Volume3dMaterial {
            e_mpa: E_MPA,
            poisson: 0.3,
        },
        tet_materials: None,
        hexes: vec![],
        trusses: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        frames,
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
        max_front_dofs: 256,
        threads: 4,
        max_pcg_iterations: iterations,
    }
}

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() < tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.2e}"
    );
}

fn check_global_equilibrium(input: &Mixed3dRequest, result: &Mixed3dResult) {
    let mut force = [0.0; 3];
    let mut moment = [0.0; 3];
    for node in 0..input.mesh.nodes.len() {
        let position = input.mesh.nodes[node];
        let resultant: [f64; 3] = std::array::from_fn(|axis| {
            input.loads_kn[node][axis] + result.nodal_reactions_kn[node][axis]
        });
        let moment_reaction = result.nodal_moment_reactions_knm[node].unwrap();
        for axis in 0..3 {
            force[axis] += resultant[axis];
            moment[axis] += input.moments_knm[node][axis] + moment_reaction[axis];
        }
        moment[0] += position[1] * resultant[2] - position[2] * resultant[1];
        moment[1] += position[2] * resultant[0] - position[0] * resultant[2];
        moment[2] += position[0] * resultant[1] - position[1] * resultant[0];
    }
    for axis in 0..3 {
        close(force[axis], 0.0, 1e-5, "global force balance");
        close(moment[axis], 0.0, 1e-4, "global moment balance");
    }
    assert!(result.relative_residual < 1e-8);
    assert_eq!(result.frame_end_forces_local.len(), input.frames.len());
    assert!(result
        .frame_end_forces_local
        .iter()
        .flatten()
        .flatten()
        .all(|value| value.is_finite()));
}

#[test]
fn small_connected_lattice_matches_sparse_direct_and_frontal() {
    let input = model(4, Mixed3dBackend::FrontalWave, 20_000);
    let frontal = solve(&input).expect("small connected frontal frame");
    let sparse = solve(&model(4, Mixed3dBackend::SparseDirect, 20_000))
        .expect("small connected sparse frame");
    check_global_equilibrium(&input, &frontal);
    check_global_equilibrium(&input, &sparse);
    for (a, b) in frontal
        .nodal_displacements_m
        .iter()
        .zip(&sparse.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-8, "small lattice translation parity");
        }
    }
    for (a, b) in frontal
        .nodal_rotations_rad
        .iter()
        .zip(&sparse.nodal_rotations_rad)
    {
        for axis in 0..3 {
            close(
                a.unwrap()[axis],
                b.unwrap()[axis],
                1e-8,
                "small lattice rotation parity",
            );
        }
    }
}

#[test]
#[ignore = "12,288-DOF connected 3D frame fallback; run explicitly in release"]
fn large_connected_lattice_automatic_recovers_with_bounded_front() {
    let input = model(128, Mixed3dBackend::Automatic, 1);
    assert_eq!(input.mesh.nodes.len(), 2_048);
    assert_eq!(input.frames.len(), 5_104);
    let automatic = solve(&input).expect("large connected automatic frame");
    assert_eq!(automatic.backend_used, Mixed3dBackend::FrontalWave);
    assert!(automatic.frontal_maximum_front_dofs.unwrap() <= 256);
    check_global_equilibrium(&input, &automatic);
    let tip = id(127, 3, 3);
    assert!(automatic.nodal_displacements_m[tip][2] < 0.0);
    eprintln!(
        "connected frame: {} members, 12,288 DOF, max front {:?}, tip uz={:.9e} m, residual={:.3e}",
        input.frames.len(),
        automatic.frontal_maximum_front_dofs,
        automatic.nodal_displacements_m[tip][2],
        automatic.relative_residual
    );
}

#[test]
#[ignore = "12,288-DOF connected lattice affine axial patch; run explicitly in release"]
fn large_connected_lattice_axial_patch_matches_closed_form() {
    let stations = 128;
    let mut input = model(stations, Mixed3dBackend::FrontalWave, 20_000);
    input.loads_kn.fill([0.0; 3]);
    input.moments_knm.fill([0.0; 3]);
    for y in 0..SIDE {
        for z in 0..SIDE {
            input.loads_kn[id(stations - 1, y, z)][0] = 1.0;
        }
    }
    let result = solve(&input).expect("large connected axial patch");
    check_global_equilibrium(&input, &result);
    let ea_kn = 1_000.0 * E_MPA * 0.02;
    let mut max_displacement_error = 0.0_f64;
    let mut max_force_error = 0.0_f64;
    for station in 0..stations {
        let exact_ux = 0.25 * station as f64 / ea_kn;
        for y in 0..SIDE {
            for z in 0..SIDE {
                let node = id(station, y, z);
                let u = result.nodal_displacements_m[node];
                max_displacement_error = max_displacement_error.max((u[0] - exact_ux).abs());
                close(u[1], 0.0, 1e-9, "axial patch uy");
                close(u[2], 0.0, 1e-9, "axial patch uz");
                for &rotation in &result.nodal_rotations_rad[node].unwrap() {
                    close(rotation, 0.0, 1e-9, "axial patch rotation");
                }
            }
        }
    }
    close(
        max_displacement_error,
        0.0,
        1e-10,
        "axial patch max displacement error",
    );
    for (frame, end_forces) in input.frames.iter().zip(&result.frame_end_forces_local) {
        let [a, b] = frame.nodes.map(|node| input.mesh.nodes[node]);
        let longitudinal = (b[0] - a[0]).abs() > 0.0;
        let target = if longitudinal { 1.0 } else { 0.0 };
        max_force_error = max_force_error.max((end_forces[0][0].abs() - target).abs());
        for end in end_forces {
            for &force_or_moment in &end[1..] {
                close(force_or_moment, 0.0, 1e-5, "axial patch bending/shear");
            }
        }
    }
    close(
        max_force_error,
        0.0,
        1e-5,
        "axial patch max axial force error",
    );
    eprintln!(
        "128-station 3D frame axial patch: max ux error={max_displacement_error:.3e} m, max N error={max_force_error:.3e} kN"
    );
}

#[test]
#[ignore = "12,288-DOF four-thread matrix-free lattice; run explicitly in release"]
fn large_connected_lattice_matrix_free_matches_frontal() {
    let stations = 128;
    let input = model(stations, Mixed3dBackend::MatrixFreePcg, 20_000);
    let matrix_free = solve(&input).expect("connected matrix-free frame");
    assert_eq!(matrix_free.backend_used, Mixed3dBackend::MatrixFreePcg);
    check_global_equilibrium(&input, &matrix_free);
    let frontal = solve(&model(stations, Mixed3dBackend::FrontalWave, 20_000))
        .expect("connected frontal reference");
    let mut max_translation_difference = 0.0_f64;
    let mut max_rotation_difference = 0.0_f64;
    for node in 0..input.mesh.nodes.len() {
        for axis in 0..3 {
            max_translation_difference = max_translation_difference.max(
                (matrix_free.nodal_displacements_m[node][axis]
                    - frontal.nodal_displacements_m[node][axis])
                    .abs(),
            );
            max_rotation_difference = max_rotation_difference.max(
                (matrix_free.nodal_rotations_rad[node].unwrap()[axis]
                    - frontal.nodal_rotations_rad[node].unwrap()[axis])
                    .abs(),
            );
        }
    }
    close(
        max_translation_difference,
        0.0,
        1e-7,
        "matrix-free/front all-node translation parity",
    );
    close(
        max_rotation_difference,
        0.0,
        1e-7,
        "matrix-free/front all-node rotation parity",
    );
    eprintln!(
        "{stations} stations: matrix-free iterations={}, residual={:.3e}, max du={max_translation_difference:.3e} m, max dr={max_rotation_difference:.3e} rad",
        matrix_free.linear_iterations, matrix_free.relative_residual,
    );
}
