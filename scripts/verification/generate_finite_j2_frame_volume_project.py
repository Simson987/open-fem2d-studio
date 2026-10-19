"""Derive a saved finite-J2 Tet4/Hex8 solid with a full bending frame."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-volume/tet4-hex8-raamwerk.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d"


def main() -> None:
    project = json.loads(SOURCE.read_text(encoding="utf-8"))
    model = project["model3d"]
    assert len(model["volumes"]) == 3 and len(model["beams"]) == 1
    assert not model["beams"][0].get("axialOnly", False)
    for volume in model["volumes"]:
        volume["materialLaw"] = {"kind": "steelJ2", "yieldMpa": 2.0, "hardeningMpa": 300.0}
    model["materialLoadPath"] = [0.5, 1.0]
    model["volumeMaterialKinematics"] = "finiteStrain"
    model["volumeBackend"] = "automatic"
    model["volumeThreads"] = 4
    project["analysetype"] = "tweedeOrdeFysisch"
    project["nonlinearEnabled"] = True
    project["selfWeightEnabled"] = False
    project["projectInfo"] = {
        "name": "Eindige-rek J2 Tet4/Hex8 met buigend 3D-raamwerk",
        "projectNumber": "VF-3D-J2-SOLID-FRAME",
    }
    TARGET.write_text(json.dumps(project, separators=(",", ":"), ensure_ascii=False) + "\n",
                      encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
