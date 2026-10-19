import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { solveNativePrestressedBeam } from "./src/lib/nativeFemClient.ts";
import { buildPrestressedBeamInput, INITIAL_PRESTRESSED_BEAM_FIELDS } from "./src/lib/prestressedBeamInput.ts";

const binary = fileURLToPath(new URL("../src-tauri/target/debug/native-prestressed-beam", import.meta.url));
const input = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/fhwa-prestressed-girder-camber.json", import.meta.url), "utf8"));
const parabolicInput = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/parabolic-prestressed-beam.json", import.meta.url), "utf8"));
const shearInput = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/ec2-prestressed-shear-example-6-3.json", import.meta.url), "utf8"));
const shearLinksInput = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/ec2-prestressed-shear-links-example-6-4.json", import.meta.url), "utf8"));
const pointLoadInput = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/point-loaded-prestressed-beam.json", import.meta.url), "utf8"));
const partialLineLoadInput = JSON.parse(readFileSync(new URL("../src-tauri/crates/native-fem/examples/partially-loaded-prestressed-beam.json", import.meta.url), "utf8"));
const uiInput = buildPrestressedBeamInput(INITIAL_PRESTRESSED_BEAM_FIELDS);
const uiPointLoadInput = buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
  transferPointLoads: [{ positionM: 3, downwardKn: 6 }],
  servicePointLoads: [{ positionM: 5, downwardKn: 12 }],
});
const uiMultiplePointLoadInput = buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
  serviceLoadKnPerM: 0,
  servicePointLoads: [{ positionM: 3, downwardKn: 6 }, { positionM: 7, downwardKn: 8 }],
});
const uiLineLoadInput = buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
  lossPercent: 0, tendonMidM: 0, serviceLoadKnPerM: 0,
  serviceLineLoads: [{ startM: 2, endM: 7, startDownwardKnPerM: 0, endDownwardKnPerM: 20 }],
});
const uiMultipleLineLoadInput = buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
  serviceLoadKnPerM: 0,
  transferLineLoads: [{ startM: 0, endM: 10, startDownwardKnPerM: 2, endDownwardKnPerM: 2 }],
  serviceLineLoads: [
    { startM: 1, endM: 4, startDownwardKnPerM: 0, endDownwardKnPerM: 12 },
    { startM: 6, endM: 9, startDownwardKnPerM: 6, endDownwardKnPerM: 6 },
  ],
});
const uiFourSegmentInput = buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
  segmentModuliMpa: [30_000, 25_000, 20_000, 15_000],
  segmentBoundariesM: [2, 6, 8],
});
const zeroPrestressServiceInput = { ...input, lossFraction: 1 };
const piecewiseModulusInput = {
  ...input,
  spanM: 10,
  section: { areaM2: 0.5, inertiaM4: 0.02, topFibreM: 0.3, bottomFibreM: 0.3, eMpa: 30000 },
  stiffnessSegments: [
    { startM: 0, endM: 5, eMpa: 30000 },
    { startM: 5, endM: 10, eMpa: 15000 },
  ],
  tendon: { kind: "straight", eccentricityM: 0 },
  initialForceKn: 1000,
  lossFraction: 0.2,
  transferUniformDownwardKnPerM: 10,
  serviceUniformDownwardKnPerM: 10,
};
const invoke = (request) => new Promise((resolve, reject) => {
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
  const output = [], errors = [];
  child.stdout.on("data", (chunk) => output.push(chunk));
  child.stderr.on("data", (chunk) => errors.push(chunk));
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve(JSON.parse(Buffer.concat(output).toString()))
    : reject(new Error(Buffer.concat(errors).toString() || Buffer.concat(output).toString())));
  child.stdin.end(JSON.stringify(request));
});

