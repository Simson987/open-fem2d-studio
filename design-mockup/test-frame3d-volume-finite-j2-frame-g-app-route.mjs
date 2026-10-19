import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const torqueKnm = 0.05;
const lengthM = 1;
const model = parseFrame3DModel({
  nodes: [
    { id: 101, x: 0, y: 0, z: 0 }, { id: 205, x: 1, y: 0, z: 0 },
    { id: 306, x: 0, y: 1, z: 0 }, { id: 407, x: 0, y: 0, z: 1 },
    { id: 509, x: 2, y: 0, z: 0 },
  ],
  beams: [{ id: 77, startNodeId: 205, endNodeId: 509,
    material: "GL24h", profileName: "200x100" }],
  volumes: [{ id: 21, kind: "tet4", nodeIds: [101, 205, 306, 407],
    eMpa: 1200, poisson: 0.2,
    materialLaw: { kind: "steelJ2", yieldMpa: 1e9, hardeningMpa: 0 } }],
  supports: [101, 205, 306, 407].map(nodeId => ({ nodeId,
    ux: true, uy: true, uz: true, rx: true, ry: true, rz: true })).concat([{
    nodeId: 509, ux: true, uy: true, uz: true, rx: false, ry: true, rz: true,
  }]),
  loads: [{ id: 1, nodeId: 509, caseId: 4,
    fx: 0, fy: 0, fz: 0, mx: torqueKnm, my: 0, mz: 0 }],
  materialLoadPath: [0.25, 1], volumeMaterialKinematics: "finiteStrain",
  volumeBackend: "dense",
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

try {
  const result = await solveFrame3D(model, 4, "material", "openaec-native-fem");
  const sent = requests.at(-1);
  assert.equal(sent.frames.length, 1);
  assert.equal(sent.frames[0].youngsMpa, 11_500);
  assert.equal(sent.frames[0].gMpa, 650);
  const { youngsMpa, poisson, gMpa, torsionJM4 } = sent.frames[0];
  const isotropicG = youngsMpa / (2 * (1 + poisson));
  assert.ok(Math.abs(gMpa / isotropicG - 1) > 0.5,
    "GL24h independent G must distinguish this test from isotropic fallback");
  assert.deepEqual(sent.frameTargets.map(target => target.momentsKnM[4][0]),
    [torqueKnm * 0.25, torqueKnm]);
  assert.ok(sent.volume.targets.every(target => target.loadsKn.every(force =>
    force.every(value => value === 0))), "torsion is a frame moment only");

  // A cantilever with only its free-end Rx active has one exact torsional DOF.
  // G is MPa = 1000 kN/m²; Saint-Venant theory gives phi = T L/(1000 G J).
  const expectedTwist = torqueKnm * lengthM / (1_000 * gMpa * torsionJM4);
  const tipTwist = result.displacements.find(node => node.nodeId === 509).rx;
  close(tipTwist, expectedTwist, 2e-8, "GL24h coupled twist TL/GJ");
  assert.ok(Math.abs(tipTwist - torqueKnm * lengthM / (1_000 * isotropicG * torsionJM4))
    > expectedTwist * 0.5, "the isotropic fallback would produce a different twist");
  close(result.reactions.reduce((sum, node) => sum + node.mx, 0), -torqueKnm,
    2e-7, "global torsional reaction");
  close(Math.abs(result.memberForces[0].torsionStartKnm), torqueKnm, 2e-7,
    "root torsional end force");
  close(Math.abs(result.memberForces[0].torsionEndKnm), torqueKnm, 2e-7,
    "tip torsional end force");
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);

  const half = await solveFrame3DCombination(model, new Map([[4, 0.5]]),
    "material", "openaec-native-fem");
  assert.deepEqual(requests.at(-1).frameTargets.map(target => target.momentsKnM[4][0]),
    [torqueKnm * 0.125, torqueKnm * 0.5]);
  close(half.displacements.find(node => node.nodeId === 509).rx,
    expectedTwist * 0.5, 2e-8, "half-factor coupled twist");
  assert.ok(half.forceBalance.ok && half.equilibrium.equilibriumOk);
  console.log(`finite-J2 GL24h frame G app route: g=${gMpa} MPa, twist=${tipTwist.toExponential(8)} rad, independent TL/(1000GJ)=${expectedTwist.toExponential(8)} rad, balance OK`);
} finally {
  globalThis.fetch = originalFetch;
}
