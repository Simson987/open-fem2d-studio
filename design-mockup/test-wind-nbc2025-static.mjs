import assert from "node:assert/strict";
import { nbc2025ExposureFactor, nbc2025MainPressureCoefficient,
  nbc2025MainSurfacePressure, nbc2025MainSurfacePressureEnvelope,
  nbc2025ReducedInternalGustFactor, nbc2025StaticPressure, nbc2025TopographicFactor,
  NBC_2025_INTERNAL_GUST_SOURCE, NBC_2025_MAIN_CP_SOURCE,
  NBC_2025_TOPOGRAPHY_SOURCE } from "./src/lib/wind/nbc2025StaticWind.ts";

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12,
  `${actual} != ${expected}`);
const basic = {
  referencePressureKPa: 0.5,
  referencePressureSource: "NBC climatic-data fixture, q1/500",
  importanceCategory: "normal",
  limitState: "uls",
  terrain: "open",
  externalReferenceHeightM: 10,
  internalReferenceHeightM: 6,
  component: "main",
  topographicFactor: 1,
  topographicFactorSource: "NBC 4.1.7.4(1), level site",
  externalPressureCoefficient: 0.8,
  externalCoefficientSource: "NBC Cp fixture",
  internalPressureCoefficient: 0.2,
  internalCoefficientSource: "NBC Cpi fixture",
};

close(nbc2025ExposureFactor("open", 10), 1);
close(nbc2025ExposureFactor("open", 1), 0.9);
close(nbc2025ExposureFactor("rough", 12), 0.7);
close(nbc2025ExposureFactor("rough", 1), 0.7);
const hill = {
  shape: "twoDimensionalHill", hillHeightM: 30, upwindHalfHeightDistanceM: 100,
  distanceFromCrestM: 0, side: "upwind", heightAboveGroundM: 0, component: "main",
};
const crest = nbc2025TopographicFactor(hill);
close(crest.slope, 0.15);
close(crest.speedUp, 0.66);
close(crest.factor, 1.33 * 1.66);
assert.equal(crest.source, NBC_2025_TOPOGRAPHY_SOURCE);
close(nbc2025TopographicFactor({ ...hill, hillHeightM: 20 }).factor, 1);
close(nbc2025TopographicFactor({ ...hill, distanceFromCrestM: 150 }).factor, 1);
close(nbc2025TopographicFactor({ ...hill, distanceFromCrestM: 75,
  heightAboveGroundM: 10 }).speedUp, 0.33 * Math.exp(-0.3));
const escarpment = nbc2025TopographicFactor({ ...hill, shape: "twoDimensionalEscarpment",
  side: "downwind", distanceFromCrestM: 200, component: "secondary" });
close(escarpment.speedUp, 0.195);
close(escarpment.factor, (1 + 0.195 / 2.5) * 1.195);
const capped = nbc2025TopographicFactor({ ...hill, hillHeightM: 60 });
close(capped.effectiveLengthM, 120);
close(capped.speedUp, 1.1);
const hilledPressure = nbc2025StaticPressure({ ...basic, topographicFactor: crest.factor,
  topographicFactorSource: crest.source });
close(hilledPressure.externalPressureKPa, 0.8 * crest.factor);
const result = nbc2025StaticPressure(basic);
assert.equal(result.annualExceedanceProbability, 1 / 500);
assert.equal(result.referencePressureSource, basic.referencePressureSource);
assert.equal(result.externalCoefficientSource, basic.externalCoefficientSource);
close(result.externalPressureKPa, 0.8);
close(result.internalPressureKPa, 0.5 * Math.max(0.9, (6 / 10) ** 0.2) * 2 * 0.2);
close(result.netPressureKPa, result.externalPressureKPa - result.internalPressureKPa);
close(result.internalGustFactor, 2);
assert.equal(result.internalGustFactorSource, NBC_2025_INTERNAL_GUST_SOURCE);

// NRC Structural Commentaries, NBC 2020, Commentary I para. 23-24:
// https://nrc-publications.canada.ca/eng/view/object/?id=b9fddc27-86f2-496b-9aa4-b66c45164ba6
// A 100,000 m³ undivided building with one 5 m² opening gives Cgi = 1.51 when
// cladding flexibility is neglected. NBC 2025 4.1.7.3.(10) retains this formula.
const reducedInternalGust = { internalVolumeM3: 100_000, exteriorOpeningAreaM2: 5,
  singleLargeUnpartitionedVolume: true, noNumerousOverheadDoorsOrOpenings: true };
const exampleCgi = nbc2025ReducedInternalGustFactor(reducedInternalGust);
assert.ok(Math.abs(exampleCgi - 1.51) < 0.005, `Published Cgi 1.51, got ${exampleCgi}`);
const reduced = nbc2025StaticPressure({ ...basic, reducedInternalGust });
close(reduced.internalGustFactor, exampleCgi);
close(reduced.internalPressureKPa, result.internalPressureKPa * exampleCgi / 2);
close(reduced.netPressureKPa, reduced.externalPressureKPa - reduced.internalPressureKPa);

