import * as THREE from "three";
import type { OpenFem3DModel } from "./openFem3dModel";

export interface OpenFem3DNodeScreenPoint {
  id: number;
  xPx: number;
  yPx: number;
  depth: number;
  /** Clip-w van de knoop: bij een perspectiefcamera de diepte langs de kijkrichting. */
  viewDepth: number;
}

export interface OpenFem3DNodeSnapScreenIndex {
  width: number;
  height: number;
  cellSizePx: number;
  nodeCount: number;
  buckets: Map<string, OpenFem3DNodeScreenPoint[]>;
}

export interface OpenFem3DNodeScreenSnap {
  point: OpenFem3DNodeScreenPoint;
  distancePx: number;
  candidateCount: number;
}

const DEFAULT_CELL_SIZE_PX = 32;

function bucketKey(x: number, y: number): string {
  return `${x}|${y}`;
}

/**
 * Projecteert alle knopen eenmaal naar schermruimte. Een muisbeweging hoeft
 * daarna alleen de eigen cel en buurcellen te bekijken, onafhankelijk van de
 * totale modelomvang.
 */
export function buildOpenFem3DNodeSnapScreenIndex(
  nodes: OpenFem3DModel["nodes"],
  camera: THREE.Camera,
  width: number,
  height: number,
  cellSizePx = DEFAULT_CELL_SIZE_PX,
): OpenFem3DNodeSnapScreenIndex {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safeCellSize = Math.max(1, cellSizePx);
  const buckets = new Map<string, OpenFem3DNodeScreenPoint[]>();
  // Eén gecombineerde matrix en kale getallen zijn bij tienduizenden knopen
  // aanzienlijk goedkoper dan per knoop Vector3.project() aanroepen.
  const elements = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    .elements;
  for (const node of nodes) {
    const clipX = elements[0] * node.x + elements[4] * node.y + elements[8] * node.z + elements[12];
    const clipY = elements[1] * node.x + elements[5] * node.y + elements[9] * node.z + elements[13];
    const clipZ = elements[2] * node.x + elements[6] * node.y + elements[10] * node.z + elements[14];
    const clipW = elements[3] * node.x + elements[7] * node.y + elements[11] * node.z + elements[15];
    if (!Number.isFinite(clipW) || clipW <= 0) continue;
    const x = clipX / clipW;
    const y = clipY / clipW;
    const depth = clipZ / clipW;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(depth) || depth < -1 || depth > 1) continue;
    const point: OpenFem3DNodeScreenPoint = {
      id: node.id,
      xPx: (x + 1) * safeWidth / 2,
      yPx: (1 - y) * safeHeight / 2,
      depth,
      viewDepth: clipW,
    };
    const key = bucketKey(Math.floor(point.xPx / safeCellSize), Math.floor(point.yPx / safeCellSize));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  return { width: safeWidth, height: safeHeight, cellSizePx: safeCellSize, nodeCount: nodes.length, buckets };
}

/** Zoekt de dichtstbijzijnde zichtbare knoop binnen de opgegeven snapzone. */
export function findOpenFem3DNodeScreenSnap(
  index: OpenFem3DNodeSnapScreenIndex,
  xPx: number,
  yPx: number,
  radiusPx = 14,
  excludedNodeId?: number,
  acceptsNodeId?: (id: number) => boolean,
): OpenFem3DNodeScreenSnap | null {
  const radius = Math.max(0, radiusPx);
  const minCellX = Math.floor((xPx - radius) / index.cellSizePx);
  const maxCellX = Math.floor((xPx + radius) / index.cellSizePx);
  const minCellY = Math.floor((yPx - radius) / index.cellSizePx);
  const maxCellY = Math.floor((yPx + radius) / index.cellSizePx);
  let candidateCount = 0;
  let bestPoint: OpenFem3DNodeScreenPoint | null = null;
  let bestDistanceSq = radius * radius;
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = index.buckets.get(bucketKey(cellX, cellY));
      if (!bucket) continue;
      candidateCount += bucket.length;
      for (const point of bucket) {
        if (point.id === excludedNodeId || (acceptsNodeId && !acceptsNodeId(point.id))) continue;
        const dx = point.xPx - xPx;
        const dy = point.yPx - yPx;
        const distanceSq = dx * dx + dy * dy;
        if (distanceSq > bestDistanceSq) continue;
        if (distanceSq === bestDistanceSq && bestPoint && point.depth >= bestPoint.depth) continue;
        bestPoint = point;
        bestDistanceSq = distanceSq;
      }
    }
  }
  return bestPoint
    ? { point: bestPoint, distancePx: Math.sqrt(bestDistanceSq), candidateCount }
    : null;
}

/**
 * De knoop waarvan de getekende bol onder het schermpunt ligt. `radiusPx`
 * geeft per knoop de straal van zijn klikzone (de zichtbare bol, met een
 * minimum); `maxRadiusPx` begrenst alleen het zoekgebied. Anders dan de
 * tekensnap hierboven wint een knoop hier niet van alles binnen een vaste
 * zone: in een uitgezoomd groot model ligt om de paar pixels een knoop op
 * een staaf, en die stal dan de klik op de staaf.
 */
export function findOpenFem3DNodeAtScreenPoint(
  index: OpenFem3DNodeSnapScreenIndex,
  xPx: number,
  yPx: number,
  radiusPx: (point: OpenFem3DNodeScreenPoint) => number,
  maxRadiusPx: number,
): OpenFem3DNodeScreenSnap | null {
  const radius = Math.max(0, maxRadiusPx);
  const minCellX = Math.floor((xPx - radius) / index.cellSizePx);
  const maxCellX = Math.floor((xPx + radius) / index.cellSizePx);
  const minCellY = Math.floor((yPx - radius) / index.cellSizePx);
  const maxCellY = Math.floor((yPx + radius) / index.cellSizePx);
  let candidateCount = 0;
  let bestPoint: OpenFem3DNodeScreenPoint | null = null;
  let bestDistance = Infinity;
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = index.buckets.get(bucketKey(cellX, cellY));
      if (!bucket) continue;
      candidateCount += bucket.length;
      for (const point of bucket) {
        const distance = Math.hypot(point.xPx - xPx, point.yPx - yPx);
        if (distance > Math.min(radius, radiusPx(point))) continue;
        if (distance > bestDistance || distance === bestDistance && bestPoint && point.depth >= bestPoint.depth) continue;
        bestPoint = point;
        bestDistance = distance;
      }
    }
  }
  return bestPoint ? { point: bestPoint, distancePx: bestDistance, candidateCount } : null;
}
