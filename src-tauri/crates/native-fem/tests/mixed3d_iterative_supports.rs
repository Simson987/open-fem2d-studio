//! Zero-load disconnected components must not be accepted as a converged
//! matrix-free/CSR-PCG solution merely because the global RHS is zero.

use openaec_native_fem::mixed3d::{
    solve, Frame3dMixedElement, Hex8MixedElement, Membrane3dElement, Mixed3dBackend,
    Mixed3dRequest, Truss3dElement,
};
use openaec_native_fem::volume3d::{Mesh, Volume3dMaterial};

fn model(backend: Mixed3dBackend) -> Mixed3dRequest {
   Mixed3dRequest {
        bending_plates: vec![],
        mesh: Mesh {
            nodes: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.0, 1.0],
                [3.0, 0.0, 0.0],
                [4.0, 0.0, 0.0],
                [3.0, 1.0, 0.0],
                [3.0, 0.0, 1.0],
            ],
            tets: vec![[0, 1, 2, 3], [4, 5, 6, 7]],
        },
        solid_material: Volume3dMaterial {
            e_mpa: 2000.0,
            poisson: 0.2,
        },
        tet_materials: None,
        hexes: vec![],
        membranes: vec![],
        membrane_tractions: vec![],
        trusses: vec![],
        loads_kn: vec![[0.0; 3]; 8],
        tet_body_forces: vec![],
        tet_face_tractions: vec![],
        hex_body_forces: vec![],
        hex_face_tractions: vec![],
        prescribed_m: vec![[Some(0.0); 3]; 4]
            .into_iter()
            .chain(vec![[None; 3]; 4])
            .collect(),
        frames: vec![],
        frame_member_loads: vec![],
        frame_member_point_loads: vec![],
        moments_knm: vec![],
        prescribed_rotations_rad: vec![],
        backend,
        max_front_dofs: 32,
        threads: 1,
        max_pcg_iterations: 10_000,
    }
}

#[test]
fn unloaded_disconnected_component_needs_its_own_restraints() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let mut input = model(backend);
        assert!(solve(&input).unwrap_err().contains("component"));
        input.prescribed_m[4..].fill([Some(0.0); 3]);
        let result = solve(&input).expect("both solids are independently restrained");
        assert!(result
            .nodal_displacements_m
            .iter()
            .flatten()
            .all(|v| v.abs() < 1e-15));
        assert_eq!(result.linear_iterations, 0);
    }
}

#[test]
fn fully_braced_single_truss_is_orientation_independent() {
    let e_mpa = 210_000.0;
    let area_m2 = 0.01;
    let expected_m = 1.0 / (1000.0 * e_mpa * area_m2);
    for axis in 0..3 {
        for backend in [
            Mixed3dBackend::Dense,
            Mixed3dBackend::SparsePcg,
            Mixed3dBackend::MatrixFreePcg,
            Mixed3dBackend::Automatic,
        ] {
            let mut input = model(backend);
            input.mesh.nodes = vec![[0.0; 3], [0.0; 3]];
            input.mesh.nodes[1][axis] = 1.0;
            input.mesh.tets.clear();
            input.trusses = vec![Truss3dElement {
                nodes: [0, 1],
                e_mpa,
                area_m2,
            }];
            input.loads_kn = vec![[0.0; 3]; 2];
            input.loads_kn[1][axis] = 1.0;
            input.prescribed_m = vec![[Some(0.0); 3], [Some(0.0); 3]];
            input.prescribed_m[1][axis] = None;
            let solved = solve(&input).expect("one axial DOF is fully restrained transversely");
            assert!(
                (solved.nodal_displacements_m[1][axis] - expected_m).abs() < 1e-10 * expected_m,
                "axis {axis}, backend {backend:?}: {:?}",
                solved.nodal_displacements_m[1]
            );
        }
    }
}

