"""Generate the saved 48-Tet4 force/unload acceptance model for the app."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-trekstaaf-membraan.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-kracht-ontlasten-membraan.ifcfem2d"

project = json.loads(SOURCE.read_text(encoding="utf-8"))
model = project["model3d"]
assert len(model["nodes"]) == 27 and len(model["volumes"]) == 48
assert len(model["beams"]) == 1 and model["beams"][0]["startNodeId"] == 114
assert model["beams"][0]["endNodeId"] == 115

def node(i: int, j: int, k: int) -> int:
    return 101 + (k * 3 + j) * 3 + i

assert model["nodes"][node(1, 1, 1) - 101] == {"id": 114, "x": 0.5, "y": 0.5, "z": 0.5}
model["supports"] = [{
    "nodeId": entry["id"],
    "ux": True, "uy": True, "uz": True,
    "rx": False, "ry": False, "rz": False,
} for entry in model["nodes"] if any(entry[axis] in (0, 1) for axis in ("x", "y", "z"))]
assert len(model["supports"]) == 26
model["loads"] = [{
    "id": 3001, "nodeId": node(1, 1, 1),
    "fx": 500_000, "fy": -250_000, "fz": 150_000,
    "mx": 0, "my": 0, "mz": 0, "caseId": 1,
}]
model["beams"][0]["profileName"] = "100x20"  # A = 0.002 m²
model["plates"] = []
for j in range(2):
    for i in range(2):
        a, b = node(i, j, 1), node(i + 1, j, 1)
        c, d = node(i, j + 1, 1), node(i + 1, j + 1, 1)
        for tri in ([a, b, d], [a, d, c]):
            model["plates"].append({
                "id": 5001 + len(model["plates"]),
                "nodeIds": tri,
                "thicknessM": 0.02,
                "membraneOnly": True,
                "membraneEMpa": 70_000.0,
                "membranePoisson": 0.25,
            })
model["materialLoadPath"] = [1, 0]
model["volumeBackend"] = "automatic"
model["volumeThreads"] = 4
project["loadCases"][0]["name"] = "Eindige-rek J2: knoopkracht en volledige ontlasting"
TARGET.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(TARGET)
