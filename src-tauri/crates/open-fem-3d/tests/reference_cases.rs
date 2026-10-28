use open_fem_3d::{
    solve, AnalysisKind, BucklingSummary, Diaphragm3D, Material3D, Member3D, MemberLoad3D, MemberPointLoad3D,
    NodalLoad3D, Node3D, ThermalLoad3D,
    Section3D, SolveRequest3D, Support3D,
};

fn section() -> Section3D {
    Section3D { id: 1, name: "reference".into(), area_m2: 0.01, iy_m4: 8e-6,
        iz_m4: 12e-6, torsion_j_m4: 5e-6, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None }
}

#[test]
fn local_point_load_on_member_matches_simply_supported_closed_form() {
    let revolute_y = |node_id| Support3D {
        node_id, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true,
        ..Default::default()
    };
    let mut input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 4.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![revolute_y(1), revolute_y(2)], vec![],
    );
    input.member_point_loads.push(MemberPointLoad3D {
        id: 1, member_id: 1, py_kn: 0.0, pz_kn: -10.0, position_m: 2.0,
    });
    let result = solve(input).unwrap();
    let left = result.reactions.iter().find(|value| value.node_id == 1).unwrap();
    let right = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    close(left.fz, 5.0, 1e-10, 1e-10);
    close(right.fz, 5.0, 1e-10, 1e-10);
    let shear = result.diagrams.shear_z.iter().find(|value| value.member_id == 1).unwrap();
    let moment = result.diagrams.moment_y.iter().find(|value| value.member_id == 1).unwrap();
    close(shear.max_abs_value, 5.0, 1e-10, 1e-10);
    close(moment.max_abs_value, 10.0, 1e-10, 1e-10);
}

fn request(nodes: Vec<Node3D>, members: Vec<Member3D>, supports: Vec<Support3D>, nodal_loads: Vec<NodalLoad3D>) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 1, analysis: AnalysisKind::Linear, nodes,
        materials: vec![Material3D { id: 1, name: "steel".into(), e_mpa: 210_000.0, nu: 0.3125, g_mpa: None, alpha_per_k: None }],
        sections: vec![section()], members, supports, nodal_loads, member_loads: vec![], member_point_loads: vec![], thermal_loads: vec![],
        plates: vec![], shell_elements: vec![], surface_loads: vec![],
        diaphragms: vec![], node_links: vec![],
        tension_only_fit: None, tension_only_cross_rule: false,
        max_iterations: 50, tolerance: 1e-10, buckling_modes: 0,
    }
}

#[test]
fn independent_timber_shear_modulus_controls_torsion_without_changing_bending() {
    let mut input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: -1.0, mx: 1.0, my: 0.0, mz: 0.0 }],
    );
    input.materials[0].e_mpa = 11_000.0;
    input.materials[0].nu = 0.0;
    let isotropic = solve(input.clone()).unwrap();
    input.materials[0].g_mpa = Some(690.0);
    let timber = solve(input.clone()).unwrap();
    let iso_end = isotropic.displacements.iter().find(|d| d.node_id == 2).unwrap();
    let wood_end = timber.displacements.iter().find(|d| d.node_id == 2).unwrap();
    close(wood_end.rx, 1.0 * 2.0 / (690.0 * 1000.0 * section().torsion_j_m4), 1e-8, 1e-10);
    close(wood_end.uz, iso_end.uz, 1e-8, 1e-10);
    assert!(wood_end.rx > iso_end.rx * 7.0);
    input.materials[0].g_mpa = Some(0.0);
    assert!(solve(input).unwrap_err().contains("G van materiaal 1"));
}

#[test]
fn uniform_thermal_expansion_uses_material_alpha() {
    let mut input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)],
        vec![fixed(1), Support3D {
            node_id: 2, ux: false, uy: true, uz: true, rx: true, ry: true, rz: true,
            ..Default::default()
        }],
        vec![],
    );
    input.materials[0].name = "concrete".into();
    input.materials[0].alpha_per_k = Some(10e-6);
    input.thermal_loads.push(ThermalLoad3D {
        id: 1, member_id: 1, delta_t_uniform_k: 30.0,
        delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 0.0,
    });
    let result = solve(input).unwrap();
    let end = result.displacements.iter().find(|value| value.node_id == 2).unwrap();
    close(end.ux, 2.0 * 10e-6 * 30.0, 1e-9, 1e-12);
    assert!(result.reactions.iter().all(|reaction| {
        [reaction.fx, reaction.fy, reaction.fz, reaction.mx, reaction.my, reaction.mz]
            .iter().all(|value| value.abs() < 1e-9)
    }));

    let mut invalid = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)], vec![],
    );
    invalid.thermal_loads.push(ThermalLoad3D {
        id: 1, member_id: 1, delta_t_uniform_k: 0.0,
        delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 0.0,
    });
    assert!(solve(invalid).unwrap_err().contains("niet-nulwaarde"));
}

#[test]
fn prescribed_axial_displacement_matches_bar_stiffness() {
    let mut moving = fixed(2);
    moving.ux_prescribed_m = Some(0.001);
    let input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1), moving], vec![],
    );
    let result = solve(input.clone()).unwrap();
    let end = result.displacements.iter().find(|value| value.node_id == 2).unwrap();
    close(end.ux, 0.001, 0.0, 1e-14);
    let left = result.reactions.iter().find(|value| value.node_id == 1).unwrap();
    let right = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    // EA/L · delta = 210e6 kN/m² · 0.01 m² / 2 m · 0.001 m = 1050 kN.
    close(left.fx, -1050.0, 1e-10, 1e-8);
    close(right.fx, 1050.0, 1e-10, 1e-8);
    close(result.member_forces[0].n_start_kn.abs(), 1050.0, 1e-10, 1e-8);

    let mut p_delta = input;
    p_delta.analysis = AnalysisKind::PDelta;
    let p_delta = solve(p_delta).unwrap();
    close(p_delta.displacements.iter().find(|value| value.node_id == 2).unwrap().ux, 0.001, 0.0, 1e-14);
    close(p_delta.reactions.iter().find(|value| value.node_id == 1).unwrap().fx, -1050.0, 1e-10, 1e-8);

    let invalid = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1), Support3D {
            node_id: 2, ux_prescribed_m: Some(0.001), ..Default::default()
        }], vec![],
    );
    assert!(solve(invalid).unwrap_err().contains("vereist een geblokkeerde vrijheidsgraad"));
}

