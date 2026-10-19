import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { parseFrame3DModel } from "./src/components/frame3d/frame3dModel.ts";
import { frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

// Independent continuum reference for a diagonal affine deformation. The
// imposed peak stretches plastically; the smaller final stretches unload
// elastically from the committed multiplicative J2 state.
const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-staal-j2-coupon.ifcfem2d",
  import.meta.url), "utf8"));
const binary = fileURLToPath(new URL(
  "../src-tauri/target/debug/native-volume3d-finite-j2", import.meta.url));
const E = 210_000, nu = 0.3, yieldMpa = 250, hardeningMpa = 2_000;
const mu = E / (2 * (1 + nu));
const bulk = E / (3 * (1 - 2 * nu));
const peakStretch = [1.002, 0.998, 1];
const finalStretch = [1.0015, 0.9985, 1];
const mean = values => values.reduce((total, value) => total + value, 0) / 3;
const deviator = values => values.map(value => value - mean(values));
const mises = deviatoricStress => Math.sqrt(1.5 * deviatoricStress
  .reduce((total, value) => total + value ** 2, 0));
const peakHencky = peakStretch.map(Math.log);
const peakTrial = deviator(peakHencky).map(value => 2 * mu * value);
const peakMises = mises(peakTrial);
assert.ok(peakMises > yieldMpa, "peak must enter the plastic branch");
const expectedPlasticStrain = (peakMises - yieldMpa) / (3 * mu + hardeningMpa);
const plasticLogStretch = peakTrial.map(value =>
  1.5 * value / peakMises * expectedPlasticStrain);
const finalElasticHencky = finalStretch.map((stretch, axis) =>
  Math.log(stretch) - plasticLogStretch[axis]);
const finalTrial = deviator(finalElasticHencky).map(value => 2 * mu * value);
assert.ok(mises(finalTrial) < yieldMpa + hardeningMpa * expectedPlasticStrain,
  "unloading must stay elastic");
const kirchhoff = finalElasticHencky.map((_, axis) =>
  3 * bulk * mean(finalElasticHencky) + finalTrial[axis]);
const expectedPiola = kirchhoff.map((value, axis) => value / finalStretch[axis]);
const expectedCauchy = kirchhoff.map(value => value / finalStretch
  .reduce((product, stretch) => product * stretch, 1));
