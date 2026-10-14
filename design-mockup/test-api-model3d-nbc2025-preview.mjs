import assert from "node:assert/strict";
import { standaardRegister } from "./src/api/standaardRegister.ts";
import { leegDocument } from "./src/api/projectDocument.ts";

const name = "model3d.nbc2025.previewWind";
const register = standaardRegister();
assert.ok(register.heeft(name));
const model = {
  nodes: [
    [0, 0, 0], [20, 0, 0], [20, 10, 0], [0, 10, 0],
    [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
  ].map(([x, y, z], index) => ({ id: index + 1, x, y, z })),
  beams: [],
  envelopePanels: [
    [1, [1, 5, 8, 4], "facade"], [2, [2, 3, 7, 6], "facade"],
    [3, [2, 6, 5, 1], "facade"], [4, [4, 8, 7, 3], "facade"],
    [5, [5, 6, 7, 8], "roof"],
  ].map(([id, nodeIds, type]) => ({ id, nodeIds, type, distribution: "twoWay" })),
};
const document = { ...leegDocument(), model3d: model };
const before = JSON.stringify(document);
const input = {
  windCodeId: "ca-nbc-2025", widthXM: 20, widthYM: 10, heightM: 5,
  naturalFrequencyHz: 1.2, naturalFrequencySource: "modal analysis W-17",
  noWakeOrChannelling: true, referencePressureKPa: 0.5,
  referencePressureSource: "project map q1/500 W-17", importanceCategory: "normal",
  terrain: "open", topographicFactor: 1, topographicFactorSource: "level site W-17",
  internalPressureCoefficientMin: -0.3, internalPressureCoefficientMax: 0.2,
  internalCoefficientSource: "verified openings W-17",
};
const result = register.voerUit(name, input, { document });
assert.equal(result.document, undefined, "proefplan mag het project niet wijzigen");
assert.equal(JSON.stringify(document), before);
assert.equal(result.uitkomst.windCodeId, "ca-nbc-2025");
assert.equal(result.uitkomst.cases.length, 16);
assert.equal(result.uitkomst.horizontalActions.length, 128);
assert.ok(result.uitkomst.loads.length > 0);
assert.ok(result.uitkomst.loads.every((item) => item.pressureDerivation.referencePressureSource
  === input.referencePressureSource && item.pressureDerivation.internalCoefficientSource
  === input.internalCoefficientSource));
for (const windCase of result.uitkomst.cases) {
  assert.ok(result.uitkomst.projectedHorizontalResultants[windCase.key]);
  assert.equal(windCase.patches.length, 6);
}
const repeat = register.voerUit(name, input, { document });
assert.deepEqual(repeat.uitkomst, result.uitkomst);
assert.throws(() => register.voerUit(name, { ...input, noWakeOrChannelling: false }, { document }),
  /niet-dynamische situatie/);
assert.throws(() => register.voerUit(name, { ...input, referencePressureSource: " " }, { document }),
  /mist een bron/);
assert.throws(() => register.voerUit(name, { ...input, widthXM: 19 }, { document }),
  /Schilafmetingen/);
assert.throws(() => register.voerUit(name, { ...input, windCodeId: "asce-7-22" }, { document }));
console.log("API NBC 2025-proefwind: 3D-druk, acties, bron en afwijzingen geslaagd");
