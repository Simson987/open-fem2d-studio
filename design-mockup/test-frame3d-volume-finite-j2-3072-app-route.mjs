import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
const binary = fileURLToPath(new URL(
  "../src-tauri/target/release/native-volume3d-finite-j2", import.meta.url));
const E = 210_000, nu = 0.3, yieldMpa = 250, hardeningMpa = 2_000;
const mu = E / (2 * (1 + nu));
const bulk = E / (3 * (1 - 2 * nu));
const finalStretch = [1.0015, 0.9985, 1];
const peakStretch = [1.002, 0.998, 1];
const mean = values => values.reduce((sum, item) => sum + item, 0) / values.length;
const deviator = values => values.map(item => item - mean(values));
const mises = stress => Math.sqrt(1.5 * stress.reduce((sum, item) => sum + item * item, 0));
const peakTrial = deviator(peakStretch.map(Math.log)).map(item => 2 * mu * item);
const peakMises = mises(peakTrial);
assert.ok(peakMises > yieldMpa);
const expectedPlasticStrain = (peakMises - yieldMpa) / (3 * mu + hardeningMpa);
const plasticLogStretch = peakTrial.map(item => 1.5 * item / peakMises * expectedPlasticStrain);
const elasticHencky = finalStretch.map((stretch, axis) => Math.log(stretch) - plasticLogStretch[axis]);
const elasticDeviator = deviator(elasticHencky).map(item => 2 * mu * item);
assert.ok(mises(elasticDeviator) < yieldMpa + hardeningMpa * expectedPlasticStrain);
const kirchhoff = elasticDeviator.map(item => 3 * bulk * mean(elasticHencky) + item);
const determinant = finalStretch.reduce((product, item) => product * item, 1);
const expectedCauchy = kirchhoff.map(item => item / determinant);
const expectedPiola = kirchhoff.map((item, axis) => item / finalStretch[axis]);

assert.equal(project.modelDimension, "3d");
assert.equal(project.analysetype, "tweedeOrdeFysisch");
assert.equal(model.nodes.length, 729);
assert.equal(model.volumes.length, 3_072);
assert.equal(model.supports.length, 386);
assert.equal(model.volumeBackend, "matrixFreeGmres");
assert.equal(model.volumeThreads, 4);
assert.deepEqual(model.materialLoadPath, [4 / 3, 1]);
const nodeById = new Map(model.nodes.map(node => [node.id, node]));
assert.ok(model.supports.every(support => {
  const { x, y, z } = nodeById.get(support.nodeId);
  return [x, y, z].some(value => value === 0 || value === 1)
    && support.ux && support.uy && support.uz;
}));

let dispatched = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const message = JSON.parse(options.body);
  assert.equal(message.opdracht, "solve_native_fem");
  assert.equal(message.inputs.kind, "volume3dFiniteJ2");
  const input = message.inputs.input;
  assert.equal(input.mesh.nodes.length, 729);
  assert.equal(input.mesh.tets.length, 3_072);
  assert.equal(input.elementSteels.length, 3_072);
  assert.equal(input.options.linearBackend, "matrixFreeGmres");
  assert.equal(input.options.matrixFreeThreads, 4);
  assert.equal(input.targets.length, 2);
  assert.equal(input.targets[0].prescribedM.filter(value => value.every(part => part === null)).length, 343);
  assert.equal(input.targets[1].prescribedM.filter(value => value.every(part => part === null)).length, 343);
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
  return new Response(JSON.stringify({ kind: "volume3dFiniteJ2", result: native }), { status: 200 });
};

try {
  const started = performance.now();
  const result = await solveFrame3D(model, 1, "material", "openaec-native-fem");
  assert.equal(dispatched, 1);
  assert.equal(result.volume3D.formulation, "totalLagrangianJ2");
  assert.equal(result.volume3D.backendUsed, "matrixFreeGmres");
  assert.equal(result.volume3D.elements.length, 3_072);
  assert.equal(result.displacements.length, 729);
  assert.ok(result.volume3D.acceptedSteps >= 2);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.volume3D.relativeResidual < 1e-6);

  let maxDisplacementError = 0, maxPlasticError = 0, maxCauchyError = 0, maxPiolaError = 0;
  for (const displacement of result.displacements) {
    const point = nodeById.get(displacement.nodeId);
    maxDisplacementError = Math.max(maxDisplacementError,
      Math.abs(displacement.ux - 0.0015 * point.x),
      Math.abs(displacement.uy + 0.0015 * point.y), Math.abs(displacement.uz));
  }
  for (const element of result.volume3D.elements) {
    maxPlasticError = Math.max(maxPlasticError,
      Math.abs(element.equivalentPlasticStrain - expectedPlasticStrain));
    for (let axis = 0; axis < 3; axis++) {
      maxCauchyError = Math.max(maxCauchyError,
        Math.abs(element.stressMpa[axis] - expectedCauchy[axis]));
      maxPiolaError = Math.max(maxPiolaError,
        Math.abs(element.firstPiolaMpa[axis][axis] - expectedPiola[axis]));
    }
  }
  assert.ok(maxDisplacementError < 3e-7, `displacement error ${maxDisplacementError}`);
  assert.ok(maxPlasticError < 3e-7, `plastic error ${maxPlasticError}`);
  assert.ok(maxCauchyError < 3e-2, `Cauchy error ${maxCauchyError} MPa`);
  assert.ok(maxPiolaError < 3e-2, `Piola error ${maxPiolaError} MPa`);
  const rightForce = result.reactions.reduce((sum, reaction) =>
    sum + (nodeById.get(reaction.nodeId).x === 1 ? reaction.fx : 0), 0);
  assert.ok(Math.abs(rightForce - 1_000 * expectedPiola[0]) < 0.2,
    `right-face force ${rightForce} kN`);
  console.log(`Saved 3,072-Tet4 finite-J2 model: matrix-free 4 threads, `
    + `u error ${maxDisplacementError.toExponential(2)} m, `
    + `alpha error ${maxPlasticError.toExponential(2)}, `
    + `P error ${maxPiolaError.toExponential(2)} MPa, `
    + `${((performance.now() - started) / 1_000).toFixed(1)} s.`);
} finally {
  globalThis.fetch = originalFetch;
}