#[test]
fn uniform_local_z_member_load_matches_cantilever_closed_form() {
    let mut input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)], vec![],
    );
    input.member_loads.push(MemberLoad3D {
        id: 1, member_id: 1,
        qy_start_kn_per_m: 0.0, qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -4.0, qz_end_kn_per_m: -4.0,
        start_position_m: None, end_position_m: None,
        ..Default::default()
    });
    let result = solve(input).unwrap();
    let tip = result.displacements.iter().find(|value| value.node_id == 2).unwrap();
    // wL^4/(8 E Iy), with E converted from MPa to kN/m² by the engine boundary.
    close(tip.uz, -0.004761904761904762, 1e-8, 1e-12);
    let reaction = result.reactions.iter().find(|value| value.node_id == 1).unwrap();
    close(reaction.fz, 8.0, 1e-10, 1e-10);
    close(reaction.my.abs(), 8.0, 1e-10, 1e-10);

    // De productgrens levert de volledige lijn, niet alleen twee eindwaarden.
    // Voor qz=-4 kN/m: Vz(x)=8-4x en My(x)=-8+8x-2x².
    let shear = result.diagrams.shear_z.iter().find(|value| value.member_id == 1).unwrap();
    let moment = result.diagrams.moment_y.iter().find(|value| value.member_id == 1).unwrap();
    let mid_shear = shear.points.iter().find(|point| (point.t - 0.5).abs() < 1e-12).unwrap();
    let mid_moment = moment.points.iter().find(|point| (point.t - 0.5).abs() < 1e-12).unwrap();
    close(shear.points.first().unwrap().value, 8.0, 1e-10, 1e-10);
    close(mid_shear.value, 4.0, 1e-10, 1e-10);
    close(shear.points.last().unwrap().value, 0.0, 0.0, 1e-10);
    close(moment.points.first().unwrap().value, -8.0, 1e-10, 1e-10);
    close(mid_moment.value, -2.0, 1e-10, 1e-10);
    close(moment.points.last().unwrap().value, 0.0, 0.0, 1e-10);
    close(shear.max_abs_value, 8.0, 1e-10, 1e-10);
    close(moment.max_abs_value, 8.0, 1e-10, 1e-10);
}

#[test]
fn member_end_release_matches_propped_cantilever_closed_form() {
    let length: f64 = 4.0;
    let load = 4.0;
    let mut released_member = member(1, 1, 2);
    released_member.releases.my_end = true;
    let mut input = request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 },
            Node3D { id: 2, x: length, y: 0.0, z: 0.0 },
        ],
        vec![released_member],
        vec![fixed(1), fixed(2)],
        vec![],
    );
    input.member_loads.push(MemberLoad3D {
        id: 1,
        member_id: 1,
        qy_start_kn_per_m: 0.0,
        qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -load,
        qz_end_kn_per_m: -load,
        start_position_m: None,
        end_position_m: None,
        ..Default::default()
    });

    let result = solve(input).unwrap();
    let left = result.reactions.iter().find(|value| value.node_id == 1).unwrap();
    let right = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    close(left.fz, 5.0 * load * length / 8.0, 1e-10, 1e-10);
    close(right.fz, 3.0 * load * length / 8.0, 1e-10, 1e-10);
    close(left.my.abs(), load * length * length / 8.0, 1e-10, 1e-10);
    close(right.my, 0.0, 0.0, 1e-10);
    let forces = &result.member_forces[0];
    close(forces.my_end_knm, 0.0, 0.0, 1e-10);
    assert!(result.equilibrium.as_ref().is_some_and(|value| value.equilibrium_ok));
}

#[test]
fn translational_support_spring_matches_closed_form_and_reports_reaction() {
    let make_request = || request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1), Support3D {
            node_id: 2, kz_kn_per_m: Some(370.0), ..Default::default()
        }],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    );
    let result = solve(make_request()).unwrap();
    // Cantilever end stiffness 3EI/L³ = 630 kN/m, in parallel with 370 kN/m.
    let tip = result.displacements.iter().find(|value| value.node_id == 2).unwrap();
    close(tip.uz, -0.01, 1e-10, 1e-12);
    let spring_reaction = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    let fixed_reaction = result.reactions.iter().find(|value| value.node_id == 1).unwrap();
    close(spring_reaction.fz, 3.7, 1e-10, 1e-10);
    close(fixed_reaction.fz, 6.3, 1e-10, 1e-10);
    assert!(result.equilibrium.as_ref().is_some_and(|value| value.equilibrium_ok));

    let mut p_delta = make_request();
    p_delta.analysis = AnalysisKind::PDelta;
    let p_delta = solve(p_delta).unwrap();
    close(p_delta.displacements.iter().find(|value| value.node_id == 2).unwrap().uz, -0.01, 1e-10, 1e-12);
    close(p_delta.reactions.iter().find(|value| value.node_id == 2).unwrap().fz, 3.7, 1e-10, 1e-10);
    close(p_delta.reactions.iter().map(|value| value.fz).sum(), 10.0, 1e-10, 1e-10);
    assert!(p_delta.equilibrium.as_ref().is_none_or(|value| value.equilibrium_ok));

    let mut invalid = make_request();
    invalid.supports[1].uz = true;
    assert!(solve(invalid).unwrap_err().contains("tegelijk blokkeren en veren"));
}

fn member(id: usize, start: usize, end: usize) -> Member3D {
    Member3D { id, start_node_id: start, end_node_id: end, material_id: 1, section_id: 1,
        releases: Default::default(), roll_angle_rad: None, intermediate_node_ids: vec![], tension_only: false, bedding: None, part_section_ids: None }
}

fn fixed(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true, ..Default::default() }
}

fn pinned(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false, ..Default::default() }
}

fn revolute_x(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: false, ry: true, rz: true, ..Default::default() }
}

fn revolute_y(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: false, rz: true, ..Default::default() }
}

fn revolute_z(node_id: usize) -> Support3D {
    Support3D { node_id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: false, ..Default::default() }
}

fn close(actual: f64, expected: f64, relative: f64, absolute: f64) {
    let difference = (actual - expected).abs();
    assert!(difference <= absolute.max(expected.abs() * relative),
        "actual={actual:.12e}, expected={expected:.12e}, difference={difference:.12e}");
}

#[test]
fn axial_oblique_xyz_matches_closed_form() {
    let result = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 2.0, z: 1.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 6.0, fy: 6.0, fz: 3.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    )).unwrap();
    let tip = result.displacements.iter().find(|v| v.node_id == 2).unwrap();
    close(tip.ux, 8.571428571428572e-6, 1e-8, 1e-12);
    close(tip.uy, 8.571428571428572e-6, 1e-8, 1e-12);
    close(tip.uz, 4.285714285714286e-6, 1e-8, 1e-12);
    let reaction = result.reactions.iter().find(|v| v.node_id == 1).unwrap();
    close(reaction.fx, -6.0, 1e-10, 1e-10);
    close(reaction.fy, -6.0, 1e-10, 1e-10);
    close(reaction.fz, -3.0, 1e-10, 1e-10);
}

#[test]
fn cantilever_biaxial_bending_keeps_iy_and_iz_separate() {
    let result = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 3.0, fz: 4.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    )).unwrap();
    let tip = result.displacements.iter().find(|v| v.node_id == 2).unwrap();
    close(tip.uy, 0.003174603174603175, 1e-8, 1e-12);
    close(tip.uz, 0.006349206349206349, 1e-8, 1e-12);
    close(tip.ry, -0.004761904761904762, 1e-8, 1e-12);
    close(tip.rz, 0.002380952380952381, 1e-8, 1e-12);
}

#[test]
fn torsion_on_rotated_member_transforms_to_global_rotations() {
    let result = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 0.0, y: 3.0, z: 4.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.6, mz: 0.8 }],
    )).unwrap();
    let tip = result.displacements.iter().find(|v| v.node_id == 2).unwrap();
    close(tip.ry, 0.0075, 1e-8, 1e-12);
    close(tip.rz, 0.01, 1e-8, 1e-12);
}

