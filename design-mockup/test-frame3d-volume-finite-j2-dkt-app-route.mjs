import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  return nextLoad(url, context);
} });
const { default: Frame3DReport } = await import("./src/components/frame3d/Frame3DReport.tsx");

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const model = parseFrame3DModel({
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 1, y: 0, z: 0 },
    { id: 3, x: 0, y: 1, z: 0 }, { id: 4, x: 0, y: 0, z: 1 },
    { id: 5, x: 2, y: 0, z: 0 },
  ],
  beams: [{ id: 8, startNodeId: 2, endNodeId: 5, profileName: "HEA100", material: "S235" }],
  volumes: [{ id: 7, kind: "tet4", nodeIds: [1, 2, 3, 4], eMpa: 120, poisson: 0.2,
    materialLaw: { kind: "steelJ2", yieldMpa: 1e9, hardeningMpa: 0 } }],
  plates: [{ id: 9, nodeIds: [1, 2, 3], thicknessM: 0.1, material: "S235" }],
  supports: [
    { nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: false },
    { nodeId: 2, ux: true, uy: true, uz: false, rx: true, ry: true, rz: true },
    { nodeId: 3, ux: true, uy: true, uz: true, rx: true, ry: true, rz: false },
    { nodeId: 4, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
    { nodeId: 5, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  ],
  loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: 8, mx: 0, my: 0, mz: 0, caseId: 1 }],
  materialLoadPath: [1], volumeMaterialKinematics: "finiteStrain", volumeBackend: "dense",
});

const oldFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code,
      output: Buffer.concat(stdout).toString(), error: Buffer.concat(stderr).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.output);
  return new Response(answer.output, { status: 200 });
};

