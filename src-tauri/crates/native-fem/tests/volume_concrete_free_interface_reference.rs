//! Two Tet4 layers in series with a freely moving axial interface.
//! The reference solves the scalar spring equilibrium and exponential tensile
//! law directly, independently of the FEM element and material routines.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetMaterial, ConcreteTetOptions, ConcreteTetRequest, ConcreteTetTarget,
};

const LENGTH: f64 = 0.5;
const AREA: f64 = 1.0;
const E_WEAK: f64 = 20_000.0;
const E_STRONG: f64 = 30_000.0;
const FT_WEAK: f64 = 2.0;
const FT_STRONG: f64 = 10.0;
const GF_WEAK: f64 = 500.0;
const GF_STRONG: f64 = 2_000.0;

fn materials() -> [ConcreteTetMaterial; 2] {
    [
        ConcreteTetMaterial {
            e_mpa: E_WEAK,
            poisson: 0.0,
            tensile_strength_mpa: FT_WEAK,
            fracture_energy_n_per_m: GF_WEAK,
            crack_band_width_m: LENGTH,
        },
        ConcreteTetMaterial {
            e_mpa: E_STRONG,
            poisson: 0.0,
            tensile_strength_mpa: FT_STRONG,
            fracture_energy_n_per_m: GF_STRONG,
            crack_band_width_m: LENGTH,
        },
    ]
}

fn target(mesh: &Mesh, end_displacement: f64) -> ConcreteTetTarget {
    ConcreteTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                [
                    if point[0] == 0.0 {
                        Some(0.0)
                    } else if point[0] == 1.0 {
                        Some(end_displacement)
                    } else {
                        None // The axial interface DOFs solve from force equilibrium.
                    },
                    Some(0.0),
                    Some(0.0),
                ]
            })
            .collect(),
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn request(mesh: &Mesh, end_displacements: &[f64]) -> ConcreteTetRequest {
    let layers = materials();
    let element_materials = mesh
        .tets
        .iter()
        .map(|tet| {
            let center_x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            layers[usize::from(center_x > LENGTH)].clone()
        })
        .collect();
    ConcreteTetRequest {
        mesh: mesh.clone(),
        e_mpa: layers[0].e_mpa,
        poisson: layers[0].poisson,
        tensile_strength_mpa: layers[0].tensile_strength_mpa,
        fracture_energy_n_per_m: layers[0].fracture_energy_n_per_m,
        crack_band_width_m: layers[0].crack_band_width_m,
        element_materials: Some(element_materials),
        targets: end_displacements.iter().map(|&u| target(mesh, u)).collect(),
        options: ConcreteTetOptions::default(),
    }
}

// Independent 1D reference. Its history is the largest tensile strain reached
// by this spring, rather than a value read from the FEM constitutive routine.
fn spring_stress_and_damage(strain: f64, history: f64, e: f64, ft: f64, gf: f64) -> (f64, f64) {
    let onset = ft / e;
    let beta = gf / (1e6 * LENGTH * ft) - onset / 2.0;
    assert!(beta > 0.0);
    let maximum = history.max(strain);
    let damage = if maximum <= onset {
        0.0
    } else {
        let envelope_stress = ft * (-(maximum - onset) / beta).exp();
        1.0 - envelope_stress / (e * maximum)
    };
    ((1.0 - damage) * e * strain, damage)
}

#[derive(Clone, Copy)]
struct SeriesState {
    interface_u: f64,
    stress: f64,
    weak_damage: f64,
    weak_history: f64,
    strong_history: f64,
}

