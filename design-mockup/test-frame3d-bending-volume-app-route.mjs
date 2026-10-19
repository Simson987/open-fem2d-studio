import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  return nextLoad(url, context);
} });
const { default: Frame3DReport } = await import("./src/components/frame3d/Frame3DReport.tsx");

const binary = process.env.OPEN_FEM_NATIVE_MIXED3D_BIN
  ?? fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const invoke = (input) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(input));
});
const support = (nodeId, rx = false) => ({ nodeId,
  ux: true, uy: true, uz: nodeId !== 20 && nodeId !== 50,
  rx, ry: rx, rz: false });
const model = parseFrame3DModel({
  nodes: [
    { id: 10, x: 0, y: 0, z: 0 }, { id: 20, x: 1, y: 0, z: 0 },
    { id: 30, x: 0, y: 1, z: 0 }, { id: 40, x: 0, y: 0, z: 1 },
    { id: 50, x: 1, y: 1, z: 0 },
  ],
  beams: [],
  volumes: [{ id: 7, kind: "tet4", nodeIds: [10, 20, 30, 40], eMpa: 1200, poisson: 0.2 }],
  plates: [{ id: 9, nodeIds: [10, 20, 50, 30], thicknessM: 0.12, material: "C30/37" }],
  supports: [support(10, true), support(20), support(30, true), support(40), support(50)],
  loads: [],
  surfaceLoads: [
    { id: 1, plateId: 9, caseId: 1, qx: 0, qy: 0, qz: -3 },
    { id: 2, plateId: 9, caseId: 2, qx: 0, qy: 0, qz: -1 },
  ],
  volumeBackend: "automatic",
});

