import assert from "node:assert/strict";
import { transformOpenFem3D } from "./src/components/openFem3d/openFem3dTransform.ts";
import { addOpenFem3DPlate, parseOpenFem3DModel } from "./src/components/openFem3d/openFem3dModel.ts";

const model = {
  nodes: [
    { id: 1, x: 0, y: 0, z: 0 },
    { id: 2, x: 4, y: 0, z: 0 },
    { id: 3, x: 4, y: 3, z: 0 },
  ],
  beams: [
    { id: 1, startNodeId: 1, endNodeId: 2, profileName: "IPE270", material: "S235" },
    { id: 2, startNodeId: 2, endNodeId: 3 },
  ],
  supports: [{ nodeId: 1, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }],
  loads: [{ id: 1, nodeId: 2, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 }],
  memberLoads: [{ id: 1, beamId: 1, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4,
    startPositionM: 0, endPositionM: 4 }],
  memberPointLoads: [{ id: 1, beamId: 1, py: 0, pz: -10, positionM: 2 }],
  plates: [{ id: 1, nodeIds: [1, 2, 3], thicknessM: 0.2, cornerRadiusM: 0.1 }],
  surfaceLoads: [{ id: 1, plateId: 1, qx: 0, qy: 0, qz: -5 }],
};

const moved = transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "move", dx: 1, dy: 2, dz: 3 });
assert.deepEqual(moved.model.nodes, [
  { id: 1, x: 1, y: 2, z: 3 },
  { id: 2, x: 5, y: 2, z: 3 },
  { id: 3, x: 4, y: 3, z: 0 },
]);
assert.deepEqual(model.nodes[0], { id: 1, x: 0, y: 0, z: 0 }, "bronmodel blijft ongewijzigd");
assert.deepEqual(moved.selection, { type: "beam", id: 1 });

const rotated = transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "rotate", axis: "z", angleDeg: 90 });
assert.ok(Math.abs(rotated.model.nodes[0].x - 2) < 1e-12);
assert.ok(Math.abs(rotated.model.nodes[0].y + 2) < 1e-12);
assert.ok(Math.abs(rotated.model.nodes[1].x - 2) < 1e-12);
assert.ok(Math.abs(rotated.model.nodes[1].y - 2) < 1e-12);

const mirrored = transformOpenFem3D(model, { type: "node", id: 3 }, { kind: "mirror", axis: "y", offset: 1 });
assert.deepEqual(mirrored.model.nodes[2], { id: 3, x: 4, y: -1, z: 0 });

assert.strictEqual(
  transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "move", dx: 0, dy: 0, dz: 0 }).model,
  model,
  "een nulverplaatsing maakt geen nieuw model",
);
assert.strictEqual(
  transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "rotate", axis: "x", angleDeg: 90 }).model,
  model,
  "rotatie om de eigen geometrische as maakt geen nieuw model",
);

const copied = transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "copy", dx: 0, dy: 5, dz: 0 });
assert.deepEqual(copied.selection, { type: "beam", id: 3 });
assert.equal(copied.model.nodes.length, 5);
assert.deepEqual(copied.model.nodes.slice(-2), [
  { id: 4, x: 0, y: 5, z: 0 },
  { id: 5, x: 4, y: 5, z: 0 },
]);
assert.deepEqual(copied.model.beams.at(-1), {
  id: 3, startNodeId: 4, endNodeId: 5, profileName: "IPE270", material: "S235",
});
assert.equal(copied.model.supports.at(-1).nodeId, 4);
assert.deepEqual(copied.model.loads.at(-1), {
  id: 2, nodeId: 5, fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0,
});
assert.deepEqual(copied.model.memberLoads.at(-1), {
  id: 2, beamId: 3, qyStart: 0, qyEnd: 0, qzStart: -4, qzEnd: -4,
  startPositionM: 0, endPositionM: 4,
});
assert.deepEqual(copied.model.memberPointLoads.at(-1), {
  id: 2, beamId: 3, py: 0, pz: -10, positionM: 2,
});

const movedMulti = transformOpenFem3D(model, { type: "multi", nodeIds: [], beamIds: [1, 2] }, { kind: "move", dx: 1, dy: 0, dz: 0 });
assert.deepEqual(movedMulti.model.nodes.map((node) => node.x), [1, 5, 5], "gedeelde knopen bewegen in een multiselectie precies eenmaal");
const copiedMulti = transformOpenFem3D(model, { type: "multi", nodeIds: [], beamIds: [1, 2] }, { kind: "copy", dx: 0, dy: 5, dz: 0 });
assert.equal(copiedMulti.model.nodes.length, 6);
assert.equal(copiedMulti.model.beams.length, 4);
assert.deepEqual(copiedMulti.selection, { type: "multi", nodeIds: [], beamIds: [3, 4] });

