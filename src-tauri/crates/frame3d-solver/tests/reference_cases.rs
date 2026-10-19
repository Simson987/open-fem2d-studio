use frame3d_solver::{
    solve, AnalysisKind, BucklingSummary, Material3D, Member3D, MemberLoad3D, MemberPointLoad3D,
    NodalLoad3D, Node3D, Section3D, SolveRequest3D, Support3D, ThermalLoad3D,
};

fn section() -> Section3D {
    Section3D {
        id: 1,
        name: "reference".into(),
        area_m2: 0.01,
        iy_m4: 8e-6,
        iz_m4: 12e-6,
        torsion_j_m4: 5e-6,
        shear_area_y_m2: None,
        shear_area_z_m2: None,
    }
}

#[test]
fn local_point_load_on_member_matches_simply_supported_closed_form() {
    let revolute_y = |node_id| Support3D {
        node_id,
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: false,
        rz: true,
        ..Default::default()
    };
    let mut input = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 4.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![revolute_y(1), revolute_y(2)],
        vec![],
    );
    input.member_point_loads.push(MemberPointLoad3D {
        id: 1,
        member_id: 1,
        py_kn: 0.0,
        pz_kn: -10.0,
        position_m: 2.0,
    });
    let result = solve(input).unwrap();
    let left = result
        .reactions
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    let right = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(left.fz, 5.0, 1e-10, 1e-10);
    close(right.fz, 5.0, 1e-10, 1e-10);
    let shear = result
        .diagrams
        .shear_z
        .iter()
        .find(|value| value.member_id == 1)
        .unwrap();
    let moment = result
        .diagrams
        .moment_y
        .iter()
        .find(|value| value.member_id == 1)
        .unwrap();
    close(shear.max_abs_value, 5.0, 1e-10, 1e-10);
    close(moment.max_abs_value, 10.0, 1e-10, 1e-10);
}

fn request(
    nodes: Vec<Node3D>,
    members: Vec<Member3D>,
    supports: Vec<Support3D>,
    nodal_loads: Vec<NodalLoad3D>,
) -> SolveRequest3D {
    SolveRequest3D {
        schema_version: 1,
        analysis: AnalysisKind::Linear,
        nodes,
        materials: vec![Material3D {
            id: 1,
            name: "steel".into(),
            e_mpa: 210_000.0,
            nu: 0.3125,
            alpha_per_k: None,
        }],
        sections: vec![section()],
        members,
        supports,
        nodal_loads,
        member_loads: vec![],
        member_point_loads: vec![],
        thermal_loads: vec![],
        max_iterations: 50,
        tolerance: 1e-10,
        buckling_modes: 0,
    }
}

#[test]
fn uniform_thermal_expansion_uses_material_alpha() {
    let mut input = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![
            fixed(1),
            Support3D {
                node_id: 2,
                ux: false,
                uy: true,
                uz: true,
                rx: true,
                ry: true,
                rz: true,
                ..Default::default()
            },
        ],
        vec![],
    );
    input.materials[0].name = "concrete".into();
    input.materials[0].alpha_per_k = Some(10e-6);
    input.thermal_loads.push(ThermalLoad3D {
        id: 1,
        member_id: 1,
        delta_t_uniform_k: 30.0,
        delta_t_gradient_y_k: 0.0,
        delta_t_gradient_z_k: 0.0,
    });
    let result = solve(input).unwrap();
    let end = result
        .displacements
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(end.ux, 2.0 * 10e-6 * 30.0, 1e-9, 1e-12);
    assert!(result.reactions.iter().all(|reaction| {
        [
            reaction.fx,
            reaction.fy,
            reaction.fz,
            reaction.mx,
            reaction.my,
            reaction.mz,
        ]
        .iter()
        .all(|value| value.abs() < 1e-9)
    }));

    let mut invalid = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1)],
        vec![],
    );
    invalid.thermal_loads.push(ThermalLoad3D {
        id: 1,
        member_id: 1,
        delta_t_uniform_k: 0.0,
        delta_t_gradient_y_k: 0.0,
        delta_t_gradient_z_k: 0.0,
    });
    assert!(solve(invalid).unwrap_err().contains("niet-nulwaarde"));
}

