import * as THREE from "three";
import type { OpenFem3DModel } from "./openFem3dModel";

export interface OpenFem3DNodeScreenPoint {
  id: number;
  xPx: number;
  yPx: number;
  depth: number;
  /** Clip-w van de knoop: bij een perspectiefcamera de diepte langs de kijkrichting, bij een parallelle camera 1. */
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

/**
 * Schermafstanden die minder dan dit verschillen, gelden als gelijk; dan wint
 * de voorste knoop. In parallelle projectie vallen knopen die precies achter
 * elkaar liggen op hetzelfde schermpunt, en verschillen hun afstanden tot de
 * muis alleen door afronding. Zonder deze marge won daar willekeurig een
 * achterliggende knoop (een klik of tekensnap op de knoop erachter).
 */
export const OPEN_FEM_3D_NODE_SNAP_GELIJK_PX = 1e-3;

/**
 * De knoop met de kleinste schermafstand tot (xPx, yPx) binnen `zoekStraal`;
 * `afstand` geeft per knoop zijn afstand, of null als hij niet meedoet.
 * Knopen binnen OPEN_FEM_3D_NODE_SNAP_GELIJK_PX van de kleinste afstand
 * gelden als gelijk; daarvan wint de voorste (kleinste diepte). Twee rondes,
 * zodat de uitkomst niet van de volgorde in de cellen afhangt.
 */
function kiesKnoop(
  index: OpenFem3DNodeSnapScreenIndex,
  xPx: number,
  yPx: number,
  zoekStraal: number,
  afstand: (point: OpenFem3DNodeScreenPoint) => number | null,
): OpenFem3DNodeScreenSnap | null {
  const radius = Math.max(0, zoekStraal);
  const minCellX = Math.floor((xPx - radius) / index.cellSizePx);
  const maxCellX = Math.floor((xPx + radius) / index.cellSizePx);
  const minCellY = Math.floor((yPx - radius) / index.cellSizePx);
  const maxCellY = Math.floor((yPx + radius) / index.cellSizePx);
  let candidateCount = 0;
  const kandidaten: { point: OpenFem3DNodeScreenPoint; distance: number }[] = [];
  let kleinste = Infinity;
  for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      const bucket = index.buckets.get(bucketKey(cellX, cellY));
      if (!bucket) continue;
      candidateCount += bucket.length;
      for (const point of bucket) {
        const distance = afstand(point);
        if (distance === null || !(distance <= radius)) continue;
        kandidaten.push({ point, distance });
        if (distance < kleinste) kleinste = distance;
      }
    }
  }
  let beste: { point: OpenFem3DNodeScreenPoint; distance: number } | null = null;
  for (const kandidaat of kandidaten) {
    if (kandidaat.distance > kleinste + OPEN_FEM_3D_NODE_SNAP_GELIJK_PX) continue;
    if (!beste || kandidaat.point.depth < beste.point.depth
      || (kandidaat.point.depth === beste.point.depth && kandidaat.distance < beste.distance)) {
      beste = kandidaat;
    }
  }
  return beste ? { point: beste.point, distancePx: beste.distance, candidateCount } : null;
}

/** Zoekt de dichtstbijzijnde zichtbare knoop binnen de opgegeven snapzone (bij gelijke afstand de voorste). */
export function findOpenFem3DNodeScreenSnap(
  index: OpenFem3DNodeSnapScreenIndex,
  xPx: number,
  yPx: number,
  radiusPx = 14,
  excludedNodeId?: number,
  acceptsNodeId?: (id: number) => boolean,
): OpenFem3DNodeScreenSnap | null {
  return kiesKnoop(index, xPx, yPx, radiusPx, (point) => {
    if (point.id === excludedNodeId || (acceptsNodeId && !acceptsNodeId(point.id))) return null;
    return Math.hypot(point.xPx - xPx, point.yPx - yPx);
  });
}

/**
 * De knoop waarvan de getekende bol onder het schermpunt ligt. `radiusPx`
 * geeft per knoop de straal van zijn klikzone (de zichtbare bol, met een
 * minimum); `maxRadiusPx` begrenst alleen het zoekgebied. Anders dan de
 * tekensnap hierboven wint een knoop hier niet van alles binnen een vaste
 * zone: in een uitgezoomd groot model ligt om de paar pixels een knoop op
 * een staaf, en die stal dan de klik op de staaf. Bij gelijke afstand (knopen
 * achter elkaar) wint de voorste.
 */
export function findOpenFem3DNodeAtScreenPoint(
  index: OpenFem3DNodeSnapScreenIndex,
  xPx: number,
  yPx: number,
  radiusPx: (point: OpenFem3DNodeScreenPoint) => number,
  maxRadiusPx: number,
): OpenFem3DNodeScreenSnap | null {
  const radius = Math.max(0, maxRadiusPx);
  return kiesKnoop(index, xPx, yPx, radius, (point) => {
    const distance = Math.hypot(point.xPx - xPx, point.yPx - yPx);
    return distance > Math.min(radius, radiusPx(point)) ? null : distance;
  });
}
