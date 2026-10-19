import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { defaultCombinations } from "./src/components/fem/solver/combinations.ts";
import { solveFrame3D, solveFrame3DCombination } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-hex8-j2-buigraamwerk.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(model.volumes.length, 3);
assert.equal(model.beams.length, 1);
assert.ok(!model.beams[0].axialOnly);
assert.deepEqual(model.materialLoadPath, [0.5, 1]);

const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
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
  const results = [];
  for (const backend of ["sparseGmres", "frontalWave", "matrixFreeGmres"]) {
    const result = await solveFrame3D({ ...model, volumeBackend: backend },
      project.activeLoadCaseId, "material", "openaec-native-fem");
    const request = requests.at(-1);
    assert.equal(request.kind, "volume3dFiniteJ2FrameCoupled");
    assert.deepEqual([request.input.volume.mesh.tets.length, request.input.hexes.length,
      request.input.frames.length, request.input.frameTargets.length], [2, 1, 1, 2]);
    assert.equal(request.input.frameTargets[1].prescribedRotationRad[8][1], 0);
    assert.equal(result.displacements.length, 10);
    assert.equal(result.volume3D.elements.length, 3);
    assert.equal(result.memberForces.length, 1);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk,
      `backend ${backend}: ${JSON.stringify(result.forceBalance)}`);
    const tip = result.displacements.find(node => node.nodeId === 10);
    assert.ok(tip && Math.abs(tip.uz) > 0 && Number.isFinite(tip.ry));
    const beam = result.memberForces[0];
    assert.ok(Math.abs(Math.abs(beam.vzStartKn) - 10) < 1e-5,
      `${backend} start shear ${beam.vzStartKn}`);
    assert.ok(Math.abs(Math.abs(beam.myStartKnm) - 10) < 1e-5,
      `${backend} start moment ${beam.myStartKnm}`);
    assert.ok(Math.abs(beam.myEndKnm) < 1e-5,
      `${backend} free-end moment ${beam.myEndKnm}`);
    results.push(result);
  }
  const referenceTip = results[0].displacements.find(node => node.nodeId === 10);
  for (const result of results.slice(1)) {
    const tip = result.displacements.find(node => node.nodeId === 10);
    for (const axis of ["ux", "uy", "uz", "rx", "ry", "rz"]) {
      assert.ok(Math.abs(tip[axis] - referenceTip[axis]) < 1e-7,
        `${result.solverPath} tip ${axis} backend parity`);
    }
  }
  assert.equal(model.volumeBackend, "automatic");
  for (const combination of defaultCombinations(project.loadCases)) {
    const result = await solveFrame3DCombination(model, combination.factors,
      "material", "openaec-native-fem");
    assert.equal(result.volume3D.elements.length, 3);
    assert.equal(result.memberForces.length, 1);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk,
      `${combination.name}: ${JSON.stringify(result.forceBalance)}`);
    assert.ok(result.equilibrium.relativeResidual < 1e-8,
      `${combination.name}: residual ${result.equilibrium.relativeResidual}`);
    if (combination.factors.get(project.activeLoadCaseId) === 0.3) {
      assert.equal(result.volume3D.backendUsed, "frontalWave",
        "small quasi-permanent step must recover from sparse Newton to frontal");
    }
  }
  console.log("Saved J2 Tet4/Hex8 + full bending frame: 3 active-load backends, 5 app combinations with automatic frontal recovery, independent 10 kN / 10 kNm beam check and global balance OK");
} finally {
  globalThis.fetch = originalFetch;
}
