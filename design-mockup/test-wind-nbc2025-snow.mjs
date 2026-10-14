import assert from "node:assert/strict";
import { nbc2025FlatRoofSnowPressure } from "./src/lib/wind/nbc2025Snow.ts";

const input = {
  widthXM: 20, widthYM: 10, groundSnowKPa: 2, groundSnowSource: "project Ss 1/1000",
  associatedRainKPa: 0.2, associatedRainSource: "project Sr 1/1000",
  windExposureFactor: 1, windExposureSource: "winter climate and shelter review",
  thermalFactor: 1, thermalFactorSource: "unknown indoor temperature: 4.1.6.2(11)",
  importanceCategory: "normal", noAdditionalAccumulation: true,
  accumulationEvidenceSource: "no higher roof, nearby building, roof projection or sliding snow",
};
const uls = nbc2025FlatRoofSnowPressure(input, "uls");
const sls = nbc2025FlatRoofSnowPressure(input, "sls");
assert.equal(uls.characteristicLengthM, 15);
assert.equal(uls.basicRoofFactor, 0.8);
assert.equal(uls.pressureKPa, 1.8);
assert.equal(sls.pressureKPa, 1.08);
assert.equal(uls.importanceFactor, 1);
assert.equal(sls.importanceFactor, 0.6);
assert.ok(uls.source.includes("4.1.6.2"));
const high = nbc2025FlatRoofSnowPressure({ ...input, importanceCategory: "high" }, "uls");
assert.ok(Math.abs(high.pressureKPa - 2.07) < 1e-12);
const large = nbc2025FlatRoofSnowPressure({ ...input, widthXM: 200, widthYM: 100 }, "uls");
assert.equal(large.characteristicLengthM, 150);
assert.ok(Math.abs(large.basicRoofFactor - (1 - 0.2 * Math.exp(-0.8))) < 1e-12);
assert.throws(() => nbc2025FlatRoofSnowPressure({ ...input, associatedRainKPa: 2 }, "uls"), /niet overschrijden/);
assert.throws(() => nbc2025FlatRoofSnowPressure({ ...input, windExposureFactor: 0.8,
  importanceCategory: "high" }, "uls"), /C_w ≥ 1/);
assert.throws(() => nbc2025FlatRoofSnowPressure({ ...input, thermalFactor: 0.6 }, "uls"), /eindige/);
assert.throws(() => nbc2025FlatRoofSnowPressure({ ...input, noAdditionalAccumulation: false }, "uls"), /ophoping/);
assert.throws(() => nbc2025FlatRoofSnowPressure({ ...input, groundSnowSource: "" }, "uls"), /bron/);
console.log("NBC 2025 sneeuw: UGT/BGT-belang, Cb, Sr-grens en invoercontrole geslaagd");
