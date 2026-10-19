/** Manual large-model acceptance: run with `node --import tsx accept-frame3d-large-55k.mjs`. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const binaryCandidates = ["../src-tauri/target/release/native-mixed3d",
  "../src-tauri/target/debug/native-mixed3d"].map((path) => fileURLToPath(new URL(path, import.meta.url)));
// Follow the dev bridge: a newer debug binary may implement fields absent from an old release.
const binary = binaryCandidates.filter(existsSync).sort((a, b) =>
  statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!binary) throw new Error("Bouw eerst de native-mixed3d Rust-binary.");

const started = performance.now();
const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/groot-gemengd-55232-volumes.ifcfem2d", import.meta.url), "utf8"));
assert.equal(project.modelDimension, "3d");
assert.equal(project.analysetype, "eersteOrde");
const model = project.model3d;
assert.equal(model.nodes.length, 18_999);
assert.equal(model.volumes.length, 55_232);
assert.equal(model.volumes.filter((volume) => volume.kind === "tet4").length, 46_080);
assert.equal(model.volumes.filter((volume) => volume.kind === "hex8").length, 9_152);
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
  assert.equal(request.inputs.input.mesh.tets.length, 46_080);
  assert.equal(request.inputs.input.hexes.length, 9_152);
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
  assert.equal(result.volume3D.elements.length, 55_232);
  assert.equal(result.displacements.length, 18_999);
  assert.equal(result.memberForces.length, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  assert.ok(result.volume3D.elements.every((element) => Number.isFinite(element.vonMisesMpa)));
  const maximumDisplacement = Math.max(...result.displacements.map((node) =>
    Math.hypot(node.ux, node.uy, node.uz)));
  assert.ok(Number.isFinite(maximumDisplacement) && maximumDisplacement > 0);
  console.log(`Ordinary 3D app route: ${model.volumes.length} volumes, ${model.nodes.length} nodes, `
    + `${result.volume3D.linearIterations} PCG iterations, residual ${result.volume3D.relativeResidual.toExponential(3)}, `
    + `force and moment balance OK, elapsed ${((performance.now() - started) / 1000).toFixed(1)} s (${binary}).`);
} finally {
  globalThis.fetch = originalFetch;
}
