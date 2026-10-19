import type { Frame3DNode, Frame3DVolume } from "./frame3dModel";
import { frame3DVolumeFaces } from "./frame3dVolumeFaces";

type Vector3 = [number, number, number];

const HEX_SIGNS: Vector3[] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];

const determinant = (a: Vector3, b: Vector3, c: Vector3) =>
  a[0] * (b[1] * c[2] - b[2] * c[1])
  - a[1] * (b[0] * c[2] - b[2] * c[0])
  + a[2] * (b[0] * c[1] - b[1] * c[0]);

/** Independent app-side integration for displayed force/moment equilibrium. */
export function consistentFrame3DVolumeBodyLoad(
  volume: Frame3DVolume, nodeById: ReadonlyMap<number, Frame3DNode>, forceKnPerM3: Vector3,
): Array<{ nodeId: number; forceKn: Vector3 }> {
  const nodes = volume.nodeIds.map((id) => nodeById.get(id));
  if (nodes.some((node) => !node)) throw new Error(`3D-volume ${volume.id}: ontbrekende knoop bij volumekracht.`);
  const points = nodes as Frame3DNode[];
  const weights = Array(points.length).fill(0) as number[];
  if (volume.kind === "tet4") {
    const a = points[0];
    const edge = (point: Frame3DNode): Vector3 => [point.x - a.x, point.y - a.y, point.z - a.z];
    const volumeM3 = Math.abs(determinant(edge(points[1]), edge(points[2]), edge(points[3]))) / 6;
    weights.fill(volumeM3 / 4);
  } else {
    const gauss = 1 / Math.sqrt(3);
    for (const r of [-gauss, gauss]) for (const s of [-gauss, gauss]) for (const t of [-gauss, gauss]) {
      const derivatives = HEX_SIGNS.map(([ri, si, ti]): Vector3 => [
        ri * (1 + si * s) * (1 + ti * t) / 8,
        si * (1 + ri * r) * (1 + ti * t) / 8,
        ti * (1 + ri * r) * (1 + si * s) / 8,
      ]);
      const columns = [0, 1, 2].map((axis): Vector3 => [
        points.reduce((sum, point, index) => sum + point.x * derivatives[index][axis], 0),
        points.reduce((sum, point, index) => sum + point.y * derivatives[index][axis], 0),
        points.reduce((sum, point, index) => sum + point.z * derivatives[index][axis], 0),
      ]);
      const jacobian = determinant(columns[0], columns[1], columns[2]);
      if (!Number.isFinite(jacobian) || jacobian <= 0) throw new Error(`Hex8 ${volume.id}: ongeldige volumekracht-Jacobiaan.`);
      for (let index = 0; index < 8; index++) {
        const [ri, si, ti] = HEX_SIGNS[index];
        weights[index] += (1 + ri * r) * (1 + si * s) * (1 + ti * t) / 8 * jacobian;
      }
    }
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error(`3D-volume ${volume.id}: ongeldige geometrie voor volumekracht.`);
  }
  return volume.nodeIds.map((nodeId, index) => ({ nodeId,
    forceKn: forceKnPerM3.map((component) => component * weights[index]) as Vector3 }));
}

/** Independent nodal integration for displaying the Rust face-load equilibrium. */
export function consistentFrame3DVolumeFaceLoad(
  volume: Frame3DVolume, nodeById: ReadonlyMap<number, Frame3DNode>,
  faceIndex: number, tractionKnPerM2: Vector3,
): Array<{ nodeId: number; forceKn: Vector3 }> {
  const face = frame3DVolumeFaces(volume.kind)[faceIndex];
  if (!face) throw new Error(`3D-volume ${volume.id}: ongeldig vlak ${faceIndex + 1}.`);
  const points = face.map((local) => nodeById.get(volume.nodeIds[local]));
  if (points.some((point) => !point)) throw new Error(`3D-volume ${volume.id}: ontbrekende knoop bij vlaktractie.`);
  const corners = points as Frame3DNode[];
  const weights = Array(face.length).fill(0) as number[];
  const subtract = (a: Frame3DNode, b: Frame3DNode): Vector3 => [a.x - b.x, a.y - b.y, a.z - b.z];
  const cross = (a: Vector3, b: Vector3): Vector3 => [
    a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
  ];
  if (volume.kind === "tet4") {
    const area = Math.hypot(...cross(subtract(corners[1], corners[0]), subtract(corners[2], corners[0]))) / 2;
    weights.fill(area / 3);
  } else {
    const signs: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const g = 1 / Math.sqrt(3);
    for (const s of [-g, g]) for (const t of [-g, g]) {
      const shape = signs.map(([si, ti]) => (1 + si * s) * (1 + ti * t) / 4);
      const ds = signs.map(([si, ti]) => si * (1 + ti * t) / 4);
      const dt = signs.map(([si, ti]) => ti * (1 + si * s) / 4);
      const tangent = (derivative: number[]): Vector3 => ["x", "y", "z"].map((axis) =>
        corners.reduce((sum, point, index) => sum + point[axis as "x" | "y" | "z"] * derivative[index], 0)) as Vector3;
      const jacobian = Math.hypot(...cross(tangent(ds), tangent(dt)));
      for (let index = 0; index < 4; index++) weights[index] += shape[index] * jacobian;
    }
  }
  if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
    throw new Error(`3D-volume ${volume.id}: ontaard vlak voor vlaktractie.`);
  }
  return face.map((local, index) => ({ nodeId: volume.nodeIds[local],
    forceKn: tractionKnPerM2.map((component) => component * weights[index]) as Vector3 }));
}