const close = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual}, expected ${expected} ± ${tolerance}`);

const invoke = input => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
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

const requests = [], nativeResults = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2");
  requests.push(body.inputs.input);
  const result = await invoke(body.inputs.input);
  nativeResults.push(result);
  return new Response(JSON.stringify({ kind: body.inputs.kind, result }), { status: 200 });
};

try {
  assert.equal(project.modelDimension, "3d");
  assert.equal(project.analysetype, "tweedeOrdeFysisch");
  assert.equal(project.model3d.volumeMaterialKinematics, "finiteStrain");
  assert.equal(frame3DAnalysisForProject(project.model3d, project.analysetype), "material");
  assert.equal(project.model3d.nodes.length, 27);
  assert.equal(project.model3d.volumes.length, 48);
  assert.deepEqual(project.model3d.materialLoadPath, [4 / 3, 1]);

  const result = await solveFrame3D(project.model3d, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(requests.length, 1);
  const request = requests[0], native = nativeResults[0];
  assert.equal(request.options.geometricFrames, undefined,
    "de bestaande materiaalroute mag geen tweede-orde staafoptie versturen");
  assert.equal(request.mesh.nodes.length, 27);
  assert.equal(request.mesh.tets.length, 48);
  assert.equal(request.elementSteels.length, 48);
  assert.ok(request.elementSteels.every(steel => steel.youngsMpa === E
    && steel.poisson === nu && steel.yieldMpa === yieldMpa
    && steel.hardeningMpa === hardeningMpa));
  assert.equal(request.targets.length, 2);
  assert.deepEqual(request.targets.map(target => target.prescribedM[13]),
    [[null, null, null], [null, null, null]], "interior node stays free");
  for (const [targetIndex, factor] of [4 / 3, 1].entries()) {
    for (const [node, [x, y, z]] of request.mesh.nodes.entries()) {
      if (node === 13) continue;
      const imposed = request.targets[targetIndex].prescribedM[node];
      close(imposed[0], factor * 0.0015 * x, 1e-15, "affine ux");
      close(imposed[1], -factor * 0.0015 * y, 1e-15, "affine uy");
      close(imposed[2], 0 * z, 1e-15, "affine uz");
    }
  }

  assert.equal(result.analysis, "material");
  assert.equal(result.volume3D.formulation, "totalLagrangianJ2");
  assert.equal(result.volume3D.elements.length, 48);
  assert.deepEqual(result.materialLoadPath, [4 / 3, 1]);
  assert.ok(result.volume3D.acceptedSteps >= 2);
  assert.ok(native.acceptedSteps.some(step => step.targetIndex === 0));
  assert.ok(native.acceptedSteps.some(step => step.targetIndex === 1));
  assert.ok(native.trueFreeResidualKn < 1e-5);
  close(native.nodalDisplacementsM[13][0], 0.00075, 2e-10, "free-center ux");
  close(native.nodalDisplacementsM[13][1], -0.00075, 2e-10, "free-center uy");
  close(native.nodalDisplacementsM[13][2], 0, 2e-10, "free-center uz");
  for (const [elementIndex, element] of result.volume3D.elements.entries()) {
    close(element.equivalentPlasticStrain, expectedPlasticStrain, 3e-9,
      `Tet4 ${elementIndex} committed plastic strain`);
    for (let axis = 0; axis < 3; axis++) {
      close(element.firstPiolaMpa[axis][axis], expectedPiola[axis], 4e-5,
        `Tet4 ${elementIndex} first Piola ${axis}`);
      close(element.stressMpa[axis], expectedCauchy[axis], 4e-5,
        `Tet4 ${elementIndex} Cauchy stress ${axis}`);
      for (let other = 0; other < 3; other++) {
        if (other !== axis) close(element.firstPiolaMpa[axis][other], 0, 4e-5,
          `Tet4 ${elementIndex} first Piola off-diagonal`);
      }
    }
  }
  const reaction = axis => result.reactions.reduce((total, node) =>
    total + (axis === 0 ? node.fx : axis === 1 ? node.fy : node.fz), 0);
  for (let axis = 0; axis < 3; axis++) close(reaction(axis), 0, 1e-4,
    `global reaction balance ${axis}`);
  const rightX = result.reactions.reduce((total, node) => total
    + (project.model3d.nodes.find(point => point.id === node.nodeId).x === 1 ? node.fx : 0), 0);
  const topY = result.reactions.reduce((total, node) => total
    + (project.model3d.nodes.find(point => point.id === node.nodeId).y === 1 ? node.fy : 0), 0);
  close(rightX, 1_000 * expectedPiola[0], 0.05, "right-face nominal force");
  close(topY, 1_000 * expectedPiola[1], 0.05, "top-face nominal force");
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);

  const loaded = await solveFrame3D({ ...project.model3d,
    volumeBodyLoads: [{ id: 1, volumeId: 1001, caseId: project.activeLoadCaseId,
      forceKnPerM3: [48, 0, 0] }] }, project.activeLoadCaseId,
  "material", "openaec-native-fem");
  assert.deepEqual(requests[1].targets.map(target => target.bodyForces), [
    [{ element: 0, forceKnPerM3: [64, 0, 0] }],
    [{ element: 0, forceKnPerM3: [48, 0, 0] }],
  ]);
  assert.ok(requests[1].targets.every(target => target.loadsKn.every(load =>
    load.every(component => component === 0))), "body force must not become a second nodal load");
  close(loaded.reactions.reduce((sum, node) => sum + node.fx, 0), -1, 1e-5,
    "48 kN/m³ on one 1/48 m³ tetrahedron");
  assert.ok(loaded.forceBalance.ok && loaded.equilibrium.equilibriumOk);

  const beforeInvalid = requests.length;
  const concrete = { kind: "concreteTensionDamage", tensileStrengthMpa: 3,
    fractureEnergyNPerM: 100, crackBandWidthM: 0.1 };
  await assert.rejects(() => solveFrame3D({ ...project.model3d,
    volumes: project.model3d.volumes.map((volume, index) => index === 0
      ? { ...volume, materialLaw: concrete } : volume) },
  1, "material", "openaec-native-fem"), /finite|J2|niet|alleen/i);
  await assert.rejects(() => solveFrame3D({ ...project.model3d,
    volumes: [{ ...project.model3d.volumes[0], kind: "hex8",
      nodeIds: [101, 103, 109, 107, 119, 121, 127, 125] },
    ...project.model3d.volumes.slice(1)] },
  1, "material", "openaec-native-fem"), /finite|Tet4|niet|alleen/i);
  assert.equal(requests.length, beforeInvalid,
    "unsupported mixed volume models must fail before native transport");
  assert.throws(() => parseFrame3DModel({ ...project.model3d,
    volumeMaterialKinematics: "unknown" }), /volumeMaterialKinematics|kinematica|ongeldig/i);
  console.log("Saved ordinary-app finite-strain Tet4 J2 patch matches an independent Hencky return, plastic history, first Piola stresses, free-center solution and global force balance.");
} finally {
  globalThis.fetch = originalFetch;
}
