import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Matrix } from "./src/core/math/Matrix.ts";
import { solveLinearSystem } from "./src/core/math/LinearSolver.ts";
import { calculateDKTStiffness, calculateElementMoments, computeDKTBMatrix } from "./src/core/fem/DKT.ts";
import { Mesh } from "./src/core/fem/Mesh.ts";
import { buildNativePlateBendingRequest, buildNativeHybridPlateRequest } from "./src/core/fem/nativePlate2DAdapter.ts";

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
mesh.nodes.get(5).constraints.springY = 100_000;
mesh.nodes.get(5).constraints.springRot = 20_000;
mesh.nodes.get(5).loads.fz = 10_000;
const request = buildNativePlateBendingRequest(mesh);
assert.equal(request.loads[0].fz, 10);
const mappedSpring = request.supports.find(support => support.nodeId === 5);
assert.deepEqual(mappedSpring, {
  nodeId: 5, w: false, thetaX: false, thetaY: false,
  kwKnPerM: 100, kthetaXKnmPerRad: 20, kthetaYKnmPerRad: 20,
});
const hybridMesh = new Mesh();
hybridMesh.materials.set(1, { id: 1, name: "beton", E: 30e9, nu: 0.2, rho: 2400, color: "" });
for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]]) hybridMesh.addNode(x, y);
hybridMesh.addQuadElement([1, 2, 3, 4], 1, 0.2);
hybridMesh.nodes.get(1).constraints.springY = 75_000;
hybridMesh.nodes.get(1).constraints.springRot = 12_000;
const mappedHybridSpring = buildNativeHybridPlateRequest(hybridMesh).supports[0];
assert.deepEqual(mappedHybridSpring, {
  nodeId: 1, w: false, thetaX: false, thetaY: false,
  kwKnPerM: 75, kthetaXKnmPerRad: 12, kthetaYKnmPerRad: 12,
});
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
// Independent app-unit stiffnesses: 100 kN/m and 20 kN m/rad become
// 100,000 N/m and 20,000 N m/rad in this SI reference assembly.
k.set(3 * (5 - 1), 3 * (5 - 1), k.get(3 * (5 - 1), 3 * (5 - 1)) + 100_000);
k.set(3 * (5 - 1) + 1, 3 * (5 - 1) + 1, k.get(3 * (5 - 1) + 1, 3 * (5 - 1) + 1) + 20_000);
k.set(3 * (5 - 1) + 2, 3 * (5 - 1) + 2, k.get(3 * (5 - 1) + 2, 3 * (5 - 1) + 2) + 20_000);
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
  close(node.reactionFzKn, fixed.has(index) ? reaction[index]
    : node.nodeId === 5 ? -100 * node.wM : 0, 1e-6, `knoop ${node.nodeId} Rz`);
  if (node.nodeId === 5) {
    close(node.reactionFzKn, -100 * node.wM, 1e-9, "middenknoop verticale veerreactie");
    close(node.reactionMxKnm, -20 * node.thetaXRad, 1e-9, "middenknoop thetaX-veerreactie");
    close(node.reactionMyKnm, -20 * node.thetaYRad, 1e-9, "middenknoop thetaY-veerreactie");
  }
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
const frontalRequest = buildNativePlateBendingRequest(mesh, [], [], 'frontalWave');
assert.equal(frontalRequest.linearBackend, 'frontalWave');
const frontal = await invoke(frontalRequest);
assert.equal(frontal.linearBackendUsed, 'frontalWave');
assert.ok(frontal.frontalMaximumFrontDofs > 0);
assert.ok(frontal.relativeResidual < 1e-8);
for (const [index, node] of frontal.nodes.entries()) {
  const sparseNode = own.nodes[index];
  assert.equal(node.nodeId, sparseNode.nodeId);
  for (const key of ['wM', 'thetaXRad', 'thetaYRad', 'reactionFzKn', 'reactionMxKnm', 'reactionMyKnm']) {
    close(node[key], sparseNode[key], 1e-8, `frontale DKT knoop ${node.nodeId} ${key}`);
  }
}
for (const [index, element] of frontal.elements.entries()) {
  assert.equal(element.triangleId, own.elements[index].triangleId);
  element.momentKnmPerM.forEach((moment, component) =>
    close(moment, own.elements[index].momentKnmPerM[component], 1e-7,
      `frontale DKT driehoek ${element.triangleId} moment ${component}`));
}
assert.throws(() => buildNativePlateBendingRequest(mesh,
  [{ materialId: 1, points: [{ strain: 0, eMpa: 210_000 }] }], [], 'frontalWave'),
  /alleen lineaire elasticiteit/);
