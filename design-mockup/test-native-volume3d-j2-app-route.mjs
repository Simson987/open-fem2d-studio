import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativeVolume3DJ2 } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d-j2", import.meta.url));
const fixture = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/volume3d-j2-steel-coupon.json", import.meta.url), "utf8"));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "volume3dJ2");
  calls++;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    child.stdout.on("data", chunk => output.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      const raw = Buffer.concat(output).toString();
      code === 0 ? resolve(JSON.parse(raw)) : reject(new Error(raw));
    });
    child.stdin.end(JSON.stringify(body.inputs.input));
  });
  return new Response(JSON.stringify({ kind: "volume3dJ2", result }), { status: 200 });
};

try {
  const result = await solveNativeVolume3DJ2(fixture.input);
  assert.equal(calls, 1);
  assert.ok(result.acceptedSteps.length >= 2);
  assert.ok(result.elementStates.every(state => state.equivalentPlasticStrain > 0));
  const { youngsMpa: e, yieldMpa: fy, hardeningMpa: h } = fixture.input.steel;
  const plasticStrain = (e * 0.004 - fy) / (e + h);
  const expectedReaction = e * (0.0035 - plasticStrain) * 1000;
  const rightReaction = [1, 3, 5, 7].reduce((sum, node) => sum + result.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(rightReaction - expectedReaction) < 1e-4);
  assert.ok(result.trueFreeResidualKn < 1e-4);
  assert.equal(result.linearBackendUsed, "sparseDirect");
  const distributed = await solveNativeVolume3DJ2({
    mesh: { nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], tets: [[0, 1, 2, 3]] },
    steel: fixture.input.steel,
    targets: [{
      loadsKn: Array.from({ length: 4 }, () => [0, 0, 0]),
      prescribedM: Array.from({ length: 4 }, () => [0, 0, 0]),
      bodyForces: [{ element: 0, forceKnPerM3: [12, 0, 0] }],
      faceTractions: [{ element: 0, faceNodes: [1, 2, 3], tractionKnPerM2: [0, 6, 0] }],
    }],
  });
  assert.equal(calls, 2);
  assert.ok(Math.abs(distributed.nodalReactionsKn.reduce((sum, node) => sum + node[0], 0) + 2) < 1e-12);
  assert.ok(Math.abs(distributed.nodalReactionsKn.reduce((sum, node) => sum + node[1], 0) + 3 * Math.sqrt(3)) < 1e-12);
  const perElement = await solveNativeVolume3DJ2({
    ...fixture.input,
    steel: { ...fixture.input.steel, youngsMpa: 150_000 },
    elementSteels: fixture.input.mesh.tets.map(() => ({ ...fixture.input.steel })),
  });
  assert.equal(calls, 3);
  const elementRightReaction = [1, 3, 5, 7]
    .reduce((sum, node) => sum + perElement.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(elementRightReaction - rightReaction) < 1e-4);
  perElement.elementStates.forEach((state, index) => {
    assert.ok(Math.abs(state.equivalentPlasticStrain
      - result.elementStates[index].equivalentPlasticStrain) < 1e-10);
  });
  await assert.rejects(
    () => solveNativeVolume3DJ2({ ...fixture.input, elementSteels: [fixture.input.steel] }),
    /elementSteels length 1 differs from mesh\.tets length 6/,
  );
  assert.equal(calls, 4);
  const frontal = await solveNativeVolume3DJ2({
    ...fixture.input,
    options: { ...fixture.input.options, linearBackend: "frontalWave" },
  });
  assert.equal(calls, 5);
  assert.equal(frontal.linearBackendUsed, "frontalWave");
  const frontalRightReaction = [1, 3, 5, 7]
    .reduce((sum, node) => sum + frontal.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(frontalRightReaction - rightReaction) < 1e-4);
  frontal.elementStates.forEach((state, index) => {
    assert.ok(Math.abs(state.equivalentPlasticStrain
      - result.elementStates[index].equivalentPlasticStrain) < 1e-9);
  });
  const automatic = await solveNativeVolume3DJ2({
    ...fixture.input,
    options: { ...fixture.input.options, linearBackend: "automatic", maxFactorEntries: 1 },
  });
  assert.equal(calls, 6);
  assert.equal(automatic.linearBackendUsed, "frontalWave");
  assert.ok(automatic.frontalFallbacks >= 1);
  const automaticRightReaction = [1, 3, 5, 7]
    .reduce((sum, node) => sum + automatic.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(automaticRightReaction - rightReaction) < 1e-4);
  const pcg = await solveNativeVolume3DJ2({
    ...fixture.input,
    options: { ...fixture.input.options, linearBackend: "sparsePcg", pcgThreads: 2 },
  });
  assert.equal(calls, 7);
  assert.equal(pcg.linearBackendUsed, "sparsePcg");
  const pcgRightReaction = [1, 3, 5, 7]
    .reduce((sum, node) => sum + pcg.nodalReactionsKn[node][0], 0);
  assert.ok(Math.abs(pcgRightReaction - rightReaction) < 1e-3);
  assert.ok(pcg.trueFreeResidualKn < 1e-4);
  console.log("Native 3D J2-staalcoupon, per-element materiaal en sparse directe/PCG/frontale/automatische Newton-oplossers slagen via app-transport.");
} finally {
  globalThis.fetch = originalFetch;
}