// Independent unit-load/Green-function reference for a simply supported beam
// under uniform load. Split at both the unit-load cusp and every E boundary;
// on each interval E is constant and M(x)m(x) is cubic, so Simpson is exact.
const greenMidspanDeflection = (spanM, inertiaM4, qKnPerM, segments) => {
  const boundaries = [0, spanM / 2, spanM,
    ...segments.flatMap(({ startM, endM }) => [startM, endM])]
    .sort((a, b) => a - b)
    .filter((x, index, all) => index === 0 || x !== all[index - 1]);
  const momentTimesUnitMoment = (x) => qKnPerM * x * (spanM - x) / 2
    * (x <= spanM / 2 ? x / 2 : (spanM - x) / 2);
  return boundaries.slice(0, -1).reduce((deflection, startM, index) => {
    const endM = boundaries[index + 1];
    const middleM = (startM + endM) / 2;
    const segment = segments.find(({ startM: a, endM: b }) => middleM >= a && middleM < b);
    assert.ok(segment, `Green-referentie mist E-segment bij x=${middleM}`);
    const integral = (endM - startM) / 6 * (momentTimesUnitMoment(startM)
      + 4 * momentTimesUnitMoment(middleM) + momentTimesUnitMoment(endM));
    return deflection + integral / (segment.eMpa * 1000 * inertiaM4);
  }, 0);
};
const greenPointLoadMidspanDeflection = (spanM, inertiaM4, segments, loads) => {
  const leftReactionKn = loads.reduce((sum, load) => sum
    + load.downwardKn * (spanM - load.positionM) / spanM, 0);
  const boundaries = [0, spanM / 2, spanM,
    ...loads.map((load) => load.positionM),
    ...segments.flatMap(({ startM, endM }) => [startM, endM])]
    .sort((a, b) => a - b)
    .filter((x, index, all) => index === 0 || x !== all[index - 1]);
  const momentTimesUnitMoment = (x) => {
    const moment = leftReactionKn * x - loads.reduce((sum, load) => sum
      + load.downwardKn * Math.max(0, x - load.positionM), 0);
    return moment * (x <= spanM / 2 ? x / 2 : (spanM - x) / 2);
  };
  return boundaries.slice(0, -1).reduce((deflection, startM, index) => {
    const endM = boundaries[index + 1];
    const middleM = (startM + endM) / 2;
    const segment = segments.find(({ startM: a, endM: b }) => middleM >= a && middleM < b);
    assert.ok(segment, `Puntlast-Green-referentie mist E-segment bij x=${middleM}`);
    const integral = (endM - startM) / 6 * (momentTimesUnitMoment(startM)
      + 4 * momentTimesUnitMoment(middleM) + momentTimesUnitMoment(endM));
    return deflection + integral / (segment.eMpa * 1000 * inertiaM4);
  }, 0);
};
const greenLineLoadMidspanDeflection = (spanM, inertiaM4, segments, loads) => {
  const forceAndFirstMoment = (load, x) => {
    const length = load.endM - load.startM;
    const distance = Math.max(0, Math.min(length, x - load.startM));
    const slope = (load.endDownwardKnPerM - load.startDownwardKnPerM) / length;
    const force = load.startDownwardKnPerM * distance + slope * distance ** 2 / 2;
    const firstMoment = load.startM * force + load.startDownwardKnPerM * distance ** 2 / 2
      + slope * distance ** 3 / 3;
    return [force, firstMoment];
  };
  const leftReactionKn = loads.reduce((sum, load) => {
    const [force, firstMoment] = forceAndFirstMoment(load, load.endM);
    return sum + (force * spanM - firstMoment) / spanM;
  }, 0);
  const boundaries = [0, spanM / 2, spanM,
    ...loads.flatMap((load) => [load.startM, load.endM]),
    ...segments.flatMap(({ startM, endM }) => [startM, endM])]
    .sort((a, b) => a - b)
    .filter((x, index, all) => index === 0 || x !== all[index - 1]);
  const integrand = (x) => {
    const moment = leftReactionKn * x - loads.reduce((sum, load) => {
      const [force, firstMoment] = forceAndFirstMoment(load, x);
      return sum + x * force - firstMoment;
    }, 0);
    return moment * (x <= spanM / 2 ? x / 2 : (spanM - x) / 2);
  };
  const nodes = [-Math.sqrt(3 / 5), 0, Math.sqrt(3 / 5)];
  const weights = [5 / 9, 8 / 9, 5 / 9];
  return boundaries.slice(0, -1).reduce((deflection, startM, index) => {
    const endM = boundaries[index + 1];
    const middleM = (startM + endM) / 2;
    const halfLength = (endM - startM) / 2;
    const segment = segments.find(({ startM: a, endM: b }) => middleM >= a && middleM < b);
    assert.ok(segment, `lijnlast-Green-referentie mist E-segment bij x=${middleM}`);
    const integral = halfLength * nodes.reduce((sum, node, i) =>
      sum + weights[i] * integrand(middleM + halfLength * node), 0);
    return deflection + integral / (segment.eMpa * 1000 * inertiaM4);
  }, 0);
};

