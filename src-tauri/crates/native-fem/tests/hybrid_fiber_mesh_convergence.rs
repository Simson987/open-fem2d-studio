//! Independent cantilever-strip check of the material-only steel hybrid plate.
//! With nu=0 and free longitudinal sides, a uniform end line load has the
//! one-way equilibrium moment Mx(x)=q(L-x). The reference tip displacement is
//! the integral of curvature from an independently integrated uniaxial
//! bilinear steel section, not another plate element implementation.
//! The scalar strip reference is approximate for the plate's plane-stress J2
//! return mapping; this test does not validate biaxial plasticity, GNL, or
//! concrete cracking.

use openaec_native_fem::hybrid_plate::{self, EdgeLoad, FiberQuad};
use openaec_native_fem::plate_bending::{LinearBackend, Material, Node, Support};
use openaec_native_fem::plate_fiber_section::Layer;
use openaec_native_fem::quad2d::{mesh_squares, SquareGrid};
use openaec_native_fem::MaterialLaw;

const LENGTH: f64 = 2.0;
const WIDTH: f64 = 1.0;
const THICKNESS: f64 = 0.2;
const E: f64 = 30_000_000.0; // kN/m²
const FY: f64 = 1_000.0; // kN/m²
const HARDENING: f64 = 0.02;
const END_LOAD: f64 = -4.0; // kN/m

fn model(cell_m: f64, layers: usize) -> (hybrid_plate::Request, Vec<FiberQuad>) {
    let mesh = mesh_squares(&SquareGrid {
        origin_x: 0.0,
        origin_y: 0.0,
        width_m: LENGTH,
        height_m: WIDTH,
        cell_size_m: cell_m,
        material_id: 1,
        thickness_m: THICKNESS,
    })
    .unwrap();
    let sections = mesh
        .quads
        .iter()
        .map(|quad| FiberQuad {
            quad_id: quad.id,
            layers: vec![
                Layer {
                    thickness_m: THICKNESS / layers as f64,
                    e_mpa: E / 1000.0,
                    nu: 0.0,
                    law: MaterialLaw::SteelBilinear {
                        yield_mpa: FY / 1000.0,
                        hardening_ratio: HARDENING,
                    },
                };
                layers
            ],
        })
        .collect();
    let mut request = hybrid_plate::Request {
        nodes: mesh
            .nodes
            .iter()
            .map(|node| Node {
                id: node.id,
                x: node.x,
                y: node.y,
            })
            .collect(),
        materials: vec![Material {
            id: 1,
            e_mpa: E / 1000.0,
            nu: 0.0,
        }],
        orthotropic_materials: vec![],
        quads: mesh.quads,
        supports: mesh
            .left_node_ids
            .iter()
            .map(|&node_id| Support {
                node_id,
                w: true,
                theta_x: true,
                theta_y: true,
                kw_kn_per_m: None,
                ktheta_x_knm_per_rad: None,
                ktheta_y_knm_per_rad: None,
            })
            .collect(),
        loads: vec![],
        edge_loads: vec![],
        pressure_kn_m2: 0.0,
        quad_pressures: vec![],
        modulus_curves: vec![],
        reinforcement: None,
        load_path: vec![0.5, 1.0],
        tolerance: 1e-8,
        max_iterations: 40,
        linear_backend: LinearBackend::Existing,
        frontal_max_front_dofs: None,
    };
    // Select the true free-edge quads from geometry, independent of node ID order.
    let xy: std::collections::HashMap<_, _> = request
        .nodes
        .iter()
        .map(|node| (node.id, [node.x, node.y]))
        .collect();
    request.edge_loads = request
        .quads
        .iter()
        .filter(|quad| {
            (xy[&quad.node_ids[1]][0] - LENGTH).abs() < 1e-12
                && (xy[&quad.node_ids[2]][0] - LENGTH).abs() < 1e-12
        })
        .map(|quad| EdgeLoad {
            quad_id: quad.id,
            edge_index: 1,
            start_kn_per_m: END_LOAD,
            end_kn_per_m: END_LOAD,
        })
        .collect();
    (request, sections)
}

// Exact through-thickness integral for a monotone uniaxial bilinear law.
// For kappa>kappa_y, c=fy/(E*kappa) is the elastic-core half-depth.
fn reference_moment(curvature: f64) -> f64 {
    let kappa = curvature.abs();
    if kappa == 0.0 {
        return 0.0;
    }
    let a = THICKNESS / 2.0;
    let c = (FY / (E * kappa)).min(a);
    let elastic = 2.0 * E * kappa * c.powi(3) / 3.0;
    let plastic = (FY - HARDENING * FY) * (a * a - c * c)
        + 2.0 * HARDENING * E * kappa * (a.powi(3) - c.powi(3)) / 3.0;
    elastic + plastic
}