fn series_reference(end_u: f64, previous: Option<SeriesState>) -> SeriesState {
    let previous_weak_history = previous.map_or(0.0, |state| state.weak_history);
    let previous_strong_history = previous.map_or(0.0, |state| state.strong_history);
    // At equal cross section, layer forces are equal. The strong layer stays
    // elastic throughout this path: eps_strong = sigma_weak / E_STRONG.
    let total_u_for_weak_strain = |eps: f64| {
        let (stress, _) =
            spring_stress_and_damage(eps, previous_weak_history, E_WEAK, FT_WEAK, GF_WEAK);
        LENGTH * eps + LENGTH * stress / E_STRONG
    };
    let mut lo = 0.0;
    let mut hi = 1e-3;
    assert!(total_u_for_weak_strain(hi) > end_u);
    for _ in 0..90 {
        let mid = (lo + hi) / 2.0;
        if total_u_for_weak_strain(mid) < end_u {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let eps_weak = (lo + hi) / 2.0;
    let (stress, weak_damage) =
        spring_stress_and_damage(eps_weak, previous_weak_history, E_WEAK, FT_WEAK, GF_WEAK);
    SeriesState {
        interface_u: LENGTH * eps_weak,
        stress,
        weak_damage,
        weak_history: previous_weak_history.max(eps_weak),
        strong_history: previous_strong_history.max(stress / E_STRONG),
    }
}

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tolerance={tolerance:.2e}"
    );
}

fn check_result(
    mesh: &Mesh,
    result: &openaec_native_fem::volume3d_concrete_damage::ConcreteTetResult,
    end_u: f64,
    expected: SeriesState,
) {
    close(result.true_free_residual_kn, 0.0, 1e-7, "free residual");
    assert!(result
        .accepted_steps
        .iter()
        .all(|step| step.true_free_residual_kn < 1e-7));
    for (node, point) in mesh.nodes.iter().enumerate() {
        let expected_u = if point[0] == 0.0 {
            0.0
        } else if point[0] == LENGTH {
            expected.interface_u
        } else {
            end_u
        };
        close(
            result.nodal_displacements_m[node][0],
            expected_u,
            2e-10,
            "nodal ux",
        );
        close(
            result.nodal_displacements_m[node][1],
            0.0,
            1e-13,
            "nodal uy",
        );
        close(
            result.nodal_displacements_m[node][2],
            0.0,
            1e-13,
            "nodal uz",
        );
        if point[0] == LENGTH {
            close(
                result.nodal_reactions_kn[node][0],
                0.0,
                1e-7,
                "interface reaction",
            );
        }
    }
    for (element, tet) in mesh.tets.iter().enumerate() {
        let center_x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
        let weak = center_x < LENGTH;
        let expected_damage = if weak { expected.weak_damage } else { 0.0 };
        let expected_history = if weak {
            expected.weak_history
        } else {
            expected.strong_history
        };
        close(
            result.element_stress_mpa[element][0],
            expected.stress,
            2e-6,
            "layer stress",
        );
        for transverse in &result.element_stress_mpa[element][1..] {
            close(*transverse, 0.0, 2e-8, "transverse stress");
        }
        close(
            result.element_damage[element],
            expected_damage,
            2e-8,
            "layer damage",
        );
        close(
            result.element_states[element].max_equivalent_strain,
            expected_history,
            2e-9,
            "layer history",
        );
    }
    let left: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[0] == 0.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    let right: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, p)| p[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(left, -1e3 * AREA * expected.stress, 2e-5, "left reaction");
    close(right, 1e3 * AREA * expected.stress, 2e-5, "right reaction");
}

#[test]
fn free_interface_matches_two_spring_damage_and_unloading_reference() {
    let mesh = Mesh::structured([2, 1, 1]).unwrap();
    let peak_u = 1.75e-4;
    let unload_u = 4.0e-5;
    let peak_reference = series_reference(peak_u, None);
    assert!(peak_reference.weak_damage > 0.0);
    assert!(peak_reference.stress < FT_WEAK);
    assert!(peak_reference.stress / E_STRONG < FT_STRONG / E_STRONG);
    let peak = solve(&request(&mesh, &[peak_u])).unwrap();
    check_result(&mesh, &peak, peak_u, peak_reference);

    let unload_reference = series_reference(unload_u, Some(peak_reference));
    assert!(unload_reference.interface_u < peak_reference.interface_u);
    assert!(unload_reference.weak_damage == peak_reference.weak_damage);
    let unloaded = solve(&request(&mesh, &[peak_u, unload_u])).unwrap();
    check_result(&mesh, &unloaded, unload_u, unload_reference);
    assert_eq!(unloaded.accepted_steps.last().unwrap().target_index, 1);
}
