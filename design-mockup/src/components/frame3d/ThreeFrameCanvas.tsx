import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addFrame3DPlate, addFrame3DPlateOpening, frame3DLoadCaseId, splitFrame3DBeam, type Frame3DModel, type Frame3DPlateBoundarySegment } from "./frame3dModel";
import type { Frame3DVisibility } from "./frame3dVisibility";
import type { Frame3DView } from "./frame3dCommands";
import { addFrame3DConditionMarkers, frame3DConditionMarkerSize } from "./frame3dMarkers";
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
import { frame3DViewFromCamera, type Frame3DCameraState } from "./frame3dViewSets";
import { createFrame3DPlateGeometry } from "./frame3dPlateGeometry";
import { sampleCircularArc3D } from "./frame3dCircularArc";
import { selectFrame3DInScreenBox } from "./frame3dBoxSelection";
import { findFrame3DBeamNearScreenPoint } from "./frame3dBeamScreenPick";
import type { Frame3DEditMeta } from "./frame3dHistory";
import { useSnapInstellingen, type SnapInstellingen, type SnapSoort } from "../../hooks/useSnapInstellingen";
import { frame3DGridLayout } from "./frame3dGrid";
import {
  buildFrame3DNodeSnapScreenIndex,
  findFrame3DNodeScreenSnap,
  type Frame3DNodeSnapScreenIndex,
} from "./frame3dNodeSnapIndex";

// De analytische knoop is een punt, maar in de editor moet hij ook op afstand
// goed aanklikbaar en herkenbaar blijven. De staaf loopt tot het middelpunt van
// deze bol en verdwijnt er dus ruim in: ook onder een schuine kijkhoek ontstaat
// er nergens een zichtbare kier tussen staaf en knoop.
const ANALYTICAL_BEAM_RADIUS_M = 0.035;
const PROFILE_BEAM_RADIUS_M = 0.12;
let contourHistorySerial = 0;
const nextContourHistoryGroup = () => `contour-${++contourHistorySerial}`;

function nextNumericId(items: readonly { id: number }[]): number {
  let maximum = 0;
  for (const item of items) maximum = Math.max(maximum, item.id);
  return maximum + 1;
}

function beamConnectionKey(startNodeId: number, endNodeId: number): string {
  return startNodeId < endNodeId
    ? `${startNodeId}|${endNodeId}`
    : `${endNodeId}|${startNodeId}`;
}

function buildBeamConnectionIndex(beams: Frame3DModel["beams"]): Set<string> {
  const index = new Set<string>();
  for (const beam of beams) index.add(beamConnectionKey(beam.startNodeId, beam.endNodeId));
  return index;
}

function sortedGridAxisValues(axes: readonly { position: number }[]): number[] {
  return axes.map((axis) => axis.position / 1000).sort((a, b) => a - b);
}

function nearestGridAxisValues(
  values: readonly number[],
  targetM: number,
  count = 3,
): number[] {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < targetM) low = middle + 1;
    else high = middle;
  }
  let left = low - 1;
  let right = low;
  const nearest: number[] = [];
  while (nearest.length < count && (left >= 0 || right < values.length)) {
    const leftDistance = left >= 0 ? Math.abs(values[left] - targetM) : Number.POSITIVE_INFINITY;
    const rightDistance = right < values.length ? Math.abs(values[right] - targetM) : Number.POSITIVE_INFINITY;
    if (leftDistance <= rightDistance) nearest.push(values[left--]);
    else nearest.push(values[right++]);
  }
  return nearest;
}

const SAME_NODE_TOLERANCE_M = 1e-7;

function cleanDrawingCoordinate(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

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

function geometrySignature(geometry: THREE.BufferGeometry): string {
  let hash = 2166136261;
  const mix = (value: number) => { hash = Math.imul(hash ^ value, 16777619); };
  const position = geometry.getAttribute("position");
  const positionArray = position.array;
  if (positionArray instanceof Float32Array) {
    const words = new Uint32Array(positionArray.buffer, positionArray.byteOffset, positionArray.length);
    for (const value of words) mix(value);
  } else {
    for (let index = 0; index < positionArray.length; index += 1) mix(Math.fround(Number(positionArray[index])) * 1e6);
  }
  const indices = geometry.index?.array;
  if (indices) for (let index = 0; index < indices.length; index += 1) mix(Number(indices[index]));
  return `${position.count}:${geometry.index?.count ?? 0}:${hash >>> 0}`;
}

function frame3DNodeBounds(model: Frame3DModel): THREE.Box3 {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const node of model.nodes) box.expandByPoint(point.set(node.x, node.y, node.z));
  return box;
}

function indexFrame3DNodes(model: Frame3DModel): Map<number, Frame3DModel["nodes"][number]> {
  const byId = new Map<number, Frame3DModel["nodes"][number]>();
  for (const node of model.nodes) byId.set(node.id, node);
  return byId;
}

/** Ongeveer dezelfde 10 px diameter als de 2D-knoop bij passend beeld. */
function visualNodeRadius(model: Frame3DModel): number {
  if (model.nodes.length < 2) return 0.035;
  const box = frame3DNodeBounds(model);
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
  const box = frame3DNodeBounds(model);
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
  viewportWidthPx: number,
  viewportHeightPx: number,
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
  // Het canvas bevat bovenaan de titel en de knop Passend beeld, en onderaan
  // statusinformatie. Reserveer hun ruimte ook voor een klein model: de vaste
  // minimumafstand van 2 m alleen liet een plaat net onder de kopregel vallen.
  const usableHeight = Math.max(0.55, 1 - 88 / Math.max(viewportHeightPx, 1));
  const usableWidth = Math.max(0.7, 1 - 48 / Math.max(viewportWidthPx, 1));
  const projectedDistance = Math.max(
    halfHeight / Math.max(Math.tan(verticalFov / 2) * usableHeight, 1e-6),
    halfWidth / Math.max(Math.tan(horizontalFov / 2) * usableWidth, 1e-6),
  );
  return Math.max(2, (halfDepth + projectedDistance) * 1.08);
}

interface Props {
  model: Frame3DModel;
  /** Zelfde geometrie met vluchtige automatische lasten, alleen voor symbolen. */
  conditionModel?: Frame3DModel;
  onChange: (model: Frame3DModel, meta?: Frame3DEditMeta) => void;
  onDrawError?: (message: string | null) => void;
  tool: Frame3DTool;
  selection: Frame3DSelection;
  onSelect: (selection: Frame3DSelection) => void;
  onOpenCheckForBeam?: (beamId: number) => void;
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
  onCameraViewChange?: (view: Frame3DView) => void;
}

interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  labelRenderer: CSS2DRenderer;
  controls: OrbitControls;
  geometry: THREE.Group;
  draftLine: THREE.LineSegments;
  preview: THREE.Group;
  previewHint: HTMLSpanElement;
  grid: THREE.GridHelper;
  axes: THREE.AxesHelper;
  axisLabels: CSS2DObject[];
}

function renderFrame3DLabels(state: SceneState, container: HTMLElement | null) {
  state.labelRenderer.render(state.scene, state.camera);
  const layer = state.labelRenderer.domElement;
  const labels = Array.from(layer.querySelectorAll<HTMLElement>(
    ".frame3d-result-label, .frame3d-utilization-label, .frame3d-profile-label, .frame3d-local-axis-label, "
    + ".frame3d-axis-label, .frame3d-node-label, .frame3d-beam-number, .frame3d-grid-label",
  ));
  if (labels.length === 0) {
    if (container) {
      container.dataset.frame3dOverlayLabelsShown = "0";
      container.dataset.frame3dOverlayLabelsHidden = "0";
    }
    return;
  }
  const startedAt = performance.now();
  // visibility:hidden behoudt de DOMRect van een label. Meet ook verborgen
  // labels en pas hun zichtbaarheid na de collision-indeling aan.
  const viewport = layer.getBoundingClientRect();
  // De vaste titel, fitknop, status en eventuele bedienpanelen liggen boven
  // het WebGL-canvas. Behandel hun rechthoeken als bezet schermgebied, zodat
  // knoop- en resultaatlabels deze bediening niet overdrukken bij zoomen.
  const reserved = Array.from(container?.parentElement?.querySelectorAll<HTMLElement>(
    ".frame3d-stage-header, .frame3d-stage-footer, .frame3d-fit, "
    + ".frame3d-draw-error, .frame3d-transform-panel, .frame3d-uc-legend",
  ) ?? []).map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  const priority = (label: HTMLElement) => label.classList.contains("frame3d-utilization-fail") ? 0
    : label.classList.contains("frame3d-diagram-peak-label") ? 1
      : label.classList.contains("frame3d-diagram-label") ? 2
        : label.classList.contains("frame3d-result-label") ? 3
          : label.classList.contains("frame3d-axis-label") ? 4
            : label.classList.contains("frame3d-utilization-label") ? 5
              : label.classList.contains("frame3d-node-label")
                || label.classList.contains("frame3d-beam-number") ? 6 : 7;
  const candidates = labels.map((label, index) => ({
    label, index, priority: priority(label), box: label.getBoundingClientRect(),
  })).filter(({ box }) => box.width > 0 && box.height > 0);
  candidates.sort((a, b) => a.priority - b.priority || a.index - b.index);
  const accepted: DOMRect[] = [];
  const overlaps = (box: DOMRect, other: DOMRect) => box.left < other.right + 2
    && box.right > other.left - 2 && box.top < other.bottom + 2
    && box.bottom > other.top - 2;
  let hidden = 0;
  for (const { label, box } of candidates) {
    const outside = box.right <= viewport.left || box.left >= viewport.right
      || box.bottom <= viewport.top || box.top >= viewport.bottom;
    const collision = !outside && (reserved.some((other) => overlaps(box, other))
      || accepted.some((other) => overlaps(box, other)));
    if (outside || collision) {
      if (label.style.visibility !== "hidden") label.style.visibility = "hidden";
      hidden += 1;
    } else {
      if (label.style.visibility) label.style.visibility = "";
      accepted.push(box);
    }
  }
  if (container) {
    container.dataset.frame3dOverlayLabelsShown = String(accepted.length);
    container.dataset.frame3dOverlayLabelsHidden = String(hidden);
    container.dataset.frame3dOverlayLayoutMs = (performance.now() - startedAt).toFixed(2);
  }
}

function writeCameraDiagnostics(container: HTMLElement | null, state: SceneState) {
  if (!container) return;
  const value = (vector: THREE.Vector3) => vector.toArray().map((component) => component.toFixed(6)).join(",");
  container.dataset.frame3dCameraPosition = value(state.camera.position);
  container.dataset.frame3dCameraTarget = value(state.controls.target);
  container.dataset.frame3dCameraUp = value(state.camera.up);
}

function writeBuildMode(container: HTMLElement, mode: string) {
  container.dataset.frame3dBuildMode = mode;
  const history = (container.dataset.frame3dBuildHistory ?? "").split(",").filter(Boolean);
  history.push(mode);
  container.dataset.frame3dBuildHistory = history.slice(-8).join(",");
}

function sameFrame3DVisibility(a: Frame3DVisibility, b: Frame3DVisibility): boolean {
  return (Object.keys(a) as (keyof Frame3DVisibility)[]).every((key) => a[key] === b[key]);
}

function sameFrame3DNodes(a: Frame3DModel["nodes"], b: Frame3DModel["nodes"]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((node, index) => {
    const other = b[index];
    return node.id === other.id && node.x === other.x && node.y === other.y && node.z === other.z;
  });
}

function sameFrame3DEntities<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) =>
    value === right[index] || JSON.stringify(value) === JSON.stringify(right[index]));
}

function sameVisibleConditionLoads(
  current: Frame3DModel | undefined,
  previous: Frame3DModel | undefined,
  activeLoadCaseId: number | undefined,
): boolean {
  if (!current || !previous) return false;
  const visible = <T extends { caseId?: number }>(loads: readonly T[] | undefined) =>
    activeLoadCaseId === undefined ? loads : loads?.filter((load) => frame3DLoadCaseId(load) === activeLoadCaseId);
  return sameFrame3DEntities(visible(current.loads), visible(previous.loads))
    && sameFrame3DEntities(visible(current.memberLoads), visible(previous.memberLoads))
    && sameFrame3DEntities(visible(current.memberPointLoads), visible(previous.memberPointLoads))
    && sameFrame3DEntities(visible(current.thermalLoads), visible(previous.thermalLoads));
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

function createPlateMaterial(color = 0x94a3b8): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.01,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof CSS2DObject) object.element.remove();
    const drawable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
    drawable.geometry?.dispose();
    if (drawable.material) {
      const materials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function disposeGroup(group: THREE.Group) {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject3D(child);
  }
}

function hidePreview(group: THREE.Group) {
  group.children.forEach((child) => { child.visible = false; });
}

const SELECTABLE_TYPES = new Set<Frame3DSelectionType>([
  "node", "beam", "plate", "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad",
]);
const LOAD_SELECTION_TYPES = new Set<Frame3DSelectionType>([
  "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad",
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
          ? (object.userData.selectionColor ?? 0xffa31a)
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
    });
    if (object.userData.frame3dSelected === selected) return;
    materials.forEach((material, index) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (!colored.color || baseColors[index] === undefined) return;
      const color = selected ? (object.userData.selectionColor ?? 0xffa31a) : baseColors[index]!;
      if (colored.color.getHex() !== color) colored.color.setHex(color);
    });
    if (object.userData.selectionOpacity !== undefined) {
      materials.forEach((material) => {
        const opacity = selected ? object.userData.selectionOpacity : object.userData.baseOpacity;
        if (material.opacity !== opacity) material.opacity = opacity;
      });
    }
    object.userData.frame3dSelected = selected;
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

