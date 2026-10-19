//! Independent series-bar check of the heterogeneous total-Lagrangian Tet4 API.
//!
//! Three unit-cube layers have nu=0 and all transverse displacements fixed.
//! Their exact uniaxial St Venant–Kirchhoff nominal stress is shared:
//! P = E_i (F_i^3 - F_i)/2, with sum_i (F_i - 1)/3 = end displacement.
//! The scalar reference below bisects that relation without using FEM assembly.

use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_gnl::{
    solve, GnlTetMaterial, GnlTetOptions, GnlTetRequest, GnlTetResult, GnlTetTarget,
};

const YOUNG_MPA: [f64; 3] = [60_000.0, 100_000.0, 180_000.0];

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual {actual:.12e}, expected {expected:.12e}, tolerance {tolerance:.3e}"
    );
}

fn layer_at(x: f64) -> usize {
    ((3.0 * x).floor() as usize).min(2)
}

fn materials(mesh: &Mesh, young: [f64; 3]) -> Vec<GnlTetMaterial> {
    mesh.tets
        .iter()
        .map(|nodes| {
            let center_x = nodes.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            GnlTetMaterial {
                e_mpa: young[layer_at(center_x)],
                poisson: 0.0,
            }
        })
        .collect()
}

fn target(mesh: &Mesh, end_displacement: f64) -> GnlTetTarget {
    GnlTetTarget {
        loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
        body_forces: vec![],
        face_tractions: vec![],
        prescribed_m: mesh
            .nodes
            .iter()
            .map(|point| {
                let ux = if point[0] == 0.0 {
                    Some(0.0)
                } else if point[0] == 1.0 {
                    Some(end_displacement)
                } else {
                    None
                };
                [ux, Some(0.0), Some(0.0)]
            })
            .collect(),
    }
}

fn nominal_stress(young: f64, stretch: f64) -> f64 {
    0.5 * young * (stretch.powi(3) - stretch)
}

fn stretch_for_stress(young: f64, stress: f64) -> f64 {
    // The positive-tangent branch contains the moderate extensions and
    // compressions used here; both bounds are deliberately outside all roots.
    let (mut low, mut high) = (0.7, 1.5);
    assert!(nominal_stress(young, low) < stress);
    assert!(nominal_stress(young, high) > stress);
    for _ in 0..100 {
        let middle = 0.5 * (low + high);
        if nominal_stress(young, middle) < stress {
            low = middle;
        } else {
            high = middle;
        }
    }
    0.5 * (low + high)
}

fn series_reference(young: [f64; 3], end_displacement: f64) -> (f64, [f64; 3]) {
    let (mut low, mut high) = (-10_000.0, 50_000.0);
    let extension = |stress: f64| -> f64 {
        young
            .iter()
            .map(|&e| (stretch_for_stress(e, stress) - 1.0) / 3.0)
            .sum()
    };
    assert!(extension(low) < end_displacement);
    assert!(extension(high) > end_displacement);
    for _ in 0..100 {
        let middle = 0.5 * (low + high);
        if extension(middle) < end_displacement {
            low = middle;
        } else {
            high = middle;
        }
    }
    let stress = 0.5 * (low + high);
    (stress, young.map(|e| stretch_for_stress(e, stress)))
}

