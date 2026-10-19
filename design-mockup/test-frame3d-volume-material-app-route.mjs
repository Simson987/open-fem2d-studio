import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

// Saved ordinary-app models use the same six-Tet4 cube as the independent
// native coupons, but reach Rust through the 3D editor's model adapter.
const binaries = {
  volume3dJ2: fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d-j2", import.meta.url)),
  volume3dConcreteDamage: fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d-concrete-damage", import.meta.url)),
};
const readProject = name => deserializeProject(readFileSync(new URL(
  `../docs/verificatie/3d-volume/${name}`, import.meta.url), "utf8"));
const invoke = (kind, input) => new Promise((resolve, reject) => {
  const child = spawn(binaries[kind], [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    const raw = Buffer.concat(output).toString();
    code === 0 ? resolve(JSON.parse(raw)) : reject(new Error(raw || Buffer.concat(errors).toString()));
  });
  child.stdin.end(JSON.stringify(input));
});
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual}, expected ${expected}`);
const sumRight = result => result.reactions.reduce((sum, node) =>
  sum + ([205, 407, 609, 811].includes(node.nodeId) ? node.fx : 0), 0);
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
  const result = await invoke(body.inputs.kind, body.inputs.input);
  return new Response(JSON.stringify({ kind: body.inputs.kind, result }), { status: 200 });
};

try {
  const steel = readProject("tet4-materiaal-staal-j2-coupon.ifcfem2d");
  const concrete = readProject("tet4-materiaal-betonschade-coupon.ifcfem2d");
  for (const project of [steel, concrete]) {
    assert.equal(project.modelDimension, "3d");
    assert.equal(project.analysetype, "tweedeOrdeFysisch");
    assert.equal(frame3DAnalysisForProject(project.model3d, project.analysetype), "material");
    assert.equal(project.model3d.volumes.length, 6);
    assert.equal(project.model3d.materialLoadPath.at(-1), 1);
    assert.ok(project.model3d.materialLoadPath[0] > 1, "saved path includes unloading");
  }

  const steelResult = await solveFrame3D(steel.model3d, steel.activeLoadCaseId,
    "material", "openaec-native-fem");
  const steelRequest = requests.at(-1);
  assert.equal(steelRequest.kind, "volume3dJ2");
  assert.deepEqual(steelRequest.input.mesh.tets[0], [0, 1, 3, 7]);
  assert.equal(steelRequest.input.elementSteels.length, 6);
  assert.ok(steelRequest.input.elementSteels.every(material =>
    material.youngsMpa === 200_000 && material.yieldMpa === 250 && material.hardeningMpa === 2_000));
  close(steelRequest.input.targets[0].prescribedM[1][0], 0.004, 1e-15, "J2 peak displacement");
  close(steelRequest.input.targets[1].prescribedM[1][0], 0.0035, 1e-15, "J2 unloaded displacement");
  assert.equal(steelRequest.input.targets[1].prescribedM[2][1], null);
  assert.equal(steelResult.analysis, "material");
  assert.equal(steelResult.volume3D.formulation, "smallStrainMaterial");
  assert.equal(steelResult.volume3D.backendUsed, "sparseDirect");
  assert.equal(steelResult.volume3D.elements.length, 6);
  assert.equal(steelResult.materialLoadPath.length, 2);
  assert.ok(steelResult.volume3D.acceptedSteps >= 2);
  assert.ok(steelResult.volume3D.newtonIterations > 0);
  assert.ok(steelResult.forceBalance.ok && steelResult.equilibrium.equilibriumOk);
  const plasticStrain = (200_000 * 0.004 - 250) / (200_000 + 2_000);
  const expectedSteelStress = 200_000 * (0.0035 - plasticStrain);
  close(sumRight(steelResult), expectedSteelStress * 1_000, 1e-4, "J2 unloaded reaction");
  for (const element of steelResult.volume3D.elements) {
    close(element.equivalentPlasticStrain, plasticStrain, 1e-9, "J2 plastic history");
    close(element.stressMpa[0], expectedSteelStress, 1e-7, "J2 unloaded stress");
    assert.ok(!("tensileDamage" in element));
  }

  const concreteResult = await solveFrame3D(concrete.model3d, concrete.activeLoadCaseId,
    "material", "openaec-native-fem");
  const concreteRequest = requests.at(-1);
  assert.equal(concreteRequest.kind, "volume3dConcreteDamage");
  assert.deepEqual(concreteRequest.input.mesh.tets[0], [0, 1, 3, 7]);
  assert.equal(concreteRequest.input.elementMaterials.length, 6);
  assert.ok(concreteRequest.input.elementMaterials.every(material =>
    material.eMpa === 30_000 && material.tensileStrengthMpa === 3
      && material.fractureEnergyNPerM === 100 && material.crackBandWidthM === 0.1));
  close(concreteRequest.input.targets[0].prescribedM[1][0], 3.833333333333333e-05, 1e-15,
    "concrete peak displacement");
  close(concreteRequest.input.targets[1].prescribedM[1][0], 2.4166666666666663e-05, 1e-15,
    "concrete unloaded displacement");
  assert.equal(concreteResult.volume3D.backendUsed, "denseLu");
  assert.equal(concreteResult.volume3D.formulation, "smallStrainMaterial");
  assert.ok(concreteResult.volume3D.acceptedSteps >= 2);
  assert.ok(concreteResult.forceBalance.ok && concreteResult.equilibrium.equilibriumOk);
  const onset = 3 / 30_000;
  const beta = 100 / (1e6 * 0.1 * 3) - onset / 2;
  const peakStrain = onset + beta;
  const unloadedStrain = onset + beta / 2;
  const expectedDamage = 1 - (3 / Math.E) / (30_000 * peakStrain);
  const expectedConcreteStress = (3 / Math.E) * unloadedStrain / peakStrain;
  close(sumRight(concreteResult), expectedConcreteStress * 0.1 ** 2 * 1_000, 1e-5,
    "concrete unloaded reaction");
  for (const element of concreteResult.volume3D.elements) {
    close(element.tensileDamage, expectedDamage, 1e-9, "concrete damage history");
    close(element.stressMpa[0], expectedConcreteStress, 1e-8, "concrete unloaded stress");
    assert.ok(!("equivalentPlasticStrain" in element));
  }

  const beforeInvalid = requests.length;
  await assert.rejects(() => solveFrame3D({ ...steel.model3d,
    volumes: steel.model3d.volumes.map((volume, index) => index === 0
      ? { ...volume, materialLaw: concrete.model3d.volumes[0].materialLaw } : volume) },
  1, "material", "openaec-native-fem"), /niet in één volume-FNL-stelsel/);
  await assert.rejects(() => solveFrame3D({ ...steel.model3d, volumeBackend: "sparseGmres" },
    1, "material", "openaec-native-fem"), /staal-J2/);
  assert.throws(() => parseFrame3DModel({ ...concrete.model3d,
    volumes: [{ ...concrete.model3d.volumes[0], materialLaw: {
      ...concrete.model3d.volumes[0].materialLaw, crackBandWidthM: 0,
    } }] }), /ongeldige staal-J2- of betontrekschadeparameters/);
  assert.equal(requests.length, beforeInvalid, "invalid models fail before Rust transport");
  console.log("Saved ordinary-app Tet4 J2 steel and concrete damage coupons match independent unload references through native transport.");
} finally {
  globalThis.fetch = originalFetch;
}
