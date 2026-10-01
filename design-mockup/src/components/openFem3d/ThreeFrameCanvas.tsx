import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addOpenFem3DPlate, addOpenFem3DPlateOpening, openFem3DLoadCaseId, splitOpenFem3DBeam, type OpenFem3DModel, type OpenFem3DPlateBoundarySegment } from "./openFem3dModel";
import { addOpenFem3DLoadPanel } from "./openFem3dLoadPanels";
import { addOpenFem3DLoadPanelMarkers, openFem3DLoadSurfaceObjects } from "./openFem3dLoadPanelVisuals";
import {
  openFem3DLoadCaseColor,
  openFem3DPickThroughDepth,
  openFem3DSolidIntersections,
  openFem3DSurfaceLoadSurface,
} from "./openFem3dLoadSurfaces";
import type { OpenFem3DVisibility } from "./openFem3dVisibility";
import type { OpenFem3DView } from "./openFem3dCommands";
import { addOpenFem3DConditionMarkers, openFem3DConditionMarkerSize } from "./openFem3dMarkers";
import type { StructuralGrid } from "../fem/femTypes";
import type {
  OpenFem3DDiagramPoint,
  OpenFem3DDiagrams,
  OpenFem3DMemberForces,
  OpenFem3DSolveResult,
} from "./openFem3dSolver";
import type { OpenFem3DTool } from "./openFem3dCommands";
import {
  OPEN_FEM_3D_UTILIZATION_COLORS,
  openFem3DUtilizationClass,
  type OpenFem3DUtilization,
} from "./openFem3dUtilization";
import { createOpenFem3DProfileGeometry, openFem3DProfileInstanceScale, openFem3DProfileSection } from "./openFem3dProfileGeometry";
import { openFem3DMemberDisplacementStations } from "./openFem3dDisplacement";
import {
  DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY,
  openFem3DAutoDeformationScale,
  openFem3DDeformationScale,
  type OpenFem3DDeformationDisplay,
} from "./openFem3dDeformationDisplay";
import {
  openFem3DSelectionContains,
  toggleOpenFem3DSelection,
  type OpenFem3DSelection, type OpenFem3DSelectionType, type OpenFem3DSingleSelection,
} from "./openFem3dSelection";
import { openFem3DViewFromCamera, type OpenFem3DCameraState } from "./openFem3dViewSets";
import { openFem3DWorkPlaneOrigin } from "./openFem3dWorkPlane";
import { createOpenFem3DPlateGeometry } from "./openFem3dPlateGeometry";
import { buildOpenFem3DPlateOverlay } from "./openFem3dPlateOverlay";
import type { OpenFem3DPlateMesh } from "./openFem3dPlateMesh";
import type { OpenFem3DPlateQuantity } from "./openFem3dPlateResults";
import { sampleCircularArc3D } from "./openFem3dCircularArc";
import { selectOpenFem3DInScreenBox } from "./openFem3dBoxSelection";
import { findOpenFem3DBeamNearScreenPoint } from "./openFem3dBeamScreenPick";
import { chooseOpenFem3DPick, type OpenFem3DLoadSelectionType } from "./openFem3dPick";
import { openFem3DOrbitPivotShift, openFem3DSelectionPivot } from "./openFem3dOrbitPivot";
import { openFem3DNodeConditionOfTool, type OpenFem3DNodeTarget } from "./openFem3dNodeTools";
import { createOpenFem3DSweptProfilesGeometry, type OpenFem3DSweepInput } from "./openFem3dDeformedSweep";
import type { OpenFem3DEditMeta } from "./openFem3dHistory";
import { useSnapInstellingen, type SnapInstellingen, type SnapSoort } from "../../hooks/useSnapInstellingen";
import { openFem3DGridLayout } from "./openFem3dGrid";
import { wheelAnchor } from "./openFem3dWheelAnchor";
import { kleurGetal, openFem3DProfielKleuring, profielKleurenActief3d } from "../../lib/profielKleur";
import {
  buildOpenFem3DNodeSnapScreenIndex,
  findOpenFem3DNodeAtScreenPoint,
  findOpenFem3DNodeScreenSnap,
  type OpenFem3DNodeSnapScreenIndex,
} from "./openFem3dNodeSnapIndex";
import { kaderModus } from "../../lib/kaderSelectie";
import { escapeActie, isInvoerVeld, volgDialoogBijToets } from "../../lib/escapeToets";
import { erIsEenDialoogOpen } from "../Modal";

// De analytische knoop is een punt, maar in de editor moet hij ook op afstand
// goed aanklikbaar en herkenbaar blijven. De staaf loopt tot het middelpunt van
// deze bol en verdwijnt er dus ruim in: ook onder een schuine kijkhoek ontstaat
// er nergens een zichtbare kier tussen staaf en knoop.
const ANALYTICAL_BEAM_RADIUS_M = 0.035;
const PROFILE_BEAM_RADIUS_M = 0.12;
// Eén klik tot zoveel pixels naast de systeemlijn selecteert de staaf, ook een
// dun buisverband of een profiel van één pixel breed.
const BEAM_PICK_RADIUS_PX = 6;
// Een knoop wint alleen als de klik echt op zijn getekende bol valt; een
// kleine bol krijgt minstens deze straal. De vaste 7 px van vroeger ving in
// een uitgezoomd groot model de klik op de staaf tussen twee knopen.
const NODE_PICK_MIN_RADIUS_PX = 4;
// Bij het plaatsen van een oplegging of een tussenknoop gaat het om de knoop
// (of om niet vlak naast een knoop te splitsen): daar blijft de ruimere zone.
const TOOL_NODE_PICK_RADIUS_PX = 7;
// Verplaatsingsstations langs een vervormde staaf: genoeg voor een vloeiende kromme.
const DEFORMED_STATION_INTERVALS = 24;
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

function buildBeamConnectionIndex(beams: OpenFem3DModel["beams"]): Set<string> {
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

function addNodeToPositionIndex(index: Map<string, number[]>, node: OpenFem3DModel["nodes"][number]) {
  const key = nodePositionBucketKey(node.x, node.y, node.z);
  const ids = index.get(key);
  if (ids) ids.push(node.id);
  else index.set(key, [node.id]);
}

function buildNodePositionIndex(nodes: OpenFem3DModel["nodes"]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  nodes.forEach((node) => addNodeToPositionIndex(index, node));
  return index;
}

function nodeAtPosition(
  index: Map<string, number[]>,
  nodesById: Map<number, OpenFem3DModel["nodes"][number]>,
  position: THREE.Vector3,
): OpenFem3DModel["nodes"][number] | undefined {
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

function openFem3DNodeBounds(model: OpenFem3DModel): THREE.Box3 {
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const node of model.nodes) box.expandByPoint(point.set(node.x, node.y, node.z));
  return box;
}

function indexOpenFem3DNodes(model: OpenFem3DModel): Map<number, OpenFem3DModel["nodes"][number]> {
  const byId = new Map<number, OpenFem3DModel["nodes"][number]>();
  for (const node of model.nodes) byId.set(node.id, node);
  return byId;
}

/** Ongeveer dezelfde 10 px diameter als de 2D-knoop bij passend beeld. */
function visualNodeRadius(model: OpenFem3DModel): number {
  if (model.nodes.length < 2) return 0.035;
  const box = openFem3DNodeBounds(model);
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

function memberAxisArrowPoints(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  axes: ReturnType<typeof memberAxes>,
  axisIndex: number,
  axisLength: number,
): THREE.Vector3[] {
  const tip = origin.clone().addScaledVector(direction, axisLength);
  const side = new THREE.Vector3().crossVectors(direction, axisIndex === 2 ? axes.ex : axes.ez).normalize();
  const wing = Math.min(axisLength * 0.28, 0.09);
  return [
    origin, tip, tip,
    tip.clone().addScaledVector(direction, -wing).addScaledVector(side, -wing * 0.45),
    tip, tip.clone().addScaledVector(direction, -wing).addScaledVector(side, wing * 0.45),
  ];
}

function memberRotation(delta: THREE.Vector3, rollAngleRad = 0): THREE.Quaternion {
  const { ex, ey, ez } = memberAxes(delta, rollAngleRad);
  // ExtrudeGeometry: contour-x → lokale y, contour-y → lokale z,
  // extrusie-z → lokale x (de staafas). Dezelfde Z-up afspraak als de kern.
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ey, ez, ex));
}

function sceneBounds(
  model: OpenFem3DModel,
  visibility: OpenFem3DVisibility,
): THREE.Box3 {
  const box = openFem3DNodeBounds(model);
  // Fit view focuses on the structural model. A project grid can deliberately
  // extend far beyond a small starter frame; including it here shrank the
  // actual model to a thumbnail even though all geometry technically fitted.
  // Grid geometry remains visible wherever it crosses the current view.
  let padding = visualNodeRadius(model);
  if (visibility.profiles) {
    for (const beam of model.beams) {
      const profile = openFem3DProfileSection(beam.profileName);
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
  model: OpenFem3DModel;
  /** Zelfde geometrie met vluchtige automatische lasten, alleen voor symbolen. */
  conditionModel?: OpenFem3DModel;
  onChange: (model: OpenFem3DModel, meta?: OpenFem3DEditMeta) => void;
  onDrawError?: (message: string | null) => void;
  tool: OpenFem3DTool;
  selection: OpenFem3DSelection;
  onSelect: (selection: OpenFem3DSelection) => void;
  onOpenCheckForBeam?: (beamId: number) => void;
  fitToken: number;
  visibility: OpenFem3DVisibility;
  structuralGrid?: StructuralGrid;
  gridSpacingM?: number;
  /**
   * Hoogte (m) van het werkvlak voor tekenen: het actieve level, standaard
   * peil 0. Een klik in leeg canvas in boven- of scheef aanzicht landt hierop.
   */
  workPlaneZ?: number;
  viewRequest?: { kind: OpenFem3DView; token: number };
  currentView?: OpenFem3DView;
  result?: OpenFem3DSolveResult | null;
  /** Rekennet van de platen voor de weergave "Mesh" zonder resultaat. */
  plateMesh?: OpenFem3DPlateMesh | null;
  /** Grootheid van de plaatcontour; `null` = geen contour. */
  plateQuantity?: OpenFem3DPlateQuantity | null;
  utilizations?: OpenFem3DUtilization[];
  activeLoadCaseId?: number;
  cameraRequest?: { state: OpenFem3DCameraState; token: number };
  onCameraChange?: (state: OpenFem3DCameraState) => void;
  onCameraViewChange?: (view: OpenFem3DView) => void;
  /** Soort per belastinggeval ("dead", "live", ...): de kleur van zijn lastvlakken. */
  loadCaseTypes?: ReadonlyMap<number, string>;
  /** Escape zet een lopend gereedschap terug op Selecteren. */
  onToolChange?: (tool: OpenFem3DTool) => void;
  /**
   * Oplegging- of veergereedschap: de klik landde op een knoop of op een punt
   * van het werkvlak (leeg canvas). De aanroeper zet er de voorwaarde, zo nodig
   * met een nieuwe knoop, in één modelwijziging.
   */
  onPlaceNodeCondition?: (target: OpenFem3DNodeTarget) => void;
  /** Vergroting van de vervormde vorm en het onvervormde model erachter (weergavevoorkeur). */
  deformationDisplay?: OpenFem3DDeformationDisplay;
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

function renderOpenFem3DLabels(state: SceneState, container: HTMLElement | null) {
  state.labelRenderer.render(state.scene, state.camera);
  const layer = state.labelRenderer.domElement;
  const labels = Array.from(layer.querySelectorAll<HTMLElement>(
    ".open-fem3d-result-label, .open-fem3d-utilization-label, .open-fem3d-profile-label, .open-fem3d-local-axis-label, "
    + ".open-fem3d-axis-label, .open-fem3d-node-label, .open-fem3d-beam-number, .open-fem3d-grid-label",
  ));
  if (labels.length === 0) {
    if (container) {
      container.dataset.openFem3dOverlayLabelsShown = "0";
      container.dataset.openFem3dOverlayLabelsHidden = "0";
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
    ".open-fem3d-stage-header, .open-fem3d-stage-footer, .open-fem3d-fit, "
    + ".open-fem3d-draw-error, .open-fem3d-transform-panel, .open-fem3d-uc-legend, .open-fem3d-profiel-legenda",
  ) ?? []).map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0);
  const priority = (label: HTMLElement) => label.classList.contains("open-fem3d-utilization-fail") ? 0
    : label.classList.contains("open-fem3d-diagram-peak-label") ? 1
      : label.classList.contains("open-fem3d-diagram-label") ? 2
        : label.classList.contains("open-fem3d-result-label") ? 3
          : label.classList.contains("open-fem3d-axis-label") ? 4
            : label.classList.contains("open-fem3d-utilization-label") ? 5
              : label.classList.contains("open-fem3d-node-label")
                || label.classList.contains("open-fem3d-beam-number") ? 6 : 7;
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
    container.dataset.openFem3dOverlayLabelsShown = String(accepted.length);
    container.dataset.openFem3dOverlayLabelsHidden = String(hidden);
    container.dataset.openFem3dOverlayLayoutMs = (performance.now() - startedAt).toFixed(2);
  }
}

function writeCameraDiagnostics(container: HTMLElement | null, state: SceneState) {
  if (!container) return;
  const value = (vector: THREE.Vector3) => vector.toArray().map((component) => component.toFixed(6)).join(",");
  container.dataset.openFem3dCameraPosition = value(state.camera.position);
  container.dataset.openFem3dCameraTarget = value(state.controls.target);
  container.dataset.openFem3dCameraUp = value(state.camera.up);
}

function writeBuildMode(container: HTMLElement, mode: string) {
  container.dataset.openFem3dBuildMode = mode;
  const history = (container.dataset.openFem3dBuildHistory ?? "").split(",").filter(Boolean);
  history.push(mode);
  container.dataset.openFem3dBuildHistory = history.slice(-8).join(",");
}

function sameOpenFem3DVisibility(a: OpenFem3DVisibility, b: OpenFem3DVisibility): boolean {
  return (Object.keys(a) as (keyof OpenFem3DVisibility)[]).every((key) => a[key] === b[key]);
}

function sameOpenFem3DNodes(a: OpenFem3DModel["nodes"], b: OpenFem3DModel["nodes"]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((node, index) => {
    const other = b[index];
    return node.id === other.id && node.x === other.x && node.y === other.y && node.z === other.z;
  });
}

function sameOpenFem3DEntities<T>(a: readonly T[] | undefined, b: readonly T[] | undefined): boolean {
  if (a === b) return true;
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) =>
    value === right[index] || JSON.stringify(value) === JSON.stringify(right[index]));
}

function sameVisibleConditionLoads(
  current: OpenFem3DModel | undefined,
  previous: OpenFem3DModel | undefined,
  activeLoadCaseId: number | undefined,
): boolean {
  if (!current || !previous) return false;
  const visible = <T extends { caseId?: number }>(loads: readonly T[] | undefined) =>
    activeLoadCaseId === undefined ? loads : loads?.filter((load) => openFem3DLoadCaseId(load) === activeLoadCaseId);
  return sameOpenFem3DEntities(visible(current.loads), visible(previous.loads))
    && sameOpenFem3DEntities(visible(current.memberLoads), visible(previous.memberLoads))
    && sameOpenFem3DEntities(visible(current.memberPointLoads), visible(previous.memberPointLoads))
    && sameOpenFem3DEntities(visible(current.thermalLoads), visible(previous.thermalLoads));
}

interface PlateSketch {
  nodeIds: number[];
  segments: OpenFem3DPlateBoundarySegment[];
  firstNodeId: number | null;
  lastNodeId: number | null;
  arcControlNodeId: number | null;
}

const emptyPlateSketch = (): PlateSketch => ({
  nodeIds: [], segments: [], firstNodeId: null, lastNodeId: null, arcControlNodeId: null,
});

const isOpeningTool = (tool: OpenFem3DTool) => tool === "addOpening" || tool === "addOpeningArc";
const isArcBoundaryTool = (tool: OpenFem3DTool) => tool === "addPlateArc" || tool === "addOpeningArc";
/** Een belastingvlak wordt getekend zoals een plaat: hoekknopen aanklikken tot de contour sluit. */
const isPlateSketchTool = (tool: OpenFem3DTool) => tool === "addPlate" || tool === "addPlateArc" || tool === "addLoadPanel";

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

// Een belastingvlak is selecteerbaar maar geen "last" in de pickvolgorde: zijn
// vlak ligt over de liggers heen en mag een klik op een staaf niet stelen.
const SELECTABLE_TYPES = new Set<OpenFem3DSelectionType>([
  "node", "beam", "plate", "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad", "loadPanel",
]);
const LOAD_SELECTION_TYPES = new Set<OpenFem3DSelectionType>([
  "nodalLoad", "memberLoad", "memberPointLoad", "thermalLoad", "surfaceLoad",
]);

