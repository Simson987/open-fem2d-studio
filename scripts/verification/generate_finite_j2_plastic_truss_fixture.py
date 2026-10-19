"""Derive a saved ordinary 3D app project with plastic truss and Tet4 solids.

The source fixture's 48 Tet4, eight Tri3 membranes, supports and load/unload
targets are kept unchanged. Only the shared axial steel member gets a
bilinear law, so the result can be compared directly with the elastic member.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "docs/verificatie/3d-volume"
SOURCE = CASES / "tet4-eindige-rek-j2-kracht-ontlasten-membraan.ifcfem2d"
TARGET = CASES / "tet4-eindige-rek-j2-plastische-trekstaaf-membraan.ifcfem2d"


def main() -> None:
    project = json.loads(SOURCE.read_text(encoding="utf-8"))
    assert len(project["model3d"]["beams"]) == 1
    beam = project["model3d"]["beams"][0]
    assert beam["axialOnly"] is True
    beam["nonlinearLaw"] = {
        "kind": "steelBilinear",
        "yieldMpa": 235.0,
        "hardeningRatio": 0.01,
    }
    project["projectInfo"] = {
        "name": "Tet4 J2 met plastische trekstaaf en Tri3-membranen",
        "projectNumber": "VF-3D-FIN-J2-PLASTIC-TRUSS-01",
    }
    project["loadCases"][0]["name"] = "J2-volume + plastische trekstaaf: kracht en ontlasten"
    TARGET.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