#[test]
fn revolute_x_support_releases_only_rotation_about_x() {
    let result = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 3.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)],
        vec![revolute_x(1), Support3D {
            node_id: 2, ux: false, uy: false, uz: false, rx: true, ry: false, rz: false,
            ..Default::default()
        }],
        vec![NodalLoad3D { id: 1, node_id: 1, fx: 0.0, fy: 0.0, fz: 0.0, mx: 5.0, my: 0.0, mz: 0.0 }],
    )).unwrap();
    let hinge = result.displacements.iter().find(|value| value.node_id == 1).unwrap();
    // θ = T·L/(GJ) = 5·3/(80e6·5e-6) = 0.0375 rad.
    close(hinge.rx, 0.0375, 1e-8, 1e-12);
    close(hinge.ry, 0.0, 1e-8, 1e-12);
    close(hinge.rz, 0.0, 1e-8, 1e-12);
    let reaction = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    close(reaction.mx.abs(), 5.0, 1e-10, 1e-10);
}

#[test]
fn revolute_y_and_z_supports_release_only_the_selected_rotation() {
    let cases = [
        (revolute_y(1), NodalLoad3D {
            id: 1, node_id: 1, fx: 0.0, fy: 0.0, fz: 0.0,
            mx: 0.0, my: 5.0, mz: 0.0,
        }, Support3D {
            node_id: 2, ry: true, ..Default::default()
        }, 0.00892857142857143, 'y'),
        (revolute_z(1), NodalLoad3D {
            id: 1, node_id: 1, fx: 0.0, fy: 0.0, fz: 0.0,
            mx: 0.0, my: 0.0, mz: 5.0,
        }, Support3D {
            node_id: 2, rz: true, ..Default::default()
        }, 0.005952380952380952, 'z'),
    ];
    for (support, load, far_support, expected_rotation, axis) in cases {
        let result = solve(request(
            vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 3.0, y: 0.0, z: 0.0 }],
            vec![member(1, 1, 2)], vec![support, far_support], vec![load],
        )).unwrap();
        let hinge = result.displacements.iter().find(|value| value.node_id == 1).unwrap();
        let actual = if axis == 'y' { hinge.ry } else { hinge.rz };
        close(actual, expected_rotation, 1e-8, 1e-12);
        close(hinge.rx, 0.0, 0.0, 1e-12);
        close(if axis == 'y' { hinge.rz } else { hinge.ry }, 0.0, 0.0, 1e-12);
        let reaction = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
        close(if axis == 'y' { reaction.my.abs() } else { reaction.mz.abs() }, 5.0, 1e-10, 1e-10);
    }
}

#[test]
fn prescribed_end_rotation_matches_slope_deflection() {
    let mut moving = fixed(2);
    moving.rz_prescribed_rad = Some(0.001);
    let result = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1), moving], vec![],
    )).unwrap();
    let end = result.displacements.iter().find(|value| value.node_id == 2).unwrap();
    close(end.rz, 0.001, 0.0, 1e-14);

    // Slope-deflection for a prismatic member without chord translation:
    // |M1| = 2 E Iz θ/L = 2.52 kNm and |M2| = 4 E Iz θ/L = 5.04 kNm.
    let left = result.reactions.iter().find(|value| value.node_id == 1).unwrap();
    let right = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    close(left.mz.abs(), 2.52, 1e-10, 1e-10);
    close(right.mz.abs(), 5.04, 1e-10, 1e-10);
    // The associated end shears form a self-equilibrating couple.
    close(left.fy.abs(), 3.78, 1e-10, 1e-10);
    close(right.fy.abs(), 3.78, 1e-10, 1e-10);
    close(left.fy + right.fy, 0.0, 0.0, 1e-10);
    assert!(result.equilibrium.as_ref().is_some_and(|value| value.equilibrium_ok));
}

#[test]
fn member_roll_contract_uses_radians_and_swaps_bending_axes() {
    let mut rolled = member(1, 1, 2);
    rolled.roll_angle_rad = Some(std::f64::consts::FRAC_PI_2);
    let result = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 2.0, y: 0.0, z: 0.0 }],
        vec![rolled], vec![fixed(1)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: 4.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    )).unwrap();
    let tip = result.displacements.iter().find(|value| value.node_id == 2).unwrap();
    // 4 kN * 2^3 / (3 * 210 GPa * Iz), because a 90-degree roll puts the
    // global Z load on local y and therefore bends about local z.
    close(tip.uz, 0.004232804232804233, 1e-8, 1e-12);
}

#[test]
fn direct_second_order_and_buckling_are_reported() {
    let n = 8usize;
    let length = 4.0;
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    for index in 0..=n {
        nodes.push(Node3D { id: index + 1, x: 0.0, y: 0.0, z: index as f64 * length / n as f64 });
        if index > 0 { members.push(member(index, index, index + 1)); }
    }
    let mut req = request(nodes, members, vec![fixed(1)], vec![NodalLoad3D {
        id: 1, node_id: n + 1, fx: 0.01, fy: 0.0, fz: -25.0, mx: 0.0, my: 0.0, mz: 0.0,
    }]);
    req.analysis = AnalysisKind::PDelta;
    req.buckling_modes = 2;
    let result = solve(req).unwrap();
    let second_order = result.second_order.expect("tweede-ordegegevens");
    assert!(second_order.converged && second_order.stable);
    assert!(second_order.iterations >= 1);
    match result.buckling {
        BucklingSummary::Available { modes, members } => {
            assert!(!modes.is_empty());
            assert!(modes[0].load_factor > 1.0);
            assert!(!members.is_empty());
        }
        other => panic!("knikresultaat verwacht, kreeg {other:?}"),
    }
}

#[test]
fn pdelta_amplifies_compression_and_stiffens_tension() {
    let n = 8usize;
    let length = 4.0;
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    for index in 0..=n {
        nodes.push(Node3D { id: index + 1, x: 0.0, y: 0.0, z: index as f64 * length / n as f64 });
        if index > 0 { members.push(member(index, index, index + 1)); }
    }
    let make = |axial_kn: f64, analysis: AnalysisKind| {
        let mut value = request(
            nodes.clone(), members.clone(), vec![fixed(1)],
            vec![NodalLoad3D {
                id: 1, node_id: n + 1, fx: 0.01, fy: 0.0, fz: axial_kn,
                mx: 0.0, my: 0.0, mz: 0.0,
            }],
        );
        value.analysis = analysis;
        value.buckling_modes = 0;
        value
    };
    let linear = solve(make(0.0, AnalysisKind::Linear)).unwrap();
    let compression = solve(make(-25.0, AnalysisKind::PDelta)).unwrap();
    let tension = solve(make(25.0, AnalysisKind::PDelta)).unwrap();
    let tip_x = |result: &open_fem_3d::SolveResult3D| result.displacements.iter()
        .find(|value| value.node_id == n + 1).unwrap().ux.abs();
    let u_linear = tip_x(&linear);
    let u_compression = tip_x(&compression);
    let u_tension = tip_x(&tension);
    assert!(u_compression > u_linear, "druk hoort te versterken: {u_compression} <= {u_linear}");
    assert!(u_tension < u_linear, "trek hoort te verstijven: {u_tension} >= {u_linear}");
    assert!(compression.second_order.as_ref().is_some_and(|value| value.max_amplification > 1.0));
    // B2 is reported as a non-reducing amplification factor and is therefore
    // capped at 1.0 even though the actual tensile displacement is smaller.
    assert!(tension.second_order.as_ref().is_some_and(|value| value.max_amplification <= 1.0 + 1e-12));
}

