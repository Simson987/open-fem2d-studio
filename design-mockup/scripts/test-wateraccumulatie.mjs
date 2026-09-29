import assert from "node:assert/strict";
import { calculateWaterAccumulation2D } from "../src/lib/waterAccumulation2d.ts";

// Blaauwendraad, Bouwen met Staal (2006), voorbeeld 1: de onafhankelijke
// computerberekening geeft M = 253 kNm. Onze balk-FE levert ~254 kNm.
const reference = calculateWaterAccumulation2D({
  spanM: 15, tributaryWidthM: 5, eiKnm2: 70_900,
  waterLevelAboveLeftM: 0.1, initialSagMm: 16,
});
assert.equal(reference.status, "converged");
assert.ok(Math.abs(reference.maxMomentKnm - 253) < 3,
  `Blaauwendraad-voorbeeld: ${reference.maxMomentKnm} kNm`);
assert.ok(Math.abs(reference.reactionsKn[0] + reference.reactionsKn[1] - reference.totalWaterLoadKn) < 1e-9);

const reducedStiffness = calculateWaterAccumulation2D({
  spanM: 15, tributaryWidthM: 5, eiKnm2: 70_900,
  waterLevelAboveLeftM: 0.1, initialSagMm: 16,
  stiffnessModelFactor: 1.3,
});
assert.equal(reducedStiffness.status, "converged");
assert.ok(Math.abs(reducedStiffness.effectiveEiKnm2 - 70_900 / 1.3) < 1e-9);
assert.ok(reducedStiffness.maxMomentKnm > reference.maxMomentKnm * 1.2,
  "de stijfheidsreductie moet het accumulatiemoment vergroten");

const flat = calculateWaterAccumulation2D({
  spanM: 6, tributaryWidthM: 3, eiKnm2: 10_000, waterLevelAboveLeftM: 0.1,
});
const baseMoment = 10 * 3 * 0.1 * 6 ** 2 / 8;
assert.ok(flat.maxMomentKnm > baseMoment, "doorbuiging moet de waterlast vergroten");
assert.ok(Math.abs(flat.reactionsKn[0] - flat.reactionsKn[1]) < 1e-7);
assert.ok(flat.maxWaterDepthM > 0.1);

const cambered = calculateWaterAccumulation2D({
  spanM: 6, tributaryWidthM: 3, eiKnm2: 10_000,
  waterLevelAboveLeftM: 0.1, camberMm: 30,
});
assert.ok(cambered.totalWaterLoadKn < flat.totalWaterLoadKn);

const sloped = calculateWaterAccumulation2D({
  spanM: 6, tributaryWidthM: 3, eiKnm2: 10_000,
  waterLevelAboveLeftM: 0.1, slopePercent: 3,
});
assert.equal(sloped.points.at(-1).waterDepthMm, 0);

const unstable = calculateWaterAccumulation2D({
  spanM: 6, tributaryWidthM: 3, eiKnm2: 100, waterLevelAboveLeftM: 0.1,
});
assert.equal(unstable.status, "unstable");
assert.ok(unstable.stiffnessRatio < 1);

// Blaauwendraad: bij n < 1 kan een dak met afschot toch een beperkt, stabiel waterbekken hebben.
const slopedSubcritical = calculateWaterAccumulation2D({
  spanM: 6, tributaryWidthM: 3, eiKnm2: 100,
  waterLevelAboveLeftM: 0.01, slopePercent: 1,
});
assert.ok(slopedSubcritical.stiffnessRatio < 1);
assert.equal(slopedSubcritical.status, "converged");
assert.equal(slopedSubcritical.points.at(-1).waterDepthMm, 0);

console.log("Wateraccumulatie 2D: Blaauwendraad-voorbeeld, γM, evenwicht, zeeg, afschot en instabiliteit OK.");