#[test]
fn disconnected_braced_truss_components_can_have_different_axes() {
    // Two independent one-DOF bars: the X bar carries 1 kN and the Y bar
    // carries 2 kN. Each component has its own restrained transverse axes.
    let e_mpa = 210_000.0;
    let area_m2 = 0.01;
    let unit_extension_m = 1.0 / (1000.0 * e_mpa * area_m2);
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        let mut input = model(backend);
        input.mesh.nodes = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [3.0, 0.0, 0.0],
            [3.0, 1.0, 0.0],
        ];
        input.mesh.tets.clear();
        input.trusses = [[0, 1], [2, 3]]
            .map(|nodes| Truss3dElement {
                nodes,
                e_mpa,
                area_m2,
            })
            .to_vec();
        input.loads_kn = vec![[0.0; 3]; 4];
        input.loads_kn[1][0] = 1.0;
        input.loads_kn[3][1] = 2.0;
        input.prescribed_m = vec![
            [Some(0.0); 3],
            [None, Some(0.0), Some(0.0)],
            [Some(0.0); 3],
            [Some(0.0), None, Some(0.0)],
        ];
        let solved = solve(&input).expect("each bar has an independent axial restraint");
        assert!(
            (solved.nodal_displacements_m[1][0] - unit_extension_m).abs()
                < 1e-10 * unit_extension_m,
            "{backend:?} X component"
        );
        assert!(
            (solved.nodal_displacements_m[3][1] - 2.0 * unit_extension_m).abs()
                < 2e-10 * unit_extension_m,
            "{backend:?} Y component"
        );
        assert!(solved.relative_residual < 1e-10);
    }
}

#[test]
fn unloaded_vertex_connected_tets_do_not_hide_a_hinge() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let mut input = model(backend);
        input.mesh.nodes = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [2.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [1.0, 0.0, 1.0],
        ];
        input.mesh.tets[1] = [1, 4, 5, 6];
        input.loads_kn.truncate(7);
        input.prescribed_m.truncate(7);
        let error = solve(&input).unwrap_err();
        assert!(
            error.contains("face-connected group") && error.contains("rank"),
            "{error}"
        );

        // Once the second body has its own independent restraints, zero load
        // is a legitimate zero-iteration PCG solution again.
        input.prescribed_m[4..].fill([Some(0.0); 3]);
        let solved = solve(&input).expect("both face-connected bodies are restrained");
        assert_eq!(solved.linear_iterations, 0);
    }
}

#[test]
fn unloaded_vertex_connected_hexes_do_not_hide_a_hinge() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let mut input = model(backend);
        input.mesh.nodes = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 1.0],
            [2.0, 1.0, 1.0],
            [2.0, 2.0, 1.0],
            [1.0, 2.0, 1.0],
            [1.0, 1.0, 2.0],
            [2.0, 1.0, 2.0],
            [2.0, 2.0, 2.0],
            [1.0, 2.0, 2.0],
        ];
        input.mesh.tets.clear();
        input.hexes = vec![
            Hex8MixedElement {
                nodes: [0, 1, 2, 3, 4, 5, 6, 7],
                e_mpa: 2_000.0,
                poisson: 0.2,
            },
            Hex8MixedElement {
                nodes: [6, 8, 9, 10, 11, 12, 13, 14],
                e_mpa: 2_000.0,
                poisson: 0.2,
            },
        ];
        input.loads_kn = vec![[0.0; 3]; 15];
        input.prescribed_m = vec![[Some(0.0); 3]; 8]
            .into_iter()
            .chain(vec![[None; 3]; 7])
            .collect();
        let error = solve(&input).unwrap_err();
        assert!(error.contains("face-connected Hex8 group"), "{error}");

        input.prescribed_m[8..].fill([Some(0.0); 3]);
        let solved = solve(&input).expect("both Hex8 bodies are restrained");
        assert_eq!(solved.linear_iterations, 0);
    }
}

