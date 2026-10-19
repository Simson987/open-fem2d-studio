import * as THREE from "three";
import { frame3DLoadCaseId, frame3DRevoluteAxis, type Frame3DMemberLoad, type Frame3DMemberPointLoad, type Frame3DModel, type Frame3DNode, type Frame3DSupport, type Frame3DThermalLoad } from "./frame3dModel";
import type { Frame3DSingleSelection } from "./frame3dSelection";

export interface Frame3DConditionVisibility {
  supports: boolean;
  loads: boolean;
}

/** World-space size shared by all support and load markers in one model. */
export function frame3DConditionMarkerSize(nodes: readonly Frame3DNode[]): number {
  if (nodes.length === 0) return 0.3;
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const node of nodes) bounds.expandByPoint(point.set(node.x, node.y, node.z));
  return Math.max(0.25, Math.min(0.8, bounds.getSize(new THREE.Vector3()).length() * 0.045));
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const GLOBAL_AXES = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

const MARKER_BATCHER_KEY = "__frame3dMarkerBatcher";

type MarkerInstance = { id: number; matrix: THREE.Matrix4 };
type MarkerBatch = {
  geometry: THREE.BufferGeometry;
  color: number;
  selectionType: Frame3DSingleSelection["type"];
  instances: MarkerInstance[];
};

interface MarkerBatcher {
  geometryFor: (key: string, factory: () => THREE.BufferGeometry) => THREE.BufferGeometry;
  add: (
    geometry: THREE.BufferGeometry,
    color: number,
    id: number,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion | undefined,
    selectionType: Frame3DSingleSelection["type"],
    scale?: THREE.Vector3,
  ) => void;
  addPolyline: (color: number, points: readonly THREE.Vector3[]) => void;
  flush: () => void;
}

function markerGeometrySignature(geometry: THREE.BufferGeometry): string {
  try {
    return `${geometry.type}:${JSON.stringify((geometry as THREE.BufferGeometry & { parameters?: unknown }).parameters ?? {})}`;
  } catch {
    return geometry.uuid;
  }
}