#[test]
fn prescribed_axial_displacement_matches_bar_stiffness() {
    let mut moving = fixed(2);
    moving.ux_prescribed_m = Some(0.001);
    let input = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1), moving],
        vec![],
    );
    let result = solve(input.clone()).unwrap();
    let end = result
        .displacements
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(end.ux, 0.001, 0.0, 1e-14);
    let left = result
        .reactions
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    let right = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    // EA/L · delta = 210e6 kN/m² · 0.01 m² / 2 m · 0.001 m = 1050 kN.
    close(left.fx, -1050.0, 1e-10, 1e-8);
    close(right.fx, 1050.0, 1e-10, 1e-8);
    close(
        result.member_forces[0].n_start_kn.abs(),
        1050.0,
        1e-10,
        1e-8,
    );

    let mut p_delta = input;
    p_delta.analysis = AnalysisKind::PDelta;
    let p_delta = solve(p_delta).unwrap();
    close(
        p_delta
            .displacements
            .iter()
            .find(|value| value.node_id == 2)
            .unwrap()
            .ux,
        0.001,
        0.0,
        1e-14,
    );
    close(
        p_delta
            .reactions
            .iter()
            .find(|value| value.node_id == 1)
            .unwrap()
            .fx,
        -1050.0,
        1e-10,
        1e-8,
    );

    let invalid = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![
            fixed(1),
            Support3D {
                node_id: 2,
                ux_prescribed_m: Some(0.001),
                ..Default::default()
            },
        ],
        vec![],
    );
    assert!(solve(invalid)
        .unwrap_err()
        .contains("vereist een geblokkeerde vrijheidsgraad"));
}

#[test]
fn uniform_local_z_member_load_matches_cantilever_closed_form() {
    let mut input = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1)],
        vec![],
    );
    input.member_loads.push(MemberLoad3D {
        id: 1,
        member_id: 1,
        qy_start_kn_per_m: 0.0,
        qy_end_kn_per_m: 0.0,
        qz_start_kn_per_m: -4.0,
        qz_end_kn_per_m: -4.0,
        start_position_m: None,
        end_position_m: None,
    });
    let result = solve(input).unwrap();
    let tip = result
        .displacements
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    // wL^4/(8 E Iy), with E converted from MPa to kN/m² by the engine boundary.
    close(tip.uz, -0.004761904761904762, 1e-8, 1e-12);
    let reaction = result
        .reactions
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    close(reaction.fz, 8.0, 1e-10, 1e-10);
    close(reaction.my.abs(), 8.0, 1e-10, 1e-10);

    // De productgrens levert de volledige lijn, niet alleen twee eindwaarden.
    // Voor qz=-4 kN/m: Vz(x)=8-4x en My(x)=-8+8x-2x².
    let shear = result
        .diagrams
        .shear_z
        .iter()
        .find(|value| value.member_id == 1)
        .unwrap();
    let moment = result
        .diagrams
        .moment_y
        .iter()
        .find(|value| value.member_id == 1)
        .unwrap();
    let mid_shear = shear
        .points
        .iter()
        .find(|point| (point.t - 0.5).abs() < 1e-12)
        .unwrap();
    let mid_moment = moment
        .points
        .iter()
        .find(|point| (point.t - 0.5).abs() < 1e-12)
        .unwrap();
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
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: length,
                y: 0.0,
                z: 0.0,
            },
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
    });

    let result = solve(input).unwrap();
    let left = result
        .reactions
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    let right = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(left.fz, 5.0 * load * length / 8.0, 1e-10, 1e-10);
    close(right.fz, 3.0 * load * length / 8.0, 1e-10, 1e-10);
    close(left.my.abs(), load * length * length / 8.0, 1e-10, 1e-10);
    close(right.my, 0.0, 0.0, 1e-10);
    let forces = &result.member_forces[0];
    close(forces.my_end_knm, 0.0, 0.0, 1e-10);
    assert!(result
        .equilibrium
        .as_ref()
        .is_some_and(|value| value.equilibrium_ok));
}

