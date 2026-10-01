//! One typed protocol for all independent Rust FEM kernels. The desktop,
//! development browser and MCP transports call this same function.

use serde::{Deserialize, Serialize};

use crate::{frame2d, frame3d, hybrid_plate, plate2d, plate_bending, prestressed_beam, quad2d};

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", content = "input", rename_all = "camelCase")]
pub enum NativeFemRequest {
    Frame2d(frame2d::Request),
    Frame3d(frame3d::Request),
    Plate2d(plate2d::Request),
    PlateBending(plate_bending::Request),
    Quad2d(quad2d::Request),
    HybridPlate(hybrid_plate::Request),
    SquareMesh(quad2d::SquareGrid),
    PrestressedBeam(prestressed_beam::Request),
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", content = "result", rename_all = "camelCase")]
pub enum NativeFemResult {
    Frame2d(frame2d::Result2D),
    Frame3d(frame3d::Result3D),
    Plate2d(plate2d::Result2D),
    PlateBending(plate_bending::ResultBending),
    Quad2d(quad2d::Result2D),
    HybridPlate(hybrid_plate::ResultBending),
    SquareMesh(quad2d::SquareMesh),
    PrestressedBeam(prestressed_beam::ResultBeam),
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
        NativeFemRequest::HybridPlate(input) => {
            NativeFemResult::HybridPlate(hybrid_plate::solve(&input)?)
        }
        NativeFemRequest::SquareMesh(input) => {
            NativeFemResult::SquareMesh(quad2d::mesh_squares(&input)?)
        }
        NativeFemRequest::PrestressedBeam(input) => {
            NativeFemResult::PrestressedBeam(prestressed_beam::solve(&input)?)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
