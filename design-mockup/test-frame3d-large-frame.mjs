import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { deserializeProject, serializeProject } from "./src/io/projectFile.ts";

// Twee bouwlagen, 3 × 3 vakken. Deze grootte activeert ook de 3D-profielinstancing.
const nx = 4, ny = 4, nz = 3;
const nodeId = (ix, iy, iz) => 1 + iz * nx * ny + iy * nx + ix;
const nodes = [];
for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  nodes.push({ id: nodeId(ix, iy, iz), x: ix * 3, y: iy * 4, z: iz * 3.5 });
}
const beams = [];
const addBeam = (a, b, profileName) => {
  beams.push({ id: beams.length + 1, startNodeId: a, endNodeId: b, profileName, material: "S235" });
};
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
  loads.push({ id: loads.length + 1, nodeId: id, caseId: 1, fx: 0, fy: 0, fz: -20, mx: 0, my: 0, mz: 0 });
  loads.push({ id: loads.length + 1, nodeId: id, caseId: 2, fx: 2, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 });
}
const memberLoads = beams.filter((beam) => {
  const a = nodes[beam.startNodeId - 1], b = nodes[beam.endNodeId - 1];
  return a.z === 7 && b.z === 7 && a.y === b.y;
}).map((beam, index) => ({
  id: index + 1, beamId: beam.id, caseId: 3,
  qyStart: 0, qyEnd: 0, qzStart: -2, qzEnd: -2,
  startPositionM: 0, endPositionM: 3,
}));
const model = parseFrame3DModel({ nodes, beams, supports, loads, memberLoads });
assert.equal(model.nodes.length, 48);
assert.equal(model.beams.length, 104);
assert.equal(memberLoads.length, 12);

const fixturePath = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/groot-staalraam.ifcfem2d", import.meta.url));
const project = {
  nodes: [], beams: [], supports: [], plates: [], loads: [],
  loadCases: [
    { id: 1, name: "Daklast", type: "dead" },
    { id: 2, name: "Horizontale belasting", type: "wind" },
    { id: 3, name: "Liggerlast", type: "live" },
  ],
  activeLoadCaseId: 1, selfWeightEnabled: false, nonlinearEnabled: true,
  analysetype: "tweedeOrdeGeometrisch", modelDimension: "3d", model3d: model,
  projectInfo: { name: "Verificatie groot 3D staalraam", projectNumber: "VF-3D-GROOT-01" },
};
if (process.argv.includes("--write-fixture")) {
  writeFileSync(fixturePath, serializeProject(project));
}
assert.ok(existsSync(fixturePath), "het GUI-verificatieproject moet aanwezig zijn");
const opened = deserializeProject(readFileSync(fixturePath, "utf8"));
assert.deepEqual(opened.model3d, model, "het project bewaart alle 3D-knopen, staven en belastingen");

const solverBinary = process.platform === "win32" ? "frame3d-solver.exe" : "frame3d-solver";
const solverPath = fileURLToPath(new URL(`../src-tauri/target/debug/${solverBinary}`, import.meta.url));
if (!existsSync(solverPath)) {
  console.log("Groot 3D-project en belastingen gevalideerd; bouw de 3D-rekenkern voor de numerieke verificatie.");
  process.exit(0);
}
const solve = (analysis, factors) => {
  const request = { ...buildFrame3DSolveRequest(model, analysis, factors), bucklingModes: 0 };
  const started = performance.now();
  const result = JSON.parse(execFileSync(solverPath, { input: JSON.stringify(request), maxBuffer: 16 * 1024 * 1024 }).toString());
  return { result, elapsedMs: performance.now() - started };
};
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: verwacht ${expected}, berekend ${actual}, grens ${tolerance}`,
);
const check = (result, forces, moments, label) => {
  assert.equal(result.displacements.length, 48, `${label}: alle knoopverplaatsingen`);
  assert.equal(result.memberForces.length, 104, `${label}: alle staafkrachten`);
  assert.ok(result.displacements.every((d) =>
    [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz].every(Number.isFinite)), `${label}: eindige verplaatsingen`);
  if (result.equilibrium) assert.equal(result.equilibrium.equilibriumOk, true, `${label}: interne evenwichtscontrole`);
  for (const [axis, force] of Object.entries(forces)) {
    close(sum(result.reactions, axis), force, 1e-4, `${label}: som reactie ${axis}`);
  }
  for (const [axis, moment] of Object.entries(moments)) {
    const lever = result.reactions.reduce((total, reaction) => {
      const node = nodes[reaction.nodeId - 1];
      if (axis === "mx") return total + node.y * reaction.fz - node.z * reaction.fy;
      if (axis === "my") return total + node.z * reaction.fx - node.x * reaction.fz;
      return total + node.x * reaction.fy - node.y * reaction.fx;
    }, 0);
    close(sum(result.reactions, axis) + lever, moment, 1e-3, `${label}: moment ${axis} over oorsprong`);
  }
};

const gravity = solve("linear", 1);
check(gravity.result, { fx: 0, fy: 0, fz: 320 }, { mx: 1920, my: -1440, mz: 0 }, "daklast");
for (const reaction of gravity.result.reactions) {
  close(reaction.fz, 20, 1e-5, `symmetrische verticale reactie steun ${reaction.nodeId}`);
}
const lateral = solve("linear", 2);
check(lateral.result, { fx: -32, fy: 0, fz: 0 }, { mx: 0, my: -224, mz: 192 }, "horizontaal");
const distributed = solve("linear", 3);
check(distributed.result, { fx: 0, fy: 0, fz: 72 }, { mx: 432, my: -324, mz: 0 }, "verdeelde liggerlast");
const combined = solve("p-delta", new Map([[1, 1], [2, 1]]));
assert.equal(combined.result.displacements.length, 48);
assert.equal(combined.result.memberForces.length, 104);
assert.ok(combined.result.displacements.every((d) =>
  [d.ux, d.uy, d.uz, d.rx, d.ry, d.rz].every(Number.isFinite)));
assert.equal(combined.result.secondOrder?.converged, true, "tweede-orde-iteraties convergeren");
assert.equal(combined.result.secondOrder?.stable, true, "grote raamwerk blijft stabiel onder de gekozen lasten");
const secondOrderForceImbalanceKn = {
  fx: sum(combined.result.reactions, "fx") + 32,
  fy: sum(combined.result.reactions, "fy"),
  fz: sum(combined.result.reactions, "fz") - 320,
};

console.log(JSON.stringify({
  model: { nodes: 48, beams: 104, supports: 16, nodalLoads: 32, memberLoads: 12 },
  cases: [gravity, lateral, distributed, combined].map(({ result, elapsedMs }, index) => ({
    name: ["daklast", "horizontaal", "liggerlast", "combinatie tweede orde"][index],
    elapsedMs: +elapsedMs.toFixed(1),
    relativeResidual: result.equilibrium?.relativeResidual,
    secondOrder: result.secondOrder,
  })),
  secondOrderForceImbalanceKn,
}, null, 2));
