import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bouwMultiInput } from "./src/lib/modelNaarSolverInput.ts";
import { berekenPlaatMeshSignatuur } from "./src/components/fem/femTypes.ts";
import { solveAllCases } from "./src/components/fem/solver/engine.ts";
import { solveAllCasesNativeMembrane2D, solveAllCombinationsNativeMembrane2D } from
  "./src/components/fem/solver/nativeMembraneRoute.ts";
import { computeEnvelope } from "./src/components/fem/solver/combinations.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-plate2d", import.meta.url));
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
let nativeCalls = 0;
let corruptNextTriangleResult = null;
const nativeInputs = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "plate2d");
  nativeCalls++;
  nativeInputs.push(body.inputs.input);
  const result = await invoke(body.inputs.input);
  if (corruptNextTriangleResult) {
    const corruption = corruptNextTriangleResult;
    corruptNextTriangleResult = null;
    if (corruption === "null-node-record") result.nodes[0] = null;
    else if (corruption === "null-element-record") result.elements[0] = null;
  }
  return new Response(JSON.stringify({ kind: "plate2d", result }), { status: 200 });
};
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, referentie ${expected}, grens ${tolerance}`,
);

const corners = [
  { x: 0, z: 0 }, { x: 2000, z: 0 }, { x: 2000, z: 1000 },
  { x: 1000, z: 1000 }, { x: 1000, z: 2000 }, { x: 0, z: 2000 },
];
const size = 500;
const points = [];
const index = new Map();
const point = (x, z) => {
  const key = `${x},${z}`;
  if (!index.has(key)) { index.set(key, points.length); points.push({ x, z }); }
  return index.get(key);
};
const triangles = [];
for (let x = 0; x < 2000; x += size) for (let z = 0; z < 2000; z += size) {
  if (x >= 1000 && z >= 1000) continue;
  const bl = point(x, z), br = point(x + size, z);
  const tr = point(x + size, z + size), tl = point(x, z + size);
  triangles.push([bl, br, tr], [bl, tr, tl]);
}
const edgeNodeIndices = corners.map((from, i) => {
  const to = corners[(i + 1) % corners.length];
  const steps = Math.round(Math.hypot(to.x - from.x, to.z - from.z) / size);
  return Array.from({ length: steps + 1 }, (_, k) =>
    point(from.x + (k / steps) * (to.x - from.x), from.z + (k / steps) * (to.z - from.z)));
});
const cache = { signature: berekenPlaatMeshSignatuur(corners, size), points, triangles, edgeNodeIndices };
assert.equal(cache.points.length, 21);
assert.equal(cache.triangles.length, 24);

const model = platePatch => ({
  nodes: corners.map((corner, index) => ({ id: index + 1, ...corner })),
  beams: [],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 6, type: "xRoller" }],
  plates: [{ id: 1, nodeIds: [1, 2, 3, 4, 5, 6], thickness: 20,
    E: 210000, nu: 0.3, rho: 7850, meshSize: size, meshCache: cache, ...platePatch }],
  loadCases: [{ id: 1, name: "trek", type: "dead" }, { id: 2, name: "dwarslast", type: "live" }],
  loads: [
    { id: 1, type: "edgeLoad", caseId: 1, plateId: 1, edgeIndex: 5, q: -100, qDir: "x" },
    { id: 2, type: "edgeLoad", caseId: 1, plateId: 1, edgeIndex: 1, q: 100, qDir: "x" },
    { id: 3, type: "edgeLoad", caseId: 1, plateId: 1, edgeIndex: 3, q: 100, qDir: "x" },
    { id: 4, type: "edgeLoad", caseId: 2, plateId: 1, edgeIndex: 4, q: -10, qDir: "z" },
  ],
  selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200, scheefstandRichting: 1,
});
try {
  const input = bouwMultiInput(model({}));
  const native = await solveAllCasesNativeMembrane2D(input);
  const reference = solveAllCases(input).perCase;
  assert.equal(nativeCalls, 2);
  for (const caseId of [1, 2]) {
    const actual = native.get(caseId), expected = reference.get(caseId);
    assert.ok(actual && expected);
    assert.equal(actual.plateElements[0].elements.length, 24);
    assert.ok(actual.plateElements[0].elements.every(element => element.corners.length === 3));
    close(actual.maxDisplacement, expected.maxDisplacement, 1e-5, `geval ${caseId} max u`);
    for (const [id, displacement] of actual.displacements) {
      const other = expected.displacements.get(id);
      assert.ok(other);
      close(displacement.ux, other.ux, 1e-5, `geval ${caseId} knoop ${id} ux`);
      close(displacement.uz, other.uz, 1e-5, `geval ${caseId} knoop ${id} uz`);
    }
    for (const [id, reaction] of actual.reactions) {
      const other = expected.reactions.get(id);
      assert.ok(other);
      close(reaction.fx, other.fx, 0.1, `geval ${caseId} knoop ${id} Rx`);
      close(reaction.fz, other.fz, 0.1, `geval ${caseId} knoop ${id} Rz`);
    }
    for (const element of actual.plateElements[0].elements) {
      const other = expected.plateElements[0].elements.find(item => item.elementId === element.elementId);
      assert.ok(other);
      for (const key of ["sigmaX", "sigmaY", "tauXY", "nx", "ny", "nxy"])
        close(element[key], other[key], 0.002, `geval ${caseId} element ${element.elementId} ${key}`);
    }
  }
  const orthotropicInput = bouwMultiInput(model({
    materiaal: "C24", hoofdrichting: 23, E: undefined, nu: undefined, rho: undefined,
  }));
  const orthotropicNative = await solveAllCasesNativeMembrane2D(orthotropicInput);
  const orthotropicReference = solveAllCases(orthotropicInput).perCase;
  const materialId = nativeInputs.at(-1).materials[0].id;
  const mappedOrthotropic = nativeInputs.at(-1).orthotropicMaterials.find(material => material.materialId === materialId);
  assert.ok(mappedOrthotropic, "app-adapter moet de orthotrope materiaalconstanten naar Rust sturen");
  close(mappedOrthotropic.angleRad, 23 * Math.PI / 180, 1e-12, "C24-hoofdrichting");
  for (const caseId of [1, 2]) {
    const actual = orthotropicNative.get(caseId), expected = orthotropicReference.get(caseId);
    assert.ok(actual && expected);
    close(actual.maxDisplacement, expected.maxDisplacement, 1e-5,
      `orthotroop geval ${caseId} max u`);
    for (const [id, displacement] of actual.displacements) {
      const other = expected.displacements.get(id);
      assert.ok(other);
      close(displacement.ux, other.ux, 1e-5, `orthotroop geval ${caseId} knoop ${id} ux`);
      close(displacement.uz, other.uz, 1e-5, `orthotroop geval ${caseId} knoop ${id} uz`);
    }
    for (const [id, reaction] of actual.reactions) {
      const other = expected.reactions.get(id);
      assert.ok(other);
      close(reaction.fx, other.fx, 0.1, `orthotroop geval ${caseId} knoop ${id} Rx`);
      close(reaction.fz, other.fz, 0.1, `orthotroop geval ${caseId} knoop ${id} Rz`);
    }
  }
  const springModel = model({});
  springModel.supports = [...springModel.supports, { nodeId: 2, type: "xSpring", k: 4200 }];
  const springInput = bouwMultiInput(springModel);
  const springNative = await solveAllCasesNativeMembrane2D(springInput);
  const springReference = solveAllCases(springInput).perCase;
  const mappedSpring = nativeInputs.at(-1).supports.find(support => support.nodeId === 2);
  assert.equal(mappedSpring.kxKnPerM, 4_200_000,
    "modelNaarSolverInput en de meshadapter moeten dezelfde kN/m-eenheid opleveren");
  for (const caseId of [1, 2]) {
    const actual = springNative.get(caseId), expected = springReference.get(caseId);
    assert.ok(actual && expected);
    close(actual.displacements.get(2).ux, expected.displacements.get(2).ux, 1e-5,
      `CST x-veer knoop 2 ux, geval ${caseId}`);
    close(actual.reactions.get(2).fx, expected.reactions.get(2).fx, 0.1,
      `CST x-veerreactie, geval ${caseId}`);
  }
  assert.ok(springNative.get(1).reactions.get(2).fx < 0,
    "de CST-route moet de weerstandskracht van de translatieve veer rapporteren");
  const patch = native.get(1);
  close(patch.displacements.get(2).ux, 5 / 210000 * 2000, 1e-6, "onafhankelijke CST-patchverplaatsing");
  close(patch.plateElements[0].ranges.sigmaX.max, 5, 1e-6, "onafhankelijke CST-patchspanning");
  const combo = { id: 11, name: "UGT", type: "uls", formula: "test", factors: new Map([[1, 1.35], [2, 1.5]]) };
  const curveInput = bouwMultiInput(model({ modulusCurve: [{ strain: 0.00001, eMpa: 100000 }] }));
  const curved = await solveAllCasesNativeMembrane2D(curveInput, "material");
  assert.ok(curved.get(1).maxDisplacement > patch.maxDisplacement);
  assert.ok(curved.get(1).plateElements[0].elements.some(element => element.effectiveEMpa < 210000));
  const direct = await solveAllCombinationsNativeMembrane2D(curveInput, [combo], "material");
  assert.ok(direct.get(11)?.maxDisplacement > 0);
  const historyInput = { ...curveInput, axialMaterialLoadPath: [1, 0, 0.5] };
  await solveAllCombinationsNativeMembrane2D(historyInput, [combo], "material");
  assert.deepEqual(nativeInputs.at(-1).loadPath, [1, 0, 0.5],
    "CST FNL moet het ingestelde belasten-ontlasten-herbelastenpad aan Rust doorgeven");
  await assert.rejects(solveAllCombinationsNativeMembrane2D({ ...curveInput,
    axialMaterialLoadPath: [1, Number.NaN] }, [combo], "material"), /eindige factoren/);
  const envelope = computeEnvelope([combo], curved, direct);
  close(envelope.maxDisplacement, direct.get(11).maxDisplacement, 1e-9, "directe CST-FNL-omhullende");
  for (const [corruption, message] of [
    ["null-node-record", /geldige knoop- of elementrecords/],
    ["null-element-record", /CST-resultaat mist geldige knoop- of elementrecords/],
  ]) {
    corruptNextTriangleResult = corruption;
    await assert.rejects(solveAllCasesNativeMembrane2D(input), message);
  }
  console.log("Rust CST-app-route: L-polygoon, analytische patchtest, lineaire pariteit en FNL E-curve slagen.");
} finally {
  globalThis.fetch = originalFetch;
}