function selectedIdsForType(selection: OpenFem3DSelection, type: OpenFem3DSelectionType): readonly number[] {
  if (!selection) return [];
  if (selection.type === type) return [selection.id];
  if (selection.type !== "multi") return [];
  if (type === "node") return selection.nodeIds;
  if (type === "beam") return selection.beamIds;
  if (type === "plate") return selection.plateIds ?? [];
  return [];
}

/** Werk alleen de materiaalkleur bij; selecteren mag de zware profielgeometrie niet opnieuw bouwen. */
function applySelectionHighlight(group: THREE.Group, selection: OpenFem3DSelection) {
  group.traverse((object) => {
    const type = object.userData.type as OpenFem3DSelectionType | undefined;
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
    const selected = openFem3DSelectionContains(selection, type, id);
    materials.forEach((material, index) => {
      const colored = material as THREE.Material & { color?: THREE.Color };
      if (!colored.color) return;
      if (baseColors[index] === undefined) baseColors[index] = colored.color.getHex();
    });
    if (object.userData.openFem3dSelected === selected) return;
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
    object.userData.openFem3dSelected = selected;
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
  if (follow) label.userData.openFem3dFollow = follow;
  return label;
}

type DiagramComponent = "shearY" | "shearZ" | "momentY" | "momentZ";

const DIAGRAM_STYLE: Record<DiagramComponent, {
  symbol: string;
  unit: string;
  color: number;
  resultKey: keyof OpenFem3DDiagrams;
  fallbackValues: (force: OpenFem3DMemberForces) => [number, number];
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
  result: OpenFem3DSolveResult,
  component: DiagramComponent,
  force: OpenFem3DMemberForces,
): OpenFem3DDiagramPoint[] {
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
  samples: readonly OpenFem3DDiagramPoint[],
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
    fill.userData = { type: "beam", id: beamId, openFem3dResult: true };
    group.add(fill);

    const zeroLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([start, end]),
      new THREE.LineDashedMaterial({ color: style.color, dashSize: 0.18, gapSize: 0.1, opacity: 0.55, transparent: true }),
    );
    zeroLine.computeLineDistances();
    zeroLine.userData = { type: "beam", id: beamId, openFem3dResult: true };
    group.add(zeroLine);
    const curve = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(diagramPoints),
      new THREE.LineBasicMaterial({ color: style.color }),
    );
    curve.userData = { type: "beam", id: beamId, openFem3dResult: true };
    group.add(curve);
  }

  // De tekst toont de echte eindwaarden, maar staat iets binnen de staaf. Op
  // een gedeelde knoop zouden alle staafeindlabels anders exact over elkaar
  // vallen. De diagramlijn zelf blijft gewoon tot beide knopen doorlopen.
  if (!showLabels) return;
  const labelClass = `open-fem3d-result-label open-fem3d-diagram-label open-fem3d-diagram-${style.symbol.toLowerCase()}`;
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
      `${labelClass} open-fem3d-diagram-peak-label`,
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

/**
 * Trek-alleen staven die in de getoonde uitkomst niet meedoen: een grijze
 * stippellijn over de staafas, altijd zichtbaar (ook door het profiel heen).
 */
function addInactiveMemberLines(group: THREE.Group, points: THREE.Vector3[]) {
  if (points.length === 0) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({
    color: 0x6b7280, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.95, depthTest: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.computeLineDistances();
  lines.renderOrder = 10;
  lines.userData = { openFem3dInactiveMembers: true };
  group.add(lines);
}

function addDashedSegments(group: THREE.Group, points: THREE.Vector3[], color = 0x7c8da0) {
  if (points.length === 0) return;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({ color, dashSize: 0.22, gapSize: 0.12, transparent: true, opacity: 0.85 });
  const lines = new THREE.LineSegments(geometry, material);
  lines.computeLineDistances();
  group.add(lines);
}

function structuralGridLayout(model: OpenFem3DModel, grid: StructuralGrid) {
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

function structuralGridLayoutKey(model: OpenFem3DModel, grid: StructuralGrid): string {
  const layout = structuralGridLayout(model, grid);
  return [layout.xMin, layout.xMax, layout.yMin, layout.yMax, layout.zMin, layout.zMax, layout.baseZ].join("|");
}

function addStructuralGrid(group: THREE.Group, model: OpenFem3DModel, grid: StructuralGrid) {
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
      group.add(makeLabel(axis.label, "open-fem3d-grid-label", new THREE.Vector3(x, yMin, baseZ)));
    }
  }
  for (const [index, axis] of (grid.yAxes ?? []).entries()) {
    const y = axis.position / 1000;
    baseSegments.push(new THREE.Vector3(xMin, y, baseZ), new THREE.Vector3(xMax, y, baseZ));
    if (index % yLabelStride === 0) {
      group.add(makeLabel(axis.label, "open-fem3d-grid-label", new THREE.Vector3(xMin, y, baseZ)));
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
      group.add(makeLabel(level.label, "open-fem3d-grid-label open-fem3d-level-label", new THREE.Vector3(xMin, yMin, z)));
    }
  }
  if (grid.zAxes.length === 0) {
    levelSegments.push(new THREE.Vector3(xMin, yMin, zMin), new THREE.Vector3(xMin, yMin, zMax));
  }
  addDashedSegments(group, baseSegments);
  addDashedSegments(group, levelSegments, 0x94a3b8);
}

/**
 * De vervormde vorm als eigen laag: per staaf de verplaatste stations,
 * vergroot met `scale`. Met profielen één doorlopend geveegd profiel voor
 * alle staven samen (openFem3dDeformedSweep), anders een rode lijn per staaf.
 */
function buildDeformedLayer(
  model: OpenFem3DModel,
  result: OpenFem3DSolveResult,
  profiles: boolean,
  scale: number,
): { group: THREE.Group; sweeps: number } {
  const group = new THREE.Group();
  group.userData.openFem3dDeformedLayer = true;
  const byId = indexOpenFem3DNodes(model);
  const sweeps: OpenFem3DSweepInput[] = [];
  for (const beam of model.beams) {
    const start = byId.get(beam.startNodeId);
    const end = byId.get(beam.endNodeId);
    if (!start || !end) continue;
    const points = openFem3DMemberDisplacementStations(model, beam, result, DEFORMED_STATION_INTERVALS).map((station) =>
      new THREE.Vector3(start.x, start.y, start.z)
        .lerp(new THREE.Vector3(end.x, end.y, end.z), station.t)
        .add(new THREE.Vector3(station.ux, station.uy, station.uz).multiplyScalar(scale)));
    if (points.length < 2) continue;
    const section = profiles ? openFem3DProfileSection(beam.profileName) : null;
    if (section) {
      const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
      sweeps.push({ section, points, referenceY: memberAxes(delta, beam.rollAngleRad ?? 0).ey });
    } else {
      group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xdc2626, linewidth: 2 }),
      ));
    }
  }
  const swept = createOpenFem3DSweptProfilesGeometry(sweeps);
  if (swept) {
    group.add(new THREE.Mesh(swept, new THREE.MeshStandardMaterial({
      color: 0xdc2626, transparent: true, opacity: 0.48, depthWrite: false, roughness: 0.65,
    })));
  }
  return { group, sweeps: sweeps.length };
}

type OriginalPresentation = "normal" | "ghost" | "hidden";
// Schimdekking van het onvervormde model achter de vervormde vorm.
const GHOST_OPACITY = 0.3;
const GHOST_SELECTED_OPACITY = 0.6;
const HIDDEN_SELECTED_OPACITY = 0.35;

/**
 * Onvervormde staven en platen achter de vervormde vorm: gewoon, als lichte
 * schim, of weg. "Weg" is volledig doorzichtig maar niet uit de scène: klikken
 * en kaderselectie blijven werken, en een geselecteerd onderdeel blijft
 * zwak zichtbaar. Resultaatdiagrammen en de vervormde laag zelf blijven zoals
 * ze zijn. Geeft terug of er iets veranderde.
 */
