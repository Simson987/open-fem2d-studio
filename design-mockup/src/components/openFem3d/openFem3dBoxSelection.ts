import * as THREE from "three";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSelection } from "./openFem3dSelection";
import { openFem3DProjectSegment } from "./openFem3dBeamScreenPick";
import { driehoekRaaktKader, lijnstukRaaktKader, type KaderModus } from "../../lib/kaderSelectie";

export interface OpenFem3DScreenBox { left: number; top: number; right: number; bottom: number }

function projectedPoint(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number) {
  const ndc = point.project(camera);
  if (ndc.z < -1 || ndc.z > 1) return null;
  return { x: (ndc.x + 1) * width / 2, y: (1 - ndc.y) * height / 2 };
}

/** Wereldmatrix van de mesh, bij een GPU-batch vermenigvuldigd met die van het exemplaar. */
function meshTransform(mesh: THREE.Mesh, instanceIndex?: number): THREE.Matrix4 | null {
  const transform = mesh.matrixWorld.clone();
  if (mesh instanceof THREE.InstancedMesh) {
    if (instanceIndex === undefined || instanceIndex >= mesh.count) return null;
    const instance = new THREE.Matrix4();
    mesh.getMatrixAt(instanceIndex, instance);
    transform.multiply(instance);
  }
  return transform;
}