fn check_state(mesh: &Mesh, result: &GnlTetResult, young: [f64; 3], extension: f64) {
    let (stress, stretches) = series_reference(young, extension);
    let mut layer_start_displacement = [0.0; 3];
    for layer in 1..3 {
        layer_start_displacement[layer] =
            layer_start_displacement[layer - 1] + (stretches[layer - 1] - 1.0) / 3.0;
    }
    for (node, point) in mesh.nodes.iter().enumerate() {
        let layer = layer_at(point[0]);
        let start_x = layer as f64 / 3.0;
        let expected_ux =
            layer_start_displacement[layer] + (stretches[layer] - 1.0) * (point[0] - start_x);
        for axis in 0..3 {
            let expected = if axis == 0 { expected_ux } else { 0.0 };
            close(
                result.nodal_displacements_m[node][axis],
                expected,
                2e-10,
                &format!("node {node} displacement {axis}"),
            );
        }
        if point[0] != 0.0 && point[0] != 1.0 {
            close(
                result.nodal_reactions_kn[node][0],
                0.0,
                2e-4,
                &format!("free node {node} axial residual"),
            );
        }
    }
    for (element, nodes) in mesh.tets.iter().enumerate() {
        let center_x = nodes.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
        let layer = layer_at(center_x);
        let expected_green_xx = 0.5 * (stretches[layer].powi(2) - 1.0);
        for row in 0..3 {
            for col in 0..3 {
                close(
                    result.element_green_strain[element][row][col],
                    if row == 0 && col == 0 {
                        expected_green_xx
                    } else {
                        0.0
                    },
                    2e-9,
                    &format!("element {element} Green {row}{col}"),
                );
                close(
                    result.element_first_piola_mpa[element][row][col],
                    if row == 0 && col == 0 { stress } else { 0.0 },
                    2e-4,
                    &format!("element {element} Piola {row}{col}"),
                );
            }
        }
    }
    let end_reaction = |x: f64| -> f64 {
        mesh.nodes
            .iter()
            .enumerate()
            .filter(|(_, point)| point[0] == x)
            .map(|(node, _)| result.nodal_reactions_kn[node][0])
            .sum()
    };
    close(
        end_reaction(0.0),
        -1_000.0 * stress,
        2e-4,
        "left axial reaction",
    );
    close(
        end_reaction(1.0),
        1_000.0 * stress,
        2e-4,
        "right axial reaction",
    );
    close(result.true_free_residual_kn, 0.0, 2e-4, "free residual");
}

#[test]
fn three_material_series_extension_reversal_and_relaxation() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    assert!(3 * mesh.nodes.len() <= 180);
    let element_materials = materials(&mesh, YOUNG_MPA);
    // Different material layers have unequal stretches even though their
    // nominal traction is equal. Each path prefix checks the reported state.
    let path = [0.105, -0.02, 0.0];
    for length in 1..=path.len() {
        let result = solve(&GnlTetRequest {
            mesh: mesh.clone(),
            e_mpa: 80_000.0,
            poisson: 0.0,
            element_materials: Some(element_materials.clone()),
            element_energy_beta: None,
            targets: path[..length]
                .iter()
                .map(|&value| target(&mesh, value))
                .collect(),
            options: GnlTetOptions::default(),
        })
        .unwrap();
        check_state(&mesh, &result, YOUNG_MPA, path[length - 1]);
        assert_eq!(
            result.accepted_steps.last().unwrap().target_index,
            length - 1
        );
    }
}

#[test]
fn uniform_material_list_matches_legacy_request_and_rejects_wrong_count() {
    let mesh = Mesh::structured([3, 1, 1]).unwrap();
    let uniform = [92_000.0; 3];
    let request = GnlTetRequest {
        mesh: mesh.clone(),
        e_mpa: uniform[0],
        poisson: 0.0,
        element_materials: None,
        element_energy_beta: None,
        targets: vec![target(&mesh, 0.06)],
        options: GnlTetOptions::default(),
    };
    let legacy = solve(&request).unwrap();
    check_state(&mesh, &legacy, uniform, 0.06);

    let mut explicit = request.clone();
    explicit.element_materials = Some(materials(&mesh, uniform));
    let explicit_result = solve(&explicit).unwrap();
    for (node, (a, b)) in legacy
        .nodal_displacements_m
        .iter()
        .zip(&explicit_result.nodal_displacements_m)
        .enumerate()
    {
        for axis in 0..3 {
            close(
                a[axis],
                b[axis],
                1e-12,
                &format!("legacy node {node} {axis}"),
            );
        }
    }
    for (element, (a, b)) in legacy
        .element_first_piola_mpa
        .iter()
        .zip(&explicit_result.element_first_piola_mpa)
        .enumerate()
    {
        close(
            a[0][0],
            b[0][0],
            1e-7,
            &format!("legacy element {element} Pxx"),
        );
    }
    let encoded = serde_json::to_value(&explicit).unwrap();
    assert!(encoded.get("elementMaterials").unwrap().is_array());
    let mut malformed = request;
    malformed.element_materials = Some(materials(&mesh, uniform)[..1].to_vec());
    assert!(solve(&malformed).is_err());
}
