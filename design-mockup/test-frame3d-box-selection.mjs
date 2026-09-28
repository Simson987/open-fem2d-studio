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

// Een gedraaid profiel past zichtbaar in het kader, terwijl de acht hoeken
// van zijn lokale bounding box er deels buiten vallen. Selectie moet op de
// werkelijk getekende profielvertices berusten.
const roundProfile = new THREE.CylinderGeometry(0.12, 0.12, 4, 12);
const rotatedBeam = new THREE.Mesh(roundProfile, new THREE.MeshBasicMaterial());
rotatedBeam.rotation.x = Math.PI / 4;
rotatedBeam.rotation.z = Math.PI / 5;
rotatedBeam.userData = { type: "beam", id: 2 };
rotatedBeam.updateMatrixWorld();
const vertices = roundProfile.getAttribute("position");
const actualPoints = Array.from({ length: vertices.count }, (_, index) => {
  const ndc = new THREE.Vector3().fromBufferAttribute(vertices, index)
    .applyMatrix4(rotatedBeam.matrixWorld).project(camera);
  return { x: (ndc.x + 1) * 400, y: (1 - ndc.y) * 300 };
});
const silhouetteBox = {
  left: Math.min(...actualPoints.map((point) => point.x)) - 1,
  right: Math.max(...actualPoints.map((point) => point.x)) + 1,
  top: Math.min(...actualPoints.map((point) => point.y)) - 1,
  bottom: Math.max(...actualPoints.map((point) => point.y)) + 1,
};
assert.equal(frame3DBoxContainsBounds(silhouetteBox,
  frame3DMeshScreenBounds(rotatedBeam, camera, 800, 600)), false);
assert.deepEqual(selectFrame3DInScreenBox(model, [rotatedBeam], camera, 800, 600,
  silhouetteBox, null, false, false), { type: "beam", id: 2 });
const rotatedBatch = new THREE.InstancedMesh(roundProfile, new THREE.MeshBasicMaterial(), 1);
rotatedBatch.setMatrixAt(0, rotatedBeam.matrixWorld);
rotatedBatch.userData = { type: "beam", instanceIds: [13] };
rotatedBatch.updateMatrixWorld();
assert.deepEqual(selectFrame3DInScreenBox(model, [rotatedBatch], camera, 800, 600,
  silhouetteBox, null, false, false), { type: "beam", id: 13 });

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
