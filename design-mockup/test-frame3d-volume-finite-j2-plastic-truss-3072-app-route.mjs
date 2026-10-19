import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-3072-volumes-plastische-trekstaaf.ifcfem2d",
  import.meta.url), "utf8"));
const model = project.model3d;
assert.deepEqual([model.nodes.length, model.volumes.length, model.beams.length], [729, 3_072, 1]);
assert.deepEqual(model.materialLoadPath, [4 / 3, 1]);
assert.deepEqual(model.beams[0].nonlinearLaw,
  { kind: "steelBilinear", yieldMpa: 100, hardeningRatio: 0.01 });
const binary = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.inputs.kind, "volume3dFiniteJ2Coupled");
  assert.deepEqual([body.inputs.input.volume.mesh.tets.length,
    body.inputs.input.trusses.length, body.inputs.input.volume.targets.length], [3_072, 1, 2]);
  assert.equal(body.inputs.input.volume.options.matrixFreeThreads, 4);
  const law = body.inputs.input.trusses[0].plasticity;
  assert.equal(law.yieldMpa, 100);
  assert.ok(Math.abs(law.hardeningMpa - 210_000 * 0.01 / 0.99) < 1e-8);
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
  const result = await solveFrame3D(model, project.activeLoadCaseId,
    "material", "openaec-native-fem");
  assert.equal(calls, 1);
  assert.equal(result.volume3D.backendUsed, "matrixFreeGmres");
  assert.equal(result.volume3D.elements.length, 3_072);
  assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
  assert.ok(result.volume3D.elements.some(element => element.equivalentPlasticStrain > 0));
  const bar = result.memberForces.find(member => member.memberId === 4001);
  assert.ok(bar?.axialHistory?.equivalentPlasticStrain > 0,
    "the large shared-node bar must plastify");
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
  const expectedKn = 1_000 * 0.02 * 210_000
    * (Math.log(stretch) - bar.axialHistory.plasticStrain) / stretch;
  assert.ok(Math.abs(bar.nStartKn - expectedKn) < 1e-4,
    `independent logarithmic force ${bar.nStartKn} vs ${expectedKn}`);
  assert.ok(Math.abs(startU.ux - 0.00075) > 1e-8,
    "the plastic bar must change the free center displacement");
  console.log(`Saved 3072 Tet4 + plastic truss: four-thread matrix-free GMRES, `
    + `N=${bar.nStartKn.toFixed(3)} kN, plastic history `
    + `${bar.axialHistory.equivalentPlasticStrain.toExponential(3)}, equilibrium OK`);
} finally {
  globalThis.fetch = originalFetch;
}
