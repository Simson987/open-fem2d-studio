import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const unload = process.env.FEM_PLASTIC_UNLOAD === "1";
const softFourStep = process.env.FEM_PLASTIC_SOFT_FOUR_STEPS === "1";
const memberLoads = process.env.FEM_PLASTIC_MEMBER_LOADS === "1";
assert.ok(Number(unload) + Number(softFourStep) + Number(memberLoads) <= 1);
const projectFile = softFourStep
  ? "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging-4-stappen.ifcfem2d"
  : memberLoads
    ? "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-punt-en-lijnlast.ifcfem2d"
  : unload
  ? "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging-ontlast.ifcfem2d"
  : "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-plastische-buiging.ifcfem2d";
const project = deserializeProject(readFileSync(new URL(projectFile, import.meta.url), "utf8"));
const elasticProject = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-buiging.ifcfem2d",
  import.meta.url), "utf8"));
const yieldMpa = 0.001;
const hardeningMpa = Number(process.env.FEM_HARDENING_MPA ?? (softFourStep ? 300 : 3_000));
const loadSteps = Number(process.env.FEM_LOAD_STEPS ?? (softFourStep ? 4 : 1));
const residualTolerance = Number(process.env.FEM_RESIDUAL_TOLERANCE ?? (softFourStep ? 1e-7 : 1e-8));
assert.ok(Number.isFinite(hardeningMpa) && hardeningMpa > 0);
assert.ok(Number.isInteger(loadSteps) && loadSteps >= 1 && loadSteps <= 8);
assert.ok(Number.isFinite(residualTolerance)
  && residualTolerance >= 1e-12 && residualTolerance <= 1e-4);
assert.ok(!unload || loadSteps === 1);
for (const key of ["nodes", "beams", "supports", "loads"]) {
  assert.deepEqual(project.model3d[key], elasticProject.model3d[key],
    `${key} must match the independent elastic-limit project`);
}
const volumeCount = Number(process.env.FEM_VOLUME_COUNT ?? 1_143);
assert.ok(Number.isInteger(volumeCount) && volumeCount > 0 && volumeCount <= 1_143);
const maxNewton = process.env.FEM_MAX_NEWTON ? Number(process.env.FEM_MAX_NEWTON) : null;
const maxCutbacks = process.env.FEM_MAX_CUTBACKS ? Number(process.env.FEM_MAX_CUTBACKS) : null;
assert.ok(maxNewton === null || (Number.isInteger(maxNewton) && maxNewton >= 1 && maxNewton <= 50));
assert.ok(maxCutbacks === null || (Number.isInteger(maxCutbacks) && maxCutbacks >= 1 && maxCutbacks <= 24));
const model = { ...project.model3d,
  volumes: project.model3d.volumes.slice(0, volumeCount).map(volume => ({ ...volume,
    materialLaw: { kind: "steelJ2", yieldMpa, hardeningMpa } })),
  materialLoadPath: loadSteps === 1 ? project.model3d.materialLoadPath
    : Array.from({ length: loadSteps }, (_, i) => (i + 1) / loadSteps),
  volumeResidualTolerance: residualTolerance,
};
if (softFourStep && !process.env.FEM_HARDENING_MPA && !process.env.FEM_LOAD_STEPS
  && !process.env.FEM_RESIDUAL_TOLERANCE && volumeCount === 1_143) {
  assert.deepEqual(model, project.model3d,
    "the four-step acceptance must use the stored project without mutation");
}
if (memberLoads && volumeCount === 1_143) {
  assert.deepEqual(model, project.model3d,
    "the large member-load acceptance must use the stored project without mutation");
  assert.deepEqual([model.memberPointLoads?.length, model.memberLoads?.length], [1, 1]);
}
if (loadSteps === 1) assert.deepEqual(model.materialLoadPath, unload ? [1, 0] : [1]);
assert.deepEqual([model.nodes.length, model.beams.length, model.volumes.length],
  [2_048, 5_104, volumeCount]);
assert.ok(model.volumes.every(volume => volume.materialLaw?.kind === "steelJ2"
  && volume.materialLaw.yieldMpa === yieldMpa
  && volume.materialLaw.hardeningMpa === hardeningMpa));