function createMarkerBatcher(group: THREE.Group): MarkerBatcher {
  const batches = new Map<string, MarkerBatch>();
  const geometries = new Map<string, THREE.BufferGeometry>();
  const lineBatches = new Map<number, THREE.Vector3[]>();
  const identityScale = new THREE.Vector3(1, 1, 1);
  return {
    geometryFor(key, factory) {
      let geometry = geometries.get(key);
      if (!geometry) {
        geometry = factory();
        geometries.set(key, geometry);
      }
      return geometry;
    },
    add(geometry, color, id, position, quaternion, selectionType, scale) {
      const key = `${selectionType}\u0000${color}\u0000${markerGeometrySignature(geometry)}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { geometry, color, selectionType, instances: [] };
        batches.set(key, batch);
      } else if (geometry !== batch.geometry) {
        geometry.dispose();
      }
      batch.instances.push({
        id,
        matrix: new THREE.Matrix4().compose(
          position,
          quaternion ?? new THREE.Quaternion(),
          scale ?? identityScale,
        ),
      });
    },
    addPolyline(color, points) {
      if (points.length < 2) return;
      let segments = lineBatches.get(color);
      if (!segments) {
        segments = [];
        lineBatches.set(color, segments);
      }
      for (let index = 0; index < points.length - 1; index += 1) {
        segments.push(points[index], points[index + 1]);
      }
    },
    flush() {
      for (const batch of batches.values()) {
        const mesh = new THREE.InstancedMesh(
          batch.geometry,
          new THREE.MeshStandardMaterial({
            color: 0xffffff, metalness: 0.06, roughness: 0.65, side: THREE.DoubleSide,
          }),
          batch.instances.length,
        );
        const instanceIds = batch.instances.map((instance) => instance.id);
        const instanceBaseColors = batch.instances.map(() => batch.color);
        mesh.userData = { type: batch.selectionType, instanceIds, instanceBaseColors };
        batch.instances.forEach((instance, index) => {
          mesh.setMatrixAt(index, instance.matrix);
          mesh.setColorAt(index, new THREE.Color(batch.color));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) {
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          mesh.instanceColor.needsUpdate = true;
        }
        mesh.computeBoundingBox();
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
      for (const [color, points] of lineBatches) {
        const lines = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color }),
        );
        // De pijlen blijven per last selecteerbaar. Deze verbindingslijn is
        // alleen visuele context en hoeft dus niet als extra raycast-doel mee.
        lines.userData = { pickable: false, frame3dLoadGuide: true };
        group.add(lines);
      }
      batches.clear();
      lineBatches.clear();
    },
  };
}

function markerGeometry(
  group: THREE.Group,
  key: string,
  factory: () => THREE.BufferGeometry,
): THREE.BufferGeometry {
  const batcher = group.userData[MARKER_BATCHER_KEY] as MarkerBatcher | undefined;
  return batcher ? batcher.geometryFor(key, factory) : factory();
}

function nodePoint(node: Frame3DNode): THREE.Vector3 {
  return new THREE.Vector3(node.x, node.y, node.z);
}

function addMesh(
  group: THREE.Group, geometry: THREE.BufferGeometry, color: number,
  nodeId: number, position: THREE.Vector3, quaternion?: THREE.Quaternion,
  selection?: Frame3DSingleSelection,
  scale?: THREE.Vector3,
) {
  const selectionData = selection ?? { type: "node" as const, id: nodeId };
  const batcher = group.userData[MARKER_BATCHER_KEY] as MarkerBatcher | undefined;
  if (batcher) {
    batcher.add(geometry, color, selectionData.id, position, quaternion, selectionData.type, scale);
    return;
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color, metalness: 0.06, roughness: 0.65, side: THREE.DoubleSide,
  }));
  mesh.position.copy(position);
  if (quaternion) mesh.quaternion.copy(quaternion);
  if (scale) mesh.scale.copy(scale);
  mesh.userData = selectionData;
  group.add(mesh);
}

function addSelectableArrow(
  group: THREE.Group,
  direction: THREE.Vector3,
  origin: THREE.Vector3,
  length: number,
  color: number,
  headLength: number,
  headWidth: number,
  selection: Frame3DSingleSelection,
) {
  const batcher = group.userData[MARKER_BATCHER_KEY] as MarkerBatcher | undefined;
  if (!batcher) {
    const arrow = new THREE.ArrowHelper(direction, origin, length, color, headLength, headWidth);
    arrow.userData = selection;
    for (const child of arrow.children) child.userData = selection;
    group.add(arrow);
    return;
  }
  const normalized = direction.clone().normalize();
  const orientation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, normalized);
  const actualHeadLength = Math.min(headLength, length * 0.9);
  const stemLength = Math.max(0, length - actualHeadLength);
  if (stemLength > 1e-10) {
    const radius = Math.max(headWidth * 0.1, 0.004);
    addMesh(
      group,
      markerGeometry(group, "load-arrow-stem-unit", () => new THREE.CylinderGeometry(1, 1, 1, 8)),
      color,
      selection.id,
      origin.clone().addScaledVector(normalized, stemLength / 2),
      orientation,
      selection,
      new THREE.Vector3(radius, stemLength, radius),
    );
  }
  addMesh(
    group,
    markerGeometry(group, "load-arrow-head-unit", () => new THREE.ConeGeometry(1, 1, 10)),
    color,
    selection.id,
    origin.clone().addScaledVector(normalized, length - actualHeadLength / 2),
    orientation,
    selection,
    new THREE.Vector3(headWidth, actualHeadLength, headWidth),
  );
}

function addSupport(group: THREE.Group, node: Frame3DNode, support: Frame3DSupport, size: number) {
  const p = nodePoint(node);
  const revoluteAxis = frame3DRevoluteAxis(support);
  const allFixed = support.ux && support.uy && support.uz && support.rx && support.ry && support.rz;
  const pinned = support.ux && support.uy && support.uz &&
    !support.rx && !support.ry && !support.rz;
  const hasSpring = Object.keys(support.springs ?? {}).length > 0;
  const fixedTranslations = ([
    ["x", support.ux], ["y", support.uy], ["z", support.uz],
  ] as const).filter(([, fixed]) => fixed).map(([axis]) => axis);
  const roller = !hasSpring && !allFixed && !pinned && fixedTranslations.length > 0 &&
    !support.rx && !support.ry && !support.rz;
  const rollerNormal = roller && fixedTranslations.length === 1
    ? GLOBAL_AXES[fixedTranslations[0]!]
    : Z_AXIS;
  const color = 0xd97706;
  const baseColor = 0x475569;
  const horizontal = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS);
  if (allFixed) {
    addMesh(group, markerGeometry(group, `support-fixed:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.76, size * 0.76, size * 0.36, 32)), color, node.id,
      p.clone().add(new THREE.Vector3(0, 0, -size * 0.18)), horizontal);
    // Donkere arcering maakt een inklemming ook in bovenaanzicht herkenbaar.
    for (let offset = -0.55; offset <= 0.55; offset += 0.37) {
      addMesh(group, markerGeometry(group, `support-hatch:${size}`, () =>
        new THREE.BoxGeometry(size * 0.09, size * 1.85, size * 0.09)), baseColor, node.id,
        p.clone().add(new THREE.Vector3(offset * size, 0, -size * 0.43)),
        new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 4));
    }
  } else if (revoluteAxis) {
    // Een revolute oplegging is translatievast en laat precies één rotatie vrij.
    // De as door de knoop en de open ring maken die vrije rotatie ook in een
    // willekeurig camerastandpunt herkenbaar.
    const axis = GLOBAL_AXES[revoluteAxis];
    const orientation = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, axis);
    addMesh(group, markerGeometry(group, `support-revolute-base:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.64, size * 0.64, size * 0.32, 32)), color, node.id,
      p.clone().add(new THREE.Vector3(0, 0, -size * 0.2)), horizontal);
    addMesh(group, markerGeometry(group, `support-revolute-ring:${size}`, () =>
      new THREE.TorusGeometry(size * 0.62, size * 0.09, 12, 48)), color, node.id,
      p.clone().addScaledVector(axis, size * 0.18), orientation);
    addMesh(group, markerGeometry(group, `support-revolute-axis:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.07, size * 0.07, size * 1.65, 10)), baseColor, node.id,
      p.clone(), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis));
  } else if (pinned) {
    addMesh(group, markerGeometry(group, `support-cone:${size}`, () =>
      new THREE.ConeGeometry(size * 0.7, size, 32)), color, node.id,
      p.clone().add(new THREE.Vector3(0, 0, -size * 0.55)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  } else if (roller) {
    addMesh(group, markerGeometry(group, `support-cone:${size}`, () =>
      new THREE.ConeGeometry(size * 0.7, size, 32)), color, node.id,
      p.clone().addScaledVector(rollerNormal, -size * 0.55),
      new THREE.Quaternion().setFromUnitVectors(Y_AXIS, rollerNormal));
  } else {
    addMesh(group, markerGeometry(group, `support-sphere:${size}`, () =>
      new THREE.SphereGeometry(size * 0.62, 24, 16)), color, node.id,
      p.clone().add(new THREE.Vector3(0, 0, -size * 0.5)));
  }
  if (roller) {
    // Twee echte rollen in het vlak loodrecht op de geblokkeerde globale as.
    // Daardoor zijn X-, Y- en Z-rollen ook in een isometrisch beeld verschillend.
    const reference = Math.abs(rollerNormal.z) < 0.9 ? Z_AXIS : new THREE.Vector3(1, 0, 0);
    const rollerAxis = new THREE.Vector3().crossVectors(rollerNormal, reference).normalize();
    const offsetAxis = new THREE.Vector3().crossVectors(rollerNormal, rollerAxis).normalize();
    const rollerRotation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, rollerAxis);
    for (const offset of [-0.34, 0.34]) {
      const position = p.clone().addScaledVector(rollerNormal, -size * 1.1)
        .addScaledVector(offsetAxis, offset * size);
      addMesh(group, markerGeometry(group, `support-roller:${size}`, () =>
        new THREE.CylinderGeometry(size * 0.13, size * 0.13, size * 0.95, 24)),
        baseColor, node.id, position, rollerRotation);
    }
  }
  if (roller) {
    addMesh(group, markerGeometry(group, `support-base:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.9, size * 0.9, size * 0.09, 40)), baseColor, node.id,
      p.clone().addScaledVector(rollerNormal, -size * 1.32),
      new THREE.Quaternion().setFromUnitVectors(Y_AXIS, rollerNormal));
  } else {
    const baseZ = allFixed || revoluteAxis ? -size * 0.48 : -size * 1.08;
    addMesh(group, markerGeometry(group, `support-base:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.9, size * 0.9, size * 0.09, 40)), baseColor, node.id,
      p.clone().add(new THREE.Vector3(0, 0, baseZ)), horizontal);
  }

  const springColor = 0x7c3aed;
  const addLinearSpring = (axis: THREE.Vector3, offsetIndex: number) => {
    const normal = Math.abs(axis.z) < 0.9 ? Z_AXIS : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(axis, normal).normalize();
    const secondSide = new THREE.Vector3().crossVectors(axis, side).normalize();
    const points: THREE.Vector3[] = [];
    const samples = 48;
    for (let index = 0; index <= samples; index += 1) {
      const t = index / samples;
      const endTaper = Math.min(1, t * 8, (1 - t) * 8);
      const angle = t * Math.PI * 10;
      const radius = size * 0.14 * endTaper;
      points.push(p.clone().addScaledVector(axis, -t * size * 1.45)
        .addScaledVector(side, Math.cos(angle) * radius + offsetIndex * size * 0.08)
        .addScaledVector(secondSide, Math.sin(angle) * radius));
    }
    const spring = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), samples, size * 0.026, 8, false),
      new THREE.MeshStandardMaterial({ color: springColor, roughness: 0.55, metalness: 0.08 }),
    );
    spring.userData = { type: "node", id: node.id };
    group.add(spring);
  };
  const translational = [
    [support.springs?.kxKnPerM, GLOBAL_AXES.x],
    [support.springs?.kyKnPerM, GLOBAL_AXES.y],
    [support.springs?.kzKnPerM, GLOBAL_AXES.z],
  ] as const;
  translational.forEach(([stiffness, axis], index) => {
    if (stiffness !== undefined) addLinearSpring(axis, index - 1);
  });
  const rotational = [
    [support.springs?.krxKnmPerRad, GLOBAL_AXES.x],
    [support.springs?.kryKnmPerRad, GLOBAL_AXES.y],
    [support.springs?.krzKnmPerRad, GLOBAL_AXES.z],
  ] as const;
  rotational.forEach(([stiffness, axis]) => {
    if (stiffness === undefined) return;
    const orientation = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, axis);
    addMesh(group, markerGeometry(group, `support-rotational-spring:${size}`, () =>
      new THREE.TorusGeometry(size * 0.72, size * 0.07, 8, 32, Math.PI * 1.72)),
      springColor, node.id, p.clone().addScaledVector(axis, size * 0.28), orientation);
  });

  const imposedColor = 0x0891b2;
  ([
    [support.prescribed?.uxM, GLOBAL_AXES.x],
    [support.prescribed?.uyM, GLOBAL_AXES.y],
    [support.prescribed?.uzM, GLOBAL_AXES.z],
  ] as const).forEach(([value, axis]) => {
    if (value !== undefined && value !== 0) addForceArrow(group, node, axis, Math.sign(value), size * 0.86, imposedColor);
  });
  ([
    [support.prescribed?.rxRad, GLOBAL_AXES.x],
    [support.prescribed?.ryRad, GLOBAL_AXES.y],
    [support.prescribed?.rzRad, GLOBAL_AXES.z],
  ] as const).forEach(([value, axis]) => {
    if (value !== undefined && value !== 0) addMomentArc(group, node, axis, Math.sign(value), size * 0.86, imposedColor);
  });
}

