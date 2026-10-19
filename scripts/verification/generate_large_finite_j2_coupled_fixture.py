#!/usr/bin/env python3
"""Add a center-to-boundary truss to the reproducible 3,072-Tet4 J2 coupon."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = ROOT / "docs/verificatie/3d-volume"
SOURCE = EXAMPLES / "tet4-eindige-rek-j2-3072-volumes.ifcfem2d"
TARGET = EXAMPLES / "tet4-eindige-rek-j2-3072-volumes-trekstaaf.ifcfem2d"

project = json.loads(SOURCE.read_text(encoding="utf-8"))
model = project["model3d"]
assert len(model["volumes"]) == 3072 and len(model["nodes"]) == 729
assert next(node for node in model["nodes"] if node["id"] == 465)["x"] == 0.5
assert next(node for node in model["nodes"] if node["id"] == 469)["x"] == 1.0
model["beams"] = [{
    "id": 4001,
    "startNodeId": 465,
    "endNodeId": 469,
    "profileName": "200x100",
    "material": "VRIJ:Teststaal E=210000 rho=7850 f=235",
    "axialOnly": True,
}]
project["projectInfo"]["name"] = "3072 Tet4 J2 met elastische eindige-rek trekstaaf"
project["projectInfo"]["projectNumber"] = "VF-3D-FIN-J2-TRUSS-3072"
TARGET.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(TARGET)
