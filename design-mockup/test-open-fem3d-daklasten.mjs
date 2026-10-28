import assert from "node:assert/strict";
import { generateRoofAndCladdingLoads } from "./src/components/openFem3d/openFem3dRoofLoads.ts";
import { openFem3DEnvelopePanelGeometry } from "./src/components/openFem3d/openFem3dEnvelopePanels.ts";

const coords = [
  [0, 0, 4], [5, 0, 6], [5, 10, 6], [0, 10, 4],
  [5, 0, 6], [10, 0, 4], [10, 10, 4], [5, 10, 6],
  [1, 2, 4.4], [2, 2, 4.8], [2, 4, 4.8], [1, 4, 4.4],
];
const model = {
  nodes: coords.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay",
      openings: [{ id: 1, nodeIds: [9, 10, 11, 12] }], claddingWeightKnPerM2: 0.2 },
    { id: 2, nodeIds: [5, 6, 7, 8], type: "roof", distribution: "twoWay",
      claddingWeightKnPerM2: 0.1 },
  ],
};
const result = generateRoofAndCladdingLoads(model, {
  groundSnowKnPerM2: 0.7, snowExposure: 1, snowThermal: 1, imposedRoofKnPerM2: 0.4,
});
assert.equal(result.roofShape, "duo");
assert.deepEqual(result.cases.map((item) => item.type), ["snow", "snow", "snow", "live", "dead"]);
const projectedArea = (load) => {
  const panel = model.envelopePanels.find((item) => item.id === load.panelId);
  return load.triangle.areaM2 * Math.abs(openFem3DEnvelopePanelGeometry(model, panel).outwardNormal[2]);
};
const force = (caseKey) => result.loads.filter((load) => load.caseKey === caseKey).reduce((sum, load) =>
  sum + load.q * (load.direction === "gravity" ? projectedArea(load) : load.triangle.areaM2), 0);
assert.ok(Math.abs(force("envelope3d:snow:balanced") - 0.8 * 0.7 * 98) < 1e-8);
assert.ok(Math.abs(force("envelope3d:snow:drift:0") - 0.8 * 0.7 * (24 + 50)) < 1e-8);
assert.ok(Math.abs(force("envelope3d:snow:drift:1") - 0.8 * 0.7 * (48 + 25)) < 1e-8);
assert.ok(Math.abs(force("envelope3d:roof:live:H") - 0.4 * 98) < 1e-8);
const actualLeft = openFem3DEnvelopePanelGeometry(model, model.envelopePanels[0]).netAreaM2;
const actualRight = openFem3DEnvelopePanelGeometry(model, model.envelopePanels[1]).netAreaM2;
assert.ok(Math.abs(force("envelope3d:cladding:dead") - (0.2 * actualLeft + 0.1 * actualRight)) < 1e-8);
assert.deepEqual(generateRoofAndCladdingLoads(model, {
  groundSnowKnPerM2: 0.7, snowExposure: 1, snowThermal: 1, imposedRoofKnPerM2: 0.4,
}), result);
console.log("3D-daklasten: controles geslaagd");
