//! Independent coupon checks for per-Tet4 experimental tensile-damage inputs.
//!
//! An elastic three-layer series bar checks traction equilibrium and differing
//! elastic moduli. A prescribed uniaxial patch then checks the scalar
//! exponential law, each layer's distinct damage history, and unloading.
//! These are limited constitutive/assembly checks, not a validated concrete
//! design model or a general 3D mesh-objectivity demonstration.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    solve, ConcreteTetFaceTraction, ConcreteTetMaterial, ConcreteTetOptions, ConcreteTetRequest,
    ConcreteTetTarget,
};

fn close(actual: f64, expected: f64, tolerance: f64, name: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{name}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn layer(x: f64) -> usize {
    ((3.0 * x).floor() as usize).min(2)
}

fn materials() -> [ConcreteTetMaterial; 3] {
    [
        ConcreteTetMaterial {
            e_mpa: 20_000.0,
            poisson: 0.0,
            tensile_strength_mpa: 2.0,
            fracture_energy_n_per_m: 100.0,
            crack_band_width_m: 1.0 / 3.0,
        },
        ConcreteTetMaterial {
            e_mpa: 30_000.0,
            poisson: 0.0,
            tensile_strength_mpa: 3.5,
            fracture_energy_n_per_m: 150.0,
            crack_band_width_m: 1.0 / 3.0,
        },
        ConcreteTetMaterial {
            e_mpa: 40_000.0,
            poisson: 0.0,
            tensile_strength_mpa: 5.0,
            fracture_energy_n_per_m: 200.0,
            crack_band_width_m: 1.0 / 3.0,
        },
    ]
}

fn element_materials(mesh: &Mesh, layers: &[ConcreteTetMaterial; 3]) -> Vec<ConcreteTetMaterial> {
    mesh.tets
        .iter()
        .map(|tet| {
            let centroid_x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            layers[layer(centroid_x)].clone()
        })
        .collect()
}

fn right_faces(mesh: &Mesh) -> Vec<ConcreteTetFaceTraction> {
    let mut faces = Vec::new();
    for (element, tet) in mesh.tets.iter().enumerate() {
        for face_nodes in [
            [tet[0], tet[1], tet[2]],
            [tet[0], tet[1], tet[3]],
            [tet[0], tet[2], tet[3]],
            [tet[1], tet[2], tet[3]],
        ] {
            if face_nodes.iter().all(|&node| mesh.nodes[node][0] == 1.0) {
                faces.push(ConcreteTetFaceTraction {
                    element,
                    face_nodes,
                    traction_kn_per_m2: [1_000.0, 0.0, 0.0],
                });
            }
        }
    }
    assert_eq!(faces.len(), 2);
    faces
}

fn elastic_target(mesh: &Mesh) -> ConcreteTetTarget {
    ConcreteTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                [
                    if point[0] == 0.0 { Some(0.0) } else { None },
                    Some(0.0),
                    Some(0.0),
                ]
            })
            .collect(),
        body_forces: vec![],
        face_tractions: right_faces(mesh),
    }
}

fn strain_target(mesh: &Mesh, axial_strain: f64) -> ConcreteTetTarget {
    ConcreteTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| [Some(axial_strain * point[0]), Some(0.0), Some(0.0)])
            .collect(),
        body_forces: vec![],
        face_tractions: vec![],
    }
}

fn request(
    mesh: &Mesh,
    element_materials: Option<Vec<ConcreteTetMaterial>>,
    targets: Vec<ConcreteTetTarget>,
) -> ConcreteTetRequest {
    let global = materials()[0].clone();
    ConcreteTetRequest {
        mesh: mesh.clone(),
        e_mpa: global.e_mpa,
        poisson: global.poisson,
        tensile_strength_mpa: global.tensile_strength_mpa,
        fracture_energy_n_per_m: global.fracture_energy_n_per_m,
        crack_band_width_m: global.crack_band_width_m,
        element_materials,
        targets,
        options: ConcreteTetOptions::default(),
    }
}

#[test]
fn three_layer_concrete_bar_has_analytical_elastic_series_response() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = materials();
    let stress_mpa = 1.0; // Below all three independently specified thresholds.
    let result = solve(&request(
        &mesh,
        Some(element_materials(&mesh, &layers)),
        vec![elastic_target(&mesh)],
    ))
    .unwrap();

    let starts = [
        0.0,
        stress_mpa / layers[0].e_mpa / 3.0,
        stress_mpa / layers[0].e_mpa / 3.0 + stress_mpa / layers[1].e_mpa / 3.0,
    ];
    for (node, point) in mesh.nodes.iter().enumerate() {
        let i = layer(point[0]);
        let expected = starts[i] + stress_mpa / layers[i].e_mpa * (point[0] - i as f64 / 3.0);
        close(
            result.nodal_displacements_m[node][0],
            expected,
            2e-10,
            "series displacement",
        );
        close(result.nodal_displacements_m[node][1], 0.0, 1e-13, "uy");
        close(result.nodal_displacements_m[node][2], 0.0, 1e-13, "uz");
    }
    for (element, stress) in result.element_stress_mpa.iter().enumerate() {
        close(stress[0], stress_mpa, 2e-6, "axial stress");
        for component in &stress[1..] {
            close(*component, 0.0, 2e-6, "transverse/shear stress");
        }
        close(result.element_damage[element], 0.0, 1e-12, "elastic damage");
    }
    let left_reaction: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 0.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(left_reaction, -1_000.0 * stress_mpa, 2e-5, "left reaction");
    close(result.true_free_residual_kn, 0.0, 2e-5, "free residual");
}

