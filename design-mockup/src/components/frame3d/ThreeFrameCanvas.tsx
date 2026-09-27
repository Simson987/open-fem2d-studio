import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addFrame3DPlate, addFrame3DPlateOpening, frame3DLoadCaseId, splitFrame3DBeam, type Frame3DModel, type Frame3DPlateBoundarySegment } from "./frame3dModel";
import type { Frame3DVisibility } from "./frame3dVisibility";
import type { Frame3DView } from "./frame3dCommands";
import { addFrame3DConditionMarkers } from "./frame3dMarkers";
import type { StructuralGrid } from "../fem/femTypes";
import type {
  Frame3DDiagramPoint,
  Frame3DDiagrams,
  Frame3DMemberForces,
  Frame3DSolveResult,
} from "./frame3dSolver";
import type { Frame3DTool } from "./frame3dCommands";
import {
  FRAME_3D_UTILIZATION_COLORS,
  frame3DUtilizationClass,
  type Frame3DUtilization,
} from "./frame3dUtilization";
import { createFrame3DProfileGeometry, frame3DProfileInstanceScale, frame3DProfileSection } from "./frame3dProfileGeometry";
import { frame3DMaximumDisplacementM, frame3DMemberDisplacementStations } from "./frame3dDisplacement";
import {
  frame3DSelectionContains,
  toggleFrame3DSelection,
  type Frame3DSelection, type Frame3DSelectionType,
} from "./frame3dSelection";
import type { Frame3DCameraState } from "./frame3dViewSets";
import { createFrame3DPlateGeometry } from "./frame3dPlateGeometry";
import { useSnapInstellingen, type SnapInstellingen, type SnapSoort } from "../../hooks/useSnapInstellingen";

// De analytische knoop is een punt, maar in de editor moet hij ook op afstand
// goed aanklikbaar en herkenbaar blijven. De staaf loopt tot het middelpunt van
// deze bol en verdwijnt er dus ruim in: ook onder een schuine kijkhoek ontstaat
// er nergens een zichtbare kier tussen staaf en knoop.
const ANALYTICAL_BEAM_RADIUS_M = 0.035;
const PROFILE_BEAM_RADIUS_M = 0.12;

function nextNumericId(items: readonly { id: number }[]): number {
  let maximum = 0;
  for (const item of items) maximum = Math.max(maximum, item.id);
  return maximum + 1;
}

const SAME_NODE_TOLERANCE_M = 1e-7;

function nodePositionBucket(x: number, y: number, z: number): [number, number, number] {
  return [
    Math.floor(x / SAME_NODE_TOLERANCE_M),
    Math.floor(y / SAME_NODE_TOLERANCE_M),
    Math.floor(z / SAME_NODE_TOLERANCE_M),
  ];
}

function nodePositionBucketKey(x: number, y: number, z: number): string {
  const bucket = nodePositionBucket(x, y, z);
  return `${bucket[0]}|${bucket[1]}|${bucket[2]}`;
}

function addNodeToPositionIndex(index: Map<string, number[]>, node: Frame3DModel["nodes"][number]) {
  const key = nodePositionBucketKey(node.x, node.y, node.z);
  const ids = index.get(key);
  if (ids) ids.push(node.id);
  else index.set(key, [node.id]);
}

function buildNodePositionIndex(nodes: Frame3DModel["nodes"]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  nodes.forEach((node) => addNodeToPositionIndex(index, node));
  return index;
}

function nodeAtPosition(
  index: Map<string, number[]>,
  nodesById: Map<number, Frame3DModel["nodes"][number]>,
  position: THREE.Vector3,
): Frame3DModel["nodes"][number] | undefined {
  const [bx, by, bz] = nodePositionBucket(position.x, position.y, position.z);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const ids = index.get(`${bx + dx}|${by + dy}|${bz + dz}`) ?? [];
        for (const id of ids) {
          const node = nodesById.get(id);
          if (node && Math.hypot(node.x - position.x, node.y - position.y, node.z - position.z) < SAME_NODE_TOLERANCE_M) {
            return node;
          }
        }
      }
    }
  }
  return undefined;
}

function expandInstancedMeshBounds(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4) {
  if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
  const instanceBox = mesh.geometry.boundingBox?.clone().applyMatrix4(matrix);
  if (!instanceBox) return;
  if (mesh.boundingBox) mesh.boundingBox.union(instanceBox);
  else mesh.boundingBox = instanceBox;
  mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(mesh.boundingSphere ?? new THREE.Sphere());
}

function markInstanceChanged(mesh: THREE.InstancedMesh, index: number) {
  mesh.instanceMatrix.addUpdateRange(index * 16, 16);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.addUpdateRange(index * 3, 3);
    mesh.instanceColor.needsUpdate = true;
  }
}

/** Catalogusnamen als `IPE 200` en `IPE200` delen dezelfde GPU-batch. */
function profileBatchName(profileName: string): string {
  return profileName.trim().toUpperCase().replace(/\s+(?=\d)/g, "");
}

/** Ongeveer dezelfde 10 px diameter als de 2D-knoop bij passend beeld. */
function visualNodeRadius(model: Frame3DModel): number {
  if (model.nodes.length < 2) return 0.035;
  const box = new THREE.Box3().setFromPoints(model.nodes.map((node) => new THREE.Vector3(node.x, node.y, node.z)));
  return Math.max(0.012, Math.min(0.08, box.getSize(new THREE.Vector3()).length() * 0.006));
}

function memberAxes(delta: THREE.Vector3, rollAngleRad = 0) {
  const ex = delta.clone().normalize();
  const up = Math.abs(ex.z) > 0.999 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const ez = up.addScaledVector(ex, -up.dot(ex)).normalize();
  const ey = new THREE.Vector3().crossVectors(ez, ex).normalize();
  if (rollAngleRad !== 0) {
    ey.applyAxisAngle(ex, rollAngleRad);
    ez.applyAxisAngle(ex, rollAngleRad);
  }
  return { ex, ey, ez };
}

function memberRotation(delta: THREE.Vector3, rollAngleRad = 0): THREE.Quaternion {
  const { ex, ey, ez } = memberAxes(delta, rollAngleRad);
  // ExtrudeGeometry: contour-x → lokale y, contour-y → lokale z,
  // extrusie-z → lokale x (de staafas). Dezelfde Z-up afspraak als de kern.
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ey, ez, ex));
}

function sceneBounds(
  model: Frame3DModel,
  visibility: Frame3DVisibility,
): THREE.Box3 {
  const box = new THREE.Box3();
  model.nodes.forEach((node) => box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z)));
  // Fit view focuses on the structural model. A project grid can deliberately
  // extend far beyond a small starter frame; including it here shrank the
  // actual model to a thumbnail even though all geometry technically fitted.
  // Grid geometry remains visible wherever it crosses the current view.
  let padding = visualNodeRadius(model);
  if (visibility.profiles) {
    for (const beam of model.beams) {
      const profile = frame3DProfileSection(beam.profileName);
      if (profile) padding = Math.max(padding, Math.hypot(profile.widthM, profile.heightM) / 2);
    }
  }
  if (!box.isEmpty()) box.expandByScalar(padding * 1.15);
  return box;
}

/**
 * Benodigde camerafstand voor de geprojecteerde begrenzing van het model.
 * Een omgeschreven bol is bij een lang, laag raamwerk veel te ruim: de straal
 * wordt dan door de lengte bepaald en laat boven en onder onnodig veel leegte.
 * Door alle acht hoeken op het cameravlak te projecteren benut het model de
 * beschikbare breedte én hoogte, ook in isometrisch aanzicht.
 */
function fittedCameraDistance(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  centerToCamera: THREE.Vector3,
): number {
  if (box.isEmpty()) return 4;
  const center = box.getCenter(new THREE.Vector3());
  const direction = centerToCamera.clone().normalize();
  const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
  const vertical = new THREE.Vector3().crossVectors(direction, right).normalize();
  let halfWidth = 0;
  let halfHeight = 0;
  let halfDepth = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const relative = new THREE.Vector3(x, y, z).sub(center);
        halfWidth = Math.max(halfWidth, Math.abs(relative.dot(right)));
        halfHeight = Math.max(halfHeight, Math.abs(relative.dot(vertical)));
        halfDepth = Math.max(halfDepth, Math.abs(relative.dot(direction)));
      }
    }
  }
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.05));
  const projectedDistance = Math.max(
    halfHeight / Math.max(Math.tan(verticalFov / 2), 1e-6),
    halfWidth / Math.max(Math.tan(horizontalFov / 2), 1e-6),
  );
  return Math.max(2, (halfDepth + projectedDistance) * 1.08);
}

interface Props {
  model: Frame3DModel;
  /** Zelfde geometrie met vluchtige automatische lasten, alleen voor symbolen. */
  conditionModel?: Frame3DModel;
  onChange: (model: Frame3DModel) => void;
  tool: Frame3DTool;
  selection: Frame3DSelection;
  onSelect: (selection: Frame3DSelection) => void;
  fitToken: number;
  visibility: Frame3DVisibility;
  structuralGrid?: StructuralGrid;
  gridSpacingM?: number;
  viewRequest?: { kind: Frame3DView; token: number };
  currentView?: Frame3DView;
  result?: Frame3DSolveResult | null;
  utilizations?: Frame3DUtilization[];
  activeLoadCaseId?: number;
  cameraRequest?: { state: Frame3DCameraState; token: number };
  onCameraChange?: (state: Frame3DCameraState) => void;
}

interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  geometry: THREE.Group;
  preview: THREE.Group;
  previewHint: HTMLSpanElement;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  axisLabels: CSS2DObject[];
}

function writeCameraDiagnostics(container: HTMLElement | null, state: SceneState) {
  if (!container) return;
  const value = (vector: THREE.Vector3) => vector.toArray().map((component) => component.toFixed(6)).join(",");
  container.dataset.frame3dCameraPosition = value(state.camera.position);
  container.dataset.frame3dCameraTarget = value(state.controls.target);
  container.dataset.frame3dCameraUp = value(state.camera.up);
}

interface PlateSketch {
  nodeIds: number[];
  segments: Frame3DPlateBoundarySegment[];
  firstNodeId: number | null;
  lastNodeId: number | null;
  arcControlNodeId: number | null;
}

const emptyPlateSketch = (): PlateSketch => ({
  nodeIds: [], segments: [], firstNodeId: null, lastNodeId: null, arcControlNodeId: null,
});

const isOpeningTool = (tool: Frame3DTool) => tool === "addOpening" || tool === "addOpeningArc";
const isArcBoundaryTool = (tool: Frame3DTool) => tool === "addPlateArc" || tool === "addOpeningArc";

