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
import { buildNativeGeometricShellRequest } from "./src/core/fem/nativeGeometricShellAdapter.ts";

const quadBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-quad2d", import.meta.url));
const meshBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-square-mesh", import.meta.url));
const hybridBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-hybrid-plate", import.meta.url));
const shellBinary = fileURLToPath(new URL("../src-tauri/target/debug/native-geometric-shell", import.meta.url));
if (!existsSync(quadBinary) || !existsSync(meshBinary) || !existsSync(hybridBinary) || !existsSync(shellBinary)) {
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

// Independent bilinear coupon: the uniaxial force fixes sigma=0.2 MPa.
// With E=210000 MPa, fy=0.1 MPa and Et/E=0.05, the exact total strain is
// fy/E + (sigma-fy)/Et = 1e-5, so a 1 m element extends by 10 micrometres.
const coupon = new Mesh();
const steel = { id: 1, name: "bilinear coupon", E: 210e9, nu: 0, rho: 0, color: "" };
coupon.materials.set(1, steel);
for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) coupon.addNode(x, y);
coupon.addQuadElement([1, 2, 4, 3], 1, 0.1);
coupon.nodes.get(1).constraints.x = true;
coupon.nodes.get(1).constraints.y = true;
coupon.nodes.get(3).constraints.x = true;
coupon.nodes.get(2).loads.fx = 10_000;
coupon.nodes.get(4).loads.fx = 10_000;
const couponRequest = buildNativeQuad2DRequest(coupon, "material",
  new Map([[1, { kind: "steelBilinear", yieldMpa: 0.1, hardeningRatio: 0.05 }]]), [1]);
const couponResult = await invoke(quadBinary, couponRequest);
close(couponResult.nodes.find(node => node.nodeId === 2).uxM, 1e-5, 1e-9,
  "bilineaire staalcoupon analytische verlenging");
close(couponResult.quads[0].averageStressMpa[0], 0.2, 1e-6,
  "bilineaire staalcoupon opgelegde spanning");
assert.ok(couponResult.quads[0].gaussPoints.every(point => point.equivalentPlasticStrain > 0));
assert.ok(couponResult.relativeResidual < 1e-8);

const crackingRequest = buildNativeQuad2DRequest(coupon, "material",
  new Map([[1, { kind: "concreteCracking", tensileMpa: 0.1, residualRatio: 0.05 }]]), [1]);
const crackingResult = await invoke(quadBinary, crackingRequest);
const crackedTrialStressMpa = 0.1 + (0.2 - 0.1) / 0.05;
close(crackingResult.nodes.find(node => node.nodeId === 2).uxM,
  crackedTrialStressMpa / 210_000, 1e-9,
  "betoncoupon analytische trekrek na tension damage");
close(crackingResult.quads[0].averageStressMpa[0], 0.2, 1e-6,
  "betoncoupon opgelegde spanning");
for (const point of crackingResult.quads[0].gaussPoints) {
  close(point.tensileDamage, 1 - 0.2 / crackedTrialStressMpa, 1e-7,
    "betoncoupon onafhankelijke damagefactor");
}
assert.ok(crackingResult.relativeResidual < 1e-8);

// Independent app-adapter coupon for secant-E FNL, unloading, and reloading.
// The adapter's N -> kN conversion gives 80 kN at each right edge node; the
// exact secant law at peak strain is 0.8 GPa and produces 2 mm extension.
const secantCoupon = new Mesh();
secantCoupon.materials.set(1, { id: 1, name: "secant coupon", E: 1_000e6, nu: 0, rho: 0, color: "" });
for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) secantCoupon.addNode(x, y);
secantCoupon.addQuadElement([1, 2, 4, 3], 1, 0.1);
secantCoupon.nodes.get(1).constraints.x = true;
secantCoupon.nodes.get(1).constraints.y = true;
secantCoupon.nodes.get(3).constraints.x = true;
secantCoupon.nodes.get(2).loads.fx = 80_000;
secantCoupon.nodes.get(4).loads.fx = 80_000;
const secantCurve = [{ materialId: 1, points: [
  { strain: 0, eMpa: 1_000 }, { strain: 0.002, eMpa: 800 },
] }];
const secantRequest = path => buildNativeQuad2DRequest(
  secantCoupon, "material", new Map(), path, secantCurve,
);
const secantLoaded = await invoke(quadBinary, secantRequest([1]));
close(secantLoaded.nodes.find(node => node.nodeId === 2).uxM, 0.002, 1e-8,
  "adapter secant-E piekverplaatsing");
