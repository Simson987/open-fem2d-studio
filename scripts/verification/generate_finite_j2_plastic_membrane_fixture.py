"""Add one plastic Tri3 membrane to the coupled Tet4/truss force-path project.

The remaining seven membranes stay elastic. This checks that mixed membrane
laws share the same free displacement DOFs without mixing material histories.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "docs/verificatie/3d-volume"
SOURCE = CASES / "tet4-eindige-rek-j2-plastische-trekstaaf-membraan.ifcfem2d"
TARGET = CASES / "tet4-eindige-rek-j2-plastische-trekstaaf-en-membraan.ifcfem2d"


def main() -> None:
    project = json.loads(SOURCE.read_text(encoding="utf-8"))
    model = project["model3d"]
    assert len(model["volumes"]) == 48 and len(model["plates"]) == 8
    assert all(plate["membraneOnly"] for plate in model["plates"])
    model["plates"][0]["nonlinearLaw"] = {
        "kind": "steelBilinear",
        "yieldMpa": 20.0,
        "hardeningRatio": 0.01,
    }
    project["projectInfo"] = {
        "name": "Eindige-rek J2 met plastische trekstaaf en Tri3-membraan",
        "projectNumber": "VF-3D-FIN-J2-PLASTIC-MEMBRANE-01",
    }
    project["loadCases"][0]["name"] = "Plastische Tet4 + trekstaaf + Tri3: piek en ontlasten"
    TARGET.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