function addForceArrow(
  group: THREE.Group, node: Frame3DNode, axis: THREE.Vector3, sign: number, size: number, color = 0xf87171,
  selection?: Frame3DSingleSelection,
) {
  const direction = axis.clone().multiplyScalar(sign);
  const headCenter = nodePoint(node).addScaledVector(direction, -size * 0.35);
  const stemCenter = headCenter.clone().addScaledVector(direction, -size * 0.78);
  const orientation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction);
  addMesh(group, markerGeometry(group, `force-stem:${size}`, () =>
    new THREE.CylinderGeometry(size * 0.065, size * 0.065, size * 0.9, 8)),
    color, node.id, stemCenter, orientation, selection);
  addMesh(group, markerGeometry(group, `force-head:${size}`, () =>
    new THREE.ConeGeometry(size * 0.22, size * 0.42, 10)),
    color, node.id, headCenter, orientation, selection);
}

function addMomentArc(
  group: THREE.Group, node: Frame3DNode, axis: THREE.Vector3, sign: number, size: number, color = 0xfbbf24,
  selection?: Frame3DSingleSelection,
) {
  const orientation = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, axis);
  const center = nodePoint(node).addScaledVector(axis, size * 0.55);
  const radius = size * 0.48;
  addMesh(group, markerGeometry(group, `moment-ring:${size}`, () =>
    new THREE.TorusGeometry(radius, size * 0.055, 6, 18, Math.PI * 1.5)),
    color, node.id, center, orientation, selection);
  const localEnd = new THREE.Vector3(0, -radius, 0).applyQuaternion(orientation);
  const tangent = new THREE.Vector3(sign, 0, 0).applyQuaternion(orientation);
  addMesh(group, markerGeometry(group, `moment-head:${size}`, () =>
    new THREE.ConeGeometry(size * 0.13, size * 0.28, 8)),
    color, node.id, center.clone().add(localEnd),
    new THREE.Quaternion().setFromUnitVectors(Y_AXIS, tangent), selection);
}

