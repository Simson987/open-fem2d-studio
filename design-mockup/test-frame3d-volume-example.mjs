import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildFrame3DVolumeExample } from "./src/components/frame3d/frame3dVolumeExample.ts";
import { withFrame3DSelfWeight } from "./src/components/frame3d/frame3dModel.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const model = buildFrame3DVolumeExample();
const tets = model.volumes.filter((volume) => volume.kind === "tet4");
const hexes = model.volumes.filter((volume) => volume.kind === "hex8");
assert.equal(model.nodes.length, 414);
assert.equal(hexes.length, 143);
assert.equal(tets.length, 720);
assert.equal(model.beams.length, 1);
assert.equal(model.supports.length, 50);
assert.equal(model.loads.length, 10);
assert.equal(model.volumeBackend, "matrixFreePcg");
assert.ok(model.volumes.every((volume) => volume.nodeIds.every((id) => id >= 1 && id <= model.nodes.length)));
assert.ok(model.volumes.every((volume) => volume.densityKgPerM3 === 2500));

const previousFetch = globalThis.fetch;
let nativeRequest;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  nativeRequest = request.inputs.input;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(JSON.parse(Buffer.concat(output).toString()))
      : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
    child.stdin.end(JSON.stringify(nativeRequest));
  });
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

try {
  const result = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  assert.equal(nativeRequest.mesh.tets.length, tets.length);
  assert.equal(nativeRequest.hexes.length, hexes.length);
  assert.equal(nativeRequest.frames.length, 1);
  assert.equal(nativeRequest.backend, "matrixFreePcg");
  assert.equal(nativeRequest.threads, 4);
  assert.equal(result.volume3D.elements.length, model.volumes.length);
  assert.equal(result.displacements.length, model.nodes.length);
  assert.equal(result.memberForces.length, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  assert.ok(result.displacements.some(({ ux, uy, uz }) => Math.hypot(ux, uy, uz) > 1e-10));
  assert.ok(result.volume3D.elements.every(({ vonMisesMpa }) => Number.isFinite(vonMisesMpa)));
  const withWeight = withFrame3DSelfWeight(model, 7);
  assert.equal(withWeight.volumeBodyLoads.length, model.volumes.length);
  const weightResult = await solveFrame3D(withWeight, 7, "linear", "openaec-native-fem");
  assert.equal(weightResult.volume3D.elements.length, model.volumes.length);
  assert.ok(weightResult.forceBalance.ok, JSON.stringify(weightResult.forceBalance));
  assert.ok(weightResult.volume3D.relativeResidual < 1e-8);
  console.log(`3D-editorproef: ${hexes.length} Hex8 + ${tets.length} Tet4 + 1 staaf; `
    + `residu ${result.volume3D.relativeResidual.toExponential(2)}`);
} finally {
  globalThis.fetch = previousFetch;
}