const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual}, expected ${expected}, tolerance ${tolerance}`);

try {
  const solved = await solveFrame3D(model, 1, "material", "openaec-native-fem");
  const request = requests.at(-1);
  assert.equal(request.kind, "volume3dFiniteJ2FrameCoupled");
  assert.deepEqual(request.input.bendingPlates.map(plate => plate.nodes), [[0, 1, 2]]);
  assert.equal(request.input.bendingPlates[0].thicknessM, 0.1);
  assert.equal(request.input.frames.length, 1);
  assert.deepEqual(request.input.volume.mesh.tets, [[0, 1, 2, 3]]);
  assert.equal(solved.volume3D.bendingPlates.length, 1);
  assert.equal(solved.volume3D.bendingPlates[0].triangleCount, 1);
  assert.equal(solved.volume3D.bendingPlates[0].centroidMoments.length, 1);
  assert.ok(solved.volume3D.bendingPlates[0].maxAbsMomentKnmPerM.every(Number.isFinite));
  assert.ok(solved.diagnostics.some(message => /centroïdemomenten.*vaste referentiestijfheid.*plaat-GNL\/FNL/i.test(message)));
  assert.ok(solved.forceBalance.ok && solved.equilibrium.equilibriumOk,
    JSON.stringify(solved.forceBalance));

  const { youngsMpa: plateE, poisson: nu, thicknessM: t } = request.input.bendingPlates[0];
  const { youngsMpa: frameE, iyM4 } = request.input.frames[0];
  const solid = request.input.volume.steel;
  const d = 1000 * plateE * t ** 3 / (12 * (1 - nu ** 2));
  const plateK = d * (45 - 3 * nu) / 8;
  const frameK = 12 * 1000 * frameE * iyM4;
  const mu = solid.youngsMpa / (2 * (1 + solid.poisson));
  const shearForce = gamma => 1000 * (2 * mu * Math.asinh(gamma / 2)
    / Math.sqrt(1 + (gamma / 2) ** 2)) / 6;
  let lo = 0, hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (shearForce(mid) + (plateK + frameK) * mid < 8) lo = mid;
    else hi = mid;
  }
  const expectedW = (lo + hi) / 2;
  const tipW = solved.displacements.find(node => node.nodeId === 2).uz;
  close(tipW, expectedW, 2e-8, "shared Tet4/DKT/frame displacement");
  assert.ok(plateK * tipW > 1, "DKT must carry a measurable part of the 8 kN load");
  close(solved.reactions.reduce((sum, reaction) => sum + reaction.fz, 0), -8, 2e-6,
    "global z reaction");
  const report = renderToStaticMarkup(React.createElement(Frame3DReport,
    { model, result: solved, projectName: "J2/DKT/frame" }));
  assert.match(report, /Gekoppelde XY-DKT-buigplaten/);
  assert.match(report, /Elastische centroidmomenten per driehoek/);
  assert.match(report, /vaste referentiestijfheid/);
  assert.doesNotMatch(report, /plaatmomenten zijn niet herleid/);

  const combined = await solveFrame3D(model, 1, "combined", "openaec-native-fem");
  const combinedRequest = requests.at(-1);
  assert.equal(combinedRequest.kind, "volume3dFiniteJ2FrameCoupled");
  assert.equal(combinedRequest.input.volume.options.geometricFrames, true);
  assert.deepEqual(combinedRequest.input.bendingPlates.map(plate => plate.nodes), [[0, 1, 2]]);
  assert.equal(combined.analysis, "combined");
  assert.ok(Number.isFinite(combined.displacements.find(node => node.nodeId === 2).uz));
  assert.ok(combined.forceBalance.ok && combined.equilibrium.equilibriumOk);
  assert.equal(combined.volume3D.bendingPlates[0].centroidMoments.length, 1);
  assert.ok(combined.volume3D.bendingPlates[0].maxAbsMomentKnmPerM.every(Number.isFinite));

  // Prescribed w = κx x²/2, Rx = dw/dy = 0, Ry = -dw/dx on the
  // horizontal triangle. Kirchhoff plate theory independently gives
  // [Mx, My, Mxy] = [Dκx, νDκx, 0], with D=1000Et³/(12(1-ν²)) kN·m.
  const kappaX = 0.002;
  const prescribedPatch = { ...model, loads: [], materialLoadPath: [1],
    supports: model.supports.map(support => support.nodeId === 2
      ? { ...support, uz: true, ry: true,
        prescribed: { uzM: kappaX / 2, ryRad: -kappaX } }
      : support.nodeId === 5 ? { ...support, uz: false, ry: false } : support),
  };
  const patch = await solveFrame3D(prescribedPatch, 1, "material", "openaec-native-fem");
  const patchRequest = requests.at(-1);
  const plate = patchRequest.input.bendingPlates[0];
  assert.equal(plate.thicknessM, 0.1);
  assert.deepEqual(plate.nodes, [0, 1, 2]);
  const patchD = 1000 * plate.youngsMpa * plate.thicknessM ** 3
    / (12 * (1 - plate.poisson ** 2));
  const actualMoment = patch.volume3D.bendingPlates[0].centroidMoments[0];
  assert.equal(actualMoment.triangleIndex, 1);
  assert.deepEqual(actualMoment.nodeIds, [1, 2, 3]);
  close(actualMoment.momentKnmPerM[0], patchD * kappaX, 2e-5, "independent quadratic Mx");
  close(actualMoment.momentKnmPerM[1], patchD * plate.poisson * kappaX,
    2e-5, "independent quadratic My");
  close(actualMoment.momentKnmPerM[2], 0, 2e-5, "independent quadratic Mxy");
  assert.ok(patch.forceBalance.ok && patch.equilibrium.equilibriumOk);

  const preflightCalls = requests.length;
  const rejectBeforeNative = async (badModel, pattern) => {
    await assert.rejects(() => solveFrame3D(badModel, 1, "material", "openaec-native-fem"), pattern);
    assert.equal(requests.length, preflightCalls);
  };
  await rejectBeforeNative({ ...model, beams: [] }, /J2-volume\/raamwerkroute/);
  await rejectBeforeNative({ ...model, volumeMaterialKinematics: "smallStrain" }, /J2-volume\/raamwerkroute/);
  await rejectBeforeNative({ ...model, volumes: model.volumes.map(volume => ({ ...volume,
    materialLaw: { kind: "concreteTensionDamage", tensileStrengthMpa: 3,
      fractureEnergyNPerM: 100, crackBandWidthM: 0.1 } })) }, /J2-volume\/raamwerkroute/);
  await rejectBeforeNative({ ...model,
    nodes: [...model.nodes, { id: 6, x: 2, y: 1, z: 0 }],
    plates: [{ ...model.plates[0], nodeIds: [1, 2, 6] }] }, /Tet4\/Hex8-volumegebonden knopen/);
  await rejectBeforeNative({ ...model, plates: [{ ...model.plates[0], material: "C24" }] },
    /isotroop beton of staal/);
  await rejectBeforeNative({ ...model,
    nodes: model.nodes.map(node => node.id === 3 ? { ...node, z: 0.1 } : node) },
  /horizontale XY-platen/);
  await assert.rejects(() => solveFrame3D(model, 1, "p-delta", "openaec-native-fem"),
    /alleen Tet4-volumes, zonder Hex8, staven of platen/);
  assert.equal(requests.length, preflightCalls);
  console.log(`frame3d finite-J2 Tet4/elastic XY-DKT/frame app route: analytic stiffness and centroid moments OK; quadratic [Mx,My,Mxy]=[${actualMoment.momentKnmPerM.map(value => value.toFixed(6)).join(", ")}] kNm/m`);
} finally {
  globalThis.fetch = oldFetch;
}
