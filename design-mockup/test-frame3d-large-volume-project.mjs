import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/groot-gemengd-2248-volumes.ifcfem2d", import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.modelDimension, "3d");
assert.equal(project.analysetype, "eersteOrde");
assert.equal(model.nodes.length, 972);
assert.equal(model.volumes.length, 2248);
assert.equal(model.volumes.filter((volume) => volume.kind === "tet4").length, 1872);
assert.equal(model.volumes.filter((volume) => volume.kind === "hex8").length, 376);
assert.equal(model.beams.length, 1);
assert.equal(model.volumeBackend, "matrixFreePcg");
assert.equal(model.volumeThreads, 4);

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const originalFetch = globalThis.fetch;
let requestCount = 0;
const trussCounts = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  assert.equal(request.inputs.input.mesh.tets.length, 1872);
  assert.equal(request.inputs.input.hexes.length, 376);
  assert.equal(request.inputs.input.frames.length, 1);
  trussCounts.push(request.inputs.input.trusses.length);
  assert.equal(request.inputs.input.threads, 4);
  requestCount++;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve(JSON.parse(Buffer.concat(output).toString()))
      : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
    child.stdin.end(JSON.stringify(request.inputs.input));
  });
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

try {
  const result = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  assert.equal(requestCount, 1);
  assert.equal(result.volume3D.elements.length, 2248);
  assert.equal(result.displacements.length, 972);
  assert.equal(result.memberForces.length, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.linearIterations > 0);
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  const maxDisplacement = Math.max(...result.displacements.map((node) => Math.hypot(node.ux, node.uy, node.uz)));
  assert.ok(maxDisplacement > 1e-10 && Number.isFinite(maxDisplacement));
  assert.ok(result.volume3D.elements.every((element) => element.stressMpa.every(Number.isFinite)
    && Number.isFinite(element.vonMisesMpa)));
  const force = model.loads.reduce((sum, load) =>
    [sum[0] + load.fx, sum[1] + load.fy, sum[2] + load.fz], [0, 0, 0]);
  const reactions = result.reactions.reduce((sum, reaction) =>
    [sum[0] + reaction.fx, sum[1] + reaction.fy, sum[2] + reaction.fz], [0, 0, 0]);
  force.forEach((component, axis) =>
    assert.ok(Math.abs(component + reactions[axis]) < 1e-6, `force balance axis ${axis}`));
  const coupledProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-volume/groot-gemengd-2248-volumes-frame-truss.ifcfem2d", import.meta.url), "utf8"));
  const coupledModel = coupledProject.model3d;
  assert.equal(coupledModel.nodes.length, 972);
  assert.equal(coupledModel.volumes.length, 2248);
  assert.deepEqual(coupledModel.beams.map(beam => [beam.id, beam.axialOnly === true]), [[1, false], [2, true]]);
  const coupled = await solveFrame3D(coupledModel, 1, "linear", "openaec-native-fem");
  assert.equal(requestCount, 2);
  assert.deepEqual(trussCounts, [0, 1]);
  assert.equal(coupled.volume3D.elements.length, 2248);
  assert.equal(coupled.memberForces.length, 2);
  assert.deepEqual(coupled.memberForces.map(member => member.memberId), [1, 2]);
  assert.ok(Number.isFinite(coupled.memberForces[1].nStartKn));
  assert.equal(coupled.memberForces[1].nStartKn, coupled.memberForces[1].nEndKn);
  assert.equal(coupled.memberForces[1].myStartKnm, 0);
  assert.ok(coupled.volume3D.relativeResidual < 1e-8);
  assert.ok(coupled.forceBalance.ok, JSON.stringify(coupled.forceBalance));
  console.log(`Large ordinary 3D project: 2248 volumes, 972 nodes, 1 frame, 4 threads, ${result.volume3D.linearIterations} PCG iterations, residual ${result.volume3D.relativeResidual.toExponential(2)}.`);
  console.log(`Coupled variant: 2248 volumes, 1 frame + 1 axial truss, ${coupled.volume3D.linearIterations} PCG iterations, residual ${coupled.volume3D.relativeResidual.toExponential(2)}.`);
} finally {
  globalThis.fetch = originalFetch;
}
