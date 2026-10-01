import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { solveAllCases, solveCombinationSecondOrder } from "./src/components/fem/solver/engine.ts";
import { getScheefstandRichtingen, SCHEEFSTAND_ID_OFFSET } from "./src/components/fem/solver/engine.ts";
import { combineResults } from "./src/components/fem/solver/combinations.ts";
import { buildNativeFrame2DRequest, solveAllCasesNativeFrame2D, solveAllCombinationsNativeFrame2D } from "./src/components/fem/solver/nativeFrame2DRoute.ts";
import { resolveSolver } from "./src/core/solver/SolverRegistry.ts";
import { spiegelElementKrachten } from "./src/lib/referentierichting.ts";
import { bouwMultiInput } from "./src/lib/modelNaarSolverInput.ts";

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
assert.throws(() => buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], releases: { startTx: true } }] }, () => 1), /translatiehulzen/);
assert.equal(buildNativeFrame2DRequest({ ...input,
  beams: [{ ...input.beams[0], endConnection: "hinge" }] }, () => 1, "geometric").members[0].releases.rzEnd, true);
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
  assert.deepEqual(spiegelElementKrachten(steelFnl.elements.get(1)).axialHistory,
    steelFnl.elements.get(1).axialHistory,
    "axiale materiaalgeschiedenis blijft gelijk als de staafrichting omkeert");
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
  await assert.rejects(() => solveAllCombinationsNativeFrame2D({ ...steelFnlInput,
    loads: [{ beamId: 1, caseId: 1, q: 1, qDir: "x", qCoord: "local" }] },
    [{ id: 101, name: "axiale lijnlast", factors: new Map([[1, 1]]) }], "material"),
  /axial material history does not yet support member axial loads/);
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
} finally {
  globalThis.fetch = previousFetch;
}
console.log("Native 2D-app-route: lineair/P-Delta (ook sparse bedding), scheefstand, thermiek en axiale staal-/beton-FNL slagen.");
