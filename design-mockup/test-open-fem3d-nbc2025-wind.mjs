import assert from "node:assert/strict";
import { generateNbc2025EnvelopeWindLoads, generateNbc2025EnvelopeWindLoadsForLimitStates
} from "./src/components/openFem3d/openFem3dNbc2025Wind.ts";
import { applyGeneratedEnvelopeLoads } from "./src/components/openFem3d/openFem3dGeneratedLoads.ts";
import { nbc2025ModelLoadPlan } from "./src/components/openFem3d/openFem3dNbc2025ModelPlan.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";
import { openFem3DLoadPanelForcePerArea, openFem3DLoadPanelGeometry
} from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import { openFem3DWindPressureReport } from "./src/components/openFem3d/openFem3dWindPressureReport.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8,
  `${actual} != ${expected}`);
const offset = [100, -40, 8];
const points = [
  [0, 0, 0], [0, 0, 5], [0, 10, 5], [0, 10, 0],
  [20, 0, 0], [20, 10, 0], [20, 10, 5], [20, 0, 5],
  [20, 0, 0], [20, 0, 5], [0, 0, 5], [0, 0, 0],
  [0, 10, 0], [0, 10, 5], [20, 10, 5], [20, 10, 0],
  [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
  [0, 2, 1], [0, 2, 2], [0, 3, 2], [0, 3, 1],
  [1, 1, 5], [2, 1, 5], [2, 2, 5], [1, 2, 5],
];
const model = {
  nodes: points.map(([x, y, z], index) => ({ id: index + 1,
    x: x + offset[0], y: y + offset[1], z: z + offset[2] })), beams: [],
  envelopePanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], type: "facade", distribution: "twoWay",
      openings: [{ id: 1, nodeIds: [21, 22, 23, 24] }] },
    { id: 2, nodeIds: [5, 6, 7, 8], type: "facade", distribution: "twoWay" },
    { id: 3, nodeIds: [9, 10, 11, 12], type: "facade", distribution: "twoWay" },
    { id: 4, nodeIds: [13, 14, 15, 16], type: "facade", distribution: "twoWay" },
    { id: 5, nodeIds: [17, 18, 19, 20], type: "roof", distribution: "twoWay",
      openings: [{ id: 2, nodeIds: [25, 26, 27, 28] }] },
  ],
};
const input = {
  widthXM: 20, widthYM: 10, heightM: 5,
  naturalFrequencyHz: 1.2, naturalFrequencySource: "project modal analysis",
  noWakeOrChannelling: true,
  referencePressureKPa: 0.5, referencePressureSource: "verified project q1/500",
  importanceCategory: "normal", limitState: "uls", terrain: "open",
  topographicFactor: 1, topographicFactorSource: "level site, NBC 4.1.7.4",
  internalPressureCoefficientMin: -0.3, internalPressureCoefficientMax: 0.2,
  internalCoefficientSource: "verified project Cpi",
};
const result = generateNbc2025EnvelopeWindLoads(model, input);
const { limitState, ...buildingInput } = input;
const bothStates = generateNbc2025EnvelopeWindLoadsForLimitStates(model, buildingInput);
assert.equal(bothStates.cases.length, 16);
assert.equal(new Set(bothStates.cases.map((item) => item.key)).size, 16);
assert.equal(bothStates.loads.length, result.loads.length * 2);
const { internalPressureCoefficientMin, internalPressureCoefficientMax, internalCoefficientSource,
  ...baseWithoutManualCpi } = input;
const classified = generateNbc2025EnvelopeWindLoads(model, { ...baseWithoutManualCpi,
  openingEvidence: { kind: "other-or-closed", nonUniformlyDistributed: true, noSignificantOpening: true,
    source: "verified opening schedule P-8" } });
assert.deepEqual(classified.cases.slice(0, 2).map((item) => item.internalPressureCoefficient), [-0.45, 0.3]);
assert.ok(classified.loads.every((load) =>
  load.pressureDerivation.internalCoefficientSource.includes("verified opening schedule P-8")));
