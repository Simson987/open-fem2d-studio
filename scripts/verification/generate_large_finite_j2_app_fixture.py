#!/usr/bin/env python3
"""Generate a reproducible ordinary-app 3,072-Tet4 finite-J2 acceptance model.

All boundary nodes follow the affine peak/unload path. Interior nodes remain
free, so the native matrix-free Newton solve must recover the affine field.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-staal-j2-coupon.ifcfem2d"
OUTPUT = ROOT / "docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes.ifcfem2d"
DIVISIONS = 8


def node_id(i: int, j: int, k: int) -> int:
    return 101 + i + (DIVISIONS + 1) * (j + (DIVISIONS + 1) * k)


def main() -> None:
    project = json.loads(REFERENCE.read_text(encoding="utf-8"))
    model = project["model3d"]
    model["nodes"] = []
    model["volumes"] = []
    model["supports"] = []
    model["loads"] = []
    model["volumeBackend"] = "matrixFreeGmres"
    model["volumeThreads"] = 4
    project["loadCases"][0]["name"] = "3.072 Tet4 · eindige J2 · piek en ontlasting"

    for k in range(DIVISIONS + 1):
        for j in range(DIVISIONS + 1):
            for i in range(DIVISIONS + 1):
                x, y, z = i / DIVISIONS, j / DIVISIONS, k / DIVISIONS
                identifier = node_id(i, j, k)
                model["nodes"].append({"id": identifier, "x": x, "y": y, "z": z})
                if 0 in (i, j, k) or DIVISIONS in (i, j, k):
                    model["supports"].append({
                        "nodeId": identifier,
                        "ux": True, "uy": True, "uz": True,
                        "rx": False, "ry": False, "rz": False,
                        "prescribed": {"uxM": 0.0015 * x, "uyM": -0.0015 * y, "uzM": 0.0},
                    })

    for k in range(DIVISIONS):
        for j in range(DIVISIONS):
            for i in range(DIVISIONS):
                a = node_id(i, j, k)
                b = node_id(i + 1, j, k)
                c = node_id(i + 1, j + 1, k)
                d = node_id(i, j + 1, k)
                e = node_id(i, j, k + 1)
                f = node_id(i + 1, j, k + 1)
                h = node_id(i, j + 1, k + 1)
                g = node_id(i + 1, j + 1, k + 1)
                for nodes in ([a, b, c, g], [a, c, d, g], [a, d, h, g],
                              [a, h, e, g], [a, e, f, g], [a, f, b, g]):
                    model["volumes"].append({
                        "id": 1001 + len(model["volumes"]),
                        "kind": "tet4", "nodeIds": nodes,
                        "eMpa": 210_000, "poisson": 0.3,
                        "materialLaw": {"kind": "steelJ2", "yieldMpa": 250, "hardeningMpa": 2_000},
                    })

    assert len(model["nodes"]) == 729
    assert len(model["volumes"]) == 3_072
    assert len(model["supports"]) == 386
    OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n",
                      encoding="utf-8")
    print(f"{OUTPUT}: {len(model['nodes'])} nodes, {len(model['volumes'])} Tet4, "
          f"{len(model['supports'])} boundary supports")


if __name__ == "__main__":
    main()
