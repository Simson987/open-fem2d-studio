use std::collections::HashMap;

use frame3d_solver::{
    solve, AnalysisKind, Material3D, Member3D, NodalLoad3D, Node3D, Section3D, SolveRequest3D,
    Support3D,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct ReferenceFile {
    section: ReferenceSection,
    cases: Vec<ReferenceCase>,
}

#[derive(Deserialize)]
#[allow(non_snake_case)]
struct ReferenceSection {
    E: f64,
    G: f64,
    A: f64,
    Iy: f64,
    Iz: f64,
    J: f64,
}

#[derive(Deserialize)]
struct ReferenceCase {
    id: String,
    nodes: HashMap<String, [f64; 3]>,
    elements: Vec<ReferenceElement>,
    supports: HashMap<String, Vec<String>>,
    #[serde(rename = "nodalLoads")]
    nodal_loads: HashMap<String, ReferenceLoad>,
    expected: ReferenceExpected,
}

#[derive(Deserialize)]
struct ReferenceElement {
    start: String,
    end: String,
}

#[derive(Deserialize)]
struct ReferenceLoad {
    force: [f64; 3],
    moment: [f64; 3],
}

#[derive(Deserialize)]
struct ReferenceExpected {
    #[serde(default)]
    displacements: HashMap<String, HashMap<String, f64>>,
    #[serde(default)]
    reactions: HashMap<String, HashMap<String, f64>>,
}

fn request_from_case(
    section: &ReferenceSection,
    case: &ReferenceCase,
) -> (SolveRequest3D, HashMap<String, usize>) {
    let mut names: Vec<_> = case.nodes.keys().cloned().collect();
    names.sort();
    let ids: HashMap<_, _> = names
        .iter()
        .enumerate()
        .map(|(index, name)| (name.clone(), index + 1))
        .collect();
    let nodes = names
        .iter()
        .map(|name| {
            let coordinates = case.nodes[name];
            Node3D {
                id: ids[name],
                x: coordinates[0],
                y: coordinates[1],
                z: coordinates[2],
            }
        })
        .collect();
    let members = case
        .elements
        .iter()
        .enumerate()
        .map(|(index, element)| Member3D {
            id: index + 1,
            start_node_id: ids[&element.start],
            end_node_id: ids[&element.end],
            material_id: 1,
            section_id: 1,
            releases: Default::default(),
            roll_angle_rad: None,
        })
        .collect();
    let supports = case
        .supports
        .iter()
        .map(|(name, fixed)| {
            let has = |dof: &str| fixed.iter().any(|value| value == dof);
            Support3D {
                node_id: ids[name],
                ux: has("ux"),
                uy: has("uy"),
                uz: has("uz"),
                rx: has("rx"),
                ry: has("ry"),
                rz: has("rz"),
                ..Default::default()
            }
        })
        .collect();
    let nodal_loads = case
        .nodal_loads
        .iter()
        .enumerate()
        .map(|(index, (name, load))| NodalLoad3D {
            id: index + 1,
            node_id: ids[name],
            fx: load.force[0] / 1000.0,
            fy: load.force[1] / 1000.0,
            fz: load.force[2] / 1000.0,
            mx: load.moment[0] / 1000.0,
            my: load.moment[1] / 1000.0,
            mz: load.moment[2] / 1000.0,
        })
        .collect();
    let poisson = section.E / (2.0 * section.G) - 1.0;
    let request = SolveRequest3D {
        schema_version: 1,
        analysis: AnalysisKind::Linear,
        nodes,
        materials: vec![Material3D {
            id: 1,
            name: "cases.json reference".into(),
            e_mpa: section.E / 1e6,
            nu: poisson,
            alpha_per_k: None,
        }],
        sections: vec![Section3D {
            id: 1,
            name: "cases.json reference".into(),
            area_m2: section.A,
            iy_m4: section.Iy,
            iz_m4: section.Iz,
            torsion_j_m4: section.J,
            shear_area_y_m2: None,
            shear_area_z_m2: None,
        }],
        members,
        supports,
        nodal_loads,
        member_loads: vec![],
        member_point_loads: vec![],
        thermal_loads: vec![],
        max_iterations: 50,
        tolerance: 1e-10,
        buckling_modes: 0,
    };
    (request, ids)
}

fn check_value(
    case_id: &str,
    quantity: &str,
    actual: f64,
    expected: f64,
    absolute_tolerance: f64,
) -> (f64, f64) {
    let absolute_error = (actual - expected).abs();
    let relative_error = if expected.abs() > absolute_tolerance {
        absolute_error / expected.abs()
    } else {
        0.0
    };
    assert!(
        absolute_error <= absolute_tolerance.max(expected.abs() * 1e-8),
        "{case_id} {quantity}: actual={actual:.12e}, expected={expected:.12e}, absolute error={absolute_error:.3e}, relative error={relative_error:.3e}",
    );
    (absolute_error, relative_error)
}

fn add_force_and_moment(
    sum_force: &mut [f64; 3],
    sum_moment: &mut [f64; 3],
    position: [f64; 3],
    force: [f64; 3],
    applied_moment: [f64; 3],
) {
    for axis in 0..3 {
        sum_force[axis] += force[axis];
        sum_moment[axis] += applied_moment[axis];
    }
    sum_moment[0] += position[1] * force[2] - position[2] * force[1];
    sum_moment[1] += position[2] * force[0] - position[0] * force[2];
    sum_moment[2] += position[0] * force[1] - position[1] * force[0];
}

#[test]
fn published_json_cases_match_the_solver_with_error_measures() {
    let references: ReferenceFile = serde_json::from_str(include_str!(
        "../../../../docs/verificatie/3d-raamwerk/cases.json"
    ))
    .expect("cases.json must remain valid and compatible with this verification test");

    for case in &references.cases {
        let (request, ids) = request_from_case(&references.section, case);
        let result = solve(request).unwrap_or_else(|error| panic!("{}: {error}", case.id));
        let mut max_absolute_error: f64 = 0.0;
        let mut max_relative_error: f64 = 0.0;

        for (name, expected) in &case.expected.displacements {
            let actual = result
                .displacements
                .iter()
                .find(|value| value.node_id == ids[name])
                .unwrap_or_else(|| panic!("{}: displacement for node {name}", case.id));
            for (component, expected_value) in expected {
                let actual_value = match component.as_str() {
                    "ux" => actual.ux,
                    "uy" => actual.uy,
                    "uz" => actual.uz,
                    "rx" => actual.rx,
                    "ry" => actual.ry,
                    "rz" => actual.rz,
                    other => panic!("{}: unknown displacement component {other}", case.id),
                };
                let (absolute, relative) = check_value(
                    &case.id,
                    &format!("{name}.{component}"),
                    actual_value,
                    *expected_value,
                    2e-11,
                );
                max_absolute_error = max_absolute_error.max(absolute);
                max_relative_error = max_relative_error.max(relative);
            }
        }

        for (name, expected) in &case.expected.reactions {
            let actual = result
                .reactions
                .iter()
                .find(|value| value.node_id == ids[name])
                .unwrap_or_else(|| panic!("{}: reaction for node {name}", case.id));
            for (component, expected_value_n) in expected {
                let actual_value_kn = match component.as_str() {
                    "Fx" => actual.fx,
                    "Fy" => actual.fy,
                    "Fz" => actual.fz,
                    "Mx" => actual.mx,
                    "My" => actual.my,
                    "Mz" => actual.mz,
                    other => panic!("{}: unknown reaction component {other}", case.id),
                };
                let expected_value_kn = expected_value_n / 1000.0;
                let (absolute, relative) = check_value(
                    &case.id,
                    &format!("{name}.{component}"),
                    actual_value_kn,
                    expected_value_kn,
                    1e-9,
                );
                max_absolute_error = max_absolute_error.max(absolute);
                max_relative_error = max_relative_error.max(relative);
            }
        }

        // Recompute global equilibrium independently from the solver summary,
        // including r x F about the global origin. This guards both reaction
        // signs and the transformation of moments for skew members.
        let mut force_balance = [0.0; 3];
        let mut moment_balance = [0.0; 3];
        for (name, load) in &case.nodal_loads {
            add_force_and_moment(
                &mut force_balance,
                &mut moment_balance,
                case.nodes[name],
                load.force.map(|value| value / 1000.0),
                load.moment.map(|value| value / 1000.0),
            );
        }
        for reaction in &result.reactions {
            let name = ids
                .iter()
                .find_map(|(name, id)| (*id == reaction.node_id).then_some(name))
                .expect("reaction node must exist in cases.json");
            add_force_and_moment(
                &mut force_balance,
                &mut moment_balance,
                case.nodes[name],
                [reaction.fx, reaction.fy, reaction.fz],
                [reaction.mx, reaction.my, reaction.mz],
            );
        }
        let max_equilibrium_error = force_balance
            .iter()
            .chain(moment_balance.iter())
            .fold(0.0_f64, |maximum, value| maximum.max(value.abs()));
        assert!(
            max_equilibrium_error <= 1e-9,
            "{}: global force/moment equilibrium error={max_equilibrium_error:.3e} kN/kNm; force={force_balance:?}, moment={moment_balance:?}",
            case.id,
        );

        eprintln!(
            "{}: max absolute error={:.3e}, max relative error={:.3e}, equilibrium error={:.3e} kN/kNm",
            case.id, max_absolute_error, max_relative_error, max_equilibrium_error,
        );
    }
}
