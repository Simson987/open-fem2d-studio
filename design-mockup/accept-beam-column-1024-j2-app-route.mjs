import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { buildFrame3DSolveRequest, frame3DAnalysisForProject, solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-j2-staafkolom-1024-elementen.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.deepEqual([model.nodes.length, model.beams.length, model.volumes.length],
  [1_028, 1_024, 1]);
assert.equal(frame3DAnalysisForProject(model, project.analysetype), "combined");
const request = buildFrame3DSolveRequest(model, "combined", project.activeLoadCaseId, true);
const member = request.members[0];
const section = request.sections.find(item => item.id === member.sectionId);
const material = request.materials.find(item => item.id === member.materialId);
const lengthM = 20, compressionKn = 0.5, transverseKn = 0.01;
const eiKnm2 = material.eMpa * 1_000 * section.iyM4;
const wave = Math.sqrt(compressionKn / eiKnm2);
const criticalKn = Math.PI ** 2 * eiKnm2 / (4 * lengthM ** 2);
assert.ok(compressionKn < criticalKn);
const firstOrderM = transverseKn * lengthM ** 3 / (3 * eiKnm2);
// Fixed-free beam-column closed solution for EI*w'''' + P*w'' = 0.
const secondOrderM = transverseKn / compressionKn
  * (Math.tan(wave * lengthM) / wave - lengthM);
const binary = process.env.NATIVE_FEM_BINARY
  ?? fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const previousFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2FrameCoupled");
  const input = body.inputs.input;
  assert.deepEqual([input.frames.length, input.volume.mesh.tets.length,
    input.hexes.length, input.volume.targets.length], [1_024, 1, 0, 4]);
  assert.equal(input.volume.options.geometricFrames, true);
  const raw = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [], stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const output = Buffer.concat(stdout).toString();
      if (code === 0) resolve(output);
      else reject(new Error(output || Buffer.concat(stderr).toString()));
    });
    child.stdin.end(JSON.stringify(body));
  });
  return new Response(raw, { status: 200 });
};
try {
  const start = performance.now();
  const solved = await solveFrame3D(model, project.activeLoadCaseId,
    "combined", "openaec-native-fem");
  assert.equal(solved.analysis, "combined");
  assert.deepEqual([solved.displacements.length, solved.memberForces.length,
    solved.volume3D.elements.length], [1_028, 1_024, 1]);
  assert.ok(solved.forceBalance.ok && solved.equilibrium.equilibriumOk);
  assert.ok(solved.equilibrium.relativeResidual < 1e-6);
  const root = solved.displacements.find(node => node.nodeId === 1);
  const tip = solved.displacements.find(node => node.nodeId === 1_028);
  const deflectionM = Math.abs(tip.uz - root.uz);
  assert.ok(Math.abs(deflectionM - secondOrderM) / secondOrderM < 0.02,
    `large beam-column ${deflectionM} m, closed solution ${secondOrderM} m`);
  assert.ok(deflectionM > 1.08 * firstOrderM);
  assert.ok(Math.max(...solved.displacements.map(node => Math.abs(node.ry))) < 0.1);
  assert.equal(solved.volume3D.elements[0].equivalentPlasticStrain, 0);
  console.log(`1,024-frame + Tet4 beam-column: ${deflectionM.toExponential(8)} m `
    + `vs closed ${secondOrderM.toExponential(8)} m, first-order ${firstOrderM.toExponential(8)} m; `
    + `P/Pcr=${(compressionKn / criticalKn).toFixed(3)}, residual=${solved.equilibrium.relativeResidual.toExponential(3)}, `
    + `backend=${solved.volume3D.backendUsed}, ${((performance.now() - start) / 1_000).toFixed(2)} s.`);
} finally {
  globalThis.fetch = previousFetch;
}