assert.ok(secantLoaded.quads[0].gaussPoints.every(point =>
  Math.abs(point.effectiveEMpa - 800) < 2e-6
    && Math.abs(point.maxEquivalentStrain - 0.002) < 1e-8
    && Math.abs(point.stressMpa[0] - 1.6) < 1e-6));
close(secantLoaded.nodes.reduce((sum, node) => sum + node.rxKn, 0), -160, 2e-6,
  "adapter secant-E piekreactie");
const secantUnloaded = await invoke(quadBinary, secantRequest([1, 0]));
close(secantUnloaded.nodes.find(node => node.nodeId === 2).uxM, 0, 1e-8,
  "adapter secant-E volledige ontlasting");
assert.ok(secantUnloaded.quads[0].gaussPoints.every(point =>
  Math.abs(point.effectiveEMpa - 800) < 2e-6
    && Math.abs(point.maxEquivalentStrain - 0.002) < 1e-8));
const secantReloaded = await invoke(quadBinary, secantRequest([1, 0, 0.5]));
close(secantReloaded.nodes.find(node => node.nodeId === 2).uxM, 0.001, 1e-8,
  "adapter secant-E half-last herbelasting");
assert.ok(secantReloaded.quads[0].gaussPoints.every(point =>
  Math.abs(point.effectiveEMpa - 800) < 2e-6
    && Math.abs(point.maxEquivalentStrain - 0.002) < 1e-8
    && Math.abs(point.stressMpa[0] - 0.8) < 1e-6));
close(secantReloaded.nodes.reduce((sum, node) => sum + node.rxKn, 0), -80, 2e-6,
  "adapter secant-E herlaadreactie");
assert.ok(secantLoaded.relativeResidual < 1e-8 && secantUnloaded.relativeResidual < 1e-8
  && secantReloaded.relativeResidual < 1e-8);

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
const frontalBending = await invoke(hybridBinary,
  buildNativeHybridPlateRequest(bendingMesh, -1, [], [], undefined, [], [], 'frontalWave', 64));
assert.equal(frontalBending.linearBackendUsed, 'frontalWave');
assert.ok(frontalBending.frontalMaximumFrontDofs > 0
  && frontalBending.frontalMaximumFrontDofs <= 64);
assert.ok(frontalBending.relativeResidual < 1e-8);
for (const [index, node] of frontalBending.nodes.entries()) {
  assert.equal(node.nodeId, bending.nodes[index].nodeId);
  for (const key of ['wM', 'thetaXRad', 'thetaYRad', 'reactionFzKn', 'reactionMxKnm', 'reactionMyKnm']) {
    close(node[key], bending.nodes[index][key], 1e-8,
      `frontale hybride plaat knoop ${node.nodeId} ${key}`);
  }
}
for (const [index, element] of frontalBending.elements.entries()) {
  assert.equal(element.quadId, bending.elements[index].quadId);
  element.momentKnmPerM.forEach((value, component) =>
    close(value, bending.elements[index].momentKnmPerM[component], 1e-7,
      `frontale hybride plaat ${element.quadId} moment ${component}`));
}
const isotropicHybridMesh = new Mesh();
isotropicHybridMesh.materials.set(1, { ...bendingMesh.materials.get(1), orthotroop: {
  E1: 30e9, E2: 30e9, nu12: 0.2, G12: 30e9 / (2 * 1.2), hoek: 0,
} });
for (const node of nativeMesh.nodes) isotropicHybridMesh.addNode(node.x, node.y);
for (const quad of nativeMesh.quads) isotropicHybridMesh.addQuadElement(quad.nodeIds, 1, 0.1);
for (const node of isotropicHybridMesh.nodes.values()) {
  if (node.x === 0 || node.x === 2 || node.y === 0 || node.y === 2) node.constraints.y = true;
}
const isotropicHybrid = await invoke(hybridBinary,
  buildNativeHybridPlateRequest(isotropicHybridMesh, -1));
for (const [index, node] of bending.nodes.entries()) {
  close(isotropicHybrid.nodes[index].wM, node.wM, 1e-10, `isotroop-equivalent hybride plaat knoop ${node.nodeId} w`);
  close(isotropicHybrid.nodes[index].thetaXRad, node.thetaXRad, 1e-10,
    `isotroop-equivalent hybride plaat knoop ${node.nodeId} thetaX`);
  close(isotropicHybrid.nodes[index].thetaYRad, node.thetaYRad, 1e-10,
    `isotroop-equivalent hybride plaat knoop ${node.nodeId} thetaY`);
}
const orthoHybridMesh = new Mesh();
orthoHybridMesh.materials.set(1, { id: 1, name: "C24", E: 30e9, nu: 0, rho: 0, color: "",
  orthotroop: { E1: 30e9, E2: 15e9, nu12: 0, G12: 7e9, hoek: 23 * Math.PI / 180 } });
