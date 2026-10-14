import assert from "node:assert/strict";
import { nbc2025CombinationPlan } from "./src/lib/wind/nbc2025Combinations.ts";
import { nbc2025RectangularWindPlan } from "./src/lib/wind/nbc2025RectangularWindPlan.ts";

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
const windCases = [
  ...nbc2025RectangularWindPlan({ ...geometry, limitState: "uls" }),
  ...nbc2025RectangularWindPlan({ ...geometry, limitState: "sls" }),
];
const windLoads = windCases.map((item, index) => ({ id: 5 + index, name: item.key,
  type: "wind", gegenereerd: { bron: "envelope3d", sleutel: item.key, windCodeId: "ca-nbc-2025" } }));
const loadCases = [{ id: 1, name: "D", type: "dead" }, { id: 2, name: "L", type: "live" },
  { id: 3, name: "S UGT", type: "snow" }, { id: 4, name: "S BGT", type: "snow" }, ...windLoads];
const input = { loadCases, windCases, snowCasePairs: [{ uls: 3, sls: 4 }], firstId: 100, deadLoadScope: "ordinary-only",
  nonWindLoadsVerifiedForNbc2025: true, liveUse: "ordinary",
  serviceability: "noncreep-deflection" };
const result = nbc2025CombinationPlan(input);
assert.equal(result.combinations.length, 133);
assert.deepEqual(result.combinations.map((item) => item.id),
  Array.from({ length: 133 }, (_, index) => index + 100));
assert.ok(result.ulsSource.includes("4.1.3.2.-A"));
assert.ok(result.slsSource.includes("4.1.3.4"));
const ulsIds = new Set(windLoads.slice(0, 8).map((item) => item.id));
const slsIds = new Set(windLoads.slice(8).map((item) => item.id));
for (const combination of result.combinations) {
  const windIds = [...combination.factors.keys()].filter((id) => ulsIds.has(id) || slsIds.has(id));
  assert.ok(windIds.length <= 1, "één samenhangend windgeval per combinatie");
  assert.ok(windIds.every((id) => combination.type === "uls" ? ulsIds.has(id) : slsIds.has(id)),
    "UGT en BGT gebruiken elk hun eigen druk en belangfactor");
  assert.ok(combination.formula.length > 0);
}
for (const item of windLoads) {
  const type = ulsIds.has(item.id) ? "uls" : "sls";
  assert.ok(result.combinations.some((combo) => combo.type === type
    && combo.factors.get(item.id) === 1), `wind ${item.id} heeft een leidende combinatie`);
  assert.ok(result.combinations.some((combo) => combo.type === type
    && combo.factors.get(item.id) === 0.3), `wind ${item.id} heeft een begeleidende combinatie`);
}
const has = (type, factors) => result.combinations.some((item) => item.type === type
  && item.factors.size === factors.size
  && [...factors].every(([id, factor]) => item.factors.get(id) === factor));
assert.ok(has("uls", new Map([[1, 1.4]])), "UGT 1: 1,4D");
assert.ok(has("uls", new Map([[1, 1.25], [2, 1.5], [3, 0.7]])), "UGT 2: L leidend, S begeleidend");
assert.ok(has("uls", new Map([[1, 0.9], [3, 1], [5, 0.3]])), "UGT 3: S leidend, wind begeleidend");
assert.ok(has("uls", new Map([[1, 1.25], [2, 0.5], [5, 1]])), "UGT 4: wind leidend, L begeleidend");
assert.ok(has("uls", new Map([[1, 0.9], [3, 0.35], [5, 1]])), "UGT 4: gunstige D en S begeleidend");
assert.ok(has("sls", new Map([[1, 1], [2, 1], [13, 0.3]])), "BGT 1: L leidend, BGT-wind begeleidend");
assert.ok(has("sls", new Map([[1, 1], [2, 0.35], [13, 1]])), "BGT 2: BGT-wind leidend");
assert.ok(has("sls", new Map([[1, 1], [4, 1], [13, 0.3]])), "BGT 3: S leidend, BGT-wind begeleidend");
assert.ok(!result.combinations.some((item) => item.type === "sls" && item.factors.has(3)),
  "BGT mag UGT-sneeuw niet hergebruiken");
const storage = nbc2025CombinationPlan({ ...input, liveUse: "storage-equipment" });
assert.ok(storage.combinations.some((item) => item.type === "uls"
  && item.factors.get(5) === 1 && item.factors.get(2) === 1));
assert.ok(storage.combinations.some((item) => item.type === "sls"
  && item.factors.get(13) === 1 && item.factors.get(2) === 0.5));
const windOnly = nbc2025CombinationPlan({ ...input,
  loadCases: loadCases.filter((item) => item.type !== "live" && item.type !== "snow"), snowCasePairs: undefined });
assert.equal(windOnly.combinations.length, 25);
const partialSnow = nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases, { id: 21, name: "S UGT half dak", type: "snow" },
    { id: 22, name: "S BGT half dak", type: "snow" }],
  snowCasePairs: [{ uls: 3, sls: 4 }, { uls: 21, sls: 22 }] });
assert.equal(partialSnow.combinations.length, 190);
assert.equal(new Set(partialSnow.combinations.map((item) => item.name)).size, 190);
for (const combination of partialSnow.combinations) {
  const snowIds = [3, 4, 21, 22].filter((id) => combination.factors.has(id));
  assert.ok(snowIds.length <= 1, "sneeuwverdelingen worden niet opgeteld");
  assert.ok(snowIds.every((id) => combination.type === "uls" ? id === 3 || id === 21 : id === 4 || id === 22),
    "elk sneeuwpatroon gebruikt zijn eigen grenstoestand");
}
for (const id of [3, 4, 21, 22]) {
  assert.ok(partialSnow.combinations.some((item) => item.factors.get(id) === 1),
    `sneeuwpatroon ${id} heeft een leidende combinatie`);
}
assert.throws(() => nbc2025CombinationPlan({ ...input,
  windCases: windCases.slice(0, 8) }), /overeenkomstige UGT- en BGT|één-op-één/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases, { id: 21, name: "andere wind", type: "wind" }] }), /één-op-één/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases, { id: 1, name: "dubbel", type: "dead" }] }), /dubbel id/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases, { id: 21, name: "aardbeving", type: "other" }] }), /overige lastsoorten/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases, { id: 21, name: "L2", type: "live" }] }), /hoogstens één/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: loadCases.filter((item) => item.id !== 4) }), /volledige, unieke UGT\/BGT-paren/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  snowCasePairs: [{ uls: 3, sls: 3 }] }), /volledige, unieke UGT\/BGT-paren/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases, { id: 21, name: "ongepaarde sneeuw", type: "snow" }] }),
  /volledige, unieke UGT\/BGT-paren/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  loadCases: [...loadCases.filter((item) => item.id !== 6),
    { ...windLoads[0], id: 6 }] }), /één-op-één/);
assert.throws(() => nbc2025CombinationPlan({ ...input,
  nonWindLoadsVerifiedForNbc2025: false }), /expliciet ondersteund/);
console.log("NBC 2025 D/L/S/W-combinaties: normrijen, gescheiden windgevallen en afwijzingen geslaagd");
