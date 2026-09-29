import * as THREE from "three";
import type { Frame3DModel, Frame3DNode, Frame3DPlate, Frame3DPlateBoundarySegment } from "./frame3dModel";
import { circularArcThroughPoints2D } from "./frame3dCircularArc";

export interface Frame3DPlateGeometry {
  geometry: THREE.ExtrudeGeometry;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  normal: THREE.Vector3;
  surfaceAnchor: THREE.Vector3;
  surfaceLabelAnchor: THREE.Vector3;
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

function boundaryPath(
  boundary: readonly Frame3DPlateBoundarySegment[],
  byId: ReadonlyMap<number, Frame3DNode>,
  project: (node: Frame3DNode) => THREE.Vector2,
  shape: boolean,
): THREE.Shape | THREE.Path | null {
  const first = byId.get(boundary[0]?.startNodeId);
  if (!first) return null;
  const path = shape ? new THREE.Shape() : new THREE.Path();
  const start = project(first);
  path.moveTo(start.x, start.y);
  for (const segment of boundary) {
    const endNode = byId.get(segment.endNodeId);
    if (!endNode) return null;
    const end = project(endNode);
    if (segment.kind === "arc") {
      const startNode = byId.get(segment.startNodeId);
      const controlNode = byId.get(segment.controlNodeId);
      if (!startNode || !controlNode) return null;
      const control = project(controlNode);
      const arc = circularArcThroughPoints2D(project(startNode), control, end);
      if (!arc) return null;
      path.absarc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle, arc.clockwise);
    } else {
      path.lineTo(end.x, end.y);
    }
  }
  path.closePath();
  return path;
}

export function createFrame3DPlateGeometry(
  model: Frame3DModel,
  plate: Frame3DPlate,
  nodeIndex?: ReadonlyMap<number, Frame3DNode>,
): Frame3DPlateGeometry | null {
  const generatedIndex = new Map<number, Frame3DNode>();
  if (!nodeIndex) for (const node of model.nodes) generatedIndex.set(node.id, node);
  const byId = nodeIndex ?? generatedIndex;
  const nodes = plate.nodeIds.map((id) => byId.get(id)).filter(Boolean) as Frame3DNode[];
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
  const shape = (plate.boundary
    ? boundaryPath(plate.boundary, byId, project, true)
    : roundedPath(nodes.map(project), plate.cornerRadiusM ?? 0, true)) as THREE.Shape | null;
  if (!shape) return null;
  for (const opening of plate.openings ?? []) {
    const openingNodes = opening.nodeIds.map((id) => byId.get(id)).filter(Boolean) as Frame3DNode[];
    if (openingNodes.length >= 3) {
      const hole = opening.boundary
        ? boundaryPath(opening.boundary, byId, project, false)
        : roundedPath(openingNodes.map(project), opening.cornerRadiusM ?? 0, false);
      if (hole) shape.holes.push(hole as THREE.Path);
    }
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: plate.thicknessM,
    bevelEnabled: false,
    curveSegments: 10,
  });
  geometry.translate(0, 0, -plate.thicknessM / 2);
  geometry.computeVertexNormals();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
  // Het gemiddelde van de contourknopen kan in een opening vallen. Kies het
  // zwaartepunt van een echte kapdriehoek: die ligt altijd op het plaatvlak.
  const cap = geometry.groups.find((group) => group.materialIndex === 0);
  const vertices = geometry.getAttribute("position");
  let anchor = new THREE.Vector3();
  let largestArea = 0;
  if (cap) for (let index = cap.start; index + 2 < cap.start + cap.count; index += 3) {
    const ax = vertices.getX(index), ay = vertices.getY(index);
    const bx = vertices.getX(index + 1), by = vertices.getY(index + 1);
    const cx = vertices.getX(index + 2), cy = vertices.getY(index + 2);
    const area = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (area > largestArea) {
      largestArea = area;
      anchor = new THREE.Vector3((ax + bx + cx) / 3, (ay + by + cy) / 3, 0);
    }
  }
  const surfaceAnchor = anchor.applyQuaternion(quaternion).add(position);
  // A label can be wider than the remaining material around an opening.
  // Keep its anchor just beyond the outer contour; the load arrow remains on
  // the actual plate surface at surfaceAnchor.
  const outlineBounds = new THREE.Box2().setFromPoints(shape.getPoints(24));
  const labelOffset = Math.max(0.05, outlineBounds.getSize(new THREE.Vector2()).y * 0.035);
  const surfaceLabelAnchor = new THREE.Vector3(
    (outlineBounds.min.x + outlineBounds.max.x) / 2,
    outlineBounds.max.y + labelOffset,
    0,
  ).applyQuaternion(quaternion).add(position);
  return { geometry, position, quaternion, normal, surfaceAnchor, surfaceLabelAnchor };
}
