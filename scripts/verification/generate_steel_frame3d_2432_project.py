"""Generate a connected, braced eight-storey steel frame for the 3D app.

All dimensions are metres and loads are kN. This is a solver verification
model, not a member design or a claim of structural code compliance.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-raamwerk/groot-vierlaags-raam.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-raamwerk/staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d"
NX, NY, STORIES = 12, 8, 8
BAY_X_M, BAY_Y_M, STOREY_M = 5.0, 5.0, 4.0


def node_id(x: int, y: int, level: int) -> int:
    return 1 + level * NX * NY + y * NX + x


def main() -> None:
    project = json.loads(SOURCE.read_text())
    model = project["model3d"]
    model["nodes"] = [
        {"id": node_id(x, y, level), "x": x * BAY_X_M,
         "y": y * BAY_Y_M, "z": level * STOREY_M}
        for level in range(STORIES + 1) for y in range(NY) for x in range(NX)
    ]
    beams = []

    def add_beam(start: int, end: int, profile: str) -> None:
        beams.append({"id": len(beams) + 1, "startNodeId": start,
                      "endNodeId": end, "profileName": profile, "material": "S235"})

    # Moment-resisting columns and beams share nodes across every storey.
    for level in range(STORIES):
        for y in range(NY):
            for x in range(NX):
                add_beam(node_id(x, y, level), node_id(x, y, level + 1), "HEA 240")
    for level in range(1, STORIES + 1):
        for y in range(NY):
            for x in range(NX - 1):
                add_beam(node_id(x, y, level), node_id(x + 1, y, level), "IPE 240")
        for y in range(NY - 1):
            for x in range(NX):
                add_beam(node_id(x, y, level), node_id(x, y + 1, level), "IPE 240")

    # Alternating façade diagonals exercise spatial bending and torsion.
    for level in range(STORIES):
        for y in (0, NY - 1):
            for x in range(NX - 1):
                left, right = (x, x + 1) if (x + level) % 2 == 0 else (x + 1, x)
                add_beam(node_id(left, y, level), node_id(right, y, level + 1), "HEA 200")
        for x in (0, NX - 1):
            for y in range(NY - 1):
                near, far = (y, y + 1) if (y + level) % 2 == 0 else (y + 1, y)
                add_beam(node_id(x, near, level), node_id(x, far, level + 1), "HEA 200")

    model["beams"] = beams
    model["supports"] = [
        {"nodeId": node_id(x, y, 0), "ux": True, "uy": True, "uz": True,
         "rx": True, "ry": True, "rz": True}
        for y in range(NY) for x in range(NX)
    ]
    model["loads"] = [
        {"id": 1 + (level - 1) * NX * NY + y * NX + x,
         "nodeId": node_id(x, y, level), "caseId": 1,
         "fx": 0.5 if x == NX - 1 else 0.0,
         "fy": 0.2 if y == NY - 1 else 0.0,
         "fz": -3.0, "mx": 0.0, "my": 0.0, "mz": 0.0}
        for level in range(1, STORIES + 1) for y in range(NY) for x in range(NX)
    ]
    model["memberLoads"] = []
    model["memberPointLoads"] = []
    project["loadCases"] = [{"id": 1, "name": "Vloerlasten + wind X/Y", "type": "live"}]
    project["activeLoadCaseId"] = 1
    project["selfWeightEnabled"] = False
    project["nonlinearEnabled"] = True
    project["analysetype"] = "tweedeOrdeGeometrisch"
    project["projectInfo"] = {
        "name": "Groot geschoord 3D-staalgebouw · 2.432 staven",
        "projectNumber": "VF-3D-STEEL-2432",
    }
    assert len(model["nodes"]) == 864 and len(beams) == 2432
    TARGET.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{TARGET}: {len(model['nodes'])} knopen, {len(beams)} staven, "
          f"{len(model['supports'])} opleggingen, {len(model['loads'])} knooplasten")


if __name__ == "__main__":
    main()