const copiedPlate = transformOpenFem3D(model, { type: "plate", id: 1 }, { kind: "copy", dx: 0, dy: 0, dz: 2 });
assert.deepEqual(copiedPlate.selection, { type: "plate", id: 2 });
assert.deepEqual(copiedPlate.model.plates.at(-1).nodeIds, [4, 5, 6]);
assert.equal(copiedPlate.model.surfaceLoads.at(-1).plateId, 2, "oppervlaktebelasting reist mee met een gekopieerde plaat");

const curved = parseOpenFem3DModel({
  nodes: [
    [1, 0, 0], [2, 6, 0], [3, 6, 4], [4, 0, 4], [5, 3, -1],
    [6, 2, 1], [7, 4, 1], [8, 4, 3], [9, 2, 3], [10, 3, 0.5],
  ].map(([id, x, y]) => ({ id, x, y, z: 0 })),
  beams: [],
  plates: [{
    id: 1, nodeIds: [1, 5, 2, 3, 4], thicknessM: 0.2,
    boundary: [
      { kind: "arc", startNodeId: 1, controlNodeId: 5, endNodeId: 2 },
      { kind: "line", startNodeId: 2, endNodeId: 3 },
      { kind: "line", startNodeId: 3, endNodeId: 4 },
      { kind: "line", startNodeId: 4, endNodeId: 1 },
    ],
    openings: [{
      id: 1, nodeIds: [6, 10, 7, 8, 9],
      boundary: [
        { kind: "arc", startNodeId: 6, controlNodeId: 10, endNodeId: 7 },
        { kind: "line", startNodeId: 7, endNodeId: 8 },
        { kind: "line", startNodeId: 8, endNodeId: 9 },
        { kind: "line", startNodeId: 9, endNodeId: 6 },
      ],
    }],
  }],
});
const copiedCurved = transformOpenFem3D(curved, { type: "plate", id: 1 }, { kind: "copy", dx: 0, dy: 6, dz: 0 }).model;
assert.equal(parseOpenFem3DModel(copiedCurved).plates.length, 2, "gekopieerde boogcontour en opening blijven geldig");
const copiedLoop = copiedCurved.plates[1].nodeIds;
assert.deepEqual(copiedCurved.plates[1].boundary[0], {
  kind: "arc", startNodeId: copiedLoop[0], controlNodeId: copiedLoop[1], endNodeId: copiedLoop[2],
});
const copiedOpeningLoop = copiedCurved.plates[1].openings[0].nodeIds;
assert.deepEqual(copiedCurved.plates[1].openings[0].boundary[0], {
  kind: "arc", startNodeId: copiedOpeningLoop[0], controlNodeId: copiedOpeningLoop[1], endNodeId: copiedOpeningLoop[2],
});

const legacyCopy = structuredClone(copiedCurved);
legacyCopy.plates[1].boundary = curved.plates[0].boundary;
legacyCopy.plates[1].openings[0].boundary = curved.plates[0].openings[0].boundary;
const repairedCopy = parseOpenFem3DModel(legacyCopy);
assert.deepEqual(repairedCopy.plates[1], parseOpenFem3DModel(copiedCurved).plates[1], "oude kopieën worden bij het laden hersteld");
assert.deepEqual(addOpenFem3DPlate(legacyCopy, [1, 2, 3, 4]).plates[1], repairedCopy.plates[1],
  "een nieuwe plaat maakt ook bestaande gekopieerde contouren geldig");
const unrelatedBadBoundary = structuredClone(legacyCopy);
unrelatedBadBoundary.nodes.find((node) => node.id === copiedLoop[1]).x += 0.25;
assert.throws(() => parseOpenFem3DModel(unrelatedBadBoundary), /ongeldige knoopverwijzing/,
  "alleen zuiver verschoven kopieën mogen automatisch hersteld worden");

assert.throws(
  () => transformOpenFem3D(model, { type: "node", id: 99 }, { kind: "move", dx: 0, dy: 0, dz: 0 }),
  /bestaat niet/,
);
assert.throws(
  () => transformOpenFem3D(model, { type: "beam", id: 1 }, { kind: "move", dx: Number.NaN, dy: 0, dz: 0 }),
  /eindige getallen/,
);

console.log("3D verplaatsen, roteren, kopiëren en spiegelen: geslaagd");
