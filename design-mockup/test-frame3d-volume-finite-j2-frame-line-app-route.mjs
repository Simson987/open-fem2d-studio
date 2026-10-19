import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const eSolidMpa = 1_200, nu = 0.2, eFrameMpa = 200_000;
const iyM4 = 0.2 * 0.1 ** 3 / 12;
const lineLoad = { id: 1, beamId: 77, caseId: 4, qyStart: 0, qyEnd: 0,
  qzStart: -4, qzEnd: -4, startPositionM: 0, endPositionM: 1 };
const base = parseFrame3DModel({
  nodes: [
    { id: 101, x: 0, y: 0, z: 0 }, { id: 205, x: 1, y: 0, z: 0 },
    { id: 306, x: 0, y: 1, z: 0 }, { id: 407, x: 0, y: 0, z: 1 },
    { id: 509, x: 2, y: 0, z: 0 },
  ],
  beams: [{ id: 77, startNodeId: 205, endNodeId: 509, profileName: "200x100",
    material: "VRIJ:Teststaal E=200000 rho=7850 f=235" }],
  volumes: [{ id: 21, kind: "tet4", nodeIds: [101, 205, 306, 407],
    eMpa: eSolidMpa, poisson: nu,
    materialLaw: { kind: "steelJ2", yieldMpa: 1e9, hardeningMpa: 0 } }],
  supports: [101, 306, 407].map(nodeId => ({ nodeId,
    ux: true, uy: true, uz: true, rx: false, ry: false, rz: false })).concat([{
    nodeId: 205, ux: true, uy: true, uz: false, rx: true, ry: true, rz: true,
  }]),
  loads: [], memberLoads: [lineLoad],
  materialLoadPath: [0.25, 1], volumeMaterialKinematics: "finiteStrain", volumeBackend: "dense",
});

const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
  requests.push(body.inputs.input);
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