function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((object) => {
      if (object instanceof CSS2DObject) object.element.remove();
      const drawable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      drawable.geometry?.dispose();
      if (drawable.material) {
        const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}

function hidePreview(group: THREE.Group) {
  group.children.forEach((child) => { child.visible = false; });
}

const SELECTABLE_TYPES = new Set<Frame3DSelectionType>([
  "node", "beam", "plate", "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad",
]);

function selectedIdsForType(selection: Frame3DSelection, type: Frame3DSelectionType): readonly number[] {
  if (!selection) return [];
  if (selection.type === type) return [selection.id];
  if (selection.type !== "multi") return [];
  if (type === "node") return selection.nodeIds;
  if (type === "beam") return selection.beamIds;
  if (type === "plate") return selection.plateIds ?? [];
  return [];
}

/** Werk alleen de materiaalkleur bij; selecteren mag de zware profielgeometrie niet opnieuw bouwen. */
function applySelectionHighlight(group: THREE.Group, selection: Frame3DSelection) {
  group.traverse((object) => {
    const type = object.userData.type as Frame3DSelectionType | undefined;
    if (!type || !SELECTABLE_TYPES.has(type)) return;
    if (object instanceof THREE.InstancedMesh && Array.isArray(object.userData.instanceIds)) {
      if (object.userData.selectionHighlight === false) return;
      const ids = object.userData.instanceIds as number[];
      const baseColors = object.userData.instanceBaseColors as number[] | undefined;
      if (!baseColors || baseColors.length !== ids.length) return;
      const indexById = object.userData.instanceIndexById as Map<number, number> | undefined
        ?? new Map(ids.map((id, index) => [id, index]));
      object.userData.instanceIndexById = indexById;
      const previous = object.userData.selectedInstanceIndices as Set<number> | undefined ?? new Set<number>();
      const next = new Set<number>();
      selectedIdsForType(selection, type).forEach((id) => {
        const index = indexById.get(id);
        if (index !== undefined) next.add(index);
      });
      const changed = new Set<number>([...previous, ...next]);
      changed.forEach((index) => {
        const selected = next.has(index);
        if (selected === previous.has(index)) return;
        object.setColorAt(index, new THREE.Color(selected
          ? (object.userData.selectionColor ?? 0xd97706)
          : baseColors[index]));
        if (object.instanceColor) object.instanceColor.addUpdateRange(index * 3, 3);
      });
      object.userData.selectedInstanceIndices = next;
      if (changed.size > 0 && object.instanceColor) object.instanceColor.needsUpdate = true;
      return;
    }
    const id = object.userData.id;
    if (typeof id !== "number") return;
    const drawable = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
    if (!drawable.material) return;
    const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    const baseColors = (object.userData.selectionBaseColors ??= []) as Array<number | undefined>;
    const selected = frame3DSelectionContains(selection, type, id);
    materials.forEach((material, index) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (!colored.color) return;
      if (baseColors[index] === undefined) baseColors[index] = colored.color.getHex();
      colored.color.setHex(selected ? (object.userData.selectionColor ?? 0xd97706) : baseColors[index]!);
      material.needsUpdate = true;
    });
    if (object.userData.selectionOpacity !== undefined) {
      materials.forEach((material) => {
        material.opacity = selected ? object.userData.selectionOpacity : object.userData.baseOpacity;
      });
    }
  });
}

function makeLabel(
  text: string,
  className: string,
  position: THREE.Vector3,
  follow?: { type: "node" | "beam"; id: number },
): CSS2DObject {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  const label = new CSS2DObject(element);
  label.position.copy(position);
  label.center.set(0, 1);
  if (follow) label.userData.frame3dFollow = follow;
  return label;
}

type DiagramComponent = "shearY" | "shearZ" | "momentY" | "momentZ";

const DIAGRAM_STYLE: Record<DiagramComponent, {
  symbol: string;
  unit: string;
  color: number;
  resultKey: keyof Frame3DDiagrams;
  fallbackValues: (force: Frame3DMemberForces) => [number, number];
  direction: (axes: ReturnType<typeof memberAxes>) => THREE.Vector3;
}> = {
  shearY: { symbol: "Vy", unit: "kN", color: 0x0284c7,
    resultKey: "shearY", fallbackValues: (f) => [f.vyStartKn, f.vyEndKn], direction: ({ ey }) => ey },
  shearZ: { symbol: "Vz", unit: "kN", color: 0x7c3aed,
    resultKey: "shearZ", fallbackValues: (f) => [f.vzStartKn, f.vzEndKn], direction: ({ ez }) => ez },
  momentY: { symbol: "My", unit: "kNm", color: 0xdc2626,
    resultKey: "momentY", fallbackValues: (f) => [f.myStartKnm, f.myEndKnm], direction: ({ ez }) => ez },
  momentZ: { symbol: "Mz", unit: "kNm", color: 0xd97706,
    resultKey: "momentZ", fallbackValues: (f) => [f.mzStartKnm, f.mzEndKnm], direction: ({ ey }) => ey },
};

function diagramPoints(
  result: Frame3DSolveResult,
  component: DiagramComponent,
  force: Frame3DMemberForces,
): Frame3DDiagramPoint[] {
  const style = DIAGRAM_STYLE[component];
  const calculated = result.diagrams?.[style.resultKey]
    .find((diagram) => diagram.memberId === force.memberId)?.points;
  if (calculated && calculated.length >= 2) return calculated;
  const [start, end] = style.fallbackValues(force);
  return [{ t: 0, value: start }, { t: 1, value: end }];
}

function resultValue(value: number): string {
  const cleaned = Math.abs(value) < 5e-10 ? 0 : value;
  return Math.abs(cleaned) >= 100 ? cleaned.toFixed(1)
    : Math.abs(cleaned) >= 10 ? cleaned.toFixed(2)
      : cleaned.toFixed(3);
}

interface ResultDiagramBatch {
  color: number;
  fillPositions: number[];
  zeroPoints: THREE.Vector3[];
  curvePoints: THREE.Vector3[];
}

function addResultDiagram(
  group: THREE.Group,
  beamId: number,
  start: THREE.Vector3,
  end: THREE.Vector3,
  direction: THREE.Vector3,
  samples: readonly Frame3DDiagramPoint[],
  maximum: number,
  height: number,
  style: { symbol: string; unit: string; color: number },
  showLabels = true,
  batch?: ResultDiagramBatch,
) {
  if (!(maximum > 1e-12) || samples.length < 2) return;
  const scale = height / maximum;
  const basePoints: THREE.Vector3[] = [];
  const diagramPoints: THREE.Vector3[] = [];
  for (const sample of samples) {
    const t = THREE.MathUtils.clamp(sample.t, 0, 1);
    const base = start.clone().lerp(end, t);
    basePoints.push(base);
    diagramPoints.push(base.clone().addScaledVector(direction, sample.value * scale));
  }
  const fillPositions: number[] = [];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = basePoints[index], b = basePoints[index + 1];
    const c = diagramPoints[index + 1], d = diagramPoints[index];
    for (const point of [a, b, c, a, c, d]) fillPositions.push(point.x, point.y, point.z);
  }
  if (batch) {
    batch.fillPositions.push(...fillPositions);
    batch.zeroPoints.push(start, end);
    for (let index = 0; index < diagramPoints.length - 1; index += 1) {
      batch.curvePoints.push(diagramPoints[index], diagramPoints[index + 1]);
    }
  } else {
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillPositions, 3));
    const fill = new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
      color: style.color, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
      depthWrite: false,
    }));
    fill.userData = { type: "beam", id: beamId };
    group.add(fill);

    const zeroLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineDashedMaterial({ color: style.color, dashSize: 0.18, gapSize: 0.1, opacity: 0.55, transparent: true }),
    );
    zeroLine.computeLineDistances();
    zeroLine.userData = { type: "beam", id: beamId };
    group.add(zeroLine);
    const curve = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(diagramPoints),
      new THREE.LineBasicMaterial({ color: style.color }),
    );
    curve.userData = { type: "beam", id: beamId };
    group.add(curve);
  }

  // De tekst toont de echte eindwaarden, maar staat iets binnen de staaf. Op
  // een gedeelde knoop zouden alle staafeindlabels anders exact over elkaar
  // vallen. De diagramlijn zelf blijft gewoon tot beide knopen doorlopen.
  if (!showLabels) return;
  const labelClass = `frame3d-result-label frame3d-diagram-label frame3d-diagram-${style.symbol.toLowerCase()}`;
  const last = samples.length - 1;
  const inset = Math.min(last, Math.max(1, Math.round(last * 0.18)));
  group.add(makeLabel(`${style.symbol} ${resultValue(samples[0].value)} ${style.unit}`, labelClass, diagramPoints[inset]));
  group.add(makeLabel(`${style.symbol} ${resultValue(samples[last].value)} ${style.unit}`, labelClass, diagramPoints[Math.max(0, last - inset)]));

  // Toon ook een maatgevende binnenwaarde. Dit maakt bijvoorbeeld het
  // parabolische veldmoment van een gelijkmatig belaste ligger direct leesbaar.
  let peakIndex = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (Math.abs(samples[index].value) > Math.abs(samples[peakIndex].value)) peakIndex = index;
  }
  if (peakIndex > 1 && peakIndex < last - 1) {
    group.add(makeLabel(
      `${style.symbol} ${resultValue(samples[peakIndex].value)} ${style.unit}`,
      `${labelClass} frame3d-diagram-peak-label`,
      diagramPoints[peakIndex],
    ));
  }
}

function flushResultDiagramBatch(group: THREE.Group, batch: ResultDiagramBatch) {
  if (batch.fillPositions.length > 0) {
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.fillPositions, 3));
    group.add(new THREE.Mesh(fillGeometry, new THREE.MeshBasicMaterial({
      color: batch.color, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
      depthWrite: false,
    })));
  }
  if (batch.zeroPoints.length > 0) {
    const zeroLines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(batch.zeroPoints),
      new THREE.LineDashedMaterial({ color: batch.color, dashSize: 0.18, gapSize: 0.1, opacity: 0.55, transparent: true }),
    );
    zeroLines.computeLineDistances();
    group.add(zeroLines);
  }
  if (batch.curvePoints.length > 0) {
    group.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(batch.curvePoints),
      new THREE.LineBasicMaterial({ color: batch.color }),
    ));
  }
}

function addDashedSegments(group: THREE.Group, points: THREE.Vector3[], color = 0x7c8da0) {
  if (points.length === 0) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.12, transparent: true, opacity: 0.85 });
  const lines = new THREE.LineSegments(geometry, material);
  lines.computeLineDistances();
  group.add(lines);
}

function addStructuralGrid(group: THREE.Group, model: Frame3DModel, grid: StructuralGrid) {
  if (!grid.enabled) return;
  const xValues = [...grid.xAxes.map((axis) => axis.position / 1000), ...model.nodes.map((node) => node.x)];
  const yValues = [...(grid.yAxes ?? []).map((axis) => axis.position / 1000), ...model.nodes.map((node) => node.y)];
  const zValues = [...grid.zAxes.map((axis) => axis.position / 1000), ...model.nodes.map((node) => node.z)];
  const range = (values: number[], fallback: [number, number]): [number, number] => {
    if (values.length === 0) return fallback;
    const min = Math.min(...values), max = Math.max(...values);
    const margin = Math.max(1, (max - min) * 0.12);
    return [min - margin, max + margin];
  };
  const [xMin, xMax] = range(xValues, [-5, 5]);
  const [yMin, yMax] = range(yValues, [-5, 5]);
  const [zMin, zMax] = range(zValues, [0, 5]);
  const baseZ = grid.zAxes[0]?.position !== undefined ? grid.zAxes[0].position / 1000 : zMin;
  const baseSegments: THREE.Vector3[] = [];
  const levelSegments: THREE.Vector3[] = [];
  // Honderden DOM-labels boven op elkaar vertragen pannen en zoomen zonder
  // nog leesbare informatie te geven. De lijnen en snap-assen blijven alle
  // aanwezig; alleen de zichtbare tekst wordt gelijkmatig uitgedund.
  const labelStride = (count: number) => count <= 80 ? 1 : Math.ceil(count / 40);
  const xLabelStride = labelStride(grid.xAxes.length);
  const yLabelStride = labelStride(grid.yAxes?.length ?? 0);
  const zLabelStride = labelStride(grid.zAxes.length);

  for (const [index, axis] of grid.xAxes.entries()) {
    const x = axis.position / 1000;
    baseSegments.push(new THREE.Vector3(x, yMin, baseZ), new THREE.Vector3(x, yMax, baseZ));
    if (index % xLabelStride === 0) {
      group.add(makeLabel(axis.label, "frame3d-grid-label", new THREE.Vector3(x, yMin, baseZ)));
    }
  }
  for (const [index, axis] of (grid.yAxes ?? []).entries()) {
    const y = axis.position / 1000;
    baseSegments.push(new THREE.Vector3(xMin, y, baseZ), new THREE.Vector3(xMax, y, baseZ));
    if (index % yLabelStride === 0) {
      group.add(makeLabel(axis.label, "frame3d-grid-label", new THREE.Vector3(xMin, y, baseZ)));
    }
  }
  for (const [levelIndex, level] of grid.zAxes.entries()) {
    const z = level.position / 1000;
    const corners = [
      new THREE.Vector3(xMin, yMin, z), new THREE.Vector3(xMax, yMin, z),
      new THREE.Vector3(xMax, yMax, z), new THREE.Vector3(xMin, yMax, z),
    ];
    corners.forEach((corner, index) => levelSegments.push(corner, corners[(index + 1) % corners.length]));
    if (levelIndex % zLabelStride === 0) {
      group.add(makeLabel(level.label, "frame3d-grid-label frame3d-level-label", new THREE.Vector3(xMin, yMin, z)));
    }
  }
  if (grid.zAxes.length === 0) {
    levelSegments.push(new THREE.Vector3(xMin, yMin, zMin), new THREE.Vector3(xMin, yMin, zMax));
  }
  addDashedSegments(group, baseSegments);
  addDashedSegments(group, levelSegments, 0x94a3b8);
}

function resultScale(model: Frame3DModel, result: Frame3DSolveResult): number {
  const box = new THREE.Box3();
  model.nodes.forEach((node) => box.expandByPoint(new THREE.Vector3(node.x, node.y, node.z)));
  const modelSize = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
  const maxDisplacement = frame3DMaximumDisplacementM(model, result);
  return maxDisplacement > 1e-15 ? Math.min(10_000, modelSize * 0.12 / maxDisplacement) : 1;
}