for (const node of nativeMesh.nodes) orthoHybridMesh.addNode(node.x, node.y);
for (const quad of nativeMesh.quads) orthoHybridMesh.addQuadElement(quad.nodeIds, 1, 0.1);
for (const node of orthoHybridMesh.nodes.values()) {
  if (node.x === 0 || node.x === 2 || node.y === 0 || node.y === 2) node.constraints.y = true;
}
const curve = [{ materialId: 1, points: [{ strain: 0, eMpa: 30_000 }, { strain: 1e-10, eMpa: 15_000 }] }];
const curvedOrthotropic = await invoke(hybridBinary, buildNativeHybridPlateRequest(orthoHybridMesh, -1, curve));
assert.ok(curvedOrthotropic.elements.every(element => Math.abs(element.effectiveEMpa - 15_000) < 1e-8));
const softOrthoMesh = new Mesh();
softOrthoMesh.materials.set(1, { id: 1, name: "C24-soft", E: 15e9, nu: 0, rho: 0, color: "",
  orthotroop: { E1: 15e9, E2: 7.5e9, nu12: 0, G12: 3.5e9, hoek: 23 * Math.PI / 180 } });
for (const node of nativeMesh.nodes) softOrthoMesh.addNode(node.x, node.y);
for (const quad of nativeMesh.quads) softOrthoMesh.addQuadElement(quad.nodeIds, 1, 0.1);
for (const node of softOrthoMesh.nodes.values()) {
  if (node.x === 0 || node.x === 2 || node.y === 0 || node.y === 2) node.constraints.y = true;
}
const fixedSoftOrthotropic = await invoke(hybridBinary, buildNativeHybridPlateRequest(softOrthoMesh, -1));
for (const [index, node] of curvedOrthotropic.nodes.entries()) {
  close(node.wM, fixedSoftOrthotropic.nodes[index].wM, 1e-9, `orthotroop secant-E hybride plaat knoop ${node.nodeId} w`);
}
for (const [index, element] of curvedOrthotropic.elements.entries()) {
  for (let component = 0; component < 3; component++) {
    close(element.momentKnmPerM[component], fixedSoftOrthotropic.elements[index].momentKnmPerM[component],
      1e-8, `orthotroop secant-E moment element ${element.quadId} ${component}`);
  }
}
const shellMembraneSupports = [{ nodeId: 1, u: true, v: true }, { nodeId: 4, u: true, v: true }];
const orthotropicShellRequest = buildNativeGeometricShellRequest(
  orthoHybridMesh, -1, curve, [1], undefined, [], [], shellMembraneSupports, [],
);
orthotropicShellRequest.analysis = "combined";
const orthotropicShell = await invoke(shellBinary, orthotropicShellRequest);
assert.ok(orthotropicShell.relativeResidual < 1e-7);
assert.ok(orthotropicShell.elements.every(element => Math.abs(element.effectiveEMpa - 15_000) < 1e-8));
const fixedSoftShellRequest = buildNativeGeometricShellRequest(
  softOrthoMesh, -1, [], [1], undefined, [], [], shellMembraneSupports, [],
);
fixedSoftShellRequest.analysis = "combined";
const fixedSoftShell = await invoke(shellBinary, fixedSoftShellRequest);
for (const [index, node] of orthotropicShell.nodes.entries()) {
  for (const key of ["uM", "vM", "wM", "thetaXRad", "thetaYRad"])
    close(node[key], fixedSoftShell.nodes[index][key], 1e-8,
      `orthotroop shell secant-E knoop ${node.nodeId} ${key}`);
}
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
const loadedRightEdge = nativeMesh.quads.find(quad => quad.nodeIds.filter(id =>
  nativeMesh.nodes.find(node => node.id === id).x === 2).length === 2);
assert.ok(loadedRightEdge);
const lineLoaded = await invoke(hybridBinary, buildNativeHybridPlateRequest(
  bendingMesh, 0, [], [], undefined, [], [{ quadId: loadedRightEdge.id, edgeIndex: 1,
    startKnPerM: -1, endKnPerM: -1 }],
));
close(lineLoaded.nodes.reduce((sum, node) => sum + node.reactionFzKn, 0), 1, 1e-7,
  "hybride plaat randlijnlast reactie");
assert.ok(lineLoaded.relativeResidual < 1e-8);
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
console.log("Native vierkantsmesh, Quad4 elastic/FNL-coupons en hybride buigplaat: vergelijkingen slagen.");
