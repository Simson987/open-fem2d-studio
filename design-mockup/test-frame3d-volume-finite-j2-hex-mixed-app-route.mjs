import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/gemengd-hex8-tet4-eindige-rek-j2-plastisch.ifcfem2d",
  import.meta.url), "utf8"));
const binary = fileURLToPath(new URL("../src-tauri/target/release/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  requests.push(body.inputs);
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
  const model = project.model3d;
  const counts = [model.volumes.filter(volume => volume.kind === "hex8").length,
    model.volumes.filter(volume => volume.kind === "tet4").length,
    model.plates.length, model.beams.length];
  assert.deepEqual(counts, [4, 24, 8, 1]);
  assert.deepEqual(model.materialLoadPath, [1, 0]);
  const results = [];
  for (const backend of ["automatic", "frontalWave", "matrixFreeGmresLarge"]) {
    const result = await solveFrame3D({ ...model, volumeBackend: backend },
      project.activeLoadCaseId, "material", "openaec-native-fem");
    const request = requests.at(-1);
    assert.equal(request.kind, "volume3dFiniteJ2HexCoupled");
    assert.deepEqual([request.input.volume.mesh.tets.length, request.input.hexes.length,
      request.input.membranes.length, request.input.trusses.length], [24, 4, 8, 1]);
    assert.equal(request.input.hexTargets.length, 2);
    assert.equal(request.input.hexTargets[0].bodyForces.length, 1);
    assert.equal(request.input.hexTargets[1].bodyForces[0].forceKnPerM3[2], 0);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    assert.equal(result.volume3D.elements.length, 28);
    assert.equal(result.volume3D.elements.filter(element => element.kind === "hex8").length, 4);
    for (const element of result.volume3D.elements.filter(element => element.kind === "hex8")) {
      assert.equal(element.gaussStressMpa.length, 8);
      assert.ok(element.gaussStressMpa.every(stress => stress.length === 6 && stress.every(Number.isFinite)));
      assert.ok(Number.isFinite(element.equivalentPlasticStrain));
    }
    assert.ok(result.memberForces[0].axialHistory.equivalentPlasticStrain > 0);
    assert.ok(result.volume3D.membranes[0].equivalentPlasticStrain > 0);
    results.push(result);
  }
  const reference = results[0].displacements.find(node => node.nodeId === 114);
  for (const result of results.slice(1)) {
    const actual = result.displacements.find(node => node.nodeId === 114);
    for (const axis of ["ux", "uy", "uz"]) {
      assert.ok(Math.abs(actual[axis] - reference[axis]) < 1e-6, `backend ${axis}`);
    }
    const firstHex = result.volume3D.elements.find(element => element.kind === "hex8");
    const referenceHex = results[0].volume3D.elements.find(element => element.kind === "hex8");
    assert.ok(Math.abs(firstHex.equivalentPlasticStrain - referenceHex.equivalentPlasticStrain) < 1e-6);
  }
  console.log("Saved 4 Hex8 + 24 Tet4 + 8 Tri3 + plastic truss: 3 backends and equilibrium OK");
} finally {
  globalThis.fetch = originalFetch;
}
