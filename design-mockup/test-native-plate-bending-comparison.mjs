import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Matrix } from "./src/core/math/Matrix.ts";
import { solveLinearSystem } from "./src/core/math/LinearSolver.ts";
import { calculateDKTStiffness, calculateElementMoments } from "./src/core/fem/DKT.ts";
import { Mesh } from "./src/core/fem/Mesh.ts";
import { buildNativePlateBendingRequest } from "./src/core/fem/nativePlate2DAdapter.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-plate-bending", import.meta.url));
if (!existsSync(binary)) {
  console.log("Vergelijking overgeslagen: bouw native-plate-bending eerst.");
  process.exit(0);
}
function invoke(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [], errors = [];
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`${Buffer.concat(chunks)} ${Buffer.concat(errors)}`));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (error) { reject(error); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, TypeScript ${expected}, grens ${tolerance}`,
);

const nodes = [];
for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) nodes.push({ id: 1 + 3 * y + x, x, y });
const triangles = [];
for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
  const bl = 1 + 3 * y + x, br = bl + 1, tl = bl + 3, tr = tl + 1;
  triangles.push({ id: triangles.length + 1, nodeIds: [bl, br, tr], materialId: 1, thicknessM: 0.02 });
  triangles.push({ id: triangles.length + 1, nodeIds: [bl, tr, tl], materialId: 1, thicknessM: 0.02 });
}
const supports = nodes.filter(node => node.x === 0 || node.x === 2 || node.y === 0 || node.y === 2)
  .map(node => ({ nodeId: node.id, w: true, thetaX: false, thetaY: false }));
const mesh = new Mesh();
mesh.materials.set(1, { id: 1, name: "staal", E: 210e9, nu: 0.3, rho: 7850, color: "" });
for (const node of nodes) assert.equal(mesh.addNode(node.x, node.y).id, node.id);
for (const triangle of triangles) {
  assert.equal(mesh.addTriangleElement(triangle.nodeIds, triangle.materialId, triangle.thicknessM).id, triangle.id);
}
for (const support of supports) mesh.nodes.get(support.nodeId).constraints.y = true;
mesh.nodes.get(5).loads.fz = 10_000;
const request = buildNativePlateBendingRequest(mesh);
assert.equal(request.loads[0].fz, 10);
const own = await invoke(request);
const material = { E: 210e9, nu: 0.3 };
const k = new Matrix(27, 27);
for (const triangle of triangles) {
  const elementNodes = triangle.nodeIds.map(id => nodes[id - 1]);
  const ke = calculateDKTStiffness(...elementNodes, material, triangle.thicknessM);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    const row = 3 * (triangle.nodeIds[Math.floor(i / 3)] - 1) + i % 3;
    const col = 3 * (triangle.nodeIds[Math.floor(j / 3)] - 1) + j % 3;
    k.set(row, col, k.get(row, col) + ke.get(i, j));
  }
}
const f = Array(27).fill(0);
f[3 * (5 - 1)] = 10_000;
const fixed = new Set(supports.map(support => 3 * (support.nodeId - 1)));
const free = [...Array(27).keys()].filter(i => !fixed.has(i));
const reduced = Matrix.fromArray(free.map(i => free.map(j => k.get(i, j))));
const reducedU = solveLinearSystem(reduced, free.map(i => f[i]));
const u = Array(27).fill(0);
free.forEach((dof, index) => { u[dof] = reducedU[index]; });
const reaction = k.multiplyVector(u).map((value, i) => (value - f[i]) / 1000);
for (const node of own.nodes) {
  const index = 3 * (node.nodeId - 1);
  close(node.wM, u[index], 1e-10, `knoop ${node.nodeId} w`);
  close(node.thetaXRad, u[index + 1], 1e-10, `knoop ${node.nodeId} thetaX`);
  close(node.thetaYRad, u[index + 2], 1e-10, `knoop ${node.nodeId} thetaY`);
  close(node.reactionFzKn, fixed.has(index) ? reaction[index] : 0, 1e-6, `knoop ${node.nodeId} Rz`);
}
for (const element of own.elements) {
  const triangle = triangles[element.triangleId - 1];
  const ids = triangle.nodeIds;
  const localU = ids.flatMap(id => u.slice(3 * (id - 1), 3 * id));
  const moments = calculateElementMoments(...ids.map(id => nodes[id - 1]), material, triangle.thicknessM, localU);
  [moments.mx, moments.my, moments.mxy].forEach((value, index) =>
    close(element.momentKnmPerM[index], value / 1000, 1e-7, `driehoek ${triangle.id} moment ${index}`));
}
assert.ok(own.relativeResidual < 1e-8);
console.log("Native DKT-plaatbuiging: 8 driehoeken stemmen overeen met de TypeScript-kern.");
