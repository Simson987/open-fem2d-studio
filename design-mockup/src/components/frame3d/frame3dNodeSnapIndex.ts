import * as THREE from "three";
import type { Frame3DModel } from "./frame3dModel";

export interface Frame3DNodeScreenPoint {
  id: number;
  xPx: number;
  yPx: number;
  depth: number;
}

export interface Frame3DNodeSnapScreenIndex {
  width: number;
  height: number;
  cellSizePx: number;
  nodeCount: number;
  buckets: Map<string, Frame3DNodeScreenPoint[]>;
}

export interface Frame3DNodeScreenSnap {
  point: Frame3DNodeScreenPoint;
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
export function buildFrame3DNodeSnapScreenIndex(
  nodes: Frame3DModel["nodes"],
  camera: THREE.Camera,
  width: number,
  height: number,
  cellSizePx = DEFAULT_CELL_SIZE_PX,
): Frame3DNodeSnapScreenIndex {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const safeCellSize = Math.max(1, cellSizePx);
  const buckets = new Map<string, Frame3DNodeScreenPoint[]>();
  const projected = new THREE.Vector3();
  for (const node of nodes) {
    projected.set(node.x, node.y, node.z).project(camera);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) continue;
    if (projected.z < -1 || projected.z > 1) continue;
    const point: Frame3DNodeScreenPoint = {
      id: node.id,
      xPx: (projected.x + 1) * safeWidth / 2,
      yPx: (1 - projected.y) * safeHeight / 2,
      depth: projected.z,
    };
    const key = bucketKey(Math.floor(point.xPx / safeCellSize), Math.floor(point.yPx / safeCellSize));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  return { width: safeWidth, height: safeHeight, cellSizePx: safeCellSize, nodeCount: nodes.length, buckets };
}

/** Zoekt de dichtstbijzijnde zichtbare knoop binnen de opgegeven snapzone. */
export function findFrame3DNodeScreenSnap(
  index: Frame3DNodeSnapScreenIndex,
  xPx: number,
  yPx: number,
  radiusPx = 14,
): Frame3DNodeScreenSnap | null {
  const radius = Math.max(0, radiusPx);
  const minCellX = Math.floor((xPx - radius) / index.cellSizePx);
  const maxCellX = Math.floor((xPx + radius) / index.cellSizePx);
  const minCellY = Math.floor((yPx - radius) / index.cellSizePx);
  const maxCellY = Math.floor((yPx + radius) / index.cellSizePx);
  let candidateCount = 0;
  let bestPoint: Frame3DNodeScreenPoint | null = null;
  let bestDistanceSq = radius * radius;
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = index.buckets.get(bucketKey(cellX, cellY));
      if (!bucket) continue;
      candidateCount += bucket.length;
      for (const point of bucket) {
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
