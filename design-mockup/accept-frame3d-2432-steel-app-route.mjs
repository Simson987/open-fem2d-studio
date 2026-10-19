import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-raamwerk/staalgebouw-2432-staven-acht-bouwlagen.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.analysetype, "tweedeOrdeGeometrisch");
assert.deepEqual([model.nodes.length, model.beams.length, model.supports.length, model.loads.length],
  [864, 2432, 96, 768]);
assert.deepEqual(new Set(model.beams.map(beam => beam.profileName)),
  new Set(["HEA 240", "IPE 240", "HEA 200"]));
assert.ok(model.beams.every(beam => !beam.axialOnly), "all 3D members have bending and torsion DOFs");
assert.ok(model.supports.every(support =>
  [support.ux, support.uy, support.uz, support.rx, support.ry, support.rz].every(Boolean)));

const nodeById = new Map(model.nodes.map(node => [node.id, node]));
const adjacency = new Map(model.nodes.map(node => [node.id, []]));
for (const beam of model.beams) {
  const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
  assert.ok(start && end && start.id !== end.id);
  assert.ok(Math.hypot(start.x - end.x, start.y - end.y, start.z - end.z) > 0);
  adjacency.get(start.id).push(end.id);
  adjacency.get(end.id).push(start.id);
}
const visited = new Set([model.nodes[0].id]);
const queue = [model.nodes[0].id];
for (let cursor = 0; cursor < queue.length; cursor++) {
  for (const neighbor of adjacency.get(queue[cursor])) {
    if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
  }
}
assert.equal(visited.size, model.nodes.length, "all nodes belong to one connected steel structure");

const binary = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
let nativeRequest;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  nativeRequest = body.inputs;
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    const timer = setTimeout(() => child.kill(), 600_000);
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, output: Buffer.concat(stdout).toString(), error: Buffer.concat(stderr).toString() });
    });
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(`native frame solver exit ${answer.code}: ${answer.error || answer.output}`);
  return new Response(answer.output, { status: 200 });
};

const totalForce = items => items.reduce((total, item) => {
  for (const axis of ["fx", "fy", "fz"]) total[axis] += item[axis];
  return total;
}, { fx: 0, fy: 0, fz: 0 });
const totalMoment = (items, displacements = []) => {
  const displacementById = new Map(displacements.map(item => [item.nodeId, item]));
  return items.reduce((total, item) => {
    const node = nodeById.get(item.nodeId);
    const displacement = displacementById.get(item.nodeId) ?? { ux: 0, uy: 0, uz: 0 };
    const x = node.x + displacement.ux, y = node.y + displacement.uy, z = node.z + displacement.uz;
    total.mx += (item.mx ?? 0) + y * item.fz - z * item.fy;
    total.my += (item.my ?? 0) + z * item.fx - x * item.fz;
    total.mz += (item.mz ?? 0) + x * item.fy - y * item.fx;
    return total;
  }, { mx: 0, my: 0, mz: 0 });
};
const appliedForce = totalForce(model.loads);
assert.ok(Math.abs(appliedForce.fx - 32) < 1e-10);
assert.ok(Math.abs(appliedForce.fy - 19.2) < 1e-10);
assert.equal(appliedForce.fz, -2304);

function check(result, analysis) {
  assert.equal(nativeRequest.kind, "frame3d");
  assert.equal(nativeRequest.input.analysis, analysis);
  assert.equal(nativeRequest.input.members.length, 2432);
  assert.equal(result.displacements.length, 864);
  assert.equal(result.memberForces.length, 2432);
  assert.ok(result.equilibrium.equilibriumOk,
    `${analysis} equilibrium residual ${result.equilibrium.relativeResidual}`);
  assert.ok(result.displacements.every(node =>
    [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
  const reactionForce = totalForce(result.reactions);
  for (const axis of ["fx", "fy", "fz"]) {
    assert.ok(Math.abs(reactionForce[axis] + appliedForce[axis]) < 1e-2,
      `${analysis} ${axis} global reaction mismatch`);
  }
  const appliedMoment = totalMoment(model.loads, analysis === "p-delta" ? result.displacements : []);
  const reactionMoment = totalMoment(result.reactions);
  for (const axis of ["mx", "my", "mz"]) {
    const error = Math.abs(appliedMoment[axis] + reactionMoment[axis]);
    const tolerance = analysis === "p-delta" ? Math.max(0.5, 1e-5 * Math.abs(appliedMoment[axis])) : 0.02;
    assert.ok(error < tolerance, `${analysis} ${axis} global moment mismatch ${error} kNm`);
  }
  const maxDisplacementM = Math.max(...result.displacements.map(node =>
    Math.hypot(node.ux, node.uy, node.uz)));
  assert.ok(maxDisplacementM > 0 && maxDisplacementM < 1);
  return maxDisplacementM;
}

try {
  const start = performance.now();
  const linear = await solveFrame3D(model, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  const linearMax = check(linear, "linear");
  console.log(`2,432-member steel frame linear: ${((performance.now() - start) / 1000).toFixed(2)} s; `
    + `max ${(1000 * linearMax).toFixed(3)} mm; forces and moments balanced`);
  if (process.env.FRAME_LARGE_LINEAR_ONLY !== "1") {
    const secondStart = performance.now();
    const second = await solveFrame3D(model, project.activeLoadCaseId,
      "p-delta", "openaec-native-fem");
    const secondMax = check(second, "p-delta");
    const roofId = model.nodes.find(node => node.x === 55 && node.y === 35 && node.z === 32).id;
    const firstRoof = linear.displacements.find(node => node.nodeId === roofId);
    const secondRoof = second.displacements.find(node => node.nodeId === roofId);
    assert.ok(Math.hypot(secondRoof.ux, secondRoof.uy) > Math.hypot(firstRoof.ux, firstRoof.uy),
      "second-order roof drift must exceed first-order drift");
    console.log(`2,432-member steel frame P-Delta: ${((performance.now() - secondStart) / 1000).toFixed(2)} s; `
      + `max ${(1000 * secondMax).toFixed(3)} mm; forces and moments balanced`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
