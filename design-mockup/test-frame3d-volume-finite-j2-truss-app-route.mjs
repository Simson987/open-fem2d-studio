import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-met-trekstaaf.ifcfem2d",
  import.meta.url), "utf8"));
const binary = fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code, json: Buffer.concat(chunks).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  return new Response(answer.json, { status: answer.code === 0 ? 200 : 400 });
};

try {
  assert.equal(project.modelDimension, "3d");
  assert.equal(project.model3d.volumes.length, 48);
  assert.equal(project.model3d.beams.length, 1);
  assert.equal(project.model3d.beams[0].axialOnly, true);
  assert.equal(resolveSolver("openaec-native-fem", {
    schemaVersion: 1, dimension: "3d", analysis: "material-nonlinear",
    elementFamilies: ["solid", "frame"],
  }).id, "openaec-native-fem");
  const result = await solveFrame3D(project.model3d, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "volume3dFiniteJ2Coupled");
  assert.equal(requests[0].input.volume.mesh.tets.length, 48);
  assert.equal(requests[0].input.trusses.length, 1);
  const truss = requests[0].input.trusses[0];
  assert.deepEqual(truss.nodes, [13, 14]);
  assert.equal(truss.youngsMpa, 210_000);
  assert.ok(truss.areaM2 > 0);
  assert.equal(result.volume3D.formulation, "totalLagrangianJ2");
  assert.ok(result.volume3D.elements.every(element => element.equivalentPlasticStrain > 0),
    "the shared Newton path must retain J2 plastic history after unloading");
  assert.equal(result.memberForces.length, 1);
  assert.equal(result.memberForces[0].memberId, 2001);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  const start = project.model3d.nodes.find(node => node.id === 114);
  const end = project.model3d.nodes.find(node => node.id === 115);
  const startU = result.displacements.find(node => node.nodeId === 114);
  const endU = result.displacements.find(node => node.nodeId === 115);
  const originalLength = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const currentLength = Math.hypot(
    end.x + endU.ux - start.x - startU.ux,
    end.y + endU.uy - start.y - startU.uy,
    end.z + endU.uz - start.z - startU.uz,
  );
  const stretch = currentLength / originalLength;
  const expectedForce = 1_000 * truss.youngsMpa * truss.areaM2
    * (stretch ** 2 - 1) / 2 * stretch;
  assert.ok(Math.abs(result.memberForces[0].nStartKn - expectedForce) < 1e-5);
  assert.ok(Math.abs(result.memberForces[0].nEndKn - expectedForce) < 1e-5);
  const baseline = await solveFrame3D({ ...project.model3d, beams: [] }, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(requests[1].kind, "volume3dFiniteJ2");
  assert.ok(Math.abs(startU.ux - baseline.displacements.find(node => node.nodeId === 114).ux) > 1e-9,
    "the truss must influence the shared free solid node");
  const parallel = await solveFrame3D({ ...project.model3d,
    volumeBackend: "matrixFreeGmres", volumeThreads: 4 }, project.activeLoadCaseId,
  "material", "openaec-native-fem");
  assert.equal(requests[2].kind, "volume3dFiniteJ2Coupled");
  assert.equal(requests[2].input.volume.options.matrixFreeThreads, 4);
  assert.equal(parallel.volume3D.backendUsed, "matrixFreeGmres");
  assert.ok(Math.abs(parallel.memberForces[0].nStartKn - result.memberForces[0].nStartKn) < 1e-4);
  await assert.rejects(() => solveFrame3D({ ...project.model3d,
    volumeMaterialKinematics: "smallStrain" }, project.activeLoadCaseId,
  "material", "openaec-native-fem"), /eindige-rek|alleen/i);
  assert.equal(requests.length, 3, "unsupported route must reject before transport");
  console.log("Saved Tet4 finite J2 plus elastic finite truss app route: shared displacement, analytical axial force and equilibrium OK");
} finally {
  globalThis.fetch = originalFetch;
}
