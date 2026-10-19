import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Mesh } from "./src/core/fem/Mesh.ts";
import { solveNativeHybridPlate, solveNativeHybridPlateFiber } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/toetsbrug", import.meta.url));
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  calls.push(body.inputs);
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

const mesh = new Mesh();
mesh.materials.set(1, { id: 1, name: "steel bending reference", E: 30e9, nu: 0, rho: 7850, color: "" });
for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]) {
  mesh.addNode(x, y);
}
mesh.addQuadElement([1, 2, 5, 4], 1, 0.2);
mesh.addQuadElement([2, 3, 6, 5], 1, 0.2);
for (const id of [1, 4]) {
  mesh.nodes.get(id).constraints.y = true;
  mesh.nodes.get(id).constraints.rotation = true;
}

const elastic = [1, 2].map(quadId => ({
  quadId,
  layers: [{ thicknessM: 0.2, eMpa: 30_000, nu: 0, law: { kind: "elastic" } }],
}));
const plastic = [1, 2].map(quadId => ({
  quadId,
  layers: Array.from({ length: 16 }, () => ({
    thicknessM: 0.2 / 16,
    eMpa: 30_000,
    nu: 0,
    law: { kind: "steelBilinear", yieldMpa: 1, hardeningRatio: 0.02 },
  })),
}));

const close = (actual, expected, relative, label) => assert.ok(
  Math.abs(actual - expected) <= relative * Math.max(Math.abs(expected), 1e-6),
  `${label}: actual=${actual}, expected=${expected}`,
);

try {
  const baseline = await solveNativeHybridPlate(mesh, -1);
  const fiberElastic = await solveNativeHybridPlateFiber(mesh, elastic, -1);
  assert.equal(calls[1].kind, "hybridPlateFiber");
  assert.equal(calls[1].input.fiberSections.length, 2);
  assert.equal(fiberElastic.elements[0].materialPoints.length, 16);
  assert.ok(fiberElastic.relativeResidual < 1e-8);
  const frontalElastic = await solveNativeHybridPlateFiber(mesh, elastic, -1, [], [], 'frontalWave');
  assert.equal(calls[2].input.bending.linearBackend, 'frontalWave');
  assert.equal(frontalElastic.linearBackendUsed, 'frontalWave');
  assert.ok(frontalElastic.frontalMaximumFrontDofs > 0);
  for (const [index, actual] of fiberElastic.nodes.entries()) {
    const expected = baseline.nodes[index];
    for (const key of ["wM", "thetaXRad", "thetaYRad", "reactionFzKn"]) {
      close(actual[key], expected[key], 1e-7, `elastic parity ${index}/${key}`);
      close(frontalElastic.nodes[index][key], actual[key], 1e-7, `frontal parity ${index}/${key}`);
    }
  }
  const peak = await solveNativeHybridPlateFiber(mesh, plastic, -8, [0.5, 1]);
  const unloaded = await solveNativeHybridPlateFiber(mesh, plastic, -8, [0.5, 1, 0]);
  assert.ok(peak.relativeResidual < 1e-8);
  assert.ok(unloaded.relativeResidual < 1e-8);
  assert.ok(peak.elements.some(element => element.maxEquivalentPlasticStrain > 0));
  assert.ok(unloaded.elements.some(element => element.maxEquivalentPlasticStrain > 0));
  assert.ok(Math.abs(unloaded.nodes[2].wM) > 1e-8);
  assert.ok(Math.abs(unloaded.nodes[2].wM) < Math.abs(peak.nodes[2].wM));
  close(peak.nodes.reduce((sum, node) => sum + node.reactionFzKn, 0), 16, 1e-7, "loaded reaction");
  close(unloaded.nodes.reduce((sum, node) => sum + node.reactionFzKn, 0), 0, 1e-7, "unloaded reaction");
  assert.equal(calls.length, 5);
  console.log("native-hybrid-plate-fiber-app-route: elastic parity and steel plastic load/unload OK");
} finally {
  globalThis.fetch = originalFetch;
}
