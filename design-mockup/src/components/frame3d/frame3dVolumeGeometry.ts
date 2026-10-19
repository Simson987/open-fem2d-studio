import * as THREE from "three";
import type { Frame3DNode, Frame3DVolume } from "./frame3dModel";
import { TET_FACES, HEX_FACES } from "./frame3dVolumeFaces";

const TET_EDGES = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]] as const;
const HEX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
] as const;

export interface Frame3DVolumeBatchGeometry {
  kind: Frame3DVolume["kind"];
  faces: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  /** One ID for each non-indexed triangle, matching Three.js faceIndex. */
  volumeIdByFace: number[];
  volumesById: Map<number, Frame3DVolume>;
}

/**
 * Keep large solid views to a bounded number of draw calls and pick targets.
 * Centroid ordering keeps each chunk spatially local so raycasts can discard
 * most chunks by their bounding boxes before testing triangles.
 */
export function createFrame3DVolumeBatches(
  volumes: readonly Frame3DVolume[],
  nodeById: ReadonlyMap<number, Frame3DNode>,
  maximumElementsPerBatch = 512,
): Frame3DVolumeBatchGeometry[] {
  if (!Number.isSafeInteger(maximumElementsPerBatch) || maximumElementsPerBatch < 1) {
    throw new Error("Volume-batchgrootte moet een positief geheel getal zijn.");
  }
  const sorted = volumes.flatMap((volume) => {
    const nodes = volume.nodeIds.map((id) => nodeById.get(id));
    if (nodes.some((node) => !node)) return [];
    const centre = [0, 0, 0];
    for (const node of nodes) {
      centre[0] += node!.x;
      centre[1] += node!.y;
      centre[2] += node!.z;
    }
    return [{ volume, nodes: nodes as Frame3DNode[],
      centre: centre.map((coordinate) => coordinate / nodes.length) as [number, number, number] }];
  });
  if (sorted.length === 0) return [];
  const minimum = [...sorted[0].centre];
  const maximum = [...sorted[0].centre];
  for (const item of sorted) {
    for (let axis = 0; axis < 3; axis++) {
      minimum[axis] = Math.min(minimum[axis], item.centre[axis]);
      maximum[axis] = Math.max(maximum[axis], item.centre[axis]);
    }
  }
  const morton = (centre: [number, number, number]) => {
    const coordinates = centre.map((value, axis) => Math.max(0, Math.min(1023,
      Math.floor((value - minimum[axis]) / Math.max(maximum[axis] - minimum[axis], 1e-12) * 1023))));
    let key = 0;
    for (let bit = 0; bit < 10; bit++) {
      key |= ((coordinates[0] >> bit) & 1) << (3 * bit);
      key |= ((coordinates[1] >> bit) & 1) << (3 * bit + 1);
      key |= ((coordinates[2] >> bit) & 1) << (3 * bit + 2);
    }
    return key;
  };
  const keyed = sorted.map((item) => ({ ...item, spatialKey: morton(item.centre) }));
  keyed.sort((a, b) => a.volume.kind.localeCompare(b.volume.kind)
    || a.spatialKey - b.spatialKey || a.volume.id - b.volume.id);
  // A conforming solid mesh only needs its exterior shell in the viewer.
  // Count faces across batch boundaries as well, otherwise chunk seams remain
  // visible and cost almost as much to draw/pick as the original interior.
  const faceKey = (nodeIds: readonly number[], face: readonly number[]) =>
    face.map((index) => nodeIds[index]).sort((a, b) => a - b).join(",");
  const faceCounts = new Map<string, number>();
  for (const { volume } of keyed) {
    for (const face of volume.kind === "tet4" ? TET_FACES : HEX_FACES) {
      const key = faceKey(volume.nodeIds, face);
      faceCounts.set(key, (faceCounts.get(key) ?? 0) + 1);
    }
  }
  const drawnEdges = new Set<string>();
  const batches: Frame3DVolumeBatchGeometry[] = [];
  for (let offset = 0; offset < keyed.length;) {
    const kind = keyed[offset].volume.kind;
    const group: typeof keyed = [];
    while (offset < keyed.length && keyed[offset].volume.kind === kind
        && group.length < maximumElementsPerBatch) group.push(keyed[offset++]);
    const facePositions: number[] = [];
    const edgePositions: number[] = [];
    const volumeIdByFace: number[] = [];
    const volumesById = new Map<number, Frame3DVolume>();
    const faces = kind === "tet4" ? TET_FACES : HEX_FACES;
    for (const { volume, nodes } of group) {
      volumesById.set(volume.id, volume);
      const pushPoint = (positions: number[], index: number) => {
        const node = nodes[index];
        positions.push(node.x, node.y, node.z);
      };
      for (const face of faces) {
        // Exactly two incident elements share an interior face. Keep
        // non-manifold faces visible so invalid meshes are not hidden.
        if (faceCounts.get(faceKey(volume.nodeIds, face)) === 2) continue;
        const triangles = face.length === 3
          ? [[face[0], face[1], face[2]]]
          : [[face[0], face[1], face[2]], [face[0], face[2], face[3]]];
        for (const triangle of triangles) {
          triangle.forEach((index) => pushPoint(facePositions, index));
          volumeIdByFace.push(volume.id);
        }
        for (let index = 0; index < face.length; index++) {
          const from = face[index];
          const to = face[(index + 1) % face.length];
          const fromId = volume.nodeIds[from];
          const toId = volume.nodeIds[to];
          const edgeKey = fromId < toId ? `${fromId},${toId}` : `${toId},${fromId}`;
          if (drawnEdges.has(edgeKey)) continue;
          drawnEdges.add(edgeKey);
          pushPoint(edgePositions, from);
          pushPoint(edgePositions, to);
        }
      }
    }
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(facePositions, 3));
    faceGeometry.computeVertexNormals();
    faceGeometry.computeBoundingBox();
    faceGeometry.computeBoundingSphere();
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    batches.push({ kind, faces: faceGeometry, edges: edgeGeometry, volumeIdByFace, volumesById });
  }
  return batches;
}

/** Surface triangles provide a pick target; explicit edges keep a translucent solid legible. */
export function createFrame3DVolumeGeometry(
  volume: Frame3DVolume,
  nodeById: ReadonlyMap<number, Frame3DNode>,
): { faces: THREE.BufferGeometry; edges: THREE.BufferGeometry } | null {
  const nodes = volume.nodeIds.map((id) => nodeById.get(id));
  if (nodes.some((node) => !node)) return null;
  const point = (index: number) => {
    const node = nodes[index]!;
    return [node.x, node.y, node.z];
  };
  const positions: number[] = [];
  const faces = volume.kind === "tet4" ? TET_FACES : HEX_FACES;
  for (const face of faces) {
    const triangles = face.length === 3
      ? [[face[0], face[1], face[2]]]
      : [[face[0], face[1], face[2]], [face[0], face[2], face[3]]];
    triangles.forEach((triangle) => triangle.forEach((index) => positions.push(...point(index))));
  }
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  faceGeometry.computeVertexNormals();

  const edgePositions: number[] = [];
  const edges = volume.kind === "tet4" ? TET_EDGES : HEX_EDGES;
  edges.forEach(([from, to]) => edgePositions.push(...point(from), ...point(to)));
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
  return { faces: faceGeometry, edges: edgeGeometry };
}
