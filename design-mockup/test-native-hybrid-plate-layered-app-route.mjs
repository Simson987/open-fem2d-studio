import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Mesh } from "./src/core/fem/Mesh.ts";
import {
  solveNativeFem, solveNativeHybridPlate, solveNativeHybridPlateLayered,
} from "./src/lib/nativeFemClient.ts";

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
mesh.materials.set(1, { id: 1, name: "elastic reference", E: 30e9, nu: 0.2, rho: 2400, color: "" });
for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]) {
  mesh.addNode(x, y);
}
mesh.addQuadElement([1, 2, 5, 4], 1, 0.2);
mesh.addQuadElement([2, 3, 6, 5], 1, 0.2);
for (const id of [1, 4]) {
  mesh.nodes.get(id).constraints.y = true;
  mesh.nodes.get(id).constraints.rotation = true;
}

const close = (actual, expected, relative, label) => assert.ok(
  Math.abs(actual - expected) <= Math.max(relative * Math.abs(expected), 1e-12),
  `${label}: actual=${actual}, expected=${expected}`,
);
const uniform = [1, 2].map(quadId => ({
  quadId, layers: [{ thicknessM: 0.2, eMpa: 30_000, nu: 0.2 }],
}));
const asymmetric = [1, 2].map(quadId => ({
  quadId, layers: [
    { thicknessM: 0.06, eMpa: 210_000, nu: 0.3 },
    { thicknessM: 0.14, eMpa: 70_000, nu: 0.2 },
  ],
}));

try {
  const existing = await solveNativeHybridPlate(mesh, -1.0);
  const layered = await solveNativeHybridPlateLayered(mesh, uniform, -1.0);
  assert.equal(calls[1].kind, "hybridPlateLayered");
  assert.equal(calls[1].input.elasticLayeredSections.length, 2);
  assert.equal(calls[1].input.elasticLayeredSections[0].layers[0].law.kind, "elastic");
  for (const [index, node] of layered.nodes.entries()) {
    const reference = existing.nodes[index];
    for (const key of ["wM", "thetaXRad", "thetaYRad", "reactionFzKn", "reactionMxKnm", "reactionMyKnm"]) {
      close(node[key], reference[key], 1e-8, `homogeneous ${node.nodeId}/${key}`);
    }
  }
  for (const [index, element] of layered.elements.entries()) {
    const reference = existing.elements[index];
    for (let i = 0; i < 3; i++) {
      close(element.momentKnmPerM[i], reference.momentKnmPerM[i], 1e-8,
        `homogeneous moment ${element.quadId}/${i}`);
    }
  }
  assert.ok(layered.relativeResidual < 1e-8);

  const twoLayer = await solveNativeHybridPlateLayered(mesh, asymmetric, -1.0);
  assert.ok(twoLayer.relativeResidual < 1e-8);
  assert.ok(twoLayer.nodes.every(node => Number.isFinite(node.wM)));
  assert.ok(Math.abs(twoLayer.nodes[2].wM - layered.nodes[2].wM) > 1e-7);
  const totalReaction = twoLayer.nodes.reduce((sum, node) => sum + node.reactionFzKn, 0);
  close(totalReaction, 2.0, 1e-8, "asymmetric pressure/reaction balance");

  const frontal = await solveNativeHybridPlateLayered(mesh, asymmetric, -1.0, [], [], "frontalWave");
  assert.equal(frontal.linearBackendUsed, "frontalWave");
  for (const [index, node] of frontal.nodes.entries()) {
    close(node.wM, twoLayer.nodes[index].wM, 1e-8, `frontal node ${node.nodeId}`);
  }
  await assert.rejects(() => solveNativeFem("hybridPlateLayered", {
    ...calls[1].input,
    elasticLayeredSections: [{
      ...calls[1].input.elasticLayeredSections[0],
      layers: [{ ...calls[1].input.elasticLayeredSections[0].layers[0],
        law: { kind: "concreteCracking", tensile_mpa: 3, residual_ratio: 0.02 } }],
    }, calls[1].input.elasticLayeredSections[1]],
  }), /elastic fibers only/);
  assert.equal(calls.length, 5);
  console.log("native-hybrid-plate-layered-app-route: homogeneous parity, asymmetric layers, frontal parity and concrete rejection OK");
} finally {
  globalThis.fetch = originalFetch;
}