/** Snelle, conservatieve schermgrenzen van de profiel-boundingbox. */
export function openFem3DMeshScreenBounds(
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
): OpenFem3DScreenBox | null {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return null;
  const transform = meshTransform(mesh, instanceIndex);
  if (!transform) return null;
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

export function openFem3DBoxContainsBounds(box: OpenFem3DScreenBox, bounds: OpenFem3DScreenBox) {
  return bounds.left >= box.left && bounds.right <= box.right
    && bounds.top >= box.top && bounds.bottom <= box.bottom;
}

function openFem3DBoxIntersectsBounds(box: OpenFem3DScreenBox, bounds: OpenFem3DScreenBox) {
  return bounds.left <= box.right && bounds.right >= box.left
    && bounds.top <= box.bottom && bounds.bottom >= box.top;
}

/** De volledige getekende mesh past in het kader, ook bij een ronde of gedraaide doorsnede. */
function openFem3DBoxContainsMeshVertices(
  box: OpenFem3DScreenBox,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
) {
  const positions = mesh.geometry.getAttribute("position");
  if (!positions?.count) return false;
  const transform = meshTransform(mesh, instanceIndex);
  if (!transform) return false;
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

function openFem3DBoxContainsMesh(
  box: OpenFem3DScreenBox,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
) {
  const coarse = openFem3DMeshScreenBounds(mesh, camera, width, height, instanceIndex);
  if (coarse && openFem3DBoxContainsBounds(box, coarse)) return true;
  if (coarse && !openFem3DBoxIntersectsBounds(box, coarse)) return false;
  return openFem3DBoxContainsMeshVertices(box, mesh, camera, width, height, instanceIndex);
}

/**
 * Raakt de getekende mesh het kader? Elke geprojecteerde driehoek wordt tegen
 * het kader gehouden, zodat een plaat met een opening of een gedraaid profiel
 * alleen telt waar hij werkelijk getekend is. Een driehoek met een hoek
 * achter de camera wordt overgeslagen; de systeemlijn vangt die gevallen.
 */
export function openFem3DMeshTouchesBox(
  box: OpenFem3DScreenBox,
  mesh: THREE.Mesh,
  camera: THREE.Camera,
  width: number,
  height: number,
  instanceIndex?: number,
): boolean {
  const coarse = openFem3DMeshScreenBounds(mesh, camera, width, height, instanceIndex);
  if (coarse && !openFem3DBoxIntersectsBounds(box, coarse)) return false;
  const positions = mesh.geometry.getAttribute("position");
  if (!positions?.count) return false;
  const transform = meshTransform(mesh, instanceIndex);
  if (!transform) return false;
  const projected = new Float64Array(positions.count * 2);
  const valid = new Uint8Array(positions.count);
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(transform).project(camera);
    if (point.z < -1 || point.z > 1 || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const x = (point.x + 1) * width / 2;
    const y = (1 - point.y) * height / 2;
    // Eén hoek in het kader is al genoeg.
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true;
    projected[index * 2] = x;
    projected[index * 2 + 1] = y;
    valid[index] = 1;
  }
  const indices = mesh.geometry.getIndex();
  const triangleCount = indices ? indices.count / 3 : positions.count / 3;
  const corner = (triangle: number, which: number) =>
    indices ? indices.getX(triangle * 3 + which) : triangle * 3 + which;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = corner(triangle, 0), b = corner(triangle, 1), c = corner(triangle, 2);
    if (!valid[a] || !valid[b] || !valid[c]) continue;
    if (driehoekRaaktKader(
      { x: projected[a * 2], y: projected[a * 2 + 1] },
      { x: projected[b * 2], y: projected[b * 2 + 1] },
      { x: projected[c * 2], y: projected[c * 2 + 1] },
      box,
    )) return true;
  }
  return false;
}

/**
 * Kaderselectie in 3D.
 *
 *  - `venster` (van links naar rechts): alleen wat volledig in het kader
 *    valt — bij een staaf of plaat het hele getekende volume.
 *  - `crossing` (van rechts naar links): alles wat het kader raakt. Een staaf
 *    telt als geraakt als zijn geprojecteerde systeemlijn of het getekende
 *    profiel het kader snijdt; een plaat als haar getekende vlak het kader
 *    overlapt; een knoop als hij in het kader ligt.
 */
export function selectOpenFem3DInScreenBox(
  model: OpenFem3DModel,
  meshes: readonly THREE.Object3D[],
  camera: THREE.Camera,
  width: number,
  height: number,
  box: OpenFem3DScreenBox,
  current: OpenFem3DSelection,
  additive: boolean,
  selectNodes: boolean,
  mode: KaderModus = "venster",
): OpenFem3DSelection {
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
  const crossing = mode === "crossing";
  const nodeById = crossing ? new Map(model.nodes.map((node) => [node.id, node])) : null;
  const beamById = crossing ? new Map(model.beams.map((beam) => [beam.id, beam])) : null;
  const matrix = crossing
    ? new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements
    : null;
  const systemLineTouches = (beamId: number) => {
    const beam = beamById!.get(beamId);
    const start = beam && nodeById!.get(beam.startNodeId);
    const end = beam && nodeById!.get(beam.endNodeId);
    if (!start || !end) return false;
    const segment = openFem3DProjectSegment(matrix!, start, end, width, height);
    return !!segment && lijnstukRaaktKader({ x: segment.ax, y: segment.ay }, { x: segment.bx, y: segment.by }, box);
  };
  const selected = (type: "beam" | "plate", id: number, object: THREE.Mesh, instanceIndex?: number) => {
    if (!crossing) return openFem3DBoxContainsMesh(box, object, camera, width, height, instanceIndex);
    if (type === "beam" && systemLineTouches(id)) return true;
    return openFem3DMeshTouchesBox(box, object, camera, width, height, instanceIndex);
  };
  for (const object of meshes) {
    if (!(object instanceof THREE.Mesh) || !object.visible) continue;
    const type = object.userData.type === "beam" ? "beam"
      : object.userData.type === "plate" ? "plate" : null;
    if (!type) continue;
    const target = type === "beam" ? beams : plates;
    object.updateWorldMatrix(true, false);
    if (object instanceof THREE.InstancedMesh) {
      const ids = object.userData.instanceIds as number[] | undefined;
      if (!ids) continue;
      for (let index = 0; index < object.count; index += 1) {
        if (!target.has(ids[index]) && selected(type, ids[index], object, index)) target.add(ids[index]);
      }
    } else if (typeof object.userData.id === "number") {
      if (!target.has(object.userData.id) && selected(type, object.userData.id, object)) target.add(object.userData.id);
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
