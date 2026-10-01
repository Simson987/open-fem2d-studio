#!/usr/bin/env python3
"""Print a reproducible native FEM plate request as JSON (standard library only)."""

import argparse
import json


def square_mesh(width, height, cell, thickness):
    nx = round(width / cell)
    ny = round(height / cell)
    assert abs(nx * cell - width) < 1e-10
    assert abs(ny * cell - height) < 1e-10
    ident = lambda i, j: 1 + j * (nx + 1) + i
    nodes = [
        {"id": ident(i, j), "x": i * cell, "y": j * cell}
        for j in range(ny + 1)
        for i in range(nx + 1)
    ]
    quads = [
        {"id": 1 + j * nx + i,
         "nodeIds": [ident(i, j), ident(i + 1, j), ident(i + 1, j + 1), ident(i, j + 1)],
         "materialId": 1, "thicknessM": thickness}
        for j in range(ny)
        for i in range(nx)
    ]
    return nodes, quads


def case(name):
    if name in ("quad_patch", "quad_variable_e"):
        nodes, quads = square_mesh(1.0, 1.0, 1.0, 0.1)
        return {
            "analysis": "material" if name == "quad_variable_e" else "linear",
            "nodes": nodes, "quads": quads,
            "materials": [{"id": 1, "eMpa": 1000.0, "nu": 0.0, "law": {"kind": "elastic"}}],
            "supports": [{"nodeId": 1, "ux": True, "uy": True},
                         {"nodeId": 3, "ux": True, "uy": False}],
            "loads": [{"nodeId": 2, "fx": 50.0, "fy": 0.0},
                      {"nodeId": 4, "fx": 50.0, "fy": 0.0}],
            **({"modulusCurves": [{"materialId": 1, "points": [
                {"strain": 0.0, "eMpa": 1000.0},
                {"strain": 0.002, "eMpa": 800.0}]}], "loadPath": [1.0, 0.0]}
               if name == "quad_variable_e" else {}),
        }
    if name == "hybrid_navier":
        nodes, quads = square_mesh(2.0, 2.0, 1.0 / 3.0, 0.1)
        supports = [{"nodeId": n["id"], "w": True, "thetaX": False, "thetaY": False}
                    for n in nodes if n["x"] == 0 or n["y"] == 0 or
                    abs(n["x"] - 2.0) < 1e-10 or abs(n["y"] - 2.0) < 1e-10]
        return {"nodes": nodes, "quads": quads,
                "materials": [{"id": 1, "eMpa": 30000.0, "nu": 0.2}],
                "supports": supports, "pressureKnM2": -1.0}
    if name == "hybrid_fnl_cantilever":
        nodes, quads = square_mesh(2.0, 1.0, 1.0, 0.2)
        supports = [{"nodeId": n["id"], "w": True, "thetaX": True, "thetaY": True}
                    for n in nodes if n["x"] == 0]
        return {"nodes": nodes, "quads": quads,
                "materials": [{"id": 1, "eMpa": 30000.0, "nu": 0.0}],
                "supports": supports, "pressureKnM2": -1.0,
                "modulusCurves": [{"materialId": 1, "points": [
                    {"strain": 0.0, "eMpa": 30000.0},
                    {"strain": 0.00001, "eMpa": 25000.0}]}],
                "loadPath": [1.0, 0.0]}
    if name == "hybrid_linear_pressure":
        nodes, quads = square_mesh(2.0, 1.0, 1.0, 0.2)
        supports = [{"nodeId": n["id"], "w": True, "thetaX": True, "thetaY": True}
                    for n in nodes if n["x"] == 0]
        return {"nodes": nodes, "quads": quads,
                "materials": [{"id": 1, "eMpa": 30000.0, "nu": 0.2}],
                "supports": supports, "pressureKnM2": 0.0,
                "quadPressures": [{"quadId": quad["id"],
                                   "nodalPressureKnM2": [-nodes[node_id - 1]["x"]
                                                         for node_id in quad["nodeIds"]]}
                                  for quad in quads]}
    if name in ("cement_2021_cantilever", "cement_2021_shear_uls", "cement_2021_crack_sls"):
        nodes, quads = square_mesh(10.0, 8.0, 2.0, 0.6)
        supports = [{"nodeId": n["id"], "w": n["y"] == 0,
                     "thetaX": n["y"] == 0,
                     "thetaY": n["y"] == 0 or n["x"] in (0.0, 10.0)}
                    for n in nodes if n["y"] == 0 or n["x"] in (0.0, 10.0)]
        request = {"nodes": nodes, "quads": quads,
                   "materials": [{"id": 1, "eMpa": 30000.0, "nu": 0.2}],
                   "supports": supports,
                   "pressureKnM2": -10.0 if name == "cement_2021_crack_sls" else -30.0}
        if name != "cement_2021_cantilever":
            request["reinforcement"] = {
                "limitState": "service" if name == "cement_2021_crack_sls" else "ultimate",
                "fckMpa": 20.0, "fctmMpa": 2.2, "gammaC": 1.5,
                "fydMpa": 435.0, "fywdMpa": 435.0, "esMpa": 200000.0,
                "coverMm": 40.0, "barDiameterMm": 16.0,
                "leverArmMm": 500.0,
                "topXMm2PerM": 2000.0, "topYMm2PerM": 2000.0,
                "bottomXMm2PerM": 2000.0, "bottomYMm2PerM": 2000.0,
                "shearMm2PerM2": 1200.0,
                "tanTheta": 1.0, "alphaCc": 1.0,
                "crackLimitMm": 0.3,
            }
        return request
    raise ValueError(name)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=["quad_patch", "quad_variable_e", "hybrid_navier",
                                         "hybrid_fnl_cantilever", "hybrid_linear_pressure",
                                         "cement_2021_cantilever",
                                         "cement_2021_shear_uls", "cement_2021_crack_sls"])
    args = parser.parse_args()
    print(json.dumps(case(args.case), separators=(",", ":")))
