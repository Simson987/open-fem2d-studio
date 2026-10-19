"""Add a shared-node Tri3 reinforcement membrane to the saved Tet4+truss coupon."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-met-trekstaaf.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-trekstaaf-membraan.ifcfem2d"

project = json.loads(SOURCE.read_text(encoding="utf-8"))
model = project["model3d"]
assert len(model["volumes"]) == 48 and len(model["beams"]) == 1
assert not model["plates"]
assert {101, 102, 114}.issubset(set(model["volumes"][0]["nodeIds"]))
model["plates"] = [{
    "id": 5001,
    "nodeIds": [101, 102, 114],
    "thicknessM": 0.02,
    "membraneOnly": True,
    "membraneEMpa": 70_000.0,
    "membranePoisson": 0.25,
}]
TARGET.write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(TARGET)