#[test]
fn pdelta_near_and_beyond_critical_load_is_bounded() {
    let n = 8usize;
    let length = 4.0;
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    for index in 0..=n {
        nodes.push(Node3D { id: index + 1, x: 0.0, y: 0.0, z: index as f64 * length / n as f64 });
        if index > 0 { members.push(member(index, index, index + 1)); }
    }
    let make = |compression_kn: f64, buckling_modes: usize| {
        let mut value = request(
            nodes.clone(), members.clone(), vec![fixed(1)],
            vec![NodalLoad3D {
                id: 1, node_id: n + 1, fx: 0.01, fy: 0.0, fz: -compression_kn,
                mx: 0.0, my: 0.0, mz: 0.0,
            }],
        );
        value.analysis = AnalysisKind::PDelta;
        value.max_iterations = 100;
        value.buckling_modes = buckling_modes;
        value
    };

    let probe = solve(make(25.0, 1)).unwrap();
    let alpha_cr = match probe.buckling {
        BucklingSummary::Available { modes, .. } => modes[0].load_factor,
        other => panic!("fysieke knikmodus verwacht, kreeg {other:?}"),
    };
    let critical_load_kn = 25.0 * alpha_cr;
    let near = solve(make(0.9 * critical_load_kn, 0)).unwrap();
    let near_second_order = near.second_order.expect("tweede-ordegegevens nabij Pcr");
    assert!(near_second_order.converged && near_second_order.stable);
    assert!(near_second_order.max_amplification > 2.0);
    assert!(near.displacements.iter().all(|value|
        [value.ux, value.uy, value.uz, value.rx, value.ry, value.rz].iter().all(|dof| dof.is_finite())));

    let error = solve(make(1.05 * critical_load_kn, 0)).unwrap_err();
    assert!(
        error.contains("instabiliteit") || error.contains("convergeerde niet") || error.contains("mechanisme"),
        "boven Pcr is een gerichte stabiliteitsmelding vereist, kreeg: {error}",
    );
}

#[test]
fn cantilever_buckling_converges_under_mesh_refinement() {
    let length: f64 = 4.0;
    let probe_load_kn = 25.0;
    let e_kn_m2 = 210_000_000.0;
    let weak_axis_i_m4 = 8e-6;
    let euler_critical_kn = std::f64::consts::PI.powi(2) * e_kn_m2 * weak_axis_i_m4
        / (4.0 * length.powi(2));
    let critical_load = |segments: usize| {
        let nodes = (0..=segments)
            .map(|index| Node3D {
                id: index + 1,
                x: 0.0,
                y: 0.0,
                z: index as f64 * length / segments as f64,
            })
            .collect();
        let members = (1..=segments)
            .map(|index| member(index, index, index + 1))
            .collect();
        let mut input = request(
            nodes,
            members,
            vec![fixed(1)],
            vec![NodalLoad3D {
                id: 1,
                node_id: segments + 1,
                fx: 0.0,
                fy: 0.0,
                fz: -probe_load_kn,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
            }],
        );
        input.buckling_modes = 1;
        let solved = solve(input).unwrap();
        match solved.buckling {
            BucklingSummary::Available { modes, .. } => modes[0].load_factor * probe_load_kn,
            other => panic!("fysieke knikmodus verwacht voor {segments} elementen, kreeg {other:?}"),
        }
    };

    let loads: Vec<_> = [1, 2, 4, 8, 16]
        .into_iter()
        .map(|segments| (segments, critical_load(segments)))
        .collect();
    let errors: Vec<_> = loads
        .iter()
        .map(|(_, value)| (value - euler_critical_kn).abs() / euler_critical_kn)
        .collect();
    for pair in errors.windows(2) {
        assert!(pair[1] <= pair[0] + 1e-10, "knikfout neemt niet af: {errors:?}");
    }
    assert!(errors.last().is_some_and(|error| *error < 1e-4),
        "16 elementen horen binnen 0,01% van Euler te liggen: loads={loads:?}, errors={errors:?}");
    eprintln!("Euler Pcr={euler_critical_kn:.9} kN; mesh={loads:?}; relative errors={errors:?}");
}

#[test]
fn pdelta_accepts_zero_displacement_when_load_is_fully_restrained() {
    let mut req = request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 },
            Node3D { id: 2, x: 3.0, y: 0.0, z: 0.0 },
        ],
        vec![member(1, 1, 2)],
        vec![
            fixed(1),
            Support3D {
                node_id: 2,
                ux: false,
                uy: false,
                uz: true,
                rx: false,
                ry: false,
                rz: false,
                ..Default::default()
            },
        ],
        vec![NodalLoad3D {
            id: 1,
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            fz: -10.0,
            mx: 0.0,
            my: 0.0,
            mz: 0.0,
        }],
    );
    req.analysis = AnalysisKind::PDelta;
    let result = solve(req).unwrap();
    let second_order = result.second_order.expect("tweede-ordegegevens");
    assert!(second_order.converged && second_order.stable);
    close(second_order.max_amplification, 1.0, 0.0, 1e-12);
    assert!(result.displacements.iter().all(|value| {
        [value.ux, value.uy, value.uz, value.rx, value.ry, value.rz]
            .iter()
            .all(|dof| dof.abs() <= 1e-20)
    }));
    let reaction = result.reactions.iter().find(|value| value.node_id == 2).unwrap();
    close(reaction.fz, 10.0, 1e-10, 1e-10);
    assert!(result.diagnostics.iter().any(|message| message.contains("P-Delta-nultoestand")));
}

#[test]
fn portal_buckling_gives_no_buckling_factor_for_a_free_rigid_body_mode() {
    let mut req = request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 },
            Node3D { id: 2, x: 12.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 0.0, y: 0.0, z: 5.0 },
            Node3D { id: 4, x: 12.0, y: 0.0, z: 5.0 },
        ],
        vec![member(1, 1, 3), member(2, 2, 4), member(3, 3, 4)],
        vec![pinned(1), pinned(2)],
        vec![NodalLoad3D { id: 1, node_id: 3, fx: 0.0, fy: 0.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    );
    // Het portaal kan als geheel om de lijn door de voeten omvallen. De
    // vroegere knikanalyse filterde die nulmode uit en gaf toch een
    // knikfactor; daarom mag geen knikfactor worden gepubliceerd.
    // GEWIJZIGD door #195 (mechanisme dat de belasting niet aanstoot: een
    // uitkomst met een melding in plaats van een fout). De verticale last
    // werkt loodrecht op het omvallen: lineair een uitkomst met de melding van
    // de opleggingen, en de knik geweigerd met knikfactor 0 (de drukkracht in
    // kolom 1 maakt het omvallen instabiel). Tot #195 was dit een fout.
    req.buckling_modes = 3;
    let result = solve(req.clone()).unwrap_or_else(|error| panic!("{error}"));
    assert!(result.diagnostics.iter().any(|m| m.starts_with("Opleggingen:") && m.contains("draaien om X (as door knoop 1 en 2)")),
        "{:?}", result.diagnostics);
    match &result.buckling {
        BucklingSummary::Failed { reason } => assert!(reason.contains("knikfactor 0"), "{reason}"),
        other => panic!("geen knikfactor verwacht: {other:?}"),
    }
    // Reacties uit het evenwicht: de last van 10 kN in knoop 3 verdeelt zich
    // in het vlak over beide voeten (het portaal is in zijn vlak stijf).
    let fz: f64 = result.reactions.iter().map(|r| r.fz).sum();
    close(fz, 10.0, 1e-10, 1e-10);
    // Tweede orde: de drukkracht maakt het omvallen instabiel (K + K_G niet
    // positief definiet): een fout die dezelfde vrije beweging noemt.
    req.analysis = AnalysisKind::PDelta;
    let error = solve(req).unwrap_err();
    assert!(error.contains("draaien om X (as door knoop 1 en 2)") && error.contains("niet positief definiet"), "{error}");
}

