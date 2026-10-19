import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const linearProject = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven.ifcfem2d",
  import.meta.url), "utf8"));
const finiteProject = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/hex8-verbonden-raamwerk-1143-volumes-5104-staven-j2-buiging.ifcfem2d",
  import.meta.url), "utf8"));
const geometricFrames = process.env.FEM_GEOMETRIC_FRAMES === "1";
const linearModel = linearProject.model3d;
const finiteModel = finiteProject.model3d;
for (const model of [linearModel, finiteModel]) {
  assert.deepEqual([model.nodes.length, model.beams.length, model.volumes.length],
    [2_048, 5_104, 1_143]);
  assert.ok(model.beams.every(beam => !beam.axialOnly));
}
for (const key of ["nodes", "beams", "supports", "loads"]) {
  assert.deepEqual(finiteModel[key], linearModel[key], `${key} must be identical`);
}
assert.ok(finiteModel.volumes.every(volume => volume.materialLaw?.kind === "steelJ2"
  && volume.materialLaw.yieldMpa === 235));
assert.equal(finiteModel.volumeMaterialKinematics, "finiteStrain");
assert.equal(finiteModel.volumeBackend, "automatic");
assert.equal(finiteModel.volumeResidualTolerance, 1e-8);
assert.deepEqual(finiteModel.materialLoadPath, [1]);
assert.equal(frame3DAnalysisForProject(finiteModel, finiteProject.analysetype), "combined",
  "de ontwikkelapp moet bij fysisch tweede orde ook de raamwerkgeometrie meenemen");

const mixedBinary = process.env.FEM_MIXED3D_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/native-mixed3d", import.meta.url));
const finiteBinary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const observedKinds = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  const kind = body.inputs.kind;
  assert.ok(["mixed3d", "volume3dFiniteJ2FrameCoupled"].includes(kind));
  observedKinds.push(kind);
  const mixed = kind === "mixed3d";
  const input = body.inputs.input;
  if (mixed) {
    assert.deepEqual([input.frames.length, input.hexes.length], [5_104, 1_143]);
  } else {
    assert.deepEqual([input.frames.length, input.hexes.length,
      input.volume.targets.length], [5_104, 1_143, 1]);
    assert.equal(input.volume.options.linearBackend, "automatic");
    assert.equal(input.volume.options.residualTolerance, 1e-8);
    assert.equal(Boolean(input.volume.options.geometricFrames), geometricFrames);
  }
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(mixed ? mixedBinary : finiteBinary, [],
      { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const output = Buffer.concat(stdout).toString();
      if (code === 0) resolve(output);
      else reject(new Error(output || Buffer.concat(stderr).toString()));
    });
    child.stdin.end(JSON.stringify(mixed ? input : body));
  });
  return new Response(mixed
    ? JSON.stringify({ kind: "mixed3d", result: JSON.parse(raw) }) : raw,
    { status: 200 });
};

try {
  const start = performance.now();
  const linear = await solveFrame3D(linearModel, linearProject.activeLoadCaseId,
    "linear", "openaec-native-fem");
  const finiteStart = performance.now();
  const finite = await solveFrame3D(finiteModel, finiteProject.activeLoadCaseId,
    geometricFrames ? "combined" : "material", "openaec-native-fem");
  assert.equal(finite.analysis, geometricFrames ? "combined" : "material");
  assert.deepEqual(observedKinds, ["mixed3d", "volume3dFiniteJ2FrameCoupled"]);
  for (const result of [linear, finite]) {
    assert.deepEqual([result.displacements.length, result.memberForces.length,
      result.volume3D.elements.length], [2_048, 5_104, 1_143]);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    assert.ok(result.equilibrium.relativeResidual < 1e-8);
  }
  assert.equal(linear.volume3D.backendUsed, "matrixFreePcg");
  assert.equal(finite.volume3D.backendUsed, "frontalWave");
  let maxTranslation = 0, maxRotation = 0, maxStress = 0;
  let maxPlastic = 0, maxMemberAction = 0;
  for (let i = 0; i < 2_048; i++) {
    const a = linear.displacements[i], b = finite.displacements[i];
    assert.equal(a.nodeId, b.nodeId);
    for (const key of ["ux", "uy", "uz"]) {
      maxTranslation = Math.max(maxTranslation, Math.abs(a[key] - b[key]));
    }
    for (const key of ["rx", "ry", "rz"]) {
      maxRotation = Math.max(maxRotation, Math.abs(a[key] - b[key]));
    }
  }
  for (let i = 0; i < 5_104; i++) {
    const a = linear.memberForces[i], b = finite.memberForces[i];
    assert.equal(a.memberId, b.memberId);
    for (const [key, value] of Object.entries(a)) {
      if (key !== "memberId" && typeof value === "number"
          && typeof b[key] === "number") {
        maxMemberAction = Math.max(maxMemberAction, Math.abs(value - b[key]));
      }
    }
  }
  for (let i = 0; i < 1_143; i++) {
    const a = linear.volume3D.elements[i], b = finite.volume3D.elements[i];
    assert.equal(a.elementId, b.elementId);
    for (let axis = 0; axis < 6; axis++) {
      maxStress = Math.max(maxStress, Math.abs(a.stressMpa[axis] - b.stressMpa[axis]));
    }
    maxPlastic = Math.max(maxPlastic, b.equivalentPlasticStrain);
  }
  assert.ok(maxTranslation < 1e-9, `translations differ by ${maxTranslation} m`);
  assert.ok(maxRotation < 1e-9, `rotations differ by ${maxRotation} rad`);
  assert.ok(maxStress < 1e-5, `Hex8 stresses differ by ${maxStress} MPa`);
  assert.ok(maxMemberAction < 1e-3,
    `member forces/moments differ by ${maxMemberAction} kN or kNm`);
  assert.equal(maxPlastic, 0);
  const tip = finite.displacements.find(node => node.nodeId === 2_048);
  assert.ok(tip.uz < 0 && Math.abs(tip.uz + 0.000121989) < 1e-8);
  console.log(`Large bending/torsion finite J2 ${geometricFrames ? "geometric-frame" : "linear-frame"} limit: 5,104 frames + 1,143 Hex8; `
    + `node translation ${maxTranslation.toExponential(3)} m, rotation `
    + `${maxRotation.toExponential(3)} rad, stress ${maxStress.toExponential(3)} MPa, `
    + `member action ${maxMemberAction.toExponential(3)}, zero plastic strain; `
    + `linear ${((finiteStart - start) / 1_000).toFixed(2)} s, finite J2 `
    + `${((performance.now() - finiteStart) / 1_000).toFixed(2)} s.`);
} finally {
  globalThis.fetch = originalFetch;
}