function memberAxes(delta: THREE.Vector3) {
  const ex = delta.clone().normalize();
  const up = Math.abs(ex.z) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const ez = up.addScaledVector(ex, -up.dot(ex)).normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  return { ex, ey, ez };
}

function rolledMemberAxes(delta: THREE.Vector3, rollAngleRad = 0) {
  const axes = memberAxes(delta);
  if (rollAngleRad !== 0) {
    axes.ey.applyAxisAngle(axes.ex, rollAngleRad);
    axes.ez.applyAxisAngle(axes.ex, rollAngleRad);
  }
  return axes;
}

function addMemberLoad(
  group: THREE.Group,
  load: Frame3DMemberLoad,
  start: Frame3DNode,
  end: Frame3DNode,
  rollAngleRad: number,
  size: number,
) {
  const a = nodePoint(start), b = nodePoint(end);
  const delta = b.clone().sub(a);
  const length = delta.length();
  if (length <= 0) return;
  const { ex, ey, ez } = rolledMemberAxes(delta, rollAngleRad);
  const range = load.endPositionM - load.startPositionM;
  const maximum = Math.max(Math.abs(load.qyStart), Math.abs(load.qyEnd), Math.abs(load.qzStart), Math.abs(load.qzEnd));
  if (range <= 0 || maximum <= 0) return;
  const tails: THREE.Vector3[] = [];
  const samples = Math.max(3, Math.min(9, Math.ceil(range / Math.max(0.6, length / 8)) + 1));
  for (let index = 0; index < samples; index += 1) {
    const t = samples === 1 ? 0 : index / (samples - 1);
    const position = load.startPositionM + range * t;
    const qy = THREE.MathUtils.lerp(load.qyStart, load.qyEnd, t);
    const qz = THREE.MathUtils.lerp(load.qzStart, load.qzEnd, t);
    const vector = ey.clone().multiplyScalar(qy).addScaledVector(ez, qz);
    const magnitude = vector.length();
    if (magnitude <= 1e-12) continue;
    const direction = vector.normalize();
    const arrowLength = size * (0.9 + 0.9 * magnitude / maximum);
    const head = a.clone().addScaledVector(ex, position);
    const tail = head.clone().addScaledVector(direction, -arrowLength);
    tails.push(tail);
    addSelectableArrow(
      group, direction, tail, arrowLength, 0xef4444,
      Math.min(size * 0.36, arrowLength * 0.35), Math.min(size * 0.2, arrowLength * 0.2),
      { type: "memberLoad", id: load.id },
    );
  }
  if (tails.length >= 2) {
    const batcher = group.userData[MARKER_BATCHER_KEY] as MarkerBatcher | undefined;
    if (batcher) {
      batcher.addPolyline(0xef4444, tails);
      // De getekende verbindingslijnen worden samengevoegd. Behoud daarnaast
      // per lijnlast een onzichtbaar raycast-doel, zodat één klik op de lijn
      // dezelfde belasting selecteert als een klik op een van de pijlen.
      const pickLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(tails),
        new THREE.LineBasicMaterial({ color: 0xef4444 }),
      );
      pickLine.visible = false;
      pickLine.userData = { type: "memberLoad", id: load.id };
      group.add(pickLine);
    }
    else {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(tails),
        new THREE.LineBasicMaterial({ color: 0xef4444 }),
      );
      line.userData = { type: "memberLoad", id: load.id };
      group.add(line);
    }
  }
}

