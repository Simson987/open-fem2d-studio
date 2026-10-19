//! Scalar mixed-boundary reference for one finite-strain Tet4.
//!
//! Only the x displacement at (1,0,0) is free. The unit right tetrahedron
//! then has F=diag(s,1,1), volume 1/6, and Green strain e=(s²-1)/2 in x.
//! Unlike an axial patch with nu=0, constrained Poisson strain produces
//! transverse reactions. The nominal axial load and every constrained
//! reaction follow directly from the closed-form StVK energy, without
//! assembling element gradients or using the solver's constitutive routine.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{solve, GnlTetOptions, GnlTetRequest, GnlTetTarget};

const YOUNG_MPA: f64 = 120.0;
const POISSON: f64 = 0.25;
const BETA: f64 = 16.0;
const VOLUME_M3: f64 = 1.0 / 6.0;
const LOADS_KN: [f64; 3] = [1_200.0, -600.0, 0.0];

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.3e}"
    );
}

fn analytic_state(stretch: f64) -> (f64, f64, f64, f64) {
    let green = (stretch * stretch - 1.0) / 2.0;
    let lame = YOUNG_MPA * POISSON / ((1.0 + POISSON) * (1.0 - 2.0 * POISSON));
    let shear = YOUNG_MPA / (2.0 * (1.0 + POISSON));
    let axial_s0 = (lame + 2.0 * shear) * green;
    let energy0 = axial_s0 * green / 2.0;
    let factor = 1.0 + BETA * energy0 / YOUNG_MPA;
    let axial_p = stretch * axial_s0 * factor;
    let transverse_p = lame * green * factor;
    (green, axial_p, transverse_p, factor)
}

fn expected_stretch(load_kn: f64) -> f64 {
    let nominal_load = |stretch| 1_000.0 * VOLUME_M3 * analytic_state(stretch).1;
    let (mut low, mut high) = (0.8, 1.2);
    assert!(nominal_load(low) < load_kn && nominal_load(high) > load_kn);
    for _ in 0..100 {
        let middle = (low + high) / 2.0;
        if nominal_load(middle) < load_kn {
            low = middle;
        } else {
            high = middle;
        }
    }
    (low + high) / 2.0
}

fn target(load_kn: f64) -> GnlTetTarget {
    let mut loads_kn = vec![[0.0; 3]; 4];
    loads_kn[1][0] = load_kn;
    let mut prescribed_m = vec![[Some(0.0); 3]; 4];
    prescribed_m[1][0] = None;
    GnlTetTarget {
        loads_kn,
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

#[test]
fn axial_force_path_predicts_poisson_reactions_and_finite_stress() {
    let mesh = Mesh {
        nodes: vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        tets: vec![[0, 1, 2, 3]],
    };
    for prefix in 1..=LOADS_KN.len() {
        let load = LOADS_KN[prefix - 1];
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: YOUNG_MPA,
            poisson: POISSON,
            element_materials: None,
            element_energy_beta: Some(vec![BETA]),
            targets: LOADS_KN[..prefix].iter().copied().map(target).collect(),
            options: GnlTetOptions::default(),
        })
        .unwrap();

        let stretch = expected_stretch(load);
        let (green, axial_p, transverse_p, factor) = analytic_state(stretch);
        close(
            result.nodal_displacements_m[1][0],
            stretch - 1.0,
            2e-10,
            "free axial displacement",
        );
        for (node, displacement) in result.nodal_displacements_m.iter().enumerate() {
            for axis in 0..3 {
                if node != 1 || axis != 0 {
                    close(displacement[axis], 0.0, 1e-12, "prescribed displacement");
                }
            }
        }
        let expected_green = [[green, 0.0, 0.0], [0.0; 3], [0.0; 3]];
        let expected_piola = [
            [axial_p, 0.0, 0.0],
            [0.0, transverse_p, 0.0],
            [0.0, 0.0, transverse_p],
        ];
        for row in 0..3 {
            for col in 0..3 {
                close(
                    result.element_green_strain[0][row][col],
                    expected_green[row][col],
                    2e-10,
                    "Green strain",
                );
                close(
                    result.element_first_piola_mpa[0][row][col],
                    expected_piola[row][col],
                    2e-8,
                    "first Piola stress",
                );
            }
        }
        close(
            result.element_effective_e_mpa[0],
            YOUNG_MPA * factor,
            2e-9,
            "effective modulus",
        );

        // Grad N_0=(-1,-1,-1), Grad N_i=e_i for the three axis nodes.
        // The free x reaction at node 1 must vanish after subtracting its load.
        let scale = 1_000.0 * VOLUME_M3;
        let expected_reactions = [
            [
                -scale * axial_p,
                -scale * transverse_p,
                -scale * transverse_p,
            ],
            [0.0; 3],
            [0.0, scale * transverse_p, 0.0],
            [0.0, 0.0, scale * transverse_p],
        ];
        for (node, expected) in expected_reactions.iter().enumerate() {
            for axis in 0..3 {
                close(
                    result.nodal_reactions_kn[node][axis],
                    expected[axis],
                    2e-6,
                    "nodal reaction",
                );
            }
        }
        close(result.true_free_residual_kn, 0.0, 2e-6, "free residual");
        assert_eq!(
            result.accepted_steps.last().unwrap().target_index,
            prefix - 1
        );
    }
}
