"""Make a saved app model with shared-node finite-J2 Hex8, Tet4, Tri3 and truss.

The source is the already verified 2x2x2 six-Tet-per-cube project. Four of
its eight cubes are replaced by one standard-order Hex8 each. The other cubes
retain their six Tet4 cells, so the same grid nodes are shared across families.
"""

from __future__ import annotations

import json
from collections import defaultdict
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-en-membraan.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-volume/gemengd-hex8-tet4-eindige-rek-j2-plastisch.ifcfem2d"


def main() -> None:
    project = deepcopy(json.loads(SOURCE.read_text()))
    model = project["model3d"]
    by_id = {node["id"]: node for node in model["nodes"]}
    by_xyz = {(node["x"], node["y"], node["z"]): node["id"] for node in model["nodes"]}
    groups = defaultdict(list)
    for tet in model["volumes"]:
        points = [by_id[node_id] for node_id in tet["nodeIds"]]
        lower = tuple(min(point[axis] for point in points) for axis in ("x", "y", "z"))
        groups[lower].append(tet)
    assert len(groups) == 8 and all(len(group) == 6 for group in groups.values())

    volumes = []
    hex_ids = []
    for index, (lower, group) in enumerate(sorted(groups.items())):
        if index % 2:
            volumes.extend(group)
            continue
        x, y, z = lower
        side = 0.5
        corners = [(x, y, z), (x + side, y, z), (x + side, y + side, z), (x, y + side, z),
                   (x, y, z + side), (x + side, y, z + side),
                   (x + side, y + side, z + side), (x, y + side, z + side)]
        hex_id = 7001 + index
        hex_ids.append(hex_id)
        volumes.append({"id": hex_id, "kind": "hex8", "nodeIds": [by_xyz[point] for point in corners],
                        "eMpa": 210000, "poisson": 0.3,
                        "materialLaw": {"kind": "steelJ2", "yieldMpa": 250, "hardeningMpa": 2000}})

    assert len(volumes) == 28 and len(hex_ids) == 4
    model["volumes"] = volumes
    model["volumeBodyLoads"] = [{"id": 9001, "volumeId": hex_ids[0], "caseId": 1,
                                 "forceKnPerM3": [0, 0, -0.1]}]
    project["projectInfo"]["name"] = "Gemengd Hex8/Tet4 J2 met plastische staaf en Tri3"
    project["projectInfo"]["projectNumber"] = "VF-3D-MIX-FIN-J2-01"
    project["loadCases"][0]["name"] = "Plastisch Hex8/Tet4 + trekstaaf + Tri3: piek en ontlasten"
    TARGET.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{TARGET}: 4 Hex8, 24 Tet4, 8 Tri3, 1 plastic truss; {len(model['nodes'])} nodes")


if __name__ == "__main__":
    main()
