import * as THREE from "three";
import type { OpenFem3DModel, OpenFem3DNode, OpenFem3DPlate, OpenFem3DPlateBoundarySegment } from "./openFem3dModel";
import { circularArcThroughPoints2D } from "./openFem3dCircularArc";
import { OPEN_FEM_3D_PLATE_DISPLAY_STYLES, type OpenFem3DPlateDisplay } from "./openFem3dPlateDisplay";

export interface OpenFem3DPlateGeometry {
  /**
   * In de eigen vlakassen van de plaat, het middenvlak op z = 0. Volume: de
   * extrusie over de dikte (z = −t/2 … t/2); Vlak en Mesh: alleen het
   * middenvlak (z = 0), zonder dikte (issue #78).
   */
  geometry: THREE.BufferGeometry;
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

function point(node: OpenFem3DNode): THREE.Vector3 {
  return new THREE.Vector3(node.x, node.y, node.z);
}

function boundaryPath(
  boundary: readonly OpenFem3DPlateBoundarySegment[],
  byId: ReadonlyMap<number, OpenFem3DNode>,
  project: (node: OpenFem3DNode) => THREE.Vector2,
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

/** Vlakke omtrek van een plaat (met bogen, afronding en openingen) in haar eigen vlakassen. */
export interface OpenFem3DPlateShape {
  shape: THREE.Shape;
  /** Oorsprong van de vlakassen: de eerste contourknoop, op het middenvlak. */
  position: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  normal: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export function openFem3DPlateShape(
  model: OpenFem3DModel,
  plate: OpenFem3DPlate,
  nodeIndex?: ReadonlyMap<number, OpenFem3DNode>,
): OpenFem3DPlateShape | null {
  const generatedIndex = new Map<number, OpenFem3DNode>();
  if (!nodeIndex) for (const node of model.nodes) generatedIndex.set(node.id, node);
  const byId = nodeIndex ?? generatedIndex;
  const nodes = plate.nodeIds.map((id) => byId.get(id)).filter(Boolean) as OpenFem3DNode[];
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
  const project = (node: OpenFem3DNode) => {
    const relative = point(node).sub(position);
    return new THREE.Vector2(relative.dot(u), relative.dot(v));
  };
  const shape = (plate.boundary
    ? boundaryPath(plate.boundary, byId, project, true)
    : roundedPath(nodes.map(project), plate.cornerRadiusM ?? 0, true)) as THREE.Shape | null;
  if (!shape) return null;
  for (const opening of plate.openings ?? []) {
    const openingNodes = opening.nodeIds.map((id) => byId.get(id)).filter(Boolean) as OpenFem3DNode[];
    if (openingNodes.length >= 3) {
      const hole = opening.boundary
        ? boundaryPath(opening.boundary, byId, project, false)
        : roundedPath(openingNodes.map(project), opening.cornerRadiusM ?? 0, false);
      if (hole) shape.holes.push(hole as THREE.Path);
    }
  }
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, normal));
  return { shape, position, u, v, normal, quaternion };
}

/**
 * De plaat als Three.js-geometrie in de gekozen plaatweergave (issue #78):
 * "volume" (standaard) de extrusie over de dikte, "surface" en "mesh" alleen
 * het middenvlak (dezelfde omtrek, bogen en openingen, geen dikte).
 */
export function createOpenFem3DPlateGeometry(
  model: OpenFem3DModel,
  plate: OpenFem3DPlate,
  nodeIndex?: ReadonlyMap<number, OpenFem3DNode>,
  display: OpenFem3DPlateDisplay = "volume",
): OpenFem3DPlateGeometry | null {
  const outline = openFem3DPlateShape(model, plate, nodeIndex);
  if (!outline) return null;
  const { shape, position, normal, quaternion } = outline;
  let geometry: THREE.BufferGeometry;
  if (OPEN_FEM_3D_PLATE_DISPLAY_STYLES[display]?.flat) {
    // Hetzelfde aantal boogstukken als de extrusie: dezelfde omtrek.
    geometry = new THREE.ShapeGeometry(shape, 10);
  } else {
    geometry = new THREE.ExtrudeGeometry(shape, {
      depth: plate.thicknessM,
      bevelEnabled: false,
      curveSegments: 10,
    });
    geometry.translate(0, 0, -plate.thicknessM / 2);
    geometry.computeVertexNormals();
  }
  // Het gemiddelde van de contourknopen kan in een opening vallen. Kies het
  // zwaartepunt van een echte kapdriehoek: die ligt altijd op het plaatvlak.
  // De extrusie heeft de kapvlakken in groep 0 (zonder index); het vlak is
  // één geïndexeerde groep.
  const cap = geometry.groups.find((group) => group.materialIndex === 0);
  const vertices = geometry.getAttribute("position");
  const indices = geometry.getIndex();
  const capStart = cap?.start ?? 0;
  const capCount = cap?.count ?? (indices ? indices.count : vertices.count);
  const vertexAt = (k: number) => indices ? indices.getX(k) : k;
  let anchor = new THREE.Vector3();
  let largestArea = 0;
  for (let index = capStart; index + 2 < capStart + capCount; index += 3) {
    const a = vertexAt(index), b = vertexAt(index + 1), c = vertexAt(index + 2);
    const ax = vertices.getX(a), ay = vertices.getY(a);
    const bx = vertices.getX(b), by = vertices.getY(b);
    const cx = vertices.getX(c), cy = vertices.getY(c);
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
