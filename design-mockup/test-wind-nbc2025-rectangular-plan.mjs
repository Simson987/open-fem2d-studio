import assert from "node:assert/strict";
import { nbc2025FrameStripLoads, nbc2025RectangularWindPlan
} from "./src/lib/wind/nbc2025RectangularWindPlan.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10,
  `${actual} != ${expected}`);
const input = {
  widthXM: 20, widthYM: 30, heightM: 10,
  naturalFrequencyHz: 1.2, naturalFrequencySource: "project modal analysis",
  noWakeOrChannelling: true,
  referencePressureKPa: 0.5, referencePressureSource: "verified project q1/500",
  importanceCategory: "normal", limitState: "uls", terrain: "open",
  topographicFactor: 1, topographicFactorSource: "level site, NBC 4.1.7.4",
  internalPressureCoefficientMin: -0.3, internalPressureCoefficientMax: 0.2,
  internalCoefficientSource: "verified project Cpi",
};
const cases = nbc2025RectangularWindPlan(input);
assert.equal(cases.length, 8);
assert.deepEqual(cases.map((item) => item.key), [
  "nbc2025:uls:+X:cpi:-0.3", "nbc2025:uls:+X:cpi:0.2",
  "nbc2025:uls:-X:cpi:-0.3", "nbc2025:uls:-X:cpi:0.2",
  "nbc2025:uls:+Y:cpi:-0.3", "nbc2025:uls:+Y:cpi:0.2",
  "nbc2025:uls:-Y:cpi:-0.3", "nbc2025:uls:-Y:cpi:0.2",
]);
const slsCases = nbc2025RectangularWindPlan({ ...input, limitState: "sls" });
assert.equal(slsCases.length, cases.length);
assert.ok(slsCases.every((item) => item.limitState === "sls" && !cases.some((uls) => uls.key === item.key)));
for (const [index, slsCase] of slsCases.entries()) {
  for (const [patchIndex, slsPatch] of slsCase.patches.entries()) {
    const ulsPatch = cases[index].patches[patchIndex];
    close(slsPatch.pressureDerivation.importanceFactor, 0.6);
    close(slsPatch.pressurePlan.pressure.outwardKnPerM2,
      ulsPatch.pressurePlan.pressure.outwardKnPerM2 * 0.6);
  }
}
const highUls = nbc2025RectangularWindPlan({ ...input, importanceCategory: "high" });
const highSls = nbc2025RectangularWindPlan({ ...input, importanceCategory: "high", limitState: "sls" });
close(highUls[0].patches[0].pressureDerivation.importanceFactor, 1.15);
close(highSls[0].patches[0].pressureDerivation.importanceFactor, 0.6);
close(highSls[0].patches[0].pressurePlan.pressure.outwardKnPerM2,
  highUls[0].patches[0].pressurePlan.pressure.outwardKnPerM2 * 0.6 / 1.15);
for (const windCase of cases) {
  assert.equal(windCase.patches.length, 6);
  assert.equal(windCase.patches.reduce((sum, patch) => sum + (patch.surface === "roof" ? patch.areaM2 : 0), 0), 600);
  for (const patch of windCase.patches) {
    assert.equal(patch.pressurePlan.codeId, "ca-nbc-2025");
    assert.equal(patch.pressurePlan.caseKey, windCase.key);
    assert.equal(patch.pressurePlan.basis.kind, "separate-pressures");
    assert.equal(patch.pressureDerivation.internalPressureCoefficient, windCase.internalPressureCoefficient);
    assert.equal(patch.referenceHeights.externalReferenceHeightM, 10);
    assert.equal(patch.referenceHeights.internalReferenceHeightM, 6);
    close(patch.resultantKn[0], patch.outwardNormal[0] * patch.areaM2
      * patch.pressurePlan.pressure.outwardKnPerM2);
    close(patch.resultantKn[1], patch.outwardNormal[1] * patch.areaM2
      * patch.pressurePlan.pressure.outwardKnPerM2);
    close(patch.resultantKn[2], patch.outwardNormal[2] * patch.areaM2
      * patch.pressurePlan.pressure.outwardKnPerM2);
  }
  const crosswindWidth = windCase.direction.endsWith("X") ? input.widthYM : input.widthXM;
  const strip = nbc2025FrameStripLoads(windCase, 2, 5);
  assert.equal(strip.length, 4);
  for (const load of strip) {
    const patch = windCase.patches.find((item) => item.pressurePlan.surfaceId === load.surfaceId);
    for (let axis = 0; axis < 3; axis++) {
      close(load.resultantKn[axis], patch.resultantKn[axis] * 3 / crosswindWidth);
      close(load.lineForceKnPerM[axis] * load.lengthM, load.resultantKn[axis]);
    }
  }
}
const plusX = cases[1];
const windward = plusX.patches.find((patch) => patch.surface === "windward");
const leeward = plusX.patches.find((patch) => patch.surface === "leeward");
const roofNear = plusX.patches.find((patch) => patch.pressurePlan.surfaceId === "roof-upwind");
const roofFar = plusX.patches.find((patch) => patch.pressurePlan.surfaceId === "roof-downwind");
close(windward.pressureDerivation.externalPressureCoefficient, 0.27 * (10 / 20 + 2));
close(leeward.pressureDerivation.externalPressureCoefficient, -0.27 * (10 / 20 + 0.88));
close(roofNear.pressureDerivation.externalPressureCoefficient, -1);
close(roofFar.pressureDerivation.externalPressureCoefficient, -0.5);
assert.deepEqual(roofNear.boundsM, { x0: 0, x1: 10, y0: 0, y1: 30, z0: 10, z1: 10 });
assert.deepEqual(roofFar.boundsM, { x0: 10, x1: 20, y0: 0, y1: 30, z0: 10, z1: 10 });

