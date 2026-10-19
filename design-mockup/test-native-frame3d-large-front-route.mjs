import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFrame3DSolveRequest, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const binary = fileURLToPath(new URL(
  `../src-tauri/target/debug/native-frame3d${process.platform === "win32" ? ".exe" : ""}`,
  import.meta.url,
));
const invoke = (request) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(`${Buffer.concat(output)} ${Buffer.concat(errors)}`)));
  child.stdin.end(JSON.stringify(request));
});

// The 20,010 global DOFs exceed the ordinary assembled-matrix cap. Fixed-root
// arms give an independent axial reference for every tip.
const arms = 3334;
const forceKn = 10;
const lengthM = 2;
const model = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0 }, ...Array.from({ length: arms }, (_, i) => ({
    id: i + 2, x: lengthM, y: 0, z: 0,
  }))],
  beams: Array.from({ length: arms }, (_, i) => ({
    id: i + 1, startNodeId: 1, endNodeId: i + 2,
    material: "S235", profileName: "IPE200",
  })),
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: true, ry: true, rz: true }],
  loads: Array.from({ length: arms }, (_, i) => ({
    id: i + 1, caseId: 1, nodeId: i + 2,
    fx: forceKn, fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
  })),
};
const built = buildFrame3DSolveRequest(model, "linear", 1);
const expected = forceKn * lengthM / (built.materials[0].eMpa * 1000 * built.sections[0].areaM2);

const previousFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "frame3d");
  assert.equal(body.inputs.input.nodes.length, arms + 1);
  assert.equal(body.inputs.input.linearBackend, "frontalWave");
  assert.equal(body.inputs.input.frontalMaxFrontDofs, 256);
  requests++;
  const result = await invoke(body.inputs.input);
  return new Response(JSON.stringify({ kind: "frame3d", result }), { status: 200 });
};

try {
  const result = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  assert.equal(requests, 1);
  assert.equal(result.solverPath, "native-rust-frame3d-frontal-wave");
  assert.ok(result.diagnostics.some(line => /direct met de frontale methode/.test(line)));
  assert.equal(result.displacements.length, arms + 1);
  assert.equal(result.memberForces.length, arms);
  assert.ok(Math.abs(result.displacements[arms].ux - expected) < 1e-9);
  assert.ok(Math.abs(result.reactions[0].fx + arms * forceKn) < 1e-5);
  assert.ok(result.forceBalance?.ok);
  console.log("Native 3D-app-route: 3.334 staven / 20.010 DOF frontaal opgelost.");
} finally {
  globalThis.fetch = previousFetch;
}