fn vertex_connected_tet_hex(backend: Mixed3dBackend) -> Mixed3dRequest {
    let mut input = model(backend);
    input.mesh.nodes = vec![
        [0.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, -1.0, 0.0],
        [-1.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 1.0],
        [0.0, 1.0, 1.0],
    ];
    input.mesh.tets = vec![[0, 1, 2, 3]];
    input.hexes = vec![Hex8MixedElement {
        nodes: [0, 4, 5, 6, 7, 8, 9, 10],
        e_mpa: 2_000.0,
        poisson: 0.2,
    }];
    input.loads_kn = vec![[0.0; 3]; input.mesh.nodes.len()];
    input.prescribed_m = vec![[Some(0.0); 3]; 4]
        .into_iter()
        .chain(vec![[None; 3]; 7])
        .collect();
    input
}

#[test]
fn unloaded_vertex_connected_tet_hex_needs_independent_restraints() {
    // The Tet4 is fixed. The Hex8 touches it only at node 0, so a rigid
    // rotation u=(-y, x, 0) of the Hex8 is zero at that node and has zero
    // strain in both solids. Zero load must not make PCG report convergence.
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        let mut input = vertex_connected_tet_hex(backend);
        solve(&input).expect_err("a vertex-connected Hex8 has a free rigid rotation");

        // Two noncollinear Hex8 vertices fixed along with shared node 0
        // remove every rigid mode while leaving five Hex8 nodes free.
        input.prescribed_m[4] = [Some(0.0); 3];
        input.prescribed_m[6] = [Some(0.0); 3];
        let solved = solve(&input).expect("the separately braced Hex8 is stable");
        assert_eq!(solved.linear_iterations, 0, "{backend:?}");
        assert!(solved
            .nodal_displacements_m
            .iter()
            .flatten()
            .all(|value| value.abs() < 1e-15));
    }
}

#[test]
fn unloaded_face_connected_hexes_remain_valid() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let mut input = model(backend);
        input.mesh.nodes = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 1.0],
            [2.0, 0.0, 0.0],
            [2.0, 1.0, 0.0],
            [2.0, 0.0, 1.0],
            [2.0, 1.0, 1.0],
        ];
        input.mesh.tets.clear();
        input.hexes = vec![
            Hex8MixedElement {
                nodes: [0, 1, 2, 3, 4, 5, 6, 7],
                e_mpa: 2_000.0,
                poisson: 0.2,
            },
            Hex8MixedElement {
                nodes: [1, 8, 9, 2, 5, 10, 11, 6],
                e_mpa: 2_000.0,
                poisson: 0.2,
            },
        ];
        input.loads_kn = vec![[0.0; 3]; 12];
        input.prescribed_m = vec![[Some(0.0); 3]; 8]
            .into_iter()
            .chain(vec![[None; 3]; 4])
            .collect();
        let solved = solve(&input).expect("whole-face connection transfers all rigid modes");
        assert_eq!(solved.linear_iterations, 0);
    }
}

#[test]
fn unloaded_four_bar_shear_mechanism_is_not_a_converged_solution() {
    for backend in [
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::Automatic,
    ] {
        let mut input = model(backend);
        input.mesh.nodes = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ];
        input.mesh.tets.clear();
        input.trusses = [[0, 1], [1, 2], [2, 3], [3, 0]]
            .map(|nodes| Truss3dElement {
                nodes,
                e_mpa: 210_000.0,
                area_m2: 0.01,
            })
            .to_vec();
        input.loads_kn = vec![[0.0; 3]; 4];
        input.prescribed_m = vec![
            [Some(0.0); 3],
            [None, Some(0.0), Some(0.0)],
            [None, None, Some(0.0)],
            [None, None, Some(0.0)],
        ];
        // Five free translations but only four independent bar extensions.
        // In particular u2x=u3x=1, all other free u=0, strains no bar.
        let error = solve(&input).expect_err("the square has an internal shear mechanism");
        assert!(error.contains("truss") && error.contains("rank"), "{error}");

        input.trusses.push(Truss3dElement {
            nodes: [0, 1],
            e_mpa: 210_000.0,
            area_m2: 0.01,
        });
        let error = solve(&input).expect_err("a duplicate bar does not brace the square");
        assert!(error.contains("truss") && error.contains("rank"), "{error}");
        input.trusses.pop();
        input.trusses.push(Truss3dElement {
            nodes: [0, 2],
            e_mpa: 210_000.0,
            area_m2: 0.01,
        });
        let solved = solve(&input).expect("one diagonal braces the square");
        assert_eq!(solved.linear_iterations, 0);
        assert!(solved
            .nodal_displacements_m
            .iter()
            .flatten()
            .all(|value| value.abs() < 1e-15));

        // Unit-load virtual work: top and right bars carry |N|=F, and the
        // diagonal carries sqrt(2) F, hence u3x=F(2+2sqrt(2))/(EA).
        input.loads_kn[3][0] = 1.0;
        let loaded = solve(&input).expect("braced square carries a horizontal load");
        let reference_m = (2.0 + 2.0 * 2.0_f64.sqrt()) / (1000.0 * 210_000.0 * 0.01);
        assert!((loaded.nodal_displacements_m[3][0] - reference_m).abs() < 1e-10 * reference_m);
    }
}

