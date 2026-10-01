import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel, withFrame3DSelfWeight } from "./src/components/frame3d/frame3dModel.ts";
import { frame3DMaximumDisplacementM } from "./src/components/frame3d/frame3dDisplacement.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import Frame3DReportViews from "./src/components/frame3d/Frame3DReportViews.tsx";

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
assert.throws(() => resolveSolver("automatic", plateRequest), /Kies.*Open FEM Rust/);
assert.throws(() => resolveSolver("openaec-native-fem", { ...plateRequest, elementFamilies: ["frame", "plate"] }), /does not support/);
assert.throws(() => resolveSolver("openaec-native-fem", { ...plateRequest, analysis: "p-delta" }), /does not support/);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  const { kind, input } = body.inputs;
  calls.push({ kind, input });
  const binary = { quadMesh: "native-quad-mesh", hybridPlate: "native-hybrid-plate" }[kind];
  assert.ok(binary, `onverwachte kern: ${kind}`);
  const result = await invoke(binary, input);
  return new Response(JSON.stringify({ kind, result }), { status: 200 });
};
try {
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
  const reportViews = renderToStaticMarkup(React.createElement(Frame3DReportViews, { model, result: first }));
  assert.ok((reportViews.match(/<polygon/g) ?? []).length >= 32,
    "de drie rapportaanzichten moeten het onvervormde en het vervormde plaatrooster tekenen");

  const combined = await solveFrame3DCombination(model, new Map([[1, 1], [2, 0.5]]), "linear", "openaec-native-fem");
  assert.ok(Math.abs(combined.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 8) < 1e-8);
  assert.ok(Math.abs(frame3DMaximumDisplacementM(model, combined) / frame3DMaximumDisplacementM(model, first) - 2) < 1e-8);
  assert.equal(combined.forceBalance.ok, true);
  assert.deepEqual(calls.map((call) => call.kind), ["quadMesh", "hybridPlate", "quadMesh", "hybridPlate"]);
  assert.equal(calls[0].input.maxCellSizeM, 0.5);
  assert.equal(calls[1].input.pressureKnM2, -1);
  assert.equal(calls[3].input.pressureKnM2, -2);

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

  const weighted = withFrame3DSelfWeight(model, 3);
  const ownWeight = weighted.surfaceLoads.at(-1);
  assert.equal(ownWeight.plateId, 7);
  assert.equal(ownWeight.caseId, 3);
  assert.ok(Math.abs(ownWeight.qz + 4.905) < 1e-12);
  const weightResult = await solveFrame3D(weighted, 3, "linear", "openaec-native-fem");
  assert.ok(Math.abs(weightResult.reactions.reduce((sum, reaction) => sum + reaction.fz, 0) - 19.62) < 1e-8);
  assert.equal(weightResult.forceBalance.ok, true);

  await assert.rejects(solveFrame3D({ ...model, plates: [{ ...model.plates[0], openings: [{ id: 1, nodeIds: [11, 22, 33] }] }] },
    1, "linear", "openaec-native-fem"), /zonder bogen.*openingen/);
  await assert.rejects(solveFrame3D({ ...model, surfaceLoads: [{ ...model.surfaceLoads[0], qx: 1 }] },
    1, "linear", "openaec-native-fem"), /alleen een verticale/);
  await assert.rejects(solveFrame3D(model, 1, "p-delta", "openaec-native-fem"), /lineaire Open FEM Rust-plaatroute/);
  console.log("3D-plaatroute via Rust-mesher en hybride buigplaat: evenwicht, combinaties, eigen gewicht en afwijzingen geslaagd.");
} finally {
  globalThis.fetch = originalFetch;
}
