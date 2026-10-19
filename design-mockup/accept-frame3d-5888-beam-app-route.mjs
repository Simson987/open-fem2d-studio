import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-raamwerk/raamwerk-5888-staven-acht-bouwlagen.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.analysetype, "tweedeOrdeGeometrisch");
assert.deepEqual([model.nodes.length, model.beams.length, model.supports.length, model.loads.length],
  [2304, 5888, 256, 256]);
assert.ok(model.beams.every(beam => !beam.axialOnly), "all members need full bending and torsion DOF");

// Verify a single connected structure, rather than a collection of easy isolated beams.
const adjacency = new Map(model.nodes.map(node => [node.id, []]));
for (const beam of model.beams) {
  adjacency.get(beam.startNodeId).push(beam.endNodeId);
  adjacency.get(beam.endNodeId).push(beam.startNodeId);
}
const visited = new Set([model.nodes[0].id]);
const queue = [model.nodes[0].id];
for (let cursor = 0; cursor < queue.length; cursor++) {
  for (const neighbor of adjacency.get(queue[cursor])) {
    if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
  }
}
assert.equal(visited.size, model.nodes.length, "every frame node belongs to one connected component");

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

const expectedForce = { fx: -64, fy: 0, fz: 640 };
const nodeById = new Map(model.nodes.map(node => [node.id, node]));
const reactionTotals = reactions => reactions.reduce((total, item) => {
  for (const axis of ["fx", "fy", "fz"]) total[axis] += item[axis];
  return total;
}, { fx: 0, fy: 0, fz: 0 });
const momentTotals = (items, displacements = []) => {
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
const check = (result, analysis) => {
  assert.equal(nativeRequest.kind, "frame3d");
  assert.equal(nativeRequest.input.analysis, analysis);
  assert.equal(nativeRequest.input.nodes.length, 2304);
  assert.equal(nativeRequest.input.members.length, 5888);
  assert.equal(result.displacements.length, 2304);
  assert.equal(result.memberForces.length, 5888);
  assert.ok(result.equilibrium.equilibriumOk,
    `${analysis} free equilibrium residual ${result.equilibrium.relativeResidual}`);
  assert.ok(result.displacements.every(node =>
    [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
  const force = reactionTotals(result.reactions);
  for (const axis of ["fx", "fy", "fz"]) {
    assert.ok(Math.abs(force[axis] - expectedForce[axis]) < 1e-3,
      `${analysis} ${axis} reaction ${force[axis]} != ${expectedForce[axis]}`);
  }
  const applied = momentTotals(model.loads, analysis === "p-delta" ? result.displacements : []);
  if (analysis === "linear") {
    assert.deepEqual(applied, { mx: -19_200, my: 20_736, mz: -1_920 });
  }
  const reactions = momentTotals(result.reactions);
  for (const axis of ["mx", "my", "mz"]) {
    const error = Math.abs(applied[axis] + reactions[axis]);
    const tolerance = analysis === "p-delta" ? Math.max(0.2, 1e-5 * Math.abs(applied[axis])) : 1e-2;
    assert.ok(error < tolerance,
      `${analysis} global ${axis} moment mismatch ${error} kNm (tolerance ${tolerance})`);
  }
  const maxDisplacement = Math.max(...result.displacements.map(node =>
    Math.hypot(node.ux, node.uy, node.uz)));
  assert.ok(maxDisplacement > 0 && maxDisplacement < 1);
  return { maxDisplacement, applied, reactions };
};

try {
  const start = performance.now();
  const linear = await solveFrame3D(model, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  const linearInfo = check(linear, "linear");
  console.log(`5,888-member connected frame linear: ${((performance.now() - start) / 1000).toFixed(2)} s; `
    + `max ${ (1000 * linearInfo.maxDisplacement).toFixed(3)} mm; forces/moments balanced`);

  if (process.env.FRAME_LARGE_LINEAR_ONLY !== "1") {
    const secondStart = performance.now();
    const second = await solveFrame3D(model, project.activeLoadCaseId,
      "p-delta", "openaec-native-fem");
    const secondInfo = check(second, "p-delta");
    const roofNode = model.nodes.find(node => node.z === 24 && node.x === 60 && node.y === 60);
    const firstRoof = linear.displacements.find(node => node.nodeId === roofNode.id);
    const secondRoof = second.displacements.find(node => node.nodeId === roofNode.id);
    assert.ok(Math.abs(secondRoof.ux) > Math.abs(firstRoof.ux),
      `P-Delta roof drift must grow: ${firstRoof.ux} -> ${secondRoof.ux}`);
    console.log(`5,888-member connected frame P-Delta: ${((performance.now() - secondStart) / 1000).toFixed(2)} s; `
      + `max ${(1000 * secondInfo.maxDisplacement).toFixed(3)} mm; forces/moments balanced`);
  }
} finally {
  globalThis.fetch = originalFetch;
}
