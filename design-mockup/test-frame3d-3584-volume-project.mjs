import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

// An ordinary saved 3D project: a 4 × 1 × 1 m block, fixed at x=0, with
// 100 kN distributed over the x=4 end face. E = 30 GPa, ν = 0.2.
const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/gemengd-axiaal-3584-volumes.ifcfem2d", import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(project.modelDimension, "3d");
assert.equal(project.activeLoadCaseId, 1);
assert.equal(model.nodes.length, 1377);
assert.equal(model.volumes.length, 3584);
assert.equal(model.volumes.filter(({ kind }) => kind === "hex8").length, 512);
assert.equal(model.volumes.filter(({ kind }) => kind === "tet4").length, 3072);
assert.equal(model.supports.length, 81);
assert.equal(model.loads.length, 81);
assert.equal(model.volumeBackend, "matrixFreePcg");
const nodes = new Map(model.nodes.map((node) => [node.id, node]));
assert.ok(model.supports.every(({ nodeId, ux, uy, uz }) =>
  nodes.get(nodeId).x === 0 && ux && uy && uz));
assert.ok(model.loads.every(({ nodeId, fx, fy, fz }) =>
  nodes.get(nodeId).x === 4 && fx > 0 && fy === 0 && fz === 0));
assert.ok(Math.abs(model.loads.reduce((sum, { fx }) => sum + fx, 0) - 100) < 1e-12);

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const previousFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "mixed3d");
  assert.equal(request.inputs.input.mesh.nodes.length, 1377);
  assert.equal(request.inputs.input.mesh.tets.length, 3072);
  assert.equal(request.inputs.input.hexes.length, 512);
  assert.equal(request.inputs.input.threads, 4);
  calls++;
  const answer = await new Promise((resolve, reject) => {
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
  return new Response(JSON.stringify({ kind: "mixed3d", result: answer }), { status: 200 });
};

try {
  const result = await solveFrame3D(model, 1, "linear", "openaec-native-fem");
  assert.equal(calls, 1);
  assert.equal(result.volume3D.elements.length, 3584);
  assert.equal(result.displacements.length, 1377);
  assert.equal(result.volume3D.backendUsed, "matrixFreePcg");
  assert.ok(result.volume3D.relativeResidual < 1e-8);
  assert.ok(result.forceBalance.ok, JSON.stringify(result.forceBalance));
  const rx = result.reactions.reduce((sum, reaction) => sum + reaction.fx, 0);
  assert.ok(Math.abs(rx + 100) < 1e-5, `x reaction ${rx} kN`);
  const displacements = new Map(result.displacements.map((node) => [node.nodeId, node]));
  const endUx = model.loads.reduce((sum, load) => sum + displacements.get(load.nodeId).ux, 0) / 81;
  const rodUx = 100 * 4 / (30_000 * 1000 * 1); // F L / E A, kN and m.
  assert.ok(endUx > 0 && Math.abs(endUx / rodUx - 1) < 0.15,
    `mean end displacement ${endUx} m versus rod estimate ${rodUx} m`);
  assert.ok(result.volume3D.elements.every(({ stressMpa, vonMisesMpa }) =>
    stressMpa.every(Number.isFinite) && Number.isFinite(vonMisesMpa)));
  console.log(`Saved mixed volume project: 1377 nodes, 512 Hex8 + 3072 Tet4; `
    + `end ux ${endUx.toExponential(3)} m, reaction ${rx.toFixed(6)} kN, `
    + `residual ${result.volume3D.relativeResidual.toExponential(2)}.`);
} finally {
  globalThis.fetch = previousFetch;
}