export default function ThreeFrameCanvas({ model, conditionModel, onChange, tool, selection, onSelect, fitToken, visibility, viewRequest, currentView = "iso", structuralGrid, gridSpacingM = 0.5, result, utilizations = [], activeLoadCaseId, cameraRequest, onCameraChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const pendingAppendRef = useRef<{
    baseModel: Frame3DModel;
    model: Frame3DModel;
    node?: Frame3DModel["nodes"][number];
    beam?: Frame3DModel["beams"][number];
  } | null>(null);
  const modelRef = useRef(model);
  const nodeByIdRef = useRef<Map<number, Frame3DModel["nodes"][number]> | null>(null);
  const nodePositionIndexRef = useRef<Map<string, number[]> | null>(null);
  const beamByIdRef = useRef<Map<number, Frame3DModel["beams"][number]> | null>(null);
  const plateByIdRef = useRef<Map<number, NonNullable<Frame3DModel["plates"]>[number]> | null>(null);
  const nextNodeIdRef = useRef(1);
  const nextBeamIdRef = useRef(1);
  if (nodeByIdRef.current === null) {
    nodeByIdRef.current = new Map(model.nodes.map((node) => [node.id, node]));
    nodePositionIndexRef.current = buildNodePositionIndex(model.nodes);
    nextNodeIdRef.current = nextNumericId(model.nodes);
  }
  nodePositionIndexRef.current ??= buildNodePositionIndex(model.nodes);
  if (beamByIdRef.current === null) {
    beamByIdRef.current = new Map(model.beams.map((beam) => [beam.id, beam]));
    nextBeamIdRef.current = nextNumericId(model.beams);
  }
  plateByIdRef.current ??= new Map((model.plates ?? []).map((plate) => [plate.id, plate]));
  // Pointer previews run at most once per animation frame. Keep their lookups
  // O(1), so snapping stays direct when a model contains thousands of nodes.
  // Only rebuild an index when its underlying immutable array changed.
  if (modelRef.current !== model) {
    const pendingAppend = pendingAppendRef.current;
    // Een selectie-update kan tijdens dezelfde klik nog eenmaal renderen met
    // het oude model. Laat die verouderde render de al opgebouwde append-info
    // en indices niet terugdraaien voordat de model-update binnenkomt.
    if (pendingAppend?.baseModel !== model) {
      pendingAppendRef.current = null;
      if (modelRef.current.nodes !== model.nodes) {
        nodeByIdRef.current = new Map(model.nodes.map((node) => [node.id, node]));
        nodePositionIndexRef.current = buildNodePositionIndex(model.nodes);
        nextNodeIdRef.current = nextNumericId(model.nodes);
      }
      if (modelRef.current.beams !== model.beams) {
        beamByIdRef.current = new Map(model.beams.map((beam) => [beam.id, beam]));
        nextBeamIdRef.current = nextNumericId(model.beams);
      }
      if (modelRef.current.plates !== model.plates) {
        plateByIdRef.current = new Map((model.plates ?? []).map((plate) => [plate.id, plate]));
      }
      modelRef.current = model;
    }
  }
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // De actieve invoerrichting wordt in dezelfde effect bijgewerkt als de
  // camera. Zo gebruikt een klik nooit nog de vorige aanzichtsrichting.
  const viewRef = useRef<Frame3DView>(viewRequest?.kind ?? currentView);
  viewRef.current = viewRequest?.kind ?? currentView;
  const snaps = useSnapInstellingen();
  const snapsRef = useRef<SnapInstellingen>(snaps);
  snapsRef.current = snaps;
  const structuralGridRef = useRef(structuralGrid);
  structuralGridRef.current = structuralGrid;
  const gridSpacingRef = useRef(gridSpacingM);
  gridSpacingRef.current = gridSpacingM;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectionRenderedWithModelRef = useRef<Frame3DSelection | undefined>(undefined);
  const nodePickTargetsRef = useRef<THREE.Object3D[]>([]);
  const selectionPickTargetsRef = useRef<THREE.Object3D[]>([]);
  const lastBuiltModelRef = useRef<Frame3DModel | null>(null);
  const lastBuiltConditionModelRef = useRef<Frame3DModel | undefined>(undefined);
  const lastBuiltNodeBoundsRef = useRef<THREE.Box3 | null>(null);
  const visualNodeRadiusRef = useRef(0.035);
  const plateDraftRef = useRef<PlateSketch>(emptyPlateSketch());
  const openingDraftRef = useRef<PlateSketch>(emptyPlateSketch());
  const plateDraftCreatedNodesRef = useRef<Set<number>>(new Set());
  const openingDraftCreatedNodesRef = useRef<Set<number>>(new Set());
  const beamStartRef = useRef<number | null>(null);
  const openingPlateRef = useRef<number | null>(null);
  const cameraChangeRef = useRef(onCameraChange);
  cameraChangeRef.current = onCameraChange;
  const discardDraftNodes = (createdNodeIds: Set<number>) => {
    if (createdNodeIds.size === 0) return;
    const current = modelRef.current;
    const referenced = new Set<number>();
    current.beams.forEach((beam) => {
      referenced.add(beam.startNodeId);
      referenced.add(beam.endNodeId);
    });
    (current.plates ?? []).forEach((plate) => {
      plate.nodeIds.forEach((id) => referenced.add(id));
      plate.openings?.forEach((opening) => opening.nodeIds.forEach((id) => referenced.add(id)));
    });
    current.supports?.forEach((support) => referenced.add(support.nodeId));
    current.loads?.forEach((load) => referenced.add(load.nodeId));
    const removable = new Set([...createdNodeIds].filter((id) => !referenced.has(id)));
    createdNodeIds.clear();
    if (removable.size === 0) return;
    const next = { ...current, nodes: current.nodes.filter((node) => !removable.has(node.id)) };
    pendingAppendRef.current = null;
    nodeByIdRef.current = new Map(next.nodes.map((node) => [node.id, node]));
    nodePositionIndexRef.current = buildNodePositionIndex(next.nodes);
    nextNodeIdRef.current = nextNumericId(next.nodes);
    modelRef.current = next;
    changeRef.current(next);
    selectRef.current(null);
  };
  const previousToolRef = useRef(tool);
  useEffect(() => {
    const previousTool = previousToolRef.current;
    const plateTools: Frame3DTool[] = ["addPlate", "addPlateArc"];
    const openingTools: Frame3DTool[] = ["addOpening", "addOpeningArc"];
    if (!(plateTools.includes(previousTool) && plateTools.includes(tool))) {
      discardDraftNodes(plateDraftCreatedNodesRef.current);
      plateDraftRef.current = emptyPlateSketch();
    }
    if (!(openingTools.includes(previousTool) && openingTools.includes(tool))) {
      discardDraftNodes(openingDraftCreatedNodesRef.current);
      openingDraftRef.current = emptyPlateSketch();
    }
    if (tool !== "addBeam") beamStartRef.current = null;
    previousToolRef.current = tool;
    if (openingTools.includes(tool)) {
      if (!openingTools.includes(previousTool) && selection?.type === "plate") openingPlateRef.current = selection.id;
    } else {
      openingPlateRef.current = null;
    }
    const state = sceneRef.current;
    if (state) {
      hidePreview(state.preview);
      state.previewHint.hidden = true;
      state.renderer.render(state.scene, state.camera);
      state.labelRenderer.render(state.scene, state.camera);
    }
  }, [tool]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(8, 8, 6);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    // 1,5 is op hoge-dpi schermen scherp genoeg voor CAD-lijnen en voorkomt
    // dat elke 3D-frame viermaal zoveel pixels als CSS-pixels hoeft te vullen.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    container.appendChild(renderer.domElement);
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.domElement.className = "frame3d-label-layer";
    container.appendChild(labelRenderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    // Direct CAD-gevoel: elke wielstap zoomt meteen, de ingedrukte
    // scrollknop pant in het schermvlak en er is geen uitloop na loslaten.
    controls.enableDamping = false;
    controls.zoomSpeed = 2.4;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    // Links blijft volledig voor selecteren/plaatsen. Rechts roteert het model.
    // `null` is de door OrbitControls ondersteunde uit-stand, maar staat in de
    // Three-typedeclaratie nog als `number` beschreven.
    (controls.mouseButtons as { LEFT: number | null }).LEFT = null;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.target.set(0, 0, 0);
    controls.update();

    const grid = new THREE.GridHelper(20, 20, 0xb6c2cf, 0xe2e8f0);
    // Three.js' raster ligt standaard in XZ. Het raamwerk gebruikt XY als
    // grondvlak, omdat Z net als in de bestaande 2D-editor omhoog wijst.
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    const axes = new THREE.AxesHelper(2);
    scene.add(axes);
    const axisLabels = [
      makeLabel("X", "frame3d-axis-label frame3d-axis-x", new THREE.Vector3(2.25, 0, 0)),
      makeLabel("Y", "frame3d-axis-label frame3d-axis-y", new THREE.Vector3(0, 2.25, 0)),
      makeLabel("Z", "frame3d-axis-label frame3d-axis-z", new THREE.Vector3(0, 0, 2.25)),
    ];
    axisLabels.forEach((label) => scene.add(label));
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(8, 6, 12);
    scene.add(light);
    const geometry = new THREE.Group();
    scene.add(geometry);
    const preview = new THREE.Group();
    preview.renderOrder = 100;
    const previewPositions = new Float32Array(25 * 3);
    const previewGeometry = new THREE.BufferGeometry();
    previewGeometry.setAttribute("position", new THREE.BufferAttribute(previewPositions, 3));
    previewGeometry.setDrawRange(0, 0);
    const previewLine = new THREE.Line(
      previewGeometry,
      new THREE.LineBasicMaterial({ color: 0x0284c7, depthTest: false }),
    );
    previewLine.renderOrder = 101;
    previewLine.visible = false;
    preview.add(previewLine);
    const previewCursor = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false }),
    );
    previewCursor.renderOrder = 102;
    previewCursor.visible = false;
    preview.add(previewCursor);
    const previewHint = document.createElement("span");
    previewHint.className = "frame3d-snap-hint";
    previewHint.hidden = true;
    container.appendChild(previewHint);
    scene.add(preview);
    sceneRef.current = { scene, camera, renderer, labelRenderer, controls, geometry, preview, previewHint, grid, axes, axisLabels };

    // Damping staat uit, dus continu renderen levert alleen CPU/GPU-belasting op.
    // Teken uitsluitend na camera-, formaat- of modelwijzigingen. Dat houdt ook
    // meerdere geopende 3D-vensters responsief.
    const renderScene = () => {
      const renderStartedAt = performance.now();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
      writeCameraDiagnostics(container, sceneRef.current!);
      container.dataset.frame3dCameraRenderMs = (performance.now() - renderStartedAt).toFixed(2);
    };
    const saveCamera = () => {
      cameraChangeRef.current?.({
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        up: camera.up.toArray() as [number, number, number],
      });
    };
    controls.addEventListener("change", renderScene);
    // Camera-instellingen gaan pas na de interactie naar React. Tijdens
    // pannen/roteren hoeft daardoor geen componentstate per muispixel mee.
    controls.addEventListener("end", saveCamera);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      labelRenderer.setSize(width, height);
      renderScene();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
                  -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const drawingAnchor = () => {
      const sketch = isOpeningTool(toolRef.current) ? openingDraftRef.current : plateDraftRef.current;
      const nodeId = toolRef.current === "addBeam" ? beamStartRef.current : sketch.firstNodeId;
      return nodeId === null ? undefined : nodeByIdRef.current!.get(nodeId);
    };
    const drawingPlane = () => {
      const anchor = drawingAnchor();
      const cameraOffset = camera.position.clone().sub(controls.target).normalize();
      // Lees het orthogonale aanzicht ook uit de echte camera. Dit houdt het
      // werkvlak correct wanneer een opgeslagen camera of Fast Refresh de
      // laatst aangevraagde view voorbijgaat.
      const cameraView: Frame3DView | null = Math.abs(cameraOffset.z) > 0.985 ? "top"
        : Math.abs(cameraOffset.y) > 0.985 ? "front"
        : Math.abs(cameraOffset.x) > 0.985 ? "side"
        : null;
      const view = cameraView ?? viewRef.current;
      // Boven gebruikt XY, voor gebruikt XZ en zij gebruikt YZ. In een vrij
      // 3D-aanzicht tekenen we bewust in het horizontale XY-werkvlak. Dit is
      // stabieler en voorspelbaarder dan een vlak dat met de camera meedraait.
      let normal = view === "front" ? new THREE.Vector3(0, 1, 0)
        : view === "side" ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1);
      let plateOrigin: THREE.Vector3 | undefined;
      if (isOpeningTool(toolRef.current) && openingPlateRef.current !== null) {
        const plate = plateByIdRef.current!.get(openingPlateRef.current);
        const boundaryNodes = plate?.nodeIds.map((id) => nodeByIdRef.current!.get(id)).filter(Boolean);
        if (boundaryNodes && boundaryNodes.length >= 3) {
          plateOrigin = new THREE.Vector3(boundaryNodes[0]!.x, boundaryNodes[0]!.y, boundaryNodes[0]!.z);
          for (let index = 1; index < boundaryNodes.length - 1; index += 1) {
            const p1 = boundaryNodes[index]!, p2 = boundaryNodes[index + 1]!;
            const candidate = new THREE.Vector3(p1.x, p1.y, p1.z).sub(plateOrigin)
              .cross(new THREE.Vector3(p2.x, p2.y, p2.z).sub(plateOrigin));
            if (candidate.lengthSq() > 1e-16) {
              normal = candidate.normalize();
              break;
            }
          }
        }
      }
      const origin = anchor
        ? new THREE.Vector3(anchor.x, anchor.y, anchor.z)
        : plateOrigin ?? controls.target.clone();
      return { anchor, view, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin) };
    };
    type DrawingSnap = { position: THREE.Vector3; nodeId?: number; kind?: SnapSoort };
    const drawingSnap = (): DrawingSnap | null => {
      const settings = snapsRef.current;
      if (settings.knoop) {
        const nodeHit = raycaster.intersectObjects(nodePickTargetsRef.current, false)[0];
        if (nodeHit) {
          const instanceIds = nodeHit.object.userData.instanceIds as number[] | undefined;
          const hitId = instanceIds && nodeHit.instanceId !== undefined
            ? instanceIds[nodeHit.instanceId]
            : nodeHit.object.userData.id;
          const node = nodeByIdRef.current!.get(hitId);
          if (node) return { position: new THREE.Vector3(node.x, node.y, node.z), nodeId: node.id, kind: "knoop" };
        }
      }
      const { anchor, view, plane } = drawingPlane();
      const position = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, position)) return null;
      const raw = position.clone();
      if (settings.stramien && structuralGridRef.current?.enabled) {
        const structural = structuralGridRef.current;
        const xValues = structural.xAxes.map((axis) => axis.position / 1000);
        const yValues = (structural.yAxes ?? []).map((axis) => axis.position / 1000);
        const zValues = structural.zAxes.map((axis) => axis.position / 1000);
        const candidates: THREE.Vector3[] = [];
        const rect = renderer.domElement.getBoundingClientRect();
        const pixelDistance = (candidate: THREE.Vector3) => {
          const projected = candidate.clone().project(camera);
          return Math.hypot((projected.x - pointer.x) * rect.width / 2, (projected.y - pointer.y) * rect.height / 2);
        };
        // Een groot stramien heeft snel honderdduizenden snijpunten. Voor
        // snappen zijn alle afzonderlijke assen nodig, maar bij hun cartesisch
        // product kunnen alleen de assen dicht bij de aanwijzer winnen. Houd
        // daarom per richting de drie beste assen over voor de kruisingen.
        const addSingleAxes = (key: "x" | "y" | "z", values: number[]) => {
          const ranked: { value: number; distance: number }[] = [];
          values.forEach((value) => {
            const candidate = raw.clone();
            candidate[key] = value;
            candidates.push(candidate);
            ranked.push({ value, distance: pixelDistance(candidate) });
          });
          return ranked.sort((a, b) => a.distance - b.distance).slice(0, 3).map((entry) => entry.value);
        };
        const intersectionValues = (all: number[], near: number[], otherCount: number) =>
          all.length * otherCount <= 4096 ? all : near;
        if (view === "front") {
          const nearX = addSingleAxes("x", xValues), nearZ = addSingleAxes("z", zValues);
          intersectionValues(xValues, nearX, zValues.length).forEach((x) =>
            intersectionValues(zValues, nearZ, xValues.length).forEach((z) =>
              candidates.push(new THREE.Vector3(x, anchor?.y ?? controls.target.y, z))));
        } else if (view === "side") {
          const nearY = addSingleAxes("y", yValues), nearZ = addSingleAxes("z", zValues);
          intersectionValues(yValues, nearY, zValues.length).forEach((y) =>
            intersectionValues(zValues, nearZ, yValues.length).forEach((z) =>
              candidates.push(new THREE.Vector3(anchor?.x ?? controls.target.x, y, z))));
        } else {
          const nearX = addSingleAxes("x", xValues), nearY = addSingleAxes("y", yValues);
          intersectionValues(xValues, nearX, yValues.length).forEach((x) =>
            intersectionValues(yValues, nearY, xValues.length).forEach((y) =>
              candidates.push(new THREE.Vector3(x, y, anchor?.z ?? controls.target.z))));
        }
        container.dataset.frame3dSnapCandidates = String(candidates.length);
        const nearest = candidates.reduce<{ point: THREE.Vector3; distance: number } | null>((best, candidate) => {
          const distance = pixelDistance(candidate);
          return !best || distance < best.distance ? { point: candidate, distance } : best;
        }, null);
        if (nearest && nearest.distance <= 14) return { position: nearest.point, kind: "stramien" };
      }
      if (settings.raster) {
        const spacing = Math.max(0.001, gridSpacingRef.current);
        const round = (value: number) => Math.round(value / spacing) * spacing;
        if (view === "front") position.set(round(raw.x), anchor?.y ?? controls.target.y, round(raw.z));
        else if (view === "side") position.set(anchor?.x ?? controls.target.x, round(raw.y), round(raw.z));
        else position.set(round(raw.x), round(raw.y), anchor?.z ?? controls.target.z);
        return { position, kind: "raster" };
      }
      return { position: raw };
    };
    let previewFrame = 0;
    let latestPointerEvent: PointerEvent | null = null;
    const drawPointerPreview = () => {
      const previewStartedAt = performance.now();
      previewFrame = 0;
      const event = latestPointerEvent;
      latestPointerEvent = null;
      if (!event) return;
      const activeTool = toolRef.current;
      if (activeTool !== "addBeam" && activeTool !== "addPlate" && activeTool !== "addPlateArc" && !isOpeningTool(activeTool)) return;
      setPointer(event);
      hidePreview(preview);
      previewHint.hidden = true;
      const sketch = isOpeningTool(activeTool) ? openingDraftRef.current : plateDraftRef.current;
      const lastId = activeTool === "addBeam" ? beamStartRef.current : sketch.lastNodeId;
      const last = lastId === null ? undefined : nodeByIdRef.current!.get(lastId);
      const target = drawingSnap();
      if (last && target) {
        const start = new THREE.Vector3(last.x, last.y, last.z);
        let points: THREE.Vector3[];
        if (isArcBoundaryTool(activeTool) && sketch.arcControlNodeId !== null) {
          const control = nodeByIdRef.current!.get(sketch.arcControlNodeId);
          points = control
            ? new THREE.QuadraticBezierCurve3(start, new THREE.Vector3(control.x, control.y, control.z), target.position).getPoints(24)
            : [start, target.position];
        } else {
          points = [start, target.position];
        }
        const attribute = previewGeometry.getAttribute("position") as THREE.BufferAttribute;
        points.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
        attribute.needsUpdate = true;
        previewGeometry.setDrawRange(0, points.length);
        (previewLine.material as THREE.LineBasicMaterial).color.setHex(isArcBoundaryTool(activeTool) ? 0x7c3aed : 0x0284c7);
        previewLine.visible = true;
        previewCursor.position.copy(target.position);
        previewCursor.scale.setScalar(Math.max(visualNodeRadiusRef.current * 1.25, 0.025));
        previewCursor.visible = true;
        if (target.kind) {
          const rect = renderer.domElement.getBoundingClientRect();
          previewHint.textContent = target.kind === "knoop" ? "Knoop" : target.kind === "stramien" ? "Stramien" : "Raster";
          previewHint.className = `frame3d-snap-hint frame3d-snap-${target.kind}`;
          previewHint.style.left = `${event.clientX - rect.left}px`;
          previewHint.style.top = `${event.clientY - rect.top}px`;
          previewHint.hidden = false;
        }
      }
      renderer.render(scene, camera);
      container.dataset.frame3dPreviewMs = (performance.now() - previewStartedAt).toFixed(2);
    };
    const onPointerMove = (event: PointerEvent) => {
      latestPointerEvent = event;
      if (!previewFrame) previewFrame = requestAnimationFrame(drawPointerPreview);
    };
    const onPointerLeave = () => {
      latestPointerEvent = null;
      hidePreview(preview);
      previewHint.hidden = true;
      renderScene();
    };
    let down: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        down = null;
        return;
      }
      down = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) {
        down = null;
        return;
      }
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
        down = null;
        return;
      }
      setPointer(event);
      // Raycast alleen tegen objecten die werkelijk selecteerbaar zijn. Labels,
      // rasters en resultaatlijnen hoeven bij grote modellen niet bij iedere
      // klik opnieuw doorzocht te worden.
      const intersection = raycaster.intersectObjects(selectionPickTargetsRef.current, false)[0];
      let hit: THREE.Object3D | undefined = intersection?.object;
      while (hit && hit !== geometry && typeof hit.userData.type !== "string") hit = hit.parent ?? undefined;
      const type = hit?.userData.type;
      const instanceIds = hit?.userData.instanceIds as number[] | undefined;
      const id = instanceIds && intersection?.instanceId !== undefined
        ? instanceIds[intersection.instanceId]
        : hit?.userData.id;
      const activeTool = toolRef.current;
      let current = modelRef.current;
      const commitModel = (next: Frame3DModel, appended?: {
        node?: Frame3DModel["nodes"][number];
        beam?: Frame3DModel["beams"][number];
      }) => {
        const priorAppend = pendingAppendRef.current?.model === current
          ? pendingAppendRef.current
          : null;
        const appendedNode = appended?.node ?? priorAppend?.node;
        const appendedBeam = appended?.beam ?? priorAppend?.beam;
        pendingAppendRef.current = appendedNode || appendedBeam
          ? { baseModel: priorAppend?.baseModel ?? current, model: next, node: appendedNode, beam: appendedBeam }
          : null;
        if (current.nodes !== next.nodes) {
          if (appendedNode && next.nodes.length === current.nodes.length + 1
            && next.nodes[next.nodes.length - 1] === appendedNode) {
            nodeByIdRef.current!.set(appendedNode.id, appendedNode);
            addNodeToPositionIndex(nodePositionIndexRef.current!, appendedNode);
            nextNodeIdRef.current = Math.max(nextNodeIdRef.current, appendedNode.id + 1);
          } else {
            nodeByIdRef.current = new Map(next.nodes.map((node) => [node.id, node]));
            nodePositionIndexRef.current = buildNodePositionIndex(next.nodes);
            nextNodeIdRef.current = nextNumericId(next.nodes);
          }
        }
        if (current.beams !== next.beams) {
          if (appendedBeam && next.beams.length === current.beams.length + 1
            && next.beams[next.beams.length - 1] === appendedBeam) {
            beamByIdRef.current!.set(appendedBeam.id, appendedBeam);
            nextBeamIdRef.current = Math.max(nextBeamIdRef.current, appendedBeam.id + 1);
          } else {
            beamByIdRef.current = new Map(next.beams.map((beam) => [beam.id, beam]));
            nextBeamIdRef.current = nextNumericId(next.beams);
          }
        }
        if (current.plates !== next.plates) {
          plateByIdRef.current = new Map((next.plates ?? []).map((plate) => [plate.id, plate]));
        }
        modelRef.current = next;
        current = next;
        changeRef.current(next);
      };
      const ensureDrawingNode = (): number | null => {
        if (activeTool === "addBeam" && type === "beam" && typeof id === "number" && intersection) {
          const beam = beamByIdRef.current!.get(id);
          const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
          const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
          if (beam && start && end) {
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
            const ratio = intersection.point.clone().sub(a).dot(delta) / delta.lengthSq();
            if (ratio <= 1e-6) return start.id;
            if (ratio >= 1 - 1e-6) return end.id;
            const split = splitFrame3DBeam(current, beam.id, ratio);
            commitModel(split.model);
            return split.nodeId;
          }
        }
        const snapped = drawingSnap();
        if (!snapped) return null;
        if (snapped.nodeId !== undefined) return snapped.nodeId;
        const position = snapped.position;
        const existing = nodeAtPosition(nodePositionIndexRef.current!, nodeByIdRef.current!, position);
        if (existing) return existing.id;
        const nodeId = nextNodeIdRef.current;
        const node = { id: nodeId, x: position.x, y: position.y, z: position.z };
        commitModel({ ...current, nodes: [...current.nodes, node] }, { node });
        if (activeTool === "addPlate" || activeTool === "addPlateArc") {
          plateDraftCreatedNodesRef.current.add(nodeId);
        } else if (isOpeningTool(activeTool)) {
          openingDraftCreatedNodesRef.current.add(nodeId);
        }
        return nodeId;
      };
      if (activeTool === "addNode") {
        const nodeId = ensureDrawingNode();
        if (nodeId !== null) selectRef.current({ type: "node", id: nodeId });
      } else if (activeTool === "addBeam") {
        const nodeId = ensureDrawingNode();
        if (nodeId !== null) {
          const rememberedStart = beamStartRef.current;
          const start = rememberedStart !== null && nodeByIdRef.current!.has(rememberedStart)
            ? rememberedStart
            : null;
          if (rememberedStart !== start) beamStartRef.current = null;
          if (start === null || start === nodeId) {
            beamStartRef.current = nodeId;
            selectRef.current({ type: "node", id: nodeId });
          }
          else {
            const duplicate = current.beams.some((beam) =>
              beam.startNodeId === start && beam.endNodeId === nodeId ||
              beam.startNodeId === nodeId && beam.endNodeId === start);
            if (!duplicate) {
              const beamId = nextBeamIdRef.current;
              const beam = {
                id: beamId,
                startNodeId: start,
                endNodeId: nodeId,
                material: "S235",
                profileName: "IPE 200",
              };
              commitModel({
                ...current,
                beams: [...current.beams, beam],
              }, { beam });
            }
            beamStartRef.current = nodeId;
            selectRef.current({ type: "node", id: nodeId });
          }
        }
      } else if (activeTool === "addPlate" || activeTool === "addPlateArc") {
        const nodeId = ensureDrawingNode();
        if (nodeId !== null) {
          const sketch = plateDraftRef.current;
          if (sketch.firstNodeId === null) {
            plateDraftRef.current = { ...emptyPlateSketch(), nodeIds: [nodeId], firstNodeId: nodeId, lastNodeId: nodeId };
          } else if (activeTool === "addPlateArc" && sketch.arcControlNodeId === null) {
            if (nodeId !== sketch.lastNodeId && nodeId !== sketch.firstNodeId && !sketch.nodeIds.includes(nodeId)) {
              plateDraftRef.current = {
                ...sketch,
                nodeIds: [...sketch.nodeIds, nodeId],
                arcControlNodeId: nodeId,
              };
            }
          } else if (sketch.lastNodeId !== null && nodeId !== sketch.lastNodeId) {
            const closes = nodeId === sketch.firstNodeId;
            if (!closes && sketch.nodeIds.includes(nodeId)) {
              down = null;
              return;
            }
            const segment: Frame3DPlateBoundarySegment = activeTool === "addPlateArc"
              ? { kind: "arc", startNodeId: sketch.lastNodeId, controlNodeId: sketch.arcControlNodeId!, endNodeId: nodeId }
              : { kind: "line", startNodeId: sketch.lastNodeId, endNodeId: nodeId };
            const segments = [...sketch.segments, segment];
            const nodeIds = closes ? sketch.nodeIds : [...sketch.nodeIds, nodeId];
            if (closes && segments.length >= 2 && nodeIds.length >= 3) {
              let committed = false;
              try {
                const next = addFrame3DPlate(current, nodeIds, {
                  thicknessM: 0.2,
                  material: "C30/37",
                  boundary: segments,
                });
                commitModel(next);
                committed = true;
                const addedPlate = next.plates?.[next.plates.length - 1];
                if (addedPlate) selectRef.current({ type: "plate", id: addedPlate.id });
              } finally {
                plateDraftRef.current = emptyPlateSketch();
                if (committed) plateDraftCreatedNodesRef.current.clear();
                else discardDraftNodes(plateDraftCreatedNodesRef.current);
              }
            } else if (!closes) {
              plateDraftRef.current = {
                nodeIds,
                segments,
                firstNodeId: sketch.firstNodeId,
                lastNodeId: nodeId,
                arcControlNodeId: null,
              };
            }
          }
          const draft = plateDraftRef.current;
          if (draft.firstNodeId !== null) {
            selectRef.current({ type: "multi", nodeIds: [...draft.nodeIds], beamIds: [] });
          }
        }
      } else if (isOpeningTool(activeTool)) {
        const nodeId = ensureDrawingNode();
        const openingPlateId = openingPlateRef.current;
        if (nodeId !== null && openingPlateId !== null) {
          const sketch = openingDraftRef.current;
          if (sketch.firstNodeId === null) {
            openingDraftRef.current = { ...emptyPlateSketch(), nodeIds: [nodeId], firstNodeId: nodeId, lastNodeId: nodeId };
          } else if (isArcBoundaryTool(activeTool) && sketch.arcControlNodeId === null) {
            if (nodeId !== sketch.lastNodeId && nodeId !== sketch.firstNodeId && !sketch.nodeIds.includes(nodeId)) {
              openingDraftRef.current = {
                ...sketch,
                nodeIds: [...sketch.nodeIds, nodeId],
                arcControlNodeId: nodeId,
              };
            }
          } else if (sketch.lastNodeId !== null && nodeId !== sketch.lastNodeId) {
            const closes = nodeId === sketch.firstNodeId;
            if (!closes && sketch.nodeIds.includes(nodeId)) {
              down = null;
              return;
            }
            const segment: Frame3DPlateBoundarySegment = isArcBoundaryTool(activeTool)
              ? { kind: "arc", startNodeId: sketch.lastNodeId, controlNodeId: sketch.arcControlNodeId!, endNodeId: nodeId }
              : { kind: "line", startNodeId: sketch.lastNodeId, endNodeId: nodeId };
            const segments = [...sketch.segments, segment];
            const nodeIds = closes ? sketch.nodeIds : [...sketch.nodeIds, nodeId];
            if (closes && segments.length >= 2 && nodeIds.length >= 3) {
              let committed = false;
              try {
                const next = addFrame3DPlateOpening(current, openingPlateId, nodeIds, { boundary: segments });
                commitModel(next);
                committed = true;
                selectRef.current({ type: "plate", id: openingPlateId });
              } finally {
                openingDraftRef.current = emptyPlateSketch();
                if (committed) openingDraftCreatedNodesRef.current.clear();
                else discardDraftNodes(openingDraftCreatedNodesRef.current);
              }
            } else if (!closes) {
              openingDraftRef.current = {
                nodeIds,
                segments,
                firstNodeId: sketch.firstNodeId,
                lastNodeId: nodeId,
                arcControlNodeId: null,
              };
            }
          }
          const draft = openingDraftRef.current;
          if (draft.firstNodeId !== null) {
            selectRef.current({ type: "multi", nodeIds: [...draft.nodeIds], beamIds: [] });
          }
        }
      } else if (activeTool === "addSubNode") {
        if (type === "beam" && typeof id === "number" && intersection) {
          const beam = beamByIdRef.current!.get(id);
          const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
          const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
          if (beam && start && end) {
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
            const ratio = intersection.point.clone().sub(a).dot(delta) / delta.lengthSq();
            if (ratio <= 1e-6) selectRef.current({ type: "node", id: start.id });
            else if (ratio >= 1 - 1e-6) selectRef.current({ type: "node", id: end.id });
            else {
              const split = splitFrame3DBeam(current, id, ratio);
              changeRef.current(split.model);
              selectRef.current({ type: "node", id: split.nodeId });
            }
          }
        }
      } else {
        const selectable = (["node", "beam", "plate", "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad"] as const)
          .includes(type) && typeof id === "number"
          ? { type, id }
          : null;
        selectRef.current(selectable
          ? toggleFrame3DSelection(selectionRef.current, selectable, event.shiftKey || event.ctrlKey || event.metaKey)
          : null);
      }
      hidePreview(preview);
      previewHint.hidden = true;
      renderScene();
      down = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      discardDraftNodes(plateDraftCreatedNodesRef.current);
      discardDraftNodes(openingDraftCreatedNodesRef.current);
      plateDraftRef.current = emptyPlateSketch();
      openingDraftRef.current = emptyPlateSketch();
      beamStartRef.current = null;
      hidePreview(preview);
      previewHint.hidden = true;
      selectRef.current(null);
      renderScene();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      discardDraftNodes(plateDraftCreatedNodesRef.current);
      discardDraftNodes(openingDraftCreatedNodesRef.current);
      observer.disconnect();
      if (previewFrame) cancelAnimationFrame(previewFrame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      controls.removeEventListener("change", renderScene);
      controls.removeEventListener("end", saveCamera);
      controls.dispose();
      disposeGroup(geometry);
      disposeGroup(preview);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      axisLabels.forEach((label) => label.element.remove());
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
      previewHint.remove();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const rebuildStartedAt = performance.now();
    const { geometry } = state;
    const previousModel = lastBuiltModelRef.current;
    const pendingAppend = pendingAppendRef.current?.model === model ? pendingAppendRef.current : null;
    const appendedNode = previousModel !== null && pendingAppend?.node !== undefined
      && model.nodes.length === previousModel.nodes.length + 1
      && model.nodes[model.nodes.length - 1] === pendingAppend.node;
    const appendedBeam = previousModel !== null && pendingAppend?.beam !== undefined
      && model.beams.length === previousModel.beams.length + 1
      && model.beams[model.beams.length - 1] === pendingAppend.beam;
    const unchangedCollections = previousModel !== null
      && model.plates === previousModel.plates
      && model.supports === previousModel.supports
      && model.loads === previousModel.loads
      && model.memberLoads === previousModel.memberLoads
      && model.memberPointLoads === previousModel.memberPointLoads
      && model.thermalLoads === previousModel.thermalLoads
      && model.surfaceLoads === previousModel.surfaceLoads;
    const movedNodes: Frame3DModel["nodes"] = [];
    let nodeTopologyStable = previousModel !== null && model.nodes.length === previousModel.nodes.length;
    if (previousModel && nodeTopologyStable && model.nodes !== previousModel.nodes) {
      for (let index = 0; index < model.nodes.length; index += 1) {
        const before = previousModel.nodes[index];
        const after = model.nodes[index];
        if (before.id !== after.id) {
          nodeTopologyStable = false;
          break;
        }
        if (before.x !== after.x || before.y !== after.y || before.z !== after.z) movedNodes.push(after);
      }
    }
    const movedNodeIds = new Set(movedNodes.map((node) => node.id));
    const affectedBeams = movedNodes.length > 0 && previousModel && model.beams === previousModel.beams
      ? model.beams.filter((beam) => movedNodeIds.has(beam.startNodeId) || movedNodeIds.has(beam.endNodeId))
      : [];
    const affectedBeamIds = new Set(affectedBeams.map((beam) => beam.id));
    const affectedPlates = (model.plates ?? []).filter((plate) =>
      plate.nodeIds.some((id) => movedNodeIds.has(id))
      || (plate.openings ?? []).some((opening) => opening.nodeIds.some((id) => movedNodeIds.has(id))));
    const affectedPlateIds = new Set(affectedPlates.map((plate) => plate.id));
    const markerModel = conditionModel ?? model;
    const conditionGeometryStable = (!visibility.supports
        || !(markerModel.supports ?? []).some((support) => movedNodeIds.has(support.nodeId)))
      && (!visibility.loads || (
        !(markerModel.loads ?? []).some((load) => movedNodeIds.has(load.nodeId))
        && !(markerModel.memberLoads ?? []).some((load) => affectedBeamIds.has(load.beamId))
        && !(markerModel.memberPointLoads ?? []).some((load) => affectedBeamIds.has(load.beamId))
        && !(markerModel.thermalLoads ?? []).some((load) => affectedBeamIds.has(load.beamId))
        && !(markerModel.surfaceLoads ?? []).some((load) => affectedPlateIds.has(load.plateId))
      ));
    const resultGeometryStable = !result || !(
      visibility.deformation || visibility.reactions || visibility.axialForce || visibility.shearY
      || visibility.shearZ || visibility.torsion || visibility.momentY || visibility.momentZ
    );
    const utilizationGeometryStable = !visibility.utilization
      || !utilizations.some((value) => affectedBeamIds.has(value.beamId));
    const previousBounds = lastBuiltNodeBoundsRef.current;
    const movedInsideBounds = previousBounds !== null
      && movedNodes.every((node) => previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)));
    const incrementalNodeMove = previousModel !== null
      && unchangedCollections
      && nodeTopologyStable
      && model.nodes !== previousModel.nodes
      && model.beams === previousModel.beams
      && movedNodes.length > 0
      && movedNodes.length <= 512
      && previousModel.nodes.length >= 250
      && movedInsideBounds
      && (!visibility.plates || affectedPlates.length === 0)
      && !visibility.beamNumbers
      && conditionGeometryStable
      && resultGeometryStable
      && utilizationGeometryStable;
    if (incrementalNodeMove) {
      const visibleNodes = geometry.children.find((child) => child.userData.frame3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.frame3dNodeHit === true);
      const nodeMeshes = [visibleNodes, hitNodes].filter((child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh);
      let fastPathReady = nodeMeshes.length > 0;
      const matrix = new THREE.Matrix4();
      for (const node of movedNodes) {
        matrix.makeTranslation(node.x, node.y, node.z);
        for (const mesh of nodeMeshes) {
          const instanceIndex = (mesh.userData.instanceIndexById as Map<number, number> | undefined)?.get(node.id);
          if (instanceIndex === undefined) {
            fastPathReady = false;
            break;
          }
          mesh.setMatrixAt(instanceIndex, matrix);
          mesh.instanceMatrix.addUpdateRange(instanceIndex * 16, 16);
          mesh.instanceMatrix.needsUpdate = true;
        }
        if (!fastPathReady) break;
      }
      const touchedBeamMeshes = new Set<THREE.InstancedMesh>();
      if (fastPathReady && visibility.beams) {
        for (const beam of affectedBeams) {
          const start = nodeByIdRef.current!.get(beam.startNodeId);
          const end = nodeByIdRef.current!.get(beam.endNodeId);
          if (!start || !end) { fastPathReady = false; break; }
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          const length = delta.length();
          if (length <= 1e-12) { fastPathReady = false; break; }
          const profileKey = visibility.profiles && beam.profileName
            ? `profile\u0000${profileBatchName(beam.profileName)}`
            : `analytical\u0000${visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M}\u0000${visibility.profiles ? 24 : 12}`;
          const mesh = geometry.children.find((child) => child.userData.frame3dBeamBatchKey === profileKey);
          const instanceIndex = mesh instanceof THREE.InstancedMesh
            ? (mesh.userData.instanceIndexById as Map<number, number> | undefined)?.get(beam.id)
            : undefined;
          if (!(mesh instanceof THREE.InstancedMesh) || instanceIndex === undefined) {
            fastPathReady = false;
            break;
          }
          const rotation = visibility.profiles && beam.profileName
            ? memberRotation(delta, beam.rollAngleRad ?? 0)
            : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
          const beamMatrix = new THREE.Matrix4().compose(
            a.add(b).multiplyScalar(0.5), rotation,
            visibility.profiles && beam.profileName
              ? frame3DProfileInstanceScale(length)
              : new THREE.Vector3(1, length, 1),
          );
          mesh.setMatrixAt(instanceIndex, beamMatrix);
          mesh.instanceMatrix.addUpdateRange(instanceIndex * 16, 16);
          mesh.instanceMatrix.needsUpdate = true;
          touchedBeamMeshes.add(mesh);
        }
      }
      if (fastPathReady) {
        touchedBeamMeshes.forEach((mesh) => {
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
        });
        geometry.traverse((object) => {
          if (!(object instanceof CSS2DObject)) return;
          const follow = object.userData.frame3dFollow as { type: "node" | "beam"; id: number } | undefined;
          if (follow?.type !== "node" || !movedNodeIds.has(follow.id)) return;
          const node = nodeByIdRef.current!.get(follow.id);
          if (!node) return;
          object.position.set(node.x, node.y, node.z);
          object.element.textContent = [
            visibility.nodeNumbers ? String(node.id) : "",
            visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
          ].filter(Boolean).join(" · ");
        });
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        state.labelRenderer.render(state.scene, state.camera);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        lastBuiltConditionModelRef.current = conditionModel;
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dIncrementalFallback;
          containerRef.current.dataset.frame3dBuildMode = "move-nodes";
          containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
        }
        return;
      }
    }
    const incrementalNodeOnly = appendedNode && model.beams === previousModel?.beams;
    const incrementalBeam = appendedBeam
      && (model.nodes === previousModel?.nodes || appendedNode);
    if (previousModel && unchangedCollections && previousModel.nodes.length >= 250
      && (incrementalNodeOnly || incrementalBeam)) {
      const node = appendedNode ? model.nodes[model.nodes.length - 1]! : undefined;
      const previousBounds = lastBuiltNodeBoundsRef.current;
      const visibleNodes = geometry.children.find((child) => child.userData.frame3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.frame3dNodeHit === true);
      const meshes = [visibleNodes, hitNodes].filter((child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh);
      const nodeCapacityAvailable = !node || (meshes.length > 0
        && meshes.every((mesh) => model.nodes.length <= mesh.instanceMatrix.count));
      const previousNodeLabelStride = previousModel.nodes.length <= 200
        ? 1 : Math.ceil(previousModel.nodes.length / 24);
      const nodeLabelStride = model.nodes.length <= 200 ? 1 : Math.ceil(model.nodes.length / 24);
      const nodeLabelSamplingStable = !(visibility.nodeNumbers || visibility.nodeCoordinates)
        || previousNodeLabelStride === nodeLabelStride;
      const beam = appendedBeam ? model.beams[model.beams.length - 1]! : undefined;
      const previousBeamLabelStride = previousModel.beams.length <= 200
        ? 1 : Math.ceil(previousModel.beams.length / 24);
      const beamLabelStride = model.beams.length <= 200 ? 1 : Math.ceil(model.beams.length / 24);
      const beamLabelSamplingStable = !visibility.beamNumbers
        || previousBeamLabelStride === beamLabelStride;
      const profileKey = beam && visibility.profiles && beam.profileName
        ? `profile\u0000${profileBatchName(beam.profileName)}`
        : beam ? `analytical\u0000${visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M}\u0000${visibility.profiles ? 24 : 12}`
          : undefined;
      const beamMesh = profileKey
        ? geometry.children.find((child) => child.userData.frame3dBeamBatchKey === profileKey)
        : undefined;
      const beamStart = beam ? nodeByIdRef.current!.get(beam.startNodeId) : undefined;
      const beamEnd = beam ? nodeByIdRef.current!.get(beam.endNodeId) : undefined;
      const beamEndpointsValid = !beam || (beamStart !== undefined && beamEnd !== undefined
        && Math.hypot(beamEnd.x - beamStart.x, beamEnd.y - beamStart.y, beamEnd.z - beamStart.z) > 1e-12);
      const beamCapacityAvailable = !beam || (beamMesh instanceof THREE.InstancedMesh
        && beamMesh.count + 1 <= beamMesh.instanceMatrix.count);
      const previousConditionModel = lastBuiltConditionModelRef.current;
      const conditionLoadsStable = !beam || !visibility.loads
        || (previousConditionModel !== undefined
          && conditionModel?.loads === previousConditionModel.loads
          && conditionModel?.memberLoads === previousConditionModel.memberLoads
          && conditionModel?.memberPointLoads === previousConditionModel.memberPointLoads
          && conditionModel?.thermalLoads === previousConditionModel.thermalLoads);
      const nodeInsideBounds = !node
        || (previousBounds !== null && previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)));
      const fastPathReady = nodeCapacityAvailable && beamCapacityAvailable && beamEndpointsValid
        && conditionLoadsStable && nodeLabelSamplingStable && beamLabelSamplingStable && nodeInsideBounds;
      // Binnen de bestaande begrenzing blijven knoopstraal, opleggingsgrootte
      // en stramienbereik gelijk. Voeg de knoop dan rechtstreeks aan de al
      // aanwezige GPU-batches toe; alle onveranderde geometrie blijft staan.
      if (fastPathReady) {
        if (node) {
          const matrix = new THREE.Matrix4().makeTranslation(node.x, node.y, node.z);
          for (const mesh of meshes) {
            const index = mesh.count;
            mesh.count += 1;
            (mesh.userData.instanceIds as number[]).push(node.id);
            (mesh.userData.instanceBaseColors as number[]).push(0x334155);
            const nodeIndexById = mesh.userData.instanceIndexById as Map<number, number> | undefined
              ?? new Map((mesh.userData.instanceIds as number[]).map((id, instanceIndex) => [id, instanceIndex]));
            mesh.userData.instanceIndexById = nodeIndexById;
            nodeIndexById.set(node.id, index);
            mesh.setMatrixAt(index, matrix);
            mesh.setColorAt(index, new THREE.Color(0x334155));
            markInstanceChanged(mesh, index);
            expandInstancedMeshBounds(mesh, matrix);
          }
        }
        let addedLabels = 0;
        if (node && (visibility.nodeNumbers || visibility.nodeCoordinates)
          && (model.nodes.length - 1) % nodeLabelStride === 0) {
          const parts = [
            visibility.nodeNumbers ? String(node.id) : "",
            visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
          ].filter(Boolean);
          geometry.add(makeLabel(
            parts.join(" · "), "frame3d-node-label",
            new THREE.Vector3(node.x, node.y, node.z), { type: "node", id: node.id },
          ));
          addedLabels += 1;
        }
        if (beam && beamMesh instanceof THREE.InstancedMesh) {
          const start = beamStart!;
          const end = beamEnd!;
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          const length = delta.length();
          const isProfile = profileKey?.startsWith("profile\u0000") ?? false;
          const rotation = isProfile
            ? memberRotation(delta, beam.rollAngleRad ?? 0)
            : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
          const utilization = visibility.utilization
            ? utilizations.find((value) => value.beamId === beam.id)
            : undefined;
          const utilizationClass = utilization ? frame3DUtilizationClass(utilization) : undefined;
          const color = utilizationClass ? FRAME_3D_UTILIZATION_COLORS[utilizationClass] : 0x2563eb;
          const index = beamMesh.count;
          beamMesh.count += 1;
          (beamMesh.userData.instanceIds as number[]).push(beam.id);
          (beamMesh.userData.instanceBaseColors as number[]).push(color);
          const beamIndexById = beamMesh.userData.instanceIndexById as Map<number, number> | undefined
            ?? new Map((beamMesh.userData.instanceIds as number[]).map((id, instanceIndex) => [id, instanceIndex]));
          beamMesh.userData.instanceIndexById = beamIndexById;
          beamIndexById.set(beam.id, index);
          const beamMatrix = new THREE.Matrix4().compose(
            a.add(b).multiplyScalar(0.5), rotation,
            isProfile ? frame3DProfileInstanceScale(length) : new THREE.Vector3(1, length, 1),
          );
          beamMesh.setMatrixAt(index, beamMatrix);
          beamMesh.setColorAt(index, new THREE.Color(color));
          markInstanceChanged(beamMesh, index);
          expandInstancedMeshBounds(beamMesh, beamMatrix);
          if (visibility.beamNumbers && (model.beams.length - 1) % beamLabelStride === 0) {
            const midpoint = new THREE.Vector3(start.x, start.y, start.z)
              .add(new THREE.Vector3(end.x, end.y, end.z)).multiplyScalar(0.5)
              .addScaledVector(memberAxes(delta, beam.rollAngleRad ?? 0).ey, 0.3);
            geometry.add(makeLabel(`(${beam.id})`, "frame3d-beam-number", midpoint));
            addedLabels += 1;
          }
        }
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        state.labelRenderer.render(state.scene, state.camera);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        lastBuiltConditionModelRef.current = conditionModel;
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dIncrementalFallback;
          containerRef.current.dataset.frame3dBuildMode = beam
            ? node ? "append-node-beam" : "append-beam"
            : "append-node";
          containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
          containerRef.current.dataset.frame3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
          if (addedLabels > 0) {
            containerRef.current.dataset.frame3dLabels = String(
              Number(containerRef.current.dataset.frame3dLabels ?? 0) + addedLabels,
            );
          }
        }
        return;
      }
      if (containerRef.current) {
        containerRef.current.dataset.frame3dIncrementalFallback = [
          !nodeCapacityAvailable ? "node-capacity" : "",
          !beamCapacityAvailable ? "beam-capacity" : "",
          !beamEndpointsValid ? "beam-endpoints" : "",
          !conditionLoadsStable ? "condition-loads" : "",
          !nodeLabelSamplingStable ? "node-labels" : "",
          !beamLabelSamplingStable ? "beam-labels" : "",
          !nodeInsideBounds ? "bounds" : "",
        ].filter(Boolean).join(",");
      }
    }
    disposeGroup(geometry);
    nodePickTargetsRef.current = [];
    selectionPickTargetsRef.current = [];
    state.grid.visible = visibility.grid;
    state.axes.visible = visibility.axes;
    state.axisLabels.forEach((label) => { label.visible = visibility.axes; });
    const byId = new Map(model.nodes.map((node) => [node.id, node]));
    const plateGeometryById = new Map<number, ReturnType<typeof createFrame3DPlateGeometry>>();
    const plateGeometryFor = (plate: NonNullable<Frame3DModel["plates"]>[number]) => {
      if (!plateGeometryById.has(plate.id)) {
        plateGeometryById.set(plate.id, createFrame3DPlateGeometry(model, plate, byId));
      }
      return plateGeometryById.get(plate.id) ?? null;
    };
    const nodeRadius = visualNodeRadius(model);
    visualNodeRadiusRef.current = nodeRadius;
    // Deel onveranderlijke buffers binnen één scène-opbouw. Vooral echte
    // profiel-extrusies en knoopbollen zijn anders bij grote modellen een
    // kostbare herhaling voor ieder element.
    const profileGeometryCache = new Map<string, THREE.BufferGeometry | null>();
    const profileGeometryFor = (profileName: string | undefined, length: number) => {
      if (!profileName) return null;
      const key = `${profileName}\u0000${length.toFixed(9)}`;
      if (!profileGeometryCache.has(key)) {
        profileGeometryCache.set(key, createFrame3DProfileGeometry(profileName, length));
      }
      return profileGeometryCache.get(key) ?? null;
    };
    const analyticalGeometryCache = new Map<string, THREE.CylinderGeometry>();
    const analyticalGeometryFor = (radius: number, length: number, segments: number) => {
      const key = `${radius}:${length.toFixed(9)}:${segments}`;
      let cached = analyticalGeometryCache.get(key);
      if (!cached) {
        cached = new THREE.CylinderGeometry(radius, radius, length, segments);
        analyticalGeometryCache.set(key, cached);
      }
      return cached;
    };
    const profileEdgeCache = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
    const profileEdgesFor = (profile: THREE.BufferGeometry) => {
      let cached = profileEdgeCache.get(profile);
      if (!cached) {
        cached = new THREE.EdgesGeometry(profile, 28);
        profileEdgeCache.set(profile, cached);
      }
      return cached;
    };
    type BeamInstance = { id: number; matrix: THREE.Matrix4; color: number };
    type BeamInstanceBatch = {
      geometry: THREE.BufferGeometry;
      instances: BeamInstance[];
    };
    const beamInstanceBatches = new Map<string, BeamInstanceBatch>();
    // Vanaf deze omvang kost duizenden losse Object3D's meer dan de echte
    // geometrie. Eén InstancedMesh per profiel/lengte houdt ieder element
    // afzonderlijk selecteerbaar, maar stuurt de transformaties in één batch
    // naar de GPU.
    // Ook middelgrote raamwerken worden vaak interactief bewerkt. Vanaf
    // honderd staven zijn losse meshes en raycast-doelen al merkbaar duurder
    // dan één selecteerbare GPU-batch per profiel.
    const useBeamInstancing = model.beams.length >= 100;
    // Nummerlabels zijn DOM-elementen. Duizenden labels boven op elkaar zijn
    // onleesbaar en blokkeren de hoofdthread. Houd per soort een gelijkmatig
    // verdeelde, representatieve set zichtbaar bij grote modellen.
    const labelStride = (count: number) => count <= 200 ? 1 : Math.ceil(count / 24);
    const beamLabelStride = labelStride(model.beams.length);
    const nodeLabelStride = labelStride(model.nodes.length);
    const resultLabelStride = model.beams.length <= 200 ? 1 : Math.ceil(model.beams.length / 12);
    const resultLabelVisible = (beamId: number, beamIndex: number) => {
      if (beamIndex % resultLabelStride === 0) return true;
      const selected = selectionRef.current;
      return (selected?.type === "beam" && selected.id === beamId)
        || (selected?.type === "multi" && selected.beamIds.includes(beamId));
    };
    const nodeGeometry = visibility.nodes ? new THREE.SphereGeometry(nodeRadius, 24, 16) : null;
    // Snapzones blijven bestaan wanneer de knoopbollen verborgen zijn. Zo is
    // Weergave onafhankelijk van de actieve Knoop-snap, zoals in de 2D-editor.
    const nodeHitGeometry = new THREE.SphereGeometry(nodeRadius * 2.6, 12, 8);
    const utilizationByMember = new Map(utilizations.map((value) => [value.beamId, value]));
    for (const [beamIndex, beam] of model.beams.entries()) {
      const start = byId.get(beam.startNodeId);
      const end = byId.get(beam.endNodeId);
      if (!start || !end) continue;
      const a = new THREE.Vector3(start.x, start.y, start.z);
      const b = new THREE.Vector3(end.x, end.y, end.z);
      const delta = new THREE.Vector3().subVectors(b, a);
      const length = delta.length();
      if (length === 0) continue;
      const axes = memberAxes(delta, beam.rollAngleRad ?? 0);
      if (visibility.beams) {
        const utilization = visibility.utilization ? utilizationByMember.get(beam.id) : undefined;
        const utilizationClass = utilization ? frame3DUtilizationClass(utilization) : undefined;
        const color = utilizationClass ? FRAME_3D_UTILIZATION_COLORS[utilizationClass] : 0x2563eb;
        // Voor grote modellen wordt één extrusie van één meter per profiel
        // gedeeld. Alleen de lokale staafas schaalt mee met de echte lengte.
        // De doorsnede zelf blijft daardoor exact, terwijl ongelijke
        // staaflengtes toch in één GPU-batch passen.
        const profileGeometry = visibility.profiles
          ? profileGeometryFor(beam.profileName, useBeamInstancing ? 1 : length)
          : null;
        const radius = visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M;
        const rotation = profileGeometry
          ? memberRotation(delta, beam.rollAngleRad ?? 0)
          : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        if (useBeamInstancing) {
          const key = profileGeometry
            ? `profile\u0000${profileBatchName(beam.profileName!)}`
            : `analytical\u0000${radius}\u0000${visibility.profiles ? 24 : 12}`;
          let batch = beamInstanceBatches.get(key);
          if (!batch) {
            batch = {
              geometry: profileGeometry ?? analyticalGeometryFor(radius, 1, visibility.profiles ? 24 : 12),
              instances: [],
            };
            beamInstanceBatches.set(key, batch);
          }
          batch.instances.push({
            id: beam.id,
            color,
            matrix: new THREE.Matrix4().compose(
              midpoint,
              rotation,
              profileGeometry ? frame3DProfileInstanceScale(length) : new THREE.Vector3(1, length, 1),
            ),
          });
        } else {
          const mesh = new THREE.Mesh(
            profileGeometry ?? analyticalGeometryFor(radius, length, visibility.profiles ? 24 : 12),
            new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 }),
          );
          mesh.position.copy(midpoint);
          mesh.quaternion.copy(rotation);
          mesh.userData = { type: "beam", id: beam.id };
          if (profileGeometry) {
            // Een dunne rand maakt lijf, flenzen en holle kokers ook bij een
            // witte achtergrond als echte doorsnede leesbaar.
            mesh.add(new THREE.LineSegments(
              profileEdgesFor(profileGeometry),
              new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.42 }),
            ));
          }
          geometry.add(mesh);
        }
        if (utilization && resultLabelVisible(beam.id, beamIndex)) {
          const midpoint = a.clone().add(b).multiplyScalar(0.5)
            .addScaledVector(axes.ez, 0.42)
            .addScaledVector(axes.ey, 0.12);
          geometry.add(makeLabel(
            utilization.status === "NotApplicable"
              ? `${utilization.standard} · n.v.t.`
              : `${utilization.standard} · UC ${utilization.uc.toFixed(2)}`,
            `frame3d-utilization-label frame3d-utilization-${utilizationClass}`,
            midpoint,
          ));
        }
      }
      if (visibility.beamNumbers && beamIndex % beamLabelStride === 0) {
        const midpoint = a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ey, 0.3);
        geometry.add(makeLabel(`(${beam.id})`, "frame3d-beam-number", midpoint));
      }
      if (visibility.profiles && beam.profileName && !useBeamInstancing) {
        const midpoint = a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ez, -0.3);
        geometry.add(makeLabel(beam.profileName, "frame3d-profile-label", midpoint));
      }
    }
    for (const [batchKey, batch] of beamInstanceBatches) {
      const instanceCapacity = 2 ** Math.ceil(Math.log2(Math.max(8, batch.instances.length + 1)));
      const mesh = new THREE.InstancedMesh(
        batch.geometry,
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.04 }),
        instanceCapacity,
      );
      const instanceIds = batch.instances.map((instance) => instance.id);
      const instanceBaseColors = batch.instances.map((instance) => instance.color);
      mesh.count = batch.instances.length;
      mesh.userData = {
        type: "beam",
        instanceIds,
        instanceBaseColors,
        instanceIndexById: new Map(instanceIds.map((id, index) => [id, index])),
        frame3dBeamBatchKey: batchKey,
      };
      batch.instances.forEach((instance, index) => {
        mesh.setMatrixAt(index, instance.matrix);
        mesh.setColorAt(index, new THREE.Color(instance.color));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (mesh.instanceColor) {
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      geometry.add(mesh);
    }
    if (visibility.plates) {
      for (const plate of model.plates ?? []) {
        const built = plateGeometryFor(plate);
        if (!built) continue;
        const mesh = new THREE.Mesh(built.geometry, new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.78,
          metalness: 0.01,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
        }));
        mesh.position.copy(built.position);
        mesh.quaternion.copy(built.quaternion);
        mesh.userData = { type: "plate", id: plate.id, baseOpacity: 0.7, selectionOpacity: 0.88 };
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(built.geometry, 22),
          new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.78 }),
        );
        // De plaatmesh zelf is de klikzone. De rand kleurt wel mee met de
        // selectie, maar verdubbelt niet het aantal raycast-doelen.
        edges.userData = { type: "plate", id: plate.id, selectionColor: 0x92400e, pickable: false };
        mesh.add(edges);
        geometry.add(mesh);
      }
    }
    const useNodeInstancing = model.nodes.length >= 250;
    if (useNodeInstancing) {
      const instanceIds = model.nodes.map((node) => node.id);
      const instanceBaseColors = model.nodes.map(() => 0x334155);
      // Reserveer in machten van twee ruimte voor interactief bijtekenen. Een
      // enkele nieuwe knoop past dan meestal in de bestaande GPU-buffer.
      const instanceCapacity = 2 ** Math.ceil(Math.log2(Math.max(256, model.nodes.length + 1)));
      const visibleNodes = visibility.nodes ? new THREE.InstancedMesh(
        nodeGeometry!, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.06 }), instanceCapacity,
      ) : null;
      const hitNodes = new THREE.InstancedMesh(
        nodeHitGeometry,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        instanceCapacity,
      );
      if (visibleNodes) {
        visibleNodes.count = model.nodes.length;
        visibleNodes.userData = {
          type: "node",
          instanceIds: [...instanceIds],
          instanceBaseColors: [...instanceBaseColors],
          instanceIndexById: new Map(instanceIds.map((id, index) => [id, index])),
          frame3dNodeVisual: true,
        };
      }
      hitNodes.count = model.nodes.length;
      hitNodes.userData = {
        type: "node",
        instanceIds,
        instanceBaseColors,
        instanceIndexById: new Map(instanceIds.map((id, index) => [id, index])),
        pickable: visibility.nodes,
        selectionHighlight: false,
        frame3dNodeHit: true,
      };
      const matrix = new THREE.Matrix4();
      model.nodes.forEach((node, index) => {
        matrix.makeTranslation(node.x, node.y, node.z);
        visibleNodes?.setMatrixAt(index, matrix);
        visibleNodes?.setColorAt(index, new THREE.Color(0x334155));
        hitNodes.setMatrixAt(index, matrix);
        hitNodes.setColorAt(index, new THREE.Color(0x334155));
      });
      if (visibleNodes) visibleNodes.instanceMatrix.needsUpdate = true;
      hitNodes.instanceMatrix.needsUpdate = true;
      visibleNodes?.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      hitNodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (visibleNodes?.instanceColor) visibleNodes.instanceColor.needsUpdate = true;
      if (hitNodes.instanceColor) hitNodes.instanceColor.needsUpdate = true;
      visibleNodes?.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      hitNodes.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      visibleNodes?.computeBoundingBox();
      visibleNodes?.computeBoundingSphere();
      hitNodes.computeBoundingBox();
      hitNodes.computeBoundingSphere();
      if (visibleNodes) geometry.add(visibleNodes);
      geometry.add(hitNodes);
      nodePickTargetsRef.current.push(hitNodes);
    }
    for (const [nodeIndex, node] of model.nodes.entries()) {
      if (!useNodeInstancing) {
        if (visibility.nodes) {
          const mesh = new THREE.Mesh(
            nodeGeometry!,
            new THREE.MeshStandardMaterial({
              color: 0x334155,
              roughness: 0.5,
              metalness: 0.06,
            }),
          );
          mesh.position.set(node.x, node.y, node.z);
          mesh.userData = { type: "node", id: node.id };
          geometry.add(mesh);
        }
        // De zichtbare bol blijft klein zoals in 2D; een transparante grotere
        // bol geeft hem een comfortabele klikzone zonder het beeld te vullen.
        const hitTarget = new THREE.Mesh(
          nodeHitGeometry,
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hitTarget.position.set(node.x, node.y, node.z);
        hitTarget.userData = { type: "node", id: node.id, pickable: visibility.nodes };
        geometry.add(hitTarget);
        nodePickTargetsRef.current.push(hitTarget);
      }
      if ((visibility.nodeNumbers || visibility.nodeCoordinates) && nodeIndex % nodeLabelStride === 0) {
        const parts = [
          visibility.nodeNumbers ? String(node.id) : "",
          visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
        ].filter(Boolean);
        geometry.add(makeLabel(
          parts.join(" · "), "frame3d-node-label",
          new THREE.Vector3(node.x, node.y, node.z), { type: "node", id: node.id },
        ));
      }
    }
    if (visibility.structuralGrid && structuralGrid) addStructuralGrid(geometry, model, structuralGrid);
    addFrame3DConditionMarkers(geometry, conditionModel ?? model, visibility, activeLoadCaseId);

    if (visibility.loads) {
      const visibleSurfaceLoads = (model.surfaceLoads ?? []).filter((load) =>
        activeLoadCaseId === undefined || frame3DLoadCaseId(load) === activeLoadCaseId);
      const surfaceLoadLabelStride = labelStride(visibleSurfaceLoads.length);
      for (const [loadIndex, load] of visibleSurfaceLoads.entries()) {
        const plate = plateByIdRef.current!.get(load.plateId);
        const built = plate && plateGeometryFor(plate);
        if (!built) continue;
        const vector = new THREE.Vector3(load.qx, load.qy, load.qz);
        const magnitude = vector.length();
        if (magnitude <= 1e-12) continue;
        const direction = vector.normalize();
        const length = 0.7;
        const arrow = new THREE.ArrowHelper(direction, built.centroid.clone().addScaledVector(direction, -length), length, 0x0284c7, 0.22, 0.12);
        arrow.traverse((child) => { child.userData = { type: "surfaceLoad", id: load.id }; });
        geometry.add(arrow);
        if (loadIndex % surfaceLoadLabelStride === 0) {
          geometry.add(makeLabel(
            `q = ${resultValue(magnitude)} kN/m²`,
            "frame3d-result-label frame3d-surface-load-label",
            built.centroid.clone().addScaledVector(built.normal, 0.12),
          ));
        }
      }
    }

    if (result && visibility.deformation) {
      const scale = resultScale(model, result);
      const deformedProfileBatches = new Map<string, {
        geometry: THREE.BufferGeometry;
        matrices: THREE.Matrix4[];
      }>();
      for (const beam of model.beams) {
        const start = byId.get(beam.startNodeId);
        const end = byId.get(beam.endNodeId);
        if (!start || !end) continue;
        const points = frame3DMemberDisplacementStations(model, beam, result).map((station) =>
          new THREE.Vector3(start.x, start.y, start.z)
            .lerp(new THREE.Vector3(end.x, end.y, end.z), station.t)
            .add(new THREE.Vector3(station.ux, station.uy, station.uz).multiplyScalar(scale)));
        if (points.length < 2) continue;
        if (visibility.profiles && beam.profileName) {
          for (let index = 0; index < points.length - 1; index += 1) {
            const a = points[index], b = points[index + 1];
            const delta = b.clone().sub(a), length = delta.length();
            const profile = length > 1e-10 ? profileGeometryFor(beam.profileName, 1) : null;
            if (!profile) continue;
            let batch = deformedProfileBatches.get(beam.profileName);
            if (!batch) {
              batch = { geometry: profile, matrices: [] };
              deformedProfileBatches.set(beam.profileName, batch);
            }
            batch.matrices.push(new THREE.Matrix4().compose(
              a.clone().add(b).multiplyScalar(0.5),
              memberRotation(delta, beam.rollAngleRad ?? 0),
              frame3DProfileInstanceScale(length),
            ));
          }
        } else {
          geometry.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: 0xdc2626, linewidth: 2 }),
          ));
        }
      }
      for (const batch of deformedProfileBatches.values()) {
        const deformed = new THREE.InstancedMesh(
          batch.geometry,
          new THREE.MeshStandardMaterial({
            color: 0xdc2626, transparent: true, opacity: 0.48, depthWrite: false, roughness: 0.65,
          }),
          batch.matrices.length,
        );
        batch.matrices.forEach((matrix, index) => deformed.setMatrixAt(index, matrix));
        deformed.instanceMatrix.needsUpdate = true;
        deformed.computeBoundingBox();
        deformed.computeBoundingSphere();
        geometry.add(deformed);
      }
    }

    if (result && visibility.reactions) {
      const maxForce = result.reactions.reduce((maximum, value) =>
        Math.max(maximum, Math.hypot(value.fx, value.fy, value.fz)), 0);
      const batchedReactionLines: THREE.Vector3[] = [];
      const batchedReactionHeads: THREE.Matrix4[] = [];
      const batchReactions = result.reactions.length >= 200;
      for (const reaction of result.reactions) {
        const node = byId.get(reaction.nodeId);
        const magnitude = Math.hypot(reaction.fx, reaction.fy, reaction.fz);
        if (!node || magnitude <= 1e-12 || maxForce <= 0) continue;
        const direction = new THREE.Vector3(reaction.fx, reaction.fy, reaction.fz).normalize();
        const length = 0.45 + 1.1 * magnitude / maxForce;
        const origin = new THREE.Vector3(node.x, node.y, node.z).addScaledVector(direction, -length);
        const headLength = Math.min(0.28, length * 0.28);
        const headWidth = Math.min(0.16, length * 0.16);
        if (batchReactions) {
          const endpoint = origin.clone().addScaledVector(direction, length);
          batchedReactionLines.push(origin, endpoint.clone().addScaledVector(direction, -headLength));
          batchedReactionHeads.push(new THREE.Matrix4().compose(
            endpoint.clone().addScaledVector(direction, -headLength / 2),
            new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
            new THREE.Vector3(headWidth, headLength, headWidth),
          ));
        } else {
          geometry.add(new THREE.ArrowHelper(direction, origin, length, 0x16a34a, headLength, headWidth));
        }
      }
      if (batchedReactionLines.length > 0) {
        geometry.add(new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(batchedReactionLines),
          new THREE.LineBasicMaterial({ color: 0x16a34a }),
        ));
        const heads = new THREE.InstancedMesh(
          new THREE.ConeGeometry(1, 1, 8),
          new THREE.MeshBasicMaterial({ color: 0x16a34a }),
          batchedReactionHeads.length,
        );
        batchedReactionHeads.forEach((matrix, index) => heads.setMatrixAt(index, matrix));
        heads.instanceMatrix.needsUpdate = true;
        heads.computeBoundingBox();
        heads.computeBoundingSphere();
        geometry.add(heads);
      }
    }

    if (result && (visibility.axialForce || visibility.shearY || visibility.shearZ ||
      visibility.torsion || visibility.momentY || visibility.momentZ)) {
      const forceByMember = new Map(result.memberForces.map((force) => [force.memberId, force]));
      const activeDiagrams = (Object.keys(DIAGRAM_STYLE) as DiagramComponent[])
        .filter((component) => visibility[component]);
      const diagramBatches = model.beams.length >= 250
        ? new Map(activeDiagrams.map((component) => [component, {
          color: DIAGRAM_STYLE[component].color,
          fillPositions: [],
          zeroPoints: [],
          curvePoints: [],
        } satisfies ResultDiagramBatch]))
        : undefined;
      const maxima = new Map(activeDiagrams.map((component) => [
        component,
        result.memberForces.reduce((maximum, force) =>
          Math.max(maximum, ...diagramPoints(result, component, force).map((point) => Math.abs(point.value))), 0),
      ]));
      const modelBox = new THREE.Box3().setFromPoints(model.nodes.map((node) => new THREE.Vector3(node.x, node.y, node.z)));
      const diagramHeight = Math.max(0.35, Math.min(3, modelBox.getSize(new THREE.Vector3()).length() * 0.085));
      for (const [beamIndex, beam] of model.beams.entries()) {
        const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
        const force = forceByMember.get(beam.id);
        if (!start || !end || !force) continue;
        const a = new THREE.Vector3(start.x, start.y, start.z);
        const b = new THREE.Vector3(end.x, end.y, end.z);
        const axes = memberAxes(b.clone().sub(a), beam.rollAngleRad ?? 0);
        for (const component of activeDiagrams) {
          const style = DIAGRAM_STYLE[component];
          addResultDiagram(
            geometry, beam.id, a, b, style.direction(axes), diagramPoints(result, component, force),
            maxima.get(component) ?? 0, diagramHeight,
            { symbol: style.symbol, unit: style.unit, color: style.color },
            resultLabelVisible(beam.id, beamIndex),
            diagramBatches?.get(component),
          );
        }
        const max = (a: number, b: number) => Math.max(Math.abs(a), Math.abs(b)).toFixed(2);
        const parts = [
          visibility.axialForce ? `N ${max(force.nStartKn, force.nEndKn)} kN` : "",
          visibility.torsion ? `T ${max(force.torsionStartKnm, force.torsionEndKnm)} kNm` : "",
        ].filter(Boolean);
        if (parts.length > 0 && resultLabelVisible(beam.id, beamIndex)) {
          const midpoint = a.clone().add(b).multiplyScalar(0.5);
          geometry.add(makeLabel(parts.join(" · "), "frame3d-result-label", midpoint));
        }
      }
      diagramBatches?.forEach((batch) => flushResultDiagramBatch(geometry, batch));
    }
    let visibleLabelCount = 0;
    geometry.traverse((object) => {
      if (object instanceof CSS2DObject) visibleLabelCount += 1;
      const type = object.userData.type as Frame3DSelectionType | undefined;
      if (type && object.userData.pickable !== false && SELECTABLE_TYPES.has(type) && typeof (object as { raycast?: unknown }).raycast === "function") {
        selectionPickTargetsRef.current.push(object);
      }
    });
    // Als alleen belastingen zichtbaar zijn, gebruiken we de plaatmesh enkel
    // om normaal en zwaartepunt te bepalen. Die tijdelijke GPU-buffer hangt
    // dan niet in de scène en moet hier meteen worden vrijgegeven.
    if (!visibility.plates) {
      plateGeometryById.forEach((built) => built?.geometry.dispose());
    }
    applySelectionHighlight(geometry, selectionRef.current);
    state.renderer.render(state.scene, state.camera);
    state.labelRenderer.render(state.scene, state.camera);
    selectionRenderedWithModelRef.current = selectionRef.current;
    writeCameraDiagnostics(containerRef.current, state);
    if (containerRef.current) {
      containerRef.current.dataset.frame3dBuildMode = "full";
      containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
      containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
      containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
      containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
      containerRef.current.dataset.frame3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
      containerRef.current.dataset.frame3dLabels = String(visibleLabelCount);
    }
    lastBuiltModelRef.current = model;
    lastBuiltConditionModelRef.current = conditionModel;
    const nodeBounds = new THREE.Box3();
    model.nodes.forEach((node) => nodeBounds.expandByPoint(new THREE.Vector3(node.x, node.y, node.z)));
    lastBuiltNodeBoundsRef.current = nodeBounds;
    if (pendingAppendRef.current?.model === model) pendingAppendRef.current = null;
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (selectionRenderedWithModelRef.current === selection) {
      selectionRenderedWithModelRef.current = undefined;
      if (containerRef.current) containerRef.current.dataset.frame3dSelectionMs = "0.00";
      return;
    }
    const selectionStartedAt = performance.now();
    applySelectionHighlight(state.geometry, selection);
    state.renderer.render(state.scene, state.camera);
    if (containerRef.current) {
      containerRef.current.dataset.frame3dSelectionMs = (performance.now() - selectionStartedAt).toFixed(2);
    }
  }, [selection]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const current = modelRef.current;
    const box = sceneBounds(current, visibility);
    const hasGeometry = !box.isEmpty();
    const center = hasGeometry ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const view = viewRequest?.kind ?? "iso";
    viewRef.current = view;
    const direction = view === "top" ? new THREE.Vector3(0, 0, 1)
      : view === "front" ? new THREE.Vector3(0, -1, 0)
      : view === "side" ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(1.4, 1.4, 1);
    if (view === "top") state.camera.up.set(0, 1, 0);
    else state.camera.up.set(0, 0, 1);
    const distance = hasGeometry ? fittedCameraDistance(state.camera, box, direction) : 4;
    state.controls.target.copy(center);
    state.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    state.camera.near = Math.max(0.001, distance / 10_000);
    state.camera.far = Math.max(1_000, distance * 100);
    state.camera.updateProjectionMatrix();
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
    state.labelRenderer.render(state.scene, state.camera);
    writeCameraDiagnostics(containerRef.current, state);
  }, [
    fitToken, viewRequest?.token, viewRequest?.kind,
  ]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !cameraRequest) return;
    state.camera.position.fromArray(cameraRequest.state.position);
    state.camera.up.fromArray(cameraRequest.state.up);
    state.controls.target.fromArray(cameraRequest.state.target);
    state.camera.updateProjectionMatrix();
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
    state.labelRenderer.render(state.scene, state.camera);
    writeCameraDiagnostics(containerRef.current, state);
  }, [cameraRequest?.token]);

  return <div
    className={`frame3d-canvas frame3d-tool-${tool}`}
    ref={containerRef}
    aria-label={`3D raamwerk · ${viewRequest?.kind ?? currentView}`}
  />;
}