function addMemberPointLoad(
  group: THREE.Group,
  load: Frame3DMemberPointLoad,
  start: Frame3DNode,
  end: Frame3DNode,
  rollAngleRad: number,
  size: number,
) {
  const a = nodePoint(start), delta = nodePoint(end).sub(a);
  if (delta.lengthSq() <= 0) return;
  const { ex, ey, ez } = rolledMemberAxes(delta, rollAngleRad);
  const vector = ey.multiplyScalar(load.py).addScaledVector(ez, load.pz);
  const magnitude = vector.length();
  if (magnitude <= 1e-12) return;
  const direction = vector.normalize();
  const arrowLength = size * 1.8;
  const head = a.clone().addScaledVector(ex, load.positionM);
  const tail = head.clone().addScaledVector(direction, -arrowLength);
  addSelectableArrow(
    group, direction, tail, arrowLength, 0xdc2626,
    Math.min(size * 0.42, arrowLength * 0.35), Math.min(size * 0.24, arrowLength * 0.2),
    { type: "memberPointLoad", id: load.id },
  );
}

function addThermalLoad(
  group: THREE.Group, load: Frame3DThermalLoad, start: Frame3DNode, end: Frame3DNode, size: number,
) {
  const a = nodePoint(start), delta = nodePoint(end).sub(a);
  const length = delta.length();
  if (length <= 0) return;
  const ex = delta.clone().normalize();
  const center = a.clone().addScaledVector(ex, length / 2);
  const color = load.deltaTUniformK >= 0 ? 0xf97316 : 0x38bdf8;
  const userData = { type: "thermalLoad", id: load.id, kind: "thermal" };
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(size * 0.62, size * 0.07, 8, 28),
    new THREE.MeshStandardMaterial({ color, metalness: 0.02, roughness: 0.7 }),
  );
  ring.position.copy(center);
  ring.quaternion.setFromUnitVectors(Z_AXIS, ex);
  ring.userData = userData;
  group.add(ring);
  if (load.deltaTUniformK !== 0) {
    const sign = Math.sign(load.deltaTUniformK);
    for (const directionSign of [-1, 1]) {
      const direction = ex.clone().multiplyScalar(directionSign * sign);
      const origin = center.clone().addScaledVector(ex, directionSign * size * 0.12);
      const arrow = new THREE.ArrowHelper(direction, origin, size * 0.82, color, size * 0.26, size * 0.16);
      arrow.userData = userData;
      for (const child of arrow.children) child.userData = userData;
      group.add(arrow);
    }
  }
  if (load.deltaTGradientYK !== 0 || load.deltaTGradientZK !== 0) {
    const gradientRing = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.9, size * 0.035, 6, 22, Math.PI * 1.55),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 }),
    );
    gradientRing.position.copy(center);
    gradientRing.quaternion.copy(ring.quaternion);
    gradientRing.userData = userData;
    group.add(gradientRing);
  }
}

