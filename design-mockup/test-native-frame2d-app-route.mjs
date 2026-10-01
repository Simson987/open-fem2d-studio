import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { solveAllCases, solveCombinationSecondOrder } from "./src/components/fem/solver/engine.ts";
import { combineResults } from "./src/components/fem/solver/combinations.ts";
import { buildNativeFrame2DRequest, solveAllCasesNativeFrame2D, solveAllCombinationsNativeFrame2D } from "./src/components/fem/solver/nativeFrame2DRoute.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";

const binary = fileURLToPath(new URL(`../src-tauri/target/debug/native-frame2d${process.platform === "win32" ? ".exe" : ""}`, import.meta.url));
const invoke = (request) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", chunk => output.push(chunk));
  child.stderr.on("data", chunk => errors.push(chunk));
  child.on("error", reject);
  child.on("close", code => {
    if (code !== 0) return reject(new Error(`${Buffer.concat(output)} ${Buffer.concat(errors)}`));
    resolve(JSON.parse(Buffer.concat(output).toString()));
  });
  child.stdin.end(JSON.stringify(request));
});
const close = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: Rust ${actual}, bestaande solver ${expected}, grens ${tolerance}`,
);

const request = { schemaVersion: 1, dimension: "2d", analysis: "linear", elementFamilies: ["frame"] };
assert.equal(resolveSolver("openaec-native-fem", request).id, "openaec-native-fem");
assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "p-delta" }).id, "openaec-native-fem");
assert.throws(() => resolveSolver("openaec-native-fem", { ...request, analysis: "material-nonlinear" }), /does not support/);

const input = {
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
  beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
  supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
  loads: [{ beamId: 1, caseId: 1, q: -5 }, { beamId: 1, caseId: 3, q: 0 }],
  pointLoads: [{ nodeId: 2, caseId: 2, fx: 60_000 }],
  cases: [{ id: 1, name: "lijnlast" }, { id: 2, name: "trek" }, { id: 3, name: "leeg" }],
};
const nativeRequest = buildNativeFrame2DRequest(input, caseId => caseId === 1 ? 1 : 0);
assert.equal(nativeRequest.memberLoads[0].qyStartKnPerM, -5);
assert.equal(nativeRequest.nodalLoads.length, 0);
const inclinedInput = { ...input,
  nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 3000 }],
  loads: [{ beamId: 1, caseId: 1, q: -3, qDir: "z" }],
  beamPointLoads: [{ beamId: 1, caseId: 1, posFrac: 0.5, fz: -5000 }],
};
const inclinedRequest = buildNativeFrame2DRequest(inclinedInput, () => 1);
close(inclinedRequest.memberLoads[0].qxStartKnPerM, -1.8, 1e-12, "globale last naar lokale qx");
close(inclinedRequest.memberLoads[0].qyStartKnPerM, -2.4, 1e-12, "globale last naar lokale qy");
close(inclinedRequest.memberPointLoads[0].pxKn, -3, 1e-12, "staafpuntlast naar lokale Px");
close(inclinedRequest.memberPointLoads[0].pyKn, -4, 1e-12, "staafpuntlast naar lokale Py");
assert.throws(() => buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], startConnection: "hinge" }] }, () => 1), /scharnieren/);
assert.throws(() => buildNativeFrame2DRequest({ ...input, plates: [{ id: 1 }] }, () => 1), /uitsluitend staven/);

const previousFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "frame2d");
  calls++;
  return new Response(JSON.stringify({ kind: "frame2d", result: await invoke(body.inputs.input) }), { status: 200 });
};
try {
  const nativeCases = await solveAllCasesNativeFrame2D(input);
  const existingCases = solveAllCases(input).perCase;
  assert.equal(calls, 2);
  assert.equal(nativeCases.size, 2);
  for (const [caseId, native] of nativeCases) {
    const existing = existingCases.get(caseId);
    assert.ok(existing);
    for (const [nodeId, displacement] of native.displacements) {
      const reference = existing.displacements.get(nodeId);
      close(displacement.ux, reference.ux, 1e-6, `geval ${caseId} knoop ${nodeId} ux`);
      close(displacement.uz, reference.uz, 1e-6, `geval ${caseId} knoop ${nodeId} uz`);
      close(displacement.ry, reference.ry, 1e-8, `geval ${caseId} knoop ${nodeId} ry`);
    }
    for (const [nodeId, reaction] of native.reactions) {
      const reference = existing.reactions.get(nodeId);
      close(reaction.fx, reference.fx, 1e-4, `geval ${caseId} reactie ${nodeId} fx`);
      close(reaction.fz, reference.fz, 1e-4, `geval ${caseId} reactie ${nodeId} fz`);
      close(reaction.my, reference.my, 1e-3, `geval ${caseId} reactie ${nodeId} my`);
    }
    const member = native.elements.get(1), reference = existing.elements.get(1);
    assert.ok(member && reference);
    for (const key of ["N", "V", "M_start", "M_end", "L_mm"]) {
      close(member[key], reference[key], key.startsWith("M_") ? 1e-3 : 1e-5,
        `geval ${caseId} ${key}`);
    }
    for (const key of ["normalForce", "shearForce", "bendingMoment", "deflection", "axialDisp", "rotation"]) {
      assert.equal(member[key].length, reference[key].length, `${key} heeft dezelfde stations`);
      member[key].forEach((value, index) => close(value, reference[key][index],
        key === "bendingMoment" ? 1e-3 : key === "rotation" ? 1e-8 : 1e-5,
        `geval ${caseId} ${key} station ${index}`));
    }
    close(native.maxDisplacement, existing.maxDisplacement, 1e-6, `geval ${caseId} max verplaatsing`);
  }
  const combination = { id: 10, name: "1,2G + 1,5Q", factors: new Map([[1, 1.2], [2, 1.5]]) };
  const nativeCombined = combineResults(combination, nativeCases);
  const existingCombined = combineResults(combination, existingCases);
  close(nativeCombined.maxDisplacement, existingCombined.maxDisplacement, 1e-6, "combinatie max verplaatsing");
  close(nativeCombined.elements.get(1).bendingMoment[10], existingCombined.elements.get(1).bendingMoment[10], 1e-3,
    "combinatie veldmoment");
  close(nativeCombined.elements.get(1).normalForce[10], existingCombined.elements.get(1).normalForce[10], 1e-4,
    "combinatie normaalkracht");
  const springInput = { ...input,
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "xSpring", k: 1000 }],
    loads: [], pointLoads: [{ nodeId: 2, caseId: 1, fx: 100_000 }],
    cases: [{ id: 1, name: "veer" }],
  };
  const springNative = (await solveAllCasesNativeFrame2D(springInput)).get(1);
  const springExisting = solveAllCases(springInput).perCase.get(1);
  close(springNative.reactions.get(2).fx, springExisting.reactions.get(2).fx, 1e-4,
    "veerreactie via app-route");
  const pointInput = { ...input, loads: [], pointLoads: [],
    beamPointLoads: [
      { beamId: 1, caseId: 1, posFrac: 0.25, fz: -8000 },
      { beamId: 1, caseId: 2, posFrac: 0.75, fz: -12000 },
    ],
    cases: [{ id: 1, name: "punt links" }, { id: 2, name: "punt rechts" }],
  };
  const nativePointCases = await solveAllCasesNativeFrame2D(pointInput);
  const existingPointCases = solveAllCases(pointInput).perCase;
  assert.deepEqual(nativePointCases.get(1).elements.get(1).stations_mm,
    nativePointCases.get(2).elements.get(1).stations_mm,
    "alle lastgevallen behouden beide puntlaststations");
  const pointCombo = { id: 11, name: "beide puntlasten", factors: new Map([[1, 1.2], [2, 1.5]]) };
  const nativePointCombo = combineResults(pointCombo, nativePointCases);
  const existingPointCombo = combineResults(pointCombo, existingPointCases);
  for (const nodeId of [1, 2]) {
    close(nativePointCombo.reactions.get(nodeId).fz, existingPointCombo.reactions.get(nodeId).fz,
      1e-4, `puntlastcombinatie reactie ${nodeId}`);
    close(nativePointCombo.displacements.get(nodeId).uz, existingPointCombo.displacements.get(nodeId).uz,
      1e-6, `puntlastcombinatie verplaatsing ${nodeId}`);
  }
  for (const x of [1500, 4500]) {
    const own = nativePointCombo.elements.get(1);
    const reference = existingPointCombo.elements.get(1);
    const ownIndex = own.stations_mm.findIndex(value => Math.abs(value - x) < 1e-8);
    const referenceIndex = reference.stations_mm.findIndex(value => Math.abs(value - x) < 1e-8);
    assert.ok(ownIndex >= 0 && referenceIndex >= 0);
    close(own.bendingMoment[ownIndex], reference.bendingMoment[referenceIndex], 1e-3,
      `puntlastcombinatie moment bij ${x} mm`);
    close(own.deflection[ownIndex], reference.deflection[referenceIndex], 1e-5,
      `puntlastcombinatie vervorming bij ${x} mm`);
  }
  const endpointInput = { ...input, loads: [], pointLoads: [],
    beamPointLoads: [{ beamId: 1, caseId: 1, posFrac: 1, fz: -10_000, my: 2e6 }],
    cases: [{ id: 1, name: "eindpunt" }],
  };
  const endpointRequest = buildNativeFrame2DRequest(endpointInput, () => 1);
  assert.equal(endpointRequest.memberPointLoads.length, 0);
  assert.deepEqual(endpointRequest.nodalLoads[0], { nodeId: 2, fx: 0, fy: -10, mz: 2 });
  const endpointNative = (await solveAllCasesNativeFrame2D(endpointInput)).get(1);
  const endpointExisting = solveAllCases(endpointInput).perCase.get(1);
  close(endpointNative.displacements.get(2).uz, endpointExisting.displacements.get(2).uz, 1e-6,
    "staafeindpuntlast verplaatsing");
  close(endpointNative.reactions.get(1).fz, endpointExisting.reactions.get(1).fz, 1e-4,
    "staafeindpuntlast reactie");
  const columnInput = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6 }],
    supports: [{ nodeId: 1, type: "fixed" }], loads: [],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: -100_000 }, { nodeId: 2, caseId: 2, fz: -10_000 }],
    cases: [{ id: 1, name: "druk" }, { id: 2, name: "dwars" }] };
  const secondOrderCombo = { id: 20, name: "druk plus dwars", type: "uls", formula: "1.2 G + 1.5 Q",
    factors: new Map([[1, 1.2], [2, 1.5]]) };
  const nativeSecondOrder = (await solveAllCombinationsNativeFrame2D(columnInput, [secondOrderCombo])).get(20);
  const referenceSecondOrder = solveCombinationSecondOrder(columnInput, secondOrderCombo);
  assert.ok(nativeSecondOrder && referenceSecondOrder);
  close(nativeSecondOrder.displacements.get(2).uz, referenceSecondOrder.displacements.get(2).uz,
    0.15, "P-Delta combinatie tipverplaatsing");
  assert.ok(nativeSecondOrder.displacements.get(2).uz <
    combineResults(secondOrderCombo, solveAllCases(columnInput).perCase).displacements.get(2).uz,
    "druk vergroot de tweede-orde tipverplaatsing");
} finally {
  globalThis.fetch = previousFetch;
}
console.log("Native 2D-app-route: gevallen, staafdiagrammen en combinatie stemmen overeen met de bestaande solver.");
