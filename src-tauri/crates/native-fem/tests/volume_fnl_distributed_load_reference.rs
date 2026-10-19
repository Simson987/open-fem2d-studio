//! Independent reference checks for constant reference body force and face
//! traction on the experimental small-strain Tet4 FNL routes.
//!
//! The unit tetrahedron has V = 1/6 m³ and the opposite-origin face has
//! A = sqrt(3)/2 m². A constant body load contributes V*b/4 to each node;
//! a constant face traction contributes A*t/3 to its three face nodes.
//! Fully prescribed zero displacement makes the expected reaction exactly
//! the negative of this external nodal load, independent of constitutive law.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    self as concrete, ConcreteTetBodyForce, ConcreteTetFaceTraction, ConcreteTetOptions,
    ConcreteTetRequest, ConcreteTetTarget,
};
use openaec_native_fem::volume3d_j2::{
    self as j2, J2TetBodyForce, J2TetFaceTraction, J2TetOptions, J2TetRequest, J2TetTarget,
};

const BODY: [f64; 3] = [12.0, -6.0, 3.0]; // kN/m³
const FACE: [f64; 3] = [6.0, 4.0, -2.0]; // kN/m²

fn unit_tet() -> Mesh {
    Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        tets: vec![[0, 1, 2, 3]],
    }
}

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn external_load(node: usize, sign: f64) -> [f64; 3] {
    let volume_per_node = 1.0 / 24.0;
    let area_per_face_node = 3.0_f64.sqrt() / 6.0;
    std::array::from_fn(|axis| {
        sign * (volume_per_node * BODY[axis]
            + if node == 0 {
                0.0
            } else {
                area_per_face_node * FACE[axis]
            })
    })
}

fn j2_target(sign: f64, gamma: f64) -> J2TetTarget {
    let mesh = unit_tet();
    J2TetTarget {
        loads_kn: vec![[0.0; 3]; 4],
        body_forces: if sign == 0.0 {
            vec![]
        } else {
            vec![J2TetBodyForce {
                element: 0,
                force_kn_per_m3: BODY.map(|component| sign * component),
            }]
        },
        face_tractions: if sign == 0.0 {
            vec![]
        } else {
            vec![J2TetFaceTraction {
                element: 0,
                face_nodes: [1, 2, 3],
                traction_kn_per_m2: FACE.map(|component| sign * component),
            }]
        },
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| [Some(gamma * point[1]), Some(0.0), Some(0.0)])
            .collect(),
    }
}

fn j2_request(targets: Vec<J2TetTarget>) -> J2TetRequest {
    J2TetRequest {
        mesh: unit_tet(),
        steel: J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap(),
        element_steels: None,
        targets,
        options: J2TetOptions::default(),
    }
}

fn concrete_target(sign: f64, axial_strain: f64) -> ConcreteTetTarget {
    let mesh = unit_tet();
    ConcreteTetTarget {
        loads_kn: vec![[0.0; 3]; 4],
        body_forces: if sign == 0.0 {
            vec![]
        } else {
            vec![ConcreteTetBodyForce {
                element: 0,
                force_kn_per_m3: BODY.map(|component| sign * component),
            }]
        },
        face_tractions: if sign == 0.0 {
            vec![]
        } else {
            vec![ConcreteTetFaceTraction {
                element: 0,
                face_nodes: [1, 2, 3],
                traction_kn_per_m2: FACE.map(|component| sign * component),
            }]
        },
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| [Some(axial_strain * point[0]), Some(0.0), Some(0.0)])
            .collect(),
    }
}

fn concrete_request(targets: Vec<ConcreteTetTarget>) -> ConcreteTetRequest {
    ConcreteTetRequest {
        mesh: unit_tet(),
        e_mpa: 30_000.0,
        poisson: 0.0,
        tensile_strength_mpa: 3.0,
        fracture_energy_n_per_m: 1_000.0,
        crack_band_width_m: 1.0,
        element_materials: None,
        targets,
        options: ConcreteTetOptions::default(),
    }
}

