import * as THREE from "three";
import { openFem3DLoadCaseId, openFem3DRevoluteAxis, type OpenFem3DMemberLoad, type OpenFem3DMemberPointLoad, type OpenFem3DModel, type OpenFem3DNode, type OpenFem3DSupport, type OpenFem3DSupportRestraints, type OpenFem3DThermalLoad } from "./openFem3dModel";
import type { OpenFem3DSingleSelection } from "./openFem3dSelection";

export interface OpenFem3DConditionVisibility {
  supports: boolean;
  loads: boolean;
}

/** World-space size shared by all support and load markers in one model. */
export function openFem3DConditionMarkerSize(nodes: readonly OpenFem3DNode[]): number {
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

const MARKER_BATCHER_KEY = "__open_fem_3dMarkerBatcher";
const LOAD_PICK_SEGMENTS_KEY = "__open_fem_3dLoadPickSegments";

/**
 * Een getekend lijnstuk van een last: een pijl (staart → punt) of een stuk
 * staartlijn. Een pijlsteel is dunner dan een pixel en dus met een raycast
 * nauwelijks te raken; het tekenvlak zoekt deze lijnstukken daarom ook op
 * schermafstand, zoals de systeemlijn van een staaf.
 */
export interface OpenFem3DLoadPickSegment {
  selection: OpenFem3DSingleSelection;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

function recordLoadPickSegment(
  group: THREE.Group, selection: OpenFem3DSingleSelection, a: THREE.Vector3, b: THREE.Vector3,
) {
  const segments = (group.userData[LOAD_PICK_SEGMENTS_KEY] ??= []) as OpenFem3DLoadPickSegment[];
  segments.push({ selection, a: a.clone(), b: b.clone() });
}

/** De aanklikbare lijnstukken van de lasten die {@link addOpenFem3DConditionMarkers} in `group` tekende. */
export function openFem3DLoadPickSegments(group: THREE.Object3D): readonly OpenFem3DLoadPickSegment[] {
  return (group.userData[LOAD_PICK_SEGMENTS_KEY] as OpenFem3DLoadPickSegment[] | undefined) ?? [];
}

type MarkerInstance = { id: number; matrix: THREE.Matrix4 };
type MarkerBatch = {
  geometry: THREE.BufferGeometry;
  color: number;
  selectionType: OpenFem3DSingleSelection["type"];
  instances: MarkerInstance[];
};
/** Lijnstukken van één soort last: per lijnstuk twee punten, de last-id en de kleur. */
type MarkerLineBatch = { points: THREE.Vector3[]; ids: number[]; colors: number[] };

interface MarkerBatcher {
  geometryFor: (key: string, factory: () => THREE.BufferGeometry) => THREE.BufferGeometry;
  add: (
    geometry: THREE.BufferGeometry,
    color: number,
    id: number,
    position: THREE.Vector3,
    quaternion: THREE.Quaternion | undefined,
    selectionType: OpenFem3DSingleSelection["type"],
    scale?: THREE.Vector3,
  ) => void;
  addPolyline: (color: number, points: readonly THREE.Vector3[], selection: OpenFem3DSingleSelection) => void;
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
  const lineBatches = new Map<OpenFem3DSingleSelection["type"], MarkerLineBatch>();
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
    addPolyline(color, points, selection) {
      if (points.length < 2) return;
      let batch = lineBatches.get(selection.type);
      if (!batch) {
        batch = { points: [], ids: [], colors: [] };
        lineBatches.set(selection.type, batch);
      }
      for (let index = 0; index < points.length - 1; index += 1) {
        batch.points.push(points[index], points[index + 1]);
        batch.ids.push(selection.id);
        batch.colors.push(color);
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
      for (const [selectionType, batch] of lineBatches) {
        // Alle staartlijnen in één tekenaanroep, met een kleur per lijnstuk:
        // zo kleurt het tekenvlak bij selecteren alleen de lijnstukken van de
        // gekozen last mee (`segmentIds`, #81), net als de losse staartlijn
        // zonder batches.
        const geometry = new THREE.BufferGeometry().setFromPoints(batch.points);
        const colors = new Float32Array(batch.points.length * 3);
        const color = new THREE.Color();
        batch.colors.forEach((hex, segment) => {
          color.setHex(hex);
          color.toArray(colors, segment * 6);
          color.toArray(colors, segment * 6 + 3);
        });
        const colorAttribute = new THREE.BufferAttribute(colors, 3);
        colorAttribute.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("color", colorAttribute);
        const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
        // Geen raycast-doel: één klik selecteert één last, en daarvoor heeft
        // elke last zijn eigen onzichtbare kieslijn en de pijlen.
        lines.userData = {
          type: selectionType, pickable: false, openFem3dLoadGuide: true,
          segmentIds: batch.ids, segmentBaseColors: batch.colors,
        };
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

function nodePoint(node: OpenFem3DNode): THREE.Vector3 {
  return new THREE.Vector3(node.x, node.y, node.z);
}

function addMesh(
  group: THREE.Group, geometry: THREE.BufferGeometry, color: number,
  nodeId: number, position: THREE.Vector3, quaternion?: THREE.Quaternion,
  selection?: OpenFem3DSingleSelection,
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
  selection: OpenFem3DSingleSelection,
) {
  recordLoadPickSegment(group, selection, origin,
    origin.clone().addScaledVector(direction.clone().normalize(), length));
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

function addSupport(group: THREE.Group, node: OpenFem3DNode, support: OpenFem3DSupport, size: number) {
  const p = nodePoint(node);
  const revoluteAxis = openFem3DRevoluteAxis(support);
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
  const allTranslationsFixed = support.ux && support.uy && support.uz;
  // Combinaties zonder eigen standaardteken: verend (een paal), of star maar
  // geen inklemming, scharnier, rol of scharnier met één vrije draaias.
  const custom = !allFixed && !revoluteAxis && !pinned && !roller;
  const color = 0xd97706;
  const baseColor = 0x475569;
  const groundColor = 0x94a3b8;
  const horizontal = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, Z_AXIS);
  // Een plaatje loodrecht op `axis`, `distance` aan de min-kant van de knoop:
  // het eind van een veer of de voet van een kegeltje.
  const addEndPlate = (axis: THREE.Vector3, distance: number, sideOffset = new THREE.Vector3()) => {
    addMesh(group, markerGeometry(group, `support-end-plate:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.34, size * 0.34, size * 0.06, 24)), baseColor, node.id,
      p.clone().addScaledVector(axis, -distance).add(sideOffset),
      new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis));
  };
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
  } else if (pinned || custom && allTranslationsFixed) {
    // Een scharnier; ook met een of twee vaste rotaties (bijv. torsievast),
    // die er hieronder als ring bij komen.
    addMesh(group, markerGeometry(group, `support-cone:${size}`, () =>
      new THREE.ConeGeometry(size * 0.7, size, 32)), color, node.id,
      p.clone().add(new THREE.Vector3(0, 0, -size * 0.55)),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  } else if (roller) {
    // Een rol zoals op papier: de kegel met de punt naar de knoop, een
    // voetplaat, twee rollen en de ondergrond met arcering, alles loodrecht op
    // de vaste richting. De rollen liggen dwars op die richting, zodat X-, Y-
    // en Z-rollen ook in een isometrisch beeld verschillen.
    const n = rollerNormal;
    const reference = Math.abs(n.z) < 0.9 ? Z_AXIS : new THREE.Vector3(1, 0, 0);
    const rollerAxis = new THREE.Vector3().crossVectors(n, reference).normalize();
    const offsetAxis = new THREE.Vector3().crossVectors(n, rollerAxis).normalize();
    // Een plaat: lokale y langs de vaste richting, x dwars op de rollen, z langs de rollen.
    const plate = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(offsetAxis, n, rollerAxis));
    const hatch = plate.clone().multiply(new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 4));
    const at = (depth: number, side = 0) => p.clone().addScaledVector(n, -depth * size).addScaledVector(offsetAxis, side * size);
    addMesh(group, markerGeometry(group, `support-cone:${size}`, () =>
      new THREE.ConeGeometry(size * 0.7, size, 32)), color, node.id,
      at(0.55), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, n));
    addMesh(group, markerGeometry(group, `support-roller-shoe:${size}`, () =>
      new THREE.BoxGeometry(size * 1.5, size * 0.06, size * 1.5)), color, node.id, at(1.08), plate);
    for (const side of [-0.4, 0.4]) {
      addMesh(group, markerGeometry(group, `support-roller:${size}`, () =>
        new THREE.CylinderGeometry(size * 0.14, size * 0.14, size * 1.3, 24)), baseColor, node.id,
        at(1.25, side), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, rollerAxis));
    }
    addMesh(group, markerGeometry(group, `support-roller-ground:${size}`, () =>
      new THREE.BoxGeometry(size * 1.8, size * 0.06, size * 1.8)), groundColor, node.id, at(1.42), plate);
    for (const side of [-0.6, -0.2, 0.2, 0.6]) {
      addMesh(group, markerGeometry(group, `support-roller-hatch:${size}`, () =>
        new THREE.BoxGeometry(size * 0.06, size * 0.34, size * 0.06)), baseColor, node.id, at(1.58, side), hatch);
    }
  } else {
    // Per vaste translatie een klein kegeltje met de punt naar de knoop en een
    // plaatje erachter. Een veer in een vrije richting tekent hieronder zijn
    // eigen spoel met plaatje; een grote bol zou die verbergen.
    for (const axisName of fixedTranslations) {
      const axis = GLOBAL_AXES[axisName];
      addMesh(group, markerGeometry(group, `support-small-cone:${size}`, () =>
        new THREE.ConeGeometry(size * 0.28, size * 0.5, 24)), color, node.id,
        p.clone().addScaledVector(axis, -size * 0.25), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis));
      addEndPlate(axis, size * 0.53);
    }
  }
  if (custom) {
    // Per vaste rotatie een donkere, gesloten ring om die as. De oranje ring
    // met asstaaf van een scharnier betekent het omgekeerde: die as is vrij.
    for (const [axisName, fixed] of [["x", support.rx], ["y", support.ry], ["z", support.rz]] as const) {
      if (!fixed) continue;
      addMesh(group, markerGeometry(group, `support-fixed-rotation:${size}`, () =>
        new THREE.TorusGeometry(size * 0.42, size * 0.06, 10, 40)), baseColor, node.id,
        p.clone(), new THREE.Quaternion().setFromUnitVectors(Z_AXIS, GLOBAL_AXES[axisName]));
    }
  }
  if (!roller && (!custom || allTranslationsFixed)) {
    const baseZ = allFixed || revoluteAxis ? -size * 0.48 : -size * 1.08;
    addMesh(group, markerGeometry(group, `support-base:${size}`, () =>
      new THREE.CylinderGeometry(size * 0.9, size * 0.9, size * 0.09, 40)), baseColor, node.id,
      p.clone().add(new THREE.Vector3(0, 0, baseZ)), horizontal);
  }

  const springColor = 0x7c3aed;
  const addLinearSpring = (axis: THREE.Vector3, offsetIndex: number) => {
    // Een schroefveer: vijf windingen met een vaste straal tussen twee korte
    // rechte aansluitingen op de as, en een plaatje aan het eind.
    const normal = Math.abs(axis.z) < 0.9 ? Z_AXIS : new THREE.Vector3(1, 0, 0);
    const side = new THREE.Vector3().crossVectors(axis, normal).normalize();
    const secondSide = new THREE.Vector3().crossVectors(axis, side).normalize();
    const shift = side.clone().multiplyScalar(offsetIndex * size * 0.08);
    const onAxis = (depth: number) => p.clone().add(shift).addScaledVector(axis, -depth * size);
    const lead = 0.13, coil = 1.2, radius = 0.2, turns = 5, perTurn = 20;
    const points: THREE.Vector3[] = [onAxis(0), onAxis(lead * 0.5)];
    for (let index = 0; index <= turns * perTurn; index += 1) {
      const t = index / (turns * perTurn);
      const angle = t * Math.PI * 2 * turns;
      points.push(onAxis(lead + t * coil)
        .addScaledVector(side, Math.cos(angle) * radius * size)
        .addScaledVector(secondSide, Math.sin(angle) * radius * size));
    }
    points.push(onAxis(lead * 1.5 + coil), onAxis(lead * 2 + coil));
    const spring = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), turns * perTurn * 2, size * 0.035, 10, false),
      new THREE.MeshStandardMaterial({ color: springColor, roughness: 0.4, metalness: 0.15 }),
    );
    spring.userData = { type: "node", id: node.id };
    group.add(spring);
    addEndPlate(axis, size * 1.5, shift);
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

/**
 * Opleggingssymbolen op willekeurige punten, bijvoorbeeld langs een
 * plaatrand: dezelfde vormen als bij een knoopoplegging (gebundeld per vorm),
 * maar niet selecteerbaar.
 */
export function addOpenFem3DSupportGlyphs(
  group: THREE.Group,
  glyphs: readonly { point: THREE.Vector3; restraints: OpenFem3DSupportRestraints }[],
  size: number,
): void {
  const target = new THREE.Group();
  const batcher = glyphs.length >= 4 ? createMarkerBatcher(target) : undefined;
  if (batcher) target.userData[MARKER_BATCHER_KEY] = batcher;
  for (const { point, restraints } of glyphs) {
    addSupport(target, { id: -1, x: point.x, y: point.y, z: point.z }, { nodeId: -1, ...restraints }, size);
  }
  if (batcher) {
    delete target.userData[MARKER_BATCHER_KEY];
    batcher.flush();
  }
  for (const child of [...target.children]) {
    child.userData = { pickable: false, openFem3dSupportGlyph: true };
    group.add(child);
  }
}

function addForceArrow(
  group: THREE.Group, node: OpenFem3DNode, axis: THREE.Vector3, sign: number, size: number, color = 0xf87171,
  selection?: OpenFem3DSingleSelection,
) {
  const direction = axis.clone().multiplyScalar(sign);
  const headCenter = nodePoint(node).addScaledVector(direction, -size * 0.35);
  const stemCenter = headCenter.clone().addScaledVector(direction, -size * 0.78);
  const orientation = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, direction);
  // Een knooplast: van het begin van de steel tot de punt van de kegel.
  if (selection) {
    recordLoadPickSegment(group, selection, stemCenter.clone().addScaledVector(direction, -size * 0.45),
      headCenter.clone().addScaledVector(direction, size * 0.21));
  }
  addMesh(group, markerGeometry(group, `force-stem:${size}`, () =>
    new THREE.CylinderGeometry(size * 0.065, size * 0.065, size * 0.9, 8)),
    color, node.id, stemCenter, orientation, selection);
  addMesh(group, markerGeometry(group, `force-head:${size}`, () =>
    new THREE.ConeGeometry(size * 0.22, size * 0.42, 10)),
    color, node.id, headCenter, orientation, selection);
}

function addMomentArc(
  group: THREE.Group, node: OpenFem3DNode, axis: THREE.Vector3, sign: number, size: number, color = 0xfbbf24,
  selection?: OpenFem3DSingleSelection,
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
  load: OpenFem3DMemberLoad,
  start: OpenFem3DNode,
  end: OpenFem3DNode,
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
    for (let index = 0; index < tails.length - 1; index += 1) {
      recordLoadPickSegment(group, { type: "memberLoad", id: load.id }, tails[index], tails[index + 1]);
    }
    const batcher = group.userData[MARKER_BATCHER_KEY] as MarkerBatcher | undefined;
    if (batcher) {
      batcher.addPolyline(0xef4444, tails, { type: "memberLoad", id: load.id });
      // De getekende verbindingslijnen worden samengevoegd (met de last-id per
      // lijnstuk, voor de selectiekleur). Behoud daarnaast per lijnlast een
      // onzichtbaar raycast-doel, zodat één klik op de lijn dezelfde
      // belasting selecteert als een klik op een van de pijlen.
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
  load: OpenFem3DMemberPointLoad,
  start: OpenFem3DNode,
  end: OpenFem3DNode,
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
  group: THREE.Group, load: OpenFem3DThermalLoad, start: OpenFem3DNode, end: OpenFem3DNode, size: number,
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
export function addOpenFem3DConditionMarkers(
  group: THREE.Group, model: OpenFem3DModel,
  visibility: OpenFem3DConditionVisibility = { supports: true, loads: true },
  activeLoadCaseId?: number,
): void {
  const visibleLoadCount = visibility.loads
    ? [model.loads, model.memberLoads, model.memberPointLoads, model.thermalLoads]
      .reduce((count, loads) => count + (loads ?? []).filter((load) =>
        activeLoadCaseId === undefined || openFem3DLoadCaseId(load) === activeLoadCaseId).length, 0)
    : 0;
  const visibleMarkerCount = (visibility.supports ? model.supports?.length ?? 0 : 0) + visibleLoadCount;
  // Een lijnlast bevat meerdere pijlen. Al bij vier zichtbare markeringen
  // bespaart instancing daarom tientallen afzonderlijke tekenaanroepen.
  const batcher = visibleMarkerCount >= 4 ? createMarkerBatcher(group) : undefined;
  if (batcher) group.userData[MARKER_BATCHER_KEY] = batcher;
  const byId = new Map<number, OpenFem3DNode>();
  for (const node of model.nodes) byId.set(node.id, node);
  const beamById = new Map(model.beams.map((beam) => [beam.id, beam]));
  const size = openFem3DConditionMarkerSize(model.nodes);
  if (visibility.supports) {
    for (const support of model.supports ?? []) {
      const node = byId.get(support.nodeId);
      if (node) addSupport(group, node, support, size);
    }
  }
  if (visibility.loads) {
    for (const load of model.loads ?? []) {
      if (activeLoadCaseId !== undefined && openFem3DLoadCaseId(load) !== activeLoadCaseId) continue;
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
      if (activeLoadCaseId !== undefined && openFem3DLoadCaseId(load) !== activeLoadCaseId) continue;
      const beam = beamById.get(load.beamId);
      if (!beam) continue;
      const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
      if (start && end) addMemberLoad(group, load, start, end, beam.rollAngleRad ?? 0, size);
    }
    for (const load of model.memberPointLoads ?? []) {
      if (activeLoadCaseId !== undefined && openFem3DLoadCaseId(load) !== activeLoadCaseId) continue;
      const beam = beamById.get(load.beamId);
      if (!beam) continue;
      const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
      if (start && end) addMemberPointLoad(group, load, start, end, beam.rollAngleRad ?? 0, size);
    }
    for (const load of model.thermalLoads ?? []) {
      if (activeLoadCaseId !== undefined && openFem3DLoadCaseId(load) !== activeLoadCaseId) continue;
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
