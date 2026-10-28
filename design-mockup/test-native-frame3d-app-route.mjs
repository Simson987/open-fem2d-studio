import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest, solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { deserializeProject } from "./src/io/projectFile.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";

const executable = (name) => fileURLToPath(new URL(`../src-tauri/target/debug/${name}`, import.meta.url));
const invoke = (binary, input) => new Promise((resolve, reject) => {
  const child = spawn(executable(binary), [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    if (code !== 0) return reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString()));
    resolve(JSON.parse(Buffer.concat(output).toString()));
  });
  child.stdin.end(JSON.stringify(input));
});

const fetchBefore = globalThis.fetch;
let nativeCalls = 0;
let referenceCalls = 0;
let corruptNativeResult = null;
let failFramePcgOnce = false;
let failFrameMechanismOnce = false;
const nativeInputs = [];
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (url === "/api/toetsing") {
    assert.equal(body.opdracht, "solve_native_fem");
    assert.equal(body.inputs.kind, "frame3d");
    nativeCalls += 1;
    nativeInputs.push(body.inputs.input);
    if (failFramePcgOnce && body.inputs.input.linearBackend !== "frontalWave") {
      failFramePcgOnce = false;
      return new Response(JSON.stringify({ fout: "sparse solver did not converge within 4000 iterations" }),
        { status: 500, headers: { "content-type": "application/json" } });
    }
    if (failFrameMechanismOnce) {
      failFrameMechanismOnce = false;
      return new Response(JSON.stringify({ fout: "non-positive free stiffness; unstable frame" }),
        { status: 500, headers: { "content-type": "application/json" } });
    }
    const result = await invoke("native-frame3d", body.inputs.input);
    if (corruptNativeResult === "null-node-record") {
      result.nodes[0] = null;
    } else if (corruptNativeResult === "null-reaction") {
      result.nodes[0].reaction = null;
    } else if (corruptNativeResult === "null-member-record") {
      result.members[0] = null;
    } else if (corruptNativeResult === "null-end-forces") {
      result.members[0].localEndForces = null;
    } else if (corruptNativeResult === "null-diagram-curve") {
      result.diagrams.momentY[0] = null;
    } else if (corruptNativeResult === "null-diagram-point") {
      result.diagrams.momentY[0].points[0] = null;
    } else if (corruptNativeResult === "duplicate-node-id") {
      result.nodes[1].nodeId = result.nodes[0].nodeId;
    } else if (corruptNativeResult === "duplicate-member-id") {
      result.members[1].memberId = result.members[0].memberId;
    } else if (corruptNativeResult === "duplicate-diagram-id") {
      result.diagrams.momentY[1].memberId = result.diagrams.momentY[0].memberId;
    } else if (corruptNativeResult === "invalid-diagram-station") {
      const points = result.diagrams.momentY[0].points;
      points[points.length - 1].t = 1.2;
    } else if (corruptNativeResult === "negative-relative-change") {
      result.relativeChange = -0.1;
    } else if (corruptNativeResult === "negative-amplification") {
      result.maxAmplification = -0.1;
    }
    return new Response(JSON.stringify({ kind: "frame3d", result }), { status: 200 });
  }
  assert.equal(url, "/api/frame3d/solve");
  referenceCalls += 1;
  const result = await invoke("frame3d-solver", body);
  return new Response(JSON.stringify(result), { status: 200 });
};

