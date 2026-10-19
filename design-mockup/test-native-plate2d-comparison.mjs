import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Matrix } from "./src/core/math/Matrix.ts";
import { solveLinearSystem } from "./src/core/math/LinearSolver.ts";
import { calculateElementStiffness, calculateElementStress } from "./src/core/fem/Triangle.ts";
import { Mesh } from "./src/core/fem/Mesh.ts";
import { buildNativePlate2DRequest } from "./src/core/fem/nativePlate2DAdapter.ts";

const suffix = process.platform === "win32" ? ".exe" : "";
const binary = fileURLToPath(new URL(`../src-tauri/target/debug/native-plate2d${suffix}`, import.meta.url));
if (!existsSync(binary)) {
  console.log("Vergelijking overgeslagen: bouw native-plate2d eerst.");
  process.exit(0);
}

function invoke(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", data => out.push(data));
    child.stderr.on("data", data => err.push(data));
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`${Buffer.concat(out)} ${Buffer.concat(err)}`));
      try { resolve(JSON.parse(Buffer.concat(out).toString())); }
      catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, TypeScript ${expected}, grens ${tolerance}`,
);
const nodes = [
  { id: 1, x: 0, y: 0 }, { id: 2, x: 2, y: 0 },
  { id: 3, x: 2, y: 1 }, { id: 4, x: 0, y: 1 },
];
const triangles = [
  { id: 1, nodeIds: [1, 2, 3], materialId: 1, thicknessM: 0.12 },
  { id: 2, nodeIds: [1, 3, 4], materialId: 1, thicknessM: 0.12 },
];
const supports = [
  { nodeId: 1, ux: true, uy: true },
  { nodeId: 4, ux: true, uy: true },
];
const loads = [{ nodeId: 2, fx: 85, fy: -12 }, { nodeId: 3, fx: 60, fy: -7 }];
const material = { id: 1, name: "referentie", E: 30_000e6, nu: 0.22, rho: 0, color: "" };
const mesh = new Mesh();
mesh.materials.set(1, material);
for (const node of nodes) {
  const added = mesh.addNode(node.x, node.y);
  assert.equal(added.id, node.id);
}
for (const triangle of triangles) {
  const added = mesh.addTriangleElement(triangle.nodeIds, triangle.materialId, triangle.thicknessM);
  assert.equal(added.id, triangle.id);
}
for (const support of supports) {
  mesh.nodes.get(support.nodeId).constraints.x = support.ux;
  mesh.nodes.get(support.nodeId).constraints.y = support.uy;
}
for (const load of loads) {
  mesh.nodes.get(load.nodeId).loads.fx += load.fx * 1000;
  mesh.nodes.get(load.nodeId).loads.fy += load.fy * 1000;
}
const request = buildNativePlate2DRequest(mesh);
assert.equal(request.materials[0].eMpa, 30_000);
assert.equal(request.loads[0].fx, 85);
mesh.beamElements.set(99, {});
assert.throws(() => buildNativePlate2DRequest(mesh), /staaf-plaatmodellen/);
mesh.beamElements.delete(99);
mesh.materials.set(1, { ...material, orthotroop: {
  E1: material.E, E2: material.E / 2, nu12: 0.2, G12: material.E / 6, hoek: 23 * Math.PI / 180,
} });
const orthotropicRequest = buildNativePlate2DRequest(mesh);
assert.equal(orthotropicRequest.orthotropicMaterials.length, 1);
assert.equal(orthotropicRequest.orthotropicMaterials[0].materialId, 1);
close(orthotropicRequest.orthotropicMaterials[0].e1Mpa, 30_000, 1e-9,
  "CST-appadapter E1 orthotroop materiaal");
const orthotropicResult = await invoke(orthotropicRequest);
assert.ok(orthotropicResult.relativeResidual < 1e-8);
assert.ok(orthotropicResult.elements.every(element => element.stressMpa.every(Number.isFinite)));
mesh.materials.set(1, material);
const own = await invoke(request);
const k = new Matrix(8, 8);
for (const triangle of triangles) {
  const elementNodes = triangle.nodeIds.map(id => nodes.find(node => node.id === id));
  const ke = calculateElementStiffness(...elementNodes, material, triangle.thicknessM, "plane_stress");
  const indices = triangle.nodeIds.flatMap(id => [2 * (id - 1), 2 * (id - 1) + 1]);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++)
    k.set(indices[i], indices[j], k.get(indices[i], indices[j]) + ke.get(i, j));
}
const f = Array(8).fill(0);
for (const load of loads) {
  f[2 * (load.nodeId - 1)] += load.fx * 1000;
  f[2 * (load.nodeId - 1) + 1] += load.fy * 1000;
}
const fixed = new Set(supports.flatMap(support => [2 * (support.nodeId - 1), 2 * (support.nodeId - 1) + 1]));
const free = [...Array(8).keys()].filter(index => !fixed.has(index));
const reduced = Matrix.fromArray(free.map(i => free.map(j => k.get(i, j))));
const solved = solveLinearSystem(reduced, free.map(i => f[i]));
const u = Array(8).fill(0);
free.forEach((index, i) => { u[index] = solved[i]; });
const r = k.multiplyVector(u).map((value, index) => (value - f[index]) / 1000);

for (const node of own.nodes) {
  const index = 2 * (node.nodeId - 1);
  close(node.uxM, u[index], 1e-10, `knoop ${node.nodeId} ux`);
  close(node.uyM, u[index + 1], 1e-10, `knoop ${node.nodeId} uy`);
  close(node.rxKn, fixed.has(index) ? r[index] : 0, 1e-7, `knoop ${node.nodeId} rx`);
  close(node.ryKn, fixed.has(index + 1) ? r[index + 1] : 0, 1e-7, `knoop ${node.nodeId} ry`);
}
for (const element of own.elements) {
  const triangle = triangles.find(item => item.id === element.triangleId);
  const ids = triangle.nodeIds;
  const displacement = ids.flatMap(id => [u[2 * (id - 1)], u[2 * (id - 1) + 1]]);
  const stress = calculateElementStress(...ids.map(id => nodes[id - 1]), material, displacement, "plane_stress");
  [stress.sigmaX, stress.sigmaY, stress.tauXY].forEach((value, i) =>
    close(element.stressMpa[i], value / 1e6, 1e-6, `driehoek ${triangle.id} spanning ${i}`));
}
assert.ok(own.relativeResidual < 1e-8);
console.log("Native 2D-vlakspanning: 2 CST-elementen stemmen overeen met de TypeScript-plaatkern.");
