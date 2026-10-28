import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel, withFrame3DSelfWeight } from "./src/components/frame3d/frame3dModel.ts";
import { frame3DMaximumDisplacementM } from "./src/components/frame3d/frame3dDisplacement.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { CONCRETE_E_CM, NU_BETON } from "./src/lib/sectionResolver.ts";
import { genereerRasterMesh } from "./src/core/fem/PlaatMesher.ts";
import Frame3DReportViews from "./src/components/frame3d/Frame3DReportViews.tsx";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  return nextLoad(url, context);
} });
const { default: Frame3DReport } = await import("./src/components/frame3d/Frame3DReport.tsx");
const { default: Frame3DPlateReinforcementEditor } = await import("./src/components/frame3d/Frame3DPlateReinforcementEditor.tsx");

const executable = (name) => fileURLToPath(new URL(`../src-tauri/target/debug/${name}`, import.meta.url));
const invoke = (binary, input) => new Promise((resolve, reject) => {
  const child = spawn(executable(binary), [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(input));
});

const model = {
  nodes: [
    { id: 11, x: 0, y: 0, z: 3 }, { id: 22, x: 2, y: 0, z: 3 },
    { id: 33, x: 2, y: 2, z: 3 }, { id: 44, x: 0, y: 2, z: 3 },
  ],
  beams: [], plates: [{ id: 7, nodeIds: [11, 22, 33, 44], thicknessM: 0.2, material: "C30/37" }],
  supports: [11, 22, 33, 44].map((nodeId) => ({ nodeId,
    ux: true, uy: true, uz: true, rx: false, ry: false, rz: false })),
  loads: [], surfaceLoads: [
    { id: 1, plateId: 7, caseId: 1, qx: 0, qy: 0, qz: -1 },
    { id: 2, plateId: 7, caseId: 2, qx: 0, qy: 0, qz: -2 },
  ],
};

const plateRequest = { schemaVersion: 1, dimension: "3d", analysis: "linear", elementFamilies: ["plate"] };
assert.equal(resolveSolver("openaec-native-fem", plateRequest).id, "openaec-native-fem");
// Open FEM 3D (release 2026.42, ex-"dedaliano") rekent platen lineair met
// MITC4; automatisch kiest dus die kern in plaats van de vroegere weigering.
// Alleen materiaal-FNL op platen blijft een expliciete Rust-keuze.
assert.equal(resolveSolver("automatic", plateRequest).id, "open-fem-3d");
assert.throws(() => resolveSolver("automatic", { ...plateRequest, analysis: "material-nonlinear" }), /Kies.*Open FEM Rust/);
assert.throws(() => resolveSolver("openaec-native-fem", { ...plateRequest, elementFamilies: ["frame", "plate"] }), /does not support/);
assert.equal(resolveSolver("openaec-native-fem", { ...plateRequest, analysis: "p-delta" }).id,
  "openaec-native-fem");
assert.equal(resolveSolver("openaec-native-fem", { ...plateRequest, analysis: "material-nonlinear" }).id,
  "openaec-native-fem");

const originalFetch = globalThis.fetch;
const calls = [];
let corruptThreeLayerBatch = null;
let corruptGeometricShell = null;
let corruptHybridPlate = null;
let corruptMembrane2D = null;
let corruptQuadMesh = null;
let failHybridPcgOnce = false;
let failHybridMechanismOnce = false;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  const { kind, input } = body.inputs;
  calls.push({ kind, input });
  if (kind === "threeLayerBatch") {
    const result = { checkedPoints: input.samples.length, status: "partial_check_exceeded",
      results: input.samples.map((sample, index) => ({ id: sample.id, positionM: sample.positionM, result: {
        leverArmMm: 100,
        top: { requiredAsXmm2PerM: 500, requiredAsYmm2PerM: 450,
          concreteCompressionMpa: 5, compressionLimitMpa: 20,
          utilizationAsX: index % 21 / 20, utilizationAsY: 0.2, utilizationCompression: 0.3,
          reinforcementCase: "x-only", annexFBranch: "reinforced" },
        bottom: { requiredAsXmm2PerM: 400, requiredAsYmm2PerM: 350,
          concreteCompressionMpa: 4, compressionLimitMpa: 20,
          utilizationAsX: 0.1, utilizationAsY: 0.2, utilizationCompression: 0.3,
          reinforcementCase: "both-directions", annexFBranch: "reinforced" },
        core: { vxKnPerM: sample.forces.vx, vyKnPerM: sample.forces.vy,
          resultantKnPerM: Math.hypot(sample.forces.vx, sample.forces.vy), directionDeg: 0,
          shearReinforcementRequired: null, requiredShearMm2PerM2: null, diagonalStressMpa: null,
          utilizationShear: null, utilizationDiagonal: null },
        status: index % 17 === 0 ? "partial_check_exceeded" : "partial_check_passes",
        notAssessed: ["scheurtoestand"],
      } })) };
    if (corruptThreeLayerBatch === "negative-utilization") {
      result.results[0].result.top.utilizationAsX = -0.1;
    } else if (corruptThreeLayerBatch === "wrong-position") {
      result.results[0].positionM[0] += 0.01;
    } else if (corruptThreeLayerBatch === "wrong-aggregate-status") {
      result.status = "partial_check_passes";
    } else if (corruptThreeLayerBatch === "null-point-record") {
      result.results[0] = null;
    } else if (corruptThreeLayerBatch === "null-skin-record") {
      result.results[0].result.top = null;
    }
    return new Response(JSON.stringify({ kind, result: corruptThreeLayerBatch === "null-batch" ? null : result }), { status: 200 });
  }
  const binary = { frame3d: "native-frame3d", quadMesh: "native-quad-mesh", quad2d: "native-quad2d", hybridPlate: "native-hybrid-plate",
    geometricShell: "native-geometric-shell" }[kind];
  assert.ok(binary, `onverwachte kern: ${kind}`);
  if (kind === "hybridPlate" && failHybridPcgOnce && input.linearBackend !== "frontalWave") {
    failHybridPcgOnce = false;
    return new Response(JSON.stringify({ fout: "sparse solver did not converge within 4000 iterations" }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
  if (kind === "hybridPlate" && failHybridMechanismOnce) {
    failHybridMechanismOnce = false;
    return new Response(JSON.stringify({ fout: "non-positive free stiffness; unstable plate" }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
  const result = await invoke(binary, input);
  if (kind === "quad2d" && corruptMembrane2D === "negative-residual") {
    result.relativeResidual = -1e-3;
  }
  if (kind === "quadMesh" && corruptQuadMesh === "null-node-record") {
    result.nodes[0] = null;
  } else if (kind === "quadMesh" && corruptQuadMesh === "null-element-record") {
    result.quads[0] = null;
  } else if (kind === "quadMesh" && corruptQuadMesh === "duplicate-node-id") {
    result.nodes[1].id = result.nodes[0].id;
  } else if (kind === "quadMesh" && corruptQuadMesh === "unknown-node-reference") {
    result.quads[0].nodeIds[3] = Number.MAX_SAFE_INTEGER;
  } else if (kind === "quadMesh" && corruptQuadMesh === "oversized-cell") {
    result.quads[0].nodeIds = [1, 3, 8, 6];
  } else if (kind === "quadMesh" && corruptQuadMesh === "overlapping-cells") {
    result.quads[0].nodeIds = [...result.quads[1].nodeIds];
  } else if (kind === "quadMesh" && corruptQuadMesh === "orphan-node") {
    result.nodes.push({ id: Math.max(...result.nodes.map((node) => node.id)) + 1,
      x: input.widthM / 2, y: input.heightM / 2 });
  } else if (kind === "quadMesh" && corruptQuadMesh === "duplicate-coordinate") {
    const original = result.nodes.find((node) => node.x > 0 && node.x < input.widthM
      && node.y > 0 && node.y < input.heightM);
    assert.ok(original, "de mesh bevat een binnenknoop voor de connectiviteitsfoutproef");
    const duplicateId = Math.max(...result.nodes.map((node) => node.id)) + 1;
    result.nodes.push({ ...original, id: duplicateId });
    const quad = result.quads.find((element) => element.nodeIds.includes(original.id));
    quad.nodeIds[quad.nodeIds.indexOf(original.id)] = duplicateId;
  } else if (kind === "quadMesh" && corruptQuadMesh === "nonconforming-edge") {
    const nodeById = new Map(result.nodes.map((node) => [node.id, node]));
    const bounds = result.quads.map((quad) => {
      const corners = quad.nodeIds.map((id) => nodeById.get(id));
      return { quad, minX: corners[0].x, maxX: corners[1].x,
        minY: corners[0].y, maxY: corners[2].y };
    });
    const pair = bounds.flatMap((left) => bounds.filter((right) => left.quad.id !== right.quad.id
      && Math.abs(left.maxX - right.minX) < 1e-10
      && Math.abs(left.minY - right.minY) < 1e-10
      && Math.abs(left.maxY - right.maxY) < 1e-10)
      .map((right) => ({ left, right }))).sort((first, second) => first.left.minY - second.left.minY
        || first.left.minX - second.left.minX)[0];
    assert.ok(pair, "de mesher levert twee aangrenzende Q4-cellen voor de T-splitsingsfoutproef");
    const { left, right } = pair;
    const combined = { ...left.quad, id: Math.max(...result.quads.map((quad) => quad.id)) + 1,
      nodeIds: [left.quad.nodeIds[0], right.quad.nodeIds[1],
        right.quad.nodeIds[2], left.quad.nodeIds[3]] };
    result.quads = result.quads.filter((quad) => quad.id !== left.quad.id && quad.id !== right.quad.id);
    result.quads.push(combined);
  } else if (kind === "quadMesh" && corruptQuadMesh === "cell-crosses-opening") {
    const corner = (x, y) => result.nodes.find((node) => node.x === x && node.y === y)?.id;
    result.quads[0].nodeIds = [corner(0.75, 0.75), corner(1.25, 0.75),
      corner(1.25, 1.25), corner(0.75, 1.25)];
  } else if (kind === "quadMesh" && corruptQuadMesh === "duplicate-edge-node") {
    result.bottomNodeIds[1] = result.bottomNodeIds[0];
  } else if (kind === "quadMesh" && corruptQuadMesh === "unknown-edge-node") {
    result.rightNodeIds[1] = Number.MAX_SAFE_INTEGER;
  } else if (kind === "quadMesh" && corruptQuadMesh === "off-edge-node") {
    result.topNodeIds[1] = result.bottomNodeIds[1];
  } else if (kind === "quadMesh" && corruptQuadMesh === "missing-edge-node") {
    result.leftNodeIds.pop();
  } else if (kind === "geometricShell" && corruptGeometricShell === "non-finite-node") {
    result.nodes[0].uM = Number.NaN;
  } else if (kind === "geometricShell" && corruptGeometricShell === "null-node-record") {
    result.nodes[0] = null;
  } else if (kind === "geometricShell" && corruptGeometricShell === "null-element-record") {
    result.elements[0] = null;
  } else if (kind === "geometricShell" && corruptGeometricShell === "null-resultant-sample") {
    result.elements[0].resultantSamples[0] = null;
  } else if (kind === "geometricShell" && corruptGeometricShell === "null-material-point") {
    result.elements[0].materialPoints[0] = null;
  } else if (kind === "geometricShell" && corruptGeometricShell === "high-residual") {
    result.relativeResidual = 1e-3;
  } else if (kind === "geometricShell" && corruptGeometricShell === "negative-residual") {
    result.relativeResidual = -1e-3;
  } else if (kind === "geometricShell" && corruptGeometricShell === "wrong-resultant-position") {
    result.elements[0].resultantSamples[5].positionM[0] += 0.01;
  } else if (kind === "geometricShell" && corruptGeometricShell === "wrong-material-point-position") {
    result.elements[0].materialPoints[0].positionM[0] += 0.01;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "duplicate-node-id") {
    result.nodes[1].nodeId = result.nodes[0].nodeId;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "null-node-record") {
    result.nodes[0] = null;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "null-element-record") {
    result.elements[0] = null;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "null-resultant-sample") {
    result.elements[0].resultantSamples[0] = null;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "duplicate-quad-id") {
    result.elements[1].quadId = result.elements[0].quadId;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "wrong-resultant-position") {
    result.elements[0].resultantSamples[5].positionM[0] += 0.01;
  } else if (kind === "hybridPlate" && corruptHybridPlate === "negative-residual") {
    result.relativeResidual = -1e-3;
  }
  calls.at(-1).result = result;
  return new Response(JSON.stringify({ kind, result }), { status: 200 });
};
try {
  const thermalGradientFrame = parseFrame3DModel({
    nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 2, y: 0, z: 0 }],
    beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "S235", profileName: "IPE 200",
      nonlinearLaw: { kind: "steelBilinear", yieldMpa: 235, hardeningRatio: 0.01 } }],
    supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
    loads: [{ id: 1, nodeId: 2, caseId: 1, fx: -100, fy: -0.1, fz: 0, mx: 0, my: 0, mz: 0 }],
    memberLoads: [], memberPointLoads: [],
    thermalLoads: [{ id: 1, beamId: 1, deltaTUniformK: 0, deltaTGradientYK: 30, deltaTGradientZK: 0 }],
    plates: [], surfaceLoads: [], plateEdgeLoads: [], materialLoadPath: [0.5, 1],
  });
  const thermalGradientResult = await solveFrame3D(thermalGradientFrame, 1, "combined", "openaec-native-fem");
  const thermalGradientCall = calls.findLast((call) => call.kind === "frame3d");
  assert.equal(thermalGradientCall.input.analysis, "combined");
  assert.equal(thermalGradientCall.input.thermalLoads[0].deltaTGradientYK, 30);
  assert.deepEqual(thermalGradientCall.input.loadPath, [0.5, 1]);
  assert.equal(thermalGradientResult.memberForces.length, 1);
  assert.equal(thermalGradientResult.analysis, "combined");
  assert.ok(thermalGradientResult.memberForces[0].axialHistory,
    "de app-route moet de axiale materiaaltoestand na gecombineerde GNL/FNL-stappen teruggeven");
  assert.ok(Number.isFinite(thermalGradientResult.memberForces[0].effectiveEMpa),
    "gecombineerde staaf-FNL moet de effectieve buigstijfheid teruggeven");
  assert.equal(thermalGradientResult.forceBalance.ok, true, JSON.stringify(thermalGradientResult.forceBalance));

  const monotoneCombinedFrame = parseFrame3DModel({ ...thermalGradientFrame, materialLoadPath: undefined });
  await solveFrame3D(monotoneCombinedFrame, 1, "combined", "openaec-native-fem");
  assert.deepEqual(calls.findLast((call) => call.kind === "frame3d").input.loadPath, [1],
    "gecombineerde GNL/FNL moet zonder ingesteld pad als één monotone materiaalhistorie draaien");

  const first = await solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem");
  assert.equal(first.engine.id, "openaec-native-fem");
  assert.equal(first.plateBending.plateId, 7);
  assert.equal(first.plateBending.nodes.length, 25);
  assert.equal(first.plateBending.elements.length, 16);
  assert.equal(first.displacements.length, 4);
  assert.equal(first.memberForces.length, 0);
  assert.equal(first.forceBalance.ok, true);
  assert.ok(first.forceBalance.maxImbalanceKn < 1e-8);
  assert.ok(first.forceBalance.maxMomentImbalanceKnm < 1e-8);
  assert.ok(Math.abs(first.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 4) < 1e-8);
  assert.ok(frame3DMaximumDisplacementM(model, first) > 1e-5,
    "de grootste zakking ligt binnen de plaat en moet uit de roosterknopen komen");
  assert.ok(first.plateBending.nodes.some((node) => node.wM < -1e-5));
  assert.ok(first.plateBending.elements.some((element) => element.momentKnmPerM.some((value) => Math.abs(value) > 0.1)));
  const callsBeforeRecovery = calls.length;
  failHybridPcgOnce = true;
  const recovered = await solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem");
  assert.deepEqual(calls.slice(callsBeforeRecovery).filter((call) => call.kind === "hybridPlate")
    .map((call) => call.input.linearBackend ?? "existing"), ["existing", "frontalWave"]);
  assert.equal(recovered.solverPath, "native-rust-hybrid-plate-frontal-wave");
  assert.ok(recovered.diagnostics.some((line) => /frontale methode/.test(line)));
  assert.ok(recovered.forceBalance.ok);
  for (const [index, node] of recovered.plateBending.nodes.entries()) {
    assert.ok(Math.abs(node.wM - first.plateBending.nodes[index].wM) < 1e-9);
  }
  const callsBeforeMechanism = calls.length;
  failHybridMechanismOnce = true;
  await assert.rejects(() => solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem"),
    /non-positive free stiffness/);
  assert.deepEqual(calls.slice(callsBeforeMechanism).filter((call) => call.kind === "hybridPlate")
    .map((call) => call.input.linearBackend ?? "existing"), ["existing"]);
  for (const element of first.plateBending.elements) {
    assert.equal(element.resultantSamples.length, 21,
      "ieder Q4 moet resultanten op de hoeken, het middelpunt en 4x4 Gauss-punten teruggeven");
    const centre = element.resultantSamples[4];
    assert.deepEqual(centre.momentKnmPerM, element.momentKnmPerM);
    assert.deepEqual(centre.shearKnPerM, element.shearKnPerM);
    assert.ok(element.resultantSamples.every((sample) =>
      [...sample.positionM, ...sample.momentKnmPerM, ...sample.shearKnPerM].every(Number.isFinite)));
  }
  const geometricResult = await solveFrame3D(parseFrame3DModel(model), 1, "p-delta", "openaec-native-fem");
  assert.equal(calls.findLast((call) => call.kind === "geometricShell").input.bending.quads.length, 16);
  assert.equal(geometricResult.analysis, "p-delta");
  assert.equal(geometricResult.plateBending.nodes.length, 25);
  assert.ok(geometricResult.plateBending.elements.every((element) => element.resultantSamples.length === 21
    && element.materialPoints?.length === 16
    && Number.isFinite(element.maxCombinedStrain)));
  assert.ok(geometricResult.forceBalance.ok);
  const concreteShellModel = parseFrame3DModel({ ...model, materialLoadPath: [1, 0], plates: [{ ...model.plates[0],
    nonlinearLaw: { kind: "concreteCracking", tensileMpa: 3.0, residualRatio: 0.02 } }] });
  assert.equal(concreteShellModel.plates[0].nonlinearLaw?.kind, "concreteCracking");
  const concreteShellResult = await solveFrame3D(concreteShellModel, 1, "p-delta", "openaec-native-fem");
  const concreteShellInput = calls.findLast((call) => call.kind === "geometricShell").input;
  assert.equal(concreteShellInput.analysis, "combined");
  assert.deepEqual(concreteShellInput.materialLaws[1], {
    kind: "concreteCracking", tensileMpa: 3.0, residualRatio: 0.02,
  }, "de app voert de beton-trekbeschadigingswet door naar de Rust-shellpunten");
  assert.deepEqual(concreteShellInput.bending.loadPath, [1, 0],
    "de shell bewaart de materiaalgeschiedenis bij ontlasten via het projectlastpad");
  assert.ok(concreteShellResult.plateBending.elements.every((element) => element.materialPoints?.length === 16
    && element.materialPoints.every((point) => [...point.positionM, ...point.membraneStrain,
      point.equivalentPlasticStrain, point.tensileDamage].every(Number.isFinite))),
  "de app-route behoudt de lokale toestand per materiaal-Gauss-punt");
  const concreteShellReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: concreteShellModel, result: concreteShellResult }));
  assert.match(concreteShellReport, /Materiaaltoestand per shell-Gauss-punt/);
  assert.match(concreteShellReport, /εp,eq/);
  const dualFnlModel = parseFrame3DModel({ ...concreteShellModel, plates: [{
    ...concreteShellModel.plates[0], modulusCurve: [
      { strain: 0, eMpa: CONCRETE_E_CM["C30/37"] },
      { strain: 1e-4, eMpa: CONCRETE_E_CM["C30/37"] * 0.5 },
    ],
  }] });
  await assert.rejects(() => solveFrame3D(dualFnlModel, 1, "p-delta", "openaec-native-fem"),
    /kies voor deze proef óf de secant-E-rekcurve óf één materiaalwet/);
  const springModel = parseFrame3DModel({ ...model, supports: model.supports.map((support) => support.nodeId === 22
    ? { ...support, ux: false, uz: false,
      springs: { kxKnPerM: 75, kzKnPerM: 80, krxKnmPerRad: 25 } } : support) });
  const springLinear = await solveFrame3D(springModel, 1, "linear", "openaec-native-fem");
  const linearSpringRequest = calls.findLast((call) => call.kind === "hybridPlate").input;
  const mappedSpring = linearSpringRequest.supports.find((support) => support.kwKnPerM === 80);
  assert.ok(mappedSpring, "de globale plaatveer moet als lokale verticale veer naar de Rust-kern gaan");
  assert.equal(mappedSpring.kwKnPerM, 80);
  assert.equal(mappedSpring.kthetaXKnmPerRad, 25);
  const linearSpringNode = springLinear.plateBending.nodes.find((node) => node.meshNodeId === mappedSpring.nodeId);
  const linearSpringReaction = springLinear.plateBending.reactions.find((node) => node.meshNodeId === mappedSpring.nodeId);
  assert.ok(Math.abs(linearSpringReaction.fz + 80 * linearSpringNode.wM) < 1e-8);
  assert.ok(Math.abs(linearSpringReaction.mx + 25 * linearSpringNode.thetaXRad) < 1e-8);
  assert.equal(springLinear.forceBalance.ok, true, JSON.stringify(springLinear.forceBalance));
  const springGeometric = await solveFrame3D(springModel, 1, "p-delta", "openaec-native-fem");
  const shellSpringRequest = calls.findLast((call) => call.kind === "geometricShell").input;
  const mappedShellSpring = shellSpringRequest.bending.supports.find((support) => support.kwKnPerM === 80);
  assert.ok(mappedShellSpring, "de GNL-shellroute moet de lokale oplegveer overnemen");
  assert.equal(mappedShellSpring.kwKnPerM, 80);
  assert.equal(mappedShellSpring.kthetaXKnmPerRad, 25);
  const mappedMembraneSpring = shellSpringRequest.membraneSupports.find((support) => support.kuKnPerM === 75);
  assert.ok(mappedMembraneSpring, "de membraanspring moet naar de gekoppelde GNL-shell DOF gaan");
  const shellSpringNode = springGeometric.plateBending.nodes.find((node) => node.meshNodeId === mappedShellSpring.nodeId);
  const shellSpringReaction = springGeometric.plateBending.reactions.find((node) => node.meshNodeId === mappedShellSpring.nodeId);
  assert.ok(Math.abs(shellSpringReaction.fz + 80 * shellSpringNode.wM) < 1e-7);
  assert.ok(Math.abs(shellSpringReaction.mx + 25 * shellSpringNode.thetaXRad) < 1e-7);
  const membraneSpringReaction = springGeometric.plateBending.reactions.find((node) => node.meshNodeId === mappedMembraneSpring.nodeId);
  const membraneSpringDisplacement = springGeometric.displacements.find((node) => node.nodeId === 22);
  assert.ok(Math.abs(membraneSpringReaction.fx + 75 * membraneSpringDisplacement.ux) < 1e-7);
  assert.equal(springGeometric.forceBalance.ok, true, JSON.stringify(springGeometric.forceBalance));
  const threeLayerModel = parseFrame3DModel({ ...model, plates: [{ ...model.plates[0], threeLayer: {
    topSkinMm: 40, bottomSkinMm: 40,
    topReinforcement: { asX: 900, asY: 800 }, bottomReinforcement: { asX: 700, asY: 600 },
    fcdMpa: 20, fydMpa: 435, nuPrime: 0.6, compressionModel: "blaauwendraad2021",
  } }] });
  assert.deepEqual(threeLayerModel.plates[0].threeLayer.topReinforcement, { asX: 900, asY: 800 });
  assert.throws(() => parseFrame3DModel({ ...model, plates: [{ ...model.plates[0], threeLayer: {
    topSkinMm: 40, bottomSkinMm: 40,
    topReinforcement: { asX: -1, asY: 0 }, bottomReinforcement: { asX: 0, asY: 0 },
    fcdMpa: 20, fydMpa: 435, nuPrime: 0.6, compressionModel: "blaauwendraad2021",
  } }] }), /topReinforcement\.asX moet niet-negatief/);
  assert.throws(() => parseFrame3DModel({ ...model, plates: [{ ...model.plates[0], material: "S235", threeLayer: {
    topSkinMm: 40, bottomSkinMm: 40,
    topReinforcement: { asX: 0, asY: 0 }, bottomReinforcement: { asX: 0, asY: 0 },
    fcdMpa: 20, fydMpa: 435, nuPrime: 0.6, compressionModel: "blaauwendraad2021",
  } }] }), /vereist beton/);
  const threeLayerResult = await solveFrame3D(threeLayerModel, 1, "linear", "openaec-native-fem");
  const threeLayerCall = calls.findLast((call) => call.kind === "threeLayerBatch");
  assert.equal(threeLayerCall.input.samples.length, 16 * 21);
  assert.ok(threeLayerCall.input.samples.every((sample) => sample.forces.nx === 0
    && sample.forces.ny === 0 && sample.forces.nxy === 0
    && [...sample.positionM, sample.forces.mx, sample.forces.my, sample.forces.mxy,
      sample.forces.vx, sample.forces.vy].every(Number.isFinite)));
  assert.equal(threeLayerResult.plateBending.elements[0].threeLayer.checkedPoints, 21);
  assert.equal(threeLayerResult.plateBending.elements[0].threeLayer.top.utilizationAsX, 1);
  assert.equal(threeLayerResult.plateBending.elements[0].threeLayer.top.reinforcementCase, "x-only");
  assert.equal(threeLayerResult.plateBending.elements[0].threeLayer.bottom.reinforcementCase, "both-directions");
  assert.equal(threeLayerResult.plateBending.elements[0].threeLayer.status, "partial_check_exceeded");
  const threeLayerReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: threeLayerModel, result: threeLayerResult, activeLoadCaseId: 1 }));
  assert.match(threeLayerReport, /Blaauwendraad drie-lagen-deelcontrole/);
  assert.match(threeLayerReport, /deelcontrole overschreden/);
  assert.match(threeLayerReport, /alleen x/);
  assert.match(threeLayerReport, /x en y/);
  assert.match(threeLayerReport, /membraanresultanten uit een aparte Rust-Q4-oplossing/);
  assert.match(threeLayerReport, /Drielageninvoer/);
  const membraneModel = parseFrame3DModel({ ...threeLayerModel,
    plates: [{ ...threeLayerModel.plates[0], maxCellSizeM: 2 }],
    supports: [
      { nodeId: 11, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 22, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 33, ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
      { nodeId: 44, ux: true, uy: false, uz: true, rx: false, ry: false, rz: false },
    ],
    loads: [
      { id: 3, nodeId: 22, caseId: 1, fx: 2.5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      { id: 4, nodeId: 33, caseId: 1, fx: 2.5, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ],
  });
  const membraneResult = await solveFrame3D(membraneModel, 1, "linear", "openaec-native-fem");
  const membraneCall = calls.findLast((call) => call.kind === "quad2d");
  assert.equal(membraneCall.input.loads.length, 2);
  assert.equal(membraneResult.forceBalance.ok, true);
  assert.equal(membraneCall.input.quads.length, 1);
  assert.equal(membraneResult.plateBending.elements[0].threeLayer.checkedPoints, 21);
  const expectedAxialM = 0.025 / membraneCall.input.materials[0].eMpa;
  const rightBottomDisplacement = membraneResult.displacements.find((node) => node.nodeId === 22);
  assert.ok(Math.abs(rightBottomDisplacement.ux - expectedAxialM) < 1e-10,
    "de uniforme Q4-trekrek moet ook de bestaande 3D-knoopverplaatsing voeden");
  const checkedMembraneSamples = calls.findLast((call) => call.kind === "threeLayerBatch").input.samples;
  // Uniforme uniaxiale trek: σx = 5 kN / (200 mm × 2000 mm) = 0,0125 MPa;
  // Nx = σx × 200 mm = 2,5 kN/m op alle hoek-, midden- en Gauss-punten.
  assert.ok(checkedMembraneSamples.every((sample) => Math.abs(sample.forces.nx - 2.5) < 1e-6
    && Math.abs(sample.forces.ny) < 1e-6 && Math.abs(sample.forces.nxy) < 1e-6),
  "uniforme Q4-membraankracht moet op alle drie-lagenpunten overeenkomen met de handberekening");
  assert.ok(membraneResult.reactions.some((reaction) => Math.abs(reaction.fx) > 1e-6),
    "membraanreacties moeten in de 3D-reacties en globale balans worden opgenomen");
  const geometricMembraneResult = await solveFrame3D(membraneModel, 1, "p-delta", "openaec-native-fem");
  const geometricMembraneCall = calls.findLast((call) => call.kind === "geometricShell");
  assert.equal(geometricMembraneCall.input.membraneLoads.length, 2);
  assert.equal(geometricMembraneResult.plateBending.elements[0].threeLayer.checkedPoints, 21);
  const geometricSamples = calls.findLast((call) => call.kind === "threeLayerBatch").input.samples;
  assert.ok(geometricSamples.every((sample) => Math.abs(sample.forces.nx - 2.5) < 1e-5
    && Math.abs(sample.forces.ny) < 1e-5 && Math.abs(sample.forces.nxy) < 1e-5),
  "gekoppelde GNL-shellresultanten moeten rechtstreeks doorstromen naar de drie-lagencontrole");
  assert.ok(geometricMembraneResult.forceBalance.ok);
  const geometricFnlModel = parseFrame3DModel({ ...membraneModel,
    plates: [{ ...membraneModel.plates[0], modulusCurve: [
      { strain: 0, eMpa: CONCRETE_E_CM["C30/37"] },
      { strain: 1e-8, eMpa: CONCRETE_E_CM["C30/37"] * 0.5 },
    ] }],
    materialLoadPath: [0.5, 1],
  });
  const geometricFnlResult = await solveFrame3D(geometricFnlModel, 1, "p-delta", "openaec-native-fem");
  const geometricFnlCall = calls.findLast((call) => call.kind === "geometricShell");
  assert.equal(geometricFnlCall.input.bending.loadPath.join(","), "0.5,1");
  assert.equal(geometricFnlCall.input.bending.modulusCurves[0].points[1].eMpa,
    CONCRETE_E_CM["C30/37"] * 0.5);
  assert.ok(geometricFnlResult.plateBending.elements.every((element) =>
    element.effectiveEMpa < CONCRETE_E_CM["C30/37"]));
  assert.ok(geometricFnlResult.forceBalance.ok);
  const membraneFnlModel = parseFrame3DModel({ ...membraneModel,
    plates: [{ ...membraneModel.plates[0], modulusCurve: [
      { strain: 0, eMpa: CONCRETE_E_CM["C30/37"] },
      { strain: 1e-8, eMpa: CONCRETE_E_CM["C30/37"] * 0.5 },
    ] }],
    materialLoadPath: [0.5, 1],
  });
  const membraneFnlResult = await solveFrame3D(membraneFnlModel, 1, "material", "openaec-native-fem");
  const membraneFnlCall = calls.findLast((call) => call.kind === "quad2d");
  assert.equal(membraneFnlCall.input.analysis, "material");
  assert.deepEqual(membraneFnlCall.input.loadPath, [0.5, 1]);
  assert.ok(membraneFnlCall.input.modulusCurves[0].points[1].eMpa < membraneFnlCall.input.materials[0].eMpa);
  assert.ok(membraneFnlCall.result.quads.some((quad) => quad.gaussPoints
    .some((point) => point.effectiveEMpa < CONCRETE_E_CM["C30/37"])),
  "FNL-membraanresultanten moeten de rekafhankelijke effectieve E uit de Rust-kern tonen");
  assert.ok(membraneFnlResult.diagnostics.some((diagnostic) =>
    diagnostic.includes("E(rek)-geschiedenis is niet gekoppeld tot één schaalelement")),
  "gelijktijdige FNL-membraan- en buiglasten moeten de ontbrekende constitutieve koppeling melden");
  assert.equal(membraneFnlResult.forceBalance.ok, true);
  const membraneOnlyFnlResult = await solveFrame3D(parseFrame3DModel({
    ...membraneFnlModel, surfaceLoads: [],
  }), 1, "material", "openaec-native-fem");
  assert.ok(!membraneOnlyFnlResult.diagnostics.some((diagnostic) =>
    diagnostic.includes("E(rek)-geschiedenis is niet gekoppeld tot één schaalelement")),
  "de waarschuwingsmelding hoort alleen bij gelijktijdige membraan- en buigbelasting");
  const membraneSurfaceModel = parseFrame3DModel({ ...threeLayerModel,
    surfaceLoads: [{ id: 4, plateId: 7, caseId: 1, qx: 2, qy: 0, qz: 0 }],
  });
  const membraneSurfaceResult = await solveFrame3D(membraneSurfaceModel, 1, "linear", "openaec-native-fem");
  assert.equal(membraneSurfaceResult.forceBalance.ok, true);
  assert.ok(Math.abs(membraneSurfaceResult.reactions.reduce((sum, reaction) => sum + reaction.fx, 0) + 8) < 1e-8);
  assert.ok(calls.findLast((call) => call.kind === "threeLayerBatch").input.samples
    .some((sample) => Math.abs(sample.forces.nx) > 1e-6 || Math.abs(sample.forces.ny) > 1e-6),
  "in-vlakse oppervlaktebelasting moet via consistente Q4-lasten in de controle komen");
  const lineLoadedModel = parseFrame3DModel({ ...model, surfaceLoads: [], plateEdgeLoads: [
    { id: 3, plateId: 7, edgeIndex: 0, caseId: 1, startKnPerM: 0, endKnPerM: -2 },
  ] });
  const lineLoaded = await solveFrame3D(lineLoadedModel, 1, "linear", "openaec-native-fem");
  assert.equal(calls.at(-1).input.edgeLoads.length, 4, "trapeziumrandlast moet over de vier meshsegmenten worden verdeeld");
  assert.ok(Math.abs(calls.at(-1).input.edgeLoads.reduce((sum, load) => sum
    + (load.startKnPerM + load.endKnPerM) / 2 * 0.5, 0) + 2) < 1e-10,
  "de som van de mesh-randlasten moet de analytische resultante van -2 kN opleveren");
  assert.equal(lineLoaded.forceBalance.ok, true);
  assert.ok(lineLoaded.forceBalance.maxImbalanceKn < 1e-8);
  assert.ok(lineLoaded.forceBalance.maxMomentImbalanceKnm < 1e-8);
  assert.ok(Math.abs(lineLoaded.plateBending.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 2) < 1e-8);
  assert.ok(Math.abs(lineLoaded.forceBalance.momentImbalanceKnm[1]) < 1e-8);
  const lineLoadedGnl = await solveFrame3D(lineLoadedModel, 1, "p-delta", "openaec-native-fem");
  const lineLoadedGnlCall = calls.at(-1);
  assert.equal(lineLoadedGnlCall.kind, "geometricShell",
    "de GNL-app-route moet de trapeziumrandlast naar de gekoppelde Rust-shell sturen");
  assert.equal(lineLoadedGnlCall.input.bending.edgeLoads.length, 4);
  assert.equal(lineLoadedGnl.forceBalance.ok, true);
  const linearWByNode = new Map(lineLoaded.plateBending.nodes.map((node) => [node.meshNodeId, node.wM]));
  const gnlSmallLoadDifference = Math.max(...lineLoadedGnl.plateBending.nodes.map((node) =>
    Math.abs(node.wM - linearWByNode.get(node.meshNodeId))));
  const linearMaximumW = Math.max(...lineLoaded.plateBending.nodes.map((node) => Math.abs(node.wM)));
  const gnlMaximumW = Math.max(...lineLoadedGnl.plateBending.nodes.map((node) => Math.abs(node.wM)));
  const peakWComparison = lineLoadedGnl.plateBending.nodes
    .filter((node) => Math.abs(linearWByNode.get(node.meshNodeId)) > linearMaximumW * 0.8)
    .map((node) => ({ meshNodeId: node.meshNodeId, linear: linearWByNode.get(node.meshNodeId), gnl: node.wM }));
  assert.ok(gnlSmallLoadDifference / linearMaximumW < 1e-3,
    `bij kleine doorbuiging moet de GNL-randlastrespons aansluiten op de lineaire hybride plaat `
    + `(verschil=${gnlSmallLoadDifference}, lineaire piek=${linearMaximumW}, `
    + `GNL-piek=${gnlMaximumW}, pieknodes=${JSON.stringify(peakWComparison)}, `
    + `ratio=${gnlSmallLoadDifference / linearMaximumW})`);
  const lineLoadReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: lineLoadedModel, result: null, activeLoadCaseId: 1 }));
  assert.match(lineLoadReport, /Randlijnlasten/);
  assert.match(lineLoadReport, /kN\/m/);
  const lineLoadedFnlModel = parseFrame3DModel({ ...lineLoadedModel,
    plates: [{ ...lineLoadedModel.plates[0], modulusCurve: [
      { strain: 0, eMpa: CONCRETE_E_CM["C30/37"] }, { strain: 0.001, eMpa: CONCRETE_E_CM["C30/37"] * 0.7 },
    ] }], materialLoadPath: [0.5, 1],
  });
  const lineLoadedFnl = await solveFrame3D(lineLoadedFnlModel, 1, "material", "openaec-native-fem");
  assert.equal(lineLoadedFnl.analysis, "material");
  assert.ok(lineLoadedFnl.materialIterations > 0);
  assert.equal(lineLoadedFnl.forceBalance.ok, true);
  assert.equal(calls.at(-1).input.edgeLoads.length, 4, "FNL moet dezelfde gemeshte randlijnlast gebruiken");
  const calculatedLineLoadReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: lineLoadedModel, result: lineLoaded, activeLoadCaseId: 1 }));
  assert.match(calculatedLineLoadReport, /Plaat-randlijnbelastingen/);
  assert.match(calculatedLineLoadReport, /<td>0<\/td><td>-2<\/td>/,
    "het berekende rapport moet de gefactoriseerde begin- en eindlast tonen");
  const reportViews = renderToStaticMarkup(React.createElement(Frame3DReportViews, { model, result: first }));
  assert.ok((reportViews.match(/<polygon/g) ?? []).length >= 32,
    "de drie rapportaanzichten moeten het onvervormde en het vervormde plaatrooster tekenen");

  const simplySupportedModel = parseFrame3DModel({ ...model,
    supports: [], plates: [{ ...model.plates[0], maxCellSizeM: 2 / 6,
      edgeSupports: ["simplySupported", "simplySupported", "simplySupported", "simplySupported"] }] });
  const simplySupported = await solveFrame3D(simplySupportedModel, 1, "linear", "openaec-native-fem");
  assert.equal(simplySupported.plateBending.nodes.length, 49);
  assert.equal(simplySupported.plateBending.reactions.length, 24);
  assert.equal(calls.at(-1).input.supports.length, 24);
  assert.ok(calls.at(-1).input.supports.every((support) => support.w && !support.thetaX && !support.thetaY));
  assert.equal(simplySupported.forceBalance.ok, true);
  assert.ok(Math.abs(simplySupported.plateBending.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 4) < 1e-8);
  const centre = simplySupported.plateBending.nodes.find((node) => Math.abs(node.x - 1) < 1e-12
    && Math.abs(node.y - 1) < 1e-12);
  assert.ok(centre);
  const rigidity = CONCRETE_E_CM["C30/37"] * 1000 * 0.2 ** 3 / (12 * (1 - NU_BETON ** 2));
  const navier = -0.00406 * 2 ** 4 / rigidity;
  assert.ok(Math.abs((centre.wM - navier) / navier) < 0.05,
    `vierzijdig opgelegde 3D-plaat: w=${centre.wM}, Navier=${navier}`);
  const edgeViews = renderToStaticMarkup(React.createElement(Frame3DReportViews,
    { model: simplySupportedModel, result: simplySupported }));
  assert.equal((edgeViews.match(/data-edge-support=/g) ?? []).length, 12,
    "alle vier oplegranden moeten in elk van de drie rapportaanzichten zichtbaar zijn");
  const edgeReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: simplySupportedModel, result: simplySupported }));
  assert.match(edgeReport, /Reacties op vastgezette roosterknopen/);
  assert.match(edgeReport, /Randopleggingen/);
  const clamped = await solveFrame3D({ ...simplySupportedModel,
    plates: [{ ...simplySupportedModel.plates[0], edgeSupports: ["clamped", "clamped", "clamped", "clamped"] }],
  }, 1, "linear", "openaec-native-fem");
  assert.equal(clamped.forceBalance.ok, true);
  assert.ok(calls.at(-1).input.supports.every((support) => support.w && support.thetaX && support.thetaY));
  assert.ok(frame3DMaximumDisplacementM(model, clamped) < frame3DMaximumDisplacementM(model, simplySupported));
  assert.ok(clamped.plateBending.reactions.some((reaction) => Math.abs(reaction.mx) + Math.abs(reaction.my) > 0.01));
  const edgeCantilever = await solveFrame3D({ ...simplySupportedModel,
    plates: [{ ...simplySupportedModel.plates[0], edgeSupports: ["free", "free", "free", "clamped"] }],
  }, 1, "linear", "openaec-native-fem");
  assert.equal(edgeCantilever.forceBalance.ok, true);
  assert.ok(edgeCantilever.plateBending.reactions.every((reaction) => Math.abs(reaction.x) < 1e-12));
  assert.ok(edgeCantilever.plateBending.reactions.some((reaction) => Math.abs(reaction.my) > 0.1));

  const openingNodes = [
    { id: 55, x: 0.75, y: 0.75, z: 3 }, { id: 66, x: 1.25, y: 0.75, z: 3 },
    { id: 77, x: 1.25, y: 1.25, z: 3 }, { id: 88, x: 0.75, y: 1.25, z: 3 },
  ];
  const openingModel = parseFrame3DModel({ ...model, nodes: [...model.nodes, ...openingNodes], supports: [],
    plates: [{ ...model.plates[0], openings: [{ id: 1, nodeIds: [55, 66, 77, 88] }],
      edgeSupports: ["simplySupported", "simplySupported", "simplySupported", "simplySupported"],
      maxCellSizeM: 0.25 }] });
  const perforated = await solveFrame3D(openingModel, 1, "linear", "openaec-native-fem");
  assert.deepEqual(calls.slice(-2).map((call) => call.kind), ["quadMesh", "hybridPlate"]);
  assert.deepEqual(calls.at(-2).input.openings,
    [{ xM: 0.75, yM: 0.75, widthM: 0.5, heightM: 0.5 }]);
  assert.equal(calls.at(-1).kind, "hybridPlate");
  assert.equal(perforated.plateBending.quads.length, 60);
  assert.equal(perforated.plateBending.nodes.length, 80);
  const oldRaster = genereerRasterMesh({ minX: 0, maxX: 2000, minZ: 0, maxZ: 2000,
    openingen: [[{ x: 750, z: 750 }, { x: 1250, z: 750 },
      { x: 1250, z: 1250 }, { x: 750, z: 1250 }]],
    meshSize: 250, meshType: "vierhoeken" });
  assert.equal(oldRaster.points.length, perforated.plateBending.nodes.length);
  assert.deepEqual(oldRaster.quads.map((quad) => quad.map((id) => id + 1)),
    perforated.plateBending.quads.map((quad) => quad.nodeIds),
    "het Rust-raster moet voor het exacte voorbeeld dezelfde connectiviteit als de bestaande rastermesher geven");
  for (let index = 0; index < oldRaster.points.length; index++) {
    const old = oldRaster.points[index], current = perforated.plateBending.nodes[index];
    assert.ok(Math.abs(old.x / 1000 - current.x) < 1e-12
      && Math.abs(old.z / 1000 - current.y) < 1e-12);
  }
  assert.equal(perforated.plateBending.reactions.length, 32);
  assert.equal(perforated.displacements.length, 8);
  assert.equal(perforated.forceBalance.ok, true);
  assert.ok(Math.abs(perforated.plateBending.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 3.75) < 1e-8);
  const perforatedNodes = new Map(perforated.plateBending.nodes.map((node) => [node.meshNodeId, node]));
  assert.ok(perforated.plateBending.quads.every((quad) => {
    const corners = quad.nodeIds.map((id) => perforatedNodes.get(id));
    const x = corners.reduce((sum, node) => sum + node.x, 0) / 4;
    const y = corners.reduce((sum, node) => sum + node.y, 0) / 4;
    return !(x > 0.75 && x < 1.25 && y > 0.75 && y < 1.25);
  }), "het Q4-mesh mag geen materiaal in de opening bevatten");
  const openingPointLoad = await solveFrame3D({ ...openingModel,
    loads: [{ id: 30, nodeId: 55, caseId: 1, fx: 0, fy: 0, fz: -0.5, mx: 0, my: 0, mz: 0 }],
  }, 1, "linear", "openaec-native-fem");
  assert.equal(openingPointLoad.forceBalance.ok, true);
  assert.ok(Math.abs(openingPointLoad.plateBending.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 4.25) < 1e-8);
  const secondOpeningNodes = [
    { id: 99, x: 1.5, y: 0.5, z: 3 }, { id: 100, x: 1.75, y: 0.5, z: 3 },
    { id: 101, x: 1.75, y: 0.75, z: 3 }, { id: 102, x: 1.5, y: 0.75, z: 3 },
  ];
  const twoOpenings = await solveFrame3D({ ...openingModel,
    nodes: [...openingModel.nodes, ...secondOpeningNodes],
    plates: [{ ...openingModel.plates[0], openings: [
      ...openingModel.plates[0].openings, { id: 2, nodeIds: [99, 100, 101, 102] },
    ] }],
  }, 1, "linear", "openaec-native-fem");
  assert.equal(twoOpenings.forceBalance.ok, true);
  assert.equal(twoOpenings.plateBending.quads.length, 59);
  assert.ok(Math.abs(twoOpenings.plateBending.reactions.reduce((sum, reaction) => sum + reaction.fz, 0)
    - 3.6875) < 1e-8);
  const offsetOpening = { ...openingModel,
    nodes: openingModel.nodes.map((node) => node.id >= 55 ? { ...node, x: node.x - 0.25 } : node) };
  const offsetResult = await solveFrame3D(offsetOpening, 1, "linear", "openaec-native-fem");
  assert.equal(offsetResult.forceBalance.ok, true,
    "een excentrische opening moet ook het globale momentenevenwicht sluiten");
  assert.ok(offsetResult.forceBalance.maxMomentImbalanceKnm < 1e-8);
  assert.ok(Math.abs(offsetResult.plateBending.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 3.75) < 1e-8);
  const coarserOpening = await solveFrame3D({ ...openingModel,
    plates: [{ ...openingModel.plates[0], maxCellSizeM: 0.4 }] },
  1, "linear", "openaec-native-fem");
  assert.equal(coarserOpening.forceBalance.ok, true);
  assert.equal(calls.at(-2).input.maxCellSizeM, 0.4);
  const inputMesh = calls.at(-1).input;
  const localNodes = new Map(inputMesh.nodes.map((node) => [node.id, node]));
  assert.ok(inputMesh.quads.every((quad) => {
    const a = localNodes.get(quad.nodeIds[0]), b = localNodes.get(quad.nodeIds[1]);
    const c = localNodes.get(quad.nodeIds[2]);
    return Math.hypot(b.x - a.x, b.y - a.y) <= 0.4 + 1e-10
      && Math.hypot(c.x - b.x, c.y - b.y) <= 0.4 + 1e-10;
  }), "ook met door openingen opgelegde gridlijnen moet maxCellSizeM gelden");
  const openingViews = renderToStaticMarkup(React.createElement(Frame3DReportViews,
    { model: openingModel, result: perforated }));
  assert.ok((openingViews.match(/<polygon/g) ?? []).length >= 120,
    "het rapport moet de uitgespaarde plaat als Q4-rooster tekenen");

  const combined = await solveFrame3DCombination(model, new Map([[1, 1], [2, 0.5]]), "linear", "openaec-native-fem");
  assert.ok(Math.abs(combined.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 8) < 1e-8);
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, combined) / frame3DMaximumDisplacementM(model, first) - 2) < 1e-8);
  assert.equal(combined.forceBalance.ok, true);
  assert.deepEqual(calls.slice(-2).map((call) => call.kind), ["quadMesh", "hybridPlate"]);
  assert.equal(calls.find((call) => call.kind === "quadMesh").input.maxCellSizeM, 0.5);
  assert.equal(calls.find((call) => call.kind === "hybridPlate").input.pressureKnM2, -1);
  assert.equal(calls.at(-1).input.pressureKnM2, -2);

  const asymmetric = { ...model, supports: model.supports.map((support) => support.nodeId === 11
    ? { ...support, rx: true, ry: true } : support) };
  const fixedCorner = await solveFrame3D(asymmetric, 1, "linear", "openaec-native-fem");
  assert.equal(fixedCorner.forceBalance.ok, true,
    "reactiemomenten van een enkel ingeklemde hoek moeten het globale momentenevenwicht sluiten");
  assert.ok(fixedCorner.forceBalance.maxMomentImbalanceKnm < 1e-8);
  assert.ok(Math.abs(fixedCorner.reactions[0].mx) > 0.1);
  const pointMoment = { ...asymmetric, loads: [{ id: 3, nodeId: 22, caseId: 1,
    fx: 0, fy: 0, fz: 0, mx: 0, my: 0.1, mz: 0 }] };
  const withMoment = await solveFrame3D(pointMoment, 1, "linear", "openaec-native-fem");
  assert.equal(withMoment.forceBalance.ok, true, "een globaal My-puntmoment moet ook met het plaatteken sluiten");
  assert.equal(calls.at(-1).input.loads[0].my, -0.1,
    "het globale puntmoment krijgt bij de plaatgrens de tegengestelde lokale tekenconventie");
  const meshCorner = withMoment.plateBending.nodes.find((node) => node.x === 2 && node.y === 0);
  assert.ok(Math.abs(meshCorner.thetaYRad - withMoment.displacements.find((node) => node.nodeId === 22).ry) < 1e-12);

  // Rotate the complete structural problem around Y and then Z. A bending
  // plate must give the same local w, moments and scalar reactions regardless
  // of its orientation in global XYZ.
  const theta = Math.PI / 6, psi = Math.PI / 7;
  const rotate = ([x, y, z]) => {
    const x1 = Math.cos(theta) * x + Math.sin(theta) * z;
    const z1 = -Math.sin(theta) * x + Math.cos(theta) * z;
    return [Math.cos(psi) * x1 - Math.sin(psi) * y,
      Math.sin(psi) * x1 + Math.cos(psi) * y, z1];
  };
  const tilted = {
    ...model,
    nodes: model.nodes.map((node) => {
      const [x, y, z] = rotate([node.x, node.y, node.z]);
      return { ...node, x, y, z };
    }),
    surfaceLoads: model.surfaceLoads.map((load) => {
      const [qx, qy, qz] = rotate([0, 0, load.qz]);
      return { ...load, qx, qy, qz };
    }),
  };
  const tiltedResult = await solveFrame3D(parseFrame3DModel(tilted), 1, "linear", "openaec-native-fem");
  assert.equal(tiltedResult.forceBalance.ok, true);
  assert.ok(tiltedResult.forceBalance.maxImbalanceKn < 1e-8);
  assert.ok(tiltedResult.forceBalance.maxMomentImbalanceKnm < 1e-8);
  for (let index = 0; index < first.plateBending.nodes.length; index++) {
    const baseNode = first.plateBending.nodes[index], tiltedNode = tiltedResult.plateBending.nodes[index];
    assert.ok(Math.abs(baseNode.wM - tiltedNode.wM) < 1e-10,
      `node ${index}: ${baseNode.wM} vs ${tiltedNode.wM}`);
    const expected = rotate([baseNode.x, baseNode.y, baseNode.z]);
    assert.ok(Math.hypot(tiltedNode.x - expected[0], tiltedNode.y - expected[1], tiltedNode.z - expected[2]) < 1e-9);
  }
  for (let index = 0; index < first.reactions.length; index++) {
    const expected = rotate([first.reactions[index].fx, first.reactions[index].fy, first.reactions[index].fz]);
    const actual = tiltedResult.reactions[index];
    assert.ok(Math.hypot(actual.fx - expected[0], actual.fy - expected[1], actual.fz - expected[2]) < 1e-8);
    const baseDisplacement = first.displacements[index], tiltedDisplacement = tiltedResult.displacements[index];
    const expectedDisplacement = rotate([baseDisplacement.ux, baseDisplacement.uy, baseDisplacement.uz]);
    assert.ok(Math.hypot(tiltedDisplacement.ux - expectedDisplacement[0],
      tiltedDisplacement.uy - expectedDisplacement[1], tiltedDisplacement.uz - expectedDisplacement[2]) < 1e-10);
  }
  const tiltedEdges = await solveFrame3D(parseFrame3DModel({ ...tilted, supports: [],
    plates: [{ ...tilted.plates[0], edgeSupports: simplySupportedModel.plates[0].edgeSupports,
      maxCellSizeM: 2 / 6 }],
  }), 1, "linear", "openaec-native-fem");
  assert.equal(tiltedEdges.forceBalance.ok, true);
  for (let index = 0; index < simplySupported.plateBending.nodes.length; index++) {
    assert.ok(Math.abs(tiltedEdges.plateBending.nodes[index].wM
      - simplySupported.plateBending.nodes[index].wM) < 1e-10);
  }
  for (let index = 0; index < simplySupported.plateBending.reactions.length; index++) {
    const baseReaction = simplySupported.plateBending.reactions[index];
    const expected = rotate([baseReaction.fx, baseReaction.fy, baseReaction.fz]);
    const actual = tiltedEdges.plateBending.reactions[index];
    assert.ok(Math.hypot(actual.fx - expected[0], actual.fy - expected[1], actual.fz - expected[2]) < 1e-8);
  }
  const tiltedOpening = { ...openingModel,
    nodes: openingModel.nodes.map((node) => {
      const [x, y, z] = rotate([node.x, node.y, node.z]);
      return { ...node, x, y, z };
    }),
    surfaceLoads: openingModel.surfaceLoads.map((load) => {
      const [qx, qy, qz] = rotate([load.qx, load.qy, load.qz]);
      return { ...load, qx, qy, qz };
    }),
  };
  const tiltedPerforated = await solveFrame3D(tiltedOpening, 1, "linear", "openaec-native-fem");
  assert.equal(tiltedPerforated.forceBalance.ok, true);
  assert.equal(tiltedPerforated.plateBending.quads.length, perforated.plateBending.quads.length);
  for (let index = 0; index < perforated.plateBending.nodes.length; index++) {
    assert.ok(Math.abs(tiltedPerforated.plateBending.nodes[index].wM
      - perforated.plateBending.nodes[index].wM) < 1e-10);
  }
  const tiltedClamped = await solveFrame3D({ ...tilted, supports: [],
    plates: [{ ...tilted.plates[0], edgeSupports: ["clamped", "clamped", "clamped", "clamped"],
      maxCellSizeM: 2 / 6 }],
  }, 1, "linear", "openaec-native-fem");
  assert.equal(tiltedClamped.forceBalance.ok, true);
  for (let index = 0; index < clamped.plateBending.reactions.length; index++) {
    const baseMoment = clamped.plateBending.reactions[index];
    const expected = rotate([baseMoment.mx, baseMoment.my, baseMoment.mz]);
    const actual = tiltedClamped.plateBending.reactions[index];
    assert.ok(Math.hypot(actual.mx - expected[0], actual.my - expected[1], actual.mz - expected[2]) < 1e-8);
  }
  const reversed = { ...model, plates: [{ ...model.plates[0], nodeIds: [11, 44, 33, 22] }] };
  const reversedResult = await solveFrame3D(reversed, 1, "linear", "openaec-native-fem");
  assert.equal(reversedResult.forceBalance.ok, true);
  for (const node of first.displacements) {
    const actual = reversedResult.displacements.find((value) => value.nodeId === node.nodeId);
    assert.ok(Math.abs(actual.uz - node.uz) < 1e-10, "omgekeerde contourvolgorde mag de globale zakking niet wijzigen");
  }
  assert.ok(reversedResult.plateBending.basis.normal[2] < -0.999);
  const rotatedFixed = {
    ...tilted,
    supports: tilted.supports.map((support) => support.nodeId === 11
      ? { ...support, rx: true, ry: true, rz: true } : support),
    loads: pointMoment.loads.map((load) => {
      const [mx, my, mz] = rotate([load.mx, load.my, load.mz]);
      return { ...load, mx, my, mz };
    }),
  };
  const tiltedMoment = await solveFrame3D(rotatedFixed, 1, "linear", "openaec-native-fem");
  assert.equal(tiltedMoment.forceBalance.ok, true);
  assert.ok(Math.abs(tiltedMoment.plateBending.nodes[12].wM - withMoment.plateBending.nodes[12].wM) < 1e-10);
  await assert.rejects(solveFrame3D({ ...tilted,
    surfaceLoads: [{ ...tilted.surfaceLoads[0], qx: tilted.surfaceLoads[0].qx + 0.25 }],
  }, 1, "linear", "openaec-native-fem"), /in-vlakse oppervlaktebelastingen/i);
  await assert.rejects(solveFrame3D({ ...tilted,
    supports: tilted.supports.map((support) => support.nodeId === 11 ? { ...support, ux: false, uy: false } : support),
  }, 1, "linear", "openaec-native-fem"), /alle drie globale translatie-assen/);
  await assert.rejects(solveFrame3D(withFrame3DSelfWeight(tilted, 3),
    3, "linear", "openaec-native-fem"), /in-vlakse oppervlaktebelastingen/i,
  "zwaartekracht op een schuine plaat heeft ook niet-ondersteunde schijfwerking");

  const weighted = withFrame3DSelfWeight(model, 3);
  const ownWeight = weighted.surfaceLoads.at(-1);
  assert.equal(ownWeight.plateId, 7);
  assert.equal(ownWeight.caseId, 3);
  assert.ok(Math.abs(ownWeight.qz + 4.905) < 1e-12);
  const weightResult = await solveFrame3D(weighted, 3, "linear", "openaec-native-fem");
  assert.ok(Math.abs(weightResult.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 19.62) < 1e-8);
  assert.equal(weightResult.forceBalance.ok, true);

  const initialE = CONCRETE_E_CM["C30/37"];
  const softeningCurve = [{ strain: 0, eMpa: initialE }, { strain: 1e-10, eMpa: initialE / 2 }];
  const materialModel = parseFrame3DModel({ ...model,
    plates: [{ ...model.plates[0], modulusCurve: softeningCurve }], materialLoadPath: [1] });
  assert.deepEqual(materialModel.plates[0].modulusCurve, softeningCurve,
    "de FNL-curve moet de projectmodelparser passeren");
  const softened = await solveFrame3D(materialModel, 1, "material", "openaec-native-fem");
  assert.equal(softened.analysis, "material");
  assert.ok(softened.materialIterations > 1);
  assert.equal(softened.forceBalance.ok, true);
  assert.ok(softened.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8 && element.maxFibreStrain > 1e-10));
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, softened)
    / frame3DMaximumDisplacementM(model, first) - 2) < 1e-7,
  "halvering van E moet bij verzadigde secantcurve de elastische zakking verdubbelen");
  const softenedCombination = await solveFrame3DCombination(materialModel,
    new Map([[1, 1], [2, 0.5]]), "material", "openaec-native-fem");
  assert.equal(softenedCombination.forceBalance.ok, true);
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, softenedCombination)
    / frame3DMaximumDisplacementM(model, softened) - 2) < 1e-7,
  "de FNL-combinatie moet als verdubbelde volledige lastvector door de Rust-kern gaan");
  const unloaded = await solveFrame3D({ ...materialModel, materialLoadPath: [1, 0] },
    1, "material", "openaec-native-fem");
  assert.equal(unloaded.forceBalance.ok, true);
  assert.ok(frame3DMaximumDisplacementM(model, unloaded) < 1e-9);
  assert.ok(unloaded.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8 && element.maxFibreStrain > 1e-10));
  const unloadedEdges = await solveFrame3D({ ...simplySupportedModel,
    plates: [{ ...simplySupportedModel.plates[0], modulusCurve: softeningCurve }], materialLoadPath: [1, 0],
  }, 1, "material", "openaec-native-fem");
  assert.equal(unloadedEdges.forceBalance.ok, true);
  assert.ok(frame3DMaximumDisplacementM(model, unloadedEdges) < 1e-9);
  assert.ok(unloadedEdges.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8));
  const openingMaterialModel = { ...openingModel,
    plates: [{ ...openingModel.plates[0], modulusCurve: softeningCurve }], materialLoadPath: [1] };
  const softenedOpening = await solveFrame3D(openingMaterialModel, 1, "material", "openaec-native-fem");
  assert.equal(softenedOpening.forceBalance.ok, true);
  assert.ok(softenedOpening.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8));
  assert.ok(Math.abs(frame3DMaximumDisplacementM(openingModel, softenedOpening)
    / frame3DMaximumDisplacementM(openingModel, perforated) - 2) < 1e-7);
  const unloadedOpening = await solveFrame3D({ ...openingMaterialModel, materialLoadPath: [1, 0] },
    1, "material", "openaec-native-fem");
  assert.equal(unloadedOpening.forceBalance.ok, true);
  assert.ok(frame3DMaximumDisplacementM(openingModel, unloadedOpening) < 1e-9);
  assert.ok(unloadedOpening.plateBending.elements.every((element) =>
    Math.abs(element.effectiveEMpa - initialE / 2) < 1e-8 && element.maxFibreStrain > 1e-10));
  await assert.rejects(solveFrame3D(model, 1, "material", "openaec-native-fem"), /expliciete E-rekcurve/);
  await assert.rejects(solveFrame3D({ ...materialModel,
    plates: [{ ...materialModel.plates[0], modulusCurve: [{ strain: 0, eMpa: initialE * 1.1 }, softeningCurve[1]] }],
  },
  1, "material", "openaec-native-fem"), /materiaaleigen E/);
  assert.throws(() => parseFrame3DModel({ ...materialModel,
    plates: [{ ...materialModel.plates[0], modulusCurve: [{ strain: 0, eMpa: initialE * 1.1 }, softeningCurve[1]] }],
  }), /materiaaleigen E/, "ook de plaateditor moet een foutieve begin-E direct weigeren");
  assert.throws(() => parseFrame3DModel({ ...model,
    plates: [{ ...model.plates[0], modulusCurve: [{ strain: 0, eMpa: initialE }, { strain: 0.001, eMpa: initialE * 1.1 }] }],
  }), /niet-toenemende E/);

  const reinforcement = { limitState: "ultimate", fckMpa: 30, fctmMpa: 2.9,
    gammaC: 1.5, fydMpa: 435, fywdMpa: 435, esMpa: 200000,
    coverMm: 30, barDiameterMm: 12, topXMm2PerM: 1000, topYMm2PerM: 1000,
    bottomXMm2PerM: 1000, bottomYMm2PerM: 1000, shearMm2PerM2: 200,
    tanTheta: 1, alphaCc: 1 };
  const reinforcedModel = parseFrame3DModel({ ...model,
    plates: [{ ...model.plates[0], reinforcement }] });
  const editor = renderToStaticMarkup(React.createElement(Frame3DPlateReinforcementEditor,
    { model: reinforcedModel, plate: reinforcedModel.plates[0], onChange: () => {} }));
  assert.match(editor, /Plaatwapening/);
  assert.match(editor, /Dwarskrachtwapening/);
  const ultimate = await solveFrame3D(reinforcedModel, 1, "linear", "openaec-native-fem");
  assert.equal(ultimate.forceBalance.ok, true);
  assert.ok(ultimate.plateBending.elements.every((element) => element.reinforcement?.limitState === "ultimate"
    && element.reinforcement.checkedPoints >= 4 && element.reinforcement.shear
    && element.reinforcement.longitudinal && element.reinforcement.maximumStrutUtilization >= 0));
  assert.equal(calls.at(-1).input.reinforcement.limitState, "ultimate");
  const service = await solveFrame3D({ ...reinforcedModel,
    plates: [{ ...reinforcedModel.plates[0], reinforcement: {
      ...reinforcement, limitState: "service", crackLimitMm: 0.3 } }],
  }, 1, "linear", "openaec-native-fem");
  assert.ok(service.plateBending.elements.every((element) => element.reinforcement?.limitState === "service"
    && element.reinforcement.crack?.length === 4));
  const checkedReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: reinforcedModel, result: ultimate }));
  assert.match(checkedReport, /Wapenings- en scheurtoets/);
  assert.match(checkedReport, /V,req/);
  assert.match(checkedReport, /fck 30 MPa/);
  const serviceReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model: { ...reinforcedModel, plates: [{ ...reinforcedModel.plates[0],
      reinforcement: { ...reinforcement, limitState: "service", crackLimitMm: 0.3 } }] }, result: service }));
  assert.match(serviceReport, /wk,max/);
  const nonlinearServiceModel = parseFrame3DModel({
    ...model,
    loads: [
      { id: 31, nodeId: 22, caseId: 1, fx: 500, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      { id: 32, nodeId: 33, caseId: 1, fx: 500, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ],
    supports: model.supports.map((support) => ({ ...support,
      ux: support.nodeId === 11 || support.nodeId === 44,
      uy: support.nodeId === 11,
    })),
    plates: [{ ...model.plates[0], reinforcement: { ...reinforcement,
      limitState: "service", crackLimitMm: 0.3 } }],
  });
  const nonlinearService = await solveFrame3D(nonlinearServiceModel, 1, "p-delta", "openaec-native-fem");
  const nonlinearServiceCall = calls.findLast((call) => call.kind === "geometricShell");
  assert.equal(nonlinearServiceCall.input.bending.reinforcement.limitState, "service");
  assert.equal(nonlinearService.forceBalance.ok, true, JSON.stringify(nonlinearService.forceBalance));
  assert.ok(nonlinearService.plateBending.elements.every((element) =>
    element.reinforcement?.limitState === "service" && element.reinforcement.crack?.length === 4));
  assert.ok(nonlinearService.plateBending.elements.some((element) =>
    element.reinforcement?.crack?.some((crack) => (crack.check.characteristicWidthMm ?? 0) > 0) ?? false),
  "de gecombineerde shellmembraantrek moet in de scheurwijdtecontrole meetellen");
  assert.throws(() => parseFrame3DModel({ ...model, plates: [{ ...model.plates[0],
    reinforcement: { ...reinforcement, coverMm: 100 } }] }), /ongeldige beton-\/wapeningsparameters/);
  assert.throws(() => parseFrame3DModel({ ...model, plates: [{ ...model.plates[0],
    reinforcement: { ...reinforcement, fckMpa: 35 } }] }), /dezelfde fck/);

  await assert.rejects(solveFrame3D({ ...model, plates: [{ ...model.plates[0], openings: [{ id: 1, nodeIds: [11, 22, 33] }] }] },
    1, "linear", "openaec-native-fem"), /3D-opening 1.*rechthoek/);
  await assert.rejects(solveFrame3D({ ...openingModel,
    nodes: openingModel.nodes.map((node) => node.id === 55 ? { ...node, x: 0 } : node) },
  1, "linear", "openaec-native-fem"), /volledig binnenliggende/);
  await assert.rejects(solveFrame3D({ ...openingModel,
    nodes: openingModel.nodes.map((node) => node.id >= 55 ? { ...node, x: node.x - 0.745 } : node) },
  1, "linear", "openaec-native-fem"), /volledig binnenliggende/,
  "een strook van 5 mm tussen opening en plaatrand is te smal voor het raster");
  await assert.rejects(solveFrame3D({ ...openingModel,
    nodes: openingModel.nodes.map((node) => node.id === 55 ? { ...node, x: 0.8 } : node) },
  1, "linear", "openaec-native-fem"), /lokaal assenrechte/);
  await assert.rejects(solveFrame3D({ ...model, surfaceLoads: [{ ...model.surfaceLoads[0], qx: 1 }] },
    1, "linear", "openaec-native-fem"), /in-vlakse oppervlaktebelastingen/i);
  for (const corruption of ["negative-utilization", "wrong-position", "wrong-aggregate-status",
    "null-batch", "null-point-record", "null-skin-record"]) {
    corruptThreeLayerBatch = corruption;
    await assert.rejects(solveFrame3D(threeLayerModel, 1, "linear", "openaec-native-fem"),
      /Rust-drielagencontrole gaf een onvolledig of ongeldig puntresultaat/);
  }
  corruptThreeLayerBatch = null;
  for (const corruption of ["non-finite-node", "null-node-record", "null-element-record",
    "null-resultant-sample", "null-material-point", "high-residual", "negative-residual"]) {
    corruptGeometricShell = corruption;
    await assert.rejects(solveFrame3D(parseFrame3DModel(model), 1, "p-delta", "openaec-native-fem"),
      /Rust-shell gaf onvolledige, niet-eindige of ongeldige meshresultaten/);
  }
  corruptGeometricShell = "wrong-resultant-position";
  await assert.rejects(solveFrame3D(parseFrame3DModel(model), 1, "p-delta", "openaec-native-fem"),
    /Rust-buigplaat leverde geen volledig, eindig resultaat/);
  corruptGeometricShell = null;
  for (const corruption of ["duplicate-node-id", "null-node-record", "null-element-record",
    "null-resultant-sample", "duplicate-quad-id", "negative-residual"]) {
    corruptHybridPlate = corruption;
    await assert.rejects(solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem"),
      /Rust-buigplaat leverde geen volledig, eindig resultaat/);
  }
  corruptMembrane2D = "negative-residual";
  await assert.rejects(solveFrame3D(membraneModel, 1, "linear", "openaec-native-fem"),
    /Rust Q4-membraanberekening gaf geen volledig resultaat met voldoende kleine restkracht/);
  corruptMembrane2D = null;
  corruptGeometricShell = "wrong-material-point-position";
  await assert.rejects(solveFrame3D(concreteShellModel, 1, "p-delta", "openaec-native-fem"),
    /Rust-buigplaat leverde geen volledig, eindig resultaat/);
  corruptGeometricShell = null;
  for (const corruption of ["null-node-record", "null-element-record", "duplicate-node-id", "unknown-node-reference", "oversized-cell", "overlapping-cells", "orphan-node", "duplicate-coordinate", "nonconforming-edge"]) {
    corruptQuadMesh = corruption;
    await assert.rejects(solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem"),
      /meshrespons is leeg, onvolledig|Rust-Q4-mesher gaf dubbele ID's|ongeldige knoopreferenties|overschrijdt de gevraagde maximale celmaat|overlappende oppervlakken|knopen terug die door geen enkel element|meerdere knoop-ID's voor dezelfde plaatcoördinaat|niet-conform/);
  }
  corruptQuadMesh = "cell-crosses-opening";
  const largeCellOpeningModel = parseFrame3DModel({ ...openingModel,
    plates: [{ ...openingModel.plates[0], maxCellSizeM: 1 }] });
  await assert.rejects(solveFrame3D(largeCellOpeningModel, 1, "linear", "openaec-native-fem"),
    /een cel die een plaatopening overlapt/);
  for (const corruption of ["duplicate-edge-node", "unknown-edge-node", "off-edge-node", "missing-edge-node"]) {
    corruptQuadMesh = corruption;
    await assert.rejects(solveFrame3D(parseFrame3DModel(model), 1, "linear", "openaec-native-fem"),
      /onvolledige of ongeldige randknoopreeks/);
  }
  corruptQuadMesh = null;
  corruptHybridPlate = null;
  console.log(`3D-plaatroute via Rust: randopleggingen, Navier (${(100 * Math.abs((centre.wM - navier) / navier)).toFixed(2)}% afwijking), evenwicht, combinaties, rotaties, FNL en ontlasten geslaagd.`);
} finally {
  globalThis.fetch = originalFetch;
}
