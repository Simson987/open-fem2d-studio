import assert from "node:assert/strict";
import * as THREE from "three";
import { createFrame3DVolumeBatches } from "./src/components/frame3d/frame3dVolumeGeometry.ts";

const nodes = new Map();
const volumes = [];
let nextNodeId = 1;
for (let element = 0; element < 1025; element++) {
  const x = element * 2;
  const points = [[x, 0, 0], [x + 1, 0, 0], [x, 1, 0], [x, 0, 1]];
  const nodeIds = points.map(([px, py, pz]) => {
    const id = nextNodeId++;
    nodes.set(id, { id, x: px, y: py, z: pz });
    return id;
  });
  volumes.push({ id: element + 1, kind: "tet4", nodeIds, eMpa: 30000, poisson: 0.2 });
}
const batches = createFrame3DVolumeBatches(volumes, nodes);
assert.equal(batches.length, 3);
assert.deepEqual(batches.map((batch) => batch.volumesById.size), [512, 512, 1]);
assert.equal(batches.reduce((sum, batch) => sum + batch.volumeIdByFace.length, 0), volumes.length * 4);
assert.equal(batches.reduce((sum, batch) => sum + batch.faces.getAttribute("position").count, 0), volumes.length * 12);
assert.equal(batches.reduce((sum, batch) => sum + batch.edges.getAttribute("position").count, 0), volumes.length * 12);
assert.deepEqual(new Set(batches.flatMap((batch) => batch.volumeIdByFace)),
  new Set(volumes.map((volume) => volume.id)));
for (const batch of batches) {
  assert.equal(batch.volumeIdByFace.length, batch.faces.getAttribute("position").count / 3);
  const mesh = new THREE.Mesh(batch.faces, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const firstId = batch.volumeIdByFace[0];
  const first = volumes[firstId - 1];
  const firstNode = nodes.get(first.nodeIds[0]);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(firstNode.x + 0.1, 0.1, -1), new THREE.Vector3(0, 0, 1),
  );
  const hit = raycaster.intersectObject(mesh, false)[0];
  assert.ok(hit && hit.faceIndex !== null);
  assert.equal(batch.volumeIdByFace[hit.faceIndex], firstId);
  mesh.material.dispose();
  batch.faces.dispose();
  batch.edges.dispose();
}
assert.throws(() => createFrame3DVolumeBatches(volumes, nodes, 0), /batchgrootte/);

const hexNodes = new Map();
const hexId = (x, y, z) => 1 + x + 3 * (y + 2 * z);
for (let z = 0; z <= 1; z++) for (let y = 0; y <= 1; y++) for (let x = 0; x <= 2; x++) {
  const id = hexId(x, y, z);
  hexNodes.set(id, { id, x, y, z });
}
const hexVolumes = [0, 1].map((x) => ({
  id: x + 1, kind: "hex8", nodeIds: [
    hexId(x, 0, 0), hexId(x + 1, 0, 0), hexId(x + 1, 1, 0), hexId(x, 1, 0),
    hexId(x, 0, 1), hexId(x + 1, 0, 1), hexId(x + 1, 1, 1), hexId(x, 1, 1),
  ],
}));
const hexBatches = createFrame3DVolumeBatches(hexVolumes, hexNodes, 1);
assert.equal(hexBatches.length, 2);
assert.equal(hexBatches.reduce((sum, batch) => sum + batch.volumeIdByFace.length, 0), 20);
assert.equal(hexBatches.reduce((sum, batch) => sum + batch.edges.getAttribute("position").count / 2, 0), 20);
assert.deepEqual(new Set(hexBatches.flatMap((batch) => batch.volumeIdByFace)), new Set([1, 2]));
const secondHex = hexBatches.find((batch) => batch.volumesById.has(2));
const secondMesh = new THREE.Mesh(secondHex.faces, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
const secondHit = new THREE.Raycaster(
  new THREE.Vector3(1.5, 0.5, -1), new THREE.Vector3(0, 0, 1),
).intersectObject(secondMesh, false)[0];
assert.ok(secondHit && secondHit.faceIndex !== null);
assert.equal(secondHex.volumeIdByFace[secondHit.faceIndex], 2);
secondMesh.material.dispose();
hexBatches.forEach((batch) => { batch.faces.dispose(); batch.edges.dispose(); });

const tetNodes = new Map([
  [1, { id: 1, x: 0, y: 0, z: 0 }], [2, { id: 2, x: 1, y: 0, z: 0 }],
  [3, { id: 3, x: 0, y: 1, z: 0 }], [4, { id: 4, x: 0, y: 0, z: 1 }],
  [5, { id: 5, x: 0, y: 0, z: -1 }],
]);
const tetBatches = createFrame3DVolumeBatches([
  { id: 1, kind: "tet4", nodeIds: [1, 2, 3, 4] },
  { id: 2, kind: "tet4", nodeIds: [1, 3, 2, 5] },
], tetNodes, 1);
assert.equal(tetBatches.reduce((sum, batch) => sum + batch.volumeIdByFace.length, 0), 6);
assert.equal(tetBatches.reduce((sum, batch) => sum + batch.edges.getAttribute("position").count / 2, 0), 9);
tetBatches.forEach((batch) => { batch.faces.dispose(); batch.edges.dispose(); });

// The shell of an n×n×n brick has 6n² quads (12n² triangles) and
// 12n² unique surface segments, independent of its 6n³ interior faces.
const side = 24;
const gridNodes = new Map();
const gridId = (x, y, z) => 1 + x + (side + 1) * (y + (side + 1) * z);
for (let z = 0; z <= side; z++) for (let y = 0; y <= side; y++) for (let x = 0; x <= side; x++) {
  const id = gridId(x, y, z);
  gridNodes.set(id, { id, x, y, z });
}
const gridVolumes = [];
for (let z = 0; z < side; z++) for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
  gridVolumes.push({ id: gridVolumes.length + 1, kind: "hex8", nodeIds: [
    gridId(x, y, z), gridId(x + 1, y, z), gridId(x + 1, y + 1, z), gridId(x, y + 1, z),
    gridId(x, y, z + 1), gridId(x + 1, y, z + 1), gridId(x + 1, y + 1, z + 1), gridId(x, y + 1, z + 1),
  ] });
}
const gridBatches = createFrame3DVolumeBatches(gridVolumes, gridNodes);
assert.equal(gridBatches.reduce((sum, batch) => sum + batch.faces.getAttribute("position").count / 3, 0), 12 * side ** 2);
assert.equal(gridBatches.reduce((sum, batch) => sum + batch.edges.getAttribute("position").count / 2, 0), 12 * side ** 2);
assert.equal(gridBatches.reduce((sum, batch) => sum + batch.volumesById.size, 0), side ** 3);
gridBatches.forEach((batch) => { batch.faces.dispose(); batch.edges.dispose(); });
console.log("3D-volume-batches: Tet4/Hex8-binnenvlakken en -randen verwijderd; 13.824 Hex8 vormen alleen de buitenschil");