// Independent whole-building wall force: equal wall areas cancel the coherent
// internal pressure, leaving q × Ce × Cg × (Cp,windward − Cp,leeward) × area.
const expectedFx = 0.5 * 1 * 2 * (0.27 * 2.5 + 0.27 * 1.38) * 300;
for (const windCase of cases.filter((item) => item.direction === "+X")) {
  close(windCase.patches.reduce((sum, patch) => sum + patch.resultantKn[0], 0), expectedFx);
}
for (const windCase of cases.filter((item) => item.direction === "-X")) {
  close(windCase.patches.reduce((sum, patch) => sum + patch.resultantKn[0], 0), -expectedFx);
  assert.deepEqual(windCase.patches.find((patch) => patch.pressurePlan.surfaceId === "roof-upwind").boundsM,
    { x0: 10, x1: 20, y0: 0, y1: 30, z0: 10, z1: 10 });
}
const oneCpi = nbc2025RectangularWindPlan({ ...input,
  internalPressureCoefficientMin: 0, internalPressureCoefficientMax: 0 });
assert.equal(oneCpi.length, 4);
for (const [openingEvidence, expected] of [
  [{ kind: "uniform-small", openingAreaFraction: 0.0009, uniformlyDistributed: true,
    source: "opening schedule S-11" }, [-0.15, 0]],
  [{ kind: "other-or-closed", nonUniformlyDistributed: true, noSignificantOpening: true,
    source: "opening review S-12" }, [-0.45, 0.3]],
  [{ kind: "other-or-closed", significantOpeningsWindResistantAndStormClosed: true,
    source: "closure specification S-13" }, [-0.45, 0.3]],
  [{ kind: "large-open", likelyOpenDuringStorm: true,
    source: "opening operation S-14" }, [-0.7, 0.7]],
]) {
  const { internalPressureCoefficientMin, internalPressureCoefficientMax, internalCoefficientSource, ...base } = input;
  const classified = nbc2025RectangularWindPlan({ ...base, openingEvidence });
  assert.deepEqual(classified.slice(0, 2).map((item) => item.internalPressureCoefficient), expected);
  assert.ok(classified.every((item) => item.patches.every((patch) =>
    patch.pressureDerivation.internalCoefficientSource.includes(openingEvidence.source)
    && patch.pressureDerivation.internalCoefficientSource.includes("4.1.7.7"))));
}
const { internalPressureCoefficientMin, internalPressureCoefficientMax, internalCoefficientSource,
  ...baseWithoutManualCpi } = input;
assert.throws(() => nbc2025RectangularWindPlan({ ...baseWithoutManualCpi,
  openingEvidence: { kind: "uniform-small", openingAreaFraction: 0.001,
    uniformlyDistributed: true, source: "opening schedule" } }), /minder dan 0,1%/);
assert.throws(() => nbc2025RectangularWindPlan({ ...baseWithoutManualCpi,
  openingEvidence: { kind: "other-or-closed", source: "opening review" } }), /stormvast/);
assert.throws(() => nbc2025RectangularWindPlan({ ...baseWithoutManualCpi,
  openingEvidence: { kind: "other-or-closed", noSignificantOpening: true,
    source: "opening review" } }), /niet-uniforme/);
assert.throws(() => nbc2025RectangularWindPlan({ ...baseWithoutManualCpi,
  openingEvidence: { kind: "large-open", likelyOpenDuringStorm: false,
    source: "opening operation" } }), /waarschijnlijk open/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input,
  openingEvidence: { kind: "large-open", likelyOpenDuringStorm: true,
    source: "opening operation" } }), /Kies óf/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input, heightM: 20 }), /H kleiner/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input, naturalFrequencyHz: 0.8 }), /niet-dynamische/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input, noWakeOrChannelling: false }), /wake-/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input, naturalFrequencySource: "" }), /mist een bron/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input, internalPressureCoefficientMin: 0.3 }), /oplopend/);
assert.throws(() => nbc2025RectangularWindPlan({ ...input, referencePressureSource: "" }), /mist een bron/);
assert.throws(() => nbc2025FrameStripLoads(plusX, 5, 2), /spantstrook/);
assert.throws(() => nbc2025FrameStripLoads(plusX, 29, 31), /spantstrook/);
console.log("NBC 2025 rechthoekig druk- en vlakplan: 4 richtingen, c_pi-gevallen, zones en resultanten geslaagd");
