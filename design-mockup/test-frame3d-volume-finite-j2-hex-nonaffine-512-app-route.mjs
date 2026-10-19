import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/hex8-j2-niet-affien-512.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.deepEqual([model.nodes.length, model.volumes.length, model.supports.length, model.loads.length],
  [729, 512, 81, 81]);
assert.ok(model.volumes.every(volume => volume.kind === "hex8"
  && volume.materialLaw?.kind === "steelJ2"));
assert.deepEqual(model.materialLoadPath, [1]);

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
    "material", "openaec-native-fem");
  assert.equal(nativeRequest.kind, "volume3dFiniteJ2HexCoupled");
  assert.equal(nativeRequest.input.hexes.length, 512);
  assert.equal(nativeRequest.input.volume.mesh.tets.length, 0);
  assert.equal(nativeRequest.input.volume.options.linearBackend, "matrixFreeGmresLarge");
  assert.equal(nativeRequest.input.volume.options.matrixFreeThreads, 4);
  assert.equal(result.displacements.length, 729);
  assert.equal(result.volume3D.elements.length, 512);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk,
    `balance ${JSON.stringify(result.forceBalance)} residual ${result.equilibrium.relativeResidual}`);
  assert.ok(result.displacements.every(node => [node.ux, node.uy, node.uz].every(Number.isFinite)));
  const plastic = result.volume3D.elements.filter(element => element.equivalentPlasticStrain > 1e-7);
  const elastic = result.volume3D.elements.filter(element => element.equivalentPlasticStrain <= 1e-7);
  assert.ok(plastic.length > 0 && elastic.length > 0,
    `nonuniform plastic zone: ${plastic.length} plastic, ${elastic.length} elastic elements`);
  assert.ok(result.volume3D.elements.every(element =>
    Number.isFinite(element.vonMisesMpa) && element.gaussStressMpa.length === 8));
  const sum = key => result.reactions.reduce((value, reaction) => value + reaction[key], 0);
  assert.ok(Math.abs(sum("fx") + 3_000) < 1e-3, `Rx ${sum("fx")}`);
  assert.ok(Math.abs(sum("fy") + 30) < 1e-3, `Ry ${sum("fy")}`);
  assert.ok(Math.abs(sum("fz") - 500) < 1e-3, `Rz ${sum("fz")}`);
  console.log(`Saved nonaffine finite-J2 model: 512 Hex8, 1,944 free DOFs, `
    + `${plastic.length} plastic and ${elastic.length} elastic elements, `
    + `relative residual ${result.equilibrium.relativeResidual.toExponential(3)}, balance OK`);
} finally {
  globalThis.fetch = originalFetch;
}
