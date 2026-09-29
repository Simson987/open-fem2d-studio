import * as THREE from "three";
import type { Frame3DBeam, Frame3DNode } from "./frame3dModel";

export interface Frame3DBeamScreenHit {
  beamId: number;
  distancePx: number;
  depth: number;
}

/**
 * Vang een dunne analytische staaf vlak naast zijn zichtbare hartlijn.
 * Mesh-raycasting blijft leidend; deze schermtest is alleen voor lege hits.
 */
export function findFrame3DBeamNearScreenPoint(
  beams: readonly Frame3DBeam[],
  nodes: ReadonlyMap<number, Frame3DNode>,
  camera: THREE.Camera,
  width: number,
  height: number,
  xPx: number,
  yPx: number,
  radiusPx = 6,
): Frame3DBeamScreenHit | null {
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  const project = (node: Frame3DNode) => {
    const clipX = matrix[0] * node.x + matrix[4] * node.y + matrix[8] * node.z + matrix[12];
    const clipY = matrix[1] * node.x + matrix[5] * node.y + matrix[9] * node.z + matrix[13];
    const clipZ = matrix[2] * node.x + matrix[6] * node.y + matrix[10] * node.z + matrix[14];
    const clipW = matrix[3] * node.x + matrix[7] * node.y + matrix[11] * node.z + matrix[15];
    if (clipW <= 0 || !Number.isFinite(clipW)) return null;
    const depth = clipZ / clipW;
    if (depth < -1 || depth > 1) return null;
    return { x: (clipX / clipW + 1) * width / 2, y: (1 - clipY / clipW) * height / 2, depth };
  };
  let best: Frame3DBeamScreenHit | null = null;
  let bestSquared = radiusPx * radiusPx;
  for (const beam of beams) {
    const startNode = nodes.get(beam.startNodeId);
    const endNode = nodes.get(beam.endNodeId);
    if (!startNode || !endNode) continue;
    const start = project(startNode);
    const end = project(endNode);
    if (!start || !end) continue;
    if (xPx < Math.min(start.x, end.x) - radiusPx || xPx > Math.max(start.x, end.x) + radiusPx
      || yPx < Math.min(start.y, end.y) - radiusPx || yPx > Math.max(start.y, end.y) + radiusPx) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((xPx - start.x) * dx + (yPx - start.y) * dy) / lengthSquared))
      : 0;
    const distanceSquared = (xPx - start.x - ratio * dx) ** 2 + (yPx - start.y - ratio * dy) ** 2;
    const depth = start.depth + ratio * (end.depth - start.depth);
    if (distanceSquared > bestSquared || distanceSquared === bestSquared && best && depth >= best.depth) continue;
    bestSquared = distanceSquared;
    best = { beamId: beam.id, distancePx: Math.sqrt(distanceSquared), depth };
  }
  return best;
}
