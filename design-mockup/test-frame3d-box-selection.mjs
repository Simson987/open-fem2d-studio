import assert from "node:assert/strict";
import * as THREE from "three";
import {
  frame3DBoxContainsBounds,
  frame3DMeshScreenBounds,
  selectFrame3DInScreenBox,
} from "./src/components/frame3d/frame3dBoxSelection.ts";

const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.1, 100);
camera.position.set(0, 0, 12);
camera.lookAt(0, 0, 0);
camera.updateProjectionMatrix();
camera.updateMatrixWorld();
// Een volumestaaf met dezelfde lokale lengte- en doorsnedeassen als de
// staalextrusie. De browserproef hieronder gebruikt het echte IPE-profiel.
const profile = new THREE.BoxGeometry(0.2, 4, 0.1);
const steelBeam = new THREE.Mesh(profile, new THREE.MeshBasicMaterial());
steelBeam.userData = { type: "beam", id: 1 };
steelBeam.updateMatrixWorld();
const bounds = frame3DMeshScreenBounds(steelBeam, camera, 800, 600);
assert.ok(bounds);
const completeBox = {
  left: bounds.left - 1, right: bounds.right + 1,
  top: bounds.top - 1, bottom: bounds.bottom + 1,
};
const axisOnlyBox = {
  left: bounds.left + 5, right: bounds.right - 5,
  top: bounds.top - 1, bottom: bounds.bottom + 1,
};
assert.ok(frame3DBoxContainsBounds(completeBox, bounds));
assert.equal(frame3DBoxContainsBounds(axisOnlyBox, bounds), false,
  "de hartlijn alleen mag het staalprofiel niet selecteren");
const model = { nodes: [], beams: [], plates: [] };
assert.deepEqual(selectFrame3DInScreenBox(model, [steelBeam], camera, 800, 600,
  axisOnlyBox, null, false, false), null);
assert.deepEqual(selectFrame3DInScreenBox(model, [steelBeam], camera, 800, 600,
  completeBox, null, false, false), { type: "beam", id: 1 });

// Hetzelfde selectiecriterium geldt voor de GPU-batch van grote raamwerken.
const instanced = new THREE.InstancedMesh(profile, new THREE.MeshBasicMaterial(), 2);
instanced.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-2, 0, 0));
instanced.setMatrixAt(1, new THREE.Matrix4().makeTranslation(2, 0, 0));
instanced.userData = { type: "beam", instanceIds: [11, 12] };
instanced.updateMatrixWorld();
const leftBounds = frame3DMeshScreenBounds(instanced, camera, 800, 600, 0);
assert.ok(leftBounds);
const leftBox = {
  left: leftBounds.left - 1, right: leftBounds.right + 1,
  top: leftBounds.top - 1, bottom: leftBounds.bottom + 1,
};
assert.deepEqual(selectFrame3DInScreenBox(model, [instanced], camera, 800, 600,
  leftBox, null, false, false), { type: "beam", id: 11 });
assert.deepEqual(selectFrame3DInScreenBox(model, [instanced], camera, 800, 600,
  leftBox, { type: "beam", id: 12 }, true, false),
{ type: "multi", nodeIds: [], beamIds: [11, 12] });

const large = new THREE.InstancedMesh(profile, new THREE.MeshBasicMaterial(), 235);
const largeIds = [];
for (let index = 0; index < 235; index += 1) {
  large.setMatrixAt(index, new THREE.Matrix4().makeTranslation(
    (index % 25 - 12) * 1.5, (Math.floor(index / 25) - 4) * 4.5, 0,
  ));
  largeIds.push(index + 1);
}
large.userData = { type: "beam", instanceIds: largeIds };
large.updateMatrixWorld();
camera.position.set(0, 0, 100);
camera.far = 200;
camera.updateProjectionMatrix();
camera.updateMatrixWorld();
const startedAt = performance.now();
const largeSelection = selectFrame3DInScreenBox(model, [large], camera, 800, 600,
  { left: 0, top: 0, right: 800, bottom: 600 }, null, false, false);
const elapsedMs = performance.now() - startedAt;
assert.equal(largeSelection?.type, "multi");
assert.equal(largeSelection.beamIds.length, 235);
console.log(`3D-selectiekader: profielvolume en 235 instanced staalstaven geslaagd (${elapsedMs.toFixed(1)} ms)`);