const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`,
);
const shearForce = displacement => {
  // Exact finite Hencky shear force of this one-free-DOF Tet4: the volume is
  // 1/6 m³ and only node 205 moves in z. This is independent of Rust's
  // assembled residual and of the frame's equivalent nodal load routine.
  const mu = eSolidMpa / (2 * (1 + nu));
  return 1_000 * 2 * mu * Math.asinh(displacement / 2)
    / Math.sqrt(1 + (displacement / 2) ** 2) / 6;
};
const rootDisplacement = force => {
  let lo = -0.1, hi = 0.1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (shearForce(mid) < force) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
const tip = result => result.displacements.find(item => item.nodeId === 509);
const root = result => result.displacements.find(item => item.nodeId === 205);
const sumReactionZ = result => result.reactions.reduce((sum, item) => sum + item.fz, 0);

try {
  const line = await solveFrame3D(base, 4, "material", "openaec-native-fem");
  const sent = requests.at(-1);
  assert.equal(sent.frames.length, 1);
  assert.equal(sent.frameMemberLoadTargets.length, sent.volume.targets.length);
  assert.deepEqual(sent.frameMemberLoadTargets.map(target => target.map(load =>
    [load.element, load.qzStartKnPerM, load.qzEndKnPerM,
      load.startPositionM, load.endPositionM])),
  [[[0, -1, -1, 0, 1]], [[0, -4, -4, 0, 1]]]);
  assert.ok(sent.volume.targets.every(target => target.loadsKn.every(force =>
    force.every(value => value === 0))), "line load is not also a nodal target");
  assert.ok(sent.frameTargets.every(target => target.momentsKnM.every(moment =>
    moment.every(value => value === 0))), "line load is not also a nodal moment target");
  close(root(line).uz, rootDisplacement(-4), 2e-8, "Tet4 root under qL");
  close(tip(line).uz, rootDisplacement(-4) - 4 / (8 * 1_000 * eFrameMpa * iyM4),
    2e-8, "cantilever tip under uniform q");
  close(sumReactionZ(line), 4, 2e-6, "global z reaction");
  close(Math.abs(line.memberForces[0].vzStartKn), 4, 2e-6, "physical root shear");
  close(Math.abs(line.memberForces[0].myStartKnm), 2, 2e-6, "physical root moment qL²/2");
  close(line.memberForces[0].vzEndKn, 0, 2e-6, "physical free-end shear");
  close(line.memberForces[0].myEndKnm, 0, 2e-6, "physical free-end moment");
  assert.ok(line.forceBalance.ok && line.equilibrium.equilibriumOk);

  const half = await solveFrame3DCombination(base, new Map([[4, 0.5]]),
    "material", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).frameMemberLoadTargets.map(target =>
    target[0].qzStartKnPerM), [-0.5, -2]);
  close(root(half).uz, rootDisplacement(-2), 2e-8, "case-factor Tet4 root");
  close(Math.abs(half.memberForces[0].myStartKnm), 1, 2e-6,
    "case-factor physical root moment");
  assert.ok(half.forceBalance.ok && half.equilibrium.equilibriumOk);

  const partial = { ...lineLoad, id: 3, qzStart: -2, qzEnd: -5,
    startPositionM: 0.2, endPositionM: 0.8 };
  const tapered = await solveFrame3D({ ...base, memberLoads: [partial] },
    4, "material", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).frameMemberLoadTargets[1][0], {
    element: 0, qyStartKnPerM: 0, qyEndKnPerM: 0,
    qzStartKnPerM: -2, qzEndKnPerM: -5,
    startPositionM: 0.2, endPositionM: 0.8,
  });
  const a = partial.startPositionM, b = partial.endPositionM, span = b - a;
  const slope = (partial.qzEnd - partial.qzStart) / span;
  const intercept = partial.qzStart - slope * a;
  const force = (partial.qzStart + partial.qzEnd) * span / 2;
  const firstMoment = intercept * (b ** 2 - a ** 2) / 2
    + slope * (b ** 3 - a ** 3) / 3;
  // Independent tip influence integral: ∫q(x)x²(3L−x)/(6EI) dx, L=1.
  const tipPrimitive = x => intercept * x ** 3
    + (3 * slope - intercept) * x ** 4 / 4 - slope * x ** 5 / 5;
  const beamDeflection = (tipPrimitive(b) - tipPrimitive(a))
    / (6 * 1_000 * eFrameMpa * iyM4);
  close(root(tapered).uz, rootDisplacement(force), 2e-8,
    "partial trapezoid Tet4 root");
  close(tip(tapered).uz, rootDisplacement(force) + beamDeflection, 2e-8,
    "partial trapezoid cantilever tip");
  close(sumReactionZ(tapered), -force, 2e-6, "partial trapezoid reaction");
  close(Math.abs(tapered.memberForces[0].myStartKnm), Math.abs(firstMoment),
    2e-6, "partial trapezoid physical root moment");
  close(tapered.memberForces[0].vzEndKn, 0, 2e-6,
    "partial trapezoid physical free-end shear");
  assert.ok(tapered.forceBalance.ok && tapered.equilibrium.equilibriumOk);

  const point = { id: 2, beamId: 77, caseId: 4, py: 0, pz: -2, positionM: 0.5 };
  const loaded = await solveFrame3D({ ...base, memberPointLoads: [point] },
    4, "material", "openaec-native-fem");
  assert.equal(requests.at(-1).frameMemberLoadTargets[1][0].qzStartKnPerM, -4);
  assert.deepEqual(requests.at(-1).frameMemberPointLoadTargets, [
    [{ element: 0, pyKn: 0, pzKn: -0.5, positionM: 0.5 }],
    [{ element: 0, pyKn: 0, pzKn: -2, positionM: 0.5 }],
  ]);
  assert.ok(requests.at(-1).volume.targets.every(target => target.loadsKn.every(force =>
    force.every(value => value === 0))), "line and point loads must not enter nodal targets twice");
  assert.ok(requests.at(-1).frameTargets.every(target => target.momentsKnM.every(moment =>
    moment.every(value => value === 0))), "line and point loads must not enter nodal moment targets twice");
  close(root(loaded).uz, rootDisplacement(-6), 2e-8, "line plus point Tet4 root");
  close(tip(loaded).uz, rootDisplacement(-6)
    - 4 / (8 * 1_000 * eFrameMpa * iyM4)
    - 2 * 0.5 ** 2 * (3 - 0.5) / (6 * 1_000 * eFrameMpa * iyM4),
  2e-8, "line plus point cantilever tip");
  close(sumReactionZ(loaded), 6, 2e-6, "line plus point reaction");
  close(Math.abs(loaded.memberForces[0].vzStartKn), 6, 2e-6,
    "line plus point physical root shear");
  close(Math.abs(loaded.memberForces[0].myStartKnm), 3, 2e-6,
    "line plus point physical root moment");
  close(loaded.memberForces[0].vzEndKn, 0, 2e-6,
    "line plus point physical free-end shear");
  assert.ok(loaded.forceBalance.ok && loaded.equilibrium.equilibriumOk);

  const pointOnly = await solveFrame3D({ ...base, memberLoads: [], memberPointLoads: [point] },
    4, "material", "openaec-native-fem");
  assert.equal(requests.at(-1).frameMemberLoadTargets, undefined);
  assert.equal(requests.at(-1).frameMemberPointLoadTargets[1][0].pzKn, -2);
  close(root(pointOnly).uz, rootDisplacement(-2), 2e-8, "native point-only Tet4 root");
  close(tip(pointOnly).uz, rootDisplacement(-2)
    - 2 * 0.5 ** 2 * (3 - 0.5) / (6 * 1_000 * eFrameMpa * iyM4),
  2e-8, "native point-only cantilever tip");
  close(sumReactionZ(pointOnly), 2, 2e-6, "native point-only reaction");
  close(Math.abs(pointOnly.memberForces[0].vzStartKn), 2, 2e-6,
    "native point-only physical root shear");
  close(Math.abs(pointOnly.memberForces[0].myStartKnm), 1, 2e-6,
    "native point-only physical root moment");
  close(pointOnly.memberForces[0].vzEndKn, 0, 2e-6,
    "native point-only physical free-end shear");
  assert.ok(pointOnly.forceBalance.ok && pointOnly.equilibrium.equilibriumOk);

  const unloaded = await solveFrame3D({ ...base, memberPointLoads: [point],
    materialLoadPath: [0.25, 1, 0] },
    4, "material", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).frameMemberLoadTargets[2], []);
  assert.deepEqual(requests.at(-1).frameMemberPointLoadTargets[2], []);
  close(tip(unloaded).uz, 0, 2e-8, "absolute zero final line-load target");
  close(sumReactionZ(unloaded), 0, 2e-6, "unloaded reaction");
  close(unloaded.memberForces[0].vzStartKn, 0, 2e-6, "unloaded member shear");
  assert.ok(unloaded.forceBalance.ok && unloaded.equilibrium.equilibriumOk);

  const geometric = await solveFrame3D({ ...base, memberPointLoads: [point] },
    4, "combined", "openaec-native-fem");
  assert.equal(requests.at(-1).volume.options.geometricFrames, true);
  assert.deepEqual(requests.at(-1).frameMemberLoadTargets.map(target =>
    target[0].qzStartKnPerM), [-1, -4]);
  assert.deepEqual(requests.at(-1).frameMemberPointLoadTargets.map(target =>
    target[0].pzKn), [-0.5, -2]);
  close(sumReactionZ(geometric), 6, 2e-6, "combined geometric-frame reaction");
  close(geometric.memberForces[0].vzEndKn, 0, 2e-6,
    "combined geometric-frame physical free-end shear");
  close(Math.abs(geometric.memberForces[0].myStartKnm), 3, 2e-6,
    "combined geometric-frame physical root moment");
  assert.ok(geometric.forceBalance.ok && geometric.equilibrium.equilibriumOk);
  console.log("finite-J2 frame line/point app route: absolute path, case factor, partial trapezoid, native point recovery, unloading, combined analysis and independent cantilever balance OK");
} finally {
  globalThis.fetch = originalFetch;
}
