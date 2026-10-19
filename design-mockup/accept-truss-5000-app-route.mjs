import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-raamwerk/trekstaven-5000-analytische-keten.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(model.nodes.length, 5_001);
assert.equal(model.beams.length, 5_000);
assert.ok(model.beams.every((beam) => beam.axialOnly));
const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed3d", import.meta.url));
const originalFetch = globalThis.fetch;
let input;
globalThis.fetch = async (_url, options) => {
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "mixed3d");
  input = body.inputs.input;
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code, output: Buffer.concat(stdout).toString(),
      error: Buffer.concat(stderr).toString() }));
    child.stdin.end(JSON.stringify(input));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.output);
  return new Response(JSON.stringify({ kind: "mixed3d", result: JSON.parse(answer.output) }),
    { status: 200 });
};

try {
  const start = performance.now();
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(input.mesh.nodes.length, 5_001);
  assert.equal(input.mesh.tets.length, 0);
  assert.equal(input.hexes.length, 0);
  assert.equal(input.trusses.length, 5_000);
  assert.equal(input.backend, "frontalWave");
  assert.equal(result.memberForces.length, 5_000);
  const { eMpa, areaM2 } = input.trusses[0];
  const totalLengthM = model.nodes.at(-1).x - model.nodes[0].x;
  const referenceTipM = 10 * totalLengthM / (1_000 * eMpa * areaM2);
  const tipM = result.displacements.at(-1).ux;
  assert.ok(Math.abs(tipM - referenceTipM) < 1e-7 * referenceTipM,
    `tip ${tipM} m, analytic FL/EA ${referenceTipM} m`);
  for (const member of result.memberForces) {
    assert.ok(Math.abs(member.nStartKn - 10) < 1e-7);
    assert.ok(Math.abs(member.nEndKn - 10) < 1e-7);
  }
  assert.ok(Math.abs(result.reactions[0].fx + 10) < 1e-7);
  assert.ok(result.forceBalance.ok);
  assert.ok(result.equilibrium.equilibriumOk);
  console.log(`5,000 axiale 3D-staven in de app: ${((performance.now() - start) / 1_000).toFixed(2)} s; `
    + `tip ${(tipM * 1_000).toFixed(3)} mm = FL/EA; 5,000 normaalkrachten en reactie akkoord.`);

  const matrixFreeModel = {
    ...model,
    nodes: model.nodes.slice(0, 65),
    beams: model.beams.slice(0, 64),
    supports: model.supports.slice(0, 65),
    loads: [{ ...model.loads[0], nodeId: 65 }],
    volumeBackend: "matrixFreePcg",
  };
  const matrixFree = await solveFrame3D(matrixFreeModel, project.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(input.backend, "matrixFreePcg");
  assert.equal(matrixFree.volume3D.backendUsed, "matrixFreePcg");
  const matrixFreeTip = matrixFree.displacements.at(-1).ux;
  const matrixFreeReference = 10 * (matrixFreeModel.nodes.at(-1).x - matrixFreeModel.nodes[0].x)
    / (1_000 * input.trusses[0].eMpa * input.trusses[0].areaM2);
  assert.ok(Math.abs(matrixFreeTip - matrixFreeReference) < 1e-7 * matrixFreeReference);
  assert.ok(matrixFree.forceBalance.ok);

  const spatialProject = deserializeProject(readFileSync(new URL(
    "../docs/verificatie/3d-raamwerk/ruimtelijk-vakwerk-5638-staven.ifcfem2d",
    import.meta.url), "utf8"));
  const spatialStart = performance.now();
  const spatial = await solveFrame3D(spatialProject.model3d, spatialProject.activeLoadCaseId,
    "linear", "openaec-native-fem");
  assert.equal(input.mesh.nodes.length, 1_028);
  assert.equal(input.trusses.length, 5_638);
  assert.equal(input.mesh.tets.length, 0);
  assert.equal(input.hexes.length, 0);
  assert.equal(spatial.memberForces.length, 5_638);
  assert.ok(spatial.memberForces.every((member) => Number.isFinite(member.nStartKn)));
  assert.ok(spatial.displacements.at(-1).uz < 0);
  assert.ok(spatial.equilibrium.equilibriumOk);
  assert.ok(spatial.forceBalance.ok);
  const totalReaction = spatial.reactions.reduce((sum, node) => {
    sum[0] += node.fx; sum[1] += node.fy; sum[2] += node.fz;
    return sum;
  }, [0, 0, 0]);
  assert.ok(Math.abs(totalReaction[0] + 1) < 1e-6);
  assert.ok(Math.abs(totalReaction[1]) < 1e-6);
  assert.ok(Math.abs(totalReaction[2] - 10) < 1e-6);
  console.log(`5,638-staven ruimtelijk vakwerk in de app: `
    + `${((performance.now() - spatialStart) / 1_000).toFixed(2)} s; `
    + `1,028 knopen, vrije residu en globale kracht/moment-balans akkoord.`);
} finally {
  globalThis.fetch = originalFetch;
}
