import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-betonschade-3072-volumes.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
const binary = fileURLToPath(new URL(
  "../src-tauri/target/release/native-volume3d-concrete-damage", import.meta.url));
const E = 30_000, nu = 0.2, ft = 3, gf = 1_000, bandWidth = 0.125;
const threshold = ft / E;
const softeningStrain = 1e-6 * gf / (bandWidth * ft) - threshold / 2;
const peakStrain = 2 * threshold;
const finalStrain = threshold;
const expectedDamage = 1 - threshold / peakStrain
  * Math.exp(-(peakStrain - threshold) / softeningStrain);
const expectedStress = (1 - expectedDamage) * E * finalStrain;
assert.ok(expectedDamage > 0 && expectedDamage < 1);
assert.equal(model.nodes.length, 729);
assert.equal(model.volumes.length, 3_072);
assert.equal(model.supports.length, 729);
assert.equal(model.volumeBackend, "sparseGmres");
assert.equal(model.volumeMaterialKinematics, "smallStrain");
assert.deepEqual(model.materialLoadPath, [2, 1]);
const nodeById = new Map(model.nodes.map(node => [node.id, node]));

let dispatched = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const message = JSON.parse(options.body);
  assert.equal(message.opdracht, "solve_native_fem");
  assert.equal(message.inputs.kind, "volume3dConcreteDamage");
  const input = message.inputs.input;
  assert.equal(input.mesh.nodes.length, 729);
  assert.equal(input.mesh.tets.length, 3_072);
  assert.equal(input.elementMaterials.length, 3_072);
  assert.ok(input.elementMaterials.every(material => material.eMpa === E
    && material.poisson === nu && material.tensileStrengthMpa === ft
    && material.fractureEnergyNPerM === gf && material.crackBandWidthM === bandWidth));
  assert.equal(input.options.linearBackend, "sparseGmres");
  assert.equal(input.targets.length, 2);
  assert.equal(input.targets[0].prescribedM.flat().filter(part => part === null).length, 686);
  assert.equal(input.targets[1].prescribedM.flat().filter(part => part === null).length, 686);
  dispatched += 1;
  const native = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve(JSON.parse(Buffer.concat(stdout).toString()))
      : reject(new Error(Buffer.concat(stderr).toString() || Buffer.concat(stdout).toString())));
    child.stdin.end(JSON.stringify(input));
  });
  return new Response(JSON.stringify({ kind: "volume3dConcreteDamage", result: native }), { status: 200 });
};

try {
  const started = performance.now();
  const result = await solveFrame3D(model, 1, "material", "openaec-native-fem");
  assert.equal(dispatched, 1);
  assert.equal(result.volume3D.formulation, "smallStrainMaterial");
  assert.equal(result.volume3D.backendUsed, "sparseGmres");
  assert.equal(result.volume3D.elements.length, 3_072);
  assert.ok(result.volume3D.acceptedSteps >= 2);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.volume3D.relativeResidual < 1e-6);

  let maxDisplacementError = 0, maxDamageError = 0, maxStressError = 0;
  for (const displacement of result.displacements) {
    const point = nodeById.get(displacement.nodeId);
    maxDisplacementError = Math.max(maxDisplacementError,
      Math.abs(displacement.ux - finalStrain * point.x),
      Math.abs(displacement.uy + nu * finalStrain * point.y),
      Math.abs(displacement.uz + nu * finalStrain * point.z));
  }
  for (const element of result.volume3D.elements) {
    maxDamageError = Math.max(maxDamageError, Math.abs(element.tensileDamage - expectedDamage));
    maxStressError = Math.max(maxStressError,
      Math.abs(element.stressMpa[0] - expectedStress),
      ...element.stressMpa.slice(1).map(Math.abs));
  }
  assert.ok(maxDisplacementError < 2e-7, `displacement error ${maxDisplacementError}`);
  assert.ok(maxDamageError < 2e-6, `damage error ${maxDamageError}`);
  assert.ok(maxStressError < 2e-3, `stress error ${maxStressError} MPa`);
  const rightForce = result.reactions.reduce((sum, reaction) =>
    sum + (nodeById.get(reaction.nodeId).x === 1 ? reaction.fx : 0), 0);
  assert.ok(Math.abs(rightForce - 1_000 * expectedStress) < 1,
    `right-face force ${rightForce} kN`);
  console.log(`Saved 3,072-Tet4 concrete damage model: sparse GMRES, `
    + `u error ${maxDisplacementError.toExponential(2)} m, `
    + `damage error ${maxDamageError.toExponential(2)}, `
    + `stress error ${maxStressError.toExponential(2)} MPa, `
    + `${((performance.now() - started) / 1_000).toFixed(1)} s.`);
} finally {
  globalThis.fetch = originalFetch;
}
