/** Manual release acceptance: node --import tsx accept-frame3d-large-membrane-55k.mjs */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/groot-gemengd-55232-volumes-768-membranen.ifcfem2d", import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.modelDimension, "3d");
assert.equal(project.activeLoadCaseId, 2);
assert.equal(model.nodes.length, 18_999);
assert.equal(model.volumes.length, 55_232);
assert.equal(model.plates.length, 768);
assert.equal(model.surfaceLoads.length, 768);
assert.equal(model.beams.length, 1);
assert.equal(model.volumeBackend, "matrixFreePcg");
assert.equal(model.volumeThreads, 4);

const nodes = new Map(model.nodes.map((node) => [node.id, node]));
const plates = new Map(model.plates.map((plate) => [plate.id, plate]));
let surfaceForceKn = 0;
const equivalentNodalForce = new Map();
for (const load of model.surfaceLoads) {
  const plate = plates.get(load.plateId);
  assert.ok(plate?.membraneOnly && plate.nodeIds.length === 3);
  const [a, b, c] = plate.nodeIds.map((id) => nodes.get(id));
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const area = Math.hypot(...cross) / 2;
  assert.ok(area > 0 && Number.isFinite(area));
  surfaceForceKn += area * load.qx;
  for (const nodeId of plate.nodeIds)
    equivalentNodalForce.set(nodeId, (equivalentNodalForce.get(nodeId) ?? 0) + area * load.qx / 3);
}

const binaryCandidates = ["../src-tauri/target/release/native-mixed3d",
  "../src-tauri/target/debug/native-mixed3d"].map((path) => fileURLToPath(new URL(path, import.meta.url)));
const binary = binaryCandidates.filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
if (!binary) throw new Error("Bouw eerst de native-mixed3d Rust-binary.");
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  assert.equal(request.inputs.input.mesh.tets.length, 46_080);
  assert.equal(request.inputs.input.hexes.length, 9_152);
  assert.equal(request.inputs.input.membranes.length, calls === 0 ? 768 : 0);
  assert.equal(request.inputs.input.frames.length, 1);
  assert.equal(request.inputs.input.threads, 4);
  calls += 1;
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
  const started = performance.now();
  const result = await solveFrame3D(model, 2, "linear", "openaec-native-fem");
  assert.equal(calls, 1);
  assert.equal(result.volume3D.elements.length, 55_232);
  assert.equal(result.volume3D.membranes.length, 768);
  assert.equal(result.memberForces.length, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  assert.ok(result.volume3D.membranes.some((membrane) => membrane.stressMpa.some((stress) => Math.abs(stress) > 1e-8)));
  const reactionX = result.reactions.reduce((sum, reaction) => sum + reaction.fx, 0);
  assert.ok(Math.abs(reactionX + surfaceForceKn) < 1e-4,
    `surface traction ${surfaceForceKn} kN, support reaction ${reactionX} kN`);
  const bareModel = { ...model, plates: [], surfaceLoads: [], loads: [
    ...model.loads,
    ...[...equivalentNodalForce].map(([nodeId, fx], index) => ({
      id: 100_000 + index, nodeId, caseId: 2, fx, fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
    })),
  ] };
  const bare = await solveFrame3D(bareModel, 2, "linear", "openaec-native-fem");
  assert.equal(calls, 2);
  assert.ok(bare.forceBalance.ok);
  const work = (solution) => {
    const displacement = new Map(solution.displacements.map((node) => [node.nodeId, node.ux]));
    return [...equivalentNodalForce].reduce((sum, [nodeId, fx]) => sum + fx * displacement.get(nodeId), 0);
  };
  const coupledWork = work(result), bareWork = work(bare);
  assert.ok(coupledWork < bareWork - 1e-12,
    `shared membranes must stiffen the 55k model: ${coupledWork} versus ${bareWork}`);
  console.log(`55k coupled app: ${model.volumes.length} volumes + ${model.plates.length} Tri3 + frame; `
    + `${surfaceForceKn.toFixed(6)} kN top traction, ${result.volume3D.linearIterations} PCG iterations, `
    + `residual ${result.volume3D.relativeResidual.toExponential(2)}, `
    + `compliance ${coupledWork.toExponential(3)} < ${bareWork.toExponential(3)} kNm, `
    + `${((performance.now() - started) / 1000).toFixed(1)} s (${binary}).`);
} finally {
  globalThis.fetch = originalFetch;
}