#[test]
fn j2_fixed_tet_reactions_follow_load_clearing_and_reversal() {
    let targets = [
        j2_target(1.0, 0.0),
        j2_target(0.0, 0.0),
        j2_target(-1.0, 0.0),
    ];
    for (count, sign) in [(1, 1.0), (2, 0.0), (3, -1.0)] {
        let result = j2::solve(&j2_request(targets[..count].to_vec())).unwrap();
        close(result.true_free_residual_kn, 0.0, 1e-10, "J2 free residual");
        for node in 0..4 {
            for axis in 0..3 {
                close(
                    result.nodal_reactions_kn[node][axis],
                    -external_load(node, sign)[axis],
                    1e-9,
                    "J2 fixed reaction",
                );
                close(
                    result.nodal_displacements_m[node][axis],
                    0.0,
                    1e-12,
                    "J2 displacement",
                );
            }
        }
        close(
            result.element_states[0].equivalent_plastic_strain,
            0.0,
            1e-12,
            "J2 plastic strain",
        );
    }
}

#[test]
fn concrete_fixed_tet_reactions_follow_load_clearing_and_reversal() {
    let targets = [
        concrete_target(1.0, 0.0),
        concrete_target(0.0, 0.0),
        concrete_target(-1.0, 0.0),
    ];
    for (count, sign) in [(1, 1.0), (2, 0.0), (3, -1.0)] {
        let result = concrete::solve(&concrete_request(targets[..count].to_vec())).unwrap();
        close(
            result.true_free_residual_kn,
            0.0,
            1e-10,
            "concrete free residual",
        );
        for node in 0..4 {
            for axis in 0..3 {
                close(
                    result.nodal_reactions_kn[node][axis],
                    -external_load(node, sign)[axis],
                    1e-9,
                    "concrete fixed reaction",
                );
                close(
                    result.nodal_displacements_m[node][axis],
                    0.0,
                    1e-12,
                    "concrete displacement",
                );
            }
        }
        close(result.element_damage[0], 0.0, 1e-12, "concrete damage");
    }
}

#[test]
fn changing_distributed_load_with_fixed_strain_preserves_material_history() {
    // With all DOFs prescribed, changing only external load cannot change
    // strain. Reactions must change by precisely the negative new nodal load.
    let j2_base = j2::solve(&j2_request(vec![j2_target(0.0, 0.004)])).unwrap();
    let j2_loaded = j2::solve(&j2_request(vec![
        j2_target(0.0, 0.004),
        j2_target(1.0, 0.004),
    ]))
    .unwrap();
    assert!(j2_base.element_states[0].equivalent_plastic_strain > 0.0);
    close(
        j2_loaded.element_states[0].equivalent_plastic_strain,
        j2_base.element_states[0].equivalent_plastic_strain,
        1e-12,
        "J2 retained plastic strain",
    );
    for node in 0..4 {
        for axis in 0..3 {
            close(
                j2_loaded.nodal_reactions_kn[node][axis] - j2_base.nodal_reactions_kn[node][axis],
                -external_load(node, 1.0)[axis],
                1e-8,
                "J2 reaction difference",
            );
        }
    }

    let concrete_base =
        concrete::solve(&concrete_request(vec![concrete_target(0.0, 0.001)])).unwrap();
    let concrete_loaded = concrete::solve(&concrete_request(vec![
        concrete_target(0.0, 0.001),
        concrete_target(1.0, 0.001),
    ]))
    .unwrap();
    assert!(concrete_base.element_damage[0] > 0.0);
    close(
        concrete_loaded.element_states[0].max_equivalent_strain,
        concrete_base.element_states[0].max_equivalent_strain,
        1e-12,
        "concrete retained damage history",
    );
    close(
        concrete_loaded.element_damage[0],
        concrete_base.element_damage[0],
        1e-12,
        "concrete retained damage",
    );
    for node in 0..4 {
        for axis in 0..3 {
            close(
                concrete_loaded.nodal_reactions_kn[node][axis]
                    - concrete_base.nodal_reactions_kn[node][axis],
                -external_load(node, 1.0)[axis],
                1e-8,
                "concrete reaction difference",
            );
        }
    }
}