fn inclined_membrane_tip(backend: Mixed3dBackend, with_frame: bool) -> Mixed3dRequest {
    let mut request = model(backend);
    request.mesh.nodes.truncate(4);
    request.mesh.tets.truncate(1);
    request.mesh.nodes.push([1.0, 1.0, 1.0]);
    request.loads_kn = vec![[0.0; 3]; 5];
    request.prescribed_m = vec![[Some(0.0); 3]; 4];
    request.prescribed_m.push([None; 3]);
    request.membranes.push(Membrane3dElement {
        nodes: [1, 2, 4],
        e_mpa: 3_000.0,
        nu: 0.2,
        thickness_m: 0.1,
    });
    if with_frame {
        request.mesh.nodes.push([2.0, 0.0, 0.0]);
        request.loads_kn.push([0.0; 3]);
        request.prescribed_m.push([None; 3]);
        request.frames.push(Frame3dMixedElement {
            nodes: [1, 5],
            e_mpa: 200_000.0,
            poisson: 0.3,
            g_mpa: None,
            area_m2: 0.02,
            iy_m4: 0.0001,
            iz_m4: 0.0001,
            torsion_j_m4: 0.0002,
            roll_angle_rad: 0.0,
        });
        request.prescribed_rotations_rad = vec![[None; 3]; 6];
        request.prescribed_rotations_rad[1] = [Some(0.0); 3];
    }
    request
}

#[test]
fn unloaded_inclined_membrane_tip_requires_a_transverse_brace() {
    // For nodes (1,0,0), (0,1,0), (1,1,1), the normal is proportional to
    // (1,1,-1). Moving only tip node 4 by that vector produces zero Tri3
    // membrane strain and no solid/frame strain: a genuine null-energy mode.
    for with_frame in [false, true] {
        let direct = inclined_membrane_tip(Mixed3dBackend::Dense, with_frame);
        assert!(
            solve(&direct).is_err(),
            "a direct solve must see the mechanism"
        );
        for backend in [
            Mixed3dBackend::SparsePcg,
            Mixed3dBackend::MatrixFreePcg,
            Mixed3dBackend::Automatic,
        ] {
            let mut request = inclined_membrane_tip(backend, with_frame);
            let error = solve(&request).expect_err("zero-load PCG must not accept the flap");
            assert!(
                error.contains("unbraced transverse mode at node 4"),
                "{error}"
            );

            // Prescribing z at the tip blocks the null normal vector, while
            // leaving two in-plane translations free. This is a valid model.
            request.prescribed_m[4][2] = Some(0.0);
            let unloaded = solve(&request).expect("transversely braced membrane");
            assert_eq!(unloaded.linear_iterations, 0);
            request.loads_kn[4][0] = 1.0;
            let loaded = solve(&request).expect("braced membrane carries in-plane load");
            let mut direct = inclined_membrane_tip(Mixed3dBackend::Dense, with_frame);
            direct.prescribed_m[4][2] = Some(0.0);
            direct.loads_kn[4][0] = 1.0;
            let reference = solve(&direct).expect("direct braced reference");
            for axis in 0..3 {
                assert!(
                    (loaded.nodal_displacements_m[4][axis]
                        - reference.nodal_displacements_m[4][axis])
                        .abs()
                        < 1e-10,
                    "{backend:?} braced displacement axis {axis}"
                );
            }

            // Prescribed normal motion gives exactly zero membrane strain.
            // This checks the geometric reference independently of the solve.
            request.loads_kn[4][0] = 0.0;
            request.prescribed_m[4] = [Some(0.001), Some(0.001), Some(-0.001)];
            let normal_motion = solve(&request).expect("prescribed zero-energy motion");
            assert!(normal_motion.membrane_stress_mpa[0]
                .iter()
                .all(|stress| stress.abs() < 1e-9));
        }
    }
}