#[test]
fn distinct_thresholds_and_fracture_energies_follow_closed_form_damage_and_unload() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let layers = materials();
    let peak_strain = 2.5e-4;
    let unloaded_strain = peak_strain / 4.0;
    let result = solve(&request(
        &mesh,
        Some(element_materials(&mesh, &layers)),
        vec![
            strain_target(&mesh, peak_strain),
            strain_target(&mesh, unloaded_strain),
        ],
    ))
    .unwrap();

    let mut stresses = [0.0; 3];
    for (i, material) in layers.iter().enumerate() {
        let onset = material.tensile_strength_mpa / material.e_mpa;
        let beta = material.fracture_energy_n_per_m
            / (1e6 * material.crack_band_width_m * material.tensile_strength_mpa)
            - onset / 2.0;
        assert!(peak_strain > onset && beta > 0.0);
        let peak_stress = material.tensile_strength_mpa * (-(peak_strain - onset) / beta).exp();
        let damage = 1.0 - peak_stress / (material.e_mpa * peak_strain);
        stresses[i] = (1.0 - damage) * material.e_mpa * unloaded_strain;

        for (element, tet) in mesh.tets.iter().enumerate() {
            let x = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            if layer(x) != i {
                continue;
            }
            close(result.element_damage[element], damage, 1e-8, "damage");
            close(
                result.element_states[element].max_equivalent_strain,
                peak_strain,
                1e-10,
                "committed maximum strain",
            );
            close(
                result.element_stress_mpa[element][0],
                stresses[i],
                1e-6,
                "unloaded stress",
            );
            for component in &result.element_stress_mpa[element][1..] {
                close(*component, 0.0, 1e-8, "uniaxial stress state");
            }
        }
    }
    assert!(stresses[0] != stresses[1] && stresses[1] != stresses[2]);
    for (node, point) in mesh.nodes.iter().enumerate() {
        close(
            result.nodal_displacements_m[node][0],
            unloaded_strain * point[0],
            1e-12,
            "prescribed displacement",
        );
    }
    let left: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 0.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    let right: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| point[0] == 1.0)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(left, -1_000.0 * stresses[0], 1e-5, "left face reaction");
    close(right, 1_000.0 * stresses[2], 1e-5, "right face reaction");
    assert_eq!(result.accepted_steps.last().unwrap().target_index, 1);
}

#[test]
fn uniform_element_materials_match_legacy_and_invalid_lists_are_rejected() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let global = materials()[0].clone();
    let targets = vec![elastic_target(&mesh)];
    let legacy = solve(&request(&mesh, None, targets.clone())).unwrap();
    let explicit = solve(&request(
        &mesh,
        Some(vec![global.clone(); mesh.tets.len()]),
        targets.clone(),
    ))
    .unwrap();
    for (a, b) in legacy
        .nodal_displacements_m
        .iter()
        .zip(&explicit.nodal_displacements_m)
    {
        for axis in 0..3 {
            close(a[axis], b[axis], 1e-12, "legacy displacement parity");
        }
    }
    assert!(
        solve(&request(&mesh, Some(vec![global.clone()]), targets.clone()))
            .unwrap_err()
            .contains("elementMaterials")
    );
    let mut invalid = vec![global; mesh.tets.len()];
    invalid[1].fracture_energy_n_per_m = -1.0;
    assert!(solve(&request(&mesh, Some(invalid), targets))
        .unwrap_err()
        .contains("elementMaterials[1]"));
}

#[test]
fn camel_case_element_materials_deserialize_and_absence_uses_global_path() {
    let mesh = Mesh::structured([1, 1, 1]).unwrap();
    let material_json = serde_json::json!({
        "eMpa": 31_000.0,
        "poisson": 0.1,
        "tensileStrengthMpa": 3.1,
        "fractureEnergyNPerM": 110.0,
        "crackBandWidthM": 0.2
    });
    let payload = serde_json::json!({
        "mesh": mesh,
        "eMpa": 20_000.0,
        "poisson": 0.0,
        "tensileStrengthMpa": 2.0,
        "fractureEnergyNPerM": 100.0,
        "crackBandWidthM": 0.25,
        "elementMaterials": vec![material_json; mesh.tets.len()],
        "targets": []
    });
    let parsed: ConcreteTetRequest = serde_json::from_value(payload.clone()).unwrap();
    let per_element = parsed.element_materials.unwrap();
    assert_eq!(per_element.len(), mesh.tets.len());
    close(per_element[0].e_mpa, 31_000.0, 0.0, "JSON E");
    close(
        per_element[0].fracture_energy_n_per_m,
        110.0,
        0.0,
        "JSON fracture energy",
    );
    let mut legacy = payload;
    legacy.as_object_mut().unwrap().remove("elementMaterials");
    let parsed_legacy: ConcreteTetRequest = serde_json::from_value(legacy).unwrap();
    assert!(parsed_legacy.element_materials.is_none());
}