const close = (actual, expected, absolute, label) => assert.ok(
  Math.abs(actual - expected) <= absolute,
  `${label}: native ${actual}, bestaande solver ${expected}, grens ${absolute}`,
);
try {
  const request = { schemaVersion: 1, dimension: "3d", analysis: "linear", elementFamilies: ["frame"] };
  assert.equal(resolveSolver("openaec-native-fem", request).id, "openaec-native-fem");
  // De Dedaliano-kern heet sinds de samenvoeging met release 2026.42
  // "open-fem-3d" (SolverRegistry; een opgeslagen voorkeur "dedaliano" wordt
  // zo gelezen). Zelfde kern, zelfde automatische keuze; geen rekenwaarde anders.
  assert.equal(resolveSolver("automatic", request).id, "open-fem-3d");
  assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "p-delta" }).id,
    "openaec-native-fem");
  assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "material-nonlinear" }).id,
    "openaec-native-fem");
  assert.throws(() => resolveSolver("automatic", { ...request, analysis: "material-nonlinear" }),
    /Kies.*Open FEM Rust/);
  const cases = [
    ["stalen-ligger-3d.ifcfem2d", 1],
    ["stalen-ruimteportaal.ifcfem2d", 1],
    ["stalen-ruimteportaal.ifcfem2d", 2],
  ];
  for (const [name, caseId] of cases) {
    const project = fileURLToPath(new URL(`../docs/verificatie/3d-raamwerk/${name}`, import.meta.url));
    const model = deserializeProject(readFileSync(project, "utf8")).model3d;
    const native = await solveFrame3D(model, caseId, "linear", "openaec-native-fem");
    const existing = await solveFrame3D(model, caseId, "linear", "dedaliano");
    assert.equal(native.engine.id, "openaec-native-fem");
    assert.equal(native.buckling.status, "notApplicable");
    assert.equal(native.forceBalance.ok, true);
    assert.equal(native.memberForces.length, existing.memberForces.length);
    for (const node of native.displacements) {
      const expected = existing.displacements.find((value) => value.nodeId === node.nodeId);
      assert.ok(expected);
      for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"])
        close(node[axis], expected[axis], 1e-7, `${name} LC${caseId} knoop ${node.nodeId} ${axis}`);
    }
    for (const reaction of native.reactions) {
      const expected = existing.reactions.find((value) => value.nodeId === reaction.nodeId);
      if (!expected) continue;
      for (const axis of ["fx", "fy", "fz", "mx", "my", "mz"])
        close(reaction[axis], expected[axis], 1e-4, `${name} LC${caseId} reactie ${reaction.nodeId} ${axis}`);
    }
    for (const member of native.memberForces) {
      const expected = existing.memberForces.find((value) => value.memberId === member.memberId);
      assert.ok(expected);
      for (const axis of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn", "vzStartKn", "vzEndKn",
        "torsionStartKnm", "torsionEndKnm", "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"])
        close(member[axis], expected[axis], 1e-4, `${name} LC${caseId} staaf ${member.memberId} ${axis}`);
      for (const [key, startAxis, endAxis] of [
        ["axial", "nStartKn", "nEndKn"], ["shearY", "vyStartKn", "vyEndKn"],
        ["shearZ", "vzStartKn", "vzEndKn"], ["momentY", "myStartKnm", "myEndKnm"],
        ["momentZ", "mzStartKnm", "mzEndKnm"], ["torsion", "torsionStartKnm", "torsionEndKnm"],
      ]) {
        const curve = native.diagrams[key].find((value) => value.memberId === member.memberId);
        assert.ok(curve);
        close(curve.points[0].value, member[startAxis], 1e-9, `${key} begin`);
        close(curve.points.at(-1).value, member[endAxis], 1e-9, `${key} einde`);
      }
    }
  }
  assert.equal(nativeCalls, 3);
  assert.equal(referenceCalls, 3);
  const fixture = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/stalen-ligger-3d.ifcfem2d", import.meta.url));
  const model = deserializeProject(readFileSync(fixture, "utf8")).model3d;
  failFramePcgOnce = true;
  const recoveredFrame = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  assert.deepEqual(nativeInputs.slice(-2).map((input) => input.linearBackend ?? "existing"),
    ["existing", "frontalWave"]);
  assert.equal(recoveredFrame.solverPath, "native-rust-frame3d-frontal-wave");
  assert.ok(recoveredFrame.diagnostics.some((line) => /frontale methode/.test(line)));
  assert.ok(recoveredFrame.forceBalance.ok);
  const callsBeforeMechanism = nativeInputs.length;
  failFrameMechanismOnce = true;
  await assert.rejects(() => solveFrame3D(model, 1, "linear", "openaec-native-fem"),
    /non-positive free stiffness/);
  assert.deepEqual(nativeInputs.slice(callsBeforeMechanism).map((input) => input.linearBackend ?? "existing"),
    ["existing"]);
  const portalFixture = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/stalen-ruimteportaal.ifcfem2d", import.meta.url));
  const portal = deserializeProject(readFileSync(portalFixture, "utf8")).model3d;
  const pDeltaFactors = new Map([[1, 1], [2, 1]]);
  const nativePDelta = await solveFrame3DCombination(portal, pDeltaFactors, "p-delta", "openaec-native-fem");
  const referencePDelta = await solveFrame3DCombination(portal, pDeltaFactors, "p-delta", "dedaliano");
  assert.equal(nativePDelta.analysis, "p-delta");
  assert.equal(nativePDelta.buckling.status, "available");
  assert.equal(referencePDelta.buckling.status, "available");
  assert.ok(Math.abs(nativePDelta.buckling.modes[0].loadFactor
    - referencePDelta.buckling.modes[0].loadFactor) / referencePDelta.buckling.modes[0].loadFactor < 0.05,
  "P-Δ eerste knikfactor wijkt meer dan 5% af");
  assert.equal(nativePDelta.secondOrder.converged, true);
  assert.equal(nativePDelta.secondOrder.stable, true);
  assert.ok(nativePDelta.secondOrder.iterations > 1);
  assert.ok(nativePDelta.secondOrder.maxAmplification > 1, "portaal onder druk versterkt de zijdelingse verplaatsing");
  assert.ok(nativePDelta.forceBalance.maxImbalanceKn < 1e-6,
    "P-Δ-krachten zijn globaal in evenwicht en momenten gebruiken de vervormde knoopposities");
  for (const node of nativePDelta.displacements) {
    const expected = referencePDelta.displacements.find((value) => value.nodeId === node.nodeId);
    assert.ok(expected);
    for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"])
      close(node[axis], expected[axis], 1e-5, `P-Δ knoop ${node.nodeId} ${axis}`);
  }
  for (const member of nativePDelta.memberForces) {
    const expected = referencePDelta.memberForces.find((value) => value.memberId === member.memberId);
    assert.ok(expected);
    for (const axis of ["nStartKn", "nEndKn", "vyStartKn", "vyEndKn", "vzStartKn", "vzEndKn",
      "torsionStartKnm", "torsionEndKnm", "myStartKnm", "myEndKnm", "mzStartKnm", "mzEndKnm"])
      close(member[axis], expected[axis], 1e-2, `P-Δ staaf ${member.memberId} ${axis}`);
  }
  const beam = model.beams[0];
  const start = model.nodes.find((node) => node.id === beam.startNodeId);
  const end = model.nodes.find((node) => node.id === beam.endNodeId);
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const loaded = { ...model, memberLoads: [{ id: 99, beamId: beam.id, caseId: 1,
    qyStart: 0, qyEnd: 0, qzStart: -1, qzEnd: -1, startPositionM: 0, endPositionM: length }] };
  const pointLoaded = { ...model, memberPointLoads: [{ id: 100, beamId: beam.id, caseId: 1,
    py: 2, pz: -4, positionM: length / 2 }] };
  const thermal = { ...model, thermalLoads: [{ id: 101, beamId: beam.id, caseId: 1,
    deltaTUniformK: 20, deltaTGradientYK: 8, deltaTGradientZK: -5 }] };
  for (const [label, caseModel] of [["lijnlast", loaded], ["puntlast", pointLoaded], ["temperatuur", thermal]]) {
    const native = await solveFrame3D(caseModel, 1, "linear", "openaec-native-fem");
    const existing = await solveFrame3D(caseModel, 1, "linear", "dedaliano");
    assert.equal(native.forceBalance.ok, true, label);
    for (const key of ["momentY", "momentZ", "shearY", "shearZ", "axial", "torsion"]) {
      for (const curve of native.diagrams[key]) {
        const reference = existing.diagrams[key].find((value) => value.memberId === curve.memberId);
        assert.ok(reference, `${label} ${key}`);
        for (const station of reference.points) {
          const actual = curve.points.find((value) => Math.abs(value.t - station.t) < 1e-9);
          assert.ok(actual, `${label} ${key} station ${station.t}`);
          close(actual.value, station.value, 1e-4, `${label} ${key} station ${station.t}`);
        }
      }
    }
  }
  await assert.rejects(solveFrame3D(model, 1, "material", "openaec-native-fem"), /expliciete FNL-materiaalwet/);
  const nonlinearCases = [
    ["staal", "S235", "IPE200", { kind: "steelBilinear", yieldMpa: 235, hardeningRatio: 0.05 }],
    ["beton", "C30/37", "300x500", { kind: "concreteCracking", tensileMpa: 2.9, residualRatio: 0.05 }],
  ];
  for (const [label, material, profileName, nonlinearLaw] of nonlinearCases) {
    const caseModel = parseFrame3DModel({ ...model,
      beams: model.beams.map((member) => ({ ...member, material, profileName, nonlinearLaw })),
      loads: model.loads.map((load) => ({ ...load, fz: load.fz * 10 })),
    });
    assert.deepEqual(caseModel.beams[0].nonlinearLaw, nonlinearLaw, `${label} projectinvoer`);
    if (label === "staal") {
      const differentLaw = { ...caseModel, beams: [caseModel.beams[0], {
        ...caseModel.beams[1], nonlinearLaw: { kind: "steelBilinear", yieldMpa: 300, hardeningRatio: 0.1 },
      }] };
      assert.equal(buildFrame3DSolveRequest(differentLaw, "material", 1).materials.length, 2,
        "verschillende FNL-wetten voor dezelfde staalsoort blijven gescheiden");
    }
    const linear = await solveFrame3D(caseModel, 1, "linear", "openaec-native-fem");
    const nonlinear = await solveFrame3D(caseModel, 1, "material", "openaec-native-fem");
    assert.equal(nonlinear.analysis, "material");
    assert.equal(nonlinear.secondOrder.converged, true);
    assert.equal(nonlinear.forceBalance.ok, true);
    const elasticDeflection = Math.abs(linear.displacements.find((node) => node.nodeId === 2).uz);
    const nonlinearDeflection = Math.abs(nonlinear.displacements.find((node) => node.nodeId === 2).uz);
    assert.ok(nonlinearDeflection > elasticDeflection, `${label} verzacht niet`);
    assert.ok(nonlinear.memberForces.some((member) => member.effectiveEMpa < linear.memberForces[0].effectiveEMpa),
      `${label} E-modulus neemt niet af`);
    if (label === "staal") {
      assert.ok(nonlinear.memberForces.some((member) =>
        (member.sectionHistory?.maximumEquivalentPlasticStrain ?? 0) > 0),
      "3D-staalbuiging rapporteert blijvende vezelplastificatie");
    } else {
      assert.ok(nonlinear.memberForces.some((member) =>
        (member.sectionHistory?.maximumTensileDamage ?? 0) > 0),
      "3D-betonbuiging rapporteert vezeltrekschade");
    }
    if (label === "staal") {
      const halfCombination = await solveFrame3DCombination(caseModel, new Map([[1, 0.5]]),
        "material", "openaec-native-fem");
      const halfDeflection = Math.abs(halfCombination.displacements.find((node) => node.nodeId === 2).uz);
      assert.ok(nonlinearDeflection > 2 * halfDeflection,
        "FNL-combinatie moet na vloeien sterker dan lineair schalen");
    }
    const gradientRequest = buildFrame3DSolveRequest(
      { ...caseModel, thermalLoads: thermal.thermalLoads }, "material", 1,
    );
    assert.equal(gradientRequest.thermalLoads[0].deltaTGradientZK, thermal.thermalLoads[0].deltaTGradientZK,
      `${label} temperatuurgradiënt moet door de FNL-adapter naar Rust worden gestuurd`);
  }
  const historyModel = parseFrame3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "IPE 200",
      nonlinearLaw: { kind: "steelBilinear", yieldMpa: 235, hardeningRatio: 0.05 } }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 1000, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }],
    materialLoadPath: [1, 0],
  });
  const torqueKnm = 0.05;
  const torsionModel = parseFrame3DModel({ ...historyModel,
    loads: [{ ...historyModel.loads[0], fx: 0, mx: torqueKnm }],
    materialLoadPath: undefined,
  });
  const torsionRequest = buildFrame3DSolveRequest(torsionModel, "linear", 1);
  const torsionMaterial = torsionRequest.materials[0];
  const torsionSection = torsionRequest.sections[0];
  const shearModulusKnPerM2 = torsionMaterial.eMpa * 1000 / (2 * (1 + torsionMaterial.nu));
  const expectedTwistRad = torqueKnm * 2 / (shearModulusKnPerM2 * torsionSection.torsionJM4);
  const torsion = await solveFrame3D(torsionModel, 1, "linear", "openaec-native-fem");
  assert.equal(torsion.forceBalance.ok, true, "zuivere torsie moet globaal in evenwicht zijn");
  const tipTwistRad = torsion.displacements.find((node) => node.nodeId === 2).rx;
  assert.ok(Math.abs(tipTwistRad - expectedTwistRad) / expectedTwistRad < 1e-8,
    `3D-staaf torsie: ${tipTwistRad} rad, onafhankelijke TL/GJ-referentie ${expectedTwistRad} rad`);
  assert.ok(Math.abs(Math.abs(torsion.memberForces[0].torsionEndKnm) - torqueKnm) < 1e-8,
    "de torsiesnedekracht moet het aangebrachte eindmoment dragen");
  assert.deepEqual(historyModel.materialLoadPath, [1, 0]);
  const savedHistoryProject = JSON.parse(readFileSync(fixture, "utf8"));
  savedHistoryProject.model3d = historyModel;
  assert.deepEqual(deserializeProject(JSON.stringify(savedHistoryProject)).model3d.materialLoadPath, [1, 0],
    "FNL-lastpad overleeft openen van een 3D-project");
  assert.deepEqual(buildFrame3DSolveRequest(historyModel, "material", 1).loadPath, [1, 0]);
  assert.equal(buildFrame3DSolveRequest(historyModel, "linear", 1).loadPath, undefined);
  const history = await solveFrame3D(historyModel, 1, "material", "openaec-native-fem");
  assert.deepEqual(history.materialLoadPath, [1, 0]);
  assert.equal(history.forceBalance.ok, true, "evenwicht bij ontladen naar lastfactor nul");
  assert.ok(history.displacements.find((node) => node.nodeId === 2).ux > 0, "blijvende staalverlenging");
  assert.ok(history.memberForces[0].axialHistory,
    "een vezelstaaf behoudt de axiale compatibiliteitsgeschiedenis");
  assert.ok(history.memberForces[0].sectionHistory.maximumEquivalentPlasticStrain > 0,
    "vezelgeschiedenis volgt ook axiale plastificatie in de doorsnede");
  assert.equal(history.memberForces[0].sectionHistory.maximumTensileDamage, 0);
  const thermalHistoryModel = parseFrame3DModel({ ...historyModel,
    loads: [], materialLoadPath: undefined,
    thermalLoads: [{ id: 201, beamId: 1, caseId: 1,
      deltaTUniformK: 30, deltaTGradientYK: 0, deltaTGradientZK: 0 }],
  });
  const thermallyExpanded = await solveFrame3D(thermalHistoryModel, 1, "material", "openaec-native-fem");
  assert.equal(thermallyExpanded.forceBalance.ok, true);
  assert.deepEqual(thermallyExpanded.materialLoadPath, [1]);
  assert.ok(Math.abs(thermallyExpanded.displacements.find((node) => node.nodeId === 2).ux - 0.00072) < 1e-9);
  assert.ok(thermallyExpanded.memberForces[0].sectionHistory.maximumEquivalentPlasticStrain < 1e-12,
    "vrije thermische rek mag staal niet plastificeren");
  const halfThermal = await solveFrame3DCombination(thermalHistoryModel, new Map([[1, 0.5]]),
    "material", "openaec-native-fem");
  assert.equal(halfThermal.forceBalance.ok, true);
  assert.ok(Math.abs(halfThermal.displacements.find((node) => node.nodeId === 2).ux - 0.00036) < 1e-9);
  const thermallyUnloaded = await solveFrame3D({ ...thermalHistoryModel, materialLoadPath: [1, 0] },
    1, "material", "openaec-native-fem");
  assert.equal(thermallyUnloaded.forceBalance.ok, true);
  assert.ok(Math.abs(thermallyUnloaded.displacements.find((node) => node.nodeId === 2).ux) < 1e-9);
  const releasedHistoryModel = parseFrame3DModel({ ...historyModel,
    beams: [{ ...historyModel.beams[0], releases: { myEnd: true } }],
    supports: [...historyModel.supports, { nodeId: 2, ux: false, uy: false, uz: false,
      rx: false, ry: true, rz: false }],
    loads: [{ ...historyModel.loads[0], fz: -10 }],
    materialLoadPath: [1, 0, 0.5],
  });
  const releasedHistory = await solveFrame3D(releasedHistoryModel, 1, "material", "openaec-native-fem");
  assert.equal(releasedHistory.forceBalance.ok, true, "FNL-evenwicht met eindscharnier");
  assert.ok(releasedHistory.memberForces[0].axialHistory.plasticStrain > 0);
  assert.ok(releasedHistory.memberForces[0].sectionHistory.maximumEquivalentPlasticStrain > 0,
    "de doorsnedegeschiedenis loopt door de FNL-eindscharnierroute");
  assert.ok(Math.abs(releasedHistory.memberForces[0].myEndKnm) < 1e-8,
    "eindscharnier draagt geen My bij FNL");
  const rotationalSpringModel = parseFrame3DModel({ ...historyModel,
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: false,
      springs: { krzKnmPerRad: 3500 } }],
    loads: [{ ...historyModel.loads[0], fx: 0, mz: 80 }],
    materialLoadPath: undefined,
  });
  const rotationalSpringRequest = buildFrame3DSolveRequest(rotationalSpringModel, "material", 1);
  assert.equal(rotationalSpringRequest.supports[0].krzKnmPerRad, 3500,
    "3D FNL-adapter stuurt de rotatieveer naar Rust");
  const rotationalSpringFnl = await solveFrame3D(rotationalSpringModel, 1, "material", "openaec-native-fem");
  assert.equal(rotationalSpringFnl.forceBalance.ok, true,
    "3D staal-FNL met rotatieveer behoudt krachtenevenwicht");
  assert.ok(rotationalSpringFnl.memberForces[0].sectionHistory.maximumEquivalentPlasticStrain > 0,
    "3D staalvezels plastificeren met een rotatieveer");
  assert.ok(Math.abs(rotationalSpringFnl.displacements.find((node) => node.nodeId === 1).rz) > 0,
    "3D FNL gebruikt de vrije knooprotatie van de rotatieveer");
  const biaxialSectionModel = parseFrame3DModel({ ...historyModel,
    loads: [{ ...historyModel.loads[0], fx: 3000, my: 40, mz: 60 }],
    materialLoadPath: [1],
  });
  const biaxialSection = await solveFrame3D(biaxialSectionModel, 1, "material", "openaec-native-fem");
  assert.equal(biaxialSection.forceBalance.ok, true,
    "3D N-My-Mz-FNL sluit krachten- en momentenbalans");
  assert.ok(biaxialSection.memberForces[0].sectionHistory.maximumEquivalentPlasticStrain > 0,
    "3D N-My-Mz-interactie bereikt plastische vezels via de app-route");
  close(Math.abs(biaxialSection.memberForces[0].nStartKn), 3000, 1e-3,
    "3D app-route N-resultante bij gecombineerde vezelbelasting");
  close(Math.abs(biaxialSection.memberForces[0].myEndKnm), 40, 1e-3,
    "3D app-route My-resultante bij gecombineerde vezelbelasting");
  close(Math.abs(biaxialSection.memberForces[0].mzEndKnm), 60, 1e-3,
    "3D app-route Mz-resultante bij gecombineerde vezelbelasting");
  const concreteHistoryModel = parseFrame3DModel({ ...historyModel,
    beams: [{ ...historyModel.beams[0], material: "C30/37", profileName: "300x500",
      nonlinearLaw: { kind: "concreteCracking", tensileMpa: 2.9, residualRatio: 0.2 } }],
    loads: [{ ...historyModel.loads[0], fx: 600 }],
    materialLoadPath: [1, 0, 0.5],
  });
  const concreteHistory = await solveFrame3D(concreteHistoryModel, 1, "material", "openaec-native-fem");
  assert.equal(concreteHistory.forceBalance.ok, true, "evenwicht na gedeeltelijke herbelasting");
  assert.ok(concreteHistory.memberForces[0].sectionHistory.maximumTensileDamage > 0,
    "doorsnedevezels bewaren betontrekschade");
  assert.ok(concreteHistory.memberForces[0].axialHistory,
    "een vezelstaaf behoudt de axiale compatibiliteitsgeschiedenis bij betonschade");
  const concreteThermalModel = parseFrame3DModel({ ...concreteHistoryModel,
    loads: [],
    supports: [...concreteHistoryModel.supports,
      { nodeId: 2, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    thermalLoads: [{ id: 202, beamId: 1, caseId: 1,
      deltaTUniformK: -30, deltaTGradientYK: 0, deltaTGradientZK: 0 }],
  });
  const concreteThermal = await solveFrame3D(concreteThermalModel, 1, "material", "openaec-native-fem");
  assert.equal(concreteThermal.forceBalance.ok, true);
  assert.ok(concreteThermal.memberForces[0].sectionHistory.maximumTensileDamage > 0,
    "verhinderde afkoeling moet blijvende betontrekschade veroorzaken");
  assert.ok(Math.abs(concreteThermal.reactions.find((node) => node.nodeId === 1).fx) > 1,
    "herbelasting na afkoelen houdt een axiale reactie over");
  assert.throws(() => parseFrame3DModel({ ...historyModel, materialLoadPath: [1, "x"] }), /ongeldig FNL-lastpad/);
  assert.throws(() => parseFrame3DModel({ ...model,
    beams: [{ ...model.beams[0], nonlinearLaw: { kind: "steelBilinear", yieldMpa: -1, hardeningRatio: 0.1 } }, model.beams[1]],
  }), /ongeldige FNL-parameters/);
  await assert.rejects(solveFrame3D({ ...model,
    beams: model.beams.map((member) => ({ ...member, nonlinearLaw: {
      kind: "concreteCracking", tensileMpa: 2.9, residualRatio: 0.05,
    } })),
  }, 1, "material", "openaec-native-fem"), /past niet bij materiaal/);
  for (const [corruption, message] of [
    ["null-node-record", /volledig of evenwichtig resultaat/],
    ["null-member-record", /volledig of evenwichtig resultaat/],
    ["null-reaction", /ongeldige oplegreactie/],
    ["null-end-forces", /ongeldige staafeindkrachten/],
    ["null-diagram-curve", /ongeldige snedekrachtlijnen/],
    ["null-diagram-point", /ongeldige snedekrachtlijnen/],
    ["duplicate-node-id", /geen één-op-één knoopresultaten/],
    ["duplicate-member-id", /geen één-op-één staafresultaten/],
    ["duplicate-diagram-id", /ongeldige snedekrachtlijnen/],
    ["invalid-diagram-station", /ongeldige snedekrachtlijnen/],
    ["negative-relative-change", /volledig of evenwichtig resultaat/],
    ["negative-amplification", /volledig of evenwichtig resultaat/],
  ]) {
    corruptNativeResult = corruption;
    await assert.rejects(solveFrame3D(model, 1, "linear", "openaec-native-fem"),
      message);
  }
  corruptNativeResult = null;
  assert.equal(nativeCalls, 37);
  assert.equal(referenceCalls, 7);
  console.log("Native 3D-app-route: staal, beton, FNL, P-Δ en staaflasten geslaagd.");
} finally {
  globalThis.fetch = fetchBefore;
}