assert.equal(result.windCodeId, "ca-nbc-2025");
assert.equal(result.cases.length, 8);
assert.equal(new Set(result.loads.map((load) => load.key)).size, result.loads.length);
assert.ok(result.loads.every((load) => load.pressurePlan.caseKey === load.caseKey
  && load.qOutwardKnPerM2 === load.pressurePlan.pressure.outwardKnPerM2));
const windCase = result.cases.find((item) => item.direction === "+X" && item.internalPressureCoefficient === 0.2);
const loads = result.loads.filter((load) => load.caseKey === windCase.key);
const area = (surfaceId) => loads.filter((load) => load.surfaceId === surfaceId)
  .reduce((sum, load) => sum + load.triangle.areaM2, 0);
close(area("x-min-wall"), 49);
close(area("x-max-wall"), 50);
close(area("y-min-wall"), 100);
close(area("y-max-wall"), 100);
close(area("roof-upwind"), 49);
close(area("roof-downwind"), 150);
const patch = (surfaceId) => windCase.patches.find((item) => item.pressurePlan.surfaceId === surfaceId);
const fullFx = windCase.patches.reduce((sum, item) => sum + item.resultantKn[0], 0);
const fullFz = windCase.patches.reduce((sum, item) => sum + item.resultantKn[2], 0);
const loadedFx = loads.reduce((sum, load) => sum + load.triangle.areaM2 * load.qOutwardKnPerM2
  * patch(load.surfaceId).outwardNormal[0], 0);
const loadedMy = loads.reduce((sum, load) => sum + load.triangle.areaM2 * load.qOutwardKnPerM2
  * patch(load.surfaceId).outwardNormal[0]
  * (load.triangle.points.reduce((height, point) => height + point[2], 0) / 3 - offset[2]), 0);
const loadedMz = loads.reduce((sum, load) => {
  const centroid = [0, 1].map((axis) => load.triangle.points
    .reduce((coordinate, point) => coordinate + point[axis], 0) / 3);
  const force = load.triangle.areaM2 * load.qOutwardKnPerM2;
  const [nx, ny] = patch(load.surfaceId).outwardNormal;
  return sum + (centroid[0] - offset[0] - input.widthXM / 2) * force * ny
    - (centroid[1] - offset[1] - input.widthYM / 2) * force * nx;
}, 0);
const loadedFz = loads.reduce((sum, load) => sum + load.triangle.areaM2 * load.qOutwardKnPerM2
  * patch(load.surfaceId).outwardNormal[2], 0);
close(loadedFx, fullFx + patch("x-min-wall").pressurePlan.pressure.outwardKnPerM2);
close(loadedFz, fullFz - patch("roof-upwind").pressurePlan.pressure.outwardKnPerM2);
assert.deepEqual(generateNbc2025EnvelopeWindLoads(model, input), result);
const noRoofLoads = { roofShape: "none", cases: [], loads: [], warnings: [] };
const manualCases = [{ id: 1, name: "Handmatig", type: "dead" }];
const modelPlanInput = { wind: buildingInput, firstId: 100,
  deadLoadScope: "ordinary-only", nonWindLoadsVerifiedForNbc2025: true,
  liveUse: "ordinary", serviceability: "noncreep-deflection" };
const modelPlan = nbc2025ModelLoadPlan(model, manualCases, modelPlanInput);
assert.equal(modelPlan.combinations.length, 25);
assert.equal(modelPlan.horizontalWindActions.length, 128);
assert.equal(modelPlan.horizontalWindActions.filter((item) => item.pattern === "d").length, 64);
const projectedFullX = modelPlan.horizontalWindActions.find((item) => item.pattern === "a"
  && item.pressureCaseKeys[0] === windCase.key);
close(projectedFullX.fxKn, loadedFx);
close(projectedFullX.baseMyKnM, loadedMy);
close(projectedFullX.mzKnM, loadedMz);
assert.ok(Math.abs(projectedFullX.mzKnM) > 1e-3,
  "asymmetrische opening veroorzaakt torsie zonder normatieve excentriciteit");
