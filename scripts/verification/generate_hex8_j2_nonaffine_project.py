"""Create a saved 8³ finite-strain J2 Hex8 project with nonaffine loading.

The nodal loads reproduce the independent native Rust quadrature test: a
constant dead traction on x=1 plus a corner force. The x=0 face is fixed.
"""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/verificatie/3d-volume/gemengd-hex8-tet4-eindige-rek-j2-plastisch.ifcfem2d"
TARGET = ROOT / "docs/verificatie/3d-volume/hex8-j2-niet-affien-512.ifcfem2d"
CELLS = 8


def node(i: int, j: int, k: int) -> int:
    return 1 + (k * (CELLS + 1) + j) * (CELLS + 1) + i


def main() -> None:
    project = json.loads(SOURCE.read_text(encoding="utf-8"))
    model = project["model3d"]
    h = 1.0 / CELLS
    nodes = [
        {"id": node(i, j, k), "x": i * h, "y": j * h, "z": k * h}
        for k in range(CELLS + 1)
        for j in range(CELLS + 1)
        for i in range(CELLS + 1)
    ]
    volumes = []
    for k in range(CELLS):
        for j in range(CELLS):
            for i in range(CELLS):
                volumes.append({
                    "id": 1 + len(volumes),
                    "kind": "hex8",
                    "nodeIds": [
                        node(i, j, k), node(i + 1, j, k),
                        node(i + 1, j + 1, k), node(i, j + 1, k),
                        node(i, j, k + 1), node(i + 1, j, k + 1),
                        node(i + 1, j + 1, k + 1), node(i, j + 1, k + 1),
                    ],
                    "eMpa": 1_000.0,
                    "poisson": 0.3,
                    "materialLaw": {"kind": "steelJ2", "yieldMpa": 2.0, "hardeningMpa": 100.0},
                })
    supports = [
        {"nodeId": node(0, j, k), "ux": True, "uy": True, "uz": True,
         "rx": False, "ry": False, "rz": False}
        for k in range(CELLS + 1)
        for j in range(CELLS + 1)
    ]
    # Each surface cell contributes area/4 to its four corner nodes.
    load_by_node: dict[int, list[float]] = {}
    for k in range(CELLS):
        for j in range(CELLS):
            for dj, dk in ((0, 0), (1, 0), (1, 1), (0, 1)):
                components = load_by_node.setdefault(node(CELLS, j + dj, k + dk), [0.0] * 3)
                components[0] += 3_000.0 * h * h / 4.0
                components[2] -= 500.0 * h * h / 4.0
    load_by_node[node(CELLS, CELLS, CELLS)][1] += 30.0
    loads = [
        {"id": index, "nodeId": node_id, "fx": force[0], "fy": force[1],
         "fz": force[2], "mx": 0.0, "my": 0.0, "mz": 0.0, "caseId": 1}
        for index, (node_id, force) in enumerate(sorted(load_by_node.items()), 1)
    ]
    model.update({
        "nodes": nodes,
        "beams": [],
        "volumes": volumes,
        "plates": [],
        "supports": supports,
        "loads": loads,
        "materialLoadPath": [1.0],
        "volumeBackend": "matrixFreeGmresLarge",
        "volumeMaterialKinematics": "finiteStrain",
        "volumeThreads": 4,
    })
    model.pop("volumeBodyLoads", None)
    project.update({
        "analysetype": "tweedeOrdeFysisch",
        "activeLoadCaseId": 1,
        "selfWeightEnabled": False,
        "nonlinearEnabled": True,
        "loadCases": [{"id": 1, "name": "Niet-affiene Hex8 J2-vlaklast en hoeklast", "type": "live"}],
        "projectInfo": {"name": "512 Hex8 J2 met niet-affiene plastische zone",
                        "projectNumber": "VF-HEX8-J2-NONAFFINE-512"},
        "frame3dViewSets": [],
    })
    assert (len(nodes), len(volumes), len(supports), len(loads)) == (729, 512, 81, 81)
    assert abs(sum(load["fx"] for load in loads) - 3_000.0) < 1e-9
    assert abs(sum(load["fy"] for load in loads) - 30.0) < 1e-9
    assert abs(sum(load["fz"] for load in loads) + 500.0) < 1e-9
    TARGET.write_text(json.dumps(project, separators=(",", ":"), ensure_ascii=False) + "\n",
                      encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