const steel = mesh.materials.get(1);
mesh.materials.set(1, { ...steel, E: 11e9, nu: 0.25, orthotroop: {
  E1: 11e9, E2: 370e6, nu12: 0.25, G12: 690e6, hoek: 23 * Math.PI / 180,
} });
const orthotropicRequest = buildNativePlateBendingRequest(mesh);
assert.equal(orthotropicRequest.orthotropicMaterials.length, 1);
close(orthotropicRequest.orthotropicMaterials[0].angleRad, 23 * Math.PI / 180, 1e-12,
  "DKT-appadapter hoofdrichting");
const orthotropic = await invoke(orthotropicRequest);
assert.ok(orthotropic.relativeResidual < 1e-8);
assert.ok(orthotropic.nodes.every(node => Number.isFinite(node.wM)));
assert.ok(orthotropic.elements.every(element => element.momentKnmPerM.every(Number.isFinite)));
const ortho = orthotropicRequest.orthotropicMaterials[0];
const nu21 = ortho.nu12 * ortho.e2Mpa / ortho.e1Mpa;
const denominator = 1 - ortho.nu12 * nu21;
const localQ = [
  [ortho.e1Mpa * 1e6 / denominator, ortho.nu12 * ortho.e2Mpa * 1e6 / denominator, 0],
  [ortho.nu12 * ortho.e2Mpa * 1e6 / denominator, ortho.e2Mpa * 1e6 / denominator, 0],
  [0, 0, ortho.g12Mpa * 1e6],
];
const c = Math.cos(ortho.angleRad), s = Math.sin(ortho.angleRad);
const transform = [[c*c, s*s, c*s], [s*s, c*c, -c*s], [-2*c*s, 2*c*s, c*c-s*s]];
const Db = Array.from({ length: 3 }, (_, i) => Array.from({ length: 3 }, (_, j) =>
  0.02 ** 3 / 12 * localQ.reduce((sum, row, a) => sum + row.reduce((part, value, b) =>
    part + transform[a][i] * value * transform[b][j], 0), 0)));
