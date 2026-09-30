import assert from "node:assert/strict";
import { solveNativeFem, solveNativeQuad2D, solveNativeHybridPlate } from "./src/lib/nativeFemClient.ts";
import { Mesh } from "./src/core/fem/Mesh.ts";

const originalFetch = globalThis.fetch;
let request;
globalThis.fetch = async (url, options) => {
  request = { url, options };
  return new Response(JSON.stringify({ kind: "squareMesh", result: { nodes: [1, 2] } }), {
    status: 200, headers: { "content-type": "application/json" },
  });
};
try {
  const input = { originX: 0, originY: 0, widthM: 1, heightM: 1,
    cellSizeM: 1, materialId: 1, thicknessM: 0.1 };
  const result = await solveNativeFem("squareMesh", input);
  assert.deepEqual(result, { nodes: [1, 2] });
  assert.equal(request.url, "/api/toetsing");
  assert.deepEqual(JSON.parse(request.options.body), {
    opdracht: "solve_native_fem", inputs: { kind: "squareMesh", input },
  });
  const mesh = new Mesh();
  mesh.materials.set(1, { id: 1, name: "patch", E: 1e9, nu: 0, rho: 0, color: "" });
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) mesh.addNode(x, y);
  mesh.addQuadElement([1, 2, 4, 3], 1, 0.1);
  mesh.nodes.get(1).constraints.x = true;
  mesh.nodes.get(1).constraints.y = true;
  mesh.nodes.get(3).constraints.x = true;
  mesh.nodes.get(2).loads.fx = 50_000;
  mesh.nodes.get(4).loads.fx = 50_000;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "quad2d", result: {
      nodes: [{ nodeId: 2, uxM: 0.001 }], quads: [], iterations: 1, relativeResidual: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const quad = await solveNativeQuad2D(mesh);
  assert.equal(quad.nodes[0].uxM, 0.001);
  const wrapped = JSON.parse(request.options.body);
  assert.equal(wrapped.inputs.kind, "quad2d");
  assert.equal(wrapped.inputs.input.materials[0].eMpa, 1000);
  assert.deepEqual(wrapped.inputs.input.loads.map(load => load.fx), [50, 50]);
  const bending = new Mesh();
  bending.materials.set(1, { id: 1, name: "concrete", E: 30e9, nu: 0.2, rho: 0, color: "" });
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) bending.addNode(x, y);
  bending.addQuadElement([1, 2, 4, 3], 1, 0.2);
  const steel = { limitState: "service", fckMpa: 20, fctmMpa: 2.2, gammaC: 1.5,
    fydMpa: 435, fywdMpa: 435, esMpa: 200000, coverMm: 30, barDiameterMm: 12,
    topXMm2PerM: 1000, topYMm2PerM: 1000,
    bottomXMm2PerM: 1000, bottomYMm2PerM: 1000 };
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ kind: "hybridPlate", result: {
      nodes: [], elements: [], iterations: 1, relativeResidual: 0,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await solveNativeHybridPlate(bending, -10, [], [], steel);
  const hybridRequest = JSON.parse(request.options.body);
  assert.equal(hybridRequest.inputs.kind, "hybridPlate");
  assert.equal(hybridRequest.inputs.input.pressureKnM2, -10);
  assert.equal(hybridRequest.inputs.input.reinforcement.limitState, "service");
  globalThis.fetch = async () => new Response(JSON.stringify({ kind: "quad2d", result: {} }), {
    status: 200, headers: { "content-type": "application/json" },
  });
  await assert.rejects(solveNativeFem("squareMesh", input), /geen squareMesh-resultaat/);
  console.log("Native FEM-client route en resultaattype slagen.");
} finally {
  globalThis.fetch = originalFetch;
}
