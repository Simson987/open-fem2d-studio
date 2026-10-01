import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildMesh, solveAllCases } from "./src/components/fem/solver/engine.ts";
import { solveAllCasesNativeMembrane2D as solveAllCasesNativeQuad2D,
  solveAllCombinationsNativeMembrane2D as solveAllCombinationsNativeQuad2D } from "./src/components/fem/solver/nativeMembraneRoute.ts";
import { combineResults, computeEnvelope } from "./src/components/fem/solver/combinations.ts";
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
  const result = await invoke(body.inputs.input);
  return new Response(JSON.stringify({ kind: "quad2d", result }), { status: 200 });
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
  assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "material-nonlinear" }).id,
    "openaec-native-fem");
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
  const nonlinearInput = { ...input,
    plates: [{ ...input.plates[0], nonlinearLaw: { kind: "steelBilinear", yieldMpa: 0.1, hardeningRatio: 0.05 } }] };
  const nonlinearCases = await solveAllCasesNativeQuad2D(nonlinearInput, "material");
  const direct = await solveAllCombinationsNativeQuad2D(nonlinearInput, [combination], "material");
  const directResult = direct.get(combination.id);
  assert.ok(directResult);
  const superposed = combineResults(combination, nonlinearCases);
  assert.ok(Math.abs(directResult.maxDisplacement - superposed.maxDisplacement) > 1e-5,
    "een FNL-combinatie mag geen superpositie van afzonderlijke gevallen zijn");
  const equivalentInput = { ...nonlinearInput,
    cases: [{ id: 4, name: "volledige combinatie" }],
    edgeLoads: [{ plateId: 9, edge: "right", p: 19.5, dir: "x", caseId: 4 }] };
  const equivalent = (await solveAllCasesNativeQuad2D(equivalentInput, "material")).get(4);
  close(directResult.maxDisplacement, equivalent.maxDisplacement, 1e-6,
    "FNL-combinatie is directe oplossing van de volledige lastvector");
  const envelope = computeEnvelope([combination], nonlinearCases, direct);
  close(envelope.maxDisplacement, directResult.maxDisplacement, 1e-9, "FNL-omhullende gebruikt directe uitkomst");
  const curveInput = { ...input,
    plates: [{ ...input.plates[0], modulusCurve: [{ strain: 0.000001, eMpa: 100000 }] }] };
  const curve = (await solveAllCasesNativeQuad2D(curveInput, "material")).get(1);
  assert.ok(curve.maxDisplacement > native.get(1).maxDisplacement,
    "een afnemende E-curve moet de vervorming vergroten");
  assert.ok(curve.plateElements[0].elements.some(element => element.effectiveEMpa < 210000),
    "de verlaagde E moet in de plaatresultaten zichtbaar zijn");
  const concreteInput = { ...input,
    plates: [{ ...input.plates[0], materiaal: "C30/37", E: undefined, nu: undefined, rho: undefined,
      nonlinearLaw: { kind: "concreteCracking", tensileMpa: 0.1, residualRatio: 0.05 } }] };
  const concrete = (await solveAllCasesNativeQuad2D(concreteInput, "material")).get(1);
  assert.ok(concrete.plateElements[0].elements.some(element => element.tensileDamage > 0),
    "betonscheuren moeten als Gauss-punt-schade in de plaatresultaten staan");
  const combined = await solveAllCombinationsNativeQuad2D(concreteInput, [combination], "combined");
  assert.ok(combined.get(combination.id)?.maxDisplacement > 0,
    "gecombineerde GNL+FNL-analyse geeft een directe plaatuitkomst");
  await assert.rejects(solveAllCasesNativeQuad2D({ ...concreteInput,
    plates: [{ ...concreteInput.plates[0], nonlinearLaw: nonlinearInput.plates[0].nonlinearLaw }] }, "material"),
  /past niet bij het gekozen materiaal/);
  await assert.rejects(solveAllCasesNativeQuad2D(input, "material"), /minstens één plaat/);
  await assert.rejects(solveAllCasesNativeQuad2D({ ...curveInput,
    plates: [{ ...curveInput.plates[0], nonlinearLaw: nonlinearInput.plates[0].nonlinearLaw }] }, "material"),
  /of een E-curve, niet beide/);
  await assert.rejects(solveAllCasesNativeQuad2D({ ...input, beams: [{}] }), /uitsluitend platen/);
  console.log("Rust Quad4 app-route: lineaire pariteit, directe FNL-combinaties en afnemende E-curve slagen.");
} finally {
  globalThis.fetch = originalFetch;
}
