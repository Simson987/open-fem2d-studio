import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deserializeProject } from "./src/io/projectFile.ts";
import { solveFrame3D } from "./src/components/frame3d/frame3dSolver.ts";

const project = deserializeProject(readFileSync(new URL(
  "../docs/verificatie/3d-volume/tet4-eindige-rek-j2-plastische-trekstaaf-membraan.ifcfem2d",
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
  const model = project.model3d;
  assert.deepEqual([model.volumes.length, model.plates.length, model.beams.length], [48, 8, 1]);
  assert.deepEqual(model.materialLoadPath, [1, 0]);
  assert.deepEqual(model.beams[0].nonlinearLaw, {
    kind: "steelBilinear", yieldMpa: 235, hardeningRatio: 0.01,
  });
  const computed = [];
  for (const backend of ["automatic", "frontalWave", "matrixFreeGmresLarge"]) {
    const result = await solveFrame3D({ ...model, volumeBackend: backend }, project.activeLoadCaseId,
      "material", "openaec-native-fem");
    const request = requests.at(-1);
    assert.equal(request.kind, "volume3dFiniteJ2MembraneCoupled");
    assert.deepEqual([request.input.volume.mesh.tets.length, request.input.trusses.length,
      request.input.membranes.length, request.input.volume.targets.length], [48, 1, 8, 2]);
    assert.deepEqual(request.input.volume.targets[1].loadsKn[13], [0, 0, 0]);
    const law = request.input.trusses[0].plasticity;
    assert.equal(law.yieldMpa, 235);
    assert.ok(Math.abs(law.hardeningMpa - 210000 * 0.01 / 0.99) < 1e-8);
    assert.deepEqual(result.materialLoadPath, [1, 0]);
    assert.ok(result.forceBalance.ok && result.equilibrium.equilibriumOk);
    assert.ok(result.volume3D.elements.some(element => element.equivalentPlasticStrain > 0));
    const bar = result.memberForces.find(member => member.memberId === 2001);
    assert.ok(bar?.axialHistory);
    const state = bar.axialHistory;
    assert.ok(state.equivalentPlasticStrain > 1e-4, `${backend}: bar plasticity`);
    assert.ok(Math.abs(state.plasticStrain) <= state.equivalentPlasticStrain + 1e-10);
    assert.ok(Number.isFinite(state.tangentEMpa) && state.tangentEMpa >= 0);
    const [start, end] = [114, 115].map(id => model.nodes.find(node => node.id === id));
    const [us, ue] = [114, 115].map(id => result.displacements.find(node => node.nodeId === id));
    const referenceLength = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const currentLength = Math.hypot(
      end.x + ue.ux - start.x - us.ux,
      end.y + ue.uy - start.y - us.uy,
      end.z + ue.uz - start.z - us.uz,
    );
    const stretch = currentLength / referenceLength;
    const conjugateStress = 210000 * (Math.log(stretch) - state.plasticStrain);
    const expectedForce = 1000 * 0.002 * conjugateStress / stretch;
    assert.ok(Math.abs(bar.nStartKn - expectedForce) < 1e-5,
      `${backend}: independent logarithmic bar force ${bar.nStartKn} vs ${expectedForce}`);
    computed.push({ result, state, center: result.displacements.find(node => node.nodeId === 114) });
  }
  for (const actual of computed.slice(1)) {
    for (const axis of ["ux", "uy", "uz"]) {
      assert.ok(Math.abs(actual.center[axis] - computed[0].center[axis]) < 1e-7,
        `backend parity ${axis}`);
    }
    assert.ok(Math.abs(actual.state.equivalentPlasticStrain
      - computed[0].state.equivalentPlasticStrain) < 1e-7);
  }
  console.log("Saved 48 Tet4 + eight Tri3 + plastic truss: 3 app backends, unloading history, equilibrium and independent bar force OK");
} finally {
  globalThis.fetch = originalFetch;
}
