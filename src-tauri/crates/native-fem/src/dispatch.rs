//! One typed protocol for all independent Rust FEM kernels. The desktop,
//! development browser and MCP transports call this same function.

use serde::{Deserialize, Serialize};

use crate::{
    crack_width, frame2d, frame3d, hybrid_plate, mixed2d, mixed3d, plate2d, plate_bending,
    prestressed_beam, quad2d, three_layer, volume3d, volume3d_concrete_damage, volume3d_finite_j2,
    volume3d_gnl, volume3d_j2, volume_hex8,
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HybridPlateLayeredRequest {
    pub bending: hybrid_plate::Request,
    pub elastic_layered_sections: Vec<hybrid_plate::ElasticLayeredQuad>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HybridPlateFiberRequest {
    pub bending: hybrid_plate::Request,
    pub fiber_sections: Vec<hybrid_plate::FiberQuad>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", content = "input", rename_all = "camelCase")]
pub enum NativeFemRequest {
    Frame2d(frame2d::Request),
    Frame3d(frame3d::Request),
    Plate2d(plate2d::Request),
    PlateBending(plate_bending::Request),
    Quad2d(quad2d::Request),
    Mixed2d(mixed2d::Request),
    Mixed3d(mixed3d::Mixed3dRequest),
    HybridPlate(hybrid_plate::Request),
    HybridPlateLayered(HybridPlateLayeredRequest),
    HybridPlateFiber(HybridPlateFiberRequest),
    GeometricShell(hybrid_plate::GeometricShellRequest),
    SquareMesh(quad2d::SquareGrid),
    QuadMesh(quad2d::QuadGrid),
    PrestressedBeam(prestressed_beam::Request),
    CrackWidth(crack_width::Request),
    ThreeLayer(three_layer::ThreeLayerInput),
    ThreeLayerBatch(three_layer::ThreeLayerBatchInput),
    Volume3d(volume3d::Volume3dRequest),
    Volume3dConcreteDamage(volume3d_concrete_damage::ConcreteTetRequest),
    Volume3dFiniteJ2(volume3d_finite_j2::FiniteJ2TetRequest),
    Volume3dFiniteJ2Coupled(volume3d_finite_j2::FiniteJ2CoupledRequest),
    Volume3dFiniteJ2MembraneCoupled(volume3d_finite_j2::FiniteJ2MembraneCoupledRequest),
    Volume3dFiniteJ2HexCoupled(volume3d_finite_j2::FiniteJ2HexCoupledRequest),
    Volume3dFiniteJ2FrameCoupled(volume3d_finite_j2::FiniteJ2FrameCoupledRequest),
    Volume3dGnl(volume3d_gnl::GnlTetRequest),
    Volume3dJ2(volume3d_j2::J2TetRequest),
    VolumeHex8(volume_hex8::Hex8VolumeRequest),
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "result", rename_all = "camelCase")]
pub enum NativeFemResult {
    Frame2d(frame2d::Result2D),
    Frame3d(frame3d::Result3D),
    Plate2d(plate2d::Result2D),
    PlateBending(plate_bending::ResultBending),
    Quad2d(quad2d::Result2D),
    Mixed2d(mixed2d::Result2D),
    Mixed3d(mixed3d::Mixed3dResult),
    HybridPlate(hybrid_plate::ResultBending),
    HybridPlateLayered(hybrid_plate::ResultBending),
    HybridPlateFiber(hybrid_plate::FiberPlateResult),
    GeometricShell(hybrid_plate::GeometricShellResult),
    SquareMesh(quad2d::SquareMesh),
    QuadMesh(quad2d::QuadMesh),
    PrestressedBeam(prestressed_beam::ResultBeam),
    CrackWidth(crack_width::Result),
    ThreeLayer(three_layer::ThreeLayerResult),
    ThreeLayerBatch(three_layer::ThreeLayerBatchResult),
    Volume3d(volume3d::Volume3dResponse),
    Volume3dConcreteDamage(volume3d_concrete_damage::ConcreteTetResult),
    Volume3dFiniteJ2(volume3d_finite_j2::FiniteJ2TetResult),
    Volume3dFiniteJ2Coupled(volume3d_finite_j2::FiniteJ2TetResult),
    Volume3dFiniteJ2MembraneCoupled(volume3d_finite_j2::FiniteJ2TetResult),
    Volume3dFiniteJ2HexCoupled(volume3d_finite_j2::FiniteJ2TetResult),
    Volume3dFiniteJ2FrameCoupled(volume3d_finite_j2::FiniteJ2TetResult),
    Volume3dGnl(volume3d_gnl::GnlTetResult),
    Volume3dJ2(volume3d_j2::J2TetResult),
    VolumeHex8(volume_hex8::Hex8VolumeResponse),
}

pub fn solve_native_fem(request: NativeFemRequest) -> Result<NativeFemResult, String> {
    Ok(match request {
        NativeFemRequest::Frame2d(input) => NativeFemResult::Frame2d(frame2d::solve(&input)?),
        NativeFemRequest::Frame3d(input) => NativeFemResult::Frame3d(frame3d::solve(&input)?),
        NativeFemRequest::Plate2d(input) => NativeFemResult::Plate2d(plate2d::solve(&input)?),
        NativeFemRequest::PlateBending(input) => {
            NativeFemResult::PlateBending(plate_bending::solve(&input)?)
        }
        NativeFemRequest::Quad2d(input) => NativeFemResult::Quad2d(quad2d::solve(&input)?),
        NativeFemRequest::Mixed2d(input) => NativeFemResult::Mixed2d(mixed2d::solve(&input)?),
        NativeFemRequest::Mixed3d(input) => NativeFemResult::Mixed3d(mixed3d::solve(&input)?),
        NativeFemRequest::HybridPlate(input) => {
            NativeFemResult::HybridPlate(hybrid_plate::solve(&input)?)
        }
        NativeFemRequest::HybridPlateLayered(input) => {
            NativeFemResult::HybridPlateLayered(hybrid_plate::solve_with_elastic_layered_sections(
                &input.bending,
                &input.elastic_layered_sections,
            )?)
        }
        NativeFemRequest::HybridPlateFiber(input) => NativeFemResult::HybridPlateFiber(
            hybrid_plate::solve_with_fiber_sections(&input.bending, &input.fiber_sections)?,
        ),
        NativeFemRequest::GeometricShell(input) => {
            NativeFemResult::GeometricShell(hybrid_plate::solve_geometric_shell(&input)?)
        }
        NativeFemRequest::SquareMesh(input) => {
            NativeFemResult::SquareMesh(quad2d::mesh_squares(&input)?)
        }
        NativeFemRequest::QuadMesh(input) => NativeFemResult::QuadMesh(quad2d::mesh_quads(&input)?),
        NativeFemRequest::PrestressedBeam(input) => {
            NativeFemResult::PrestressedBeam(prestressed_beam::solve(&input)?)
        }
        NativeFemRequest::CrackWidth(input) => {
            NativeFemResult::CrackWidth(crack_width::solve(&input)?)
        }
        NativeFemRequest::ThreeLayer(input) => {
            NativeFemResult::ThreeLayer(three_layer::check(&input)?)
        }
        NativeFemRequest::ThreeLayerBatch(input) => {
            NativeFemResult::ThreeLayerBatch(three_layer::check_batch(&input)?)
        }
        NativeFemRequest::Volume3d(input) => {
            NativeFemResult::Volume3d(volume3d::solve_volume3d(input)?)
        }
        NativeFemRequest::Volume3dConcreteDamage(input) => {
            NativeFemResult::Volume3dConcreteDamage(volume3d_concrete_damage::solve(&input)?)
        }
        NativeFemRequest::Volume3dFiniteJ2(input) => {
            NativeFemResult::Volume3dFiniteJ2(volume3d_finite_j2::solve(&input)?)
        }
        NativeFemRequest::Volume3dFiniteJ2Coupled(input) => {
            NativeFemResult::Volume3dFiniteJ2Coupled(volume3d_finite_j2::solve_coupled(&input)?)
        }
        NativeFemRequest::Volume3dFiniteJ2MembraneCoupled(input) => {
            NativeFemResult::Volume3dFiniteJ2MembraneCoupled(
                volume3d_finite_j2::solve_membrane_coupled(&input)?,
            )
        }
        NativeFemRequest::Volume3dFiniteJ2HexCoupled(input) => {
            NativeFemResult::Volume3dFiniteJ2HexCoupled(volume3d_finite_j2::solve_hex_coupled(
                &input,
            )?)
        }
        NativeFemRequest::Volume3dFiniteJ2FrameCoupled(input) => {
            NativeFemResult::Volume3dFiniteJ2FrameCoupled(volume3d_finite_j2::solve_frame_coupled(
                &input,
            )?)
        }
        NativeFemRequest::Volume3dGnl(input) => {
            NativeFemResult::Volume3dGnl(volume3d_gnl::solve(&input)?)
        }
        NativeFemRequest::Volume3dJ2(input) => {
            NativeFemResult::Volume3dJ2(volume3d_j2::solve(&input)?)
        }
        NativeFemRequest::VolumeHex8(input) => {
            NativeFemResult::VolumeHex8(volume_hex8::solve_hex8_volume(input)?)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finite_strain_j2_coupon_is_dispatched_with_committed_history() {
        let request: NativeFemRequest = serde_json::from_str(include_str!(
            "../examples/volume3d-finite-j2-steel-coupon.json"
        ))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "volume3dFiniteJ2");
        assert_eq!(
            value["result"]["elementStates"].as_array().unwrap().len(),
            6
        );
        assert!(value["result"]["elementStates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|state| state["equivalentPlasticStrain"].as_f64().unwrap() > 0.0));
        assert!(value["result"]["trueFreeResidualKn"].as_f64().unwrap() < 1e-5);
    }

    #[test]
    fn finite_strain_j2_hex_only_is_dispatched_with_gauss_history() {
        let nodes = [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 1.0],
        ];
        let steel = serde_json::json!({"youngsMpa":210000.0,"poisson":0.3,
            "yieldMpa":250.0,"hardeningMpa":1000.0});
        let zero_triplets = vec![[0.0, 0.0, 0.0]; 8];
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind":"volume3dFiniteJ2HexCoupled",
            "input": {
                "volume": {"mesh":{"nodes":nodes,"tets":[]},"steel":steel,
                    "targets":[{"loadsKn":zero_triplets,
                        "prescribedM":zero_triplets}]},
                "hexes":[{"nodes":[0,1,2,3,4,5,6,7],"steel":steel}],
                "hexTargets":[{}]
            }
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "volume3dFiniteJ2HexCoupled");
        assert_eq!(
            value["result"]["hexGaussStates"][0]
                .as_array()
                .unwrap()
                .len(),
            8
        );
        assert_eq!(
            value["result"]["hexGaussCauchyMpa"][0]
                .as_array()
                .unwrap()
                .len(),
            8
        );
    }

    #[test]
    fn square_mesh_is_dispatched_with_typed_output() {
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "squareMesh",
            "input": { "originX": 0, "originY": 0, "widthM": 2, "heightM": 2,
                "cellSizeM": 1, "materialId": 1, "thicknessM": 0.1 }
        }))
        .unwrap();
        let result = solve_native_fem(request).unwrap();
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value["kind"], "squareMesh");
        assert_eq!(value["result"]["quads"].as_array().unwrap().len(), 4);
    }

    #[test]
    fn hex8_cube_is_dispatched_with_gauss_stresses() {
        let input: serde_json::Value =
            serde_json::from_str(include_str!("../examples/volume-hex8-uniaxial.json")).unwrap();
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind":"volumeHex8","input":input
        }))
        .unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "volumeHex8");
        assert!(
            (result["result"]["elementGaussStressMpa"][0][0][0]
                .as_f64()
                .unwrap()
                - 210.0)
                .abs()
                < 1e-6
        );
    }

    #[test]
    fn j2_steel_coupon_is_dispatched_with_committed_history() {
        let request: NativeFemRequest =
            serde_json::from_str(include_str!("../examples/volume3d-j2-steel-coupon.json"))
                .unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "volume3dJ2");
        assert!(result["result"]["acceptedSteps"].as_array().unwrap().len() >= 2);
        let right_reaction: f64 = [1, 3, 5, 7]
            .iter()
            .map(|&node| {
                result["result"]["nodalReactionsKn"][node][0]
                    .as_f64()
                    .unwrap()
            })
            .sum();
        let e = 200_000.0;
        let fy = 250.0;
        let h = 2_000.0;
        let p = (e * 0.004 - fy) / (e + h);
        let expected = e * (0.0035 - p) * 1_000.0;
        assert!((right_reaction - expected).abs() < 1e-4);
    }

    #[test]
    fn concrete_damage_coupon_is_dispatched_with_committed_history() {
        let request: NativeFemRequest = serde_json::from_str(include_str!(
            "../examples/volume3d-concrete-damage-coupon.json"
        ))
        .unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "volume3dConcreteDamage");
        assert!(result["result"]["acceptedSteps"].as_array().unwrap().len() >= 2);
        let history = result["result"]["elementStates"][0]["maxEquivalentStrain"]
            .as_f64()
            .unwrap();
        let onset = 3.0 / 30_000.0;
        let softening = 1e-6 * 100.0 / (0.1 * 3.0) - 0.5 * onset;
        assert!((history - onset - softening).abs() < 1e-10);
    }

    #[test]
    fn gnl_affine_stretch_is_dispatched_with_nominal_reaction() {
        let request: NativeFemRequest =
            serde_json::from_str(include_str!("../examples/volume3d-gnl-affine-stretch.json"))
                .unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "volume3dGnl");
        let response = &result["result"];
        let strain = 0.5 * (1.05_f64.powi(2) - 1.0);
        let lambda = 200_000.0 * 0.3 / (1.3 * 0.4);
        let mu = 200_000.0 / (2.0 * 1.3);
        let nominal_stress = 1.05 * (lambda + 2.0 * mu) * strain;
        let right_reaction: f64 = (0..27)
            .filter(|&node| node % 3 == 2)
            .map(|node| response["nodalReactionsKn"][node][0].as_f64().unwrap())
            .sum();
        assert!((right_reaction - 1_000.0 * nominal_stress).abs() < 1e-4);
        assert!((response["nodalDisplacementsM"][13][0].as_f64().unwrap() - 0.025).abs() < 1e-10);
        assert!((response["elementGreenStrain"][0][0][0].as_f64().unwrap() - strain).abs() < 1e-10);
        assert!(
            (response["elementFirstPiolaMpa"][0][0][0].as_f64().unwrap() - nominal_stress).abs()
                < 1e-8
        );
        assert!(response["trueFreeResidualKn"].as_f64().unwrap() < 1e-5);
    }

    #[test]
    fn three_layer_postprocessor_is_available_through_the_shared_dispatch() {
        let fixture =
            serde_json::from_str(include_str!("../examples/three-layer-blaauwendraad.json"))
                .unwrap();
        let request: NativeFemRequest = serde_json::from_value(fixture).unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "threeLayer");
        assert_eq!(result["result"]["top"]["requiredAsXmm2PerM"], 1031.25);
        assert_eq!(
            result["result"]["top"]["reinforcementCase"],
            "both-directions"
        );
        assert_eq!(result["result"]["status"], "partial_check_passes");
    }

    #[test]
    fn three_layer_batch_uses_external_solver_points_in_one_dispatch() {
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "threeLayerBatch",
            "input": {
                "configuration": {
                    "thicknessMm":300,"topSkinMm":100,"bottomSkinMm":100,
                    "topReinforcement":{"asX":500,"asY":500},
                    "bottomReinforcement":{"asX":500,"asY":500},
                    "fcdMpa":20,"fydMpa":400,"nuPrime":0.8,
                    "compressionModel":"blaauwendraad2021"
                },
                "samples": [
                    {"id":"q1-g1","positionM":[0.25,0.25],"forces":{"nx":100,"ny":0,"nxy":0,"mx":0,"my":0,"mxy":0,"vx":0,"vy":0}},
                    {"id":"q1-g2","positionM":[0.75,0.75],"forces":{"nx":200,"ny":0,"nxy":0,"mx":0,"my":0,"mxy":0,"vx":0,"vy":0}}
                ]
            }
        })).unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "threeLayerBatch");
        assert_eq!(result["result"]["checkedPoints"], 2);
        assert_eq!(
            result["result"]["results"][0]["result"]["top"]["requiredAsXmm2PerM"],
            125.0
        );
        assert_eq!(
            result["result"]["results"][1]["result"]["top"]["requiredAsXmm2PerM"],
            250.0
        );
    }

    #[test]
    fn bonded_prestress_crack_width_is_available_through_shared_dispatch() {
        let fixture = serde_json::from_str(include_str!(
            "../examples/ec2-bonded-prestress-crack-width.json"
        ))
        .unwrap();
        let request: NativeFemRequest = serde_json::from_value(fixture).unwrap();
        let result = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(result["kind"], "crackWidth");
        assert_eq!(result["result"]["effectiveConcreteAreaMm2"], 45_000.0);
        assert!(result["result"]["crackWidthMm"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn rectangular_quad_mesh_is_dispatched_without_truncating_edges() {
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "quadMesh",
            "input": { "originX": 0, "originY": 0, "widthM": 2.1, "heightM": 1.5,
                "maxCellSizeM": 1, "materialId": 1, "thicknessM": 0.2 }
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "quadMesh");
        assert_eq!(value["result"]["quads"].as_array().unwrap().len(), 6);
        assert_eq!(value["result"]["nodes"][11]["x"], 2.1);
        assert_eq!(value["result"]["nodes"][11]["y"], 1.5);
    }

    #[test]
    fn mixed_cst_q4_patch_is_available_through_typed_dispatch() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../examples/mixed-cst-q4-patch.json")).unwrap();
        let request: NativeFemRequest = serde_json::from_value(fixture).unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "mixed2d");
        assert_eq!(value["result"]["triangles"].as_array().unwrap().len(), 2);
        assert_eq!(value["result"]["quads"].as_array().unwrap().len(), 1);
        assert!((value["result"]["nodes"][5]["uxM"].as_f64().unwrap() - 0.002).abs() < 1e-10);
    }

    #[test]
    fn perforated_quad_mesh_is_dispatched_with_opening_geometry() {
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "quadMesh",
            "input": { "originX": 0, "originY": 0, "widthM": 2, "heightM": 2,
                "maxCellSizeM": 0.25, "materialId": 1, "thicknessM": 0.2,
                "openings": [{ "xM": 0.75, "yM": 0.75, "widthM": 0.5, "heightM": 0.5 }] }
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "quadMesh");
        assert_eq!(value["result"]["nodes"].as_array().unwrap().len(), 80);
        assert_eq!(value["result"]["quads"].as_array().unwrap().len(), 60);
    }

    #[test]
    fn geometric_shell_dispatches_coupled_membrane_and_hybrid_bending() {
        let input: serde_json::Value =
            serde_json::from_str(include_str!("../examples/geometric-shell-uniaxial.json"))
                .unwrap();
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "geometricShell",
            "input": input,
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "geometricShell");
        assert!(
            (value["result"]["nodes"][1]["uM"].as_f64().unwrap() - 1.6666665278e-6).abs() < 1e-10
        );
        assert_eq!(value["result"]["elements"][0]["quadId"], 1);
    }

    #[test]
    fn orthotropic_dkt_secant_e_load_path_runs_through_shared_dispatch() {
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "plateBending",
            "input": {
                "nodes": [
                    {"id":1,"x":0.0,"y":0.0}, {"id":2,"x":1.0,"y":0.0},
                    {"id":3,"x":1.0,"y":1.0}, {"id":4,"x":0.0,"y":1.0},
                    {"id":5,"x":0.5,"y":0.5}
                ],
                "materials": [{"id":1,"eMpa":1000.0,"nu":0.2}],
                "orthotropicMaterials": [{"materialId":1,"e1Mpa":1000.0,"e2Mpa":500.0,
                    "nu12":0.2,"g12Mpa":200.0,"angleRad":0.4}],
                "modulusCurves": [{"materialId":1,"points":[
                    {"strain":0.0,"eMpa":1000.0},{"strain":1e-12,"eMpa":500.0}
                ]}],
                "loadPath": [1.0,0.0,1.0],
                "triangles": [
                    {"id":1,"nodeIds":[1,2,5],"materialId":1,"thicknessM":0.1},
                    {"id":2,"nodeIds":[2,3,5],"materialId":1,"thicknessM":0.1},
                    {"id":3,"nodeIds":[3,4,5],"materialId":1,"thicknessM":0.1},
                    {"id":4,"nodeIds":[4,1,5],"materialId":1,"thicknessM":0.1}
                ],
                "supports": [
                    {"nodeId":1,"w":true,"thetaX":false,"thetaY":false},
                    {"nodeId":2,"w":true,"thetaX":false,"thetaY":false},
                    {"nodeId":3,"w":true,"thetaX":false,"thetaY":false},
                    {"nodeId":4,"w":true,"thetaX":false,"thetaY":false}
                ],
                "loads": [{"nodeId":5,"fz":-1.0,"mx":0.0,"my":0.0}]
            }
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "plateBending");
        assert_eq!(value["result"]["elements"].as_array().unwrap().len(), 4);
        for element in value["result"]["elements"].as_array().unwrap() {
            assert!((element["effectiveEMpa"].as_f64().unwrap() - 500.0).abs() < 1e-8);
            assert!(element["maxFibreStrain"].as_f64().unwrap() > 1e-12);
        }
    }

    #[test]
    fn plane_frame_example_is_dispatched_with_typed_output() {
        let input: serde_json::Value =
            serde_json::from_str(include_str!("../examples/frame2d-cantilever.json")).unwrap();
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "frame2d", "input": input
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "frame2d");
        assert_eq!(value["result"]["members"][0]["memberId"], 1);
        assert_eq!(value["result"]["nodes"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn conforming_frame_and_membrane_share_one_typed_dispatch() {
        let request: NativeFemRequest = serde_json::from_value(serde_json::json!({
            "kind": "frame2d",
            "input": {
                "analysis": "linear",
                "nodes": [
                    {"id": 1, "x": 0.0, "y": 0.0},
                    {"id": 2, "x": 3.0, "y": 0.0},
                    {"id": 3, "x": 3.0, "y": 2.0}
                ],
                "materials": [{"id": 1, "eMpa": 210000.0}],
                "sections": [{"id": 1, "areaM2": 0.01, "inertiaM4": 0.000008}],
                "members": [{"id": 1, "startNodeId": 1, "endNodeId": 2,
                    "materialId": 1, "sectionId": 1, "releases": {}, "springs": {}}],
                "supports": [
                    {"nodeId": 1, "ux": true, "uy": true, "rz": true},
                    {"nodeId": 2, "ux": false, "uy": true, "rz": true}
                ],
                "nodalLoads": [{"nodeId": 3, "fx": 10.0, "fy": 0.0, "mz": 0.0}],
                "membrane": {
                    "materials": [{"id": 2, "eMpa": 30000.0, "nu": 0.2}],
                    "triangles": [{"id": 20, "nodeIds": [1, 2, 3], "materialId": 2,
                        "thicknessM": 0.2}]
                }
            }
        }))
        .unwrap();
        let value = serde_json::to_value(solve_native_fem(request).unwrap()).unwrap();
        assert_eq!(value["kind"], "frame2d");
        assert_eq!(
            value["result"]["membraneTriangles"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(value["result"]["equilibriumResidual"].as_f64().unwrap() < 1e-8);
    }

    #[test]
    fn unknown_kind_or_payload_field_is_rejected() {
        assert!(
            serde_json::from_value::<NativeFemRequest>(serde_json::json!({
                "kind":"unknown", "input":{}
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<NativeFemRequest>(serde_json::json!({
                "kind":"squareMesh", "input":{"originX":0,"originY":0,"widthM":1,
                    "heightM":1,"cellSizeM":1,"materialId":1,"thicknessM":0.1,"extra":1}
            }))
            .is_err()
        );
    }
}
