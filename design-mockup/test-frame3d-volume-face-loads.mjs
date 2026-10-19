import assert from "node:assert/strict";
import { consistentFrame3DVolumeFaceLoad } from "./src/components/frame3d/frame3dVolumeLoads.ts";

const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual}, verwacht ${expected}`);
const mapNodes = (coordinates) => new Map(coordinates.map(([x, y, z], index) =>
  [index + 1, { id: index + 1, x, y, z }]));
const cross = ([ax, ay, az], [bx, by, bz]) =>
  [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
const checkResultantAndMoment = (loads, nodes, traction, area, centre, label) => {
  const total = [0, 1, 2].map((axis) => loads.reduce((sum, load) => sum + load.forceKn[axis], 0));
  total.forEach((force, axis) => close(force, traction[axis] * area, `${label} kracht ${axis}`));
  const moment = loads.reduce((sum, load) => {
    const node = nodes.get(load.nodeId);
    const contribution = cross([node.x, node.y, node.z], load.forceKn);
    return sum.map((component, axis) => component + contribution[axis]);
  }, [0, 0, 0]);
  const reference = cross(centre, total);
  moment.forEach((component, axis) => close(component, reference[axis], `${label} moment ${axis}`));
};

const tetNodes = mapNodes([[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]]);
const tet = { id: 1, kind: "tet4", nodeIds: [1, 2, 3, 4] };
const traction = [2, -3, 4];
const tetLoads = consistentFrame3DVolumeFaceLoad(tet, tetNodes, 0, traction);
assert.deepEqual(tetLoads.map((load) => load.nodeId), [1, 3, 2]);
tetLoads.forEach(({ forceKn }) => forceKn.forEach((force, axis) =>
  close(force, traction[axis], `Tet4 knoopkracht ${axis}`)));
checkResultantAndMoment(tetLoads, tetNodes, traction, 3, [2 / 3, 1, 0], "Tet4");

// Affine-skewed Hex8: top face is a parallelogram with exact area |a × b|.
const transform = ([x, y, z]) => [x + y / 2, y, z + x / 4];
const hexNodes = mapNodes([
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
].map(transform));
const hex = { id: 2, kind: "hex8", nodeIds: [1, 2, 3, 4, 5, 6, 7, 8] };
const hexLoads = consistentFrame3DVolumeFaceLoad(hex, hexNodes, 1, traction);
assert.deepEqual(hexLoads.map((load) => load.nodeId), [5, 6, 7, 8]);
const a = [1, 0, 0.25], b = [0.5, 1, 0];
const area = Math.hypot(...cross(a, b));
hexLoads.forEach(({ forceKn }) => forceKn.forEach((force, axis) =>
  close(force, traction[axis] * area / 4, `Hex8 knoopkracht ${axis}`)));
checkResultantAndMoment(hexLoads, hexNodes, traction, area,
  transform([0.5, 0.5, 1]), "Hex8");
console.log("3D-volumevlaktracties: onafhankelijke Tet4- en scheve Hex8-kracht en moment geslaagd");
