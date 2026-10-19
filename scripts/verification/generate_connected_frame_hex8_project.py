"""Generate the 4×4×128 shared-node Hex8/3D-frame app acceptance model."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "docs/verificatie/3d-volume/hex8-raamwerk-koppeling-klein.ifcfem2d"
OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-verbonden-raamwerk-5104-staven.ifcfem2d"
FULL_OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven.ifcfem2d"
BENDING_J2_OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-buiging.ifcfem2d"
PATCH_OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-axiaal-patch.ifcfem2d"
FINITE_PATCH_OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-j2-elastische-patch.ifcfem2d"
PLASTIC_PATCH_OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-j2-plastische-patch.ifcfem2d"
PLASTIC_UNLOAD_OUTPUT = ROOT / "docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-j2-ontlast-patch.ifcfem2d"
SIDE = 4
STATIONS = 128


def node_id(station: int, y: int, z: int) -> int:
    return 1 + station * SIDE * SIDE + y * SIDE + z


def main() -> None:
    project = json.loads(TEMPLATE.read_text())
    model = project["model3d"]
    model["nodes"] = [
        {"id": node_id(station, y, z), "x": 0.25 * station,
         "y": float(y), "z": float(z)}
        for station in range(STATIONS)
        for y in range(SIDE)
        for z in range(SIDE)
    ]
    beams = []

    def beam(a: int, b: int) -> None:
        beams.append({"id": len(beams) + 1, "startNodeId": a,
                      "endNodeId": b, "profileName": "400x400",
                      "material": "VRIJ:Teststaal E=210000 rho=7850 f=235"})

    for station in range(STATIONS):
        for y in range(SIDE):
            for z in range(SIDE):
                if y + 1 < SIDE:
                    beam(node_id(station, y, z), node_id(station, y + 1, z))
                if z + 1 < SIDE:
                    beam(node_id(station, y, z), node_id(station, y, z + 1))
        if station + 1 < STATIONS:
            for y in range(SIDE):
                for z in range(SIDE):
                    beam(node_id(station, y, z), node_id(station + 1, y, z))
    model["beams"] = beams
    model["volumes"] = [{
        "id": 1, "kind": "hex8",
        "nodeIds": [
            node_id(0, 0, 0), node_id(1, 0, 0),
            node_id(1, 1, 0), node_id(0, 1, 0),
            node_id(0, 0, 1), node_id(1, 0, 1),
            node_id(1, 1, 1), node_id(0, 1, 1),
        ],
        "eMpa": 30_000.0, "poisson": 0.2, "densityKgPerM3": 2_500.0,
    }]
    model["supports"] = [
        {"nodeId": node_id(0, y, z), "ux": True, "uy": True,
         "uz": True, "rx": True, "ry": True, "rz": True}
        for y in range(SIDE) for z in range(SIDE)
    ]
    model["loads"] = [{
        "id": 1, "nodeId": node_id(STATIONS - 1, SIDE - 1, SIDE - 1),
        "fx": 1.0, "fy": 0.0, "fz": -10.0,
        "mx": 0.0, "my": 1.0, "mz": 0.0, "caseId": 1,
    }]
    for key in ("plates", "memberLoads", "memberPointLoads", "thermalLoads",
                "volumeBodyLoads", "volumeFaceLoads", "surfaceLoads", "plateEdgeLoads"):
        model[key] = []
    model["volumeBackend"] = "matrixFreePcg"
    model["volumeThreads"] = 4
    project["loadCases"] = [{"id": 1, "name": "Hoekkracht en moment", "type": "live"}]
    project["activeLoadCaseId"] = 1
    project["combinations"] = []
    project["selfWeightEnabled"] = False
    project["nonlinearEnabled"] = False
    project["analysetype"] = "eersteOrde"
    project["projectInfo"] = {
        "name": "Verbonden 3D-raamwerk met Hex8-knooppunt",
        "projectNumber": "VF-FRAME-5104-HEX8",
    }
    assert len(model["nodes"]) == 2_048
    assert len(beams) == 5_104
    OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{OUTPUT}: 2,048 nodes, 5,104 frames, 1 shared Hex8")

    model["volumes"] = [
        {
            "id": 1 + station * (SIDE - 1) ** 2 + y * (SIDE - 1) + z,
            "kind": "hex8",
            "nodeIds": [
                node_id(station, y, z), node_id(station + 1, y, z),
                node_id(station + 1, y + 1, z), node_id(station, y + 1, z),
                node_id(station, y, z + 1), node_id(station + 1, y, z + 1),
                node_id(station + 1, y + 1, z + 1), node_id(station, y + 1, z + 1),
            ],
            "eMpa": 30_000.0, "poisson": 0.2, "densityKgPerM3": 2_500.0,
        }
        for station in range(STATIONS - 1)
        for y in range(SIDE - 1)
        for z in range(SIDE - 1)
    ]
    project["projectInfo"] = {
        "name": "Verbonden 3D-raamwerk met 1143 Hex8-elementen",
        "projectNumber": "VF-FRAME-5104-HEX8-1143",
    }
    assert len(model["volumes"]) == 1_143
    FULL_OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{FULL_OUTPUT}: 2,048 nodes, 5,104 frames, 1,143 shared Hex8")

    # A separate full-grid bending/torsion project exercises finite-strain J2
    # Hex8 and every 12-DOF frame under the same corner force and moment as
    # the independent linear mixed3d reference. The 235 MPa yield keeps the
    # material elastic so the two routes have a controlled small-strain limit.
    bending_project = json.loads(json.dumps(project))
    bending_model = bending_project["model3d"]
    bending_model["volumes"] = [
        {**volume, "materialLaw": {"kind": "steelJ2", "yieldMpa": 235.0,
                                     "hardeningMpa": 300.0}}
        for volume in bending_model["volumes"]
    ]
    bending_model["volumeMaterialKinematics"] = "finiteStrain"
    bending_model["materialLoadPath"] = [1.0]
    bending_model["volumeBackend"] = "automatic"
    bending_model["volumeResidualTolerance"] = 1e-8
    bending_project["nonlinearEnabled"] = True
    bending_project["analysetype"] = "tweedeOrdeFysisch"
    bending_project["projectInfo"] = {
        "name": "Eindige-rek J2-buigraamwerk: 1143 Hex8 en 5104 staven",
        "projectNumber": "VF-FRAME-HEX8-J2-BENDING-1143",
    }
    BENDING_J2_OUTPUT.write_text(json.dumps(bending_project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{BENDING_J2_OUTPUT}: 3D frame bending and torsion, 1,143 finite-J2 Hex8")

    # Constrained uniaxial-strain patch. With uy=uz=0 at every node, the
    # continuum modulus is M=E(1-nu)/((1+nu)(1-2nu)). The 16 longitudinal
    # frames act in parallel. Distribute the 100 kN end load according to
    # exact Hex8 face tributary areas plus one axial frame per end node.
    beam_e_kn_m2 = 210_000.0 * 1_000.0
    beam_area_m2 = 0.4 * 0.4
    volume_e_kn_m2 = 30_000.0 * 1_000.0
    nu = 0.2
    constrained_modulus = volume_e_kn_m2 * (1.0 - nu) / ((1.0 + nu) * (1.0 - 2.0 * nu))
    volume_area_m2 = float((SIDE - 1) ** 2)
    strain = 100.0 / (constrained_modulus * volume_area_m2
                      + beam_e_kn_m2 * beam_area_m2 * SIDE * SIDE)
    model["supports"] = [
        {"nodeId": node_id(station, y, z), "ux": station == 0,
         "uy": True, "uz": True, "rx": True, "ry": True, "rz": True}
        for station in range(STATIONS)
        for y in range(SIDE)
        for z in range(SIDE)
    ]
    model["loads"] = [
        {"id": 1 + y * SIDE + z, "nodeId": node_id(STATIONS - 1, y, z),
         "fx": strain * (beam_e_kn_m2 * beam_area_m2
                         + constrained_modulus * (0.5 if y in (0, SIDE - 1) else 1.0)
                         * (0.5 if z in (0, SIDE - 1) else 1.0)),
         "fy": 0.0, "fz": 0.0, "mx": 0.0, "my": 0.0, "mz": 0.0,
         "caseId": 1}
        for y in range(SIDE)
        for z in range(SIDE)
    ]
    assert abs(sum(load["fx"] for load in model["loads"]) - 100.0) < 1e-12
    project["loadCases"] = [{"id": 1, "name": "Axiale analytische patch", "type": "live"}]
    project["projectInfo"] = {
        "name": "Analytische axiale patch: 1143 Hex8 en 5104 staven",
        "projectNumber": "VF-FRAME-HEX8-AXIAL-1143",
    }
    PATCH_OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{PATCH_OUTPUT}: 100 kN, exact affine ux at 2,048 nodes")

    # Exercise the coupled finite-strain Newton route at a load that remains
    # strictly elastic under a conventional steel J2 law. The linear patch
    # supplies an independent small-strain limit for this much larger system.
    model["volumes"] = [
        {**volume, "materialLaw": {"kind": "steelJ2", "yieldMpa": 235.0,
                                     "hardeningMpa": 300.0}}
        for volume in model["volumes"]
    ]
    model["volumeMaterialKinematics"] = "finiteStrain"
    model["materialLoadPath"] = [1.0]
    model["volumeBackend"] = "automatic"
    model["volumeResidualTolerance"] = 1e-8
    project["nonlinearEnabled"] = True
    project["analysetype"] = "tweedeOrdeFysisch"
    project["projectInfo"] = {
        "name": "Eindige-rek J2 elastische patch: 1143 Hex8 en 5104 staven",
        "projectNumber": "VF-FRAME-HEX8-J2-ELASTIC-1143",
    }
    FINITE_PATCH_OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{FINITE_PATCH_OUTPUT}: finite-strain J2 route, elastic at 100 kN")

    # Give each longitudinal frame the same axial stiffness per tributary
    # area. Then the zero-force plastic unload also has an exact affine
    # solution at every end node, including corners and edges.
    def tributary_area(y: int, z: int) -> float:
        return (0.5 if y in (0, SIDE - 1) else 1.0) * (
            0.5 if z in (0, SIDE - 1) else 1.0
        )

    for member in model["beams"]:
        if member["endNodeId"] - member["startNodeId"] == SIDE * SIDE:
            cell = (member["startNodeId"] - 1) % (SIDE * SIDE)
            y, z = divmod(cell, SIDE)
            area_m2 = beam_area_m2 * SIDE * SIDE / volume_area_m2 * tributary_area(y, z)
            member["profileName"] = f"400x{area_m2 * 1_000_000 / 400:.12f}"

    # Independent small-strain J2 return for a laterally constrained patch.
    # Sandia LAMÉ §4.13 gives q_trial=2G*eps and, for linear hardening,
    # dp=(q_trial-Y)/(3G+H). The volume axial stress is K*eps+2q/3.
    # A deliberately low Y activates plasticity at this modest 100 kN load;
    # these are verification parameters, not a structural steel grade.
    e_solid_mpa = 30_000.0
    e_beam_mpa = 210_000.0
    yield_mpa = 0.002
    hardening_mpa = 300.0
    shear_mpa = e_solid_mpa / (2.0 * (1.0 + nu))
    bulk_mpa = e_solid_mpa / (3.0 * (1.0 - 2.0 * nu))
    q_slope = 2.0 * shear_mpa * hardening_mpa / (3.0 * shear_mpa + hardening_mpa)
    q_intercept = 3.0 * shear_mpa * yield_mpa / (3.0 * shear_mpa + hardening_mpa)
    plastic_strain = (
        100.0 - 1_000.0 * volume_area_m2 * (2.0 / 3.0) * q_intercept
    ) / (
        1_000.0 * (volume_area_m2 * (bulk_mpa + (2.0 / 3.0) * q_slope)
                   + e_beam_mpa * beam_area_m2 * SIDE * SIDE)
    )
    assert 2.0 * shear_mpa * plastic_strain > yield_mpa
    q = q_slope * plastic_strain + q_intercept
    sigma_x_mpa = bulk_mpa * plastic_strain + (2.0 / 3.0) * q
    model["volumes"] = [
        {**volume, "materialLaw": {"kind": "steelJ2", "yieldMpa": yield_mpa,
                                     "hardeningMpa": hardening_mpa}}
        for volume in model["volumes"]
    ]
    model["loads"] = [
        {"id": 1 + y * SIDE + z, "nodeId": node_id(STATIONS - 1, y, z),
         "fx": (plastic_strain * e_beam_mpa * 1_000.0
                * beam_area_m2 * SIDE * SIDE / volume_area_m2
                + sigma_x_mpa * 1_000.0) * tributary_area(y, z),
         "fy": 0.0, "fz": 0.0, "mx": 0.0, "my": 0.0, "mz": 0.0,
         "caseId": 1}
        for y in range(SIDE)
        for z in range(SIDE)
    ]
    assert abs(sum(load["fx"] for load in model["loads"]) - 100.0) < 1e-12
    project["projectInfo"] = {
        "name": "Eindige-rek J2 plastische patch: 1143 Hex8 en 5104 staven",
        "projectNumber": "VF-FRAME-HEX8-J2-PLASTIC-1143",
    }
    PLASTIC_PATCH_OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{PLASTIC_PATCH_OUTPUT}: J2 plastic patch, eps={plastic_strain:.9e}")

    model["materialLoadPath"] = [1.0, 0.0]
    project["projectInfo"] = {
        "name": "Eindige-rek J2 ontlastpatch: 1143 Hex8 en 5104 staven",
        "projectNumber": "VF-FRAME-HEX8-J2-UNLOAD-1143",
    }
    PLASTIC_UNLOAD_OUTPUT.write_text(json.dumps(project, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{PLASTIC_UNLOAD_OUTPUT}: plastic load and full unload")


if __name__ == "__main__":
    main()
