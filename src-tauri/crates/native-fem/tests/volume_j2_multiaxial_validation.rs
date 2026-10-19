//! Closed-form hydrostatic plus simple-shear patch for the public J2 Tet4 solver.
//! The hydrostatic and deviatoric responses decouple. For a first monotonic
//! shear increment, q_trial = sqrt(3) G gamma and consistency gives
//! p = (q_trial - sigma_y)/(3G + H). On a subsequent elastic unload,
//! tau_xy changes by G delta_gamma while p remains fixed.

use openaec_native_fem::solid_j2::J2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_j2::{
    solve, J2TetLinearBackend, J2TetOptions, J2TetRequest, J2TetTarget,
};

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn target(mesh: &Mesh, dilation: f64, shear: f64) -> J2TetTarget {
    let prescribed_m = mesh
        .nodes
        .iter()
        .map(|&[x, y, z]| {
            if [x, y, z] == [0.5, 0.5, 0.5] {
                [None; 3]
            } else {
                [
                    Some(dilation * x + shear * y),
                    Some(dilation * y),
                    Some(dilation * z),
                ]
            }
        })
        .collect();
    J2TetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m,
        body_forces: vec![],
        face_tractions: vec![],
    }
}

#[test]
fn multiaxial_plastic_loading_with_cutbacks_then_elastic_unload() {
    let mesh = Mesh::structured([2, 2, 2]).unwrap();
    let steel = J2Steel::new(200_000.0, 0.3, 250.0, 2_000.0).unwrap();
    let (dilation_peak, shear_peak) = (0.0002, 0.004);
    let (dilation_end, shear_end) = (-0.0001, 0.0035);
    let shear_modulus = steel.youngs_mpa / (2.0 * (1.0 + steel.poisson));
    let bulk_modulus = steel.youngs_mpa / (3.0 * (1.0 - 2.0 * steel.poisson));
    let trial_q = 3.0_f64.sqrt() * shear_modulus * shear_peak;
    let plastic_p = (trial_q - steel.yield_mpa) / (3.0 * shear_modulus + steel.hardening_mpa);
    let peak_tau = (steel.yield_mpa + steel.hardening_mpa * plastic_p) / 3.0_f64.sqrt();
    let end_tau = peak_tau + shear_modulus * (shear_end - shear_peak);
    assert!(trial_q > steel.yield_mpa);
    assert!(3.0_f64.sqrt() * end_tau.abs() < steel.yield_mpa + steel.hardening_mpa * plastic_p);

    let mut options = J2TetOptions::default();
    options.max_newton_iterations = 3;
    options.max_step_cutbacks = 30;
    options.min_step_fraction = 1.0 / 4_096.0;
    let model = J2TetRequest {
        mesh: mesh.clone(),
        steel,
        element_steels: None,
        targets: vec![
            target(&mesh, dilation_peak, shear_peak),
            target(&mesh, dilation_end, shear_end),
        ],
        options,
    };
    let result = solve(&model).unwrap();

    // The three free center DOFs fit in the sparse diagonal budget, while
    // their coupled factor entries do not. Recover the same multiaxial path
    // frontally, including cutbacks and an elastic unload.
    let mut automatic_model = model.clone();
    automatic_model.options.linear_backend = J2TetLinearBackend::Automatic;
    automatic_model.options.max_factor_entries = 3;
    let recovered = solve(&automatic_model).unwrap();
    assert_eq!(
        recovered.linear_backend_used,
        J2TetLinearBackend::FrontalWave
    );
    assert!(recovered.frontal_fallbacks >= 2);
    assert!(recovered.cutbacks > 0);
    for (node, displacement) in result.nodal_displacements_m.iter().enumerate() {
        for axis in 0..3 {
            close(
                recovered.nodal_displacements_m[node][axis],
                displacement[axis],
                1e-10,
                "fallback displacement",
            );
            close(
                recovered.nodal_reactions_kn[node][axis],
                result.nodal_reactions_kn[node][axis],
                1e-4,
                "fallback reaction",
            );
        }
    }
    for (element, state) in result.element_states.iter().enumerate() {
        close(
            recovered.element_states[element].equivalent_plastic_strain,
            state.equivalent_plastic_strain,
            1e-9,
            "fallback plastic strain",
        );
        close(
            recovered.element_states[element].stress_mpa[0][1],
            state.stress_mpa[0][1],
            1e-6,
            "fallback shear stress",
        );
    }

    assert!(result.cutbacks > 0, "expected a rejected trial load step");
    assert!(result
        .accepted_steps
        .iter()
        .any(|step| step.target_index == 1));
    close(result.true_free_residual_kn, 0.0, 1e-5, "free residual");
    let center = mesh
        .nodes
        .iter()
        .position(|point| *point == [0.5; 3])
        .unwrap();
    let expected_center = [
        0.5 * (dilation_end + shear_end),
        0.5 * dilation_end,
        0.5 * dilation_end,
    ];
    for component in 0..3 {
        close(
            result.nodal_displacements_m[center][component],
            expected_center[component],
            1e-10,
            "free center displacement",
        );
    }

    let mean_stress = 3.0 * bulk_modulus * dilation_end;
    let expected_plastic_shear = 3.0_f64.sqrt() * plastic_p / 2.0;
    for state in &result.element_states {
        close(
            state.equivalent_plastic_strain,
            plastic_p,
            1e-9,
            "plastic p",
        );
        for axis in 0..3 {
            close(
                state.stress_mpa[axis][axis],
                mean_stress,
                1e-6,
                "normal stress",
            );
            close(
                state.plastic_strain[axis][axis],
                0.0,
                1e-9,
                "normal plastic strain",
            );
        }
        close(state.stress_mpa[0][1], end_tau, 1e-6, "shear stress");
        close(
            state.plastic_strain[0][1],
            expected_plastic_shear,
            1e-9,
            "plastic shear strain",
        );
    }

    let top_x_reaction_kn: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[1] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(
        top_x_reaction_kn,
        1_000.0 * end_tau,
        1e-4,
        "top shear reaction",
    );
}
