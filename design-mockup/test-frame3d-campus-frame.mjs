import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest, frame3DGlobalForceBalance } from "./src/components/frame3d/frame3dSolver.ts";
import { frame3DMaximumDisplacementM } from "./src/components/frame3d/frame3dDisplacement.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

// Vier niveaus, 4 × 4 vakken: een herhaalbaar GUI-model én een onafhankelijke
// evenwichtsproef voor drie richtingen en een excentrische staafpuntlast.
const nx = 5, ny = 5, nz = 4;
const nodeId = (ix, iy, iz) => 1 + iz * nx * ny + iy * nx + ix;
const nodes = [];
for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  nodes.push({ id: nodeId(ix, iy, iz), x: ix * 4, y: iy * 4, z: iz * 3 });
}
const beams = [];
const addBeam = (a, b, profileName) => beams.push({
  id: beams.length + 1, startNodeId: a, endNodeId: b, profileName, material: "S235",
});
for (let iz = 0; iz < nz - 1; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  addBeam(nodeId(ix, iy, iz), nodeId(ix, iy, iz + 1), "HEA 200");
}
for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  if (ix + 1 < nx) addBeam(nodeId(ix, iy, iz), nodeId(ix + 1, iy, iz), "IPE 200");
  if (iy + 1 < ny) addBeam(nodeId(ix, iy, iz), nodeId(ix, iy + 1, iz), "IPE 200");
}
const supports = nodes.filter((node) => node.z === 0).map((node) => ({
  nodeId: node.id, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true,
}));
const loads = [];
for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  const id = nodeId(ix, iy, nz - 1);
  loads.push({ id: loads.length + 1, nodeId: id, caseId: 1,
    fx: 0, fy: 0, fz: -12, mx: 0, my: 0, mz: 0 });
  loads.push({ id: loads.length + 1, nodeId: id, caseId: 2,
    fx: 0, fy: 4, fz: 0, mx: 0, my: 0, mz: 0 });
}
loads.push({ id: loads.length + 1, nodeId: nodeId(4, 4, 3), caseId: 4,
  fx: 15, fy: 0, fz: 0, mx: 0, my: 0, mz: 30 });
const roofXBeams = beams.filter((beam) => {
  const a = nodes[beam.startNodeId - 1], b = nodes[beam.endNodeId - 1];
  return a.z === 9 && b.z === 9 && a.y === b.y;
});
const memberLoads = roofXBeams.map((beam, index) => ({
  id: index + 1, beamId: beam.id, caseId: 3,
  qyStart: 0, qyEnd: 0, qzStart: -3, qzEnd: -3,
  startPositionM: 0, endPositionM: 4,
}));
const pointBeam = roofXBeams.find((beam) => beam.startNodeId === nodeId(0, 0, 3));
assert.ok(pointBeam);
const memberPointLoads = [{ id: 1, beamId: pointBeam.id, caseId: 4,
  py: 0, pz: -10, positionM: 2 }];
const model = parseFrame3DModel({ nodes, beams, supports, loads, memberLoads, memberPointLoads });
assert.deepEqual([model.nodes.length, model.beams.length, model.supports.length,
  model.loads.length, model.memberLoads.length, model.memberPointLoads.length],
  [100, 235, 25, 51, 20, 1]);

const fixturePath = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/groot-vierlaags-raam.ifcfem2d", import.meta.url));
const project = {
  nodes: [], beams: [], supports: [], plates: [], loads: [],
  loadCases: [
    { id: 1, name: "Daklast", type: "dead" },
    { id: 2, name: "Wind Y", type: "wind" },
    { id: 3, name: "Dakliggerlast", type: "live" },
    { id: 4, name: "Excentrische last", type: "wind" },
  ],
  activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: false,
  analysetype: "eersteOrde", modelDimension: "3d", model3d: model,
  projectInfo: { name: "Verificatie vierlaags 3D raam", projectNumber: "VF-3D-GROOT-02" },
};
if (process.argv.includes("--write-fixture")) writeFileSync(fixturePath, serializeProject(project));
assert.ok(existsSync(fixturePath));
assert.deepEqual(deserializeProject(readFileSync(fixturePath, "utf8")).model3d, model);

const solverBinary = process.platform === "win32" ? "frame3d-solver.exe" : "frame3d-solver";
const solverPath = process.env.FRAME3D_SOLVER_PATH
  ?? fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
