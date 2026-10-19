import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { solveAllCases, solveCombinationSecondOrder } from "./src/components/fem/solver/engine.ts";
import { getScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./src/components/fem/solver/engine.ts";
import { combineResults } from "./src/components/fem/solver/combinations.ts";
import { getEindtoestandGevallen } from "./src/components/fem/solver/combinations.ts";
import { eindstijfheidInvoer, losEindtoestandNativeOp } from "./src/lib/houtEindstijfheid.ts";
import { buildNativeFrame2DRequest, solveAllCasesNativeFrame2D, solveAllCombinationsNativeFrame2D } from "./src/components/fem/solver/nativeFrame2DRoute.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { spiegelElementKrachten } from "./src/lib/referentierichting.ts";
import { bouwMultiInput } from "./src/lib/modelNaarSolverInput.ts";
import { losCombinatieFysischOp } from "./src/lib/betonStijfheid.ts";

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
assert.equal(resolveSolver("openaec-native-fem", { ...request, analysis: "material-nonlinear" }).id,
  "openaec-native-fem");

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
const inclinedSwayRequest = buildNativeFrame2DRequest({ ...inclinedInput,
  scheefstand: { phi: 0.005, richting: 1 } }, () => 1);
close(inclinedSwayRequest.memberLoads[0].qxStartKnPerM, -1.788, 1e-12,
  "scheefstand op verticale component van schuine lijnlast");
close(inclinedSwayRequest.memberLoads[0].qyStartKnPerM, -2.409, 1e-12,
  "scheefstand terug naar lokale dwarsrichting");
close(inclinedSwayRequest.memberPointLoads[0].pxKn, -2.98, 1e-12,
  "scheefstand op schuine staafpuntlast");
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], startConnection: "hinge" }] }, () => 1).members[0].releases.rzStart, true);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], releases: { startTx: true } }] }, () => 1).members[0].releases.uxStart, true);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], releases: { endTz: true } }] }, () => 1).members[0].releases.uyEnd, true);
const splitReleaseMembers = buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], extraSneden: [0.5],
    releases: { startTx: true, endTz: true } }] }, () => 1).members;
assert.equal(splitReleaseMembers.length, 2);
assert.equal(splitReleaseMembers[0].releases.uxStart, true);
assert.equal(splitReleaseMembers[0].releases.uyEnd, false);
assert.equal(splitReleaseMembers[1].releases.uxStart, false);
assert.equal(splitReleaseMembers[1].releases.uyEnd, true);
const springMembers = buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], extraSneden: [0.5],
    veren: { startTx: 200_000, endRy: 3.5e9 } }] }, () => 1).members;
assert.equal(springMembers[0].springs.uxStartKnPerM, 200_000);
assert.equal(springMembers[0].springs.rzEndKnmPerRad, undefined);
assert.equal(springMembers[1].springs.uxStartKnPerM, undefined);
assert.equal(springMembers[1].springs.rzEndKnmPerRad, 3500);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], veren: { startTx: 200_000 },
    axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }] },
() => 1, "material").members[0].springs.uxStartKnPerM, 200_000);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], releases: { endRy: true },
    veren: { endRy: 3.5e9 } }] }, () => 1).members[0].springs.rzEndKnmPerRad, undefined);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], releases: { startTx: true },
    axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 355, hardeningRatio: 0.01 } }] },
() => 1, "material").members[0].releases.uxStart, true);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], endConnection: "hinge" }] }, () => 1, "geometric").members[0].releases.rzEnd, true);
assert.throws(() => buildNativeFrame2DRequest({ ...input, plates: [{ id: 1 }] }, () => 1), /uitsluitend staven/);

