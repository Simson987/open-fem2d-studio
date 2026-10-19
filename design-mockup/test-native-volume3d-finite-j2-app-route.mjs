import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativeVolume3DFiniteJ2 } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/volume3d-finite-j2-steel-coupon.json", import.meta.url), "utf8"));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dFiniteJ2");
  calls++;
  const answer = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.on("error", reject);
    child.on("close", code => resolve({ code, body: Buffer.concat(output).toString() }));
    child.stdin.end(JSON.stringify(body));
  });
  return new Response(answer.body, {
    status: answer.code === 0 ? 200 : 400,
    headers: { "content-type": "application/json" },
  });
};

try {
  const result = await solveNativeVolume3DFiniteJ2(fixture.input);
  assert.equal(calls, 1);
  assert.equal(result.elementStates.length, 6);
  assert.equal(result.elementFirstPiolaMpa.length, 6);
  assert.equal(result.acceptedSteps.length, 2);
  assert.ok(result.elementStates.every(state => state.equivalentPlasticStrain > 0));
  assert.ok(result.trueFreeResidualKn < 1e-5);
  for (const node of [1, 3, 5, 7]) {
    assert.ok(Math.abs(result.nodalDisplacementsM[node][0] - 0.0035) < 1e-10);
  }
  for (let axis = 0; axis < 3; axis++) {
    const total = result.nodalReactionsKn.reduce((sum, value) => sum + value[axis], 0);
    assert.ok(Math.abs(total) < 1e-4, `reaction balance axis ${axis}: ${total}`);
  }
  assert.equal(result.linearBackendUsed, "dense");
  const sparse = await solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    options: { linearBackend: "sparseGmres" },
  });
  assert.equal(sparse.linearBackendUsed, "sparseGmres");
  assert.equal(sparse.acceptedSteps.length, result.acceptedSteps.length);
  assert.ok(sparse.trueFreeResidualKn < 1e-5);
  for (let element = 0; element < result.elementStates.length; element++) {
    assert.ok(Math.abs(sparse.elementStates[element].equivalentPlasticStrain
      - result.elementStates[element].equivalentPlasticStrain) < 1e-8);
  }
  const frontal = await solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    options: { linearBackend: "frontalWave" },
  });
  assert.equal(frontal.linearBackendUsed, "frontalWave");
  assert.ok(frontal.trueFreeResidualKn < 1e-5);
  for (let element = 0; element < result.elementStates.length; element++) {
    assert.ok(Math.abs(frontal.elementStates[element].equivalentPlasticStrain
      - result.elementStates[element].equivalentPlasticStrain) < 1e-8);
  }
  const matrixFree = await solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    options: { linearBackend: "matrixFreeGmres", matrixFreeThreads: 4 },
  });
  assert.equal(matrixFree.linearBackendUsed, "matrixFreeGmres");
  assert.ok(matrixFree.trueFreeResidualKn < 1e-5);
  for (let element = 0; element < result.elementStates.length; element++) {
    assert.ok(Math.abs(matrixFree.elementStates[element].equivalentPlasticStrain
      - result.elementStates[element].equivalentPlasticStrain) < 1e-8);
  }
  const large = await solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    options: { linearBackend: "matrixFreeGmresLarge", matrixFreeThreads: 4 },
  });
  assert.equal(large.linearBackendUsed, "matrixFreeGmresLarge");
  assert.ok(large.trueFreeResidualKn < 1e-5);
  for (let element = 0; element < result.elementStates.length; element++) {
    assert.ok(Math.abs(large.elementStates[element].equivalentPlasticStrain
      - result.elementStates[element].equivalentPlasticStrain) < 1e-8);
  }
  const automatic = await solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    options: { linearBackend: "automatic" },
  });
  assert.equal(automatic.linearBackendUsed, "sparseGmres");
  assert.equal(automatic.frontalFallbacks, 0);
  assert.ok(automatic.trueFreeResidualKn < 1e-5);
  for (let element = 0; element < result.elementStates.length; element++) {
    assert.ok(Math.abs(automatic.elementStates[element].equivalentPlasticStrain
      - result.elementStates[element].equivalentPlasticStrain) < 1e-8);
  }
  const distributed = await solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    targets: fixture.input.targets.map(target => ({
      ...target,
      bodyForces: [{ element: 0, forceKnPerM3: [100, 0, 0] }],
      faceTractions: [{ element: 0, faceNodes: [0, 1, 3], tractionKnPerM2: [0, 10, 0] }],
    })),
    options: { linearBackend: "sparseGmres" },
  });
  assert.equal(distributed.linearBackendUsed, "sparseGmres");
  assert.ok(distributed.trueFreeResidualKn < 1e-5);
  assert.ok(distributed.elementStates.every(state => state.equivalentPlasticStrain > 0));
  const totals = [0, 1, 2].map(axis => distributed.nodalReactionsKn
    .reduce((sum, value) => sum + value[axis], 0));
  assert.ok(Math.abs(totals[0] + 100 / 6) < 1e-4);
  assert.ok(Math.abs(totals[1] + 5) < 1e-4);
  assert.ok(Math.abs(totals[2]) < 1e-4);
  await assert.rejects(() => solveNativeVolume3DFiniteJ2({
    ...fixture.input,
    targets: fixture.input.targets.map((target, index) => index === 0
      ? { ...target, followerTractions: [{ element: 0, tractionKnPerM2: [1, 0, 0] }] } : target),
  }), /unknown field `followerTractions`/);
  assert.equal(calls, 8);
  console.log("native-volume3d-finite-j2-app-route: dense/GMRES/frontal/matrix-free/large/automatic, distributed loads, plastic history, and unsupported-load rejection OK");
} finally {
  globalThis.fetch = originalFetch;
}
