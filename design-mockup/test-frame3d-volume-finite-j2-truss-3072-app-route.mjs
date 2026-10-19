import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes-trekstaaf.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.equal(model.nodes.length, 729);
assert.equal(model.volumes.length, 3_072);
assert.equal(model.beams.length, 1);
assert.equal(model.volumeBackend, "matrixFreeGmres");
assert.equal(model.volumeThreads, 4);
const binary = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.inputs.kind, "volume3dFiniteJ2Coupled");
  assert.equal(body.inputs.input.volume.mesh.tets.length, 3_072);
  assert.equal(body.inputs.input.trusses.length, 1);
  assert.equal(body.inputs.input.volume.options.matrixFreeThreads, 4);
  calls++;
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [], errors = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.stderr.on("data", chunk => errors.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code,
      text: Buffer.concat(output).toString(), error: Buffer.concat(errors).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  if (answer.code !== 0) throw new Error(answer.error || answer.text);
  return new Response(answer.text, { status: 200 });
};

try {
  const started = performance.now();
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(calls, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreeGmres");
  assert.equal(result.volume3D.elements.length, 3_072);
  assert.equal(result.memberForces.length, 1);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.volume3D.elements.some(element => element.equivalentPlasticStrain > 0));
  const nodes = new Map(model.nodes.map(node => [node.id, node]));
  const displacements = new Map(result.displacements.map(node => [node.nodeId, node]));
  const start = nodes.get(465), end = nodes.get(469);
  const startU = displacements.get(465), endU = displacements.get(469);
  const originalLength = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const currentLength = Math.hypot(
    end.x + endU.ux - start.x - startU.ux,
    end.y + endU.uy - start.y - startU.uy,
    end.z + endU.uz - start.z - startU.uz,
  );
  const stretch = currentLength / originalLength;
  const areaM2 = 0.02; // rectangle 200×100 mm from the saved model
  const expected = 1_000 * 210_000 * areaM2 * (stretch ** 2 - 1) / 2 * stretch;
  const force = result.memberForces[0].nStartKn;
  assert.ok(Math.abs(force - expected) < 1e-4,
    `Green-truss axial force ${force} vs ${expected}`);
  assert.ok(Math.abs(startU.ux - 0.00075) > 1e-8,
    "the truss must alter the free center displacement from the affine pure-solid solution");
  console.log(`3072 Tet4 plus shared finite truss: 4-thread matrix-free GMRES, `
    + `center ux ${startU.ux.toExponential(5)} m, N ${force.toFixed(3)} kN, `
    + `equilibrium OK, ${(performance.now() - started).toFixed(0)} ms`);
} finally {
  globalThis.fetch = originalFetch;
}
