import * as THREE from "three";
import type { OpenFem3DBeam, OpenFem3DNode } from "./openFem3dModel";
import { openFem3DCameraAfstand } from "./openFem3dProjectie";
import { openFem3DSectionBoxKnipLijnstuk, type OpenFem3DSectionBoxBounds } from "./openFem3dSectionBox";

export interface OpenFem3DBeamScreenHit {
  beamId: number;
  distancePx: number;
  /** NDC-diepte van het dichtstbijzijnde punt: −1 bij het nabije vlak, 1 bij het verre. */
  depth: number;
  /** Punt op de systeemlijn onder de cursor (perspectief-correct), in meters. */
  point: THREE.Vector3;
  /** Afstand van de camera tot `point`; vergelijkbaar met de afstand van een raycasttreffer. */
  distance: number;
}

/**
 * Een lijnstuk in schermpixels, afgeknipt op het nabije en verre vlak van de
 * camera. `s0`/`s1` zijn de parameters van de afgeknipte eindpunten op het
 * oorspronkelijke 3D-lijnstuk (0 = begin, 1 = eind); `w0`/`w1` hun clip-w,
 * nodig om een schermpunt perspectief-correct naar 3D terug te rekenen.
 */
export interface OpenFem3DScreenSegment {
  ax: number; ay: number; aDepth: number; w0: number; s0: number;
  bx: number; by: number; bDepth: number; w1: number; s1: number;
}

type Punt = { x: number; y: number; z: number };

/**
 * Projecteer een 3D-lijnstuk met de gecombineerde matrix (projectie ×
 * wereld-naar-camera). Een staaf die deels achter de camera ligt, wordt op
 * het nabije vlak afgeknipt in plaats van weggelaten: ingezoomd in een hal
 * blijft een lange gording zo aanklikbaar en selecteerbaar.
 */
export function openFem3DProjectSegment(
  m: ArrayLike<number>,
  a: Punt,
  b: Punt,
  width: number,
  height: number,
): OpenFem3DScreenSegment | null {
  // Kale getallen: een klik of kader loopt langs alle staven van het model.
  const ax = m[0] * a.x + m[4] * a.y + m[8] * a.z + m[12];
  const ay = m[1] * a.x + m[5] * a.y + m[9] * a.z + m[13];
  const az = m[2] * a.x + m[6] * a.y + m[10] * a.z + m[14];
  const aw = m[3] * a.x + m[7] * a.y + m[11] * a.z + m[15];
  const bx = m[0] * b.x + m[4] * b.y + m[8] * b.z + m[12];
  const by = m[1] * b.x + m[5] * b.y + m[9] * b.z + m[13];
  const bz = m[2] * b.x + m[6] * b.y + m[10] * b.z + m[14];
  const bw = m[3] * b.x + m[7] * b.y + m[11] * b.z + m[15];
  if (!Number.isFinite(ax + ay + az + aw + bx + by + bz + bw)) return null;
  let s0 = 0;
  let s1 = 1;
  // Binnen het nabije vlak: z + w ≥ 0; binnen het verre vlak: w − z ≥ 0.
  const clipPlane = (da: number, db: number) => {
    if (da < 0 && db < 0) return false;
    if (da < 0) s0 = Math.max(s0, da / (da - db));
    else if (db < 0) s1 = Math.min(s1, da / (da - db));
    return true;
  };
  if (!clipPlane(az + aw, bz + bw) || !clipPlane(aw - az, bw - bz) || s0 > s1) return null;
  const w0 = aw + s0 * (bw - aw);
  const w1 = aw + s1 * (bw - aw);
  if (!(w0 > 1e-12) || !(w1 > 1e-12)) return null;
  return {
    ax: ((ax + s0 * (bx - ax)) / w0 + 1) * width / 2,
    ay: (1 - (ay + s0 * (by - ay)) / w0) * height / 2,
    aDepth: (az + s0 * (bz - az)) / w0,
    w0, s0,
    bx: ((ax + s1 * (bx - ax)) / w1 + 1) * width / 2,
    by: (1 - (ay + s1 * (by - ay)) / w1) * height / 2,
    bDepth: (az + s1 * (bz - az)) / w1,
    w1, s1,
  };
}

/** Een treffer van {@link findOpenFem3DSegmentNearScreenPoint}: het lijnstuk zelf plus de maten van de treffer. */
export interface OpenFem3DSegmentScreenHit<T> {
  item: T;
  distancePx: number;
  /** NDC-diepte van het dichtstbijzijnde punt: −1 bij het nabije vlak, 1 bij het verre. */
  depth: number;
  /** Punt op het lijnstuk onder de cursor (perspectief-correct), in meters. */
  point: THREE.Vector3;
  /** Afstand van de camera tot `point`; vergelijkbaar met de afstand van een raycasttreffer. */
  distance: number;
}

