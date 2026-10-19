"""Derive a saved 3,072-Tet4 project with a plastic shared-node truss.

The source project keeps its two-step absolute load path, boundary conditions,
and 4-thread matrix-free backend. Only the axial member's constitutive law
and project label change, making the plastic response directly comparable to
the existing elastic truss fixture.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CASES = ROOT / "docs/verificatie/3d-volume"
SOURCE = CASES / "tet4-eindige-rek-j2-3072-volumes-trekstaaf.ifcfem2d"
TARGET = CASES / "tet4-eindige-rek-j2-3072-volumes-plastische-trekstaaf.ifcfem2d"


def main() -> None:
    project = json.loads(SOURCE.read_text(encoding="utf-8"))
    model = project["model3d"]
    assert len(model["volumes"]) == 3072
    assert len(model["beams"]) == 1 and model["beams"][0]["axialOnly"] is True
    model["beams"][0]["nonlinearLaw"] = {
        "kind": "steelBilinear",
        "yieldMpa": 100.0,
        "hardeningRatio": 0.01,
    }
    project["projectInfo"] = {
        "name": "3072 Tet4 J2 met plastische eindige-rek trekstaaf",
        "projectNumber": "VF-3D-FIN-J2-PLASTIC-TRUSS-3072",
    }
    TARGET.write_text(json.dumps(project, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
