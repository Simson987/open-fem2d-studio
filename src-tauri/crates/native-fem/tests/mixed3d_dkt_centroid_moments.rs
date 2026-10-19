//! Independent constant-curvature DKT moment references through the coupled
//! Tet4/plate/frame path. Moment expectations come from Kirchhoff plate
//! theory, not the element B matrix or its recovered output.

use openaec_native_fem::mixed3d::{solve, Mixed3dBackend, Mixed3dRequest};
use serde_json::json;

const E_MPA: f64 = 30_000.0;
const NU: f64 = 0.2;
const KX: f64 = 0.002;
const KY: f64 = -0.001;
const GAMMA_XY: f64 = 0.0006;

fn near(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.15e}, expected={expected:.15e}, tolerance={tolerance:.3e}"
    );
}

fn field(x: f64, y: f64, z: f64, curvature: [f64; 3], rigid: [f64; 2]) -> ([f64; 3], [f64; 3]) {
    let [kx, ky, gamma_xy] = curvature;
    let [rigid_rx, rigid_ry] = rigid;
    let w =
        0.5 * kx * x * x + 0.5 * ky * y * y + 0.5 * gamma_xy * x * y + rigid_rx * y - rigid_ry * x;
    // Physical frame rotations are Rx=dw/dy, Ry=-dw/dx. The DKT element
    // uses their negatives as thetaX and thetaY.
    let rx = ky * y + 0.5 * gamma_xy * x + rigid_rx;
    let ry = -kx * x - 0.5 * gamma_xy * y + rigid_ry;
    ([ry * z, -rx * z, w], [rx, ry, 0.0])
}

fn patch(
    thickness_m: f64,
    reversed: bool,
    backend: Mixed3dBackend,
    curvature: [f64; 3],
    rigid: [f64; 2],
) -> Mixed3dRequest {
    // A 2x2 DKT square has one interior node with three genuinely free
    // bending DOFs. A Tet4 and a bending frame share its fixed corner node.
    let mut nodes = Vec::new();
    let mut prescribed = Vec::new();
    let mut prescribed_rotations = Vec::new();
    for j in 0..=2 {
        for i in 0..=2 {
            let (x, y) = (i as f64 / 2.0, j as f64 / 2.0);
            nodes.push([x, y, 0.0]);
            let (u, r) = field(x, y, 0.0, curvature, rigid);
            let boundary = i == 0 || j == 0 || i == 2 || j == 2;
            prescribed.push(if boundary {
                [
                    if i == 0 && j == 0 { Some(u[0]) } else { None },
                    if i == 0 && j == 0 { Some(u[1]) } else { None },
                    Some(u[2]),
                ]
            } else {
                [None, None, None]
            });
            prescribed_rotations.push(if boundary {
                [
                    Some(r[0]),
                    Some(r[1]),
                    if i == 0 && j == 0 { Some(0.0) } else { None },
                ]
            } else {
                [None, None, None]
            });
        }
    }
    for xyz in [[0.0, 0.0, 1.0], [-1.0, 0.0, 0.0], [0.0, -1.0, 0.0]] {
        let (u, r) = field(xyz[0], xyz[1], xyz[2], curvature, rigid);
        nodes.push(xyz);
        prescribed.push(u.map(Some));
        prescribed_rotations.push(if nodes.len() - 1 == 10 {
            r.map(Some)
        } else {
            [None, None, None]
        });
    }
    let mut triangles = Vec::new();
    let id = |i: usize, j: usize| i + 3 * j;
    for j in 0..2 {
        for i in 0..2 {
            let (a, b, c, d) = (id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1));
            for nodes in [[a, b, d], [a, d, c]] {
                let nodes = if reversed {
                    [nodes[0], nodes[2], nodes[1]]
                } else {
                    nodes
                };
                triangles.push(
                    json!({"nodes": nodes, "eMpa": E_MPA, "nu": NU, "thicknessM": thickness_m}),
                );
            }
        }
    }
    serde_json::from_value(json!({
        "mesh": {"nodes": nodes, "tets": [[0, 9, 10, 11]]},
        "solidMaterial": {"eMpa": 120.0, "poisson": NU},
        "trusses": [],
        "frames": [{"nodes": [0, 10], "eMpa": 200000.0, "poisson": 0.3,
          "areaM2": 0.02, "iyM4": 0.0001, "izM4": 0.0001, "torsionJM4": 0.0002}],
        "bendingPlates": triangles,
        "loadsKn": vec![[0.0; 3]; 12],
        "prescribedM": prescribed,
        "prescribedRotationsRad": prescribed_rotations,
        "backend": backend,
        "threads": 4,
        "maxPcgIterations": 1000
    }))
    .expect("quadratic coupled DKT patch")
}

fn analytic_moments(thickness_m: f64, curvature: [f64; 3]) -> [f64; 3] {
    // D∇^4w is the Kirchhoff operator. For constant curvature
    // kappa=[w_xx,w_yy,2w_xy], the isotropic bending law gives these
    // centroid moment resultants in kN m/m. 1 MPa = 1000 kN/m².
    let d = 1_000.0 * E_MPA * thickness_m.powi(3) / (12.0 * (1.0 - NU * NU));
    let [kx, ky, gamma_xy] = curvature;
    [
        d * (kx + NU * ky),
        d * (NU * kx + ky),
        d * (1.0 - NU) * gamma_xy / 2.0,
    ]
}

