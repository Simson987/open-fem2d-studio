import assert from "node:assert/strict";
import { PerspectiveCamera } from "three";
import { findFrame3DBeamNearScreenPoint } from "./src/components/frame3d/frame3dBeamScreenPick.ts";

const camera = new PerspectiveCamera(60, 800 / 600, 0.1, 100);
camera.up.set(0, 0, 1);
camera.position.set(0, -10, 0);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);
const nodes = new Map([
  { id: 1, x: -2, y: 0, z: 0 },
  { id: 2, x: 2, y: 0, z: 0 },
  { id: 3, x: -2, y: 0, z: 2 },
  { id: 4, x: 2, y: 0, z: 2 },
].map((node) => [node.id, node]));
const beams = [
  { id: 7, startNodeId: 1, endNodeId: 2 },
  { id: 8, startNodeId: 3, endNodeId: 4 },
];

assert.equal(findFrame3DBeamNearScreenPoint(beams, nodes, camera, 800, 600, 400, 304)?.beamId, 7,
  "de analytische staaf is enkele pixels naast zijn hartlijn selecteerbaar");
assert.equal(findFrame3DBeamNearScreenPoint(beams, nodes, camera, 800, 600, 400, 307), null,
  "de klikzone mag niet tot een naburige staaf reiken");
assert.equal(findFrame3DBeamNearScreenPoint(beams, nodes, camera, 800, 600, 650, 300), null,
  "de doorgetrokken hartlijn buiten de staaf is niet selecteerbaar");
assert.equal(findFrame3DBeamNearScreenPoint(beams, nodes, camera, 800, 600, 400, 196)?.beamId, 8,
  "de getekende staaf, niet een andere ligger, wordt gekozen");
console.log("3D-staafselectie rond de dunne hartlijn: geslaagd");