#[test]
fn translational_support_spring_matches_closed_form_and_reports_reaction() {
    let make_request = || {
        request(
            vec![
                Node3D {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                Node3D {
                    id: 2,
                    x: 2.0,
                    y: 0.0,
                    z: 0.0,
                },
            ],
            vec![member(1, 1, 2)],
            vec![
                fixed(1),
                Support3D {
                    node_id: 2,
                    kz_kn_per_m: Some(370.0),
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
        )
    };
    let result = solve(make_request()).unwrap();
    // Cantilever end stiffness 3EI/L³ = 630 kN/m, in parallel with 370 kN/m.
    let tip = result
        .displacements
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(tip.uz, -0.01, 1e-10, 1e-12);
    let spring_reaction = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    let fixed_reaction = result
        .reactions
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    close(spring_reaction.fz, 3.7, 1e-10, 1e-10);
    close(fixed_reaction.fz, 6.3, 1e-10, 1e-10);
    assert!(result
        .equilibrium
        .as_ref()
        .is_some_and(|value| value.equilibrium_ok));

    let mut p_delta = make_request();
    p_delta.analysis = AnalysisKind::PDelta;
    let p_delta = solve(p_delta).unwrap();
    close(
        p_delta
            .displacements
            .iter()
            .find(|value| value.node_id == 2)
            .unwrap()
            .uz,
        -0.01,
        1e-10,
        1e-12,
    );
    close(
        p_delta
            .reactions
            .iter()
            .find(|value| value.node_id == 2)
            .unwrap()
            .fz,
        3.7,
        1e-10,
        1e-10,
    );
    close(
        p_delta.reactions.iter().map(|value| value.fz).sum(),
        10.0,
        1e-10,
        1e-10,
    );
    assert!(p_delta
        .equilibrium
        .as_ref()
        .is_none_or(|value| value.equilibrium_ok));

    let mut invalid = make_request();
    invalid.supports[1].uz = true;
    assert!(solve(invalid)
        .unwrap_err()
        .contains("tegelijk blokkeren en veren"));
}

fn member(id: usize, start: usize, end: usize) -> Member3D {
    Member3D {
        id,
        start_node_id: start,
        end_node_id: end,
        material_id: 1,
        section_id: 1,
        releases: Default::default(),
        roll_angle_rad: None,
    }
}

fn fixed(node_id: usize) -> Support3D {
    Support3D {
        node_id,
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: true,
        rz: true,
        ..Default::default()
    }
}

fn pinned(node_id: usize) -> Support3D {
    Support3D {
        node_id,
        ux: true,
        uy: true,
        uz: true,
        rx: false,
        ry: false,
        rz: false,
        ..Default::default()
    }
}

fn revolute_x(node_id: usize) -> Support3D {
    Support3D {
        node_id,
        ux: true,
        uy: true,
        uz: true,
        rx: false,
        ry: true,
        rz: true,
        ..Default::default()
    }
}

fn revolute_y(node_id: usize) -> Support3D {
    Support3D {
        node_id,
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: false,
        rz: true,
        ..Default::default()
    }
}

fn revolute_z(node_id: usize) -> Support3D {
    Support3D {
        node_id,
        ux: true,
        uy: true,
        uz: true,
        rx: true,
        ry: true,
        rz: false,
        ..Default::default()
    }
}

fn close(actual: f64, expected: f64, relative: f64, absolute: f64) {
    let difference = (actual - expected).abs();
    assert!(
        difference <= absolute.max(expected.abs() * relative),
        "actual={actual:.12e}, expected={expected:.12e}, difference={difference:.12e}"
    );
}

#[test]
fn axial_oblique_xyz_matches_closed_form() {
    let result = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 2.0,
                z: 1.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1)],
        vec![NodalLoad3D {
            id: 1,
            node_id: 2,
            fx: 6.0,
            fy: 6.0,
            fz: 3.0,
            mx: 0.0,
            my: 0.0,
            mz: 0.0,
        }],
    ))
    .unwrap();
    let tip = result
        .displacements
        .iter()
        .find(|v| v.node_id == 2)
        .unwrap();
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
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1)],
        vec![NodalLoad3D {
            id: 1,
            node_id: 2,
            fx: 0.0,
            fy: 3.0,
            fz: 4.0,
            mx: 0.0,
            my: 0.0,
            mz: 0.0,
        }],
    ))
    .unwrap();
    let tip = result
        .displacements
        .iter()
        .find(|v| v.node_id == 2)
        .unwrap();
    close(tip.uy, 0.003174603174603175, 1e-8, 1e-12);
    close(tip.uz, 0.006349206349206349, 1e-8, 1e-12);
    close(tip.ry, -0.004761904761904762, 1e-8, 1e-12);
    close(tip.rz, 0.002380952380952381, 1e-8, 1e-12);
}