const oldFetch = globalThis.fetch;
const requests = [];
let alterNativeResult = (result) => result;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "mixed3d");
  requests.push(body.inputs.input);
  const result = alterNativeResult(await invoke(body.inputs.input));
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual}, verwacht ${expected}`);
const closeScaled = (actual, expected, tolerance, label) =>
  close(actual, expected, tolerance * Math.max(1, Math.abs(expected)), label);

try {
  const solved = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  const request = requests.at(-1);
  assert.deepEqual(request.mesh.tets, [[0, 1, 2, 3]]);
  assert.deepEqual(request.bendingPlates.map((plate) => plate.nodes), [[0, 1, 4], [0, 4, 2]]);
  assert.ok(request.bendingPlates.every((plate) =>
    plate.eMpa > 0 && plate.nu === 0.2 && plate.thicknessM === 0.12));
  assert.deepEqual(request.membranes, []);
  assert.deepEqual(request.membraneTractions, []);
  assert.deepEqual(request.loadsKn.map((load) => load[2]), [-1, -0.5, -0.5, 0, -1],
    "3 kN/m² × 1 m² is exactly 3 kN, assembled once as A q / 3 on both triangles");
  assert.deepEqual(request.prescribedRotationsRad[0].slice(0, 2), [0, 0]);
  assert.deepEqual(request.prescribedRotationsRad[4].slice(0, 2), [null, null],
    "plate-only node 50 owns its Rx/Ry DOFs");
  close(solved.reactions.reduce((sum, reaction) => sum + reaction.fz, 0), 3, 1e-7,
    "global z equilibrium");
  assert.ok(solved.forceBalance.ok && solved.equilibrium.equilibriumOk);
  assert.equal(solved.volume3D.elements[0].elementId, 7);
  assert.deepEqual(solved.volume3D.bendingPlates.map((plate) => [plate.plateId, plate.triangleCount]), [[9, 2]]);
  assert.ok(solved.volume3D.bendingPlates[0].maxAbsWm > 0);
  assert.ok(solved.volume3D.bendingPlates[0].maxAbsRotationRad > 0,
    "shared DKT Rx/Ry are present in the returned node rotations");
  const centroidMoments = solved.volume3D.bendingPlates[0].centroidMoments;
  assert.deepEqual(centroidMoments.map((triangle) => [triangle.triangleIndex, triangle.nodeIds]),
    [[1, [10, 20, 50]], [2, [10, 50, 30]]]);
  assert.ok(centroidMoments.every((triangle) => triangle.momentKnmPerM.every(Number.isFinite)));
  assert.ok(centroidMoments.some((triangle) => triangle.momentKnmPerM.some((moment) => Math.abs(moment) > 1e-8)));
  for (let axis = 0; axis < 3; axis++) {
    close(solved.volume3D.bendingPlates[0].maxAbsMomentKnmPerM[axis],
      Math.max(...centroidMoments.map((triangle) => Math.abs(triangle.momentKnmPerM[axis]))),
      1e-12, `maximum centroid moment ${axis}`);
  }
  assert.ok(Number.isFinite(solved.displacements.find((node) => node.nodeId === 50).rx));
  assert.ok(solved.diagnostics.some((message) => /alleen buiging.*geen plaatmembraan/i.test(message)));
  assert.ok(!("stressMpa" in solved.volume3D.bendingPlates[0]),
    "DKT result must not imply a recovered plate stress");
  const reportHtml = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model, result: solved, projectName: "DKT/Tet4" }));
  assert.match(reportHtml, /Gekoppelde XY-DKT-buigplaten/);
  assert.match(reportHtml, /elastische centroidmomenten/i);
  assert.match(reportHtml, /Mx \[kNm\/m\]/);
  assert.match(reportHtml, /platen dragen alleen buiging/i);
  assert.match(reportHtml, /oppervlaktespanning.*niet berekend/i);
  const oversizedPlate = { ...solved.volume3D.bendingPlates[0], triangleCount: 251,
    centroidMoments: Array.from({ length: 251 }, (_, index) => ({
      ...centroidMoments[index % centroidMoments.length], triangleIndex: index + 1,
    })) };
  const cappedReport = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model, result: { ...solved, volume3D: { ...solved.volume3D,
      bendingPlates: [oversizedPlate] } }, projectName: "DKT/Tet4" }));
  assert.match(cappedReport, /Eerste 250 van 251 driehoeken getoond; 1 overige/);

  const dense = await solveFrame3D({ ...model, volumeBackend: "dense" }, 1,
    "linear", "openaec-native-fem");
  const denseRequest = requests.at(-1);
  const iterative = await solveFrame3D({ ...model, volumeBackend: "matrixFreePcg" }, 1,
    "linear", "openaec-native-fem");
  const iterativeRequest = requests.at(-1);
  assert.equal(request.backend, "automatic");
  assert.equal(denseRequest.backend, "dense");
  assert.equal(iterativeRequest.backend, "matrixFreePcg");
  assert.deepEqual(iterativeRequest.bendingPlates, denseRequest.bendingPlates);
  assert.deepEqual(iterativeRequest.loadsKn, denseRequest.loadsKn);
  assert.deepEqual(iterativeRequest.prescribedRotationsRad, denseRequest.prescribedRotationsRad);
  assert.deepEqual(request.bendingPlates, denseRequest.bendingPlates);
  assert.deepEqual(request.loadsKn, denseRequest.loadsKn);
  assert.equal(dense.volume3D.backendUsed, "dense");
  for (const [name, result] of [["explicit", iterative], ["automatic", solved]]) {
    assert.equal(result.volume3D.backendUsed, "matrixFreePcg", `${name} backend`);
    assert.equal(result.solverPath, "native-rust-mixed3d-matrixFreePcg");
    assert.ok(result.volume3D.linearIterations > 0, `${name} iteration count`);
    assert.ok(result.volume3D.relativeResidual < 1e-8, `${name} relative residual`);
    assert.ok(result.equilibrium.equilibriumOk && result.forceBalance.ok,
      `${name} equilibrium`);
    assert.ok(result.diagnostics.some((message) => /XY-DKT-buigdriehoeken/.test(message)),
      `${name} mixed-element diagnostic`);
    assert.ok(result.diagnostics.some((message) => /matrixFreePcg/.test(message)),
      `${name} backend diagnostic`);
    assert.deepEqual(result.volume3D.bendingPlates.map((plate) =>
      [plate.plateId, plate.triangleCount]), [[9, 2]]);
    for (let index = 0; index < dense.displacements.length; index++) {
      for (const component of ["ux", "uy", "uz", "rx", "ry", "rz"]) {
        closeScaled(result.displacements[index][component], dense.displacements[index][component],
          1e-8, `${name} node ${dense.displacements[index].nodeId} ${component}`);
      }
      for (const component of ["fx", "fy", "fz", "mx", "my", "mz"]) {
        closeScaled(result.reactions[index][component], dense.reactions[index][component],
          1e-7, `${name} reaction ${dense.reactions[index].nodeId} ${component}`);
      }
    }
    closeScaled(result.volume3D.bendingPlates[0].maxAbsWm,
      dense.volume3D.bendingPlates[0].maxAbsWm, 1e-8, `${name} DKT deflection`);
    closeScaled(result.volume3D.bendingPlates[0].maxAbsRotationRad,
      dense.volume3D.bendingPlates[0].maxAbsRotationRad, 1e-8,
      `${name} DKT rotation`);
    assert.equal(result.volume3D.bendingPlates[0].centroidMoments.length,
      dense.volume3D.bendingPlates[0].centroidMoments.length);
    for (let triangle = 0; triangle < dense.volume3D.bendingPlates[0].centroidMoments.length; triangle++) {
      assert.deepEqual(result.volume3D.bendingPlates[0].centroidMoments[triangle].nodeIds,
        dense.volume3D.bendingPlates[0].centroidMoments[triangle].nodeIds);
      for (let axis = 0; axis < 3; axis++) {
        closeScaled(result.volume3D.bendingPlates[0].centroidMoments[triangle].momentKnmPerM[axis],
          dense.volume3D.bendingPlates[0].centroidMoments[triangle].momentKnmPerM[axis],
          1e-7, `${name} DKT centroid moment triangle ${triangle + 1} component ${axis}`);
      }
    }
    for (let component = 0; component < 6; component++) {
      closeScaled(result.volume3D.elements[0].stressMpa[component],
        dense.volume3D.elements[0].stressMpa[component], 1e-7,
        `${name} Tet4 stress ${component}`);
    }
  }

  const combination = await solveFrame3DCombination(model, new Map([[1, 1.5], [2, -0.5]]),
    "linear", "openaec-native-fem");
  close(requests.at(-1).loadsKn.reduce((sum, load) => sum + load[2], 0), -4, 1e-12,
    "combination pressure factors");
  close(combination.reactions.reduce((sum, reaction) => sum + reaction.fz, 0), 4, 1e-7,
    "combination reaction balance");

  const allFreeEdges = ["free", "free", "free", "free"];
  const freeEdges = await solveFrame3D({ ...model,
    plates: [{ ...model.plates[0], edgeSupports: allFreeEdges }] },
  1, "linear", "openaec-native-fem");
  close(freeEdges.volume3D.bendingPlates[0].maxAbsWm,
    solved.volume3D.bendingPlates[0].maxAbsWm, 1e-12,
    "an explicitly free edge is not a hidden restraint");

  const callCount = requests.length;
  await assert.rejects(() => solveFrame3D({ ...model,
    plates: [{ ...model.plates[0], edgeSupports: ["clamped", "free", "free", "free"] }] },
  1, "linear", "openaec-native-fem"), /geen randopleggingen/);
  await assert.rejects(() => solveFrame3D({ ...model,
    surfaceLoads: [{ ...model.surfaceLoads[0], qx: 1 }] }, 1, "linear", "openaec-native-fem"),
  /alleen globale z-druk/);
  await assert.rejects(() => solveFrame3D({ ...model,
    plates: [{ ...model.plates[0], material: "C24" }] }, 1, "linear", "openaec-native-fem"),
  /isotroop beton of staal/);
  await assert.rejects(() => solveFrame3D({ ...model,
    nodes: model.nodes.map((node) => node.id === 50 ? { ...node, z: 0.1 } : node) },
  1, "linear", "openaec-native-fem"), /horizontale XY-platen/);
  await assert.rejects(() => solveFrame3D({ ...model,
    plates: [{ ...model.plates[0], openings: [{ id: 1, nodeIds: [10, 20, 30] }] }] },
  1, "linear", "openaec-native-fem"), /zonder bogen of openingen/);
  await assert.rejects(() => solveFrame3D(model, 1, "material", "openaec-native-fem"),
  /alleen lineaire analyse/);
  assert.equal(requests.length, callCount, "unsupported models fail before the Rust call");
  for (const invalid of [undefined, [[1, 2, 3]], [[1, null, 3], [1, 2, 3]]]) {
    alterNativeResult = (native) => ({ ...native, bendingPlateMomentsKnmPerM: invalid });
    await assert.rejects(() => solveFrame3D(model, 1, "linear", "openaec-native-fem"),
      /ongeldige XY-DKT-centroïdebuigmomenten|geen geldige XY-DKT-centroïdebuigmomenten/);
  }
  alterNativeResult = (native) => native;
  console.log("frame3d XY-DKT bending/volume app route: OK");
} finally {
  globalThis.fetch = oldFetch;
}