assert.ok(Math.abs(projectedFullX.baseMyKnM - fullFx * input.heightM / 2) > 1e-3,
  "gevelopeningen verschuiven de werkelijke verticale resultante");
const projectedEccentric = modelPlan.horizontalWindActions.filter((item) => item.pattern === "b"
  && item.pressureCaseKeys[0] === windCase.key);
assert.ok(projectedEccentric.every((item) => Math.abs(item.fxKn - 0.75 * loadedFx) < 1e-8
  && Math.abs(item.baseMyKnM - 0.75 * loadedMy) < 1e-8
  && Math.abs(item.mzKnM - (0.75 * loadedMz - item.offsetYM * item.fxKn)) < 1e-8));
assert.ok(modelPlan.horizontalWindActions.every((item) => item.pressureCaseKeys.every((key) =>
  modelPlan.loadCases.some((load) => load.gegenereerd?.sleutel === key))));
assert.equal(modelPlan.loadCases.length, 17);
assert.equal(modelPlan.model.loadPanels.length, bothStates.loads.length);
assert.ok(modelPlan.combinations.every((combo) => [...combo.factors.keys()]
  .every((id) => modelPlan.loadCases.some((item) => item.id === id))));
for (const combination of modelPlan.combinations.filter((item) => item.factors.size === 2)) {
  const windId = [...combination.factors.keys()].find((id) => id !== 1);
  const windCase = modelPlan.loadCases.find((item) => item.id === windId);
  assert.equal(windCase.gegenereerd.sleutel.includes(`:${combination.type}:`), true);
  assert.equal(combination.factors.get(windId), 1);
  assert.ok(modelPlan.model.loadPanels.some((panel) => panel.caseId === windId));
}
const repeatedModelPlan = nbc2025ModelLoadPlan(modelPlan.model, modelPlan.loadCases, modelPlanInput);
assert.equal(repeatedModelPlan.changed, false);
assert.deepEqual(repeatedModelPlan.combinations, modelPlan.combinations);
assert.deepEqual(repeatedModelPlan.horizontalWindActions, modelPlan.horizontalWindActions);
const snow = {
  widthXM: 20, widthYM: 10, groundSnowKPa: 2, groundSnowSource: "project Ss 1/1000",
  associatedRainKPa: 0.2, associatedRainSource: "project Sr 1/1000",
  windExposureFactor: 1, windExposureSource: "winter climate and shelter review",
  thermalFactor: 1, thermalFactorSource: "NBC 4.1.6.2(11)",
  importanceCategory: "normal", noAdditionalAccumulation: true,
  accumulationEvidenceSource: "no adjacent higher roof, parapet or roof projection",
  partitions: [
    { axis: "x", atM: 10, fullLoadSide: "lower", source: "member influence-line review" },
    { axis: "x", atM: 10, fullLoadSide: "upper", source: "member influence-line review" },
  ],
  partialRegionsVerifiedForMembers: true, partialRegionsSource: "roof member load-pattern review",
};
const snowPlan = nbc2025ModelLoadPlan(model, manualCases, { ...modelPlanInput, snow });
assert.equal(snowPlan.loadCases.filter((item) => item.type === "snow").length, 6);
assert.equal(snowPlan.combinations.length, 178);
const snowLoads = snowPlan.loadCases.filter((item) => item.type === "snow");
const snowId = (key) => snowLoads.find((item) => item.gegenereerd.sleutel === key).id;
const uniformUlsId = snowId("nbc2025:snow:uls:uniform");
const partialUlsId = snowId("nbc2025:snow:uls:partial:x:10:lower");
const uniformSlsId = snowId("nbc2025:snow:sls:uniform");
assert.ok(snowPlan.combinations.some((item) => item.type === "uls" && item.factors.get(partialUlsId) === 1));
assert.ok(snowPlan.combinations.some((item) => item.type === "sls" && item.factors.get(uniformSlsId) === 1));
assert.ok(snowPlan.combinations.every((item) =>
  snowLoads.filter((snowCase) => item.factors.has(snowCase.id)).length <= 1));