#[test]
fn torsion_on_rotated_member_transforms_to_global_rotations() {
    let result = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 0.0,
                y: 3.0,
                z: 4.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1)],
        vec![NodalLoad3D {
            id: 1,
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            fz: 0.0,
            mx: 0.0,
            my: 0.6,
            mz: 0.8,
        }],
    ))
    .unwrap();
    let tip = result
        .displacements
        .iter()
        .find(|v| v.node_id == 2)
        .unwrap();
    close(tip.ry, 0.0075, 1e-8, 1e-12);
    close(tip.rz, 0.01, 1e-8, 1e-12);
}

#[test]
fn revolute_x_support_releases_only_rotation_about_x() {
    let result = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 3.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![
            revolute_x(1),
            Support3D {
                node_id: 2,
                ux: false,
                uy: false,
                uz: false,
                rx: true,
                ry: false,
                rz: false,
                ..Default::default()
            },
        ],
        vec![NodalLoad3D {
            id: 1,
            node_id: 1,
            fx: 0.0,
            fy: 0.0,
            fz: 0.0,
            mx: 5.0,
            my: 0.0,
            mz: 0.0,
        }],
    ))
    .unwrap();
    let hinge = result
        .displacements
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    // θ = T·L/(GJ) = 5·3/(80e6·5e-6) = 0.0375 rad.
    close(hinge.rx, 0.0375, 1e-8, 1e-12);
    close(hinge.ry, 0.0, 1e-8, 1e-12);
    close(hinge.rz, 0.0, 1e-8, 1e-12);
    let reaction = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(reaction.mx.abs(), 5.0, 1e-10, 1e-10);
}

#[test]
fn revolute_y_and_z_supports_release_only_the_selected_rotation() {
    let cases = [
        (
            revolute_y(1),
            NodalLoad3D {
                id: 1,
                node_id: 1,
                fx: 0.0,
                fy: 0.0,
                fz: 0.0,
                mx: 0.0,
                my: 5.0,
                mz: 0.0,
            },
            Support3D {
                node_id: 2,
                ry: true,
                ..Default::default()
            },
            0.00892857142857143,
            'y',
        ),
        (
            revolute_z(1),
            NodalLoad3D {
                id: 1,
                node_id: 1,
                fx: 0.0,
                fy: 0.0,
                fz: 0.0,
                mx: 0.0,
                my: 0.0,
                mz: 5.0,
            },
            Support3D {
                node_id: 2,
                rz: true,
                ..Default::default()
            },
            0.005952380952380952,
            'z',
        ),
    ];
    for (support, load, far_support, expected_rotation, axis) in cases {
        let result = solve(request(
            vec![
                Node3D {
                    id: 1,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                Node3D {
                    id: 2,
                    x: 3.0,
                    y: 0.0,
                    z: 0.0,
                },
            ],
            vec![member(1, 1, 2)],
            vec![support, far_support],
            vec![load],
        ))
        .unwrap();
        let hinge = result
            .displacements
            .iter()
            .find(|value| value.node_id == 1)
            .unwrap();
        let actual = if axis == 'y' { hinge.ry } else { hinge.rz };
        close(actual, expected_rotation, 1e-8, 1e-12);
        close(hinge.rx, 0.0, 0.0, 1e-12);
        close(
            if axis == 'y' { hinge.rz } else { hinge.ry },
            0.0,
            0.0,
            1e-12,
        );
        let reaction = result
            .reactions
            .iter()
            .find(|value| value.node_id == 2)
            .unwrap();
        close(
            if axis == 'y' {
                reaction.my.abs()
            } else {
                reaction.mz.abs()
            },
            5.0,
            1e-10,
            1e-10,
        );
    }
}

#[test]
fn prescribed_end_rotation_matches_slope_deflection() {
    let mut moving = fixed(2);
    moving.rz_prescribed_rad = Some(0.001);
    let result = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1), moving],
        vec![],
    ))
    .unwrap();
    let end = result
        .displacements
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(end.rz, 0.001, 0.0, 1e-14);

    // Slope-deflection for a prismatic member without chord translation:
    // |M1| = 2 E Iz θ/L = 2.52 kNm and |M2| = 4 E Iz θ/L = 5.04 kNm.
    let left = result
        .reactions
        .iter()
        .find(|value| value.node_id == 1)
        .unwrap();
    let right = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(left.mz.abs(), 2.52, 1e-10, 1e-10);
    close(right.mz.abs(), 5.04, 1e-10, 1e-10);
    // The associated end shears form a self-equilibrating couple.
    close(left.fy.abs(), 3.78, 1e-10, 1e-10);
    close(right.fy.abs(), 3.78, 1e-10, 1e-10);
    close(left.fy + right.fy, 0.0, 0.0, 1e-10);
    assert!(result
        .equilibrium
        .as_ref()
        .is_some_and(|value| value.equilibrium_ok));
}