const referenceK = Array.from({ length: 27 }, () => Array(27).fill(0));
const referenceElementMatrices = [];
const gauss = [[2/3, 1/6, 1/6], [1/6, 2/3, 1/6], [1/6, 1/6, 2/3]];
for (const triangle of triangles) {
  const elemNodes = triangle.nodeIds.map(id => nodes[id - 1]);
  const area = Math.abs((elemNodes[1].x - elemNodes[0].x) * (elemNodes[2].y - elemNodes[0].y)
    - (elemNodes[2].x - elemNodes[0].x) * (elemNodes[1].y - elemNodes[0].y)) / 2;
  const ke = Array.from({ length: 9 }, () => Array(9).fill(0));
  for (const [l1, l2, l3] of gauss) {
    const bmat = computeDKTBMatrix(...elemNodes, l1, l2, l3);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
      ke[i][j] += area / 3 * Db.reduce((sum, row, a) => sum + row.reduce((part, value, d) =>
        part + bmat.get(a, i) * value * bmat.get(d, j), 0), 0);
    }
  }
  referenceElementMatrices.push(ke);
  const global = triangle.nodeIds.flatMap(id => [3 * (id - 1), 3 * (id - 1) + 1, 3 * (id - 1) + 2]);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++)
    referenceK[global[i]][global[j]] += ke[i][j];
}
referenceK[12][12] += 100_000;
referenceK[13][13] += 20_000;
referenceK[14][14] += 20_000;
const fixedW = new Set(supports.map(support => 3 * (support.nodeId - 1)));
const freeDofs = Array.from({ length: 27 }, (_, dof) => dof).filter(dof => !fixedW.has(dof));
const reducedK = freeDofs.map(i => freeDofs.map(j => referenceK[i][j]));
const referenceLoad = Array(27).fill(0);
referenceLoad[12] = 10_000;
const orthotropicReducedU = solveLinearSystem(Matrix.fromArray(reducedK), freeDofs.map(dof => referenceLoad[dof]));
const referenceU = Array(27).fill(0);
freeDofs.forEach((dof, i) => { referenceU[dof] = orthotropicReducedU[i]; });
for (const node of orthotropic.nodes) {
  const dof = 3 * (node.nodeId - 1);
  close(node.wM, referenceU[dof], 1e-10, `orthotrope DKT knoop ${node.nodeId} w`);
  close(node.thetaXRad, referenceU[dof + 1], 1e-10, `orthotrope DKT knoop ${node.nodeId} thetaX`);
  close(node.thetaYRad, referenceU[dof + 2], 1e-10, `orthotrope DKT knoop ${node.nodeId} thetaY`);
}
for (const [index, triangle] of triangles.entries()) {
  const elemNodes = triangle.nodeIds.map(id => nodes[id - 1]);
  const bmat = computeDKTBMatrix(...elemNodes, 1/3, 1/3, 1/3);
  const dofs = triangle.nodeIds.flatMap(id => [3 * (id - 1), 3 * (id - 1) + 1, 3 * (id - 1) + 2]);
  const curvature = Array.from({ length: 3 }, (_, row) => dofs.reduce((sum, dof, col) =>
    sum + bmat.get(row, col) * referenceU[dof], 0));
  const expectedMoment = Db.map(row => row.reduce((sum, value, col) => sum + value * curvature[col], 0));
  expectedMoment.forEach((value, component) => close(
    orthotropic.elements[index].momentKnmPerM[component] * 1000, value, 1e-5,
    `orthotroop DKT element ${triangle.id} moment ${component}`));
}
const modulusCurve = [{ materialId: 1, points: [
  { strain: 0, eMpa: 11_000 }, { strain: 1e-12, eMpa: 5_500 },
] }];
const nonlinear = await invoke(buildNativePlateBendingRequest(mesh, modulusCurve, [1, 0, 1]));
// Independent linear reference assembled from the computed softened Qbar.
// The sampled FNL curve saturates at 50% E, while the translational and
// rotational springs retain their full stiffness.
const softGlobalK = referenceK.map(row => row.map(value => value * 0.5));
softGlobalK[12][12] += 50_000;
softGlobalK[13][13] += 10_000;
softGlobalK[14][14] += 10_000;
const softReducedK = freeDofs.map(i => freeDofs.map(j => softGlobalK[i][j]));
const softReducedU = solveLinearSystem(Matrix.fromArray(softReducedK),
  freeDofs.map(dof => referenceLoad[dof]));
const softReferenceU = Array(27).fill(0);
freeDofs.forEach((dof, i) => { softReferenceU[dof] = softReducedU[i]; });
for (const [index, node] of nonlinear.nodes.entries()) {
  const dof = 3 * (node.nodeId - 1);
  close(node.wM, softReferenceU[dof], 1e-10, `DKT secant-E knoop ${node.nodeId} w`);
  close(node.thetaXRad, softReferenceU[dof + 1], 1e-10,
    `DKT secant-E knoop ${node.nodeId} thetaX`);
  close(node.thetaYRad, softReferenceU[dof + 2], 1e-10,
    `DKT secant-E knoop ${node.nodeId} thetaY`);
}
for (const [index, element] of nonlinear.elements.entries()) {
  close(element.effectiveEMpa, 5_500, 1e-8, `DKT secant-E driehoek ${element.triangleId}`);
  assert.ok(element.maxFibreStrain > 1e-12);
  const triangle = triangles[index];
  const elemNodes = triangle.nodeIds.map(id => nodes[id - 1]);
  const bmat = computeDKTBMatrix(...elemNodes, 1/3, 1/3, 1/3);
  const dofs = triangle.nodeIds.flatMap(id => [3 * (id - 1), 3 * (id - 1) + 1, 3 * (id - 1) + 2]);
  const curvature = Array.from({ length: 3 }, (_, row) => dofs.reduce((sum, dof, col) =>
    sum + bmat.get(row, col) * softReferenceU[dof], 0));
  const expectedMoment = Db.map(row => row.reduce((sum, value, col) =>
    sum + 0.5 * value * curvature[col], 0));
  element.momentKnmPerM.forEach((value, axis) => close(
    value * 1000, expectedMoment[axis], 1e-5,
    `DKT secant-E moment driehoek ${element.triangleId} as ${axis}`));
}
console.log("Native DKT-plaatbuiging: onafhankelijke assemblage, orthotropie en secant-E/FNL slagen.");