const snowForce = (caseId) => snowPlan.model.loadPanels.filter((panel) => panel.caseId === caseId)
  .reduce((sum, panel) => sum + panel.q * openFem3DLoadPanelGeometry(snowPlan.model, panel).areaM2, 0);
close(snowForce(uniformUlsId), 199 * 1.8);
close(snowForce(partialUlsId), 99 * 1.8 + 100 * 0.9);
assert.ok(snowPlan.model.loadPanels.filter((panel) => panel.caseId === partialUlsId)
  .every((panel) => panel.generated.windCodeId === "ca-nbc-2025"
    && panel.generated.sourceReference.includes("S_s=2 kPa")
    && panel.generated.sourceReference.includes("member influence-line review")));
assert.ok(snowLoads.every((item) => item.gegenereerd.windCodeId === "ca-nbc-2025"));
assert.deepEqual(parseOpenFem3DModel(snowPlan.model).loadPanels, snowPlan.model.loadPanels);
const repeatSnowPlan = nbc2025ModelLoadPlan(snowPlan.model, snowPlan.loadCases,
  { ...modelPlanInput, snow });
assert.equal(repeatSnowPlan.changed, false);
assert.deepEqual(repeatSnowPlan.combinations, snowPlan.combinations);
assert.throws(() => nbc2025ModelLoadPlan(model, manualCases,
  { ...modelPlanInput, snow: { ...snow, partitions: [] } }), /gedeeltelijke verdelingen/);
assert.throws(() => nbc2025ModelLoadPlan(model, manualCases,
  { ...modelPlanInput, snow: { ...snow, partitions: [snow.partitions[0], snow.partitions[0]] } }),
  /Dubbele NBC-sneeuwverdeling/);
assert.throws(() => nbc2025ModelLoadPlan(model, manualCases,
  { ...modelPlanInput, snow: { ...snow, importanceCategory: "high" } }), /dezelfde projectbelangcategorie/);
const appliedBoth = applyGeneratedEnvelopeLoads(model, manualCases, bothStates, noRoofLoads);
assert.equal(appliedBoth.loadCases.length, 17);
assert.equal(appliedBoth.model.loadPanels.length, bothStates.loads.length);
assert.equal(new Set(appliedBoth.model.loadPanels.map((panel) => panel.generated.key)).size,
  bothStates.loads.length);
assert.ok(appliedBoth.loadCases.some((item) => item.name.includes("NBC 2025 ULS")));
assert.ok(appliedBoth.loadCases.some((item) => item.name.includes("NBC 2025 SLS")));
const appliedByKey = new Map(appliedBoth.model.loadPanels.map((panel) => [panel.generated.key, panel]));
for (const ulsLoad of result.loads) {
  const slsKey = ulsLoad.key.replace(":uls:", ":sls:");
  close(appliedByKey.get(slsKey).q, appliedByKey.get(ulsLoad.key).q * 0.6);
}
assert.deepEqual(parseOpenFem3DModel(appliedBoth.model).loadPanels, appliedBoth.model.loadPanels);
assert.equal(applyGeneratedEnvelopeLoads(appliedBoth.model, appliedBoth.loadCases,
  generateNbc2025EnvelopeWindLoadsForLimitStates(appliedBoth.model, buildingInput), noRoofLoads).changed, false);
const applied = applyGeneratedEnvelopeLoads(model, manualCases, result, noRoofLoads);
assert.equal(applied.changed, true);
assert.equal(applied.loadCases.length, 9);
assert.deepEqual(applied.loadCases[0], manualCases[0]);
assert.ok(applied.loadCases.slice(1).every((item) => item.type === "wind"
  && item.gegenereerd.windCodeId === "ca-nbc-2025"));