const originalFetch = globalThis.fetch;
let corruptResult = null;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/toetsing");
  const request = JSON.parse(options.body);
  assert.equal(request.opdracht, "solve_native_fem");
  assert.equal(request.inputs.kind, "prestressedBeam");
  assert.ok([input, parabolicInput, shearInput, shearLinksInput, pointLoadInput, partialLineLoadInput,
    piecewiseModulusInput, uiInput, uiPointLoadInput, uiMultiplePointLoadInput,
    uiLineLoadInput, uiMultipleLineLoadInput, uiFourSegmentInput,
    zeroPrestressServiceInput].some((expected) =>
    JSON.stringify(request.inputs.input) === JSON.stringify(expected)));
  const result = await invoke(request.inputs.input);
  if (corruptResult === "non-finite-stress") result.service.stations[0].fibreStress.topMpa = Number.NaN;
  else if (corruptResult === "station-outside-span") result.service.stations.at(-1).xM += 0.01;
  return new Response(JSON.stringify({ kind: "prestressedBeam", result }), { status: 200 });
};
try {
  const result = await solveNativePrestressedBeam(input);
  assert.ok(Math.abs(result.transfer.prestressCamberM / 0.0254 - -1.99) < 0.01,
    `FHWA camber ${result.transfer.prestressCamberM / 0.0254} in differs from -1.99 in`);
  assert.equal(result.transfer.forceKn, input.initialForceKn);
  assert.equal(result.service.forceKn, input.initialForceKn * (1 - input.lossFraction));
  assert.ok(Math.abs(result.transfer.equivalentUniformUpwardKnPerM) < 1e-12);
  assert.equal(result.service.stations.length, 5);
  assert.equal(result.service.stations[2].xM, input.spanM / 2);
  assert.ok(Math.abs(result.service.stations[2].totalDeflectionM - result.service.totalMidspanDeflectionM) < 1e-12);
  assert.ok(Math.abs(result.service.stations[0].totalDeflectionM) < 1e-12);
  assert.ok(Math.abs(result.service.stations[4].totalDeflectionM) < 1e-12);
  assert.deepEqual(result.service.criticalStations.map((station) => station.xM), [0, input.spanM / 2, input.spanM]);
  const parabolic = await solveNativePrestressedBeam(parabolicInput);
  assert.deepEqual(parabolic.service.stations.map((station) => station.xM), [0, 2.5, 7.5, 10]);
  assert.ok(Math.abs(parabolic.service.stations[1].shearKn - 8) < 1e-12);
  assert.ok(Math.abs(parabolic.service.stations[2].shearKn + 8) < 1e-12);
  assert.ok(Math.abs(parabolic.transfer.leftReactionKn + 80) < 1e-12);
  assert.ok(Math.abs(parabolic.transfer.rightReactionKn + 80) < 1e-12);
  assert.ok(Math.abs(parabolic.service.externalLeftReactionKn - 80) < 1e-12);
  assert.ok(Math.abs(parabolic.service.leftReactionKn - 16) < 1e-12);
  assert.ok(Math.abs(parabolic.service.rightReactionKn - 16) < 1e-12);
  assert.deepEqual(parabolic.service.criticalStations.map((station) => station.xM), [0, 5, 10]);
  const checkedShear = await solveNativePrestressedBeam(shearInput);
  const shear = checkedShear.service.stations[0].shearResistanceWithoutLinks;
  assert.ok(shear, "Rust-route must return prestressed shear resistance when requested");
  assert.ok(Math.abs(shear.sigmaCpMpa - 5) < 1e-12);
  assert.ok(Math.abs(shear.vRdcCrackedKn - 24.08) < 1e-12);
  assert.ok(Math.abs(shear.vRdcUncrackedKn - 44.33) < 0.02);
  const linkedShear = await solveNativePrestressedBeam(shearLinksInput);
  const linkDesign = linkedShear.service.stations[0].shearLinks;
  assert.ok(linkDesign, "Rust-route must return EC2 link design when requested");
  assert.ok(Math.abs(linkDesign.vEdKn - 600) < 1e-12);
  assert.ok(Math.abs(linkDesign.requiredAswPerSpacingMm2PerMm - 1.263) < 0.001);
  assert.ok(Math.abs(linkDesign.vRdMaxKn - 600) < 0.2);
  assert.ok(linkDesign.maximumSpacingForProvidedAswMm > 170);
  const pointLoaded = await solveNativePrestressedBeam(pointLoadInput);
  const pointLoadStation = pointLoaded.service.stations.find((station) => station.xM === 5);
  assert.ok(pointLoadStation, "de puntlastlocatie moet als doorsnede worden gerapporteerd");
  assert.ok(Math.abs(pointLoadStation.externalMomentKnm - 30) < 1e-12);
  assert.ok(Math.abs(pointLoadStation.shearBeforePointLoadKn - 6) < 1e-12);
  assert.ok(Math.abs(pointLoadStation.shearAfterPointLoadKn + 6) < 1e-12);
  assert.ok(Math.abs(pointLoaded.service.externalMidspanDeflectionM - 1 / 2400) < 1e-14);
  assert.ok(Math.abs(pointLoaded.transfer.externalMidspanMomentKnm) < 1e-12,
    "service point load must not leak into the transfer stage");
  const partialLineLoaded = await solveNativePrestressedBeam(partialLineLoadInput);
  assert.ok(Math.abs(partialLineLoaded.service.externalMidspanMomentKnm - 296 / 3) < 1e-10);
  assert.ok(Math.abs(partialLineLoaded.service.externalMidspanDeflectionM - 0.0015968333333333334) < 1e-14);
  const rampStart = partialLineLoaded.service.stations.find((station) => station.xM === 2);
  const rampEnd = partialLineLoaded.service.stations.find((station) => station.xM === 7);
  assert.ok(Math.abs(rampStart.shearKn - 70 / 3) < 1e-12);
  assert.ok(Math.abs(rampEnd.shearKn + 80 / 3) < 1e-12);
  assert.ok(Math.abs(partialLineLoaded.service.externalLeftReactionKn - 70 / 3) < 1e-12);
  assert.ok(Math.abs(partialLineLoaded.service.externalRightReactionKn - 80 / 3) < 1e-12);
  const piecewiseModulus = await solveNativePrestressedBeam(piecewiseModulusInput);
  assert.ok(Math.abs(piecewiseModulus.service.externalMidspanDeflectionM - 0.003255208333333333) < 1e-14);
  assert.equal(piecewiseModulus.service.stations.find((station) => station.xM === 5).effectiveEMpa, 15000);
  assert.ok(Math.abs(piecewiseModulus.service.externalLeftReactionKn - 50) < 1e-12);
  const uiResult = await solveNativePrestressedBeam(uiInput);
  assert.equal(uiResult.service.stations.length, 5);
  assert.equal(uiResult.service.stations.find((station) => station.xM === 5).effectiveEMpa, 30000);
  assert.ok(uiResult.service.stations.every((station) => station.shearLinks));
  assert.ok(uiResult.service.stations.some((station) => station.shearLinks.requiredAswPerSpacingMm2PerMm > 0));
  assert.deepEqual(uiFourSegmentInput.stiffnessSegments, [
    { startM: 0, endM: 2, eMpa: 30000 },
    { startM: 2, endM: 6, eMpa: 25000 },
    { startM: 6, endM: 8, eMpa: 20000 },
    { startM: 8, endM: 10, eMpa: 15000 },
  ]);
  assert.ok([2, 6, 8].every((x) => uiFourSegmentInput.stationsXM.includes(x)),
    "E-segmentgrenzen moeten als resultaatstations worden aangevraagd");
  const uiFourSegmentResult = await solveNativePrestressedBeam(uiFourSegmentInput);
  assert.ok([2, 6, 8].every((x) => uiFourSegmentResult.service.stations.some((station) => station.xM === x)),
    "de Rust-resultaten moeten de instelbare E-segmentgrenzen tonen");
  const fourSegmentGreenReference = greenMidspanDeflection(10, 0.02, 16,
    uiFourSegmentInput.stiffnessSegments);
  assert.ok(Math.abs(uiFourSegmentResult.service.externalMidspanDeflectionM - fourSegmentGreenReference) < 1e-13,
    `vier E-segmenten geven ${uiFourSegmentResult.service.externalMidspanDeflectionM} m; `
      + `onafhankelijke Green-referentie geeft ${fourSegmentGreenReference} m`);
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    segmentModuliMpa: [30000, 25000, 20000, 15000], segmentBoundariesM: [5, 4, 8],
  }), /E-segmentgrenzen moeten oplopend/);
  assert.deepEqual(uiPointLoadInput.transferPointLoads, [{ positionM: 3, downwardKn: 6 }]);
  assert.deepEqual(uiPointLoadInput.servicePointLoads, [{ positionM: 5, downwardKn: 12 }]);
  assert.ok(uiPointLoadInput.stationsXM.includes(3) && uiPointLoadInput.stationsXM.includes(5),
    "app-builder moet beide puntlastposities expliciet als resultaatstation aanvragen");
  const uiPointLoadResult = await solveNativePrestressedBeam(uiPointLoadInput);
  assert.ok(uiPointLoadResult.transfer.stations.some((station) => station.xM === 3),
    "de overdrachtspuntlast moet als station in de zichtbare resultaten verschijnen");
  const servicePointLoadStation = uiPointLoadResult.service.stations.find((station) => station.xM === 5);
  assert.ok(servicePointLoadStation && Number.isFinite(servicePointLoadStation.shearBeforePointLoadKn)
    && Number.isFinite(servicePointLoadStation.shearAfterPointLoadKn),
  "de appbuilder moet de service-puntsprong met dwarskracht aan beide zijden rapporteren");
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    servicePointLoads: [{ positionM: 0, downwardKn: 12 }],
  }), /Actieve puntlasten moeten een eindige last en een positie tussen de steunpunten hebben/);
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    servicePointLoads: [{ positionM: 5, downwardKn: Number.NaN }],
  }), /Actieve puntlasten moeten een eindige last en een positie tussen de steunpunten hebben/);
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    inertiaM4: 0,
  }), /traagheidsmoment I moet positief zijn/);
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    lossPercent: 100.1,
  }), /Voorspanverlies moet tussen 0 en 100 procent liggen/);
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    cotTheta: 3,
  }), /cot\(theta\) moet tussen 1,0 en 2,5 liggen/);
  assert.deepEqual(uiMultiplePointLoadInput.servicePointLoads, [
    { positionM: 3, downwardKn: 6 }, { positionM: 7, downwardKn: 8 },
  ]);
  assert.ok([3, 7].every((x) => uiMultiplePointLoadInput.stationsXM.includes(x)),
    "alle puntlastposities moeten als resultaatstations worden aangevraagd");
  const uiMultiplePointLoadResult = await solveNativePrestressedBeam(uiMultiplePointLoadInput);
  assert.ok(Math.abs(uiMultiplePointLoadResult.service.externalLeftReactionKn - 6.6) < 1e-12);
  assert.ok(Math.abs(uiMultiplePointLoadResult.service.externalRightReactionKn - 7.4) < 1e-12);
  assert.ok(Math.abs(uiMultiplePointLoadResult.service.externalMidspanMomentKnm - 21) < 1e-12);
  const twoPointGreenReference = greenPointLoadMidspanDeflection(10, 0.02,
    uiMultiplePointLoadInput.stiffnessSegments, uiMultiplePointLoadInput.servicePointLoads);
  assert.ok(Math.abs(uiMultiplePointLoadResult.service.externalMidspanDeflectionM - twoPointGreenReference) < 1e-13,
    `twee puntlasten geven ${uiMultiplePointLoadResult.service.externalMidspanDeflectionM} m; `
      + `Green-referentie geeft ${twoPointGreenReference} m`);
  assert.deepEqual(uiLineLoadInput.serviceLineLoads, [{ startM: 2, endM: 7,
    startDownwardKnPerM: 0, endDownwardKnPerM: 20 }]);
  assert.ok(uiLineLoadInput.stationsXM.includes(2) && uiLineLoadInput.stationsXM.includes(7),
    "app-builder moet de uiteinden van de gedeeltelijke lijnlast als resultaatstations aanvragen");
  const uiLineLoadResult = await solveNativePrestressedBeam(uiLineLoadInput);
  assert.ok(Math.abs(uiLineLoadResult.service.externalMidspanMomentKnm - 296 / 3) < 1e-10,
    "de zichtbare invoer moet het onafhankelijke middenmoment van de driehoeklast reproduceren");
  assert.ok(Math.abs(uiLineLoadResult.service.externalMidspanDeflectionM - 0.0015968333333333334) < 1e-14,
    "de zichtbare invoer moet de onafhankelijke Green-functie-doorbuiging reproduceren");
  assert.deepEqual(uiMultipleLineLoadInput.serviceLineLoads, [
    { startM: 1, endM: 4, startDownwardKnPerM: 0, endDownwardKnPerM: 12 },
    { startM: 6, endM: 9, startDownwardKnPerM: 6, endDownwardKnPerM: 6 },
  ]);
  assert.ok([1, 4, 6, 9].every((x) => uiMultipleLineLoadInput.stationsXM.includes(x)),
    "alle gedeeltelijke lijnlastuiteinden moeten als resultaatstations worden aangevraagd");
  const uiMultipleLineLoadResult = await solveNativePrestressedBeam(uiMultipleLineLoadInput);
  assert.deepEqual(uiMultipleLineLoadInput.transferLineLoads, [
    { startM: 0, endM: 10, startDownwardKnPerM: 2, endDownwardKnPerM: 2 },
  ]);
  assert.ok(Math.abs(uiMultipleLineLoadResult.transfer.externalLeftReactionKn - 10) < 1e-12);
  assert.ok(Math.abs(uiMultipleLineLoadResult.transfer.externalRightReactionKn - 10) < 1e-12);
  assert.ok(Math.abs(uiMultipleLineLoadResult.transfer.externalMidspanMomentKnm - 25) < 1e-12);
  assert.ok(Math.abs(uiMultipleLineLoadResult.service.externalLeftReactionKn - 17.1) < 1e-12);
  assert.ok(Math.abs(uiMultipleLineLoadResult.service.externalRightReactionKn - 18.9) < 1e-12);
  assert.ok(Math.abs(uiMultipleLineLoadResult.service.externalMidspanMomentKnm - 49.5) < 1e-12);
  const twoLineGreenReference = greenLineLoadMidspanDeflection(10, 0.02,
    uiMultipleLineLoadInput.stiffnessSegments, uiMultipleLineLoadInput.serviceLineLoads);
  assert.ok(Math.abs(uiMultipleLineLoadResult.service.externalMidspanDeflectionM - twoLineGreenReference) < 1e-13,
    `twee lijnlasten geven ${uiMultipleLineLoadResult.service.externalMidspanDeflectionM} m; `
      + `Green-referentie geeft ${twoLineGreenReference} m`);
  assert.throws(() => buildPrestressedBeamInput({ ...INITIAL_PRESTRESSED_BEAM_FIELDS,
    serviceLineLoads: [{ startM: 7, endM: 2, startDownwardKnPerM: 0, endDownwardKnPerM: 10 }],
  }), /Gedeeltelijke lijnlasten moeten eindig en binnen de overspanning liggen/);
  const zeroPrestressService = await solveNativePrestressedBeam(zeroPrestressServiceInput);
  assert.equal(zeroPrestressService.service.forceKn, 0,
    "100% voorspanningsverlies is een geldige toestand zonder resterende voorspankracht");
  for (const corruption of ["non-finite-stress", "station-outside-span"]) {
    corruptResult = corruption;
    await assert.rejects(solveNativePrestressedBeam(input),
      /Rust-voorgespannen ligger leverde onvolledige, niet-eindige of ongeldige stationsresultaten/);
  }
  corruptResult = null;
  console.log("Rust voorgespannen-liggerroute: FHWA, EC2-dwarskracht, stukgewijze E en app-invoer slagen.");
} finally {
  globalThis.fetch = originalFetch;
}
