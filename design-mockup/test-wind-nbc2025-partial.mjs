import assert from "node:assert/strict";
import { nbc2025RectangularWindPlan } from "./src/lib/wind/nbc2025RectangularWindPlan.ts";
import { nbc2025HorizontalWindActions } from "./src/lib/wind/nbc2025PartialWind.ts";

const geometry = {
  widthXM: 20, widthYM: 30, heightM: 10,
  naturalFrequencyHz: 1.2, naturalFrequencySource: "project modal analysis",
  noWakeOrChannelling: true,
  referencePressureKPa: 0.5, referencePressureSource: "project q1/500",
  importanceCategory: "normal", terrain: "open",
  topographicFactor: 1, topographicFactorSource: "level site",
  internalPressureCoefficientMin: -0.3, internalPressureCoefficientMax: 0.2,
  internalCoefficientSource: "opening schedule",
};
const wind = nbc2025RectangularWindPlan({ ...geometry, limitState: "uls" });
const actions = nbc2025HorizontalWindActions(wind, geometry.widthXM, geometry.widthYM);
assert.equal(actions.length, 64);
assert.deepEqual(["a", "b", "c", "d"].map((pattern) => actions.filter((item) => item.pattern === pattern).length),
  [8, 16, 8, 32]);
const cpi = -0.3;
const fullX = actions.find((item) => item.pattern === "a" && item.internalPressureCoefficient === cpi
  && item.pressureCaseKeys[0].includes(":+X:"));
const fullY = actions.find((item) => item.pattern === "a" && item.internalPressureCoefficient === cpi
  && item.pressureCaseKeys[0].includes(":+Y:"));
const diagonal = actions.find((item) => item.pattern === "c" && item.internalPressureCoefficient === cpi
  && item.pressureCaseKeys[0] === fullX.pressureCaseKeys[0]
  && item.pressureCaseKeys[1] === fullY.pressureCaseKeys[0]);
assert.ok(Math.abs(diagonal.fxKn - 0.75 * fullX.fxKn) < 1e-9);
assert.ok(Math.abs(diagonal.fyKn - 0.75 * fullY.fyKn) < 1e-9);
assert.ok(Math.abs(diagonal.baseMyKnM - 0.75 * fullX.baseMyKnM) < 1e-9);
assert.ok(Math.abs(diagonal.baseMxKnM - 0.75 * fullY.baseMxKnM) < 1e-9);
assert.equal(diagonal.mzKnM, 0);
assert.equal(diagonal.pressureCaseKeys.length, 2);
const eccentricX = actions.filter((item) => item.pattern === "b"
  && item.pressureCaseKeys[0] === fullX.pressureCaseKeys[0]);
assert.deepEqual(eccentricX.map((item) => item.offsetYM), [-4.5, 4.5]);
assert.ok(eccentricX.every((item) => Math.abs(item.fxKn - 0.75 * fullX.fxKn) < 1e-9));
assert.ok(eccentricX.every((item) => Math.abs(item.mzKnM + item.offsetYM * item.fxKn) < 1e-9));
const eccentricDiagonal = actions.filter((item) => item.pattern === "d"
  && item.pressureCaseKeys[0] === fullX.pressureCaseKeys[0]
  && item.pressureCaseKeys[1] === fullY.pressureCaseKeys[0]);
assert.equal(eccentricDiagonal.length, 4);
assert.ok(eccentricDiagonal.every((item) => Math.abs(item.fxKn - 0.56 * fullX.fxKn) < 1e-9
  && Math.abs(item.fyKn - 0.56 * fullY.fyKn) < 1e-9
  && Math.abs(item.mzKnM - (item.offsetXM * item.fyKn - item.offsetYM * item.fxKn)) < 1e-9));
assert.throws(() => nbc2025HorizontalWindActions(wind.slice(1), 20, 30), /vier unieke|volledige/);
assert.throws(() => nbc2025HorizontalWindActions(wind, 0, 30), /positieve/);
assert.throws(() => nbc2025HorizontalWindActions(wind, 20, 30,
  new Map([[wind[0].key, { fxKn: 1, fyKn: 0, baseMxKnM: 0, baseMyKnM: 5, centerMzKnM: 0 }]])),
  /projectieresultante/);
const sls = nbc2025RectangularWindPlan({ ...geometry, limitState: "sls" });
assert.throws(() => nbc2025HorizontalWindActions([...wind, ...sls], 20, 30), /Meng geen/);
console.log("NBC 2025 4.1.7.9: volledige, excentrische en orthogonale horizontale acties geslaagd");
