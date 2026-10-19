import assert from "node:assert/strict";
import { consistentFrame3DVolumeBodyLoad } from "./src/components/frame3d/frame3dVolumeLoads.ts";

const close = (actual, expected, name) =>
  assert.ok(Math.abs(actual - expected) < 1e-11, `${name}: ${actual}, verwacht ${expected}`);
const density = [1, 2, -3];
const tetPoints = [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]];
const tetNodes = new Map(tetPoints.map(([x, y, z], index) => [index + 1, { id: index + 1, x, y, z }]));
const tet = { id: 1, kind: "tet4", nodeIds: [1, 2, 3, 4] };
const tetLoads = consistentFrame3DVolumeBodyLoad(tet, tetNodes, density);
// V = 2·3·4/6 = 4 m³, with exactly V/4 on every Tet4 node.
tetLoads.forEach(({ forceKn }) => assert.deepEqual(forceKn, density));

const hexPoints = [
  [0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0],
  [1, 0, 4], [3, 0, 4], [3, 3, 4], [1, 3, 4],
];
const hexNodes = new Map(hexPoints.map(([x, y, z], index) => [index + 1, { id: index + 1, x, y, z }]));
const hex = { id: 2, kind: "hex8", nodeIds: [1, 2, 3, 4, 5, 6, 7, 8] };
const hexLoads = consistentFrame3DVolumeBodyLoad(hex, hexNodes, density);
// An affine shear preserves V = 24 m³ and gives exactly 3 m³ per node.
hexLoads.forEach(({ forceKn }) => forceKn.forEach((value, axis) =>
  close(value, density[axis] * 3, `Hex8 knooplast ${axis}`)));
const resultant = [0, 1, 2].map((axis) => hexLoads.reduce((sum, load) => sum + load.forceKn[axis], 0));
resultant.forEach((value, axis) => close(value, density[axis] * 24, `Hex8 resultante ${axis}`));
const moment = hexLoads.reduce(([mx, my, mz], load) => {
  const node = hexNodes.get(load.nodeId), [fx, fy, fz] = load.forceKn;
  return [mx + node.y * fz - node.z * fy,
    my + node.z * fx - node.x * fz,
    mz + node.x * fy - node.y * fx];
}, [0, 0, 0]);
const centre = [1.5, 1.5, 2];
const expectedMoment = [centre[1] * resultant[2] - centre[2] * resultant[1],
  centre[2] * resultant[0] - centre[0] * resultant[2],
  centre[0] * resultant[1] - centre[1] * resultant[0]];
moment.forEach((value, axis) => close(value, expectedMoment[axis], `Hex8 moment ${axis}`));
console.log("3D-volumekrachten: exacte Tet4- en affien-vervormde Hex8-resultanten en momenten geslaagd");
