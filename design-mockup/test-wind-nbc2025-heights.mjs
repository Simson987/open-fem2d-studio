import assert from "node:assert/strict";
import {
  NBC_2025_REFERENCE_HEIGHT_SOURCE, nbc2025MainSurfacePressureFromGeometry,
  nbc2025MainSurfacePressureEnvelopeFromGeometry, nbc2025ReferenceHeights,
} from "./src/lib/wind/nbc2025ReferenceHeights.ts";

const low = { smallerPlanDimensionM: 12, roofMidHeightM: 4,
  buildingMidHeightM: 5, windwardPointHeightM: 2, hasDominantOpening: false };
const lowHeights = nbc2025ReferenceHeights("windward", 10, low);
assert.equal(lowHeights.source, NBC_2025_REFERENCE_HEIGHT_SOURCE);
assert.equal(lowHeights.lowBuildingRule, true);
assert.equal(lowHeights.externalReferenceHeightM, 6);
assert.equal(lowHeights.internalReferenceHeightM, 6);
assert.equal(nbc2025ReferenceHeights("roof", 10, { ...low,
  roofMidHeightM: 8 }).externalReferenceHeightM, 8);

const tall = { smallerPlanDimensionM: 12, roofMidHeightM: 28,
  buildingMidHeightM: 15, windwardPointHeightM: 12,
  hasDominantOpening: true, dominantOpeningMidHeightM: 21 };
const windward = nbc2025ReferenceHeights("windward", 30, tall);
assert.equal(windward.lowBuildingRule, false);
assert.equal(windward.externalReferenceHeightM, 12);
assert.equal(windward.internalReferenceHeightM, 21);
assert.equal(nbc2025ReferenceHeights("leeward", 30, tall).externalReferenceHeightM, 15);
assert.equal(nbc2025ReferenceHeights("parallelWall", 30, tall).externalReferenceHeightM, 28);
assert.equal(nbc2025ReferenceHeights("roof", 30, tall).externalReferenceHeightM, 28);
assert.equal(nbc2025ReferenceHeights("windward", 20, { ...tall,
  smallerPlanDimensionM: 20 }).lowBuildingRule, false);
assert.equal(nbc2025ReferenceHeights("windward", 30, { ...tall,
  hasDominantOpening: false, dominantOpeningMidHeightM: undefined }).internalReferenceHeightM, 15);
assert.equal(nbc2025ReferenceHeights("windward", 30, { ...tall,
  dominantOpeningMidHeightM: 3 }).internalReferenceHeightM, 3);

const input = {
  referencePressureKPa: 0.5,
  referencePressureSource: "NBC q1/500 fixture",
  importanceCategory: "normal", limitState: "uls", terrain: "open",
  topographicFactor: 1, topographicFactorSource: "NBC 4.1.7.4(1)",
  internalPressureCoefficient: 0.2, internalCoefficientSource: "NBC Cpi fixture",
  surface: "windward", buildingHeightM: 30, parallelPlanWidthM: 12,
  referenceGeometry: tall,
};
const { referenceHeights, pressure } = nbc2025MainSurfacePressureFromGeometry(input);
assert.deepEqual(referenceHeights, windward);
assert.equal(pressure.externalReferenceHeightM, 12);
assert.equal(pressure.internalReferenceHeightM, 21);
const { envelope } = nbc2025MainSurfacePressureEnvelopeFromGeometry({ ...input,
  internalPressureCoefficientMin: -0.3, internalPressureCoefficientMax: 0.2 });
assert.equal(envelope.minimumNetPressure.externalReferenceHeightM, 12);
assert.equal(envelope.maximumNetPressure.internalReferenceHeightM, 21);
assert.ok(envelope.minimumNetPressure.netPressureKPa < envelope.maximumNetPressure.netPressureKPa);

assert.throws(() => nbc2025ReferenceHeights("windward", 30,
  { ...tall, windwardPointHeightM: undefined }), /loefgevelpunt/);
assert.throws(() => nbc2025ReferenceHeights("windward", 30,
  { ...tall, dominantOpeningMidHeightM: -1 }), /dominante opening/);
assert.throws(() => nbc2025ReferenceHeights("windward", 30,
  { ...tall, dominantOpeningMidHeightM: undefined }), /Dominante opening vraagt/);
assert.throws(() => nbc2025ReferenceHeights("other", 10, low), /onbekend/);
console.log("NBC 2025-referentiehoogten: normregels en drukafleiding geslaagd");
