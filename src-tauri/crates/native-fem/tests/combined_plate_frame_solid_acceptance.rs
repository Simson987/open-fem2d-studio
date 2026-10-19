//! Staged acceptance fixture for one conceptual deck/column/foundation assembly.
//! The executable stages are deliberately separate public solver calls. They do
//! not imply a coupled frame/plate/solid model or validated concrete plate FNL.

use openaec_native_fem::frame3d;
use openaec_native_fem::hybrid_plate::{
    self, EdgeLoad, ElasticLayeredQuad, GeometricShellRequest, MembraneLoad, MembraneSupport,
    QuadPressure,
};
use openaec_native_fem::plate_bending::{LinearBackend, Material, Node, Support};
use openaec_native_fem::plate_fiber_section::{Layer, PlateFiberSection};
use openaec_native_fem::quad2d::Quad;
use openaec_native_fem::solid_finite_j2::FiniteJ2Steel;
use openaec_native_fem::volume3d::Mesh;
use openaec_native_fem::volume3d_concrete_damage::{
    self, ConcreteTetMaterial, ConcreteTetOptions, ConcreteTetRequest, ConcreteTetTarget,
};
use openaec_native_fem::volume3d_finite_j2::{
    self, FiniteJ2TetOptions, FiniteJ2TetRequest, FiniteJ2TetTarget,
};
use openaec_native_fem::volume3d_gnl::{self, GnlTetOptions, GnlTetRequest, GnlTetTarget};
use openaec_native_fem::MaterialLaw;
use openaec_native_fem::{crack_width, frame2d, prestressed_beam};
use serde::Deserialize;
use serde_json::json;

