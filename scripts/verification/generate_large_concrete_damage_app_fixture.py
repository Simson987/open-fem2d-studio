#!/usr/bin/env python3
"""Derive a 3,072-Tet4 small-strain concrete damage/unloading app model."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes.ifcfem2d"
OUTPUT = ROOT / "docs/verificatie/3d-volume/tet4-betonschade-3072-volumes.ifcfem2d"


def main() -> None:
    project = json.loads(REFERENCE.read_text(encoding="utf-8"))
    model = project["model3d"]
    project["loadCases"][0]["name"] = "3.072 Tet4 · betontrekschade · piek en ontlasting"
    model["volumeBackend"] = "sparseGmres"
    model["volumeMaterialKinematics"] = "smallStrain"
    model["materialLoadPath"] = [2, 1]
    for support in model["supports"]:
        point = model["nodes"][support["nodeId"] - 101]
        support["prescribed"] = {
            "uxM": 0.0001 * point["x"],
            "uyM": -0.00002 * point["y"],
            "uzM": -0.00002 * point["z"],
        }
    boundary_ids = {support["nodeId"] for support in model["supports"]}
    for point in model["nodes"]:
        if point["id"] not in boundary_ids:
            # Constrain only the axial component to suppress localization.
            # The 343 interior nodes retain both free lateral components.
            model["supports"].append({
                "nodeId": point["id"],
                "ux": True, "uy": False, "uz": False,
                "rx": False, "ry": False, "rz": False,
                "prescribed": {"uxM": 0.0001 * point["x"]},
            })
    for volume in model["volumes"]:
        volume["eMpa"] = 30_000
        volume["poisson"] = 0.2
        volume["materialLaw"] = {
            "kind": "concreteTensionDamage",
            "tensileStrengthMpa": 3,
            "fractureEnergyNPerM": 1_000,
            "crackBandWidthM": 0.125,
        }
    OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n",
                      encoding="utf-8")
    print(f"{OUTPUT}: {len(model['nodes'])} nodes, {len(model['volumes'])} Tet4, "
          "686 free lateral DOF")


if __name__ == "__main__":
    main()