#[test]
fn malformed_model_is_rejected_before_engine_call() {
    let error = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 1, x: 1.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![fixed(1)], vec![],
    )).unwrap_err();
    assert!(error.contains("dubbele knoop-id"));
}

#[test]
fn torsion_mechanism_has_actionable_diagnostics() {
    let error = solve(request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 3.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![pinned(1), pinned(2)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: 0.0, mx: 5.0, my: 0.0, mz: 0.0 }],
    )).unwrap_err();
    assert!(error.contains("mechanisme"), "{error}");
    assert!(error.contains("torsie om de staafas"), "{error}");
    assert!(error.contains("revolute-oplegging") && error.contains("rotatieveer"), "{error}");
}

#[test]
fn no_spurious_nearly_vertical_warning_for_members_along_y() {
    // De externe kern toetst "nearly vertical" tegen globaal Y, terwijl de
    // lokale assen (en Open FEM 3D) Z omhoog gebruiken. Een ligger langs Y
    // kreeg die melding onterecht (#61); een kolom langs Z hoort hem ook niet
    // te krijgen. Echte meldingen blijven staan.
    let input = request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 0.0, y: 0.0, z: 4.0 },
            Node3D { id: 3, x: 0.0, y: 6.0, z: 4.0 }, Node3D { id: 4, x: 0.0, y: 6.0, z: 0.0 },
        ],
        vec![member(1, 1, 2), member(2, 2, 3), member(3, 4, 3)],
        vec![fixed(1), fixed(4)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 1.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    );
    let result = solve(input).unwrap();
    assert!(
        !result.diagnostics.iter().any(|message| message.contains("nearly vertical")),
        "onterechte melding: {:?}", result.diagnostics,
    );
    assert!(!result.diagnostics.is_empty(), "de overige meldingen van de kern blijven staan");
}

/// Horizontaal raam in het XY-vlak (knoop 1, 2, 3), alleen verticaal opgelegd.
fn vertical_supports_only() -> SolveRequest3D {
    let roller = |node_id| Support3D { node_id, uz: true, ..Default::default() };
    request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 4.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 4.0, y: 3.0, z: 0.0 },
        ],
        vec![member(1, 1, 2), member(2, 2, 3)],
        vec![roller(1), roller(2), roller(3)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    )
}

#[test]
fn mechanism_error_names_the_part_the_free_motions_and_a_remedy() {
    // #64: welk deel, welke bewegingen vrij zijn en wat te doen, met de
    // algemene uitleg erachter. Sinds #110 rekent de adapter een mechanisme
    // zelf na: de verticale last op dit alleen verticaal opgelegde raam werkt
    // loodrecht op de vrije bewegingen (verschuiven in X en Y, draaien om Z)
    // en geeft nu een uitkomst met de melding van de opleggingen. Tot #110
    // weigerde de kern dit model ("Engine: Singular ..."). Een horizontale
    // last stoot de vrije beweging aan: de fout, met dezelfde bevinding en de
    // kracht langs die beweging in plaats van de melding van de kern.
    let result = solve(vertical_supports_only()).unwrap();
    assert!(result.diagnostics[0].starts_with("Opleggingen: Het deel met knopen 1–3 en staven 1–2 is onvoldoende opgelegd"), "{:?}", result.diagnostics);
    assert!(!result.diagnostics.iter().any(|m| m.starts_with("Mechanisme:")), "geen tweede melding: {:?}", result.diagnostics);
    let sideways = || {
        let mut input = vertical_supports_only();
        input.nodal_loads[0].fx = 1.0;
        input
    };
    let error = solve(sideways()).unwrap_err();
    assert!(error.contains("mechanisme") && error.contains("singuliere stijfheidsmatrix"), "{error}");
    assert!(error.contains("Het deel met knopen 1–3 en staven 1–2 is onvoldoende opgelegd"), "{error}");
    assert!(error.contains("vrij: verschuiven in X, verschuiven in Y en draaien om Z"), "{error}");
    assert!(error.contains("voeg horizontale opleggingen in X en Y toe") && error.contains("blokkeer de rotatie om Z"), "{error}");
    assert!(error.contains("Controleer per verbonden modeldeel"), "de algemene uitleg blijft staan: {error}");
    assert!(error.contains("de belasting stoot die beweging aan") && error.contains("1,000 kN in X"), "{error}");

    // Tweede orde: dezelfde melding, met de eigen context.
    let mut second_order = sideways();
    second_order.analysis = AnalysisKind::PDelta;
    let error = solve(second_order).unwrap_err();
    assert!(error.starts_with("tweede-orde 3D-berekening: het model is een mechanisme"), "{error}");
    assert!(error.contains("Het deel met knopen 1–3 en staven 1–2 is onvoldoende opgelegd"), "{error}");
    assert!(error.contains("vrij: verschuiven in X, verschuiven in Y en draaien om Z"), "{error}");
}

#[test]
fn internal_mechanism_is_reported_as_such_when_supports_are_sufficient() {
    // Twee ingeklemde einden en twee staven die aan beide einden voor buiging
    // zijn vrijgegeven (vakwerkstaven op één lijn): knoop 2 kan dwars op de
    // lijn bewegen. De opleggingen houden het deel vast; de melding zegt dat
    // het een intern mechanisme is. (Tot #96 stond hier het geval met alleen
    // de einden in knoop 2 vrijgegeven: twee consoles met een scharnier. Dat
    // rekent nu: de vrije draaiing van knoop 2 vervormt niets en wordt
    // vastgehouden, zie tests/knoopdraaiing.rs.)
    let mut first = member(1, 1, 2);
    first.releases.my_start = true;
    first.releases.mz_start = true;
    first.releases.my_end = true;
    first.releases.mz_end = true;
    let mut second = member(2, 2, 3);
    second.releases.my_start = true;
    second.releases.mz_start = true;
    second.releases.my_end = true;
    second.releases.mz_end = true;
    let error = solve(request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 4.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 8.0, y: 0.0, z: 0.0 },
        ],
        vec![first, second], vec![fixed(1), fixed(3)],
        vec![NodalLoad3D { id: 1, node_id: 2, fx: 0.0, fy: 0.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    )).unwrap_err();
    assert!(error.contains("singuliere stijfheidsmatrix"), "{error}");
    assert!(error.contains("De opleggingen houden elk verbonden modeldeel als geheel vast") && error.contains("intern mechanisme"), "{error}");
    assert!(!error.contains("onvoldoende opgelegd;"), "{error}");
}