#[test]
fn member_roll_contract_uses_radians_and_swaps_bending_axes() {
    let mut rolled = member(1, 1, 2);
    rolled.roll_angle_rad = Some(std::f64::consts::FRAC_PI_2);
    let result = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 2.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![rolled],
        vec![fixed(1)],
        vec![NodalLoad3D {
            id: 1,
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            fz: 4.0,
            mx: 0.0,
            my: 0.0,
            mz: 0.0,
        }],
    ))
    .unwrap();
    let tip = result
        .displacements
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
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
        nodes.push(Node3D {
            id: index + 1,
            x: 0.0,
            y: 0.0,
            z: index as f64 * length / n as f64,
        });
        if index > 0 {
            members.push(member(index, index, index + 1));
        }
    }
    let mut req = request(
        nodes,
        members,
        vec![fixed(1)],
        vec![NodalLoad3D {
            id: 1,
            node_id: n + 1,
            fx: 0.01,
            fy: 0.0,
            fz: -25.0,
            mx: 0.0,
            my: 0.0,
            mz: 0.0,
        }],
    );
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
        nodes.push(Node3D {
            id: index + 1,
            x: 0.0,
            y: 0.0,
            z: index as f64 * length / n as f64,
        });
        if index > 0 {
            members.push(member(index, index, index + 1));
        }
    }
    let make = |axial_kn: f64, analysis: AnalysisKind| {
        let mut value = request(
            nodes.clone(),
            members.clone(),
            vec![fixed(1)],
            vec![NodalLoad3D {
                id: 1,
                node_id: n + 1,
                fx: 0.01,
                fy: 0.0,
                fz: axial_kn,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
            }],
        );
        value.analysis = analysis;
        value.buckling_modes = 0;
        value
    };
    let linear = solve(make(0.0, AnalysisKind::Linear)).unwrap();
    let compression = solve(make(-25.0, AnalysisKind::PDelta)).unwrap();
    let tension = solve(make(25.0, AnalysisKind::PDelta)).unwrap();
    let tip_x = |result: &frame3d_solver::SolveResult3D| {
        result
            .displacements
            .iter()
            .find(|value| value.node_id == n + 1)
            .unwrap()
            .ux
            .abs()
    };
    let u_linear = tip_x(&linear);
    let u_compression = tip_x(&compression);
    let u_tension = tip_x(&tension);
    assert!(
        u_compression > u_linear,
        "druk hoort te versterken: {u_compression} <= {u_linear}"
    );
    assert!(
        u_tension < u_linear,
        "trek hoort te verstijven: {u_tension} >= {u_linear}"
    );
    assert!(compression
        .second_order
        .as_ref()
        .is_some_and(|value| value.max_amplification > 1.0));
    // B2 is reported as a non-reducing amplification factor and is therefore
    // capped at 1.0 even though the actual tensile displacement is smaller.
    assert!(tension
        .second_order
        .as_ref()
        .is_some_and(|value| value.max_amplification <= 1.0 + 1e-12));
}

