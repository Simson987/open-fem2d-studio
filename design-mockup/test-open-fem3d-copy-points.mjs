import assert from "node:assert/strict";
import { openFem3DCopyPointStep } from "./src/components/openFem3d/openFem3dCopyPoints.ts";
import { transformOpenFem3D } from "./src/components/openFem3d/openFem3dTransform.ts";

const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 1, name: "A" },
    { id: 2, x: 4, y: 0, z: 1 },
    { id: 3, x: 4, y: 3, z: 1 },
    { id: 4, x: 8, y: 3, z: 1 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE270", material: "S235",
      rollAngleRad: 0.2, tensionOnly: true,
      releases: { myStart: true, myEnd: false, mzStart: false, mzEnd: true, torsionStart: false, torsionEnd: false } },
    { id: 2, startNodeId: 2, endNodeId: 3, name: "Ligger" },
    { id: 3, startNodeId: 3, endNodeId: 4, material: "S355" },
  ],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
  loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0, caseId: 2 }],
  memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4,
    startPositionM: 0, endPositionM: 4, caseId: 2 }],
  memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -10, positionM: 2, caseId: 2 }],
};
const original = structuredClone(model);
const sourcePoint = { x: 1, y: 2, z: 3 };
const first = openFem3DCopyPointStep(null, sourcePoint);
assert.equal(first.command, null, "het basispunt maakt nog geen kopie");
assert.deepEqual(first.anchor, sourcePoint);
assert.notStrictEqual(first.anchor, sourcePoint, "het basispunt bewaart een eigen coördinaatwaarde");
sourcePoint.x = 99;
assert.equal(first.anchor.x, 1, "latere wijziging aan het klikpunt verandert het basispunt niet");
assert.deepEqual(model, original, "het kiezen van het basispunt verandert het model niet");

const second = openFem3DCopyPointStep(first.anchor, { x: 6, y: -2, z: 5 });
assert.deepEqual(second.command, { kind: "copy", dx: 5, dy: -4, dz: 2 },
  "de twee gekozen punten bepalen ook de verticale verplaatsing");
assert.deepEqual(second.anchor, first.anchor);
const copied = transformOpenFem3D(model, { type: "beam", id: 1 }, second.command);
assert.equal(copied.model.nodes.length, 6);
assert.equal(copied.model.beams.length, 4);
assert.deepEqual(copied.model.nodes.slice(-2), [
  { id: 5, x: 5, y: -4, z: 3, name: "A" },
  { id: 6, x: 9, y: -4, z: 3 },
]);
assert.deepEqual(copied.model.beams.at(-1), {
  ...model.beams[0], id: 4, startNodeId: 5, endNodeId: 6,
}, "profiel, materiaal, scharnieren en overige staafeigenschappen reizen mee");
assert.deepEqual(copied.selection, { type: "beam", id: 4 });
assert.deepEqual(copied.model.beams.slice(0, 3), model.beams, "bestaande staven blijven aangesloten op hun oorspronkelijke knopen");
assert.deepEqual(copied.model.nodes.slice(0, 4), model.nodes, "gedeelde en niet geselecteerde knopen blijven staan");
assert.deepEqual(copied.model.supports.at(-1), { ...model.supports[0], nodeId: 5 });
assert.deepEqual(copied.model.loads.at(-1), { ...model.loads[0], id: 2, nodeId: 6 });
assert.deepEqual(copied.model.memberLoads.at(-1), { ...model.memberLoads[0], id: 2, beamId: 4 });
assert.deepEqual(copied.model.memberPointLoads.at(-1), { ...model.memberPointLoads[0], id: 2, beamId: 4 });

const multi = transformOpenFem3D(model,
  { type: "multi", nodeIds: [2], beamIds: [1, 2] }, second.command);
assert.equal(multi.model.nodes.length, 7, "een gedeelde knoop wordt in de multiselectie eenmaal gekopieerd");
assert.equal(multi.model.beams.length, 5);
const [copyA, copyB] = multi.model.beams.slice(-2);
assert.equal(copyA.endNodeId, copyB.startNodeId, "de gekopieerde staven delen hun aansluiting");
assert.deepEqual(multi.selection, { type: "multi", nodeIds: [5], beamIds: [4, 5] });
assert.deepEqual(multi.model.beams[2], model.beams[2], "de niet geselecteerde staaf blijft ongewijzigd");
assert.deepEqual(model, original, "alle kopieën laten het bronmodel ongewijzigd");

for (const point of [first.anchor, { x: 1 + 0.5e-9, y: 2 + 0.5e-9, z: 3 + 0.5e-9 }]) {
  const samePoint = openFem3DCopyPointStep(first.anchor, point);
  assert.equal(samePoint.command, null, "een tweede punt binnen de tolerantie maakt geen geometrische dubbeling");
  assert.deepEqual(samePoint.anchor, first.anchor, "een nulafstand behoudt het gekozen basispunt");
}
assert.notEqual(openFem3DCopyPointStep(first.anchor, { x: 1 + 2e-9, y: 2, z: 3 }).command, null,
  "een verplaatsing buiten de tolerantie blijft bruikbaar");

for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  for (const axis of ["x", "y", "z"]) {
    assert.throws(() => openFem3DCopyPointStep(null, { x: 0, y: 0, z: 0, [axis]: invalid }), /eindige/);
    assert.throws(() => openFem3DCopyPointStep({ x: 0, y: 0, z: 0, [axis]: invalid }, { x: 1, y: 2, z: 3 }), /eindige/);
  }
}
assert.throws(() => openFem3DCopyPointStep({ x: -Number.MAX_VALUE, y: 0, z: 0 },
  { x: Number.MAX_VALUE, y: 0, z: 0 }), /eindige/);

console.log("3D kopiëren met basispunt en doelpunt: geslaagd");