const FIXTURE: &str = include_str!("../examples/combined-plate-frame-solid-acceptance.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    schema_version: u32,
    id: String,
    units: String,
    plate: PlateSpec,
    frame: FrameSpec,
    solid: SolidSpec,
    load_path_factors: Vec<f64>,
    separate_reference_examples: ReferenceExamples,
    large_model_release_tests: Vec<String>,
    acceptance_gates: Vec<Gate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReferenceExamples {
    frame2d: String,
    prestressed_beam: String,
    shear_without_links: String,
    shear_links: String,
    crack_width: String,
}

#[derive(Deserialize)]
struct Gate {
    id: String,
    status: String,
    criterion: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlateSpec {
    origin_m: [f64; 3],
    size_m: [f64; 2],
    coarse_cells: [usize; 2],
    refined_cells: [usize; 2],
    thickness_m: f64,
    reference_e_mpa: f64,
    nu: f64,
    layers_bottom_to_top: Vec<LayerSpec>,
    pressure_kn_m2: f64,
    patch: PatchSpec,
    free_edge_load_kn_per_m: [f64; 2],
    free_edge_membrane_fx_kn: f64,
    expected_transverse_force_kn: f64,
    expected_transverse_x_first_moment_knm: f64,
    expected_transverse_y_first_moment_knm: f64,
    required_concrete_plate_regularization: ConcretePlateRegularization,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConcretePlateRegularization {
    fracture_energy_n_per_m: f64,
    characteristic_length_m: Option<f64>,
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LayerSpec {
    name: String,
    thickness_m: f64,
    e_mpa: f64,
    nu: f64,
    baseline_law: MaterialLaw,
    target_law: MaterialLaw,
    #[serde(default)]
    target_law_status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchSpec {
    x_min_m: f64,
    y_min_m: f64,
    extra_pressure_kn_m2: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameSpec {
    base_m: [f64; 3],
    head_m: [f64; 3],
    e_mpa: f64,
    nu: f64,
    area_m2: f64,
    iy_m4: f64,
    iz_m4: f64,
    torsion_jm4: f64,
    head_lateral_fx_kn: f64,
    head_compression_fz_kn: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolidSpec {
    origin_m: [f64; 3],
    size_m: [f64; 3],
    cells: [usize; 3],
    e_mpa: f64,
    poisson: f64,
    top_shear_gamma: f64,
    finite_j2_coupon: FiniteJ2CouponSpec,
    damage_coupon: DamageCouponSpec,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FiniteJ2CouponSpec {
    youngs_mpa: f64,
    poisson: f64,
    yield_mpa: f64,
    hardening_mpa: f64,
    peak_hencky_strain: f64,
    unload_factor: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DamageCouponSpec {
    cells: [usize; 3],
    e_mpa: f64,
    poisson: f64,
    weak_tensile_mpa: f64,
    strong_tensile_mpa: f64,
    fracture_energy_n_per_m: f64,
    strong_fracture_energy_n_per_m: f64,
    crack_band_width_m: f64,
    peak_axial_strain: f64,
    unload_axial_strain: f64,
}

fn fixture() -> Fixture {
    serde_json::from_str(FIXTURE).unwrap()
}

fn close(actual: f64, expected: f64, tolerance: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{label}: actual={actual:.12e}, expected={expected:.12e}, tol={tolerance:.3e}"
    );
}

fn plate_layers(spec: &PlateSpec) -> Vec<Layer> {
    spec.layers_bottom_to_top
        .iter()
        .map(|layer| Layer {
            thickness_m: layer.thickness_m,
            e_mpa: layer.e_mpa,
            nu: layer.nu,
            law: layer.baseline_law,
        })
        .collect()
}

fn plate_request(
    spec: &PlateSpec,
    cells: [usize; 2],
    backend: LinearBackend,
) -> hybrid_plate::Request {
    let [nx, ny] = cells;
    assert!(nx > 0 && ny > 0);
    let id = |i: usize, j: usize| 1 + i + (nx + 1) * j;
    let mut nodes = Vec::new();
    let mut supports = Vec::new();
    for j in 0..=ny {
        for i in 0..=nx {
            let node_id = id(i, j);
            nodes.push(Node {
                id: node_id,
                x: spec.origin_m[0] + spec.size_m[0] * i as f64 / nx as f64,
                y: spec.origin_m[1] + spec.size_m[1] * j as f64 / ny as f64,
            });
            if i == 0 {
                supports.push(Support {
                    node_id,
                    w: true,
                    theta_x: true,
                    theta_y: true,
                    kw_kn_per_m: None,
                    ktheta_x_knm_per_rad: None,
                    ktheta_y_knm_per_rad: None,
                });
            }
        }
    }
    let mut quads = Vec::new();
    let mut quad_pressures = Vec::new();
    let mut edge_loads = Vec::new();
    for j in 0..ny {
        for i in 0..nx {
            let quad_id = quads.len() + 1;
            let x_mid = spec.origin_m[0] + spec.size_m[0] * (i as f64 + 0.5) / nx as f64;
            let y_mid = spec.origin_m[1] + spec.size_m[1] * (j as f64 + 0.5) / ny as f64;
            quads.push(Quad {
                id: quad_id,
                node_ids: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)],
                material_id: 1,
                thickness_m: spec.thickness_m,
            });
            if x_mid > spec.patch.x_min_m && y_mid > spec.patch.y_min_m {
                quad_pressures.push(QuadPressure {
                    quad_id,
                    nodal_pressure_kn_m2: [spec.patch.extra_pressure_kn_m2; 4],
                });
            }
            if i == nx - 1 {
                let t0 = j as f64 / ny as f64;
                let t1 = (j + 1) as f64 / ny as f64;
                let line = |t: f64| {
                    spec.free_edge_load_kn_per_m[0] * (1.0 - t)
                        + spec.free_edge_load_kn_per_m[1] * t
                };
                edge_loads.push(EdgeLoad {
                    quad_id,
                    edge_index: 1,
                    start_kn_per_m: line(t0),
                    end_kn_per_m: line(t1),
                });
            }
        }
    }
    hybrid_plate::Request {
        nodes,
        materials: vec![Material {
            id: 1,
            e_mpa: spec.reference_e_mpa,
            nu: spec.nu,
        }],
        orthotropic_materials: vec![],
        quads,
        supports,
        loads: vec![],
        edge_loads,
        pressure_kn_m2: spec.pressure_kn_m2,
        quad_pressures,
        modulus_curves: vec![],
        reinforcement: None,
        load_path: vec![],
        tolerance: 1e-8,
        max_iterations: 40,
        linear_backend: backend,
        frontal_max_front_dofs: Some(64),
    }
}

fn layered_quads(request: &hybrid_plate::Request, spec: &PlateSpec) -> Vec<ElasticLayeredQuad> {
    request
        .quads
        .iter()
        .map(|quad| ElasticLayeredQuad {
            quad_id: quad.id,
            layers: plate_layers(spec),
        })
        .collect()
}

#[test]
fn fixture_has_explicit_supported_and_pending_gates() {
    let model = fixture();
    assert_eq!(model.schema_version, 1);
    assert_eq!(model.id, "cantilever-deck-column-foundation-v1");
    assert_eq!(model.units, "m, kN, MPa");
    assert_eq!(model.load_path_factors, [0.0, 0.5, 1.0, 0.25, 0.0, 1.0]);
    assert_eq!(model.plate.origin_m[2], model.frame.head_m[2]);
    assert_eq!(
        model.frame.base_m[2],
        model.solid.origin_m[2] + model.solid.size_m[2]
    );
    close(
        model
            .plate
            .layers_bottom_to_top
            .iter()
            .map(|layer| layer.thickness_m)
            .sum(),
        model.plate.thickness_m,
        1e-14,
        "layer thickness",
    );
    assert!(matches!(
        model.plate.layers_bottom_to_top[0].target_law,
        MaterialLaw::ConcreteCracking { .. }
    ));
    assert!(matches!(
        model.plate.layers_bottom_to_top[1].target_law,
        MaterialLaw::SteelBilinear { .. }
    ));
    assert_eq!(model.plate.layers_bottom_to_top[0].name, "concrete");
    assert_eq!(model.plate.layers_bottom_to_top[1].name, "top-steel");
    let plate = &model.plate;
    let patch_area =
        (plate.size_m[0] - plate.patch.x_min_m) * (plate.size_m[1] - plate.patch.y_min_m);
    let full_area = plate.size_m[0] * plate.size_m[1];
    let line_length = plate.size_m[1];
    let line_resultant =
        line_length * (plate.free_edge_load_kn_per_m[0] + plate.free_edge_load_kn_per_m[1]) / 2.0;
    close(
        plate.pressure_kn_m2 * full_area
            + plate.patch.extra_pressure_kn_m2 * patch_area
            + line_resultant,
        plate.expected_transverse_force_kn,
        1e-12,
        "external vertical resultant",
    );
    close(
        plate.pressure_kn_m2 * full_area * plate.size_m[0] / 2.0
            + plate.patch.extra_pressure_kn_m2
                * patch_area
                * (plate.patch.x_min_m + plate.size_m[0])
                / 2.0
            + line_resultant * plate.size_m[0],
        plate.expected_transverse_x_first_moment_knm,
        1e-12,
        "external first x moment",
    );
    close(
        plate.pressure_kn_m2 * full_area * plate.size_m[1] / 2.0
            + plate.patch.extra_pressure_kn_m2
                * patch_area
                * (plate.patch.y_min_m + plate.size_m[1])
                / 2.0
            + line_length
                * plate.size_m[1]
                * (plate.free_edge_load_kn_per_m[0] + 2.0 * plate.free_edge_load_kn_per_m[1])
                / 6.0,
        plate.expected_transverse_y_first_moment_knm,
        1e-12,
        "external first y moment",
    );
    assert!(model.plate.layers_bottom_to_top[0]
        .target_law_status
        .as_deref()
        .unwrap()
        .contains("must be rejected"));
    assert!(
        model
            .plate
            .required_concrete_plate_regularization
            .fracture_energy_n_per_m
            > 0.0
    );
    assert_eq!(
        model
            .plate
            .required_concrete_plate_regularization
            .characteristic_length_m,
        None
    );
    assert!(model
        .plate
        .required_concrete_plate_regularization
        .status
        .contains("pending"));
    let statuses: Vec<_> = model
        .acceptance_gates
        .iter()
        .map(|gate| gate.status.as_str())
        .collect();
    assert!(statuses.contains(&"executable"));
    assert!(statuses.contains(&"executable-separate"));
    assert!(statuses.contains(&"pending"));
    assert!(statuses.contains(&"explicit-scale-test"));
    assert!(model
        .acceptance_gates
        .iter()
        .all(|gate| !gate.id.is_empty() && !gate.criterion.is_empty()));
    assert!(model
        .acceptance_gates
        .iter()
        .any(|gate| gate.id == "plate-frame-solid-interface" && gate.status == "pending"));
    assert!(model.acceptance_gates.iter().any(|gate| {
        gate.id == "solid-finite-strain-j2" && gate.status == "executable-separate"
    }));
    assert_eq!(model.large_model_release_tests.len(), 4);
    assert!(model
        .large_model_release_tests
        .iter()
        .any(|name| name == "volume_finite_j2_250k_validation"));
    assert!(model
        .large_model_release_tests
        .iter()
        .any(|name| name == "volume_hex8_250k_cavity_validation"));
}

#[test]
fn separate_frame2d_prestress_shear_and_crack_width_examples_remain_runnable() {
    let model = fixture();
    let refs = model.separate_reference_examples;
    assert_eq!(refs.frame2d, "frame2d-p-delta-cantilever.json");
    let frame: frame2d::Request =
        serde_json::from_str(include_str!("../examples/frame2d-p-delta-cantilever.json")).unwrap();
    let frame_result = frame2d::solve(&frame).unwrap();
    close(
        frame_result.nodes[0].reaction[0],
        100.0,
        1e-7,
        "2D frame axial reaction",
    );
    close(
        frame_result.nodes[0].reaction[1],
        10.0,
        1e-7,
        "2D frame lateral reaction",
    );
    assert!(frame_result.equilibrium_residual < 1e-6);

    assert_eq!(refs.prestressed_beam, "parabolic-prestressed-beam.json");
    let beam: prestressed_beam::Request =
        serde_json::from_str(include_str!("../examples/parabolic-prestressed-beam.json")).unwrap();
    let beam_result = prestressed_beam::solve(&beam).unwrap();
    close(
        beam_result.transfer.equivalent_uniform_upward_kn_per_m,
        16.0,
        1e-10,
        "transfer equivalent upward load",
    );
    close(
        beam_result.service.force_kn,
        800.0,
        1e-10,
        "service prestress after loss",
    );
    close(
        beam_result.service.external_left_reaction_kn,
        80.0,
        1e-10,
        "service external left reaction",
    );

    assert_eq!(
        refs.shear_without_links,
        "ec2-prestressed-shear-example-6-3.json"
    );
    let no_links: prestressed_beam::Request = serde_json::from_str(include_str!(
        "../examples/ec2-prestressed-shear-example-6-3.json"
    ))
    .unwrap();
    let no_links_result = prestressed_beam::solve(&no_links).unwrap();
    assert!(no_links_result
        .service
        .stations
        .iter()
        .all(|point| point.shear_resistance_without_links.is_some()));

    assert_eq!(
        refs.shear_links,
        "ec2-prestressed-shear-links-example-6-4.json"
    );
    let links: prestressed_beam::Request = serde_json::from_str(include_str!(
        "../examples/ec2-prestressed-shear-links-example-6-4.json"
    ))
    .unwrap();
    let links_result = prestressed_beam::solve(&links).unwrap();
    let support_links = links_result.service.stations[0]
        .shear_links
        .as_ref()
        .unwrap();
    close(support_links.v_ed_kn, 600.0, 1e-8, "link design VEd");
    close(
        support_links.required_asw_per_spacing_mm2_per_mm,
        600_000.0 / (675.0 * 391.0 * 1.8),
        1e-9,
        "required Asw/s",
    );

    assert_eq!(refs.crack_width, "ec2-bonded-prestress-crack-width.json");
    let crack_wrapper: serde_json::Value = serde_json::from_str(include_str!(
        "../examples/ec2-bonded-prestress-crack-width.json"
    ))
    .unwrap();
    assert_eq!(crack_wrapper["kind"], "crackWidth");
    let crack: crack_width::Request =
        serde_json::from_value(crack_wrapper["input"].clone()).unwrap();
    let crack_result = crack_width::solve(&crack).unwrap();
    close(
        crack_result.crack_width_mm,
        0.098496,
        1e-5,
        "bonded prestress crack width",
    );
}

#[test]
fn asymmetric_elastic_deck_closes_pressure_edge_equilibrium_and_refines() {
    let model = fixture();
    let plate = &model.plate;
    let section = PlateFiberSection::new(&plate_layers(plate)).unwrap();
    let tangent = section
        .trial([0.0; 6], &section.initial_state())
        .unwrap()
        .tangent;
    // Independent thickness integrals of Qxx=1000 E/(1-nu²): A=∫Q dz,
    // B=∫zQ dz, D=∫z²Q dz. No Gauss weights or solver tangents in reference.
    let mut bottom = -plate.thickness_m / 2.0;
    let mut abd = [0.0; 3];
    for layer in &plate.layers_bottom_to_top {
        let top = bottom + layer.thickness_m;
        let q = 1000.0 * layer.e_mpa / (1.0 - layer.nu * layer.nu);
        abd[0] += q * (top - bottom);
        abd[1] += q * (top * top - bottom * bottom) / 2.0;
        abd[2] += q * (top.powi(3) - bottom.powi(3)) / 3.0;
        bottom = top;
    }
    close(tangent[0][0], abd[0], 2e-4, "Axx");
    close(tangent[0][3], abd[1], 2e-5, "Bxx");
    close(tangent[3][3], abd[2], 2e-6, "Dxx");
    assert!(abd[1].abs() > 0.0, "asymmetric stack must have B coupling");

    let mut tip_w = Vec::new();
    for cells in [plate.coarse_cells, plate.refined_cells] {
        let request = plate_request(plate, cells, LinearBackend::Existing);
        let layers = layered_quads(&request, plate);
        let dense = hybrid_plate::solve_with_elastic_layered_sections(&request, &layers).unwrap();
        let mut frontal_request = request.clone();
        frontal_request.linear_backend = LinearBackend::FrontalWave;
        let frontal =
            hybrid_plate::solve_with_elastic_layered_sections(&frontal_request, &layers).unwrap();
        assert_eq!(dense.nodes.len(), frontal.nodes.len());
        assert!(dense.relative_residual < 1e-7 && frontal.relative_residual < 1e-7);
        for (a, b) in dense.nodes.iter().zip(&frontal.nodes) {
            close(a.w_m, b.w_m, 2e-9, "backend plate w");
            close(a.reaction_fz_kn, b.reaction_fz_kn, 2e-8, "backend plate Rz");
        }
        let rz: f64 = dense.nodes.iter().map(|node| node.reaction_fz_kn).sum();
        let my: f64 = dense.nodes.iter().map(|node| node.reaction_my_knm).sum();
        let x_axis_reaction: f64 = dense
            .nodes
            .iter()
            .zip(&request.nodes)
            .map(|(result, geometry)| {
                // theta_x = -w,y, so the physical x-axis moment has the
                // opposite sign to the reported generalized theta_x reaction.
                geometry.y * result.reaction_fz_kn - result.reaction_mx_knm
            })
            .sum();
        close(rz, -plate.expected_transverse_force_kn, 2e-8, "plate Rz");
        close(
            my,
            -plate.expected_transverse_x_first_moment_knm,
            2e-8,
            "plate My",
        );
        close(
            x_axis_reaction,
            -plate.expected_transverse_y_first_moment_knm,
            2e-8,
            "plate global x-axis moment",
        );
        let free_corner_id = 1 + cells[0] + (cells[0] + 1) * cells[1];
        tip_w.push(dense.nodes[free_corner_id - 1].w_m);
    }
    assert!(tip_w.iter().all(|value| *value < 0.0));
    let refinement_change = (tip_w[1] / tip_w[0] - 1.0).abs();
    assert!(
        refinement_change < 0.15,
        "deck tip mesh change={refinement_change:.3e}"
    );
}

#[test]
fn separate_homogeneous_shell_carries_membrane_force_and_transverse_load() {
    let model = fixture();
    let plate = &model.plate;
    let bending = plate_request(plate, plate.coarse_cells, LinearBackend::Existing);
    let nx = plate.coarse_cells[0];
    let ny = plate.coarse_cells[1];
    let id = |i: usize, j: usize| 1 + i + (nx + 1) * j;
    let membrane_supports = (0..=ny)
        .map(|j| MembraneSupport {
            node_id: id(0, j),
            u: true,
            v: true,
            ku_kn_per_m: None,
            kv_kn_per_m: None,
        })
        .collect();
    let membrane_loads = (0..=ny)
        .map(|j| MembraneLoad {
            node_id: id(nx, j),
            fx_kn: plate.free_edge_membrane_fx_kn * if j == 0 || j == ny { 0.25 } else { 0.5 },
            fy_kn: 0.0,
        })
        .collect();
    let result = hybrid_plate::solve_geometric_shell(&GeometricShellRequest {
        bending,
        analysis: openaec_native_fem::Analysis::Geometric,
        material_laws: Default::default(),
        membrane_supports,
        membrane_loads,
    })
    .unwrap();
    close(
        result.nodes.iter().map(|node| node.reaction_fx_kn).sum(),
        -plate.free_edge_membrane_fx_kn,
        2e-6,
        "shell Fx",
    );
    close(
        result.nodes.iter().map(|node| node.reaction_fz_kn).sum(),
        -plate.expected_transverse_force_kn,
        2e-6,
        "shell Fz",
    );
    assert!(result.nodes.iter().any(|node| node.u_m > 0.0));
    assert!(result.nodes.iter().any(|node| node.w_m < 0.0));
    assert!(result.relative_residual < 1e-6);
}

#[test]
fn separate_column_p_delta_amplifies_and_balances_head_load() {
    let model = fixture();
    let frame = &model.frame;
    let base = json!({"id":1,"x":frame.base_m[0],"y":frame.base_m[1],"z":frame.base_m[2]});
    let head = json!({"id":2,"x":frame.head_m[0],"y":frame.head_m[1],"z":frame.head_m[2]});
    let mut request: frame3d::Request = serde_json::from_value(json!({
        "analysis":"linear",
        "nodes":[base,head],
        "materials":[{"id":1,"eMpa":frame.e_mpa,"nu":frame.nu,"law":{"kind":"elastic"}}],
        "sections":[{"id":1,"areaM2":frame.area_m2,"iyM4":frame.iy_m4,"izM4":frame.iz_m4,"torsionJM4":frame.torsion_jm4}],
        "members":[{"id":1,"startNodeId":1,"endNodeId":2,"materialId":1,"sectionId":1}],
        "supports":[{"nodeId":1,"ux":true,"uy":true,"uz":true,"rx":true,"ry":true,"rz":true}],
        "nodalLoads":[{"nodeId":2,"fx":frame.head_lateral_fx_kn,"fy":0,"fz":frame.head_compression_fz_kn,"mx":0,"my":0,"mz":0}]
    })).unwrap();
    let linear = frame3d::solve(&request).unwrap();
    request.analysis = frame3d::Analysis::PDelta;
    let second_order = frame3d::solve(&request).unwrap();
    assert!(second_order.nodes[1].displacement[0].abs() > linear.nodes[1].displacement[0].abs());
    close(
        second_order.nodes[0].reaction[0],
        -frame.head_lateral_fx_kn,
        1e-7,
        "column Rx",
    );
    close(
        second_order.nodes[0].reaction[2],
        -frame.head_compression_fz_kn,
        1e-7,
        "column Rz",
    );
    assert!(second_order.equilibrium_residual < 1e-6);
}

#[test]
fn separate_tet4_second_order_shear_matches_analytic_green_strain_and_nominal_traction() {
    let model = fixture();
    let spec = &model.solid;
    let mut mesh = Mesh::structured(spec.cells).unwrap();
    for point in &mut mesh.nodes {
        for axis in 0..3 {
            point[axis] = spec.origin_m[axis] + spec.size_m[axis] * point[axis];
        }
    }
    let gamma = spec.top_shear_gamma;
    let gamma_path = [gamma, -gamma, gamma];
    let center = mesh
        .nodes
        .iter()
        .position(|point| {
            (0..3).all(|axis| {
                (point[axis] - spec.origin_m[axis] - 0.5 * spec.size_m[axis]).abs() < 1e-12
            })
        })
        .unwrap();
    let targets: Vec<_> = gamma_path
        .iter()
        .map(|&value| GnlTetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            prescribed_m: mesh
                .nodes
                .iter()
                .enumerate()
                .map(|(node, point)| {
                    if node == center {
                        [None; 3]
                    } else {
                        [
                            Some(value * (point[2] - spec.origin_m[2]) / spec.size_m[2]),
                            Some(0.0),
                            Some(0.0),
                        ]
                    }
                })
                .collect(),
            body_forces: vec![],
            face_tractions: vec![],
        })
        .collect();
    let result = volume3d_gnl::solve(&GnlTetRequest {
        mesh: mesh.clone(),
        e_mpa: spec.e_mpa,
        poisson: spec.poisson,
        element_materials: None,
        element_energy_beta: None,
        targets,
        options: GnlTetOptions::default(),
    })
    .unwrap();
    let mu = spec.e_mpa / (2.0 * (1.0 + spec.poisson));
    let lambda = spec.e_mpa * spec.poisson / ((1.0 + spec.poisson) * (1.0 - 2.0 * spec.poisson));
    let expected_p_xz = mu * gamma + (0.5 * lambda + mu) * gamma.powi(3);
    close(
        result.nodal_displacements_m[center][0],
        0.5 * gamma,
        1e-11,
        "solid center ux",
    );
    for strain in &result.element_green_strain {
        close(strain[0][2], 0.5 * gamma, 1e-10, "Green Exz");
        close(strain[2][2], 0.5 * gamma * gamma, 1e-10, "Green Ezz");
    }
    for stress in &result.element_first_piola_mpa {
        close(stress[0][2], expected_p_xz, 1e-7, "Piola Pxz");
    }
    let top_z = spec.origin_m[2] + spec.size_m[2];
    let top_reaction_x: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| (point[2] - top_z).abs() < 1e-12)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(
        top_reaction_x,
        1000.0 * expected_p_xz * spec.size_m[0] * spec.size_m[1],
        1e-4,
        "solid top nominal traction",
    );
    assert!(result.true_free_residual_kn < 1e-6);
}

#[test]
fn separate_tet4_finite_strain_j2_coupon_matches_closed_hencky_return() {
    let model = fixture();
    let solid = &model.solid;
    let coupon = &solid.finite_j2_coupon;
    let mut mesh = Mesh::structured(solid.cells).unwrap();
    for point in &mut mesh.nodes {
        for axis in 0..3 {
            point[axis] = solid.origin_m[axis] + solid.size_m[axis] * point[axis];
        }
    }
    let center = mesh
        .nodes
        .iter()
        .position(|point| {
            (0..3).all(|axis| {
                (point[axis] - solid.origin_m[axis] - 0.5 * solid.size_m[axis]).abs() < 1e-12
            })
        })
        .unwrap();
    let a = coupon.peak_hencky_strain;
    assert!(a > 0.0 && coupon.unload_factor > 0.0 && coupon.unload_factor < 1.0);
    let targets: Vec<_> = [0.5 * a, a, coupon.unload_factor * a, a]
        .into_iter()
        .map(|step| FiniteJ2TetTarget {
            loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
            body_forces: vec![],
            face_tractions: vec![],
            prescribed_m: mesh
                .nodes
                .iter()
                .enumerate()
                .map(|(node, point)| {
                    if node == center {
                        [None; 3]
                    } else {
                        [
                            Some((step.exp() - 1.0) * (point[0] - solid.origin_m[0])),
                            Some(((-step).exp() - 1.0) * (point[1] - solid.origin_m[1])),
                            Some(0.0),
                        ]
                    }
                })
                .collect(),
        })
        .collect();
    let steel = FiniteJ2Steel::new(
        coupon.youngs_mpa,
        coupon.poisson,
        coupon.yield_mpa,
        coupon.hardening_mpa,
    )
    .unwrap();
    let result = volume3d_finite_j2::solve(&FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel,
        element_steels: None,
        targets: targets.clone(),
        options: FiniteJ2TetOptions::default(),
    })
    .unwrap();
    let unloaded = volume3d_finite_j2::solve(&FiniteJ2TetRequest {
        mesh: mesh.clone(),
        steel,
        element_steels: None,
        targets: targets[..3].to_vec(),
        options: FiniteJ2TetOptions::default(),
    })
    .unwrap();
    let shear = coupon.youngs_mpa / (2.0 * (1.0 + coupon.poisson));
    let trial_q = 2.0 * shear * 3.0_f64.sqrt() * a;
    assert!(trial_q > coupon.yield_mpa);
    let alpha = (trial_q - coupon.yield_mpa) / (3.0 * shear + coupon.hardening_mpa);
    let plastic_hencky = 3.0_f64.sqrt() * alpha / 2.0;
    let tau_x = 2.0 * shear * (a - plastic_hencky);
    let expected_pxx = tau_x / a.exp();
    let expected_pyy = -tau_x / (-a).exp();
    let unload_a = coupon.unload_factor * a;
    let unload_tau_x = 2.0 * shear * (unload_a - plastic_hencky);
    let unload_pxx = unload_tau_x / unload_a.exp();
    for (element, state) in unloaded.element_states.iter().enumerate() {
        close(
            state.equivalent_plastic_strain,
            alpha,
            2e-8,
            &format!("finite-J2 unloaded plastic history {element}"),
        );
        close(
            unloaded.element_first_piola_mpa[element][0][0],
            unload_pxx,
            2e-5,
            "finite-J2 unloaded Pxx",
        );
    }
    close(
        result.nodal_displacements_m[center][0],
        0.5 * (a.exp() - 1.0) * solid.size_m[0],
        2e-10,
        "finite-J2 center ux",
    );
    for (element, state) in result.element_states.iter().enumerate() {
        close(
            state.equivalent_plastic_strain,
            alpha,
            2e-8,
            &format!("finite-J2 plastic strain {element}"),
        );
        let stress = result.element_first_piola_mpa[element];
        close(stress[0][0], expected_pxx, 2e-5, "finite-J2 Pxx");
        close(stress[1][1], expected_pyy, 2e-5, "finite-J2 Pyy");
    }
    let top_x = solid.origin_m[0] + solid.size_m[0];
    let reaction_x: f64 = mesh
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, point)| (point[0] - top_x).abs() < 1e-12)
        .map(|(node, _)| result.nodal_reactions_kn[node][0])
        .sum();
    close(
        reaction_x,
        1000.0 * expected_pxx * solid.size_m[1] * solid.size_m[2],
        2e-4,
        "finite-J2 x-face nominal force",
    );
    assert!(result.accepted_steps.len() >= 4);
    assert!(result.true_free_residual_kn < 1e-6);
}

#[test]
fn separate_tet4_damage_coupon_localizes_to_weak_zone_and_retains_history() {
    let model = fixture();
    let coupon = &model.solid.damage_coupon;
    let mesh = Mesh::structured(coupon.cells).unwrap();
    let materials: Vec<_> = mesh
        .tets
        .iter()
        .map(|tet| {
            let cx = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
            ConcreteTetMaterial {
                e_mpa: coupon.e_mpa,
                poisson: coupon.poisson,
                tensile_strength_mpa: if cx < 0.5 {
                    coupon.weak_tensile_mpa
                } else {
                    coupon.strong_tensile_mpa
                },
                fracture_energy_n_per_m: if cx < 0.5 {
                    coupon.fracture_energy_n_per_m
                } else {
                    coupon.strong_fracture_energy_n_per_m
                },
                crack_band_width_m: coupon.crack_band_width_m,
            }
        })
        .collect();
    let run = |strains: &[f64]| {
        let targets = strains
            .iter()
            .map(|&strain| ConcreteTetTarget {
                loads_kn: vec![[0.0; 3]; mesh.nodes.len()],
                prescribed_m: mesh
                    .nodes
                    .iter()
                    .map(|point| [Some(strain * point[0]), Some(0.0), Some(0.0)])
                    .collect(),
                body_forces: vec![],
                face_tractions: vec![],
            })
            .collect();
        volume3d_concrete_damage::solve(&ConcreteTetRequest {
            mesh: mesh.clone(),
            e_mpa: coupon.e_mpa,
            poisson: coupon.poisson,
            tensile_strength_mpa: coupon.weak_tensile_mpa,
            fracture_energy_n_per_m: coupon.fracture_energy_n_per_m,
            crack_band_width_m: coupon.crack_band_width_m,
            element_materials: Some(materials.clone()),
            targets,
            options: ConcreteTetOptions::default(),
        })
        .unwrap()
    };
    let peak = run(&[coupon.peak_axial_strain]);
    let unload = run(&[coupon.peak_axial_strain, coupon.unload_axial_strain]);
    let result = run(&[
        coupon.peak_axial_strain,
        coupon.unload_axial_strain,
        coupon.peak_axial_strain,
    ]);
    assert!(result.accepted_steps.len() >= 3);
    assert!(result.true_free_residual_kn < 1e-6);
    for (element, tet) in mesh.tets.iter().enumerate() {
        let cx = tet.iter().map(|&node| mesh.nodes[node][0]).sum::<f64>() / 4.0;
        if cx < 0.5 {
            assert!(
                result.element_damage[element] > 0.0,
                "weak element {element} did not crack"
            );
            close(
                unload.element_damage[element],
                peak.element_damage[element],
                1e-12,
                "damage preserved on unload",
            );
            close(
                result.element_damage[element],
                peak.element_damage[element],
                1e-12,
                "damage preserved on reload",
            );
            close(
                unload.element_stress_mpa[element][0],
                peak.element_stress_mpa[element][0] * coupon.unload_axial_strain
                    / coupon.peak_axial_strain,
                1e-8,
                "weak-zone secant unload stress",
            );
            close(
                result.element_stress_mpa[element][0],
                peak.element_stress_mpa[element][0],
                1e-8,
                "weak-zone reload stress",
            );
        } else {
            close(
                result.element_damage[element],
                0.0,
                1e-12,
                "strong-zone damage",
            );
            close(
                result.element_stress_mpa[element][0],
                coupon.e_mpa * coupon.peak_axial_strain,
                1e-8,
                "strong-zone elastic stress",
            );
        }
    }
}

// Activation criterion: replace this ignored gate with an ordinary passing test
// only after one global solve uses layerwise concrete/steel history, geometric
// membrane-bending coupling, and frame/solid interface equilibrium on this mesh.
#[test]
#[ignore = "missing shared plate GNL/FNL and frame/solid interface assembly; fixture gates identify exact work"]
fn coupled_plate_frame_solid_non_linear_acceptance_gate() {
    let model = fixture();
    let pending: Vec<_> = model
        .acceptance_gates
        .iter()
        .filter(|gate| gate.status == "pending")
        .map(|gate| gate.id.as_str())
        .collect();
    assert_eq!(
        pending,
        [
            "plate-steel-plastic-global",
            "plate-concrete-crack-global",
            "plate-membrane-bending-fnl",
            "plate-frame-solid-interface",
        ]
    );
    panic!("no coupled solver API or validated global result exists yet");
}