assert.equal(frame3DAnalysisForProject(model, project.analysetype), "combined");

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
  if (maxNewton !== null) body.inputs.input.volume.options.maxNewtonIterations = maxNewton;
  if (maxCutbacks !== null) body.inputs.input.volume.options.maxCutbacks = maxCutbacks;
  assert.deepEqual([body.inputs.input.frames.length, body.inputs.input.hexes.length,
    body.inputs.input.volume.targets.length], [5_104, volumeCount, unload ? 2 : loadSteps]);
  assert.equal(body.inputs.input.volume.options.geometricFrames, true);
  if (memberLoads) {
    const totalVerticalKn = body.inputs.input.volume.targets[0].loadsKn
      .reduce((sum, load) => sum + load[2], 0);
    // The original corner force is -10 kN; the point and line loads add
    // -1 kN and -0.25 kN. This checks the adapter's independent resultant.
    assert.ok(Math.abs(totalVerticalKn + 11.25) < 1e-10,
      `member-load vertical resultant ${totalVerticalKn} kN`);
  }
  if (unload) {
    assert.ok(body.inputs.input.volume.targets[1].loadsKn.every(force =>
      force.every(value => Math.abs(value) < 1e-12)));
  }
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

function vonMises([xx, yy, zz, xy, yz, zx]) {
  return Math.sqrt(((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) / 2
    + 3 * (xy ** 2 + yz ** 2 + zx ** 2));
}

try {
  const start = performance.now();
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "combined", "openaec-native-fem");
  assert.deepEqual([result.displacements.length, result.memberForces.length,
    result.volume3D.elements.length], [2_048, 5_104, volumeCount]);
  assert.equal(result.diagrams.momentY.length, 5_104);
  if (memberLoads) {
    const loadedBeam = model.memberLoads[0].beamId;
    const curve = result.diagrams.momentY.find(item => item.memberId === loadedBeam);
    assert.ok(curve && curve.points.length >= 21 && Number.isFinite(curve.maxAbsValue),
      "the large coupled J2 frame retains bounded member-load field stations");
  }
  assert.ok(result.equilibrium.equilibriumOk && result.forceBalance.ok);
  // At zero external force the app reports the absolute free residual in kN
  // (denominator 1); its explicit absolute equilibrium gate is 1e-7 kN.
  const residualLimit = unload ? 1e-7 : model.volumeResidualTolerance;
  assert.ok(result.equilibrium.relativeResidual < residualLimit,
    `free residual ${result.equilibrium.relativeResidual} exceeds ${residualLimit}`);
  const elements = result.volume3D.elements;
  const plastic = elements.filter(element => element.equivalentPlasticStrain > 1e-12);
  let maxPlastic = 0, maxYieldExcess = 0;
  for (const element of elements) {
    assert.ok(element.stressMpa.every(Number.isFinite));
    const p = element.equivalentPlasticStrain;
    assert.ok(Number.isFinite(p) && p >= 0);
    maxPlastic = Math.max(maxPlastic, p);
    // The norm of the averaged deviatoric stress cannot exceed the average
    // Gauss-point J2 yield stress for linear isotropic hardening.
    maxYieldExcess = Math.max(maxYieldExcess,
      vonMises(element.stressMpa) - (yieldMpa + hardeningMpa * p));
  }
  assert.ok(plastic.length > 0, "the non-affine load must plastify at least one Hex8");
  if (volumeCount === 1_143) {
    assert.ok(plastic.length > 1_000, "plasticity must span the large volume grid");
    if (unload) assert.ok(maxPlastic > 3e-7, "J2 history must survive unloading");
  }
  assert.ok(maxYieldExcess < 1e-6,
    `J2 yield surface exceeded by ${maxYieldExcess} MPa`);
  const tip = result.displacements.find(node => node.nodeId === 2_048);
  assert.ok(tip && Number.isFinite(tip.uz));
  if (unload && volumeCount === 1_143) {
    assert.ok(Math.abs(tip.uz) > 1e-6,
      "permanent displacement must remain after all external load is removed");
  }
  if (volumeCount === 1_143 && !unload) {
    // The same full elastic grid has |uz|=0.121989 mm in the independent
    // linear mixed3d route; plastic yielding must make it more compliant.
    assert.ok(Math.abs(tip.uz) > 1.1 * 0.000121989);
    if (memberLoads) assert.ok(tip.uz < -0.000137028,
      "member point and line loads must add downward tip displacement");
  }
  console.log(`Non-affine ${unload ? "plastic unload" : "plastic load"} frame/volume: 5,104 frames + ${volumeCount} Hex8, H=${hardeningMpa} MPa, steps=${loadSteps}, `
    + `${plastic.length} plastic elements, max p=${maxPlastic.toExponential(3)}, `
    + `max yield excess=${maxYieldExcess.toExponential(3)} MPa, `
    + `tip uz=${(tip.uz * 1_000).toFixed(6)} mm, `
    + `residual=${result.equilibrium.relativeResidual.toExponential(3)}, `
    + `backend=${result.volume3D.backendUsed}, `
    + `${((performance.now() - start) / 1_000).toFixed(2)} s.`);
} finally {
  globalThis.fetch = previousFetch;
}
