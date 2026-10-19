/** Manual 250k+ ordinary-app acceptance: `node --import tsx accept-frame3d-massive-257k.mjs`. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFrame3DVolumeExample } from "./src/components/frame3d/frame3dVolumeExample.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";
import { MASSIVE_IRREGULAR_DIMENSIONS } from "./src/components/volume3d/irregularMixed3dModel.ts";

const binaryCandidates = ["../src-tauri/target/release/native-mixed3d",
  "../src-tauri/target/debug/native-mixed3d"].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const binary = binaryCandidates.filter(existsSync).sort((a, b) =>
  statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!binary) throw new Error("Bouw eerst de native-mixed3d Rust-binary.");

const started = performance.now();
const model = buildFrame3DVolumeExample(MASSIVE_IRREGULAR_DIMENSIONS);
assert.equal(model.nodes.length, 84_746);
assert.equal(model.volumes.length, 257_728);
assert.equal(model.volumes.filter((volume) => volume.kind === "tet4").length, 215_040);
assert.equal(model.volumes.filter((volume) => volume.kind === "hex8").length, 42_688);
assert.equal(model.beams.length, 1);
assert.equal(model.volumeBackend, "matrixFreePcg");
assert.equal(model.volumeThreads, 4);

const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  assert.equal(request.inputs.input.mesh.tets.length, 215_040);
  assert.equal(request.inputs.input.hexes.length, 42_688);
  assert.equal(request.inputs.input.frames.length, 1);
  assert.equal(request.inputs.input.backend, "matrixFreePcg");
  assert.equal(request.inputs.input.threads, 4);
  requests++;
  const native = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(JSON.parse(Buffer.concat(output).toString()))
      : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
    child.stdin.end(JSON.stringify(request.inputs.input));
  });
  return new Response(JSON.stringify({ kind: "mixed3d", result: native }), { status: 200 });
};

try {
  const result = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  assert.equal(requests, 1);
  assert.equal(result.volume3D.elements.length, 257_728);
  assert.equal(result.displacements.length, 84_746);
  assert.equal(result.memberForces.length, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  assert.ok(result.volume3D.elements.every((element) => Number.isFinite(element.vonMisesMpa)));
  const maximumDisplacement = result.displacements.reduce((maximum, node) =>
    Math.max(maximum, Math.hypot(node.ux, node.uy, node.uz)), 0);
  assert.ok(Number.isFinite(maximumDisplacement) && maximumDisplacement > 0);
  console.log(`Ordinary 3D app route: ${model.volumes.length} volumes, ${model.nodes.length} nodes, `
    + `${result.volume3D.linearIterations} PCG iterations, residual ${result.volume3D.relativeResidual.toExponential(3)}, `
    + `force and moment balance OK, elapsed ${((performance.now() - started) / 1000).toFixed(1)} s (${binary}).`);
} finally {
  globalThis.fetch = originalFetch;
}
