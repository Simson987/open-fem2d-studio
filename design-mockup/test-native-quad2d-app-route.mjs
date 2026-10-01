import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildMesh, solveAllCases } from "./src/components/fem/solver/engine.ts";
import { solveAllCasesNativeQuad2D } from "./src/components/fem/solver/nativeQuadRoute.ts";
import { combineResults } from "./src/components/fem/solver/combinations.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-quad2d", import.meta.url));
const invoke = input => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const out = [], err = [];
  child.stdout.on("data", chunk => out.push(chunk));
  child.stderr.on("data", chunk => err.push(chunk));
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(JSON.parse(Buffer.concat(out).toString()))
    : reject(new Error(Buffer.concat(err).toString())));
  child.stdin.end(JSON.stringify(input));
});
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "quad2d");
  calls++;
  return new Response(JSON.stringify({ kind: "quad2d", result: await invoke(body.inputs.input) }), { status: 200 });
};
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, bestaande solver ${expected}, grens ${tolerance}`,
);
try {
  const request = { schemaVersion: 1, dimension: "2d", analysis: "linear", elementFamilies: ["plate"] };
  assert.equal(resolveSolver("openaec-native-fem", request).id, "openaec-native-fem");
  assert.equal(resolveSolver("automatic", request).id, "open-fem-2d");
  assert.throws(() => resolveSolver("openaec-native-fem", { ...request, elementFamilies: ["frame", "plate"] }));
  assert.throws(() => resolveSolver("openaec-native-fem", { ...request, analysis: "material-nonlinear" }));
  const input = {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 1000, z: 0 },
      { id: 3, x: 0, z: 1000 }, { id: 4, x: 1000, z: 1000 },
    ],
    beams: [],
    plates: [{ id: 9, nodeIds: [1, 2, 4, 3], thickness: 20,
      E: 210000, nu: 0.3, rho: 7850, meshSize: 500, meshType: "vierhoeken" }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 3, type: "xRoller" }],
    cases: [{ id: 1, name: "G" }, { id: 2, name: "Q" }, { id: 3, name: "leeg" }],
    loads: [], pointLoads: [],
    edgeLoads: [
      { plateId: 9, edge: "right", p: 10, dir: "x", caseId: 1 },
      { plateId: 9, edge: "right", p: 4, dir: "x", caseId: 2 },
    ],
  };
  const built = buildMesh(input, caseId => caseId === 1 ? 1 : 0);
  assert.equal(built.plateInfo[0].region.elementIds.length, 4);
  const native = await solveAllCasesNativeQuad2D(input);
  const reference = solveAllCases(input).perCase;
  assert.equal(calls, 2);
  assert.equal(native.has(3), false);
  for (const caseId of [1, 2]) {
    const actual = native.get(caseId), expected = reference.get(caseId);
    assert.ok(actual && expected);
    close(actual.maxDisplacement, expected.maxDisplacement, 1e-5, `geval ${caseId} grootste verplaatsing`);
    for (const [id, node] of actual.displacements) {
      const other = expected.displacements.get(id);
      assert.ok(other);
      close(node.ux, other.ux, 1e-5, `geval ${caseId} knoop ${id} ux`);
      close(node.uz, other.uz, 1e-5, `geval ${caseId} knoop ${id} uz`);
    }
    for (const [id, reaction] of actual.reactions) {
      const other = expected.reactions.get(id);
      assert.ok(other);
      close(reaction.fx, other.fx, 1e-2, `geval ${caseId} knoop ${id} Rx`);
      close(reaction.fz, other.fz, 1e-2, `geval ${caseId} knoop ${id} Rz`);
    }
    const plate = actual.plateElements[0], otherPlate = expected.plateElements[0];
    assert.equal(plate.plateId, 9);
    assert.deepEqual(plate.expectedElementIds, otherPlate.expectedElementIds);
    for (const element of plate.elements) {
      const other = otherPlate.elements.find(item => item.elementId === element.elementId);
      assert.ok(other);
      for (const key of ["sigmaX", "sigmaY", "tauXY", "nx", "ny", "nxy"])
        close(element[key], other[key], 1e-3, `geval ${caseId} element ${element.elementId} ${key}`);
    }
  }
  const combination = { id: 10, name: "ULS", type: "uls", formula: "test", factors: new Map([[1, 1.35], [2, 1.5]]) };
  const actual = combineResults(combination, native);
  const expected = combineResults(combination, reference);
  close(actual.maxDisplacement, expected.maxDisplacement, 1e-5, "combinatieverplaatsing");
  assert.equal(actual.plateElements[0].elements.length, expected.plateElements[0].elements.length);
  await assert.rejects(solveAllCasesNativeQuad2D({ ...input, beams: [{}] }), /uitsluitend platen/);
  console.log("Rust Quad4 app-route: gevallen, combinatie, eenheden en UI-plaatresultaten gelijk aan bestaande solver.");
} finally {
  globalThis.fetch = originalFetch;
}