fn reference_curvature(moment: f64) -> f64 {
    if moment == 0.0 {
        return 0.0;
    }
    let mut lo = 0.0;
    let mut hi = 1e-5;
    while reference_moment(hi) < moment.abs() {
        hi *= 2.0;
    }
    for _ in 0..60 {
        let mid = (lo + hi) / 2.0;
        if reference_moment(mid) < moment.abs() {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    moment.signum() * (lo + hi) / 2.0
}

fn reference_tip() -> f64 {
    // Simpson integration of w(L) = integral_0^L (L-x) kappa(x) dx.
    let intervals = 400;
    let dx = LENGTH / intervals as f64;
    let integral = (0..=intervals)
        .map(|i| {
            let x = i as f64 * dx;
            let weight = if i == 0 || i == intervals {
                1.0
            } else if i % 2 == 0 {
                2.0
            } else {
                4.0
            };
            weight * (LENGTH - x) * reference_curvature(END_LOAD * (LENGTH - x))
        })
        .sum::<f64>();
    integral * dx / 3.0
}

#[test]
fn reference_section_recovers_elastic_rigidity_and_first_yield_moment() {
    let i = THICKNESS.powi(3) / 12.0;
    let tiny_curvature = 1e-6;
    assert!((reference_moment(tiny_curvature) - E * i * tiny_curvature).abs() < 1e-12);
    let first_yield_curvature = 2.0 * FY / (E * THICKNESS);
    let first_yield_moment = FY * THICKNESS * THICKNESS / 6.0;
    assert!((reference_moment(first_yield_curvature) - first_yield_moment).abs() < 1e-12);
    assert!((reference_curvature(first_yield_moment) - first_yield_curvature).abs() < 1e-12);
}

#[test]
fn material_only_steel_plate_refines_towards_one_way_plastic_strip() {
    let expected_tip = reference_tip();
    let mut measurements = Vec::new();
    for (cell_m, layers) in [(1.0, 8), (0.5, 8), (0.25, 8)] {
        let (request, sections) = model(cell_m, layers);
        let result = hybrid_plate::solve_with_fiber_sections(&request, &sections).unwrap();
        assert!(result.relative_residual < 1e-8);
        assert!(result
            .elements
            .iter()
            .any(|element| element.max_equivalent_plastic_strain > 0.0));
        let tip = result
            .nodes
            .iter()
            .filter(|node| {
                let x = request
                    .nodes
                    .iter()
                    .find(|n| n.id == node.node_id)
                    .unwrap()
                    .x;
                (x - LENGTH).abs() < 1e-12
            })
            .map(|node| node.w_m)
            .sum::<f64>()
            / (WIDTH / cell_m + 1.0);
        assert!(
            (tip - expected_tip).abs() / expected_tip.abs() < 0.006,
            "strip deflection differs from independent bilinear-section integral"
        );
        let reaction = result.nodes.iter().map(|n| n.reaction_fz_kn).sum::<f64>();
        assert!((reaction + END_LOAD * WIDTH).abs() < 1e-7);
        let max_moment_error = result
            .elements
            .iter()
            .flat_map(|element| &element.material_points)
            .map(|point| {
                (point.moment_knm_per_m[0] - END_LOAD * (LENGTH - point.position_m[0])).abs()
            })
            .fold(0.0_f64, f64::max);
        let max_curvature_error = result
            .elements
            .iter()
            .flat_map(|element| &element.material_points)
            .filter(|point| point.position_m[0] < LENGTH - 0.1)
            .map(|point| {
                let reference = reference_curvature(END_LOAD * (LENGTH - point.position_m[0]));
                (point.curvature_per_m[0] - reference).abs() / reference.abs()
            })
            .fold(0.0_f64, f64::max);
        assert!(max_moment_error < 0.01 * END_LOAD.abs() * LENGTH);
        assert!(
            max_curvature_error < 0.03,
            "plane-stress plate curvature differs by over 3% from uniaxial strip"
        );
        println!("cell={cell_m} layers={layers} tip={tip} reference={expected_tip} moment_error={max_moment_error} curvature_error={max_curvature_error}");
        measurements.push((tip, max_moment_error, max_curvature_error));
    }
    assert!(measurements[1].1 < measurements[0].1);
    assert!(measurements[2].1 < measurements[1].1);
    assert!(
        (measurements[2].0 - measurements[1].0).abs() / expected_tip.abs() < 0.005,
        "in-plane refinement changed tip displacement by more than 0.5%"
    );
    let mut thickness_tips = Vec::new();
    for layers in [4, 16] {
        let (request, sections) = model(0.5, layers);
        let result = hybrid_plate::solve_with_fiber_sections(&request, &sections).unwrap();
        assert!(result.relative_residual < 1e-8);
        let tip = result
            .nodes
            .iter()
            .filter(|node| {
                (request
                    .nodes
                    .iter()
                    .find(|n| n.id == node.node_id)
                    .unwrap()
                    .x
                    - LENGTH)
                    .abs()
                    < 1e-12
            })
            .map(|node| node.w_m)
            .sum::<f64>()
            / 3.0;
        println!("cell=0.5 layers={layers} tip={tip} reference={expected_tip}");
        thickness_tips.push(tip);
    }
    let coarse_thickness_error = (thickness_tips[0] - thickness_tips[1]).abs();
    let refined_thickness_error = (measurements[1].0 - thickness_tips[1]).abs();
    assert!(refined_thickness_error < coarse_thickness_error);
    assert!(refined_thickness_error / expected_tip.abs() < 0.001);
}