const high = nbc2025StaticPressure({ ...basic, importanceCategory: "high", terrain: "rough",
  externalReferenceHeightM: 12, internalReferenceHeightM: 6,
  externalPressureCoefficient: -0.5, internalPressureCoefficient: -0.3 });
close(high.importanceFactor, 1.15);
close(high.externalPressureKPa, -0.4025);
close(high.internalPressureKPa, -0.2415);
close(high.netPressureKPa, -0.161);
const sls = nbc2025StaticPressure({ ...basic, importanceCategory: "post-disaster", limitState: "sls",
  component: "secondary", internalPressureCoefficient: 0 });
close(sls.importanceFactor, 0.6);
close(sls.externalGustFactor, 2.5);
close(sls.externalPressureKPa, 0.6 * 0.5 * 1 * 2.5 * 0.8);

close(nbc2025MainPressureCoefficient("windward", 2, 10), 0.6);
close(nbc2025MainPressureCoefficient("windward", 2.5, 10), 0.27 * (0.25 + 2));
close(nbc2025MainPressureCoefficient("windward", 10, 10), 0.8);
close(nbc2025MainPressureCoefficient("leeward", 2, 10), -0.3);
close(nbc2025MainPressureCoefficient("leeward", 2.5, 10), -0.27 * (0.25 + 0.88));
close(nbc2025MainPressureCoefficient("leeward", 10, 10), -0.5);
close(nbc2025MainPressureCoefficient("parallelWall", 6, 12), -0.7);
close(nbc2025MainPressureCoefficient("roof", 6, 12, 6), -1);
close(nbc2025MainPressureCoefficient("roof", 6, 12, 6.001), -0.5);
close(nbc2025MainPressureCoefficient("roof", 12, 12, 12), -1);
const surface = nbc2025MainSurfacePressure({ ...basic, surface: "windward",
  buildingHeightM: 10, parallelPlanWidthM: 10 });
close(surface.externalPressureCoefficient, 0.8);
close(surface.netPressureKPa, result.netPressureKPa);
assert.equal(surface.externalCoefficientSource, NBC_2025_MAIN_CP_SOURCE);
const envelopeInput = { ...basic, surface: "windward", buildingHeightM: 10,
  parallelPlanWidthM: 10, internalPressureCoefficientMin: -0.3,
  internalPressureCoefficientMax: 0.2 };
const envelope = nbc2025MainSurfacePressureEnvelope(envelopeInput);
close(envelope.minimumNetPressure.netPressureKPa, result.netPressureKPa);
close(envelope.maximumNetPressure.internalPressureKPa,
  -0.5 * Math.max(0.9, (6 / 10) ** 0.2) * 2 * 0.3);
assert.ok(envelope.minimumNetPressure.netPressureKPa < envelope.maximumNetPressure.netPressureKPa);
assert.equal(envelope.maximumNetPressure.internalCoefficientSource, basic.internalCoefficientSource);

assert.throws(() => nbc2025StaticPressure({ ...basic, referencePressureKPa: 0 }), /Referentiedruk/);
assert.throws(() => nbc2025StaticPressure({ ...basic, referencePressureSource: "" }), /bron/);
assert.throws(() => nbc2025StaticPressure({ ...basic, topographicFactor: 0.9 }), /niet verlagen/);
assert.throws(() => nbc2025ExposureFactor("transition", 10), /interpolatie/);
assert.throws(() => nbc2025MainPressureCoefficient("roof", 6, 12), /afstand/);
assert.throws(() => nbc2025MainPressureCoefficient("roof", 6, 12, 13), /afstand/);
assert.throws(() => nbc2025StaticPressure({ ...basic, externalPressureCoefficient: Infinity }), /eindig/);
assert.throws(() => nbc2025ReducedInternalGustFactor({ ...reducedInternalGust,
  singleLargeUnpartitionedVolume: false }), /onverdeeld volume/);
assert.throws(() => nbc2025ReducedInternalGustFactor({ ...reducedInternalGust,
  exteriorOpeningAreaM2: 0 }), /Buitenopeningen/);
assert.throws(() => nbc2025TopographicFactor({ ...hill, distanceFromCrestM: -1 }), /niet-negatief/);
assert.throws(() => nbc2025TopographicFactor({ ...hill, side: "other" }), /onbekend/);
assert.throws(() => nbc2025MainSurfacePressureEnvelope({ ...envelopeInput,
  internalPressureCoefficientMin: 0.3 }), /omgekeerde volgorde/);
assert.throws(() => nbc2025MainSurfacePressureEnvelope({ ...envelopeInput,
  internalPressureCoefficientMax: Infinity }), /eindig/);
console.log("NBC 2025 statische winddruk: formule- en invoercontroles geslaagd");