/** Adds pickable flat Mesh children; the canvas's existing disposer owns them. */
export function addFrame3DConditionMarkers(
  group: THREE.Group, model: Frame3DModel,
  visibility: Frame3DConditionVisibility = { supports: true, loads: true },
  activeLoadCaseId?: number,
  supportScale = 1,
): void {
  const visibleLoadCount = visibility.loads
    ? [model.loads, model.memberLoads, model.memberPointLoads, model.thermalLoads]
      .reduce((count, loads) => count + (loads ?? []).filter((load) =>
        activeLoadCaseId === undefined || frame3DLoadCaseId(load) === activeLoadCaseId).length, 0)
    : 0;
  const visibleMarkerCount = (visibility.supports ? model.supports?.length ?? 0 : 0) + visibleLoadCount;
  // Een lijnlast bevat meerdere pijlen. Al bij vier zichtbare markeringen
  // bespaart instancing daarom tientallen afzonderlijke tekenaanroepen.
  const batcher = visibleMarkerCount >= 4 ? createMarkerBatcher(group) : undefined;
  if (batcher) group.userData[MARKER_BATCHER_KEY] = batcher;
  const byId = new Map<number, Frame3DNode>();
  for (const node of model.nodes) byId.set(node.id, node);
  const beamById = new Map(model.beams.map((beam) => [beam.id, beam]));
  const size = frame3DConditionMarkerSize(model.nodes);
  if (visibility.supports) {
    for (const support of model.supports ?? []) {
      const node = byId.get(support.nodeId);
      if (node) addSupport(group, node, support, size * supportScale);
    }
    for (const plate of model.plates ?? []) {
      for (let edge = 0; edge < (plate.edgeSupports?.length ?? 0); edge++) {
        const kind = plate.edgeSupports?.[edge];
        if (!kind || kind === "free") continue;
        const start = byId.get(plate.nodeIds[edge]);
        const end = byId.get(plate.nodeIds[(edge + 1) % plate.nodeIds.length]);
        if (!start || !end) continue;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([nodePoint(start), nodePoint(end)]),
          new THREE.LineBasicMaterial({ color: kind === "clamped" ? 0x1e3a8a : 0x16a34a }),
        );
        line.userData = { type: "plate", id: plate.id, frame3dPlateEdgeSupport: kind, edgeIndex: edge };
        group.add(line);
      }
    }
  }
  if (visibility.loads) {
    for (const load of model.loads ?? []) {
      if (activeLoadCaseId !== undefined && frame3DLoadCaseId(load) !== activeLoadCaseId) continue;
      const node = byId.get(load.nodeId);
      if (!node) continue;
      for (const axis of ["x", "y", "z"] as const) {
        const force = load[`f${axis}`];
        const moment = load[`m${axis}`];
        if (force !== 0) addForceArrow(group, node, GLOBAL_AXES[axis], Math.sign(force), size, 0xf87171,
          { type: "nodalLoad", id: load.id });
        if (moment !== 0) addMomentArc(group, node, GLOBAL_AXES[axis], Math.sign(moment), size, 0xfbbf24,
          { type: "nodalLoad", id: load.id });
      }
    }
    for (const load of model.memberLoads ?? []) {
      if (activeLoadCaseId !== undefined && frame3DLoadCaseId(load) !== activeLoadCaseId) continue;
      const beam = beamById.get(load.beamId);
      if (!beam) continue;
      const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
      if (start && end) addMemberLoad(group, load, start, end, beam.rollAngleRad ?? 0, size);
    }
    for (const load of model.memberPointLoads ?? []) {
      if (activeLoadCaseId !== undefined && frame3DLoadCaseId(load) !== activeLoadCaseId) continue;
      const beam = beamById.get(load.beamId);
      if (!beam) continue;
      const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
      if (start && end) addMemberPointLoad(group, load, start, end, beam.rollAngleRad ?? 0, size);
    }
    for (const load of model.thermalLoads ?? []) {
      if (activeLoadCaseId !== undefined && frame3DLoadCaseId(load) !== activeLoadCaseId) continue;
      const beam = beamById.get(load.beamId);
      if (!beam) continue;
      const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
      if (start && end) addThermalLoad(group, load, start, end, size);
    }
  }
  if (batcher) {
    delete group.userData[MARKER_BATCHER_KEY];
    batcher.flush();
  }
}