assert.ok(existsSync(solverPath), "Bouw eerst de Rust-rekenkern.");
const invokeSolver = (request) => new Promise((resolve, reject) => {
  const child = spawn(solverPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  let size = 0;
  const timeout = setTimeout(() => child.kill(), 120_000);
  child.stdout.on("data", (chunk) => {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) child.kill();
    else stdout.push(chunk);
  });
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => {
    clearTimeout(timeout);
    if (code !== 0) return reject(new Error(`3D-kern: exit ${code}; ${Buffer.concat(stderr).toString()}`));
    try { resolve(JSON.parse(Buffer.concat(stdout).toString())); }
    catch (error) { reject(error); }
  });
  child.stdin.on("error", reject);
  child.stdin.end(JSON.stringify(request));
});
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: verwacht ${expected}, berekend ${actual}, grens ${tolerance}`,
);
const sum = (values, key) => values.reduce((total, value) => total + value[key], 0);
const solve = async (factor) => {
  const request = { ...buildFrame3DSolveRequest(model, "linear", factor), bucklingModes: 0 };
  const started = performance.now();
  const result = await invokeSolver(request);
  return { result, balance: frame3DGlobalForceBalance(request, result), elapsedMs: performance.now() - started };
};
const check = (solved, expectedForces, expectedMoments, name) => {
  const { result, balance } = solved;
  assert.equal(result.displacements.length, 100, `${name}: alle knopen`);
  assert.equal(result.memberForces.length, 235, `${name}: alle staven`);
  assert.equal(result.reactions.length, 25, `${name}: alle steunpunten`);
  assert.equal(result.equilibrium?.equilibriumOk, true, `${name}: kerncontrole`);
  assert.equal(balance.ok, true, `${name}: onafhankelijke kracht- en momentbalans`);
  for (const [axis, value] of Object.entries(expectedForces)) {
    close(sum(result.reactions, axis), value, 1e-4, `${name}: reactie ${axis}`);
  }
  for (const [axis, value] of Object.entries(expectedMoments)) {
    const lever = result.reactions.reduce((total, reaction) => {
      const node = nodes[reaction.nodeId - 1];
      if (axis === "mx") return total + node.y * reaction.fz - node.z * reaction.fy;
      if (axis === "my") return total + node.z * reaction.fx - node.x * reaction.fz;
      return total + node.x * reaction.fy - node.y * reaction.fx;
    }, 0);
    close(sum(result.reactions, axis) + lever, value, 1e-3, `${name}: moment ${axis}`);
  }
};

// Analytisch uit ΣF=0 en ΣM=0. Voor de 25 dakknopen geldt gemiddelde
// x=y=8 m; voor de 20 dakliggers geldt q·L=−12 kN per ligger.
const roof = await solve(1);
check(roof, { fx: 0, fy: 0, fz: 300 }, { mx: 2400, my: -2400, mz: 0 }, "daklast");
for (const reaction of roof.result.reactions) {
  close(reaction.fz, 12, 1e-5, `symmetrische daklast, steun ${reaction.nodeId}`);
}
const wind = await solve(2);
check(wind, { fx: 0, fy: -100, fz: 0 }, { mx: 900, my: 0, mz: -800 }, "wind Y");
const distributed = await solve(3);
check(distributed, { fx: 0, fy: 0, fz: 240 }, { mx: 1920, my: -1920, mz: 0 }, "dakliggerlast");
const eccentric = await solve(4);
check(eccentric, { fx: -15, fy: 0, fz: 10 }, { mx: 0, my: -155, mz: 210 }, "excentrisch");
const combined = await solve(new Map([[1, 1], [2, 1], [3, 1], [4, 1]]));
check(combined, { fx: -15, fy: -100, fz: 550 }, { mx: 5220, my: -4475, mz: -590 }, "vier gevallen samen");
for (const collection of ["displacements", "reactions", "memberForces"]) {
  for (const [index, actual] of combined.result[collection].entries()) {
    for (const [key, value] of Object.entries(actual)) {
      if (typeof value !== "number" || key.endsWith("Id") || key === "lengthM") continue;
      const expected = [roof, wind, distributed, eccentric]
        .reduce((total, solved) => total + solved.result[collection][index][key], 0);
      close(value, expected, 1e-5, `superpositie ${collection} ${index} ${key}`);
    }
  }
}
console.log(JSON.stringify({
  model: { nodes: 100, beams: 235, supports: 25, nodalLoads: 51, memberLoads: 20, memberPointLoads: 1 },
  cases: [roof, wind, distributed, eccentric, combined].map((solved, index) => ({
    name: ["daklast", "wind Y", "dakliggerlast", "excentrisch", "combinatie"][index],
    elapsedMs: +solved.elapsedMs.toFixed(1),
    maxTranslationMm: +Math.max(...solved.result.displacements.map((value) =>
      Math.hypot(value.ux, value.uy, value.uz) * 1000)).toFixed(5),
    maxDisplacementMm: +(frame3DMaximumDisplacementM(model, solved.result) * 1000).toFixed(5),
    maxForceImbalanceKn: solved.balance.maxImbalanceKn,
    maxMomentImbalanceKnm: solved.balance.maxMomentImbalanceKnm,
    relativeResidual: solved.result.equilibrium?.relativeResidual,
  })),
}, null, 2));
