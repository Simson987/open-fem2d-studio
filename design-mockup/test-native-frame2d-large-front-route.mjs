import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { solveAllCasesNativeFrame2D } from "./src/components/fem/solver/nativeFrame2DRoute.ts";

const binary = fileURLToPath(new URL(
  `../src-tauri/target/debug/native-frame2d${process.platform === "win32" ? ".exe" : ""}`,
  import.meta.url,
));
const invoke = (request) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(`${Buffer.concat(output)} ${Buffer.concat(errors)}`)));
  child.stdin.end(JSON.stringify(request));
});

// This input exceeds the global Matrix backend's 20,000-DOF limit. It tests
// the actual app adapter and CLI, not just a backend-selection mock.
const segments = 7000;
const nodes = Array.from({ length: segments + 1 }, (_, index) => ({
  id: index + 1, x: index * 1000, z: 0,
}));
const beams = Array.from({ length: segments }, (_, index) => ({
  id: index + 1, from: index + 1, to: index + 2,
  E: 210_000, A: 10_000, I: 8e6,
}));
const supports = nodes.map((node, index) => ({
  nodeId: node.id, type: index === 0 ? "fixed" : "zRoller",
}));
const forceN = 10_000;
const input = {
  nodes, beams, supports, loads: [],
  pointLoads: [{ nodeId: segments + 1, caseId: 1, fx: forceN }],
  cases: [{ id: 1, name: "axiale ketting" }],
};

const previousFetch = globalThis.fetch;
let requests = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "frame2d");
  assert.equal(body.inputs.input.nodes.length, segments + 1);
  assert.equal(body.inputs.input.linearBackend, "frontalWave");
  assert.equal(body.inputs.input.frontalMaxFrontDofs, 256);
  requests++;
  const result = await invoke(body.inputs.input);
  return new Response(JSON.stringify({ kind: "frame2d", result }), { status: 200 });
};

try {
  const cases = await solveAllCasesNativeFrame2D(input);
  assert.equal(requests, 1);
  const result = cases.get(1);
  assert.ok(result);
  const expectedMm = forceN * segments * 1000 / (210_000 * 10_000);
  assert.ok(Math.abs(result.displacements.get(segments + 1).ux - expectedMm) < 1e-5);
  assert.ok(Math.abs(result.reactions.get(1).fx + forceN) < 1e-4);
  assert.ok(Math.abs(result.maxDisplacement - expectedMm) < 1e-5);
  console.log("Native 2D-app-route: 7.000 staven / 21.003 DOF frontaal opgelost.");
} finally {
  globalThis.fetch = previousFetch;
}
