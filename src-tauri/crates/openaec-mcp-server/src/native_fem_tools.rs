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
        "description": "Experimental independent Rust FEM solver. Select frame3d, plate2d (CST membrane), plateBending (DKT), quad2d (Q4 membrane), hybridPlate (Q4 Kirchhoff bending), squareMesh or prestressedBeam. Units: m, kN, MPa. The model is validated by the selected Rust kernel; unsupported loads and conditions are errors. Not a certified design analysis.",
        "inputSchema": {
            "type": "object", "additionalProperties": false,
            "required": ["inputs"],
            "properties": {
                "inputs": {
                    "type": "object", "additionalProperties": false,
                    "required": ["kind", "input"],
                    "properties": {
                        "kind": { "type": "string", "enum": [
                            "frame3d", "plate2d", "plateBending", "quad2d",
                            "hybridPlate", "squareMesh", "prestressedBeam"
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
}
