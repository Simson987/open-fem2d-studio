import assert from "node:assert/strict";
import { generateWind3DLoads } from "./src/components/openFem3d/openFem3dWindGeneration.ts";
import { cpeWand } from "./src/lib/wind/windEurocode.ts";

const coords = [
  [0, 0, 0], [0, 0, 5], [0, 10, 5], [0, 10, 0],
  [20, 0, 0], [20, 10, 0], [20, 10, 5], [20, 0, 5],
  [20, 0, 0], [20, 0, 5], [0, 0, 5], [0, 0, 0],
  [0, 10, 0], [0, 10, 5], [20, 10, 5], [20, 10, 0],
  [0, 0, 5], [20, 0, 5], [20, 10, 5], [0, 10, 5],
  [0, 1, 1], [0, 3, 1], [0, 3, 3], [0, 1, 3],
  [20, 2, 1], [20, 3.5, 1], [20, 3.5, 2], [20, 2, 2],
];
const panels = [
  [1, [1, 2, 3, 4], "facade"], [2, [5, 6, 7, 8], "facade"],
  [3, [9, 10, 11, 12], "facade"], [4, [13, 14, 15, 16], "facade"],
  [5, [17, 18, 19, 20], "roof"],
].map(([id, nodeIds, type]) => ({ id, nodeIds, type, distribution: "twoWay" }));
const model = { nodes: coords.map(([x, y, z], index) => ({ id: index + 1, x, y, z })),
  beams: [], envelopePanels: structuredClone(panels) };
const settings = { windgebied: "II", terreincategorie: "II", backgroundPermeabilityFraction: 0 };
const defaults = generateWind3DLoads(model, settings);
assert.deepEqual([...new Set(defaults.cases.filter((item) => item.direction === "+X").map((item) => item.cpi))], [0.2, -0.3]);
model.envelopePanels[0].openings = [{ id: 1, nodeIds: [21, 22, 23, 24] }];
model.envelopePanels[1].openings = [{ id: 1, nodeIds: [25, 26, 27, 28] }];
const generated = generateWind3DLoads(model, settings);
const ratio = 4 / 1.5;
const factor = 0.75 + 0.15 * (ratio - 2);
const expected = cpeWand(5 / 20);
const cpis = (direction) => [...new Set(generated.cases.filter((item) => item.direction === direction)
  .map((item) => item.cpi))];
assert.equal(cpis("+X").length, 1);
assert.ok(Math.abs(cpis("+X")[0] - factor * expected.D) < 1e-12);
assert.ok(Math.abs(cpis("-X")[0] - factor * expected.E) < 1e-12);
assert.ok(Math.abs(cpis("+Y")[0] - factor * (expected.A + expected.B) / 2) < 1e-12,
  "opening over A/B: oppervlaktegewogen c_pe");
assert.ok(generated.warnings.some((item) => item.includes("Dominante gevel -X")));
for (const direction of ["+X", "-X", "+Y", "-Y"]) {
  const cases = generated.cases.filter((item) => item.direction === direction);
  assert.ok(cases.every((item) => item.internalPressureDerivation.some((line) =>
    line.symbool === "r" && line.waarde.includes(ratio.toFixed(6)))));
  assert.ok(cases.every((item) => item.internalPressureDerivation.some((line) =>
    line.symbool === "c_pi" && line.waarde.includes(item.cpi.toFixed(6)))));
}
assert.ok(defaults.cases.every((item) => item.internalPressureDerivation[0].bron.includes("§7.2.9")));
assert.deepEqual(generateWind3DLoads(model, settings), generated);
console.log("3D-binnendruk uit dominante openingen: controles geslaagd");
