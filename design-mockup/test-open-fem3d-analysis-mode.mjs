import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveOpenFem3D, solveOpenFem3DCombination } from "./src/components/openFem3d/openFem3dSolver.ts";
import { deserializeProject } from "./src/io/projectFile.ts";

const fixture = fileURLToPath(new URL("../docs/verificatie/3d-raamwerk/groot-vierlaags-raam.ifcfem", import.meta.url));
const model = deserializeProject(readFileSync(fixture, "utf8")).model3d;
assert.ok(model);
const requests = [];
const previousFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  requests.push(JSON.parse(options.body));
  return { ok: true, json: async () => ({ reactions: [], diagnostics: [] }) };
};
try {
  await solveOpenFem3D(model, 1, "linear");
  await solveOpenFem3DCombination(model, new Map([[1, 1], [2, 0.5]]), "linear");
  await solveOpenFem3D(model, 1, "p-delta");
} finally {
  globalThis.fetch = previousFetch;
}
assert.equal(requests.length, 3);
assert.deepEqual(requests.map((request) => [request.analysis, request.bucklingModes]), [
  ["linear", 0], ["linear", 0], ["p-delta", 3],
]);
assert.equal(requests[0].nodalLoads.length, 25);
assert.equal(requests[1].nodalLoads.length, 50);
assert.equal(requests[2].nodalLoads.length, 25);
console.log("3D-analysetype en belastingselectie: eerste orde, combinatie en P-Delta geslaagd");