#[test]
fn pdelta_near_and_beyond_critical_load_is_bounded() {
    let n = 8usize;
    let length = 4.0;
    let mut nodes = Vec::new();
    let mut members = Vec::new();
    for index in 0..=n {
        nodes.push(Node3D {
            id: index + 1,
            x: 0.0,
            y: 0.0,
            z: index as f64 * length / n as f64,
        });
        if index > 0 {
            members.push(member(index, index, index + 1));
        }
    }
    let make = |compression_kn: f64, buckling_modes: usize| {
        let mut value = request(
            nodes.clone(),
            members.clone(),
            vec![fixed(1)],
            vec![NodalLoad3D {
                id: 1,
                node_id: n + 1,
                fx: 0.01,
                fy: 0.0,
                fz: -compression_kn,
                mx: 0.0,
                my: 0.0,
                mz: 0.0,
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
    assert!(near.displacements.iter().all(|value| [
        value.ux, value.uy, value.uz, value.rx, value.ry, value.rz
    ]
    .iter()
    .all(|dof| dof.is_finite())));

    let error = solve(make(1.05 * critical_load_kn, 0)).unwrap_err();
    assert!(
        error.contains("instabiliteit")
            || error.contains("convergeerde niet")
            || error.contains("mechanisme"),
        "boven Pcr is een gerichte stabiliteitsmelding vereist, kreeg: {error}",
    );
}

#[test]
fn cantilever_buckling_converges_under_mesh_refinement() {
    let length: f64 = 4.0;
    let probe_load_kn = 25.0;
    let e_kn_m2 = 210_000_000.0;
    let weak_axis_i_m4 = 8e-6;
    let euler_critical_kn =
        std::f64::consts::PI.powi(2) * e_kn_m2 * weak_axis_i_m4 / (4.0 * length.powi(2));
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
            other => {
                panic!("fysieke knikmodus verwacht voor {segments} elementen, kreeg {other:?}")
            }
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
        assert!(
            pair[1] <= pair[0] + 1e-10,
            "knikfout neemt niet af: {errors:?}"
        );
    }
    assert!(
        errors.last().is_some_and(|error| *error < 1e-4),
        "16 elementen horen binnen 0,01% van Euler te liggen: loads={loads:?}, errors={errors:?}"
    );
    eprintln!("Euler Pcr={euler_critical_kn:.9} kN; mesh={loads:?}; relative errors={errors:?}");
}

#[test]
fn pdelta_accepts_zero_displacement_when_load_is_fully_restrained() {
    let mut req = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 3.0,
                y: 0.0,
                z: 0.0,
            },
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
    let reaction = result
        .reactions
        .iter()
        .find(|value| value.node_id == 2)
        .unwrap();
    close(reaction.fz, 10.0, 1e-10, 1e-10);
    assert!(result
        .diagnostics
        .iter()
        .any(|message| message.contains("P-Delta-nultoestand")));
}

#[test]
fn portal_buckling_discards_numerical_zero_mode() {
    let mut req = request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 12.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 3,
                x: 0.0,
                y: 0.0,
                z: 5.0,
            },
            Node3D {
                id: 4,
                x: 12.0,
                y: 0.0,
                z: 5.0,
            },
        ],
        vec![member(1, 1, 3), member(2, 2, 4), member(3, 3, 4)],
        vec![pinned(1), pinned(2)],
        vec![NodalLoad3D {
            id: 1,
            node_id: 3,
            fx: 0.0,
            fy: 0.0,
            fz: -10.0,
            mx: 0.0,
            my: 0.0,
            mz: 0.0,
        }],
    );
    req.analysis = AnalysisKind::PDelta;
    req.buckling_modes = 3;
    let result = solve(req).unwrap();
    match result.buckling {
        BucklingSummary::Available { modes, members } => {
            assert_eq!(modes.len(), 2);
            close(modes[0].load_factor, 17.4767300887, 1e-7, 1e-7);
            assert!(modes.iter().all(|mode| mode.load_factor > 1e-9));
            close(members[0].critical_force_kn, 174.767300887, 1e-7, 1e-7);
            assert!(
                members[0].effective_length_m.is_finite() && members[0].effective_length_m > 0.0
            );
        }
        other => panic!("knikresultaat verwacht, kreeg {other:?}"),
    }
}

#[test]
fn malformed_model_is_rejected_before_engine_call() {
    let error = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 1,
                x: 1.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![fixed(1)],
        vec![],
    ))
    .unwrap_err();
    assert!(error.contains("dubbele knoop-id"));
}

#[test]
fn torsion_mechanism_has_actionable_diagnostics() {
    let error = solve(request(
        vec![
            Node3D {
                id: 1,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            Node3D {
                id: 2,
                x: 3.0,
                y: 0.0,
                z: 0.0,
            },
        ],
        vec![member(1, 1, 2)],
        vec![pinned(1), pinned(2)],
        vec![NodalLoad3D {
            id: 1,
            node_id: 2,
            fx: 0.0,
            fy: 0.0,
            fz: 0.0,
            mx: 5.0,
            my: 0.0,
            mz: 0.0,
        }],
    ))
    .unwrap_err();
    assert!(error.contains("mechanisme"), "{error}");
    assert!(error.contains("torsie om de staafas"), "{error}");
    assert!(
        error.contains("revolute-oplegging") && error.contains("rotatieveer"),
        "{error}"
    );
}