#[test]
fn an_unexcited_mechanism_gives_a_warning_an_excited_one_an_error() {
    // Portaal met ruimtelijke scharnieren: het kan om de lijn door beide voeten
    // buiten zijn vlak omvallen. GEWIJZIGD door #195: onder een last in zijn
    // vlak (geen component langs het omvallen) een uitkomst met de melding van
    // de opleggingen; tot #195 wees de adapter het model af. Een last die het
    // omvallen aanstoot, blijft een fout.
    let portal = |foot: fn(usize) -> Support3D| request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 12.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 0.0, y: 0.0, z: 5.0 }, Node3D { id: 4, x: 12.0, y: 0.0, z: 5.0 },
        ],
        vec![member(1, 1, 3), member(2, 2, 4), member(3, 3, 4)],
        vec![foot(1), foot(2)],
        vec![NodalLoad3D { id: 1, node_id: 3, fx: 1.0, fy: 0.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 }],
    );
    let result = solve(portal(pinned)).unwrap_or_else(|error| panic!("{error}"));
    let melding = &result.diagnostics[0];
    assert!(melding.starts_with("Opleggingen: Het deel met knopen 1–4 en staven 1–3 is onvoldoende opgelegd"), "{melding}");
    assert!(melding.contains("vrij: draaien om X (as door knoop 1 en 2)"), "{melding}");
    assert!(!result.diagnostics.iter().any(|m| m.starts_with("Mechanisme:")), "geen tweede melding: {:?}", result.diagnostics);
    // Kleinste oplossing: geen verplaatsing in Y (het omvallen eraf).
    assert!(result.displacements.iter().all(|d| d.uy.abs() < 1e-14), "{:?}", result.displacements);

    // Een last die de beweging aanstoot: dezelfde bevinding staat in de fout.
    let mut sideways = portal(pinned);
    sideways.nodal_loads[0].fy = 1.0;
    let error = solve(sideways).unwrap_err();
    assert!(error.contains("Opleggingen: Het deel met knopen 1–4") && error.contains("draaien om X (as door knoop 1 en 2)"), "{error}");
    assert!(error.contains("de belasting stoot die beweging aan"), "{error}");

    // Goed opgelegd: geen melding over de opleggingen.
    let good = solve(portal(fixed)).unwrap();
    assert!(!good.diagnostics.iter().any(|message| message.contains("Opleggingen")), "{:?}", good.diagnostics);
}

#[test]
fn a_tension_only_member_that_drops_out_is_left_out_of_the_support_check() {
    // Portaal 1–4 met ruimtelijke scharnieren in de voeten (kan buiten zijn
    // vlak omvallen) en een ingeklemde kolom 6–5 ernaast. Trek-alleen staaf 5
    // (5–3) koppelt ze; zolang die meedoet, houdt de inklemming alles vast.
    // De last fx op knoop 5 drukt staaf 5 in; zonder staaf 5 kan het portaal
    // omvallen, maar de last op het portaal ligt in zijn vlak. GEWIJZIGD door
    // #195: een uitkomst met de melding die dat deel en de inactieve staaf
    // noemt (tot #195 een fout met dezelfde bevinding).
    let mut tie = member(5, 5, 3);
    tie.tension_only = true;
    let input = request(
        vec![
            Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 12.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 0.0, y: 0.0, z: 5.0 }, Node3D { id: 4, x: 12.0, y: 0.0, z: 5.0 },
            Node3D { id: 5, x: -3.0, y: 0.0, z: 5.0 }, Node3D { id: 6, x: -3.0, y: 0.0, z: 0.0 },
        ],
        vec![member(1, 1, 3), member(2, 2, 4), member(3, 3, 4), member(4, 6, 5), tie],
        vec![pinned(1), pinned(2), fixed(6)],
        vec![
            NodalLoad3D { id: 1, node_id: 5, fx: 10.0, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.0, mz: 0.0 },
            NodalLoad3D { id: 2, node_id: 4, fx: 0.0, fy: 0.0, fz: -10.0, mx: 0.0, my: 0.0, mz: 0.0 },
        ],
    );
    let result = solve(input).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(result.inactive_members, vec![5], "{:?}", result.diagnostics);
    let melding = result.diagnostics.iter().find(|m| m.starts_with("Opleggingen:"))
        .unwrap_or_else(|| panic!("{:?}", result.diagnostics));
    assert!(melding.contains("Het deel met knopen 1–4 en staven 1–3 is onvoldoende opgelegd"), "{melding}");
    assert!(melding.contains("vrij: draaien om X (as door knoop 1 en 2)"), "{melding}");
    // Staaf 5 is inactief (zie `inactive_members` hierboven); de melding gaat over het deel zonder haar.
    assert!(!melding.contains("knopen 1–6"), "met staaf 5 erbij was alles vast: {melding}");
}

#[test]
fn pendulum_columns_under_a_diaphragm_name_the_sway_of_the_diaphragm() {
    // Vier kolommen met een scharnierende voet, de koppen in één starre schijf,
    // zonder verband: de vloer kan zwaaien in X en Y en draaien om Z.
    let columns = |loads: Vec<NodalLoad3D>| {
        let mut nodes = Vec::new();
        let mut members = Vec::new();
        let mut supports = Vec::new();
        for (i, (x, y)) in [(0.0, 0.0), (6.0, 0.0), (0.0, 6.0), (6.0, 6.0)].into_iter().enumerate() {
            nodes.push(Node3D { id: 2 * i + 1, x, y, z: 0.0 });
            nodes.push(Node3D { id: 2 * i + 2, x, y, z: 4.0 });
            members.push(member(i + 1, 2 * i + 1, 2 * i + 2));
            supports.push(pinned(2 * i + 1));
        }
        let mut input = request(nodes, members, supports, loads);
        input.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![2, 4, 6, 8] });
        input
    };
    let load = |id: usize, node_id: usize, fx: f64, fz: f64| NodalLoad3D { id, node_id, fx, fy: 0.0, fz, mx: 0.0, my: 0.0, mz: 0.0 };
    let sway = "Schijf 1 kan met de delen die eraan hangen (knopen 1–8 en staven 1–4) als geheel bewegen; vrij: verschuiven in X, verschuiven in Y en draaien om Z.";

    // Een horizontale last: geen oplossing; de fout noemt de schijf en wat te doen.
    let error = solve(columns(vec![load(1, 2, 1.0, -10.0)])).unwrap_err();
    assert!(error.contains(sway), "{error}");
    assert!(error.contains("toe die schijf 1 in X en Y en tegen draaien om Z vasthouden"), "{error}");
    assert!(!error.contains("kunnen samen nog bewegen"), "{error}");

    // Alleen verticale lasten. GEWIJZIGD door #195: de lasten hebben geen
    // component langs het zwaaien, dus een uitkomst met de melding (tot #195
    // een fout). Elke kolom draagt haar eigen 10 kN.
    let result = solve(columns((0..4).map(|i| load(i + 1, 2 * i + 2, 0.0, -10.0)).collect()))
        .unwrap_or_else(|error| panic!("{error}"));
    assert!(result.diagnostics.iter().any(|m| m.contains(sway)), "{:?}", result.diagnostics);
    for voet in [1, 3, 5, 7] {
        let reactie = result.reactions.iter().find(|r| r.node_id == voet).unwrap();
        close(reactie.fz, 10.0, 1e-10, 1e-10);
    }
}

