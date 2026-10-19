"""Generate small and large shared-node Hex8/3D-frame acceptance projects."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "docs/verificatie/3d-volume/tet4-hex8-raamwerk.ifcfem2d"
OUTPUT = ROOT / "docs/verificatie/3d-volume"


def build(cells: int, slab_layers: int, stories: int, name: str) -> None:
    project = json.loads(TEMPLATE.read_text())
    model = project["model3d"]
    stride = cells + 1
    nodes = []

    def node_id(x: int, y: int, level: int) -> int:
        return 1 + (level * stride + y) * stride + x

    for level in range(slab_layers + stories + 1):
        z = 0.3 * level / slab_layers if level <= slab_layers else 0.3 + 3.0 * (level - slab_layers)
        for y in range(stride):
            for x in range(stride):
                nodes.append({"id": node_id(x, y, level), "x": float(x), "y": float(y), "z": z})
    # The slab needs every grid node through its thickness. Above it, all
    # grid nodes are frame joints, so the same IDs are reused at each floor.
    model["nodes"] = nodes
    volumes = []
    for level in range(slab_layers):
        for y in range(cells):
            for x in range(cells):
                volumes.append({
                    "id": len(volumes) + 1, "kind": "hex8",
                    "nodeIds": [
                        node_id(x, y, level), node_id(x + 1, y, level),
                        node_id(x + 1, y + 1, level), node_id(x, y + 1, level),
                        node_id(x, y, level + 1), node_id(x + 1, y, level + 1),
                        node_id(x + 1, y + 1, level + 1), node_id(x, y + 1, level + 1),
                    ],
                    "eMpa": 30_000.0, "poisson": 0.2, "densityKgPerM3": 2_500.0,
                })
    model["volumes"] = volumes
    beams = []

    def beam(a: int, b: int) -> None:
        beams.append({"id": len(beams) + 1, "startNodeId": a, "endNodeId": b,
                      "profileName": "HEA 200", "material": "S235"})

    for level in range(slab_layers, slab_layers + stories):
        for y in range(stride):
            for x in range(stride):
                beam(node_id(x, y, level), node_id(x, y, level + 1))
    for level in range(slab_layers + 1, slab_layers + stories + 1):
        for y in range(stride):
            for x in range(cells):
                beam(node_id(x, y, level), node_id(x + 1, y, level))
        for y in range(cells):
            for x in range(stride):
                beam(node_id(x, y, level), node_id(x, y + 1, level))
    model["beams"] = beams
    model["supports"] = [
        {"nodeId": node_id(x, y, 0), "ux": True, "uy": True, "uz": True,
         "rx": False, "ry": False, "rz": False}
        for y in range(stride) for x in range(stride)
    ]
    model["loads"] = [
        {"id": 1 + y * stride + x, "nodeId": node_id(x, y, slab_layers + stories),
         "fx": 0.1, "fy": 0.0, "fz": -1.0, "mx": 0.0, "my": 0.0, "mz": 0.0,
         "caseId": 1}
        for y in range(stride) for x in range(stride)
    ]
    for key in ("plates", "memberLoads", "memberPointLoads", "thermalLoads", "volumeBodyLoads",
                "volumeFaceLoads", "surfaceLoads", "plateEdgeLoads"):
        model[key] = []
    model["volumeBackend"] = "matrixFreePcg"
    model["volumeThreads"] = 4
    project["loadCases"] = [{"id": 1, "name": "Daklast: verticaal en X", "type": "live"}]
    project["activeLoadCaseId"] = 1
    project["combinations"] = []
    project["selfWeightEnabled"] = False
    project["nonlinearEnabled"] = False
    project["analysetype"] = "eersteOrde"
    project["projectInfo"] = {"name": f"Hex8-fundering met {len(beams)} ruimtelijke staven",
                              "projectNumber": f"VF-HEX-FRAME-{cells}"}
    target = OUTPUT / name
    target.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{target}: {len(nodes)} nodes, {len(volumes)} Hex8, {len(beams)} frames")


if __name__ == "__main__":
    build(2, 1, 2, "hex8-raamwerk-koppeling-klein.ifcfem2d")
    build(12, 3, 3, "hex8-raamwerk-koppeling-groot.ifcfem2d")
