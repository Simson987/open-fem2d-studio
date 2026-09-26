import * as THREE from "three";
import type { Frame3DModel, Frame3DNode, Frame3DPlate } from "./frame3dModel";

export interface Frame3DPlateGeometry {
  geometry: THREE.ExtrudeGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
}

function roundedPath(points: THREE.Vector2[], radius: number, shape: boolean): THREE.Shape | THREE.Path {
  const path = shape ? new THREE.Shape() : new THREE.Path();
  const count = points.length;
  const corners = points.map((point, index) => {
    const previous = points[(index + count - 1) % count], next = points[(index + 1) % count];
    const incoming = previous.clone().sub(point), outgoing = next.clone().sub(point);
    const limited = Math.min(Math.max(0, radius), incoming.length() * 0.45, outgoing.length() * 0.45);
    return {
      start: point.clone().add(incoming.normalize().multiplyScalar(limited)),
      corner: point,
      end: point.clone().add(outgoing.normalize().multiplyScalar(limited)),
    };
  });
  path.moveTo(corners[0].start.x, corners[0].start.y);
  for (let index = 0; index < count; index += 1) {
    const corner = corners[index];
    if (radius > 0) path.quadraticCurveTo(corner.corner.x, corner.corner.y, corner.end.x, corner.end.y);
    else path.lineTo(corner.corner.x, corner.corner.y);
    const next = corners[(index + 1) % count];
    path.lineTo(next.start.x, next.start.y);
  }
  path.closePath();
  return path;
}

function point(node: Frame3DNode): THREE.Vector3 {
  return new THREE.Vector3(node.x, node.y, node.z);
}

export function createFrame3DPlateGeometry(model: Frame3DModel, plate: Frame3DPlate): Frame3DPlateGeometry | null {
  const nodes = plate.nodeIds.map((id) => model.nodes.find((node) => node.id === id)).filter(Boolean) as Frame3DNode[];
  if (nodes.length < 3) return null;
  const position = point(nodes[0]);
  const u = point(nodes[1]).sub(position).normalize();
  let normal: THREE.Vector3 | null = null;
  for (let index = 2; index < nodes.length && !normal; index += 1) {
    const candidate = new THREE.Vector3().crossVectors(u, point(nodes[index]).sub(position));
    if (candidate.lengthSq() > 1e-16) normal = candidate.normalize();
  }
  if (!normal) return null;
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const project = (node: Frame3DNode) => {
    const relative = point(node).sub(position);
    return new THREE.Vector2(relative.dot(u), relative.dot(v));
  };
  const shape = roundedPath(nodes.map(project), plate.cornerRadiusM ?? 0, true) as THREE.Shape;
  for (const opening of plate.openings ?? []) {
    const openingNodes = opening.nodeIds.map((id) => model.nodes.find((node) => node.id === id)).filter(Boolean) as Frame3DNode[];
    if (openingNodes.length >= 3) shape.holes.push(roundedPath(openingNodes.map(project), opening.cornerRadiusM ?? 0, false) as THREE.Path);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: plate.thicknessM,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -plate.thicknessM / 2);
  geometry.computeVertexNormals();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
  const centroid = nodes.reduce((sum, node) => sum.add(point(node)), new THREE.Vector3()).multiplyScalar(1 / nodes.length);
  return { geometry, position, quaternion, normal, centroid };
}