/**
 * Het 3D-lijnstuk dat op het scherm het dichtst bij het schermpunt ligt,
 * binnen `radiusPx`. Bij gelijke schermafstand wint het voorste lijnstuk.
 * Voor alles wat dunner getekend is dan een raycast betrouwbaar raakt: een
 * systeemlijn, een pijlsteel van een last.
 */
export function findOpenFem3DSegmentNearScreenPoint<T extends { a: Punt; b: Punt }>(
  segments: readonly T[],
  camera: THREE.Camera,
  width: number,
  height: number,
  xPx: number,
  yPx: number,
  radiusPx = 6,
): OpenFem3DSegmentScreenHit<T> | null {
  camera.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  let best: { item: T; segment: OpenFem3DScreenSegment; ratio: number; depth: number } | null = null;
  let bestSquared = radiusPx * radiusPx;
  for (const item of segments) {
    const segment = openFem3DProjectSegment(matrix, item.a, item.b, width, height);
    if (!segment) continue;
    if (xPx < Math.min(segment.ax, segment.bx) - radiusPx || xPx > Math.max(segment.ax, segment.bx) + radiusPx
      || yPx < Math.min(segment.ay, segment.by) - radiusPx || yPx > Math.max(segment.ay, segment.by) + radiusPx) continue;
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((xPx - segment.ax) * dx + (yPx - segment.ay) * dy) / lengthSquared))
      : 0;
    const distanceSquared = (xPx - segment.ax - ratio * dx) ** 2 + (yPx - segment.ay - ratio * dy) ** 2;
    const depth = segment.aDepth + ratio * (segment.bDepth - segment.aDepth);
    if (distanceSquared > bestSquared || distanceSquared === bestSquared && best && depth >= best.depth) continue;
    bestSquared = distanceSquared;
    best = { item, segment, ratio, depth };
  }
  if (!best) return null;
  const { item, segment, ratio, depth } = best;
  // 1/w verloopt lineair over het scherm; daarmee wordt de schermfractie
  // een perspectief-correcte parameter op het lijnstuk. Parallel is w = 1 en
  // is de schermfractie zelf de parameter.
  const sigma = ratio * segment.w0 / ((1 - ratio) * segment.w1 + ratio * segment.w0);
  const s = segment.s0 + sigma * (segment.s1 - segment.s0);
  const point = new THREE.Vector3(item.a.x, item.a.y, item.a.z)
    .lerp(new THREE.Vector3(item.b.x, item.b.y, item.b.z), s);
  return {
    item,
    distancePx: Math.sqrt(bestSquared),
    depth,
    point,
    // Zoals de raycast meet: perspectief vanaf het oogpunt, parallel langs de kijkrichting.
    distance: openFem3DCameraAfstand(camera, point),
  };
}

/**
 * De staaf waarvan de systeemlijn het dichtst bij het schermpunt ligt, binnen
 * `radiusPx`. Zo is ook een dunne staaf (buisverband, analytische as, een
 * profiel van één pixel breed) met één klik vlak naast de getekende lijn te
 * kiezen. Bij gelijke schermafstand wint de voorste staaf.
 *
 * Met een section box (issue #86) telt alleen het deel van de systeemlijn
 * binnen de doos: een staaf erbuiten is niet te kiezen, een staaf die de doos
 * snijdt alleen op zijn zichtbare stuk.
 */
export function findOpenFem3DBeamNearScreenPoint(
  beams: readonly OpenFem3DBeam[],
  nodes: ReadonlyMap<number, OpenFem3DNode>,
  camera: THREE.Camera,
  width: number,
  height: number,
  xPx: number,
  yPx: number,
  radiusPx = 6,
  doos: OpenFem3DSectionBoxBounds | null = null,
): OpenFem3DBeamScreenHit | null {
  const segments: { a: Punt; b: Punt; beamId: number }[] = [];
  for (const beam of beams) {
    const a = nodes.get(beam.startNodeId);
    const b = nodes.get(beam.endNodeId);
    if (!a || !b) continue;
    if (!doos) {
      segments.push({ a, b, beamId: beam.id });
      continue;
    }
    const deel = openFem3DSectionBoxKnipLijnstuk(doos, a, b);
    if (deel) segments.push({ ...deel, beamId: beam.id });
  }
  const hit = findOpenFem3DSegmentNearScreenPoint(segments, camera, width, height, xPx, yPx, radiusPx);
  return hit ? {
    beamId: hit.item.beamId, distancePx: hit.distancePx, depth: hit.depth, point: hit.point, distance: hit.distance,
  } : null;
}
