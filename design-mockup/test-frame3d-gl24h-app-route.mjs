import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";

// Cantilever along the grain. Closed-form Euler-Bernoulli bending and Saint-Venant
// torsion provide independent references for E0,mean and Gmean respectively.
const lengthM = 4;
const tipForceKn = -1;
const tipTorqueKnm = 0.5;
const bM = 0.16;
const hM = 0.4;
const eKnM2 = 11_500_000;
const gKnM2 = 650_000;
const iyM4 = bM * hM ** 3 / 12;
const longMm = 400;
const shortMm = 160;
const jM4 = longMm * shortMm ** 3
  * (1 / 3 - 0.21 * (shortMm / longMm) * (1 - shortMm ** 4 / (12 * longMm ** 4))) * 1e-12;
const model = parseFrame3DModel({
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: lengthM, y: 0, z: 0 }],
  beams: [{ id: 1, startNodeId: 1, endNodeId: 2, material: "GL24h", profileName: "160x400" }],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: [{ id: 1, nodeId: 2, caseId: 1, fx: 0, fy: 0, fz: tipForceKn,
    mx: tipTorqueKnm, my: 0, mz: 0 }],
});
const request = buildFrame3DSolveRequest(model, "linear", 1);
assert.equal(request.materials[0].eMpa, 11_500);
assert.equal(request.materials[0].gMpa, 650);
assert.ok(Math.abs(request.sections[0].iyM4 - iyM4) < 1e-15);
assert.ok(Math.abs(request.sections[0].torsionJM4 - jM4) < 1e-15);
await assert.rejects(() => solveFrame3D(model, 1, "linear", "dedaliano"), /Open FEM Rust/);

const binary = fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const invoke = (input) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [];
  const errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(input));
});

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "frame3d");
  const result = await invoke(body);
  return new Response(JSON.stringify(result), { status: 200 });
};
try {
  const result = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  const tip = result.displacements.find((node) => node.nodeId === 2);
  assert.ok(tip);
  const expectedUz = tipForceKn * lengthM ** 3 / (3 * eKnM2 * iyM4);
  const expectedRx = tipTorqueKnm * lengthM / (gKnM2 * jM4);
  assert.ok(Math.abs((tip.uz - expectedUz) / expectedUz) < 1e-8,
    `GL24h buiging: ${tip.uz} m, verwacht ${expectedUz} m`);
  assert.ok(Math.abs((tip.rx - expectedRx) / expectedRx) < 1e-8,
    `GL24h torsie: ${tip.rx} rad, verwacht ${expectedRx} rad`);
  assert.ok(result.forceBalance.ok);
  console.log(`GL24h 3D-staaf geslaagd: uz=${tip.uz} m, rx=${tip.rx} rad`);
} finally {
  globalThis.fetch = originalFetch;
}