const previousFetch = globalThis.fetch;
let calls = 0;
let corruptNextFrameResult = null;
let failFramePcgOnce = false;
let failFrameMechanismOnce = false;
const nativeRequests = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const body = JSON.parse(options.body);
  assert.equal(body.opdracht, "solve_native_fem");
  assert.equal(body.inputs.kind, "frame2d");
  calls++;
  nativeRequests.push(body.inputs.input);
  if (failFramePcgOnce && body.inputs.input.linearBackend !== "frontalWave") {
    failFramePcgOnce = false;
    return new Response(JSON.stringify({ fout: "sparse solver did not converge within 4000 iterations" }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
  if (failFrameMechanismOnce) {
    failFrameMechanismOnce = false;
    return new Response(JSON.stringify({ fout: "non-positive free stiffness; unstable frame" }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
  const result = await invoke(body.inputs.input);
  if (corruptNextFrameResult) {
    const corruption = corruptNextFrameResult;
    corruptNextFrameResult = null;
    if (corruption === "null-node-record") result.nodes[0] = null;
    else if (corruption === "null-member-record") result.members[0] = null;
    else if (corruption === "null-displacement") result.nodes[0].displacement = null;
    else if (corruption === "null-reaction") result.nodes[0].reaction = null;
    else if (corruption === "null-stations") result.members[0].stationsM = null;
    else if (corruption === "null-end-forces") result.members[0].localEndForces = null;
    else if (corruption === "invalid-diagram-station") {
      const stations = result.members[0].stationsM;
      stations[1] = stations.at(-1);
    }
  }
  return new Response(JSON.stringify({ kind: "frame2d", result }), { status: 200 });
};
try {
  let nativeConcreteIterationCalls = 0;
  const concreteInput = {
    ...input,
    cases: [{ id: 1, name: "betonbelasting" }],
    loads: [{ beamId: 1, caseId: 1, q: -5 }],
    pointLoads: [],
    beams: [{ ...input.beams[0], material: "C30/37", profile: "rechthoek 300x600" }],
  };
  const concrete = await losCombinatieFysischOp(concreteInput,
    { id: 95, name: "native beton FNL", factors: new Map([[1, 1]]) },
    [{ beamId: 1, doorsnede: {}, betonklasse: "C30/37", staalsoort: "B500B", korf: {},
      lengteMm: 6000, aantalStroken: 50, staaltak: "Horizontal" }],
    {
      segmentLengteMm: 2000,
      roep: async (_command, request) => {
        const count = Math.max(1, Math.round(request.length_m * 1000
          / request.target_segment_length_mm));
        const hasForces = request.segment_forces.length > 0;
        return {
          beam_id: request.beam_id, length_m: request.length_m,
          target_segment_length_mm: request.target_segment_length_mm,
          segment_count: count, ei_uncracked_knm2: 1680,
          segments: Array.from({ length: count }, (_, index) => ({
            index, x_start_mm: index * request.length_m * 1000 / count,
            x_end_mm: (index + 1) * request.length_m * 1000 / count,
            ei_knm2: hasForces ? 1200 : null, message: null,
          })),
          converged: hasForces, max_relative_change: hasForces ? 0 : null,
          failed_count: 0, clamped_count: 0, governing_segment: hasForces ? 0 : null,
        };
      },
      losOp: async (iterationInput, iterationCombo) => {
        nativeConcreteIterationCalls++;
        const result = await solveAllCombinationsNativeFrame2D(iterationInput, [{
          id: iterationCombo.id, name: iterationCombo.name, type: "uls", formula: "",
          factors: iterationCombo.factors,
        }], "geometric");
        return result.get(iterationCombo.id) ?? null;
      },
    });
  assert.equal(nativeConcreteIterationCalls, 1,
    "de beton-secanslus moet de asynchrone Rust P-Δ-oplosser afwachten");
  assert.ok(concrete.resultaat.elements.get(1).segmenten.length === 3,
    "de Rust-uitkomst moet de drie beton-secans-E-segmenten behouden");
  assert.ok(Number.isFinite(concrete.resultaat.displacements.get(2).uz),
    "de native beton-secantiteratie moet een eindige tipverplaatsing geven");

  const conformingFramePlate = {
    nodes: [
      { id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 },
      { id: 3, x: 3000, z: 2000 }, { id: 4, x: 0, z: 2000 },
    ],
    beams: [{ id: 11, from: 1, to: 2, E: 210000, A: 10000, I: 8e6 }],
    plates: [{ id: 21, nodeIds: [1, 2, 3, 4], thickness: 200,
      E: 30000, nu: 0.2, rho: 2500, meshSize: 1000, meshType: "vierhoeken" }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" },
      { nodeId: 4, type: "xRoller" }],
    cases: [{ id: 31, name: "gekoppelde randlast" }],
    loads: [], pointLoads: [],
    edgeLoads: [{ plateId: 21, edge: "right", p: 5, dir: "x", caseId: 31 }],
  };
  const coupledNative = (await solveAllCasesNativeFrame2D(conformingFramePlate)).get(31);
  const coupledReference = solveAllCases(conformingFramePlate).perCase.get(31);
  assert.ok(coupledNative && coupledReference);
  assert.equal(coupledNative.plateElements.length, 1);
  assert.equal(coupledNative.plateElements[0].elements.length, 6,
    "de gekoppelde route moet alle Q4-resultanten naar de plaatweergave terugzetten");
  for (const nodeId of [1, 2, 3, 4]) {
    close(coupledNative.displacements.get(nodeId).ux, coupledReference.displacements.get(nodeId).ux,
      2e-4, `frame-plaat verplaatsing knoop ${nodeId} ux`);
    close(coupledNative.displacements.get(nodeId).uz, coupledReference.displacements.get(nodeId).uz,
      2e-4, `frame-plaat verplaatsing knoop ${nodeId} uz`);
  }
  for (const nodeId of [1, 2, 4]) {
    close(coupledNative.reactions.get(nodeId).fx, coupledReference.reactions.get(nodeId).fx,
      0.1, `frame-plaat reactie knoop ${nodeId} Fx`);
    close(coupledNative.reactions.get(nodeId).fz, coupledReference.reactions.get(nodeId).fz,
      0.1, `frame-plaat reactie knoop ${nodeId} Fz`);
  }
  const coupledStresses = coupledNative.plateElements[0].elements;
  assert.ok(coupledStresses.every(element => [element.sigmaX, element.sigmaY, element.tauXY].every(Number.isFinite)));
  close(coupledNative.elements.get(11).N, coupledReference.elements.get(11).N, 0.1,
    "plaatrandbelasting draagt normaalkracht over op de gedeelde ligger");
  assert.ok(Math.abs(coupledNative.elements.get(11).N) > 1,
    "de plaatbelasting moet aantoonbaar normaalkracht in de ligger veroorzaken");
  assert.ok(Math.abs([...coupledNative.reactions.values()].reduce((sum, reaction) => sum + reaction.fx, 0)
    + 10_000) < 0.1, "gekoppelde plaatrandbelasting sluit op de totale horizontale reactie");
  const coupledCombo = combineResults({ id: 91, name: "gekoppeld", factors: new Map([[31, 1]]) },
    new Map([[31, coupledNative]]));
  assert.equal(coupledCombo.plateElements.length, 1,
    "lineaire combinaties moeten de gekoppelde plaatresultaten meenemen");
  close(coupledCombo.plateElements[0].elements[0].sigmaX,
    coupledNative.plateElements[0].elements[0].sigmaX, 1e-9,
    "lineaire combinatie behoudt gekoppelde membraanspanning");
  const coupledCstInput = { ...conformingFramePlate,
    plates: [{ ...conformingFramePlate.plates[0], meshType: "driehoeken" }],
  };
  const coupledCstNative = (await solveAllCasesNativeFrame2D(coupledCstInput)).get(31);
  const coupledCstReference = solveAllCases(coupledCstInput).perCase.get(31);
  assert.ok(coupledCstNative && coupledCstReference);
  assert.equal(coupledCstNative.plateElements[0].elements.length, 12,
    "de gekoppelde route moet alle CST-resultanten naar de plaatweergave terugzetten");
  close(coupledCstNative.elements.get(11).N, coupledCstReference.elements.get(11).N, 0.1,
    "CST-randbelasting draagt normaalkracht over op de gedeelde ligger");
  for (const nodeId of [1, 2, 3, 4]) {
    close(coupledCstNative.displacements.get(nodeId).uz, coupledCstReference.displacements.get(nodeId).uz,
      2e-4, `CST frame-plaat verplaatsing knoop ${nodeId}`);
  }
  const coupledGnl = (await solveAllCasesNativeFrame2D(conformingFramePlate, "geometric")).get(31);
  assert.ok(coupledGnl && coupledGnl.plateElements[0].elements.length === 6,
    "GNL moet gekoppelde Q4-plaatresultaten terugzetten");
  assert.ok([...coupledGnl.displacements.values()].some(value => Math.abs(value.ux) > 1e-8),
    "GNL moet de gemeenschappelijke raamwerk-plaatverplaatsingen oplossen");
  const coupledGnlCombo = (await solveAllCombinationsNativeFrame2D(conformingFramePlate,
    [{ id: 92, name: "gekoppelde GNL", factors: new Map([[31, 1]]) }], "geometric")).get(92);
  assert.ok(coupledGnlCombo && coupledGnlCombo.plateElements[0].elements.length === 6,
    "GNL-combinaties moeten gekoppelde plaatresultaten bevatten");
  const coupledFnlInput = { ...conformingFramePlate,
    plates: [{ ...conformingFramePlate.plates[0], materiaal: "S235",
      nonlinearLaw: { kind: "steelBilinear", yieldMpa: 0.01, hardeningRatio: 0.1 } }],
  };
  const coupledFnl = (await solveAllCombinationsNativeFrame2D(coupledFnlInput,
    [{ id: 93, name: "gekoppelde FNL", factors: new Map([[31, 1]]) }], "material")).get(93);
  assert.ok(coupledFnl && coupledFnl.plateElements[0].elements.length === 6,
    "FNL-combinaties moeten gekoppelde plaatresultaten bevatten");
  assert.ok(coupledFnl.plateElements[0].elements.some(element =>
    (element.equivalentPlasticStrain ?? 0) > 0), "de plaat-FNL-wet moet plastische rek terugrapporteren");
  const coupledCurveInput = { ...conformingFramePlate,
    plates: [{ ...conformingFramePlate.plates[0],
      modulusCurve: [{ strain: 1e-8, eMpa: 15_000 }, { strain: 2e-8, eMpa: 10_000 }] }],
  };
  const coupledCurve = (await solveAllCombinationsNativeFrame2D(coupledCurveInput,
    [{ id: 94, name: "gekoppelde FNL E-curve", factors: new Map([[31, 1]]) }], "combined")).get(94);
  assert.ok(coupledCurve && coupledCurve.plateElements[0].elements.length === 6,
    "gecombineerde GNL/FNL moet gekoppelde E-curveplaatresultaten bevatten");
  assert.ok(coupledCurve.plateElements[0].elements.every(element =>
    Number.isFinite(element.effectiveEMpa) && element.effectiveEMpa < 30_000),
  "de gekoppelde FNL moet de veranderende plaat-E-modulus rapporteren");
  await assert.rejects(() => solveAllCasesNativeFrame2D({ ...conformingFramePlate,
    beams: [{ ...conformingFramePlate.beams[0], to: 3 }],
  }), /raakt een plaatelement|binnenvlak.*MPC/,
  "een ligger door een plaatelement mag niet als gedeelde randknoop worden behandeld");
  calls = 0;

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
  const singleCaseInput = { ...input, cases: [{ id: 1, name: "lijnlast" }] };
  const callsBeforeRecovery = nativeRequests.length;
  failFramePcgOnce = true;
  const recoveredCase = (await solveAllCasesNativeFrame2D(singleCaseInput)).get(1);
  assert.deepEqual(nativeRequests.slice(callsBeforeRecovery).map((entry) => entry.linearBackend ?? "existing"),
    ["existing", "frontalWave"]);
  assert.ok(recoveredCase);
  close(recoveredCase.maxDisplacement, nativeCases.get(1).maxDisplacement, 1e-6,
    "frontale 2D-raamwerkfallback");
  const callsBeforeMechanism = nativeRequests.length;
  failFrameMechanismOnce = true;
  await assert.rejects(() => solveAllCasesNativeFrame2D(singleCaseInput), /non-positive free stiffness/);
  assert.deepEqual(nativeRequests.slice(callsBeforeMechanism).map((entry) => entry.linearBackend ?? "existing"),
    ["existing"]);
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
  const thermalInput = { ...input, loads: [], pointLoads: [],
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: 40, alpha: 12e-6 }],
    cases: [{ id: 1, name: "opwarming" }] };
  const thermalRequest = buildNativeFrame2DRequest(thermalInput, () => 0.5);
  assert.deepEqual(thermalRequest.thermalLoads, [{ memberId: 1, deltaTK: 20, alphaPerK: 12e-6 }]);
  assert.throws(() => buildNativeFrame2DRequest({ ...thermalInput,
    thermalLoads: [{ beamId: 99, caseId: 1, deltaT: 40 }] }, () => 1), /onbekende staaf/);
  const freeThermal = (await solveAllCasesNativeFrame2D(thermalInput)).get(1);
  const freeThermalReference = solveAllCases(thermalInput).perCase.get(1);
  close(freeThermal.displacements.get(2).ux, 2.88, 1e-8, "vrije thermische uitzetting analytisch");
  close(freeThermal.displacements.get(2).ux, freeThermalReference.displacements.get(2).ux,
    1e-6, "vrije thermische uitzetting bestaande solver");
  close(freeThermal.elements.get(1).axialDisp[10], 1.44, 1e-8,
    "thermische verplaatsing midden staaf");
  const restrainedThermalInput = { ...thermalInput,
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "pinned" }] };
  const restrainedThermal = (await solveAllCasesNativeFrame2D(restrainedThermalInput)).get(1);
  const restrainedReference = solveAllCases(restrainedThermalInput).perCase.get(1);
  close(restrainedThermal.reactions.get(1).fx, 1_008_000, 1e-4,
    "verhinderde thermische reactie analytisch");
  close(restrainedThermal.reactions.get(1).fx, restrainedReference.reactions.get(1).fx,
    1e-4, "verhinderde thermische reactie bestaande solver");
  const halfThermal = (await solveAllCombinationsNativeFrame2D(thermalInput,
    [{ id: 98, name: "halve temperatuur", factors: new Map([[1, 0.5]]) }])).get(98);
  close(halfThermal.displacements.get(2).ux, 1.44, 1e-8,
    "gefactoreerde thermische uitzetting bij P-Delta");
  const gradientInput = { ...thermalInput,
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: 0, deltaTGradient: 40,
      thermalDepthMm: 200, alpha: 12e-6 }],
  };
  const gradientRequest = buildNativeFrame2DRequest(gradientInput, () => 0.5);
  assert.deepEqual(gradientRequest.thermalLoads, [{ memberId: 1, deltaTK: 0,
    alphaPerK: 12e-6, deltaTGradientK: 20, depthM: 0.2 }]);
  assert.throws(() => buildNativeFrame2DRequest({ ...gradientInput,
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: 0, deltaTGradient: 40 }] }, () => 1),
  /gradiënthoogte/);
  assert.throws(() => solveAllCases(gradientInput), /temperatuurgradiënt vereist/);
  const gradientResult = (await solveAllCasesNativeFrame2D(gradientInput)).get(1);
  close(gradientResult.elements.get(1).deflection[10], 10.8, 1e-7,
    "vrije kromming door temperatuurgradiënt analytisch");
  close(gradientResult.elements.get(1).bendingMoment[10], 0, 1e-5,
    "vrij opgelegde thermische gradiënt zonder mechanisch moment");
  const beddingE = 210_000, beddingI = 1e8, beddingK = 1;
  const beddingLambda = Math.pow(beddingK / (4 * beddingE * beddingI), 0.25);
  const beddingLength = 20 / beddingLambda;
  const beddingLoad = 100_000;
  const beddingInput = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: beddingLength, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: beddingE, I: beddingI, A: 5000,
      bedding: { kLijn: beddingK } }],
    supports: [{ nodeId: 1, type: "xRoller" }],
    loads: [], pointLoads: [],
    beamPointLoads: [{ beamId: 1, caseId: 1, posFrac: 0.5, fz: -beddingLoad }],
    cases: [{ id: 1, name: "puntlast op bedding" }],
  };
  const beddingRequest = buildNativeFrame2DRequest(beddingInput, () => 1);
  assert.ok(beddingRequest.members.length >= 134, "bedding wordt fijn genoeg verdeeld");
  assert.equal(beddingRequest.members.length + 1, beddingRequest.nodes.length);
  assert.ok(beddingRequest.members.every(member => member.foundationKnPerM2 === 1000));
  const beddingNative = (await solveAllCasesNativeFrame2D(beddingInput)).get(1);
  const beddingOld = solveAllCases(beddingInput).perCase.get(1);
  const beddingElement = beddingNative.elements.get(1);
  assert.equal(beddingNative.displacements.size, 2, "virtuele meshknopen blijven uit de app-uitvoer");
  assert.equal(beddingNative.elements.size, 1, "meshelementen worden één app-staaf");
  const beddingDeflection = Math.max(...beddingElement.deflection.map(Math.abs));
  const beddingMoment = Math.max(...beddingElement.bendingMoment.map(Math.abs));
  close(beddingDeflection, beddingLoad * beddingLambda / (2 * beddingK),
    beddingLoad * beddingLambda / (2 * beddingK) * 0.015,
    "beddingzakking tegen gesloten oplossing");
  close(beddingMoment, beddingLoad / (4 * beddingLambda),
    beddingLoad / (4 * beddingLambda) * 0.015,
    "beddingmoment tegen gesloten oplossing");
  close(beddingDeflection, Math.max(...beddingOld.elements.get(1).deflection.map(Math.abs)),
    beddingDeflection * 0.005, "beddingzakking tegen bestaande solver");
  close(beddingNative.reactions.get(1).fz, 0, 1e-4,
    "beddingreactie wordt niet als oplegreactie getoond");
  const beddingLineInput = { ...beddingInput,
    beamPointLoads: [],
    loads: [{ beamId: 1, caseId: 1, qStart: -2, qEnd: -5,
      startFrac: 0.2, endFrac: 0.8, qDir: "z" }],
  };
  const beddingLine = (await solveAllCasesNativeFrame2D(beddingLineInput)).get(1);
  const beddingLineOld = solveAllCases(beddingLineInput).perCase.get(1);
  close(beddingLine.elements.get(1).deflection[Math.floor(beddingLine.elements.get(1).deflection.length / 2)],
    beddingLineOld.elements.get(1).deflection[Math.floor(beddingLineOld.elements.get(1).deflection.length / 2)],
    0.1, "deellast op bedding tegen bestaande solver");
  const beddingGeometricInput = { ...beddingInput,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 }],
    supports: [{ nodeId: 1, type: "fixed" }], beamPointLoads: [],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: -100_000, fz: -10_000 }],
  };
  const beddingCombination = { id: 97, name: "bedding P-Delta", factors: new Map([[1, 1]]) };
  const beddingGeometric = (await solveAllCombinationsNativeFrame2D(beddingGeometricInput,
    [beddingCombination], "geometric")).get(97);
  const beddingGeometricOld = solveCombinationSecondOrder(beddingGeometricInput, beddingCombination);
  close(beddingGeometric.displacements.get(2).uz,
    beddingGeometricOld.displacements.get(2).uz, 1e-3,
    "P-Delta op bedding tegen bestaande solver");
  const beddingSparseInput = { ...beddingInput,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 40 / beddingLambda, z: 0 }],
    supports: [{ nodeId: 1, type: "fixed" }], beamPointLoads: [],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -1000 }],
  };
  assert.equal(buildNativeFrame2DRequest(beddingSparseInput, () => 1).nodes.length, 201,
    "lang beddingmodel heeft 603 DOF en raakt de sparse route");
  const beddingSparseLinear = (await solveAllCasesNativeFrame2D(beddingSparseInput)).get(1);
  const beddingSparseGeometric = (await solveAllCombinationsNativeFrame2D(beddingSparseInput,
    [beddingCombination], "geometric")).get(97);
  close(beddingSparseGeometric.displacements.get(2).uz,
    beddingSparseLinear.displacements.get(2).uz, 1e-5,
    "P-Delta met 603 DOF zonder normaalkracht is gelijk aan lineair");
  const stepE = 210_000, stepI = 1.673e7, stepL = 6000, stepQ = 10;
  const steppedInput = { ...input,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: stepL, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: stepE, A: 3877, I: stepI,
      segmenten: [{ tStart: 0, tEnd: 0.5, I: stepI },
        { tStart: 0.5, tEnd: 1, I: 3 * stepI }] }],
    supports: [{ nodeId: 1, type: "pinned" }, { nodeId: 2, type: "zRoller" }],
    loads: [{ beamId: 1, caseId: 1, q: -stepQ }], pointLoads: [],
    cases: [{ id: 1, name: "traptrede" }],
  };
  const steppedRequest = buildNativeFrame2DRequest(steppedInput, () => 1);
  assert.equal(steppedRequest.members.length, 2);
  assert.equal(steppedRequest.sections[1].inertiaM4, 3 * stepI * 1e-12);
  const steppedNative = (await solveAllCasesNativeFrame2D(steppedInput)).get(1);
  const steppedOld = solveAllCases(steppedInput).perCase.get(1);
  const steppedElement = steppedNative.elements.get(1);
  const middle = steppedElement.stations_mm.findIndex(x => Math.abs(x - stepL / 2) < 1e-6);
  const handDeflection = -(5 * stepQ * stepL ** 4 / 768)
    * (1 / (stepE * stepI) + 1 / (stepE * 3 * stepI));
  close(steppedElement.deflection[middle], handDeflection, 1e-7,
    "traptrede-ligger: analytische middenzakking");
  close(steppedElement.deflection[middle], steppedOld.elements.get(1).deflection[middle], 1e-6,
    "traptrede-ligger: bestaande solver");
  close(steppedElement.bendingMoment[middle], stepQ * stepL ** 2 / 8, 1e-3,
    "traptrede-ligger: analytisch middenmoment");
  assert.deepEqual(steppedElement.segmenten.map(segment => segment.I), [stepI, 3 * stepI]);
  assert.deepEqual(steppedElement.segmenten.map(segment => segment.segmentIndex), [0, 1]);
  close(steppedElement.segmenten[0].xEnd, 3000, 1e-8, "segmentuitvoer x-grens");
  const steppedCasesInput = { ...steppedInput,
    pointLoads: [{ nodeId: 2, caseId: 2, fx: 10_000 }],
    cases: [...steppedInput.cases, { id: 2, name: "trek" }],
  };
  const steppedCases = await solveAllCasesNativeFrame2D(steppedCasesInput);
  const steppedCombination = combineResults({ id: 96, name: "traptredecombinatie",
    factors: new Map([[1, 1.5], [2, 0.5]]) }, steppedCases).elements.get(1);
  assert.equal(steppedCombination.segmenten.length, 2,
    "lineaire combinatie behoudt de segmentuitvoer");
  close(steppedCombination.segmenten[0].N_start, 5000, 1e-5,
    "lineaire combinatie: segmentnormaalkracht");
  close(steppedCombination.segmenten[0].M_max, 1.5 * stepQ * stepL ** 2 / 8, 1e-3,
    "lineaire combinatie: maatgevend segmentmoment");
  const jointAtSegmentInput = { ...steppedInput,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 6000, z: 0 },
      { id: 3, x: 3000, z: 0 }, { id: 4, x: 3000, z: 3000 }],
    beams: [...steppedInput.beams,
      { id: 2, from: 3, to: 4, E: stepE, A: 3877, I: stepI }],
    loads: [], pointLoads: [{ nodeId: 4, caseId: 1, fx: 10_000 }],
  };
  const jointRequest = buildNativeFrame2DRequest(jointAtSegmentInput, () => 1);
  assert.equal(jointRequest.members[0].endNodeId, 3,
    "segmentgrens hergebruikt de bestaande knoop van de aansluitende staaf");
  assert.equal(jointRequest.members[1].startNodeId, 3);
  const jointNative = (await solveAllCasesNativeFrame2D(jointAtSegmentInput)).get(1);
  const jointOld = solveAllCases(jointAtSegmentInput).perCase.get(1);
  close(jointNative.displacements.get(4).ux, jointOld.displacements.get(4).ux, 1e-5,
    "aansluitende staaf op segmentgrens: horizontale tipverplaatsing");
  close(jointNative.reactions.get(1).fx, jointOld.reactions.get(1).fx, 1e-4,
    "aansluitende staaf op segmentgrens: horizontale reactie");
  const partialSteppedInput = { ...steppedInput,
    loads: [{ beamId: 1, caseId: 1, q: -stepQ, startFrac: 0.25, endFrac: 0.75 }],
  };
  const partialNative = (await solveAllCasesNativeFrame2D(partialSteppedInput)).get(1);
  const partialOld = solveAllCases(partialSteppedInput).perCase.get(1);
  assert.equal(partialNative.elements.get(1).segmenten.length, 4,
    "deellastgrenzen maken extra rekenstukken binnen bronsegmenten");
  assert.deepEqual(partialNative.elements.get(1).segmenten.map(segment => segment.segmentIndex),
    [0, 0, 1, 1]);
  for (const nodeId of [1, 2]) {
    close(partialNative.displacements.get(nodeId).uz, partialOld.displacements.get(nodeId).uz,
      1e-6, `deellast op segmenten: knoop ${nodeId} uz`);
    close(partialNative.reactions.get(nodeId).fz, partialOld.reactions.get(nodeId).fz,
      1e-4, `deellast op segmenten: knoop ${nodeId} Rz`);
  }
  const partialN = partialNative.elements.get(1), partialO = partialOld.elements.get(1);
  assert.equal(partialN.stations_mm.length, partialO.stations_mm.length);
  for (const x of [0, 1500, 3000, 4500, 6000]) {
    const index = partialN.stations_mm.findIndex(station => Math.abs(station - x) < 1e-6);
    close(partialN.bendingMoment[index], partialO.bendingMoment[index], 1e-3,
      `deellast op segmenten: M(${x})`);
    close(partialN.deflection[index], partialO.deflection[index], 1e-5,
      `deellast op segmenten: w(${x})`);
  }
  const plainPartialInput = { ...partialSteppedInput,
    beams: [{ id: 1, from: 1, to: 2, E: stepE, A: 3877, I: stepI }],
  };
  assert.equal(buildNativeFrame2DRequest(plainPartialInput, () => 1).members.length, 3,
    "deellastgrenzen worden ook zonder variabele doorsnede rekenstations");
  const plainPartialNative = (await solveAllCasesNativeFrame2D(plainPartialInput)).get(1);
  const plainPartialOld = solveAllCases(plainPartialInput).perCase.get(1);
  assert.equal(plainPartialNative.elements.get(1).stations_mm.length,
    plainPartialOld.elements.get(1).stations_mm.length);
  close(plainPartialNative.elements.get(1).bendingMoment[30],
    plainPartialOld.elements.get(1).bendingMoment[30], 1e-3,
    "deellast op gewone staaf: momentlijn tegen bestaande solver");
  const boundaryPointInput = { ...steppedInput, loads: [],
    beamPointLoads: [{ beamId: 1, caseId: 1, posFrac: 0.5, fz: -50_000 }],
  };
  const boundaryNative = (await solveAllCasesNativeFrame2D(boundaryPointInput)).get(1);
  const boundaryOld = solveAllCases(boundaryPointInput).perCase.get(1);
  close(boundaryNative.elements.get(1).deflection[20],
    boundaryOld.elements.get(1).deflection[20], 1e-6,
    "puntlast op segmentgrens: middenzakking");
  close(boundaryNative.reactions.get(1).fz, boundaryOld.reactions.get(1).fz, 1e-4,
    "puntlast op segmentgrens: oplegreactie");
  const variableAreaInput = { ...steppedInput,
    beams: [{ ...steppedInput.beams[0], segmenten: [
      { tStart: 0, tEnd: 0.5, I: stepI, A: 1000 },
      { tStart: 0.5, tEnd: 1, I: stepI, A: 2000 },
    ] }],
    loads: [], pointLoads: [{ nodeId: 2, caseId: 1, fx: 100_000 }],
  };
  const variableArea = (await solveAllCasesNativeFrame2D(variableAreaInput)).get(1);
  const variableOld = solveAllCases(variableAreaInput).perCase.get(1);
  const handExtension = 100_000 * 3000 / (stepE * 1000)
    + 100_000 * 3000 / (stepE * 2000);
  close(variableArea.displacements.get(2).ux, handExtension, 1e-8,
    "verlopende A: analytische rekverlenging");
  close(variableArea.displacements.get(2).ux, variableOld.displacements.get(2).ux, 1e-6,
    "verlopende A: bestaande solver");
  assert.deepEqual(variableArea.elements.get(1).segmenten.map(segment => segment.A), [1000, 2000]);
  const segmentedFnlInput = { ...variableAreaInput,
    beams: [{ ...variableAreaInput.beams[0], segmenten: [
      { tStart: 0, tEnd: 0.5, I: stepI, A: 2000 },
      { tStart: 0.5, tEnd: 1, I: stepI, A: 1000 },
    ], axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 100, hardeningRatio: 0.1 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 150_000 }],
    axialMaterialLoadPath: [1],
  };
  const segmentedFnl = (await solveAllCombinationsNativeFrame2D(segmentedFnlInput,
    [{ id: 95, name: "gesegmenteerd staal", factors: new Map([[1, 1]]) }], "material")).get(95);
  const handPlasticExtension = 3000 * (75 / stepE)
    + 3000 * (100 / stepE + 50 / (0.1 * stepE));
  close(segmentedFnl.displacements.get(2).ux, handPlasticExtension, 1e-5,
    "gesegmenteerde staal-FNL: analytische verlenging");
  assert.ok(segmentedFnl.elements.get(1).axialHistory.equivalentPlasticStrain > 0,
    "staafhistorie kiest het geplastificeerde segment");
  const steppedColumnInput = { ...steppedInput,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 0, z: 3000 }],
    beams: [{ id: 1, from: 1, to: 2, E: stepE, A: 3877, I: stepI,
      segmenten: Array.from({ length: 4 }, (_, i) => ({
        tStart: i / 4, tEnd: (i + 1) / 4, I: stepI })) }],
    supports: [{ nodeId: 1, type: "fixed" }], loads: [],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 2000, fz: -100_000 }],
  };
  const steppedColumnCombination = { id: 94, name: "traptrede P-Delta", factors: new Map([[1, 1]]) };
  const steppedColumn = (await solveAllCombinationsNativeFrame2D(steppedColumnInput,
    [steppedColumnCombination], "geometric")).get(94);
  const steppedColumnOld = solveCombinationSecondOrder(steppedColumnInput, steppedColumnCombination);
  close(steppedColumn.displacements.get(2).ux, steppedColumnOld.displacements.get(2).ux, 1e-3,
    "gesegmenteerde kolom: P-Delta-uitwijking tegen bestaande solver");
  assert.equal(steppedColumn.elements.get(1).segmenten.length, 4);
  const cutsInput = { ...steppedInput,
    beams: [{ id: 1, from: 1, to: 2, E: stepE, A: 3877, I: stepI,
      extraSneden: [0.25, 0.75] }],
  };
  const cutsNative = (await solveAllCasesNativeFrame2D(cutsInput)).get(1);
  const cutsOld = solveAllCases(cutsInput).perCase.get(1);
  assert.equal(cutsNative.elements.get(1).segmenten, undefined);
  assert.equal(cutsNative.elements.get(1).stations_mm.filter(x => Math.abs(x - 1500) < 1e-6).length, 2);
  assert.equal(cutsNative.elements.get(1).stations_mm.filter(x => Math.abs(x - 4500) < 1e-6).length, 2);
  close(cutsNative.reactions.get(1).fz, cutsOld.reactions.get(1).fz, 1e-5,
    "extra sneden houden oplegreactie gelijk");
  assert.throws(() => buildNativeFrame2DRequest({ ...steppedInput,
    beams: [{ ...steppedInput.beams[0], segmenten: [
      { tStart: 0, tEnd: 0.4, I: stepI }, { tStart: 0.6, tEnd: 1, I: stepI },
    ] }] }, () => 1), /aaneensluiten/);
  assert.equal(buildNativeFrame2DRequest({ ...steppedInput,
    beams: [{ ...steppedInput.beams[0], segmenten: [
      { tStart: 0, tEnd: 0.5, I: stepI },
      { tStart: 0.5, tEnd: 0.5 + 10 / stepL, I: 2 * stepI },
      { tStart: 0.5 + 10 / stepL, tEnd: 1, I: stepI },
    ] }] }, () => 1).members.length, 3,
  "twee nabije opgegeven segmentgrenzen blijven behouden");
  const swayInput = { ...input,
    supports: [{ nodeId: 1, type: "fixed" }], loads: [],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -100_000 }],
    cases: [{ id: 1, name: "kolomlast" }],
    scheefstand: { phi: 0.005, richting: 1 },
  };
  const swayRequest = buildNativeFrame2DRequest(swayInput, () => 1);
  close(swayRequest.nodalLoads[0].fx, 0.5, 1e-12,
    "scheefstand H = φV als horizontale knooplast");
  const nativeSwayCases = await solveAllCasesNativeFrame2D(swayInput);
  const oldSwayCases = solveAllCases(swayInput).perCase;
  assert.deepEqual(getScheefstandRichtingen(nativeSwayCases),
    { primair: 1, offset: SCHEEFSTAND_ID_OFFSET });
  for (const caseId of [1, 1 + SCHEEFSTAND_ID_OFFSET]) {
    const current = nativeSwayCases.get(caseId), previous = oldSwayCases.get(caseId);
    close(current.displacements.get(2).ux, previous.displacements.get(2).ux, 1e-6,
      `scheefstand geval ${caseId} horizontale uitwijking`);
    close(current.reactions.get(1).fx, previous.reactions.get(1).fx, 1e-5,
      `scheefstand geval ${caseId} horizontale reactie`);
  }
  const swayLineInput = { ...input,
    loads: [{ beamId: 1, caseId: 1, q: -10, qDir: "z" }], pointLoads: [],
    cases: [{ id: 1, name: "lijnlast met scheefstand" }],
    scheefstand: { phi: 0.005, richting: 1 },
  };
  const nativeSwayLine = await solveAllCasesNativeFrame2D(swayLineInput);
  const oldSwayLine = solveAllCases(swayLineInput).perCase;
  for (const caseId of [1, 1 + SCHEEFSTAND_ID_OFFSET]) {
    close(nativeSwayLine.get(caseId).reactions.get(1).fx,
      oldSwayLine.get(caseId).reactions.get(1).fx, 1e-4,
      `scheefstand lijnlast geval ${caseId} horizontale reactie`);
    close(nativeSwayLine.get(caseId).elements.get(1).bendingMoment[10],
      oldSwayLine.get(caseId).elements.get(1).bendingMoment[10], 1e-3,
      `scheefstand lijnlast geval ${caseId} veldmoment`);
  }
  const swayCombos = [
    { id: 90, name: "scheefstand +x", factors: new Map([[1, 1]]), scheefstandRichting: 1 },
    { id: 91, name: "scheefstand -x", factors: new Map([[1, 1]]), scheefstandRichting: -1 },
  ];
  close(combineResults(swayCombos[1], nativeSwayCases).displacements.get(2).ux,
    combineResults(swayCombos[1], oldSwayCases).displacements.get(2).ux, 1e-6,
    "lineaire scheefstandcombinatie leest tegengestelde gevalset");
  const nativeSwayCombos = await solveAllCombinationsNativeFrame2D(swayInput, swayCombos, "geometric");
  for (const combo of swayCombos) {
    const previous = solveCombinationSecondOrder(swayInput, combo);
    close(nativeSwayCombos.get(combo.id).displacements.get(2).ux,
      previous.displacements.get(2).ux, 1e-5,
      `P-Delta scheefstand ${combo.scheefstandRichting} uitwijking`);
  }
  const steelFnlInput = { ...thermalInput,
    beams: [{ ...thermalInput.beams[0], axialMaterialLaw: {
      kind: "steelBilinear", yieldMpa: 100, hardeningRatio: 0.5 } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "fixed" }],
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: 100, alpha: 1e-5 }],
    axialMaterialLoadPath: [1, 0],
  };
  const steelRequest = buildNativeFrame2DRequest(steelFnlInput, () => 1, "material");
  assert.deepEqual(steelRequest.loadPath, [1, 0]);
  assert.deepEqual(steelRequest.materials[0].law,
    { kind: "steelBilinear", yield_mpa: 100, hardening_ratio: 0.5 });
  assert.throws(() => buildNativeFrame2DRequest({ ...steelFnlInput,
    axialMaterialLoadPath: [1, Number.NaN] }, () => 1, "material"), /lastpad/);
  assert.throws(() => buildNativeFrame2DRequest({ ...steelFnlInput,
    beams: [{ ...steelFnlInput.beams[0], axialMaterialLaw: undefined }] }, () => 1, "material"),
  /minstens één staaf/);
  assert.throws(() => buildNativeFrame2DRequest({ ...steelFnlInput,
    beams: [{ ...steelFnlInput.beams[0], axialMaterialLaw: {
      kind: "steelBilinear", yieldMpa: 100, hardeningRatio: 1.2 } }] }, () => 1, "material"),
  /ongeldige axiale FNL/);
  const steelFnl = (await solveAllCombinationsNativeFrame2D(steelFnlInput,
    [{ id: 99, name: "staal afkoelen", factors: new Map([[1, 1]]) }], "material")).get(99);
  close(steelFnl.reactions.get(1).fx, -550_000, 1e-3, "axiale staal-FNL-restreactie via app-route");
  close(steelFnl.elements.get(1).axialHistory.plasticStrain, -0.0002619047619047619, 1e-12,
    "axiale staal-FNL-plastische rek via app-route");
  assert.ok(steelFnl.elements.get(1).sectionHistory.maximumEquivalentPlasticStrain > 0,
    "vezelgeschiedenis van de doorsnede bereikt de FEM Studio-resultaten");
  assert.deepEqual(spiegelElementKrachten(steelFnl.elements.get(1)).axialHistory,
    steelFnl.elements.get(1).axialHistory,
    "axiale materiaalgeschiedenis blijft gelijk als de staafrichting omkeert");
  assert.deepEqual(spiegelElementKrachten(steelFnl.elements.get(1)).sectionHistory,
    steelFnl.elements.get(1).sectionHistory,
    "doorsnedegeschiedenis blijft gelijk als de staafrichting omkeert");
  const fromProject = bouwMultiInput({
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, material: "S235", profile: "HEA160",
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 100, hardeningRatio: 0.5 } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "fixed" }],
    plates: [],
    loads: [{ id: 1, type: "thermal", beamId: 1, caseId: 1, deltaT: 100 }],
    loadCases: [{ id: 1, name: "opwarming", type: "dead" }],
    selfWeightEnabled: false, scheefstandEnabled: false, scheefstandNoemer: 200,
    scheefstandRichting: 1, axialMaterialLoadPath: [1, 0],
  });
  assert.deepEqual(fromProject.beams[0].axialMaterialLaw,
    { kind: "steelBilinear", yieldMpa: 100, hardeningRatio: 0.5 });
  assert.deepEqual(fromProject.axialMaterialLoadPath, [1, 0]);
  const projectFnl = (await solveAllCombinationsNativeFrame2D(fromProject,
    [{ id: 102, name: "projectstaal", factors: new Map([[1, 1]]) }], "combined")).get(102);
  close(projectFnl.reactions.get(1).fx, -76 * fromProject.beams[0].A, 1e-3,
    "projectmodel door 2D Rust-FNL-route");
  const concreteFnlInput = { ...steelFnlInput,
    beams: [{ ...steelFnlInput.beams[0], E: 33_000,
      axialMaterialLaw: { kind: "concreteCracking", tensileMpa: 3, residualRatio: 0.2 } }],
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: -30, alpha: 1e-5 }],
    axialMaterialLoadPath: [1, 0, 0.5],
  };
  const concreteFnl = (await solveAllCombinationsNativeFrame2D(concreteFnlInput,
    [{ id: 100, name: "beton herbelasten", factors: new Map([[1, 1]]) }], "combined")).get(100);
  close(concreteFnl.reactions.get(1).fx, -21_900, 1e-3,
    "axiale beton-FNL-reactie via app-route");
  close(concreteFnl.elements.get(1).axialHistory.tensileDamage, 1 - 4.38 / 9.9, 1e-10,
    "axiale beton-FNL-schade via app-route");
  const axialDistributedFnlInput = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 1.673e7,
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }],
    supports: [{ nodeId: 1, type: "fixed" }],
    cases: [{ id: 1, name: "axiale verdeelde FNL-last" }], pointLoads: [],
    loads: [{ beamId: 1, caseId: 1, q: 700, qDir: "x", qCoord: "local" }],
  };
  const axialDistributedRequest = buildNativeFrame2DRequest(axialDistributedFnlInput,
    () => 1, "material");
  assert.equal(axialDistributedRequest.members.length, 40,
    "axiale verdeelde FNL-last krijgt een verfijnd mesh van 0,1 m");
  assert.ok(axialDistributedRequest.memberLoads.every(load =>
    load.qxStartKnPerM === 700 && load.qxEndKnPerM === 700));
  const axialDistributedFnl = (await solveAllCombinationsNativeFrame2D(axialDistributedFnlInput,
    [{ id: 101, name: "axiale verdeelde FNL-last", factors: new Map([[1, 1]]) }],
    "material")).get(101);
  const maxStressMpa = 700 * 4 / (1000 * 0.01);
  const yieldLengthM = 4 * (1 - 250 / maxStressMpa);
  const expectedDistributedExtensionM = 250 / 210_000 * yieldLengthM
    + ((maxStressMpa - 250) * yieldLengthM
      - maxStressMpa * yieldLengthM ** 2 / (2 * 4)) / (0.02 * 210_000)
    + 250 * (4 - yieldLengthM) / (2 * 210_000);
  close(axialDistributedFnl.elements.get(1).axialDisp.at(-1),
    expectedDistributedExtensionM * 1000, 0.02,
    "axiale FNL-lijnlast tipverlenging uit de analytische bilineaire rekintegraal");
  close(axialDistributedFnl.reactions.get(1).fx, -2_800_000, 1e-3,
    "axiale FNL-lijnlast globale evenwichtsreactie");
  const axialPointFnl = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 1.673e7,
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "fixed" }],
    cases: [{ id: 1, name: "axiale puntlast" }], loads: [], pointLoads: [],
    beamPointLoads: [{ beamId: 1, caseId: 1, posFrac: 0.5, fx: 6_000_000 }],
  };
  const axialPointRequest = buildNativeFrame2DRequest(axialPointFnl, () => 1, "material");
  assert.equal(axialPointRequest.nodes.length, 2,
    "de app-adapter laat het interne puntlaststation aan de Rust-kern");
  assert.equal(axialPointRequest.members.length, 1,
    "de app-adapter stuurt de ongesplitste materiaalstaaf naar Rust");
  assert.deepEqual(axialPointRequest.memberPointLoads, [{
    memberId: 1, positionM: 2, pxKn: 6000, pyKn: 0,
  }], "de axiale puntlast blijft een staaflast in de Rust-aanvraag");
  const axialPointResult = (await solveAllCombinationsNativeFrame2D(axialPointFnl,
    [{ id: 103, name: "axiale puntlast plastisch", factors: new Map([[1, 1]]) }],
    "material")).get(103);
  const axialPointForces = axialPointResult.elements.get(1).normalForce;
  const axialPointStations = axialPointResult.elements.get(1).stations_mm;
  const atLoad = axialPointStations.flatMap((x, index) =>
    Math.abs(x - 2000) < 1e-8 ? [index] : []);
  assert.equal(atLoad.length, 2,
    "de Rust-kern bewaart beide zijden van de normaalkrachtsprong in het samengevoegde diagram");
  close(Math.abs(axialPointForces[0]), 3_000_000, 1e-3, "axiale FNL-puntlast linker staafdeel");
  close(Math.abs(axialPointForces.at(-1)), 3_000_000, 1e-3, "axiale FNL-puntlast rechter staafdeel");
  close(Math.abs(axialPointForces[atLoad[0]]), 3_000_000, 1e-3,
    "axiale FNL-puntlast normalkracht links van de interne knoop");
  close(Math.abs(axialPointForces[atLoad[1]]), 3_000_000, 1e-3,
    "axiale FNL-puntlast normalkracht rechts van de interne knoop");
  const expectedAxialPointStrain = 250 / 210_000 + 50 / (0.02 * 210_000);
  for (const index of atLoad) {
    close(axialPointResult.elements.get(1).axialDisp[index], 2000 * expectedAxialPointStrain,
      1e-6, "axiale FNL-puntlast verlenging uit gesloten bilineaire wet");
  }
  assert.ok(axialPointForces[0] * axialPointForces.at(-1) < 0,
    "de puntlast veroorzaakt de juiste normaalkrachtsprong");
  assert.ok(axialPointResult.elements.get(1).axialHistory.equivalentPlasticStrain > 0,
    "de materiaalgeschiedenis bewaart plastificatie van de gesplitste staafdelen");
  close(axialPointResult.reactions.get(1).fx + axialPointResult.reactions.get(2).fx,
    -6_000_000, 1e-3, "axiale FNL-puntlast reactiekrachtevenwicht");
  const axialPointOnOff = await solveAllCombinationsNativeFrame2D(axialPointFnl, [
    { id: 104, name: "axiale puntlast actief", factors: new Map([[1, 1]]) },
    { id: 105, name: "axiale puntlast nul", factors: new Map([[1, 0]]) },
  ], "material");
  const zeroFactorAxialPointRequest = buildNativeFrame2DRequest(axialPointFnl,
    () => 0, "material");
  assert.equal(zeroFactorAxialPointRequest.memberPointLoads.length, 1,
    "een puntlast met factor nul blijft in de Rust-aanvraag staan voor rasterconsistentie");
  assert.deepEqual(axialPointOnOff.get(105).elements.get(1).stations_mm,
    axialPointOnOff.get(104).elements.get(1).stations_mm,
    "een puntlast met factor nul behoudt hetzelfde Rust-mesh voor combinatie-superpositie");
  assert.ok(axialPointOnOff.get(105).elements.get(1).normalForce.every(value => Math.abs(value) < 1e-6),
    "de combinatie met factor nul heeft geen normaalkracht");
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
  const internalMomentInput = { ...input, loads: [], pointLoads: [],
    beamPointLoads: [{ beamId: 1, caseId: 1, posFrac: 1 / 3, my: 2e6 }],
    cases: [{ id: 1, name: "inwendig puntmoment" }],
  };
  const internalMomentRequest = buildNativeFrame2DRequest(internalMomentInput, () => 1);
  assert.equal(internalMomentRequest.members.length, 2,
    "een inwendig puntmoment maakt een knoop op de aangrijpingsplaats");
  assert.deepEqual(internalMomentRequest.nodalLoads, [{ nodeId: 3, fx: 0, fy: 0, mz: 2 }]);
  assert.equal(internalMomentRequest.memberPointLoads.length, 0,
    "een puntmoment wordt als knoopmoment op de gesplitste staaf overgedragen");
  const internalMomentNative = (await solveAllCasesNativeFrame2D(internalMomentInput)).get(1);
  const internalMomentExisting = solveAllCases(internalMomentInput).perCase.get(1);
  for (const nodeId of [1, 2]) {
    close(internalMomentNative.reactions.get(nodeId).fz,
      internalMomentExisting.reactions.get(nodeId).fz, 1e-4,
      `inwendig puntmoment reactie ${nodeId}`);
    close(internalMomentNative.displacements.get(nodeId).uz,
      internalMomentExisting.displacements.get(nodeId).uz, 1e-6,
      `inwendig puntmoment verplaatsing ${nodeId}`);
  }
  close(internalMomentNative.reactions.get(1).fz, 1000 / 3, 1e-4,
    "gesloten steunreactie links voor een puntkoppel");
  close(internalMomentNative.reactions.get(2).fz, -1000 / 3, 1e-4,
    "gesloten steunreactie rechts voor een puntkoppel");
  const internalMomentResult = internalMomentNative.elements.get(1);
  const internalMomentReference = internalMomentExisting.elements.get(1);
  assert.deepEqual(internalMomentResult.stations_mm, internalMomentReference.stations_mm,
    "momentpunt levert hetzelfde dubbelstation als de bestaande solver");
  const momentPointIndices = internalMomentResult.stations_mm
    .map((x, index) => Math.abs(x - 2000) < 1e-6 ? index : -1).filter(index => index >= 0);
  assert.equal(momentPointIndices.length, 2);
  close(Math.abs(internalMomentResult.bendingMoment[momentPointIndices[1]]
    - internalMomentResult.bendingMoment[momentPointIndices[0]]), 2e6, 1e-3,
  "gesloten sprong van 2 kNm in het momentdiagram op het puntkoppel");
  for (let index = 0; index < internalMomentResult.stations_mm.length; index++) {
    close(internalMomentResult.bendingMoment[index], internalMomentReference.bendingMoment[index],
      1e-3, `inwendig puntmoment-diagram station ${index}`);
    close(internalMomentResult.deflection[index], internalMomentReference.deflection[index],
      1e-5, `inwendig puntmoment-vervorming station ${index}`);
  }
  const internalMomentFnlInput = { ...internalMomentInput,
    beams: [{ ...internalMomentInput.beams[0],
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.01 } }],
    axialMaterialLoadPath: [0, 1],
  };
  const internalMomentFnl = (await solveAllCombinationsNativeFrame2D(internalMomentFnlInput,
    [{ id: 12, name: "staal-FNL met inwendig puntmoment", factors: new Map([[1, 1]]) }],
    "material")).get(12);
  assert.ok(internalMomentFnl.elements.get(1).sectionHistory,
    "de interne momentknoop blijft onderdeel van de staal-FNL-mesh");
  close(internalMomentFnl.reactions.get(1).fz, 1000 / 3, 1e-4,
    "staal-FNL gesloten steunreactie voor een puntkoppel");
  const internalMomentFnlIndices = internalMomentFnl.elements.get(1).stations_mm
    .map((x, index) => Math.abs(x - 2000) < 1e-6 ? index : -1).filter(index => index >= 0);
  assert.equal(internalMomentFnlIndices.length, 2);
  close(Math.abs(internalMomentFnl.elements.get(1).bendingMoment[internalMomentFnlIndices[1]]
    - internalMomentFnl.elements.get(1).bendingMoment[internalMomentFnlIndices[0]]), 2e6, 1e-3,
  "staal-FNL behoudt de sprong van 2 kNm op het puntkoppel");
  const hingeInput = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6,
      endConnection: "hinge" }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "rotSpring", k: 0 }],
    loads: [], pointLoads: [{ nodeId: 2, caseId: 1, fz: -10_000 }],
    cases: [{ id: 1, name: "scharnier" }] };
  const hingeNative = (await solveAllCasesNativeFrame2D(hingeInput)).get(1);
  const hingeExisting = solveAllCases(hingeInput).perCase.get(1);
  close(hingeNative.displacements.get(2).uz, hingeExisting.displacements.get(2).uz,
    1e-6, "scharnierende uitkraging tipverplaatsing");
  close(hingeNative.reactions.get(1).my, hingeExisting.reactions.get(1).my,
    1e-3, "scharnierende uitkraging inklemmoment");
  close(hingeNative.elements.get(1).M_end, 0, 1e-5, "vrij scharnierend eindmoment");
  const hingeSecondInput = { ...hingeInput,
    pointLoads: [...hingeInput.pointLoads, { nodeId: 2, caseId: 2, fx: -100_000 }],
    cases: [...hingeInput.cases, { id: 2, name: "druk" }] };
  const hingeCombo = { id: 21, name: "scharnier met druk", type: "uls", formula: "G + Q",
    factors: new Map([[1, 1], [2, 1]]) };
  const hingeSecondNative = (await solveAllCombinationsNativeFrame2D(hingeSecondInput, [hingeCombo])).get(21);
  const hingeSecondExisting = solveCombinationSecondOrder(hingeSecondInput, hingeCombo);
  assert.ok(hingeSecondNative && hingeSecondExisting);
  close(hingeSecondNative.displacements.get(2).uz, hingeSecondExisting.displacements.get(2).uz,
    0.15, "scharnier P-Delta tipverplaatsing");
  close(hingeSecondNative.elements.get(1).M_end, 0, 1e-5,
    "scharnier P-Delta eindmoment");
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
  const releaseBase = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }, { id: 3, x: 6000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 3877, I: 1.673e7 },
      { id: 2, from: 2, to: 3, E: 210_000, A: 3877, I: 1.673e7 }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 3, type: "fixed" }],
    cases: [{ id: 1, name: "vrijgave" }], loads: [], pointLoads: [],
  };
  const fiberReleased = {
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 3000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 10_000, I: 8e6,
      releases: { endRy: true },
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.01 } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "rotSpring", k: 0 }],
    cases: [{ id: 1, name: "staal-FNL met momentvrijgave" }], loads: [],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -20_000 }],
  };
  const fiberReleasedLinear = solveAllCases(fiberReleased).perCase.get(1);
  const fiberReleasedNative = (await solveAllCombinationsNativeFrame2D(fiberReleased,
    [{ id: 55, name: "staal-FNL met momentvrijgave", factors: new Map([[1, 1]]) }],
    "material")).get(55);
  assert.ok(fiberReleasedLinear && fiberReleasedNative);
  assert.ok(Math.abs(fiberReleasedNative.displacements.get(2).uz)
    > Math.abs(fiberReleasedLinear.displacements.get(2).uz) * 1.01,
  "staal-FNL verhoogt de vervorming bij een geroteerd vrijgegeven staafeinde");
  close(fiberReleasedNative.elements.get(1).M_end, 0, 1e-5,
    "staal-FNL houdt het moment aan de vrijgegeven zijde nul");
  const concreteReleased = { ...fiberReleased,
    beams: [{ ...fiberReleased.beams[0],
      axialMaterialLaw: { kind: "concreteCracking", tensileMpa: 3, residualRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -1000 }],
  };
  const concreteReleasedResult = (await solveAllCombinationsNativeFrame2D(concreteReleased,
    [{ id: 56, name: "beton-FNL met momentvrijgave", factors: new Map([[1, 1]]) }],
    "material")).get(56);
  assert.ok(concreteReleasedResult.elements.get(1).sectionHistory.maximumTensileDamage > 0,
    "betonschade blijft actief bij een rotatievrijgave");
  close(concreteReleasedResult.elements.get(1).M_end, 0, 1e-5,
    "beton-FNL houdt het moment aan de vrijgegeven zijde nul");
  const { releases: _releasedEnds, ...rigidFiberBeam } = fiberReleased.beams[0];
  const fiberSpring = { ...fiberReleased,
    beams: [{ ...rigidFiberBeam, veren: { startRy: 3_500_000_000 } }],
    supports: [{ nodeId: 1, type: "fixed" }],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -20_000 }],
  };
  const fiberSpringLinear = solveAllCases(fiberSpring).perCase.get(1);
  const fiberSpringNative = (await solveAllCombinationsNativeFrame2D(fiberSpring,
    [{ id: 57, name: "staal-FNL met momentveer", factors: new Map([[1, 1]]) }],
    "material")).get(57);
  assert.ok(fiberSpringLinear && fiberSpringNative);
  assert.ok(Math.abs(fiberSpringNative.displacements.get(2).uz)
    > Math.abs(fiberSpringLinear.displacements.get(2).uz) * 1.01,
  `staal-FNL verhoogt de vervorming met een rotatieveereind (${fiberSpringNative.displacements.get(2).uz} vs ${fiberSpringLinear.displacements.get(2).uz})`);
  assert.ok(fiberSpringNative.elements.get(1).sectionHistory.maximumEquivalentPlasticStrain > 0,
    "staalplastificatie blijft actief met een rotatieveer");
  close(fiberSpringNative.elements.get(1).M_start, -60_000_000, 1e-3,
    "staafmoment wordt door de rotatieveer naar de knoop overgedragen");
  const fiberTransverseSpring = { ...fiberSpring,
    beams: [{ ...fiberSpring.beams[0], veren: { endTz: 25_000 } }] };
  const fiberTransverseSpringLinear = solveAllCases(fiberTransverseSpring).perCase.get(1);
  const fiberTransverseSpringNative = (await solveAllCombinationsNativeFrame2D(fiberTransverseSpring,
    [{ id: 59, name: "staal-FNL met dwarsveer", factors: new Map([[1, 1]]) }],
    "material")).get(59);
  assert.ok(fiberTransverseSpringLinear && fiberTransverseSpringNative);
  assert.ok(Math.abs(fiberTransverseSpringNative.displacements.get(2).uz)
    > Math.abs(fiberTransverseSpringLinear.displacements.get(2).uz) * 1.01,
  "staal-FNL vergroot de doorbuiging met een dwarse eindveer");
  assert.ok(fiberTransverseSpringNative.elements.get(1).sectionHistory.maximumEquivalentPlasticStrain > 0,
    "staalplastificatie blijft actief met een dwarse eindveer");
  close(fiberTransverseSpringNative.elements.get(1).M_end, 0, 1e-3,
    "dwarse eindveer draagt geen eindmoment over");
  const concreteTransverseSpring = { ...fiberTransverseSpring,
    beams: [{ ...fiberTransverseSpring.beams[0], axialMaterialLaw: {
      kind: "concreteCracking", tensileMpa: 3, residualRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -1000 }],
  };
  const concreteTransverseSpringNative = (await solveAllCombinationsNativeFrame2D(concreteTransverseSpring,
    [{ id: 60, name: "beton-FNL met dwarsveer", factors: new Map([[1, 1]]) }],
    "material")).get(60);
  assert.ok(concreteTransverseSpringNative.elements.get(1).sectionHistory.maximumTensileDamage > 0,
    "betonscheurvorming blijft actief met een dwarse eindveer");
  close(concreteTransverseSpringNative.elements.get(1).M_end, 0, 1e-3,
    "beton-FNL met dwarse eindveer houdt het eindmoment nul");
  const fiberTransverseRelease = { ...fiberReleased,
    beams: [{ ...fiberReleased.beams[0], releases: { endTz: true } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "zRoller" }],
    pointLoads: [{ nodeId: 2, caseId: 1, my: 60_000_000 }],
  };
  const fiberTransverseReleaseNative = (await solveAllCombinationsNativeFrame2D(fiberTransverseRelease,
    [{ id: 61, name: "staal-FNL met dwarsvrijgave", factors: new Map([[1, 1]]) }],
    "material")).get(61);
  assert.ok(fiberTransverseReleaseNative.elements.get(1).sectionHistory.maximumEquivalentPlasticStrain > 0,
    "staalplastificatie blijft actief bij een dwarsverplaatsingsvrijgave");
  close(fiberTransverseReleaseNative.elements.get(1).V, 0, 1e-3,
    "dwarsverplaatsingsvrijgave draagt geen dwarskracht over");
  close(fiberTransverseReleaseNative.elements.get(1).M_end, 60_000_000, 1e-3,
    "dwarsverplaatsingsvrijgave draagt het eindmoment over");
  const concreteTransverseRelease = { ...fiberTransverseRelease,
    beams: [{ ...fiberTransverseRelease.beams[0], axialMaterialLaw: {
      kind: "concreteCracking", tensileMpa: 3, residualRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, my: 2_000_000 }],
  };
  const concreteTransverseReleaseNative = (await solveAllCombinationsNativeFrame2D(concreteTransverseRelease,
    [{ id: 62, name: "beton-FNL met dwarsvrijgave", factors: new Map([[1, 1]]) }],
    "material")).get(62);
  assert.ok(concreteTransverseReleaseNative.elements.get(1).sectionHistory.maximumTensileDamage > 0,
    "betonscheurvorming blijft actief bij een dwarsverplaatsingsvrijgave");
  close(concreteTransverseReleaseNative.elements.get(1).V, 0, 1e-3,
    "betonnen dwarsvrijgave draagt geen dwarskracht over");
  close(concreteTransverseReleaseNative.elements.get(1).M_end, 2_000_000, 1e-3,
    "betonnen dwarsvrijgave draagt het eindmoment over");
  const concreteSpring = { ...fiberSpring,
    beams: [{ ...fiberSpring.beams[0], axialMaterialLaw: {
      kind: "concreteCracking", tensileMpa: 3, residualRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -1000 }],
  };
  const concreteSpringNative = (await solveAllCombinationsNativeFrame2D(concreteSpring,
    [{ id: 58, name: "beton-FNL met momentveer", factors: new Map([[1, 1]]) }],
    "material")).get(58);
  assert.ok(concreteSpringNative.elements.get(1).sectionHistory.maximumTensileDamage > 0,
    "betonschade blijft actief met een rotatieveer");
  close(concreteSpringNative.elements.get(1).M_start, -3_000_000, 1e-3,
    "beton-FNL moment wordt door de rotatieveer naar de knoop overgedragen");
  for (const [release, pointLoad] of [
    ["startTx", { fx: 10_000 }], ["startTz", { fz: -10_000 }],
  ]) {
    const example = { ...releaseBase,
      beams: [releaseBase.beams[0], { ...releaseBase.beams[1], releases: { [release]: true } }],
      pointLoads: [{ nodeId: 2, caseId: 1, ...pointLoad }],
    };
    const own = (await solveAllCasesNativeFrame2D(example)).get(1);
    const reference = solveAllCases(example).perCase.get(1);
    for (const nodeId of [1, 3]) {
      close(own.reactions.get(nodeId).fx, reference.reactions.get(nodeId).fx, 1e-5,
        `${release} reactie ${nodeId} fx`);
      close(own.reactions.get(nodeId).fz, reference.reactions.get(nodeId).fz, 1e-5,
        `${release} reactie ${nodeId} fz`);
    }
    close(own.elements.get(2).N, reference.elements.get(2).N, 1e-5, `${release} normaalkracht`);
    close(own.elements.get(2).V, reference.elements.get(2).V, 1e-5, `${release} dwarskracht`);
  }
  const releasedLine = { ...releaseBase,
    beams: [releaseBase.beams[0], { ...releaseBase.beams[1], releases: { startTz: true } }],
    loads: [{ beamId: 1, caseId: 1, q: -10 }, { beamId: 2, caseId: 1, q: -10 }],
  };
  const lineOwn = (await solveAllCasesNativeFrame2D(releasedLine)).get(1);
  const lineReference = solveAllCases(releasedLine).perCase.get(1);
  for (const nodeId of [1, 3]) {
    close(lineOwn.reactions.get(nodeId).fz, lineReference.reactions.get(nodeId).fz, 1e-4,
      `dwarskrachthuls met lijnlast reactie ${nodeId}`);
  }
  close(lineOwn.elements.get(2).shearForce[0], 0, 1e-6,
    "dwarskrachthuls met lijnlast nul dwarskracht aan het begin");
  const doubleAxial = { ...releaseBase,
    beams: [releaseBase.beams[0], { ...releaseBase.beams[1],
      releases: { startTx: true, endTx: true } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 10_000 }],
  };
  const doubleResult = (await solveAllCasesNativeFrame2D(doubleAxial)).get(1);
  close(doubleResult.elements.get(2).N, 0, 1e-6, "dubbele axiale vrijgave N");
  await assert.rejects(() => solveAllCasesNativeFrame2D({ ...doubleAxial,
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 3, type: "zRoller" }],
  }), /stiffness|singular|mechanism/i);
  const thermalRelease = { ...releaseBase,
    nodes: [releaseBase.nodes[0], releaseBase.nodes[2]],
    beams: [{ ...releaseBase.beams[0], to: 3, releases: { startTx: true } }],
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: 30, alpha: 12e-6 }],
  };
  const thermalOwn = (await solveAllCasesNativeFrame2D(thermalRelease)).get(1);
  close(thermalOwn.elements.get(1).N, 0, 1e-6, "thermische huls N");
  close(thermalOwn.elements.get(1).axialDisp[0], -2.16, 1e-8,
    "thermische huls vrije uitzetting in mm");
  const springBase = { nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 4000, z: 0 }],
    beams: [{ id: 1, from: 1, to: 2, E: 210_000, A: 3877, I: 1.673e7 }],
    supports: [{ nodeId: 1, type: "fixed" }], cases: [{ id: 1, name: "veer" }],
    loads: [], pointLoads: [] };
  const momentSpring = { ...springBase,
    beams: [{ ...springBase.beams[0], veren: { startRy: 3.5e9 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fz: -10_000 }] };
  const momentOwn = (await solveAllCasesNativeFrame2D(momentSpring)).get(1);
  const momentReference = solveAllCases(momentSpring).perCase.get(1);
  close(momentOwn.displacements.get(2).uz, momentReference.displacements.get(2).uz, 1e-6,
    "momentveer console tipverplaatsing");
  close(momentOwn.reactions.get(1).my, momentReference.reactions.get(1).my, 1e-4,
    "momentveer console inklemmoment");
  const springSecond = { ...momentSpring,
    cases: [...momentSpring.cases, { id: 2, name: "druk" }],
    pointLoads: [...momentSpring.pointLoads, { nodeId: 2, caseId: 2, fx: -50_000 }] };
  const springCombo = { id: 51, name: "momentveer met druk", type: "uls", formula: "G + Q",
    factors: new Map([[1, 1], [2, 1]]) };
  const springSecondOwn = (await solveAllCombinationsNativeFrame2D(springSecond, [springCombo])).get(51);
  const springSecondReference = solveCombinationSecondOrder(springSecond, springCombo);
  close(springSecondOwn.displacements.get(2).uz, springSecondReference.displacements.get(2).uz,
    0.1, "momentveer P-Delta tipverplaatsing");
  const plasticSpring = { ...momentSpring,
    beams: [{ ...momentSpring.beams[0], axialMaterialLaw: {
      kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 1_200_000, fz: -10_000 }] };
  const plasticSpringCombo = { id: 52, name: "plastische staaf met momentveer",
    factors: new Map([[1, 1]]) };
  const plasticSpringResult = (await solveAllCombinationsNativeFrame2D(
    plasticSpring, [plasticSpringCombo], "material")).get(52);
  const stress = 1_200_000 / 3877;
  const plasticStrain = 250 / 210_000 + (stress - 250) / (0.02 * 210_000);
  assert.ok(plasticSpringResult.displacements.get(2).ux > 4000 * plasticStrain,
    "gekoppelde N-M-plastificatie beïnvloedt de staafverlenging bij een momentveer");
  close(plasticSpringResult.elements.get(1).N, 1_200_000, 1e-3,
    "staal-FNL met momentveer normaalkracht");
  assert.ok(plasticSpringResult.elements.get(1).sectionHistory.maximumEquivalentPlasticStrain > 0,
    "staalplastificatie blijft actief met axiaal- en buigbelasting bij een momentveer");
  assert.ok(Math.abs(plasticSpringResult.displacements.get(2).uz)
    > Math.abs(momentOwn.displacements.get(2).uz),
  "buigplastificatie vergroot de dwarsverplaatsing bij een momentveer");
  const axialSpring = { ...springBase,
    beams: [{ ...springBase.beams[0], veren: { startTx: 200_000 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 50_000 }] };
  const axialOwn = (await solveAllCasesNativeFrame2D(axialSpring)).get(1);
  const axialReference = solveAllCases(axialSpring).perCase.get(1);
  close(axialOwn.displacements.get(2).ux, axialReference.displacements.get(2).ux, 1e-6,
    "axiale eindveer verlenging");
  close(axialOwn.elements.get(1).N, 50_000, 1e-5, "axiale eindveer normaalkracht");
  const axialSpringFnl = { ...springBase,
    beams: [{ ...springBase.beams[0], veren: { startTx: 200_000 },
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 1_200_000 }] };
  const axialSpringFnlResult = (await solveAllCombinationsNativeFrame2D(axialSpringFnl,
    [{ id: 53, name: "axiale FNL-veer", factors: new Map([[1, 1]]) }], "material")).get(53);
  const fnlStress = 1_200_000 / 3877;
  const fnlStrain = 250 / 210_000 + (fnlStress - 250) / (0.02 * 210_000);
  // This direct nonlinear route is checked against the material law and the
  // spring's independent series extension.
  close(axialSpringFnlResult.displacements.get(2).ux,
    4000 * fnlStrain + 1_200_000 / 200_000, 0.01, "axiale staal-FNL-veerverlenging");
  close(axialSpringFnlResult.elements.get(1).N, 1_200_000, 1e-3,
    "axiale staal-FNL-veerkracht");
  const coupledAxialSpringFnl = { ...springBase,
    beams: [{ ...springBase.beams[0], veren: { startTx: 200_000 },
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 1_200_000, my: 60_000_000 }] };
  const coupledAxialSpringFnlResult = (await solveAllCombinationsNativeFrame2D(
    coupledAxialSpringFnl,
    [{ id: 55, name: "gekoppelde N-M staal-FNL met axiale veer", factors: new Map([[1, 1]]) }],
    "material")).get(55);
  close(coupledAxialSpringFnlResult.elements.get(1).N, 1_200_000, 1e-3,
    "gekoppelde staal-FNL met axiale veer normaalkracht");
  close(coupledAxialSpringFnlResult.elements.get(1).M_end, 60_000_000, 1e-2,
    "gekoppelde staal-FNL met axiale veer eindmoment");
  assert.ok(coupledAxialSpringFnlResult.elements.get(1).sectionHistory.maximumEquivalentPlasticStrain > 0,
    "N-M-vezelplastificatie blijft actief met een axiale eindveer");
  assert.ok(Number.isFinite(coupledAxialSpringFnlResult.displacements.get(2).ux)
    && Number.isFinite(coupledAxialSpringFnlResult.displacements.get(2).uz),
  "gekoppelde staal-FNL met axiale veer geeft eindige verplaatsingen");
  const coupledConcreteSpringFnl = { ...springBase,
    beams: [{ ...springBase.beams[0], veren: { startTx: 200_000 },
      axialMaterialLaw: { kind: "concreteCracking", tensileMpa: 3, residualRatio: 0.02 } }],
    pointLoads: [{ nodeId: 2, caseId: 1, fx: 10_000, my: 500_000 }] };
  const coupledConcreteSpringFnlResult = (await solveAllCombinationsNativeFrame2D(
    coupledConcreteSpringFnl,
    [{ id: 56, name: "gekoppelde beton-FNL met axiale veer", factors: new Map([[1, 1]]) }],
    "material")).get(56);
  close(coupledConcreteSpringFnlResult.elements.get(1).N, 10_000, 1e-2,
    "gekoppelde beton-FNL met axiale veer normaalkracht");
  close(coupledConcreteSpringFnlResult.elements.get(1).M_end, 500_000, 1e-2,
    "gekoppelde beton-FNL met axiale veer eindmoment");
  assert.ok(coupledConcreteSpringFnlResult.elements.get(1).sectionHistory.maximumTensileDamage > 0,
    "N-M-betonscheurvorming blijft actief met een axiale eindveer");
  const variableModulusFrame = { ...springBase,
    nodes: [{ id: 1, x: 0, z: 0 }, { id: 2, x: 2000, z: 0 }, { id: 3, x: 4000, z: 0 }],
    beams: [
      { ...springBase.beams[0], id: 1, from: 1, to: 2, E: 210_000,
        axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.01 } },
      { ...springBase.beams[0], id: 2, from: 2, to: 3, E: 170_000,
        axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.01 } },
    ],
    pointLoads: [{ nodeId: 3, caseId: 1, my: 60_000_000 }] };
  const variableModulusResult = (await solveAllCombinationsNativeFrame2D(variableModulusFrame,
    [{ id: 57, name: "staal-FNL met variabele E", factors: new Map([[1, 1]]) }],
    "material")).get(57);
  for (const memberId of [1, 2]) {
    const element = variableModulusResult.elements.get(memberId);
    assert.ok(element.sectionHistory.maximumEquivalentPlasticStrain > 0,
      `per-staaf E-FNL bewaart plastische sectietoestand voor element ${memberId}`);
    close(element.M_end, 60_000_000, 1e-2,
      `variabele E staal-FNL momentoverdracht element ${memberId}`);
  }
  assert.ok(Number.isFinite(variableModulusResult.displacements.get(3).uz),
    "meerdere staal-FNL-staven met verschillende E geven een eindige tipverplaatsing");
  const thermalFnlRelease = { ...springBase,
    beams: [{ ...springBase.beams[0], releases: { startTx: true },
      axialMaterialLaw: { kind: "steelBilinear", yieldMpa: 250, hardeningRatio: 0.02 } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "fixed" }],
    thermalLoads: [{ beamId: 1, caseId: 1, deltaT: 30, alpha: 12e-6 }],
  };
  const thermalFnlReleaseResult = (await solveAllCombinationsNativeFrame2D(thermalFnlRelease,
    [{ id: 54, name: "vrije thermische uitzetting", factors: new Map([[1, 1]]) }],
    "material")).get(54);
  close(thermalFnlReleaseResult.elements.get(1).N, 0, 1e-6,
    "axiale vrijgave met FNL thermiek normaalkracht");
  close(thermalFnlReleaseResult.elements.get(1).axialDisp[0], -1.44, 1e-8,
    "axiale vrijgave met FNL vrije thermische uitzetting in mm");
  const distributedSpring = { ...springBase,
    beams: [{ ...springBase.beams[0], veren: { endRy: 4 * 210_000 * 1.673e7 / 4000 } }],
    supports: [{ nodeId: 1, type: "fixed" }, { nodeId: 2, type: "fixed" }],
    loads: [{ beamId: 1, caseId: 1, q: -10 }] };
  const distributedOwn = (await solveAllCasesNativeFrame2D(distributedSpring)).get(1);
  const distributedReference = solveAllCases(distributedSpring).perCase.get(1);
  close(distributedOwn.elements.get(1).M_start, distributedReference.elements.get(1).M_start,
    1e-3, "momentveer lijnlast startmoment");
  close(distributedOwn.elements.get(1).M_end, distributedReference.elements.get(1).M_end,
    1e-3, "momentveer lijnlast eindmoment");
  const endStateInput = { ...input,
    beams: [{ ...input.beams[0], E: 210_000, veren: { startRy: 4 * 210_000 * 1.673e7 / 4000 } }],
  };
  const endStateCombo = { id: 61, name: "hout UGT eindstijfheid", type: "uls", formula: "test",
    factors: new Map([[1, 1]]), eindtoestand: { psi2: 0.5 } };
  const ordinaryCases = await solveAllCasesNativeFrame2D(endStateInput);
  const endStateCases = await solveAllCasesNativeFrame2D(
    eindstijfheidInvoer(endStateInput, { kDefPerStaaf: new Map([[1, 0.6]]) }, 0.5));
  await losEindtoestandNativeOp(endStateInput, ordinaryCases, [endStateCombo],
    { kDefPerStaaf: new Map([[1, 0.6]]) }, adjusted => solveAllCasesNativeFrame2D(adjusted));
  const storedEndState = getEindtoestandGevallen(ordinaryCases, 0.5);
  assert.ok(storedEndState);
  const oldEndState = solveAllCases(eindstijfheidInvoer(endStateInput,
    { kDefPerStaaf: new Map([[1, 0.6]]) }, 0.5)).perCase;
  const nativeEndCombo = combineResults(endStateCombo, ordinaryCases);
  const directNativeEndCombo = combineResults({ ...endStateCombo,
    eindtoestand: undefined }, endStateCases);
  const oldEndCombo = combineResults({ ...endStateCombo,
    eindtoestand: undefined }, oldEndState);
  const maxBeamDeflection = result => Math.max(...result.elements.get(1).deflection.map(Math.abs));
  assert.ok(Math.abs(maxBeamDeflection(nativeEndCombo)
    - maxBeamDeflection(combineResults({ ...endStateCombo, eindtoestand: undefined }, ordinaryCases))) > 1e-5,
  "E_mean,fin moet de native constructievervorming wijzigen");
  close(maxBeamDeflection(nativeEndCombo), maxBeamDeflection(directNativeEndCombo),
    1e-8, "native eindtoestandvariant gebruikt E_mean,fin");
  close(maxBeamDeflection(nativeEndCombo), maxBeamDeflection(oldEndCombo),
    1e-8, "native eindtoestandvariant stemt overeen met de bestaande solver");
  for (const [corruption, message] of [
    ["null-node-record", /volledig evenwichtig resultaat/],
    ["null-member-record", /volledig evenwichtig resultaat/],
    ["null-displacement", /ongeldige knoopwaarden/],
    ["null-reaction", /ongeldige knoopwaarden/],
    ["null-stations", /ongeldige staafdiagrammen/],
    ["null-end-forces", /ongeldige staafdiagrammen/],
    ["invalid-diagram-station", /ongeldige staafdiagrammen/],
  ]) {
    corruptNextFrameResult = corruption;
    await assert.rejects(() => solveAllCasesNativeFrame2D({ ...input, cases: [{ id: 1, name: "lijnlast" }] }), message);
  }
} finally {
  globalThis.fetch = previousFetch;
}
console.log("Native 2D-app-route: lineair/P-Delta, bedding, segmenten, veren, thermiek, axiale FNL en buig-FNL met rotatievrijgave slagen.");