#[test]
fn rigid_diaphragm_on_four_columns_reports_the_reduced_residual_not_a_false_alarm() {
    // #238: vier ingeklemde kolommen CHS 219.1×8 (A = 5306 mm², I = 2,96·10⁷ mm⁴,
    // J = 2I), L = 4 m, hoeken van een vlak 6 × 6 m, koppen 5–8 in een starre
    // schijf, F_x = 20 kN op kop 5 (x = y = 0). E = 210 000 N/mm², ν = 0,3.
    // Handberekening (koppen draaien vrij om X/Y, dus uitkragende kolommen):
    //   k = 3EI/L³ = 3·210e6·2,96e-5/64 = 291,375 kN/m per kolom
    //   GJ/L = 210e6/2,6 · 5,92e-5 / 4 = 1195,38 kNm/rad per kolom
    //   K_θ = 4·k·(3² + 3²) + 4·GJ/L = 25 760,5 kNm/rad
    //   θ_z = F·3 / K_θ = 60 / 25 760,5 = 2,3291e-3 rad
    //   u_x,5 = F/(4k) + 3·θ_z = 24,147 mm
    let e = 210e6_f64;
    let (a, i) = (5306e-6, 2.96e-5);
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    let mut supports = Vec::new();
    for (n, (x, y)) in [(0.0, 0.0), (6.0, 0.0), (0.0, 6.0), (6.0, 6.0)].into_iter().enumerate() {
        nodes.push(Node3D { id: n + 1, x, y, z: 0.0 });
        nodes.push(Node3D { id: n + 5, x, y, z: 4.0 });
        members.push(member(n + 1, n + 1, n + 5));
        supports.push(fixed(n + 1));
    }
    let mut input = request(nodes, members, supports,
        vec![NodalLoad3D { id: 1, node_id: 5, fx: 20.0, fy: 0.0, fz: 0.0, mx: 0.0, my: 0.0, mz: 0.0 }]);
    input.materials[0].nu = 0.3;
    input.sections[0] = Section3D { id: 1, name: "CHS 219.1x8".into(), area_m2: a, iy_m4: i, iz_m4: i,
        torsion_j_m4: 2.0 * i, shear_area_y_m2: None, shear_area_z_m2: None, height_m: None, width_m: None };
    input.diaphragms.push(Diaphragm3D { id: 1, node_ids: vec![5, 6, 7, 8] });
    let result = solve(input).unwrap();

    let k = 3.0 * e * i / 64.0;
    let gj_l = e / 2.6 * 2.0 * i / 4.0;
    let theta = 60.0 / (4.0 * k * 18.0 + 4.0 * gj_l);
    close(theta, 2.3291e-3, 1e-4, 0.0);
    let kop5 = result.displacements.iter().find(|d| d.node_id == 5).unwrap();
    // Axiale en afschuifvervorming wijken minder dan 0,5 % af van de handwaarde.
    close(kop5.rz, theta, 5e-3, 0.0);
    close(kop5.ux, 20.0 / (4.0 * k) + 3.0 * theta, 5e-3, 0.0);

    let evenwicht = result.equilibrium.as_ref().unwrap();
    assert!(evenwicht.residual_ok && evenwicht.relative_residual < 1e-9, "{evenwicht:?}");
    // De diagnostiek mag het evenwicht niet tegenspreken.
    assert!(!result.diagnostics.iter().any(|m| m.contains("exceeds tolerance")), "{:?}", result.diagnostics);
    let residu = result.diagnostics.iter().find(|m| m.starts_with("Constrained 3D residual"));
    if let Some(melding) = residu {
        assert!(melding.contains("gereduceerd"), "{melding}");
    }
}

#[test]
fn thermal_gradient_uses_the_real_section_height_not_sqrt_12i_over_a() {
    // #221: IPE300 (catalogus A = 5381 mm², I_y = 8356·10⁴ mm⁴, h = 300 mm),
    // ΔT over lokaal z = 20 K, α = 12·10⁻⁶/K. EN 1991-1-5 §4: ΔT_M werkt
    // tussen boven- en onderkant, dus κ = α·ΔT/h met h = 300 mm, niet
    // √(12I/A) = 431,7 mm.
    //   κ = 12e-6 · 20 / 0,300 = 8,0·10⁻⁴ /m
    //   uitkraging L = 4 m: θ_tip = κL = 3,20·10⁻³ rad, w_tip = κL²/2 = 6,40 mm
    //   tweezijdig ingeklemd: M = E·I·κ = 210e6 · 8,356e-5 · 8e-4 = 14,04 kNm
    let ipe300 = Section3D { id: 1, name: "IPE300".into(), area_m2: 5381e-6, iy_m4: 8356e-8, iz_m4: 604e-8,
        torsion_j_m4: 20.1e-8, shear_area_y_m2: None, shear_area_z_m2: None,
        height_m: Some(0.300), width_m: Some(0.150) };
    let gradient = ThermalLoad3D { id: 1, member_id: 1, delta_t_uniform_k: 0.0,
        delta_t_gradient_y_k: 0.0, delta_t_gradient_z_k: 20.0 };
    let kappa = 12e-6 * 20.0 / 0.300;
    let nodes = vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 4.0, y: 0.0, z: 0.0 }];

    let mut console = request(nodes.clone(), vec![member(1, 1, 2)], vec![fixed(1)], vec![]);
    console.sections[0] = ipe300.clone();
    console.materials[0].alpha_per_k = Some(12e-6);
    console.thermal_loads.push(gradient.clone());
    let result = solve(console.clone()).unwrap();
    let tip = result.displacements.iter().find(|d| d.node_id == 2).unwrap();
    close(tip.ry.abs(), kappa * 4.0, 1e-9, 0.0);
    close(tip.uz.abs(), kappa * 16.0 / 2.0, 1e-9, 0.0);
    close(tip.uz.abs() * 1000.0, 6.40, 1e-9, 0.0);

    let mut clamped = request(nodes.clone(), vec![member(1, 1, 2)], vec![fixed(1), fixed(2)], vec![]);
    clamped.sections[0] = ipe300.clone();
    clamped.materials[0].alpha_per_k = Some(12e-6);
    clamped.thermal_loads.push(gradient.clone());
    let result = solve(clamped).unwrap();
    let moment = result.diagrams.moment_y.iter().find(|d| d.member_id == 1).unwrap();
    close(moment.max_abs_value, 210e6 * 8356e-8 * kappa, 1e-9, 0.0);
    close(moment.max_abs_value, 14.04, 1e-3, 0.0);

    // Breedte voor een gradiënt in lokaal y: κ = α·ΔT/b, b = 150 mm.
    let mut sideways = console.clone();
    sideways.thermal_loads[0].delta_t_gradient_z_k = 0.0;
    sideways.thermal_loads[0].delta_t_gradient_y_k = 20.0;
    let result = solve(sideways).unwrap();
    let tip = result.displacements.iter().find(|d| d.node_id == 2).unwrap();
    close(tip.rz.abs(), 12e-6 * 20.0 / 0.150 * 4.0, 1e-9, 0.0);

    // Zonder hoogte geen stille aanname: een duidelijke weigering.
    let mut missing = console.clone();
    missing.sections[0].height_m = None;
    let error = solve(missing).unwrap_err();
    assert!(error.contains("mist de hoogte (heightM)"), "{error}");
    let mut missing = console;
    missing.thermal_loads[0].delta_t_gradient_y_k = 5.0;
    missing.sections[0].width_m = None;
    let error = solve(missing).unwrap_err();
    assert!(error.contains("mist de breedte (widthM)"), "{error}");
}

fn ipe300_section() -> Section3D {
    Section3D { id: 1, name: "IPE300".into(), area_m2: 5381e-6, iy_m4: 8356e-8, iz_m4: 604e-8,
        torsion_j_m4: 20.1e-8, shear_area_y_m2: None, shear_area_z_m2: None,
        height_m: Some(0.300), width_m: Some(0.150) }
}

/// Scharnier (alleen draaien om lokaal/globaal Y vrij) en rol (ook X vrij).
fn hinge_y(node_id: usize, roller: bool) -> Support3D {
    Support3D { node_id, ux: !roller, uy: true, uz: true, rx: true, ry: false, rz: true, ..Default::default() }
}

