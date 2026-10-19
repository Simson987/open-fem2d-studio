import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { solveNativeVolume3D } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-volume3d", import.meta.url));
const invoke = input => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    const raw = Buffer.concat(output).toString();
    if (code === 0) resolve(JSON.parse(raw));
    else reject(new Error(raw || Buffer.concat(errors).toString()));
  });
  child.stdin.end(JSON.stringify(input));
});

const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "volume3d");
  calls++;
  const result = await invoke(request.inputs.input);
  return new Response(JSON.stringify({ kind: "volume3d", result }), { status: 200 });
};

try {
  // One-tet loaded shear coupon: k_tip,ux = µV = 800,000 kN/m.
  const input = {
    nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
    materials: [{ eMpa: 12000, poisson: 0.25 }],
    elements: [{ nodes: [0, 1, 2, 3], material: 0 }],
    loads: [{ node: 3, forceKn: [1, 0, 0] }],
    supports: [
      { node: 0, displacementM: [0, 0, 0] },
      { node: 1, displacementM: [0, 0, 0] },
      { node: 2, displacementM: [0, 0, 0] },
      { node: 3, displacementM: [null, 0, 0] },
    ],
    threads: 2, tolerance: 1e-10, maxIterations: 100,
  };
  const answer = await solveNativeVolume3D(input);
  assert.equal(calls, 1);
  assert.equal(answer.solverUsed, "matrixFree");
  assert.equal(answer.nodalDisplacementsM.length, 4);
  assert.ok(Math.abs(answer.nodalDisplacementsM[3][0] - 1.25e-6) < 1e-15);
  assert.ok(Math.abs(answer.nodalReactionsKn[0][0] + 1) < 1e-12);
  assert.ok(Math.abs(answer.elementStressMpa[0][5] - 0.006) < 1e-12);
  assert.ok(answer.relativeResidual < 1e-10);
  for (const solverStrategy of ["sparse", "sparseDirect", "frontal"]) {
    const alternative = await solveNativeVolume3D({ ...input, solverStrategy });
    assert.equal(alternative.solverUsed, solverStrategy);
    assert.equal(alternative.threads, 1);
    assert.ok(Math.abs(alternative.nodalDisplacementsM[3][0] - answer.nodalDisplacementsM[3][0]) < 1e-15);
    assert.ok(Math.abs(alternative.nodalReactionsKn[0][0] - answer.nodalReactionsKn[0][0]) < 1e-12);
  }
  await assert.rejects(solveNativeVolume3D({ ...input,
    supports: [...input.supports, input.supports[0]],
  }), /duplicate|support/i);
  const distributed = await solveNativeVolume3D({
    ...input,
    loads: [],
    bodyForces: [{ element: 0, forceKnPerM3: [24, 0, 0] }],
    faceTractions: [{ element: 0, nodes: [1, 2, 3], tractionKnPerM2: [2 * Math.sqrt(3), 0, 0] }],
    supports: input.nodes.map((_, node) => ({ node, displacementM: [0, 0, 0] })),
  });
  assert.deepEqual(distributed.nodalReactionsKn.map(value => value[0]), [-1, -2, -2, -2]);
  assert.equal(calls, 6);
  console.log("Native 3D-volumeroute met onafhankelijke belaste Tet4-proef slaagt.");
} finally {
  globalThis.fetch = originalFetch;
}
