//! MCP-gereedschap voor de ruimtelijke raamwerkkern.
//!
//! Dit is een dunne protocolschil rond `frame3d_solver::solve`. De desktop-app,
//! de ontwikkelbrowser en MCP rekenen daardoor met hetzelfde versievaste
//! contract en dezelfde Dedaliano/Stabileo-revisie.

use serde_json::{json, Value};

use super::RpcError;

const TOOL: &str = "solve_frame3d";

pub(super) fn is_frame3d_tool(name: &str) -> bool {
    name == TOOL
}

fn vector_schema() -> Value {
    json!({ "type": "number", "description": "Eindig getal." })
}

/// Strikt schema voor het neutrale Open FEM 3D-contract.
pub(super) fn tool_definitions() -> Vec<Value> {
    vec![json!({
        "name": TOOL,
        "description": "Analyseer een ruimtelijk 3D-raamwerk met de vastgezette Dedaliano/Stabileo-kern. Standaard wordt directe tweede orde (P-Delta) gerekend; het resultaat bevat knoopverplaatsingen, oplegreacties, zes snedekrachten per staaf, convergentie en eigenwaarde-knikfactoren. Eenheden: m, kN, kNm en MPa.",
        "inputSchema": {
            "type": "object",
            "additionalProperties": false,
            "required": ["nodes", "materials", "sections", "members"],
            "properties": {
                "schemaVersion": { "type": "integer", "const": 1, "default": 1 },
                "analysis": { "type": "string", "enum": ["linear", "p-delta"], "default": "p-delta" },
                "nodes": {
                    "type": "array", "minItems": 2,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "x", "y", "z"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "x": vector_schema(), "y": vector_schema(), "z": vector_schema()
                        }
                    }
                },
                "materials": {
                    "type": "array", "minItems": 1,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "name", "eMpa", "nu"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "name": { "type": "string", "minLength": 1 },
                            "eMpa": { "type": "number", "exclusiveMinimum": 0 },
                            "nu": { "type": "number", "exclusiveMinimum": -1, "exclusiveMaximum": 0.5 },
                            "alphaPerK": { "type": ["number", "null"], "exclusiveMinimum": 0, "description": "Lineaire uitzettingscoëfficiënt in 1/K; standaard 12e-6." }
                        }
                    }
                },
                "sections": {
                    "type": "array", "minItems": 1,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "name", "areaM2", "iyM4", "izM4", "torsionJM4"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "name": { "type": "string", "minLength": 1 },
                            "areaM2": { "type": "number", "exclusiveMinimum": 0 },
                            "iyM4": { "type": "number", "exclusiveMinimum": 0 },
                            "izM4": { "type": "number", "exclusiveMinimum": 0 },
                            "torsionJM4": { "type": "number", "exclusiveMinimum": 0 },
                            "shearAreaYM2": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "shearAreaZM2": { "type": ["number", "null"], "exclusiveMinimum": 0 }
                        }
                    }
                },
                "members": {
                    "type": "array", "minItems": 1,
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "startNodeId", "endNodeId", "materialId", "sectionId"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "startNodeId": { "type": "integer", "minimum": 1 },
                            "endNodeId": { "type": "integer", "minimum": 1 },
                            "materialId": { "type": "integer", "minimum": 1 },
                            "sectionId": { "type": "integer", "minimum": 1 },
                            "rollAngleRad": { "type": ["number", "null"] },
                            "releases": {
                                "type": "object", "additionalProperties": false,
                                "properties": {
                                    "myStart": { "type": "boolean", "default": false },
                                    "myEnd": { "type": "boolean", "default": false },
                                    "mzStart": { "type": "boolean", "default": false },
                                    "mzEnd": { "type": "boolean", "default": false },
                                    "torsionStart": { "type": "boolean", "default": false },
                                    "torsionEnd": { "type": "boolean", "default": false }
                                }
                            }
                        }
                    }
                },
                "supports": {
                    "type": "array", "default": [],
                    "description": "Knoopopleggingen; true betekent geblokkeerd. Veren zijn kN/m of kNm/rad. Optionele opgelegde translaties zijn m en rotaties rad en vereisen een geblokkeerde DOF.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["nodeId", "ux", "uy", "uz", "rx", "ry", "rz"],
                        "properties": {
                            "nodeId": { "type": "integer", "minimum": 1 },
                            "ux": { "type": "boolean" }, "uy": { "type": "boolean" }, "uz": { "type": "boolean" },
                            "rx": { "type": "boolean" }, "ry": { "type": "boolean" }, "rz": { "type": "boolean" },
                            "kxKnPerM": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "kyKnPerM": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "kzKnPerM": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "krxKnmPerRad": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "kryKnmPerRad": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "krzKnmPerRad": { "type": ["number", "null"], "exclusiveMinimum": 0 },
                            "uxPrescribedM": { "type": ["number", "null"] },
                            "uyPrescribedM": { "type": ["number", "null"] },
                            "uzPrescribedM": { "type": ["number", "null"] },
                            "rxPrescribedRad": { "type": ["number", "null"] },
                            "ryPrescribedRad": { "type": ["number", "null"] },
                            "rzPrescribedRad": { "type": ["number", "null"] }
                        }
                    }
                },
                "nodalLoads": {
                    "type": "array", "default": [],
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "nodeId", "fx", "fy", "fz", "mx", "my", "mz"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "nodeId": { "type": "integer", "minimum": 1 },
                            "fx": vector_schema(), "fy": vector_schema(), "fz": vector_schema(),
                            "mx": vector_schema(), "my": vector_schema(), "mz": vector_schema()
                        }
                    }
                },
                "memberLoads": {
                    "type": "array", "default": [],
                    "description": "Trapezoidal member loads in local y/z axes. Intensities are kN/m; positions are metres from member start.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "memberId", "qyStartKnPerM", "qyEndKnPerM", "qzStartKnPerM", "qzEndKnPerM"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "memberId": { "type": "integer", "minimum": 1 },
                            "qyStartKnPerM": vector_schema(), "qyEndKnPerM": vector_schema(),
                            "qzStartKnPerM": vector_schema(), "qzEndKnPerM": vector_schema(),
                            "startPositionM": { "type": ["number", "null"], "minimum": 0 },
                            "endPositionM": { "type": ["number", "null"], "exclusiveMinimum": 0 }
                        }
                    }
                },
                "memberPointLoads": {
                    "type": "array", "default": [],
                    "description": "Concentrated member forces in local y/z axes. Forces are kN; position is metres from member start.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "memberId", "pyKn", "pzKn", "positionM"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "memberId": { "type": "integer", "minimum": 1 },
                            "pyKn": vector_schema(), "pzKn": vector_schema(),
                            "positionM": { "type": "number", "minimum": 0 }
                        }
                    }
                },
                "thermalLoads": {
                    "type": "array", "default": [],
                    "description": "Member temperature loads in K. Gradients are differences over the local y/z section dimensions.",
                    "items": {
                        "type": "object", "additionalProperties": false,
                        "required": ["id", "memberId", "deltaTUniformK"],
                        "properties": {
                            "id": { "type": "integer", "minimum": 1 },
                            "memberId": { "type": "integer", "minimum": 1 },
                            "deltaTUniformK": vector_schema(),
                            "deltaTGradientYK": { "type": "number", "default": 0 },
                            "deltaTGradientZK": { "type": "number", "default": 0 }
                        }
                    }
                },
                "maxIterations": { "type": "integer", "minimum": 1, "maximum": 1000, "default": 50 },
                "tolerance": { "type": "number", "exclusiveMinimum": 0, "default": 1e-8 },
                "bucklingModes": { "type": "integer", "minimum": 0, "maximum": 20, "default": 3 }
            }
        }
    })]
}

