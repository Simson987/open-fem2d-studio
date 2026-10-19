"""Extend the saved 55k solid/frame app project with conforming top Tri3 membranes.

Run from the repository root. The original project remains untouched.
The top face of each upper Hex8 is split into two triangles using the same
existing node IDs, so all membrane translation DOFs are shared with the solids.
"""

import copy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "docs/verificatie/3d-volume"
SOURCE = EXAMPLES / "groot-gemengd-55232-volumes.ifcfem2d"
OUTPUT = EXAMPLES / "groot-gemengd-55232-volumes-768-membranen.ifcfem2d"


def main() -> None:
    project = copy.deepcopy(json.loads(SOURCE.read_text()))
    model = project["model3d"]
    nodes = {node["id"]: node for node in model["nodes"]}
    top_hexes = [
        volume for volume in model["volumes"]
        if volume["kind"] == "hex8"
        and all(nodes[node_id]["z"] > 0.98 for node_id in volume["nodeIds"][4:8])
    ]
    if len(top_hexes) != 384:
        raise ValueError(f"expected 384 upper Hex8 faces, got {len(top_hexes)}")
    plates = []
    surface_loads = []
    for volume in top_hexes:
        top = volume["nodeIds"][4:8]
        for corners in ([top[0], top[1], top[2]], [top[0], top[2], top[3]]):
            plate_id = len(plates) + 1
            plates.append({
                "id": plate_id,
                "nodeIds": corners,
                "thicknessM": 0.08,
                "membraneOnly": True,
                "membraneEMpa": 30000,
                "membranePoisson": 0.2,
                "material": "C30/37",
            })
            surface_loads.append({
                "id": plate_id,
                "plateId": plate_id,
                "caseId": 2,
                "qx": 20,
                "qy": 0,
                "qz": 0,
            })
    model["plates"] = plates
    model["surfaceLoads"] = surface_loads
    project["loadCases"] = [
        *project["loadCases"],
        {"id": 2, "name": "Bovenvlaktractie via 768 Tri3-membranen", "type": "live"},
    ]
    project["activeLoadCaseId"] = 2
    project["projectInfo"]["name"] = "Groot volume-raamwerk met bovenmembranen"
    project["projectInfo"]["projectNumber"] = "VF-3D-MIXED-55232-M768"
    OUTPUT.write_text(json.dumps(project, separators=(",", ":")) + "\n")
    print(f"{OUTPUT}: {len(model['volumes'])} volumes, {len(plates)} Tri3, {len(model['beams'])} frame")


if __name__ == "__main__":
    main()
