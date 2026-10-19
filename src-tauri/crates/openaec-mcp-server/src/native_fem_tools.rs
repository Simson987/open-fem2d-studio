//! Experimental independent Rust FEM kernels through the same typed dispatcher
//! as the desktop command and development-browser bridge.

use openaec_native_fem::dispatch::NativeFemRequest;
use serde_json::{json, Value};

use super::RpcError;

const TOOL: &str = "solve_native_fem";

pub(super) fn is_native_fem_tool(name: &str) -> bool {
    name == TOOL
}

pub(super) fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": TOOL,
        "description": "Experimental independent Rust FEM solver. Select frame2d, frame3d, plate2d (CST membrane), quad2d (Q4 membrane), mixed2d (coupled CST/Q4), plateBending (DKT), quadMesh, hybridPlate, hybridPlateLayered (elastic layered bending with local N=0), geometricShell, volume3d (linear Tet4 with nodal/body/face loads), volume3dJ2 (bounded small-strain J2 steel Tet4 Newton load path), volume3dConcreteDamage (bounded tensile-damage Tet4 with explicit crack-band width), volume3dGnl (bounded total-Lagrangian St Venant–Kirchhoff Tet4), volumeHex8 (linear Hex8 with Gauss stresses and distributed loads), squareMesh, prestressedBeam, crackWidth, threeLayer, or threeLayerBatch. General FEM units are m, kN, MPa; threeLayer and crackWidth geometry/areas use mm and mm². The model is validated by the selected Rust kernel; unsupported loads and conditions are errors. Not a certified design analysis.",
        "inputSchema": {
            "type": "object", "additionalProperties": false,
            "required": ["inputs"],
            "properties": {
                "inputs": {
                    "type": "object", "additionalProperties": false,
                    "required": ["kind", "input"],
                    "properties": {
                        "kind": { "type": "string", "enum": [
                            "frame2d", "frame3d", "plate2d", "plateBending", "quad2d", "mixed2d",
                            "hybridPlate", "hybridPlateLayered", "geometricShell", "squareMesh", "quadMesh", "prestressedBeam",
                            "crackWidth", "threeLayer", "threeLayerBatch", "volume3d", "volume3dJ2", "volume3dConcreteDamage", "volume3dGnl", "volumeHex8"
                        ]},
                        "input": { "type": "object", "description": "Typed model for the selected native-fem kernel; see native-fem/README.md for the per-kernel contract." }
                    }
                }
            }
        }
    })]
}