#[test]
fn field_moment_of_a_partial_triangular_load_is_found_between_stations() {
    // #242, deeltest 067: IPE300, 6 m scharnier–rol, driehoekslast 0 → 6 kN/m
    // tussen x = 2 en 5 m. R_A = 9·2/6 = 3 kN, R_B = 6 kN;
    // V(x) = 3 − (x − 2)² = 0 bij x = 2 + √3 = 3,732 m;
    // M_max = 3x − (x − 2)³/3 = 9,4641 kNm (station t = 0,60 gaf 9,4347).
    let mut input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 6.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2)], vec![hinge_y(1, false), hinge_y(2, true)], vec![],
    );
    input.sections[0] = ipe300_section();
    input.member_loads.push(MemberLoad3D {
        id: 1, member_id: 1, qz_start_kn_per_m: 0.0, qz_end_kn_per_m: -6.0,
        start_position_m: Some(2.0), end_position_m: Some(5.0), ..Default::default()
    });
    let result = solve(input).unwrap();
    let x0 = 2.0 + 3.0_f64.sqrt();
    let m_hand = 3.0 * x0 - (x0 - 2.0).powi(3) / 3.0;
    close(m_hand, 9.4641, 1e-5, 0.0);
    let moment = result.diagrams.moment_y.iter().find(|d| d.member_id == 1).unwrap();
    close(moment.max_abs_value, m_hand, 1e-9, 0.0);
    let piek = moment.points.iter().max_by(|a, b| a.value.abs().total_cmp(&b.value.abs())).unwrap();
    close(piek.t * 6.0, x0, 1e-9, 0.0);
    // Alle lijnen van het element houden dezelfde stations.
    let shear = result.diagrams.shear_z.iter().find(|d| d.member_id == 1).unwrap();
    assert_eq!(shear.points.len(), moment.points.len());
    assert!(shear.points.iter().any(|p| (p.t - piek.t).abs() < 1e-12 && p.value.abs() < 1e-9));
    // De stations blijven oplopend.
    assert!(moment.points.windows(2).all(|w| w[0].t < w[1].t));
}

#[test]
fn field_moment_of_a_two_span_beam_is_9ql2_over_128() {
    // #242, deeltest 091: doorgaande ligger 2 × 5 m, q = 10 kN/m, IPE300.
    // Reacties 3qL/8, 10qL/8, 3qL/8 = 18,75 / 62,5 / 18,75 kN; steunmoment
    // −qL²/8 = −31,25 kNm; veldmoment 9qL²/128 = 17,578 kNm op x = 3L/8 =
    // 1,875 m (de stations t = 0,35/0,40 gaven 17,500).
    let mut input = request(
        vec![Node3D { id: 1, x: 0.0, y: 0.0, z: 0.0 }, Node3D { id: 2, x: 5.0, y: 0.0, z: 0.0 },
            Node3D { id: 3, x: 10.0, y: 0.0, z: 0.0 }],
        vec![member(1, 1, 2), member(2, 2, 3)],
        vec![hinge_y(1, false), hinge_y(2, true), hinge_y(3, true)], vec![],
    );
    input.sections[0] = ipe300_section();
    for id in [1, 2] {
        input.member_loads.push(MemberLoad3D {
            id, member_id: id, qz_start_kn_per_m: -10.0, qz_end_kn_per_m: -10.0, ..Default::default()
        });
    }
    let result = solve(input).unwrap();
    let r = |id| result.reactions.iter().find(|r| r.node_id == id).unwrap().fz;
    close(r(1), 18.75, 1e-9, 1e-9);
    close(r(2), 62.5, 1e-9, 1e-9);
    close(r(3), 18.75, 1e-9, 1e-9);
    let veld = 9.0 * 10.0 * 25.0 / 128.0;
    close(veld, 17.578125, 1e-12, 0.0);
    for (id, x_veld) in [(1, 1.875), (2, 5.0 - 1.875)] {
        let moment = result.diagrams.moment_y.iter().find(|d| d.member_id == id).unwrap();
        close(moment.max_abs_value, 31.25, 1e-9, 0.0);
        // Het veldmoment heeft het andere teken dan het steunmoment.
        let steun = if id == 1 { moment.points.last().unwrap().value } else { moment.points[0].value };
        let veldwaarde = if steun < 0.0 { moment.max_value } else { -moment.min_value };
        close(veldwaarde, veld, 1e-9, 0.0);
        let punt = moment.points.iter().find(|p| (p.value.abs() - veld).abs() < 1e-9).unwrap();
        close(punt.t * 5.0, x_veld, 1e-9, 0.0);
    }
}

/// Issue #213: de P-Δ-iteratie hergebruikt de symbolische analyse van
/// K + K_G (vast patroon) en blijft de gesloten oplossing volgen.
///
/// Uitkragende kolom L = 4 m (8 delen), E = 210 000 MPa, kop: P = 100 kN druk
/// en H = 1 kN in x. Gesloten oplossing (tweede orde, exact):
///   δ = H/(P·k)·(tan(kL) − kL), k = √(P/EI).
/// Met EI om de buigas van ux: EI = 2,1·10⁸ kN/m² · I. I volgt uit de
/// lineaire zakking H·L³/(3EI), zodat de test niet afhangt van welke lokale
/// as de kern voor een staande staaf kiest.
#[test]
fn pdelta_hergebruikt_de_symbolische_analyse_en_volgt_de_gesloten_oplossing() {
    let n = 8usize;
    let length: f64 = 4.0;
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    for index in 0..=n {
        nodes.push(Node3D { id: index + 1, x: 0.0, y: 0.0, z: index as f64 * length / n as f64 });
        if index > 0 { members.push(member(index, index, index + 1)); }
    }
    let make = |p: f64, analysis: AnalysisKind| {
        let mut value = request(
            nodes.clone(), members.clone(), vec![fixed(1)],
            vec![NodalLoad3D { id: 1, node_id: n + 1, fx: 1.0, fy: 0.0, fz: -p, mx: 0.0, my: 0.0, mz: 0.0 }],
        );
        value.analysis = analysis;
        value
    };
    let tip_x = |result: &open_fem_3d::SolveResult3D| result.displacements.iter()
        .find(|value| value.node_id == n + 1).unwrap().ux;
    let e = 210_000.0e3;
    let lineair = tip_x(&solve(make(0.0, AnalysisKind::Linear)).unwrap());
    let ei = length.powi(3) / (3.0 * lineair);
    let i = ei / e;
    assert!((i - 8e-6).abs() < 1e-12 || (i - 12e-6).abs() < 1e-12, "I = {i}");
    let p = 100.0;
    let uit = solve(make(p, AnalysisKind::PDelta)).unwrap();
    let k = (p / ei).sqrt();
    let exact = 1.0 / (p * k) * ((k * length).tan() - k * length);
    let delta = tip_x(&uit);
    assert!((delta - exact).abs() <= 5e-3 * exact, "δ = {delta}, gesloten oplossing {exact}");
    let melding = uit.diagnostics.iter().find(|d| d.starts_with("Tweede orde:")).expect("tweede-ordemelding");
    let iteraties = uit.second_order.as_ref().unwrap().iterations;
    assert!(iteraties >= 2, "{melding}");
    assert!(
        melding.contains("symbolische analyse 1 keer gemaakt")
            && melding.contains(&format!("{} keer hergebruikt", iteraties - 1)),
        "{melding}"
    );
}