pub(super) async fn dispatch(name: &str, args: Value) -> Result<Value, RpcError> {
    if name != TOOL {
        return Err(RpcError::method_not_found(name));
    }
    let request: frame3d_solver::SolveRequest3D = serde_json::from_value(args)
        .map_err(|error| RpcError::invalid_params(format!("SolveRequest3D: {error}")))?;
    let result = tokio::task::spawn_blocking(move || frame3d_solver::solve(request))
        .await
        .map_err(|error| RpcError::tool_exec(format!("3D-kern kon niet worden afgerond: {error}")))?
        .map_err(RpcError::tool_exec)?;
    serde_json::to_value(result)
        .map_err(|error| RpcError::tool_exec(format!("3D-resultaat kon niet naar JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_biedt_staafpuntlast_met_lokale_componenten_en_positie() {
        let definition = &tool_definitions()[0];
        let point = &definition["inputSchema"]["properties"]["memberPointLoads"];
        assert_eq!(point["type"], "array");
        assert_eq!(point["items"]["additionalProperties"], false);
        assert_eq!(
            point["items"]["required"],
            json!(["id", "memberId", "pyKn", "pzKn", "positionM"])
        );
        let support = &definition["inputSchema"]["properties"]["supports"]["items"];
        assert_eq!(support["properties"]["kzKnPerM"]["exclusiveMinimum"], 0);
        assert_eq!(
            support["properties"]["kryKnmPerRad"]["type"],
            json!(["number", "null"])
        );
        assert_eq!(
            support["properties"]["uxPrescribedM"]["type"],
            json!(["number", "null"])
        );
        assert_eq!(
            support["properties"]["rzPrescribedRad"]["type"],
            json!(["number", "null"])
        );
        let thermal = &definition["inputSchema"]["properties"]["thermalLoads"]["items"];
        assert_eq!(thermal["additionalProperties"], false);
        assert_eq!(
            thermal["required"],
            json!(["id", "memberId", "deltaTUniformK"])
        );
        assert_eq!(
            definition["inputSchema"]["properties"]["materials"]["items"]["properties"]
                ["alphaPerK"]["exclusiveMinimum"],
            0
        );
    }
}
