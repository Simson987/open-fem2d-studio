import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";
import { buildFrame3DVolumeMembraneExample } from "./src/components/frame3d/frame3dVolumeExample.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/groot-gemengd-2248-volumes-96-membranen.ifcfem2d", import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.modelDimension, "3d");
assert.equal(project.activeLoadCaseId, 2);
assert.equal(model.nodes.length, 972);
assert.equal(model.volumes.length, 2248);
assert.equal(model.beams.length, 1);
assert.equal(model.plates.length, 96);
assert.equal(model.surfaceLoads.length, 96);
assert.deepEqual(model.plates, buildFrame3DVolumeMembraneExample().plates);

const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
const plateById = new Map(model.plates.map((plate) => [plate.id, plate]));
const equivalent = new Map();
let totalSurfaceForce = 0;
for (const load of model.surfaceLoads) {
  const plate = plateById.get(load.plateId);
  assert.ok(plate?.membraneOnly);
  assert.ok(plate.nodeIds.every((id) => model.volumes.some((volume) => volume.nodeIds.includes(id))),
    `Tri3 ${plate.id} must share volume nodes`);
  const [a, b, c] = plate.nodeIds.map((id) => nodeById.get(id));
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const area = Math.hypot(...cross) / 2;
  const force = load.qx * area;
  totalSurfaceForce += force;
  for (const id of plate.nodeIds) equivalent.set(id, (equivalent.get(id) ?? 0) + force / 3);
}
assert.ok(totalSurfaceForce > 9.9 && totalSurfaceForce < 10.1);

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const originalFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  assert.equal(request.inputs.input.mesh.tets.length, 1872);
  assert.equal(request.inputs.input.hexes.length, 376);
  assert.equal(request.inputs.input.frames.length, 1);
  requests++;
  const result = await new Promise((resolve, reject) => {
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
  return new Response(JSON.stringify({ kind: "mixed3d", result }), { status: 200 });
};

try {
  const coupled = await solveFrame3D(model, 2, "linear", "openaec-native-fem");
  assert.equal(coupled.volume3D.elements.length, 2248);
  assert.equal(coupled.volume3D.membranes.length, 96);
  assert.equal(coupled.memberForces.length, 1);
  assert.equal(coupled.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(coupled.volume3D.relativeResidual < 1e-8);
  assert.ok(coupled.forceBalance.ok, JSON.stringify(coupled.forceBalance));
  assert.ok(coupled.volume3D.membranes.some(({ stressMpa }) => stressMpa.some((stress) => Math.abs(stress) > 1e-8)));
  const rx = coupled.reactions.reduce((sum, reaction) => sum + reaction.fx, 0);
  assert.ok(Math.abs(rx + totalSurfaceForce) < 1e-6, `reaction ${rx} versus load ${totalSurfaceForce}`);

  // Same load vector on the bare solid/frame system: a positive membrane stiffness must reduce compliance.
  const bare = { ...model, plates: [], surfaceLoads: [],
    loads: [...model.loads, ...[...equivalent].map(([nodeId, fx], index) => ({
      id: 1000 + index, nodeId, caseId: 2, fx, fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
    }))] };
  const uncoupled = await solveFrame3D(bare, 2, "linear", "openaec-native-fem");
  assert.ok(uncoupled.forceBalance.ok);
  const compliance = (result) => {
    const displacements = new Map(result.displacements.map((node) => [node.nodeId, node.ux]));
    return [...equivalent].reduce((sum, [nodeId, fx]) => sum + fx * displacements.get(nodeId), 0);
  };
  assert.ok(compliance(coupled) < compliance(uncoupled) - 1e-12,
    `membrane should stiffen shared top face: ${compliance(coupled)} versus ${compliance(uncoupled)}`);
  const nodalCase = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  const combination = await solveFrame3DCombination(model,
    new Map([[1, 0.3], [2, 1.2]]), "linear", "openaec-native-fem");
  assert.ok(combination.forceBalance.ok);
  for (let i = 0; i < model.nodes.length; i++) {
    for (const component of ["ux", "uy", "uz"]) {
      const expected = 0.3 * nodalCase.displacements[i][component]
        + 1.2 * coupled.displacements[i][component];
      const actual = combination.displacements[i][component];
      assert.ok(Math.abs(actual - expected) < Math.max(1e-11, 2e-5 * Math.abs(expected)),
        `combination node ${i + 1} ${component}: ${actual} versus ${expected}`);
    }
  }
  assert.equal(requests, 4);
  console.log(`Large mixed 3D project: 2248 volumes + 96 Tri3 membranes + frame; `
    + `${coupled.volume3D.linearIterations} PCG iterations, residual ${coupled.volume3D.relativeResidual.toExponential(2)}; `
    + `surface force ${totalSurfaceForce.toFixed(6)} kN, compliance ${compliance(coupled).toExponential(3)} < ${compliance(uncoupled).toExponential(3)} kNm.`);
} finally {
  globalThis.fetch = originalFetch;
}
