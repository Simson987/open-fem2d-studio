import * as THREE from "three";
import type { OpenFem3DModel } from "./openFem3dModel";
import { openFem3DSelectionFromIds, type OpenFem3DSelection, type OpenFem3DSingleSelection } from "./openFem3dSelection";
import { openFem3DProjectSegment } from "./openFem3dBeamScreenPick";
import { driehoekRaaktKader, lijnstukRaaktKader, veelhoekRaaktKader, type KaderModus } from "../../lib/kaderSelectie";
import {
  openFem3DSectionBoxBevat, openFem3DSectionBoxKnipLijnstuk, openFem3DSectionBoxStaafStand, openFem3DSectionBoxVeelhoek,
  openFem3DSectionBoxVeelhoekStand, type OpenFem3DSectionBoxBounds,
} from "./openFem3dSectionBox";

export interface OpenFem3DScreenBox { left: number; top: number; right: number; bottom: number }

/** Een getekend lijnstuk van een last: een pijl of een stuk staartlijn (zie `openFem3DLoadPickSegments`). */
export interface OpenFem3DBoxLoadSegment {
  selection: OpenFem3DSingleSelection;
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
}

/**
 * De last in een kader zonder geometrie: in een venster een pijl of stuk
 * staartlijn dat er geheel in valt, bij crossing een dat het kader raakt.
 * Raken meer lasten het kader, dan wint de last waarvan een lijnstuk het
 * dichtst bij het midden van het kader ligt.
 */
