import * as THREE from "three";
import type { Frame3DModel } from "./frame3dModel";
import type { Frame3DSelection } from "./frame3dSelection";

export interface Frame3DScreenBox { left: number; top: number; right: number; bottom: number }

function projectedPoint(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number) {
  const ndc = point.project(camera);
  if (ndc.z < -1 || ndc.z > 1) return null;
  return { x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2 };
}

/** Snelle, conservatieve schermgrenzen van de profiel-boundingbox. */
export function frame3DMeshScreenBounds(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
): Frame3DScreenBox | null {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return null;
  const transform = mesh.matrixWorld.clone();
  if (mesh instanceof THREE.InstancedMesh) {
    if (instanceIndex === undefined || instanceIndex >= mesh.count) return null;
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(instanceIndex, instance);
    transform.multiply(instance);
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        const point = projectedPoint(new THREE.Vector3(x, y, z).applyMatrix4(transform), camera, width, height);
        // Een half achter de camera gelegen profiel zit niet geheel in het kader.
        if (!point) return null;
        left = Math.min(left, point.x);
        right = Math.max(right, point.x);
        top = Math.min(top, point.y);
        bottom = Math.max(bottom, point.y);
      }
    }
  }
  return { left, top, right, bottom };
}

export function frame3DBoxContainsBounds(box: Frame3DScreenBox, bounds: Frame3DScreenBox) {
  return bounds.left >= box.left && bounds.right <= box.right
    && bounds.top >= box.top && bounds.bottom <= box.bottom;
}

function frame3DBoxIntersectsBounds(box: Frame3DScreenBox, bounds: Frame3DScreenBox) {
  return bounds.left <= box.right && bounds.right >= box.left
    && bounds.top <= box.bottom && bounds.bottom >= box.top;
}

/** De volledige getekende mesh past in het kader, ook bij een ronde of gedraaide doorsnede. */
function frame3DBoxContainsMeshVertices(
  box: Frame3DScreenBox,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
) {
  const positions = mesh.geometry.getAttribute("position");
  if (!positions?.count) return false;
  const transform = mesh.matrixWorld.clone();
  if (mesh instanceof THREE.InstancedMesh) {
    if (instanceIndex === undefined || instanceIndex >= mesh.count) return false;
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(instanceIndex, instance);
    transform.multiply(instance);
  }
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(transform).project(camera);
    if (point.z < -1 || point.z > 1) return false;
    const x = (point.x + 1) * width / 2;
    const y = (1 - point.y) * height / 2;
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
  }
  return true;
}

function frame3DBoxContainsMesh(
  box: Frame3DScreenBox,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
) {
  const coarse = frame3DMeshScreenBounds(mesh, camera, width, height, instanceIndex);
  if (coarse && frame3DBoxContainsBounds(box, coarse)) return true;
  if (coarse && !frame3DBoxIntersectsBounds(box, coarse)) return false;
  return frame3DBoxContainsMeshVertices(box, mesh, camera, width, height, instanceIndex);
}

export function selectFrame3DInScreenBox(
  model: Frame3DModel,
  meshes: readonly THREE.Object3D[],
  camera: THREE.Camera,
  width: number,
  height: number,
  box: Frame3DScreenBox,
  current: Frame3DSelection,
  additive: boolean,
  selectNodes: boolean,
): Frame3DSelection {
  camera.updateMatrixWorld();
  const nodes = new Set<number>();
  const beams = new Set<number>();
  const plates = new Set<number>();
  if (selectNodes) {
    for (const node of model.nodes) {
      const point = projectedPoint(new THREE.Vector3(node.x, node.y, node.z), camera, width, height);
      if (point && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) {
        nodes.add(node.id);
      }
    }
  }
  for (const object of meshes) {
    if (!(object instanceof THREE.Mesh) || !object.visible) continue;
    const target = object.userData.type === "beam" ? beams
      : object.userData.type === "plate" ? plates : null;
    if (!target) continue;
    object.updateWorldMatrix(true, false);
    if (object instanceof THREE.InstancedMesh) {
      const ids = object.userData.instanceIds as number[] | undefined;
      if (!ids) continue;
      for (let index = 0; index < object.count; index += 1) {
        if (frame3DBoxContainsMesh(box, object, camera, width, height, index)) target.add(ids[index]);
      }
    } else if (typeof object.userData.id === "number") {
      if (frame3DBoxContainsMesh(box, object, camera, width, height)) target.add(object.userData.id);
    }
  }
  if (additive) {
    if (current?.type === "node") nodes.add(current.id);
    else if (current?.type === "beam") beams.add(current.id);
    else if (current?.type === "plate") plates.add(current.id);
    else if (current?.type === "multi") {
      current.nodeIds.forEach((id) => nodes.add(id));
      current.beamIds.forEach((id) => beams.add(id));
      current.plateIds?.forEach((id) => plates.add(id));
    }
  }
  const nodeIds = [...nodes].sort((a, b) => a - b);
  const beamIds = [...beams].sort((a, b) => a - b);
  const plateIds = [...plates].sort((a, b) => a - b);
  if (nodeIds.length + beamIds.length + plateIds.length === 0) return additive ? current : null;
  if (nodeIds.length === 1 && beamIds.length + plateIds.length === 0) return { type: "node", id: nodeIds[0] };
  if (beamIds.length === 1 && nodeIds.length + plateIds.length === 0) return { type: "beam", id: beamIds[0] };
  if (plateIds.length === 1 && nodeIds.length + beamIds.length === 0) return { type: "plate", id: plateIds[0] };
  return { type: "multi", nodeIds, beamIds, ...(plateIds.length ? { plateIds } : {}) };
}