function applyOriginalPresentation(root: THREE.Group, mode: OriginalPresentation): boolean {
  let changed = false;
  const visit = (object: THREE.Object3D) => {
    if (object.userData.openFem3dDeformedLayer) return;
    object.children.forEach(visit);
    const type = object.userData.type;
    if ((type !== "beam" && type !== "plate") || object.userData.openFem3dResult) return;
    const material = (object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
    if (!material || Array.isArray(material)) return;
    if ((object.userData.openFem3dPresentation ?? "normal") === mode) return;
    const saved = object.userData.openFem3dPresentationBase as {
      opacity: number; transparent: boolean; depthWrite: boolean; visible: boolean;
      baseOpacity?: number; selectionOpacity?: number;
    } | undefined ?? {
      opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
      visible: object.visible, baseOpacity: object.userData.baseOpacity, selectionOpacity: object.userData.selectionOpacity,
    };
    const setOpacities = (base: number | undefined, selected: number | undefined) => {
      if (base === undefined) delete object.userData.baseOpacity; else object.userData.baseOpacity = base;
      if (selected === undefined) delete object.userData.selectionOpacity; else object.userData.selectionOpacity = selected;
    };
    if (mode === "normal") {
      material.opacity = saved.opacity;
      material.transparent = saved.transparent;
      material.depthWrite = saved.depthWrite;
      object.visible = saved.visible;
      setOpacities(saved.baseOpacity, saved.selectionOpacity);
      delete object.userData.openFem3dPresentationBase;
      if (saved.baseOpacity !== undefined && saved.selectionOpacity !== undefined) {
        material.opacity = object.userData.openFem3dSelected ? saved.selectionOpacity : saved.baseOpacity;
      }
    } else {
      object.userData.openFem3dPresentationBase = saved;
      material.transparent = true;
      material.depthWrite = false;
      if (object instanceof THREE.LineSegments || object instanceof THREE.Line) {
        // Profiel- en plaatranden: dunner als schim, weg als het origineel weg is.
        object.visible = mode === "ghost" && saved.visible;
        material.opacity = saved.opacity * GHOST_OPACITY;
      } else {
        const factor = saved.baseOpacity ?? 1;
        const base = mode === "ghost" ? factor * GHOST_OPACITY : 0;
        const selected = mode === "ghost" ? Math.max(base, GHOST_SELECTED_OPACITY) : HIDDEN_SELECTED_OPACITY;
        setOpacities(base, selected);
        material.opacity = object.userData.openFem3dSelected ? selected : base;
      }
    }
    material.needsUpdate = true;
    object.userData.openFem3dPresentation = mode;
    changed = true;
  };
  root.children.forEach(visit);
  return changed;
}

export default function ThreeFrameCanvas({ model, conditionModel, onChange, onDrawError, tool, selection, onSelect, onOpenCheckForBeam, fitToken, visibility, viewRequest, currentView = "iso", structuralGrid, gridSpacingM = 0.5, workPlaneZ = 0, result, utilizations = [], activeLoadCaseId, cameraRequest, onCameraChange, onCameraViewChange, loadCaseTypes, onToolChange, onPlaceNodeCondition, deformationDisplay, plateMesh = null, plateQuantity = null }: Props) {
  const { t } = useTranslation("ribbon");
  const containerRef = useRef<HTMLDivElement>(null);
  // Een nieuw getekend belastingvlak hoort bij het geval dat nu in beeld is.
  const activeLoadCaseIdRef = useRef(activeLoadCaseId);
  activeLoadCaseIdRef.current = activeLoadCaseId;
  const sceneRef = useRef<SceneState | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const toolChangeRef = useRef(onToolChange);
  toolChangeRef.current = onToolChange;
  const placeNodeConditionRef = useRef(onPlaceNodeCondition);
  placeNodeConditionRef.current = onPlaceNodeCondition;
  const pendingAppendRef = useRef<{
    baseModel: OpenFem3DModel;
    model: OpenFem3DModel;
    node?: OpenFem3DModel["nodes"][number];
    beam?: OpenFem3DModel["beams"][number];
    plate?: NonNullable<OpenFem3DModel["plates"]>[number];
    replacedPlateId?: number;
  } | null>(null);
  const modelRef = useRef(model);
  const nodeByIdRef = useRef<Map<number, OpenFem3DModel["nodes"][number]> | null>(null);
  const nodePositionIndexRef = useRef<Map<string, number[]> | null>(null);
  const nodeSnapScreenIndexRef = useRef<OpenFem3DNodeSnapScreenIndex | null>(null);
  const nodeSnapScreenIndexDirtyRef = useRef(true);
  const nodeSnapPrewarmRef = useRef<(() => void) | null>(null);
  const nodeSnapPrewarmFrameRef = useRef(0);
  const beamByIdRef = useRef<Map<number, OpenFem3DModel["beams"][number]> | null>(null);
  const beamConnectionIndexRef = useRef<Set<string> | null>(null);
  const plateByIdRef = useRef<Map<number, NonNullable<OpenFem3DModel["plates"]>[number]> | null>(null);
  const nextNodeIdRef = useRef(1);
  const nextBeamIdRef = useRef(1);
  if (nodeByIdRef.current === null) {
    nodeByIdRef.current = indexOpenFem3DNodes(model);
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
        nodeByIdRef.current = indexOpenFem3DNodes(model);
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
  const workPlaneZRef = useRef(workPlaneZ);
  workPlaneZRef.current = workPlaneZ;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const selectionRenderedWithModelRef = useRef<OpenFem3DSelection | undefined>(undefined);
  const nodePickTargetsRef = useRef<THREE.Object3D[]>([]);
  const selectionPickTargetsRef = useRef<THREE.Object3D[]>([]);
  const nonNodePickTargetsRef = useRef<THREE.Object3D[]>([]);
  const lastBuiltModelRef = useRef<OpenFem3DModel | null>(null);
  const lastBuiltConditionModelRef = useRef<OpenFem3DModel | undefined>(undefined);
  const lastBuiltStructuralGridLayoutRef = useRef<string | null>(null);
  const lastBuiltPresentationRef = useRef<{
    visibility: OpenFem3DVisibility;
    structuralGrid: StructuralGrid | undefined;
    result: OpenFem3DSolveResult | null | undefined;
    utilizations: OpenFem3DUtilization[];
    activeLoadCaseId: number | undefined;
  } | null>(null);
  const lastBuiltNodeBoundsRef = useRef<THREE.Box3 | null>(null);
  // Profielen in kleur (lib/profielKleur.ts). De kleur van een staaf hangt af
  // van ALLE profielen in het model (gesorteerd), dus een staaf met een nieuw
  // profiel kan andere staven laten verkleuren: dan geen snelle toevoeg- of
  // verwijderpaden maar een volledige opbouw (zie `profielKleurenStabiel`).
  const profielKleuren = useMemo(
    () => (profielKleurenActief3d(visibility, utilizations.length) ? openFem3DProfielKleuring(model.beams) : null),
    [visibility, utilizations.length, model.beams],
  );
  const profielKleurSleutel = profielKleuren ? profielKleuren.regels.map((regel) => regel.sleutel).join("\u0001") : "";
  const lastBuiltProfielKleurSleutelRef = useRef("");
  /** De basiskleur van een staaf: UC-klasse, anders profielkleur, anders het standaardblauw. */
  const staafKleur = (beamId: number, utilizationClass?: ReturnType<typeof openFem3DUtilizationClass>) => {
    if (utilizationClass) return OPEN_FEM_3D_UTILIZATION_COLORS[utilizationClass];
    const regel = profielKleuren?.perStaaf.get(beamId);
    return regel ? kleurGetal(regel.kleur3d) : 0x2563eb;
  };
  const visualNodeRadiusRef = useRef(0.035);
  const plateDraftRef = useRef<PlateSketch>(emptyPlateSketch());
  const openingDraftRef = useRef<PlateSketch>(emptyPlateSketch());
  const redrawDraftContourRef = useRef<((sketch: PlateSketch | null, opening?: boolean) => void) | null>(null);
  const plateDraftCreatedNodesRef = useRef<Set<number>>(new Set());
  const openingDraftCreatedNodesRef = useRef<Set<number>>(new Set());
  const plateHistoryGroupRef = useRef<string | null>(null);
  const openingHistoryGroupRef = useRef<string | null>(null);
  const beamStartRef = useRef<number | null>(null);
  const beamPlaneRef = useRef<THREE.Plane | null>(null);
  const platePlaneRef = useRef<THREE.Plane | null>(null);
  const openingPlateRef = useRef<number | null>(null);
  useEffect(() => {
    // Ongedaan maken kan plaatsvinden terwijl een contour nog open is.
    // Verwijder dan ook de lokale schets, zodat de volgende klik niet naar
    // inmiddels verdwenen knoopnummers verwijst.
    const existing = new Set(model.nodes.map((node) => node.id));
    if (beamStartRef.current !== null && !existing.has(beamStartRef.current)) {
      beamStartRef.current = null;
      beamPlaneRef.current = null;
    }
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
    if (plateDraftRef.current.firstNodeId === null) platePlaneRef.current = null;
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
    lastBuiltProfielKleurSleutelRef.current = profielKleurSleutel;
  };
  const discardDraftNodes = (
    createdNodeIds: Set<number>, historyGroupRef: { current: string | null }, preserveHistoryGroup = false,
  ) => {
    const historyGroup = historyGroupRef.current;
    if (!preserveHistoryGroup) historyGroupRef.current = null;
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
    changeRef.current(next, { historyGroup: historyGroup ?? undefined, cancelHistoryGroup: !preserveHistoryGroup });
    selectRef.current(null);
  };
  const cancelPendingArcControl = (
    sketchRef: { current: PlateSketch }, createdNodeIds: Set<number>,
    historyGroupRef: { current: string | null }, opening: boolean,
  ) => {
    const controlId = sketchRef.current.arcControlNodeId;
    if (controlId === null) return;
    sketchRef.current = {
      ...sketchRef.current,
      nodeIds: sketchRef.current.nodeIds.filter((id) => id !== controlId),
      arcControlNodeId: null,
    };
    if (createdNodeIds.delete(controlId)) {
      discardDraftNodes(new Set([controlId]), historyGroupRef, true);
    }
    redrawDraftContourRef.current?.(sketchRef.current, opening);
    selectRef.current({ type: "multi", nodeIds: [...sketchRef.current.nodeIds], beamIds: [] });
  };
  const previousToolRef = useRef(tool);
  useEffect(() => {
    const previousTool = previousToolRef.current;
    if (previousTool !== tool) drawErrorRef.current?.(null);
    const plateTools: OpenFem3DTool[] = ["addPlate", "addPlateArc"];
    const openingTools: OpenFem3DTool[] = ["addOpening", "addOpeningArc"];
    // Plaat en belastingvlak delen de schets, maar een halve plaatcontour
    // (met boogstuurpunten) mag geen belastingvlak worden en andersom.
    const sameSketchFamily = (plateTools.includes(previousTool) && plateTools.includes(tool))
      || (previousTool === "addLoadPanel" && tool === "addLoadPanel");
    if (previousTool === "addPlateArc" && tool === "addPlate") {
      cancelPendingArcControl(plateDraftRef, plateDraftCreatedNodesRef.current, plateHistoryGroupRef, false);
    }
    if (previousTool === "addOpeningArc" && tool === "addOpening") {
      cancelPendingArcControl(openingDraftRef, openingDraftCreatedNodesRef.current, openingHistoryGroupRef, true);
    }
    if (!sameSketchFamily) {
      discardDraftNodes(plateDraftCreatedNodesRef.current, plateHistoryGroupRef);
      plateDraftRef.current = emptyPlateSketch();
      platePlaneRef.current = null;
    }
    if (!(openingTools.includes(previousTool) && openingTools.includes(tool))) {
      discardDraftNodes(openingDraftCreatedNodesRef.current, openingHistoryGroupRef);
      openingDraftRef.current = emptyPlateSketch();
    }
    if (tool !== "addBeam") {
      beamStartRef.current = null;
      beamPlaneRef.current = null;
    }
    previousToolRef.current = tool;
    if (openingTools.includes(tool)) {
      if (!openingTools.includes(previousTool) && selection?.type === "plate") openingPlateRef.current = selection.id;
    } else {
      openingPlateRef.current = null;
    }
    const state = sceneRef.current;
    if (state) {
      hidePreview(state.preview);
      if (!(isPlateSketchTool(tool) || openingTools.includes(tool))) state.draftLine.visible = false;
      state.previewHint.hidden = true;
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
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
    labelRenderer.domElement.className = "open-fem3d-label-layer";
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
      makeLabel("X", "open-fem3d-axis-label open-fem3d-axis-x", new THREE.Vector3(2.25, 0, 0)),
      makeLabel("Y", "open-fem3d-axis-label open-fem3d-axis-y", new THREE.Vector3(0, 2.25, 0)),
      makeLabel("Z", "open-fem3d-axis-label open-fem3d-axis-z", new THREE.Vector3(0, 0, 2.25)),
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
    container.dataset.openFem3dPlateShaderWarmupMs = (performance.now() - plateWarmupStartedAt).toFixed(2);
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
    previewHint.className = "open-fem3d-snap-hint";
    previewHint.hidden = true;
    container.appendChild(previewHint);
    const selectionBox = document.createElement("div");
    selectionBox.className = "open-fem3d-selection-box";
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
      renderOpenFem3DLabels(sceneRef.current!, container);
      writeCameraDiagnostics(container, sceneRef.current!);
      container.dataset.openFem3dCameraRenderMs = (performance.now() - renderStartedAt).toFixed(2);
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
        container.dataset.openFem3dCameraRenderMs = (performance.now() - renderStartedAt).toFixed(2);
      });
    };
    const saveCamera = () => {
      cameraChangeRef.current?.({
        position: camera.position.toArray() as [number, number, number],
        target: controls.target.toArray() as [number, number, number],
        up: camera.up.toArray() as [number, number, number],
      });
    };
    // OrbitControls meldt bij élke losgelaten muisknop een einde, ook na een
    // gewone linkerklik zonder camerabeweging. Alleen een echte
    // camera-interactie hoeft opnieuw te tekenen en de camera op te slaan.
    let cameraInteractionActive = false;
    // Draaien rond de selectie: het draaipunt en het camera-quaternion van de
    // vorige draaistap. Alleen tijdens roteren, niet bij pannen of zoomen.
    let orbitPivot: { pivot: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;
    const startCameraInteraction = () => {
      cameraInteractionActive = true;
      nodeSnapScreenIndexDirtyRef.current = true;
      labelRenderer.domElement.style.visibility = "hidden";
      container.dataset.openFem3dLabelsSuspended = "true";
    };
    const endCameraInteraction = () => {
      if (!cameraInteractionActive) return;
      cameraInteractionActive = false;
      renderScene();
      labelRenderer.domElement.style.visibility = "visible";
      container.dataset.openFem3dLabelsSuspended = "false";
      saveCamera();
      cameraViewChangeRef.current?.(openFem3DViewFromCamera(camera.position, controls.target));
      nodeSnapPrewarmRef.current?.();
    };
    // OrbitControls draait om zijn doel t. Na elke draaistap verschuiven
    // camera en doel samen over (I − R)(c − t): dan draait het beeld om het
    // midden c van de selectie en blijft c op dezelfde schermplek staan, ook
    // bij de eerste stap (geen sprong naar c). Zie openFem3dOrbitPivot.ts.
    const followOrbitPivot = () => {
      if (!orbitPivot) return;
      const shift = openFem3DOrbitPivotShift(orbitPivot.quaternion, camera.quaternion, orbitPivot.pivot, controls.target);
      camera.position.add(shift);
      controls.target.add(shift);
      orbitPivot.quaternion.copy(camera.quaternion);
    };
    const endControlsInteraction = () => {
      orbitPivot = null;
      endCameraInteraction();
    };
    controls.addEventListener("start", startCameraInteraction);
    controls.addEventListener("change", followOrbitPivot);
    controls.addEventListener("change", renderCameraInteraction);
    // Camera-instellingen gaan pas na de interactie naar React. Tijdens
    // pannen/roteren hoeft daardoor geen componentstate per muispixel mee.
    controls.addEventListener("end", endControlsInteraction);

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
      // Het zoomanker ligt op de cursorstraal, zodat het punt onder de muis
      // blijft staan; zie openFem3dWheelAnchor.ts voor de keuze van de diepte.
      const { point: anchor, source: anchorSource } = wheelAnchor(
        raycaster.ray, hit?.point ?? null, openFem3DNodeBounds(modelRef.current),
        camera.getWorldDirection(new THREE.Vector3()), controls.target,
      );
      const modeScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * modeScale * (event.ctrlKey ? 10 : 1);
      const step = Math.pow(0.95, controls.zoomSpeed * Math.abs(delta * 0.01));
      const distance = camera.position.distanceTo(controls.target);
      const nextDistance = THREE.MathUtils.clamp(
        distance * (delta < 0 ? step : 1 / step),
        Math.max(controls.minDistance, 0.1), controls.maxDistance,
      );
      const scale = nextDistance / distance;
      // Een wielstap tijdens het draaien hoort bij die interactie; die sluit
      // zelf af bij het loslaten van de muisknop.
      const withinInteraction = cameraInteractionActive;
      startCameraInteraction();
      camera.position.sub(anchor).multiplyScalar(scale).add(anchor);
      controls.target.sub(anchor).multiplyScalar(scale).add(anchor);
      controls.update();
      if (!withinInteraction) endCameraInteraction();
      container.dataset.openFem3dWheelAnchor = anchorSource;
      container.dataset.openFem3dWheelMs = (performance.now() - startedAt).toFixed(2);
    };
    renderer.domElement.addEventListener("wheel", onWheelAnchor, { capture: true, passive: false });
    const drawingAnchor = () => {
      const sketch = isOpeningTool(toolRef.current) ? openingDraftRef.current : plateDraftRef.current;
      const nodeId = toolRef.current === "addBeam" ? beamStartRef.current : sketch.firstNodeId;
      return nodeId === null ? undefined : nodeByIdRef.current!.get(nodeId);
    };
    const platePlane = (plate: NonNullable<OpenFem3DModel["plates"]>[number]): THREE.Plane | null => {
      const nodes = plate.nodeIds.map((id) => nodeByIdRef.current!.get(id)).filter(Boolean);
      if (nodes.length < 3) return null;
      const a = new THREE.Vector3(nodes[0]!.x, nodes[0]!.y, nodes[0]!.z);
      const b = new THREE.Vector3(nodes[1]!.x, nodes[1]!.y, nodes[1]!.z);
      for (let index = 2; index < nodes.length; index += 1) {
        const node = nodes[index]!;
        const c = new THREE.Vector3(node.x, node.y, node.z);
        if (new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).lengthSq() > 1e-16) {
          return new THREE.Plane().setFromCoplanarPoints(a, b, c);
        }
      }
      return null;
    };
    const platePlaneForNode = (nodeId: number | undefined): THREE.Plane | null => {
      if (nodeId === undefined) return null;
      for (const plate of plateByIdRef.current!.values()) {
        if (!plate.nodeIds.includes(nodeId)
          && !plate.openings?.some((opening) => opening.nodeIds.includes(nodeId))) continue;
        const plane = platePlane(plate);
        if (plane) return plane;
      }
      return null;
    };
    const platePlaneFromHit = (hit: THREE.Intersection<THREE.Object3D> | undefined): THREE.Plane | null => {
      if (!hit || hit.object.userData.type !== "plate") return null;
      const instanceIds = hit.object.userData.instanceIds as number[] | undefined;
      const id = instanceIds && hit.instanceId !== undefined
        ? instanceIds[hit.instanceId] : hit.object.userData.id as number | undefined;
      const plate = id === undefined ? undefined : plateByIdRef.current!.get(id);
      return plate ? platePlane(plate) : null;
    };
    const drawingPlane = (nearNodeId?: number, pointedPlatePlane?: THREE.Plane | null) => {
      const anchor = drawingAnchor();
      // De echte camerastand bepaalt het tekenvlak. Een opgeslagen vooraanzicht
      // kan immers later schuin zijn gedraaid; de oude aanzichtsnaam mag dan
      // geen onzichtbaar verticaal werkvlak blijven afdwingen.
      const cameraView = openFem3DViewFromCamera(camera.position, controls.target);
      let view = cameraView;
      // Boven gebruikt XY, voor gebruikt XZ en zij gebruikt YZ. Een vrije
      // 3D-staaf of plaat vanaf een plaatknoop volgt het plaatvlak;
      // anders gebruiken we het horizontale XY-werkvlak op de hoogte van het
      // actieve level (standaard peil 0), niet op de hoogte van het
      // camerarichtpunt: die is na pannen of Passend beeld willekeurig.
      let normal = cameraView === "front" ? new THREE.Vector3(0, 1, 0)
        : cameraView === "side" ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 0, 1);
      const plateSketchTool = isPlateSketchTool(toolRef.current);
      const surfacePlane = cameraView === "iso" && (toolRef.current === "addBeam" || plateSketchTool)
        ? (plateSketchTool ? platePlaneRef.current : beamPlaneRef.current)
          ?? platePlaneForNode(anchor?.id ?? nearNodeId) ?? pointedPlatePlane
        : null;
      if (surfacePlane) {
        normal = surfacePlane.normal.clone();
        const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
        view = ax > ay && ax > az ? "side" : ay > az ? "front" : "top";
      }
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
              const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
              view = ax > ay && ax > az ? "side" : ay > az ? "front" : "top";
              break;
            }
          }
        }
      }
      const workPlaneOrigin = openFem3DWorkPlaneOrigin(cameraView, controls.target, workPlaneZRef.current);
      const origin = anchor
        ? new THREE.Vector3(anchor.x, anchor.y, anchor.z)
        : plateOrigin ?? (surfacePlane ? surfacePlane.coplanarPoint(new THREE.Vector3())
          : new THREE.Vector3(workPlaneOrigin.x, workPlaneOrigin.y, workPlaneOrigin.z));
      container.dataset.openFem3dDrawingPlaneSource = surfacePlane
        ? plateSketchTool ? "sketch-plate" : "beam-plate"
        : anchor ? "anchor" : plateOrigin ? "plate"
          : cameraView === "front" || cameraView === "side" ? "camera" : "level";
      container.dataset.openFem3dDrawingPlaneZ = origin.z.toFixed(6);
      container.dataset.openFem3dDrawingPlaneNormal = `${normal.x.toFixed(4)},${normal.y.toFixed(4)},${normal.z.toFixed(4)}`;
      return { anchor, view, origin, surfaceConstrained: !!surfacePlane,
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin) };
    };
    type DrawingSnap = { position: THREE.Vector3; nodeId?: number; kind?: SnapSoort; plane?: THREE.Plane };
    const ensureNodeSnapScreenIndex = () => {
      const width = Math.max(1, renderer.domElement.clientWidth);
      const height = Math.max(1, renderer.domElement.clientHeight);
      const current = nodeSnapScreenIndexRef.current;
      if (nodeSnapScreenIndexDirtyRef.current || !current || current.width !== width || current.height !== height
        || current.nodeCount !== modelRef.current.nodes.length) {
        camera.updateMatrixWorld();
        nodeSnapScreenIndexRef.current = buildOpenFem3DNodeSnapScreenIndex(
          modelRef.current.nodes, camera, width, height,
        );
        nodeSnapScreenIndexDirtyRef.current = false;
        container.dataset.openFem3dNodeSnapIndexed = String(modelRef.current.nodes.length);
        container.dataset.openFem3dNodeSnapBuckets = String(nodeSnapScreenIndexRef.current.buckets.size);
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
    const drawingSnap = (
      knownPlateHit?: THREE.Intersection<THREE.Object3D>,
      plateHitsAlreadyChecked = false,
    ): DrawingSnap | null => {
      const snapStartedAt = performance.now();
      const finish = (value: DrawingSnap | null) => {
        container.dataset.openFem3dSnapMs = (performance.now() - snapStartedAt).toFixed(2);
        return value;
      };
      delete container.dataset.openFem3dSnapCandidates;
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
        // Projecties van knopen buiten het vastgelegde contourvlak kunnen
        // samenvallen met de zichtbare contour en mogen die niet kromtrekken.
        const contourPlane = openingPlane?.plane
          ?? (isPlateSketchTool(toolRef.current) ? platePlaneRef.current : null);
        const acceptsContourNode = contourPlane ? (id: number) => {
          const node = nodeByIdRef.current!.get(id);
          const plane = contourPlane;
          return !!node && Math.abs(plane.normal.x * node.x + plane.normal.y * node.y
            + plane.normal.z * node.z + plane.constant) <= 1e-5;
        } : undefined;
        const nodeHit = findOpenFem3DNodeScreenSnap(index, xPx, yPx, 14, excludedNodeId, acceptsContourNode);
        container.dataset.openFem3dNodeSnapCandidates = String(nodeHit?.candidateCount ?? 0);
        if (nodeHit) {
          const node = nodeByIdRef.current!.get(nodeHit.point.id);
          if (node) return finish({ position: new THREE.Vector3(node.x, node.y, node.z), nodeId: node.id, kind: "knoop" });
        }
      }
      const nearPlateNodeId = toolRef.current === "addBeam" && !settings.knoop
        ? findOpenFem3DNodeScreenSnap(
            ensureNodeSnapScreenIndex(),
            (pointer.x + 1) * renderer.domElement.clientWidth / 2,
            (1 - pointer.y) * renderer.domElement.clientHeight / 2,
          )?.point.id
        : undefined;
      let pointedPlatePlane = platePlaneFromHit(knownPlateHit);
      const plateSketchTool = isPlateSketchTool(toolRef.current);
      if (!pointedPlatePlane && !plateHitsAlreadyChecked
        && ((toolRef.current === "addBeam" && !beamPlaneRef.current)
          || (plateSketchTool && !platePlaneRef.current))
        && openFem3DViewFromCamera(camera.position, controls.target) === "iso") {
        const plateTargets = selectionPickTargetsRef.current.filter((target) =>
          target.userData.type === "plate" && target.visible);
        pointedPlatePlane = platePlaneFromHit(raycaster.intersectObjects(plateTargets, false)[0]);
      }
      const { view, origin, plane, surfaceConstrained } = openingPlane ?? drawingPlane(nearPlateNodeId, pointedPlatePlane);
      const position = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, position)) return finish(null);
      const raw = position.clone();
      const onDrawingPlane = (candidate: THREE.Vector3) => {
        if (!openingPlane && !surfaceConstrained) return candidate;
        // Raster- en stramiensnap wijzigen coördinaten na de ray-plane
        // doorsnijding. Houd een opening, plaat of staaf op een schuine plaat toch
        // in het actieve plaatvlak door de diepte-as opnieuw op te lossen.
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
        container.dataset.openFem3dSnapCandidates = String(candidates.length);
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
          return finish({ position: onDrawingPlane(nearest.point), kind: "stramien",
            plane: toolRef.current === "addBeam" ? plane.clone() : undefined });
        }
      }
      if (settings.raster) {
        const spacing = Math.max(0.001, gridSpacingRef.current);
        const round = (value: number) => Math.round(value / spacing) * spacing;
        if (view === "front") position.set(round(raw.x), origin.y, round(raw.z));
        else if (view === "side") position.set(origin.x, round(raw.y), round(raw.z));
        else position.set(round(raw.x), round(raw.y), origin.z);
        return finish({ position: onDrawingPlane(position), kind: "raster",
          plane: toolRef.current === "addBeam" ? plane.clone() : undefined });
      }
      return finish({ position: raw, plane: toolRef.current === "addBeam" ? plane.clone() : undefined });
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
      container.dataset.openFem3dDraftSegments = String(sketch?.segments.length ?? 0);
      container.dataset.openFem3dDraftVertices = String(vertices.length);
    };
    redrawDraftContourRef.current = drawDraftContour;
    let previewFrame = 0;
    let latestPointerEvent: PointerEvent | null = null;
    const drawPointerPreview = () => {
      const previewStartedAt = performance.now();
      previewFrame = 0;
      const event = latestPointerEvent;
      latestPointerEvent = null;
      if (!event) return;
      const activeTool = toolRef.current;
      if (activeTool !== "addBeam" && !isPlateSketchTool(activeTool) && !isOpeningTool(activeTool)) return;
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
          previewHint.className = `open-fem3d-snap-hint open-fem3d-snap-${target.kind}`;
          previewHint.style.left = `${event.clientX - rect.left}px`;
          previewHint.style.top = `${event.clientY - rect.top}px`;
          previewHint.hidden = false;
        }
      }
      renderer.render(scene, camera);
      container.dataset.openFem3dPreviewMs = (performance.now() - previewStartedAt).toFixed(2);
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
      // CAD: naar rechts slepen is een venster, naar links een crossing.
      selectionBox.dataset.modus = kaderModus(down.x, x);
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
        // Rechts slepen draait (midden met Ctrl/Shift ook). Met een selectie
        // draait het beeld om het midden daarvan; zonder selectie, of met een
        // draaipunt achter de camera, blijft het gewone draaien om het doel.
        const modifier = event.ctrlKey || event.metaKey || event.shiftKey;
        const rotates = event.button === 2 ? !modifier : event.button === 1 && modifier;
        orbitPivot = null;
        if (rotates && controls.enabled && controls.enableRotate) {
          const pivot = openFem3DSelectionPivot(modelRef.current, selectionRef.current);
          camera.updateMatrixWorld();
          if (pivot && pivot.clone().applyMatrix4(camera.matrixWorldInverse).z < 0) {
            orbitPivot = { pivot, quaternion: camera.quaternion.clone() };
          }
        }
        container.dataset.openFem3dOrbitPivot = orbitPivot
          ? orbitPivot.pivot.toArray().map((value) => value.toFixed(6)).join(",") : "none";
        return;
      }
      down = { x: event.clientX, y: event.clientY,
        additive: event.shiftKey || event.ctrlKey || event.metaKey };
      if (toolRef.current === "select") renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerCancel = () => {
      down = null;
      orbitPivot = null;
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
        const mode = kaderModus(down.x, event.clientX);
        selectRef.current(selectOpenFem3DInScreenBox(
          modelRef.current, selectionPickTargetsRef.current, camera,
          rect.width, rect.height, box, selectionRef.current, down.additive,
          visibilityRef.current.nodes, mode,
        ));
        container.dataset.openFem3dBoxSelectMode = mode;
        container.dataset.openFem3dBoxSelectMs = (performance.now() - startedAt).toFixed(2);
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
      const activeTool = toolRef.current;
      // Raycast alleen tegen objecten die werkelijk selecteerbaar zijn. Labels,
      // rasters en resultaatlijnen hoeven bij grote modellen niet bij iedere
      // klik opnieuw doorzocht te worden.
      const pickStartedAt = performance.now();
      const intersections = raycaster.intersectObjects(nonNodePickTargetsRef.current, false);
      container.dataset.openFem3dPickCandidates = intersections.slice(0, 6).map((candidate) =>
        `${String(candidate.object.userData.type ?? "unknown")}@${candidate.distance.toFixed(3)}`,
      ).join(",");
      // Een licht doorzichtig lastvlak (belastingvlak of oppervlaktelast) mag
      // geen klik stelen van wat erin of er vlak onder ligt: een staaf in het
      // vlak of de plaat onder een oppervlaktelast blijft aanklikbaar. Iets
      // wat ver achter het vlak ligt (een kolom aan de overkant) telt niet;
      // dan klik je bewust op het vlak zelf en selecteer je dat.
      const throughBounds = lastBuiltNodeBoundsRef.current;
      const throughDepth = openFem3DPickThroughDepth(
        throughBounds && !throughBounds.isEmpty() ? throughBounds.getSize(new THREE.Vector3()).length() : 0);
      const solidIntersections = openFem3DSolidIntersections(intersections, throughDepth);
      const throughHit = intersections.find((candidate) => candidate.object.userData.pickThrough === true
        && candidate.object.userData.openFem3dLoadSurface === true)
        ?? intersections.find((candidate) => candidate.object.userData.pickThrough === true);
      // Dezelfde grens voor een knoop of systeemlijn die niet via de straal gevonden is.
      const throughLimitM = throughHit ? throughHit.distance + throughDepth : Number.POSITIVE_INFINITY;
      const identity = (candidate: THREE.Intersection<THREE.Object3D>) => {
        let object: THREE.Object3D | undefined = candidate.object;
        while (object && object !== geometry && typeof object.userData.type !== "string") object = object.parent ?? undefined;
        if (!object) return null;
        const instanceIds = object.userData.instanceIds as number[] | undefined;
        const id = instanceIds && candidate.instanceId !== undefined
          ? instanceIds[candidate.instanceId] : object.userData.id;
        return typeof id === "number" ? { type: object.userData.type as OpenFem3DSelectionType, id } : null;
      };
      // De eerste treffer van elke soort langs de straal.
      let loadHit: { type: OpenFem3DLoadSelectionType; id: number; distance: number } | null = null;
      let rayBeamHit: { id: number; distance: number; point: THREE.Vector3 } | null = null;
      let plateHit: { id: number; distance: number } | null = null;
      for (const candidate of solidIntersections) {
        const found = identity(candidate);
        if (!found) continue;
        if (!loadHit && LOAD_SELECTION_TYPES.has(found.type)) {
          loadHit = { type: found.type as OpenFem3DLoadSelectionType, id: found.id, distance: candidate.distance };
        } else if (!rayBeamHit && found.type === "beam") {
          rayBeamHit = { id: found.id, distance: candidate.distance, point: candidate.point.clone() };
        } else if (!plateHit && found.type === "plate") {
          plateHit = { id: found.id, distance: candidate.distance };
        }
      }
      const nodeIndex = ensureNodeSnapScreenIndex();
      const xPx = (pointer.x + 1) * nodeIndex.width / 2;
      const yPx = (1 - pointer.y) * nodeIndex.height / 2;
      // Een knoop telt alleen als de klik op zijn getekende bol valt (met een
      // minimum van enkele pixels); zo steelt een knoop in een uitgezoomd
      // model niet de klik op de staaf ernaast. Opleggingen plaatsen en
      // tussenknopen zetten houden de ruimere zone.
      const nodeCondition = openFem3DNodeConditionOfTool(activeTool);
      const nodeTool = nodeCondition !== null || activeTool === "addSubNode";
      const pixelsPerMeter = camera.projectionMatrix.elements[5] * nodeIndex.height / 2;
      const nodeRadiusM = visualNodeRadiusRef.current;
      const nodeHit = nodePickTargetsRef.current.some((target) => target.userData.pickable !== false)
        ? findOpenFem3DNodeAtScreenPoint(
            nodeIndex, xPx, yPx,
            (point) => nodeTool ? TOOL_NODE_PICK_RADIUS_PX
              : Math.max(NODE_PICK_MIN_RADIUS_PX, nodeRadiusM * pixelsPerMeter / Math.max(point.viewDepth, 1e-9) + 1),
            48,
          )
        : null;
      const hitNode = nodeHit ? nodeByIdRef.current!.get(nodeHit.point.id) : undefined;
      const beamScreenStartedAt = performance.now();
      // De systeemlijn binnen de klikzone, ook in de profielweergave: een dun
      // verband of een ver weg gelegen ligger is anders maar één pixel breed.
      // Bij het tekenen van een staaf splitst alleen een echte treffer een staaf.
      const beamScreenHit = activeTool !== "addBeam" && visibilityRef.current.beams
        ? findOpenFem3DBeamNearScreenPoint(
            modelRef.current.beams, nodeByIdRef.current!,
            camera, nodeIndex.width, nodeIndex.height, xPx, yPx, BEAM_PICK_RADIUS_PX,
          )
        : null;
      const beamHalfSize = (beamId: number) => {
        if (!visibilityRef.current.profiles) return ANALYTICAL_BEAM_RADIUS_M;
        const section = openFem3DProfileSection(beamByIdRef.current?.get(beamId)?.profileName);
        return section ? Math.hypot(section.widthM, section.heightM) / 2 : PROFILE_BEAM_RADIUS_M;
      };
      const hitPlate = plateHit ? plateByIdRef.current?.get(plateHit.id) : undefined;
      // Voorrang (zie openFem3dPick.ts): een echt geraakt lastteken, dan een
      // knoop onder de klik, dan de staaf onder of vlak naast de cursor, dan
      // de plaat. Diepte beslist tussen elementen achter elkaar.
      const pick = chooseOpenFem3DPick({
        load: loadHit,
        node: nodeHit && hitNode
          && camera.position.distanceTo(new THREE.Vector3(hitNode.x, hitNode.y, hitNode.z)) <= throughLimitM ? {
          id: hitNode.id,
          distance: camera.position.distanceTo(new THREE.Vector3(hitNode.x, hitNode.y, hitNode.z)),
          radiusM: nodeRadiusM,
        } : null,
        rayBeam: rayBeamHit ? { ...rayBeamHit, halfSizeM: beamHalfSize(rayBeamHit.id) } : null,
        lineBeam: beamScreenHit && beamScreenHit.distance <= throughLimitM ? {
          id: beamScreenHit.beamId, distance: beamScreenHit.distance,
          halfSizeM: beamHalfSize(beamScreenHit.beamId), point: beamScreenHit.point,
        } : null,
        plate: plateHit ? { ...plateHit, bandM: (hitPlate?.thicknessM ?? 0) / 2 + 0.25 } : null,
        // Een lastpijl is hoogstens twee markeringsmaten lang. Een last die
        // verder achter de staaf of knoop ligt, hoort bij iets anders.
        loadDepthToleranceM: 2 * openFem3DConditionMarkerSize(modelRef.current.nodes),
      });
      // Niets vóór of in het lastvlak geraakt: de klik selecteert het vlak zelf.
      const throughPick = !pick && throughHit ? identity(throughHit) : null;
      const type = pick?.type ?? throughPick?.type;
      const id = pick?.id ?? throughPick?.id;
      const pickPoint = pick?.point ? new THREE.Vector3(pick.point.x, pick.point.y, pick.point.z) : undefined;
      container.dataset.openFem3dPickMs = (performance.now() - pickStartedAt).toFixed(2);
      container.dataset.openFem3dPickType = String(type ?? "none");
      container.dataset.openFem3dPickId = String(id ?? "none");
      container.dataset.openFem3dPickReason = pick?.reason ?? (throughPick ? "lastvlak" : "none");
      container.dataset.openFem3dPickNodeCandidates = String(nodeHit?.candidateCount ?? 0);
      container.dataset.openFem3dPickNodeDistancePx = nodeHit?.distancePx.toFixed(2) ?? "none";
      container.dataset.openFem3dPickBeamScreen = beamScreenHit
        ? `${beamScreenHit.beamId}@${beamScreenHit.distancePx.toFixed(1)}px` : "none";
      container.dataset.openFem3dPickBeamScreenMs = (performance.now() - beamScreenStartedAt).toFixed(2);
      let current = modelRef.current;
      const commitModel = (next: OpenFem3DModel, appended?: {
        node?: OpenFem3DModel["nodes"][number];
        beam?: OpenFem3DModel["beams"][number];
        plate?: NonNullable<OpenFem3DModel["plates"]>[number];
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
        const historyGroupRef = isPlateSketchTool(activeTool)
          ? plateHistoryGroupRef
          : isOpeningTool(activeTool) ? openingHistoryGroupRef : null;
        if (historyGroupRef && historyGroupRef.current === null) {
          historyGroupRef.current = nextContourHistoryGroup();
        }
        changeRef.current(next, historyGroupRef?.current
          ? { historyGroup: historyGroupRef.current } : undefined);
      };
      const ensureDrawingNode = (): number | null => {
        const plateHit = intersections.find((candidate) => candidate.object.userData.type === "plate");
        const snapped = drawingSnap(plateHit, true);
        if (activeTool === "addBeam" && beamStartRef.current === null && snapped) {
          beamPlaneRef.current = snapped.plane ?? platePlaneForNode(snapped.nodeId);
        }
        if (isPlateSketchTool(activeTool)
          && plateDraftRef.current.firstNodeId === null && snapped) {
          platePlaneRef.current = platePlaneFromHit(plateHit)
            ?? platePlaneForNode(snapped.nodeId) ?? snapped.plane ?? null;
        }
        // De zichtbare knoopsnapzone wint van een staafhit op hetzelfde
        // schermpunt. Een profielraycast op het staafeinde kan anders een
        // bestaande knoop onbedoeld vervangen door een splitsing vlak ernaast.
        if (snapped?.nodeId !== undefined) return snapped.nodeId;
        if (activeTool === "addBeam" && type === "beam" && typeof id === "number" && pickPoint) {
          const beam = beamByIdRef.current!.get(id);
          const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
          const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
          if (beam && start && end) {
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
            const ratio = pickPoint.clone().sub(a).dot(delta) / delta.lengthSq();
            if (ratio <= 1e-6) return start.id;
            if (ratio >= 1 - 1e-6) return end.id;
            const split = splitOpenFem3DBeam(current, beam.id, ratio);
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
        if (isPlateSketchTool(activeTool)) {
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
          if (rememberedStart !== start) {
            beamStartRef.current = null;
            beamPlaneRef.current = null;
          }
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
            beamPlaneRef.current = platePlaneForNode(nodeId) ?? beamPlaneRef.current;
            selectRef.current({ type: "node", id: nodeId });
          }
        }
      } else if (isPlateSketchTool(activeTool)) {
        const nodeId = ensureDrawingNode();
        if (nodeId !== null) {
          drawErrorRef.current?.(null);
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
            } else {
              drawErrorRef.current?.("Het boogstuurpunt valt samen met een contourknoop. Klik verder weg of zet Raster-snap uit.");
            }
          } else if (sketch.lastNodeId !== null && nodeId !== sketch.lastNodeId) {
            const closes = nodeId === sketch.firstNodeId;
            if (!closes && sketch.nodeIds.includes(nodeId)) {
              drawErrorRef.current?.("Het eindpunt valt samen met een bestaande contourknoop. Klik verder weg of zet Raster-snap uit.");
              down = null;
              return;
            }
            const segment: OpenFem3DPlateBoundarySegment = activeTool === "addPlateArc"
              ? { kind: "arc", startNodeId: sketch.lastNodeId, controlNodeId: sketch.arcControlNodeId!, endNodeId: nodeId }
              : { kind: "line", startNodeId: sketch.lastNodeId, endNodeId: nodeId };
            const segments = [...sketch.segments, segment];
            const nodeIds = closes ? sketch.nodeIds : [...sketch.nodeIds, nodeId];
            if (closes && segments.length >= 2 && nodeIds.length >= 3) {
              let committed = false;
              try {
                if (activeTool === "addLoadPanel") {
                  // Geen stijfheid, alleen lastafdracht: q, geval en afdracht
                  // staan daarna in het eigenschappenpaneel.
                  const next = addOpenFem3DLoadPanel(current, nodeIds, { caseId: activeLoadCaseIdRef.current });
                  const addedPanel = next.loadPanels?.[next.loadPanels.length - 1];
                  commitModel(next);
                  committed = true;
                  drawErrorRef.current?.(null);
                  if (addedPanel) selectRef.current({ type: "loadPanel", id: addedPanel.id });
                } else {
                  const next = addOpenFem3DPlate(current, nodeIds, {
                    thicknessM: 0.2,
                    material: "C30/37",
                    boundary: segments,
                  });
                  const addedPlate = next.plates?.[next.plates.length - 1];
                  commitModel(next, { plate: addedPlate });
                  committed = true;
                  drawErrorRef.current?.(null);
                  if (addedPlate) selectRef.current({ type: "plate", id: addedPlate.id });
                }
              } catch (error) {
                drawErrorRef.current?.(error instanceof Error ? error.message : String(error));
              } finally {
                plateDraftRef.current = emptyPlateSketch();
                platePlaneRef.current = null;
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
          } else if (sketch.lastNodeId !== null) {
            drawErrorRef.current?.("Het eindpunt valt samen met het vorige punt. Klik verder weg of zet Raster-snap uit.");
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
          drawErrorRef.current?.(null);
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
            } else {
              drawErrorRef.current?.("Het boogstuurpunt valt samen met een contourknoop. Klik verder weg of zet Raster-snap uit.");
            }
          } else if (sketch.lastNodeId !== null && nodeId !== sketch.lastNodeId) {
            const closes = nodeId === sketch.firstNodeId;
            if (!closes && sketch.nodeIds.includes(nodeId)) {
              drawErrorRef.current?.("Het eindpunt valt samen met een bestaande contourknoop. Klik verder weg of zet Raster-snap uit.");
              down = null;
              return;
            }
            const segment: OpenFem3DPlateBoundarySegment = isArcBoundaryTool(activeTool)
              ? { kind: "arc", startNodeId: sketch.lastNodeId, controlNodeId: sketch.arcControlNodeId!, endNodeId: nodeId }
              : { kind: "line", startNodeId: sketch.lastNodeId, endNodeId: nodeId };
            const segments = [...sketch.segments, segment];
            const nodeIds = closes ? sketch.nodeIds : [...sketch.nodeIds, nodeId];
            if (closes && segments.length >= 2 && nodeIds.length >= 3) {
              let committed = false;
              try {
                const next = addOpenFem3DPlateOpening(current, openingPlateId, nodeIds, { boundary: segments });
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
          } else if (sketch.lastNodeId !== null) {
            drawErrorRef.current?.("Het eindpunt valt samen met het vorige punt. Klik verder weg of zet Raster-snap uit.");
          }
          const draft = openingDraftRef.current;
          if (draft.firstNodeId !== null) {
            selectRef.current({ type: "multi", nodeIds: [...draft.nodeIds], beamIds: [] });
          }
        }
      } else if (activeTool === "addSubNode") {
        if (type === "beam" && typeof id === "number" && pickPoint) {
          const beam = beamByIdRef.current!.get(id);
          const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
          const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
          if (beam && start && end) {
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const delta = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
            const ratio = pickPoint.clone().sub(a).dot(delta) / delta.lengthSq();
            if (ratio <= 1e-6) selectRef.current({ type: "node", id: start.id });
            else if (ratio >= 1 - 1e-6) selectRef.current({ type: "node", id: end.id });
            else {
              const split = splitOpenFem3DBeam(current, id, ratio);
              changeRef.current(split.model);
              selectRef.current({ type: "node", id: split.nodeId });
            }
          }
        }
      } else if (activeTool === "addMemberLoad") {
        if (type === "beam" && typeof id === "number") {
          selectRef.current({ type: "beam", id });
        }
      } else if (nodeCondition && placeNodeConditionRef.current && (type === "node" || !pick)) {
        // Oplegging of veer: op een knoop, of in leeg canvas op het werkvlak
        // (met knoop-, stramien- en rastersnap zoals bij het tekenen). Een
        // knoop binnen de snapzone krijgt de voorwaarde zelf.
        if (type === "node" && typeof id === "number") {
          placeNodeConditionRef.current({ nodeId: id });
        } else {
          const snapped = drawingSnap();
          if (snapped?.nodeId !== undefined) placeNodeConditionRef.current({ nodeId: snapped.nodeId });
          else if (snapped) {
            placeNodeConditionRef.current({ position: {
              x: cleanDrawingCoordinate(snapped.position.x),
              y: cleanDrawingCoordinate(snapped.position.y),
              z: cleanDrawingCoordinate(snapped.position.z),
            } });
          }
        }
        container.dataset.openFem3dNodeCondition = type === "node" ? "node" : "work-plane";
      } else {
        // De keuze levert altijd een selecteerbaar type (zie openFem3dPick.ts).
        const selectable = type !== undefined && typeof id === "number"
          ? { type, id } as OpenFem3DSingleSelection
          : null;
        selectRef.current(selectable
          ? toggleOpenFem3DSelection(selectionRef.current, selectable, event.shiftKey || event.ctrlKey || event.metaKey)
          : null);
      }
      drawDraftContour(
        isOpeningTool(activeTool)
          ? openingDraftRef.current
          : isPlateSketchTool(activeTool) ? plateDraftRef.current : null,
        isOpeningTool(activeTool),
      );
      hidePreview(preview);
      previewHint.hidden = true;
      renderScene();
      down = null;
    };
    const dialog = volgDialoogBijToets(erIsEenDialoogOpen);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // In een invoerveld hoort Escape bij het veld; een open dialoog sluit
      // eerst zelf. Het tekenvlak blijft dan ongemoeid (zoals in 2D).
      if (event.defaultPrevented || isInvoerVeld(event.target) || dialog.open()) return;
      // Escape breekt het lopende gereedschap af en zet het terug op
      // Selecteren; een tweede Escape in Selecteren heft de selectie op.
      const action = escapeActie(toolRef.current, selectionRef.current !== null);
      drawErrorRef.current?.(null);
      down = null;
      selectionBox.hidden = true;
      discardDraftNodes(plateDraftCreatedNodesRef.current, plateHistoryGroupRef);
      discardDraftNodes(openingDraftCreatedNodesRef.current, openingHistoryGroupRef);
      plateDraftRef.current = emptyPlateSketch();
      platePlaneRef.current = null;
      openingDraftRef.current = emptyPlateSketch();
      beamStartRef.current = null;
      beamPlaneRef.current = null;
      drawDraftContour(null);
      hidePreview(preview);
      previewHint.hidden = true;
      if (action === "naarSelecteren") toolChangeRef.current?.("select");
      else if (action === "selectieOpheffen") selectRef.current(null);
      container.dataset.openFem3dEscape = action;
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
      dialog.stop();
      controls.removeEventListener("start", startCameraInteraction);
      controls.removeEventListener("change", followOrbitPivot);
      controls.removeEventListener("change", renderCameraInteraction);
      controls.removeEventListener("end", endControlsInteraction);
      if (cameraRenderFrame) cancelAnimationFrame(cameraRenderFrame);
      if (nodeSnapPrewarmFrameRef.current) cancelAnimationFrame(nodeSnapPrewarmFrameRef.current);
      nodeSnapPrewarmRef.current = null;
      redrawDraftContourRef.current = null;
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
    const layout = openFem3DGridLayout(model.nodes, gridSpacingM);
    const previous = state.grid.userData.layout as ReturnType<typeof openFem3DGridLayout> | undefined;
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
      containerRef.current.dataset.openFem3dGridSizeM = String(layout.sizeM);
      containerRef.current.dataset.openFem3dGridSpacingM = String(layout.visibleSpacingM);
      containerRef.current.dataset.openFem3dGridDivisions = String(layout.divisions);
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
    // Dezelfde profielen (en dus dezelfde kleuren) als bij de vorige opbouw?
    const profielKleurenStabiel = profielKleurSleutel === lastBuiltProfielKleurSleutelRef.current;
    const visibilityChangedOnly = (...allowedKeys: (keyof OpenFem3DVisibility)[]) =>
      previousPresentation !== null
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).some((key) =>
        allowedKeys.includes(key) && visibility[key] !== previousPresentation.visibility[key])
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).every((key) =>
        allowedKeys.includes(key) || visibility[key] === previousPresentation.visibility[key]);
    const addSurfaceLoadMarkers = (
      group: THREE.Group,
      plateGeometry: (plate: NonNullable<OpenFem3DModel["plates"]>[number]) =>
        ReturnType<typeof createOpenFem3DPlateGeometry>,
    ) => {
      if (!visibility.loads) return;
      const visibleLoads = (model.surfaceLoads ?? []).filter((load) =>
        activeLoadCaseId === undefined || openFem3DLoadCaseId(load) === activeLoadCaseId);
      const stride = visibleLoads.length <= 200 ? 1 : Math.ceil(visibleLoads.length / 24);
      for (const [loadIndex, load] of visibleLoads.entries()) {
        const plate = plateByIdRef.current!.get(load.plateId);
        const built = plate && plateGeometry(plate);
        if (!built) continue;
        const surface = openFem3DSurfaceLoadSurface(model, plate, load, nodeByIdRef.current ?? undefined);
        if (surface) {
          const color = openFem3DLoadCaseColor(loadCaseTypes?.get(openFem3DLoadCaseId(load)));
          for (const object of openFem3DLoadSurfaceObjects(surface, color, { type: "surfaceLoad", id: load.id })) group.add(object);
        }
        const vector = new THREE.Vector3(load.qx, load.qy, load.qz);
        const magnitude = vector.length();
        if (magnitude <= 1e-12) continue;
        const direction = vector.normalize();
        const length = 0.7;
        const arrow = new THREE.ArrowHelper(direction,
          built.surfaceAnchor.clone().addScaledVector(direction, -length), length, 0x0284c7, 0.22, 0.12);
        arrow.traverse((child) => { child.userData = { type: "surfaceLoad", id: load.id }; });
        group.add(arrow);
        if (loadIndex % stride !== 0) continue;
        const components = (["x", "y", "z"] as const)
          .filter((axis) => Math.abs(load[`q${axis}`]) > 1e-12)
          .map((axis) => `q${axis}=${resultValue(load[`q${axis}`])}`);
        const label = makeLabel(
          `${components.join(" · ")} kN/m²`,
          "open-fem3d-result-label open-fem3d-surface-load-label",
          built.surfaceLabelAnchor.clone().addScaledVector(built.normal, 0.12),
        );
        label.element.setAttribute("role", "button");
        label.element.setAttribute("tabindex", "0");
        label.element.setAttribute("title", `Selecteer oppervlaktebelasting ${load.id}`);
        label.element.style.pointerEvents = "auto";
        label.element.addEventListener("pointerdown", (event) => event.stopPropagation());
        label.element.addEventListener("click", (event) => {
          event.stopPropagation();
          selectRef.current(toggleOpenFem3DSelection(
            selectionRef.current, { type: "surfaceLoad", id: load.id },
            event.shiftKey || event.ctrlKey || event.metaKey,
          ));
        });
        label.element.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          selectRef.current(toggleOpenFem3DSelection(
            selectionRef.current, { type: "surfaceLoad", id: load.id },
            event.shiftKey || event.ctrlKey || event.metaKey,
          ));
        });
        group.add(label);
      }
    };
    const addLoadPanelLayer = (group: THREE.Group) => {
      if (!visibility.loads || !visibility.loadPanels) return;
      addOpenFem3DLoadPanelMarkers(group, model, activeLoadCaseId, {
        label: (panel) => t("openFem3d.loadPanel.canvasLabel", {
          id: panel.id,
          q: resultValue(panel.q),
          mode: t(panel.distribution === "oneWay" ? "openFem3d.loadPanel.oneWayShort" : "openFem3d.loadPanel.twoWayShort"),
        }),
        title: (panel) => t("openFem3d.loadPanel.selectTitle", { id: panel.id }),
        onSelect: (id, additive) => selectRef.current(toggleOpenFem3DSelection(
          selectionRef.current, { type: "loadPanel", id }, additive,
        )),
        color: (panel) => openFem3DLoadCaseColor(loadCaseTypes?.get(openFem3DLoadCaseId(panel))),
      });
    };
    /** Vervang alleen de laag met belastingvlakken; geeft het verschil in labels terug. */
    const replaceLoadPanelLayer = () => {
      const old = geometry.children.find((child) => child.userData.openFem3dLoadPanels === true);
      const oldTargets = new Set<THREE.Object3D>();
      let removedLabels = 0;
      if (old instanceof THREE.Group) {
        old.traverse((object) => {
          oldTargets.add(object);
          if (object instanceof CSS2DObject) removedLabels += 1;
        });
        geometry.remove(old);
        disposeGroup(old);
      }
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !oldTargets.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !oldTargets.has(target));
      const next = new THREE.Group();
      next.userData.openFem3dLoadPanels = true;
      addLoadPanelLayer(next);
      geometry.add(next);
      let addedLabels = 0;
      next.traverse((object) => {
        if (object instanceof CSS2DObject) addedLabels += 1;
        if (object.userData.type === "loadPanel" && object.userData.pickable !== false
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          nonNodePickTargetsRef.current.push(object);
        }
      });
      applySelectionHighlight(next, selectionRef.current);
      return addedLabels - removedLabels;
    };
    // De conditielaag kan alleen los worden ververst wanneer de verzameling
    // oppervlaktebelastingen gelijk blijft; wijzigingen krijgen hun eigen pad.
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
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "scene-guides");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
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
      ? geometry.children.find((child) => child.userData.openFem3dStructuralGrid === true)
      : undefined;
    if (structuralGridVisibilityOnly && existingStructuralGrid && structuralGrid?.enabled
      && structuralGridLayoutKey(model, structuralGrid) === lastBuiltStructuralGridLayoutRef.current) {
      existingStructuralGrid.visible = visibility.structuralGrid;
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "structural-grid-visibility");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
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
      ? geometry.children.find((child) => child.userData.openFem3dMemberAxes === true)
      : undefined;
    if (memberAxesVisibilityOnly && existingMemberAxes) {
      existingMemberAxes.visible = visibility.memberAxes;
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "member-axes-visibility");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
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
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).every((key) =>
        key === "nodeNumbers" || key === "nodeCoordinates" || key === "beamNumbers"
          || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    if (annotationLabelsOnly) {
      const oldLabels = geometry.children.filter((child) => child instanceof CSS2DObject
        && (nodeLabelsChanged && child.element.classList.contains("open-fem3d-node-label")
          || beamLabelsChanged && child.element.classList.contains("open-fem3d-beam-number")));
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
          geometry.add(makeLabel(parts.join(" · "), "open-fem3d-node-label",
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
          geometry.add(makeLabel(`(${beam.id})`, "open-fem3d-beam-number", midpoint, { type: "beam", id: beam.id }));
          addedLabels += 1;
        });
      }
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        const oldCount = Number(containerRef.current.dataset.openFem3dLabels ?? 0);
        containerRef.current.dataset.openFem3dLabels = String(Math.max(0, oldCount - oldLabels.length + addedLabels));
        containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
        writeBuildMode(containerRef.current, nodeLabelsChanged && beamLabelsChanged ? "labels"
          : nodeLabelsChanged ? "node-labels" : "beam-labels");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
      }
      return;
    }
    const nodeVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.nodes !== previousPresentation.visibility.nodes
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).every((key) =>
        key === "nodes" || visibility[key] === previousPresentation.visibility[key])
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && conditionModel === lastBuiltConditionModelRef.current;
    const nodeVisual = nodeVisibilityOnly
      ? geometry.children.find((child) => child.userData.openFem3dNodeVisual === true)
      : undefined;
    if (nodeVisibilityOnly && nodeVisual) {
      nodeVisual.visible = visibility.nodes;
      nodePickTargetsRef.current.forEach((target) => { target.userData.pickable = visibility.nodes; });
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "node-visibility");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
      }
      return;
    }
    const beamVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.beams !== previousPresentation.visibility.beams
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).every((key) =>
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
        if (child instanceof CSS2DObject && child.element.classList.contains("open-fem3d-utilization-label")) {
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
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "beam-visibility");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
        containerRef.current.dataset.openFem3dNonNodeLoadPickTargets = String(
          nonNodePickTargetsRef.current.filter((target) => LOAD_SELECTION_TYPES.has(
            target.userData.type as OpenFem3DSelectionType)).length);
      }
      return;
    }
    // Een wissel tussen hartlijnen en profielvolumes verandert alleen de
    // staven. Laat platen, opleggingen, lasten en alle andere GPU-buffers staan;
    // een volledige scène-opbouw uploadde die anders telkens opnieuw.
    const profileVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.profiles !== previousPresentation.visibility.profiles
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).every((key) =>
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
        && child.element.classList.contains("open-fem3d-profile-label"))) geometry.remove(label);
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
          profileGeometries.set(key, createOpenFem3DProfileGeometry(beam.profileName, length));
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
          new THREE.MeshStandardMaterial({ color: staafKleur(beam.id), roughness: 0.62, metalness: 0.04 }),
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
          geometry.add(makeLabel(beam.profileName!, "open-fem3d-profile-label",
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
      renderOpenFem3DLabels(state, containerRef.current);
      selectionRenderedWithModelRef.current = selectionRef.current;
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "beam-profiles");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dFullRenderMs = (performance.now() - renderStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dWebglRenderMs = webglRenderMs.toFixed(2);
        containerRef.current.dataset.openFem3dLabelRenderMs =
          (performance.now() - renderStartedAt - webglRenderMs).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
      }
      return;
    }
    // Verbergen/tonen van bestaande platen hoeft hun triangulatie niet opnieuw
    // te bouwen. Houd ook de pick-lijsten gelijk aan wat werkelijk zichtbaar is.
    const plateVisibilityOnly = previousModel === model
      && previousPresentation !== null
      && visibility.plates !== previousPresentation.visibility.plates
      && (Object.keys(visibility) as (keyof OpenFem3DVisibility)[]).every((key) =>
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
        if (child.userData.openFem3dPlateEdges === true) child.visible = visibility.plates;
      }
      const plateSet = new Set(existingPlateMeshes);
      selectionPickTargetsRef.current = selectionPickTargetsRef.current.filter((target) => !plateSet.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current.filter((target) => !plateSet.has(target));
      if (visibility.plates) {
        selectionPickTargetsRef.current.push(...existingPlateMeshes);
        nonNodePickTargetsRef.current.push(...existingPlateMeshes);
      }
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      rememberBuiltPresentation();
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "plate-visibility");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
      }
      return;
    }
    // Een nieuw, gewijzigd of verwijderd belastingvlak raakt geen staaf, plaat
    // of last: ververs dan alleen die laag in plaats van de hele scène.
    const loadPanelsChangedOnly = previousModel !== null && previousModel !== model
      && model.loadPanels !== previousModel.loadPanels
      && model.nodes === previousModel.nodes && model.beams === previousModel.beams
      && model.plates === previousModel.plates && model.supports === previousModel.supports
      && model.loads === previousModel.loads && model.memberLoads === previousModel.memberLoads
      && model.memberPointLoads === previousModel.memberPointLoads
      && model.thermalLoads === previousModel.thermalLoads && model.surfaceLoads === previousModel.surfaceLoads;
    const previousConditionModelForPanels = lastBuiltConditionModelRef.current;
    const loadPanelLayerOnly = previousPresentation !== null
      && ((loadPanelsChangedOnly && sameOpenFem3DVisibility(visibility, previousPresentation.visibility))
        || (previousModel === model && visibilityChangedOnly("loadPanels")))
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && (conditionModel === previousConditionModelForPanels
        || (conditionModel !== undefined && previousConditionModelForPanels !== undefined
          && sameVisibleConditionLoads(conditionModel, previousConditionModelForPanels, activeLoadCaseId)
          && sameOpenFem3DEntities(conditionModel.supports, previousConditionModelForPanels.supports)));
    if (loadPanelLayerOnly) {
      const labelDelta = replaceLoadPanelLayer();
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      lastBuiltModelRef.current = model;
      selectionRenderedWithModelRef.current = selectionRef.current;
      rememberBuiltPresentation();
      if (pendingAppendRef.current?.model === model) pendingAppendRef.current = null;
      if (containerRef.current) {
        writeBuildMode(containerRef.current, "load-panels");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
        containerRef.current.dataset.openFem3dLabels = String(
          Math.max(0, Number(containerRef.current.dataset.openFem3dLabels ?? 0) + labelDelta));
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
    const changedConditionLoadsOnly = previousModel !== null && previousModel !== model
      && model.nodes === previousModel.nodes
      && model.beams === previousModel.beams
      && model.plates === previousModel.plates
      && model.supports === previousModel.supports
      && model.surfaceLoads === previousModel.surfaceLoads
      && model.loadPanels === previousModel.loadPanels
      && (model.loads !== previousModel.loads || model.memberLoads !== previousModel.memberLoads
        || model.memberPointLoads !== previousModel.memberPointLoads
        || model.thermalLoads !== previousModel.thermalLoads);
    const conditionLayerOnly = (previousModel === model || changedConditionLoadsOnly)
      && previousPresentation !== null
      && (sameOpenFem3DVisibility(visibility, previousPresentation.visibility)
        || supportVisibilityOnly || loadVisibilityOnly)
      && structuralGrid === previousPresentation.structuralGrid
      && result === previousPresentation.result
      && utilizations === previousPresentation.utilizations
      && (supportVisibilityOnly || loadVisibilityOnly
        || conditionModel !== lastBuiltConditionModelRef.current
        || activeLoadCaseId !== previousPresentation.activeLoadCaseId);
    if (conditionLayerOnly) {
      const refreshSurfaceLoads = loadVisibilityOnly
        || activeLoadCaseId !== previousPresentation.activeLoadCaseId;
      let removedSurfaceLabelCount = 0;
      let addedSurfaceLabelCount = 0;
      if (refreshSurfaceLoads) {
        const oldSurfaceLoads = geometry.children.find((child) => child.userData.openFem3dSurfaceLoads === true);
        const oldSurfaceTargets = new Set<THREE.Object3D>();
        if (oldSurfaceLoads instanceof THREE.Group) {
          oldSurfaceLoads.traverse((object) => {
            oldSurfaceTargets.add(object);
            if (oldSurfaceLoads.visible && object instanceof CSS2DObject) removedSurfaceLabelCount += 1;
          });
          geometry.remove(oldSurfaceLoads);
          disposeGroup(oldSurfaceLoads);
        }
        selectionPickTargetsRef.current = selectionPickTargetsRef.current
          .filter((target) => !oldSurfaceTargets.has(target));
        nonNodePickTargetsRef.current = nonNodePickTargetsRef.current
          .filter((target) => !oldSurfaceTargets.has(target));
        const nextSurfaceLoads = new THREE.Group();
        nextSurfaceLoads.userData.openFem3dSurfaceLoads = true;
        const temporaryGeometries: THREE.BufferGeometry[] = [];
        addSurfaceLoadMarkers(nextSurfaceLoads, (plate) => {
          const built = createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined);
          if (built) temporaryGeometries.push(built.geometry);
          return built;
        });
        temporaryGeometries.forEach((plateGeometry) => plateGeometry.dispose());
        geometry.add(nextSurfaceLoads);
        nextSurfaceLoads.traverse((object) => {
          if (object instanceof CSS2DObject) addedSurfaceLabelCount += 1;
          if (object.userData.type === "surfaceLoad" && object.userData.pickable !== false
            && typeof (object as { raycast?: unknown }).raycast === "function") {
            selectionPickTargetsRef.current.push(object);
            nonNodePickTargetsRef.current.push(object);
          }
        });
        applySelectionHighlight(nextSurfaceLoads, selectionRef.current);
      }
      // Belastingvlakken horen, net als oppervlaktelasten, bij het actieve geval.
      const loadPanelLabelDelta = refreshSurfaceLoads ? replaceLoadPanelLayer() : 0;
      const oldConditions = geometry.children.find((child) => child.userData.openFem3dConditions === true);
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
      nextConditions.userData.openFem3dConditions = true;
      addOpenFem3DConditionMarkers(nextConditions, conditionModel ?? model, visibility, activeLoadCaseId);
      geometry.add(nextConditions);
      let addedLabelCount = 0;
      nextConditions.traverse((object) => {
        if (object instanceof CSS2DObject) addedLabelCount += 1;
        const type = object.userData.type as OpenFem3DSelectionType | undefined;
        if (type && object.userData.pickable !== false && SELECTABLE_TYPES.has(type)
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          if (type !== "node") nonNodePickTargetsRef.current.push(object);
        }
      });
      applySelectionHighlight(nextConditions, selectionRef.current);
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      lastBuiltModelRef.current = model;
      selectionRenderedWithModelRef.current = selectionRef.current;
      rememberBuiltPresentation();
      if (containerRef.current) {
        const previousLabelCount = Number(containerRef.current.dataset.openFem3dLabels ?? 0);
        const visibleLabelCount = Math.max(0,
          previousLabelCount - removedLabelCount + addedLabelCount
          - removedSurfaceLabelCount + addedSurfaceLabelCount + loadPanelLabelDelta);
        writeBuildMode(containerRef.current, "conditions");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
        containerRef.current.dataset.openFem3dNonNodeLoadPickTargets = String(
          nonNodePickTargetsRef.current.filter((target) => LOAD_SELECTION_TYPES.has(
            target.userData.type as OpenFem3DSelectionType)).length);
        containerRef.current.dataset.openFem3dLabels = String(visibleLabelCount);
      }
      return;
    }
    const surfaceLoadsOnly = previousModel !== null && previousPresentation !== null
      && model !== previousModel && model.surfaceLoads !== previousModel.surfaceLoads
      && sameOpenFem3DNodes(model.nodes, previousModel.nodes)
      && sameOpenFem3DEntities(model.beams, previousModel.beams)
      && sameOpenFem3DEntities(model.plates, previousModel.plates)
      && sameOpenFem3DEntities(model.supports, previousModel.supports)
      && sameOpenFem3DEntities(model.loads, previousModel.loads)
      && sameOpenFem3DEntities(model.memberLoads, previousModel.memberLoads)
      && sameOpenFem3DEntities(model.memberPointLoads, previousModel.memberPointLoads)
      && sameOpenFem3DEntities(model.thermalLoads, previousModel.thermalLoads)
      && sameOpenFem3DEntities(model.loadPanels, previousModel.loadPanels)
      && sameOpenFem3DVisibility(visibility, previousPresentation.visibility)
      && structuralGrid === previousPresentation.structuralGrid
      && result === null && previousPresentation.result === null
      && utilizations.length === 0 && previousPresentation.utilizations.length === 0
      && activeLoadCaseId === previousPresentation.activeLoadCaseId
      && sameVisibleConditionLoads(conditionModel ?? model,
        lastBuiltConditionModelRef.current ?? previousModel, activeLoadCaseId);
    const oldSurfaceLoads = surfaceLoadsOnly
      ? geometry.children.find((child) => child.userData.openFem3dSurfaceLoads === true)
      : undefined;
    if (surfaceLoadsOnly && oldSurfaceLoads instanceof THREE.Group) {
      const oldTargets = new Set<THREE.Object3D>();
      let oldLabels = 0;
      oldSurfaceLoads.traverse((object) => {
        oldTargets.add(object);
        if (object instanceof CSS2DObject) oldLabels += 1;
      });
      selectionPickTargetsRef.current = selectionPickTargetsRef.current
        .filter((target) => !oldTargets.has(target));
      nonNodePickTargetsRef.current = nonNodePickTargetsRef.current
        .filter((target) => !oldTargets.has(target));
      geometry.remove(oldSurfaceLoads);
      disposeGroup(oldSurfaceLoads);

      const nextSurfaceLoads = new THREE.Group();
      nextSurfaceLoads.userData.openFem3dSurfaceLoads = true;
      const temporaryGeometries: THREE.BufferGeometry[] = [];
      addSurfaceLoadMarkers(nextSurfaceLoads, (plate) => {
        const built = createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined);
        if (built) temporaryGeometries.push(built.geometry);
        return built;
      });
      temporaryGeometries.forEach((plateGeometry) => plateGeometry.dispose());
      geometry.add(nextSurfaceLoads);
      let nextLabels = 0;
      nextSurfaceLoads.traverse((object) => {
        if (object instanceof CSS2DObject) nextLabels += 1;
        const type = object.userData.type as OpenFem3DSelectionType | undefined;
        if (type === "surfaceLoad" && object.userData.pickable !== false
          && typeof (object as { raycast?: unknown }).raycast === "function") {
          selectionPickTargetsRef.current.push(object);
          nonNodePickTargetsRef.current.push(object);
        }
      });
      applySelectionHighlight(nextSurfaceLoads, selectionRef.current);
      state.renderer.render(state.scene, state.camera);
      renderOpenFem3DLabels(state, containerRef.current);
      lastBuiltModelRef.current = model;
      rememberBuiltPresentation();
      if (containerRef.current) {
        const previousLabelCount = Number(containerRef.current.dataset.openFem3dLabels ?? 0);
        writeBuildMode(containerRef.current, "surface-loads");
        containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
        containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
        containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
        containerRef.current.dataset.openFem3dNonNodeLoadPickTargets = String(
          nonNodePickTargetsRef.current.filter((target) => LOAD_SELECTION_TYPES.has(
            target.userData.type as OpenFem3DSelectionType)).length);
        containerRef.current.dataset.openFem3dLabels = String(
          Math.max(0, previousLabelCount - oldLabels + nextLabels));
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
      && model.surfaceLoads === previousModel.surfaceLoads
      && model.loadPanels === previousModel.loadPanels;
    const previousPlates = previousModel?.plates ?? [];
    const nextPlates = model.plates ?? [];
    const presentationStable = previousPresentation !== null
      && sameOpenFem3DVisibility(visibility, previousPresentation.visibility)
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
        sameOpenFem3DNodes(model.nodes, previousModel.nodes)
        && sameOpenFem3DEntities(model.beams, previousModel.beams)
        && sameOpenFem3DEntities(model.supports, previousModel.supports)
        && sameOpenFem3DEntities(model.loads, previousModel.loads)
        && sameOpenFem3DEntities(model.memberLoads, previousModel.memberLoads)
        && sameOpenFem3DEntities(model.memberPointLoads, previousModel.memberPointLoads)
        && sameOpenFem3DEntities(model.thermalLoads, previousModel.thermalLoads)
        && sameOpenFem3DEntities(model.surfaceLoads, previousModel.surfaceLoads)
        && sameOpenFem3DEntities(model.loadPanels, previousModel.loadPanels)
      ));
    const appendedPlate = hintedAppendedPlate ?? (previousModel !== null
      && !hasValidatedPlateHint
      && nonPlateCollectionsUnchanged
      && nextPlates.length === previousPlates.length + 1
      && nextPlates.length < 100
      && previousPlates.every((plate, index) => sameOpenFem3DEntities([plate], [nextPlates[index]]))
      ? nextPlates[nextPlates.length - 1]
      : undefined);
    const replacedPlateIndices = previousModel !== null && !hasValidatedPlateHint && nonPlateCollectionsUnchanged
      && nextPlates.length === previousPlates.length && nextPlates.length < 100
      ? nextPlates.flatMap((plate, index) => sameOpenFem3DEntities([plate], [previousPlates[index]]) ? [] : [index])
      : [];
    const replacedPlate = hintedReplacedPlate ?? (replacedPlateIndices.length === 1
      ? nextPlates[replacedPlateIndices[0]]
      : undefined);
    const changedPlate = appendedPlate ?? replacedPlate;
    if (containerRef.current && previousModel !== null && model.plates !== previousModel.plates) {
      containerRef.current.dataset.openFem3dPlateIncrementalFallback = [
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
      const built = createOpenFem3DPlateGeometry(model, changedPlate, nodeByIdRef.current ?? undefined);
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
        renderOpenFem3DLabels(state, containerRef.current);
        const renderMs = performance.now() - renderStartedAt;
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.openFem3dPlateIncrementalFallback;
          writeBuildMode(containerRef.current, appendedPlate ? "append-plate" : "update-plate");
          containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.openFem3dPlateGeometryMs = plateGeometryMs.toFixed(2);
          containerRef.current.dataset.openFem3dPlateLayerMs = plateLayerMs.toFixed(2);
          containerRef.current.dataset.openFem3dFullRenderMs = renderMs.toFixed(2);
          containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
        }
        return;
      }
      built?.geometry.dispose();
    }
    const movedNodes: OpenFem3DModel["nodes"] = [];
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
      || (plate.boundary ?? []).some((segment) => segment.kind === "arc" && movedNodeIds.has(segment.controlNodeId))
      || (plate.openings ?? []).some((opening) =>
        opening.nodeIds.some((id) => movedNodeIds.has(id))
        || (opening.boundary ?? []).some((segment) => segment.kind === "arc" && movedNodeIds.has(segment.controlNodeId))));
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
        // Een verschoven hoekknoop verplaatst het hele belastingvlak.
        && !(visibility.loadPanels && (model.loadPanels ?? []).some((panel) =>
          panel.nodeIds.some((id) => movedNodeIds.has(id))))
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
      && (!visibility.plates || (model.plates ?? []).length < 100 && affectedPlates.length <= 8)
      && conditionGeometryStable
      && resultGeometryStable
      && utilizationGeometryStable;
    if (containerRef.current && previousModel !== null && model !== previousModel && !incrementalNodeMove) {
      containerRef.current.dataset.openFem3dMoveFallback = [
        model.nodes === previousModel.nodes ? "nodes-unchanged" : "",
        !nodeTopologyStable ? "node-topology" : "",
        movedNodes.length === 0 ? "no-coordinate-change" : "",
        !unchangedCollections ? "collections" : "",
        model.beams !== previousModel.beams ? "beams" : "",
        movedNodes.length > 512 ? "selection-size" : "",
        previousModel.nodes.length < 250 ? "small-model" : "",
        !movedNodeRadiusStable ? "node-radius" : "",
        visibility.plates && ((model.plates ?? []).length >= 100 || affectedPlates.length > 8) ? "plates" : "",
        !conditionGeometryStable ? "conditions" : "",
        !resultGeometryStable ? "results" : "",
        !utilizationGeometryStable ? "utilization" : "",
      ].filter(Boolean).join(",");
    }
    if (incrementalNodeMove) {
      const visibleNodes = geometry.children.find((child) => child.userData.openFem3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.openFem3dNodeHit === true);
      const nodeMeshes = [visibleNodes, hitNodes].filter((child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh);
      let fastPathReady = nodeMeshes.length > 0;
      const movedMemberAxisLines: THREE.LineSegments[] = [];
      if (fastPathReady && visibility.memberAxes && affectedBeams.length > 0) {
        const axesGroup = geometry.children.find((child) => child.userData.openFem3dMemberAxes === true);
        for (let axisIndex = 0; axisIndex < 3; axisIndex += 1) {
          const lines = axesGroup?.children.find((child) => child.userData.openFem3dAxisIndex === axisIndex);
          const offsets = lines?.userData.openFem3dAxisVertexByBeamId as Map<number, number> | undefined;
          if (!(lines instanceof THREE.LineSegments) || !offsets
            || affectedBeams.some((beam) => !offsets.has(beam.id))) {
            fastPathReady = false;
            break;
          }
          movedMemberAxisLines.push(lines);
        }
      }
      const movedPlateMeshes: Array<{ mesh: THREE.Mesh; built: NonNullable<ReturnType<typeof createOpenFem3DPlateGeometry>> }> = [];
      if (fastPathReady && visibility.plates) {
        for (const plate of affectedPlates) {
          const mesh = geometry.children.find((child) => child.userData.type === "plate" && child.userData.id === plate.id);
          const built = createOpenFem3DPlateGeometry(model, plate, nodeByIdRef.current ?? undefined);
          if (!(mesh instanceof THREE.Mesh) || !built) {
            built?.geometry.dispose();
            fastPathReady = false;
            break;
          }
          movedPlateMeshes.push({ mesh, built });
        }
      }
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
          const mesh = geometry.children.find((child) => child.userData.openFem3dBeamBatchKey === profileKey);
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
              ? openFem3DProfileInstanceScale(length)
              : new THREE.Vector3(1, length, 1),
          );
          mesh.setMatrixAt(instanceIndex, beamMatrix);
          mesh.instanceMatrix.addUpdateRange(instanceIndex * 16, 16);
          mesh.instanceMatrix.needsUpdate = true;
          touchedBeamMeshes.add(mesh);
        }
      }
      if (fastPathReady) {
        for (const beam of affectedBeams) {
          if (movedMemberAxisLines.length === 0) break;
          const start = nodeByIdRef.current!.get(beam.startNodeId)!;
          const end = nodeByIdRef.current!.get(beam.endNodeId)!;
          const a = new THREE.Vector3(start.x, start.y, start.z);
          const b = new THREE.Vector3(end.x, end.y, end.z);
          const delta = b.clone().sub(a);
          const axes = memberAxes(delta, beam.rollAngleRad ?? 0);
          const origin = a.add(b).multiplyScalar(0.5);
          const axisLength = Math.min(0.5, Math.max(0.12, delta.length() * 0.16));
          ([axes.ex, axes.ey, axes.ez] as const).forEach((direction, axisIndex) => {
            const lines = movedMemberAxisLines[axisIndex];
            const offset = (lines.userData.openFem3dAxisVertexByBeamId as Map<number, number>).get(beam.id)!;
            const positions = lines.geometry.getAttribute("position") as THREE.BufferAttribute;
            memberAxisArrowPoints(origin, direction, axes, axisIndex, axisLength)
              .forEach((point, index) => positions.setXYZ(offset + index, point.x, point.y, point.z));
            positions.needsUpdate = true;
          });
        }
        movedMemberAxisLines.forEach((lines) => lines.geometry.computeBoundingSphere());
        for (const { mesh, built } of movedPlateMeshes) {
          const oldGeometry = mesh.geometry;
          mesh.geometry = built.geometry;
          mesh.position.copy(built.position);
          mesh.quaternion.copy(built.quaternion);
          oldGeometry.dispose();
          const edges = mesh.children.find((child): child is THREE.LineSegments => child instanceof THREE.LineSegments);
          if (edges) {
            edges.geometry.dispose();
            edges.geometry = new THREE.EdgesGeometry(built.geometry, 22);
          }
        }
        if (!movedInsideBounds) {
          nodeMeshes.forEach((mesh) => {
            mesh.computeBoundingBox();
            mesh.computeBoundingSphere();
          });
          if (visibility.structuralGrid && structuralGrid?.enabled) {
            const oldGrid = geometry.children.find((child) => child.userData.openFem3dStructuralGrid === true);
            if (oldGrid instanceof THREE.Group) {
              disposeGroup(oldGrid);
              geometry.remove(oldGrid);
            }
            const nextGrid = new THREE.Group();
            nextGrid.userData.openFem3dStructuralGrid = true;
            addStructuralGrid(nextGrid, model, structuralGrid);
            geometry.add(nextGrid);
            lastBuiltStructuralGridLayoutRef.current = structuralGridLayoutKey(model, structuralGrid);
          }
          lastBuiltNodeBoundsRef.current = openFem3DNodeBounds(model);
        }
        touchedBeamMeshes.forEach((mesh) => {
          mesh.computeBoundingBox();
          mesh.computeBoundingSphere();
        });
        geometry.traverse((object) => {
          if (!(object instanceof CSS2DObject)) return;
          const follow = object.userData.openFem3dFollow as { type: "node" | "beam"; id: number } | undefined;
          if (follow?.type === "node" && movedNodeIds.has(follow.id)) {
            const node = nodeByIdRef.current!.get(follow.id);
            if (!node) return;
            object.position.set(node.x, node.y, node.z);
            object.element.textContent = [
              visibility.nodeNumbers ? String(node.id) : "",
              visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
            ].filter(Boolean).join(" · ");
          } else if (follow?.type === "beam" && affectedBeamIds.has(follow.id)
            && object.element.classList.contains("open-fem3d-beam-number")) {
            const beam = beamByIdRef.current!.get(follow.id);
            const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
            const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
            if (!beam || !start || !end) return;
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const b = new THREE.Vector3(end.x, end.y, end.z);
            const axes = memberAxes(b.clone().sub(a), beam.rollAngleRad ?? 0);
            object.position.copy(a.add(b).multiplyScalar(0.5).addScaledVector(axes.ey, 0.3));
          } else if (follow?.type === "beam" && affectedBeamIds.has(follow.id)
            && object.element.classList.contains("open-fem3d-local-axis-label")) {
            const beam = beamByIdRef.current!.get(follow.id);
            const start = beam && nodeByIdRef.current!.get(beam.startNodeId);
            const end = beam && nodeByIdRef.current!.get(beam.endNodeId);
            if (!beam || !start || !end) return;
            const a = new THREE.Vector3(start.x, start.y, start.z);
            const b = new THREE.Vector3(end.x, end.y, end.z);
            const delta = b.clone().sub(a);
            const axes = memberAxes(delta, beam.rollAngleRad ?? 0);
            const axisIndex = object.userData.openFem3dAxisIndex as number;
            const direction = [axes.ex, axes.ey, axes.ez][axisIndex];
            const axisLength = Math.min(0.5, Math.max(0.12, delta.length() * 0.16));
            object.position.copy(a.add(b).multiplyScalar(0.5).addScaledVector(direction, axisLength));
          }
        });
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        renderOpenFem3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.openFem3dIncrementalFallback;
          delete containerRef.current.dataset.openFem3dMoveFallback;
          writeBuildMode(containerRef.current, "move-nodes");
          containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
        }
        return;
      }
      movedPlateMeshes.forEach(({ built }) => built.geometry.dispose());
      if (containerRef.current) containerRef.current.dataset.openFem3dMoveFallback = "gpu-target";
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
      && (!visibility.utilization || utilizations.length === 0)
      && profielKleurenStabiel;
    if (unhintedAppend) {
      const visibleNodes = geometry.children.find((child) => child.userData.openFem3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.openFem3dNodeHit === true);
      const nodeMeshes = [visibleNodes, hitNodes].filter((child): child is THREE.InstancedMesh =>
        child instanceof THREE.InstancedMesh);
      let fastPathReady = nodeMeshes.length > 0
        && nodeMeshes.every((mesh) => mesh.count + unhintedNodes.length <= mesh.instanceMatrix.count);
      const beamUpdates: Array<{
        beam: OpenFem3DModel["beams"][number];
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
          const candidate = geometry.children.find((child) => child.userData.openFem3dBeamBatchKey === profileKey);
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
          const utilizationClass = utilization ? openFem3DUtilizationClass(utilization) : undefined;
          beamUpdates.push({
            beam,
            mesh: candidate,
            color: staafKleur(beam.id, utilizationClass),
            matrix: new THREE.Matrix4().compose(
              a.add(b).multiplyScalar(0.5), rotation,
              isProfile ? openFem3DProfileInstanceScale(length) : new THREE.Vector3(1, length, 1),
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
              parts.join(" · "), "open-fem3d-node-label",
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
        renderOpenFem3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.openFem3dIncrementalFallback;
          writeBuildMode(containerRef.current, "append-copy");
          containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
          containerRef.current.dataset.openFem3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
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
      && (!visibility.utilization || utilizations.length === 0)
      && profielKleurenStabiel;
    if (incrementalTailRemoval) {
      const removedNodeIds = new Set(removedNodes.map((node) => node.id));
      const visibleNodes = geometry.children.find((child) => child.userData.openFem3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.openFem3dNodeHit === true);
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
          const candidate = geometry.children.find((child) => child.userData.openFem3dBeamBatchKey === profileKey);
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
          const follow = child.userData.openFem3dFollow as { type: "node" | "beam"; id: number } | undefined;
          if (follow?.type !== "node" || !removedNodeIds.has(follow.id)) continue;
          geometry.remove(child);
          child.element.remove();
        }
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        renderOpenFem3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.openFem3dIncrementalFallback;
          writeBuildMode(containerRef.current, "remove-copy");
          containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
          containerRef.current.dataset.openFem3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
        }
        return;
      }
    }
    const incrementalNodeOnly = appendedNode && model.beams === previousModel?.beams;
    const incrementalBeam = appendedBeam
      && (model.nodes === previousModel?.nodes || appendedNode);
    const interactivePlateNodeAppend = Boolean(incrementalNodeOnly)
      && (isPlateSketchTool(toolRef.current) || isOpeningTool(toolRef.current));
    if (previousModel && unchangedCollections && (incrementalNodeOnly || incrementalBeam) && profielKleurenStabiel) {
      const node = appendedNode ? model.nodes[model.nodes.length - 1]! : undefined;
      const previousBounds = lastBuiltNodeBoundsRef.current;
      const visibleNodes = geometry.children.find((child) => child.userData.openFem3dNodeVisual === true);
      const hitNodes = geometry.children.find((child) => child.userData.openFem3dNodeHit === true);
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
        ? geometry.children.find((child) => child.userData.openFem3dMemberAxes === true)
        : undefined;
      const memberAxesReady = !visibility.memberAxes || !beam || (
        memberAxesGroup instanceof THREE.Group
        && (previousModel.beams.length <= 12) === (model.beams.length <= 12)
        && [0, 1, 2].every((axisIndex) => memberAxesGroup.children.some((child) =>
          child.userData.openFem3dAxisIndex === axisIndex && child instanceof THREE.LineSegments))
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
        ? geometry.children.find((child) => child.userData.openFem3dBeamBatchKey === profileKey)
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
        && Math.abs(openFem3DConditionMarkerSize((conditionModel ?? model).nodes)
          - openFem3DConditionMarkerSize((previousConditionModel ?? previousModel).nodes)) < 1e-12;
      const nodeInsideBounds = !node || interactivePlateNodeAppend
        || (previousBounds !== null && previousBounds.containsPoint(new THREE.Vector3(node.x, node.y, node.z)))
        || outsideBoundsScaleStable;
      const fastPathReady = nodeCapacityAvailable && beamCapacityAvailable && beamEndpointsValid
        && conditionLoadsStable && beamLabelSamplingStable
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
        if (node && !nodeLabelSamplingStable && (visibility.nodeNumbers || visibility.nodeCoordinates)) {
          // Een extra knoop kan de labelstap wijzigen (bijvoorbeeld 264 -> 265).
          // Ververs alleen knooplabels; de bestaande plaat- en profielgeometrie
          // hoeft daarvoor niet opnieuw te worden opgebouwd.
          const oldLabels = geometry.children.filter((child) => child instanceof CSS2DObject
            && child.element.classList.contains("open-fem3d-node-label"));
          for (const label of oldLabels) geometry.remove(label);
          addedLabels -= oldLabels.length;
          for (let index = 0; index < model.nodes.length; index += nodeLabelStride) {
            const labeledNode = model.nodes[index];
            const parts = [
              visibility.nodeNumbers ? String(labeledNode.id) : "",
              visibility.nodeCoordinates
                ? `(${labeledNode.x}, ${labeledNode.y}, ${labeledNode.z}) m` : "",
            ].filter(Boolean);
            geometry.add(makeLabel(
              parts.join(" · "), "open-fem3d-node-label",
              new THREE.Vector3(labeledNode.x, labeledNode.y, labeledNode.z),
              { type: "node", id: labeledNode.id },
            ));
            addedLabels += 1;
          }
        } else if (node && (visibility.nodeNumbers || visibility.nodeCoordinates)
          && (model.nodes.length - 1) % nodeLabelStride === 0) {
          const parts = [
            visibility.nodeNumbers ? String(node.id) : "",
            visibility.nodeCoordinates ? `(${node.x}, ${node.y}, ${node.z}) m` : "",
          ].filter(Boolean);
          geometry.add(makeLabel(
            parts.join(" · "), "open-fem3d-node-label",
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
          const utilizationClass = utilization ? openFem3DUtilizationClass(utilization) : undefined;
          const color = staafKleur(beam.id, utilizationClass);
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
            isProfile ? openFem3DProfileInstanceScale(length) : new THREE.Vector3(1, length, 1),
          );
          beamMesh.setMatrixAt(index, beamMatrix);
          beamMesh.setColorAt(index, new THREE.Color(color));
          markInstanceChanged(beamMesh, index);
          expandInstancedMeshBounds(beamMesh, beamMatrix);
          if (visibility.beamNumbers && (model.beams.length - 1) % beamLabelStride === 0) {
            const midpoint = new THREE.Vector3(start.x, start.y, start.z)
              .add(new THREE.Vector3(end.x, end.y, end.z)).multiplyScalar(0.5)
              .addScaledVector(memberAxes(delta, beam.rollAngleRad ?? 0).ey, 0.3);
            geometry.add(makeLabel(`(${beam.id})`, "open-fem3d-beam-number", midpoint));
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
            ? createOpenFem3DProfileGeometry(beam.profileName, length)
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
          const utilizationClass = utilization ? openFem3DUtilizationClass(utilization) : undefined;
          const color = staafKleur(beam.id, utilizationClass);
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
              `(${beam.id})`, "open-fem3d-beam-number",
              mesh.position.clone().addScaledVector(axes.ey, 0.3),
            ));
            addedLabels += 1;
          }
          if (visibility.profiles && beam.profileName) {
            geometry.add(makeLabel(
              beam.profileName, "open-fem3d-profile-label",
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
              child.userData.openFem3dAxisIndex === axisIndex) as THREE.LineSegments;
            const previousPositions = line.geometry.getAttribute("position").array as Float32Array;
            const combined = new Float32Array(previousPositions.length + positions.length);
            combined.set(previousPositions);
            combined.set(positions, previousPositions.length);
            line.geometry.dispose();
            line.geometry = new THREE.BufferGeometry();
            line.geometry.setAttribute("position", new THREE.BufferAttribute(combined, 3));
            line.geometry.computeBoundingSphere();
            if (model.beams.length <= 12 || selectionRef.current?.type === "beam" && selectionRef.current.id === beam.id) {
              memberAxesGroup.add(makeLabel(["x", "y", "z"][axisIndex], "open-fem3d-local-axis-label", tip));
              addedLabels += 1;
            }
          });
        }
        applySelectionHighlight(geometry, selectionRef.current);
        state.renderer.render(state.scene, state.camera);
        renderOpenFem3DLabels(state, containerRef.current);
        selectionRenderedWithModelRef.current = selectionRef.current;
        lastBuiltModelRef.current = model;
        lastBuiltNodeBoundsRef.current = openFem3DNodeBounds(model);
        rememberBuiltPresentation();
        pendingAppendRef.current = null;
        if (containerRef.current) {
          delete containerRef.current.dataset.openFem3dIncrementalFallback;
          writeBuildMode(containerRef.current, beam
            ? node ? "append-node-beam" : "append-beam"
            : "append-node");
          containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
          containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
          containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
          containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
          containerRef.current.dataset.openFem3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
          if (addedLabels !== 0) {
            containerRef.current.dataset.openFem3dLabels = String(
              Math.max(0, Number(containerRef.current.dataset.openFem3dLabels ?? 0) + addedLabels),
            );
          }
        }
        return;
      }
      if (containerRef.current) {
        containerRef.current.dataset.openFem3dIncrementalFallback = [
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
    const oldStructuralGrid = geometry.children.find((child) => child.userData.openFem3dStructuralGrid === true);
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
    const byId = indexOpenFem3DNodes(model);
    let plateGeometryMs = 0;
    const plateGeometryById = new Map<number, ReturnType<typeof createOpenFem3DPlateGeometry>>();
    const plateGeometryFor = (plate: NonNullable<OpenFem3DModel["plates"]>[number]) => {
      if (!plateGeometryById.has(plate.id)) {
        const startedAt = performance.now();
        plateGeometryById.set(plate.id, createOpenFem3DPlateGeometry(model, plate, byId));
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
        profileGeometryCache.set(key, createOpenFem3DProfileGeometry(profileName, length));
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
    const memberAxisVertexByBeamId = new Map<number, number>();
    const memberAxesGroup = new THREE.Group();
    memberAxesGroup.userData.openFem3dMemberAxes = true;
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
        memberAxisVertexByBeamId.set(beam.id, localAxisSegments[0].length / 3);
        ([axes.ex, axes.ey, axes.ez] as const).forEach((direction, axisIndex) => {
          const points = memberAxisArrowPoints(origin, direction, axes, axisIndex, axisLength);
          points.forEach((point) => localAxisSegments[axisIndex].push(point.x, point.y, point.z));
          if (model.beams.length <= 12 || selectionRef.current?.type === "beam" && selectionRef.current.id === beam.id) {
            const label = makeLabel(["x", "y", "z"][axisIndex], "open-fem3d-local-axis-label", points[1], { type: "beam", id: beam.id });
            label.userData.openFem3dAxisIndex = axisIndex;
            memberAxesGroup.add(label);
          }
        });
      }
      if (visibility.beams) {
        const utilization = visibility.utilization ? utilizationByMember.get(beam.id) : undefined;
        const utilizationClass = utilization ? openFem3DUtilizationClass(utilization) : undefined;
        const color = staafKleur(beam.id, utilizationClass);
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
              profileGeometry ? openFem3DProfileInstanceScale(length) : new THREE.Vector3(1, length, 1),
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
            `open-fem3d-utilization-label open-fem3d-utilization-${utilizationClass}`,
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
        geometry.add(makeLabel(`(${beam.id})`, "open-fem3d-beam-number", midpoint, { type: "beam", id: beam.id }));
      }
      if (visibility.profiles && beam.profileName && !useBeamInstancing) {
        const midpoint = a.clone().add(b).multiplyScalar(0.5).addScaledVector(axes.ez, -0.3);
        geometry.add(makeLabel(beam.profileName, "open-fem3d-profile-label", midpoint));
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
        lines.userData.openFem3dAxisIndex = axisIndex;
        lines.userData.openFem3dAxisVertexByBeamId = memberAxisVertexByBeamId;
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
        openFem3dBeamBatchKey: batchKey,
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
            openFem3dPlateBatchKey: batchKey,
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
          edges.userData = { openFem3dPlateEdges: true, pickable: false };
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
          openFem3dNodeVisual: true,
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
        openFem3dNodeHit: true,
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
          parts.join(" · "), "open-fem3d-node-label",
          new THREE.Vector3(node.x, node.y, node.z), { type: "node", id: node.id },
        ));
      }
    }
    if (visibility.structuralGrid && structuralGrid && !preservedStructuralGrid) {
      const structuralGridGroup = new THREE.Group();
      structuralGridGroup.userData.openFem3dStructuralGrid = true;
      addStructuralGrid(structuralGridGroup, model, structuralGrid);
      geometry.add(structuralGridGroup);
    }
    const conditionGroup = new THREE.Group();
    conditionGroup.userData.openFem3dConditions = true;
    addOpenFem3DConditionMarkers(conditionGroup, conditionModel ?? model, visibility, activeLoadCaseId);
    geometry.add(conditionGroup);

    const surfaceLoadGroup = new THREE.Group();
    surfaceLoadGroup.userData.openFem3dSurfaceLoads = true;
    geometry.add(surfaceLoadGroup);
    addSurfaceLoadMarkers(surfaceLoadGroup, plateGeometryFor);

    const loadPanelGroup = new THREE.Group();
    loadPanelGroup.userData.openFem3dLoadPanels = true;
    geometry.add(loadPanelGroup);
    addLoadPanelLayer(loadPanelGroup);

    // Trek-alleen: staven die in deze uitkomst op druk stonden en niet
    // meededen, gestippeld en grijs, met een label (zelfde dichtheid als de
    // resultaatlabels). De legenda staat in de editor.
    const inactiveMembers = new Set(result?.inactiveMembers ?? []);
    if (inactiveMembers.size > 0) {
      const inactivePoints: THREE.Vector3[] = [];
      for (const [beamIndex, beam] of model.beams.entries()) {
        if (!inactiveMembers.has(beam.id)) continue;
        const start = byId.get(beam.startNodeId), end = byId.get(beam.endNodeId);
        if (!start || !end) continue;
        const a = new THREE.Vector3(start.x, start.y, start.z);
        const b = new THREE.Vector3(end.x, end.y, end.z);
        inactivePoints.push(a, b);
        if (resultLabelVisible(beam.id, beamIndex)) {
          geometry.add(makeLabel(t("openFem3d.trekSchijf.canvasInactive"),
            "open-fem3d-result-label open-fem3d-inactive-label", a.clone().add(b).multiplyScalar(0.5)));
        }
      }
      addInactiveMemberLines(geometry, inactivePoints);
    }
    if (containerRef.current) containerRef.current.dataset.openFem3dInactiveMembers = String(inactiveMembers.size);

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
      const modelBox = openFem3DNodeBounds(model);
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
          geometry.add(makeLabel(parts.join(" · "), "open-fem3d-result-label", midpoint));
        }
      }
      diagramBatches?.forEach((batch) => flushResultDiagramBatch(geometry, batch));
    }
    let visibleLabelCount = 0;
    geometry.traverse((object) => {
      if (object instanceof CSS2DObject) visibleLabelCount += 1;
      const type = object.userData.type as OpenFem3DSelectionType | undefined;
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
    renderOpenFem3DLabels(state, containerRef.current);
    const renderMs = performance.now() - renderStartedAt;
    selectionRenderedWithModelRef.current = selectionRef.current;
    writeCameraDiagnostics(containerRef.current, state);
    if (containerRef.current) {
      writeBuildMode(containerRef.current, preservedStructuralGrid ? "full-grid-reuse" : "full");
      containerRef.current.dataset.openFem3dBuildMs = (performance.now() - rebuildStartedAt).toFixed(2);
      containerRef.current.dataset.openFem3dPlateGeometryMs = plateGeometryMs.toFixed(2);
      containerRef.current.dataset.openFem3dPlateLayerMs = plateLayerMs.toFixed(2);
      containerRef.current.dataset.openFem3dFullRenderMs = renderMs.toFixed(2);
      containerRef.current.dataset.openFem3dWebglRenderMs = webglRenderMs.toFixed(2);
      containerRef.current.dataset.openFem3dLabelRenderMs = (renderMs - webglRenderMs).toFixed(2);
      containerRef.current.dataset.openFem3dDrawCalls = String(state.renderer.info.render.calls);
      containerRef.current.dataset.openFem3dSceneObjects = String(geometry.children.length);
      containerRef.current.dataset.openFem3dPickTargets = String(selectionPickTargetsRef.current.length);
      containerRef.current.dataset.openFem3dNodeSnapTargets = String(nodePickTargetsRef.current.length);
      containerRef.current.dataset.openFem3dLabels = String(visibleLabelCount);
    }
    lastBuiltModelRef.current = model;
    rememberBuiltPresentation();
    lastBuiltNodeBoundsRef.current = openFem3DNodeBounds(model);
    lastBuiltStructuralGridLayoutRef.current = nextStructuralGridLayout;
    if (pendingAppendRef.current?.model === model) pendingAppendRef.current = null;
    nodeSnapPrewarmRef.current?.();
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, loadCaseTypes]);

  // De vervormde vorm als eigen laag, na de scène-opbouw hierboven: een
  // andere vergroting of Origineel tonen bouwt alleen deze laag opnieuw, niet
  // het hele model. Na een volledige opbouw (die de laag weggooit) komt hij
  // terug; anders blijft hij staan zolang model, resultaat en vergroting
  // gelijk zijn.
  const deformedLayerRef = useRef<{
    group: THREE.Group; model: OpenFem3DModel; result: OpenFem3DSolveResult; profiles: boolean; scale: number;
  } | null>(null);
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const { geometry } = state;
    const display = deformationDisplay ?? DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY;
    const shown = result && visibility.deformation ? result : null;
    const scale = shown ? openFem3DDeformationScale(display, openFem3DAutoDeformationScale(model, shown)) : 0;
    const current = deformedLayerRef.current;
    let changed = false;
    const reusable = shown !== null && current !== null && current.group.parent === geometry && current.model === model
      && current.result === shown && current.profiles === visibility.profiles && current.scale === scale;
    if (!reusable) {
      if (current) {
        current.group.removeFromParent();
        disposeObject3D(current.group);
        deformedLayerRef.current = null;
        changed = true;
      }
      if (shown) {
        const built = buildDeformedLayer(model, shown, visibility.profiles, scale);
        geometry.add(built.group);
        deformedLayerRef.current = { group: built.group, model, result: shown, profiles: visibility.profiles, scale };
        changed = true;
        if (containerRef.current) containerRef.current.dataset.openFem3dDeformedSweeps = String(built.sweeps);
      }
    }
    const mode: OriginalPresentation = !shown ? "normal" : display.showOriginal ? "ghost" : "hidden";
    if (applyOriginalPresentation(geometry, mode)) changed = true;
    if (containerRef.current) {
      containerRef.current.dataset.openFem3dDeformationScale = shown ? scale.toPrecision(6) : "none";
      containerRef.current.dataset.openFem3dOriginal = mode;
    }
    if (changed) state.renderer.render(state.scene, state.camera);
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, deformationDisplay]);

  // Platen: rekennet ("Mesh") en resultaatcontour in een eigen laag. Deze
  // effect volgt op elke (her)bouw hierboven, zodat de gewone plaatvlakken na
  // een herbouw opnieuw doorzichtig worden als er een contour ligt.
  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    const previous = state.scene.getObjectByName("open-fem3d-plate-overlay");
    if (previous) {
      state.scene.remove(previous);
      disposeObject3D(previous);
    }
    const hasPlates = (model.plates ?? []).length > 0;
    if (!hasPlates) {
      if (containerRef.current) containerRef.current.dataset.openFem3dPlateOverlay = "none";
      return;
    }
    const overlay = buildOpenFem3DPlateOverlay({
      model, mesh: plateMesh, result: result ?? null, quantity: plateQuantity,
      showMesh: visibility.mesh, showPlates: visibility.plates, showSupports: visibility.supports,
      deformation: visibility.deformation,
      // Dezelfde vergroting als de vervormde staven (schuifregelaar in Resultaten).
      deformationScale: result ? openFem3DDeformationScale(deformationDisplay ?? DEFAULT_OPEN_FEM_3D_DEFORMATION_DISPLAY, openFem3DAutoDeformationScale(model, result)) : 1,
    });
    state.scene.add(overlay.group);
    // Met een contour worden de gewone plaatvlakken bijna doorzichtig, ook
    // geselecteerd: de selectiemarkering leest baseOpacity/selectionOpacity.
    state.geometry.traverse((child) => {
      if (child.userData.type !== "plate" || !(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const data = child.userData;
      data.plainBaseOpacity ??= data.baseOpacity ?? materials[0].opacity;
      if (data.selectionOpacity !== undefined) data.plainSelectionOpacity ??= data.selectionOpacity;
      data.baseOpacity = overlay.contourShown ? 0.15 : data.plainBaseOpacity;
      if (data.plainSelectionOpacity !== undefined) {
        data.selectionOpacity = overlay.contourShown ? 0.3 : data.plainSelectionOpacity;
      }
      const opacity = data.openFem3dSelected && data.selectionOpacity !== undefined ? data.selectionOpacity : data.baseOpacity;
      for (const material of materials) {
        if (material.opacity === opacity && material.depthWrite === !overlay.contourShown) continue;
        material.opacity = opacity;
        material.depthWrite = !overlay.contourShown;
        material.needsUpdate = true;
      }
    });
    state.renderer.render(state.scene, state.camera);
    if (containerRef.current) {
      containerRef.current.dataset.openFem3dPlateOverlay =
        overlay.contourShown ? `contour:${plateQuantity}`
          : overlay.group.children.some((child) => child.userData.openFem3dPlateMesh !== undefined) ? "mesh" : "none";
      // Aantal getekende symbooldelen van de randopleggingen (gebundeld per vorm).
      containerRef.current.dataset.openFem3dEdgeSupportGlyphs = String(
        overlay.group.getObjectByName("open-fem3d-plate-edge-supports")?.children.reduce((count, child) =>
          count + (child instanceof THREE.InstancedMesh ? child.count : child instanceof THREE.Mesh ? 1 : 0), 0) ?? 0);
    }
  }, [model, conditionModel, visibility, structuralGrid, result, utilizations, activeLoadCaseId, plateMesh, plateQuantity, deformationDisplay]);

  useEffect(() => {
    const state = sceneRef.current;
    if (!state) return;
    if (selectionRenderedWithModelRef.current === selection) {
      selectionRenderedWithModelRef.current = undefined;
      if (containerRef.current) containerRef.current.dataset.openFem3dSelectionMs = "0.00";
      return;
    }
    const selectionStartedAt = performance.now();
    applySelectionHighlight(state.geometry, selection);
    state.renderer.render(state.scene, state.camera);
    if (containerRef.current) {
      containerRef.current.dataset.openFem3dSelectionMs = (performance.now() - selectionStartedAt).toFixed(2);
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
    renderOpenFem3DLabels(state, containerRef.current);
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
    cameraViewChangeRef.current?.(openFem3DViewFromCamera(state.camera.position, state.controls.target));
    state.renderer.render(state.scene, state.camera);
    renderOpenFem3DLabels(state, containerRef.current);
    writeCameraDiagnostics(containerRef.current, state);
    nodeSnapPrewarmRef.current?.();
  }, [cameraRequest?.token]);

  return <div
    className={`open-fem3d-canvas open-fem3d-tool-${tool} ${tool.startsWith("support:") || tool.startsWith("spring:") || tool === "addMemberLoad" || tool === "loadPanelSpan" ? "open-fem3d-tool-support" : ""}`}
    ref={containerRef}
    aria-label={`3D raamwerk · ${viewRequest?.kind ?? currentView}`}
  />;
}