#[test]
fn unloaded_coplanar_two_tri3_patch_needs_a_transverse_brace() {
    // Both triangles lie on z=x+y. Their normal (-1,-1,1)/sqrt(3) has
    // nonzero x, y and z components, so the free node has a positive
    // stiffness diagonal in every direction despite a normal null mode.
    // Node 2 belongs to both Tri3s; checking only single-membrane tips
    // therefore misses its unconstrained transverse motion.
    let mut input = model(Mixed3dBackend::Dense);
    input.mesh.nodes = vec![
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 1.0],
        [1.0, 1.0, 2.0],
        [0.0, 1.0, 1.0],
    ];
    input.mesh.tets.clear();
    input.membranes = [[0, 1, 2], [0, 2, 3]]
        .map(|nodes| Membrane3dElement {
            nodes,
            e_mpa: 3_000.0,
            nu: 0.0,
            thickness_m: 0.1,
        })
        .to_vec();
    input.loads_kn = vec![[0.0; 3]; 4];
    input.prescribed_m = vec![[Some(0.0); 3]; 4];
    input.prescribed_m[2] = [None; 3];

    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        input.backend = backend;
        solve(&input).expect_err("two coplanar Tri3s have an unbraced normal mode");
    }

    // A displacement (-a,-a,a) at node 2 is exactly normal to both
    // triangles and gives zero membrane strain, independently of the solve.
    input.prescribed_m[2] = [Some(-0.001), Some(-0.001), Some(0.001)];
    input.backend = Mixed3dBackend::Dense;
    let normal_motion = solve(&input).expect("prescribed normal motion");
    assert!(normal_motion
        .membrane_stress_mpa
        .iter()
        .flatten()
        .all(|stress| stress.abs() < 1e-9));

    // Braced one-DOF reference: fix node 2's y and z translations and
    // apply 1 kN in x. Each triangle has area sqrt(3)/2. With nu=0,
    // grad(x)=(2,-1,1)/3, grad(y)=(-1,2,1)/3, and the two membrane
    // strain-tensor norms squared are 4/9 and 5/18 per unit ux. Thus
    // kxx = 1000*E*t*A*(4/9+5/18) = 325000*sqrt(3)/3 kN/m,
    // giving ux = sqrt(3)/325000 m for the unit load.
    input.prescribed_m[2] = [None, Some(0.0), Some(0.0)];
    input.loads_kn[2][0] = 1.0;
    let expected_ux = 3.0_f64.sqrt() / 325_000.0;
    let mut direct_ux: Option<f64> = None;
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        input.backend = backend;
        let solved = solve(&input).expect("braced two-Tri3 patch");
        let ux = solved.nodal_displacements_m[2][0];
        assert!(
            (ux - expected_ux).abs() < 1e-11 * expected_ux,
            "{backend:?}: ux={ux}, expected={expected_ux}"
        );
        if let Some(reference) = direct_ux {
            assert!((ux - reference).abs() < 1e-11 * expected_ux);
        } else {
            direct_ux = Some(ux);
        }
    }
}
