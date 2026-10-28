import assert from "node:assert/strict";
import { generateFacadeWindLoads } from "./src/components/openFem3d/openFem3dFacadeWindLoads.ts";
import { berekenStuwdruk, cpeWand } from "./src/lib/wind/windEurocode.ts";
import { analyseOpenFem3DLoadPanel } from "./src/components/openFem3d/openFem3dLoadPanels.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";

const points = [
  [0, 0, 0], [0, 0, 5], [0, 10, 5], [0, 10, 0],
  [20, 0, 0], [20, 10, 0], [20, 10, 5], [20, 0, 5],
  [20, 0, 0], [20, 0, 5], [0, 0, 5], [0, 0, 0],
  [0, 10, 0], [0, 10, 5], [20, 10, 5], [20, 10, 0],
  [0.5, 0, 1], [1.5, 0, 1], [1.5, 0, 2], [0.5, 0, 2],
];
const model = {
  nodes: points.map(([x, y, z], index) => ({ id: index + 1, x, y, z })), beams: [],
  envelopePanels: [
    { id: 1, nodeIds: [1, 2, 3, 4], type: "facade", distribution: "twoWay" },
    { id: 2, nodeIds: [5, 6, 7, 8], type: "facade", distribution: "twoWay" },
    { id: 3, nodeIds: [9, 10, 11, 12], type: "facade", distribution: "twoWay",
      openings: [{ id: 1, nodeIds: [17, 18, 19, 20] }] },
    { id: 4, nodeIds: [13, 14, 15, 16], type: "facade", distribution: "twoWay" },
  ],
};
const result = generateFacadeWindLoads(model, { windgebied: "II", terreincategorie: "II" });
assert.equal(result.cases.length, 8);
const loads = result.loads.filter((load) => load.direction === "+X" && load.cpi === 0.2);
const area = (zone) => loads.filter((load) => load.zone === zone)
  .reduce((sum, load) => sum + load.triangle.areaM2, 0);
for (const [zone, expected] of [["A", 19], ["B", 80], ["C", 100], ["D", 50], ["E", 50]]) {
  assert.ok(Math.abs(area(zone) - expected) < 1e-8, `${zone}: oppervlakte inclusief opening`);
}
const qp = berekenStuwdruk("II", "II", 5).qp_kNm2;
const cpe = cpeWand(5 / 20);
const totalOutward = loads.reduce((sum, load) => sum + load.qOutwardKnPerM2 * load.triangle.areaM2, 0);
const expected = qp * (19 * (0.2 - cpe.A) + 80 * (0.2 - cpe.B) + 100 * (0.2 - cpe.C)
  + 50 * (0.2 - cpe.D) + 50 * (0.2 - cpe.E));
assert.ok(Math.abs(totalOutward - expected) < 1e-8, "som F = (c_pi − c_pe) q_p A per zone");
assert.ok(loads.every((load) => load.sourceReference.includes("tabel 7.1")));
assert.equal(new Set(result.loads.map((load) => load.key)).size, result.loads.length);
assert.deepEqual(generateFacadeWindLoads(model, { windgebied: "II", terreincategorie: "II" }), result);
const cladding = parseOpenFem3DModel({ ...model,
  beams: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([startNodeId, endNodeId], index) =>
    ({ id: index + 1, startNodeId, endNodeId })),
  loadPanels: [{ id: 1, nodeIds: [1, 2, 3, 4], caseId: 1, q: 0.15,
    direction: "verticalSurface", distribution: "twoWay" }],
});
const claddingForce = analyseOpenFem3DLoadPanel(cladding, cladding.loadPanels[0]).totalForceKn;
assert.ok(Math.abs(claddingForce[2] + 7.5) < 1e-8, "gevelbekleding: Fz = −q × werkelijk vlakoppervlak");
console.log("3D-gevelwind: controles geslaagd");
