import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";

const unloadPatch = process.env.FEM_PLASTIC_UNLOAD === "1";
const plasticPatch = unloadPatch || process.env.FEM_PLASTIC_PATCH === "1";
const projectFile = unloadPatch
  ? "../docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-j2-ontlast-patch.ifcfem2d"
  : plasticPatch
    ? "../docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-j2-plastische-patch.ifcfem2d"
    : "../docs/verificatie/3d-volume/hex8-raamwerk-1143-volumes-5104-staven-j2-elastische-patch.ifcfem2d";
const project = deserializeProject(readFileSync(new URL(projectFile, import.meta.url), "utf8"));
const model = project.model3d;
assert.deepEqual([model.nodes.length, model.beams.length, model.volumes.length],
  [2_048, 5_104, 1_143]);
assert.equal(model.volumeMaterialKinematics, "finiteStrain");
assert.ok(model.volumes.every(volume => volume.materialLaw?.kind === "steelJ2"));
assert.equal(model.volumeBackend, "automatic");
assert.equal(model.volumeResidualTolerance, 1e-8);
assert.deepEqual(model.materialLoadPath, unloadPatch ? [1, 0] : [1]);
for (const invalid of [0, 1e-13, 1e-3, Number.NaN]) {
  assert.throws(() => parseFrame3DModel({ ...model, volumeResidualTolerance: invalid }),
    /Newton-tolerantie/);
}

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
let nativeInput;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
  nativeInput = body.inputs.input;
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const raw = Buffer.concat(output).toString();
      if (code === 0) resolve(raw);
      else reject(new Error(raw || Buffer.concat(errors).toString()));
    });
    child.stdin.end(JSON.stringify(body));
  });
  return new Response(answer, { status: 200 });
};

try {
  const start = performance.now();
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(nativeInput.volume.mesh.nodes.length, 2_048);
  assert.equal(nativeInput.hexes.length, 1_143);
  assert.equal(nativeInput.frames.length, 5_104);
  assert.equal(nativeInput.volume.options.linearBackend, "automatic");
  assert.equal(nativeInput.volume.options.residualTolerance, 1e-8);
  assert.equal(nativeInput.volume.targets.length, unloadPatch ? 2 : 1);
  const targetForces = nativeInput.volume.targets.map(target =>
    target.loadsKn.reduce((sum, force) => sum + force[0], 0));
  assert.ok(Math.abs(targetForces[0] - 100) < 1e-9);
  if (unloadPatch) assert.ok(Math.abs(targetForces[1]) < 1e-9);
  assert.deepEqual([result.displacements.length, result.memberForces.length,
    result.volume3D.elements.length], [2_048, 5_104, 1_143]);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.equilibrium.relativeResidual < 1e-8);
  assert.equal(result.volume3D.backendUsed, "frontalWave");

  // Independent infinitesimal limit of the constrained finite-strain patch.
  // For the plastic variant use the J2 radial return with linear hardening:
  // dp=(2G*eps-Y)/(3G+H), q=Y+H*dp, sigma_x=K*eps+2q/3.
  const eBeamMpa = 210_000, eSolidMpa = 30_000, poisson = 0.2;
  const constrainedModulusMpa = eSolidMpa * (1 - poisson)
    / ((1 + poisson) * (1 - 2 * poisson));
  const shearMpa = eSolidMpa / (2 * (1 + poisson));
  const bulkMpa = eSolidMpa / (3 * (1 - 2 * poisson));
  const yieldMpa = 0.002, hardeningMpa = 300;
  const qSlope = 2 * shearMpa * hardeningMpa / (3 * shearMpa + hardeningMpa);
  const qIntercept = 3 * shearMpa * yieldMpa / (3 * shearMpa + hardeningMpa);
  const loadedStrain = plasticPatch
    ? (100 - 9_000 * (2 / 3) * qIntercept)
      / (1_000 * (9 * (bulkMpa + (2 / 3) * qSlope) + eBeamMpa * 0.16 * 16))
    : 100 / (constrainedModulusMpa * 1_000 * 9
      + eBeamMpa * 1_000 * 0.16 * 16);
  const loadedPlasticStrain = plasticPatch
    ? (2 * shearMpa * loadedStrain - yieldMpa) / (3 * shearMpa + hardeningMpa)
    : 0;
  // After full unloading the plastic strain stays, while the elastic Hex8
  // and the axial frames find a common zero-force residual displacement.
  const expectedStrain = unloadPatch
    ? 9 * 2 * shearMpa * loadedPlasticStrain
      / (9 * constrainedModulusMpa + eBeamMpa * 0.16 * 16)
    : loadedStrain;
  const positions = new Map(model.nodes.map(node => [node.id, node]));
  let maxDisplacementError = 0, maxStressError = 0;
  for (const node of result.displacements) {
    const error = Math.abs(node.ux - expectedStrain * positions.get(node.nodeId).x);
    maxDisplacementError = Math.max(maxDisplacementError, error);
    assert.ok(error < 1e-9, `node ${node.nodeId}: actual=${node.ux}, expected=${expectedStrain * positions.get(node.nodeId).x}, error=${error}`);
    assert.ok(Math.max(Math.abs(node.uy), Math.abs(node.uz), Math.abs(node.rx),
      Math.abs(node.ry), Math.abs(node.rz)) < 1e-10);
  }
  const lambdaMpa = eSolidMpa * poisson / ((1 + poisson) * (1 - 2 * poisson));
  const q = plasticPatch ? qSlope * loadedStrain + qIntercept
    : 2 * shearMpa * expectedStrain;
  const stressReference = unloadPatch
    ? [constrainedModulusMpa * expectedStrain - 2 * shearMpa * loadedPlasticStrain,
      lambdaMpa * expectedStrain + shearMpa * loadedPlasticStrain,
      lambdaMpa * expectedStrain + shearMpa * loadedPlasticStrain]
    : plasticPatch
    ? [bulkMpa * expectedStrain + (2 / 3) * q,
      bulkMpa * expectedStrain - q / 3,
      bulkMpa * expectedStrain - q / 3]
    : [constrainedModulusMpa * expectedStrain,
      lambdaMpa * expectedStrain, lambdaMpa * expectedStrain];
  const expectedPlasticStrain = loadedPlasticStrain;
  let maxPlasticError = 0;
  for (const element of result.volume3D.elements) {
    const plasticError = Math.abs(element.equivalentPlasticStrain - expectedPlasticStrain);
    maxPlasticError = Math.max(maxPlasticError, plasticError);
    assert.ok(plasticError < 1e-9,
      `Hex8 ${element.elementId}: plastic history ${element.equivalentPlasticStrain}`);
    for (let axis = 0; axis < 3; axis++) {
      const error = Math.abs(element.stressMpa[axis] - stressReference[axis]);
      maxStressError = Math.max(maxStressError, error);
      assert.ok(error < 1e-5, `Hex8 ${element.elementId}: stress ${axis}`);
    }
  }
  console.log(`Large coupled finite J2 ${unloadPatch ? "plastic unload" : plasticPatch ? "plastic" : "elastic"} patch: `
    + `1,143 Hex8 + 5,104 frames, `
    + `node error ${maxDisplacementError.toExponential(3)} m, stress error `
    + `${maxStressError.toExponential(3)} MPa, plastic error `
    + `${maxPlasticError.toExponential(3)}, residual `
    + `${result.equilibrium.relativeResidual.toExponential(3)}, `
    + `${((performance.now() - start) / 1_000).toFixed(2)} s.`);
} finally {
  globalThis.fetch = originalFetch;
}
