import assert from "node:assert/strict";
import { generateFlatRoofWindZones } from "./src/components/openFem3d/openFem3dFlatRoofWind.ts";

const coords = [
  [0, 0], [20, 0], [20, 10], [0, 10],
  [0.5, 1], [1.5, 1], [1.5, 2], [0.5, 2],
];
const model = {
  nodes: coords.map(([x, y], index) => ({ id: index + 1, x, y, z: 5 })), beams: [],
  envelopePanels: [{ id: 1, nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay",
    openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] }],
};
const result = generateFlatRoofWindZones(model, 5);
const loads = result.zones.filter((zone) => zone.direction === "+X" && zone.variant === "I-suction");
const area = (zone) => loads.filter((item) => item.zone === zone)
  .reduce((sum, item) => sum + item.triangle.areaM2, 0);
for (const [zone, expected] of [["F", 4.5], ["G", 5], ["H", 39.5], ["I", 150]]) {
  assert.ok(Math.abs(area(zone) - expected) < 1e-8, `${zone}: exacte zone-oppervlakte`);
}
assert.ok(Math.abs(loads.reduce((sum, item) => sum + item.triangle.areaM2, 0) - 199) < 1e-8);
assert.ok(loads.filter((item) => item.zone === "I").every((item) => item.cpe === -0.2));
assert.ok(result.zones.filter((item) => item.zone === "I" && item.variant === "I-pressure")
  .every((item) => item.cpe === 0.2));
assert.deepEqual(generateFlatRoofWindZones(model, 5), result);
console.log("3D-platdakwind: controles geslaagd");