function signedDiagramValue(value: number): string {
  const formatted = resultValue(value);
  return value >= 5e-10 ? `+${formatted}` : formatted;
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
  // Waarden die in de gekozen weergave overal als 0,000 verschijnen leveren
  // alleen overlappende labels en loze vlakgeometrie op.
  if (samples.every((sample) => Math.abs(sample.value) < 5e-4)) return;
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
  group.add(makeLabel(`${style.symbol} ${signedDiagramValue(samples[0].value)} ${style.unit}`, labelClass, diagramPoints[inset]));
  group.add(makeLabel(`${style.symbol} ${signedDiagramValue(samples[last].value)} ${style.unit}`, labelClass, diagramPoints[Math.max(0, last - inset)]));

  // Toon ook een maatgevende binnenwaarde. Dit maakt bijvoorbeeld het
  // parabolische veldmoment van een gelijkmatig belaste ligger direct leesbaar.
  let peakIndex = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (Math.abs(samples[index].value) > Math.abs(samples[peakIndex].value)) peakIndex = index;
  }
  if (peakIndex > 1 && peakIndex < last - 1) {
    group.add(makeLabel(
      `${style.symbol} ${signedDiagramValue(samples[peakIndex].value)} ${style.unit}`,
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

function structuralGridLayout(model: Frame3DModel, grid: StructuralGrid) {
  const range = (
    axes: readonly { position: number }[],
    coordinate: "x" | "y" | "z",
    fallback: [number, number],
  ): [number, number] => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const axis of axes) {
      const value = axis.position / 1000;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    for (const node of model.nodes) {
      const value = node[coordinate];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min)) return fallback;
    const margin = Math.max(1, (max - min) * 0.12);
    return [min - margin, max + margin];
  };
  const [xMin, xMax] = range(grid.xAxes, "x", [-5, 5]);
  const [yMin, yMax] = range(grid.yAxes ?? [], "y", [-5, 5]);
  const [zMin, zMax] = range(grid.zAxes, "z", [0, 5]);
  const baseZ = grid.zAxes[0]?.position !== undefined ? grid.zAxes[0].position / 1000 : zMin;
  return { xMin, xMax, yMin, yMax, zMin, zMax, baseZ };
}

function structuralGridLayoutKey(model: Frame3DModel, grid: StructuralGrid): string {
  const layout = structuralGridLayout(model, grid);
  return [layout.xMin, layout.xMax, layout.yMin, layout.yMax, layout.zMin, layout.zMax, layout.baseZ].join("|");
}

function addStructuralGrid(group: THREE.Group, model: Frame3DModel, grid: StructuralGrid) {
  if (!grid.enabled) return;
  const { xMin, xMax, yMin, yMax, zMin, zMax, baseZ } = structuralGridLayout(model, grid);
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
  const box = frame3DNodeBounds(model);
  const modelSize = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
  const maxDisplacement = frame3DMaximumDisplacementM(model, result);
  return maxDisplacement > 1e-15 ? Math.min(10_000, modelSize * 0.12 / maxDisplacement) : 1;
}

export default function ThreeFrameCanvas({ model, conditionModel, onChange, onDrawError, tool, selection, onSelect, onOpenCheckForBeam, fitToken, visibility, viewRequest, currentView = "iso", structuralGrid, gridSpacingM = 0.5, result, utilizations = [], activeLoadCaseId, cameraRequest, onCameraChange, onCameraViewChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneState | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const pendingAppendRef = useRef<{
    baseModel: Frame3DModel;
    model: Frame3DModel;
    node?: Frame3DModel["nodes"][number];
    beam?: Frame3DModel["beams"][number];
    plate?: NonNullable<Frame3DModel["plates"]>[number];
    replacedPlateId?: number;
  } | null>(null);
  const modelRef = useRef(model);
  const nodeByIdRef = useRef<Map<number, Frame3DModel["nodes"][number]> | null>(null);
  const nodePositionIndexRef = useRef<Map<string, number[]> | null>(null);
  const nodeSnapScreenIndexRef = useRef<Frame3DNodeSnapScreenIndex | null>(null);
  const nodeSnapScreenIndexDirtyRef = useRef(true);
  const nodeSnapPrewarmRef = useRef<(() => void) | null>(null);
  const nodeSnapPrewarmFrameRef = useRef(0);
  const beamByIdRef = useRef<Map<number, Frame3DModel["beams"][number]> | null>(null);
  const beamConnectionIndexRef = useRef<Set<string> | null>(null);
  const plateByIdRef = useRef<Map<number, NonNullable<Frame3DModel["plates"]>[number]> | null>(null);
  const nextNodeIdRef = useRef(1);
  const nextBeamIdRef = useRef(1);
  if (nodeByIdRef.current === null) {
    nodeByIdRef.current = indexFrame3DNodes(model);
    nodePositionIndexRef.current = buildNodePositionIndex(model.nodes);
    nextNodeIdRef.current = nextNumericId(model.nodes);
  }
  nodePositionIndexRef.current ??= buildNodePositionIndex(model.nodes);
  if (beamByIdRef.current === null) {
    beamByIdRef.current = new Map(model.beams.map((beam) => [beam.id, beam]));
    beamConnectionIndexRef.current = buildBeamConnectionIndex(model.beams);
    nextBeamIdRef.current = nextNumericId(model.beams);
  }
  beamConnectionIndexRef.current ??= buildBeamConnectionIndex(model.beams);
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
        nodeByIdRef.current = indexFrame3DNodes(model);
        nodePositionIndexRef.current = buildNodePositionIndex(model.nodes);
        nodeSnapScreenIndexDirtyRef.current = true;
        nextNodeIdRef.current = nextNumericId(model.nodes);
      }
      if (modelRef.current.beams !== model.beams) {
        beamByIdRef.current = new Map(model.beams.map((beam) => [beam.id, beam]));
        beamConnectionIndexRef.current = buildBeamConnectionIndex(model.beams);
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
  const drawErrorRef = useRef(onDrawError);
  drawErrorRef.current = onDrawError;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;
  const snaps = useSnapInstellingen();
  const snapsRef = useRef<SnapInstellingen>(snaps);
  snapsRef.current = snaps;
  const structuralGridRef = useRef(structuralGrid);
  structuralGridRef.current = structuralGrid;
  const structuralSnapAxesSourceRef = useRef<StructuralGrid | undefined>(undefined);
  const structuralSnapAxesRef = useRef({ x: [] as number[], y: [] as number[], z: [] as number[] });
  if (structuralSnapAxesSourceRef.current !== structuralGrid) {
    structuralSnapAxesSourceRef.current = structuralGrid;
    structuralSnapAxesRef.current = {
      x: sortedGridAxisValues(structuralGrid?.xAxes ?? []),
      y: sortedGridAxisValues(structuralGrid?.yAxes ?? []),
      z: sortedGridAxisValues(structuralGrid?.zAxes ?? []),
    };
  }
  const gridSpacingRef = useRef(gridSpacingM);
  gridSpacingRef.current = gridSpacingM;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectionRenderedWithModelRef = useRef<Frame3DSelection | undefined>(undefined);
  const nodePickTargetsRef = useRef<THREE.Object3D[]>([]);
  const selectionPickTargetsRef = useRef<THREE.Object3D[]>([]);
  const nonNodePickTargetsRef = useRef<THREE.Object3D[]>([]);
  const lastBuiltModelRef = useRef<Frame3DModel | null>(null);
  const lastBuiltConditionModelRef = useRef<Frame3DModel | undefined>(undefined);
  const lastBuiltStructuralGridLayoutRef = useRef<string | null>(null);
  const lastBuiltPresentationRef = useRef<{
    visibility: Frame3DVisibility;
    structuralGrid: StructuralGrid | undefined;
    result: Frame3DSolveResult | null | undefined;
    utilizations: Frame3DUtilization[];
    activeLoadCaseId: number | undefined;
  } | null>(null);
  const lastBuiltNodeBoundsRef = useRef<THREE.Box3 | null>(null);
  const visualNodeRadiusRef = useRef(0.035);
  const plateDraftRef = useRef<PlateSketch>(emptyPlateSketch());
  const openingDraftRef = useRef<PlateSketch>(emptyPlateSketch());
  const plateDraftCreatedNodesRef = useRef<Set<number>>(new Set());
  const openingDraftCreatedNodesRef = useRef<Set<number>>(new Set());
  const plateHistoryGroupRef = useRef<string | null>(null);
  const openingHistoryGroupRef = useRef<string | null>(null);
  const beamStartRef = useRef<number | null>(null);
  const openingPlateRef = useRef<number | null>(null);
  useEffect(() => {
    // Ongedaan maken kan plaatsvinden terwijl een contour nog open is.
    // Verwijder dan ook de lokale schets, zodat de volgende klik niet naar
    // inmiddels verdwenen knoopnummers verwijst.
    const existing = new Set(model.nodes.map((node) => node.id));
    const resetMissingSketch = (
      sketchRef: { current: PlateSketch },
      createdRef: { current: Set<number> },
      groupRef: { current: string | null },
    ) => {
      if (sketchRef.current.nodeIds.every((id) => existing.has(id))) return;
      sketchRef.current = emptyPlateSketch();
      createdRef.current.clear();
      groupRef.current = null;
      if (sceneRef.current) sceneRef.current.draftLine.visible = false;
    };
    resetMissingSketch(plateDraftRef, plateDraftCreatedNodesRef, plateHistoryGroupRef);
    resetMissingSketch(openingDraftRef, openingDraftCreatedNodesRef, openingHistoryGroupRef);
  }, [model.nodes]);
  const cameraChangeRef = useRef(onCameraChange);
  cameraChangeRef.current = onCameraChange;
  const cameraViewChangeRef = useRef(onCameraViewChange);
  cameraViewChangeRef.current = onCameraViewChange;
  const rememberBuiltPresentation = () => {
    lastBuiltConditionModelRef.current = conditionModel;
    lastBuiltPresentationRef.current = {
      visibility, structuralGrid, result, utilizations, activeLoadCaseId,
    };
  };
  const discardDraftNodes = (createdNodeIds: Set<number>, historyGroupRef: { current: string | null }) => {
    const historyGroup = historyGroupRef.current;
    historyGroupRef.current = null;
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
    changeRef.current(next, { historyGroup: historyGroup ?? undefined, cancelHistoryGroup: true });
    selectRef.current(null);
  };
  const previousToolRef = useRef(tool);
  useEffect(() => {
    const previousTool = previousToolRef.current;
    const plateTools: Frame3DTool[] = ["addPlate", "addPlateArc"];
    const openingTools: Frame3DTool[] = ["addOpening", "addOpeningArc"];
    if (!(plateTools.includes(previousTool) && plateTools.includes(tool))) {
      discardDraftNodes(plateDraftCreatedNodesRef.current, plateHistoryGroupRef);
      plateDraftRef.current = emptyPlateSketch();
    }
    if (!(openingTools.includes(previousTool) && openingTools.includes(tool))) {
      discardDraftNodes(openingDraftCreatedNodesRef.current, openingHistoryGroupRef);
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
      if (!(plateTools.includes(tool) || openingTools.includes(tool))) state.draftLine.visible = false;
      state.previewHint.hidden = true;
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
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
    controls.zoomToCursor = true;
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
    // Compileer het transparante dubbelzijdige plaatmateriaal terwijl de
    // viewer opent. Zonder deze opwarming blokkeerde het sluiten van de eerste
    // plaat tientallen milliseconden op shadercompilatie, terwijl de eigenlijke
    // extrusie maar enkele milliseconden kost.
    const plateWarmupStartedAt = performance.now();
    const plateWarmupGeometry = new THREE.PlaneGeometry(1, 1);
    const plateWarmupMaterial = createPlateMaterial();
    const plateWarmupMesh = new THREE.Mesh(plateWarmupGeometry, plateWarmupMaterial);
    plateWarmupMesh.frustumCulled = false;
    scene.add(plateWarmupMesh);
    renderer.compile(scene, camera);
    scene.remove(plateWarmupMesh);
    container.dataset.frame3dPlateShaderWarmupMs = (performance.now() - plateWarmupStartedAt).toFixed(2);
    const geometry = new THREE.Group();
    scene.add(geometry);
    const draftGeometry = new THREE.BufferGeometry();
    draftGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(512 * 3), 3));
    draftGeometry.setDrawRange(0, 0);
    const draftLine = new THREE.LineSegments(
      draftGeometry,
      new THREE.LineBasicMaterial({ color: 0x0284c7, depthTest: false, transparent: true, opacity: 0.9 }),
    );
    draftLine.renderOrder = 100;
    draftLine.visible = false;
    scene.add(draftLine);
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
    const selectionBox = document.createElement("div");
    selectionBox.className = "frame3d-selection-box";
    selectionBox.hidden = true;
    container.appendChild(selectionBox);
    scene.add(preview);
    sceneRef.current = { scene, camera, renderer, labelRenderer, controls, geometry, draftLine, preview, previewHint, grid, axes, axisLabels };

    // Damping staat uit, dus continu renderen levert alleen CPU/GPU-belasting op.
    // Teken uitsluitend na camera-, formaat- of modelwijzigingen. Dat houdt ook
    // meerdere geopende 3D-vensters responsief.
    let cameraRenderFrame = 0;
    const renderScene = () => {
      if (cameraRenderFrame) {
        cancelAnimationFrame(cameraRenderFrame);
        cameraRenderFrame = 0;
      }
      const renderStartedAt = performance.now();
      renderer.render(scene, camera);
      renderFrame3DLabels(sceneRef.current!, container);
      writeCameraDiagnostics(container, sceneRef.current!);
      container.dataset.frame3dCameraRenderMs = (performance.now() - renderStartedAt).toFixed(2);
    };
    const renderCameraInteraction = () => {
      // Pointer-events kunnen sneller binnenkomen dan het beeldscherm tekent.
      // Bundel ze tot hoogstens één WebGL-render per animatieframe. De
      // CSS-labels blijven tijdens slepen verborgen: hun DOM-layout was bij
      // grote stramienen duurder dan het hele 3D-beeld en is pas bij de
      // uiteindelijke camerastand weer nodig.
      if (cameraRenderFrame) return;
      cameraRenderFrame = requestAnimationFrame(() => {
        cameraRenderFrame = 0;
        const renderStartedAt = performance.now();
        renderer.render(scene, camera);
        writeCameraDiagnostics(container, sceneRef.current!);
        container.dataset.frame3dCameraRenderMs = (performance.now() - renderStartedAt).toFixed(2);
      });
    };
    const saveCamera = () => {
      cameraChangeRef.current?.({
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        up: camera.up.toArray() as [number, number, number],
      });
    };
    const startCameraInteraction = () => {
      nodeSnapScreenIndexDirtyRef.current = true;
      labelRenderer.domElement.style.visibility = "hidden";
      container.dataset.frame3dLabelsSuspended = "true";
    };
    const endCameraInteraction = () => {
      renderScene();
      labelRenderer.domElement.style.visibility = "visible";
      container.dataset.frame3dLabelsSuspended = "false";
      saveCamera();
      cameraViewChangeRef.current?.(frame3DViewFromCamera(camera.position, controls.target));
      nodeSnapPrewarmRef.current?.();
    };
    controls.addEventListener("start", startCameraInteraction);
    controls.addEventListener("change", renderCameraInteraction);
    // Camera-instellingen gaan pas na de interactie naar React. Tijdens
    // pannen/roteren hoeft daardoor geen componentstate per muispixel mee.
    controls.addEventListener("end", endCameraInteraction);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      labelRenderer.setSize(width, height);
      nodeSnapScreenIndexDirtyRef.current = true;
      renderScene();
      nodeSnapPrewarmRef.current?.();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const setPointer = (event: { clientX: number; clientY: number }) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
                  -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      // Three.js gebruikt anders een vaste wereldafstand van 1 m voor lijnen.
      // Dat selecteert op een uitgezoomd raamwerk een last ver naast de cursor
      // en kan een naburige staaf overstemmen. Houd circa vijf schermpixels aan.
      const worldPerPixel = 2 * camera.position.distanceTo(controls.target)
        * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(rect.height, 1);
      raycaster.params.Line.threshold = Math.max(0.02, worldPerPixel * 5);
    };
    const onWheelAnchor = (event: WheelEvent) => {
      if (!controls.enabled || !controls.enableZoom || event.deltaY === 0) return;
      // OrbitControls zoomToCursor uses the plane through controls.target.
      // On a long frame that plane can be hundreds of metres behind the
      // member under the pointer, so a fast zoom throws that member offscreen.
      event.preventDefault();
      event.stopImmediatePropagation();
      const startedAt = performance.now();
      setPointer(event);
      const visibleTargets = [...nodePickTargetsRef.current, ...nonNodePickTargetsRef.current]
        .filter((target) => target.userData.pickable !== false);
      const hit = raycaster.intersectObjects(visibleTargets, false)[0];
      const anchor = hit?.point.clone() ?? new THREE.Vector3();
      let anchorSource = hit ? "geometry" : "bounds";
      if (!hit) {
        const bounds = frame3DNodeBounds(modelRef.current);
        if (bounds.isEmpty() || !raycaster.ray.intersectBox(bounds, anchor)) {
          anchorSource = "camera";
          const viewNormal = camera.getWorldDirection(new THREE.Vector3());
          raycaster.ray.intersectPlane(
            new THREE.Plane().setFromNormalAndCoplanarPoint(viewNormal, controls.target), anchor,
          );
        }
      }
      const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * modeScale * (event.ctrlKey ? 10 : 1);
      const step = Math.pow(0.95, controls.zoomSpeed * Math.abs(delta * 0.01));
      const distance = camera.position.distanceTo(controls.target);
      const nextDistance = THREE.MathUtils.clamp(
        distance * (delta < 0 ? step : 1 / step),
        Math.max(controls.minDistance, 0.1), controls.maxDistance,
      );
      const scale = nextDistance / distance;
      startCameraInteraction();
      camera.position.sub(anchor).multiplyScalar(scale).add(anchor);
      controls.target.sub(anchor).multiplyScalar(scale).add(anchor);
      controls.update();
      endCameraInteraction();
      container.dataset.frame3dWheelAnchor = anchorSource;
      container.dataset.frame3dWheelMs = (performance.now() - startedAt).toFixed(2);
    };
    renderer.domElement.addEventListener("wheel", onWheelAnchor, { capture: true, passive: false });
    const drawingAnchor = () => {
      const sketch = isOpeningTool(toolRef.current) ? openingDraftRef.current : plateDraftRef.current;
      const nodeId = toolRef.current === "addBeam" ? beamStartRef.current : sketch.firstNodeId;
      return nodeId === null ? undefined : nodeByIdRef.current!.get(nodeId);
    };
    const drawingPlane = () => {
      const anchor = drawingAnchor();
      // De echte camerastand bepaalt het tekenvlak. Een opgeslagen vooraanzicht
      // kan immers later schuin zijn gedraaid; de oude aanzichtsnaam mag dan
      // geen onzichtbaar verticaal werkvlak blijven afdwingen.
      const view = frame3DViewFromCamera(camera.position, controls.target);
      // Boven gebruikt XY, voor gebruikt XZ en zij gebruikt YZ. In een vrij
      // 3D-aanzicht tekenen we bewust in het horizontale XY-werkvlak. Dit is
      // stabieler en voorspelbaarder dan een vlak dat met de camera meedraait.
      let normal = view === "front" ? new THREE.Vector3(0, 1, 0)
        : view === "side" ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1);
      let plateOrigin: THREE.Vector3 | undefined;
      const openingPlateId = isOpeningTool(toolRef.current)
        ? openingPlateRef.current ?? (selectionRef.current?.type === "plate" ? selectionRef.current.id : null)
        : null;
      if (openingPlateId !== null) {
        // De ribbon kan het gereedschap al activeren voordat het effect de
        // geselecteerde plaat vastlegt. Gebruik die selectie meteen, zodat de
        // eerste openingsknoop nooit op de camerahoogte terechtkomt.
        openingPlateRef.current = openingPlateId;
        const plate = plateByIdRef.current!.get(openingPlateId);
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
      container.dataset.frame3dDrawingPlaneSource = anchor ? "anchor" : plateOrigin ? "plate" : "camera";
      container.dataset.frame3dDrawingPlaneZ = origin.z.toFixed(6);
      container.dataset.frame3dDrawingPlaneNormal = `${normal.x.toFixed(4)},${normal.y.toFixed(4)},${normal.z.toFixed(4)}`;
      return { anchor, view, origin, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin) };
    };
    type DrawingSnap = { position: THREE.Vector3; nodeId?: number; kind?: SnapSoort };
    const ensureNodeSnapScreenIndex = () => {
      const width = Math.max(1, renderer.domElement.clientWidth);
      const height = Math.max(1, renderer.domElement.clientHeight);
      const current = nodeSnapScreenIndexRef.current;
      if (nodeSnapScreenIndexDirtyRef.current || !current || current.width !== width || current.height !== height
        || current.nodeCount !== modelRef.current.nodes.length) {
        camera.updateMatrixWorld();
        nodeSnapScreenIndexRef.current = buildFrame3DNodeSnapScreenIndex(
          modelRef.current.nodes, camera, width, height,
        );
        nodeSnapScreenIndexDirtyRef.current = false;
        container.dataset.frame3dNodeSnapIndexed = String(modelRef.current.nodes.length);
        container.dataset.frame3dNodeSnapBuckets = String(nodeSnapScreenIndexRef.current.buckets.size);
      }
      return nodeSnapScreenIndexRef.current!;
    };
    nodeSnapPrewarmRef.current = () => {
      if (nodeSnapPrewarmFrameRef.current) cancelAnimationFrame(nodeSnapPrewarmFrameRef.current);
      nodeSnapPrewarmFrameRef.current = requestAnimationFrame(() => {
        nodeSnapPrewarmFrameRef.current = 0;
        ensureNodeSnapScreenIndex();
      });
    };
    const drawingSnap = (): DrawingSnap | null => {
      const snapStartedAt = performance.now();
      const finish = (value: DrawingSnap | null) => {
        container.dataset.frame3dSnapMs = (performance.now() - snapStartedAt).toFixed(2);
        return value;
      };
      delete container.dataset.frame3dSnapCandidates;
      const settings = snapsRef.current;
      const openingPlane = isOpeningTool(toolRef.current) ? drawingPlane() : null;
      if (settings.knoop) {
        const index = ensureNodeSnapScreenIndex();
        const xPx = (pointer.x + 1) * index.width / 2;
        const yPx = (1 - pointer.y) * index.height / 2;
        // Het stuurpunt van een nog te voltooien boog is geen geldig
        // eindpunt. Anders blijft een klik vlak ernaast zonder zichtbaar
        // resultaat op hetzelfde stuurpunt snappen.
        const draft = isOpeningTool(toolRef.current) ? openingDraftRef.current : plateDraftRef.current;
        const excludedNodeId = isArcBoundaryTool(toolRef.current)
          ? draft.arcControlNodeId ?? undefined : undefined;
        // Een knoop op een ander niveau kan in bovenaanzicht precies boven de
        // opening liggen. Zo'n snap zou de opening niet-coplanair maken.
        const acceptsOpeningNode = openingPlane ? (id: number) => {
          const node = nodeByIdRef.current!.get(id);
          const plane = openingPlane.plane;
          return !!node && Math.abs(plane.normal.x * node.x + plane.normal.y * node.y
            + plane.normal.z * node.z + plane.constant) <= 1e-5;
        } : undefined;
        const nodeHit = findFrame3DNodeScreenSnap(index, xPx, yPx, 14, excludedNodeId, acceptsOpeningNode);
        container.dataset.frame3dNodeSnapCandidates = String(nodeHit?.candidateCount ?? 0);
        if (nodeHit) {
          const node = nodeByIdRef.current!.get(nodeHit.point.id);
          if (node) return finish({ position: new THREE.Vector3(node.x, node.y, node.z), nodeId: node.id, kind: "knoop" });
        }
      }
      const { view, origin, plane } = openingPlane ?? drawingPlane();
      const position = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, position)) return finish(null);
      const raw = position.clone();
      const onOpeningPlane = (candidate: THREE.Vector3) => {
        if (!openingPlane) return candidate;
        // Raster- en stramiensnap wijzigen coördinaten na de ray-plane
        // doorsnijding. Bij een schuine plaat zou de openingsrand daardoor
        // uit het plaatvlak springen. Los de diepte-as opnieuw op.
        const normal = plane.normal;
        const dependentAxis = view === "front" ? "y" : view === "side" ? "x" : "z";
        const axis = Math.abs(normal[dependentAxis]) > 1e-8 ? dependentAxis
          : (["x", "y", "z"] as const).reduce((best, current) =>
              Math.abs(normal[current]) > Math.abs(normal[best]) ? current : best);
        candidate[axis] -= plane.distanceToPoint(candidate) / normal[axis];
        return candidate;
      };
      if (settings.stramien && structuralGridRef.current?.enabled) {
        const structuralAxes = structuralSnapAxesRef.current;
        const candidates: Array<{
          point: THREE.Vector3;
          axes: readonly ("x" | "y" | "z")[];
        }> = [];
        const rect = renderer.domElement.getBoundingClientRect();
        const pixelDistance = (candidate: THREE.Vector3) => {
          const projected = candidate.clone().project(camera);
          return Math.hypot((projected.x - pointer.x) * rect.width / 2, (projected.y - pointer.y) * rect.height / 2);
        };
        // Alleen de drie assen die in modelruimte het dichtst bij de aanwijzer
        // liggen kunnen binnen de 14 px snapzone winnen. Zo blijft een zeer
        // groot stramien per beeldframe op maximaal vijftien projecties.
        const addSingleAxes = (key: "x" | "y" | "z", values: readonly number[]) => {
          const nearest = nearestGridAxisValues(values, raw[key]);
          nearest.forEach((value) => {
            const candidate = raw.clone();
            candidate[key] = value;
            candidates.push({ point: candidate, axes: [key] });
          });
          return nearest;
        };
        if (view === "front") {
          const nearX = addSingleAxes("x", structuralAxes.x), nearZ = addSingleAxes("z", structuralAxes.z);
          nearX.forEach((x) => nearZ.forEach((z) =>
              candidates.push({ point: new THREE.Vector3(x, origin.y, z), axes: ["x", "z"] })));
        } else if (view === "side") {
          const nearY = addSingleAxes("y", structuralAxes.y), nearZ = addSingleAxes("z", structuralAxes.z);
          nearY.forEach((y) => nearZ.forEach((z) =>
              candidates.push({ point: new THREE.Vector3(origin.x, y, z), axes: ["y", "z"] })));
        } else {
          const nearX = addSingleAxes("x", structuralAxes.x), nearY = addSingleAxes("y", structuralAxes.y);
          nearX.forEach((x) => nearY.forEach((y) =>
              candidates.push({ point: new THREE.Vector3(x, y, origin.z), axes: ["x", "y"] })));
        }
        container.dataset.frame3dSnapCandidates = String(candidates.length);
        const nearest = candidates.reduce<{ point: THREE.Vector3; axes: readonly ("x" | "y" | "z")[]; distance: number } | null>((best, candidate) => {
          const distance = pixelDistance(candidate.point);
          return !best || distance < best.distance ? { ...candidate, distance } : best;
        }, null);
        if (nearest && nearest.distance <= 14) {
          // Een stramienas wint per richting van het raster. De andere
          // richting blijft wél raster-snap volgen, zoals in het 2D-tekenvlak.
          // Zonder deze stap leverde een klik op X=9,25 m bijvoorbeeld
          // Z=2,8509 m op terwijl raster-snap nog aan stond.
          if (settings.raster) {
            const spacing = Math.max(0.001, gridSpacingRef.current);
            const round = (value: number) => Math.round(value / spacing) * spacing;
            const activeAxes = view === "front" ? ["x", "z"] as const
              : view === "side" ? ["y", "z"] as const
              : ["x", "y"] as const;
            activeAxes.forEach((axis) => {
              if (!nearest.axes.includes(axis)) nearest.point[axis] = round(raw[axis]);
            });
          }
          return finish({ position: onOpeningPlane(nearest.point), kind: "stramien" });
        }
      }
      if (settings.raster) {
        const spacing = Math.max(0.001, gridSpacingRef.current);
        const round = (value: number) => Math.round(value / spacing) * spacing;
        if (view === "front") position.set(round(raw.x), origin.y, round(raw.z));
        else if (view === "side") position.set(origin.x, round(raw.y), round(raw.z));
        else position.set(round(raw.x), round(raw.y), origin.z);
        return finish({ position: onOpeningPlane(position), kind: "raster" });
      }
      return finish({ position: raw });
    };
    const drawDraftContour = (sketch: PlateSketch | null, opening = false) => {
      const vertices: THREE.Vector3[] = [];
      const pushSegment = (start: THREE.Vector3, end: THREE.Vector3) => {
        vertices.push(start, end);
      };
      if (sketch) {
        for (const segment of sketch.segments) {
          const startNode = nodeByIdRef.current!.get(segment.startNodeId);
          const endNode = nodeByIdRef.current!.get(segment.endNodeId);
          if (!startNode || !endNode) continue;
          const start = new THREE.Vector3(startNode.x, startNode.y, startNode.z);
          const end = new THREE.Vector3(endNode.x, endNode.y, endNode.z);
          if (segment.kind === "arc") {
            const controlNode = nodeByIdRef.current!.get(segment.controlNodeId);
            if (!controlNode) continue;
            const points = sampleCircularArc3D(start, controlNode, end)?.map((value) =>
              new THREE.Vector3(value.x, value.y, value.z)) ?? [start, end];
            for (let index = 0; index < points.length - 1; index += 1) {
              pushSegment(points[index], points[index + 1]);
            }
          } else {
            pushSegment(start, end);
          }
        }
        if (sketch.arcControlNodeId !== null && sketch.lastNodeId !== null) {
          const startNode = nodeByIdRef.current!.get(sketch.lastNodeId);
          const controlNode = nodeByIdRef.current!.get(sketch.arcControlNodeId);
          if (startNode && controlNode) {
            pushSegment(
              new THREE.Vector3(startNode.x, startNode.y, startNode.z),
              new THREE.Vector3(controlNode.x, controlNode.y, controlNode.z),
            );
          }
        }
      }
      let attribute = draftGeometry.getAttribute("position") as THREE.BufferAttribute;
      if (attribute.count < vertices.length) {
        const capacity = 2 ** Math.ceil(Math.log2(Math.max(512, vertices.length)));
        attribute = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
        draftGeometry.setAttribute("position", attribute);
      }
      vertices.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
      if (vertices.length > 0) attribute.needsUpdate = true;
      draftGeometry.setDrawRange(0, vertices.length);
      (draftLine.material as THREE.LineBasicMaterial).color.setHex(opening ? 0x7c3aed : 0x0284c7);
      draftLine.visible = vertices.length > 0;
      container.dataset.frame3dDraftSegments = String(sketch?.segments.length ?? 0);
      container.dataset.frame3dDraftVertices = String(vertices.length);
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
          const arc = control ? sampleCircularArc3D(start, control, target.position) : null;
          points = arc?.map((value) => new THREE.Vector3(value.x, value.y, value.z))
            ?? [start, target.position];
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
    let down: { x: number; y: number; additive: boolean } | null = null;
    const drawSelectionBox = (x: number, y: number) => {
      if (!down) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const x1 = THREE.MathUtils.clamp(down.x - rect.left, 0, rect.width);
      const y1 = THREE.MathUtils.clamp(down.y - rect.top, 0, rect.height);
      const x2 = THREE.MathUtils.clamp(x - rect.left, 0, rect.width);
      const y2 = THREE.MathUtils.clamp(y - rect.top, 0, rect.height);
      selectionBox.style.left = `${Math.min(x1, x2)}px`;
      selectionBox.style.top = `${Math.min(y1, y2)}px`;
      selectionBox.style.width = `${Math.abs(x2 - x1)}px`;
      selectionBox.style.height = `${Math.abs(y2 - y1)}px`;
      selectionBox.hidden = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (down && toolRef.current === "select"
        && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
        drawSelectionBox(event.clientX, event.clientY);
        return;
      }
      latestPointerEvent = event;
      if (!previewFrame) previewFrame = requestAnimationFrame(drawPointerPreview);
    };
    const onPointerLeave = () => {
      latestPointerEvent = null;
      hidePreview(preview);
      previewHint.hidden = true;
      renderScene();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        down = null;
        return;
      }
      down = { x: event.clientX, y: event.clientY,
        additive: event.shiftKey || event.ctrlKey || event.metaKey };
      if (toolRef.current === "select") renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerCancel = () => {
      down = null;
      selectionBox.hidden = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) {
        down = null;
        selectionBox.hidden = true;
        return;
      }
      if (down && toolRef.current === "select"
        && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
        const rect = renderer.domElement.getBoundingClientRect();
        const box = {
          left: Math.min(down.x, event.clientX) - rect.left,
          right: Math.max(down.x, event.clientX) - rect.left,
          top: Math.min(down.y, event.clientY) - rect.top,
          bottom: Math.max(down.y, event.clientY) - rect.top,
        };
        const startedAt = performance.now();
        selectRef.current(selectFrame3DInScreenBox(
          modelRef.current, selectionPickTargetsRef.current, camera,
          rect.width, rect.height, box, selectionRef.current, down.additive,
          visibilityRef.current.nodes,
        ));
        container.dataset.frame3dBoxSelectMs = (performance.now() - startedAt).toFixed(2);
        selectionBox.hidden = true;
        down = null;
        renderScene();
        return;
      }
      selectionBox.hidden = true;
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) {
        down = null;
        return;
      }
      setPointer(event);
      // Raycast alleen tegen objecten die werkelijk selecteerbaar zijn. Labels,
      // rasters en resultaatlijnen hoeven bij grote modellen niet bij iedere
      // klik opnieuw doorzocht te worden.
      const pickStartedAt = performance.now();
      const intersections = raycaster.intersectObjects(nonNodePickTargetsRef.current, false);
      // Lastpijlen eindigen bewust op de constructie en liggen daardoor vaak
      // exact voor een staaf of knoop. Wanneer dezelfde klik beide raakt,
      // krijgt het zichtbare lastteken voorrang; anders was een belasting op
      // drukke 3D-modellen praktisch niet via het canvas te selecteren.
      const loadIntersection = intersections.find((candidate) =>
        LOAD_SELECTION_TYPES.has(candidate.object.userData.type as Frame3DSelectionType));
      const nodeIndex = ensureNodeSnapScreenIndex();
      const nodeHit = nodePickTargetsRef.current.some((target) => target.userData.pickable !== false)
        ? findFrame3DNodeScreenSnap(
            nodeIndex,
            (pointer.x + 1) * nodeIndex.width / 2,
            (1 - pointer.y) * nodeIndex.height / 2,
          )
        : null;
      const beamScreenStartedAt = performance.now();
      const beamScreenHit = toolRef.current !== "addBeam" && !loadIntersection && !nodeHit && intersections.length === 0
        && visibilityRef.current.beams && !visibilityRef.current.profiles
        ? findFrame3DBeamNearScreenPoint(
            modelRef.current.beams, nodeByIdRef.current!,
            camera, nodeIndex.width, nodeIndex.height,
            (pointer.x + 1) * nodeIndex.width / 2,
            (1 - pointer.y) * nodeIndex.height / 2,
          )
        : null;
      // Een last wint altijd. Binnen de knoopsnapzone wint daarna de knoop,
      // zodat het staafeinde net zo direct selecteerbaar is als in 2D.
      const intersection = loadIntersection ?? (nodeHit ? undefined : intersections[0]);
      let hit: THREE.Object3D | undefined = intersection?.object;
      while (hit && hit !== geometry && typeof hit.userData.type !== "string") hit = hit.parent ?? undefined;
      const type = nodeHit && !loadIntersection ? "node" : beamScreenHit ? "beam" : hit?.userData.type;
      const instanceIds = hit?.userData.instanceIds as number[] | undefined;
      const id = nodeHit && !loadIntersection ? nodeHit.point.id
        : beamScreenHit ? beamScreenHit.beamId
        : instanceIds && intersection?.instanceId !== undefined
        ? instanceIds[intersection.instanceId]
        : hit?.userData.id;
      container.dataset.frame3dPickMs = (performance.now() - pickStartedAt).toFixed(2);
      container.dataset.frame3dPickType = String(type ?? "none");
      container.dataset.frame3dPickId = String(id ?? "none");
      container.dataset.frame3dPickNodeCandidates = String(nodeHit?.candidateCount ?? 0);
      container.dataset.frame3dPickBeamScreen = beamScreenHit
        ? `${beamScreenHit.beamId}@${beamScreenHit.distancePx.toFixed(1)}px` : "none";
      container.dataset.frame3dPickBeamScreenMs = (performance.now() - beamScreenStartedAt).toFixed(2);
      const activeTool = toolRef.current;
      let current = modelRef.current;
      const commitModel = (next: Frame3DModel, appended?: {
        node?: Frame3DModel["nodes"][number];
        beam?: Frame3DModel["beams"][number];
        plate?: NonNullable<Frame3DModel["plates"]>[number];
        replacedPlateId?: number;
      }) => {
        const priorAppend = pendingAppendRef.current?.model === current
          ? pendingAppendRef.current
          : null;
        const appendedNode = appended?.node ?? priorAppend?.node;
        const appendedBeam = appended?.beam ?? priorAppend?.beam;
        const appendedPlate = appended?.plate ?? priorAppend?.plate;
        const replacedPlateId = appended?.replacedPlateId ?? priorAppend?.replacedPlateId;
        pendingAppendRef.current = appendedNode || appendedBeam || appendedPlate
          ? {
              baseModel: priorAppend?.baseModel ?? current,
              model: next,
              node: appendedNode,
              beam: appendedBeam,
              plate: appendedPlate,
              replacedPlateId,
            }
          : null;
        if (current.nodes !== next.nodes) {
          nodeSnapScreenIndexDirtyRef.current = true;
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
            beamConnectionIndexRef.current!.add(beamConnectionKey(appendedBeam.startNodeId, appendedBeam.endNodeId));
            nextBeamIdRef.current = Math.max(nextBeamIdRef.current, appendedBeam.id + 1);
          } else {
            beamByIdRef.current = new Map(next.beams.map((beam) => [beam.id, beam]));
            beamConnectionIndexRef.current = buildBeamConnectionIndex(next.beams);
            nextBeamIdRef.current = nextNumericId(next.beams);
          }
        }
        if (current.plates !== next.plates) {
          plateByIdRef.current = new Map((next.plates ?? []).map((plate) => [plate.id, plate]));
        }
        modelRef.current = next;
        current = next;
        const historyGroupRef = activeTool === "addPlate" || activeTool === "addPlateArc"
          ? plateHistoryGroupRef
          : isOpeningTool(activeTool) ? openingHistoryGroupRef : null;
        if (historyGroupRef && historyGroupRef.current === null) {
          historyGroupRef.current = nextContourHistoryGroup();
        }
        changeRef.current(next, historyGroupRef?.current
          ? { historyGroup: historyGroupRef.current } : undefined);
      };
      const ensureDrawingNode = (): number | null => {
        const snapped = drawingSnap();
        // De zichtbare knoopsnapzone wint van een staafhit op hetzelfde
        // schermpunt. Een profielraycast op het staafeinde kan anders een
        // bestaande knoop onbedoeld vervangen door een splitsing vlak ernaast.
        if (snapped?.nodeId !== undefined) return snapped.nodeId;
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
        if (!snapped) return null;
        const position = snapped.position.set(
          cleanDrawingCoordinate(snapped.position.x),
          cleanDrawingCoordinate(snapped.position.y),
          cleanDrawingCoordinate(snapped.position.z),
        );
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
            const connectionKey = beamConnectionKey(start, nodeId);
            if (!beamConnectionIndexRef.current!.has(connectionKey)) {
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
                const addedPlate = next.plates?.[next.plates.length - 1];
                commitModel(next, { plate: addedPlate });
                committed = true;
                drawErrorRef.current?.(null);
                if (addedPlate) selectRef.current({ type: "plate", id: addedPlate.id });
              } catch (error) {
                drawErrorRef.current?.(error instanceof Error ? error.message : String(error));
              } finally {
                plateDraftRef.current = emptyPlateSketch();
                if (committed) {
                  plateDraftCreatedNodesRef.current.clear();
                  plateHistoryGroupRef.current = null;
                } else discardDraftNodes(plateDraftCreatedNodesRef.current, plateHistoryGroupRef);
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
                const updatedPlate = next.plates?.find((plate) => plate.id === openingPlateId);
                commitModel(next, { plate: updatedPlate, replacedPlateId: openingPlateId });
                committed = true;
                drawErrorRef.current?.(null);
                selectRef.current({ type: "plate", id: openingPlateId });
              } catch (error) {
                drawErrorRef.current?.(error instanceof Error ? error.message : String(error));
              } finally {
                openingDraftRef.current = emptyPlateSketch();
                if (committed) {
                  openingDraftCreatedNodesRef.current.clear();
                  openingHistoryGroupRef.current = null;
                } else discardDraftNodes(openingDraftCreatedNodesRef.current, openingHistoryGroupRef);
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
      } else if (activeTool === "addMemberLoad") {
        if (type === "beam" && typeof id === "number") {
          selectRef.current({ type: "beam", id });
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
      drawDraftContour(
        isOpeningTool(activeTool)
          ? openingDraftRef.current
          : activeTool === "addPlate" || activeTool === "addPlateArc" ? plateDraftRef.current : null,
        isOpeningTool(activeTool),
      );
      hidePreview(preview);
      previewHint.hidden = true;
      renderScene();
      down = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      down = null;
      selectionBox.hidden = true;
      discardDraftNodes(plateDraftCreatedNodesRef.current, plateHistoryGroupRef);
      discardDraftNodes(openingDraftCreatedNodesRef.current, openingHistoryGroupRef);
      plateDraftRef.current = emptyPlateSketch();
      openingDraftRef.current = emptyPlateSketch();
      beamStartRef.current = null;
      drawDraftContour(null);
      hidePreview(preview);
      previewHint.hidden = true;
      selectRef.current(null);
      renderScene();
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      discardDraftNodes(plateDraftCreatedNodesRef.current, plateHistoryGroupRef);
      discardDraftNodes(openingDraftCreatedNodesRef.current, openingHistoryGroupRef);
      observer.disconnect();
      if (previewFrame) cancelAnimationFrame(previewFrame);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("wheel", onWheelAnchor, true);
      selectionBox.remove();
      window.removeEventListener("keydown", onKeyDown);
      controls.removeEventListener("start", startCameraInteraction);
      controls.removeEventListener("change", renderCameraInteraction);
      controls.removeEventListener("end", endCameraInteraction);
      if (cameraRenderFrame) cancelAnimationFrame(cameraRenderFrame);
      if (nodeSnapPrewarmFrameRef.current) cancelAnimationFrame(nodeSnapPrewarmFrameRef.current);
      nodeSnapPrewarmRef.current = null;
      controls.dispose();
      disposeGroup(geometry);
      disposeGroup(preview);
      draftGeometry.dispose();
      (draftLine.material as THREE.Material).dispose();
      const activeGrid = sceneRef.current?.grid ?? grid;
      activeGrid.geometry.dispose();
      (activeGrid.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      axisLabels.forEach((label) => label.element.remove());
      plateWarmupGeometry.dispose();
      plateWarmupMaterial.dispose();
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
    const layout = frame3DGridLayout(model.nodes, gridSpacingM);
    const previous = state.grid.userData.layout as ReturnType<typeof frame3DGridLayout> | undefined;
    if (previous && Object.keys(layout).every((key) =>
      previous[key as keyof typeof layout] === layout[key as keyof typeof layout])) return;
    const nextGrid = new THREE.GridHelper(layout.sizeM, layout.divisions, 0xb6c2cf, 0xe2e8f0);
    nextGrid.rotation.x = Math.PI / 2;
    nextGrid.position.set(layout.centerX, layout.centerY, 0);
    nextGrid.visible = state.grid.visible;
    nextGrid.userData.layout = layout;
    state.scene.remove(state.grid);
    state.grid.geometry.dispose();
    (state.grid.material as THREE.Material).dispose();
    state.grid = nextGrid;
    state.scene.add(nextGrid);
    if (containerRef.current) {
      containerRef.current.dataset.frame3dGridSizeM = String(layout.sizeM);
      containerRef.current.dataset.frame3dGridSpacingM = String(layout.visibleSpacingM);
      containerRef.current.dataset.frame3dGridDivisions = String(layout.divisions);
    }
    // Een modelwijziging rendert direct hierna in de scène-effect opnieuw.
    // Teken alleen apart wanneer uitsluitend de rasterafstand wijzigt.
    if (lastBuiltModelRef.current === model) state.renderer.render(state.scene, state.camera);
  }, [model.nodes, gridSpacingM]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const rebuildStartedAt = performance.now();
    const { geometry } = state;
    const previousModel = lastBuiltModelRef.current;
    const previousPresentation = lastBuiltPresentationRef.current;
    const visibilityChangedOnly = (...allowedKeys: (keyof Frame3DVisibility)[]) =>
      previousPresentation !== null
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).some((key) =>
        allowedKeys.includes(key) && visibility[key] !== previousPresentation.visibility[key])
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).every((key) =>
        allowedKeys.includes(key) || visibility[key] === previousPresentation.visibility[key]);
    // Oppervlaktebelastingen gebruiken de tijdens de volledige plaatopbouw
    // berekende driehoeksmesh en worden daarom niet los ververst.
    const noSurfaceLoadsInEitherModel =
      (conditionModel?.surfaceLoads?.length ?? model.surfaceLoads?.length ?? 0) === 0
      && (lastBuiltConditionModelRef.current?.surfaceLoads?.length
        ?? previousModel?.surfaceLoads?.length ?? 0) === 0;
    const conditionLayerHasNoSurfaceLoads = !visibility.loads || noSurfaceLoadsInEitherModel;
    const sceneGuidesOnly = previousModel === model
      && visibilityChangedOnly("grid", "axes")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    if (sceneGuidesOnly) {
      state.grid.visible = visibility.grid;
      state.axes.visible = visibility.axes;
      state.axisLabels.forEach((label) => { label.visible = visibility.axes; });
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "scene-guides");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
      }
      return;
    }
    const structuralGridVisibilityOnly = previousModel === model
      && visibilityChangedOnly("structuralGrid")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const existingStructuralGrid = structuralGridVisibilityOnly
      ? geometry.children.find((child) => child.userData.frame3dStructuralGrid === true)
      : undefined;
    if (structuralGridVisibilityOnly && existingStructuralGrid && structuralGrid?.enabled
      && structuralGridLayoutKey(model, structuralGrid) === lastBuiltStructuralGridLayoutRef.current) {
      existingStructuralGrid.visible = visibility.structuralGrid;
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "structural-grid-visibility");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
      }
      return;
    }
    const memberAxesVisibilityOnly = previousModel === model
      && visibilityChangedOnly("memberAxes")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const existingMemberAxes = memberAxesVisibilityOnly
      ? geometry.children.find((child) => child.userData.frame3dMemberAxes === true)
      : undefined;
    if (memberAxesVisibilityOnly && existingMemberAxes) {
      existingMemberAxes.visible = visibility.memberAxes;
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "member-axes-visibility");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
      }
      return;
    }
    const nodeLabelsChanged = previousPresentation !== null
      && (visibility.nodeNumbers !== previousPresentation.visibility.nodeNumbers
        || visibility.nodeCoordinates !== previousPresentation.visibility.nodeCoordinates);
    const beamLabelsChanged = previousPresentation !== null
      && visibility.beamNumbers !== previousPresentation.visibility.beamNumbers;
    const annotationLabelsOnly = previousModel === model
      && previousPresentation !== null
      && (nodeLabelsChanged || beamLabelsChanged)
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).every((key) =>
        key === "nodeNumbers" || key === "nodeCoordinates" || key === "beamNumbers"
          || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    if (annotationLabelsOnly) {
      const oldLabels = geometry.children.filter((child) => child instanceof CSS2DObject
        && (nodeLabelsChanged && child.element.classList.contains("frame3d-node-label")
          || beamLabelsChanged && child.element.classList.contains("frame3d-beam-number")));
      oldLabels.forEach((label) => geometry.remove(label));
      let addedLabels = 0;
      if (nodeLabelsChanged && (visibility.nodeNumbers || visibility.nodeCoordinates)) {
        const stride = model.nodes.length <= 200 ? 1 : Math.ceil(model.nodes.length / 24);
        model.nodes.forEach((node, index) => {
          if (index % stride !== 0) return;
          const parts = [
            visibility.nodeNumbers ? String(node.id) : "",
            visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
          ].filter(Boolean);
          geometry.add(makeLabel(parts.join(" · "), "frame3d-node-label",
            new THREE.Vector3(node.x, node.y, node.z), { type: "node", id: node.id }));
          addedLabels += 1;
        });
      }
      if (beamLabelsChanged && visibility.beamNumbers) {
        const stride = model.beams.length <= 200 ? 1 : Math.ceil(model.beams.length / 24);
        model.beams.forEach((beam, index) => {
          if (index % stride !== 0) return;
          const start = nodeByIdRef.current!.get(beam.startNodeId);
          const end = nodeByIdRef.current!.get(beam.endNodeId);
          if (!start || !end) return;
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          if (delta.lengthSq() <= 1e-16) return;
          const axes = memberAxes(delta, beam.rollAngleRad ?? 0);
          const midpoint = a.add(b).multiplyScalar(0.5).addScaledVector(axes.ey, 0.3);
          geometry.add(makeLabel(`(${beam.id})`, "frame3d-beam-number", midpoint));
          addedLabels += 1;
        });
      }
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        const oldCount = Number(containerRef.current.dataset.frame3dLabels ?? 0);
        containerRef.current.dataset.frame3dLabels = String(Math.max(0, oldCount - oldLabels.length + addedLabels));
        containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
        writeBuildMode(containerRef.current, nodeLabelsChanged && beamLabelsChanged ? "labels"
          : nodeLabelsChanged ? "node-labels" : "beam-labels");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
      }
      return;
    }
    const nodeVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.nodes !== previousPresentation.visibility.nodes
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).every((key) =>
        key === "nodes" || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const nodeVisual = nodeVisibilityOnly
      ? geometry.children.find((child) => child.userData.frame3dNodeVisual === true)
      : undefined;
    if (nodeVisibilityOnly && nodeVisual) {
      nodeVisual.visible = visibility.nodes;
      nodePickTargetsRef.current.forEach((target) => { target.userData.pickable = visibility.nodes; });
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "node-visibility");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
      }
      return;
    }
    const beamVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.beams !== previousPresentation.visibility.beams
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).every((key) =>
        key === "beams" || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const existingBeamMeshes = beamVisibilityOnly
      ? geometry.children.filter((child) => child.userData.type === "beam" && child instanceof THREE.Mesh)
      : [];
    if (beamVisibilityOnly && (!visibility.beams || model.beams.length === 0 || existingBeamMeshes.length > 0)) {
      for (const mesh of existingBeamMeshes) mesh.visible = visibility.beams;
      for (const child of geometry.children) {
        if (child instanceof CSS2DObject && child.element.classList.contains("frame3d-utilization-label")) {
          child.visible = visibility.beams;
        }
      }
      const beamSet = new Set(existingBeamMeshes);
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !beamSet.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !beamSet.has(target));
      if (visibility.beams) {
        selectionPickTargetsRef.current.push(...existingBeamMeshes);
        nonNodePickTargetsRef.current.push(...existingBeamMeshes);
      }
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "beam-visibility");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
        containerRef.current.dataset.frame3dNonNodeLoadPickTargets = String(
          nonNodePickTargetsRef.current.filter((target) => LOAD_SELECTION_TYPES.has(
            target.userData.type as Frame3DSelectionType)).length);
      }
      return;
    }
    // Een wissel tussen hartlijnen en profielvolumes verandert alleen de
    // staven. Laat platen, opleggingen, lasten en alle andere GPU-buffers staan;
    // een volledige scène-opbouw uploadde die anders telkens opnieuw.
    const profileVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.profiles !== previousPresentation.visibility.profiles
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).every((key) =>
        key === "profiles" || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === null && previousPresentation.result === null
      && utilizations.length === 0 && previousPresentation.utilizations.length === 0
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current
      && visibility.beams && model.beams.length < 100 && model.nodes.length < 250;
    const oldProfileBeamMeshes = profileVisibilityOnly
      ? geometry.children.filter((child) => child.userData.type === "beam" && child instanceof THREE.Mesh)
      : [];
    if (profileVisibilityOnly && oldProfileBeamMeshes.length === model.beams.length) {
      const oldBeamSet = new Set(oldProfileBeamMeshes);
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !oldBeamSet.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !oldBeamSet.has(target));
      for (const mesh of oldProfileBeamMeshes) {
        geometry.remove(mesh);
        disposeObject3D(mesh);
      }
      for (const label of geometry.children.filter((child) => child instanceof CSS2DObject
        && child.element.classList.contains("frame3d-profile-label"))) geometry.remove(label);
      const byId = nodeByIdRef.current!;
      const profileGeometries = new Map<string, THREE.BufferGeometry | null>();
      const analyticalGeometries = new Map<string, THREE.CylinderGeometry>();
      const profileEdges = new Map<THREE.BufferGeometry, THREE.EdgesGeometry>();
      for (const beam of model.beams) {
        const start = byId.get(beam.startNodeId);
        const end = byId.get(beam.endNodeId);
        if (!start || !end) continue;
        const a = new THREE.Vector3(start.x, start.y, start.z);
        const b = new THREE.Vector3(end.x, end.y, end.z);
        const delta = b.clone().sub(a);
        const length = delta.length();
        if (length <= 1e-12) continue;
        const key = `${beam.profileName ?? ""}\u0000${length.toFixed(9)}`;
        if (visibility.profiles && beam.profileName && !profileGeometries.has(key)) {
          profileGeometries.set(key, createFrame3DProfileGeometry(beam.profileName, length));
        }
        const profileGeometry = visibility.profiles ? profileGeometries.get(key) ?? null : null;
        const radius = visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M;
        const analyticalKey = `${radius}:${length.toFixed(9)}:${visibility.profiles ? 24 : 12}`;
        if (!profileGeometry && !analyticalGeometries.has(analyticalKey)) {
          analyticalGeometries.set(analyticalKey,
            new THREE.CylinderGeometry(radius, radius, length, visibility.profiles ? 24 : 12));
        }
        const mesh = new THREE.Mesh(
          profileGeometry ?? analyticalGeometries.get(analyticalKey)!,
          new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.62, metalness: 0.04 }),
        );
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.copy(profileGeometry
          ? memberRotation(delta, beam.rollAngleRad ?? 0)
          : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
        mesh.userData = { type: "beam", id: beam.id };
        if (profileGeometry) {
          let edges = profileEdges.get(profileGeometry);
          if (!edges) {
            edges = new THREE.EdgesGeometry(profileGeometry, 28);
            profileEdges.set(profileGeometry, edges);
          }
          const outline = new THREE.LineSegments(edges,
            new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.42 }));
          outline.userData = { type: "beam", id: beam.id, selectionColor: 0x7c2d12, pickable: false };
          mesh.add(outline);
          const axes = memberAxes(b.clone().sub(a), beam.rollAngleRad ?? 0);
          geometry.add(makeLabel(beam.profileName!, "frame3d-profile-label",
            a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ez, -0.3)));
        }
        geometry.add(mesh);
        selectionPickTargetsRef.current.push(mesh);
        nonNodePickTargetsRef.current.push(mesh);
      }
      applySelectionHighlight(geometry, selectionRef.current);
      const renderStartedAt = performance.now();
      state.renderer.render(state.scene, state.camera);
      const webglRenderMs = performance.now() - renderStartedAt;
      renderFrame3DLabels(state, containerRef.current);
      selectionRenderedWithModelRef.current = selectionRef.current;
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "beam-profiles");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dFullRenderMs = (performance.now() - renderStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dWebglRenderMs = webglRenderMs.toFixed(2);
        containerRef.current.dataset.frame3dLabelRenderMs =
          (performance.now() - renderStartedAt - webglRenderMs).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
        containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
      }
      return;
    }
    // Verbergen/tonen van bestaande platen hoeft hun triangulatie niet opnieuw
    // te bouwen. Houd ook de pick-lijsten gelijk aan wat werkelijk zichtbaar is.
    const plateVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.plates !== previousPresentation.visibility.plates
      && (Object.keys(visibility) as (keyof Frame3DVisibility)[]).every((key) =>
        key === "plates" || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current
      && conditionLayerHasNoSurfaceLoads;
    const existingPlateMeshes = plateVisibilityOnly
      ? geometry.children.filter((child) => child.userData.type === "plate" && child instanceof THREE.Mesh)
      : [];
    if (plateVisibilityOnly && (!visibility.plates || model.plates?.length === 0 || existingPlateMeshes.length > 0)) {
      for (const mesh of existingPlateMeshes) mesh.visible = visibility.plates;
      // Bij grote modellen zijn plaatranden één losse, gebatchte lijnlaag.
      // Die moet met de meshes verdwijnen en terugkomen.
      for (const child of geometry.children) {
        if (child.userData.frame3dPlateEdges === true) child.visible = visibility.plates;
      }
      const plateSet = new Set(existingPlateMeshes);
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !plateSet.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !plateSet.has(target));
      if (visibility.plates) {
        selectionPickTargetsRef.current.push(...existingPlateMeshes);
        nonNodePickTargetsRef.current.push(...existingPlateMeshes);
      }
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "plate-visibility");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
      }
      return;
    }
    const supportVisibilityOnly = previousModel === model
      && visibilityChangedOnly("supports")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const loadVisibilityOnly = previousModel === model
      && visibilityChangedOnly("loads")
      && structuralGrid === previousPresentation?.structuralGrid
      && result === previousPresentation?.result
      && utilizations === previousPresentation?.utilizations
      && activeLoadCaseId === previousPresentation?.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const existingSurfaceLoads = loadVisibilityOnly
      ? geometry.children.find((child) => child.userData.frame3dSurfaceLoads === true)
      : undefined;
    const surfaceLoadToggleReady = !loadVisibilityOnly || !visibility.loads
      || noSurfaceLoadsInEitherModel
      || (existingSurfaceLoads instanceof THREE.Group && existingSurfaceLoads.children.length > 0);
    const conditionLayerOnly = previousModel === model
      && previousPresentation !== null
      && (sameFrame3DVisibility(visibility, previousPresentation.visibility)
        || supportVisibilityOnly || loadVisibilityOnly)
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && (supportVisibilityOnly || loadVisibilityOnly || conditionLayerHasNoSurfaceLoads)
      && surfaceLoadToggleReady
      && (supportVisibilityOnly || loadVisibilityOnly
        || conditionModel !== lastBuiltConditionModelRef.current
        || activeLoadCaseId !== previousPresentation.activeLoadCaseId);
    if (conditionLayerOnly) {
      const oldConditions = geometry.children.find((child) => child.userData.frame3dConditions === true);
      const removedConditionObjects = new Set<THREE.Object3D>();
      let removedLabelCount = 0;
      if (oldConditions instanceof THREE.Group) {
        oldConditions.traverse((object) => {
          removedConditionObjects.add(object);
          if (object instanceof CSS2DObject) removedLabelCount += 1;
        });
        disposeGroup(oldConditions);
        geometry.remove(oldConditions);
      }
      selectionPickTargetsRef.current = selectionPickTargetsRef.current
        .filter((target) => !removedConditionObjects.has(target));
      // De gewone klik gebruikt een tweede raycast-lijst. Oude lastpijlen
      // daarin zouden na omschakelen naar Model onzichtbaar selecteerbaar blijven.
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current
        .filter((target) => !removedConditionObjects.has(target));
      const nextConditions = new THREE.Group();
      nextConditions.userData.frame3dConditions = true;
      addFrame3DConditionMarkers(nextConditions, conditionModel ?? model, visibility, activeLoadCaseId);
      geometry.add(nextConditions);
      let addedLabelCount = 0;
      nextConditions.traverse((object) => {
        if (object instanceof CSS2DObject) addedLabelCount += 1;
        const type = object.userData.type as Frame3DSelectionType | undefined;
        if (type && object.userData.pickable !== false && SELECTABLE_TYPES.has(type)
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          if (type !== "node") nonNodePickTargetsRef.current.push(object);
        }
      });
      if (loadVisibilityOnly && existingSurfaceLoads instanceof THREE.Group) {
        existingSurfaceLoads.visible = visibility.loads;
        const surfaceTargets = new Set<THREE.Object3D>();
        let surfaceLabelCount = 0;
        existingSurfaceLoads.traverse((object) => {
          if (object instanceof CSS2DObject) surfaceLabelCount += 1;
          if (object.userData.type === "surfaceLoad"
            && typeof (object as { raycast?: unknown }).raycast === "function") surfaceTargets.add(object);
        });
        selectionPickTargetsRef.current = selectionPickTargetsRef.current
          .filter((target) => !surfaceTargets.has(target));
        nonNodePickTargetsRef.current = nonNodePickTargetsRef.current
          .filter((target) => !surfaceTargets.has(target));
        if (visibility.loads) {
          selectionPickTargetsRef.current.push(...surfaceTargets);
          nonNodePickTargetsRef.current.push(...surfaceTargets);
        }
        addedLabelCount += visibility.loads ? surfaceLabelCount : -surfaceLabelCount;
      }
      applySelectionHighlight(nextConditions, selectionRef.current);
      state.renderer.render(state.scene, state.camera);
      renderFrame3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        const previousLabelCount = Number(containerRef.current.dataset.frame3dLabels ?? 0);
        const visibleLabelCount = Math.max(0, previousLabelCount - removedLabelCount + addedLabelCount);
        writeBuildMode(containerRef.current, "conditions");
        containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
        containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
        containerRef.current.dataset.frame3dNonNodeLoadPickTargets = String(
          nonNodePickTargetsRef.current.filter((target) => LOAD_SELECTION_TYPES.has(
            target.userData.type as Frame3DSelectionType)).length);
        containerRef.current.dataset.frame3dLabels = String(visibleLabelCount);
      }
      return;
    }
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
    const previousPlates = previousModel?.plates ?? [];
    const nextPlates = model.plates ?? [];
    const presentationStable = previousPresentation !== null
      && sameFrame3DVisibility(visibility, previousPresentation.visibility)
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId;
    const hintedPlate = pendingAppend?.plate;
    const hintedPlateIsCurrent = hintedPlate !== undefined
      && plateByIdRef.current?.get(hintedPlate.id) === hintedPlate;
    const hintedAppendedPlate = previousModel !== null
      && hintedPlate !== undefined
      && hintedPlateIsCurrent
      && pendingAppend?.replacedPlateId === undefined
      && nextPlates.length === previousPlates.length + 1
      && nextPlates[nextPlates.length - 1] === hintedPlate
      ? hintedPlate
      : undefined;
    const hintedReplacedPlate = previousModel !== null
      && hintedPlate !== undefined
      && hintedPlateIsCurrent
      && pendingAppend?.replacedPlateId === hintedPlate.id
      && nextPlates.length === previousPlates.length
      ? hintedPlate
      : undefined;
    const hasValidatedPlateHint = hintedAppendedPlate !== undefined || hintedReplacedPlate !== undefined;
    const nonPlateCollectionsUnchanged = previousModel !== null
      && (hasValidatedPlateHint || (
        sameFrame3DNodes(model.nodes, previousModel.nodes)
        && sameFrame3DEntities(model.beams, previousModel.beams)
        && sameFrame3DEntities(model.supports, previousModel.supports)
        && sameFrame3DEntities(model.loads, previousModel.loads)
        && sameFrame3DEntities(model.memberLoads, previousModel.memberLoads)
        && sameFrame3DEntities(model.memberPointLoads, previousModel.memberPointLoads)
        && sameFrame3DEntities(model.thermalLoads, previousModel.thermalLoads)
        && sameFrame3DEntities(model.surfaceLoads, previousModel.surfaceLoads)
      ));
    const appendedPlate = hintedAppendedPlate ?? (previousModel !== null
      && !hasValidatedPlateHint
      && nonPlateCollectionsUnchanged
      && nextPlates.length === previousPlates.length + 1
      && nextPlates.length < 100
      && previousPlates.every((plate, index) => sameFrame3DEntities([plate], [nextPlates[index]]))
      ? nextPlates[nextPlates.length - 1]
      : undefined);
    const replacedPlateIndices = previousModel !== null && !hasValidatedPlateHint && nonPlateCollectionsUnchanged
      && nextPlates.length === previousPlates.length && nextPlates.length < 100
      ? nextPlates.flatMap((plate, index) => sameFrame3DEntities([plate], [previousPlates[index]]) ? [] : [index])
      : [];
    const replacedPlate = hintedReplacedPlate ?? (replacedPlateIndices.length === 1
      ? nextPlates[replacedPlateIndices[0]]
      : undefined);
    const changedPlate = appendedPlate ?? replacedPlate;
    if (containerRef.current && previousModel !== null && model.plates !== previousModel.plates) {
      containerRef.current.dataset.frame3dPlateIncrementalFallback = [
        model.nodes !== previousModel.nodes ? "nodes" : "",
        model.beams !== previousModel.beams ? "beams" : "",
        model.supports !== previousModel.supports ? "supports" : "",
        model.loads !== previousModel.loads ? "loads" : "",
        model.memberLoads !== previousModel.memberLoads ? "member-loads" : "",
        model.memberPointLoads !== previousModel.memberPointLoads ? "point-loads" : "",
        model.thermalLoads !== previousModel.thermalLoads ? "thermal-loads" : "",
        model.surfaceLoads !== previousModel.surfaceLoads ? "surface-loads-collection" : "",
        nextPlates.length !== previousPlates.length && !appendedPlate
          ? `plate-count-${previousPlates.length}-${nextPlates.length}` : "",
        !changedPlate ? `plate-delta-${replacedPlateIndices.length}` : "",
        !presentationStable ? "presentation" : "",
        !visibility.plates ? "hidden" : "",
        !conditionLayerHasNoSurfaceLoads ? "surface-loads" : "",
      ].filter(Boolean).join(",");
    }
    if (changedPlate && presentationStable && visibility.plates && conditionLayerHasNoSurfaceLoads) {
      const plateLayerStartedAt = performance.now();
      const built = createFrame3DPlateGeometry(model, changedPlate, nodeByIdRef.current ?? undefined);
      const plateGeometryMs = performance.now() - plateLayerStartedAt;
      const oldPlateMesh = replacedPlate
        ? geometry.children.find((child) => child.userData.type === "plate" && child.userData.id === replacedPlate.id)
        : undefined;
      if (built && (!replacedPlate || oldPlateMesh)) {
        if (oldPlateMesh) {
          geometry.remove(oldPlateMesh);
          selectionPickTargetsRef.current = selectionPickTargetsRef.current
            .filter((target) => target !== oldPlateMesh);
          nonNodePickTargetsRef.current = nonNodePickTargetsRef.current
            .filter((target) => target !== oldPlateMesh);
          disposeObject3D(oldPlateMesh);
        }
        const mesh = new THREE.Mesh(built.geometry, createPlateMaterial());
        mesh.position.copy(built.position);
        mesh.quaternion.copy(built.quaternion);
        mesh.userData = { type: "plate", id: changedPlate.id, baseOpacity: 0.7, selectionOpacity: 0.88 };
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(built.geometry, 22),
          new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.78 }),
        );
        edges.userData = { type: "plate", id: changedPlate.id, selectionColor: 0x92400e, pickable: false };
        mesh.add(edges);
        geometry.add(mesh);
        selectionPickTargetsRef.current.push(mesh);
        nonNodePickTargetsRef.current.push(mesh);
        applySelectionHighlight(geometry, selectionRef.current);
        const plateLayerMs = performance.now() - plateLayerStartedAt;
        const renderStartedAt = performance.now();
        state.renderer.render(state.scene, state.camera);
        renderFrame3DLabels(state, containerRef.current);
        const renderMs = performance.now() - renderStartedAt;
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dPlateIncrementalFallback;
          writeBuildMode(containerRef.current, appendedPlate ? "append-plate" : "update-plate");
          containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.frame3dPlateGeometryMs = plateGeometryMs.toFixed(2);
          containerRef.current.dataset.frame3dPlateLayerMs = plateLayerMs.toFixed(2);
          containerRef.current.dataset.frame3dFullRenderMs = renderMs.toFixed(2);
          containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
        }
        return;
      }
      built?.geometry.dispose();
    }
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
    const movedNodeRadiusStable = movedInsideBounds
      || Math.abs(visualNodeRadius(model) - visualNodeRadiusRef.current) < 1e-12;
    const incrementalNodeMove = previousModel !== null
      && unchangedCollections
      && nodeTopologyStable
      && model.nodes !== previousModel.nodes
      && model.beams === previousModel.beams
      && movedNodes.length > 0
      && movedNodes.length <= 512
      && previousModel.nodes.length >= 250
      && movedNodeRadiusStable
      && (!visibility.plates || affectedPlates.length === 0)
      && !visibility.beamNumbers
      && !visibility.memberAxes
      && conditionGeometryStable
      && resultGeometryStable
      && utilizationGeometryStable;
    if (containerRef.current && previousModel !== null && model !== previousModel && !incrementalNodeMove) {
      containerRef.current.dataset.frame3dMoveFallback = [
        model.nodes === previousModel.nodes ? "nodes-unchanged" : "",
        !nodeTopologyStable ? "node-topology" : "",
        movedNodes.length === 0 ? "no-coordinate-change" : "",
        !unchangedCollections ? "collections" : "",
        model.beams !== previousModel.beams ? "beams" : "",
        movedNodes.length > 512 ? "selection-size" : "",
        previousModel.nodes.length < 250 ? "small-model" : "",
        !movedNodeRadiusStable ? "node-radius" : "",
        visibility.plates && affectedPlates.length > 0 ? "plates" : "",
        visibility.beamNumbers ? "beam-labels" : "",
        !conditionGeometryStable ? "conditions" : "",
        !resultGeometryStable ? "results" : "",
        !utilizationGeometryStable ? "utilization" : "",
      ].filter(Boolean).join(",");
    }
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
        if (!movedInsideBounds) {
          nodeMeshes.forEach((mesh) => {
            mesh.computeBoundingBox();
            mesh.computeBoundingSphere();
          });
          if (visibility.structuralGrid && structuralGrid?.enabled) {
            const oldGrid = geometry.children.find((child) => child.userData.frame3dStructuralGrid === true);
            if (oldGrid instanceof THREE.Group) {
              disposeGroup(oldGrid);
              geometry.remove(oldGrid);
            }
            const nextGrid = new THREE.Group();
            nextGrid.userData.frame3dStructuralGrid = true;
            addStructuralGrid(nextGrid, model, structuralGrid);
            geometry.add(nextGrid);
            lastBuiltStructuralGridLayoutRef.current = structuralGridLayoutKey(model, structuralGrid);
          }
          lastBuiltNodeBoundsRef.current = frame3DNodeBounds(model);
        }
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
        renderFrame3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dIncrementalFallback;
          delete containerRef.current.dataset.frame3dMoveFallback;
          writeBuildMode(containerRef.current, "move-nodes");
          containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
        }
        return;
      }
      if (containerRef.current) containerRef.current.dataset.frame3dMoveFallback = "gpu-target";
    }
    const unhintedNodeCount = previousModel && pendingAppend === null
      ? model.nodes.length - previousModel.nodes.length : 0;
    const unhintedBeamCount = previousModel && pendingAppend === null
      ? model.beams.length - previousModel.beams.length : 0;
    let appendPrefixesStable = unhintedNodeCount > 0 && unhintedNodeCount <= 64
      && unhintedBeamCount >= 0 && unhintedBeamCount <= 64;
    if (previousModel && appendPrefixesStable) {
      for (let index = 0; index < previousModel.nodes.length; index += 1) {
        if (model.nodes[index] !== previousModel.nodes[index]) { appendPrefixesStable = false; break; }
      }
      if (appendPrefixesStable) {
        for (let index = 0; index < previousModel.beams.length; index += 1) {
          if (model.beams[index] !== previousModel.beams[index]) { appendPrefixesStable = false; break; }
        }
      }
    }
    const unhintedNodes = previousModel && appendPrefixesStable
      ? model.nodes.slice(previousModel.nodes.length) : [];
    const unhintedBeams = previousModel && appendPrefixesStable
      ? model.beams.slice(previousModel.beams.length) : [];
    const unhintedInsideBounds = previousBounds !== null
      && unhintedNodes.every((node) => previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)));
    const previousNodeLabelStride = previousModel
      ? previousModel.nodes.length <= 200 ? 1 : Math.ceil(previousModel.nodes.length / 24) : 1;
    const nextNodeLabelStride = model.nodes.length <= 200 ? 1 : Math.ceil(model.nodes.length / 24);
    const previousConditionModel = lastBuiltConditionModelRef.current;
    const appendConditionGeometryStable = !visibility.loads || (
      conditionModel?.loads === previousConditionModel?.loads
      && conditionModel?.memberLoads === previousConditionModel?.memberLoads
      && conditionModel?.memberPointLoads === previousConditionModel?.memberPointLoads
      && conditionModel?.thermalLoads === previousConditionModel?.thermalLoads
      && conditionModel?.surfaceLoads === previousConditionModel?.surfaceLoads
    );
    const unhintedAppend = previousModel !== null
      && previousModel.nodes.length >= 250
      && appendPrefixesStable
      && unchangedCollections
      && unhintedInsideBounds
      && (!(visibility.nodeNumbers || visibility.nodeCoordinates)
        || previousNodeLabelStride === nextNodeLabelStride)
      && !visibility.beamNumbers
      && !visibility.memberAxes
      && appendConditionGeometryStable
      && !result
      && (!visibility.utilization || utilizations.length === 0);
    if (unhintedAppend) {
      const visibleNodes = geometry.children.find((child) => child.userData.frame3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.frame3dNodeHit === true);
      const nodeMeshes = [visibleNodes, hitNodes].filter((child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh);
      let fastPathReady = nodeMeshes.length > 0
        && nodeMeshes.every((mesh) => mesh.count + unhintedNodes.length <= mesh.instanceMatrix.count);
      const beamUpdates: Array<{
        beam: Frame3DModel["beams"][number];
        mesh: THREE.InstancedMesh;
        matrix: THREE.Matrix4;
        color: number;
      }> = [];
      const additionsPerMesh = new Map<THREE.InstancedMesh, number>();
      if (fastPathReady) {
        for (const beam of unhintedBeams) {
          const start = nodeByIdRef.current!.get(beam.startNodeId);
          const end = nodeByIdRef.current!.get(beam.endNodeId);
          if (!start || !end) { fastPathReady = false; break; }
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          const length = delta.length();
          if (length <= 1e-12) { fastPathReady = false; break; }
          const isProfile = visibility.profiles && Boolean(beam.profileName);
          const profileKey = isProfile
            ? `profile\u0000${profileBatchName(beam.profileName!)}`
            : `analytical\u0000${visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M}\u0000${visibility.profiles ? 24 : 12}`;
          const candidate = geometry.children.find((child) => child.userData.frame3dBeamBatchKey === profileKey);
          if (!(candidate instanceof THREE.InstancedMesh)) { fastPathReady = false; break; }
          const count = (additionsPerMesh.get(candidate) ?? 0) + 1;
          additionsPerMesh.set(candidate, count);
          if (candidate.count + count > candidate.instanceMatrix.count) { fastPathReady = false; break; }
          const rotation = isProfile
            ? memberRotation(delta, beam.rollAngleRad ?? 0)
            : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
          const utilization = visibility.utilization
            ? utilizations.find((value) => value.beamId === beam.id)
            : undefined;
          const utilizationClass = utilization ? frame3DUtilizationClass(utilization) : undefined;
          beamUpdates.push({
            beam,
            mesh: candidate,
            color: utilizationClass ? FRAME_3D_UTILIZATION_COLORS[utilizationClass] : 0x2563eb,
            matrix: new THREE.Matrix4().compose(
              a.add(b).multiplyScalar(0.5), rotation,
              isProfile ? frame3DProfileInstanceScale(length) : new THREE.Vector3(1, length, 1),
            ),
          });
        }
      }
      if (fastPathReady) {
        for (const node of unhintedNodes) {
          const nodeMatrix = new THREE.Matrix4().makeTranslation(node.x, node.y, node.z);
          for (const mesh of nodeMeshes) {
            const instanceIndex = mesh.count;
            mesh.count += 1;
            (mesh.userData.instanceIds as number[]).push(node.id);
            (mesh.userData.instanceBaseColors as number[]).push(0x334155);
            (mesh.userData.instanceIndexById as Map<number, number>).set(node.id, instanceIndex);
            mesh.setMatrixAt(instanceIndex, nodeMatrix);
            mesh.setColorAt(instanceIndex, new THREE.Color(0x334155));
            markInstanceChanged(mesh, instanceIndex);
          }
          const nodeIndex = model.nodes.indexOf(node);
          if ((visibility.nodeNumbers || visibility.nodeCoordinates) && nodeIndex % nextNodeLabelStride === 0) {
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
        for (const update of beamUpdates) {
          const instanceIndex = update.mesh.count;
          update.mesh.count += 1;
          (update.mesh.userData.instanceIds as number[]).push(update.beam.id);
          (update.mesh.userData.instanceBaseColors as number[]).push(update.color);
          (update.mesh.userData.instanceIndexById as Map<number, number>).set(update.beam.id, instanceIndex);
          update.mesh.setMatrixAt(instanceIndex, update.matrix);
          update.mesh.setColorAt(instanceIndex, new THREE.Color(update.color));
          markInstanceChanged(update.mesh, instanceIndex);
          expandInstancedMeshBounds(update.mesh, update.matrix);
        }
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        renderFrame3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dIncrementalFallback;
          writeBuildMode(containerRef.current, "append-copy");
          containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
          containerRef.current.dataset.frame3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
        }
        return;
      }
    }
    const removedNodeCount = previousModel ? previousModel.nodes.length - model.nodes.length : 0;
    const removedBeamCount = previousModel ? previousModel.beams.length - model.beams.length : 0;
    let removalPrefixesStable = removedNodeCount > 0 && removedNodeCount <= 64
      && removedBeamCount >= 0 && removedBeamCount <= 64;
    if (previousModel && removalPrefixesStable) {
      for (let index = 0; index < model.nodes.length; index += 1) {
        if (model.nodes[index] !== previousModel.nodes[index]) { removalPrefixesStable = false; break; }
      }
      if (removalPrefixesStable) {
        for (let index = 0; index < model.beams.length; index += 1) {
          if (model.beams[index] !== previousModel.beams[index]) { removalPrefixesStable = false; break; }
        }
      }
    }
    const removedNodes = previousModel && removalPrefixesStable
      ? previousModel.nodes.slice(model.nodes.length) : [];
    const removedBeams = previousModel && removalPrefixesStable
      ? previousModel.beams.slice(model.beams.length) : [];
    const removalNodeLabelStrideStable = previousModel
      ? (previousModel.nodes.length <= 200 ? 1 : Math.ceil(previousModel.nodes.length / 24)) === nextNodeLabelStride
      : false;
    const incrementalTailRemoval = previousModel !== null
      && model.nodes.length >= 250
      && removalPrefixesStable
      && unchangedCollections
      && (!(visibility.nodeNumbers || visibility.nodeCoordinates) || removalNodeLabelStrideStable)
      && !visibility.beamNumbers
      && !visibility.memberAxes
      && appendConditionGeometryStable
      && !result
      && (!visibility.utilization || utilizations.length === 0);
    if (incrementalTailRemoval) {
      const removedNodeIds = new Set(removedNodes.map((node) => node.id));
      const visibleNodes = geometry.children.find((child) => child.userData.frame3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.frame3dNodeHit === true);
      const nodeMeshes = [visibleNodes, hitNodes].filter((child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh);
      let fastPathReady = nodeMeshes.length > 0 && nodeMeshes.every((mesh) => {
        const ids = mesh.userData.instanceIds as number[];
        return ids.length === previousModel.nodes.length
          && removedNodes.every((node, index) => ids[model.nodes.length + index] === node.id);
      });
      const beamRemovals = new Map<THREE.InstancedMesh, number[]>();
      if (fastPathReady) {
        for (const beam of removedBeams) {
          const profileKey = visibility.profiles && beam.profileName
            ? `profile\u0000${profileBatchName(beam.profileName)}`
            : `analytical\u0000${visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M}\u0000${visibility.profiles ? 24 : 12}`;
          const candidate = geometry.children.find((child) => child.userData.frame3dBeamBatchKey === profileKey);
          if (!(candidate instanceof THREE.InstancedMesh)) { fastPathReady = false; break; }
          const ids = beamRemovals.get(candidate) ?? [];
          ids.push(beam.id);
          beamRemovals.set(candidate, ids);
        }
      }
      if (fastPathReady) {
        for (const [mesh, idsToRemove] of beamRemovals) {
          const ids = mesh.userData.instanceIds as number[];
          const tail = ids.slice(ids.length - idsToRemove.length);
          if (tail.length !== idsToRemove.length || tail.some((id, index) => id !== idsToRemove[index])) {
            fastPathReady = false;
            break;
          }
        }
      }
      if (fastPathReady) {
        for (const mesh of nodeMeshes) {
          const ids = mesh.userData.instanceIds as number[];
          const colors = mesh.userData.instanceBaseColors as number[];
          const indexById = mesh.userData.instanceIndexById as Map<number, number>;
          removedNodes.forEach((node) => indexById.delete(node.id));
          ids.length = model.nodes.length;
          colors.length = model.nodes.length;
          mesh.count = model.nodes.length;
          mesh.userData.selectedInstanceIndices = new Set<number>();
        }
        for (const [mesh, idsToRemove] of beamRemovals) {
          const ids = mesh.userData.instanceIds as number[];
          const colors = mesh.userData.instanceBaseColors as number[];
          const indexById = mesh.userData.instanceIndexById as Map<number, number>;
          idsToRemove.forEach((id) => indexById.delete(id));
          ids.length -= idsToRemove.length;
          colors.length -= idsToRemove.length;
          mesh.count -= idsToRemove.length;
          mesh.userData.selectedInstanceIndices = new Set<number>();
        }
        for (const child of [...geometry.children]) {
          if (!(child instanceof CSS2DObject)) continue;
          const follow = child.userData.frame3dFollow as { type: "node" | "beam"; id: number } | undefined;
          if (follow?.type !== "node" || !removedNodeIds.has(follow.id)) continue;
          geometry.remove(child);
          child.element.remove();
        }
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        renderFrame3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dIncrementalFallback;
          writeBuildMode(containerRef.current, "remove-copy");
          containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
          containerRef.current.dataset.frame3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
        }
        return;
      }
    }
    const incrementalNodeOnly = appendedNode && model.beams === previousModel?.beams;
    const incrementalBeam = appendedBeam
      && (model.nodes === previousModel?.nodes || appendedNode);
    const interactivePlateNodeAppend = Boolean(incrementalNodeOnly)
      && (toolRef.current === "addPlate" || toolRef.current === "addPlateArc" || isOpeningTool(toolRef.current));
    if (previousModel && unchangedCollections && (incrementalNodeOnly || incrementalBeam)) {
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
      const memberAxesGroup = visibility.memberAxes
        ? geometry.children.find((child) => child.userData.frame3dMemberAxes === true)
        : undefined;
      const memberAxesReady = !visibility.memberAxes || !beam || (
        memberAxesGroup instanceof THREE.Group
        && (previousModel.beams.length <= 12) === (model.beams.length <= 12)
        && [0, 1, 2].every((axisIndex) => memberAxesGroup.children.some((child) =>
          child.userData.frame3dAxisIndex === axisIndex && child instanceof THREE.LineSegments))
      );
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
      const standaloneBeamAppend = Boolean(beam)
        && model.beams.length < 100
        && model.nodes.length < 250;
      const beamStart = beam ? nodeByIdRef.current!.get(beam.startNodeId) : undefined;
      const beamEnd = beam ? nodeByIdRef.current!.get(beam.endNodeId) : undefined;
      const beamEndpointsValid = !beam || (beamStart !== undefined && beamEnd !== undefined
        && Math.hypot(beamEnd.x - beamStart.x, beamEnd.y - beamStart.y, beamEnd.z - beamStart.z) > 1e-12);
      const beamCapacityAvailable = !beam || !visibility.beams || standaloneBeamAppend
        || (beamMesh instanceof THREE.InstancedMesh && beamMesh.count + 1 <= beamMesh.instanceMatrix.count);
      const previousConditionModel = lastBuiltConditionModelRef.current;
      const conditionLoadsStable = !beam || !visibility.loads
        || sameVisibleConditionLoads(conditionModel ?? model, previousConditionModel, activeLoadCaseId);
      // Tijdens het tekenen van een plaat is iedere klik eerst een losse
      // conceptknoop. Ook wanneer die de bestaande modelbegrenzing vergroot,
      // kunnen we de al aanwezige knoopbatches veilig hergebruiken. De
      // definitieve plaatopbouw ververst daarna de overige begrenzingsafhankelijke
      // geometrie in één keer.
      // Een gewone staaf mag eveneens buiten de oude grens eindigen zolang
      // de schaal van bestaande knoop- en oplegsymbolen gelijk blijft. Raster
      // en camerabereik worden onafhankelijk van deze snelle toevoeging bijgewerkt.
      const outsideBoundsScaleStable = Math.abs(visualNodeRadius(model) - visualNodeRadiusRef.current) < 1e-12
        && Math.abs(frame3DConditionMarkerSize((conditionModel ?? model).nodes)
          - frame3DConditionMarkerSize((previousConditionModel ?? previousModel).nodes)) < 1e-12;
      const nodeInsideBounds = !node || interactivePlateNodeAppend
        || (previousBounds !== null && previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)))
        || outsideBoundsScaleStable;
      const fastPathReady = nodeCapacityAvailable && beamCapacityAvailable && beamEndpointsValid
        && conditionLoadsStable && nodeLabelSamplingStable && beamLabelSamplingStable
        && memberAxesReady && nodeInsideBounds;
      // Binnen de bestaande begrenzing blijven knoopstraal, opleggingsgrootte
      // en stramienbereik gelijk. Voeg de knoop dan rechtstreeks aan de al
      // aanwezige GPU-batches toe; alle onveranderde geometrie blijft staan.
      if (fastPathReady) {
        if (node && interactivePlateNodeAppend) {
          const nextRadius = visualNodeRadius(model);
          const previousRadius = visualNodeRadiusRef.current;
          if (previousRadius > 0 && Math.abs(nextRadius - previousRadius) > 1e-12) {
            const radiusScale = nextRadius / previousRadius;
            for (const mesh of meshes) {
              mesh.geometry.scale(radiusScale, radiusScale, radiusScale);
              mesh.geometry.computeBoundingBox();
              mesh.geometry.computeBoundingSphere();
            }
            visualNodeRadiusRef.current = nextRadius;
          }
        }
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
        } else if (beam && standaloneBeamAppend && visibility.beams) {
          const start = beamStart!;
          const end = beamEnd!;
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          const length = delta.length();
          const profileGeometry = visibility.profiles && beam.profileName
            ? createFrame3DProfileGeometry(beam.profileName, length)
            : null;
          const radius = visibility.profiles ? PROFILE_BEAM_RADIUS_M : ANALYTICAL_BEAM_RADIUS_M;
          const beamGeometry = profileGeometry
            ?? new THREE.CylinderGeometry(radius, radius, length, visibility.profiles ? 24 : 12);
          const rotation = profileGeometry
            ? memberRotation(delta, beam.rollAngleRad ?? 0)
            : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
          const utilization = visibility.utilization
            ? utilizations.find((value) => value.beamId === beam.id)
            : undefined;
          const utilizationClass = utilization ? frame3DUtilizationClass(utilization) : undefined;
          const color = utilizationClass ? FRAME_3D_UTILIZATION_COLORS[utilizationClass] : 0x2563eb;
          const mesh = new THREE.Mesh(
            beamGeometry,
            new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 }),
          );
          mesh.position.copy(a).add(b).multiplyScalar(0.5);
          mesh.quaternion.copy(rotation);
          mesh.userData = { type: "beam", id: beam.id };
          if (profileGeometry) {
            const edges = new THREE.LineSegments(
              new THREE.EdgesGeometry(profileGeometry, 28),
              new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.42 }),
            );
            edges.userData = { type: "beam", id: beam.id, selectionColor: 0x7c2d12, pickable: false };
            mesh.add(edges);
          }
          geometry.add(mesh);
          selectionPickTargetsRef.current.push(mesh);
          nonNodePickTargetsRef.current.push(mesh);
          const axes = memberAxes(delta, beam.rollAngleRad ?? 0);
          if (visibility.beamNumbers && (model.beams.length - 1) % beamLabelStride === 0) {
            geometry.add(makeLabel(
              `(${beam.id})`, "frame3d-beam-number",
              mesh.position.clone().addScaledVector(axes.ey, 0.3),
            ));
            addedLabels += 1;
          }
          if (visibility.profiles && beam.profileName) {
            geometry.add(makeLabel(
              beam.profileName, "frame3d-profile-label",
              mesh.position.clone().addScaledVector(axes.ez, -0.3),
            ));
            addedLabels += 1;
          }
        }
        if (beam && visibility.memberAxes && memberAxesGroup instanceof THREE.Group) {
          const start = beamStart!;
          const end = beamEnd!;
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          const axes = memberAxes(delta, beam.rollAngleRad ?? 0);
          const origin = a.clone().lerp(b, 0.5);
          const axisLength = Math.min(0.5, Math.max(0.12, delta.length() * 0.16));
          ([axes.ex, axes.ey, axes.ez] as const).forEach((direction, axisIndex) => {
            const tip = origin.clone().addScaledVector(direction, axisLength);
            const side = new THREE.Vector3().crossVectors(direction, axisIndex === 2 ? axes.ex : axes.ez).normalize();
            const wing = Math.min(axisLength * 0.28, 0.09);
            const positions = [origin.x, origin.y, origin.z, tip.x, tip.y, tip.z];
            for (const sign of [-1, 1]) {
              const shoulder = tip.clone().addScaledVector(direction, -wing).addScaledVector(side, sign * wing * 0.45);
              positions.push(tip.x, tip.y, tip.z, shoulder.x, shoulder.y, shoulder.z);
            }
            const line = memberAxesGroup.children.find((child) =>
              child.userData.frame3dAxisIndex === axisIndex) as THREE.LineSegments;
            const previousPositions = line.geometry.getAttribute("position").array as Float32Array;
            const combined = new Float32Array(previousPositions.length + positions.length);
            combined.set(previousPositions);
            combined.set(positions, previousPositions.length);
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry();
            line.geometry.setAttribute("position", new THREE.BufferAttribute(combined, 3));
            line.geometry.computeBoundingSphere();
            if (model.beams.length <= 12 || selectionRef.current?.type === "beam" && selectionRef.current.id === beam.id) {
              memberAxesGroup.add(makeLabel(["x", "y", "z"][axisIndex], "frame3d-local-axis-label", tip));
              addedLabels += 1;
            }
          });
        }
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        renderFrame3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        lastBuiltNodeBoundsRef.current = frame3DNodeBounds(model);
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.frame3dIncrementalFallback;
          writeBuildMode(containerRef.current, beam
            ? node ? "append-node-beam" : "append-beam"
            : "append-node");
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
          !memberAxesReady ? "member-axes" : "",
          !nodeInsideBounds ? "bounds" : "",
        ].filter(Boolean).join(",");
      }
    }
    const nextStructuralGridLayout = visibility.structuralGrid && structuralGrid?.enabled
      ? structuralGridLayoutKey(model, structuralGrid)
      : null;
    const oldStructuralGrid = geometry.children.find((child) => child.userData.frame3dStructuralGrid === true);
    const preservedStructuralGrid = oldStructuralGrid instanceof THREE.Group
      && previousPresentation?.structuralGrid === structuralGrid
      && previousPresentation?.visibility.structuralGrid
      && nextStructuralGridLayout !== null
      && nextStructuralGridLayout === lastBuiltStructuralGridLayoutRef.current
      ? oldStructuralGrid
      : null;
    // De stramienbuffer kan tienduizenden lijnpunten bevatten. Wanneer alleen
    // het model wijzigt en zijn bereik binnen hetzelfde stramien blijft, hang
    // die ongewijzigde groep tijdelijk los zodat de volledige modelopbouw hem
    // niet weggooit en direct daarna opnieuw maakt.
    if (preservedStructuralGrid) geometry.remove(preservedStructuralGrid);
    disposeGroup(geometry);
    if (preservedStructuralGrid) geometry.add(preservedStructuralGrid);
    nodePickTargetsRef.current = [];
    selectionPickTargetsRef.current = [];
    nonNodePickTargetsRef.current = [];
    state.grid.visible = visibility.grid;
    state.axes.visible = visibility.axes;
    state.axisLabels.forEach((label) => { label.visible = visibility.axes; });
    const byId = indexFrame3DNodes(model);
    let plateGeometryMs = 0;
    const plateGeometryById = new Map<number, ReturnType<typeof createFrame3DPlateGeometry>>();
    const plateGeometryFor = (plate: NonNullable<Frame3DModel["plates"]>[number]) => {
      if (!plateGeometryById.has(plate.id)) {
        const startedAt = performance.now();
        plateGeometryById.set(plate.id, createFrame3DPlateGeometry(model, plate, byId));
        plateGeometryMs += performance.now() - startedAt;
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
    // Een model met veel knopen is ook duur om volledig opnieuw op te bouwen
    // wanneer er nog maar enkele staven zijn. Maak daar vanaf de eerste staaf
    // al een uitbreidbare batch van, zodat doorlopend tekenen na die eerste
    // staaf op het incrementele pad blijft.
    const useBeamInstancing = model.beams.length >= 100 || model.nodes.length >= 250;
    // Nummerlabels zijn DOM-elementen. Duizenden labels boven op elkaar zijn
    // onleesbaar en blokkeren de hoofdthread. Houd per soort een gelijkmatig
    // verdeelde, representatieve set zichtbaar bij grote modellen.
    const labelStride = (count: number) => count <= 200 ? 1 : Math.ceil(count / 24);
    const beamLabelStride = labelStride(model.beams.length);
    const nodeLabelStride = labelStride(model.nodes.length);
    // Bij een groter raamwerk maken tientallen badges zowel het model als de
    // bediening traag en onleesbaar. Details blijven per staaf selecteerbaar.
    const resultLabelStride = model.beams.length <= 24 ? 1 : Math.ceil(model.beams.length / 16);
    const resultLabelVisible = (beamId: number, beamIndex: number) => {
      if (beamIndex % resultLabelStride === 0) return true;
      const selected = selectionRef.current;
      return (selected?.type === "beam" && selected.id === beamId)
        || (selected?.type === "multi" && selected.beamIds.includes(beamId));
    };
    const nodeGeometry = new THREE.SphereGeometry(nodeRadius, 24, 16);
    // Snapzones blijven bestaan wanneer de knoopbollen verborgen zijn. Zo is
    // Weergave onafhankelijk van de actieve Knoop-snap, zoals in de 2D-editor.
    const nodeHitGeometry = new THREE.SphereGeometry(nodeRadius * 2.6, 12, 8);
    const utilizationByMember = new Map(utilizations.map((value) => [value.beamId, value]));
    const localAxisSegments: number[][] = [[], [], []];
    const memberAxesGroup = new THREE.Group();
    memberAxesGroup.userData.frame3dMemberAxes = true;
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
      if (visibility.memberAxes) {
        const origin = a.clone().lerp(b, 0.5);
        const axisLength = Math.min(0.5, Math.max(0.12, length * 0.16));
        ([axes.ex, axes.ey, axes.ez] as const).forEach((direction, axisIndex) => {
          const tip = origin.clone().addScaledVector(direction, axisLength);
          localAxisSegments[axisIndex].push(origin.x, origin.y, origin.z, tip.x, tip.y, tip.z);
          const side = new THREE.Vector3().crossVectors(direction, axisIndex === 2 ? axes.ex : axes.ez).normalize();
          const wing = Math.min(axisLength * 0.28, 0.09);
          for (const sign of [-1, 1]) {
            const shoulder = tip.clone().addScaledVector(direction, -wing).addScaledVector(side, sign * wing * 0.45);
            localAxisSegments[axisIndex].push(tip.x, tip.y, tip.z, shoulder.x, shoulder.y, shoulder.z);
          }
          if (model.beams.length <= 12 || selectionRef.current?.type === "beam" && selectionRef.current.id === beam.id) {
            memberAxesGroup.add(makeLabel(["x", "y", "z"][axisIndex], "frame3d-local-axis-label", tip));
          }
        });
      }
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
            const edges = new THREE.LineSegments(
              profileEdgesFor(profileGeometry),
              new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.42 }),
            );
            edges.userData = { type: "beam", id: beam.id, selectionColor: 0x7c2d12, pickable: false };
            mesh.add(edges);
          }
          geometry.add(mesh);
        }
        if (utilization && resultLabelVisible(beam.id, beamIndex)) {
          const midpoint = a.clone().add(b).multiplyScalar(0.5)
            .addScaledVector(axes.ez, 0.42)
            .addScaledVector(axes.ey, 0.12);
          const label = makeLabel(
            utilization.status === "NotApplicable"
              ? `${utilization.standard} · n.v.t.`
              : `${utilization.standard} · UC ${utilization.uc.toFixed(2)}`,
            `frame3d-utilization-label frame3d-utilization-${utilizationClass}`,
            midpoint,
          );
          label.element.setAttribute("role", "button");
          label.element.setAttribute("tabindex", "0");
          label.element.setAttribute("title", `Staaf ${beam.id}: open normtoetsing`);
          label.element.style.pointerEvents = "auto";
          const openCheck = (event: Event) => {
            event.stopPropagation();
            onOpenCheckForBeam?.(beam.id);
          };
          label.element.addEventListener("pointerdown", (event) => event.stopPropagation());
          label.element.addEventListener("click", openCheck);
          label.element.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openCheck(event);
            }
          });
          geometry.add(label);
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
    if (visibility.memberAxes) {
      [0xdc2626, 0x16a34a, 0x2563eb].forEach((color, axisIndex) => {
        const positions = localAxisSegments[axisIndex];
        if (positions.length === 0) return;
        const axisGeometry = new THREE.BufferGeometry();
        axisGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        const lines = new THREE.LineSegments(axisGeometry, new THREE.LineBasicMaterial({ color, depthTest: false }));
        lines.renderOrder = 20;
        lines.userData.pickable = false;
        lines.userData.frame3dAxisIndex = axisIndex;
        memberAxesGroup.add(lines);
      });
      geometry.add(memberAxesGroup);
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
    const plateLayerStartedAt = performance.now();
    const plateBatchOwnedGeometries = new Set<THREE.BufferGeometry>();
    if (visibility.plates) {
      const plates = model.plates ?? [];
      if (plates.length >= 100) {
        type PlateInstance = { id: number; matrix: THREE.Matrix4 };
        const batches = new Map<string, { geometry: THREE.BufferGeometry; instances: PlateInstance[] }>();
        for (const plate of plates) {
          const built = plateGeometryFor(plate);
          if (!built) continue;
          const key = geometrySignature(built.geometry);
          let batch = batches.get(key);
          if (!batch) {
            batch = { geometry: built.geometry, instances: [] };
            batches.set(key, batch);
            plateBatchOwnedGeometries.add(built.geometry);
          }
          batch.instances.push({
            id: plate.id,
            matrix: new THREE.Matrix4().compose(
              built.position,
              built.quaternion,
              new THREE.Vector3(1, 1, 1),
            ),
          });
        }
        for (const [batchKey, batch] of batches) {
          const mesh = new THREE.InstancedMesh(
            batch.geometry,
            createPlateMaterial(0xffffff),
            batch.instances.length,
          );
          const instanceIds = batch.instances.map((instance) => instance.id);
          mesh.userData = {
            type: "plate",
            instanceIds,
            instanceBaseColors: new Array<number>(instanceIds.length).fill(0x94a3b8),
            instanceIndexById: new Map(instanceIds.map((id, index) => [id, index])),
            frame3dPlateBatchKey: batchKey,
          };
          batch.instances.forEach((instance, index) => {
            mesh.setMatrixAt(index, instance.matrix);
            mesh.setColorAt(index, new THREE.Color(0x94a3b8));
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
          geometry.add(mesh);

          const localEdges = new THREE.EdgesGeometry(batch.geometry, 22);
          const localPositions = localEdges.getAttribute("position") as THREE.BufferAttribute;
          const worldPositions = new Float32Array(localPositions.count * batch.instances.length * 3);
          const edgePoint = new THREE.Vector3();
          let worldIndex = 0;
          for (const instance of batch.instances) {
            for (let index = 0; index < localPositions.count; index += 1) {
              edgePoint.fromBufferAttribute(localPositions, index).applyMatrix4(instance.matrix);
              worldPositions[worldIndex++] = edgePoint.x;
              worldPositions[worldIndex++] = edgePoint.y;
              worldPositions[worldIndex++] = edgePoint.z;
            }
          }
          localEdges.dispose();
          const edgeGeometry = new THREE.BufferGeometry();
          edgeGeometry.setAttribute("position", new THREE.BufferAttribute(worldPositions, 3));
          edgeGeometry.computeBoundingBox();
          edgeGeometry.computeBoundingSphere();
          const edges = new THREE.LineSegments(
            edgeGeometry,
            new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.78 }),
          );
          edges.userData = { frame3dPlateEdges: true, pickable: false };
          geometry.add(edges);
        }
      } else {
        for (const plate of plates) {
          const built = plateGeometryFor(plate);
          if (!built) continue;
          plateBatchOwnedGeometries.add(built.geometry);
          const mesh = new THREE.Mesh(built.geometry, createPlateMaterial());
          mesh.position.copy(built.position);
          mesh.quaternion.copy(built.quaternion);
          mesh.userData = { type: "plate", id: plate.id, baseOpacity: 0.7, selectionOpacity: 0.88 };
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(built.geometry, 22),
            new THREE.LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.78 }),
          );
          edges.userData = { type: "plate", id: plate.id, selectionColor: 0x92400e, pickable: false };
          mesh.add(edges);
          geometry.add(mesh);
        }
      }
    }
    const plateLayerMs = performance.now() - plateLayerStartedAt;
    // Bereid de zichtbare knoopbatch en transparante snapbatch ook voor bij een
    // leeg model. Daardoor kan de allereerste tekenklik direct een instantie
    // toevoegen en verschuift de eenmalige WebGL-opstartkost naar het openen
    // van de 3D-viewer. De schermindex bewaart de individuele ID's.
    const useNodeInstancing = true;
    if (useNodeInstancing) {
      const instanceIds = model.nodes.map((node) => node.id);
      const instanceBaseColors = new Array<number>(model.nodes.length).fill(0x334155);
      // Reserveer in machten van twee ruimte voor interactief bijtekenen. Een
      // enkele nieuwe knoop past dan meestal in de bestaande GPU-buffer.
      const instanceCapacity = 2 ** Math.ceil(Math.log2(Math.max(256, model.nodes.length + 1)));
      const visibleNodes = new THREE.InstancedMesh(
        nodeGeometry, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.06 }), instanceCapacity,
      );
      visibleNodes.visible = visibility.nodes;
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
    if (visibility.structuralGrid && structuralGrid && !preservedStructuralGrid) {
      const structuralGridGroup = new THREE.Group();
      structuralGridGroup.userData.frame3dStructuralGrid = true;
      addStructuralGrid(structuralGridGroup, model, structuralGrid);
      geometry.add(structuralGridGroup);
    }
    const conditionGroup = new THREE.Group();
    conditionGroup.userData.frame3dConditions = true;
    addFrame3DConditionMarkers(conditionGroup, conditionModel ?? model, visibility, activeLoadCaseId);
    geometry.add(conditionGroup);

    const surfaceLoadGroup = new THREE.Group();
    surfaceLoadGroup.userData.frame3dSurfaceLoads = true;
    geometry.add(surfaceLoadGroup);
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
        const arrow = new THREE.ArrowHelper(direction, built.surfaceAnchor.clone().addScaledVector(direction, -length), length, 0x0284c7, 0.22, 0.12);
        arrow.traverse((child) => { child.userData = { type: "surfaceLoad", id: load.id }; });
        surfaceLoadGroup.add(arrow);
        if (loadIndex % surfaceLoadLabelStride === 0) {
          const label = makeLabel(
            `q = ${resultValue(magnitude)} kN/m²`,
            "frame3d-result-label frame3d-surface-load-label",
            built.surfaceLabelAnchor.clone().addScaledVector(built.normal, 0.12),
          );
          // In bovenaanzicht projecteert de verticale lastpijl vrijwel op
          // één pixel. Het zichtbare label moet daarom zelf selecteerbaar
          // zijn, ook wanneer de plaat een opening rond zijn zwaartepunt heeft.
          label.element.setAttribute("role", "button");
          label.element.setAttribute("tabindex", "0");
          label.element.setAttribute("title", `Selecteer oppervlaktebelasting ${load.id}`);
          label.element.style.pointerEvents = "auto";
          label.element.addEventListener("pointerdown", (event) => event.stopPropagation());
          label.element.addEventListener("click", (event) => {
            event.stopPropagation();
            selectRef.current(toggleFrame3DSelection(
              selectionRef.current, { type: "surfaceLoad", id: load.id },
              event.shiftKey || event.ctrlKey || event.metaKey,
            ));
          });
          label.element.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            selectRef.current(toggleFrame3DSelection(
              selectionRef.current, { type: "surfaceLoad", id: load.id },
              event.shiftKey || event.ctrlKey || event.metaKey,
            ));
          });
          surfaceLoadGroup.add(label);
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
      const diagramBatches = model.beams.length >= 100
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
      const modelBox = frame3DNodeBounds(model);
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
        if (type !== "node") nonNodePickTargetsRef.current.push(object);
      }
    });
    // Bij GPU-batches blijft per vorm één geometrie aan de scène gekoppeld.
    // De overige, alleen voor herkenning of lastpositie gebruikte geometrieën
    // hangen nergens en worden daarom meteen vrijgegeven.
    plateGeometryById.forEach((built) => {
      if (built && !plateBatchOwnedGeometries.has(built.geometry)) built.geometry.dispose();
    });
    applySelectionHighlight(geometry, selectionRef.current);
    const renderStartedAt = performance.now();
    state.renderer.render(state.scene, state.camera);
    const webglRenderMs = performance.now() - renderStartedAt;
    renderFrame3DLabels(state, containerRef.current);
    const renderMs = performance.now() - renderStartedAt;
    selectionRenderedWithModelRef.current = selectionRef.current;
    writeCameraDiagnostics(containerRef.current, state);
    if (containerRef.current) {
      writeBuildMode(containerRef.current, preservedStructuralGrid ? "full-grid-reuse" : "full");
      containerRef.current.dataset.frame3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
      containerRef.current.dataset.frame3dPlateGeometryMs = plateGeometryMs.toFixed(2);
      containerRef.current.dataset.frame3dPlateLayerMs = plateLayerMs.toFixed(2);
      containerRef.current.dataset.frame3dFullRenderMs = renderMs.toFixed(2);
      containerRef.current.dataset.frame3dWebglRenderMs = webglRenderMs.toFixed(2);
      containerRef.current.dataset.frame3dLabelRenderMs = (renderMs - webglRenderMs).toFixed(2);
      containerRef.current.dataset.frame3dDrawCalls = String(state.renderer.info.render.calls);
      containerRef.current.dataset.frame3dSceneObjects = String(geometry.children.length);
      containerRef.current.dataset.frame3dPickTargets = String(selectionPickTargetsRef.current.length);
      containerRef.current.dataset.frame3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
      containerRef.current.dataset.frame3dLabels = String(visibleLabelCount);
    }
    lastBuiltModelRef.current = model;
    rememberBuiltPresentation();
    lastBuiltNodeBoundsRef.current = frame3DNodeBounds(model);
    lastBuiltStructuralGridLayoutRef.current = nextStructuralGridLayout;
    if (pendingAppendRef.current?.model === model) pendingAppendRef.current = null;
    nodeSnapPrewarmRef.current?.();
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
    nodeSnapScreenIndexDirtyRef.current = true;
    const current = modelRef.current;
    const box = sceneBounds(current, visibility);
    const hasGeometry = !box.isEmpty();
    const center = hasGeometry ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const view = viewRequest?.kind ?? "iso";
    const direction = view === "top" ? new THREE.Vector3(0, 0, 1)
      : view === "front" ? new THREE.Vector3(0, -1, 0)
      : view === "side" ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(1.4, 1.4, 1);
    if (view === "top") state.camera.up.set(0, 1, 0);
    else state.camera.up.set(0, 0, 1);
    const distance = hasGeometry ? fittedCameraDistance(
      state.camera, box, direction,
      state.renderer.domElement.clientWidth, state.renderer.domElement.clientHeight,
    ) : 4;
    state.controls.target.copy(center);
    state.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance));
    state.camera.near = Math.max(0.001, distance / 10_000);
    state.camera.far = Math.max(1_000, distance * 100);
    state.camera.updateProjectionMatrix();
    state.controls.update();
    cameraChangeRef.current?.({
      position: state.camera.position.toArray() as [number, number, number],
      target: state.controls.target.toArray() as [number, number, number],
      up: state.camera.up.toArray() as [number, number, number],
    });
    state.renderer.render(state.scene, state.camera);
    renderFrame3DLabels(state, containerRef.current);
    writeCameraDiagnostics(containerRef.current, state);
    nodeSnapPrewarmRef.current?.();
  }, [
    // Een door cameradraaien afgeleide aanzichtsnaam verandert de camera niet.
    fitToken, viewRequest?.token,
  ]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state || !cameraRequest) return;
    nodeSnapScreenIndexDirtyRef.current = true;
    state.camera.position.fromArray(cameraRequest.state.position);
    state.camera.up.fromArray(cameraRequest.state.up);
    state.controls.target.fromArray(cameraRequest.state.target);
    state.camera.updateProjectionMatrix();
    state.controls.update();
    cameraChangeRef.current?.({
      position: state.camera.position.toArray() as [number, number, number],
      target: state.controls.target.toArray() as [number, number, number],
      up: state.camera.up.toArray() as [number, number, number],
    });
    cameraViewChangeRef.current?.(frame3DViewFromCamera(state.camera.position, state.controls.target));
    state.renderer.render(state.scene, state.camera);
    renderFrame3DLabels(state, containerRef.current);
    writeCameraDiagnostics(containerRef.current, state);
    nodeSnapPrewarmRef.current?.();
  }, [cameraRequest?.token]);

  return <div
    className={`frame3d-canvas frame3d-tool-${tool} ${tool.startsWith("support:") || tool === "addMemberLoad" ? "frame3d-tool-support" : ""}`}
    ref={containerRef}
    aria-label={`3D raamwerk · ${viewRequest?.kind ?? currentView}`}
  />;
}
