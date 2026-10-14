import assert from "node:assert/strict";
import { generatePitchedRoofWindZones } from "./src/components/openFem3d/openFem3dPitchedRoofWind.ts";
import { generateWind3DLoads } from "./src/components/openFem3d/openFem3dWindGeneration.ts";
import { berekenStuwdruk } from "./src/lib/wind/windEurocode.ts";

const rise = 5 * Math.tan(15 * Math.PI / 180);
const node = (id, x, y, z) => ({ id, x, y, z });
const panel = (id, nodeIds) => ({ id, nodeIds, type: "roof", distribution: "twoWay", openings: [] });
const mono = {
  nodes: [node(1, 0, 0, 5), node(2, 10, 0, 5 + 2 * rise),
    node(3, 10, 20, 5 + 2 * rise), node(4, 0, 20, 5)], beams: [],
  envelopePanels: [panel(1, [1, 2, 3, 4])],
};
const duo = {
  nodes: [node(1, 0, 0, 5), node(2, 5, 0, 5 + rise),
    node(3, 5, 20, 5 + rise), node(4, 0, 20, 5),
    node(5, 10, 0, 5), node(6, 10, 20, 5)], beams: [],
  envelopePanels: [panel(1, [1, 2, 3, 4]), panel(2, [2, 5, 6, 3])],
};
for (const [model, shape] of [[mono, "mono"], [duo, "duo"]]) {
  const result = generatePitchedRoofWindZones(model, 5 + rise);
  assert.equal(result.shape, shape);
  const expectedArea = 200 / Math.cos(15 * Math.PI / 180);
  for (const { direction, variant } of result.variants) {
    const zones = result.zones.filter((zone) => zone.direction === direction && zone.variant === variant);
    const area = zones.reduce((sum, zone) => sum + zone.triangle.areaM2, 0);
    assert.ok(Math.abs(area - expectedArea) < 1e-7, `${shape} ${direction} ${variant}: netto dakoppervlak`);
    assert.ok(zones.every((zone) => Number.isFinite(zone.cpe) && zone.sourceReference.includes("NB.")));
  }
  assert.deepEqual(generatePitchedRoofWindZones(model, 5 + rise), result);
}
const m = generatePitchedRoofWindZones(mono, 5 + rise);
assert.ok(m.variants.some(({ direction, variant }) => direction === "+X" && variant === "dak:pos"));
assert.ok(m.zones.some(({ direction, zone }) => direction === "+Y" && zone === "Fhoog"));
assert.ok(m.zones.some(({ direction, zone }) => direction === "+Y" && zone === "Flaag"));
const d = generatePitchedRoofWindZones(duo, 5 + rise);
assert.ok(d.variants.some(({ direction, variant }) => direction === "+X" && variant.includes("loef:pos")));
assert.ok(d.zones.some(({ direction, zone }) => direction === "+X" && zone === "J"));
const building = structuredClone(duo);
building.nodes.push(node(7, 0, 0, 0), node(8, 0, 20, 0),
  node(9, 10, 0, 0), node(10, 10, 20, 0));
building.envelopePanels.push(
  { ...panel(3, [7, 1, 4, 8]), type: "facade" },
  { ...panel(4, [9, 10, 6, 5]), type: "facade" },
  { ...panel(5, [7, 9, 5, 1]), type: "facade" },
  { ...panel(6, [8, 4, 6, 10]), type: "facade" },
);
const combined = generateWind3DLoads(building, { windgebied: "II", terreincategorie: "II" });
assert.ok(combined.cases.length > 8, "dakvarianten worden aparte windgevallen");
const combinedCase = combined.cases.find((item) => item.direction === "+X" && item.cpi === 0.2);
const caseLoads = combined.loads.filter((load) => load.caseKey === combinedCase.key);
assert.ok(caseLoads.some((load) => load.panelId <= 2));
assert.ok(caseLoads.some((load) => load.panelId >= 3));
const qpRoof = berekenStuwdruk("II", "II", 5 + rise).qp_kNm2;
assert.ok(caseLoads.filter((load) => load.panelId <= 2)
  .every((load) => Math.abs(load.qpKnPerM2 - qpRoof) < 1e-12));
console.log("3D-hellend-dakwind: controles geslaagd");
