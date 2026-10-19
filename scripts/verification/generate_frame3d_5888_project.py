"""Generate a connected eight-storey, 5,888-member bending frame project."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-raamwerk/groot-vierlaags-raam.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-raamwerk/raamwerk-5888-staven-acht-bouwlagen.ifcfem2d"
GRID = 16
STORIES = 8
BAY_M = 4.0
STORY_M = 3.0


def node_id(x: int, y: int, level: int) -> int:
    return 1 + level * GRID * GRID + y * GRID + x


def main() -> None:
    project = json.loads(SOURCE.read_text())
    model = project["model3d"]
    model["nodes"] = [
        {"id": node_id(x, y, level), "x": x * BAY_M, "y": y * BAY_M, "z": level * STORY_M}
        for level in range(STORIES + 1) for y in range(GRID) for x in range(GRID)
    ]
    beams = []

    def add_beam(start: int, end: int) -> None:
        beams.append({"id": len(beams) + 1, "startNodeId": start, "endNodeId": end,
                      "profileName": "HEA 200", "material": "S235"})

    for level in range(STORIES):
        for y in range(GRID):
            for x in range(GRID):
                add_beam(node_id(x, y, level), node_id(x, y, level + 1))
    for level in range(1, STORIES + 1):
        for y in range(GRID):
            for x in range(GRID - 1):
                add_beam(node_id(x, y, level), node_id(x + 1, y, level))
        for y in range(GRID - 1):
            for x in range(GRID):
                add_beam(node_id(x, y, level), node_id(x, y + 1, level))
    model["beams"] = beams
    model["supports"] = [
        {"nodeId": node_id(x, y, 0), "ux": True, "uy": True, "uz": True,
         "rx": True, "ry": True, "rz": True}
        for y in range(GRID) for x in range(GRID)
    ]
    model["loads"] = [
        {"id": 1 + y * GRID + x, "nodeId": node_id(x, y, STORIES),
         "fx": 0.25, "fy": 0.0, "fz": -2.5, "mx": 0.0, "my": 0.0, "mz": 0.0,
         "caseId": 1}
        for y in range(GRID) for x in range(GRID)
    ]
    model["memberLoads"] = []
    model["memberPointLoads"] = []
    project["loadCases"] = [{"id": 1, "name": "Dak: 640 kN verticaal + 64 kN horizontaal", "type": "live"}]
    project["activeLoadCaseId"] = 1
    project["selfWeightEnabled"] = False
    project["nonlinearEnabled"] = True
    project["analysetype"] = "tweedeOrdeGeometrisch"
    project["projectInfo"] = {"name": "Achtlaags verbonden 3D-staalraam met 5.888 staven",
                              "projectNumber": "VF-3D-FRAME-5888"}
    assert len(model["nodes"]) == 2304 and len(beams) == 5888
    TARGET.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{TARGET}: {len(model['nodes'])} nodes, {len(beams)} bending members, "
          f"{len(model['supports'])} fixed supports, {len(model['loads'])} roof loads")


if __name__ == "__main__":
    main()