function loadInScreenBox(
  segments: readonly OpenFem3DBoxLoadSegment[],
  matrix: ArrayLike<number>,
  width: number,
  height: number,
  box: OpenFem3DScreenBox,
  crossing: boolean,
): OpenFem3DSingleSelection | null {
  const inside = (p: { x: number; y: number }) =>
    p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  let best: OpenFem3DSingleSelection | null = null;
  let bestDistance = Infinity;
  for (const segment of segments) {
    const projected = openFem3DProjectSegment(matrix, segment.a, segment.b, width, height);
    if (!projected) continue;
    const a = { x: projected.ax, y: projected.ay };
    const b = { x: projected.bx, y: projected.by };
    // Een venster bevat geen pijl die deels achter de camera ligt.
    const hit = crossing ? lijnstukRaaktKader(a, b, box)
      : projected.s0 === 0 && projected.s1 === 1 && inside(a) && inside(b);
    if (!hit) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(cx - a.x - t * dx, cy - a.y - t * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = segment.selection;
    }
  }
  return best;
}

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
 *
 * Valt er geen knoop, staaf of plaat in het kader, dan kiest het kader de
 * last die het raakt (`loadSegments`, zie {@link loadInScreenBox}). Een last
 * gaat niet samen met geometrie in één selectie.
 *
 * Section box (`doos`, issue #86): alleen wat binnen de doos valt telt. Een
 * knoop of staaf (systeemlijn) of plaat (omtrek) geheel buiten de doos valt
 * weg; een staaf of plaat die de doos snijdt, telt met haar zichtbare deel:
 * venster = het geknipte stuk geheel in het kader, crossing = het geknipte
 * stuk raakt het kader. Een last telt met het deel van zijn pijl binnen de doos.
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
  loadSegments: readonly OpenFem3DBoxLoadSegment[] = [],
  doos: OpenFem3DSectionBoxBounds | null = null,
): OpenFem3DSelection {
  camera.updateMatrixWorld();
  const nodes = new Set<number>();
  const beams = new Set<number>();
  const plates = new Set<number>();
  if (selectNodes) {
    for (const node of model.nodes) {
      if (doos && !openFem3DSectionBoxBevat(doos, node)) continue;
      const point = projectedPoint(new THREE.Vector3(node.x, node.y, node.z), camera, width, height);
      if (point && point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) {
        nodes.add(node.id);
      }
    }
  }
  const crossing = mode === "crossing";
  const nodeById = crossing || doos ? new Map(model.nodes.map((node) => [node.id, node])) : null;
  const beamById = crossing || doos ? new Map(model.beams.map((beam) => [beam.id, beam])) : null;
  const plateById = doos ? new Map((model.plates ?? []).map((plate) => [plate.id, plate])) : null;
  const matrix = crossing || doos
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
  const inKader = (p: { x: number; y: number }) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;
  const staafEinden = (beamId: number) => {
    const beam = beamById!.get(beamId);
    const start = beam && nodeById!.get(beam.startNodeId);
    const end = beam && nodeById!.get(beam.endNodeId);
    return start && end ? { start, end } : null;
  };
  const plaatOmtrek = (plateId: number) => (plateById!.get(plateId)?.nodeIds ?? [])
    .map((id) => nodeById!.get(id)).filter((node): node is NonNullable<typeof node> => Boolean(node));
  /** Binnen, deels of buiten de section box (systeemlijn of plaatomtrek). */
  const standInDoos = (type: "beam" | "plate", id: number) => {
    if (type === "beam") {
      const einden = staafEinden(id);
      return einden ? openFem3DSectionBoxStaafStand(doos!, einden.start, einden.end) : "buiten";
    }
    return openFem3DSectionBoxVeelhoekStand(doos!, plaatOmtrek(id));
  };
  /** Het zichtbare deel van een staaf of plaat die de doos snijdt, tegen het kader. */
  const zichtbaarDeelGeselecteerd = (type: "beam" | "plate", id: number) => {
    if (type === "beam") {
      const einden = staafEinden(id);
      const deel = einden && openFem3DSectionBoxKnipLijnstuk(doos!, einden.start, einden.end);
      const segment = deel && openFem3DProjectSegment(matrix!, deel.a, deel.b, width, height);
      if (!segment) return false;
      const a = { x: segment.ax, y: segment.ay }, b = { x: segment.bx, y: segment.by };
      return crossing ? lijnstukRaaktKader(a, b, box) : segment.s0 === 0 && segment.s1 === 1 && inKader(a) && inKader(b);
    }
    const geknipt = openFem3DSectionBoxVeelhoek(doos!, plaatOmtrek(id));
    const scherm = geknipt.map((p) => projectedPoint(new THREE.Vector3(p.x, p.y, p.z), camera, width, height));
    if (scherm.length < 3 || scherm.some((p) => !p)) return false;
    const punten = scherm as { x: number; y: number }[];
    return crossing ? veelhoekRaaktKader(punten, [], box) : punten.every(inKader);
  };
  const selected = (type: "beam" | "plate", id: number, object: THREE.Mesh, instanceIndex?: number) => {
    if (doos) {
      const stand = standInDoos(type, id);
      if (stand === "buiten") return false;
      if (stand === "deels") return zichtbaarDeelGeselecteerd(type, id);
    }
    if (!crossing) return openFem3DBoxContainsMesh(box, object, camera, width, height, instanceIndex);
    if (type === "beam" && systemLineTouches(id)) return true;
    return openFem3DMeshTouchesBox(box, object, camera, width, height, instanceIndex);
  };
  for (const object of meshes) {
    if (!(object instanceof THREE.Mesh) || !object.visible) continue;
    // Een scharnierbolletje ligt op de staaf; het kader kiest de staaf zelf
    // (venster: helemaal erin), niet een bolletje dat er toevallig in valt.
    if (object.userData.openFem3dBeamHinge === true) continue;
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
  const lastDelen = doos
    ? loadSegments.flatMap((segment) => {
      const deel = openFem3DSectionBoxKnipLijnstuk(doos, segment.a, segment.b);
      return deel ? [{ ...segment, a: deel.a, b: deel.b }] : [];
    })
    : loadSegments;
  if (nodes.size + beams.size + plates.size === 0 && lastDelen.length > 0) {
    const load = loadInScreenBox(lastDelen,
      matrix ?? new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements,
      width, height, box, crossing);
    if (load) return load;
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
  // Lasten uit het selectiefilter (issue #94) blijven bij een kader met Ctrl staan.
  if (additive && current?.type === "multi" && current.loads) {
    return openFem3DSelectionFromIds({ nodeIds, beamIds, plateIds, loads: current.loads });
  }
  if (nodeIds.length === 1 && beamIds.length + plateIds.length === 0) return { type: "node", id: nodeIds[0] };
  if (beamIds.length === 1 && nodeIds.length + plateIds.length === 0) return { type: "beam", id: beamIds[0] };
  if (plateIds.length === 1 && nodeIds.length + beamIds.length === 0) return { type: "plate", id: plateIds[0] };
  return { type: "multi", nodeIds, beamIds, ...(plateIds.length ? { plateIds } : {}) };
}
