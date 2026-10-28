import assert from "node:assert/strict";
import { clipOpenFem3DEnvelopeTriangle, triangulateOpenFem3DEnvelopePanel } from
  "./src/components/openFem3d/openFem3dEnvelopeZones.ts";
import { parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";

const coords = [
  [0, 0], [4, 0], [4, 3], [0, 3],
  [1, 1], [2, 1], [2, 2], [1, 2],
];
const model = {
  nodes: coords.map(([x, y], index) => ({ id: index + 1, x, y, z: 4 })),
  beams: [],
  envelopePanels: [{ id: 1, nodeIds: [1, 2, 3, 4], type: "roof", distribution: "twoWay",
    openings: [{ id: 1, nodeIds: [5, 6, 7, 8] }] }],
};
const triangles = triangulateOpenFem3DEnvelopePanel(model, model.envelopePanels[0]);
const sum = (items) => items.reduce((total, item) => total + item.areaM2, 0);
assert.ok(Math.abs(sum(triangles) - 11) < 1e-9, "opening trekt 1 m² van dak af");
const left = triangles.flatMap((triangle) => clipOpenFem3DEnvelopeTriangle(triangle, 0, 0, 1.5));
const right = triangles.flatMap((triangle) => clipOpenFem3DEnvelopeTriangle(triangle, 0, 1.5, 4));
assert.ok(Math.abs(sum(left) - 4) < 1e-9, "linkerzone heeft een halve opening");
assert.ok(Math.abs(sum(right) - 7) < 1e-9, "rechterzone heeft een halve opening");
assert.ok(Math.abs(sum([...left, ...right]) - sum(triangles)) < 1e-9, "zonering behoudt netto oppervlak");
for (const triangle of left) assert.ok(triangle.points.every((point) => point[0] <= 1.5 + 1e-9));
for (const triangle of right) assert.ok(triangle.points.every((point) => point[0] >= 1.5 - 1e-9));
assert.throws(() => clipOpenFem3DEnvelopeTriangle(triangles[0], 0, 2, 1), /oplopend/);
const generated = {
  source: "envelope3d", key: "wind:+x:plus:panel:1:zone:A:0", panelId: 1, zone: "A",
  coefficient: -1.2, referencePressureKnPerM2: 0.8,
  internalPressureCoefficient: 0.2, sourceReference: "EN 1991-1-4 tabel 7.1",
};
const parsed = parseOpenFem3DModel({ ...model, loadPanels: [{
  id: 1, nodeIds: [1, 2, 3], caseId: 5, q: -1.12,
  direction: "normal", distribution: "twoWay", generated,
}] });
assert.deepEqual(parsed.loadPanels[0].generated, generated);
assert.throws(() => parseOpenFem3DModel({ ...model, loadPanels: [{
  ...parsed.loadPanels[0], generated: { ...generated, coefficient: Infinity },
}] }), /ongeldige herkomst/);
console.log("3D-schilzones: controles geslaagd");