#[test]
fn coupled_centroid_moments_match_quadratic_plate_theory_across_backends_and_winding() {
    let expected = analytic_moments(0.1, [KX, KY, GAMMA_XY]);
    for backend in [
        Mixed3dBackend::Dense,
        Mixed3dBackend::SparseDirect,
        Mixed3dBackend::SparsePcg,
        Mixed3dBackend::MatrixFreePcg,
        Mixed3dBackend::FrontalWave,
        Mixed3dBackend::Automatic,
    ] {
        for reversed in [false, true] {
            let result = solve(&patch(0.1, reversed, backend, [KX, KY, GAMMA_XY], [0.0; 2]))
                .unwrap_or_else(|e| panic!("{backend:?}, reversed={reversed}: {e}"));
            assert_eq!(result.bending_plate_moments_knm_per_m.len(), 8);
            assert_eq!(result.solid_element_stress_mpa.len(), 1);
            assert_eq!(result.frame_end_forces_local.len(), 1);
            assert!(result.relative_residual < 1e-8);
            for moment in &result.bending_plate_moments_knm_per_m {
                for axis in 0..3 {
                    near(
                        moment[axis],
                        expected[axis],
                        2e-6,
                        "quadratic patch centroid M (kNm/m)",
                    );
                }
            }
            let interior = result.nodal_displacements_m[4][2];
            near(
                interior,
                field(0.5, 0.5, 0.0, [KX, KY, GAMMA_XY], [0.0; 2]).0[2],
                1e-9,
                "free interior w (m)",
            );
        }
    }
}

#[test]
fn centroid_moments_scale_with_thickness_cubed_for_prescribed_curvature() {
    let thin = solve(&patch(
        0.1,
        false,
        Mixed3dBackend::MatrixFreePcg,
        [KX, KY, GAMMA_XY],
        [0.0; 2],
    ))
    .unwrap();
    let thick = solve(&patch(
        0.2,
        false,
        Mixed3dBackend::MatrixFreePcg,
        [KX, KY, GAMMA_XY],
        [0.0; 2],
    ))
    .unwrap();
    for (a, b) in thin
        .bending_plate_moments_knm_per_m
        .iter()
        .zip(&thick.bending_plate_moments_knm_per_m)
    {
        for axis in 0..3 {
            near(
                b[axis],
                8.0 * a[axis],
                1e-5,
                "t cubed centroid moment (kNm/m)",
            );
        }
    }
}

#[test]
fn rigid_rotation_recovers_zero_centroid_moment_and_zero_reactions() {
    for backend in [Mixed3dBackend::SparsePcg, Mixed3dBackend::MatrixFreePcg] {
        let result = solve(&patch(0.1, true, backend, [0.0; 3], [0.01, -0.02]))
            .unwrap_or_else(|e| panic!("{backend:?}: {e}"));
        for moment in &result.bending_plate_moments_knm_per_m {
            for &value in moment {
                near(value, 0.0, 2e-8, "rigid centroid moment (kNm/m)");
            }
        }
        for reaction in &result.nodal_reactions_kn {
            for &value in reaction {
                near(value, 0.0, 2e-5, "rigid reaction (kN)");
            }
        }
    }
}

#[test]
fn no_plate_model_returns_empty_moment_array() {
    let mut value: serde_json::Value =
        serde_json::from_str(include_str!("../examples/mixed3d-tet4-frame-bending.json")).unwrap();
    let input = &mut value["input"];
    input["mesh"]["nodes"].as_array_mut().unwrap().truncate(4);
    input["frames"] = json!([]);
    input["loadsKn"].as_array_mut().unwrap().truncate(4);
    input["momentsKnm"].as_array_mut().unwrap().truncate(4);
    input["prescribedM"].as_array_mut().unwrap().truncate(4);
    input["prescribedRotationsRad"]
        .as_array_mut()
        .unwrap()
        .truncate(4);
    input["prescribedRotationsRad"][1] = json!([null, null, null]);
    for backend in [Mixed3dBackend::Dense, Mixed3dBackend::MatrixFreePcg] {
        input["backend"] = serde_json::to_value(backend).unwrap();
        let request: Mixed3dRequest = serde_json::from_value(input.clone()).unwrap();
        let result = solve(&request).unwrap_or_else(|e| panic!("{backend:?}: {e}"));
        assert!(result.bending_plate_moments_knm_per_m.is_empty());
    }
}

#[test]
fn dkt_local_stiffness_is_exactly_symmetric_for_sparse_ldlt() {
    use openaec_native_fem::plate_bending::{element_stiffness, Material, Node};
    let material = Material {
        id: 0,
        e_mpa: E_MPA,
        nu: NU,
    };
    for coordinates in [
        [[0.0, 0.0], [0.5, 0.0], [0.5, 0.5]],
        [[0.0, 0.0], [0.5, 0.5], [0.0, 0.5]],
    ] {
        let nodes = coordinates.map(|point| Node {
            id: 0,
            x: point[0],
            y: point[1],
        });
        let k = element_stiffness([&nodes[0], &nodes[1], &nodes[2]], &material, 0.1).unwrap();
        for i in 0..9 {
            for j in i + 1..9 {
                assert_eq!(k[i][j], k[j][i], "local reciprocity at {i},{j}");
            }
        }
    }
}