pub(super) async fn dispatch(_name: &str, args: Value) -> Result<Value, RpcError> {
    let inputs = args
        .get("inputs")
        .cloned()
        .ok_or_else(|| RpcError::invalid_params("missing 'inputs'"))?;
    let request: NativeFemRequest = serde_json::from_value(inputs)
        .map_err(|e| RpcError::invalid_params(format!("native FEM input: {e}")))?;
    let result = tokio::task::spawn_blocking(move || {
        openaec_native_fem::dispatch::solve_native_fem(request)
    })
    .await
    .map_err(|e| RpcError::tool_exec(format!("join error: {e}")))?
    .map_err(RpcError::tool_exec)?;
    serde_json::to_value(result).map_err(|e| RpcError::tool_exec(format!("serialize result: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn square_mesh_tool_returns_the_shared_result() {
        let answer = dispatch(
            TOOL,
            json!({"inputs": {
                "kind":"squareMesh", "input": {
                    "originX":0, "originY":0, "widthM":2, "heightM":2,
                    "cellSizeM":1, "materialId":1, "thicknessM":0.1
                }
            }}),
        )
        .await
        .unwrap();
        assert_eq!(answer["kind"], "squareMesh");
        assert_eq!(answer["result"]["nodes"].as_array().unwrap().len(), 9);
    }

    #[tokio::test]
    async fn mixed_cst_q4_tool_runs_the_shared_patch_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/mixed-cst-q4-patch.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs": fixture})).await.unwrap();
        assert_eq!(answer["kind"], "mixed2d");
        assert_eq!(answer["result"]["triangles"].as_array().unwrap().len(), 2);
        assert_eq!(answer["result"]["quads"].as_array().unwrap().len(), 1);
        assert!((answer["result"]["nodes"][5]["uxM"].as_f64().unwrap() - 0.002).abs() < 1e-10);
    }

    #[tokio::test]
    async fn loaded_volume3d_tool_runs_the_shared_tet4_kernel() {
        let input: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/volume3d-loaded-tet.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs":{"kind":"volume3d","input":input}}))
            .await
            .unwrap();
        assert_eq!(answer["kind"], "volume3d");
        assert!(
            (answer["result"]["nodalDisplacementsM"][1][0]
                .as_f64()
                .unwrap()
                - 3e-8)
                .abs()
                < 1e-18
        );
        assert_eq!(answer["result"]["solverUsed"], "matrixFree");
    }

    #[tokio::test]
    async fn j2_steel_coupon_runs_through_the_shared_dispatcher() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/volume3d-j2-steel-coupon.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs": fixture})).await.unwrap();
        assert_eq!(answer["kind"], "volume3dJ2");
        assert!(
            answer["result"]["elementStates"][0]["equivalentPlasticStrain"]
                .as_f64()
                .unwrap()
                > 0.0
        );
    }

    #[tokio::test]
    async fn concrete_damage_coupon_runs_through_the_shared_dispatcher() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/volume3d-concrete-damage-coupon.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs": fixture})).await.unwrap();
        assert_eq!(answer["kind"], "volume3dConcreteDamage");
        let history = answer["result"]["elementStates"][0]["maxEquivalentStrain"]
            .as_f64()
            .unwrap();
        assert!((history - 0.0003833333333333333).abs() < 1e-10);
        assert!(answer["result"]["trueFreeResidualKn"].as_f64().unwrap() < 1e-8);
    }

    #[tokio::test]
    async fn gnl_affine_patch_runs_through_the_shared_dispatcher() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/volume3d-gnl-affine-stretch.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs": fixture})).await.unwrap();
        assert_eq!(answer["kind"], "volume3dGnl");
        assert!(
            (answer["result"]["nodalDisplacementsM"][13][0]
                .as_f64()
                .unwrap()
                - 0.025)
                .abs()
                < 1e-10
        );
        assert!(answer["result"]["trueFreeResidualKn"].as_f64().unwrap() < 1e-5);
    }

    #[tokio::test]
    async fn loaded_hex8_tool_runs_the_shared_volume_kernel() {
        let input: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/volume-hex8-uniaxial.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs":{"kind":"volumeHex8","input":input}}))
            .await
            .unwrap();
        assert_eq!(answer["kind"], "volumeHex8");
        assert!(
            (answer["result"]["elementGaussStressMpa"][0][0][0]
                .as_f64()
                .unwrap()
                - 210.0)
                .abs()
                < 1e-6
        );
    }

    #[tokio::test]
    async fn crack_width_tool_runs_the_shared_prestressed_reference_fixture() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/ec2-bonded-prestress-crack-width.json"
        ))
        .unwrap();
        let answer = dispatch(TOOL, json!({"inputs": fixture})).await.unwrap();
        assert_eq!(answer["kind"], "crackWidth");
        assert_eq!(answer["result"]["crackWidthMm"], 0.098496);
        assert_eq!(answer["result"]["utilization"], 0.49248);
    }

    #[tokio::test]
    async fn crack_width_tool_rejects_neutral_axis_beyond_tension_steel() {
        let mut fixture: Value = serde_json::from_str(include_str!(
            "../../native-fem/examples/ec2-bonded-prestress-crack-width.json"
        ))
        .unwrap();
        fixture["input"]["neutralAxisMm"] = fixture["input"]["effectiveDepthMm"].clone();
        let error = dispatch(TOOL, json!({"inputs": fixture}))
            .await
            .unwrap_err();
        assert!(error.message.contains("vóór de trekstaal"));
    }

    #[test]
    fn schema_exposes_every_mesh_and_postprocessor_dispatch_kind() {
        let definition = &tool_definitions()[0];
        let kinds = definition["inputSchema"]["properties"]["inputs"]["properties"]["kind"]["enum"]
            .as_array()
            .unwrap();
        for kind in [
            "quadMesh",
            "mixed2d",
            "crackWidth",
            "threeLayerBatch",
            "volume3d",
            "volume3dJ2",
            "volume3dConcreteDamage",
            "volume3dGnl",
            "volumeHex8",
        ] {
            assert!(
                kinds.iter().any(|value| value == kind),
                "missing {kind} from tool schema"
            );
        }
    }
}
