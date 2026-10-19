import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Mesh } from "./src/core/fem/Mesh.ts";
import { buildNativeMixed2DRequest } from "./src/core/fem/nativePlate2DAdapter.ts";
import { solveNativeMixed2D } from "./src/lib/nativeFemClient.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-mixed2d", import.meta.url));
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

const mesh = new Mesh();
for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]) mesh.addNode(x, y);
mesh.materials.set(1, { id: 1, name: "Patch", E: 1e9, nu: 0, rho: 0, color: "#888" });
mesh.elements.set(10, { id: 10, nodeIds: [1, 2, 5], materialId: 1, thickness: 0.1 });
mesh.elements.set(11, { id: 11, nodeIds: [1, 5, 4], materialId: 1, thickness: 0.1 });
mesh.elements.set(12, { id: 12, nodeIds: [2, 3, 6, 5], materialId: 1, thickness: 0.1 });
mesh.nodes.get(1).constraints.x = true;
mesh.nodes.get(1).constraints.y = true;
mesh.nodes.get(4).constraints.x = true;
mesh.nodes.get(3).loads.fx = 50000;
mesh.nodes.get(6).loads.fx = 50000;

const defaultRequest = buildNativeMixed2DRequest(mesh);
assert.equal(Object.hasOwn(defaultRequest, "linearBackend"), false);
assert.throws(() => buildNativeMixed2DRequest(mesh, "geometric", new Map(), [], [], "sparseDirect"),
  /alleen lineaire analyse/);
assert.throws(() => buildNativeMixed2DRequest(mesh, "geometric", new Map(), [], [], "frontalWave"),
  /alleen lineaire analyse/);

const originalFetch = globalThis.fetch;
const sent = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "mixed2d");
  sent.push(body.inputs.input);
  const result = await invoke(body.inputs.input);
  return new Response(JSON.stringify({ kind: "mixed2d", result }), { status: 200 });
};

try {
  const existing = await solveNativeMixed2D(mesh);
  const direct = await solveNativeMixed2D(mesh, "linear", new Map(), [], [], "sparseDirect");
  const wave = await solveNativeMixed2D(mesh, "linear", new Map(), [], [], "frontalWave");
  assert.equal(sent.length, 3);
  assert.equal(Object.hasOwn(sent[0], "linearBackend"), false);
  assert.equal(sent[1].linearBackend, "sparseDirect");
  assert.equal(sent[2].linearBackend, "frontalWave");
  assert.equal(existing.linearBackendUsed, "existing");
  assert.equal(direct.linearBackendUsed, "sparseDirect");
  assert.equal(wave.linearBackendUsed, "frontalWave");
  assert.ok(wave.frontalMaximumFrontDofs > 0);
  assert.ok(wave.frontalMaximumFrontDofs <= mesh.nodes.size * 2);
  assert.ok(wave.linearSolverTrueResidual < 1e-9);
  assert.ok(wave.relativeResidual < 1e-9);
  assert.equal(wave.triangles.length, direct.triangles.length);
  assert.equal(wave.quads.length, direct.quads.length);
  assert.ok(direct.linearSolverTrueResidual < 1e-9);
  assert.ok(direct.relativeResidual < 1e-9);
  assert.equal(direct.triangles.length, 2);
  assert.equal(direct.quads.length, 1);
  for (let i = 0; i < direct.nodes.length; i++) {
    const a = direct.nodes[i], b = existing.nodes[i];
    assert.equal(a.nodeId, b.nodeId);
    for (const key of ["uxM", "uyM"])
      assert.ok(Math.abs(a[key] - b[key]) < 1e-10, `${key} node ${a.nodeId}`);
    for (const key of ["rxKn", "ryKn"])
      assert.ok(Math.abs(a[key] - b[key]) < 1e-7, `${key} node ${a.nodeId}`);
    const c = wave.nodes[i];
    assert.equal(c.nodeId, a.nodeId);
    for (const key of ["uxM", "uyM"])
      assert.ok(Math.abs(c[key] - a[key]) < 1e-10, `frontalWave ${key} node ${a.nodeId}`);
    for (const key of ["rxKn", "ryKn"])
      assert.ok(Math.abs(c[key] - a[key]) < 1e-7, `frontalWave ${key} node ${a.nodeId}`);
  }
  assert.ok(Math.abs(direct.nodes.find(node => node.nodeId === 6).uxM - 0.002) < 1e-10);
  assert.ok(Math.abs(direct.nodes.reduce((sum, node) => sum + node.rxKn, 0) + 100) < 1e-7);
  console.log("Gemengde CST/Q4-appadapter: frontalWave, sparseDirect en bestaande backend slagen op de patchproef.");
} finally {
  globalThis.fetch = originalFetch;
}