assert.equal(applied.model.loadPanels.length, result.loads.length);
const sourceLoads = new Map(result.loads.map((load) => [load.key, load]));
for (const panel of applied.model.loadPanels) {
  const source = sourceLoads.get(panel.generated.key);
  const geometry = openFem3DLoadPanelGeometry(applied.model, panel);
  const force = openFem3DLoadPanelForcePerArea(panel, geometry);
  const sourceCase = result.cases.find((item) => item.key === source.caseKey);
  const sourcePatch = sourceCase.patches.find((item) => item.pressurePlan.surfaceId === source.surfaceId);
  close(geometry.areaM2, source.triangle.areaM2);
  for (let axis = 0; axis < 3; axis += 1) {
    close(force[axis] * geometry.areaM2,
      source.qOutwardKnPerM2 * source.triangle.areaM2 * sourcePatch.outwardNormal[axis]);
  }
}
assert.ok(applied.model.loadPanels.every((panel) => panel.generated.windPressureMethod === "nbc-static"
  && panel.generated.windPressurePlan.basis.kind === "separate-pressures"
  && panel.generated.windPressureDerivation.some((line) => line.symbool === "C_ei")
  && panel.generated.windInternalPressureDerivation.some((line) => line.symbool === "C_pi")));
assert.deepEqual(parseOpenFem3DModel(applied.model).loadPanels, applied.model.loadPanels);
const pressureReport = openFem3DWindPressureReport(applied.model.loadPanels);
assert.ok(pressureReport.sources.length > 0);
assert.ok(pressureReport.sources.every((item) => item.pressureMethod === "nbc-static"));
assert.deepEqual(pressureReport.missingPanelIds, []);
const repeated = applyGeneratedEnvelopeLoads(applied.model, applied.loadCases,
  generateNbc2025EnvelopeWindLoads(applied.model, input), noRoofLoads);
assert.equal(repeated.changed, false);
assert.equal(repeated.model, applied.model);
assert.throws(() => applyGeneratedEnvelopeLoads(model, manualCases, result,
  { ...noRoofLoads, cases: [{ key: "snow", name: "Sneeuw", type: "snow" }] }), /niet met Nederlandse/);
assert.throws(() => nbc2025ModelLoadPlan(model, [...manualCases,
  { id: 2, name: "Nederlandse wind", type: "wind",
    gegenereerd: { bron: "envelope3d", sleutel: "en-wind", windCodeId: "nl-nen-en-1991-1-4" } }],
modelPlanInput), /andere norm/);
assert.throws(() => nbc2025ModelLoadPlan({ ...appliedBoth.model,
  loadPanels: appliedBoth.model.loadPanels.map((panel, index) => index === 0
    ? { ...panel, generated: { ...panel.generated, windCodeId: "nl-nen-en-1991-1-4" } } : panel) },
appliedBoth.loadCases, modelPlanInput), /andere norm/);
assert.throws(() => nbc2025ModelLoadPlan(appliedBoth.model, appliedBoth.loadCases,
  { ...modelPlanInput, nonWindLoadsVerifiedForNbc2025: false }), /expliciet ondersteund/);
const firstApplied = applied.model.loadPanels[0];
assert.throws(() => parseOpenFem3DModel({ ...applied.model,
  loadPanels: [{ ...firstApplied, q: firstApplied.q + 0.1 }] }), /ongeldig winddrukplan/);
assert.throws(() => parseOpenFem3DModel({ ...applied.model,
  loadPanels: [{ ...firstApplied, generated: { ...firstApplied.generated,
    windPressurePlan: { ...firstApplied.generated.windPressurePlan,
      pressure: { inwardKnPerM2: 0, outwardKnPerM2: 0 } } } }] }), /ongeldig winddrukplan/);

assert.throws(() => generateNbc2025EnvelopeWindLoads({ ...model,
  envelopePanels: model.envelopePanels.slice(0, 4) }, input), /vier volledige/);
assert.throws(() => generateNbc2025EnvelopeWindLoads({ ...model,
  envelopePanels: model.envelopePanels.map((panel) => panel.id === 5
    ? { ...panel, flipOuterSide: true } : panel) }, input), /omgekeerde buitenzijde/);
assert.throws(() => generateNbc2025EnvelopeWindLoads(model, { ...input, widthXM: 19 }), /Schilafmetingen/);
console.log("NBC 2025 op 3D-schil: vlakdekking, openingen, dakstroken en krachtbalans geslaagd");
