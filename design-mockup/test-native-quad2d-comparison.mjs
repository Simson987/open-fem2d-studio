import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Matrix } from "./src/core/math/Matrix.ts";
import { solveLinearSystem } from "./src/core/math/LinearSolver.ts";
import { calculateQuadStiffness, calculateQuadStress } from "./src/core/fem/Quad4.ts";
import { genereerRasterMesh } from "./src/core/fem/PlaatMesher.ts";
import { Mesh } from "./src/core/fem/Mesh.ts";
import { buildNativeHybridPlateRequest, buildNativeQuad2DRequest } from "./src/core/fem/nativePlate2DAdapter.ts";

const quadBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-quad2d", import.meta.url));
const meshBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-square-mesh", import.meta.url));
const hybridBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-hybrid-plate", import.meta.url));
if (!existsSync(quadBinary) || !existsSync(meshBinary) || !existsSync(hybridBinary)) {
  console.log("Vergelijking overgeslagen: bouw de native vierhoeksbinaries eerst.");
  process.exit(0);
}
function invoke(binary, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const out = [], err = [];
    const timeout = setTimeout(() => child.kill(), 30_000);
    child.stdout.on("data", chunk => out.push(chunk));
    child.stderr.on("data", chunk => err.push(chunk));
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

const raster = genereerRasterMesh({ minX: 0, maxX: 2000, minZ: 0, maxZ: 2000,
  openingen: [], meshSize: 1000, meshType: "vierhoeken" });
const nativeMesh = await invoke(meshBinary, { originX: 0, originY: 0, widthM: 2, heightM: 2,
  cellSizeM: 1, materialId: 1, thicknessM: 0.1 });
assert.equal(nativeMesh.nodes.length, raster.points.length);
assert.deepEqual(nativeMesh.quads.map(quad => quad.nodeIds), raster.quads.map(quad => quad.map(index => index + 1)));
nativeMesh.nodes.forEach((node, index) => {
  close(node.x, raster.points[index].x / 1000, 1e-12, `mesh knoop ${index} x`);
  close(node.y, raster.points[index].z / 1000, 1e-12, `mesh knoop ${index} y`);
});

for (const distorted of [false, true]) {
  const mesh = new Mesh();
  const material = { id: 1, name: "referentie", E: 30e9, nu: 0.2, rho: 0, color: "" };
  mesh.materials.set(1, material);
  for (const node of nativeMesh.nodes) {
    const added = mesh.addNode(node.x + (distorted && node.id === 5 ? 0.15 : 0),
      node.y + (distorted && node.id === 5 ? -0.1 : 0));
    assert.equal(added.id, node.id);
  }
  for (const quad of nativeMesh.quads) assert.equal(
    mesh.addQuadElement(quad.nodeIds, quad.materialId, quad.thicknessM).id, quad.id);
  for (const node of mesh.nodes.values()) {
    if (node.x === 0) node.constraints.x = true;
    if (node.y === 0) node.constraints.y = true;
  }
  for (const [index, id] of nativeMesh.rightNodeIds.entries()) {
    mesh.nodes.get(id).loads.fx = (index === 1 ? 100 : 50) * 1000;
  }
  const request = buildNativeQuad2DRequest(mesh);
  const own = await invoke(quadBinary, request);
  const nodes = [...mesh.nodes.values()];
  const n = nodes.length * 2;
  const k = new Matrix(n, n);
  for (const quad of request.quads) {
    const qnodes = quad.nodeIds.map(id => mesh.nodes.get(id));
    const ke = calculateQuadStiffness(...qnodes, material, quad.thicknessM, "plane_stress");
    const indices = quad.nodeIds.flatMap(id => [2 * (id - 1), 2 * (id - 1) + 1]);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++)
      k.set(indices[i], indices[j], k.get(indices[i], indices[j]) + ke.get(i, j));
  }
  const f = Array(n).fill(0);
  for (const load of request.loads) {
    f[2 * (load.nodeId - 1)] += load.fx * 1000;
    f[2 * (load.nodeId - 1) + 1] += load.fy * 1000;
  }
  const fixed = new Set(request.supports.flatMap(support => [
    ...(support.ux ? [2 * (support.nodeId - 1)] : []),
    ...(support.uy ? [2 * (support.nodeId - 1) + 1] : []),
  ]));
  const free = [...Array(n).keys()].filter(i => !fixed.has(i));
  const reduced = Matrix.fromArray(free.map(i => free.map(j => k.get(i, j))));
  const reducedU = solveLinearSystem(reduced, free.map(i => f[i]));
  const u = Array(n).fill(0);
  free.forEach((dof, index) => { u[dof] = reducedU[index]; });
  const reaction = k.multiplyVector(u).map((value, i) => (value - f[i]) / 1000);
  for (const node of own.nodes) {
    const i = 2 * (node.nodeId - 1);
    close(node.uxM, u[i], 1e-9, `knoop ${node.nodeId} ux`);
    close(node.uyM, u[i + 1], 1e-9, `knoop ${node.nodeId} uy`);
    close(node.rxKn, fixed.has(i) ? reaction[i] : 0, 1e-5, `knoop ${node.nodeId} rx`);
    close(node.ryKn, fixed.has(i + 1) ? reaction[i + 1] : 0, 1e-5, `knoop ${node.nodeId} ry`);
  }
  for (const quad of own.quads) {
    const source = request.quads.find(item => item.id === quad.quadId);
    const localU = source.nodeIds.flatMap(id => u.slice(2 * (id - 1), 2 * id));
    const stress = calculateQuadStress(...source.nodeIds.map(id => mesh.nodes.get(id)),
      material, localU, "plane_stress");
    [stress.sigmaX, stress.sigmaY, stress.tauXY].forEach((value, index) =>
      close(quad.averageStressMpa[index], value / 1e6, distorted ? 1e-3 : 1e-6,
        `vierhoek ${quad.quadId} spanning ${index}`));
  }
  assert.ok(own.relativeResidual < 1e-8);
}
const bendingMesh = new Mesh();
bendingMesh.materials.set(1, { id: 1, name: "plaat", E: 30e9, nu: 0.2, rho: 0, color: "" });
for (const node of nativeMesh.nodes) bendingMesh.addNode(node.x, node.y);
for (const quad of nativeMesh.quads) bendingMesh.addQuadElement(quad.nodeIds, 1, 0.1);
for (const node of bendingMesh.nodes.values()) {
  if (node.x === 0 || node.x === 2 || node.y === 0 || node.y === 2) node.constraints.y = true;
}
const bendingRequest = buildNativeHybridPlateRequest(bendingMesh, -1);
const bending = await invoke(hybridBinary, bendingRequest);
assert.ok(bending.nodes.find(node => node.nodeId === 5).wM < 0);
close(bending.nodes.reduce((sum, node) => sum + node.reactionFzKn, 0), 4, 1e-7, "hybride plaat reacties");
assert.ok(bending.relativeResidual < 1e-8);
const graded = await invoke(hybridBinary, buildNativeHybridPlateRequest(
  bendingMesh, 0, [], [], undefined,
  [...bendingMesh.elements.values()].map(element => ({
    quadId: element.id,
    nodalPressureKnM2: element.nodeIds.map(id => -bendingMesh.getNode(id).x),
  })),
));
close(graded.nodes.reduce((sum, node) => sum + node.reactionFzKn, 0), 4, 1e-7,
  "hybride plaat variabele druk reacties");
assert.ok(graded.relativeResidual < 1e-8);
const reinforcement = {
  limitState: "service", fckMpa: 20, fctmMpa: 2.2, gammaC: 1.5,
  fydMpa: 435, fywdMpa: 435, esMpa: 200000,
  coverMm: 20, barDiameterMm: 12,
  topXMm2PerM: 1000, topYMm2PerM: 1000,
  bottomXMm2PerM: 1000, bottomYMm2PerM: 1000,
  crackLimitMm: 0.3,
};
const service = await invoke(hybridBinary,
  buildNativeHybridPlateRequest(bendingMesh, -1, [], [], reinforcement));
assert.equal(service.elements[0].reinforcement.limitState, "service");
assert.equal(service.elements[0].reinforcement.checkedPoints, 21);
assert.equal(service.elements[0].reinforcement.crack.length, 4);
assert.equal(service.elements[0].reinforcement.shear, undefined);
console.log("Native vierkantsmesh, Quad4 en hybride buigplaat: adapter en vergelijkingen slagen.");
