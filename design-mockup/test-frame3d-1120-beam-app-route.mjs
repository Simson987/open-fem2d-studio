import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-raamwerk/raamwerk-1120-staven-vier-bouwlagen.ifcfem2d",
  import.meta.url), "utf8"));
assert.equal(project.analysetype, "tweedeOrdeGeometrisch");
const model = project.model3d;
assert.deepEqual([model.nodes.length, model.beams.length, model.supports.length, model.loads.length],
  [500, 1120, 100, 100]);
assert.ok(model.beams.every(beam => !beam.axialOnly), "alle staven hebben buiging en rotatievrijheidsgraden");

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
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code,
      output: Buffer.concat(stdout).toString(), error: Buffer.concat(stderr).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.output);
  return new Response(answer.output, { status: 200 });
};

try {
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(nativeRequest.kind, "frame3d");
  assert.equal(nativeRequest.input.members.length, 1120);
  assert.equal(nativeRequest.input.nodes.length, 500);
  assert.equal(result.displacements.length, 500);
  assert.equal(result.memberForces.length, 1120);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.displacements.every(node =>
    [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
  const sum = (key) => result.reactions.reduce((value, reaction) => value + reaction[key], 0);
  const nodeById = new Map(model.nodes.map(node => [node.id, node]));
  const reactionMoments = (reactions) => reactions.reduce((moments, reaction) => {
    const node = nodeById.get(reaction.nodeId);
    assert.ok(node, `known reaction node ${reaction.nodeId}`);
    moments.mx += reaction.mx + node.y * reaction.fz - node.z * reaction.fy;
    moments.my += reaction.my + node.z * reaction.fx - node.x * reaction.fz;
    moments.mz += reaction.mz + node.x * reaction.fy - node.y * reaction.fx;
    return moments;
  }, { mx: 0, my: 0, mz: 0 });
  const assertGlobalMoments = (reactions, label, displacements) => {
    // First order uses the original lever arms. P-Delta uses the displaced
    // roof load positions, including the vertical load's lateral drift arm.
    const displacementById = new Map(displacements.map(node => [node.nodeId, node]));
    const applied = model.loads.reduce((moments, load) => {
      if (load.caseId !== project.activeLoadCaseId) return moments;
      const node = nodeById.get(load.nodeId);
      const displacement = displacementById.get(load.nodeId) ?? { ux: 0, uy: 0, uz: 0 };
      assert.ok(node, `known loaded node ${load.nodeId}`);
      const x = node.x + displacement.ux;
      const y = node.y + displacement.uy;
      const z = node.z + displacement.uz;
      moments.mx += (load.mx ?? 0) + y * load.fz - z * load.fy;
      moments.my += (load.my ?? 0) + z * load.fx - x * load.fz;
      moments.mz += (load.mz ?? 0) + x * load.fy - y * load.fx;
      return moments;
    }, { mx: 0, my: 0, mz: 0 });
    assert.ok(Math.abs(applied.mx + 18_000) < 1, `applied Mx ${applied.mx}`);
    assert.ok(Math.abs(applied.my - 19_200) < 10, `applied My ${applied.my}`);
    assert.ok(Math.abs(applied.mz + 1_800) < 1, `applied Mz ${applied.mz}`);
    const moments = reactionMoments(reactions);
    for (const [axis, appliedMoment] of Object.entries(applied)) {
      const expected = -appliedMoment;
      const tolerance = label === "P-Delta" ? Math.max(1e-2, 1e-6 * Math.abs(expected)) : 1e-2;
      assert.ok(Math.abs(moments[axis] - expected) < tolerance,
        `${label} reaction ${axis}: ${moments[axis]} != ${expected} kNm`);
    }
  };
  assert.ok(Math.abs(sum("fx") + 100) < 1e-4, `lateral reaction ${sum("fx")}`);
  assert.ok(Math.abs(sum("fz") - 1000) < 1e-4, `vertical reaction ${sum("fz")}`);
  assertGlobalMoments(result.reactions, "linear", []);
  const maxDisplacement = Math.max(...result.displacements.map(node =>
    Math.hypot(node.ux, node.uy, node.uz)));
  assert.ok(maxDisplacement > 0 && maxDisplacement < 1,
    `finite realistic frame displacement ${maxDisplacement}`);
  console.log(`Connected 1,120-beam 3D frame: ${result.solverPath}, `
    + `max displacement ${(1000 * maxDisplacement).toFixed(3)} mm, equilibrium OK`);

  const secondOrder = await solveFrame3D(model, project.activeLoadCaseId,
    "p-delta", "openaec-native-fem");
  assert.equal(nativeRequest.kind, "frame3d");
  assert.equal(nativeRequest.input.analysis, "p-delta");
  assert.equal(secondOrder.displacements.length, 500);
  assert.equal(secondOrder.memberForces.length, 1120);
  assert.ok(secondOrder.equilibrium.equilibriumOk,
    `second-order residual ${secondOrder.equilibrium.relativeResidual}`);
  assert.ok(secondOrder.displacements.every(node =>
    [node.ux, node.uy, node.uz, node.rx, node.ry, node.rz].every(Number.isFinite)));
  const reaction = (key) => secondOrder.reactions.reduce((value, item) => value + item[key], 0);
  assert.ok(Math.abs(reaction("fx") + 100) < 1e-4);
  assert.ok(Math.abs(reaction("fz") - 1000) < 1e-4);
  assertGlobalMoments(secondOrder.reactions, "P-Delta", secondOrder.displacements);
  const roofNode = model.nodes.reduce((best, node) => node.z > best.z ? node : best);
  const linearRoof = result.displacements.find(node => node.nodeId === roofNode.id);
  const nonlinearRoof = secondOrder.displacements.find(node => node.nodeId === roofNode.id);
  assert.ok(linearRoof && nonlinearRoof);
  assert.ok(Math.abs(nonlinearRoof.ux) > Math.abs(linearRoof.ux),
    `P-Delta should amplify roof drift: ${linearRoof.ux} -> ${nonlinearRoof.ux}`);
  console.log(`Connected second-order frame: ${secondOrder.solverPath}, `
    + `roof x ${(1000 * nonlinearRoof.ux).toFixed(3)} mm, equilibrium OK`);
} finally {
  globalThis.fetch = originalFetch;
}
